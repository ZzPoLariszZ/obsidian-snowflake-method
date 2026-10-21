import { calendarDay, monthKeyOfDay } from './calendar';
import { isForeshadowingStatus, type ForeshadowingStatus } from './foreshadowing';
import { isTaskStatus, type TaskStatus } from './task';
import { isDocumentType, type DocumentType } from './types';

/**
 * The modification history: what happened to a project's notes, day by day,
 * kept as numbers. Two record kinds, each filed per device and per month as
 * the writing sessions are, so sync never has to merge a file: the versions
 * Obsidian's File recovery kept of a note, reduced to a word count and a
 * fingerprint each, and the events the plugin itself made -- a note
 * created, renamed, deleted or imported, a task, a foreshadowing or a
 * revision changed. The text of a version is never kept.
 */

export const SNAPSHOT_FILE_SUFFIX = '_note_snapshots.json';
export const EVENT_FILE_SUFFIX = '_history_events.json';

/** The two record kinds the history folder holds, by the suffix each file's name ends in. */
export const HISTORY_FILE_SUFFIXES = [SNAPSHOT_FILE_SUFFIX, EVENT_FILE_SUFFIX] as const;

export type HistoryFileSuffix = (typeof HISTORY_FILE_SUFFIXES)[number];

/** The folder every year of a project's history is filed under. */
export function historyFolder(projectRoot: string, historyDir: string): string {
	return projectRoot.length === 0 ? historyDir : `${projectRoot}/${historyDir}`;
}

/** The year folder a month's files stand in, for gathering a whole month. */
export function historyYearFolder(
	projectRoot: string,
	historyDir: string,
	year: string,
): string {
	return `${historyFolder(projectRoot, historyDir)}/${year}`;
}

/**
 * Where one device files one month of one record kind:
 * `<root>/<history dir>/<year>/<year>_<month>_<device><suffix>`. The month
 * is the moment's day in the device's zone, as the sessions file theirs,
 * and the device id keeps two installations from ever appending to the
 * same file; a reader gathers a month by prefix and suffix.
 */
export function historyFilePath(
	projectRoot: string,
	historyDir: string,
	ms: number,
	timeZone: string,
	deviceId: string,
	suffix: HistoryFileSuffix,
): string {
	const { year, month } = monthKeyOfDay(calendarDay(ms, timeZone));
	return `${historyYearFolder(projectRoot, historyDir, year)}/${year}_${month}_${deviceId}${suffix}`;
}

export const MODIFICATION_HISTORY_SCHEMA_VERSION = 1;

// ---- What a note is to the history ----

/**
 * What kind of note a path is, as the history tells it: the manuscript,
 * the three entity kinds, a step note, or any other note of the project.
 */
export const HISTORY_NOTE_KINDS = [
	'manuscript',
	'character',
	'scene',
	'worldbuilding',
	'step',
	'other',
] as const;

export type HistoryNoteKind = (typeof HISTORY_NOTE_KINDS)[number];

/** The steps whose work is one note each: the summaries and the synopses. */
export const HISTORY_STEPS = [1, 2, 4, 6] as const;

export type HistoryStep = (typeof HISTORY_STEPS)[number];

export interface HistoryNoteRef {
	/** Under the project root, so moving or archiving the project changes nothing. */
	path: string;
	kind: HistoryNoteKind;
	/** The worldbuilding kind's id, for a worldbuilding note. */
	wbKind?: string;
	/** The step a step note stands for. */
	step?: HistoryStep;
	/** The document type the note's frontmatter declared, where it did. */
	documentType?: DocumentType;
}

// ---- The versions File recovery kept ----

/**
 * One version of one note, as File recovery kept it, reduced to numbers:
 * the moment, the count, the change since this device last saw the note,
 * and a fingerprint of the text so the same version met twice -- synced
 * back, or kept again after a clear -- is one version.
 */
export interface NoteSnapshotRecord extends HistoryNoteRef {
	/** File recovery's own moment for the version, in milliseconds. */
	ts: number;
	/** The body's whole-text count, under the convention the file or the row names. */
	words: number;
	/**
	 * Against this device's previous version of the note: null for the first
	 * version this device saw, and across a change of counting convention.
	 */
	delta: number | null;
	/** The previous version's moment, present exactly when the delta is. */
	prevTs?: number;
	/** A fingerprint of the whole text, never the text. */
	hash: string;
	/** The convention the row was counted under, only where it differs from the file's. */
	countMode?: string;
	countHeadings?: string;
}

export interface NoteSnapshotMonthFile {
	schemaVersion: typeof MODIFICATION_HISTORY_SCHEMA_VERSION;
	/**
	 * The convention the rows were counted under unless a row says
	 * otherwise. Kept as the stamps the settings write, read for equality
	 * and never interpreted, so a convention a later build adds still
	 * reads here.
	 */
	countMode: string;
	countHeadings: string;
	/** Ascending by moment, one row per version of a path. */
	snapshots: NoteSnapshotRecord[];
}

// ---- The changes the plugin made ----

/**
 * What the plugin did, in the words the history uses: to a note, a task, a
 * foreshadowing thread or a revision. The first word of each kind names
 * its subject.
 */
export const HISTORY_EVENT_KINDS = [
	'created',
	'renamed',
	'deleted',
	'imported',
	'task-created',
	'task-status',
	'task-archived',
	'task-deleted',
	'thread-created',
	'thread-status',
	'thread-deleted',
	'revision-proposed',
	'revision-accepted',
	'revision-discarded',
] as const;

export type HistoryEventKind = (typeof HISTORY_EVENT_KINDS)[number];

/**
 * Who made the change: the author at a form, the plugin on its own (a
 * repair, a materialized node), an import, or a reading inferred from the
 * versions alone (a rename the plugin never saw, told by the text).
 */
export const HISTORY_EVENT_ORIGINS = ['user', 'plugin', 'import', 'inferred'] as const;

export type HistoryEventOrigin = (typeof HISTORY_EVENT_ORIGINS)[number];

export const HISTORY_SUBJECT_TYPES = ['note', 'task', 'thread', 'revision'] as const;

export type HistorySubjectType = (typeof HISTORY_SUBJECT_TYPES)[number];

export type HistorySubject =
	| ({ type: 'note' } & HistoryNoteRef)
	| { type: 'task'; id: string; title: string }
	| { type: 'thread'; id: string; name: string }
	| { type: 'revision'; id: string; note: HistoryNoteRef };

export interface HistoryEventRecord {
	/** The acting device's own, and the merge key across devices. */
	id: string;
	ts: number;
	event: HistoryEventKind;
	origin: HistoryEventOrigin;
	subject: HistorySubject;
	/** The path renamed from, for a rename. */
	from?: string;
	/** The status moved to, for a task or thread status change. */
	status?: TaskStatus | ForeshadowingStatus;
	/** The book the change came from, for an event an import made. */
	importedFrom?: { projectId: string; title: string };
	/** The body's count when a note was created: shown beside it, never summed. */
	words?: number;
}

export interface HistoryEventMonthFile {
	schemaVersion: typeof MODIFICATION_HISTORY_SCHEMA_VERSION;
	/** Ascending by moment, one record per id. */
	events: HistoryEventRecord[];
}

/** Which subject an event kind is about, told by the kind's first word. */
export function subjectTypeOfEvent(event: HistoryEventKind): HistorySubjectType {
	if (event.startsWith('task-')) return 'task';
	if (event.startsWith('thread-')) return 'thread';
	if (event.startsWith('revision-')) return 'revision';
	return 'note';
}

// ---- Reading the files back ----

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/** A moment or a count: a finite number that is not below zero. */
function isCount(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
}

function isName(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isOneOf<T extends string | number>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (values as readonly unknown[]).includes(value);
}

/** An optional convention stamp: a non-empty string or nothing, as the sessions keep theirs. */
function parseConvention(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseNoteRef(value: Record<string, unknown>): HistoryNoteRef | null {
	if (!isName(value.path)) return null;
	if (!isOneOf(HISTORY_NOTE_KINDS, value.kind)) return null;
	if (value.wbKind !== undefined && !isName(value.wbKind)) return null;
	if (value.step !== undefined && !isOneOf(HISTORY_STEPS, value.step)) return null;
	if (value.documentType !== undefined && !isDocumentType(value.documentType)) {
		return null;
	}
	return {
		path: value.path,
		kind: value.kind,
		...(value.wbKind === undefined ? {} : { wbKind: value.wbKind }),
		...(value.step === undefined ? {} : { step: value.step }),
		...(value.documentType === undefined ? {} : { documentType: value.documentType }),
	};
}

/** Reads one stored version back, as strictly as a session record. */
export function parseNoteSnapshotRecord(value: unknown): NoteSnapshotRecord | null {
	if (!isRecord(value)) return null;
	const ref = parseNoteRef(value);
	if (ref === null) return null;
	if (!isCount(value.ts) || !isCount(value.words)) return null;
	const delta = value.delta;
	if (delta !== null && !isFiniteNumber(delta)) return null;
	// A delta is read against a previous version, so it names one; a
	// baseline has none to name. A row saying one without the other has
	// half a reading, and is not trusted with the other half.
	let prevTs: number | undefined;
	if (delta === null) {
		if (value.prevTs !== undefined) return null;
	} else {
		if (!isCount(value.prevTs)) return null;
		prevTs = value.prevTs;
	}
	if (!isName(value.hash)) return null;
	const countMode = parseConvention(value.countMode);
	const countHeadings = parseConvention(value.countHeadings);
	return {
		...ref,
		ts: value.ts,
		words: value.words,
		delta,
		...(prevTs === undefined ? {} : { prevTs }),
		hash: value.hash,
		...(countMode === undefined ? {} : { countMode }),
		...(countHeadings === undefined ? {} : { countHeadings }),
	};
}

/** A whole snapshot file, or null: one row this build cannot read rejects it. */
export function parseNoteSnapshotMonthFile(value: unknown): NoteSnapshotMonthFile | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== MODIFICATION_HISTORY_SCHEMA_VERSION) return null;
	if (!isName(value.countMode) || !isName(value.countHeadings)) return null;
	if (!Array.isArray(value.snapshots)) return null;
	const snapshots: NoteSnapshotRecord[] = [];
	for (const entry of value.snapshots) {
		const row = parseNoteSnapshotRecord(entry);
		if (row === null) return null;
		snapshots.push(row);
	}
	return {
		schemaVersion: MODIFICATION_HISTORY_SCHEMA_VERSION,
		countMode: value.countMode,
		countHeadings: value.countHeadings,
		snapshots,
	};
}

function parseSubject(value: unknown): HistorySubject | null {
	if (!isRecord(value)) return null;
	switch (value.type) {
		case 'note': {
			const ref = parseNoteRef(value);
			return ref === null ? null : { type: 'note', ...ref };
		}
		case 'task':
			if (!isName(value.id) || typeof value.title !== 'string') return null;
			return { type: 'task', id: value.id, title: value.title };
		case 'thread':
			if (!isName(value.id) || typeof value.name !== 'string') return null;
			return { type: 'thread', id: value.id, name: value.name };
		case 'revision': {
			if (!isName(value.id) || !isRecord(value.note)) return null;
			const note = parseNoteRef(value.note);
			return note === null ? null : { type: 'revision', id: value.id, note };
		}
		default:
			return null;
	}
}

/**
 * Reads one stored event back. The subject has to be the kind the event is
 * about; a rename has to say where from and a status change where to, and
 * neither is read off any other event.
 */
export function parseHistoryEventRecord(value: unknown): HistoryEventRecord | null {
	if (!isRecord(value)) return null;
	if (!isName(value.id) || !isCount(value.ts)) return null;
	if (!isOneOf(HISTORY_EVENT_KINDS, value.event)) return null;
	if (!isOneOf(HISTORY_EVENT_ORIGINS, value.origin)) return null;
	const subject = parseSubject(value.subject);
	if (subject === null || subject.type !== subjectTypeOfEvent(value.event)) return null;
	const record: HistoryEventRecord = {
		id: value.id,
		ts: value.ts,
		event: value.event,
		origin: value.origin,
		subject,
	};
	if (value.event === 'renamed') {
		if (!isName(value.from)) return null;
		record.from = value.from;
	}
	if (value.event === 'task-status') {
		if (!isTaskStatus(value.status)) return null;
		record.status = value.status;
	}
	if (value.event === 'thread-status') {
		if (!isForeshadowingStatus(value.status)) return null;
		record.status = value.status;
	}
	if (value.importedFrom !== undefined) {
		const from = value.importedFrom;
		if (!isRecord(from) || !isName(from.projectId) || typeof from.title !== 'string') {
			return null;
		}
		record.importedFrom = { projectId: from.projectId, title: from.title };
	}
	if (value.words !== undefined) {
		if (!isCount(value.words)) return null;
		record.words = value.words;
	}
	return record;
}

/** A whole event file, or null: one event this build cannot read rejects it. */
export function parseHistoryEventMonthFile(value: unknown): HistoryEventMonthFile | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== MODIFICATION_HISTORY_SCHEMA_VERSION) return null;
	if (!Array.isArray(value.events)) return null;
	const events: HistoryEventRecord[] = [];
	for (const entry of value.events) {
		const event = parseHistoryEventRecord(entry);
		if (event === null) return null;
		events.push(event);
	}
	return { schemaVersion: MODIFICATION_HISTORY_SCHEMA_VERSION, events };
}

// ---- Writing the files ----

/** A snapshot file with nothing in it yet, counted under the convention given. */
export function emptyNoteSnapshotMonthFile(
	countMode: string,
	countHeadings: string,
): NoteSnapshotMonthFile {
	return {
		schemaVersion: MODIFICATION_HISTORY_SCHEMA_VERSION,
		countMode,
		countHeadings,
		snapshots: [],
	};
}

export function emptyHistoryEventMonthFile(): HistoryEventMonthFile {
	return { schemaVersion: MODIFICATION_HISTORY_SCHEMA_VERSION, events: [] };
}

/** The convention a row was counted under: its own, or the file's. */
export function snapshotConvention(
	file: Pick<NoteSnapshotMonthFile, 'countMode' | 'countHeadings'>,
	row: Pick<NoteSnapshotRecord, 'countMode' | 'countHeadings'>,
): { countMode: string; countHeadings: string } {
	return {
		countMode: row.countMode ?? file.countMode,
		countHeadings: row.countHeadings ?? file.countHeadings,
	};
}

/** What two sightings of one version share: the moment and the path. */
export function snapshotKey(row: Pick<NoteSnapshotRecord, 'ts' | 'path'>): string {
	return `${String(row.ts)}:${row.path}`;
}

function byMomentThenPath(left: NoteSnapshotRecord, right: NoteSnapshotRecord): number {
	if (left.ts !== right.ts) return left.ts - right.ts;
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/**
 * The file with the rows added: a row whose moment and path the file
 * already holds is the same version seen again and stays as it was, and
 * the rows come out ascending by moment whatever order they went in. The
 * file comes back as it is when nothing was new.
 */
export function withSnapshots(
	file: NoteSnapshotMonthFile,
	rows: readonly NoteSnapshotRecord[],
): NoteSnapshotMonthFile {
	const seen = new Set(file.snapshots.map(snapshotKey));
	const added: NoteSnapshotRecord[] = [];
	for (const row of rows) {
		const key = snapshotKey(row);
		if (seen.has(key)) continue;
		seen.add(key);
		added.push(row);
	}
	if (added.length === 0) return file;
	return { ...file, snapshots: [...file.snapshots, ...added].sort(byMomentThenPath) };
}

/** The file with the events added, once each by id, ascending by moment. */
export function withHistoryEvents(
	file: HistoryEventMonthFile,
	events: readonly HistoryEventRecord[],
): HistoryEventMonthFile {
	const seen = new Set(file.events.map((event) => event.id));
	const added: HistoryEventRecord[] = [];
	for (const event of events) {
		if (seen.has(event.id)) continue;
		seen.add(event.id);
		added.push(event);
	}
	if (added.length === 0) return file;
	return {
		...file,
		events: [...file.events, ...added].sort((left, right) => left.ts - right.ts),
	};
}

/** The files as they are written: indented with tabs and ending in a newline, like the sessions'. */
export function serializeNoteSnapshotMonthFile(file: NoteSnapshotMonthFile): string {
	return `${JSON.stringify(file, null, '\t')}\n`;
}

export function serializeHistoryEventMonthFile(file: HistoryEventMonthFile): string {
	return `${JSON.stringify(file, null, '\t')}\n`;
}
