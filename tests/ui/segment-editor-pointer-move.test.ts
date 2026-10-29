// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { EditorState } from '@codemirror/state';

import { pointerMoved } from '../../src/ui/segment-editor-backend';

const state = EditorState.create({ doc: 'The clockmaker met the baker by the tower.' });

/**
 * The stream follows the author's caret under typewriter scrolling, and
 * must not follow a selection the browser moved on its own, as a finger's
 * handles move it, or the page scrolls under the finger.
 */
describe("a caret move that is not the author's", () => {
	it('is not a key walking the caret, which asks for a scroll', () => {
		expect(
			pointerMoved(state.update({ selection: { anchor: 5 }, userEvent: 'select', scrollIntoView: true })),
		).toBe(false);
		expect(
			pointerMoved(
				state.update({ selection: { anchor: 2, head: 14 }, userEvent: 'select', scrollIntoView: true }),
			),
		).toBe(false);
	});

	it('is not typing or deleting', () => {
		expect(pointerMoved(state.update({ changes: { from: 0, insert: 'A ' }, userEvent: 'input.type' }))).toBe(false);
		expect(pointerMoved(state.update({ changes: { from: 0, to: 4 }, userEvent: 'delete.backward' }))).toBe(false);
	});

	it('is a selection the browser moved and the editor read back', () => {
		expect(pointerMoved(state.update({ selection: { anchor: 4, head: 27 }, userEvent: 'select' }))).toBe(true);
		expect(pointerMoved(state.update({ selection: { anchor: 9 }, userEvent: 'select' }))).toBe(true);
	});

	it("is a pointer's click, and the find bar's replacement", () => {
		expect(pointerMoved(state.update({ selection: { anchor: 3 }, userEvent: 'select.pointer' }))).toBe(true);
		expect(
			pointerMoved(state.update({ changes: { from: 0, to: 3, insert: 'A' }, userEvent: 'input.replace' })),
		).toBe(true);
	});
});
