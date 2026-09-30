import { describe, expect, it } from 'vitest';

import type { FreeformStep } from '../../src/domain';
import {
	EMPTY_FREEFORM_HISTORY,
	FREEFORM_HISTORY_DEPTH,
	answerFreeformChange,
	recordFreeformChange,
	takeFreeformRedo,
	takeFreeformUndo,
	type FreeformHistory,
} from '../../src/ui/freeform-history';

const place = (id: string, x: number): FreeformStep[] => [{ do: 'place', places: [{ id, x, y: 0 }] }];
const stepsOf = (stack: readonly { steps: readonly FreeformStep[] }[]): FreeformStep[][] => stack.map((entry) => [...entry.steps]);

describe('the freeform history', () => {
	it('keeps a change to take back, the last made at the end, and forgets what could be made again', () => {
		const first = recordFreeformChange(EMPTY_FREEFORM_HISTORY, place('a', 1), 'change');
		const second = recordFreeformChange(first.history, place('b', 2), 'change');
		expect(stepsOf(second.history.undo)).toEqual([place('a', 1), place('b', 2)]);
		expect(second.history.redo).toEqual([]);
		const undone = takeFreeformUndo(second.history)!;
		const kept = recordFreeformChange(undone.history, place('b', 20), 'undo');
		expect(stepsOf(kept.history.redo)).toEqual([place('b', 20)]);
		// A change made anew leaves nothing to make again.
		const third = recordFreeformChange(kept.history, place('c', 3), 'change');
		expect(stepsOf(third.history.undo)).toEqual([place('a', 1), place('c', 3)]);
		expect(third.history.redo).toEqual([]);
	});

	it('hands the last change back to be taken back, and keeps what takes it back again to be made again', () => {
		const made = recordFreeformChange(EMPTY_FREEFORM_HISTORY, place('a', 1), 'change');
		const undone = takeFreeformUndo(made.history)!;
		expect(undone.entry).toBe(made.entry);
		expect(undone.history).toEqual(EMPTY_FREEFORM_HISTORY);
		const kept = recordFreeformChange(undone.history, place('a', 10), 'undo');
		expect(stepsOf(kept.history.redo)).toEqual([place('a', 10)]);
		expect(kept.history.undo).toEqual([]);
		const redone = takeFreeformRedo(kept.history)!;
		expect(redone.entry).toBe(kept.entry);
		expect(redone.history).toEqual(EMPTY_FREEFORM_HISTORY);
		// Made again, it is kept to be taken back once more, and whatever else could be made again still can.
		const twice = recordFreeformChange(
			{ undo: [], redo: [{ steps: place('z', 9) }] },
			place('a', 1),
			'redo',
		);
		expect(stepsOf(twice.history.undo)).toEqual([place('a', 1)]);
		expect(stepsOf(twice.history.redo)).toEqual([place('z', 9)]);
	});

	it('hands back nothing where nothing is kept', () => {
		expect(takeFreeformUndo(EMPTY_FREEFORM_HISTORY)).toBeNull();
		expect(takeFreeformRedo(EMPTY_FREEFORM_HISTORY)).toBeNull();
	});

	it('keeps nothing of a change that took no step back, nor with no depth to keep it in', () => {
		expect(recordFreeformChange(EMPTY_FREEFORM_HISTORY, [], 'change')).toEqual({ history: EMPTY_FREEFORM_HISTORY, entry: null });
		expect(recordFreeformChange(EMPTY_FREEFORM_HISTORY, place('a', 1), 'change', 0)).toEqual({ history: EMPTY_FREEFORM_HISTORY, entry: null });
	});

	it('lets the oldest go as the depth is reached', () => {
		let history: FreeformHistory = EMPTY_FREEFORM_HISTORY;
		for (let at = 0; at < FREEFORM_HISTORY_DEPTH + 5; at += 1) {
			history = recordFreeformChange(history, place('a', at), 'change').history;
		}
		expect(history.undo).toHaveLength(FREEFORM_HISTORY_DEPTH);
		expect(history.undo[0]!.steps).toEqual(place('a', 5));
		expect(history.undo[FREEFORM_HISTORY_DEPTH - 1]!.steps).toEqual(place('a', FREEFORM_HISTORY_DEPTH + 4));
		let redo: FreeformHistory = EMPTY_FREEFORM_HISTORY;
		for (let at = 0; at < 4; at += 1) redo = recordFreeformChange(redo, place('b', at), 'undo', 3).history;
		expect(stepsOf(redo.redo)).toEqual([place('b', 1), place('b', 2), place('b', 3)]);
	});

	it('puts the file’s own answer in a change’s place, wherever it stands', () => {
		const first = recordFreeformChange(EMPTY_FREEFORM_HISTORY, place('a', 1), 'change');
		const second = recordFreeformChange(first.history, place('b', 2), 'change');
		const answered = answerFreeformChange(second.history, first.entry!, place('a', 100));
		expect(stepsOf(answered.undo)).toEqual([place('a', 100), place('b', 2)]);
		expect(answered.undo[1]).toBe(second.entry);
		const undone = takeFreeformUndo(answered)!;
		const kept = recordFreeformChange(undone.history, place('b', 20), 'undo');
		const redoAnswered = answerFreeformChange(kept.history, kept.entry!, place('b', 200));
		expect(stepsOf(redoAnswered.redo)).toEqual([place('b', 200)]);
	});

	it('forgets a change the file would not take, and one that took no step back after all', () => {
		const first = recordFreeformChange(EMPTY_FREEFORM_HISTORY, place('a', 1), 'change');
		const second = recordFreeformChange(first.history, place('b', 2), 'change');
		expect(stepsOf(answerFreeformChange(second.history, first.entry!, null).undo)).toEqual([place('b', 2)]);
		expect(stepsOf(answerFreeformChange(second.history, second.entry!, []).undo)).toEqual([place('a', 1)]);
	});

	it('answers nothing for a change already taken off its stack, and leaves the stacks as they are', () => {
		const made = recordFreeformChange(EMPTY_FREEFORM_HISTORY, place('a', 1), 'change');
		const undone = takeFreeformUndo(made.history)!;
		expect(answerFreeformChange(undone.history, made.entry!, place('a', 100))).toBe(undone.history);
		expect(answerFreeformChange(undone.history, made.entry!, null)).toBe(undone.history);
	});
});
