import { normalizePath } from 'obsidian';

import {
	TASK_STATUSES,
	orderForeshadowings,
	orderOccurrences,
	orderRevisions,
	sortStickyNotes,
	type StickyNoteSort,
} from '../../src/domain';
import type { ProjectSnapshot } from '../../src/services';
import { PassageNotes, foreshadowingOf, revisionOf, stickyNoteOf, taskOf } from '../dto/records';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { pageOf } from '../paging';
import { optionalTextParam, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';

/** Whether something that can be set aside is among what a call asks for. */
function inState(call: OperationCall, archived: boolean): boolean {
	const state = textParam(call, 'state');
	return state === 'all' || (state === 'archived') === archived;
}

export const gone = (what: string, list: string): ApiError =>
	new ApiError('not-found', `There is no ${what} with that id in the project. It may have been deleted. ${list} gives the ones there are.`);

/**
 * The manuscript's notes in reading order, with what each of the named ones
 * says. A note is read only where it is one of the manuscript's own: a
 * record is a file like any other, and a path written into it by hand
 * could name any note of the vault.
 */
export async function readPassageNotes(context: ApiContext, project: ProjectSnapshot, named: readonly string[]): Promise<PassageNotes> {
	const notes = new PassageNotes(project, await context.host.projects.manuscript.listSegmentsFromFiles(project));
	for (const path of new Set(named)) {
		if (!notes.holds(path)) continue;
		// A note that cannot be read leaves its passages lost, as it does on the author's own tables.
		notes.keep(path, (await context.host.projects.repository.tryReadManaged(path))?.body ?? null);
	}
	return notes;
}

/** One task, as it stands in the file now. */
export async function tellTask(context: ApiContext, project: ProjectSnapshot, id: string): Promise<JsonObject> {
	const task = (await context.host.projects.tasks.list(project)).find((entry) => entry.id === id);
	if (task === undefined) throw gone('task', 'listTasks');
	return taskOf(context.members(project), task, context.host.today());
}

/** One thread with every place it appears, in reading order. */
export async function tellForeshadowing(context: ApiContext, project: ProjectSnapshot, id: string): Promise<JsonObject> {
	const item = (await context.host.projects.foreshadowing.list(project)).find((entry) => entry.id === id);
	if (item === undefined) throw gone('foreshadowing thread', 'listForeshadowing');
	const named = item.occurrences.map((occurrence) => occurrence.path);
	const notes = await readPassageNotes(context, project, named);
	return foreshadowingOf(context.members(project), notes, item, orderOccurrences(item, notes.order(named), notes.bodyOf));
}

/** One proposed revision, held against its note as the note is now. */
export async function tellRevision(context: ApiContext, project: ProjectSnapshot, id: string): Promise<JsonObject> {
	const revision = (await context.host.projects.revisions.list(project)).find((entry) => entry.id === id);
	if (revision === undefined) throw gone('revision', 'listRevisions');
	return revisionOf(await readPassageNotes(context, project, [revision.path]), revision);
}

/**
 * Tasks, foreshadowing threads, proposed revisions and sticky notes, read.
 * Each is read from the file the plugin keeps it in, which is small, and
 * held against the manuscript only where it marks a passage there.
 */
export const recordOperations: OperationGroup = {
	listTasks: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const status = optionalTextParam(call, 'status');
		const priority = optionalTextParam(call, 'priority');
		const kept = (await context.host.projects.tasks.list(project)).filter(
			(task) =>
				inState(call, task.archived) && (status === null || task.status === status) && (priority === null || task.priority === priority),
		);
		// The file keeps one order for the whole board. Told column by column, each column reads from its top.
		const rows = TASK_STATUSES.flatMap((column) => kept.filter((task) => task.status === column));
		const index = context.members(project);
		const today = context.host.today();
		return { status: 200, body: pageOf(rows, call, (task) => taskOf(index, task, today)) };
	},

	getTask: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		return { status: 200, body: await tellTask(context, project, textParam(call, 'taskId')) };
	},

	listForeshadowing: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const status = optionalTextParam(call, 'status');
		const items = (await context.host.projects.foreshadowing.list(project)).filter((item) => status === null || item.status === status);
		const named = items.flatMap((item) => item.occurrences.map((occurrence) => occurrence.path));
		const notes = await readPassageNotes(context, project, named);
		const paths = notes.order(named);
		const index = context.members(project);
		return {
			status: 200,
			body: pageOf(orderForeshadowings(items, paths, notes.bodyOf), call, (item) =>
				foreshadowingOf(index, notes, item, orderOccurrences(item, paths, notes.bodyOf)),
			),
		};
	},

	getForeshadowing: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		return { status: 200, body: await tellForeshadowing(context, project, textParam(call, 'foreshadowingId')) };
	},

	listRevisions: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const kind = optionalTextParam(call, 'kind');
		const asked = optionalTextParam(call, 'note');
		const wanted = asked === null ? null : normalizePath(`${project.rootPath}/${asked}`);
		const revisions = (await context.host.projects.revisions.list(project)).filter(
			(revision) => (kind === null || revision.kind === kind) && (wanted === null || revision.path === wanted),
		);
		const named = revisions.map((revision) => revision.path);
		const notes = await readPassageNotes(context, project, wanted === null ? named : [wanted]);
		// A slip in the address would otherwise read as a note with nothing proposed on it.
		if (wanted !== null && !notes.holds(wanted)) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: [{ pointer: 'params/note', detail: 'The manuscript has no note at that address. listManuscriptNotes gives the addresses there are.' }],
			});
		}
		return {
			status: 200,
			body: pageOf(orderRevisions(revisions, notes.order(named), notes.bodyOf), call, (revision) => revisionOf(notes, revision)),
		};
	},

	getRevision: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		return { status: 200, body: await tellRevision(context, project, textParam(call, 'revisionId')) };
	},

	listStickyNotes: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const kept = (await context.host.projects.stickyNotes.list(project)).filter((note) => inState(call, note.archived));
		const rows = sortStickyNotes(kept, textParam(call, 'sort') as StickyNoteSort);
		return { status: 200, body: pageOf(rows, call, (note) => stickyNoteOf(note, false)) };
	},

	getStickyNote: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const id = textParam(call, 'stickyNoteId');
		const note = (await context.host.projects.stickyNotes.list(project)).find((entry) => entry.id === id);
		if (note === undefined) throw gone('sticky note', 'listStickyNotes');
		return { status: 200, body: stickyNoteOf(note, true), etag: note.revision };
	},
};
