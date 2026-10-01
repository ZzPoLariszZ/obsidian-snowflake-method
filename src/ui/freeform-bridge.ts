/**
 * What the freeform workspace is handed by the plugin, and what it hands
 * back. A view is its file's, read through the bridge and written one
 * gesture at a time; the entities' names are the project model's, which the
 * view that mounts the workspace already holds; and the records and files a
 * view places are read through the bridge too, each family only when a view
 * on show places one of it.
 */

import type { App, Component, KeymapEventListener, Modifier } from 'obsidian';

import type {
	DateFormat,
	FreeformDocument,
	FreeformLabels,
	FreeformLimits,
	FreeformStep,
	FreeformViewport,
} from '../domain';
import type { FreeformTransacted, FreeformViewWrite } from '../services';
import type { MountFreeformCanvas } from './freeform-canvas-port';
import type { FreeformResourceRequest, FreeformResources } from './freeform-resources';
import type { Translate } from './modals';
import type { SessionPanelContext } from './session-panel';
import type { FreeformMemory } from './story-structure-state';
import type { DashboardHost, ProjectDashboardModel } from './view-model';

/**
 * The views as read. Whether the project can be written is not said here:
 * the model says so, and is renewed with every project refresh, where a word
 * given at the read would stand until the next read.
 */
export interface FreeformReading {
	projectPath: string;
	locale: 'en' | 'zh-CN';
	/** The views held, shared with the store's memo: treated as immutable by everyone who reads them. */
	held: FreeformDocument;
	limits: Readonly<FreeformLimits>;
}

export type FreeformContext = SessionPanelContext;

export interface FreeformBridge {
	/** The views as their files hold them now; null while no project stands. */
	read: () => Promise<FreeformReading | null>;
	/** Fires when a view's file changed: the workspace's own writes and the vault's events alike. */
	subscribe: (listener: () => void) => () => void;
	/** The records and files the view on show places, each family on its own footing; null while no project stands. */
	readResources: (wanted: FreeformResourceRequest) => Promise<FreeformResources | null>;
	/** Fires for the tasks and the sticky notes; threads, revisions and files arrive with the view's own refresh. */
	subscribeResources: (listener: () => void) => () => void;
	/** Every file under the project's root but the plugin's own, by its path from the root, for the form that places one. */
	listFiles: () => Promise<{ path: string; name: string }[]>;
	/** A fresh id for something about to be placed, so the canvas shows it under the id the file will keep. */
	mintId: (kind: 'placement' | 'frame' | 'edge') => string;
	/** The day the reading device is on, which a task's due date is measured against. */
	today: () => string;
	/** How a day is written, as the author chose. */
	dateFormat: () => DateFormat;
	/** A new view with nothing on it; its id, or null on a refusal. */
	createView: (name: string) => Promise<string | null>;
	renameView: (id: string, name: string) => Promise<FreeformViewWrite>;
	/** Takes a view out for good; the confirmation is the workspace's. False only on a refusal. */
	deleteView: (id: string) => Promise<boolean>;
	/** What a leaf leaves behind as it goes from a view: where it stood looking, and what its resources are called. */
	leaveView: (
		id: string,
		left: { viewport?: FreeformViewport; labels?: FreeformLabels },
	) => Promise<FreeformViewWrite>;
	/** One gesture, one write, one bell; where the leaf stands looking rides along with a change that landed. */
	transact: (
		viewId: string,
		steps: readonly FreeformStep[],
		viewport?: FreeformViewport | null,
	) => Promise<FreeformTransacted>;
}

/** The host's own methods the workspace calls, and no others. */
export type FreeformHost = Pick<
	DashboardHost,
	| 'openManagedFile'
	| 'openManuscriptStream'
	| 'openSceneForm'
	| 'openCharacterForm'
	| 'openEntityForm'
	| 'patchScene'
	| 'patchCharacter'
	| 'patchEntity'
	| 'isReduceMotionEnabled'
	| 'revealTask'
	| 'foreshadowingTable'
	| 'revisionTable'
	| 'stickyNotes'
	| 'openProjectFile'
	| 'openExternalLink'
>;

export interface FreeformControls {
	app: App;
	host: FreeformHost;
	/** Speaks the loaded project's language; rebuilt with the workspace when it changes. */
	t: Translate;
	/** The model the view last loaded; null before the first load or with no project. */
	model: () => ProjectDashboardModel | null;
	projectPath: () => string | null;
	/** Makes the workspace's project current before a host action reads or writes it. */
	activateProject: () => void;
	/** Re-reads the project model; resolves after `handle.refresh()` has been called with it. */
	refresh: () => Promise<void>;
	/** The bridge for the project standing now; asked for afresh, since a rename moves the path. */
	bridge: () => FreeformBridge;
	memory: FreeformMemory;
	/** Saves the tab layout, where the view on show and the two switches live. */
	remember: () => void;
	/** Unload still settles typed words, but a refusal cannot open another dialog. */
	unloading?: () => boolean;
	/** What rendered Markdown lives under: the view that mounts the workspace. */
	component: Component;
	/**
	 * A chord heard while the tab is the active one, ahead of the app's own
	 * keys. Hands back the way to stop hearing it. A listener that did not
	 * take the key answers true, and the key goes on to whoever is next.
	 */
	chord: (modifiers: Modifier[], key: string, listener: KeymapEventListener) => () => void;
	/** Raises the canvas's engine on an element; handed in so a test can stand a plain one in its place. */
	mountCanvas: MountFreeformCanvas;
	/** Whether the plugin's own window is the one the element stands in, which a view moved out is not in. */
	atHome: (element: HTMLElement) => boolean;
}

/** The same shape as the corkboard's handle, the timeline's and the beat sheet's, so the view holds any of them alike. */
export interface FreeformHandle {
	/** Redraws from `controls.model()`; the view calls it on every refresh that is not a rebuild. */
	refresh: () => void;
	/** Brings a scene's first placement on the view into sight and gives it the focus. */
	reveal: (id: string) => void;
	remeasure: () => void;
	/** Keeps the words of the box holding the focus, for the view's own key scope. */
	saveFocusedConflict: () => boolean;
	dispose: () => void;
}

export type RenderFreeform = (host: HTMLElement, controls: FreeformControls) => FreeformHandle;
