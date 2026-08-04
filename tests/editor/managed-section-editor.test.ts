import { EditorState, Transaction } from '@codemirror/state';
import { editorLivePreviewField } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import {
	areManagedBoundariesUnlocked,
	createManagedSectionEditorExtension,
	ManagedSectionFlashTimer,
	setManagedBoundariesUnlockedEffect,
} from '../../src/editor/managed-section-editor';
import { scanManagedBoundaries } from '../../src/editor/managed-section-ranges';
import { renderMarkedSection } from '../../src/templates/markers';

function protectedState(onBlocked = vi.fn()): EditorState {
	return EditorState.create({
		doc: `Before\n${renderMarkedSection('plot-synopsis', 'Editable')}\nAfter`,
		extensions: createManagedSectionEditorExtension({
			isEnabled: () => true,
			isProtectionEnabled: () => true,
			onBoundaryBlocked: onBlocked,
		}),
	});
}

describe('managed section editor transaction protection', () => {
	it('restarts and disposes the one-second section flash timer safely', () => {
		let nextHandle = 0;
		const callbacks = new Map<number, () => void>();
		const cleared: number[] = [];
		const elapsed: number[] = [];
		const timer = new ManagedSectionFlashTimer({
			setTimeout: (callback, delay) => {
				expect(delay).toBe(1_000);
				const handle = ++nextHandle;
				callbacks.set(handle, callback);
				return handle;
			},
			clearTimeout: (handle) => {
				cleared.push(handle);
				callbacks.delete(handle);
			},
		});

		expect(timer.restart((cycle) => elapsed.push(cycle))).toBe(1);
		expect(timer.restart((cycle) => elapsed.push(cycle))).toBe(2);
		expect(cleared).toEqual([1]);
		const secondCallback = callbacks.get(2);
		callbacks.delete(2);
		secondCallback?.();
		expect(elapsed).toEqual([2]);

		expect(timer.restart((cycle) => elapsed.push(cycle))).toBe(3);
		timer.cancel();
		expect(cleared).toEqual([1, 3]);
		expect(callbacks.size).toBe(0);
	});

	it('blocks the whole user transaction when it touches a marker', () => {
		const onBlocked = vi.fn();
		const state = protectedState(onBlocked);
		const boundary = scanManagedBoundaries(state.doc.toString())[0]!;
		const transaction = state.update({
			changes: [
				{ from: 0, insert: 'Safe but part of the same transaction ' },
				{ from: boundary.from, to: boundary.protectedTo },
			],
			annotations: Transaction.userEvent.of('delete'),
		});

		expect(transaction.docChanged).toBe(false);
		expect(transaction.newDoc.toString()).toBe(state.doc.toString());
		expect(onBlocked).toHaveBeenCalledTimes(1);
	});

	it('allows user edits in the body and non-user synchronization changes', () => {
		const state = protectedState();
		const source = state.doc.toString();
		const body = source.indexOf('Editable');
		const marker = scanManagedBoundaries(source)[0]!;

		const typed = state.update({
			changes: { from: body, to: body + 'Editable'.length, insert: 'Revised' },
			annotations: Transaction.userEvent.of('input.type'),
		});
		expect(typed.docChanged).toBe(true);
		expect(typed.newDoc.toString()).toContain('Revised');

		const synchronized = state.update({
			changes: { from: marker.from, to: marker.protectedTo },
		});
		expect(synchronized.docChanged).toBe(true);
	});

	it('temporarily unlocks only the current editor state', () => {
		const locked = protectedState();
		const unlockedTransaction = locked.update({
			effects: setManagedBoundariesUnlockedEffect.of(true),
		});
		const unlocked = unlockedTransaction.state;
		const marker = scanManagedBoundaries(unlocked.doc.toString())[0]!;

		expect(areManagedBoundariesUnlocked(locked)).toBe(false);
		expect(areManagedBoundariesUnlocked(unlocked)).toBe(true);
		expect(
			unlocked.update({
				changes: { from: marker.from, to: marker.protectedTo },
				annotations: Transaction.userEvent.of('delete'),
			}).docChanged,
		).toBe(true);
		expect(areManagedBoundariesUnlocked(protectedState())).toBe(false);
	});

	it('distinguishes Live Preview from Source mode in editor context', () => {
		const observedModes: boolean[] = [];
		const makeState = (livePreview: boolean): EditorState =>
			EditorState.create({
				doc: renderMarkedSection('description', 'Editable'),
				extensions: [
					editorLivePreviewField.init(() => livePreview),
					createManagedSectionEditorExtension({
						isEnabled: (context) => {
							observedModes.push(context.livePreview);
							return true;
						},
					}),
				],
			});

		for (const state of [makeState(false), makeState(true)]) {
			const body = state.doc.toString().indexOf('Editable');
			state.update({
				changes: { from: body, insert: 'A' },
				annotations: Transaction.userEvent.of('input.type'),
			});
		}

		expect(observedModes).toEqual([false, true]);
	});

	it('skips full managed-document checks for an ordinary note', () => {
		const fullCheck = vi.fn(() => true);
		const state = EditorState.create({
			doc: '# Ordinary note\n\nLong prose',
			extensions: createManagedSectionEditorExtension({
				isPotentiallyEnabled: () => false,
				isEnabled: fullCheck,
			}),
		});

		const transaction = state.update({
			changes: { from: state.doc.length, insert: '!' },
			annotations: Transaction.userEvent.of('input.type'),
		});
		expect(transaction.docChanged).toBe(true);
		expect(fullCheck).not.toHaveBeenCalled();
	});
});
