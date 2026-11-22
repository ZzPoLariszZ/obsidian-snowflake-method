import {
	findTimeline,
	findTimelineView,
	isTimelineBindingKind,
	type EntityRef,
	type ScenePresentation,
	type Timeline,
	type TimelineCardStyle,
	type TimelineDocument,
	type TimelineRow,
	type TimelineView,
} from '../../src/domain';
import type { ProjectSnapshot } from '../../src/services';
import { timelineBoardOf, timelineOf } from '../dto/boards';
import type { MemberIndex } from '../dto/member';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { anchorOf, idOf, landed, made, memberOfKind, noSuch, rowText, scenesOf } from './board-rules';
import { bodyOf, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';
import { gone } from './records';
import { free, taken, textOf } from './refusals';

const FILE = 'timelines';
const noTimeline = (): ApiError => gone('timeline', 'getTimeline');
const noView = (): ApiError => gone('view of the timelines', 'getTimeline');
const noRow = (): ApiError =>
	new ApiError('not-found', 'The timeline has no row with that id. It may have been deleted. getTimeline gives the rows there are.');

/** A project that may be changed, with its timelines as they stand and its notes to be found by id. */
interface Standing {
	readonly project: ProjectSnapshot;
	readonly held: TimelineDocument;
	readonly index: MemberIndex;
}

async function standingOf(call: OperationCall, context: ApiContext): Promise<Standing> {
	const project = await context.writableProject(textParam(call, 'projectId'));
	return { project, held: await context.host.projects.timeline.read(project), index: context.members(project) };
}

function timelineIn(held: TimelineDocument, call: OperationCall): Timeline {
	const timeline = findTimeline(held, textParam(call, 'timelineId'));
	if (timeline === undefined) throw noTimeline();
	return timeline;
}

function viewIn(held: TimelineDocument, call: OperationCall): TimelineView {
	const view = findTimelineView(held, textParam(call, 'timelineViewId'));
	if (view === undefined) throw noView();
	return view;
}

/** Where a row stands on a timeline: the time it is written under, and the rows it stands among. */
function rowIn(timeline: Timeline, rowId: string): { timeId: string; row: TimelineRow; rows: readonly TimelineRow[] } | null {
	for (const time of timeline.times) {
		const row = time.rows.find((entry) => entry.id === rowId);
		if (row !== undefined) return { timeId: time.timeId, row, rows: time.rows };
	}
	return null;
}

/** The rows a timeline has written under one time. */
const rowsUnder = (timeline: Timeline, timeId: string): readonly TimelineRow[] =>
	timeline.times.find((time) => time.timeId === timeId)?.rows ?? [];

/**
 * The note a timeline follows, as a timeline keeps it. One the timeline
 * names already is kept as it has it, so a timeline read and sent back
 * whole changes nothing, and a note deleted since is no reason to refuse.
 */
function bindingOf(index: MemberIndex, sent: unknown, kept: EntityRef | null): EntityRef | null {
	if (sent === null || sent === undefined) return null;
	const id = idOf(sent);
	if (kept !== null && kept.id === id) return kept;
	const member = index.byId(id);
	if (member === null) throw noSuch('/binding', 'The project has no note with that id. listMembers gives the ids there are.');
	if (!isTimelineBindingKind(member.kind)) {
		throw noSuch('/binding', 'A timeline follows a character, a place or another note of the world. A scene or a time is what it lays out.');
	}
	return { kind: member.kind, id: member.id, name: member.name };
}

/** A timeline as it stands in the file now. */
async function tellTimeline(context: ApiContext, project: ProjectSnapshot, id: string): Promise<JsonObject> {
	const timeline = findTimeline(await context.host.projects.timeline.read(project), id);
	if (timeline === undefined) throw noTimeline();
	return timelineOf(context.members(project), timeline);
}

/** The whole board as it stands in the file now. */
async function tellBoard(context: ApiContext, project: ProjectSnapshot): Promise<JsonObject> {
	return timelineBoardOf(context.members(project), await context.host.projects.timeline.read(project));
}

/** The timelines a view is to show, each of which must be one the board has, or one the view already names. */
function timelineIdsOf(held: TimelineDocument, sent: unknown, kept: readonly string[]): string[] {
	const ids: string[] = [];
	(Array.isArray(sent) ? sent : []).forEach((entry: unknown, at) => {
		const id = textOf(entry);
		if (findTimeline(held, id) === undefined && !kept.includes(id)) {
			throw noSuch(`/timelineIds/${String(at)}`, 'The board has no timeline with that id. getTimeline gives the ones there are.');
		}
		if (!ids.includes(id)) ids.push(id);
	});
	return ids;
}

/**
 * The timelines, changed. Every change goes through the plugin's own
 * timeline service, one change at a time as its own screen makes them, and
 * the screens are told at once. What a call names is looked up first: see
 * `board-rules`.
 */
export const timelineWriteOperations: OperationGroup = {
	createTimeline: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const body = bodyOf(call);
		const service = context.host.projects.timeline;
		const name = textOf(body['name']).trim();
		if (!free(held.timelines.map((timeline) => timeline.name), name, null)) throw taken('timeline', name);
		const binding = bindingOf(index, body['binding'], null);
		// A timeline shows only through a view. Unless the call says which, it joins the one the author last looked at, or the first.
		const last = held.lastViewId !== null && findTimelineView(held, held.lastViewId) !== undefined ? held.lastViewId : null;
		const viewId = 'view' in body ? (body['view'] === null ? null : textOf(body['view'])) : (last ?? held.views[0]?.id ?? null);
		if (viewId !== null && findTimelineView(held, viewId) === undefined) {
			throw noSuch('/view', 'The board has no view with that id. getTimeline gives the ones there are.');
		}
		const id = made(await service.createTimeline(project, { name, binding }), FILE);
		if (viewId !== null) {
			const view = findTimelineView(await service.read(project), viewId);
			if (view !== undefined) landed(await service.setViewTimelines(project, viewId, [...view.timelines, id]), noView(), FILE);
		}
		context.host.recordsChanged('timeline');
		return { status: 201, body: await tellTimeline(context, project, id) };
	},

	updateTimeline: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const body = bodyOf(call);
		const service = context.host.projects.timeline;
		const name = typeof body['name'] === 'string' ? body['name'].trim() : timeline.name;
		const others = held.timelines.filter((entry) => entry.id !== timeline.id).map((entry) => entry.name);
		if (!free(others, name, timeline.name)) throw taken('timeline', name);
		const binding = 'binding' in body ? bindingOf(index, body['binding'], timeline.binding) : timeline.binding;
		landed(await service.renameTimeline(project, timeline.id, name), noTimeline(), FILE);
		landed(await service.bindTimeline(project, timeline.id, binding), noTimeline(), FILE);
		if (body['pinned'] === true) landed(await service.pinTimeline(project, timeline.id), noTimeline(), FILE);
		// Taking the pin off one that does not wear it would take it off the one that does.
		if (body['pinned'] === false && held.pinnedTimelineId === timeline.id) landed(await service.pinTimeline(project, null), noTimeline(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	deleteTimeline: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		landed(await context.host.projects.timeline.deleteTimeline(project, timelineIn(held, call).id), noTimeline(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 204 };
	},

	addTimelineTime: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const time = memberOfKind(index, textParam(call, 'timeId'), 'time', 'params/timeId');
		landed(await context.host.projects.timeline.addTime(project, timeline.id, time.id), noTimeline(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	removeTimelineTime: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const timeId = textParam(call, 'timeId');
		// A time whose note is gone can still be taken off, so it is looked for on the timeline and not among the notes.
		if (!timeline.times.some((time) => time.timeId === timeId)) {
			throw new ApiError('not-found', 'The timeline has no such time on it. getTimeline gives the times it has.');
		}
		landed(await context.host.projects.timeline.removeTime(project, timeline.id, timeId), noTimeline(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	addTimelineRow: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const body = bodyOf(call);
		const time = memberOfKind(index, idOf(body['time']), 'time', '/time');
		const scenes = scenesOf(index, body['scenes'], '/scenes');
		const text = rowText(body, scenes);
		const before = anchorOf(body, rowsUnder(timeline, time.id).map((row) => row.id), 'row under that time');
		const id = made(await context.host.projects.timeline.addRow(project, timeline.id, time.id, text, before, scenes), FILE);
		context.host.recordsChanged('timeline');
		return { status: 201, body: { id, timeline: await tellTimeline(context, project, timeline.id) } };
	},

	updateTimelineRow: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const body = bodyOf(call);
		const rowId = textParam(call, 'rowId');
		const place = rowIn(timeline, rowId);
		if (place === null) throw noRow();
		const service = context.host.projects.timeline;
		const moves = 'time' in body || 'before' in body;
		const toTime = 'time' in body ? memberOfKind(index, idOf(body['time']), 'time', '/time').id : place.timeId;
		const before = moves ? anchorOf(body, rowsUnder(timeline, toTime).map((row) => row.id), 'row under that time', rowId) : null;
		if (typeof body['text'] === 'string') {
			const text = body['text'].trim();
			if (text.length === 0 && place.row.scenes.length === 0) rowText(body, []);
			landed(await service.editRow(project, timeline.id, rowId, text), noRow(), FILE);
		}
		if (moves) landed(await service.moveRow(project, timeline.id, rowId, toTime, before), noRow(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	deleteTimelineRow: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const rowId = textParam(call, 'rowId');
		if (rowIn(timeline, rowId) === null) throw noRow();
		landed(await context.host.projects.timeline.deleteRow(project, timeline.id, rowId), noTimeline(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	placeTimelineScene: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const body = bodyOf(call);
		const scene = memberOfKind(index, textParam(call, 'sceneId'), 'scene', 'params/sceneId');
		const rowId = textOf(body['row']);
		const place = rowIn(timeline, rowId);
		if (place === null) throw noSuch('/row', 'The timeline has no row with that id. getTimeline gives the rows there are.');
		const before = anchorOf(body, place.row.scenes, 'scene in that row', scene.id);
		landed(await context.host.projects.timeline.placeScene(project, timeline.id, scene.id, rowId, before), noRow(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	removeTimelineScene: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const timeline = timelineIn(held, call);
		const sceneId = textParam(call, 'sceneId');
		// A scene whose note is gone can still be taken off, so it is looked for on the timeline and not among the notes.
		if (!timeline.times.some((time) => time.rows.some((row) => row.scenes.includes(sceneId)))) {
			throw new ApiError('not-found', 'The timeline places no such scene. getTimeline gives the scenes it places.');
		}
		landed(await context.host.projects.timeline.removeScene(project, timeline.id, sceneId), noTimeline(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellTimeline(context, project, timeline.id) };
	},

	createTimelineView: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		const body = bodyOf(call);
		const name = textOf(body['name']).trim();
		if (!free(held.views.map((view) => view.name), name, null)) throw taken('timeline view', name);
		const timelines = timelineIdsOf(held, body['timelineIds'], []);
		const id = made(await context.host.projects.timeline.createView(project, { name, timelines }), FILE);
		context.host.recordsChanged('timeline');
		return { status: 201, body: { id, board: await tellBoard(context, project) } };
	},

	updateTimelineView: async (call, context) => {
		const { project, held, index } = await standingOf(call, context);
		const view = viewIn(held, call);
		const body = bodyOf(call);
		const service = context.host.projects.timeline;
		const name = typeof body['name'] === 'string' ? body['name'].trim() : view.name;
		const others = held.views.filter((entry) => entry.id !== view.id).map((entry) => entry.name);
		if (!free(others, name, view.name)) throw taken('timeline view', name);
		const timelines = 'timelineIds' in body ? timelineIdsOf(held, body['timelineIds'], view.timelines) : null;
		// A time the view already keeps a place for may be one whose note is gone. Any other must be a time note.
		const order =
			'timeOrder' in body
				? (Array.isArray(body['timeOrder']) ? body['timeOrder'] : []).map((entry: unknown, at) => {
						const id = textOf(entry);
						return view.timeOrder.includes(id) ? id : memberOfKind(index, id, 'time', `/timeOrder/${String(at)}`).id;
					})
				: null;
		const done = (outcome: 'written' | 'absent' | 'refused'): void => {
			landed(outcome, noView(), FILE);
		};
		done(await service.renameView(project, view.id, name));
		if (timelines !== null) done(await service.setViewTimelines(project, view.id, timelines));
		if (order !== null) done(await service.setTimeOrder(project, view.id, order));
		if ('presentation' in body) done(await service.setViewPresentation(project, view.id, body['presentation'] as ScenePresentation | null));
		if ('cardStyle' in body) done(await service.setViewCardStyle(project, view.id, body['cardStyle'] as TimelineCardStyle | null));
		if (typeof body['showSubDescriptions'] === 'boolean') done(await service.setViewSubDescriptions(project, view.id, body['showSubDescriptions']));
		if (typeof body['timesReversed'] === 'boolean') done(await service.setViewTimesReversed(project, view.id, body['timesReversed']));
		context.host.recordsChanged('timeline');
		return { status: 200, body: await tellBoard(context, project) };
	},

	deleteTimelineView: async (call, context) => {
		const { project, held } = await standingOf(call, context);
		landed(await context.host.projects.timeline.deleteView(project, viewIn(held, call).id), noView(), FILE);
		context.host.recordsChanged('timeline');
		return { status: 204 };
	},
};
