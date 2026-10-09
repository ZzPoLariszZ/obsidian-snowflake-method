// @vitest-environment happy-dom

import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { runEditorCommand } from '../../src/editor';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

/**
 * The commands a formatting bar runs, on a bare editor such as the one
 * Obsidian shows a note in: the same transaction the stream's bar makes.
 */
describe('runEditorCommand', () => {
	function editor(doc: string, from: number, to = from): EditorView {
		return new EditorView({
			state: EditorState.create({
				doc,
				selection: { anchor: from, head: to },
				extensions: [history()],
			}),
			parent: document.body.createDiv(),
		});
	}

	it('wraps a selection, sets a heading and undoes both', () => {
		const view = editor('a word here', 2, 6);
		expect(runEditorCommand(view, 'bold')).toBe(true);
		expect(view.state.doc.toString()).toBe('a **word** here');
		expect(runEditorCommand(view, 'heading-2')).toBe(true);
		expect(view.state.doc.toString()).toBe('## a **word** here');
		expect(runEditorCommand(view, 'undo')).toBe(true);
		expect(view.state.doc.toString()).toBe('a **word** here');
		expect(runEditorCommand(view, 'redo')).toBe(true);
		expect(view.state.doc.toString()).toBe('## a **word** here');
		view.destroy();
	});

	it('declines on a read-only editor, and when there is nothing to undo', () => {
		const sealed = new EditorView({
			state: EditorState.create({
				doc: 'text',
				extensions: [EditorState.readOnly.of(true), history()],
			}),
			parent: document.body.createDiv(),
		});
		expect(runEditorCommand(sealed, 'italic')).toBe(false);
		expect(runEditorCommand(sealed, 'undo')).toBe(false);
		sealed.destroy();
	});
});
