import { describe, expect, it } from 'vitest';
import { holdInPlace } from '../../src/ui/hold-in-place';

/** An element whose top the repaint moves, as a row under a growing inspector. */
function anchorAt(tops: number[]): { getBoundingClientRect(): { top: number } } {
	let reads = 0;
	return {
		getBoundingClientRect: () => ({ top: tops[Math.min(reads++, tops.length - 1)] ?? 0 }),
	};
}

describe('holdInPlace', () => {
	it('scrolls by what the repaint moved the anchor, so it stays put', () => {
		const scroller = { scrollTop: 104 };
		let painted = 0;
		holdInPlace(anchorAt([412, 649]), scroller, () => {
			painted += 1;
		});
		expect(painted).toBe(1);
		expect(scroller.scrollTop).toBe(104 + 237);
	});

	it('scrolls back up when what stood above the anchor shrank', () => {
		const scroller = { scrollTop: 400 };
		holdInPlace(anchorAt([600, 500]), scroller, () => undefined);
		expect(scroller.scrollTop).toBe(300);
	});

	it('leaves the scroller alone when the anchor did not move', () => {
		const scroller = { scrollTop: 104 };
		holdInPlace(anchorAt([412, 412]), scroller, () => undefined);
		expect(scroller.scrollTop).toBe(104);
	});

	it('follows an anchor whose element the repaint makes anew', () => {
		// A folder row's tap also rebuilds the tree, which took the focused
		// row out while the tree stood empty and let the page clamp its
		// scroll to the shorter content: the new row is found where it is.
		let current = anchorAt([412]);
		const scroller = { scrollTop: 104 };
		holdInPlace(
			{ getBoundingClientRect: () => current.getBoundingClientRect() },
			scroller,
			() => {
				current = anchorAt([504]);
				scroller.scrollTop = 249;
			},
		);
		expect(scroller.scrollTop).toBe(249 + 92);
	});

	it('still repaints with no anchor or no scroller to hold', () => {
		let painted = 0;
		holdInPlace(undefined, { scrollTop: 0 }, () => {
			painted += 1;
		});
		holdInPlace(anchorAt([1, 2]), null, () => {
			painted += 1;
		});
		expect(painted).toBe(2);
	});
});
