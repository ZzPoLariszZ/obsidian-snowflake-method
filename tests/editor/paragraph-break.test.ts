import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';

import { MARKDOWN_LANGUAGE, paragraphBreak } from '../../src/editor';

/** The document after Enter, with the caret shown as a bar; null when Enter is not ours. */
function pressEnter(doc: string, from: number, to = from): string | null {
	const state = EditorState.create({
		doc,
		extensions: MARKDOWN_LANGUAGE,
		selection: EditorSelection.range(from, to),
	});
	const spec = paragraphBreak(state);
	if (spec === null) return null;
	const next = state.update(spec).state;
	const head = next.selection.main.head;
	return `${next.doc.sliceString(0, head)}|${next.doc.sliceString(head)}`;
}

describe('paragraphBreak', () => {
	it('puts the blank line a paragraph needs and lands on the line after it', () => {
		expect(pressEnter('One.', 4)).toBe('One.\n\n|');
	});

	it('splits a paragraph into two where the caret stands', () => {
		expect(pressEnter('One two', 3)).toBe('One\n\n| two');
	});

	it('stands between the two newlines when Enter is pressed on a blank line', () => {
		// A line of its own, with a gap on either side.
		expect(pressEnter('One.\n\nTwo.', 5)).toBe('One.\n\n|\n\nTwo.');
	});

	it('replaces a selection the way typing would', () => {
		expect(pressEnter('One two three', 3, 7)).toBe('One\n\n| three');
	});

	it('follows a heading with the blank line the convention wants', () => {
		expect(pressEnter('# Title', 7)).toBe('# Title\n\n|');
	});

	it('leaves lists, quotes, code and table rows to the plain Enter', () => {
		expect(pressEnter('- item', 6)).toBeNull();
		expect(pressEnter('1. item', 7)).toBeNull();
		expect(pressEnter('> quote', 7)).toBeNull();
		expect(pressEnter('```\ncode\n```', 8)).toBeNull();
		expect(pressEnter('| a | b |', 9)).toBeNull();
		expect(pressEnter('<div>\nraw\n</div>', 9)).toBeNull();
	});

	it('answers for prose deep in a note the parser has not reached yet', () => {
		const doc = `${'word '.repeat(1000)}\n\nDeep.`;
		expect(pressEnter(doc, doc.length)).toBe(`${doc}\n\n|`);
	});
});
