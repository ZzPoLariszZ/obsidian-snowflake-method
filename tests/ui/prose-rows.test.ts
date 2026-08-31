import { describe, expect, it } from 'vitest';

import { t as translate } from '../../src/i18n';
import type { ManuscriptProseStatistics } from '../../src/services';
import {
	averageSentenceLength,
	cloudWords,
	dialoguePercent,
	filterChapterRows,
	filterFrequencyRows,
	formatDecimal,
	formatPercent,
	formatReadingTime,
	frequencySharePercent,
	parseLengthBound,
	proseSummary,
	readingMinutes,
	type ReadingSpeeds,
} from '../../src/ui/prose-rows';

const t = (key: string, vars?: Record<string, string | number>): string =>
	translate('en', key, vars);

const speeds: ReadingSpeeds = { wordsPerMinute: 250, cjkPerMinute: 400 };

describe('reading time', () => {
	it('reads each script at its own speed and sums the minutes', () => {
		expect(readingMinutes({ cjk: 400, words: 0 }, speeds)).toBe(1);
		expect(readingMinutes({ cjk: 0, words: 500 }, speeds)).toBe(2);
		expect(readingMinutes({ cjk: 400, words: 250 }, speeds)).toBe(2);
		expect(readingMinutes({ cjk: 100, words: 0 }, { wordsPerMinute: 0, cjkPerMinute: 0 })).toBe(100);
	});

	it('speaks minutes the way a reader would', () => {
		expect(formatReadingTime(0.4, t)).toBe('< 1 min');
		expect(formatReadingTime(12.4, t)).toBe('12 min');
		expect(formatReadingTime(125, t)).toBe('2 h 5 min');
	});
});

describe('averages and shares', () => {
	it('reads units per sentence unrounded, or nothing off nothing', () => {
		// The counted length, which is what the length column shows: the two
		// numbers a reader can see must divide into each other.
		expect(averageSentenceLength({ counted: 100 }, 8)).toBe(12.5);
		expect(averageSentenceLength({ counted: 45 }, 3)).toBe(15);
		expect(averageSentenceLength({ counted: 100 }, 3)).toBeCloseTo(33.3333, 3);
		expect(averageSentenceLength({ counted: 0 }, 0)).toBeNull();
	});

	it('reads the dialogue share unrounded', () => {
		expect(dialoguePercent({ counted: 100, dialogueCounted: 33 })).toBe(33);
		expect(dialoguePercent({ counted: 60, dialogueCounted: 20 })).toBeCloseTo(
			33.3333,
			3,
		);
		expect(dialoguePercent({ counted: 0, dialogueCounted: 0 })).toBeNull();
	});

	it('writes every derived figure with both decimals', () => {
		expect(formatDecimal(12.5)).toBe('12.50');
		expect(formatDecimal(100 / 3)).toBe('33.33');
		expect(formatDecimal(0)).toBe('0.00');
	});

	it('writes every percent at one width, a lone digit fed a zero', () => {
		expect(formatPercent(9.39)).toBe('09.39');
		expect(formatPercent(34.07)).toBe('34.07');
		expect(formatPercent(0)).toBe('00.00');
		expect(formatPercent(100)).toBe('100.00');
	});

	it('says a share of the whole vocabulary, or nothing off nothing', () => {
		expect(frequencySharePercent(135, 3100)).toBe('04.35');
		expect(frequencySharePercent(1, 3100)).toBe('00.03');
		expect(frequencySharePercent(9, 0)).toBeNull();
	});

	it('folds the totals into one summary strip', () => {
		const statistics: ManuscriptProseStatistics = {
			perNote: [],
			totals: {
				cjk: 800,
				words: 0,
				// Reading time comes off the script split above; every number a
				// reader compares with another comes off these two.
				counted: 900,
				sentences: 40,
				dialogueCounted: 225,
				chapters: 2,
			},
		};
		expect(proseSummary(statistics, speeds, t)).toEqual({
			readingTime: '2 min',
			averageChapter: '1 min',
			sentencesPerChapter: 20,
			averageSentence: 22.5,
			dialoguePercent: 25,
		});
		const silent: ManuscriptProseStatistics = {
			perNote: [],
			totals: {
				cjk: 0,
				words: 0,
				counted: 0,
				sentences: 0,
				dialogueCounted: 0,
				chapters: 0,
			},
		};
		expect(proseSummary(silent, speeds, t)).toEqual({
			readingTime: '< 1 min',
			averageChapter: null,
			sentencesPerChapter: null,
			averageSentence: null,
			dialoguePercent: null,
		});
	});
});

describe('the word cloud', () => {
	const ranked = [
		{ term: 'sea', count: 100 },
		{ term: 'fog', count: 10 },
		{ term: 'rope', count: 1 },
	];

	it('weighs the chosen words on a log scale, ends pinned', () => {
		const byTerm = new Map(
			cloudWords(ranked, 3).map((word) => [word.term, word.weight]),
		);
		expect(byTerm.get('sea')).toBe(1);
		expect(byTerm.get('rope')).toBe(0);
		expect(byTerm.get('fog')).toBeCloseTo(0.5, 5);
	});

	it('keeps only the top of the ranking and scatters it stably', () => {
		const two = cloudWords(ranked, 2);
		expect(new Set(two.map((word) => word.term))).toEqual(
			new Set(['sea', 'fog']),
		);
		expect(cloudWords(ranked, 2)).toEqual(two);
	});

	it('weighs a uniform field at the middle, and nothing as nothing', () => {
		const flat = cloudWords(
			[
				{ term: 'one', count: 4 },
				{ term: 'two', count: 4 },
			],
			5,
		);
		expect(flat.map((word) => word.weight)).toEqual([0.5, 0.5]);
		expect(cloudWords([], 10)).toEqual([]);
	});
});

describe('the chapter filter', () => {
	const row = (title: string, counted: number) => ({
		path: `${title}.md`,
		title,
		cjk: counted,
		words: 0,
		counted,
		sentences: 1,
		dialogueCounted: 0,
	});
	const chapters = [row('Fog', 100), row('Rope', 250), row('Sea', 1000)];

	it('reads a typed bound, and nothing from blanks or noise', () => {
		expect(parseLengthBound('250')).toBe(250);
		expect(parseLengthBound(' 42 ')).toBe(42);
		expect(parseLengthBound('')).toBeNull();
		expect(parseLengthBound('   ')).toBeNull();
		expect(parseLengthBound('many')).toBeNull();
		expect(parseLengthBound('-9')).toBe(0);
	});

	it('bounds the length from either side, ends inclusive', () => {
		const titles = (min: number | null, max: number | null): string[] =>
			filterChapterRows(chapters, '', { min, max }).map((entry) => entry.title);
		expect(titles(null, null)).toEqual(['Fog', 'Rope', 'Sea']);
		expect(titles(250, null)).toEqual(['Rope', 'Sea']);
		expect(titles(null, 250)).toEqual(['Fog', 'Rope']);
		expect(titles(101, 999)).toEqual(['Rope']);
	});

	it('narrows by the title and the length together', () => {
		expect(
			filterChapterRows(chapters, 'o', { min: 200, max: null }).map(
				(entry) => entry.title,
			),
		).toEqual(['Rope']);
	});
});

describe('the frequency search', () => {
	const rows = [
		{ term: 'fog', count: 9 },
		{ term: '缓缓', count: 4 },
		{ term: 'seafog', count: 1 },
	];

	it('narrows by the term, empty query keeping all', () => {
		expect(filterFrequencyRows(rows, '')).toHaveLength(3);
		expect(filterFrequencyRows(rows, 'fog').map((row) => row.term)).toEqual([
			'fog',
			'seafog',
		]);
		expect(filterFrequencyRows(rows, '缓').map((row) => row.term)).toEqual([
			'缓缓',
		]);
	});
});
