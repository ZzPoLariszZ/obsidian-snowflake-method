import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

interface MenuAction {
	title: string;
	disabled: boolean;
	run: () => void;
}

const ui = vi.hoisted(() => ({ menus: [] as MenuAction[][] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
		Menu: class {
			private items: MenuAction[] = [];
			addItem(build: (item: unknown) => void): this {
				const action: MenuAction = { title: '', disabled: false, run: () => undefined };
				const item = {
					setTitle: (title: string) => { action.title = title; return item; },
					setIcon: () => item,
					setWarning: () => item,
					setDisabled: (disabled: boolean) => { action.disabled = disabled; return item; },
					onClick: (run: () => void) => { action.run = run; return item; },
				};
				build(item);
				this.items.push(action);
				return this;
			}
			addSeparator(): this { return this; }
			setParentElement(): this { return this; }
			showAtMouseEvent(): this { ui.menus.push(this.items); return this; }
		},
	};
});

vi.mock('../../src/ui/virtual-table', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/virtual-table')>();
	return {
		...runtime,
		// Keep the real table frame and row callback; browser measurement is
		// irrelevant to whether a filtered row can move to a visible neighbour.
		VirtualTable: class {
			constructor(private options: {
				body: HTMLElement;
				renderRow(body: HTMLElement, index: number): void;
			}) {}
			setTotal(total: number): void {
				this.options.body.empty();
				for (let index = 0; index < total; index++) {
					this.options.renderRow(this.options.body, index);
				}
			}
			refresh(): void {}
		},
	};
});

import { SCENE_DRAG_TYPE } from '../../src/ui/corkboard-layout';
import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { sceneFilters, type SceneFilters } from '../../src/ui/scene-filters';
import type { DashboardHost, ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

function scene(id: string, index: number): SceneViewModel {
	return {
		id, path: `Scenes/${id}.md`, title: id, rank: index, progressStatus: 'complete',
		aliases: [], categoryPaths: ['Act/One'], povPath: 'Characters/Ada.md', povName: 'Ada',
		povMissing: false, times: ['Morning'], locations: ['Harbour'],
		characterPaths: ['Characters/Ada.md'], conflict: 'Shared conflict', color: 'macaron-1',
		linkedManuscript: [{ raw: '[[Chapter]]', linktext: 'Chapter', target: 'Chapter', label: 'Chapter' }],
		worldStatus: [], relationships: [], events: '', customFields: '', revision: id,
		readOnly: false, healthIssues: [],
	};
}

function dashboard(options: {
	filters?: Partial<SceneFilters>;
	query?: string;
	readOnly?: boolean;
	readOnlyScene?: string;
} = {}) {
	const dom = new CorkboardDom();
	const reorderScene = vi.fn((_id: string, _index: number) => Promise.resolve());
	const view = new SnowflakeDashboardView({ app: {
		metadataCache: { getFirstLinkpathDest: (target: string) => ({ path: `${target}.md` }) },
	} } as unknown as WorkspaceLeaf, {
		getRecentStep: () => 8,
		isFreeformModeEnabled: () => true,
		showsTableActionsColumn: () => false,
		showsTableProgressStatus: () => false,
		translateForProject: (_locale: string, key: string) => key,
		reorderScene,
	} as unknown as DashboardHost);
	const filters = { ...sceneFilters(), sceneMin: 2, sceneMax: 4, ...options.filters };
	Object.assign(view, {
		sceneFilters: filters,
		sceneQuery: options.query ?? '',
		renderOpenBase: vi.fn(),
		loadMemberCategories: vi.fn(),
		loadManuscriptNotes: vi.fn(),
		refresh: vi.fn(() => Promise.resolve()),
	});
	const model = {
		path: 'Novel/Project.md',
		readOnly: options.readOnly ?? false,
		structureIssues: [],
		characters: [{ path: 'Characters/Ada.md', name: 'Ada' }],
		scenes: ['A', 'B', 'C', 'D', 'E'].map((id, index) => ({
			...scene(id, index), readOnly: options.readOnlyScene === id,
		})),
	} as unknown as ProjectDashboardModel;
	(view as unknown as {
		renderScenes(panel: HTMLElement, model: ProjectDashboardModel, step: 8): void;
	}).renderScenes(dom.container as unknown as HTMLElement, model, 8);
	const rows = dom.container.querySelectorAll('tr').filter((row) => row.dataset.sceneId !== undefined);
	const row = (id: string): CorkboardElement => {
		const found = rows.find((candidate) => candidate.dataset.sceneId === id);
		if (found === undefined) throw new Error(`Missing scene row: ${id}`);
		return found;
	};
	const menu = (id: string): MenuAction[] => {
		row(id).querySelector('.snowflake-method-table-more')?.dispatch('click');
		const opened = ui.menus[ui.menus.length - 1];
		if (opened === undefined) throw new Error(`Missing scene menu: ${id}`);
		return opened;
	};
	return { filters, rows, row, menu, reorderScene };
}

function action(menu: MenuAction[], title: string): MenuAction {
	const item = menu.find((candidate) => candidate.title === title);
	if (item === undefined) throw new Error(`Missing menu item: ${title}`);
	return item;
}

function drop(row: CorkboardElement, id: string): void {
	for (const listener of row.listeners.get('drop') ?? []) {
		listener({
			target: row,
			preventDefault: () => undefined,
			stopPropagation: () => undefined,
			dataTransfer: { getData: (type: string) => type === SCENE_DRAG_TYPE ? id : '' },
		} as Parameters<typeof listener>[0]);
	}
}

beforeEach(() => { ui.menus.length = 0; });

describe('dashboard adjacency with a continuous scene range', () => {
	it('enables dragging and moves only to neighbours inside the shown range', async () => {
		const table = dashboard();
		expect(table.rows.map((row) => row.dataset.sceneId)).toEqual(['B', 'C', 'D']);
		expect(table.rows.map((row) => row.getAttribute('draggable'))).toEqual(['true', 'true', 'true']);
		expect(table.rows.every((row) => row.listeners.has('dragstart') && row.listeners.has('drop'))).toBe(true);
		const first = table.menu('B');
		const middle = table.menu('C');
		const last = table.menu('D');
		expect(action(first, 'actions.moveUp').disabled).toBe(true);
		expect(action(last, 'actions.moveDown').disabled).toBe(true);
		for (const [menu, direction, id, target] of [
			[first, 'actions.moveDown', 'B', 2],
			[middle, 'actions.moveUp', 'C', 1],
			[middle, 'actions.moveDown', 'C', 3],
			[last, 'actions.moveUp', 'D', 2],
		] as const) {
			const item = action(menu, direction);
			expect(item.disabled).toBe(false);
			item.run();
			expect(table.reorderScene).toHaveBeenLastCalledWith(id, target, 'Novel/Project.md');
		}
		await Promise.resolve();
	});

	it('accepts a visible scene drop and rejects a scene outside the current range', () => {
		const table = dashboard();
		drop(table.row('D'), 'B');
		expect(table.reorderScene).toHaveBeenCalledExactlyOnceWith('B', 3, 'Novel/Project.md');
		table.reorderScene.mockClear();
		for (const id of ['A', 'E', 'unknown']) drop(table.row('D'), id);
		expect(table.reorderScene).not.toHaveBeenCalled();
		// A drag started before a filter change must not pull a now-hidden
		// scene back into the range when it is dropped.
		table.filters.sceneMin = 3;
		drop(table.row('D'), 'B');
		expect(table.reorderScene).not.toHaveBeenCalled();
	});

	it.each([
		{ sceneMin: 3, sceneMax: null, ids: ['C', 'D', 'E'] },
		{ sceneMin: null, sceneMax: 3, ids: ['A', 'B', 'C'] },
		{ sceneMin: 3, sceneMax: 3, ids: ['C'] },
	])('keeps the range edges closed for $sceneMin–$sceneMax', ({ sceneMin, sceneMax, ids }) => {
		const table = dashboard({ filters: { sceneMin, sceneMax } });
		expect(table.rows.map((row) => row.dataset.sceneId)).toEqual(ids);
		expect(action(table.menu(ids[0]!), 'actions.moveUp').disabled).toBe(true);
		expect(action(table.menu(ids[ids.length - 1]!), 'actions.moveDown').disabled).toBe(true);
	});

	it.each([
		{ status: 'complete' as const },
		{ category: 'Act' },
		{ pov: 'Characters/Ada.md' },
		{ time: 'Morning' },
		{ location: 'Harbour' },
		{ character: 'Characters/Ada.md' },
		{ color: 'macaron-1' as const },
		{ linked: 'Chapter' },
	])('disables adjacency with an additional filter even if every shown scene matches: %j', (filters) => {
		const table = dashboard({ filters });
		expect(table.rows.map((row) => row.dataset.sceneId)).toEqual(['B', 'C', 'D']);
		for (const row of table.rows) {
			expect(row.getAttribute('draggable')).toBe('false');
			expect(row.listeners.has('drop')).toBe(false);
			const menu = table.menu(row.dataset.sceneId!);
			expect(action(menu, 'actions.moveUp').disabled).toBe(true);
			expect(action(menu, 'actions.moveDown').disabled).toBe(true);
			expect(action(menu, 'table.moveToPosition').disabled).toBe(false);
			expect(action(menu, 'table.moveAfter').disabled).toBe(false);
		}
	});

	it('disables adjacency for a search that keeps every scene in the range', () => {
		const table = dashboard({ query: 'Shared' });
		expect(table.rows).toHaveLength(3);
		expect(table.rows.every((row) => row.getAttribute('draggable') === 'false')).toBe(true);
		expect(action(table.menu('C'), 'actions.moveUp').disabled).toBe(true);
		expect(action(table.menu('C'), 'actions.moveDown').disabled).toBe(true);
	});

	it('ignores blank search text alongside the range', () => {
		const table = dashboard({ query: '   ' });
		expect(table.row('C').getAttribute('draggable')).toBe('true');
		expect(action(table.menu('C'), 'actions.moveUp').disabled).toBe(false);
		expect(action(table.menu('C'), 'actions.moveDown').disabled).toBe(false);
	});

	it.each([{ readOnly: true }, { readOnlyScene: 'C' }, { readOnlyScene: 'A' }])(
		'keeps all reorder actions disabled when the project or any scene is read-only: %j',
		(options) => {
			const table = dashboard(options);
			expect(table.rows.every((row) => row.getAttribute('draggable') === 'false')).toBe(true);
			const menu = table.menu('C');
			for (const title of ['actions.moveUp', 'actions.moveDown', 'table.moveToPosition', 'table.moveAfter']) {
				expect(action(menu, title).disabled).toBe(true);
			}
		},
	);
});
