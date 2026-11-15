/**
 * The questions a funnel asks, in the shape the dashboard's popover draws
 * them: a labelled picker, a pair of numeric range bounds, or a measure
 * picked on a rail of stops.
 * The member tables, the foreshadowing table, the revision table and the
 * task board each hand the popover their own rows and read the answers
 * back through `apply`; the popover is one, lent by the dashboard, so its
 * pickers' lifetime and its outside-click rules are written once.
 */

import type { PickerOption } from './option-picker';

/** One question the funnel asks: a picker with one answer, or none. */
export interface FilterOptionRow {
	label: string;
	/** Colour questions use the same swatch strip as the sticky-note board. */
	presentation?: 'color-swatches';
	/** What the field reads as when the question is not being asked. */
	placeholder: string;
	/** The value that means exactly that, and what the reset returns to. */
	empty: string;
	options: () => PickerOption[];
	/** What the table is filtered by now, which the panel opens on. */
	value: string;
	apply: (value: string) => void;
	/**
	 * The drafted answer shown on the surface while the panel is open, for a
	 * choice that has to be seen to be made. The panel hands the standing
	 * answer back the same way when it closes unconfirmed.
	 */
	preview?: (value: string) => void;
	/**
	 * Questions asked only under some of this one's answers, keyed by the
	 * answer: the panel draws them under this row while that answer is
	 * drafted and redraws them when the draft changes. A question not on
	 * show when the panel is confirmed is applied as not asked.
	 */
	under?: Readonly<Record<string, readonly FilterRow[]>>;
}

/** A range is edited as text until the caller parses its confirmed bounds. */
export interface FilterRangeRow {
	presentation: 'number-range';
	label: string;
	min: { label: string; placeholder: string; value: string };
	max: { label: string; placeholder: string; value: string };
	apply: (min: string, max: string) => void;
}

/**
 * A measure picked on a rail of stops: a width, a height, a size. The
 * handle moves stop by stop and the surface follows it while it moves,
 * through `preview`; the measure is kept, like every other answer, when the
 * panel is confirmed, and a panel closed any other way hands the standing
 * measure back through `preview`.
 */
export interface FilterSliderRow {
	presentation: 'stop-slider';
	label: string;
	/** The values the handle stops at, in order. */
	stops: readonly number[];
	/** What the surface is set to now, which the panel opens on. */
	value: number;
	/** The value that means the surface's own measure, and what the reset returns to. */
	empty: number;
	/** Names the button beside the rail that puts the measure back. */
	resetLabel: string;
	/** The measure in words, written at the end of the row's name. */
	format: (value: number) => string;
	/** What the surface already draws while the measure is its own, where the handle waits. */
	rest?: () => number;
	/** The theme variable the surface falls back to while the measure is its own, where the handle waits. */
	themeVar?: string;
	/**
	 * Whether the row is out of sight for the answers drafted now: a measure
	 * of something the drafted answers do not show. A hidden row is left as
	 * it is stored when the panel is confirmed.
	 */
	hidden?: () => boolean;
	preview: (value: number) => void;
	apply: (value: number) => void;
}

export type FilterRow = FilterOptionRow | FilterRangeRow | FilterSliderRow;

/** Whether a row is a picker's: neither a range nor a rail. */
export const isFilterOptionRow = (row: FilterRow): row is FilterOptionRow =>
	row.presentation !== 'number-range' && row.presentation !== 'stop-slider';

/** What the dashboard lends a panel: its funnel popover. */
export interface LentFilterPopover {
	/** Whether the lent popover is open, so the funnel can close it instead. */
	filterOpen(): boolean;
	/** The popover under its anchor; a title other than the funnel's when asked. */
	openFilter(
		anchor: HTMLElement,
		rows: readonly FilterRow[],
		changed: () => void,
		title?: string,
	): void;
	closeFilter(): void;
}
