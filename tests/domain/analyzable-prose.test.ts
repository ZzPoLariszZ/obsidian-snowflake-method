import { describe, expect, it } from 'vitest';

import { type AnalyzableRange, analyzableRanges } from '../../src/domain';

/** Every asserted stretch is read back out of the body it indexes. */
const slices = (body: string, ranges: readonly AnalyzableRange[]): string[] =>
	ranges.map((range) => body.slice(range.from, range.to));

describe('analyzable prose', () => {
	it('offers plain prose as one verbatim stretch', () => {
		const body = 'Alice met Bob.\n\n他们抵达黑塔城。';
		const ranges = analyzableRanges(body);
		expect(slices(body, ranges)).toEqual([body]);
		expect(ranges[0]?.link).toBeNull();
	});

	it('splits prose at syntax marks, so no match can span them', () => {
		const body = 'A**lice** ran';
		expect(slices(body, analyzableRanges(body))).toEqual(['A', 'lice', ' ran']);
	});

	it('offers the alias of a piped link, addressed to its target', () => {
		const body = 'Meet [[Demo/20_Character/Alice|小艾]] now';
		const ranges = analyzableRanges(body);
		expect(slices(body, ranges)).toEqual(['Meet ', '小艾', ' now']);
		expect(ranges[1]?.link).toEqual({ target: 'Demo/20_Character/Alice' });
		expect(ranges[0]?.link).toBeNull();
	});

	it('offers the target of a bare link as its own visible text', () => {
		const body = '去[[黑塔城]]了';
		const ranges = analyzableRanges(body);
		expect(slices(body, ranges)).toEqual(['去', '黑塔城', '了']);
		expect(ranges[1]?.link).toEqual({ target: '黑塔城' });
	});

	it('drops an embed whole', () => {
		const body = 'One ![[Chapter_01]] two';
		expect(slices(body, analyzableRanges(body))).toEqual(['One ', ' two']);
	});

	it('drops code, spans and fences alike', () => {
		const body = 'a `let x` b\n\n```\nAlice\n```\n\nc';
		const kept = slices(body, analyzableRanges(body)).join('');
		expect(kept).not.toContain('let x');
		expect(kept).not.toContain('Alice');
		expect(kept).toContain('a ');
		expect(kept).toContain('c');
	});

	it('hides comments, and an unclosed one to the end', () => {
		const body = 'kept %%gone%% also %%and the rest';
		const kept = slices(body, analyzableRanges(body)).join('');
		expect(kept).toBe('kept  also ');
	});

	it('lets a comment marker inside code open nothing', () => {
		const body = 'a `%%` b';
		const kept = slices(body, analyzableRanges(body)).join('');
		expect(kept).toBe('a  b');
	});

	it('never lets a tilde run swallow the chapter under it', () => {
		const body = '~~~~\nAlice below';
		const kept = slices(body, analyzableRanges(body)).join('');
		expect(kept).toContain('Alice below');
	});

	it('keeps heading text, marks dropped: a name in a title is a mention', () => {
		const body = '# Alice arrives\n\nprose';
		const kept = slices(body, analyzableRanges(body)).join('');
		expect(kept).toContain('Alice arrives');
		expect(kept).not.toContain('#');
	});

	it('drops a callout kind and keeps its title', () => {
		const body = '> [!note] The title';
		const kept = slices(body, analyzableRanges(body)).join('');
		expect(kept).toContain('The title');
		expect(kept).not.toContain('[!note]');
		expect(kept).not.toContain('>');
	});

	it('drops a block id and the space that carries it', () => {
		const body = 'Alice waited ^ab12';
		expect(slices(body, analyzableRanges(body)).join('')).toBe('Alice waited');
	});

	it('keeps an escaped character at its own offset, split from its guard', () => {
		const body = 'foo\\*bar';
		const ranges = analyzableRanges(body);
		expect(slices(body, ranges)).toEqual(['foo', '*bar']);
		expect(ranges[1]?.from).toBe(4);
	});

	it('removes excluded stretches, and reads an inverted one as empty', () => {
		const body = 'Alice met Bob';
		expect(
			slices(body, analyzableRanges(body, [{ from: 0, to: 6 }])).join(''),
		).toBe('met Bob');
		expect(slices(body, analyzableRanges(body, [{ from: 6, to: 5 }]))).toEqual([
			body,
		]);
	});

	it('drops highlight pairs and keeps what they hold', () => {
		const body = 'so ==Alice== ran';
		expect(slices(body, analyzableRanges(body))).toEqual([
			'so ',
			'Alice',
			' ran',
		]);
	});

	it('offers nothing from a link buried in a comment', () => {
		const body = '%%[[Alice]]%% Bob';
		const ranges = analyzableRanges(body);
		expect(slices(body, ranges).join('')).toBe(' Bob');
		expect(ranges.every((range) => range.link === null)).toBe(true);
	});
});
