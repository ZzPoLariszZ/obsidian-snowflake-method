/**
 * What the timeline workspace is handed by the plugin, and what it hands
 * back. The document is the file's, read through the bridge and written
 * one change at a time; the names of the times, the scenes and the bound
 * entities are the project model's, which the view that mounts the
 * workspace already holds, so nothing here carries a label.
 */

import type {
	EntityRef,
	ScenePresentation,
	TimelineCardStyle,
	TimelineDocument,
} from '../domain';
import type { TimelineWrite } from '../services';
import type { Translate } from './modals';

export interface TimelineReading {
	projectPath: string;
	locale: 'en' | 'zh-CN';
	/** The project cannot be written to, so every change is off. */
	readOnly: boolean;
	/** The document held, shared with the store's memo: treated as immutable by everyone who reads it. */
	held: TimelineDocument;
}

export interface TimelineBridge {
	t: Translate;
	/** The document as the file holds it now; null while no project stands. */
	read: () => Promise<TimelineReading | null>;
	/** Fires when the timeline file changed: the workspace's own writes and the vault's events alike. */
	subscribe: (listener: () => void) => () => void;
	/** A new timeline; its id, or null on a refusal. */
	createTimeline: (name: string, binding: EntityRef | null) => Promise<string | null>;
	renameTimeline: (id: string, name: string) => Promise<TimelineWrite>;
	bindTimeline: (id: string, binding: EntityRef | null) => Promise<TimelineWrite>;
	/** Takes a timeline out for good; the confirmation is the workspace's. False only on a refusal. */
	deleteTimeline: (id: string) => Promise<boolean>;
	pinTimeline: (id: string | null) => Promise<TimelineWrite>;
	/** A new view over the timelines named, in that order; its id, or null on a refusal. */
	createView: (name: string, timelineIds: readonly string[]) => Promise<string | null>;
	renameView: (id: string, name: string) => Promise<TimelineWrite>;
	deleteView: (id: string) => Promise<boolean>;
	setLastView: (id: string | null) => Promise<TimelineWrite>;
	setViewTimelines: (viewId: string, timelineIds: readonly string[]) => Promise<TimelineWrite>;
	moveTimelineInView: (
		viewId: string,
		timelineId: string,
		beforeTimelineId: string | null,
	) => Promise<TimelineWrite>;
	setTimeOrder: (viewId: string, timeIds: readonly string[]) => Promise<TimelineWrite>;
	setViewPresentation: (
		viewId: string,
		presentation: ScenePresentation | null,
	) => Promise<TimelineWrite>;
	setViewCardStyle: (viewId: string, cardStyle: TimelineCardStyle | null) => Promise<TimelineWrite>;
	addTime: (timelineId: string, timeId: string) => Promise<TimelineWrite>;
	removeTime: (timelineId: string, timeId: string) => Promise<TimelineWrite>;
	/** A new row under a time, before a neighbour or at the end; its id, or null on a refusal. */
	addRow: (
		timelineId: string,
		timeId: string,
		text: string,
		beforeRowId: string | null,
		scenes?: readonly string[],
	) => Promise<string | null>;
	editRow: (timelineId: string, rowId: string, text: string) => Promise<TimelineWrite>;
	moveRow: (
		timelineId: string,
		rowId: string,
		toTimeId: string,
		beforeRowId: string | null,
	) => Promise<TimelineWrite>;
	deleteRow: (timelineId: string, rowId: string) => Promise<TimelineWrite>;
	placeScene: (
		timelineId: string,
		sceneId: string,
		rowId: string,
		beforeSceneId: string | null,
	) => Promise<TimelineWrite>;
	removeScene: (timelineId: string, sceneId: string) => Promise<TimelineWrite>;
	/** Takes out what points at scenes or times the project no longer has. */
	pruneMissing: (known: {
		sceneIds?: ReadonlySet<string>;
		timeIds?: ReadonlySet<string>;
	}) => Promise<TimelineWrite>;
}
