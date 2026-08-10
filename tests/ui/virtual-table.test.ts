import { describe, expect, it } from 'vitest';

import { rowOffsets, virtualWindow } from '../../src/ui/virtual-table';

const uniform = rowOffsets(new Array<number>(100).fill(40));

describe('row offsets', () => {
	it('runs the heights up into starting positions plus a total', () => {
		expect(rowOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
	});

	it('holds a lone zero for no rows at all', () => {
		expect(rowOffsets([])).toEqual([0]);
	});
});

describe('virtual table window', () => {
	it('opens on the head of the list before any scrolling', () => {
		expect(virtualWindow(0, 400, uniform, 3)).toEqual({
			first: 0,
			count: 14,
			padTop: 0,
			padBottom: 3440,
		});
	});

	it('starts overscan rows above the first row in view', () => {
		expect(virtualWindow(2000, 400, uniform, 3)).toEqual({
			first: 47,
			count: 17,
			padTop: 1880,
			padBottom: 1440,
		});
	});

	it('answers a scroll at the end with the last windowful', () => {
		expect(virtualWindow(3990, 400, uniform, 3)).toEqual({
			first: 87,
			count: 13,
			padTop: 3480,
			padBottom: 0,
		});
	});

	it('shows exactly the rows in view when overscan is zero', () => {
		expect(virtualWindow(80, 400, uniform, 0)).toEqual({
			first: 2,
			count: 11,
			padTop: 80,
			padBottom: 3480,
		});
	});

	it('finds the rows straddling the view when heights vary', () => {
		const offsets = rowOffsets([100, 50, 200, 50, 100]);
		expect(virtualWindow(140, 120, offsets, 0)).toEqual({
			first: 1,
			count: 2,
			padTop: 100,
			padBottom: 150,
		});
	});

	it('pads with the exact heights of the rows left out', () => {
		const offsets = rowOffsets([30, 60, 90, 120, 150]);
		expect(virtualWindow(95, 100, offsets, 0)).toEqual({
			first: 2,
			count: 2,
			padTop: 90,
			padBottom: 150,
		});
	});

	it('shows a short list whole with nothing to pad', () => {
		expect(virtualWindow(0, 400, rowOffsets([40, 40, 40]), 3)).toEqual({
			first: 0,
			count: 3,
			padTop: 0,
			padBottom: 0,
		});
	});

	it('treats an empty list as an empty window', () => {
		expect(virtualWindow(120, 400, rowOffsets([]), 3)).toEqual({
			first: 0,
			count: 0,
			padTop: 0,
			padBottom: 0,
		});
	});

	it('reads a scroll position past either end as the nearest one', () => {
		expect(virtualWindow(-50, 400, uniform, 3).first).toBe(0);
		expect(virtualWindow(999999, 400, uniform, 3).first).toBe(87);
	});
});
