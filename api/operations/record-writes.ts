import {
	DEFAULT_STICKY_NOTE_COLOR,
	DEFAULT_TASK_PRIORITY,
	DEFAULT_TASK_STATUS,
	anchorRevision,
	captureOccurrence,
	captureOccurrencePlacement,
	captureRevision,
	isForeshadowingStatus,
	isOccurrenceRole,
	isStickyNoteColor,
	isTaskDay,
	isTaskPriority,
	isTaskStatus,
	overlapsLive,
	resolvePassage,
	type EntityRef,
	type Foreshadowing,
	type ForeshadowingStatus,
	type OccurrenceRole,
	type RevisionKind,
	type Task,
	type TaskEdit,
} from '../../src/domain';
import type { ProjectSnapshot, StickyNoteRecord } from '../../src/services';
import { relativePathOf } from '../dto/manuscript';
import type { MemberIndex } from '../dto/member';
import { occurrenceOf, stickyNoteOf } from '../dto/records';
import { ApiError, changedSince } from '../errors';
import type { JsonObject } from '../json';
import { NOT_THE_AUTHOR, bodyOf, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';
import { noteAt } from './manuscript-writes';
import { tellManuscriptNote } from './manuscript';
import { gone, readPassageNotes, tellForeshadowing, tellRevision, tellTask } from './records';
import { foreign, free, isSent, misfit, taken, textOf } from './refusals';

/** What a thread starts as, and an appearance is taken for, where a caller does not say: as the plugin's own forms have it. */
const FIRST_STATUS: ForeshadowingStatus = 'planned';
const FIRST_ROLE: OccurrenceRole = 'plant';

/** What a service said a change came to, held to the one answer that lets a handler go on. */
function settled(outcome: 'written' | 'deleted' | 'removed' | 'absent' | 'refused', what: string, list: string, file: string): void {
	if (outcome === 'refused') throw foreign(file);
	if (outcome === 'absent') throw gone(what, list);
}

/**
 * The notes a record is about, as a record keeps them: each by its id, with
 * the kind and the name the note has now. One the record already names is
 * kept as the record has it. So a record read and sent back whole changes
 * nothing, and a note deleted since is not a reason to refuse the rest.
 */
function relatedOf(index: MemberIndex, sent: unknown, kept: readonly EntityRef[]): EntityRef[] {
	const refs: EntityRef[] = [];
	(Array.isArray(sent) ? sent : []).forEach((entry: unknown, at) => {
		const id = isSent(entry) ? textOf(entry['id']) : '';
		if (refs.some((ref) => ref.id === id)) return;
		const standing = kept.find((ref) => ref.id === id);
		if (standing !== undefined) {
			refs.push(standing);
			return;
		}
		const member = index.byId(id);
		if (member === null) {
			throw new ApiError('invalid-reference', 'The project has no note with that id. listMembers gives the ids there are.', {
				pointer: `/related/${String(at)}`,
				id,
			});
		}
		refs.push({ kind: member.kind, id: member.id, name: member.name });
	});
	return refs;
}

/** A day due, or none. The contract holds it to the look of a day, and the calendar says whether there is one. */
function dayOf(sent: unknown): string | null {
	if (sent === null || sent === undefined) return null;
	if (isTaskDay(sent)) return sent;
	throw misfit('/dueDate', 'That is not a day the calendar has.');
}

/** A passage of a manuscript note as a caller names it, with where in the call it was named. */
interface Place {
	readonly note: string;
	readonly passage: unknown;
	readonly pointer: string;
}

/** A passage found: the note it stands in, what the note says now, and where in that it stands. */
interface Found {
	readonly path: string;
	readonly text: string;
	readonly from: number;
	readonly to: number;
}

/** Where a passage stands in a text: found by its words, or taken as the place it was said to be. */
function rangeIn(text: string, sent: unknown, pointer: string): { from: number; to: number } {
	const passage = isSent(sent) ? sent : {};
	const exact = passage['exact'];
	if (typeof exact === 'string') {
		const found = resolvePassage(text, exact, textOf(passage['prefix']), textOf(passage['suffix']));
		if (found !== null) return found;
		throw text.includes(exact)
			? new ApiError('ambiguous-passage', 'The note says those words in more than one place. Send a few of the words before or after them as prefix or suffix.', { pointer })
			: new ApiError('passage-not-found', 'The note does not say those words. Read it again: its text may have changed.', { pointer });
	}
	const from = Number(passage['from']);
	const to = Number(passage['to']);
	if (to < from) throw misfit(`${pointer}/to`, 'A passage ends at or after the place it begins.');
	if (to > text.length) {
		throw new ApiError('passage-not-found', 'The note is shorter than that. Read it again: its text may have changed.', { pointer });
	}
	return { from, to };
}

/**
 * The passages a call names, each found in its note. What the author has
 * typed into those notes and not saved is saved first, so that a passage is
 * looked for in the words the author sees. The notes are only read: a mark
 * is kept beside the manuscript, never in it, and no editor is closed.
 */
async function findPassages(context: ApiContext, project: ProjectSnapshot, places: readonly Place[]): Promise<Found[]> {
	if (places.length === 0) return [];
	const manuscript = context.host.projects.manuscript;
	const segments = await manuscript.listSegmentsFromFiles(project);
	const paths = places.map((place) => noteAt(project, segments, place.note, `${place.pointer}/note`).path);
	const distinct = [...new Set(paths)];
	await context.host.settleNotes(distinct);
	const texts = new Map<string, string>();
	for (const path of distinct) texts.set(path, (await manuscript.readSegment(path)).body);
	return places.map((place, at) => {
		const path = paths[at] ?? '';
		const text = texts.get(path) ?? '';
		return { path, text, ...rangeIn(text, place.passage, `${place.pointer}/passage`) };
	});
}

/** A place a thread appears is words the author could have picked out. Blank lines and spaces alone are nothing to mark. */
function marked(found: Found, pointer: string): Found {
	if (found.text.slice(found.from, found.to).trim().length === 0) {
		throw misfit(`${pointer}/passage`, 'Blank lines and spaces alone are no passage to mark.');
	}
	return found;
}

/** The thread of an id, or the refusal that it is not there. */
async function threadOf(context: ApiContext, project: ProjectSnapshot, id: string): Promise<{ item: Foreshadowing; all: readonly Foreshadowing[] }> {
	const all = await context.host.projects.foreshadowing.list(project);
	const item = all.find((entry) => entry.id === id);
	if (item === undefined) throw gone('foreshadowing thread', 'listForeshadowing');
	return { item, all };
}

const noAppearance = (): ApiError =>
	new ApiError('not-found', 'The thread has no appearance with that id. It may have been taken off. getForeshadowing gives the ones it has.');

/** One appearance of a thread, held against its note as the note is now. */
async function tellOccurrence(context: ApiContext, project: ProjectSnapshot, id: string, occurrenceId: string): Promise<JsonObject> {
	const { item } = await threadOf(context, project, id);
	const occurrence = item.occurrences.find((entry) => entry.id === occurrenceId);
	if (occurrence === undefined) throw noAppearance();
	return occurrenceOf(await readPassageNotes(context, project, [occurrence.path]), occurrence);
}

/** The sticky note of an id, where this version may change it. */
async function stickyNoteOfId(context: ApiContext, project: ProjectSnapshot, id: string): Promise<StickyNoteRecord> {
	const note = (await context.host.projects.stickyNotes.list(project)).find((entry) => entry.id === id);
	if (note === undefined) throw gone('sticky note', 'listStickyNotes');
	if (note.readOnly) {
		throw new ApiError('read-only', 'A newer version of the plugin wrote this note, and this one may only read it.', { path: note.path });
	}
	return note;
}

/**
 * Makes a sticky note ready for a change, as a manuscript note is made
 * ready. What the author typed into it and had not saved is saved first.
 * The version a caller names is held against the note as it stands after
 * that. Only then, and only where the change asks it, is the author's
 * editor on the note closed. Whether it asks is said of the note as it then
 * stands: a note read and sent back whole names its text again, which is no
 * change to it and no reason to close anything. Answers the note as it was
 * held: a change to what it says is made against that version and no later
 * one.
 */
async function readySticky(
	context: ApiContext,
	call: OperationCall,
	note: StickyNoteRecord,
	release: (standing: StickyNoteRecord) => boolean,
): Promise<StickyNoteRecord> {
	await context.host.settleNotes([note.path]);
	const standing = await context.host.projects.stickyNotes.read(note.path);
	if (standing === null) throw gone('sticky note', 'listStickyNotes');
	if (call.ifMatch !== null && call.ifMatch !== '*' && standing.revision !== call.ifMatch) throw changedSince(standing.revision);
	if (release(standing)) await context.host.releaseNotes([note.path]);
	return standing;
}

const under = (projectId: string, ...rest: string[]): string =>
	`/projects/${encodeURIComponent(projectId)}/${rest.map((part) => encodeURIComponent(part)).join('/')}`;

/**
 * Tasks, foreshadowing threads, proposed revisions and sticky notes,
 * changed. Each change goes through the service the plugin's own screens
 * change them through, and is held to what those screens hold a change to:
 * a name no other has, a passage that is words, a revision that stands
 * over no other.
 *
 * A thread's appearance and a revision are marks beside the manuscript.
 * Making one never writes a manuscript note, so none of these closes an
 * editor the author is writing in. A sticky note is the author's own text,
 * and is changed with the care a chapter is.
 */
export const recordWriteOperations: OperationGroup = {
	createTask: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const tasks = context.host.projects.tasks;
		const title = textOf(body['title']).trim();
		if (!free((await tasks.list(project)).map((task) => task.title), title, null)) throw taken('task', title);
		const now = context.host.now();
		const task: Task = {
			id: context.host.mint('task'),
			title,
			description: textOf(body['description']).trim(),
			status: isTaskStatus(body['status']) ? body['status'] : DEFAULT_TASK_STATUS,
			priority: isTaskPriority(body['priority']) ? body['priority'] : DEFAULT_TASK_PRIORITY,
			dueDate: dayOf(body['dueDate']),
			related: relatedOf(context.members(project), body['related'], []),
			archived: body['archived'] === true,
			createdAt: now,
			updatedAt: now,
		};
		if (!(await tasks.create(project, task))) throw foreign('tasks');
		context.host.recordsChanged('tasks');
		return { status: 201, body: await tellTask(context, project, task.id), location: under(projectId, 'tasks', task.id) };
	},

	updateTask: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'taskId');
		const body = bodyOf(call);
		const tasks = context.host.projects.tasks;
		const standing = await tasks.list(project);
		const kept = standing.find((task) => task.id === id);
		if (kept === undefined) throw gone('task', 'listTasks');
		const title = typeof body['title'] === 'string' ? body['title'].trim() : kept.title;
		const others = standing.filter((task) => task.id !== id).map((task) => task.title);
		if (!free(others, title, kept.title)) throw taken('task', title);
		const next: TaskEdit = {
			title,
			description: typeof body['description'] === 'string' ? body['description'].trim() : kept.description,
			status: isTaskStatus(body['status']) ? body['status'] : kept.status,
			priority: isTaskPriority(body['priority']) ? body['priority'] : kept.priority,
			dueDate: 'dueDate' in body ? dayOf(body['dueDate']) : kept.dueDate,
			related: 'related' in body ? relatedOf(context.members(project), body['related'], kept.related) : kept.related,
		};
		settled(await tasks.edit(project, id, next), 'task', 'listTasks', 'tasks');
		const archived = body['archived'];
		if (typeof archived === 'boolean' && archived !== kept.archived) {
			settled(await tasks.setArchived(project, id, archived), 'task', 'listTasks', 'tasks');
		}
		context.host.recordsChanged('tasks');
		return { status: 200, body: await tellTask(context, project, id) };
	},

	deleteTask: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		settled(await context.host.projects.tasks.remove(project, [textParam(call, 'taskId')]), 'task', 'listTasks', 'tasks');
		context.host.recordsChanged('tasks');
		return { status: 204 };
	},

	moveTask: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'taskId');
		const body = bodyOf(call);
		const tasks = context.host.projects.tasks;
		const standing = await tasks.list(project);
		const kept = standing.find((task) => task.id === id);
		if (kept === undefined) throw gone('task', 'listTasks');
		const status = isTaskStatus(body['status']) ? body['status'] : kept.status;
		const before = typeof body['before'] === 'string' ? body['before'] : null;
		if (before !== null) {
			// The plugin's own board lets a card dropped on a neighbour that has gone fall to the column's end,
			// since a drop is aimed at what was painted. A caller names its neighbour, and is told where it named none.
			const neighbour = standing.find((task) => task.id === before);
			if (before === id || neighbour === undefined || neighbour.archived || neighbour.status !== status) {
				throw new ApiError('invalid-reference', 'No other task of that id stands in the column asked for. listTasks gives each column in order.', {
					pointer: '/before',
					id: before,
				});
			}
		}
		settled(await tasks.move(project, id, status, before), 'task', 'listTasks', 'tasks');
		context.host.recordsChanged('tasks');
		return { status: 200, body: await tellTask(context, project, id) };
	},

	purgeArchivedTasks: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const tasks = context.host.projects.tasks;
		const aside = (await tasks.list(project)).filter((task) => task.archived).map((task) => task.id);
		// Asked even where nothing is set aside: a file this version may not write says so either way.
		if ((await tasks.remove(project, aside, { archivedOnly: true })) === 'refused') throw foreign('tasks');
		const left = new Set((await tasks.list(project)).map((task) => task.id));
		const removed = aside.filter((id) => !left.has(id)).length;
		if (removed > 0) context.host.recordsChanged('tasks');
		return { status: 200, body: { removed } };
	},

	createForeshadowing: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const threads = context.host.projects.foreshadowing;
		const name = textOf(body['name']).trim();
		if (!free((await threads.list(project)).map((item) => item.name), name, null)) throw taken('foreshadowing', name);
		const related = relatedOf(context.members(project), body['related'], []);
		const places = (Array.isArray(body['occurrences']) ? body['occurrences'] : []).filter(isSent);
		const found = await findPassages(
			context,
			project,
			places.map((place, at) => ({ note: textOf(place['note']), passage: place['passage'], pointer: `/occurrences/${String(at)}` })),
		);
		const now = context.host.now();
		const item: Foreshadowing = {
			id: context.host.mint('foreshadowing'),
			name,
			description: textOf(body['description']).trim(),
			status: isForeshadowingStatus(body['status']) ? body['status'] : FIRST_STATUS,
			related,
			createdAt: now,
			updatedAt: now,
			occurrences: found.map((passage, at) => {
				const place = places[at] ?? {};
				const { path, text, from, to } = marked(passage, `/occurrences/${String(at)}`);
				const role = isOccurrenceRole(place['role']) ? place['role'] : FIRST_ROLE;
				return captureOccurrence(path, text, from, to, role, textOf(place['comment']).trim(), context.host.mint('occurrence'));
			}),
		};
		if (!(await threads.create(project, item))) throw foreign('foreshadowing threads');
		context.host.recordsChanged('margin');
		return { status: 201, body: await tellForeshadowing(context, project, item.id), location: under(projectId, 'foreshadowing', item.id) };
	},

	updateForeshadowing: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'foreshadowingId');
		const body = bodyOf(call);
		const { item: kept, all } = await threadOf(context, project, id);
		const name = typeof body['name'] === 'string' ? body['name'].trim() : kept.name;
		const others = all.filter((item) => item.id !== id).map((item) => item.name);
		if (!free(others, name, kept.name)) throw taken('foreshadowing', name);
		const outcome = await context.host.projects.foreshadowing.edit(project, id, {
			name,
			description: typeof body['description'] === 'string' ? body['description'] : kept.description,
			status: isForeshadowingStatus(body['status']) ? body['status'] : kept.status,
			related: 'related' in body ? relatedOf(context.members(project), body['related'], kept.related) : kept.related,
			// The places it appears are left as they stand: each is changed by an operation of its own.
			occurrences: [],
			removed: [],
		});
		settled(outcome, 'foreshadowing thread', 'listForeshadowing', 'foreshadowing threads');
		context.host.recordsChanged('margin');
		return { status: 200, body: await tellForeshadowing(context, project, id) };
	},

	deleteForeshadowing: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const outcome = await context.host.projects.foreshadowing.deleteItem(project, textParam(call, 'foreshadowingId'));
		settled(outcome, 'foreshadowing thread', 'listForeshadowing', 'foreshadowing threads');
		context.host.recordsChanged('margin');
		return { status: 204 };
	},

	addForeshadowingOccurrence: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'foreshadowingId');
		const body = bodyOf(call);
		await threadOf(context, project, id);
		const [passage] = await findPassages(context, project, [{ note: textOf(body['note']), passage: body['passage'], pointer: '' }]);
		if (passage === undefined) throw new ApiError('internal-error', 'The operation failed.');
		const { path, text, from, to } = marked(passage, '');
		const role = isOccurrenceRole(body['role']) ? body['role'] : FIRST_ROLE;
		const occurrence = captureOccurrence(path, text, from, to, role, textOf(body['comment']).trim(), context.host.mint('occurrence'));
		const outcome = await context.host.projects.foreshadowing.addOccurrence(project, id, occurrence);
		settled(outcome, 'foreshadowing thread', 'listForeshadowing', 'foreshadowing threads');
		context.host.recordsChanged('margin');
		return { status: 201, body: await tellOccurrence(context, project, id, occurrence.id) };
	},

	updateForeshadowingOccurrence: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'foreshadowingId');
		const occurrenceId = textParam(call, 'occurrenceId');
		const body = bodyOf(call);
		const threads = context.host.projects.foreshadowing;
		const { item } = await threadOf(context, project, id);
		const held = item.occurrences.find((entry) => entry.id === occurrenceId);
		if (held === undefined) throw noAppearance();
		if ('passage' in body) {
			// A note is named by its address, or sent back as it was read. Where none is named, the passage is looked for in the note the appearance stands in.
			const sent = body['note'];
			const note = typeof sent === 'string' ? sent : isSent(sent) && typeof sent['relativePath'] === 'string' ? sent['relativePath'] : relativePathOf(project, held.path);
			const [passage] = await findPassages(context, project, [{ note, passage: body['passage'], pointer: '' }]);
			if (passage === undefined) throw new ApiError('internal-error', 'The operation failed.');
			const { path, text, from, to } = marked(passage, '');
			const outcome = await threads.relinkOccurrence(project, id, occurrenceId, captureOccurrencePlacement(path, text, from, to));
			settled(outcome, 'foreshadowing thread', 'listForeshadowing', 'foreshadowing threads');
		}
		if ('role' in body || 'comment' in body) {
			const outcome = await threads.updateOccurrence(project, id, occurrenceId, {
				role: isOccurrenceRole(body['role']) ? body['role'] : held.role,
				note: typeof body['comment'] === 'string' ? body['comment'] : held.note,
			});
			settled(outcome, 'foreshadowing thread', 'listForeshadowing', 'foreshadowing threads');
		}
		context.host.recordsChanged('margin');
		return { status: 200, body: await tellOccurrence(context, project, id, occurrenceId) };
	},

	deleteForeshadowingOccurrence: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'foreshadowingId');
		const occurrenceId = textParam(call, 'occurrenceId');
		const { item } = await threadOf(context, project, id);
		if (!item.occurrences.some((entry) => entry.id === occurrenceId)) throw noAppearance();
		const outcome = await context.host.projects.foreshadowing.deleteOccurrence(project, id, occurrenceId);
		if (outcome === 'refused') throw foreign('foreshadowing threads');
		if (outcome === 'absent') throw noAppearance();
		context.host.recordsChanged('margin');
		return { status: 204 };
	},

	createRevision: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const revisions = context.host.projects.revisions;
		const kind = body['kind'] as RevisionKind;
		const proposed = kind === 'delete' ? '' : textOf(body['proposed']);
		if (kind !== 'delete' && proposed.length === 0) {
			throw misfit(
				'/proposed',
				kind === 'insert'
					? 'An insertion proposes words. Send them as proposed.'
					: 'A replacement proposes words. To take the passage out and put nothing in its place, send the kind delete.',
			);
		}
		const [passage] = await findPassages(context, project, [{ note: textOf(body['note']), passage: body['passage'], pointer: '' }]);
		if (passage === undefined) throw new ApiError('internal-error', 'The operation failed.');
		// New words go in right after the passage named, which stays. Anything else stands over the passage itself.
		const from = kind === 'insert' ? passage.to : passage.from;
		const to = passage.to;
		if (kind !== 'insert' && to === from) throw misfit('/passage', 'There are no words at a place. Name the words the revision stands over.');
		const clash = overlapsLive(passage.text, await revisions.list(project), passage.path, from, to);
		if (clash !== null) {
			throw new ApiError('overlapping-revision', 'Another revision already stands over part of that passage. Change that one or discard it first.', {
				revisionId: clash.id,
			});
		}
		const revision = captureRevision(
			passage.path,
			passage.text,
			kind,
			from,
			to,
			proposed,
			textOf(body['comment']).trim(),
			context.host.mint('revision'),
			context.host.now(),
		);
		if (!(await revisions.create(project, revision))) throw foreign('revisions');
		context.host.recordsChanged('margin');
		return { status: 201, body: await tellRevision(context, project, revision.id), location: under(projectId, 'revisions', revision.id) };
	},

	updateRevision: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'revisionId');
		const body = bodyOf(call);
		const revisions = context.host.projects.revisions;
		const kept = (await revisions.list(project)).find((entry) => entry.id === id);
		if (kept === undefined) throw gone('revision', 'listRevisions');
		const proposed = typeof body['proposed'] === 'string' ? body['proposed'] : kept.proposed;
		if (kept.kind === 'insert' && proposed.length === 0) {
			throw misfit('/proposed', 'An insertion proposes words. To take it away, discard the revision.');
		}
		const comment = typeof body['comment'] === 'string' ? body['comment'] : kept.comment;
		// The service answers whether the revision stood. It was read a moment ago, so one that does not has just been taken away.
		if (!(await revisions.update(project, id, { proposed, comment }))) throw gone('revision', 'listRevisions');
		context.host.recordsChanged('margin');
		return { status: 200, body: await tellRevision(context, project, id) };
	},

	discardRevision: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const outcome = await context.host.projects.revisions.remove(project, textParam(call, 'revisionId'), 'discarded');
		settled(outcome, 'revision', 'listRevisions', 'revisions');
		context.host.recordsChanged('margin');
		return { status: 204 };
	},

	acceptRevision: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'revisionId');
		const revision = (await context.host.projects.revisions.list(project)).find((entry) => entry.id === id);
		if (revision === undefined) throw gone('revision', 'listRevisions');
		const manuscript = context.host.projects.manuscript;
		const segments = await manuscript.listSegmentsFromFiles(project);
		const segment = segments.find((entry) => entry.path === revision.path);
		const lost = (detail: string): ApiError => new ApiError('passage-not-found', detail, { note: relativePathOf(project, revision.path) });
		if (segment === undefined) throw lost('The note the revision was proposed in is no longer one of the manuscript\'s. discardRevision takes the revision away.');
		if (segment.readOnly) {
			throw new ApiError('read-only', 'A newer version of the plugin wrote this note, and this one may only read it.', { path: segment.path });
		}
		// The passage is found again in the note as it stands once the author's last words are in it.
		await context.host.settleNotes([segment.path]);
		const standing = await manuscript.readSegment(segment.path);
		const anchor = anchorRevision(standing.body, revision);
		if (anchor.state === 'conflict') {
			throw lost('The note no longer says the words the revision was proposed over, or says them in more places than can be told apart. getRevision shows how it stands.');
		}
		// The author's editor on the note is closed only now that the change is sure to be made.
		await context.host.releaseNotes([segment.path]);
		const accepted = standing.body.slice(0, anchor.from) + revision.proposed + standing.body.slice(anchor.to);
		await manuscript.writeSegment(segment.path, accepted, standing.revision, NOT_THE_AUTHOR);
		settled(await context.host.projects.revisions.remove(project, id, 'accepted'), 'revision', 'listRevisions', 'revisions');
		context.host.recordsChanged('margin');
		return { status: 200, ...(await tellManuscriptNote(context, project, segment.path, segments)) };
	},

	createStickyNote: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = call.body === undefined ? {} : bodyOf(call);
		const made = await context.host.projects.stickyNotes.create(
			project,
			isStickyNoteColor(body['color']) ? body['color'] : DEFAULT_STICKY_NOTE_COLOR,
			new Date(context.host.now()),
			undefined,
			textOf(body['body']),
			body['archived'] === true,
		);
		context.host.recordsChanged('stickyNotes');
		return { status: 201, body: stickyNoteOf(made, true), etag: made.revision, location: under(projectId, 'sticky-notes', made.id) };
	},

	updateStickyNote: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const note = await stickyNoteOfId(context, project, textParam(call, 'stickyNoteId'));
		const body = bodyOf(call);
		const text = typeof body['body'] === 'string' ? body['body'] : null;
		const archived = typeof body['archived'] === 'boolean' ? body['archived'] : null;
		// An editor left open would write its own text back over new words, and the plugin's own screens close one before a note is set aside.
		// Text that is the note's own already, and a note set aside that is aside already, change nothing and close nothing.
		const standing = await readySticky(
			context,
			call,
			note,
			(held) => (text !== null && text !== held.body) || (archived === true && !held.archived),
		);
		const notes = context.host.projects.stickyNotes;
		if (text !== null && text !== standing.body) await notes.writeBody(note.path, text, standing.revision, NOT_THE_AUTHOR);
		const color = body['color'];
		if (isStickyNoteColor(color) && color !== standing.color) await notes.setColor(note.path, color);
		if (archived !== null && archived !== standing.archived) await notes.setArchived(note.path, archived);
		context.host.recordsChanged('stickyNotes');
		const told = await notes.read(note.path);
		if (told === null) throw gone('sticky note', 'listStickyNotes');
		return { status: 200, body: stickyNoteOf(told, true), etag: told.revision };
	},

	deleteStickyNote: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const note = await stickyNoteOfId(context, project, textParam(call, 'stickyNoteId'));
		await readySticky(context, call, note, () => true);
		await context.host.projects.stickyNotes.trash(note.path);
		context.host.stickyNoteDeleted(note.id);
		context.host.recordsChanged('stickyNotes');
		return { status: 204 };
	},
};
