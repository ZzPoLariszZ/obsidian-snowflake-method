import { describe, expect, it } from 'vitest';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import { MARKDOWN_LANGUAGE, paragraphLayout } from '../../src/editor';

/**
 * The layout of a document as line numbers, which is how a reader sees it.
 * A short document is parsed in full the moment the state is made, so the
 * tree the rule reads is the whole tree.
 */
function layoutOf(
	doc: string,
	range?: { from: number; to: number },
): { first: number[]; lines: number[]; blank: number[] } {
	const state = EditorState.create({ doc, extensions: MARKDOWN_LANGUAGE });
	const layout = paragraphLayout(
		state,
		range?.from ?? 0,
		range?.to ?? state.doc.length,
	);
	const lineOf = (at: number): number => state.doc.lineAt(at).number;
	return {
		first: layout.first.map(lineOf),
		lines: layout.lines.map(lineOf),
		blank: layout.blank.map(lineOf),
	};
}

describe('the manuscript grammar', () => {
	it('parses a bare state into a Markdown document', () => {
		const state = EditorState.create({
			doc: '# Title\n\nProse.',
			extensions: MARKDOWN_LANGUAGE,
		});
		const tree = syntaxTree(state);
		expect(tree.topNode.name).toBe('Document');
		expect(tree.topNode.firstChild?.name).toBe('ATXHeading1');
	});
});

describe('paragraphLayout', () => {
	it('finds the first line of each paragraph and the blank lines between', () => {
		expect(layoutOf('One.\n\nTwo.\n')).toEqual({
			first: [1, 3],
			lines: [1, 3],
			blank: [2, 4],
		});
	});

	it('marks only the first line of a paragraph written over several, but every line as its', () => {
		expect(layoutOf('One\ntwo\n\nThree')).toEqual({
			first: [1, 4],
			lines: [1, 2, 4],
			blank: [3],
		});
	});

	it('leaves headings, lists and quotes without an indent, as the page does', () => {
		const doc = [
			'# Title', // 1
			'', // 2
			'Para', // 3
			'', // 4
			'- item', // 5
			'- item', // 6
			'', // 7
			'> quote', // 8
			'', // 9
			'Last', // 10
		].join('\n');
		expect(layoutOf(doc)).toEqual({
			first: [3, 10],
			lines: [3, 10],
			blank: [2, 4, 7, 9],
		});
	});

	it('indents a paragraph that follows a heading without a blank line', () => {
		expect(layoutOf('# T\nPara')).toEqual({ first: [2], lines: [2], blank: [] });
	});

	it('keeps a blank line inside a code block as code', () => {
		const doc = [
			'Text', // 1
			'', // 2
			'```', // 3
			'code', // 4
			'', // 5
			'more', // 6
			'```', // 7
			'', // 8
			'After', // 9
		].join('\n');
		expect(layoutOf(doc)).toEqual({ first: [1, 9], lines: [1, 9], blank: [2, 8] });
	});

	it('makes the first blank line of a run the gap and a second one a line of its own', () => {
		// Enter at the end of a note that ends in a newline: gap, the line
		// just opened, and the note's own trailing newline as the gap below.
		expect(layoutOf('One.\n\n\n')).toEqual({
			first: [1, 3],
			lines: [1],
			blank: [2, 4],
		});
		// Two blank lines: the second is a line of its own.
		expect(layoutOf('One.\n\n\nTwo.')).toEqual({
			first: [1, 3, 4],
			lines: [1, 4],
			blank: [2],
		});
		// Three or more: the first and the last are the gaps.
		expect(layoutOf('One.\n\n\n\n\nTwo.')).toEqual({
			first: [1, 3, 4, 6],
			lines: [1, 6],
			blank: [2, 5],
		});
	});

	it('reads a run across the edge of the range asked for', () => {
		const doc = 'One.\n\n\nTwo.';
		// Asked only from the second blank line on, it still knows that line
		// is the second of its run.
		expect(layoutOf(doc, { from: 6, to: doc.length })).toEqual({
			first: [3, 4],
			lines: [4],
			blank: [],
		});
	});

	it('reads whitespace as blank, the way the grammar does', () => {
		expect(layoutOf('A\n   \nB')).toEqual({
			first: [1, 3],
			lines: [1, 3],
			blank: [2],
		});
	});

	it('reads only as far as the parser has got, unless handed a tree parsed further', () => {
		// A state parses its first three thousand characters when it is made
		// and the rest in the background. The editor, opened deep in a long
		// note, needs the lines in view now, and brings a tree parsed that far.
		const filler = `${'word '.repeat(1000)}\n\n`;
		const doc = `${filler}Deep paragraph\n\nAnother`;
		const state = EditorState.create({ doc, extensions: MARKDOWN_LANGUAGE });
		const from = filler.length;
		expect(paragraphLayout(state, from, doc.length).first).toEqual([]);
		const tree = ensureSyntaxTree(state, doc.length, 1000);
		expect(tree).not.toBeNull();
		const layout = paragraphLayout(state, from, doc.length, tree ?? undefined);
		expect(layout.first.map((at) => state.doc.lineAt(at).number)).toEqual([3, 5]);
	});

	it('answers for a range alone', () => {
		const doc = 'A\n\nB\n\nC';
		// From the blank line before C to the end: B and A are out of range.
		expect(layoutOf(doc, { from: 5, to: doc.length })).toEqual({
			first: [5],
			lines: [5],
			blank: [4],
		});
	});
});
