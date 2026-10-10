import { afterEach, describe, expect, it, vi } from 'vitest';

// The real plugin starts and stops the explorer tools; the explorer itself
// is the fake the tools' own tests drive, and a component is only what the
// tools' life needs of one: callbacks run once, when it ends.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Component {
		private readonly ending: (() => void)[] = [];
		load(): void {}
		unload(): void {
			for (const callback of this.ending.splice(0).reverse()) callback();
		}
		register(callback: () => void): void {
			this.ending.push(callback);
		}
		registerEvent(): void {}
	}
	return {
		...runtime,
		Component,
		addIcon: (): void => undefined,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import type { Component } from 'obsidian';

import SnowflakeMethodPlugin from '../../src/main';
import type { ExplorerScope } from '../../src/services';
import { DEFAULT_SETTINGS, type SnowflakeSettings } from '../../src/settings';
import { CorkboardDom } from '../helpers/corkboard-dom';
import { FakeApp, FakeBaseItem, FakeExplorerView, FakeFiles, FakeLeaf, settle } from '../helpers/explorer-fake';

const BUTTONS = ['tidy', 'immersive', 'arrange', 'counts'].map((kind) => `snowflake-method-explorer-button-${kind}`);

interface ExplorerHost {
	settings: SnowflakeSettings;
	explorer: unknown;
	startExplorer(): void;
	handleSettingsChanged(key: string): Promise<void>;
}

const hosts: ExplorerHost[] = [];

function host(scope: ExplorerScope) {
	const dom = new CorkboardDom();
	const files = new FakeFiles();
	for (const path of ['Novel/50_Manuscript/Draft.md', 'Novel/00_System/001_Project_Metadata.md']) files.file(path);
	const app = new FakeApp(dom, files);
	Object.assign(app.workspace, { layoutReady: true });
	const view = new FakeExplorerView(dom, files);
	app.leaves.push(new FakeLeaf(view));
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as ExplorerHost;
	Object.assign(plugin, {
		app,
		settings: {
			...DEFAULT_SETTINGS,
			explorerScope: scope,
			explorerTidy: true,
			explorerHidePrefix: true,
			explorerHideFolders: true,
			// No numbers asked for: the count service would reach the projects.
			explorerCounts: false,
			explorerImmersive: false,
			explorerImmersiveFolds: [],
			explorerOrders: {},
		},
		explorer: null,
		explorerLife: null,
		explorerRoots: new Set(['Novel']),
		globalT: (key: string) => key,
		addChild: (child: Component) => {
			child.load();
			return child;
		},
		removeChild: (child: Component) => {
			child.unload();
			return child;
		},
	});
	hosts.push(plugin);
	const buttons = (): string[] =>
		view.buttonsEl.children.map(
			(button) => [...button.classes].find((cls) => cls.startsWith('snowflake-method-explorer-button-')) ?? '',
		);
	const shownName = (path: string): string | null => view.fileItems[path]?.innerEl.textContent ?? null;
	return { dom, view, plugin, buttons, shownName };
}

afterEach(async () => {
	for (const plugin of hosts.splice(0)) {
		plugin.settings.explorerScope = 'off';
		await plugin.handleSettingsChanged('explorerScope');
	}
});

describe('the explorer tools and their scope', () => {
	it('stays away from the explorer while the scope is off, whatever else changes', async () => {
		const updateTitle: unknown = Reflect.get(FakeBaseItem.prototype, 'updateTitle');
		const { dom, view, plugin, buttons, shownName } = host('off');
		// The explorer draws its rows whether or not anything dresses them.
		view.requestSort();
		plugin.startExplorer();
		await plugin.handleSettingsChanged('explorerTidy');
		await settle(dom);
		expect(plugin.explorer).toBeNull();
		expect(buttons()).toEqual([]);
		expect(shownName('Novel/50_Manuscript')).toBe('50_Manuscript');
		expect(view.renderedPaths()).toContain('Novel/00_System');
		// Not so much as a patch on the explorer's own rows.
		expect(Reflect.get(FakeBaseItem.prototype, 'updateTitle')).toBe(updateTitle);
	});

	it('comes back whole when the scope does, and goes again, buttons and all, when it is turned off', async () => {
		const updateTitle: unknown = Reflect.get(FakeBaseItem.prototype, 'updateTitle');
		const { dom, view, plugin, buttons, shownName } = host('off');
		plugin.startExplorer();
		plugin.settings.explorerScope = 'projects';
		await plugin.handleSettingsChanged('explorerScope');
		await settle(dom);
		expect(plugin.explorer).not.toBeNull();
		expect(buttons()).toEqual(BUTTONS);
		expect(shownName('Novel/50_Manuscript')).toBe('Manuscript');
		expect(view.renderedPaths()).not.toContain('Novel/00_System');

		plugin.settings.explorerScope = 'off';
		await plugin.handleSettingsChanged('explorerScope');
		await settle(dom);
		expect(plugin.explorer).toBeNull();
		expect(buttons()).toEqual([]);
		expect(shownName('Novel/50_Manuscript')).toBe('50_Manuscript');
		expect(view.renderedPaths()).toContain('Novel/00_System');
		expect(Reflect.get(FakeBaseItem.prototype, 'updateTitle')).toBe(updateTitle);
	});

	it('repaints rather than starts again when the scope moves between projects and the whole vault', async () => {
		const { dom, plugin, buttons } = host('projects');
		plugin.startExplorer();
		await settle(dom);
		const first = plugin.explorer;
		plugin.settings.explorerScope = 'vault';
		await plugin.handleSettingsChanged('explorerScope');
		await settle(dom);
		expect(plugin.explorer).toBe(first);
		expect(buttons()).toEqual(BUTTONS);
	});
});
