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

import type { BeatSheetWrite } from '../services';
import type { Translate } from './modals';

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
	t: Translate;
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
	/** Takes out what points at scenes the project no longer has. */
	pruneMissing: (known: { sceneIds?: ReadonlySet<string> }) => Promise<BeatSheetWrite>;
}

/** The drag types of the workspace's four levels, each its own so nothing lands where it should not, a timeline in another leaf included. */
export const BEAT_SHEET_ACT_DRAG_TYPE = 'application/x-snowflake-beat-sheet-act';
export const BEAT_SHEET_BEAT_DRAG_TYPE = 'application/x-snowflake-beat-sheet-beat';
export const BEAT_SHEET_ROW_DRAG_TYPE = 'application/x-snowflake-beat-sheet-row';
export const BEAT_SHEET_SCENE_DRAG_TYPE = 'application/x-snowflake-beat-sheet-scene';
