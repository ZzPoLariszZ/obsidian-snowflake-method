/**
 * What the relationship graph workspace is handed by the plugin, and what
 * it hands back. The document is the file's, read through the bridge and
 * written one part at a time; the members whose relationships are drawn are
 * the project's, read with the document so one reading is one picture.
 */

import type { App } from 'obsidian';

import type { EntityGraphState, RelationshipGraphDocument } from '../domain';
import type { RelationshipGraphWrite } from '../services';
import type { Translate } from './modals';
import type { SceneManuscriptOpening, SceneManuscriptWrite } from './scene-manuscript-graph';
import type { SceneManuscriptStanding } from './scene-manuscript-pane';
import type { RelationshipGraphMemory } from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel } from './view-model';

/**
 * A document as read. Whether the project can be written is said here, since
 * the workspace's controls write the file as they are moved and a read-only
 * project must still show its graph with the controls stilled.
 */
export interface RelationshipGraphReading {
	projectPath: string;
	/** The project's root folder, which the native preset's filters are written for. */
	rootPath: string;
	locale: 'en' | 'zh-CN';
	/** The document held, shared with the store's memo: treated as immutable by everyone who reads it. */
	held: RelationshipGraphDocument;
	readOnly: boolean;
}

export interface RelationshipGraphBridge {
	t: Translate;
	/** The document as the file holds it now; null while no project stands. */
	read: () => Promise<RelationshipGraphReading | null>;
	/** Fires when the relationship graph file changed, or a native graph tab of ours opened or closed. */
	subscribe: (listener: () => void) => () => void;
	/** The entity view's state, one or more parts at a time. */
	updateEntities: (patch: Partial<EntityGraphState>) => Promise<RelationshipGraphWrite>;
	/** Whether Obsidian's graph is there to open, and whether one of ours shows the project now. */
	sceneManuscript: () => SceneManuscriptStanding;
	/** Opens Obsidian's graph set to the project, in a tab of its own; 'absent' while no project stands. */
	openSceneManuscriptGraph: () => Promise<SceneManuscriptOpening | 'absent'>;
	/** Lets the remembered native options go, so the next open builds the preset again. */
	resetSceneManuscriptGraph: () => Promise<SceneManuscriptWrite>;
}

/** The host's own methods the workspace calls. */
export type RelationshipGraphHost = Pick<DashboardHost, 'openStoryStructure' | 'translateForProject'>;

export interface RelationshipGraphControls {
	app: App;
	host: RelationshipGraphHost;
	/** Speaks the loaded project's language; rebuilt with the workspace when it changes. */
	t: Translate;
	/** The model the view last loaded; null before the first load or with no project. */
	model(): ProjectDashboardModel | null;
	projectPath(): string | null;
	/** Makes the workspace's project current before a host action reads or writes it. */
	activateProject(): void;
	/** Re-reads the project model; resolves after `handle.refresh()` has been called with it. */
	refresh(): Promise<void>;
	/** The bridge for the project standing now; asked for afresh, since a rename moves the path. */
	bridge(): RelationshipGraphBridge;
	memory: RelationshipGraphMemory;
	/** Saves the tab layout, where the view and the panel's fold live. */
	remember(): void;
	/** Unload still settles what is in flight, but a refusal cannot open another dialog. */
	unloading?(): boolean;
}

/** The same shape as the other workspaces' handles, so the view holds any of them alike. */
export interface RelationshipGraphHandle {
	/** Redraws from `controls.model()`; the view calls it on every refresh that is not a rebuild. */
	refresh(): void;
	/** Brings a node into the middle of the picture and gives it the focus. */
	reveal(id: string): void;
	remeasure(): void;
	/** Nothing on the graph is typed into, so there is never a body to save. */
	saveFocusedBody(): boolean;
	dispose(): void;
}

export type RenderRelationshipGraph = (
	host: HTMLElement,
	controls: RelationshipGraphControls,
) => RelationshipGraphHandle;
