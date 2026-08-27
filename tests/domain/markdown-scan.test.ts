import { describe, expect, it } from 'vitest';

import {
	hiddenCommentRanges,
	maskTildeFences,
	tildeFenceRanges,
	wikilinkSpans,
} from '../../src/domain';

describe('markdown scan', () => {
	describe('wikilink spans', () => {
		it('bounds the alias as the visible text of a piped link', () => {
			const body = 'Meet [[Character/Alice|Alice]] today';
			const [span] = wikilinkSpans(body);
			expect(span?.target).toBe('Character/Alice');
			expect(span?.embed).toBe(false);
			expect(body.slice(span?.from, span?.to)).toBe('[[Character/Alice|Alice]]');
			expect(body.slice(span?.visibleFrom, span?.visibleTo)).toBe('Alice');
		});

		it('bounds the target as the visible text of a bare link', () => {
			const body = '去[[黑塔城]]了';
			const [span] = wikilinkSpans(body);
			expect(body.slice(span?.visibleFrom, span?.visibleTo)).toBe('黑塔城');
			expect(span?.target).toBe('黑塔城');
		});

		it('shows nothing for an empty alias', () => {
			const [span] = wikilinkSpans('[[Alice|]]');
			expect(span?.visibleFrom).toBe(span?.visibleTo);
		});

		it('shows nothing of an embed, whose content is another note', () => {
			const body = 'One ![[Chapter_01]] two';
			const [span] = wikilinkSpans(body);
			expect(span?.embed).toBe(true);
			expect(body.slice(span?.from, span?.to)).toBe('![[Chapter_01]]');
			expect(span?.visibleFrom).toBe(span?.visibleTo);
		});

		it('keeps an alias that carries a pipe of its own', () => {
			const body = '[[a|b|c]]';
			const [span] = wikilinkSpans(body);
			expect(span?.target).toBe('a');
			expect(body.slice(span?.visibleFrom, span?.visibleTo)).toBe('b|c');
		});

		it('finds every link on a line, in order', () => {
			const body = '[[Alice]] met [[Bob|him]]';
			const shown = wikilinkSpans(body).map((span) =>
				body.slice(span.visibleFrom, span.visibleTo),
			);
			expect(shown).toEqual(['Alice', 'him']);
		});
	});

	describe('tilde masking', () => {
		it('replaces every long run without moving a single offset', () => {
			const body = 'a ~~~~ b\n~~~text\nplain';
			const masked = maskTildeFences(body);
			expect(masked.length).toBe(body.length);
			expect(masked).toBe('a ,,,, b\n,,,text\nplain');
		});

		it('leaves strikethrough pairs for the grammar to read', () => {
			expect(maskTildeFences('~~gone~~')).toBe('~~gone~~');
		});
	});

	describe('tilde fence ranges', () => {
		it('finds a matched pair by the text alone', () => {
			const body = 'before\n~~~\n%% not a comment %%\n~~~\nafter';
			const [range] = tildeFenceRanges(body);
			expect(body.slice(range?.from, range?.to)).toBe(
				'~~~\n%% not a comment %%\n~~~',
			);
		});

		it('needs a closing run at least as wide as the opening one', () => {
			expect(tildeFenceRanges('~~~~\ntext\n~~~\nmore')).toEqual([]);
		});

		it('reads nothing into an unclosed opener', () => {
			expect(tildeFenceRanges('~~~\nthe rest of the chapter')).toEqual([]);
		});
	});

	describe('hidden comment ranges', () => {
		const nowhere = (): boolean => false;

		it('hides each pair, and an unclosed marker to the end', () => {
			const body = 'a %%one%% b %%two';
			const ranges = hiddenCommentRanges(body, nowhere);
			expect(ranges.map((range) => body.slice(range.from, range.to))).toEqual([
				'%%one%%',
				'%%two',
			]);
		});

		it('lets a marker inside code open nothing', () => {
			const body = 'a %%quoted%% b';
			const inCode = (at: number): boolean => at < 4;
			// The opening marker sits in code, so the closing one opens instead
			// and runs to the end of the body.
			expect(hiddenCommentRanges(body, inCode)).toEqual([
				{ from: 10, to: body.length },
			]);
		});
	});
});
