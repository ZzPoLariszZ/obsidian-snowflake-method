import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import type { NativeGraphOptions, SceneManuscriptGraphMemory } from '../../src/domain';
import {
	buildSceneManuscriptPreset,
	buildSceneManuscriptQuery,
	sceneManuscriptFolders,
	SCENE_MANUSCRIPT_FALLBACK_COLORS,
} from '../../src/ui/native-graph';
import {
	NATIVE_GRAPH_KEEPER_KEY,
	SceneManuscriptGraphKeeper,
	type SceneManuscriptProject,
} from '../../src/ui/scene-manuscript-graph';

/** Obsidian 1.14's own defaults, as `graph.json` holds them before anyone touches the graph. */
const NATIVE_DEFAULTS: Record<string, unknown> = {
	'collapse-filter': true,
	search: '',
	showTags: false,
	showAttachments: false,
	hideUnresolved: false,
	showOrphans: true,
	'collapse-color-groups': true,
	colorGroups: [],
	'collapse-display': true,
	showArrow: false,
	textFadeMultiplier: 0,
	nodeSizeMultiplier: 1,
	lineSizeMultiplier: 1,
	'collapse-forces': true,
	centerStrength: 0.518713248970312,
	repelStrength: 10,
	linkStrength: 1,
	linkDistance: 250,
	scale: 1,
	close: false,
};

/** The user's own options: a search of their own, which every test expects back. */
const USERS_OWN: Record<string, unknown> = { ...NATIVE_DEFAULTS, search: 'tag:#mine', repelStrength: 12 };

const DEMO: SceneManuscriptProject = {
	projectFile: 'Demo/001_Project_Metadata.md',
	rootPath: 'Demo',
	locale: 'en',
	readOnly: false,
};
const OTHER: SceneManuscriptProject = {
	projectFile: 'Other/001_Project_Metadata.md',
	rootPath: 'Other',
	locale: 'en',
	readOnly: false,
};

const PRESET_QUERY = buildSceneManuscriptQuery(sceneManuscriptFolders(DEMO));

interface FakeView {
	getViewType(): string;
	dataEngine?: { getOptions: () => Record<string, unknown>; setOptions: (next: Record<string, unknown>) => void };
	register(callback: () => void): void;
	unload(): void;
}

interface FakeLeaf {
	id: string;
	view: FakeView;
	setViewState(state: { type: string }): Promise<void>;
}

/**
 * As much of the app as the keeper touches: a workspace of leaves found by
 * id, the graph core plugin with its global options, and local storage. A
 * graph view's engine copies the global options when it opens and writes
 * every set back to them, as the native engine does.
 */
function fakeApp(options: { enabled?: boolean; graphViews?: boolean } = {}) {
	const enabled = options.enabled ?? true;
	const instance = { options: { ...USERS_OWN }, saveOptions: vi.fn() };
	const leaves = new Map<string, FakeLeaf>();
	const handlers = new Map<string, Set<(...args: unknown[]) => unknown>>();
	const storage = new Map<string, unknown>();
	let sequence = 0;
	const emptyView = (): FakeView => ({
		getViewType: () => 'empty',
		register: () => undefined,
		unload: () => undefined,
	});
	const graphView = (): FakeView => {
		const held: Record<string, unknown> = { ...instance.options };
		const cleanups: (() => void)[] = [];
		return {
			getViewType: () => 'graph',
			dataEngine: {
				getOptions: () => ({ ...held }),
				setOptions: vi.fn((next: Record<string, unknown>) => {
					Object.assign(held, next);
					instance.options = { ...held };
					instance.saveOptions();
				}),
			},
			register: (callback) => {
				cleanups.push(callback);
			},
			unload: () => {
				while (cleanups.length > 0) cleanups.pop()!();
			},
		};
	};
	const newLeaf = (): FakeLeaf => {
		const id = `leaf-${++sequence}`;
		const leaf: FakeLeaf = {
			id,
			view: emptyView(),
			setViewState: (state) => {
				leaf.view = state.type === 'graph' && options.graphViews !== false ? graphView() : emptyView();
				return Promise.resolve();
			},
		};
		leaves.set(id, leaf);
		return leaf;
	};
	const fire = (name: string, ...args: unknown[]): void => {
		for (const handler of handlers.get(name) ?? []) handler(...args);
	};
	const app = {
		workspace: {
			getLeaf: vi.fn(() => newLeaf()),
			getLeafById: (id: string) => leaves.get(id) ?? null,
			revealLeaf: vi.fn(() => Promise.resolve()),
			getLeavesOfType: (type: string) => [...leaves.values()].filter((leaf) => leaf.view.getViewType() === type),
			on: (name: string, handler: (...args: unknown[]) => unknown) => {
				handlers.set(name, new Set([...(handlers.get(name) ?? []), handler]));
				return { name, handler };
			},
			offref: (ref: { name: string; handler: (...args: unknown[]) => unknown }) => {
				handlers.get(ref.name)?.delete(ref.handler);
			},
		},
		internalPlugins: {
			getEnabledPluginById: (id: string) => (enabled && id === 'graph' ? instance : null),
			on: (name: string, handler: (...args: unknown[]) => unknown) => {
				handlers.set(`plugins:${name}`, new Set([...(handlers.get(`plugins:${name}`) ?? []), handler]));
				return { name: `plugins:${name}`, handler };
			},
			offref: (ref: { name: string; handler: (...args: unknown[]) => unknown }) => {
				handlers.get(ref.name)?.delete(ref.handler);
			},
		},
		loadLocalStorage: (key: string) => storage.get(key) ?? null,
		saveLocalStorage: (key: string, value: unknown) => {
			if (value === null) storage.delete(key);
			else storage.set(key, value);
		},
	};
	/** Closes a leaf as Obsidian does: the view unloads, the leaf goes, the layout changes. */
	const close = (leaf: FakeLeaf): void => {
		leaf.view.unload();
		leaves.delete(leaf.id);
		leaf.view = emptyView();
		fire('layout-change');
	};
	/** A graph tab of the user's own. */
	const openOwnGraph = async (): Promise<FakeLeaf> => {
		const leaf = newLeaf();
		await leaf.setViewState({ type: 'graph' });
		fire('layout-change');
		return leaf;
	};
	const engineOf = (leaf: FakeLeaf) => leaf.view.dataEngine!;
	const stored = () => storage.get(NATIVE_GRAPH_KEEPER_KEY) as { before: unknown; leaves: Record<string, unknown> } | undefined;
	return { app, instance, leaves, storage, fire, close, openOwnGraph, newLeaf, engineOf, stored };
}

function keeperFor(fake: ReturnType<typeof fakeApp>, held: SceneManuscriptGraphMemory | null = null) {
	const stored = vi.fn(() => Promise.resolve(held));
	const store = vi.fn(() => Promise.resolve('written' as const));
	const clear = vi.fn(() => Promise.resolve('written' as const));
	const timers: (() => void)[] = [];
	const later = vi.fn((callback: () => void) => {
		timers.push(callback);
		return () => {
			const at = timers.indexOf(callback);
			if (at >= 0) timers.splice(at, 1);
		};
	});
	const fail = vi.fn();
	const keeper = new SceneManuscriptGraphKeeper({
		app: fake.app as unknown as App,
		stored,
		store,
		clear,
		colors: () => SCENE_MANUSCRIPT_FALLBACK_COLORS,
		later,
		fail,
	});
	return {
		keeper,
		stored,
		store,
		clear,
		later,
		fail,
		/** Runs every timer that is due. */
		tick: () => {
			for (const callback of timers.splice(0)) callback();
		},
	};
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const lastLeaf = (fake: ReturnType<typeof fakeApp>): FakeLeaf => {
	const all = [...fake.leaves.values()];
	return all[all.length - 1]!;
};

describe('opening the scenes and manuscript graph', () => {
	it('says the plugin is off and opens nothing', async () => {
		const fake = fakeApp({ enabled: false });
		const { keeper } = keeperFor(fake);
		keeper.start();
		expect(keeper.available()).toBe(false);
		expect(await keeper.open(DEMO)).toBe('disabled');
		expect(fake.app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(fake.stored()).toBeUndefined();
	});

	it('captures the options as they stand and opens a graph tab that loads with the preset', async () => {
		const fake = fakeApp();
		const { keeper, stored } = keeperFor(fake);
		keeper.start();
		const changes = vi.fn();
		keeper.subscribe(changes);
		expect(await keeper.open(DEMO)).toBe('opened');
		const leaf = lastLeaf(fake);
		expect(leaf.view.getViewType()).toBe('graph');
		expect(fake.engineOf(leaf).getOptions().search).toBe(PRESET_QUERY);
		expect(fake.engineOf(leaf).getOptions().showArrow).toBe(true);
		// The view took the options from the plugin as it loaded, so none were set on it after.
		expect(fake.engineOf(leaf).setOptions).not.toHaveBeenCalled();
		expect(fake.instance.options.search).toBe(PRESET_QUERY);
		expect(stored).toHaveBeenCalledWith(DEMO);
		expect(keeper.isOpen(DEMO.projectFile)).toBe(true);
		expect(keeper.isOpen(OTHER.projectFile)).toBe(false);
		expect(changes).toHaveBeenCalledOnce();
		const kept = fake.stored()!;
		expect(kept.before).toMatchObject({ search: 'tag:#mine', repelStrength: 12 });
		expect(kept.leaves).toEqual({ [leaf.id]: DEMO });
	});

	it('brings the tab already showing the project to the front instead of opening another', async () => {
		const fake = fakeApp();
		const { keeper } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		expect(await keeper.open(DEMO)).toBe('revealed');
		expect(fake.app.workspace.getLeaf).toHaveBeenCalledOnce();
		expect(fake.app.workspace.revealLeaf).toHaveBeenCalledWith(lastLeaf(fake));
		// Another project gets a tab of its own, and the capture stays the first one.
		expect(await keeper.open(OTHER)).toBe('opened');
		expect(fake.app.workspace.getLeaf).toHaveBeenCalledTimes(2);
		expect(fake.stored()!.before).toMatchObject({ search: 'tag:#mine' });
		expect(Object.keys(fake.stored()!.leaves)).toHaveLength(2);
	});

	it('sets the options the file remembers, re-prefixed for a moved root, instead of the preset', async () => {
		const fake = fakeApp();
		const remembered: NativeGraphOptions = {
			...buildSceneManuscriptPreset({ rootPath: 'Old', locale: 'en' }, SCENE_MANUSCRIPT_FALLBACK_COLORS),
			repelStrength: 4,
			scale: 0.5,
		};
		const { keeper } = keeperFor(fake, { options: remembered, rootPath: 'Old', updatedAt: 1 });
		keeper.start();
		await keeper.open(DEMO);
		const options = fake.engineOf(lastLeaf(fake)).getOptions();
		expect(options.search).toBe(PRESET_QUERY);
		expect(options.repelStrength).toBe(4);
		expect(options.scale).toBe(0.5);
		expect((options.colorGroups as { query: string }[]).map((group) => group.query)).toEqual([
			'path:"Demo/40_Scene"',
			'path:"Demo/50_Manuscript"',
		]);
	});

	it('leaves a tab whose view it does not know as a plain graph and keeps nothing', async () => {
		const fake = fakeApp({ graphViews: false });
		const { keeper } = keeperFor(fake);
		keeper.start();
		expect(await keeper.open(DEMO)).toBe('unavailable');
		expect(fake.app.workspace.getLeaf).toHaveBeenCalledOnce();
		// The options set for the view to load with are put back, since nothing loaded with them.
		expect(fake.instance.options).toEqual(USERS_OWN);
		expect(fake.instance.saveOptions).not.toHaveBeenCalled();
		expect(fake.stored()).toBeUndefined();
		expect(keeper.isOpen(DEMO.projectFile)).toBe(false);
	});
});

describe('closing the scenes and manuscript graph', () => {
	it('keeps what the tab held for the project and gives the user their options back', async () => {
		const fake = fakeApp();
		const { keeper, store } = keeperFor(fake);
		keeper.start();
		const changes = vi.fn();
		keeper.subscribe(changes);
		await keeper.open(DEMO);
		const leaf = lastLeaf(fake);
		fake.engineOf(leaf).setOptions({ repelStrength: 3, scale: 2 });
		fake.instance.saveOptions.mockClear();
		fake.close(leaf);
		await settle();
		expect(store).toHaveBeenCalledOnce();
		const [project, kept] = store.mock.calls[0] as unknown as [SceneManuscriptProject, NativeGraphOptions];
		expect(project).toEqual(DEMO);
		expect(kept.search).toBe(PRESET_QUERY);
		expect(kept.repelStrength).toBe(3);
		expect(kept.scale).toBe(2);
		expect(fake.instance.options).toEqual(USERS_OWN);
		expect(fake.instance.saveOptions).toHaveBeenCalledOnce();
		expect(fake.stored()).toBeUndefined();
		expect(keeper.isOpen(DEMO.projectFile)).toBe(false);
		expect(changes).toHaveBeenCalledTimes(2);
	});

	it('keeps the user options alone when a tab of their own changed them since', async () => {
		const fake = fakeApp();
		const { keeper, store } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		const ours = lastLeaf(fake);
		const theirs = await fake.openOwnGraph();
		fake.engineOf(theirs).setOptions({ linkDistance: 99 });
		fake.instance.saveOptions.mockClear();
		fake.close(ours);
		await settle();
		// Ours held the preset to the end, so the file has nothing to keep.
		expect(store).not.toHaveBeenCalled();
		expect(fake.instance.options.linkDistance).toBe(99);
		expect(fake.instance.saveOptions).not.toHaveBeenCalled();
		expect(fake.stored()).toBeUndefined();
	});

	it('sets the restored options on a graph tab of the user that is still open', async () => {
		const fake = fakeApp();
		const { keeper } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		const ours = lastLeaf(fake);
		const theirs = await fake.openOwnGraph();
		expect(fake.engineOf(theirs).getOptions().search).toBe(PRESET_QUERY);
		fake.close(ours);
		await settle();
		expect(fake.engineOf(theirs).getOptions().search).toBe('tag:#mine');
		expect(fake.instance.options.search).toBe('tag:#mine');
	});

	it('waits for the last of its tabs before restoring', async () => {
		const fake = fakeApp();
		const { keeper } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		const first = lastLeaf(fake);
		await keeper.open(OTHER);
		const second = lastLeaf(fake);
		fake.close(first);
		await settle();
		expect(fake.instance.options.search).not.toBe('tag:#mine');
		expect(Object.keys(fake.stored()!.leaves)).toEqual([second.id]);
		fake.close(second);
		await settle();
		expect(fake.instance.options.search).toBe('tag:#mine');
		expect(fake.stored()).toBeUndefined();
	});

	it('writes nothing for a read-only project but still restores', async () => {
		const fake = fakeApp();
		const { keeper, store, clear } = keeperFor(fake);
		keeper.start();
		await keeper.open({ ...DEMO, readOnly: true });
		fake.engineOf(lastLeaf(fake)).setOptions({ repelStrength: 3 });
		fake.close(lastLeaf(fake));
		await settle();
		expect(store).not.toHaveBeenCalled();
		expect(clear).not.toHaveBeenCalled();
		expect(fake.instance.options.search).toBe('tag:#mine');
	});

	it('takes the options down after the layout settles, and only what changed is for the store to see', async () => {
		const fake = fakeApp();
		const { keeper, store, later, tick } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		fake.engineOf(lastLeaf(fake)).setOptions({ nodeSizeMultiplier: 2 });
		fake.fire('layout-change');
		fake.fire('layout-change');
		expect(later).toHaveBeenCalledTimes(2);
		expect(store).not.toHaveBeenCalled();
		tick();
		await settle();
		expect(store).toHaveBeenCalledOnce();
		expect((store.mock.calls[0] as unknown as [unknown, NativeGraphOptions])[1].nodeSizeMultiplier).toBe(2);
		// Unchanged since, the next settle writes nothing.
		fake.fire('layout-change');
		tick();
		await settle();
		expect(store).toHaveBeenCalledOnce();
	});
});

describe('what the file remembers', () => {
	it('keeps nothing while the tab holds the preset, and lets a remembered set go once it is back on it', async () => {
		const fake = fakeApp();
		const { keeper, store, clear, tick } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		const leaf = lastLeaf(fake);
		fake.fire('layout-change');
		tick();
		await settle();
		expect(store).not.toHaveBeenCalled();
		expect(clear).not.toHaveBeenCalled();
		fake.engineOf(leaf).setOptions({ repelStrength: 3, scale: 0.5 });
		fake.fire('layout-change');
		tick();
		await settle();
		expect(store).toHaveBeenCalledOnce();
		// Back on the preset, at whatever zoom, the file is cleared rather than left holding it.
		fake.engineOf(leaf).setOptions({ repelStrength: 10, scale: 2 });
		fake.fire('layout-change');
		tick();
		await settle();
		expect(clear).toHaveBeenCalledWith(DEMO);
		expect(clear).toHaveBeenCalledOnce();
		expect(store).toHaveBeenCalledOnce();
	});

	it('clears a file that holds the preset on the first settle', async () => {
		const fake = fakeApp();
		const preset = buildSceneManuscriptPreset(DEMO, SCENE_MANUSCRIPT_FALLBACK_COLORS);
		const { keeper, store, clear, tick } = keeperFor(fake, { options: preset, rootPath: 'Demo', updatedAt: 1 });
		keeper.start();
		await keeper.open(DEMO);
		fake.fire('layout-change');
		tick();
		await settle();
		expect(clear).toHaveBeenCalledOnce();
		expect(store).not.toHaveBeenCalled();
	});

	it('takes the options down as soon as the user leaves the tab, and once for the same options', async () => {
		const fake = fakeApp();
		const { keeper, store, later } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		const ours = lastLeaf(fake);
		fake.engineOf(ours).setOptions({ nodeSizeMultiplier: 2 });
		// Becoming active is not leaving.
		fake.fire('active-leaf-change', ours);
		await settle();
		expect(store).not.toHaveBeenCalled();
		const note = fake.newLeaf();
		fake.fire('active-leaf-change', note);
		await settle();
		expect(store).toHaveBeenCalledOnce();
		expect((store.mock.calls[0] as unknown as [unknown, NativeGraphOptions])[1].nodeSizeMultiplier).toBe(2);
		expect(later).not.toHaveBeenCalled();
		fake.fire('active-leaf-change', ours);
		fake.fire('active-leaf-change', note);
		await settle();
		expect(store).toHaveBeenCalledOnce();
	});
});

describe('resetting the scenes and manuscript graph', () => {
	it('clears the file and sets the preset on the open tab, and writes nothing back for it', async () => {
		const fake = fakeApp();
		const remembered: NativeGraphOptions = {
			...buildSceneManuscriptPreset(DEMO, SCENE_MANUSCRIPT_FALLBACK_COLORS),
			repelStrength: 4,
		};
		const { keeper, clear, store, tick } = keeperFor(fake, { options: remembered, rootPath: 'Demo', updatedAt: 1 });
		keeper.start();
		await keeper.open(DEMO);
		expect(fake.engineOf(lastLeaf(fake)).getOptions().repelStrength).toBe(4);
		expect(await keeper.reset(DEMO)).toBe('written');
		expect(clear).toHaveBeenCalledWith(DEMO);
		expect(fake.engineOf(lastLeaf(fake)).getOptions().repelStrength).toBe(10);
		fake.fire('layout-change');
		tick();
		await settle();
		expect(store).not.toHaveBeenCalled();
		expect(clear).toHaveBeenCalledOnce();
	});

	it('hands a refusal back and touches no tab', async () => {
		const fake = fakeApp();
		const { keeper, clear } = keeperFor(fake);
		clear.mockResolvedValue('refused' as never);
		keeper.start();
		await keeper.open(DEMO);
		fake.engineOf(lastLeaf(fake)).setOptions({ repelStrength: 4 });
		expect(await keeper.reset(DEMO)).toBe('refused');
		expect(fake.engineOf(lastLeaf(fake)).getOptions().repelStrength).toBe(4);
	});
});

describe('a run cut short', () => {
	it('takes the stored leaves up again by id and sets the project options afresh', async () => {
		const fake = fakeApp();
		const leaf = fake.newLeaf();
		await leaf.setViewState({ type: 'graph' });
		// The restart loaded the engine with the user's own options again.
		fake.storage.set(NATIVE_GRAPH_KEEPER_KEY, { before: { ...USERS_OWN }, leaves: { [leaf.id]: DEMO } });
		const { keeper } = keeperFor(fake);
		keeper.start();
		await settle();
		expect(keeper.isOpen(DEMO.projectFile)).toBe(true);
		expect(fake.engineOf(leaf).getOptions().search).toBe(PRESET_QUERY);
		expect(fake.stored()!.leaves).toEqual({ [leaf.id]: DEMO });
		fake.close(leaf);
		await settle();
		expect(fake.instance.options).toEqual(USERS_OWN);
		expect(fake.stored()).toBeUndefined();
	});

	it('leaves a taken-up tab alone when it already shows the project', async () => {
		const fake = fakeApp();
		// The restart loaded the engine with the project's options, which the view had written through.
		fake.instance.options = { ...USERS_OWN, ...buildSceneManuscriptPreset(DEMO, SCENE_MANUSCRIPT_FALLBACK_COLORS) };
		const leaf = fake.newLeaf();
		await leaf.setViewState({ type: 'graph' });
		fake.storage.set(NATIVE_GRAPH_KEEPER_KEY, { before: { ...USERS_OWN }, leaves: { [leaf.id]: DEMO } });
		const { keeper } = keeperFor(fake);
		keeper.start();
		await settle();
		expect(keeper.isOpen(DEMO.projectFile)).toBe(true);
		// Set again, the engine would search the vault again for the same picture.
		expect(fake.engineOf(leaf).setOptions).not.toHaveBeenCalled();
		expect(fake.engineOf(leaf).getOptions().search).toBe(PRESET_QUERY);
		fake.close(leaf);
		await settle();
		expect(fake.instance.options).toEqual(USERS_OWN);
	});

	it('gives the captured options back when none of the stored leaves is alive', () => {
		const fake = fakeApp();
		fake.instance.options = { ...USERS_OWN, search: PRESET_QUERY };
		fake.storage.set(NATIVE_GRAPH_KEEPER_KEY, { before: { ...USERS_OWN }, leaves: { 'leaf-9': DEMO } });
		const { keeper } = keeperFor(fake);
		keeper.start();
		expect(fake.instance.options).toEqual(USERS_OWN);
		expect(fake.instance.saveOptions).toHaveBeenCalledOnce();
		expect(fake.stored()).toBeUndefined();
	});

	it('ignores a stored leaf that no longer shows a graph', async () => {
		const fake = fakeApp();
		const leaf = fake.newLeaf();
		fake.storage.set(NATIVE_GRAPH_KEEPER_KEY, { before: { ...USERS_OWN }, leaves: { [leaf.id]: DEMO } });
		const { keeper } = keeperFor(fake);
		keeper.start();
		await settle();
		expect(keeper.isOpen(DEMO.projectFile)).toBe(false);
		expect(fake.stored()).toBeUndefined();
	});

	it('keeps the capture while the plugin is off, for a run that has it again', () => {
		const fake = fakeApp({ enabled: false });
		fake.storage.set(NATIVE_GRAPH_KEEPER_KEY, { before: { ...USERS_OWN }, leaves: {} });
		const { keeper } = keeperFor(fake);
		keeper.start();
		expect(fake.stored()).toEqual({ before: USERS_OWN, leaves: {} });
	});
});

describe('quitting and unloading', () => {
	it('flushes what is held at quit and leaves the storage for the restart', async () => {
		const fake = fakeApp();
		const { keeper, store } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		fake.engineOf(lastLeaf(fake)).setOptions({ linkDistance: 100 });
		const pending: Promise<unknown>[] = [];
		fake.fire('quit', { add: (work: () => Promise<unknown>) => pending.push(work()) });
		await Promise.all(pending);
		expect(store).toHaveBeenCalledOnce();
		keeper.dispose();
		expect(fake.stored()).toBeDefined();
		expect(fake.instance.options.search).toBe(PRESET_QUERY);
	});

	it('gives the options back at once when the plugin unloads', async () => {
		const fake = fakeApp();
		const { keeper, store } = keeperFor(fake);
		keeper.start();
		await keeper.open(DEMO);
		const leaf = lastLeaf(fake);
		fake.engineOf(leaf).setOptions({ linkDistance: 100 });
		keeper.dispose();
		await settle();
		expect(store).toHaveBeenCalledOnce();
		expect(fake.instance.options).toEqual(USERS_OWN);
		expect(fake.engineOf(leaf).getOptions().search).toBe('tag:#mine');
		expect(fake.stored()).toBeUndefined();
		// The view's own close later is nothing to a disposed keeper.
		fake.close(leaf);
		await settle();
		expect(store).toHaveBeenCalledOnce();
	});
});

describe('following the core plugins', () => {
	it('tells its listeners when a core plugin is turned on or off, and stops once disposed', () => {
		const fake = fakeApp();
		const { keeper } = keeperFor(fake);
		keeper.start();
		const changes = vi.fn();
		keeper.subscribe(changes);
		fake.fire('plugins:change');
		expect(changes).toHaveBeenCalledTimes(1);
		keeper.dispose();
		fake.fire('plugins:change');
		expect(changes).toHaveBeenCalledTimes(1);
	});
});
