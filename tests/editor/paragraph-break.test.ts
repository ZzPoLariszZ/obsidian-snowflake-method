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

	it('declines inside a table written without its outer pipes', () => {
		const table = 'Name | Age\n--- | ---\nBo | 3';
		// The end of each row in turn: headings, dashes, and a body row.
		expect(pressEnter(table, 10)).toBeNull();
		expect(pressEnter(table, 20)).toBeNull();
		expect(pressEnter(table, 27)).toBeNull();
	});

	it('answers on the blank line under a table, which is not the table', () => {
		// The line that ended the table belongs to no block. Reading it as one
		// of the rows put a single newline there, and the next thing written
		// became a soft break glued to the paragraph below.
		expect(pressEnter('Name | Age\n--- | ---\nBo | 3\n\nAfter', 28)).toBe(
			'Name | Age\n--- | ---\nBo | 3\n\n|\n\nAfter',
		);
		expect(
			pressEnter('| Name | Age |\n| --- | --- |\n| Bo | 3 |\n\nAfter', 40),
		).toBe('| Name | Age |\n| --- | --- |\n| Bo | 3 |\n\n|\n\nAfter');
		// The same line with nothing after it at all.
		expect(pressEnter('Name | Age\n--- | ---\nBo | 3\n', 28)).toBe(
			'Name | Age\n--- | ---\nBo | 3\n\n|\n',
		);
	});

	it('declines inside a table written with its outer pipes', () => {
		const table = '| Name | Age |\n| --- | --- |\n| Bo | 3 |';
		expect(pressEnter(table, 14)).toBeNull();
		expect(pressEnter(table, 39)).toBeNull();
	});

	it('answers on the prose around a table', () => {
		const doc = 'Before\n\nName | Age\n--- | ---\nBo | 3\n\nAfter';
		expect(pressEnter(doc, 6)).toBe('Before\n\n|\n\nName | Age\n--- | ---\nBo | 3\n\nAfter');
		expect(pressEnter(doc, 42)).toBe(`${doc}\n\n|`);
	});

	it('answers under a row of dashes that underlines a heading', () => {
		// No pipe, so it is a setext heading rather than a table.
		expect(pressEnter('Title\n---\n\nProse.', 17)).toBe('Title\n---\n\nProse.\n\n|');
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
