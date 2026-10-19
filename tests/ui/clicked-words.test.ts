import { describe, expect, it } from 'vitest';

import { clickedSide, rowTopOf } from '../../src/ui/clicked-words';

/** A glyph's box on a row that starts at `top`. */
const row = (top: number): { top: number; bottom: number } => ({
	top,
	bottom: top + 30,
});

describe('clickedSide', () => {
	it('is the character before at the end of a text node', () => {
		// Past a paragraph's last letter: nothing after it in its node.
		expect(clickedSide(8, 8, '', row(100), null, 115)).toBe(-1);
	});

	it('is the character after at the start of one', () => {
		// In the gap below a paragraph, the browser answers with the first
		// letter of the next one.
		expect(clickedSide(0, 8, 'T', null, row(200), 160)).toBe(1);
	});

	it('is the character before when the pointer stood on the row above', () => {
		// "beta |gamma" wrapped after the space: the pointer at the end of
		// beta's row, gamma a row below.
		expect(clickedSide(6, 12, 'g', row(100), row(156), 115)).toBe(-1);
		// In the leading just above gamma's row: still gamma's.
		expect(clickedSide(6, 12, 'g', row(100), row(156), 150)).toBe(1);
	});

	it('is the character before at the end of a word', () => {
		expect(clickedSide(5, 11, ' ', row(100), row(100), 115)).toBe(-1);
	});

	it('is the character after inside a word', () => {
		expect(clickedSide(2, 11, 'p', row(100), row(100), 115)).toBe(1);
	});
});

describe('rowTopOf', () => {
	it('prefers the row under the pointer, the side of the click first', () => {
		expect(rowTopOf(row(100), row(156), -1, 115)).toBe(100);
		expect(rowTopOf(row(100), row(156), 1, 170)).toBe(156);
	});

	it('takes the side of the click when neither row holds the pointer', () => {
		// The gap below a paragraph, answered with the next one's first letter.
		expect(rowTopOf(null, row(300), 1, 250)).toBe(300);
		expect(rowTopOf(row(100), row(156), 1, 140)).toBe(156);
		expect(rowTopOf(row(100), row(156), -1, 140)).toBe(100);
	});

	it('answers null with nothing to measure', () => {
		expect(rowTopOf(null, null, -1, 10)).toBeNull();
	});
});
