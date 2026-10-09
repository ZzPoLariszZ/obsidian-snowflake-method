import { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { typewriterWhen } from '../../src/editor';

/**
 * Typewriter scrolling for an editor of Obsidian's own: the scroll-to-middle
 * instruction rides every transaction the author made at the keyboard, and
 * no other.
 */
describe('typewriterWhen', () => {
	function state(on: boolean): EditorState {
		return EditorState.create({
			doc: 'one\ntwo\nthree',
			extensions: [typewriterWhen(() => on)],
		});
	}

	/** Whether a transaction carries the instruction, by the target it holds. */
	function centred(transaction: Transaction): boolean {
		return transaction.effects.some(
			(effect) => (effect.value as { y?: string } | null)?.y === 'center',
		);
	}

	it('centres the caret on typing, deleting and keyboard moves', () => {
		const typed = state(true).update({
			changes: { from: 3, insert: '!' },
			selection: { anchor: 4 },
			userEvent: 'input.type',
		});
		expect(centred(typed)).toBe(true);
		const deleted = state(true).update({
			changes: { from: 2, to: 3 },
			userEvent: 'delete.backward',
		});
		expect(centred(deleted)).toBe(true);
		const moved = state(true).update({
			selection: { anchor: 8 },
			userEvent: 'select',
		});
		expect(centred(moved)).toBe(true);
	});

	it('leaves a click, a programmatic move and an editor with the mode off alone', () => {
		const clicked = state(true).update({
			selection: { anchor: 8 },
			userEvent: 'select.pointer',
		});
		expect(centred(clicked)).toBe(false);
		const restored = state(true).update({ selection: { anchor: 8 } });
		expect(centred(restored)).toBe(false);
		const off = state(false).update({
			changes: { from: 3, insert: '!' },
			userEvent: 'input.type',
		});
		expect(centred(off)).toBe(false);
	});
});
