/**
 * The funnel popover every table and board asks its questions in: a panel
 * under the funnel button, with pickers and range fields confirmed as a whole or
 * dismissed as nothing. A view hangs one of these and lends it to every panel
 * it holds through `lend()`, so the pickers' lifetime and the outside-click
 * rules are written once and every surface asks its questions in the same
 * box. The same panel serves a board's display settings under a title of
 * their own: the rows are the same shape.
 */

import type { App } from 'obsidian';

import { isMacaronColor } from '../domain';
import { followAnchor } from './anchored-panel';
import { DIALOG_CLASS } from './dialog-class';
import type { FilterRow, LentFilterPopover } from './filter-rows';
import type { Translate } from './modals';
import { buildOptionField, type OptionPicker } from './option-picker';
import { renderStickySwatches } from './sticky-note-card';

/** The rows copied, branches and all, so nothing changes until confirmed. */
const draftOf = (rows: readonly FilterRow[]): FilterRow[] =>
	rows.map((entry) => {
		if (entry.presentation === 'number-range') {
			return { ...entry, min: { ...entry.min }, max: { ...entry.max } };
		}
		if (entry.under === undefined) return { ...entry };
		return {
			...entry,
			under: Object.fromEntries(
				Object.entries(entry.under).map(([answer, under]) => [answer, draftOf(under)]),
			),
		};
	});

/**
 * The drafted answers handed back, and those under an answer not drafted
 * handed back as not asked: a question that was not on show cannot have
 * been answered.
 */
const applyRows = (rows: readonly FilterRow[], shown: boolean): void => {
	for (const entry of rows) {
		if (entry.presentation === 'number-range') {
			if (shown) entry.apply(entry.min.value, entry.max.value);
			else entry.apply('', '');
			continue;
		}
		entry.apply(shown ? entry.value : entry.empty);
		for (const [answer, under] of Object.entries(entry.under ?? {})) {
			applyRows(under, shown && answer === entry.value);
		}
	}
};

/** Every answer back at rest, under every branch too. */
const clearRows = (rows: readonly FilterRow[]): void => {
	for (const entry of rows) {
		if (entry.presentation === 'number-range') {
			entry.min.value = '';
			entry.max.value = '';
			continue;
		}
		entry.value = entry.empty;
		for (const under of Object.values(entry.under ?? {})) clearRows(under);
	}
};

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
			cls: `${DIALOG_CLASS} snowflake-method-filter-panel`,
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
		const draft = draftOf(rows);
		const apply = (): void => {
			applyRows(draft, true);
			this.close();
			changed();
		};
		/**
		 * The rows drawn into a box, each a field of its own. A row with
		 * questions under some of its answers gets a box for them after its
		 * field, drawn again whenever its draft changes, so the questions
		 * that follow are always the drafted answer's. `within` names every
		 * branch the box stands in, outermost first: a picker drawn here is
		 * one of each, so a branch drawn again takes down the pickers of the
		 * branches under it too, and never one twice.
		 */
		const draw = (
			into: HTMLElement,
			entries: readonly FilterRow[],
			within: readonly Set<OptionPicker>[],
		): void => {
			for (const entry of entries) {
				const field = into.createDiv({ cls: 'snowflake-method-filter-row' });
				field.createDiv({
					cls: 'snowflake-method-filter-label',
					text: entry.label,
				});
				if (entry.presentation === 'number-range') {
					const range = field.createDiv({ cls: 'snowflake-method-filter-range' });
					for (const bound of [entry.min, entry.max]) {
						const input = range.createEl('input', {
							attr: {
								type: 'text',
								inputmode: 'numeric',
								placeholder: bound.placeholder,
								'aria-label': bound.label,
							},
						});
						input.value = bound.value;
						input.addEventListener('input', () => {
							bound.value = input.value;
						});
						input.addEventListener('keydown', (event) => {
							if (event.key !== 'Enter' || event.isComposing) return;
							event.preventDefault();
							apply();
						});
					}
					continue;
				}
				const branch =
					entry.under === undefined
						? null
						: into.createDiv({ cls: 'snowflake-method-filter-branch' });
				/** The pickers under this row's answer, the branches under them included. */
				const own = new Set<OptionPicker>();
				const drawBranch = (): void => {
					if (branch === null) return;
					for (const picker of own) {
						picker.destroy();
						for (const scope of within) scope.delete(picker);
					}
					this.pickers = this.pickers.filter((picker) => !own.has(picker));
					own.clear();
					branch.empty();
					draw(branch, entry.under?.[entry.value] ?? [], [...within, own]);
				};
				if (entry.presentation === 'color-swatches') {
					const value = entry.value;
					const strip = renderStickySwatches(field, {
						value: isMacaronColor(value) ? value : '',
						t: this.t,
						onPick: (next) => {
							// Picking the chosen colour again clears this question,
							// just as it does on the dashboard's sticky-note tab.
							const chosen = entry.value === next ? '' : next;
							entry.value = chosen;
							strip.sync(chosen);
							drawBranch();
						},
					});
				} else {
					const picker = buildOptionField(this.app, field, {
						options: () => [
							{ value: entry.empty, label: entry.placeholder },
							...entry.options(),
						],
						value: () => entry.value,
						choose: (value) => {
							entry.value = value;
							drawBranch();
						},
						label: entry.label,
						placeholder: entry.placeholder,
						emptyPlaceholder: entry.placeholder,
					});
					this.pickers.push(picker);
					for (const scope of within) scope.add(picker);
				}
				drawBranch();
			}
		};
		// Rebuilt rather than reassigned: a picker shows the value it was built
		// with, so the reset below has to build the fields again to show them
		// back at rest.
		const fill = (): void => {
			body.empty();
			this.releasePickers();
			draw(body, draft, []);
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
			clearRows(draft);
			fill();
		});
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.t('table.filterConfirm'),
			attr: { type: 'button' },
		});
		confirm.addEventListener('click', apply);

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
			// An Escape struck while an input method is composing is the composition's.
			if (event.key !== 'Escape' || event.isComposing) return;
			// The field's own list answers Escape first, and closing the panel
			// under it would take the field away mid-correction.
			if (view.activeDocument.querySelector('.suggestion-container') !== null) {
				return;
			}
			this.close();
			anchor.focus();
		};
		view.addEventListener('pointerdown', dismiss, true);
		view.addEventListener('keydown', onKey, true);
		this.panel = {
			el: panel,
			release: () => {
				view.removeEventListener('pointerdown', dismiss, true);
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
