// @vitest-environment happy-dom

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
	CARET_PARAGRAPH_CLASS,
	caretParagraph,
	caretParagraphWhen,
	paragraphAround,
	refreshParagraphLines,
} from '../../src/editor';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

const source = (text: string): Parameters<typeof paragraphAround>[0] => {
	const lines = text.split('\n');
	return {
		lines: lines.length,
		lineText: (line: number) => lines[line - 1] ?? '',
	};
};

const chapter = source(
	[
		'The rain had not stopped since Tuesday.', // 1
		'The road out was gone.', // 2
		'', // 3
		'She counted the coins twice.', // 4
		'The kettle had not boiled.', // 5
		'Nobody followed them out.', // 6
		'   ', // 7 — whitespace is as blank as nothing
		'', // 8
		'He said the bridge would hold.', // 9
	].join('\n'),
);

describe('paragraphAround', () => {
	it('finds the run of lines the caret line sits in', () => {
		expect(paragraphAround(chapter, 5)).toEqual({ first: 4, last: 6 });
		expect(paragraphAround(chapter, 4)).toEqual({ first: 4, last: 6 });
		expect(paragraphAround(chapter, 6)).toEqual({ first: 4, last: 6 });
	});

	it('stops at the edges of the document', () => {
		expect(paragraphAround(chapter, 1)).toEqual({ first: 1, last: 2 });
		expect(paragraphAround(chapter, 9)).toEqual({ first: 9, last: 9 });
	});

	it('lights nothing from a blank line, however the blank is spelt', () => {
		// A caret between paragraphs is in neither of them.
		expect(paragraphAround(chapter, 3)).toBeNull();
		expect(paragraphAround(chapter, 7)).toBeNull();
		expect(paragraphAround(chapter, 8)).toBeNull();
	});

	it('takes a document with no blank lines whole', () => {
		const solid = source('One line.\nAnother line.\nA third.');
		expect(paragraphAround(solid, 2)).toEqual({ first: 1, last: 3 });
	});

	it('answers nothing for a line the document does not have', () => {
		expect(paragraphAround(chapter, 0)).toBeNull();
		expect(paragraphAround(chapter, 10)).toBeNull();
	});
});

const text = ['First line.', 'Still the first.', '', 'Second paragraph.'].join('\n');

/** The numbers of the lines that wear the caret's mark. */
function lit(view: EditorView): number[] {
	const found: number[] = [];
	view.dom.querySelectorAll('.cm-line').forEach((line, index) => {
		if (line.classList.contains(CARET_PARAGRAPH_CLASS)) found.push(index + 1);
	});
	return found;
}

function editor(extension: Extension, anchor = 0, parent: HTMLElement = document.body.createDiv()): EditorView {
	return new EditorView({
		state: EditorState.create({ doc: text, selection: { anchor }, extensions: [extension] }),
		parent,
	});
}

describe('caretParagraph', () => {
	it('marks the paragraph the caret is in, and follows the caret', () => {
		const view = editor(caretParagraph);
		expect(lit(view)).toEqual([1, 2]);
		view.dispatch({ selection: { anchor: text.length } });
		expect(lit(view)).toEqual([4]);
		// Between paragraphs, in neither of them.
		view.dispatch({ selection: { anchor: text.indexOf('\n\n') + 1 } });
		expect(lit(view)).toEqual([]);
		view.destroy();
	});
});

/**
 * The same mark in an editor of Obsidian's own, worn only while the note in
 * it is one focus mode reaches, and never in a table cell's own editor.
 */
describe('caretParagraphWhen', () => {
	it('marks nothing outside the reach, and asks again when told or when the text changes', () => {
		let reaches = false;
		const view = editor(caretParagraphWhen(() => reaches));
		expect(lit(view)).toEqual([]);
		// The caret moving asks nothing: the note is where it was.
		reaches = true;
		view.dispatch({ selection: { anchor: text.length } });
		expect(lit(view)).toEqual([]);
		view.dispatch({ effects: refreshParagraphLines.of(null) });
		expect(lit(view)).toEqual([4]);
		view.dispatch({ selection: { anchor: 0 } });
		expect(lit(view)).toEqual([1, 2]);
		// Another note in the same editor: the text changes, and the answer.
		reaches = false;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Elsewhere.' } });
		expect(lit(view)).toEqual([]);
		view.destroy();
	});

	it('leaves a table cell’s own editor unmarked', () => {
		const outer = editor(caretParagraphWhen(() => true));
		const cell = editor(caretParagraphWhen(() => true), 0, outer.contentDOM.createDiv());
		expect(lit(outer)).toEqual([1, 2]);
		expect(lit(cell)).toEqual([]);
		// Built away from the document and only then put in the table:
		// unmarked by the first update that finds it there.
		const loose = document.body.createDiv();
		loose.remove();
		const later = editor(caretParagraphWhen(() => true), 0, loose);
		expect(lit(later)).toEqual([1, 2]);
		outer.contentDOM.appendChild(loose);
		later.dispatch({ selection: { anchor: 1 } });
		expect(lit(later)).toEqual([]);
		later.destroy();
		cell.destroy();
		outer.destroy();
	});
});
