// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Platform } from 'obsidian';

import { drawnCaret } from '../../src/ui/segment-editor-backend';

const mount = (): EditorView =>
	new EditorView({
		state: EditorState.create({ doc: 'a line of words', extensions: drawnCaret() }),
		parent: document.body,
	});

/**
 * WebKit draws the browser's caret on a wrapped line from the previous
 * line's bottom, so under the stream's line height it stands high in the
 * gap above the words; Chromium draws it on the glyph box.
 */
describe('the caret the stream draws', () => {
	afterEach(() => {
		Platform.isIosApp = false;
	});

	it('is the editor’s own where the app is WebKit’s, measured on the glyph box', () => {
		Platform.isIosApp = true;
		const view = mount();
		expect(view.dom.querySelector('.cm-cursorLayer')).not.toBeNull();
		view.destroy();
	});

	it('is left to the browser elsewhere, where its own stands on the glyph box', () => {
		const view = mount();
		expect(view.dom.querySelector('.cm-cursorLayer')).toBeNull();
		view.destroy();
	});
});
