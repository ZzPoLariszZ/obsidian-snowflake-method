import { addDays, calendarDay, daysBetween, zoneOffsetMs } from './calendar';
import type { ForeshadowingStatus } from './foreshadowing';
import {
	snapshotConvention,
	type HistoryEventKind,
	type HistoryEventOrigin,
	type HistoryEventRecord,
	type HistoryNoteRef,
	type HistorySubject,
	type NoteSnapshotMonthFile,
} from './history';
import type { TaskStatus } from './task';

/**
 * The merge: three records of what happened to a project's notes -- the
 * versions File recovery kept, reduced per device; the writing sessions'
 * per-note tallies; the plugin's own ledger -- read together into one
 * history, a day at a time, in the reader's zone. Pure: everything it
 * needs is handed in, and what it answers is what the panel shows.
 *
 * A note is one note across its renames, which the ledger's rename events
 * chain: a row kept under a path a note had then is read under the name
 * it has now, and a path reused after a rename keeps the old note's rows
 * under the new name and the new note's under the old. A day's words for
 * a note come from one source: the versions, where any device kept some
 * that day; else the sessions' tallies; and the ledger never counts
 * words, so nothing is summed twice.
 */

export const HISTORY_SOURCES = ['snapshots', 'sessions', 'ledger'] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];

/** How close two renames stand to be one renumbering, or one folder moved. */
export const RENAME_GROUP_MS = 2_000;
/** How close two notes an import brought stand to be one import. */
export const IMPORT_GROUP_MS = 10 * 60_000;
/** How long a rename, a deletion or an import told again by another device is the same one. */
export const EVENT_ECHO_MS = 24 * 3_600_000;
/** How long after File recovery's first version of a note the ledger may still write the creation down: the two land in either order. */
export const CREATION_SLACK_MS = 2_000;
const HOUR_MS = 3_600_000;

export interface HistoryWords {
	added: number;
	deleted: number;
	net: number;
}

/** A note as the history knows it now: under its latest name, and whether it still stands. */
export interface HistoryNoteIdentity extends HistoryNoteRef {
	exists: boolean;
}

export type HistoryNoteAction = 'created' | 'imported' | 'first-recorded' | 'edited' | 'deleted';

export interface HistoryImportSource {
	projectId: string;
	title: string;
}

interface HistoryEntryBase {
	id: string;
	day: string;
	/** The first and last moments of what the entry covers, ms. */
	at: number;
	until: number;
}

/** One note's day: its versions, its words and what became of it. */
export interface HistoryNoteEntry extends HistoryEntryBase {
	kind: 'note';
	action: HistoryNoteAction;
	note: HistoryNoteIdentity;
	/** Versions File recovery kept that day. */
	versions: number;
	words: HistoryWords;
	source: HistorySource;
	/** Timed sessions that touched the note that day. */
	sessions: number;
	/** Who made the note, for a creation. */
	origin?: HistoryEventOrigin;
	/** The body's count when the note was made, to show beside it; never summed. */
	createdWords?: number;
	importedFrom?: HistoryImportSource;
	/** The day the words reach back to, where the day's first version was read against one older than the day before. */
	since?: string;
}

export interface HistoryRenameItem {
	from: string;
	note: HistoryNoteIdentity;
}

/** A rename, or several told within a moment of one another: a renumbering, a folder moved. */
export interface HistoryRenameEntry extends HistoryEntryBase {
	kind: 'renamed';
	items: HistoryRenameItem[];
	/** Read off the versions rather than seen: the same text under a new name, the old gone. */
	inferred: boolean;
}

/** Several notes one import brought, told as one. */
export interface HistoryImportEntry extends HistoryEntryBase {
	kind: 'imported';
	from: HistoryImportSource | null;
	notes: HistoryNoteIdentity[];
	created: number;
	replaced: number;
	/** The versions the notes' own entries would have counted, kept here instead. */
	versions: number;
}

export type HistoryTaskEvent = 'task-created' | 'task-status' | 'task-archived' | 'task-deleted';
export interface HistoryTaskEntry extends HistoryEntryBase {
	kind: 'task';
	event: HistoryTaskEvent;
	task: { id: string; title: string };
	status?: TaskStatus;
}

export type HistoryThreadEvent = 'thread-created' | 'thread-status' | 'thread-deleted';
export interface HistoryThreadEntry extends HistoryEntryBase {
	kind: 'thread';
	event: HistoryThreadEvent;
	thread: { id: string; name: string };
	status?: ForeshadowingStatus;
}

export type HistoryRevisionEvent = 'revision-proposed' | 'revision-accepted' | 'revision-discarded';
export interface HistoryRevisionEntry extends HistoryEntryBase {
	kind: 'revision';
	event: HistoryRevisionEvent;
	revision: { id: string };
	note: HistoryNoteIdentity;
}

export type HistoryEntry =
	| HistoryNoteEntry
	| HistoryRenameEntry
	| HistoryImportEntry
	| HistoryTaskEntry
	| HistoryThreadEntry
	| HistoryRevisionEntry;

export interface HistoryTotals {
	words: HistoryWords;
	versions: number;
	/** Distinct notes with activity. */
	notes: number;
	/** Timed sessions. */
	sessions: number;
	/** What the ledger told: creations, deletions, renames, imports, tasks, threads, revisions. */
	events: number;
	sources: HistorySource[];
}

export interface HistoryDay extends HistoryTotals {
	day: string;
	/** Ascending by moment. */
	entries: HistoryEntry[];
}

export interface HistoryReading {
	/** Every day of the span, oldest first. */
	days: HistoryDay[];
	/** The span as one: its words, versions, notes, sessions and events summed. */
	summary: HistoryTotals;
}

/** One device's month file of versions. */
export interface HistorySnapshotSource {
	device: string;
	file: NoteSnapshotMonthFile;
}

/** One device's month file of events. */
export interface HistoryEventSource {
	device: string;
	events: readonly HistoryEventRecord[];
}

export interface HistoryTallyFile {
	/** Under the project root. */
	path: string;
	added: number;
	deleted: number;
	net: number;
}

/** One session's or untimed day's per-note tallies, as the session service reads them. */
export interface HistoryTallyReading {
	id: string;
	kind: 'session' | 'untimed';
	day: string;
	startedAt: number | null;
	endedAt: number | null;
	focusMs: number;
	files: readonly HistoryTallyFile[];
}

export interface HistoryMergeInput {
	/** The span, as days in the reader's zone. */
	from: string;
	through: string;
	timeZone: string;
	/** Every device's files for the months around the span. */
	snapshots: readonly HistorySnapshotSource[];
	/** Every device's events, all months: a note's identity needs the whole chain. */
	events: readonly HistoryEventSource[];
	tallies: readonly HistoryTallyReading[];
	/** Whether a note stands now, by its path under the root. */
	exists: (path: string) => boolean;
	/** What a note is now, for one the records never described; null for one the history does not speak of. */
	classify: (path: string) => HistoryNoteRef | null;
}

// ---- the series ----

interface SeriesRow {
	device: string;
	ts: number;
	words: number;
	delta: number | null;
	prevTs?: number;
	hash: string;
	mode: string;
	headings: string;
	/** A deletion's row: no version, only the words that went. */
	synthetic: boolean;
}

interface NoteTally {
	reading: HistoryTallyReading;
	file: HistoryTallyFile;
}

interface NoteState {
	identity: string;
	ref: HistoryNoteRef;
	refTs: number;
	rows: SeriesRow[];
	kept: SeriesRow[];
	created: HistoryEventRecord[];
	deleted: HistoryEventRecord[];
	imported: HistoryEventRecord[];
	tallies: NoteTally[];
}

const ECHOING: ReadonlySet<HistoryEventKind> = new Set(['renamed', 'deleted', 'imported']);

const compareText = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

const byMoment = (left: HistoryEventRecord, right: HistoryEventRecord): number =>
	left.ts - right.ts || compareText(left.id, right.id);

const subjectPath = (subject: HistorySubject): string | null =>
	subject.type === 'note' ? subject.path : subject.type === 'revision' ? subject.note.path : null;

/** The ref's own fields and nothing a row or an event carries besides. */
function noteRefOf(source: HistoryNoteRef, path: string): HistoryNoteRef {
	const ref: HistoryNoteRef = { path, kind: source.kind };
	if (source.wbKind !== undefined) ref.wbKind = source.wbKind;
	if (source.step !== undefined) ref.step = source.step;
	if (source.documentType !== undefined) ref.documentType = source.documentType;
	return ref;
}

const zeroWords = (): HistoryWords => ({ added: 0, deleted: 0, net: 0 });

const addWords = (into: HistoryWords, words: HistoryWords): void => {
	into.added += words.added;
	into.deleted += words.deleted;
	into.net += words.net;
};

interface ToldEvent {
	event: HistoryEventRecord;
	device: string;
}

/**
 * Every event once: the same id told by two devices' files is one event,
 * and a rename, a deletion or an import that sync made every other device
 * see, and write down as its own, is the one the earliest device wrote
 * down. Told again by the same device within the day, it is the same
 * change made again, a note deleted, restored and deleted once more, and
 * stands again; the ledger keeps one device's own echoes apart.
 */
function dedupeEvents(sources: readonly HistoryEventSource[]): HistoryEventRecord[] {
	const byId = new Map<string, ToldEvent>();
	for (const { device, events } of sources) {
		for (const event of events) {
			if (!byId.has(event.id)) byId.set(event.id, { event, device });
		}
	}
	const recent = new Map<string, ToldEvent[]>();
	const kept: HistoryEventRecord[] = [];
	for (const told of [...byId.values()].sort((left, right) => byMoment(left.event, right.event))) {
		const { event, device } = told;
		if (ECHOING.has(event.event)) {
			const key = `${event.event}\n${event.from ?? ''}\n${subjectPath(event.subject) ?? ''}`;
			const within = (recent.get(key) ?? []).filter(
				(seen) => event.ts - seen.event.ts <= EVENT_ECHO_MS,
			);
			if (within.some((seen) => seen.device !== device)) continue;
			within.push(told);
			recent.set(key, within);
		}
		kept.push(event);
	}
	return kept;
}

interface Rename {
	to: string;
	ts: number;
}

/**
 * The name a note has now, from the path a record named it by and when:
 * every rename of that path at or after the moment is followed, and a
 * deletion of the path before the next rename ends the chain, so a path
 * reused after a rename or a deletion keeps the old note's records under
 * the old note's name. A chain that comes back to a name it had stops
 * there.
 */
function buildIdentityIndex(
	events: readonly HistoryEventRecord[],
): (path: string, ts: number) => string {
	const renames = new Map<string, Rename[]>();
	const deletions = new Map<string, number[]>();
	for (const event of events) {
		if (event.subject.type !== 'note') continue;
		if (event.event === 'renamed' && event.from !== undefined) {
			const list = renames.get(event.from) ?? [];
			list.push({ to: event.subject.path, ts: event.ts });
			renames.set(event.from, list);
		} else if (event.event === 'deleted') {
			const list = deletions.get(event.subject.path) ?? [];
			list.push(event.ts);
			deletions.set(event.subject.path, list);
		}
	}
	return (path, ts) => {
		const visited = new Set([path]);
		let current = path;
		let at = ts;
		for (;;) {
			const next = (renames.get(current) ?? []).find((rename) => rename.ts >= at);
			if (next === undefined) break;
			const ended = (deletions.get(current) ?? []).some(
				(deleted) => deleted >= at && deleted < next.ts,
			);
			if (ended || visited.has(next.to)) break;
			visited.add(next.to);
			current = next.to;
			at = next.ts;
		}
		return current;
	};
}

/**
 * One note's versions across every device, each version once, with the
 * change each one made: a row from another device whose text is the last
 * kept row's is the same version synced back and drops, while the same
 * text kept again on one device is a version its dialog lists and stays;
 * a row read by its own device against its own last sighting keeps that
 * reading; one following another device's row is read against that
 * instead, where the two were counted the same way. A baseline that
 * follows the author's own creation of the note, or stands a moment
 * before the ledger wrote it down, is the whole of the note, added. A
 * deletion after the last version takes the words the note had.
 */
function walkSeries(state: NoteState): void {
	state.rows.sort((left, right) => left.ts - right.ts || compareText(left.device, right.device));
	const creations = state.created
		.filter((event) => event.origin === 'user')
		.map((event) => event.ts)
		.sort((left, right) => left - right);
	const kept: SeriesRow[] = [];
	let previous: SeriesRow | null = null;
	for (const row of state.rows) {
		if (previous !== null && previous.device !== row.device && previous.hash === row.hash) continue;
		let { delta, prevTs } = row;
		if (previous !== null && previous.device !== row.device) {
			const same = previous.mode === row.mode && previous.headings === row.headings;
			delta = same ? row.words - previous.words : null;
			prevTs = same ? previous.ts : undefined;
		}
		if (delta === null) {
			const floor = previous?.ts ?? Number.NEGATIVE_INFINITY;
			const creation = creations.find((ts) => ts > floor && ts <= row.ts + CREATION_SLACK_MS);
			if (creation !== undefined) {
				delta = row.words;
				prevTs = creation;
			}
		}
		const next: SeriesRow = { ...row, delta };
		if (prevTs === undefined) delete next.prevTs;
		else next.prevTs = prevTs;
		kept.push(next);
		previous = next;
	}
	for (const event of state.deleted) {
		let last: SeriesRow | null = null;
		for (const row of kept) {
			if (row.ts > event.ts) break;
			if (row.synthetic) last = null;
			else last = row;
		}
		if (last === null) continue;
		kept.push({
			device: '',
			ts: event.ts,
			words: 0,
			delta: -last.words,
			hash: '',
			mode: '',
			headings: '',
			synthetic: true,
		});
		kept.sort((left, right) => left.ts - right.ts);
	}
	state.kept = kept;
}

/** Items of a list by a key, in first-seen order. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	}
	return groups;
}

const emptyTotals = (): HistoryTotals => ({
	words: zeroWords(),
	versions: 0,
	notes: 0,
	sessions: 0,
	events: 0,
	sources: [],
});

const isLedgerEvent = (entry: HistoryEntry): boolean =>
	entry.kind !== 'note' ||
	entry.action === 'created' ||
	entry.action === 'imported' ||
	entry.action === 'deleted';

/** The day's work on an imported note beyond the import itself, which keeps the note's own entry. */
interface ImportOwnWork {
	versions: number;
	/** The later versions' words, or the sessions' where no version followed the import. */
	words: HistoryWords;
	source: HistorySource;
	at: number | null;
}

interface ImportCandidate {
	entry: HistoryNoteEntry;
	brought: 'created' | 'replaced';
	/** The version the import itself landed, where File recovery kept one: the group's, not the note's. */
	share: number;
	/** The import's own moments: when it was told, through the version it landed. */
	at: number;
	until: number;
	own: ImportOwnWork | null;
}

export function mergeHistory(input: HistoryMergeInput): HistoryReading {
	const zone = input.timeZone;
	const offsets = new Map<number, number>();
	const offsetAt = (ms: number): number => {
		const key = Math.floor(ms / HOUR_MS);
		let offset = offsets.get(key);
		if (offset === undefined) {
			offset = zoneOffsetMs(ms, zone);
			offsets.set(key, offset);
		}
		return offset;
	};
	const dayStart = (day: string): number => {
		const [year, month, date] = day.split('-').map(Number);
		const utc = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
		return utc - offsetAt(utc);
	};
	const dayOf = (ms: number): string => calendarDay(ms, zone);

	const events = dedupeEvents(input.events);
	const identityOf = buildIdentityIndex(events);

	// ---- every note, by the name it has now ----

	const notes = new Map<string, NoteState>();
	const noteAt = (identity: string): NoteState => {
		let state = notes.get(identity);
		if (state === undefined) {
			state = {
				identity,
				ref: { path: identity, kind: 'other' },
				refTs: Number.NEGATIVE_INFINITY,
				rows: [],
				kept: [],
				created: [],
				deleted: [],
				imported: [],
				tallies: [],
			};
			notes.set(identity, state);
		}
		return state;
	};
	const learn = (state: NoteState, ref: HistoryNoteRef, ts: number): void => {
		if (ts < state.refTs) return;
		state.ref = noteRefOf(ref, state.identity);
		state.refTs = ts;
	};
	const identityRef = (identity: string): HistoryNoteIdentity => {
		const state = notes.get(identity);
		const ref = state === undefined ? { path: identity, kind: 'other' as const } : state.ref;
		return { ...ref, exists: input.exists(identity) };
	};

	for (const { device, file } of input.snapshots) {
		for (const row of file.snapshots) {
			const state = noteAt(identityOf(row.path, row.ts));
			learn(state, row, row.ts);
			const convention = snapshotConvention(file, row);
			const kept: SeriesRow = {
				device,
				ts: row.ts,
				words: row.words,
				delta: row.delta,
				hash: row.hash,
				mode: convention.countMode,
				headings: convention.countHeadings,
				synthetic: false,
			};
			if (row.prevTs !== undefined) kept.prevTs = row.prevTs;
			state.rows.push(kept);
		}
	}
	for (const event of events) {
		if (event.subject.type === 'revision') {
			const state = noteAt(identityOf(event.subject.note.path, event.ts));
			learn(state, event.subject.note, event.ts);
			continue;
		}
		if (event.subject.type !== 'note') continue;
		const state = noteAt(identityOf(event.subject.path, event.ts));
		learn(state, event.subject, event.ts);
		if (event.event === 'created') state.created.push(event);
		else if (event.event === 'deleted') state.deleted.push(event);
		else if (event.event === 'imported') state.imported.push(event);
	}
	for (const reading of input.tallies) {
		const at = reading.startedAt ?? dayStart(reading.day);
		for (const file of reading.files) {
			const identity = identityOf(file.path, at);
			let state = notes.get(identity);
			if (state === undefined) {
				// A note the records never described: what it is now is all there is to go by.
				const ref = input.classify(identity);
				if (ref === null) continue;
				state = noteAt(identity);
				learn(state, ref, Number.NEGATIVE_INFINITY);
			}
			state.tallies.push({ reading, file });
		}
	}

	// ---- the days ----

	const days = new Map<string, HistoryDay>();
	const span = daysBetween(input.from, input.through);
	for (let at = 0; at <= span; at += 1) {
		const day = addDays(input.from, at);
		days.set(day, { ...emptyTotals(), day, entries: [] });
	}
	const dayAt = (day: string): HistoryDay | undefined => days.get(day);
	const notesTouched = new Map<string, Set<string>>();
	const touch = (day: string, identity: string): void => {
		const touched = notesTouched.get(day) ?? new Set<string>();
		touched.add(identity);
		notesTouched.set(day, touched);
	};
	const candidates = new Map<string, ImportCandidate[]>();

	for (const state of notes.values()) {
		walkSeries(state);
		const real = state.kept.filter((row) => !row.synthetic);
		const firstRow = real[0];
		const rowsByDay = groupBy(real, (row) => dayOf(row.ts));
		const goneByDay = groupBy(
			state.kept.filter((row) => row.synthetic),
			(row) => dayOf(row.ts),
		);
		const createdByDay = groupBy(state.created, (event) => dayOf(event.ts));
		const deletedByDay = groupBy(state.deleted, (event) => dayOf(event.ts));
		const importedByDay = groupBy(state.imported, (event) => dayOf(event.ts));
		const talliesByDay = groupBy(state.tallies, (tally) => tally.reading.day);
		const activeDays = new Set([
			...rowsByDay.keys(),
			...createdByDay.keys(),
			...deletedByDay.keys(),
			...importedByDay.keys(),
			...talliesByDay.keys(),
		]);
		for (const day of activeDays) {
			const bucket = dayAt(day);
			if (bucket === undefined) continue;
			const note = identityRef(state.identity);
			const rows = rowsByDay.get(day) ?? [];
			const created = createdByDay.get(day) ?? [];
			const imported = importedByDay.get(day) ?? [];
			const tallies = talliesByDay.get(day) ?? [];
			const timed = tallies.filter((tally) => tally.reading.kind === 'session');

			// A deletion is its own entry: the words that went, told apart
			// from the day's work before it.
			for (const event of deletedByDay.get(day) ?? []) {
				const gone = (goneByDay.get(day) ?? []).find((row) => row.ts === event.ts);
				const words = zeroWords();
				if (gone !== null && gone !== undefined && gone.delta !== null) {
					words.deleted = -gone.delta;
					words.net = gone.delta;
				}
				const entry: HistoryNoteEntry = {
					kind: 'note',
					id: `${day}:${state.identity}:deleted:${event.id}`,
					day,
					at: event.ts,
					until: event.ts,
					action: 'deleted',
					note,
					versions: 0,
					words,
					source: gone === undefined ? 'ledger' : 'snapshots',
					sessions: 0,
				};
				bucket.entries.push(entry);
				touch(day, state.identity);
				}

			if (rows.length === 0 && created.length === 0 && imported.length === 0 && tallies.length === 0) {
				continue;
			}
			const creation = created[0];
			const importEvent = imported[0];
			const words = zeroWords();
			let source: HistorySource = 'ledger';
			if (rows.length > 0) {
				source = 'snapshots';
				for (const row of rows) {
					if (row.delta === null) continue;
					if (row.delta > 0) words.added += row.delta;
					else words.deleted -= row.delta;
					words.net += row.delta;
				}
			} else if (tallies.length > 0) {
				source = 'sessions';
				for (const { file } of tallies) {
					words.added += file.added;
					words.deleted += file.deleted;
					words.net += file.net;
				}
			}
			const moments: number[] = rows.map((row) => row.ts);
			if (creation !== undefined) moments.push(creation.ts);
			if (importEvent !== undefined) moments.push(importEvent.ts);
			for (const { reading } of timed) {
				if (reading.startedAt !== null) moments.push(reading.startedAt);
			}
			const ends: number[] = rows.map((row) => row.ts);
			for (const { reading } of timed) {
				if (reading.endedAt !== null) ends.push(reading.endedAt);
			}
			const at = moments.length === 0 ? dayStart(day) : Math.min(...moments);
			const until = ends.length === 0 ? at : Math.max(at, ...ends);
			let action: HistoryNoteAction = 'edited';
			if (creation !== undefined) action = creation.origin === 'import' ? 'imported' : 'created';
			else if (importEvent !== undefined) action = 'imported';
			else if (firstRow !== undefined && rows[0] === firstRow && firstRow.delta === null) {
				action = 'first-recorded';
			}
			const entry: HistoryNoteEntry = {
				kind: 'note',
				id: `${day}:${state.identity}`,
				day,
				at,
				until,
				action,
				note,
				versions: rows.length,
				words,
				source,
				sessions: timed.length,
			};
			if (creation !== undefined) {
				entry.origin = creation.origin;
				if (creation.words !== undefined) entry.createdWords = creation.words;
				if (creation.importedFrom !== undefined) entry.importedFrom = creation.importedFrom;
			} else if (importEvent?.importedFrom !== undefined) {
				entry.importedFrom = importEvent.importedFrom;
			}
			// A first version read against one from the day before says nothing
			// a reader would not assume; one reaching further back names the day
			// the words have been gathering since.
			const reachingBack = rows[0];
			if (reachingBack?.prevTs !== undefined) {
				const sinceDay = dayOf(reachingBack.prevTs);
				if (sinceDay < addDays(day, -1)) entry.since = sinceDay;
			}
			bucket.entries.push(entry);
			touch(day, state.identity);
			if (action === 'imported') {
				// The import's own version is the first one at or after its moment;
				// versions before it and after it are the author's day.
				const importAt = creation?.ts ?? importEvent?.ts ?? at;
				const shareIndex = rows.findIndex((row) => row.ts >= importAt - CREATION_SLACK_MS);
				const shareRow = shareIndex === -1 ? undefined : rows[shareIndex];
				const ownRows = rows.filter((_, index) => index !== shareIndex);
				let own: ImportOwnWork | null = null;
				if (ownRows.length > 0 || timed.length > 0) {
					const ownWords = zeroWords();
					let ownSource: HistorySource = 'sessions';
					if (ownRows.length > 0) {
						ownSource = 'snapshots';
						for (const row of ownRows) {
							if (row.delta === null) continue;
							if (row.delta > 0) ownWords.added += row.delta;
							else ownWords.deleted -= row.delta;
							ownWords.net += row.delta;
						}
					} else {
						for (const { file } of tallies) {
							ownWords.added += file.added;
							ownWords.deleted += file.deleted;
							ownWords.net += file.net;
						}
					}
					const ownMoments = ownRows.map((row) => row.ts);
					for (const { reading } of timed) {
						if (reading.startedAt !== null) ownMoments.push(reading.startedAt);
					}
					own = {
						versions: ownRows.length,
						words: ownWords,
						source: ownSource,
						at: ownMoments.length === 0 ? null : Math.min(...ownMoments),
					};
				}
				const list = candidates.get(day) ?? [];
				list.push({
					entry,
					brought: creation !== undefined ? 'created' : 'replaced',
					share: shareRow === undefined ? 0 : 1,
					at: importAt,
					until: Math.max(importAt, shareRow?.ts ?? importAt),
					own,
				});
				candidates.set(day, list);
			}
		}
	}

	// ---- what one import brought, told as one ----

	for (const [day, list] of candidates) {
		const bucket = dayAt(day);
		if (bucket === undefined) continue;
		list.sort((left, right) => left.entry.at - right.entry.at);
		const groups: ImportCandidate[][] = [];
		const open = new Map<string, ImportCandidate[]>();
		for (const candidate of list) {
			const key = candidate.entry.importedFrom?.projectId ?? '';
			const group = open.get(key);
			const last = group?.[group.length - 1];
			if (group !== undefined && last !== undefined && candidate.entry.at - last.entry.at <= IMPORT_GROUP_MS) {
				group.push(candidate);
				continue;
			}
			const fresh = [candidate];
			groups.push(fresh);
			open.set(key, fresh);
		}
		for (const group of groups) {
			const first = group[0];
			if (group.length < 2 || first === undefined) continue;
			// Read before the members are rewritten below.
			const from = first.entry.importedFrom ?? null;
			let versions = 0;
			for (const member of group) {
				versions += member.share;
				if (member.own === null) {
					bucket.entries = bucket.entries.filter((entry) => entry !== member.entry);
					continue;
				}
				// The import's share goes with the group; the day's work stays the note's.
				const { entry } = member;
				entry.action = 'edited';
				delete entry.origin;
				delete entry.createdWords;
				delete entry.importedFrom;
				entry.versions = member.own.versions;
				entry.words = member.own.words;
				entry.source = member.own.source;
				if (member.own.at !== null) entry.at = member.own.at;
			}
			bucket.entries.push({
				kind: 'imported',
				id: `import:${first.entry.id}`,
				day,
				at: Math.min(...group.map((member) => member.at)),
				until: Math.max(...group.map((member) => member.until)),
				from,
				notes: group.map((member) => member.entry.note),
				created: group.filter((member) => member.brought === 'created').length,
				replaced: group.filter((member) => member.brought === 'replaced').length,
				versions,
			});
		}
	}

	// ---- renames, tasks, threads and revisions ----

	let renameGroup: HistoryEventRecord[] = [];
	const flushRenames = (): void => {
		const first = renameGroup[0];
		const last = renameGroup[renameGroup.length - 1];
		if (first === undefined || last === undefined) return;
		const day = dayOf(first.ts);
		const bucket = dayAt(day);
		if (bucket !== undefined) {
			bucket.entries.push({
				kind: 'renamed',
				id: `rename:${first.id}`,
				day,
				at: first.ts,
				until: last.ts,
				items: renameGroup.map((event) => ({
					from: event.from ?? '',
					note: identityRef(identityOf(subjectPath(event.subject) ?? '', event.ts)),
				})),
				inferred: renameGroup.every((event) => event.origin === 'inferred'),
			});
			for (const event of renameGroup) {
				touch(day, identityOf(subjectPath(event.subject) ?? '', event.ts));
			}
		}
		renameGroup = [];
	};
	for (const event of events) {
		const day = dayOf(event.ts);
		if (event.event === 'renamed' && event.subject.type === 'note') {
			const last = renameGroup[renameGroup.length - 1];
			if (last !== undefined && event.ts - last.ts > RENAME_GROUP_MS) flushRenames();
			renameGroup.push(event);
			continue;
		}
		const bucket = dayAt(day);
		if (bucket === undefined) continue;
		const base = { id: event.id, day, at: event.ts, until: event.ts };
		if (event.subject.type === 'task' && isTaskEvent(event.event)) {
			const entry: HistoryTaskEntry = {
				kind: 'task',
				...base,
				event: event.event,
				task: { id: event.subject.id, title: event.subject.title },
			};
			if (event.event === 'task-status' && event.status !== undefined) {
				entry.status = event.status as TaskStatus;
			}
			bucket.entries.push(entry);
		} else if (event.subject.type === 'thread' && isThreadEvent(event.event)) {
			const entry: HistoryThreadEntry = {
				kind: 'thread',
				...base,
				event: event.event,
				thread: { id: event.subject.id, name: event.subject.name },
			};
			if (event.event === 'thread-status' && event.status !== undefined) {
				entry.status = event.status as ForeshadowingStatus;
			}
			bucket.entries.push(entry);
		} else if (event.subject.type === 'revision' && isRevisionEvent(event.event)) {
			bucket.entries.push({
				kind: 'revision',
				...base,
				event: event.event,
				revision: { id: event.subject.id },
				note: identityRef(identityOf(event.subject.note.path, event.ts)),
			});
		}
	}
	flushRenames();

	// ---- the sessions ----

	for (const reading of input.tallies) {
		if (reading.kind !== 'session') continue;
		const bucket = dayAt(reading.day);
		if (bucket === undefined) continue;
		bucket.sessions += 1;
	}

	// ---- totals ----

	const summary = emptyTotals();
	const summaryNotes = new Set<string>();
	const summarySources = new Set<HistorySource>();
	for (const bucket of days.values()) {
		bucket.entries.sort((left, right) => left.at - right.at || compareText(left.id, right.id));
		const sources = new Set<HistorySource>();
		for (const entry of bucket.entries) {
			if (entry.kind === 'note') {
				addWords(bucket.words, entry.words);
				bucket.versions += entry.versions;
				sources.add(entry.source);
			} else if (entry.kind === 'imported') {
				bucket.versions += entry.versions;
			}
			if (isLedgerEvent(entry)) bucket.events += 1;
		}
		const touched = notesTouched.get(bucket.day) ?? new Set<string>();
		bucket.notes = touched.size;
		for (const identity of touched) summaryNotes.add(identity);
		bucket.sources = HISTORY_SOURCES.filter((source) => sources.has(source));
		for (const source of sources) summarySources.add(source);
		addWords(summary.words, bucket.words);
		summary.versions += bucket.versions;
		summary.sessions += bucket.sessions;
		summary.events += bucket.events;
	}
	summary.notes = summaryNotes.size;
	summary.sources = HISTORY_SOURCES.filter((source) => summarySources.has(source));
	return { days: [...days.values()], summary };
}

const isTaskEvent = (event: HistoryEventKind): event is HistoryTaskEvent =>
	event.startsWith('task-');
const isThreadEvent = (event: HistoryEventKind): event is HistoryThreadEvent =>
	event.startsWith('thread-');
const isRevisionEvent = (event: HistoryEventKind): event is HistoryRevisionEvent =>
	event.startsWith('revision-');
