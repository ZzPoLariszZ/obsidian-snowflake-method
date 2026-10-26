/**
 * Windowed rendering for the dashboard's member tables.
 *
 * Three thousand scenes drawn as three thousand rows cost the dashboard
 * seconds on every render. Drawn as the thirty or so that fit the viewport
 * they cost nothing, and the scrollbar still spans the whole list because a
 * spacer row above and below the window holds the height of everything not
 * drawn.
 *
 * Rows are not uniform: a storyline or a conflict wraps to as many lines as
 * it needs. So the window is computed from running offsets — each row's
 * measured height where it has been drawn before, and an estimate where it
 * has not — and every measurement is remembered against the row's own id,
 * so scrolling somewhere twice is exact the second time.
 */

export interface VirtualWindow {
	first: number;
	count: number;
	padTop: number;
	padBottom: number;
}

/**
 * Running offsets of the rows: `offsets[i]` is where row `i` starts, and the
 * extra last entry is the height of the whole list.
 */
export function rowOffsets(heights: readonly number[]): number[] {
	const offsets = new Array<number>(heights.length + 1);
	offsets[0] = 0;
	for (let index = 0; index < heights.length; index += 1) {
		offsets[index + 1] = offsets[index]! + heights[index]!;
	}
	return offsets;
}

/** The greatest row index whose offset is at or before `value`. */
export function rowAtOrBefore(offsets: readonly number[], value: number): number {
	let low = 0;
	let high = offsets.length - 2;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (offsets[middle]! <= value) low = middle;
		else high = middle - 1;
	}
	return low;
}

/**
 * The rows a scroller should be showing, clamped at both ends: a position
 * past the end answers with the last windowful rather than a window past
 * the list, and an empty list is an empty window.
 */
export function virtualWindow(
	scrollTop: number,
	viewportHeight: number,
	offsets: readonly number[],
	overscan: number,
): VirtualWindow {
	const total = offsets.length - 1;
	if (total <= 0) {
		return { first: 0, count: 0, padTop: 0, padBottom: 0 };
	}
	const height = offsets[total]!;
	const top = Math.min(
		Math.max(0, scrollTop),
		Math.max(0, height - viewportHeight),
	);
	const first = Math.max(0, rowAtOrBefore(offsets, top) - overscan);
	const last = Math.min(
		total - 1,
		rowAtOrBefore(offsets, top + viewportHeight) + overscan,
	);
	const count = last - first + 1;
	return {
		first,
		count,
		padTop: offsets[first]!,
		padBottom: height - offsets[first + count]!,
	};
}

const SPACER_CLASS = 'snowflake-method-virtual-spacer';

/** A window with the measuring tool a frame keeps its layout by, which every window has and the types name on none. */
type MeasuringWindow = Window & {
	ResizeObserver?: new (callback: () => void) => {
		observe(target: Element, options?: { box: 'border-box' }): void;
		disconnect(): void;
	};
};

interface VirtualTableOptions {
	/** The element that scrolls, and whose height frames the window. */
	scroller: HTMLElement;
	/**
	 * The frame the rows are drawn in, named only where the scroller is an
	 * ancestor of it: a phone's dashboard scrolls as one page, and the rows
	 * stand somewhere down it. The frame's place in the scroller then offsets
	 * the window. Left out, the scroller is the frame.
	 */
	frame?: HTMLElement;
	/** The tbody the rows go into. */
	body: HTMLElement;
	/** How many columns a spacer row must span. */
	columns: number;
	/** Stands in for a row's height until that row has been measured. */
	estimatedRowHeight: number;
	/** Rows drawn beyond each edge, so a flick shows rows and not blank. */
	overscan: number;
	/** Names the row at an index, so its measured height survives moves. */
	rowKey(index: number): string;
	/** The measured heights, owned by the caller so they outlive rebuilds. */
	heights: Map<string, number>;
	/** Appends exactly one row for the list index it is given. */
	renderRow(body: HTMLElement, index: number): void;
	/** Appends whatever follows the list, after the bottom spacer. */
	renderTail(body: HTMLElement): void;
	/** Where the scroll came to rest, so the view can restore it later. */
	onScroll(scrollTop: number): void;
	/** The average measured height, so the view's next mount starts close. */
	onMeasure(rowHeight: number): void;
}

/**
 * One table drawn a windowful at a time.
 *
 * Built fresh on every dashboard render and left to die with its elements:
 * the scroll listener sits on the scroller itself, so discarding the wrap
 * discards the listener with it. Restoring the scroll position is the
 * view's job, done after `setTotal` has laid the spacers out — before that
 * there is nothing to scroll into.
 */
export class VirtualTable {
	private total = 0;
	private first = -1;
	private count = -1;
	private padTop = -1;
	private padBottom = -1;
	private estimate: number;
	private frame = 0;
	private resized: { disconnect(): void } | null = null;
	private unmigrate: (() => void) | null = null;
	private readonly onScroll: () => void;

	constructor(private readonly options: VirtualTableOptions) {
		this.estimate = Math.max(1, options.estimatedRowHeight);
		const onScroll = (): void => {
			// A page scroller outlives the frames drawn down it: a frame the
			// last render discarded takes its listener off at the next scroll.
			if (!(this.options.frame ?? this.options.scroller).isConnected) {
				this.options.scroller.removeEventListener('scroll', onScroll);
				return;
			}
			this.options.onScroll(this.options.scroller.scrollTop);
			if (this.frame !== 0) return;
			this.frame = this.options.scroller.win.requestAnimationFrame(() => {
				this.frame = 0;
				this.refresh();
			});
		};
		this.onScroll = onScroll;
		options.scroller.addEventListener('scroll', onScroll);
		// A frame that changes size changes what fits in it, and a frame
		// that stacks its table into cards, or lays the cards back out as
		// rows, changes every row's height under the window. Either way the
		// rows are read again at once, before the frame is painted: the
		// frame's own watcher was made first, so its word is already said.
		const watch = (): void => {
			this.resized?.disconnect();
			this.resized = null;
			const win = options.scroller.win as MeasuringWindow;
			if (win.ResizeObserver === undefined) return;
			const resized = new win.ResizeObserver(() => {
				// A frame taken out of the document reports a size of none.
				if (options.scroller.isConnected) this.refresh();
			});
			resized.observe(options.scroller);
			this.resized = resized;
		};
		watch();
		// Watched again from the window a moved table now stands in, as the
		// frame is: one window's watcher hears nothing of another's layout.
		this.unmigrate = (options.scroller as MigratingElement).onWindowMigrated?.(watch) ?? null;
	}

	/**
	 * Drops a frame still waiting to run, the watch on the frame's size and
	 * the scroll listener, for a table whose elements are going away. A
	 * scroller that is the frame takes the listener with it anyway; a page
	 * scroller stays, and would hear every scroll for a table long gone.
	 */
	destroy(): void {
		this.unmigrate?.();
		this.unmigrate = null;
		this.resized?.disconnect();
		this.resized = null;
		this.options.scroller.removeEventListener('scroll', this.onScroll);
		if (this.frame === 0) return;
		this.options.scroller.win.cancelAnimationFrame(this.frame);
		this.frame = 0;
	}

	/** Replaces what the table is showing. Also the first fill. */
	setTotal(total: number): void {
		this.total = total;
		this.first = -1;
		this.refresh();
		// Again, because the first pass read the scrollport as the old list
		// left it: a list that just grew from a filtered handful was measured
		// against a shrunken viewport. The second pass sees the settled one
		// and costs nothing when the window comes out the same.
		this.refresh();
	}

	/** Scrolls so the given row sits about a third down the viewport. */
	reveal(index: number): void {
		const { scroller } = this.options;
		const offsets = this.offsets();
		const top = offsets[Math.max(0, Math.min(index, this.total - 1))] ?? 0;
		scroller.scrollTop = Math.max(0, this.frameTop() + top - scroller.clientHeight / 3);
		this.refresh();
	}

	/** Puts the scroller where a scroll it reported once stood. */
	restore(scrollTop: number): void {
		this.options.scroller.scrollTop = scrollTop;
	}

	/**
	 * Where the frame starts, measured down the scroller's content: nothing
	 * where the scroller is the frame, and the rows' own offsets count from
	 * there.
	 */
	private frameTop(): number {
		const { scroller, frame } = this.options;
		if (frame === undefined || frame === scroller) return 0;
		return (
			frame.getBoundingClientRect().top -
			(scroller.getBoundingClientRect().top + scroller.clientTop) +
			scroller.scrollTop
		);
	}

	/**
	 * The slice of the frame the scroller shows: how far down the frame its
	 * top edge stands, and how much of the frame fits under it. A frame that
	 * begins below the scroller's top edge shows only what the scroller has
	 * left under that beginning.
	 */
	private viewport(): { top: number; height: number } {
		const { scroller, frame } = this.options;
		if (frame === undefined || frame === scroller) {
			return { top: scroller.scrollTop, height: scroller.clientHeight };
		}
		const top =
			scroller.getBoundingClientRect().top +
			scroller.clientTop -
			frame.getBoundingClientRect().top;
		return { top, height: scroller.clientHeight + Math.min(0, top) };
	}

	refresh(): void {
		const { body } = this.options;
		const offsets = this.offsets();
		const viewport = this.viewport();
		const shown = virtualWindow(
			viewport.top,
			viewport.height,
			offsets,
			this.options.overscan,
		);
		if (shown.first !== this.first || shown.count !== this.count) {
			this.first = shown.first;
			this.count = shown.count;
			this.padTop = shown.padTop;
			this.padBottom = shown.padBottom;
			body.empty();
			this.spacer(shown.padTop);
			for (
				let index = shown.first;
				index < shown.first + shown.count;
				index += 1
			) {
				this.options.renderRow(body, index);
			}
			this.spacer(shown.padBottom);
			this.options.renderTail(body);
		} else if (
			shown.padTop !== this.padTop ||
			shown.padBottom !== this.padBottom
		) {
			// The same rows, sitting on revised arithmetic: measurements
			// changed the height of what is not drawn, so only the spacers
			// move.
			this.padTop = shown.padTop;
			this.padBottom = shown.padBottom;
			this.setSpacer(0, shown.padTop);
			this.setSpacer(1 + this.count, shown.padBottom);
		}
		this.measure();
	}

	/** The current offsets: measured heights where known, estimates where not. */
	private offsets(): number[] {
		const heights = new Array<number>(this.total);
		for (let index = 0; index < this.total; index += 1) {
			heights[index] =
				this.options.heights.get(this.options.rowKey(index)) ??
				this.estimate;
		}
		return rowOffsets(heights);
	}

	private spacer(height: number): void {
		const row = this.options.body.createEl('tr', { cls: SPACER_CLASS });
		const cell = row.createEl('td', {
			attr: { colspan: String(this.options.columns) },
		});
		cell.setCssStyles({ height: `${String(Math.max(0, height))}px` });
	}

	private setSpacer(childIndex: number, height: number): void {
		const cell = this.options.body.children
			.item(childIndex)
			?.querySelector('td');
		cell?.setCssStyles({ height: `${String(Math.max(0, height))}px` });
	}

	/**
	 * Reads the heights of the drawn rows — each from the distance to the row
	 * after it, so borders and the narrow layout's card gaps are counted in —
	 * and stores what changed. New measurements above the viewport would slide
	 * the rows on screen, so the scroll position is moved by the same amount
	 * and everything stays put. The drawn rows sit between the spacers, at
	 * children 1 through `count`.
	 */
	private measure(): void {
		if (this.count < 1) return;
		const { body, scroller, heights } = this.options;
		const rows = body.children;
		let changed = false;
		let previousTop: number | null = null;
		let lastHeight = 0;
		for (let at = 0; at < this.count; at += 1) {
			const rect = rows.item(1 + at)?.getBoundingClientRect();
			if (rect === undefined || rect.height <= 0) return;
			if (previousTop !== null) {
				changed =
					this.keep(this.first + at - 1, rect.top - previousTop) ||
					changed;
			}
			previousTop = rect.top;
			lastHeight = rect.height;
		}
		changed = this.keep(this.first + this.count - 1, lastHeight) || changed;
		if (!changed) return;
		let sum = 0;
		for (const height of heights.values()) sum += height;
		if (heights.size > 0) {
			this.estimate = Math.max(1, sum / heights.size);
			this.options.onMeasure(this.estimate);
		}
		// What sits above the window may have just changed height under the
		// reader; moving the scroll by the same amount keeps the drawn rows
		// exactly where they were on screen.
		const settled = this.offsets()[this.first] ?? 0;
		const delta = settled - this.padTop;
		if (delta !== 0) scroller.scrollTop += delta;
		this.refresh();
	}

	/** Stores one measured height. True when it differs from what was held. */
	private keep(index: number, height: number): boolean {
		if (height <= 0) return false;
		const key = this.options.rowKey(index);
		const known = this.options.heights.get(key);
		if (known !== undefined && Math.abs(known - height) <= 0.5) return false;
		this.options.heights.set(key, height);
		return true;
	}
}

/**
 * The element whose scroll moves the rows: the frame itself where it
 * scrolls, as it does on the desktop, else the nearest ancestor that does.
 * A phone's dashboard lets its frames run to their content and scrolls the
 * whole page, and the stylesheet alone says which it is, so the answer is
 * read from the layout rather than from the device. A frame not laid out,
 * as a test's is, scrolls itself.
 */
export function scrollerOf(frame: HTMLElement): HTMLElement {
	for (let candidate: HTMLElement | null = frame; candidate !== null; candidate = candidate.parentElement) {
		const style = frame.win.getComputedStyle(candidate);
		if (style.overflowY === 'auto' || style.overflowY === 'scroll') return candidate;
	}
	return frame;
}

/** The pieces of a split-header table frame a caller fills and scrolls. */
export interface TableFrame {
	/** The whole frame, for hiding and showing. */
	wrap: HTMLElement;
	headTable: HTMLElement;
	/** The scroller the rows live in: what a virtual table is given. */
	bodyWrap: HTMLElement;
	/** The body the rows are drawn into. */
	body: HTMLElement;
}

type MigratingElement = HTMLElement & {
	onWindowMigrated?: (listener: (win: Window) => unknown) => () => void;
};

/** The floor the stylesheet sets on a table, in pixels; null where none can be read. */
function tableFloor(table: HTMLElement): number | null {
	const win = table.win;
	const value = win
		.getComputedStyle(table)
		.getPropertyValue('--snowflake-method-table-floor')
		.trim();
	const match = /^(\d+(?:\.\d+)?)(rem|px)$/u.exec(value);
	if (match === null) return null;
	const size = Number(match[1]);
	if (match[2] === 'px') return size;
	const root = parseFloat(
		win.getComputedStyle(table.ownerDocument.documentElement).fontSize,
	);
	return size * (root > 0 ? root : 16);
}

/**
 * Lays a table out as cards while its frame is narrower than the table's
 * floor, the width its columns need to read as a table. The frame is
 * watched, not the dashboard: the rail and the panel's own chrome take a
 * share of the pane that differs from table to table, and a table held at
 * its floor in a narrower frame ran past the frame's edge. The floor is the
 * stylesheet's, read from the table, so the two cannot disagree. Nothing is
 * let go by hand: a kept panel's frame can leave the document and come
 * back, and a discarded one takes its watcher with it.
 */
function stackWhenNarrow(
	wrap: HTMLElement,
	bodyWrap: HTMLElement,
	table: HTMLElement,
): void {
	/** The frame's own border while it draws one, which a stacked frame takes off. */
	let border = 0;
	const settle = (): void => {
		const floor = tableFloor(table);
		if (floor === null) return;
		const stacked = wrap.classList.contains('is-stacked');
		if (!stacked) {
			const own = wrap.win.getComputedStyle(wrap);
			border = (parseFloat(own.borderLeftWidth) || 0) + (parseFloat(own.borderRightWidth) || 0);
		}
		const style = bodyWrap.win.getComputedStyle(bodyWrap);
		// The room the rows would have as a table, inside the border a table
		// is framed by: read the same way stacked or not, so the answer does
		// not turn over on its own measure.
		const room =
			bodyWrap.clientWidth -
			parseFloat(style.paddingLeft) -
			parseFloat(style.paddingRight) -
			(stacked ? border : 0);
		wrap.toggleClass('is-stacked', room < floor);
	};
	let observer: { disconnect(): void } | null = null;
	const watch = (): void => {
		observer?.disconnect();
		observer = null;
		const win = wrap.win as MeasuringWindow;
		if (win.ResizeObserver === undefined) return;
		const watching = new win.ResizeObserver(settle);
		// The wrap by its outer box, which the pane alone decides: the body
		// grows when stacking hides the header, and a watch on the body
		// would hear its own answer in the same frame, which the browser
		// holds over and reports as a loop.
		watching.observe(wrap, { box: 'border-box' });
		observer = watching;
	};
	watch();
	(wrap as MigratingElement).onWindowMigrated?.(watch);
	// Once now as well, so rows drawn straight after are measured as the
	// cards they will be in a frame too narrow for them.
	settle();
}

/**
 * The split frame every table here stands in: one wrap, a header strip the
 * body's scroll carries sideways by a transform (the table-head styles say
 * why it must never scroll itself), and one colgroup worn twice so the two
 * halves agree on their columns. Stated once, because the stylesheet keys on
 * these class names and the carry idiom alike, and four frames laid by hand
 * were four places for either to drift. A frame too narrow for its table
 * lays it out as cards.
 */
export function buildTableFrame(
	host: HTMLElement,
	options: {
		/** Classes on the wrap beside the frame's own. */
		wrapCls?: string;
		/** Classes both tables wear. */
		tableCls: string;
		/** One column class per column, in order. */
		columns: readonly string[];
		/** One header per column: its text, and any class of its own. */
		headers: readonly (string | { text: string; cls?: string })[];
	},
): TableFrame {
	const wrap = host.createDiv({
		cls: `snowflake-method-table-wrap${
			options.wrapCls === undefined ? '' : ` ${options.wrapCls}`
		}`,
	});
	const headWrap = wrap.createDiv({ cls: 'snowflake-method-table-head' });
	const bodyWrap = wrap.createDiv({ cls: 'snowflake-method-table-body' });
	const tableCls = `snowflake-method-table ${options.tableCls}`;
	const headTable = headWrap.createEl('table', { cls: tableCls });
	const bodyTable = bodyWrap.createEl('table', { cls: tableCls });
	for (const table of [headTable, bodyTable]) {
		const cols = table.createEl('colgroup');
		for (const cls of options.columns) cols.createEl('col', { cls });
	}
	const headRow = headTable.createEl('thead').createEl('tr');
	for (const header of options.headers) {
		const { text, cls } =
			typeof header === 'string' ? { text: header, cls: undefined } : header;
		headRow.createEl('th', { text, ...(cls === undefined ? {} : { cls }) });
	}
	let carried = '';
	bodyWrap.addEventListener('scroll', () => {
		const shift = `translateX(${String(-bodyWrap.scrollLeft)}px)`;
		if (shift === carried) return;
		carried = shift;
		headTable.style.transform = shift;
	});
	stackWhenNarrow(wrap, bodyWrap, bodyTable);
	return { wrap, headTable, bodyWrap, body: bodyTable.createEl('tbody') };
}
