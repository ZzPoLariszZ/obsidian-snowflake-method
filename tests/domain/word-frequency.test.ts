import { describe, expect, it } from 'vitest';

import {
	DEFAULT_STOPWORDS_EN,
	DEFAULT_STOPWORDS_ZH,
	frequencyRows,
	hasWordSegmenter,
	mergeTokenCounts,
	parseStopwords,
	tokenizeProse,
} from '../../src/domain';

const counted = (map: Map<string, number>): Record<string, number> =>
	Object.fromEntries(map);

describe('tokenizing with the platform segmenter', () => {
	it('gathers, lowercases and folds spellings together', () => {
		if (!hasWordSegmenter()) return;
		const counts = tokenizeProse('The fog, the FOG, the fog!', [], 'en');
		expect(counted(counts)).toEqual({ the: 3, fog: 3 });
	});

	it('reads Chinese by dictionary words', () => {
		if (!hasWordSegmenter()) return;
		const counts = tokenizeProse('他们缓缓地走过，又缓缓地回来。', [], 'zh');
		expect(counts.get('缓缓')).toBe(2);
		expect(counts.get('他们')).toBe(1);
	});

	it('keeps numbers and punctuation out of the table', () => {
		if (!hasWordSegmenter()) return;
		const counts = tokenizeProse('Room 42 -- again!', [], 'en');
		expect(counts.has('42')).toBe(false);
		expect(counts.get('room')).toBe(1);
		expect(counts.get('again')).toBe(1);
	});

	it('never reads code, and never fuses across syntax', () => {
		if (!hasWordSegmenter()) return;
		const counts = tokenizeProse('plain `coded` **bold**text', [], 'en');
		expect(counts.has('coded')).toBe(false);
		expect(counts.has('boldtext')).toBe(false);
		expect(counts.get('bold')).toBe(1);
		expect(counts.get('text')).toBe(1);
	});
});

describe('tokenizing without a segmenter', () => {
	it('falls back to word runs and single CJK characters', () => {
		const counts = tokenizeProse('The fog 缓缓 came', [], 'en', null);
		expect(counted(counts)).toEqual({
			the: 1,
			fog: 1,
			缓: 2,
			came: 1,
		});
	});
});

describe('stopwords', () => {
	it('ships both default lists with their obvious members', () => {
		expect(DEFAULT_STOPWORDS_EN.has('the')).toBe(true);
		expect(DEFAULT_STOPWORDS_ZH.has('的')).toBe(true);
		expect(DEFAULT_STOPWORDS_EN.has('fog')).toBe(false);
	});

	it('reads a custom list from free text, normalized', () => {
		expect([...parseStopwords('Suddenly, 缓缓、and\nthen；')]).toEqual([
			'suddenly',
			'缓缓',
			'and',
			'then',
		]);
		expect(parseStopwords('  \n ')).toEqual(new Set());
	});
});

describe('merging and reading rows', () => {
	it('folds per-note pair lists into one count', () => {
		const merged = mergeTokenCounts([
			[
				['fog', 2],
				['sea', 1],
			],
			[['fog', 3]],
		]);
		expect(counted(merged)).toEqual({ fog: 5, sea: 1 });
	});

	it('filters at read time and orders by count, then locale', () => {
		const merged = mergeTokenCounts([
			[
				['the', 9],
				['fog', 3],
				['sea', 3],
				['alice', 2],
			],
		]);
		expect(
			frequencyRows(merged, { stopwords: null, exclude: null })[0]?.term,
		).toBe('the');
		expect(
			frequencyRows(merged, {
				stopwords: DEFAULT_STOPWORDS_EN,
				exclude: new Set(['alice']),
			}),
		).toEqual([
			{ term: 'fog', count: 3 },
			{ term: 'sea', count: 3 },
		]);
	});
});
