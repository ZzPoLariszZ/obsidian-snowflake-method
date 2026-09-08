import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

interface MenuEntry {
	title: string;
	disabled: boolean;
	click: () => void;
}

const { menuEntries } = vi.hoisted(() => ({ menuEntries: [] as MenuEntry[] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Item implements MenuEntry {
		title = '';
		disabled = false;
		click = (): void => undefined;
		setTitle(title: string): this { this.title = title; return this; }
		setIcon(): this { return this; }
		setWarning(): this { return this; }
		setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
		onClick(click: () => void): this { this.click = click; return this; }
	}
	return {
		...runtime,
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent {
			setValue(): this { return this; }
		},
		Menu: class {
			addItem(build: (item: Item) => void): this {
				const item = new Item();
				build(item);
				menuEntries.push(item);
				return this;
			}
			addSeparator(): this { return this; }
			showAtMouseEvent(): void {}
		},
	};
});

import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls } from '../../src/ui/corkboard-bridge';
import { SCENE_DRAG_TYPE } from '../../src/ui/corkboard-layout';
import { sceneFilters } from '../../src/ui/scene-filters';
import { corkboardMemory, type CorkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

function board(settings: Partial<CorkboardMemory> = {}, locks: { project?: boolean; scene?: boolean } = {}) {
	const dom = new CorkboardDom();
	const memory = Object.assign(corkboardMemory(), {
		filters: { ...sceneFilters(), sceneMin: 2, sceneMax: 4 },
	}, settings);
	const scenes: SceneViewModel[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
		id, path: `Scenes/${id}.md`, title: `Scene ${id}`, rank: index,
		progressStatus: 'in-progress', aliases: [], categoryPaths: [],
		povPath: '', povName: '', povMissing: false,
		times: [], locations: [], characterPaths: [], conflict: '', color: null,
		linkedManuscript: [], worldStatus: [], relationships: [], events: '',
		customFields: '', revision: 'revision', healthIssues: [],
		readOnly: locks.scene === true && index === 0,
	}));
	const model = {
		path: 'Project/Project.md', projectId: 'project', locale: 'en',
		scenes, characters: [], manuscriptPaths: [], readOnly: locks.project === true,
	} as unknown as ProjectDashboardModel;
	const host = {
		reorderScene: vi.fn(() => Promise.resolve()),
		openSceneForm: vi.fn(() => Promise.resolve(null)),
	};
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
		host, t: (key: string) => key, model: () => model,
		activateProject: vi.fn(), refresh: vi.fn(() => Promise.resolve()),
		popover: { closeFilter: vi.fn() }, memory, remember: vi.fn(),
	} as unknown as CorkboardControls;
	const handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	const root = dom.container.children[0]!;
	const canvas = root.querySelector('.snowflake-method-corkboard-canvas')!;
	const cards = canvas.querySelectorAll('.snowflake-method-corkboard-card');
	return { root, canvas, cards, host, handle, memory };
}

function menu(card: CorkboardElement): Map<string, MenuEntry> {
	menuEntries.length = 0;
	card.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
	return new Map(menuEntries.map((entry) => [entry.title, entry]));
}

function event(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

function dropAtEnd(fixture: ReturnType<typeof board>, card: CorkboardElement): void {
	const data = new Map<string, string>();
	const dataTransfer = {
		types: [SCENE_DRAG_TYPE],
		setData: (type: string, value: string) => { data.set(type, value); },
		getData: (type: string) => data.get(type) ?? '',
	};
	// The fake DOM has no browser Element prototype; a null target exercises
	// the card drag path without the unrelated nested-control exclusion.
	event(card, 'dragstart', { target: null, dataTransfer });
	vi.spyOn(fixture.canvas, 'getBoundingClientRect').mockReturnValue({ height: 600, ...{ left: 0, top: 0 } });
	event(fixture.canvas, 'dragover', { clientX: 0, clientY: 10_000, dataTransfer });
	event(fixture.canvas, 'drop', { dataTransfer });
	card.dispatch('dragend');
}

beforeEach(() => { menuEntries.length = 0; vi.clearAllMocks(); });

describe('corkboard adjacency with a scene range', () => {
	it.each([false, true])('enables range-only actions and closes movement at visible ends (reversed: %s)', async (reversed) => {
		const fixture = board({ reversed });
		expect(fixture.cards.map((card) => card.dataset.id)).toEqual(reversed ? ['d', 'c', 'b'] : ['b', 'c', 'd']);
		for (const card of fixture.cards) {
			expect(card.getAttribute('draggable')).toBe('true');
			expect(card.querySelector('.snowflake-method-corkboard-insert-before')!.classes.has('is-hidden')).toBe(false);
			expect(card.querySelector('.snowflake-method-corkboard-insert-after')!.classes.has('is-hidden')).toBe(false);
		}
		expect(fixture.root.querySelector('.snowflake-method-filter-button')!.classes.has('is-active')).toBe(true);
		const first = menu(fixture.cards[0]!);
		expect(first.get('actions.moveUp')!.disabled).toBe(true);
		expect(first.get('actions.moveDown')!.disabled).toBe(false);
		const last = menu(fixture.cards[2]!);
		expect(last.get('actions.moveUp')!.disabled).toBe(false);
		expect(last.get('actions.moveDown')!.disabled).toBe(true);
		const middle = menu(fixture.cards[1]!);
		expect(middle.get('actions.moveUp')!.disabled).toBe(false);
		expect(middle.get('actions.moveDown')!.disabled).toBe(false);
		middle.get('actions.moveUp')!.click();
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledWith('c', reversed ? 3 : 1, 'Project/Project.md'));
		fixture.handle.dispose();
	});

	it.each([false, true])('drops after the visible tail without crossing the range (reversed: %s)', async (reversed) => {
		const fixture = board({ reversed });
		dropAtEnd(fixture, fixture.cards[0]!);
		await vi.waitFor(() => expect(fixture.host.reorderScene).toHaveBeenCalledWith(reversed ? 'd' : 'b', reversed ? 1 : 3, 'Project/Project.md'));
		fixture.host.reorderScene.mockClear();
		dropAtEnd(fixture, fixture.cards[2]!);
		await Promise.resolve();
		expect(fixture.host.reorderScene).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it.each([false, true])('inserts beside the actual scene in either display direction (reversed: %s)', async (reversed) => {
		const fixture = board({ reversed });
		fixture.cards[1]!.querySelector('.snowflake-method-corkboard-insert-after')!.dispatch('click');
		await vi.waitFor(() => expect(fixture.host.openSceneForm).toHaveBeenCalledWith({ mode: 'create', afterIndex: reversed ? 1 : 2 }, 'Project/Project.md'));
		fixture.handle.dispose();
	});

	it.each([
		{ name: 'status filter', settings: { filters: { ...sceneFilters(), sceneMin: 2, sceneMax: 4, status: 'in-progress' as const } } },
		{ name: 'search', settings: { query: 'Scene' } },
		{ name: 'grouping', settings: { group: 'status' as const } },
	])('disables adjacency with $name while keeping positional moves available', ({ settings }) => {
		const fixture = board(settings);
		for (const card of fixture.cards) {
			expect(card.getAttribute('draggable')).toBe('false');
			expect(card.querySelector('.snowflake-method-corkboard-insert-after')!.classes.has('is-hidden')).toBe(true);
		}
		const actions = menu(fixture.cards[1]!);
		expect(actions.get('actions.moveUp')!.disabled).toBe(true);
		expect(actions.get('actions.moveDown')!.disabled).toBe(true);
		expect(actions.get('table.moveToPosition')!.disabled).toBe(false);
		expect(actions.get('table.moveAfter')!.disabled).toBe(false);
		fixture.handle.dispose();
	});

	it('updates retained cards when an additional filter matches the same scenes and is cleared', () => {
		const fixture = board();
		const middle = fixture.cards[1]!;
		for (const filtered of [true, false]) {
			fixture.memory.filters.status = filtered ? 'in-progress' : 'all';
			fixture.handle.refresh();
			expect(fixture.canvas.querySelectorAll('.snowflake-method-corkboard-card')).toEqual(fixture.cards);
			expect(middle.getAttribute('draggable')).toBe(filtered ? 'false' : 'true');
			expect(middle.querySelector('.snowflake-method-corkboard-insert-before')!.classes.has('is-hidden')).toBe(filtered);
			expect(middle.querySelector('.snowflake-method-corkboard-insert-after')!.classes.has('is-hidden')).toBe(filtered);
			const actions = menu(middle);
			expect(actions.get('actions.moveUp')!.disabled).toBe(filtered);
			expect(actions.get('actions.moveDown')!.disabled).toBe(filtered);
		}
		fixture.handle.dispose();
	});

	it.each([{ project: true }, { scene: true }])('keeps range-only actions locked for read-only data: %j', (locks) => {
		const fixture = board({}, locks);
		expect(fixture.cards[0]!.getAttribute('draggable')).toBe('false');
		expect(fixture.cards[0]!.querySelector('.snowflake-method-corkboard-insert-before')!.classes.has('is-hidden')).toBe(true);
		const actions = menu(fixture.cards[1]!);
		expect(actions.get('actions.moveUp')!.disabled).toBe(true);
		expect(actions.get('actions.moveDown')!.disabled).toBe(true);
		fixture.handle.dispose();
	});
});
