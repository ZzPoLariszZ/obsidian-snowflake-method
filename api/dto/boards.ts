import type {
	Beat,
	BeatSheet,
	BeatSheetStructure,
	BeatSheetTemplate,
	BuiltInBeatSheetTemplate,
	DerivedTask,
	EntityGraph,
	FreeformEdge,
	FreeformFrame,
	FreeformPlacement,
	FreeformResource,
	FreeformView,
	SceneRow,
	Timeline,
	TimelineDocument,
	TimelineView,
} from '../../src/domain';
import type { ProjectRef } from '../../src/services';
import type { JsonObject } from '../json';
import type { MemberIndex } from './member';
import { instantOf } from './records';

/**
 * The boards an author lays a project out on, as the API tells them: the
 * timelines, the beat sheets, the freeform views and the relationship
 * graph, with the cards the plugin derives for the task board.
 *
 * A board names a note by its id and keeps nothing else of it but the name
 * it last saw, for the day the note is gone. Each is told here as the note
 * it leads to now.
 */

export function derivedTaskOf(task: DerivedTask): JsonObject {
	return {
		key: task.key,
		status: task.status,
		count: task.count,
		progress: task.progress === null ? null : { net: task.progress.net, goal: task.progress.goal },
	};
}

/** A scene a board places, which it knows by the scene's id alone. */
const sceneRefOf = (index: MemberIndex, id: string): JsonObject => index.refOfStored({ kind: 'scene', id, name: '' });

function sceneRowOf(index: MemberIndex, row: SceneRow): JsonObject {
	return { id: row.id, text: row.text, scenes: row.scenes.map((id) => sceneRefOf(index, id)) };
}

export function timelineOf(index: MemberIndex, timeline: Timeline): JsonObject {
	return {
		id: timeline.id,
		name: timeline.name,
		binding: timeline.binding === null ? null : index.refOfStored(timeline.binding),
		times: timeline.times.map((entry) => ({
			time: index.refOfStored({ kind: 'time', id: entry.timeId, name: '' }),
			rows: entry.rows.map((row) => sceneRowOf(index, row)),
		})),
		createdAt: instantOf(timeline.createdAt),
		updatedAt: instantOf(timeline.updatedAt),
	};
}

export function timelineViewOf(view: TimelineView): JsonObject {
	return {
		id: view.id,
		name: view.name,
		timelineIds: [...view.timelines],
		timeOrder: [...view.timeOrder],
		presentation: view.presentation,
		cardStyle: view.cardStyle,
		showSubDescriptions: view.showSubDescriptions,
		timesReversed: view.timesReversed,
		createdAt: instantOf(view.createdAt),
		updatedAt: instantOf(view.updatedAt),
	};
}

/** The timelines and the views of them, as the board keeps them. */
export function timelineBoardOf(index: MemberIndex, held: TimelineDocument): JsonObject {
	return {
		timelines: held.timelines.map((timeline) => timelineOf(index, timeline)),
		views: held.views.map(timelineViewOf),
		pinnedTimelineId: held.pinnedTimelineId,
		lastViewId: held.lastViewId,
	};
}

/** Every template a beat sheet can be laid out from: the plugin's own in the project's language, then the author's. */
export function beatSheetTemplatesOf(builtIn: readonly BuiltInBeatSheetTemplate[], saved: readonly BeatSheetTemplate[]): JsonObject {
	return { items: [...builtIn.map(builtInTemplateOf), ...saved.map(savedTemplateOf)] };
}

export function beatSheetSummaryOf(sheet: BeatSheet): JsonObject {
	const beats = sheet.acts.flatMap((act) => act.beats);
	return {
		id: sheet.id,
		name: sheet.name,
		acts: sheet.acts.length,
		beats: beats.length,
		scenes: beats.reduce((sum, beat) => sum + beat.rows.reduce((placed, row) => placed + row.scenes.length, 0), 0),
		createdAt: instantOf(sheet.createdAt),
		updatedAt: instantOf(sheet.updatedAt),
	};
}

function beatOf(index: MemberIndex, beat: Beat): JsonObject {
	return { id: beat.id, name: beat.name, description: beat.description, rows: beat.rows.map((row) => sceneRowOf(index, row)) };
}

export function beatSheetOf(index: MemberIndex, sheet: BeatSheet): JsonObject {
	return {
		id: sheet.id,
		name: sheet.name,
		presentation: sheet.presentation,
		showSubDescriptions: sheet.showSubDescriptions,
		reversed: sheet.reversed,
		createdAt: instantOf(sheet.createdAt),
		updatedAt: instantOf(sheet.updatedAt),
		// An act's number is its place in the story, which is the order the sheet keeps its acts in.
		acts: sheet.acts.map((act, at) => ({
			id: act.id,
			number: at + 1,
			label: act.label,
			beats: act.beats.map((beat) => beatOf(index, beat)),
		})),
	};
}

function structureOf(structure: BeatSheetStructure): JsonObject[] {
	return structure.acts.map((act) => ({
		label: act.label,
		beats: act.beats.map((beat) => ({ name: beat.name, description: beat.description })),
	}));
}

export function builtInTemplateOf(template: BuiltInBeatSheetTemplate): JsonObject {
	return { id: template.id, name: template.name, description: '', builtIn: true, acts: structureOf(template.structure) };
}

export function savedTemplateOf(template: BeatSheetTemplate): JsonObject {
	return { id: template.id, name: template.name, description: template.description, builtIn: false, acts: structureOf(template) };
}

export function freeformViewSummaryOf(view: FreeformView): JsonObject {
	return {
		id: view.id,
		name: view.name,
		placements: view.placements.length,
		frames: view.frames.length,
		edges: view.edges.length,
		createdAt: instantOf(view.createdAt),
		updatedAt: instantOf(view.updatedAt),
	};
}

function freeformResourceOf(index: MemberIndex, project: ProjectRef, resource: FreeformResource): JsonObject {
	switch (resource.type) {
		case 'entity':
			return { type: 'entity', member: index.refOfStored(resource) };
		case 'file':
			return { type: 'file', path: `${project.rootPath}/${resource.path}`, relativePath: resource.path };
		case 'link':
			return { type: 'link', url: resource.url, label: resource.label };
		case 'text':
			return { type: 'text', text: resource.text };
		default:
			return { type: resource.type, id: resource.id, name: resource.name };
	}
}

function placementOf(index: MemberIndex, project: ProjectRef, placement: FreeformPlacement): JsonObject {
	return {
		id: placement.id,
		resource: freeformResourceOf(index, project, placement.resource),
		x: placement.x,
		y: placement.y,
		width: placement.width,
		height: placement.height,
		displayMode: placement.displayMode,
		zIndex: placement.zIndex,
		frameId: placement.frameId,
	};
}

const frameOf = (frame: FreeformFrame): JsonObject => ({
	id: frame.id,
	title: frame.title,
	color: frame.color,
	x: frame.x,
	y: frame.y,
	width: frame.width,
	height: frame.height,
	zIndex: frame.zIndex,
});

const edgeOf = (edge: FreeformEdge): JsonObject => ({
	id: edge.id,
	source: edge.source,
	target: edge.target,
	sourceSide: edge.sourceSide,
	targetSide: edge.targetSide,
	label: edge.label,
	arrow: edge.arrow,
	line: edge.line,
});

export function freeformViewOf(index: MemberIndex, project: ProjectRef, view: FreeformView): JsonObject {
	return {
		id: view.id,
		name: view.name,
		viewport: { x: view.viewport.x, y: view.viewport.y, zoom: view.viewport.zoom },
		placements: view.placements.map((placement) => placementOf(index, project, placement)),
		frames: view.frames.map(frameOf),
		edges: view.edges.map(edgeOf),
		createdAt: instantOf(view.createdAt),
		updatedAt: instantOf(view.updatedAt),
	};
}

/** The graph as the plugin builds it, without where its own screen would draw each line. */
export function relationshipGraphOf(graph: EntityGraph): JsonObject {
	return {
		nodes: graph.nodes.map((node) => ({
			id: node.id,
			group: node.group,
			kind: node.kind,
			name: node.name,
			aliases: [...node.aliases],
			path: node.path,
			weight: node.weight,
		})),
		edges: graph.edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			label: edge.label,
			labelPath: edge.labelPath,
			text: edge.text,
			record: edge.record,
		})),
		labels: [...graph.labels],
	};
}
