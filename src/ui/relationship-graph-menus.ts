/**
 * The menus of the entity graph: on a node, on a line, and on the ground.
 * Every drag and every key the graph answers has its twin here, so a touch
 * screen and a keyboard reach everything a mouse does; every item carries a
 * Lucide icon, since a menu drawn by the plugin on Windows shows none
 * otherwise.
 */

import { Menu } from 'obsidian';

import { UNRESOLVED_GROUP, type GraphEdge, type GraphNode } from '../domain';
import type { Translate } from './modals';

/** How far a menu's move takes a node or the view, in screen pixels. */
export const GRAPH_MENU_STEP = 50;

export interface GraphMenuDeps {
	t: Translate;
	node(id: string): GraphNode | undefined;
	/** The node the local graph is drawn about, or null. */
	focus(): string | null;
	controlsOpen(): boolean;
	isPinned(id: string): boolean;
	/** The note. */
	open(node: GraphNode): void;
	/** The form. */
	edit(node: GraphNode): void;
	editRelationship(edge: GraphEdge): void;
	showLocal(id: string): void;
	showWhole(): void;
	pin(id: string, on: boolean): void;
	nudge(id: string, dx: number, dy: number): void;
	pan(dx: number, dy: number): void;
	fit(): void;
	resetView(): void;
	foldControls(open: boolean): void;
}

const addItem = (menu: Menu, title: string, icon: string, onClick: () => void): void => {
	menu.addItem((item) => {
		item.setTitle(title).setIcon(icon).onClick(onClick);
	});
};

const MOVES: readonly { key: string; icon: string; dx: number; dy: number }[] = [
	{ key: 'up', icon: 'arrow-up', dx: 0, dy: -GRAPH_MENU_STEP },
	{ key: 'down', icon: 'arrow-down', dx: 0, dy: GRAPH_MENU_STEP },
	{ key: 'left', icon: 'arrow-left', dx: -GRAPH_MENU_STEP, dy: 0 },
	{ key: 'right', icon: 'arrow-right', dx: GRAPH_MENU_STEP, dy: 0 },
];

/** The words for a node's four moves, which the timeline already has for up and down. */
const MOVE_WORDS: Record<string, string> = {
	up: 'actions.moveUp',
	down: 'actions.moveDown',
	left: 'relationshipGraph.node.moveLeft',
	right: 'relationshipGraph.node.moveRight',
};

/** The menu on a node, or null for a node the graph no longer has. */
export function buildNodeMenu(deps: GraphMenuDeps, id: string): Menu | null {
	const node = deps.node(id);
	if (node === undefined) return null;
	const { t } = deps;
	const menu = new Menu();
	if (node.group !== UNRESOLVED_GROUP) {
		addItem(menu, t('common.open'), 'file-text', () => {
			deps.open(node);
		});
		addItem(menu, t('actions.edit'), 'pencil', () => {
			deps.edit(node);
		});
		menu.addSeparator();
	}
	if (deps.focus() === id) {
		addItem(menu, t('relationshipGraph.local.whole'), 'git-fork', () => {
			deps.showWhole();
		});
	} else {
		addItem(menu, t('relationshipGraph.local.show'), 'git-fork', () => {
			deps.showLocal(id);
		});
	}
	const pinned = deps.isPinned(id);
	addItem(menu, t(pinned ? 'relationshipGraph.node.unpin' : 'relationshipGraph.node.pin'), pinned ? 'pin-off' : 'pin', () => {
		deps.pin(id, !pinned);
	});
	menu.addSeparator();
	for (const move of MOVES) {
		addItem(menu, t(MOVE_WORDS[move.key]!), move.icon, () => {
			deps.nudge(id, move.dx, move.dy);
		});
	}
	menu.addSeparator();
	addItem(menu, t('relationshipGraph.fit'), 'maximize', () => {
		deps.fit();
	});
	return menu;
}

/** The menu on a line: the relationship's card, and the two notes it joins. */
export function buildEdgeMenu(deps: GraphMenuDeps, edge: GraphEdge): Menu {
	const { t } = deps;
	const menu = new Menu();
	addItem(menu, t('relationshipGraph.edge.edit'), 'pencil', () => {
		deps.editRelationship(edge);
	});
	for (const end of [deps.node(edge.source), deps.node(edge.target)]) {
		if (end === undefined || end.path === null) continue;
		addItem(menu, t('relationshipGraph.edge.open', { name: end.name }), 'file-text', () => {
			deps.open(end);
		});
	}
	return menu;
}

/** The menu on the ground: the view, the controls, and the pan's twin. */
export function buildBackgroundMenu(deps: GraphMenuDeps): Menu {
	const { t } = deps;
	const menu = new Menu();
	addItem(menu, t('relationshipGraph.fit'), 'maximize', () => {
		deps.fit();
	});
	addItem(menu, t('relationshipGraph.resetView'), 'locate-fixed', () => {
		deps.resetView();
	});
	if (deps.focus() !== null) {
		addItem(menu, t('relationshipGraph.local.whole'), 'git-fork', () => {
			deps.showWhole();
		});
	}
	const open = deps.controlsOpen();
	addItem(menu, t(open ? 'relationshipGraph.closeControls' : 'relationshipGraph.openControls'), 'sliders-horizontal', () => {
		deps.foldControls(!open);
	});
	menu.addSeparator();
	for (const move of MOVES) {
		// The view moves as the camera does: panning up shows what stands above.
		// Subtracting from zero keeps a still axis at 0, where negation gives -0.
		addItem(menu, t(`relationshipGraph.pan.${move.key}`), move.icon, () => {
			deps.pan(0 - move.dx, 0 - move.dy);
		});
	}
	return menu;
}
