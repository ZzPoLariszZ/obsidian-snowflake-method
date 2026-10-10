import { describe, expect, it } from 'vitest';

import { buildTableFrame, rowOffsets, virtualWindow } from '../../src/ui/virtual-table';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

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

describe('table frame', () => {
	/**
	 * A frame in a window whose stylesheet gives the table the floor named,
	 * and the body the padding the gutter leaves it. The frame is as wide as
	 * the fake window, which the test moves.
	 */
	const framed = (floor: string, width: number) => {
		const dom = new CorkboardDom();
		(dom.win as unknown as { getComputedStyle: (element: CorkboardElement) => unknown }).getComputedStyle = (element) => ({
			fontSize: '16px',
			paddingLeft: '0px',
			paddingRight: '12px',
			getPropertyValue: (name: string): string =>
				name === '--snowflake-method-table-floor' && element.classList.contains('snowflake-method-table') ? floor : '',
		});
		dom.width = width;
		const frame = buildTableFrame(dom.container as unknown as HTMLElement, {
			tableCls: 'snowflake-method-character-table',
			columns: ['order', 'name'],
			headers: ['#', 'Name'],
		});
		return { dom, stacked: () => frame.wrap.classList.contains('is-stacked') };
	};

	it('lays its table out as cards while the frame is narrower than the table\u2019s floor', () => {
		// 52rem is 832 pixels; the body keeps 12 of its width for the gutter.
		const { dom, stacked } = framed('52rem', 840);
		expect(stacked()).toBe(true);
		dom.resize(844);
		expect(stacked()).toBe(false);
		dom.resize(843);
		expect(stacked()).toBe(true);
	});

	it('reads a floor in pixels as well as in rem', () => {
		const { dom, stacked } = framed('600px', 700);
		expect(stacked()).toBe(false);
		dom.resize(611);
		expect(stacked()).toBe(true);
	});

	it('leaves a table the stylesheet gives no floor as a table', () => {
		const { dom, stacked } = framed('', 100);
		expect(stacked()).toBe(false);
		dom.resize(10);
		expect(stacked()).toBe(false);
	});
});
