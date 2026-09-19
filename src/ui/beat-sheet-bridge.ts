/**
 * What the beat sheet workspace is handed by the plugin, and what it hands
 * back. The document is the file's, read through the bridge and written one
 * change at a time; the scenes' names are the project model's, which the
 * view that mounts the workspace already holds. An act and a beat are not
 * notes, so their words ride in the document itself.
 */

import type {
	BeatSheetDocument,
	BuiltInBeatSheetTemplateId,
	ScenePresentation,
} from '../domain';

import type { App } from 'obsidian';

import type { BeatSheetWrite } from '../services';
import type { CorkboardHost, RenderCorkboard } from './corkboard-bridge';
import type { LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import type { BeatSheetMemory } from './story-structure-state';
import type { ProjectDashboardModel } from './view-model';

/**
 * A document as read. Whether the project can be written is not said here:
 * the model says so, and is renewed with every project refresh, where a word
 * given at the read would stand until the next read.
 */
export interface BeatSheetReading {
	projectPath: string;
	locale: 'en' | 'zh-CN';
	/** The document held, shared with the store's memo: treated as immutable by everyone who reads it. */
	held: BeatSheetDocument;
}

/** What a new sheet starts from: one of the presets, written in the project's language, or one of the project's own templates. */
export type BeatSheetTemplateChoice =
	| { kind: 'built-in'; id: BuiltInBeatSheetTemplateId }
	| { kind: 'project'; id: string };

export interface BeatSheetBridge {
	/** The document as the file holds it now; null while no project stands. */
	read: () => Promise<BeatSheetReading | null>;
	/** Fires when the beat sheet file changed: the workspace's own writes and the vault's events alike. */
	subscribe: (listener: () => void) => () => void;
	/** A new sheet from a template, made the one opened last; its id, or null on a refusal. */
	createSheet: (name: string, template: BeatSheetTemplateChoice) => Promise<string | null>;
	renameSheet: (id: string, name: string) => Promise<BeatSheetWrite>;
	/** Takes a sheet out for good; the confirmation is the workspace's. False only on a refusal. */
	deleteSheet: (id: string) => Promise<boolean>;
	setLastSheet: (id: string | null) => Promise<BeatSheetWrite>;
	setPresentation: (sheetId: string, presentation: ScenePresentation | null) => Promise<BeatSheetWrite>;
	setSubDescriptions: (sheetId: string, shown: boolean) => Promise<BeatSheetWrite>;
	/** Shows the sheet from its end, the last act first and each act's last beat first, or from its beginning again. */
	setReversed: (sheetId: string, reversed: boolean) => Promise<BeatSheetWrite>;
	/** A new act before another or at the end; its id, or null on a refusal. */
	addAct: (sheetId: string, label: string, beforeActId: string | null) => Promise<string | null>;
	relabelAct: (sheetId: string, actId: string, label: string) => Promise<BeatSheetWrite>;
	moveAct: (sheetId: string, actId: string, beforeActId: string | null) => Promise<BeatSheetWrite>;
	deleteAct: (sheetId: string, actId: string) => Promise<BeatSheetWrite>;
	/** A new beat in an act, before another of its beats or at the end; its id, or null on a refusal. */
	addBeat: (
		sheetId: string,
		actId: string,
		draft: { name: string; description: string },
		beforeBeatId: string | null,
	) => Promise<string | null>;
	editBeat: (
		sheetId: string,
		beatId: string,
		change: { name?: string; description?: string },
	) => Promise<BeatSheetWrite>;
	moveBeat: (
		sheetId: string,
		beatId: string,
		toActId: string,
		beforeBeatId: string | null,
	) => Promise<BeatSheetWrite>;
	deleteBeat: (sheetId: string, beatId: string) => Promise<BeatSheetWrite>;
	/** A new row under a beat, before a neighbour or at the end; its id, or null on a refusal. */
	addRow: (
		sheetId: string,
		beatId: string,
		text: string,
		beforeRowId: string | null,
		scenes?: readonly string[],
	) => Promise<string | null>;
	editRow: (sheetId: string, rowId: string, text: string) => Promise<BeatSheetWrite>;
	moveRow: (
		sheetId: string,
		rowId: string,
		toBeatId: string,
		beforeRowId: string | null,
	) => Promise<BeatSheetWrite>;
	deleteRow: (sheetId: string, rowId: string) => Promise<BeatSheetWrite>;
	placeScene: (
		sheetId: string,
		sceneId: string,
		rowId: string,
		beforeSceneId: string | null,
	) => Promise<BeatSheetWrite>;
	removeScene: (sheetId: string, sceneId: string) => Promise<BeatSheetWrite>;
	/** A sheet's acts and beats kept under a name as one of the project's templates; a namesake is replaced. */
	saveTemplate: (sheetId: string, draft: { name: string; description: string }) => Promise<BeatSheetWrite>;
	deleteTemplate: (templateId: string) => Promise<boolean>;
}

/** The drag types of the workspace's four levels, each its own so nothing lands where it should not, a timeline in another leaf included. */
export const BEAT_SHEET_ACT_DRAG_TYPE = 'application/x-snowflake-beat-sheet-act';
export const BEAT_SHEET_BEAT_DRAG_TYPE = 'application/x-snowflake-beat-sheet-beat';
export const BEAT_SHEET_ROW_DRAG_TYPE = 'application/x-snowflake-beat-sheet-row';
export const BEAT_SHEET_SCENE_DRAG_TYPE = 'application/x-snowflake-beat-sheet-scene';

/** The host's own methods the workspace calls: the card's, and no others, since an act and a beat are not notes. */
export type BeatSheetHost = CorkboardHost;

export interface BeatSheetControls {
	app: App;
	host: BeatSheetHost;
	/** Speaks the loaded project's language; rebuilt with the workspace when it changes. */
	t: Translate;
	/** The model the view last loaded; null before the first load or with no project. */
	model: () => ProjectDashboardModel | null;
	projectPath: () => string | null;
	/** Makes the workspace's project current before a host action reads or writes it. */
	activateProject: () => void;
	/** Re-reads the project model; resolves after `handle.refresh()` has been called with it. */
	refresh: () => Promise<void>;
	popover: LentFilterPopover;
	/** The bridge for the project standing now; asked for afresh, since a rename moves the path. */
	bridge: () => BeatSheetBridge;
	memory: BeatSheetMemory;
	/** Saves the tab layout, where the pool's settings and the folds live. */
	remember: () => void;
	/** Unload still settles typed words, but a refusal cannot open another dialog. */
	unloading?: () => boolean;
	/** What deals the scene pool: the corkboard, in its one-column variant. */
	corkboard: RenderCorkboard;
}

/** The same shape as the corkboard's handle and the timeline's, so the view holds any of them alike. */
export interface BeatSheetHandle {
	/** Redraws from `controls.model()`; the view calls it on every refresh that is not a rebuild. */
	refresh: () => void;
	/** Scrolls a scene's pool card into view and gives it the focus. */
	reveal: (id: string) => void;
	remeasure: () => void;
	/** Saves the conflict box holding the focus, for the view's own key scope. */
	saveFocusedConflict: () => boolean;
	dispose: () => void;
}

export type RenderBeatSheet = (host: HTMLElement, controls: BeatSheetControls) => BeatSheetHandle;
