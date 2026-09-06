/**
 * What a sticky-note surface asks of the plugin, and nothing more. The
 * dashboard's board, the sidebar and the floating layer all render through
 * one of these; the plugin builds it for a project and a language, the way
 * the other panel bridges are built. Types only, so the pure modules and the
 * tests can name the contract without touching the DOM.
 */

import type { StickyNoteColor, StickyNoteMode } from '../domain';
import type { StickyNoteRecord } from '../services';
import type { Translate } from './modals';
import type { StickyNoteHub } from './sticky-note-hub';

/** One project's notes, as a board reads them. */
export interface StickyNoteReading {
	projectPath: string;
	locale: 'en' | 'zh-CN';
	/** The project may not be written to; every control that writes is disabled. */
	readOnly: boolean;
	notes: readonly StickyNoteRecord[];
}

/** How a note is named to a mutation: by id, and by the path it was last seen at. */
export interface StickyNoteKey {
	id: string;
	path: string;
}

export interface StickyNoteFloatOptions {
	mode?: StickyNoteMode;
	/** Put the caret in the note once it stands. */
	focus?: boolean;
}

export interface StickyNoteBridge {
	t: Translate;
	/** Claims, the device's memory of the panels, and the bell every surface listens for. */
	hub: StickyNoteHub;
	/** The current project's notes; null while no project is open. */
	read(): Promise<StickyNoteReading | null>;
	/** One note by path, wherever it is; null when it is gone or is no sticky note. */
	readNote(path: string): Promise<StickyNoteRecord | null>;
	/** How the Vault last saw the file, without opening it; null when gone. */
	stamp(path: string): string | null;
	/** The editor settings the manuscript stream types under, shared here. */
	editorPreferences(): { autoPairBrackets: boolean; autoPairMarkdown: boolean };
	/** A new, empty note in the current project; null when there is none to write to. */
	create(color?: StickyNoteColor): Promise<StickyNoteRecord | null>;
	/** Writes the body under the revision, or throws `StickyNoteSaveConflict`. */
	writeBody(
		path: string,
		body: string,
		expectedRevision: string,
	): Promise<StickyNoteRecord>;
	setColor(note: StickyNoteKey, color: StickyNoteColor): Promise<boolean>;
	/** Evicts the note's editor, sets it aside, closes its floats, and tells every surface. */
	archive(note: StickyNoteKey): Promise<boolean>;
	/** Brings a note back to the active set; never reopens a float on its own. */
	restore(note: StickyNoteKey): Promise<boolean>;
	/** Asks first; declining answers true, since nothing was refused. */
	deleteNote(note: StickyNoteKey): Promise<boolean>;
	/** Every note set aside, out at once: confirms once inside (declining answers true). */
	deleteArchived(notes: readonly StickyNoteKey[]): Promise<boolean>;
	/** Opens the note's file as an ordinary Markdown note. */
	openNote(path: string): Promise<void>;
	/** Shows the note as a floating panel in `win`, or raises the one already there. */
	float(id: string, win: Window, options?: StickyNoteFloatOptions): Promise<void>;
	isFloating(id: string, win: Window): boolean;
	/** Takes the note's panel down in `win`, if one stands there; the surfaces hear of it through the hub. */
	unfloat(id: string, win: Window): void;
}
