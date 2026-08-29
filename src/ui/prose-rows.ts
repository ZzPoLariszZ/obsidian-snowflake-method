/**
 * The prose panel's pure half: reading-time arithmetic, averages, and the
 * frequency search, kept apart from the DOM so every number is pinned by a
 * test that needs no workspace.
 */

import type { FrequencyRow } from '../domain';
import type {
	ManuscriptProseRow,
	ManuscriptProseStatistics,
	NoteProseStats,
} from '../services';
import type { Translate } from './modals';

export interface ReadingSpeeds {
	wordsPerMinute: number;
	cjkPerMinute: number;
}

/** Minutes of reading: each script at its own speed, summed. */
export function readingMinutes(
	units: { cjk: number; words: number },
	speeds: ReadingSpeeds,
): number {
	const wordsPerMinute = Math.max(1, speeds.wordsPerMinute);
	const cjkPerMinute = Math.max(1, speeds.cjkPerMinute);
	return units.words / wordsPerMinute + units.cjk / cjkPerMinute;
}

/** Minutes spoken the way a reader would: under one, in minutes, in hours. */
export function formatReadingTime(minutes: number, t: Translate): string {
	if (minutes < 1) return t('prose.time.lessThanMinute');
	const whole = Math.round(minutes);
	if (whole < 60) return t('prose.time.minutes', { minutes: whole });
	return t('prose.time.hoursMinutes', {
		hours: Math.floor(whole / 60),
		minutes: whole % 60,
	});
}

/**
 * Units per sentence, unrounded: words per sentence for English prose and
 * characters per sentence for Chinese, by the same split reading time uses.
 * Null where nothing is measured; the display rounds, not the measure.
 */
export function averageSentenceLength(
	units: { cjk: number; words: number },
	sentences: number,
): number | null {
	if (sentences <= 0) return null;
	return (units.cjk + units.words) / sentences;
}

/** The dialogue share of the writing, unrounded percent; null off nothing. */
export function dialoguePercent(
	stats: Pick<NoteProseStats, 'cjk' | 'words' | 'dialogueCjk' | 'dialogueWords'>,
): number | null {
	const total = stats.cjk + stats.words;
	if (total <= 0) return null;
	return ((stats.dialogueCjk + stats.dialogueWords) / total) * 100;
}

/** How every derived figure is written: two decimals, always both. */
export function formatDecimal(value: number): string {
	return value.toFixed(2);
}

/**
 * One term's share of everything counted, in percent against the whole
 * vocabulary rather than the filtered view, so a toggle never moves it.
 * Null while nothing is counted.
 */
export function frequencySharePercent(
	count: number,
	total: number,
): string | null {
	if (total <= 0) return null;
	return formatDecimal((count / total) * 100);
}

export interface ProseSummary {
	readingTime: string;
	/** Null while the manuscript holds no chapters. */
	averageChapter: string | null;
	/** Sentences per chapter, unrounded; null while there are no chapters. */
	sentencesPerChapter: number | null;
	averageSentence: number | null;
	dialoguePercent: number | null;
}

/** The strip above the table, every number derived from the totals. */
export function proseSummary(
	statistics: ManuscriptProseStatistics,
	speeds: ReadingSpeeds,
	t: Translate,
): ProseSummary {
	const totals = statistics.totals;
	const minutes = readingMinutes(totals, speeds);
	return {
		readingTime: formatReadingTime(minutes, t),
		averageChapter:
			totals.chapters > 0
				? formatReadingTime(minutes / totals.chapters, t)
				: null,
		sentencesPerChapter:
			totals.chapters > 0 ? totals.sentences / totals.chapters : null,
		averageSentence: averageSentenceLength(totals, totals.sentences),
		dialoguePercent: dialoguePercent(totals),
	};
}

/** The chapter filter's bounds; null on either side is no bound there. */
export interface LengthBounds {
	min: number | null;
	max: number | null;
}

/** A bound as typed: blank is no bound, and anything unreadable is too. */
export function parseLengthBound(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const value = Number(trimmed);
	if (!Number.isFinite(value)) return null;
	return Math.max(0, value);
}

/**
 * The chapter table's search and length filter in one pass: the title the
 * way every member search matches, the length -- the chapter's own counted
 * units -- against inclusive bounds.
 */
export function filterChapterRows(
	rows: readonly ManuscriptProseRow[],
	query: string,
	bounds: LengthBounds,
): ManuscriptProseRow[] {
	const needle = query.trim().toLowerCase();
	return rows.filter((row) => {
		if (needle.length > 0 && !row.title.toLowerCase().includes(needle)) {
			return false;
		}
		const length = row.cjk + row.words;
		if (bounds.min !== null && length < bounds.min) return false;
		if (bounds.max !== null && length > bounds.max) return false;
		return true;
	});
}

/** The frequency table's search, matched the way the pane's own search is. */
export function filterFrequencyRows(
	rows: readonly FrequencyRow[],
	query: string,
): FrequencyRow[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [...rows];
	return rows.filter((row) => row.term.includes(needle));
}

export interface CloudWord {
	term: string;
	count: number;
	/** 0 for the rarest of the chosen words, 1 for the commonest. */
	weight: number;
	/**
	 * The term's own die roll in [0, 1): every whim of the presentation --
	 * a tilt, a drift, a color -- derives from this, so the same word falls
	 * the same way every time the cloud is drawn.
	 */
	seed: number;
}

/** A stable pseudo-shuffle: the cloud looks scattered, never re-scatters. */
function cloudOrderOf(term: string): number {
	let hash = 5381;
	for (let index = 0; index < term.length; index += 1) {
		hash = ((hash << 5) + hash + term.charCodeAt(index)) >>> 0;
	}
	return hash;
}

/**
 * The cloud's words: the most frequent `limit` terms, each weighed on a log
 * scale -- word counts are Zipfian, and a linear scale would leave one giant
 * and dust -- then scattered by a hash of the term itself, so the layout
 * holds still across repaints. A uniform field weighs in at the middle.
 */
export function cloudWords(
	rows: readonly FrequencyRow[],
	limit: number,
): CloudWord[] {
	const top = rows.slice(0, Math.max(0, limit));
	if (top.length === 0) return [];
	const most = Math.max(...top.map((row) => row.count));
	const least = Math.min(...top.map((row) => row.count));
	const spread = Math.log(most) - Math.log(least);
	return top
		.map((row) => ({
			term: row.term,
			count: row.count,
			weight:
				spread <= 0 ? 0.5 : (Math.log(row.count) - Math.log(least)) / spread,
			seed: cloudOrderOf(row.term) / 4294967296,
		}))
		.sort(
			(left, right) =>
				cloudOrderOf(left.term) - cloudOrderOf(right.term) ||
				left.term.localeCompare(right.term),
		);
}
