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
function rowAtOrBefore(offsets: readonly number[], value: number): number {
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

interface VirtualTableOptions {
	/** The element that scrolls, and whose height frames the window. */
	scroller: HTMLElement;
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

	constructor(private readonly options: VirtualTableOptions) {
		this.estimate = Math.max(1, options.estimatedRowHeight);
		options.scroller.addEventListener('scroll', () => {
			this.options.onScroll(this.options.scroller.scrollTop);
			if (this.frame !== 0) return;
			this.frame = this.options.scroller.win.requestAnimationFrame(() => {
				this.frame = 0;
				this.refresh();
			});
		});
	}

	/**
	 * Drops a frame still waiting to run, for a table whose elements are
	 * going away. The scroll listener needs no such care: it lives on the
	 * scroller, which the next render discards along with it.
	 */
	destroy(): void {
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
		scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
		this.refresh();
	}

	refresh(): void {
		const { scroller, body } = this.options;
		const offsets = this.offsets();
		const shown = virtualWindow(
			scroller.scrollTop,
			scroller.clientHeight,
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
