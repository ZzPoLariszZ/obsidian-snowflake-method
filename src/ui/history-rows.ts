import {
	HISTORY_NOTE_KINDS,
	addDays,
	addMonths,
	clockOf,
	dayOfWeek,
	endOfMonth,
	formatDay,
	monthTitle,
	startOfMonth,
	startOfWeek,
	weekdayLabels,
	type DateFormat,
	type ForeshadowingStatus,
	type HistoryDay,
	type HistoryEntry,
	type HistoryNoteRef,
	type HistoryReading,
	type TaskStatus,
	type WeekStartDay,
} from '../domain';
import type { Translate } from './modals';

/**
 * The pure half of the Modification history tab: the range the reader
 * walks, the funnel over the kinds, the day list flattened for the virtual
 * window, and the sentence, the time and the figures each row says. Nothing
 * here touches the DOM, so all of it runs under the node test runtime; the
 * panel beside it only draws.
 */

// --- the range --------------------------------------------------------------

export const HISTORY_RANGE_UNITS = ['day', 'week', 'month'] as const;
export type HistoryRangeUnit = (typeof HISTORY_RANGE_UNITS)[number];

export function isHistoryRangeUnit(value: unknown): value is HistoryRangeUnit {
	return (HISTORY_RANGE_UNITS as readonly unknown[]).includes(value);
}

/** A span of days, inclusive, cut to the unit that holds `anchor`. */
export interface HistoryRange {
	unit: HistoryRangeUnit;
	from: string;
	through: string;
}

export function historyRange(
	anchor: string,
	unit: HistoryRangeUnit,
	weekStart: WeekStartDay,
): HistoryRange {
	switch (unit) {
		case 'day':
			return { unit, from: anchor, through: anchor };
		case 'week': {
			const from = startOfWeek(anchor, weekStart);
			return { unit, from, through: addDays(from, 6) };
		}
		case 'month':
			return { unit, from: startOfMonth(anchor), through: endOfMonth(anchor) };
	}
}

/** The range `count` units on; a negative count reaches backwards. */
export function stepHistoryRange(
	range: HistoryRange,
	count: number,
	weekStart: WeekStartDay,
): HistoryRange {
	const anchor =
		range.unit === 'month'
			? addMonths(range.from, count)
			: addDays(range.from, count * (range.unit === 'week' ? 7 : 1));
	return historyRange(anchor, range.unit, weekStart);
}

export interface HistoryDateOptions {
	t: Translate;
	locale: string;
	dateFormat: DateFormat;
}

/** A day as the list heads it: today and yesterday by name, the rest by date and weekday. */
export function historyDayTitle(day: string, today: string, options: HistoryDateOptions): string {
	if (day === today) return options.t('sessionWidget.bands.today');
	if (day === addDays(today, -1)) return options.t('sessionWidget.bands.yesterday');
	const weekday = weekdayLabels(options.locale, 'short')[dayOfWeek(day)] ?? '';
	return `${formatDay(day, options.dateFormat)} ${weekday}`;
}

/** The range as its title reads: a day as the list heads it, a week by its two ends, a month by name. */
export function historyRangeTitle(
	range: HistoryRange,
	today: string,
	options: HistoryDateOptions,
): string {
	switch (range.unit) {
		case 'day':
			return historyDayTitle(range.from, today, options);
		case 'week':
			return options.t('history.range.span', {
				from: formatDay(range.from, options.dateFormat),
				to: formatDay(range.through, options.dateFormat),
			});
		case 'month':
			return monthTitle(range.from, options.locale);
	}
}

// --- the kinds --------------------------------------------------------------

/**
 * The kinds the funnel always offers, as filter values: the notes by kind,
 * the three built-in worldbuilding kinds by theirs, then what the ledger
 * speaks of besides notes. An authored kind joins when a reading has one.
 */
export const HISTORY_FIXED_KINDS = [
	'manuscript',
	'character',
	'scene',
	'wb:time',
	'wb:location',
	'wb:item',
	'step',
	'task',
	'thread',
	'revision',
	'other',
] as const;

/** A note's kind as a filter value: worldbuilding notes by their own kind. */
export function noteKindKey(ref: Pick<HistoryNoteRef, 'kind' | 'wbKind'>): string {
	return ref.kind === 'worldbuilding' ? `wb:${ref.wbKind ?? ''}` : ref.kind;
}

/** A filter value back to the ref the labels and icons read; null for a value that is no kind of note. */
export function kindRefOf(key: string): HistoryNoteRef | null {
	if (key.startsWith('wb:')) return { path: '', kind: 'worldbuilding', wbKind: key.slice(3) };
	const kind = HISTORY_NOTE_KINDS.find((candidate) => candidate === key);
	return kind === undefined ? null : { path: '', kind };
}

/** Every kind an entry speaks of: a rename or an import, of every note it touched. */
export function entryKindKeys(entry: HistoryEntry): string[] {
	switch (entry.kind) {
		case 'note':
			return [noteKindKey(entry.note)];
		case 'renamed':
			return entry.items.map((item) => noteKindKey(item.note));
		case 'imported':
			return entry.notes.map((note) => noteKindKey(note));
		case 'task':
			return ['task'];
		case 'thread':
			return ['thread'];
		case 'revision':
			return ['revision'];
	}
}

export function entryMatchesKind(entry: HistoryEntry, filter: string): boolean {
	return filter === '' || entryKindKeys(entry).includes(filter);
}

/** The funnel's values: the fixed kinds, then any authored kind the reading speaks of. */
export function historyKindOptions(reading: HistoryReading | null): string[] {
	const fixed: readonly string[] = HISTORY_FIXED_KINDS;
	const authored = new Set<string>();
	for (const day of reading?.days ?? []) {
		for (const entry of day.entries) {
			for (const key of entryKindKeys(entry)) {
				if (!fixed.includes(key)) authored.add(key);
			}
		}
	}
	return [...fixed, ...[...authored].sort()];
}

// --- the rows ---------------------------------------------------------------

export interface HistoryDayRow {
	kind: 'day';
	key: string;
	day: string;
}

export interface HistoryEntryRow {
	kind: 'entry';
	key: string;
	day: string;
	entry: HistoryEntry;
}

export type HistoryFlatRow = HistoryDayRow | HistoryEntryRow;

/**
 * The list as the window draws it: the newest day first, each day's head
 * over its entries in the order they happened, and a day with nothing the
 * funnel lets through left out whole.
 */
export function flattenHistoryRows(
	days: readonly HistoryDay[],
	filter: string,
): HistoryFlatRow[] {
	const rows: HistoryFlatRow[] = [];
	for (const day of [...days].reverse()) {
		const entries = day.entries.filter((entry) => entryMatchesKind(entry, filter));
		if (entries.length === 0) continue;
		rows.push({ kind: 'day', key: `day:${day.day}`, day: day.day });
		for (const entry of entries) {
			rows.push({ kind: 'entry', key: `entry:${entry.id}`, day: day.day, entry });
		}
	}
	return rows;
}

// --- the sentences ----------------------------------------------------------

/**
 * Where the subject's name stands in a sentence while it is built, so the
 * panel can draw the name as a link and the words around it as words. A
 * private-use character: no copy contains one.
 */
export const NAME_MARK = '';

/** A sentence in three parts: the words before the name, the name, the words after. */
export interface HistorySentence {
	before: string;
	/** Null where the sentence names no one thing: several notes renamed or imported. */
	name: string | null;
	after: string;
}

/** A note's name as the sentences say it: the file's stem. */
export function noteName(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

/**
 * The name a note goes by in a sentence: a step note by its step's title,
 * since the layout names its file, every other note by its file.
 */
export function historyNoteName(t: Translate, note: HistoryNoteRef): string {
	if (note.kind === 'step' && note.step !== undefined) return t(`steps.${note.step}.title`);
	return noteName(note.path);
}

/**
 * What a note is in a sentence -- "the character “Ada”" -- with the name
 * standing as the mark. The kind's word for an authored worldbuilding kind
 * is the project's, so the caller lends it.
 */
export function historyWhat(
	t: Translate,
	note: HistoryNoteRef,
	kindLabel: (ref: HistoryNoteRef) => string,
): string {
	const name = NAME_MARK;
	switch (note.kind) {
		case 'character':
			return t('history.what.character', { name });
		case 'scene':
			return t('history.what.scene', { name });
		case 'worldbuilding': {
			const kind = note.wbKind ?? '';
			if (kind === 'time' || kind === 'location' || kind === 'item') {
				return t(`history.what.${kind}`, { name });
			}
			return t('history.what.custom', { kind: kindLabel(note), name });
		}
		case 'manuscript':
			return t('history.what.manuscript', { name });
		case 'step':
			return t('history.what.step', { step: note.step ?? '', name });
		default:
			return t('history.what.other', { name });
	}
}

export interface HistorySentenceLabels {
	what(note: HistoryNoteRef): string;
	taskStatus(status: TaskStatus): string;
	threadStatus(status: ForeshadowingStatus): string;
}

function splitAtMark(text: string, name: string): HistorySentence {
	const at = text.indexOf(NAME_MARK);
	if (at < 0) return { before: text, name: null, after: '' };
	return { before: text.slice(0, at), name, after: text.slice(at + 1) };
}

/** What an entry says happened, in the reader's words, the subject's name set apart. */
export function historySentence(
	t: Translate,
	entry: HistoryEntry,
	labels: HistorySentenceLabels,
): HistorySentence {
	switch (entry.kind) {
		case 'note': {
			const what = labels.what(entry.note);
			const name = historyNoteName(t, entry.note);
			switch (entry.action) {
				case 'created':
					return splitAtMark(t('history.event.created', { what }), name);
				case 'imported':
					return splitAtMark(
						entry.importedFrom === undefined
							? t('history.event.imported', { what })
							: t('history.event.importedFrom', { what, from: entry.importedFrom.title }),
						name,
					);
				case 'first-recorded':
					return splitAtMark(t('history.event.firstRecorded', { what }), name);
				case 'deleted':
					return splitAtMark(t('history.event.deleted', { what }), name);
				case 'edited':
					return splitAtMark(
						t(entry.source === 'sessions' ? 'history.event.wrote' : 'history.event.edited', {
							what,
						}),
						name,
					);
			}
			break;
		}
		case 'renamed': {
			const one = entry.items.length === 1 ? entry.items[0] : undefined;
			if (one === undefined) {
				return { before: t('history.event.renamedMany', { count: entry.items.length }), name: null, after: '' };
			}
			return splitAtMark(
				t('history.event.renamed', { from: noteName(one.from), name: NAME_MARK }),
				noteName(one.note.path),
			);
		}
		case 'imported':
			return {
				before:
					entry.from === null
						? t('history.event.importedManyPlain', { count: entry.notes.length })
						: t('history.event.importedMany', { count: entry.notes.length, from: entry.from.title }),
				name: null,
				after: '',
			};
		case 'task': {
			const name = NAME_MARK;
			const text =
				entry.event === 'task-created'
					? t('history.event.taskCreated', { name })
					: entry.event === 'task-status'
						? t('history.event.taskStatus', {
								name,
								status: entry.status === undefined ? '' : labels.taskStatus(entry.status),
							})
						: entry.event === 'task-archived'
							? t('history.event.taskArchived', { name })
							: t('history.event.taskDeleted', { name });
			return splitAtMark(text, entry.task.title);
		}
		case 'thread': {
			const name = NAME_MARK;
			const text =
				entry.event === 'thread-created'
					? t('history.event.threadCreated', { name })
					: entry.event === 'thread-status'
						? t('history.event.threadStatus', {
								name,
								status: entry.status === undefined ? '' : labels.threadStatus(entry.status),
							})
						: t('history.event.threadDeleted', { name });
			return splitAtMark(text, entry.thread.name);
		}
		case 'revision': {
			const what = labels.what(entry.note);
			const text =
				entry.event === 'revision-proposed'
					? t('history.event.revisionProposed', { what })
					: entry.event === 'revision-accepted'
						? t('history.event.revisionAccepted', { what })
						: t('history.event.revisionDiscarded', { what });
			return splitAtMark(text, historyNoteName(t, entry.note));
		}
	}
	return { before: '', name: null, after: '' };
}

// --- the time and the figures -----------------------------------------------

/** How far apart two moments stand before an entry shows both ends of its stretch. */
const SPAN_SHOWN_MS = 60_000;

/** When an entry happened, as the clock read: one moment, or the two ends of a stretch. */
export function historyTime(entry: HistoryEntry, timeZone: string): string {
	const from = clockOf(entry.at, timeZone);
	if (entry.until - entry.at < SPAN_SHOWN_MS) return from;
	return `${from}–${clockOf(entry.until, timeZone)}`;
}

/** A piece of a text: a run of digits with their separators, or the words around one. */
export interface TextRun {
	text: string;
	numeral: boolean;
}

const NUMERAL = /[+\-−]?\d+(?:[,.:/-]\d+)*/gu;

/**
 * A text cut at its numbers, so the panel can set the figures in the
 * monospaced face and leave the words around them in the interface's own:
 * a signed count, a grouped count, a clock, a day in any of the formats.
 */
export function numeralRuns(text: string): TextRun[] {
	const runs: TextRun[] = [];
	let from = 0;
	for (const match of text.matchAll(NUMERAL)) {
		if (match.index > from) runs.push({ text: text.slice(from, match.index), numeral: false });
		runs.push({ text: match[0], numeral: true });
		from = match.index + match[0].length;
	}
	if (from < text.length) runs.push({ text: text.slice(from), numeral: false });
	return runs;
}

