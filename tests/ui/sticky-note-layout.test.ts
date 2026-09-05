import { describe, expect, it } from 'vitest';

import {
	FLOAT_HEAD_REACH,
	batchSchedule,
	clampFloatGeometry,
	defaultFloatGeometry,
	defaultFloatState,
	dragGeometry,
	formatStickyCreated,
	planCardMoves,
	planCardRepaint,
	resizeGeometry,
} from '../../src/ui/sticky-note-layout';

const VIEWPORT = { width: 1000, height: 800 };
const REM = 16;

describe('floating geometry', () => {
	it('keeps a head’s reach of the panel inside the window on every side', () => {
		const far = clampFloatGeometry({ x: -900, y: -50, width: 400, height: 200 }, VIEWPORT, REM);
		expect(far).toEqual({ x: FLOAT_HEAD_REACH - 400, y: 0, width: 400, height: 200 });
		const beyond = clampFloatGeometry({ x: 5000, y: 5000, width: 400, height: 200 }, VIEWPORT, REM);
		expect(beyond).toEqual({ x: 1000 - FLOAT_HEAD_REACH, y: 800 - FLOAT_HEAD_REACH / 2, width: 400, height: 200 });
		const inside = { x: 100, y: 120, width: 400, height: 200 };
		expect(clampFloatGeometry(inside, VIEWPORT, REM)).toEqual(inside);
	});

	it('holds the size between the floor and the window, and reads nonsense as the floor', () => {
		expect(clampFloatGeometry({ x: 0, y: 0, width: 10, height: 5 }, VIEWPORT, REM)).toMatchObject({
			width: 22 * REM,
			height: 8 * REM,
		});
		expect(clampFloatGeometry({ x: 0, y: 0, width: 5000, height: 5000 }, VIEWPORT, REM)).toMatchObject({
			width: 1000,
			height: 800,
		});
		expect(
			clampFloatGeometry(
				{ x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN },
				VIEWPORT,
				REM,
			),
		).toEqual({ x: 0, y: 0, width: 22 * REM, height: 8 * REM });
	});

	it('cascades new panels from the corner and comes round after eight', () => {
		expect(defaultFloatGeometry(VIEWPORT, 0, REM)).toEqual({ x: 24, y: 24, width: 24 * REM, height: 18 * REM });
		expect(defaultFloatGeometry(VIEWPORT, 3, REM)).toMatchObject({ x: 24 + 84, y: 24 + 84 });
		expect(defaultFloatGeometry(VIEWPORT, 8, REM)).toMatchObject({ x: 24, y: 24 });
		expect(defaultFloatState({ x: 1, y: 2, width: 300, height: 200 })).toEqual({
			open: true,
			x: 1,
			y: 2,
			width: 300,
			height: 200,
			locked: false,
			alpha: 100,
			mode: 'viewing',
		});
	});

	it('moves and grows a panel by the pointer’s travel', () => {
		const start = { pointer: { x: 10, y: 10 }, box: { x: 100, y: 100, width: 300, height: 200 } };
		expect(dragGeometry(start, { x: 40, y: 25 })).toEqual({ x: 130, y: 115, width: 300, height: 200 });
		expect(resizeGeometry(start, { x: 40, y: 25 })).toEqual({ x: 100, y: 100, width: 330, height: 215 });
	});

	it('resizes from every edge and corner, holding the opposite side still even at the floor', () => {
		const start = { pointer: { x: 10, y: 10 }, box: { x: 100, y: 100, width: 300, height: 200 } };
		const floor = { width: 120, height: 80 };
		expect(resizeGeometry(start, { x: 40, y: 25 }, 'n', floor)).toEqual({ x: 100, y: 115, width: 300, height: 185 });
		expect(resizeGeometry(start, { x: 40, y: 25 }, 'w', floor)).toEqual({ x: 130, y: 100, width: 270, height: 200 });
		expect(resizeGeometry(start, { x: 40, y: 25 }, 'e', floor)).toEqual({ x: 100, y: 100, width: 330, height: 200 });
		expect(resizeGeometry(start, { x: 40, y: 25 }, 's', floor)).toEqual({ x: 100, y: 100, width: 300, height: 215 });
		expect(resizeGeometry(start, { x: 40, y: 25 }, 'nw', floor)).toEqual({ x: 130, y: 115, width: 270, height: 185 });
		expect(resizeGeometry(start, { x: -40, y: -25 }, 'ne', floor)).toEqual({ x: 100, y: 65, width: 250, height: 235 });
		// Pulled far past the floor from the left: the right edge stays at 400.
		expect(resizeGeometry(start, { x: 900, y: 900 }, 'sw', floor)).toEqual({ x: 280, y: 100, width: 120, height: 1090 });
		expect(resizeGeometry(start, { x: 900, y: 900 }, 'n', floor)).toEqual({ x: 100, y: 220, width: 300, height: 80 });
	});
});

describe('card repaint plan', () => {
	it('takes down the gone, keeps the standing in the new order and makes the new', () => {
		expect(planCardRepaint(['a', 'b', 'c'], ['c', 'd'], [])).toEqual({
			remove: ['a', 'b'],
			keep: ['c'],
			add: ['d'],
			order: ['c', 'd'],
		});
		expect(planCardRepaint(['a'], ['a'], [])).toEqual({ remove: [], keep: ['a'], add: [], order: ['a'] });
	});

	it('keeps a pinned card the filter dropped, out of the order', () => {
		expect(planCardRepaint(['a', 'b', 'c'], ['c', 'd'], ['b'])).toEqual({
			remove: ['a'],
			keep: ['b', 'c'],
			add: ['d'],
			order: ['c', 'd'],
		});
	});
});

describe('card moves', () => {
	it('moves nothing when the order already stands', () => {
		expect(planCardMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
		expect(planCardMoves([], [])).toEqual([]);
	});

	it('moves only the card out of place, before the card it now precedes', () => {
		expect(planCardMoves(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([{ id: 'c', before: 'a' }]);
		expect(planCardMoves(['a', 'b', 'c'], ['a', 'c', 'b'])).toEqual([{ id: 'c', before: 'b' }]);
	});

	it('walks the order greedily, as the boards did by hand', () => {
		expect(planCardMoves(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual([
			{ id: 'b', before: 'a' },
			{ id: 'c', before: 'a' },
		]);
	});

	it('steps over cards the order does not name, and may put a card before one of them', () => {
		// A pinned card at the head, and a lane's tail at the end, keep their places.
		expect(planCardMoves(['pinned', 'a', 'b'], ['b', 'a'])).toEqual([{ id: 'b', before: 'a' }]);
		expect(planCardMoves(['a', 'b', ''], ['b', 'a'])).toEqual([{ id: 'b', before: 'a' }]);
		expect(planCardMoves(['a', 'pinned', 'b'], ['b', 'a'])).toEqual([{ id: 'b', before: 'a' }]);
		expect(planCardMoves(['a', 'b', 'pinned', 'c'], ['a', 'c', 'b'])).toEqual([
			{ id: 'c', before: 'b' },
		]);
	});

	it('skips an id that is not on the surface, and leaves its input alone', () => {
		const present = ['a', 'b'];
		expect(planCardMoves(present, ['c', 'b', 'a'])).toEqual([{ id: 'b', before: 'a' }]);
		expect(present).toEqual(['a', 'b']);
	});
});

describe('batch schedule', () => {
	it('lays the list down a batch a frame and stops when the surface is gone', () => {
		const frames: (() => void)[] = [];
		const drawn: number[] = [];
		let live = true;
		batchSchedule(
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			4,
			(item) => drawn.push(item),
			(callback) => frames.push(callback),
			() => live,
		);
		expect(drawn).toEqual([1, 2, 3, 4]);
		expect(frames).toHaveLength(1);
		frames.shift()?.();
		expect(drawn).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		live = false;
		frames.shift()?.();
		expect(drawn).toHaveLength(8);
		expect(frames).toHaveLength(0);
	});

	it('stops after a cancel and draws nothing for an empty list', () => {
		const frames: (() => void)[] = [];
		const drawn: number[] = [];
		const cancel = batchSchedule([1, 2, 3], 2, (item) => drawn.push(item), (cb) => frames.push(cb), () => true);
		cancel();
		frames.shift()?.();
		expect(drawn).toEqual([1, 2]);
		expect(batchSchedule([], 2, () => undefined, () => undefined, () => true)).toBeTypeOf('function');
	});
});

describe('created label', () => {
	it('formats the moment in the locale and zone given, and says nothing for junk', () => {
		const instant = Date.UTC(2026, 8, 4, 5, 14, 32, 123);
		const label = formatStickyCreated(instant, 'en', 'UTC');
		expect(label.full).toContain('2026');
		expect(label.short).toBe('2026-09-04 05:14:32');
		expect(formatStickyCreated(instant, 'zh-CN', 'UTC').short).toBe('2026-09-04 05:14:32');
		expect(formatStickyCreated(instant, 'zh-CN', 'UTC').full).toContain('2026');
		expect(formatStickyCreated(Number.NaN, 'en', 'UTC')).toEqual({ short: '', full: '' });
	});
});
