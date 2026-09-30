/**
 * What was done to a freeform view, kept so it can be taken back: two
 * stacks per view, one of changes to undo and one of changes to redo, each
 * entry the steps that take a change back as the file worked them out. The
 * stacks are the tab's own and go with it; nothing here is written. Pure,
 * so every rule of it is read without a canvas.
 */

import type { FreeformStep } from '../domain';

/** How many changes a view keeps to take back; the oldest goes as the next comes. */
export const FREEFORM_HISTORY_DEPTH = 100;

/** One change as it can be taken back, or made again: the steps that do so. */
export interface FreeformHistoryEntry {
	readonly steps: readonly FreeformStep[];
}

export interface FreeformHistory {
	/** The changes to take back, the last made at the end. */
	readonly undo: readonly FreeformHistoryEntry[];
	/** The changes taken back that can be made again, the last taken back at the end. */
	readonly redo: readonly FreeformHistoryEntry[];
}

export const EMPTY_FREEFORM_HISTORY: FreeformHistory = { undo: [], redo: [] };

/**
 * What a write is: a change, which is kept to be taken back and forgets
 * what could be made again; a change taken back, kept to be made again; or
 * one made again, kept to be taken back once more, with the rest still to
 * be made again.
 */
export type FreeformHistoryTurn = 'change' | 'undo' | 'redo';

const kept = (stack: readonly FreeformHistoryEntry[], entry: FreeformHistoryEntry, depth: number): FreeformHistoryEntry[] =>
	[...stack, entry].slice(Math.max(0, stack.length + 1 - depth));

/**
 * A change made, kept by the steps that take it back. The entry is handed
 * back so the write's own answer can be put in its place once it lands. A
 * change that took no step back is nothing to keep, and leaves the stacks
 * as they were.
 */
export function recordFreeformChange(
	history: FreeformHistory,
	inverse: readonly FreeformStep[],
	turn: FreeformHistoryTurn,
	depth = FREEFORM_HISTORY_DEPTH,
): { history: FreeformHistory; entry: FreeformHistoryEntry | null } {
	if (inverse.length === 0 || depth <= 0) return { history, entry: null };
	const entry: FreeformHistoryEntry = { steps: inverse };
	switch (turn) {
		case 'change':
			return { history: { undo: kept(history.undo, entry, depth), redo: [] }, entry };
		case 'undo':
			return { history: { undo: history.undo, redo: kept(history.redo, entry, depth) }, entry };
		case 'redo':
			return { history: { undo: kept(history.undo, entry, depth), redo: history.redo }, entry };
	}
}

/**
 * The file's own answer to a change kept: the steps that take it back as
 * the file worked them out, which stand in the entry's place; or nothing,
 * for a change the file would not take, which is forgotten. An entry
 * already taken off its stack is no longer anywhere to answer.
 */
export function answerFreeformChange(
	history: FreeformHistory,
	entry: FreeformHistoryEntry,
	inverse: readonly FreeformStep[] | null,
): FreeformHistory {
	const answer = (stack: readonly FreeformHistoryEntry[]): readonly FreeformHistoryEntry[] => {
		const at = stack.indexOf(entry);
		if (at === -1) return stack;
		if (inverse === null || inverse.length === 0) return [...stack.slice(0, at), ...stack.slice(at + 1)];
		return [...stack.slice(0, at), { steps: inverse }, ...stack.slice(at + 1)];
	};
	const undo = answer(history.undo);
	const redo = answer(history.redo);
	return undo === history.undo && redo === history.redo ? history : { undo, redo };
}

/** The last change made, taken off the stack to be taken back; null where none is kept. */
export function takeFreeformUndo(history: FreeformHistory): { history: FreeformHistory; entry: FreeformHistoryEntry } | null {
	const entry = history.undo[history.undo.length - 1];
	if (entry === undefined) return null;
	return { history: { undo: history.undo.slice(0, -1), redo: history.redo }, entry };
}

/** The last change taken back, taken off the stack to be made again; null where none is kept. */
export function takeFreeformRedo(history: FreeformHistory): { history: FreeformHistory; entry: FreeformHistoryEntry } | null {
	const entry = history.redo[history.redo.length - 1];
	if (entry === undefined) return null;
	return { history: { undo: history.undo, redo: history.redo.slice(0, -1) }, entry };
}
