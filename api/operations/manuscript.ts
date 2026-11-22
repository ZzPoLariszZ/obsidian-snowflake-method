import { normalizePath } from 'obsidian';

import { getProjectPathLayout, type ManuscriptSegmentRecord, type ProjectSnapshot } from '../../src/services';
import { countingOf, manuscriptNoteOf, manuscriptNoteSummaryOf, writingCountOf } from '../dto/manuscript';
import { namesHold } from '../dto/member';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { pageOf } from '../paging';
import { listParam, optionalTextParam, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';

/**
 * The manuscript's notes in reading order, read from the notes themselves.
 * Obsidian's own index of them runs a beat behind a write, and a caller that
 * has just made a note must find it in the very next list.
 */
function segmentsOf(context: ApiContext, project: ProjectSnapshot): Promise<ManuscriptSegmentRecord[]> {
	return context.host.projects.manuscript.listSegmentsFromFiles(project);
}

/**
 * The note a call addresses, with where it stands among the others. An
 * address is a path, and a path could name any file of the vault, so it is
 * taken only where it is one of this project's manuscript notes: nothing
 * else is read through here, however the path is spelled.
 */
export async function findManuscriptNote(
	context: ApiContext,
	project: ProjectSnapshot,
	call: OperationCall,
): Promise<{ segments: ManuscriptSegmentRecord[]; index: number; segment: ManuscriptSegmentRecord }> {
	const wanted = normalizePath(`${project.rootPath}/${textParam(call, 'notePath')}`);
	const segments = await segmentsOf(context, project);
	const index = segments.findIndex((segment) => segment.path === wanted);
	const segment = segments[index];
	if (segment === undefined) {
		throw new ApiError(
			'not-found',
			'The manuscript has no note at that address. It may have been renamed or deleted. listManuscriptNotes gives the addresses there are.',
		);
	}
	return { segments, index, segment };
}

/** The manuscript, read. */
export const manuscriptOperations: OperationGroup = {
	getManuscript: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const options = context.host.countOptions();
		const segments = await segmentsOf(context, project);
		const count = await context.host.projects.writingCount.countProject(project, 'manuscript', options);
		return {
			status: 200,
			body: {
				path: `${project.rootPath}/${getProjectPathLayout(project.locale).directories.draft}`,
				notes: segments.length,
				unreadable: count.unreadable,
				firstNotePath: segments[0]?.path ?? null,
				count: writingCountOf(count),
				counting: countingOf(options),
			},
		};
	},

	listManuscriptNotes: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const asked = optionalTextParam(call, 'q');
		const rows = (await segmentsOf(context, project))
			.map((segment, index) => ({ segment, index }))
			.filter(({ segment }) => namesHold([segment.title], asked));
		const totals = listParam(call, 'include').includes('counts')
			? await context.host.projects.writingCount.countManuscriptTotals(project, context.host.countOptions())
			: null;
		return {
			status: 200,
			body: pageOf(rows, call, ({ segment, index }) =>
				manuscriptNoteSummaryOf(project, segment, index, totals === null ? undefined : totals.get(segment.path)),
			),
		};
	},

	getManuscriptNote: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const { segments, segment } = await findManuscriptNote(context, project, call);
		return { status: 200, ...(await tellManuscriptNote(context, project, segment.path, segments)) };
	},
};

/**
 * One manuscript note told in full, as it stands in its file: its text, its
 * version, its size and the notes on either side of it. `segments` is the
 * manuscript in reading order where the caller has it in hand already.
 */
export async function tellManuscriptNote(
	context: ApiContext,
	project: ProjectSnapshot,
	path: string,
	segments?: readonly ManuscriptSegmentRecord[],
): Promise<{ body: JsonObject; etag: string }> {
	const order = segments ?? (await segmentsOf(context, project));
	const index = order.findIndex((segment) => segment.path === path);
	const manuscript = context.host.projects.manuscript;
	const options = context.host.countOptions();
	const content = await manuscript.readSegment(path);
	const naming = await manuscript.segmentNaming(path);
	const count = await context.host.projects.writingCount.countNote(path, options);
	return {
		body: manuscriptNoteOf(
			project,
			content,
			{ index, previous: order[index - 1]?.path ?? null, next: order[index + 1]?.path ?? null },
			naming,
			count,
			options,
		),
		etag: content.revision,
	};
}
