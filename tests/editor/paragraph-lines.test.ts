// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

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

	it('keeps the rows of a paragraph that begins with a space flush, against the app’s hang', () => {
		const text = ['Plain line.', '', ' One space.', '', '\u3000\u3000Ideographic.'].join('\n');
		const state = EditorState.create({ doc: text });
		// Obsidian hangs a space-led line's wrapped rows under its first word
		// with a style on the line, made before the plugin's own: stood in for here.
		const hang = EditorView.decorations.of(
			Decoration.set([
				Decoration.line({
					attributes: { style: 'text-indent:-70px;padding-inline-start:70px' },
				}).range(state.doc.line(3).from),
			]),
		);
		const view = new EditorView({
			state: EditorState.create({
				doc: text,
				extensions: [MARKDOWN_LANGUAGE, hang, paragraphLinesWhen(() => true)],
			}),
			parent: document.body.createDiv(),
		});
		const lines = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-line'));
		// The plugin's style comes last, and the last declaration holds.
		expect(lines[2]?.style.getPropertyValue('text-indent')).toMatch(/^0(px)?$/u);
		expect(lines[2]?.style.getPropertyValue('padding-inline-start')).toMatch(/^0(px)?$/u);
		// The app hangs the ideographic spaces a Chinese paragraph opens with
		// too, so that line is kept flush as well; one with no space before it
		// is left without a style of the plugin's.
		expect(lines[4]?.style.getPropertyValue('padding-inline-start')).toMatch(/^0(px)?$/u);
		expect(lines[0]?.getAttribute('style')).toBeNull();
		view.destroy();
	});

	it('puts the rows back flush in the same turn when the app writes a hang onto the line', async () => {
		const text = ['Plain line.', '', ' One space.', '', '- A list item.'].join('\n');
		const view = new EditorView({
			state: EditorState.create({
				doc: text,
				extensions: [MARKDOWN_LANGUAGE, paragraphLinesWhen(() => true)],
			}),
			parent: document.body.createDiv(),
		});
		const lines = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-line'));
		const paragraph = lines[2] as HTMLElement;
		const item = lines[4] as HTMLElement;
		// What Obsidian does once it has measured a hung line: the hang it
		// measured written straight onto the line, past the decorations.
		const hang = 70;
		for (const line of [paragraph, item]) {
			line.style.setProperty('text-indent', `${String(-hang)}px`);
			line.style.setProperty('padding-inline-start', `${String(hang)}px`);
		}
		await Promise.resolve();
		await Promise.resolve();
		// Gone again before the turn is out: nothing left to hang the rows by.
		const nothing = /^(0(px)?)?$/u;
		expect(paragraph.style.getPropertyValue('text-indent')).toMatch(nothing);
		expect(paragraph.style.getPropertyValue('padding-inline-start')).toMatch(nothing);
		// A list item is no paragraph of the page's, and keeps the app's hang.
		expect(item.style.getPropertyValue('padding-inline-start')).toBe('70px');
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
