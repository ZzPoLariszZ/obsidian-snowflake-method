import { describe, expect, it } from 'vitest';

import {
	buildTokenLexicon,
	DEFAULT_STOPWORDS_EN,
	DEFAULT_STOPWORDS_ZH,
	frequencyRows,
	hasWordSegmenter,
	lexiconFingerprint,
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
		const counts = tokenizeProse('The fog 缓缓 came', [], 'en', null, null);
		expect(counted(counts)).toEqual({
			the: 1,
			fog: 1,
			缓: 2,
			came: 1,
		});
	});
});

describe('tokenizing with the roster as a lexicon', () => {
	it('counts an invented name whole, no fragments left behind', () => {
		if (!hasWordSegmenter()) return;
		const lexicon = buildTokenLexicon(['萧炎', '萧薰儿']);
		const counts = tokenizeProse(
			'萧薰儿看着萧炎笑了。萧炎缓缓地走过。',
			[],
			'zh',
			lexicon,
		);
		expect(counts.get('萧炎')).toBe(2);
		expect(counts.get('萧薰儿')).toBe(1);
		expect(counts.has('萧')).toBe(false);
		expect(counts.has('炎')).toBe(false);
		expect(counts.get('缓缓')).toBe(1);
	});

	it('keeps the longest name where the roster overlaps itself', () => {
		const lexicon = buildTokenLexicon(['萧炎', '萧炎帝', '炎帝']);
		const counts = tokenizeProse('萧炎帝驾到。', [], 'zh', lexicon, null);
		expect(counts.get('萧炎帝')).toBe(1);
		expect(counts.has('萧炎')).toBe(false);
		expect(counts.has('炎帝')).toBe(false);
	});

	it('reads leftmost first when overlapping names tie', () => {
		const lexicon = buildTokenLexicon(['萧炎', '炎帝']);
		const counts = tokenizeProse('萧炎帝笑了', [], 'zh', lexicon, null);
		expect(counts.get('萧炎')).toBe(1);
		expect(counts.has('炎帝')).toBe(false);
		expect(counts.get('帝')).toBe(1);
	});

	it('stands on word boundaries exactly as mentions do', () => {
		if (!hasWordSegmenter()) return;
		const lexicon = buildTokenLexicon(['Rose']);
		const counts = tokenizeProse('Rose saw the roses. Roses!', [], 'en', lexicon);
		expect(counts.get('rose')).toBe(1);
		expect(counts.get('roses')).toBe(2);
	});

	it('carries a two-word name as one token', () => {
		if (!hasWordSegmenter()) return;
		const lexicon = buildTokenLexicon(['Black Tower']);
		const counts = tokenizeProse('The Black Tower stands.', [], 'en', lexicon);
		expect(counts.get('black tower')).toBe(1);
		expect(counts.has('black')).toBe(false);
		expect(counts.has('tower')).toBe(false);
	});

	it('folds a possessive into the name, either apostrophe', () => {
		if (!hasWordSegmenter()) return;
		const lexicon = buildTokenLexicon(['Alice']);
		const counts = tokenizeProse(
			"Alice's sword. Alice’s shield.",
			[],
			'en',
			lexicon,
		);
		expect(counts.get('alice')).toBe(2);
		expect(counts.has('s')).toBe(false);
		expect(counts.get('sword')).toBe(1);
		expect(counts.get('shield')).toBe(1);
	});

	it('atomizes under the fallback tokenizer too', () => {
		const lexicon = buildTokenLexicon(['萧炎']);
		const counts = tokenizeProse('萧炎笑了', [], 'zh', lexicon, null);
		expect(counted(counts)).toEqual({ 萧炎: 1, 笑: 1, 了: 1 });
	});

	it('never fuses a name across syntax, exactly as mentions cannot', () => {
		const lexicon = buildTokenLexicon(['萧炎']);
		const counts = tokenizeProse('萧**炎**来了', [], 'zh', lexicon, null);
		expect(counts.has('萧炎')).toBe(false);
		expect(counts.get('萧')).toBe(1);
	});

	it('fingerprints the label set blind to order and repeats', () => {
		expect(lexiconFingerprint(['萧炎', 'Alice'])).toBe(
			lexiconFingerprint(['Alice', '萧炎', ' Alice ']),
		);
		expect(lexiconFingerprint(['萧炎'])).not.toBe(lexiconFingerprint(['萧薰儿']));
		expect(lexiconFingerprint([])).toBe(lexiconFingerprint(['  ']));
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
