// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
	MARKDOWN_LANGUAGE,
	PARAGRAPH_LINE_CLASSES,
	paragraphLines,
	paragraphLinesWhen,
	refreshParagraphLines,
} from '../../src/editor';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

const doc = ['# Title', '', 'First paragraph.', '', 'Second paragraph.'].join('\n');

/** The classes each line of the editor wears, by line number. */
function marks(view: EditorView): Record<number, string[]> {
	const found: Record<number, string[]> = {};
	view.dom.querySelectorAll('.cm-line').forEach((line, index) => {
		const own = Array.from(line.classList).filter((cls) => cls.startsWith('snowflake-method-'));
		if (own.length > 0) found[index + 1] = own.sort();
	});
	return found;
}

function editor(...extensions: Extension[]): EditorView {
	const parent = document.body.createDiv();
	return new EditorView({
		state: EditorState.create({ doc, extensions: [MARKDOWN_LANGUAGE, ...extensions] }),
		parent,
	});
}

describe('paragraphLines', () => {
	it('marks the paragraph lines and the gaps of the whole note', () => {
		const view = editor(paragraphLines);
		expect(marks(view)).toEqual({
			2: [PARAGRAPH_LINE_CLASSES.blank],
			3: [PARAGRAPH_LINE_CLASSES.first, PARAGRAPH_LINE_CLASSES.line],
			4: [PARAGRAPH_LINE_CLASSES.blank],
			5: [PARAGRAPH_LINE_CLASSES.first, PARAGRAPH_LINE_CLASSES.line],
		});
		view.destroy();
	});
});

describe('paragraphLinesWhen', () => {
	it('marks nothing while the note is outside the scope, and everything once asked again', () => {
		let dressed = false;
		const view = editor(paragraphLinesWhen(() => dressed));
		expect(marks(view)).toEqual({});

		dressed = true;
		// Nothing has asked yet: the editor goes on as it was.
		view.dispatch({ changes: { from: doc.length, insert: '!' } });
		expect(marks(view)).not.toEqual({});
		view.destroy();
	});

	it('takes the marks off on the refresh effect when the note has left the scope', () => {
		let dressed = true;
		const view = editor(paragraphLinesWhen(() => dressed));
		expect(Object.keys(marks(view))).toHaveLength(4);

		dressed = false;
		view.dispatch({ effects: refreshParagraphLines.of(null) });
		expect(marks(view)).toEqual({});

		dressed = true;
		view.dispatch({ effects: refreshParagraphLines.of(null) });
		expect(Object.keys(marks(view))).toHaveLength(4);
		view.destroy();
	});
});
