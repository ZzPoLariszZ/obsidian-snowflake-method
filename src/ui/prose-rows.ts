/**
 * The prose panel's pure half: reading-time arithmetic, averages, and the
 * frequency search, kept apart from the DOM so every number is pinned by a
 * test that needs no workspace.
 */

import type { FrequencyRow } from '../domain';
import type { ManuscriptProseStatistics, NoteProseStats } from '../services';
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
 * Units per sentence, one decimal: words per sentence for English prose and
 * characters per sentence for Chinese, by the same split reading time uses.
 * Null where nothing is measured.
 */
export function averageSentenceLength(
	units: { cjk: number; words: number },
	sentences: number,
): number | null {
	if (sentences <= 0) return null;
	return Math.round(((units.cjk + units.words) / sentences) * 10) / 10;
}

/** The dialogue share of the writing, in whole percent; null off nothing. */
export function dialoguePercent(
	stats: Pick<NoteProseStats, 'cjk' | 'words' | 'dialogueCjk' | 'dialogueWords'>,
): number | null {
	const total = stats.cjk + stats.words;
	if (total <= 0) return null;
	return Math.round(((stats.dialogueCjk + stats.dialogueWords) / total) * 100);
}

export interface ProseSummary {
	readingTime: string;
	/** Null while the manuscript holds no chapters. */
	averageChapter: string | null;
	sentences: number;
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
		sentences: totals.sentences,
		averageSentence: averageSentenceLength(totals, totals.sentences),
		dialoguePercent: dialoguePercent(totals),
	};
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
