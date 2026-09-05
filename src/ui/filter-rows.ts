/**
 * The questions a funnel asks, in the shape the dashboard's popover draws
 * them: a labelled picker over one vocabulary, taking one answer or several.
 * The member tables, the foreshadowing table, the revision table and the
 * task board each hand the popover their own rows and read the answers
 * back through `apply`; the popover is one, lent by the dashboard, so its
 * pickers' lifetime and its outside-click rules are written once.
 */

import type { PickerOption } from './option-picker';

interface FilterRowBase {
	label: string;
	/** What the field reads as when the question is not being asked. */
	placeholder: string;
	/** The value that means exactly that, and what the reset returns to. */
	empty: string;
	options: () => PickerOption[];
}

/** A question with one answer, or none. */
export interface OneFilterRow extends FilterRowBase {
	kind: 'one';
	/** What the table is filtered by now, which the panel opens on. */
	value: string;
	apply: (value: string) => void;
}

/** A question with any number of answers, worn as tags; none means not asked. */
export interface ManyFilterRow extends FilterRowBase {
	kind: 'many';
	values: readonly string[];
	apply: (values: string[]) => void;
	/** The accessible name of a tag's remove button. */
	removeLabel: (label: string) => string;
}

export type FilterRow = OneFilterRow | ManyFilterRow;

/** What the dashboard lends a panel: its funnel popover. */
export interface LentFilterPopover {
	/** Whether the lent popover is open, so the funnel can close it instead. */
	filterOpen(): boolean;
	openFilter(
		anchor: HTMLElement,
		rows: readonly FilterRow[],
		changed: () => void,
	): void;
	closeFilter(): void;
}
