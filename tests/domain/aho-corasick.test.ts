import { describe, expect, it } from 'vitest';

import { buildPatternMatcher } from '../../src/domain';

const entries = (...patterns: string[]): { pattern: string; payload: string }[] =>
	patterns.map((pattern) => ({ pattern, payload: pattern }));

describe('aho-corasick', () => {
	it('finds every occurrence, offsets sliced from the searched text', () => {
		const matcher = buildPatternMatcher(entries('ab'));
		const text = 'ab ab';
		const hits = matcher.findAll(text, 0);
		expect(hits.map((hit) => text.slice(hit.from, hit.to))).toEqual([
			'ab',
			'ab',
		]);
		expect(hits.map((hit) => hit.from)).toEqual([0, 3]);
	});

	it('adds the base into every offset', () => {
		const matcher = buildPatternMatcher(entries('x'));
		expect(matcher.findAll('x', 100)).toEqual([
			{ from: 100, to: 101, pattern: 'x', payloads: ['x'] },
		]);
	});

	it('reports overlapping and nested patterns alike', () => {
		const matcher = buildPatternMatcher(entries('he', 'she', 'hers'));
		const text = 'ushers';
		const found = matcher
			.findAll(text, 0)
			.map((hit) => [hit.pattern, hit.from]);
		expect(found).toEqual([
			['she', 1],
			['he', 2],
			['hers', 2],
		]);
	});

	it('reports a shorter pattern inside a longer one, in CJK too', () => {
		const matcher = buildPatternMatcher(entries('黑塔', '黑塔城'));
		const text = '他们抵达黑塔城。';
		const found = matcher
			.findAll(text, 0)
			.map((hit) => text.slice(hit.from, hit.to));
		expect(found).toEqual(['黑塔', '黑塔城']);
	});

	it('carries every payload registered for one exact string together', () => {
		const matcher = buildPatternMatcher([
			{ pattern: '小艾', payload: 'Alice' },
			{ pattern: '小艾', payload: 'Bob' },
			{ pattern: 'other', payload: 'Carol' },
		]);
		expect(matcher.patternCount).toBe(2);
		const hits = matcher.findAll('叫小艾的人', 0);
		expect(hits).toHaveLength(1);
		expect(hits[0]?.payloads).toEqual(['Alice', 'Bob']);
	});

	it('skips empty patterns and matches nothing without any', () => {
		expect(buildPatternMatcher(entries('')).patternCount).toBe(0);
		expect(buildPatternMatcher(entries('')).findAll('anything', 0)).toEqual(
			[],
		);
		expect(buildPatternMatcher(entries('long')).findAll('lo', 0)).toEqual([]);
	});
});
