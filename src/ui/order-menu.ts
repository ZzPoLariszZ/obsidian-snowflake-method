/**
 * The order items a row's menu carries, for every list the plugin keeps in
 * an order of its own: the member tables, and the corkboard. Move up
 * and down go where the caller says, so a board that shows its sequence
 * backwards can send them by the eye; the position and the follow dialogs
 * speak the list's own order, whichever way it is shown.
 */

import type { App, Menu, MenuItem } from 'obsidian';

import {
	MoveAfterModal,
	MoveToPositionModal,
	type MoveAfterEntry,
	type Translate,
} from './modals';

export interface OrderMenuDeps {
	app: App;
	t: Translate;
	/** Runs a change, redraws, and turns a failure into a notice. */
	run(action: () => Promise<void>): Promise<void>;
	/** Queues a mutation and its redraw, leaving rejection for the dialog to report. */
	mutate?(action: () => Promise<void>): Promise<void>;
	/** Redraws alone, for a dialog that reports its own failures. */
	refresh(): Promise<void>;
	/** The menu section the items join, for a menu that keeps its items in sections. */
	section?: string;
}

export interface OrderMenuConfig {
	/** The row's place in the full list, not the filtered one. */
	index: number;
	total: number;
	/** True when any member is read-only, the rule the drag follows. */
	locked: boolean;
	/** True when the project cannot take a new member at all. */
	readOnly: boolean;
	/** The insert item at the foot, for a list a row can be added to; a list that only moves leaves both out. */
	insertTitle?: string;
	/** Where Move up takes the row, or null where there is nowhere to go. */
	up: number | null;
	down: number | null;
	/** Everything the row could be moved after, so all but itself. */
	options: () => MoveAfterEntry[];
	move: (toIndex: number) => Promise<void>;
	/** Resolves a relative move by identity when a queued writer can outlive this menu's order. */
	moveBeside?: (id: string, side: 'before' | 'after') => Promise<void>;
	/** Scrolls to the row once the move has been drawn. */
	reveal: () => void;
	insert?: () => void;
}

/** The two neighbours of a place in a list shown in its own order. */
export function listNeighbours(
	index: number,
	total: number,
): { up: number | null; down: number | null } {
	return {
		up: index > 0 ? index - 1 : null,
		down: index < total - 1 ? index + 1 : null,
	};
}

export function addOrderMenuItems(
	menu: Menu,
	deps: OrderMenuDeps,
	config: OrderMenuConfig,
): void {
	const { index, total } = config;
	const runMove = (action: () => Promise<void>): void => {
		void deps.run(action).then(() => {
			config.reveal();
		});
	};
	const moveTo = (toIndex: number): void => {
		runMove(() => config.move(Math.max(0, Math.min(toIndex, total - 1))));
	};
	const moveNeighbour = (toIndex: number): void => {
		const moveBeside = config.moveBeside;
		if (moveBeside === undefined) {
			moveTo(toIndex);
			return;
		}
		const neighbour = config.options().find((candidate) => candidate.index === toIndex);
		if (neighbour === undefined) return;
		const side = toIndex < index ? 'before' : 'after';
		runMove(() => moveBeside(neighbour.id, side));
	};
	const sectioned = (item: MenuItem): MenuItem =>
		deps.section === undefined ? item : item.setSection(deps.section);
	menu.addSeparator();
	menu.addItem((item) =>
		sectioned(item)
			.setTitle(deps.t('actions.moveUp'))
			.setIcon('arrow-up')
			.setDisabled(config.locked || config.up === null)
			.onClick(() => {
				if (config.up !== null) moveNeighbour(config.up);
			}),
	);
	menu.addItem((item) =>
		sectioned(item)
			.setTitle(deps.t('actions.moveDown'))
			.setIcon('arrow-down')
			.setDisabled(config.locked || config.down === null)
			.onClick(() => {
				if (config.down !== null) moveNeighbour(config.down);
			}),
	);
	menu.addItem((item) =>
		sectioned(item)
			.setTitle(deps.t('table.moveToPosition'))
			.setIcon('hash')
			.setDisabled(config.locked)
			.onClick(() => {
				new MoveToPositionModal(
					deps.app,
					deps.t,
					total,
					index + 1,
					async (toIndex) => {
						if (deps.mutate !== undefined) await deps.mutate(() => config.move(toIndex));
						else {
							await config.move(toIndex);
							await deps.refresh();
						}
						config.reveal();
					},
				).open();
			}),
	);
	menu.addItem((item) =>
		sectioned(item)
			.setTitle(deps.t('table.moveAfter'))
			.setIcon('corner-down-right')
			.setDisabled(config.locked)
			.onClick(() => {
				new MoveAfterModal(deps.app, deps.t, config.options(), (picked) => {
					const moveBeside = config.moveBeside;
					if (moveBeside !== undefined) {
						runMove(() => moveBeside(picked.id, 'after'));
						return;
					}
					// The mover leaves its place before it lands: a target below
					// it slides up by one, so following it means taking its old
					// index, while a target above keeps its index and following
					// it means the slot after.
					moveTo(index < picked.index ? picked.index : picked.index + 1);
				}).open();
			}),
	);
	const { insertTitle, insert } = config;
	if (insertTitle === undefined || insert === undefined) return;
	menu.addSeparator();
	menu.addItem((item) =>
		sectioned(item)
			.setTitle(insertTitle)
			.setIcon('plus')
			.setDisabled(config.readOnly)
			.onClick(insert),
	);
}

/**
 * A grip that answers a press, Enter, Space or a right-click with a menu
 * under it: the drag's twin, for a hand that cannot drag. A touch never
 * starts an HTML5 drag, and a keyboard never did.
 */
export function wireGripMenu(handle: HTMLElement, build: () => Menu | null): void {
	handle.setAttribute('aria-haspopup', 'menu');
	if (!handle.hasAttribute('tabindex')) handle.setAttribute('tabindex', '0');
	const open = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		const menu = build();
		if (menu === null) return;
		const box = handle.getBoundingClientRect();
		menu.showAtPosition({ x: box.left, y: box.bottom });
	};
	handle.addEventListener('click', open);
	handle.addEventListener('contextmenu', open);
	handle.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') open(event);
	});
}

/** Move up and Move down alone, for a short list with no position dialog of its own. */
export function addMoveNeighbourItems(
	menu: Menu,
	options: { t: Translate; up: (() => void) | null; down: (() => void) | null },
): void {
	menu.addItem((item) =>
		item
			.setTitle(options.t('actions.moveUp'))
			.setIcon('arrow-up')
			.setDisabled(options.up === null)
			.onClick(() => {
				options.up?.();
			}),
	);
	menu.addItem((item) =>
		item
			.setTitle(options.t('actions.moveDown'))
			.setIcon('arrow-down')
			.setDisabled(options.down === null)
			.onClick(() => {
				options.down?.();
			}),
	);
}
