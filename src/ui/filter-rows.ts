/**
 * The questions a funnel asks, in the shape the dashboard's popover draws
 * them: a labelled picker over one vocabulary, taking one answer or none.
 * The member tables, the foreshadowing table, the revision table and the
 * task board each hand the popover their own rows and read the answers
 * back through `apply`; the popover is one, lent by the dashboard, so its
 * pickers' lifetime and its outside-click rules are written once.
 */

import type { PickerOption } from './option-picker';

/** One question the funnel asks: a picker with one answer, or none. */
export interface FilterRow {
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
}

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
