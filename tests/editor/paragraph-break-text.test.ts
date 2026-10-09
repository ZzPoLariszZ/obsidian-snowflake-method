import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { paragraphBreakByText } from '../../src/editor';

/** Enter as the paragraph break, decided from the text alone. */
describe('paragraphBreakByText', () => {
	function state(doc: string, at: number): EditorState {
		return EditorState.create({ doc, selection: { anchor: at } });
	}

	it('puts two newlines in prose, and after a heading', () => {
		const prose = state('One sentence.', 13);
		const spec = paragraphBreakByText(prose);
		expect(spec?.changes).toEqual({ from: 13, to: 13, insert: '\n\n' });
		const heading = state('# Title', 7);
		expect(paragraphBreakByText(heading)?.changes).toEqual({ from: 7, to: 7, insert: '\n\n' });
	});

	it('stands the caret between the two on a blank line', () => {
		const blank = state('One.\n\n\nTwo.', 5);
		const spec = paragraphBreakByText(blank);
		expect(spec?.changes).toEqual({ from: 5, to: 5, insert: '\n\n' });
		expect(spec?.selection).toEqual(expect.objectContaining({ anchor: 6, head: 6 }));
	});

	it('declines in a list, a quote, a fence, raw HTML, the front matter and a table', () => {
		expect(paragraphBreakByText(state('- item', 6))).toBeNull();
		expect(paragraphBreakByText(state('> quote', 7))).toBeNull();
		expect(paragraphBreakByText(state('```\ncode\n```', 8))).toBeNull();
		expect(paragraphBreakByText(state('<div>\ntext', 10))).toBeNull();
		expect(paragraphBreakByText(state('---\ntitle: a\n---', 10))).toBeNull();
		expect(paragraphBreakByText(state('| a | b |\n|---|---|\n| 1 | 2 |', 24))).toBeNull();
		expect(paragraphBreakByText(state('a | b\n--|--\n1 | 2', 16))).toBeNull();
	});
});
