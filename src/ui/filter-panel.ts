/**
 * The funnel popover every table and board asks its questions in: a panel
 * under the funnel button, one picker per question, confirmed as a whole or
 * dismissed as nothing. A view hangs one of these and lends it to every panel
 * it holds through `lend()`, so the pickers' lifetime and the outside-click
 * rules are written once and every surface asks its questions in the same
 * box. The same panel serves a board's display settings under a title of
 * their own: the rows are the same shape.
 */

import type { App } from 'obsidian';

import { isMacaronColor } from '../domain';
import { followAnchor } from './anchored-panel';
import type { FilterRow, LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import { buildOptionField, type OptionPicker } from './option-picker';
import { renderStickySwatches } from './sticky-note-card';

export class FilterPanel {
	/** The pickers the open panel is using, for release. */
	private pickers: OptionPicker[] = [];
	/** The panel while it is open, with what it has to let go of. */
	private panel: { el: HTMLElement; release: () => void } | null = null;

	constructor(
		private readonly app: App,
		private readonly t: Translate,
	) {}

	isOpen(): boolean {
		return this.panel !== null;
	}

	/** What a panel is handed: this popover, its lifetime kept here. */
	lend(): LentFilterPopover {
		return {
			filterOpen: () => this.isOpen(),
			openFilter: (anchor, rows, changed, title) => {
				this.open(anchor, rows, changed, title);
			},
			closeFilter: () => {
				this.close();
			},
		};
	}

	/**
	 * The questions, in a panel under the anchor. Each is a picker of its
	 * own, so they can all be asked at once, and each offers its whole
	 * vocabulary rather than only the answers this project happens to hold.
	 */
	open(
		anchor: HTMLElement,
		rows: readonly FilterRow[],
		changed: () => void,
		title?: string,
	): void {
		this.close();
		const heading = title ?? this.t('table.filter');
		const panel = anchor.win.activeDocument.body.createDiv({
			cls: 'snowflake-method-filter-panel',
			attr: { role: 'dialog', 'aria-label': heading },
		});
		panel.createDiv({
			cls: 'snowflake-method-filter-panel-title',
			text: heading,
		});
		const body = panel.createDiv({ cls: 'snowflake-method-filter-panel-body' });
		// What the panel is being set to, until it is confirmed. The table keeps
		// showing what it was showing while the fields are being worked out, and
		// a panel dismissed without confirming changes nothing.
		const draft = rows.map((entry) => entry.value);
		// Rebuilt rather than reassigned: a picker shows the value it was built
		// with, so the reset below has to build the fields again to show them
		// back at rest.
		const fill = (): void => {
			body.empty();
			this.releasePickers();
			rows.forEach((entry, index) => {
				const field = body.createDiv({ cls: 'snowflake-method-filter-row' });
				field.createDiv({
					cls: 'snowflake-method-filter-label',
					text: entry.label,
				});
				if (entry.presentation === 'color-swatches') {
					const value = draft[index];
					const strip = renderStickySwatches(field, {
						value: isMacaronColor(value) ? value : '',
						t: this.t,
						onPick: (next) => {
							// Picking the chosen colour again clears this question,
							// just as it does on the dashboard's sticky-note tab.
							const chosen = draft[index] === next ? '' : next;
							draft[index] = chosen;
							strip.sync(chosen);
						},
					});
					return;
				}
				this.pickers.push(
					buildOptionField(this.app, field, {
						options: () => [
							{ value: entry.empty, label: entry.placeholder },
							...entry.options(),
						],
						value: () => draft[index] ?? entry.empty,
						choose: (value) => {
							draft[index] = value;
						},
						label: entry.label,
						placeholder: entry.placeholder,
						emptyPlaceholder: entry.placeholder,
					}),
				);
			});
		};
		fill();
		const actions = panel.createDiv({
			cls: 'snowflake-method-filter-panel-actions',
		});
		const reset = actions.createEl('button', {
			cls: 'snowflake-method-filter-reset',
			text: this.t('table.filterReset'),
			attr: { type: 'button' },
		});
		// Clears the fields rather than the table: the panel has one way out,
		// and this is not it.
		reset.addEventListener('click', () => {
			rows.forEach((entry, index) => {
				draft[index] = entry.empty;
			});
			fill();
		});
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('table.filterConfirm'),
			attr: { type: 'button' },
		});
		confirm.addEventListener('click', () => {
			rows.forEach((entry, index) => {
				entry.apply(draft[index] ?? entry.empty);
			});
			this.close();
			changed();
		});

		// Under the anchor and lined up with its end, in the layer above
		// everything: the panel covers a table that scrolls, and a panel inside
		// it would be clipped by it. Where exactly, and keeping it there, is the
		// shared panel helper's -- the manuscript's typography popover hangs the
		// same way, and this one gains from that: it stays inside the window
		// and follows the anchor when a sidebar folds under it.
		const view = anchor.win;
		const unfollow = followAnchor(panel, anchor, view);
		anchor.setAttribute('aria-expanded', 'true');

		// A click inside the panel is the author using it, and one inside a
		// suggestion list is them using a field of it: the list is put in the
		// same layer, outside the panel's own element.
		const dismiss = (event: MouseEvent): void => {
			const target = event.target as Node | null;
			if (target === null) return;
			if (panel.contains(target) || anchor.contains(target)) return;
			const el = target.instanceOf(Element) ? target : target.parentElement;
			if (el?.closest('.suggestion-container') != null) return;
			this.close();
		};
		const onKey = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			// The field's own list answers Escape first, and closing the panel
			// under it would take the field away mid-correction.
			if (view.activeDocument.querySelector('.suggestion-container') !== null) {
				return;
			}
			this.close();
			anchor.focus();
		};
		view.addEventListener('mousedown', dismiss, true);
		view.addEventListener('keydown', onKey, true);
		this.panel = {
			el: panel,
			release: () => {
				view.removeEventListener('mousedown', dismiss, true);
				view.removeEventListener('keydown', onKey, true);
				unfollow();
				anchor.setAttribute('aria-expanded', 'false');
			},
		};
	}

	/** Takes the panel down, and lets go of its pickers either way. */
	close(): void {
		const open = this.panel;
		if (open !== null) {
			this.panel = null;
			open.release();
			open.el.remove();
		}
		this.releasePickers();
	}

	private releasePickers(): void {
		for (const picker of this.pickers) picker.destroy();
		this.pickers = [];
	}
}
