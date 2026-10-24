import type { DateFormat, HistoryNoteRef, HistoryReading, WeekStartDay } from '../domain';
import type { Translate } from './modals';

/**
 * What the modification history panel asks of the plugin: the readings,
 * the state of File recovery on this device, and the ways out of a row --
 * into the note, into Obsidian's own recovery dialog, into the settings
 * where the core plugin is turned on.
 */

/** Whether the versions Obsidian keeps are being counted, and if not, why not. */
export type SnapshotReadingState =
	| 'reading'
	/** The plugin's own setting is off. */
	| 'setting-off'
	/** The core plugin is off. */
	| 'plugin-off'
	/** The device keeps no copies, as on iOS. */
	| 'unsupported'
	/** The store is there but could not be read. */
	| 'unreadable';

export interface HistoryAvailability {
	snapshots: SnapshotReadingState;
	/** How often the core plugin takes a copy, when it is on. */
	intervalMinutes: number | null;
	/** How long it keeps one, when it is on. */
	keepDays: number | null;
	/** True while a pass over the store is under way. */
	harvesting: boolean;
	/** The moment the store has been read through, or null before any reading. */
	readThrough: number | null;
}

/** What moved: the readings, or whether the copies are being read. */
export type HistoryChange = 'data' | 'availability';

/** What opening the recovery dialog on a note came to; the dialog needs no note, since the copies outlive one. */
export type FileRecoveryOpening = 'opened' | 'off' | 'unsupported' | 'no-project';

export interface HistoryPanelBridge {
	t: Translate;
	/** The language the panel's calendar names are read in. */
	locale(): string;
	/** The day the author draws a week from. */
	weekStart(): WeekStartDay;
	/** How the author writes a date down. */
	dateFormat(): DateFormat;
	/** The day the reading device is on. */
	today(): string;
	/** The zone the days are cut in, which is the device's. */
	timeZone(): string;
	availability(): HistoryAvailability;
	/** What happened between two days, inclusive; null while no project is open. */
	read(from: string, through: string): Promise<HistoryReading | null>;
	/** Reads the copies now, joining a pass already under way. */
	refresh(): Promise<void>;
	/** Opens a note by its path under the project root. */
	openNote(path: string): Promise<void>;
	/** Opens Obsidian's own File recovery dialog on a note by its path under the root, deleted or not. */
	openFileRecovery(path: string): FileRecoveryOpening;
	/** Opens the settings on the core plugins; false where the app has no settings to open. */
	openCorePluginSettings(): boolean;
	/** Opens the settings on File recovery's own tab, or on the core plugins where it is off; false where the app has no settings to open. */
	openFileRecoverySettings(): boolean;
	/** Fires on data worth re-reading and on the copies' availability; never on a clock tick. */
	subscribe(listener: (change: HistoryChange) => void): () => void;
	/** What a note's kind is called. */
	kindLabel(ref: HistoryNoteRef): string;
	/** The icon a note's kind wears. */
	kindIcon(ref: HistoryNoteRef): string;
	/** True while a table's rows wear their actions as a column of buttons. */
	showsActionsColumn(): boolean;
}
