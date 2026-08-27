import { describe, expect, it } from 'vitest';

import { t as translate } from '../../src/i18n';
import type { ManuscriptProseStatistics } from '../../src/services';
import {
	averageSentenceLength,
	dialoguePercent,
	filterFrequencyRows,
	formatReadingTime,
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
		expect(formatReadingTime(0.4, t)).toBe('Under a minute');
		expect(formatReadingTime(12.4, t)).toBe('12 min');
		expect(formatReadingTime(125, t)).toBe('2 h 5 min');
	});
});

describe('averages and shares', () => {
	it('reads units per sentence to one decimal, or nothing off nothing', () => {
		expect(averageSentenceLength({ cjk: 100, words: 0 }, 8)).toBe(12.5);
		expect(averageSentenceLength({ cjk: 0, words: 45 }, 3)).toBe(15);
		expect(averageSentenceLength({ cjk: 0, words: 0 }, 0)).toBeNull();
	});

	it('reads the dialogue share in whole percent', () => {
		expect(
			dialoguePercent({ cjk: 80, words: 20, dialogueCjk: 30, dialogueWords: 3 }),
		).toBe(33);
		expect(
			dialoguePercent({ cjk: 0, words: 0, dialogueCjk: 0, dialogueWords: 0 }),
		).toBeNull();
	});

	it('folds the totals into one summary strip', () => {
		const statistics: ManuscriptProseStatistics = {
			perNote: [],
			totals: {
				cjk: 800,
				words: 0,
				sentences: 40,
				dialogueCjk: 200,
				dialogueWords: 0,
				chapters: 2,
			},
		};
		expect(proseSummary(statistics, speeds, t)).toEqual({
			readingTime: '2 min',
			averageChapter: '1 min',
			sentences: 40,
			averageSentence: 20,
			dialoguePercent: 25,
		});
		const silent: ManuscriptProseStatistics = {
			perNote: [],
			totals: {
				cjk: 0,
				words: 0,
				sentences: 0,
				dialogueCjk: 0,
				dialogueWords: 0,
				chapters: 0,
			},
		};
		expect(proseSummary(silent, speeds, t)).toEqual({
			readingTime: 'Under a minute',
			averageChapter: null,
			sentences: 0,
			averageSentence: null,
			dialoguePercent: null,
		});
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
