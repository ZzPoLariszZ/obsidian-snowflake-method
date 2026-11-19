import { describe, expect, it, vi } from 'vitest';

import {
	actionsWidth,
	buildTableFrame,
	rowOffsets,
	scrollerOf,
	VirtualTable,
	virtualWindow,
} from '../../src/ui/virtual-table';
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

	/**
	 * A frame draws a border round a table and none round its cards, so the
	 * body is two pixels wider stacked. The room is read inside the border
	 * either way, or a frame just over the floor would stack, read itself
	 * wider, and lay the table out again a pixel past its edge.
	 */
	it('reads the room inside the frame’s border whether it is stacked or not', () => {
		const dom = new CorkboardDom();
		(dom.win as unknown as { getComputedStyle: (element: CorkboardElement) => unknown }).getComputedStyle = (element) => ({
			fontSize: '16px',
			paddingLeft: '0px',
			paddingRight: '0px',
			borderLeftWidth: element.classList.contains('snowflake-method-table-wrap') ? '1px' : '0px',
			borderRightWidth: element.classList.contains('snowflake-method-table-wrap') ? '1px' : '0px',
			getPropertyValue: (name: string): string =>
				name === '--snowflake-method-table-floor' && element.classList.contains('snowflake-method-table') ? '640px' : '',
		});
		const frame = buildTableFrame(dom.container as unknown as HTMLElement, {
			tableCls: 'snowflake-method-character-table',
			columns: ['order', 'name'],
			headers: ['#', 'Name'],
		});
		const stacked = (): boolean => frame.wrap.classList.contains('is-stacked');
		// The body fills the frame inside its border, which stacking takes off.
		Object.defineProperty(frame.bodyWrap, 'clientWidth', {
			get: () => dom.width - (stacked() ? 0 : 2),
		});
		dom.resize(641);
		expect(stacked()).toBe(true);
		// The frame heard again at the same size, as it is when first laid out.
		dom.resize(641);
		expect(stacked()).toBe(true);
		dom.resize(642);
		expect(stacked()).toBe(false);
		dom.resize(642);
		expect(stacked()).toBe(false);
	});

	it('watches its rows from the window a moved table stands in', () => {
		const dom = new CorkboardDom();
		const frame = buildTableFrame(dom.container as unknown as HTMLElement, {
			tableCls: 'snowflake-method-character-table',
			columns: ['order', 'name'],
			headers: ['#', 'Name'],
		});
		const table = new VirtualTable({
			scroller: frame.bodyWrap,
			body: frame.body,
			columns: 2,
			estimatedRowHeight: 30,
			overscan: 2,
			rowKey: (index) => String(index),
			heights: new Map(),
			renderRow: (body, index) => {
				body.createEl('tr').createEl('td', { text: String(index) });
			},
			renderTail: () => undefined,
			onScroll: () => undefined,
			onMeasure: () => undefined,
		});
		const refresh = vi.spyOn(table, 'refresh');
		const popout = new CorkboardDom();
		(frame.wrap as unknown as CorkboardElement).migrateTo(popout);
		popout.resize(700);
		expect(refresh).toHaveBeenCalled();
		table.destroy();
		refresh.mockClear();
		popout.resize(600);
		expect(refresh).not.toHaveBeenCalled();
	});
});

/**
 * The actions column takes what its first row's buttons need, in every
 * language, so they stand the cell's padding from either edge: narrower than
 * the stylesheet's width for the English pair, wider for a longer language's,
 * with the floor grown by what it takes past that width. The need is the
 * buttons' own widths, the gaps between them and the cell's padding, never
 * the group's width, which fills its cell and in a card lets them wrap.
 */
describe('the actions column of a frame', () => {
	/**
	 * A frame as wide as the fake window, in a stylesheet that gives the
	 * table a floor of 52rem and its actions column 11rem, the buttons' group
	 * a gap of four and the cell twelve of padding on either side. What the
	 * frame writes on a table wins over the stylesheet, as an inline style does.
	 */
	const fitting = (width: number) => {
		const dom = new CorkboardDom();
		const sheet: Record<string, string> = {
			'--snowflake-method-table-floor': '52rem',
			'--snowflake-method-table-actions-width': '11rem',
		};
		(dom.win as unknown as { getComputedStyle: (element: CorkboardElement) => unknown }).getComputedStyle = (element) => ({
			fontSize: '16px',
			paddingLeft: '0px',
			paddingRight: '0px',
			paddingInlineStart: '12px',
			paddingInlineEnd: '12px',
			columnGap: '4px',
			getPropertyValue: (name: string): string =>
				element.classList.contains('snowflake-method-table') ? (element.styles[name] ?? sheet[name] ?? '') : '',
		});
		dom.width = width;
		const frame = buildTableFrame(dom.container as unknown as HTMLElement, {
			tableCls: 'snowflake-method-character-table has-actions-column',
			columns: ['order', 'name', 'actions'],
			headers: ['#', 'Name', 'Actions'],
		});
		const body = frame.body as unknown as CorkboardElement;
		/** A row whose last cell holds buttons of the widths given, nothing being a button not laid out. */
		const row = (...widths: number[]): CorkboardElement => {
			const group = body
				.createEl('tr')
				.createEl('td')
				.createDiv({ cls: 'snowflake-method-table-actions' });
			for (const each of widths) lay(group.createEl('button'), each);
			return group;
		};
		/** What the frame wrote on the header's table and the body's. */
		const written = (): Record<string, string>[] =>
			[frame.headTable, body.parentElement].map((table) => ({ ...(table as unknown as CorkboardElement).styles }));
		const stacked = (): boolean => frame.wrap.classList.contains('is-stacked');
		return { dom, frame, row, written, stacked };
	};
	/** A box as wide as given, as the layout reads it; nothing being one not laid out. */
	const lay = (element: CorkboardElement, width: number): void => {
		element.box = { left: 0, width };
	};
	/** French: Modifier's split button, its 66 and the chevron's 32, beside Supprimer's 79. */
	const FRENCH = [98, 79] as const;

	it('measures a row’s buttons by their own widths, the gaps between them and the cell’s padding', () => {
		const { row } = fitting(1000);
		const group = row(...FRENCH);
		// The group fills the cell's 152, which is the room it has, not the room it needs.
		lay(group, 152);
		expect(actionsWidth(group as unknown as HTMLElement)).toBe(98 + 4 + 79 + 24);
		// A third button brings its own gap.
		expect(actionsWidth(row(98, 79, 40) as unknown as HTMLElement)).toBe(98 + 4 + 79 + 4 + 40 + 24);
		// The fractions a layout keeps are kept: a rounded sum moved the last button off its padding.
		expect(actionsWidth(row(85.296875, 78.90625) as unknown as HTMLElement)).toBe(85.296875 + 4 + 78.90625 + 24);
	});

	it('measures nothing for a row not laid out, or one with no buttons', () => {
		const { row } = fitting(1000);
		expect(actionsWidth(row(98, 0) as unknown as HTMLElement)).toBe(0);
		expect(actionsWidth(row() as unknown as HTMLElement)).toBe(0);
	});

	it('narrows the column to the English buttons, and leaves the floor', () => {
		// 52rem is 832 pixels: a frame of 840 holds the table, and still does.
		const { frame, row, written, stacked } = fitting(840);
		// Edit's split button and Delete at their least widths: 168 of the 176.
		row(76, 64);
		frame.fitActions();
		const fitted = { '--snowflake-method-table-actions-width': '168px' };
		expect(written()).toEqual([fitted, fitted]);
		expect(stacked()).toBe(false);
	});

	it('writes nothing for buttons that need the stylesheet’s width exactly', () => {
		const { frame, row, written } = fitting(840);
		row(76, 72);
		frame.fitActions();
		expect(written()).toEqual([{}, {}]);
	});

	it('rounds a fractional need up to the layout’s next sixty-fourth, never down', () => {
		const { frame, row, written } = fitting(1000);
		// Ouvrir's split button and Supprimer as the French desktop lays them: 192.2 in all.
		row(85.3, 78.9);
		frame.fitActions();
		expect(written()[1]?.['--snowflake-method-table-actions-width']).toBe(`${String(12301 / 64)}px`);
		expect(written()[1]?.['--snowflake-method-table-floor']).toBe(`${String(832 + 12301 / 64 - 176)}px`);
	});

	it('widens the column to a longer language’s first row, and the floor by as much, and settles again', () => {
		// 52rem is 832 pixels: a frame of 850 holds the table until French asks 29 more.
		const { frame, row, written, stacked } = fitting(850);
		expect(stacked()).toBe(false);
		row(...FRENCH);
		frame.fitActions();
		const grown = {
			'--snowflake-method-table-actions-width': '205px',
			'--snowflake-method-table-floor': '861px',
		};
		expect(written()).toEqual([grown, grown]);
		expect(stacked()).toBe(true);
		// The first row drawn decides: the rows after it say the same words.
		row(120, 90);
		frame.fitActions();
		expect(written()).toEqual([grown, grown]);
	});

	it('fits to the first row laid out, past one a search has hidden', () => {
		const { frame, row, written } = fitting(1000);
		// The first row is hidden, so its buttons measure nothing; the next shows.
		row(0, 0);
		row(...FRENCH);
		frame.fitActions();
		expect(written()[1]?.['--snowflake-method-table-actions-width']).toBe('205px');
		expect(written()[1]?.['--snowflake-method-table-floor']).toBe('861px');
	});

	it('tries again when a row drawn in a hidden frame comes to be laid out', () => {
		const { dom, frame, row, written, stacked } = fitting(850);
		const group = row(0, 0);
		frame.fitActions();
		expect(written()).toEqual([{}, {}]);
		// The frame is shown: its buttons have widths, and it hears its size.
		group.children.forEach((button, at) => {
			lay(button, FRENCH[at] ?? 0);
		});
		dom.resize(850);
		expect(written()[1]?.['--snowflake-method-table-floor']).toBe('861px');
		expect(stacked()).toBe(true);
	});

	it('fits no frame its caller has not asked to', () => {
		const { dom, row, written, stacked } = fitting(850);
		row(...FRENCH);
		dom.resize(850);
		expect(written()).toEqual([{}, {}]);
		expect(stacked()).toBe(false);
	});
});

/**
 * A phone's dashboard scrolls as one page, and a table's frame stands
 * somewhere down it: the window is read from the page's scroll and the
 * frame's place in it, and the page's listener is let go with the frame.
 */
describe('a table windowed by the page it stands down', () => {
	/** A page 400 high with a frame 300 below its top, holding rows of 40 where none is measured yet. */
	const paged = () => {
		const dom = new CorkboardDom();
		dom.resize(600, 400);
		const page = dom.container;
		const frame = buildTableFrame(page as unknown as HTMLElement, {
			tableCls: 'snowflake-method-character-table',
			columns: ['order', 'name'],
			headers: ['#', 'Name'],
		});
		Object.defineProperty(page, 'clientTop', { get: () => 0 });
		Object.defineProperty(page, 'getBoundingClientRect', { value: () => ({ top: 0, height: 400 }) });
		Object.defineProperty(frame.bodyWrap, 'getBoundingClientRect', {
			value: () => ({ top: 300 - page.scrollTop, height: 4000 }),
		});
		const onScroll = vi.fn();
		const table = new VirtualTable({
			scroller: page as unknown as HTMLElement,
			frame: frame.bodyWrap,
			body: frame.body,
			columns: 2,
			estimatedRowHeight: 40,
			overscan: 0,
			rowKey: (index) => String(index),
			heights: new Map(),
			renderRow: (body, index) => {
				body.createEl('tr').createEl('td', { text: String(index) });
			},
			renderTail: () => undefined,
			onScroll,
			onMeasure: () => undefined,
		});
		/** The rows drawn, between the two spacers. */
		const drawn = (): string[] =>
			(frame.body as unknown as CorkboardElement).children
				.filter((row) => !row.classes.has('snowflake-method-virtual-spacer'))
				.map((row) => row.querySelector('td')?.textContent ?? '');
		return { dom, page, frame, table, onScroll, drawn };
	};

	it('opens on the head of the list and shows only what the page has left under the frame’s top', () => {
		const { table, drawn } = paged();
		table.setTotal(100);
		// The fake measures every row at 37, so 100 pixels of page hold three.
		expect(drawn()).toEqual(['0', '1', '2']);
	});

	it('moves the window with the page and reports the page’s scroll', () => {
		const { dom, page, table, onScroll, drawn } = paged();
		table.setTotal(100);
		page.scrollTop = 1300;
		page.dispatch('scroll');
		dom.flushFrame();
		expect(onScroll).toHaveBeenCalledWith(1300);
		// A thousand pixels into rows of 37, for a page 400 high.
		expect(drawn()[0]).toBe('27');
		expect(drawn()).toHaveLength(11);
	});

	it('reveals a row by the frame’s place down the page, and puts the page back where a scroll stood', () => {
		const { page, table } = paged();
		table.setTotal(100);
		page.scrollTop = 1300;
		table.reveal(50);
		// The frame's top at 300, the row at 50 rows of 37, a third of the page up.
		expect(page.scrollTop).toBeCloseTo(300 + 50 * 37 - 400 / 3, 3);
		table.restore(120);
		expect(page.scrollTop).toBe(120);
	});

	it('brings a page scrolled into the rows back to the frame’s top, and leaves one above it where it stands', () => {
		const { page, table } = paged();
		table.setTotal(100);
		page.scrollTop = 1300;
		expect(table.toHead()).toBe(300);
		expect(page.scrollTop).toBe(300);
		// The band above the rows is on the screen: nothing moves.
		page.scrollTop = 100;
		expect(table.toHead()).toBe(100);
		expect(page.scrollTop).toBe(100);
	});

	it('lets go of the page once its frame has left the document', () => {
		const { dom, page, frame, table, onScroll } = paged();
		table.setTotal(100);
		frame.wrap.remove();
		page.dispatch('scroll');
		dom.flushFrame();
		expect(onScroll).not.toHaveBeenCalled();
		expect(page.listeners.get('scroll') ?? []).toHaveLength(0);
	});

	it('takes its listener off the page when destroyed', () => {
		const { page, table } = paged();
		table.destroy();
		expect(page.listeners.get('scroll') ?? []).toHaveLength(0);
	});
});

describe('the scroller of a frame', () => {
	/** A window whose stylesheet gives each element the overflow its class names. */
	const styled = (overflow: Record<string, string>) => {
		const dom = new CorkboardDom();
		(dom.win as unknown as { getComputedStyle: (element: CorkboardElement) => unknown }).getComputedStyle = (element) => ({
			overflowY: Object.entries(overflow).find(([cls]) => element.classList.contains(cls))?.[1] ?? 'visible',
			getPropertyValue: (): string => '',
		});
		const page = dom.container.createDiv({ cls: 'page' });
		const frame = buildTableFrame(page as unknown as HTMLElement, {
			tableCls: 'snowflake-method-character-table',
			columns: ['order', 'name'],
			headers: ['#', 'Name'],
		});
		return { page, frame };
	};

	it('is the frame itself where it scrolls, as on the desktop', () => {
		const { frame } = styled({ 'snowflake-method-table-body': 'scroll', page: 'auto' });
		expect(scrollerOf(frame.bodyWrap)).toBe(frame.bodyWrap);
	});

	it('is the nearest ancestor that scrolls where the frame runs on, as on a phone', () => {
		const { page, frame } = styled({ page: 'auto' });
		expect(scrollerOf(frame.bodyWrap)).toBe(page);
	});

	it('is the frame where nothing is laid out to scroll at all', () => {
		const { frame } = styled({});
		expect(scrollerOf(frame.bodyWrap)).toBe(frame.bodyWrap);
	});
});
