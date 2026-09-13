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
import type { App } from 'obsidian';

import type { TimelineWrite } from '../services';
import type { CorkboardHost, RenderCorkboard } from './corkboard-bridge';
import type { LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import type { TimelineMemory } from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel } from './view-model';

/**
 * A document as read. Whether the project can be written is not said
 * here: the model says so, and is renewed with every project refresh,
 * where a word given at the read would stand until the next read.
 */
export interface TimelineReading {
	projectPath: string;
	locale: 'en' | 'zh-CN';
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
	setViewSubDescriptions: (viewId: string, shown: boolean) => Promise<TimelineWrite>;
	setViewTimesReversed: (viewId: string, reversed: boolean) => Promise<TimelineWrite>;
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

/** The host's own methods the workspace calls: the card's, and the worldbuilding form's. */
export type TimelineHost = CorkboardHost &
	Pick<DashboardHost, 'openEntityForm' | 'createEntity' | 'opensFormWhenCreatingFromField'>;

/** The drag types of the workspace's three levels, each its own so nothing lands where it should not. */
export const TIMELINE_TIME_DRAG_TYPE = 'application/x-snowflake-timeline-time';
export const TIMELINE_ROW_DRAG_TYPE = 'application/x-snowflake-timeline-row';
export const TIMELINE_SCENE_DRAG_TYPE = 'application/x-snowflake-timeline-scene';

export interface TimelineControls {
	app: App;
	host: TimelineHost;
	/** Speaks the loaded project's language; rebuilt with the workspace when it changes. */
	t: Translate;
	/** The model the view last loaded; null before the first load or with no project. */
	model(): ProjectDashboardModel | null;
	projectPath(): string | null;
	/** Makes the workspace's project current before a host action reads or writes it. */
	activateProject(): void;
	/** Re-reads the project model; resolves after `handle.refresh()` has been called with it. */
	refresh(): Promise<void>;
	popover: LentFilterPopover;
	/** The bridge for the project standing now; asked for afresh, since a rename moves the path. */
	bridge(): TimelineBridge;
	memory: TimelineMemory;
	/** Saves the tab layout, where the pool's settings live. */
	remember(): void;
	/** Unload still settles typed words, but a refusal cannot open another dialog. */
	unloading?(): boolean;
	/** What deals the scene pool: the corkboard, in its one-column variant. */
	corkboard: RenderCorkboard;
}

/** The same shape as the corkboard's handle, so the view holds one or the other alike. */
export interface TimelineHandle {
	/** Redraws from `controls.model()`; the view calls it on every refresh that is not a rebuild. */
	refresh(): void;
	/** Scrolls a scene's pool card into view and gives it the focus. */
	reveal(id: string): void;
	remeasure(): void;
	/** Saves the conflict box holding the focus, for the view's own key scope. */
	saveFocusedConflict(): boolean;
	dispose(): void;
}

export type RenderTimeline = (host: HTMLElement, controls: TimelineControls) => TimelineHandle;
