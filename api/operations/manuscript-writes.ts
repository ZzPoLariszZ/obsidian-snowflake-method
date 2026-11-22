import { normalizePath } from 'obsidian';

import {
	followerRenames,
	proposeChapterPlacement,
	proposeChapterRemovalAmong,
	resolvePassage,
	type ChapterPlacement,
} from '../../src/domain';
import type { ManuscriptSegmentRecord, ProjectSnapshot, SegmentRenameOutcome } from '../../src/services';
import { relativePathOf } from '../dto/manuscript';
import { ApiError, changedSince } from '../errors';
import type { JsonObject } from '../json';
import {
	NOT_THE_AUTHOR,
	bodyOf,
	flagParam,
	optionalTextParam,
	textParam,
	type ApiContext,
	type OperationCall,
	type OperationGroup,
} from './context';
import { findManuscriptNote, tellManuscriptNote } from './manuscript';

type Sent = Readonly<Record<string, unknown>>;
type Rename = { path: string; title: string };

/** The note at an address a body or a query gives, among the manuscript's notes in hand. */
function noteAt(project: ProjectSnapshot, segments: readonly ManuscriptSegmentRecord[], relativePath: string, pointer: string): ManuscriptSegmentRecord {
	const wanted = normalizePath(`${project.rootPath}/${relativePath}`);
	const found = segments.find((segment) => segment.path === wanted);
	if (found === undefined) {
		throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
			errors: [{ pointer, detail: 'The manuscript has no note at that address. listManuscriptNotes gives the addresses there are.' }],
		});
	}
	return found;
}

/** A note a newer version of the plugin wrote is read and never changed. */
function writable(segment: ManuscriptSegmentRecord): ManuscriptSegmentRecord {
	if (segment.readOnly) {
		throw new ApiError('read-only', 'A newer version of the plugin wrote this note, and this one may only read it.', { path: segment.path });
	}
	return segment;
}

/**
 * Makes notes ready for a change. What the author typed into them and had
 * not saved is saved first. The version a caller names is then held against
 * the note as it stands after that, so a change worked out from an older
 * text is refused and not made over the author's words. Only once the
 * change is sure to be made is the plugin's editor on each note closed: a
 * call that is refused leaves the author writing where they were.
 *
 * `first` is the note the caller's version is of. The rest are notes the
 * change rewrites along with it. Answers the version `first` was held at,
 * which is the one the change must then be made against: closing an editor
 * writes whatever was typed in the moment before, and a change made
 * against any later version would go over those last words.
 */
async function ready(context: ApiContext, call: OperationCall, first: string, rest: readonly string[] = []): Promise<string> {
	const paths = [first, ...rest];
	await context.host.settleNotes(paths);
	const standing = await context.host.projects.manuscript.readSegment(first);
	if (call.ifMatch !== null && call.ifMatch !== '*' && standing.revision !== call.ifMatch) throw changedSince(standing.revision);
	await context.host.releaseNotes(paths);
	return standing.revision;
}

/**
 * A note's text where it still stands at the version it was made ready at.
 * For the changes the manuscript service makes against its own reading of a
 * note, which cannot be handed a version to hold it to.
 */
async function textAt(context: ApiContext, path: string, revision: string): Promise<string> {
	const standing = await context.host.projects.manuscript.readSegment(path);
	if (standing.revision !== revision) throw changedSince(standing.revision);
	return standing.body;
}

/** What a renumbering did, each note by its address. */
function renumberedOf(project: ProjectSnapshot, outcome: SegmentRenameOutcome): { renumbered: JsonObject[]; skipped: string[] } {
	return {
		renumbered: outcome.renamed.map(({ from, to }) => ({ from: relativePathOf(project, from), to: relativePathOf(project, to) })),
		skipped: outcome.skipped.map((path) => relativePathOf(project, path)),
	};
}

/**
 * What the author's numbering rule offers a note placed among the others,
 * and asks of the notes after it. Nothing where no rule is switched on.
 */
function placing(context: ApiContext, segments: readonly ManuscriptSegmentRecord[], placement: ChapterPlacement): { head: string | null; renames: Rename[] } {
	const numbering = context.host.chapterNumbering();
	if (numbering === null) return { head: null, renames: [] };
	const proposal = proposeChapterPlacement(segments, placement, numbering);
	return { head: proposal.head, renames: followerRenames(proposal) };
}

/** The same for the note at an index leaving the manuscript. */
function removing(context: ApiContext, segments: readonly ManuscriptSegmentRecord[], index: number): Rename[] {
	const numbering = context.host.chapterNumbering();
	return numbering === null ? [] : followerRenames(proposeChapterRemovalAmong(segments, index, numbering));
}

/** The name a new note takes: the one sent, or the one the rule offers, and one of the two there must be. */
function titleOf(body: Sent, head: string | null): string {
	if (typeof body['title'] === 'string') return body['title'].trim();
	if (head !== null) return head;
	throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
		errors: [{ pointer: '/title', detail: "No title was sent, and the author's numbering rule offers none at this place." }],
	});
}

/** Where a note is cut: at a place in its text, or where some of its words begin. */
function cutOf(text: string, sent: unknown): number {
	const point = (typeof sent === 'object' && sent !== null ? sent : {}) as Sent;
	if (typeof point['offset'] === 'number') return Math.min(point['offset'], text.length);
	const exact = String(point['exact']);
	const found = resolvePassage(text, exact, typeof point['prefix'] === 'string' ? point['prefix'] : '', typeof point['suffix'] === 'string' ? point['suffix'] : '');
	if (found !== null) return found.from;
	throw text.includes(exact)
		? new ApiError('ambiguous-passage', 'The note says those words in more than one place. Send a few of the words before or after them as prefix or suffix.', { pointer: '/at' })
		: new ApiError('passage-not-found', 'The note does not say those words. Read it again: its text may have changed.', { pointer: '/at' });
}

const renumbers = (body: Sent): boolean => body['renumber'] !== false;

/**
 * The manuscript, changed. Each change goes through the plugin's own
 * manuscript service, with the renumbering the plugin's own dialogs offer.
 * A note's text is never written over what the author is in the middle of
 * typing: see `ready`.
 */
export const manuscriptWriteOperations: OperationGroup = {
	planManuscriptNumbering: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const after = optionalTextParam(call, 'after');
		const position = optionalTextParam(call, 'position');
		const remove = optionalTextParam(call, 'remove');
		if ([after, position, remove].filter((value) => value !== null).length !== 1) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: [{ pointer: 'params', detail: 'Say one of after, position and remove, and only one.' }],
			});
		}
		const segments = await context.host.projects.manuscript.listSegmentsFromFiles(project);
		const rule = context.host.chapterNumbering() !== null;
		const told = (renames: readonly Rename[]): JsonObject[] =>
			renames.map((rename) => {
				const from = relativePathOf(project, rename.path);
				return { from, to: `${from.slice(0, from.lastIndexOf('/') + 1)}${rename.title}.md` };
			});
		if (remove !== null) {
			const index = segments.indexOf(noteAt(project, segments, remove, 'params/remove'));
			return { status: 200, body: { rule, head: null, renames: told(removing(context, segments, index)) } };
		}
		const placement: ChapterPlacement =
			after !== null ? { after: noteAt(project, segments, after, 'params/after').path } : position === 'start' ? { atStart: true } : { atEnd: true };
		const plan = placing(context, segments, placement);
		return { status: 200, body: { rule, head: plan.head, renames: told(plan.renames) } };
	},

	createManuscriptNote: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const manuscript = context.host.projects.manuscript;
		const segments = await manuscript.listSegmentsFromFiles(project);
		const placement: ChapterPlacement =
			typeof body['after'] === 'string'
				? { after: noteAt(project, segments, body['after'], '/after').path }
				: body['position'] === 'start'
					? { atStart: true }
					: { atEnd: true };
		const plan = placing(context, segments, placement);
		const title = titleOf(body, plan.head);
		const renames = renumbers(body) ? plan.renames : [];
		// A renamed note's heading is rewritten with its name, so each is made ready as a note about to be written.
		if (renames.length > 0) await ready(context, call, renames[0]?.path ?? '', renames.slice(1).map((rename) => rename.path));
		const made = await manuscript.createSegmentAt(project, placement, title, renames, {
			...(typeof body['body'] === 'string' ? { body: body['body'] } : {}),
			...NOT_THE_AUTHOR,
		});
		const { project: after } = await context.loadProject(projectId);
		const told = await tellManuscriptNote(context, after, made.path);
		return {
			status: 201,
			body: { note: told.body, ...renumberedOf(after, made.renumbered) },
			etag: told.etag,
			location: `/projects/${encodeURIComponent(projectId)}/manuscript/notes/${encodeURIComponent(relativePathOf(after, made.path))}`,
		};
	},

	writeManuscriptNoteBody: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const { segment, segments } = await findManuscriptNote(context, project, call);
		writable(segment);
		const revision = await ready(context, call, segment.path);
		await context.host.projects.manuscript.writeSegment(segment.path, String(bodyOf(call)['body']), revision, NOT_THE_AUTHOR);
		return { status: 200, ...(await tellManuscriptNote(context, project, segment.path, segments)) };
	},

	renameManuscriptNote: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const { segment } = await findManuscriptNote(context, project, call);
		writable(segment);
		const body = bodyOf(call);
		const service = context.host.projects;
		await ready(context, call, segment.path);
		const heading = typeof body['heading'] === 'boolean' ? body['heading'] : (await service.manuscript.segmentNaming(segment.path)).matches;
		const moved = await service.renameManuscriptSegment(project, segment.path, String(body['title']), { heading, ...NOT_THE_AUTHOR });
		const { project: after } = await context.loadProject(projectId);
		const told = await tellManuscriptNote(context, after, moved.to);
		return {
			status: 200,
			body: { note: told.body, renumbered: [], skipped: [] },
			etag: told.etag,
			location: `/projects/${encodeURIComponent(projectId)}/manuscript/notes/${encodeURIComponent(relativePathOf(after, moved.to))}`,
		};
	},

	splitManuscriptNote: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const { segment, segments } = await findManuscriptNote(context, project, call);
		writable(segment);
		const body = bodyOf(call);
		const plan = placing(context, segments, { after: segment.path });
		const title = titleOf(body, plan.head);
		const renames = renumbers(body) ? plan.renames : [];
		const revision = await ready(
			context,
			call,
			segment.path,
			renames.map((rename) => rename.path),
		);
		const manuscript = context.host.projects.manuscript;
		// Found in the text as it stands once the author's last words are in it.
		const offset = cutOf(await textAt(context, segment.path, revision), body['at']);
		const cut = await manuscript.splitSegmentAt(project, segment.path, offset, title, renames, NOT_THE_AUTHOR);
		const { project: after } = await context.loadProject(projectId);
		const told = await tellManuscriptNote(context, after, cut.path);
		const head = await manuscript.readSegment(segment.path);
		return {
			status: 201,
			body: {
				note: told.body,
				...renumberedOf(after, cut.renumbered),
				source: { relativePath: relativePathOf(after, segment.path), etag: head.revision },
			},
			etag: told.etag,
			location: `/projects/${encodeURIComponent(projectId)}/manuscript/notes/${encodeURIComponent(relativePathOf(after, cut.path))}`,
		};
	},

	mergeManuscriptNoteWithNext: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const { segment, segments, index } = await findManuscriptNote(context, project, call);
		const later = segments[index + 1];
		if (later === undefined) {
			throw new ApiError('nothing-to-merge', 'That is the last note of the manuscript, and no note stands after it to merge with.');
		}
		writable(segment);
		writable(later);
		const renames = call.body === undefined || renumbers(bodyOf(call)) ? removing(context, segments, index + 1) : [];
		await ready(context, call, segment.path, [later.path, ...renames.map((rename) => rename.path)]);
		// A merge writes no word of its own. It moves the author's words from one note into another, and is told
		// to the plugin as the author's own merging is: the note that takes them gains what the note that goes
		// loses. Told as a stranger's write, the one would count as words lost and the other as nothing gained.
		const merged = await context.host.projects.mergeManuscriptSegments(project, segment.path, renames);
		const told = await tellManuscriptNote(context, merged.project, segment.path);
		return {
			status: 200,
			body: { note: told.body, ...renumberedOf(merged.project, merged.renumbered), removed: relativePathOf(project, later.path) },
			etag: told.etag,
		};
	},

	deleteManuscriptNote: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const { segment, segments, index } = await findManuscriptNote(context, project, call);
		writable(segment);
		const renames = flagParam(call, 'renumber') ? removing(context, segments, index) : [];
		const revision = await ready(
			context,
			call,
			segment.path,
			renames.map((rename) => rename.path),
		);
		await textAt(context, segment.path, revision);
		const gone = await context.host.projects.deleteManuscriptSegment(project, segment.path, renames, NOT_THE_AUTHOR);
		const { project: after } = await context.loadProject(projectId);
		return {
			status: 200,
			body: {
				removed: relativePathOf(project, segment.path),
				neighbour: gone.neighbour === null ? null : relativePathOf(after, gone.neighbour),
				...renumberedOf(after, gone.renumbered),
			},
		};
	},
};
