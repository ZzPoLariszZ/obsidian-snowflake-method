import { describe, expect, it } from 'vitest';
import { fuzzyScore, matchesFromStart } from '../../src/ui/fuzzy-match';

function scoreOf(query: string, candidate: string): number {
	const score = fuzzyScore(query, candidate);
	expect(score, `"${query}" should match "${candidate}"`).not.toBeNull();
	return score ?? Number.NEGATIVE_INFINITY;
}

describe('fuzzyScore', () => {
	it('matches everything at zero on an empty query', () => {
		expect(fuzzyScore('', 'Alice')).toBe(0);
		expect(fuzzyScore('  ', '雪花')).toBe(0);
	});

	it('returns null when the letters are not there in order', () => {
		expect(fuzzyScore('xyz', 'Alice')).toBeNull();
		expect(fuzzyScore('ba', 'ab')).toBeNull();
	});

	it('ignores case', () => {
		expect(fuzzyScore('ALI', 'alice')).toBe(fuzzyScore('ali', 'Alice'));
	});

	it('ranks a substring above any scattered subsequence', () => {
		expect(scoreOf('ali', 'Alice')).toBeGreaterThan(scoreOf('ali', 'apple lime'));
		expect(scoreOf('ab', 'drab')).toBeGreaterThan(scoreOf('ab', 'a very long b'));
	});

	it('prefers matches at the front and at word starts', () => {
		expect(scoreOf('ali', 'Alice')).toBeGreaterThan(scoreOf('ali', 'Malice'));
		expect(scoreOf('ali', 'Big Alice')).toBeGreaterThan(scoreOf('ali', 'Malice'));
		expect(scoreOf('ali', 'xxAlice')).toBeGreaterThan(scoreOf('ali', 'xxxxAlice'));
	});

	it('prefers tighter subsequences', () => {
		expect(scoreOf('ab', 'axb')).toBeGreaterThan(scoreOf('ab', 'axxxxb'));
	});

	it('matches CJK queries character-wise', () => {
		expect(scoreOf('雪', '雪花')).toBeGreaterThan(0);
		expect(scoreOf('花', '雪花')).toBeGreaterThan(0);
		expect(scoreOf('爱丽丝', '爱丽丝·门罗')).toBeGreaterThan(scoreOf('爱丝', '爱丽丝·门罗'));
		expect(fuzzyScore('丝爱', '爱丽丝')).toBeNull();
	});
});

describe('matchesFromStart', () => {
	it('is true only when the candidate begins with the folded query', () => {
		expect(matchesFromStart('ali', 'Alice')).toBe(true);
		expect(matchesFromStart(' ALI ', 'alice')).toBe(true);
		expect(matchesFromStart('lic', 'Alice')).toBe(false);
		expect(matchesFromStart('小', '小张')).toBe(true);
		expect(matchesFromStart('张', '小张')).toBe(false);
	});

	it('begins nothing on an empty query', () => {
		expect(matchesFromStart('', 'Alice')).toBe(false);
		expect(matchesFromStart('   ', 'Alice')).toBe(false);
	});
});
