import { describe, expect, it } from 'vitest';

import { RenderStateKeeper, scrollOffsetRevealing } from '../../src/ui/render-state';

describe('revealing an item below a sticky heading', () => {
	it.each([
		{ itemTop: 120, expected: 56 },
		{ itemTop: 150, expected: 80 },
	])('reveals a row at $itemTop without unnecessary scrolling', ({ itemTop, expected }) => {
		const item = { getBoundingClientRect: () => ({ top: itemTop, bottom: itemTop + 46 }) };
		const scroller = {
			scrollTop: 80,
			querySelector: () => item,
			getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
		};
		const root = {
			matches: () => false,
			querySelector: () => scroller,
		} as unknown as HTMLElement;
		const keeper = new RenderStateKeeper(['.rail']);

		keeper.reveal(root, '.rail', '.active', 44);

		expect(scroller.scrollTop).toBe(expected);
		scroller.scrollTop = 0;
		keeper.restore(root);
		expect(scroller.scrollTop).toBe(expected);
	});
});

describe('scroll offset revealing an item', () => {
	const viewport = { viewportStart: 100, viewportEnd: 300 };

	it('leaves a fully visible item alone', () => {
		expect(
			scrollOffsetRevealing({
				...viewport,
				scrollTop: 80,
				itemStart: 150,
				itemEnd: 190,
			}),
		).toBe(80);
	});

	it('scrolls up by exactly the amount hidden above the viewport', () => {
		expect(
			scrollOffsetRevealing({
				...viewport,
				scrollTop: 80,
				itemStart: 70,
				itemEnd: 110,
			}),
		).toBe(50);
	});

	it('scrolls down by exactly the amount hidden below the viewport', () => {
		expect(
			scrollOffsetRevealing({
				...viewport,
				scrollTop: 80,
				itemStart: 280,
				itemEnd: 320,
			}),
		).toBe(100);
	});

	it('aligns an item taller than the viewport to its top edge', () => {
		expect(
			scrollOffsetRevealing({
				...viewport,
				scrollTop: 80,
				itemStart: 60,
				itemEnd: 400,
			}),
		).toBe(40);
	});

	it('leaves an item flush with both edges alone', () => {
		expect(
			scrollOffsetRevealing({
				...viewport,
				scrollTop: 80,
				itemStart: 100,
				itemEnd: 300,
			}),
		).toBe(80);
	});
});
