/**
 * The parts a task pane shares with its siblings and is not the owner of:
 * the line said when there is nothing to show, and the split button a row's
 * primary action wears with the rest of its actions behind a chevron. Built
 * here once so the revision table, the foreshadowing table, the sticky
 * board and the member tables cannot drift apart in what they draw.
 */

import { Menu, setIcon, setTooltip } from 'obsidian';

/** The warning sign and the words, as every tab says it has nothing to show. */
export function renderEmptyLine(
	host: HTMLElement,
	text: string,
): { line: HTMLElement; text: HTMLElement } {
	const line = host.createEl('p', { cls: 'snowflake-method-character-empty' });
	const icon = line.createSpan({
		cls: 'snowflake-method-character-empty-icon',
		attr: { 'aria-hidden': 'true' },
	});
	setIcon(icon, 'triangle-alert');
	return { line, text: line.createSpan({ text }) };
}

/**
 * A split button: the primary at the left, the menu of the rest behind the
 * chevron. The menu is built afresh at every press, from the items handed in.
 */
export function renderSplitButton(
	host: HTMLElement,
	spec: {
		/** Classes beside the split button's own, when a table dresses it. */
		cls?: string;
		primary: {
			cls: string;
			label: string;
			tip?: string;
			disabled?: boolean;
			run: () => void;
		};
		/** The chevron's accessible name: the table's word for its actions. */
		menuLabel: string;
		items: (menu: Menu) => void;
	},
): { wrap: HTMLElement; primary: HTMLButtonElement } {
	const wrap = host.createDiv({
		cls:
			spec.cls === undefined
				? 'snowflake-method-character-split-button'
				: `snowflake-method-character-split-button ${spec.cls}`,
	});
	const primary = wrap.createEl('button', {
		cls: spec.primary.cls,
		text: spec.primary.label,
		attr: { type: 'button' },
	});
	if (spec.primary.tip !== undefined) setTooltip(primary, spec.primary.tip);
	primary.disabled = spec.primary.disabled === true;
	primary.addEventListener('click', spec.primary.run);
	const trigger = wrap.createEl('button', {
		cls: 'snowflake-method-character-action-menu-trigger',
		attr: {
			type: 'button',
			'aria-haspopup': 'menu',
			'aria-label': spec.menuLabel,
		},
	});
	setIcon(
		trigger.createSpan({ cls: 'snowflake-method-character-action-menu-icon' }),
		'chevron-down',
	);
	trigger.addEventListener('click', (event) => {
		const menu = new Menu();
		menu.setParentElement(wrap);
		spec.items(menu);
		menu.showAtMouseEvent(event);
	});
	return { wrap, primary };
}

/**
 * A count as a reader groups it. Both languages this plugin speaks group by
 * threes with a comma, so one grouping serves them both.
 */
export function grouped(value: number): string {
	return value.toLocaleString('en-US');
}
