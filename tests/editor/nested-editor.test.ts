// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
	PARAGRAPH_LINE_CLASSES,
	isNestedEditor,
	paragraphBreakWhen,
	paragraphLinesWhen,
} from '../../src/editor';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

/**
 * An editor the app nests in a note's own, as it does for a table's cells:
 * told by the box above it, and left undressed by the line marks and the
 * paragraph break, whether its box was in the document when it was built
 * or put there afterwards.
 */
describe('isNestedEditor', () => {
	const marks = (view: EditorView): number =>
		view.dom.querySelectorAll(`.${PARAGRAPH_LINE_CLASSES.first}`).length;

	it('tells a nested editor from the one it stands in', () => {
		const outer = new EditorView({
			state: EditorState.create({ doc: 'outer' }),
			parent: document.body.createDiv(),
		});
		const cell = outer.contentDOM.createDiv();
		const inner = new EditorView({ state: EditorState.create({ doc: 'inner' }), parent: cell });
		expect(isNestedEditor(outer)).toBe(false);
		expect(isNestedEditor(inner)).toBe(true);
		inner.destroy();
		outer.destroy();
	});

	it('leaves a nested editor unmarked, built in place or put in place later', () => {
		const outer = new EditorView({
			state: EditorState.create({ doc: 'outer' }),
			parent: document.body.createDiv(),
		});
		const cell = outer.contentDOM.createDiv();
		const inPlace = new EditorView({
			state: EditorState.create({ doc: 'cell', extensions: [paragraphLinesWhen(() => true)] }),
			parent: cell,
		});
		expect(marks(inPlace)).toBe(0);

		// Built away from the document, as the app builds a cell's editor,
		// and only then put into the table: marked at first, for want of
		// a box above it, and unmarked by the first update that finds it.
		const loose = document.body.createDiv();
		loose.remove();
		const later = new EditorView({
			state: EditorState.create({ doc: 'cell', extensions: [paragraphLinesWhen(() => true)] }),
			parent: loose,
		});
		expect(marks(later)).toBe(1);
		outer.contentDOM.appendChild(loose);
		later.dispatch({ selection: { anchor: 1 } });
		expect(marks(later)).toBe(0);
		later.dispatch({ changes: { from: 0, insert: 'x' } });
		expect(marks(later)).toBe(0);

		// The leaf's own editor, built away and put in place the same way,
		// is dressed as before.
		const box = document.body.createDiv();
		box.remove();
		const main = new EditorView({
			state: EditorState.create({ doc: 'prose', extensions: [paragraphLinesWhen(() => true)] }),
			parent: box,
		});
		document.body.appendChild(box);
		main.dispatch({ selection: { anchor: 1 } });
		expect(marks(main)).toBe(1);
		inPlace.destroy();
		later.destroy();
		main.destroy();
		outer.destroy();
	});

	it('declines the paragraph break in a nested editor, and puts it in the one above', () => {
		const press = (view: EditorView): boolean =>
			runScopeHandlers(
				view,
				new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }),
				'editor',
			);
		const outer = new EditorView({
			state: EditorState.create({
				doc: 'prose',
				selection: { anchor: 5 },
				extensions: [paragraphBreakWhen(() => true)],
			}),
			parent: document.body.createDiv(),
		});
		const inner = new EditorView({
			state: EditorState.create({
				doc: 'cell',
				selection: { anchor: 4 },
				extensions: [paragraphBreakWhen(() => true)],
			}),
			parent: outer.contentDOM.createDiv(),
		});
		expect(press(inner)).toBe(false);
		expect(inner.state.doc.toString()).toBe('cell');
		expect(press(outer)).toBe(true);
		expect(outer.state.doc.toString()).toBe('prose\n\n');
		inner.destroy();
		outer.destroy();
	});
});
