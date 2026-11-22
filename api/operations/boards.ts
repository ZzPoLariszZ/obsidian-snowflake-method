import { buildEntityGraph, builtInBeatSheetTemplates, deriveTasks, findBeatSheet, findFreeformView } from '../../src/domain';
import { graphMembersOf } from '../../src/services';
import {
	beatSheetOf,
	beatSheetSummaryOf,
	builtInTemplateOf,
	derivedTaskOf,
	freeformViewOf,
	freeformViewSummaryOf,
	relationshipGraphOf,
	savedTemplateOf,
	timelineOf,
	timelineViewOf,
} from '../dto/boards';
import { ApiError } from '../errors';
import { textParam, type OperationGroup } from './context';

const gone = (what: string, list: string): ApiError =>
	new ApiError('not-found', `There is no ${what} with that id in the project. It may have been deleted. ${list} gives the ones there are.`);

/**
 * The boards, read: timelines, beat sheets, freeform views and the
 * relationship graph, and the cards the plugin derives for the task board.
 * Each board is one small file the plugin keeps beside the project, read
 * here as the plugin's own screens read it.
 */
export const boardOperations: OperationGroup = {
	listDerivedTasks: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const { sources, failed } = await context.host.derivedTaskSources(project);
		return { status: 200, body: { items: deriveTasks(sources).map(derivedTaskOf), complete: !failed } };
	},

	getTimeline: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const held = await context.host.projects.timeline.read(project);
		const index = context.members(project);
		return {
			status: 200,
			body: {
				timelines: held.timelines.map((timeline) => timelineOf(index, timeline)),
				views: held.views.map(timelineViewOf),
				pinnedTimelineId: held.pinnedTimelineId,
				lastViewId: held.lastViewId,
			},
		};
	},

	listBeatSheets: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const held = await context.host.projects.beatSheet.read(project);
		return { status: 200, body: { items: held.sheets.map(beatSheetSummaryOf), lastSheetId: held.lastSheetId } };
	},

	getBeatSheet: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const sheet = findBeatSheet(await context.host.projects.beatSheet.read(project), textParam(call, 'beatSheetId'));
		if (sheet === undefined) throw gone('beat sheet', 'listBeatSheets');
		return { status: 200, body: beatSheetOf(context.members(project), sheet) };
	},

	listBeatSheetTemplates: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const held = await context.host.projects.beatSheet.read(project);
		return {
			status: 200,
			body: { items: [...builtInBeatSheetTemplates(project.locale).map(builtInTemplateOf), ...held.templates.map(savedTemplateOf)] },
		};
	},

	listFreeformViews: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const held = await context.host.projects.freeform.read(project);
		return { status: 200, body: { items: held.views.map(freeformViewSummaryOf) } };
	},

	getFreeformView: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const view = findFreeformView(await context.host.projects.freeform.read(project), textParam(call, 'freeformViewId'));
		if (view === undefined) throw gone('freeform view', 'listFreeformViews');
		return { status: 200, body: freeformViewOf(context.members(project), project, view) };
	},

	getRelationshipGraph: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const index = context.members(project);
		const graph = buildEntityGraph(graphMembersOf(project), (link, sourcePath) => index.pathOf(link, sourcePath));
		return { status: 200, body: relationshipGraphOf(graph) };
	},
};
