// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import {
	applyMentionMarks,
	applySearchMarks,
	clearSearchMarks,
	markCurrentSearch,
	projectMentionMarks,
	searchMarkPieces,
} from '../../src/ui/mention-marks';
import type { MentionMark } from '../../src/domain';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

/**
 * A note as the stream renders it, one paragraph built from its pieces: a
 * string is text, and a one-entry object an element of that tag holding text.
 */
function rendered(...pieces: (string | Record<string, string>)[]): HTMLElement {
	const el = document.body.createDiv({ cls: 'snowflake-method-segment-rendered' });
	const paragraph = el.createEl('p');
	for (const piece of pieces) {
		if (typeof piece === 'string') {
			paragraph.append(piece);
			continue;
		}
		for (const [tag, text] of Object.entries(piece)) {
			paragraph.createEl(tag as keyof HTMLElementTagNameMap, { text });
		}
	}
	return el;
}

const match = (from: number, to: number, current = false) => ({
	from,
	to,
	classes: current ? 'snowflake-method-search-match is-current' : 'snowflake-method-search-match',
});

describe('search marks on the rendered half', () => {
	const body = 'The *ash* tree and the ash cart.';
	const html = '<p>The <em>ash</em> tree and the ash cart.</p>';
	const prose = (): HTMLElement => rendered('The ', { em: 'ash' }, ' tree and the ash cart.');

	it('wraps each match where the prose shows it, inside the emphasis it stands in', () => {
		const el = prose();
		applySearchMarks(el, projectMentionMarks(body, [match(5, 8, true), match(23, 26)]));
		const pieces = Array.from(el.querySelectorAll('span.snowflake-method-search-match'));
		expect(pieces.map((piece) => piece.textContent)).toEqual(['ash', 'ash']);
		expect(pieces[0]?.parentElement?.tagName).toBe('EM');
		expect(pieces[0]?.classList.contains('is-current')).toBe(true);
		expect(searchMarkPieces(el, 1)).toHaveLength(1);
	});

	it('moves the ring without wrapping again, and comes off leaving the prose as it was', () => {
		const el = prose();
		applySearchMarks(el, projectMentionMarks(body, [match(5, 8, true), match(23, 26)]));
		const moved = markCurrentSearch(el, 1);
		expect(moved.map((piece) => piece.textContent)).toEqual(['ash']);
		expect(el.querySelectorAll('.is-current')).toHaveLength(1);
		markCurrentSearch(el, null);
		expect(el.querySelectorAll('.is-current')).toHaveLength(0);
		clearSearchMarks(el);
		expect(el.innerHTML).toBe(html);
	});

	it('nests inside a mention that already wears the words, and leaves it standing', () => {
		const el = rendered('The ash cart.');
		const source = 'The ash cart.';
		const mention = {
			from: 4,
			to: 12,
			classes: 'snowflake-method-mention is-linked',
		} as unknown as MentionMark;
		applyMentionMarks(el, projectMentionMarks(source, [mention]));
		applySearchMarks(el, projectMentionMarks(source, [match(4, 7)]));
		const piece = el.querySelector('span.snowflake-method-search-match');
		expect(piece?.parentElement?.classList.contains('snowflake-method-mention')).toBe(true);
		clearSearchMarks(el);
		expect(el.querySelector('span.snowflake-method-mention')?.textContent).toBe('ash cart');
		expect(el.querySelector('span.snowflake-method-search-match')).toBeNull();
	});
});
