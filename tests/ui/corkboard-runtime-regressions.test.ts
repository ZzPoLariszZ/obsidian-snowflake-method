import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

interface MenuEntry { title: string; disabled: boolean; click(): void }
const { searches, menuEntries } = vi.hoisted(() => ({
	searches: [] as ((value: string) => void)[], menuEntries: [] as MenuEntry[],
}));

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
			override onChange(handler: (value: string) => void): this { searches.push(handler); return this; }
		},
		Menu: class {
			addItem(build: (item: Item) => void): this {
				const item = new Item(); build(item); menuEntries.push(item); return this;
			}
			addSeparator(): this { return this; }
			showAtMouseEvent(): void {}
		},
	};
});

vi.mock('../../src/ui/anchored-panel', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../../src/ui/anchored-panel')>();
	return {
		...runtime,
		hangPanel: (anchor: HTMLElement, spec: Parameters<typeof runtime.hangPanel>[1]) => {
			const el = (anchor as unknown as CorkboardElement).dom.container.createDiv({ cls: spec.cls });
			spec.build(el as unknown as HTMLElement);
			return { el, release: vi.fn() };
		},
	};
});

import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardHandle } from '../../src/ui/corkboard-bridge';
import { SCENE_DRAG_TYPE } from '../../src/ui/corkboard-layout';
import { corkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

function scene(index: number, changes: Partial<SceneViewModel> = {}): SceneViewModel {
	return {
		id: `scene-${String(index)}`, path: `Project/Scenes/${String(index)}.md`, title: `Scene ${String(index)}`,
		rank: index, progressStatus: 'in-progress', aliases: [], categoryPaths: [],
		povPath: '', povName: '', povMissing: false, times: [], locations: [], characterPaths: [],
		conflict: '', color: null, linkedManuscript: [], worldStatus: [], relationships: [], events: '',
		customFields: '', revision: 'initial', healthIssues: [], readOnly: false, ...changes,
	};
}

function board(
	scenes: SceneViewModel[] = [scene(0), scene(1)],
	dom = new CorkboardDom(),
	characters: ProjectDashboardModel['characters'] = [],
) {
	const memory = corkboardMemory();
	let model = {
		path: 'Project/Project.md', projectId: 'project', locale: 'en', scenes, characters,
		worldbuilding: {}, manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	const resolve = vi.fn((target: string, _source: string): { path: string } | null => ({ path: `${target}.md` }));
	let handle: CorkboardHandle;
	const host = { deleteScene: vi.fn(async () => undefined) };
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: resolve } }, host,
		t: (key: string) => key, model: () => model, activateProject: vi.fn(),
		refresh: async () => { handle.refresh(); }, popover: { closeFilter: vi.fn() },
		memory, remember: vi.fn(),
	} as unknown as CorkboardControls;
	handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	const root = dom.container.querySelector('.snowflake-method-corkboard')!;
	const canvas = root.querySelector('.snowflake-method-corkboard-canvas')!;
	const scroller = root.querySelector('.snowflake-method-corkboard-scroll')!;
	return {
		dom, root, canvas, scroller, handle, memory, resolve, host,
		cards: () => canvas.querySelectorAll('.snowflake-method-corkboard-card'),
		external: (next: SceneViewModel[]) => { model = { ...model, scenes: next }; handle.refresh(); },
	};
}

function event(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

beforeEach(() => { searches.length = 0; menuEntries.length = 0; vi.clearAllMocks(); });

describe('corkboard window and repaint ownership', () => {
	it('moves listeners to the adopted window and cancels pending work through its issuing window', () => {
		const f = board();
		const popout = new CorkboardDom();
		const release = f.dom.windowListeners.get('mouseup')![0]!;
		expect(release.capture).toBe(true);
		expect(f.root.windowMigrationListeners.size).toBe(1);
		searches[0]!('Scene');
		f.scroller.dispatch('scroll');
		expect(f.dom.frames.size).toBe(2);

		f.root.migrateTo(popout);

		expect(f.root.win).toBe(popout.win);
		expect(f.dom.windowListeners.get('mouseup')).toEqual([]);
		expect(popout.windowListeners.get('mouseup')).toEqual([release]);
		expect(f.dom.frames.size).toBe(0);
		searches[0]!('Scene 1');
		f.handle.remeasure();
		expect(popout.frames.size).toBeGreaterThan(0);
		f.handle.dispose();

		for (const window of [f.dom, popout]) {
			expect(window.frames.size).toBe(0);
			for (const type of ['mouseup', 'scroll', 'resize']) expect(window.windowListeners.get(type) ?? []).toEqual([]);
			for (const observer of window.observers) expect(observer.disconnected).toBe(true);
		}
		expect(f.root.windowMigrationListeners.size).toBe(0);
	});

	it('resolves each source/target once per full paint and rereads metadata for unchanged scene objects', () => {
		const dom = new CorkboardDom();
		dom.height = 5_000;
		const scenes = Array.from({ length: 15 }, (_, index) => scene(index, {
			linkedManuscript: [1, 2, 3].map((chapter) => {
				const target = `Project/Manuscript/Chapter ${String(chapter)}`;
				return { raw: `[[${target}]]`, target, linktext: target, label: `Chapter ${String(chapter)}` };
			}),
		}));
		const f = board(scenes, dom);
		expect(f.cards()).toHaveLength(15);
		expect(f.resolve).toHaveBeenCalledTimes(45);
		expect(new Set(f.resolve.mock.calls.map(([target, source]) => `${source}\0${target}`)).size).toBe(45);
		f.resolve.mockClear();
		f.scroller.dispatch('scroll'); dom.flushFrame();
		expect(f.resolve).not.toHaveBeenCalled();

		f.resolve.mockImplementation(() => null);
		f.handle.refresh();
		expect(f.resolve).toHaveBeenCalledTimes(45);
		for (const chip of f.canvas.querySelectorAll('.snowflake-method-corkboard-link')) {
			expect(chip.classes.has('is-missing')).toBe(true);
		}
		f.handle.dispose();
	});

	it('looks up POVs without scanning the cast once per card', () => {
		const characters = Array.from({ length: 300 }, (_, index) => ({
			id: `character-${String(index)}`, path: `Characters/${String(index)}.md`, name: `Character ${String(index)}`,
			readOnly: false, healthIssues: [],
		})) as unknown as ProjectDashboardModel['characters'];
		const find = vi.spyOn(characters, 'find');
		const f = board(Array.from({ length: 15 }, (_, index) => scene(index, {
			povPath: characters[299]!.path, povName: characters[299]!.name,
		})), new CorkboardDom(), characters);
		f.handle.refresh();
		expect(find).not.toHaveBeenCalled();
		for (const card of f.cards()) expect(card.querySelector('.snowflake-method-corkboard-pov')!.disabled).toBe(false);
		f.handle.dispose(); find.mockRestore();
	});

	it('reuses drag geometry until scrolling, resizing, remeasuring or starting a new drag', () => {
		const f = board();
		const card = f.cards()[0]!;
		const rect = vi.spyOn(f.canvas, 'getBoundingClientRect').mockReturnValue({ height: 600, ...{ left: 0, top: 0 } });
		const dataTransfer = { types: [SCENE_DRAG_TYPE], setData: vi.fn() };
		const dragover = () => event(f.canvas, 'dragover', { clientX: 50, clientY: 50, dataTransfer });
		event(card, 'dragstart', { target: null, dataTransfer });
		for (let index = 0; index < 60; index++) dragover();
		expect(rect).toHaveBeenCalledTimes(1);
		for (const invalidate of [
			() => f.scroller.dispatch('scroll'), () => f.dom.dispatchWindow('scroll'),
			() => f.dom.dispatchWindow('resize'), () => f.handle.remeasure(),
		]) {
			const count = rect.mock.calls.length;
			invalidate(); dragover(); dragover();
			expect(rect).toHaveBeenCalledTimes(count + 1);
		}
		card.dispatch('dragend');
		event(card, 'dragstart', { target: null, dataTransfer }); dragover();
		expect(rect).toHaveBeenCalledTimes(6);
		f.handle.dispose();
	});

	it('allows deleting a scene with damaged markers', async () => {
		const f = board([scene(0, { healthIssues: [{ blocking: true, code: 'missing' }] as SceneViewModel['healthIssues'] })]);
		f.cards()[0]!.querySelector('.snowflake-method-corkboard-more')!.dispatch('click');
		const remove = menuEntries.find((entry) => entry.title === 'actions.delete')!;
		expect(remove.disabled).toBe(false);
		remove.click();
		await vi.waitFor(() => expect(f.host.deleteScene).toHaveBeenCalledWith('scene-0', 'initial', 'Project/Project.md'));
		f.handle.dispose();
	});

	it('closes a color panel when an external edit removes its focused card from the search results', () => {
		const f = board();
		f.memory.query = 'Scene 0'; f.handle.refresh();
		const anchor = f.cards()[0]!.querySelector('.snowflake-method-corkboard-color')!;
		anchor.focus(); anchor.dispatch('click');
		const panel = f.dom.container.querySelector('.snowflake-method-corkboard-color-panel')!;
		expect(panel.isConnected).toBe(true);

		f.external([scene(0, { title: 'Renamed' }), scene(1)]);

		expect(anchor.isConnected).toBe(false);
		expect(panel.isConnected).toBe(false);
		f.handle.dispose();
	});
});
