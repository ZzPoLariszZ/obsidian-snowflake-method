import { describe, expect, it, vi } from 'vitest';

interface Item {
	title: string;
	icon: string;
	click: () => void;
}

const { menus } = vi.hoisted(() => ({ menus: [] as { items: (Item | 'separator')[] }[] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class MenuItem {
		readonly item: Item = { title: '', icon: '', click: () => undefined };
		setTitle(title: string): this {
			this.item.title = title;
			return this;
		}
		setIcon(icon: string): this {
			this.item.icon = icon;
			return this;
		}
		onClick(click: () => void): this {
			this.item.click = click;
			return this;
		}
	}
	class Menu {
		readonly items: (Item | 'separator')[] = [];
		constructor() {
			menus.push(this);
		}
		addItem(build: (item: MenuItem) => void): this {
			const item = new MenuItem();
			build(item);
			this.items.push(item.item);
			return this;
		}
		addSeparator(): this {
			this.items.push('separator');
			return this;
		}
		showAtMouseEvent(): this {
			return this;
		}
		showAtPosition(): this {
			return this;
		}
	}
	return { ...runtime, Menu };
});

import type { GraphEdge, GraphNode } from '../../src/domain';
import {
	buildBackgroundMenu,
	buildEdgeMenu,
	buildNodeMenu,
	GRAPH_MENU_STEP,
	type GraphMenuDeps,
} from '../../src/ui/relationship-graph-menus';

const node = (id: string, group: GraphNode['group'], name: string, path: string | null): GraphNode => ({
	id,
	group,
	kind: group === 'unresolved' ? 'unresolved' : 'character',
	name,
	aliases: [],
	path,
	weight: 1,
});

const alice = node('character-alice', 'character', 'Alice', 'Demo/20_Character/Alice.md');
const bob = node('character-bob', 'character', 'Bob', 'Demo/20_Character/Bob.md');
const nobody = node('unresolved:Nobody', 'unresolved', 'Nobody', null);

const edge: GraphEdge = {
	id: 'character-alice|0|character-bob|Family',
	source: 'character-alice',
	target: 'character-bob',
	label: 'Family',
	labelPath: 'Family',
	text: '',
	record: 0,
	lane: 0,
};

function deps(options: { focus?: string | null; pinned?: boolean; controlsOpen?: boolean } = {}) {
	menus.length = 0;
	const nodes = new Map([alice, bob, nobody].map((one) => [one.id, one]));
	return {
		t: (key: string, vars?: Record<string, string | number>) => (vars?.name === undefined ? key : `${key}:${vars.name}`),
		node: (id: string) => nodes.get(id),
		focus: () => options.focus ?? null,
		controlsOpen: () => options.controlsOpen ?? true,
		isPinned: () => options.pinned ?? false,
		open: vi.fn(),
		edit: vi.fn(),
		editRelationship: vi.fn(),
		showLocal: vi.fn(),
		showWhole: vi.fn(),
		pin: vi.fn(),
		nudge: vi.fn(),
		pan: vi.fn(),
		fit: vi.fn(),
		resetView: vi.fn(),
		foldControls: vi.fn(),
	} satisfies GraphMenuDeps;
}

const titles = (): string[] => menus[0]!.items.map((item) => (item === 'separator' ? item : item.title));
const icons = (): string[] => menus[0]!.items.flatMap((item) => (item === 'separator' ? [] : [item.icon]));
const click = (title: string): void => {
	const item = menus[0]!.items.find((one) => one !== 'separator' && one.title === title);
	if (item === undefined || item === 'separator') throw new Error(`no item ${title}`);
	item.click();
};

describe('the node menu', () => {
	it('offers the note, the form, the local graph, a pin, the four moves and a fit, every item with an icon', () => {
		const given = deps();
		const menu = buildNodeMenu(given, alice.id);
		expect(menu).not.toBeNull();
		expect(titles()).toEqual([
			'common.open',
			'actions.edit',
			'separator',
			'relationshipGraph.local.show',
			'relationshipGraph.node.pin',
			'separator',
			'actions.moveUp',
			'actions.moveDown',
			'relationshipGraph.node.moveLeft',
			'relationshipGraph.node.moveRight',
			'separator',
			'relationshipGraph.fit',
		]);
		expect(icons().every((icon) => icon.length > 0)).toBe(true);
		click('common.open');
		expect(given.open).toHaveBeenCalledWith(alice);
		click('actions.edit');
		expect(given.edit).toHaveBeenCalledWith(alice);
		click('relationshipGraph.local.show');
		expect(given.showLocal).toHaveBeenCalledWith(alice.id);
		click('relationshipGraph.node.pin');
		expect(given.pin).toHaveBeenCalledWith(alice.id, true);
		click('actions.moveUp');
		click('relationshipGraph.node.moveRight');
		expect(given.nudge.mock.calls).toEqual([
			[alice.id, 0, -GRAPH_MENU_STEP],
			[alice.id, GRAPH_MENU_STEP, 0],
		]);
		click('relationshipGraph.fit');
		expect(given.fit).toHaveBeenCalledTimes(1);
	});

	it('turns the local graph off and the pin out when they stand', () => {
		const given = deps({ focus: alice.id, pinned: true });
		buildNodeMenu(given, alice.id);
		expect(titles()).toContain('relationshipGraph.local.whole');
		expect(titles()).not.toContain('relationshipGraph.local.show');
		click('relationshipGraph.local.whole');
		expect(given.showWhole).toHaveBeenCalledTimes(1);
		const unpin = menus[0]!.items.find((item) => item !== 'separator' && item.title === 'relationshipGraph.node.unpin');
		expect(unpin).toMatchObject({ icon: 'pin-off' });
		click('relationshipGraph.node.unpin');
		expect(given.pin).toHaveBeenCalledWith(alice.id, false);
	});

	it('offers neither note nor form for a target no note answers to, and nothing for a node gone', () => {
		buildNodeMenu(deps(), nobody.id);
		expect(titles()[0]).toBe('relationshipGraph.local.show');
		expect(titles()).not.toContain('common.open');
		expect(buildNodeMenu(deps(), 'character-carol')).toBeNull();
	});
});

describe('the line menu', () => {
	it("offers the relationship's card and the two notes it joins", () => {
		const given = deps();
		buildEdgeMenu(given, edge);
		expect(titles()).toEqual(['relationshipGraph.edge.edit', 'relationshipGraph.edge.open:Alice', 'relationshipGraph.edge.open:Bob']);
		click('relationshipGraph.edge.edit');
		expect(given.editRelationship).toHaveBeenCalledWith(edge);
		click('relationshipGraph.edge.open:Bob');
		expect(given.open).toHaveBeenCalledWith(bob);
	});

	it('leaves out a target that leads to no note', () => {
		buildEdgeMenu(deps(), { ...edge, target: nobody.id });
		expect(titles()).toEqual(['relationshipGraph.edge.edit', 'relationshipGraph.edge.open:Alice']);
	});
});

describe('the ground menu', () => {
	it('offers the view, the controls and the four pans, the camera moving as the words say', () => {
		const given = deps({ controlsOpen: true });
		buildBackgroundMenu(given);
		expect(titles()).toEqual([
			'relationshipGraph.fit',
			'relationshipGraph.resetView',
			'relationshipGraph.closeControls',
			'separator',
			'relationshipGraph.pan.up',
			'relationshipGraph.pan.down',
			'relationshipGraph.pan.left',
			'relationshipGraph.pan.right',
		]);
		click('relationshipGraph.resetView');
		expect(given.resetView).toHaveBeenCalledTimes(1);
		click('relationshipGraph.closeControls');
		expect(given.foldControls).toHaveBeenCalledWith(false);
		click('relationshipGraph.pan.up');
		click('relationshipGraph.pan.left');
		expect(given.pan.mock.calls).toEqual([
			[0, GRAPH_MENU_STEP],
			[GRAPH_MENU_STEP, 0],
		]);
	});

	it('offers the whole graph while a node is the focus, and the controls when shut', () => {
		const given = deps({ focus: alice.id, controlsOpen: false });
		buildBackgroundMenu(given);
		expect(titles()).toContain('relationshipGraph.local.whole');
		expect(titles()).toContain('relationshipGraph.openControls');
		click('relationshipGraph.openControls');
		expect(given.foldControls).toHaveBeenCalledWith(true);
	});
});
