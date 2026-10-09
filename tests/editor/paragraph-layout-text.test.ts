import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';

import { paragraphLayoutByText } from '../../src/editor';

/** The layout of a document as line numbers, read off the text alone. */
function layoutOf(doc: string): { first: number[]; lines: number[]; blank: number[] } {
	const text = Text.of(doc.split('\n'));
	const lineOf = (at: number): number => text.lineAt(at).number;
	const layout = paragraphLayoutByText(text);
	return {
		first: layout.first.map(lineOf),
		lines: layout.lines.map(lineOf),
		blank: layout.blank.map(lineOf),
	};
}

describe('paragraphLayoutByText', () => {
	it('finds the paragraphs of a plain note and the gaps between them', () => {
		expect(layoutOf(['# Title', '', 'First.', 'Still first.', '', 'Second.'].join('\n'))).toEqual({
			first: [3, 6],
			lines: [3, 4, 6],
			blank: [2, 5],
		});
	});

	it('leaves headings, rules, tables and definitions out of the paragraphs', () => {
		const doc = ['Text.', '', '## Heading', '', '---', '', '| a | b |', '| - | - |', '', '[^1]: a footnote', '[ref]: https://example.test', '', 'More text.'].join('\n');
		expect(layoutOf(doc)).toEqual({
			first: [1, 13],
			lines: [1, 13],
			blank: [2, 4, 6, 9, 12],
		});
	});

	it('keeps a list and a quote to themselves, their blank lines included', () => {
		const doc = ['Intro.', '', '- one', '- two', '', '  still two', '', '- three', '', '> quoted', '> more', '', 'After.'].join('\n');
		expect(layoutOf(doc)).toEqual({
			first: [1, 13],
			lines: [1, 13],
			// The blank line after the list is the gap before the quote;
			// the ones inside the list are the list's own.
			blank: [2, 9, 12],
		});
	});

	it('reads nothing inside a fence, front matter, a math block or a comment', () => {
		const doc = ['---', 'title: x', '---', '', '```', '', 'code', '```', '', '$$', 'a = b', '', '$$', '', '%%', 'hidden', '', '%%', '', 'Prose.'].join('\n');
		expect(layoutOf(doc)).toEqual({
			first: [20],
			lines: [20],
			blank: [4, 9, 14, 19],
		});
	});

	it('closes a fence only with the same marker, at least as long', () => {
		const doc = ['````', '```', 'still code', '````', '', 'Prose.'].join('\n');
		expect(layoutOf(doc)).toEqual({ first: [6], lines: [6], blank: [5] });
	});

	it('treats a tag block as opaque until the blank line that ends it', () => {
		const doc = ['<div>', 'inside', '</div>', '', 'Prose.'].join('\n');
		expect(layoutOf(doc)).toEqual({ first: [5], lines: [5], blank: [4] });
	});

	it('ends a comment, a declaration or an instruction at its own closing', () => {
		// A section marker is one line, and the prose right after it is prose.
		const marker = ['<!-- snowflake:section:x:start -->', 'Prose after the marker.', '<!-- snowflake:section:x:end -->', '', 'More.'].join('\n');
		expect(layoutOf(marker)).toEqual({ first: [2, 5], lines: [2, 5], blank: [4] });
		const spread = ['<!--', 'a comment', 'over lines -->', 'Prose.', '', '<?php', 'echo 1; ?>', 'After.'].join('\n');
		expect(layoutOf(spread)).toEqual({ first: [4, 8], lines: [4, 8], blank: [5] });
	});

	it('marks the blank lines of a run as the stream does', () => {
		// Two blanks: the first is the gap, the second a line of its own.
		expect(layoutOf(['A.', '', '', 'B.'].join('\n'))).toEqual({
			first: [1, 3, 4],
			lines: [1, 4],
			blank: [2],
		});
		// Three: the first and the last are gaps, the middle a line of its own.
		expect(layoutOf(['A.', '', '', '', 'B.'].join('\n'))).toEqual({
			first: [1, 3, 5],
			lines: [1, 5],
			blank: [2, 4],
		});
	});

	it('takes an indented line for code only when no paragraph is under way', () => {
		const doc = ['Prose that', '    continues indented.', '', '    code', '', 'After.'].join('\n');
		expect(layoutOf(doc)).toEqual({
			first: [1, 6],
			lines: [1, 2, 6],
			blank: [3, 5],
		});
	});

	it('reads an empty note as one gap line, as the grammar does', () => {
		expect(layoutOf('')).toEqual({ first: [], lines: [], blank: [1] });
	});

	it('ends a quote at a blank line, and a list at one nothing continues', () => {
		const doc = ['> one', '', '> two', '', '- item', '', 'Prose.'].join('\n');
		expect(layoutOf(doc)).toEqual({ first: [7], lines: [7], blank: [2, 4, 6] });
	});
});
