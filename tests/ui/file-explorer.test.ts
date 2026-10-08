import { afterEach, describe, expect, it, vi } from 'vitest';

// The explorer's menu reaches the move dialogs, which extend classes the
// runtime stub leaves out; nothing here ever opens one.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import type { App, Component } from 'obsidian';

import type { ExplorerOrders } from '../../src/domain';
import { projectRootContaining } from '../../src/project-root';
import { ExplorerEnhancer, type ExplorerSettingsView } from '../../src/ui/file-explorer';
import { CorkboardDom } from '../helpers/corkboard-dom';
import {
	FakeApp,
	FakeBaseItem,
	FakeExplorerView,
	FakeFiles,
	FakeLeaf,
	FakePlugin,
	settle,
} from '../helpers/explorer-fake';

const BADGE = '.snowflake-method-explorer-count';

interface HarnessOptions {
	files: string[];
	roots?: string[];
	settings?: Partial<ExplorerSettingsView>;
	totals?: Record<string, number | null>;
	ready?: boolean;
	deferred?: boolean;
}

function harness(options: HarnessOptions) {
	const dom = new CorkboardDom();
	Object.assign(dom.doc, { querySelector: (selector: string) => dom.container.querySelector(selector) });
	const files = new FakeFiles();
	for (const path of options.files) {
		if (path.endsWith('/')) files.folder(path.slice(0, -1));
		else files.file(path);
	}
	const app = new FakeApp(dom, files);
	const view = new FakeExplorerView(dom, files);
	view.ready = options.ready ?? true;
	app.leaves.push(new FakeLeaf(view, options.deferred ?? false));
	const settings: ExplorerSettingsView = {
		explorerScope: 'projects',
		explorerTidy: true,
		explorerCounts: true,
		explorerHidePrefix: true,
		explorerHideFiles: true,
		explorerHiddenFiles: '',
		explorerHideFolders: true,
		explorerHiddenFolders: '',
		explorerNoteCounts: true,
		explorerFolderCounts: true,
		explorerOrders: {},
		...options.settings,
	};
	const plugin = new FakePlugin();
	const saved: ExplorerOrders[] = [];
	const toggles: [string, boolean][] = [];
	const notices: string[] = [];
	const roots = options.roots ?? ['Novel'];
	const totals = options.totals ?? {};
	const enhancer = new ExplorerEnhancer({
		app: app as unknown as App,
		plugin: plugin as unknown as Component,
		t: (key) => key,
		settings: () => settings,
		saveOrders: (next) => {
			settings.explorerOrders = next;
			saved.push(next);
		},
		saveToggle: (key, value) => {
			settings[key] = value;
			toggles.push([key, value]);
		},
		projectRootOf: (path) => projectRootContaining(path, roots),
		countNote: async (path) => totals[path] ?? null,
		noteCounted: () => undefined,
		breathe: async () => undefined,
		locale: () => 'en-US',
		notice: (text) => notices.push(text),
	});
	cleanups.push(() => enhancer.dispose());
	const badgeOf = (path: string): string | null =>
		view.fileItems[path]?.selfEl.querySelector(BADGE)?.textContent ?? null;
	const buttons = (): string[] =>
		view.buttonsEl.children.map((button) => [...button.classes].find((cls) => cls.startsWith('snowflake-method-explorer-button-')) ?? '');
	return { dom, files, app, view, settings, plugin, saved, toggles, notices, totals, enhancer, badgeOf, buttons };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('the explorer tools', () => {
	it('dresses an open explorer with three buttons and leaves a deferred one alone', () => {
		const open = harness({ files: ['Novel/50_Manuscript/Draft.md'] });
		open.enhancer.start();
		expect(open.buttons()).toEqual([
			'snowflake-method-explorer-button-tidy',
			'snowflake-method-explorer-button-arrange',
			'snowflake-method-explorer-button-counts',
		]);
		const tidy = open.view.buttonsEl.children[0];
		expect(tidy?.classes.has('is-active')).toBe(true);
		expect(tidy?.getAttribute('aria-label')).toBe('explorer.tidyOn\nexplorer.tidyTurnOff');
		expect(open.view.registered).toHaveLength(1);

		const deferred = harness({ files: ['Novel/50_Manuscript/Draft.md'], deferred: true });
		deferred.enhancer.start();
		expect(deferred.buttons()).toEqual([]);
	});

	it('leaves the scaffolding out of the tree, inside projects only, and keeps a row being renamed', () => {
		const { enhancer, view, files } = harness({
			files: [
				'Novel/00_System/001_Project_Metadata.md',
				'Novel/10_Summary/11_One_Sentence_Summary.md',
				'Novel/20_Character/Alice.md',
				'Novel/20_Character/21_Category/Major/Major.md',
				'Novel/70_Tool/72_Task_Management/721_Task/tasks.json',
				'Novel/90_Archive/',
				'Inbox/00_System/x.md',
			],
		});
		enhancer.start();
		const shown = view.renderedPaths();
		expect(shown).toContain('Novel/10_Summary');
		expect(shown).toContain('Novel/20_Character/Alice.md');
		expect(shown).toContain('Novel/90_Archive');
		expect(shown).toContain('Inbox/00_System');
		expect(shown).not.toContain('Novel/00_System');
		expect(shown).not.toContain('Novel/20_Character/21_Category');
		expect(shown).not.toContain('Novel/70_Tool');

		view.fileBeingRenamed = files.get('Novel/00_System');
		view.requestSort();
		expect(view.renderedPaths()).toContain('Novel/00_System');
		view.fileBeingRenamed = null;

		enhancer.setTidy(false);
		expect(view.renderedPaths()).toContain('Novel/00_System');
		expect(view.renderedPaths()).toContain('Novel/70_Tool/72_Task_Management/721_Task/tasks.json');
	});

	it('shows tidy names and gives the rename box the real one, on Enter and on Escape alike', () => {
		const { enhancer, view, files, app } = harness({ files: ['Novel/50_Manuscript/Draft.md', 'Inbox/01_Notes/a.md'] });
		enhancer.start();
		const folder = files.get('Novel/50_Manuscript');
		if (folder === null) throw new Error('no folder');
		const item = view.fileItems['Novel/50_Manuscript'];
		if (item === undefined) throw new Error('no item');
		expect(item.innerEl.textContent).toBe('Manuscript');
		expect(view.fileItems['Novel/50_Manuscript/Draft.md']?.innerEl.textContent).toBe('Draft');
		// Outside the projects, nothing is touched.
		expect(view.fileItems['Inbox/01_Notes']?.innerEl.textContent).toBe('01_Notes');

		// Escape: the box opened on the real name and the dress came back.
		view.startRenameFile(folder);
		expect(item.selectedText).toBe('50_Manuscript');
		expect(item.innerEl.textContent).toBe('50_Manuscript');
		item.updateTitle();
		expect(item.innerEl.textContent).toBe('50_Manuscript');
		view.exitRename();
		expect(item.innerEl.textContent).toBe('Manuscript');

		// Enter: the typed name is what the vault is told, and the dress follows the new name.
		view.startRenameFile(folder);
		item.innerEl.setText(['51', 'Manuscript'].join('_'));
		const typed = item.innerEl.textContent;
		const oldPath = files.rename(folder, `Novel/${typed}`);
		app.vault.trigger('rename', folder, oldPath);
		view.onRename(folder, oldPath);
		expect(item.innerEl.textContent).toBe('51_Manuscript');
		view.exitRename();
		expect(item.innerEl.textContent).toBe('Manuscript');
		expect(item.selfEl.getAttribute('data-path')).toBe('Novel/51_Manuscript');
	});

	it("lists a folder in the author's order, files and folders mixed, with the rest after in Obsidian's", () => {
		const { enhancer, view, files, settings } = harness({
			files: ['Novel/10_Summary/', 'Novel/30_Synopsis/', 'Novel/Draft.md', 'Novel/Notes.md', 'Zed/', 'Novel/'],
			settings: { explorerOrders: { Novel: ['Notes.md', '30_Synopsis'], '': ['Zed', 'Novel'] } },
		});
		enhancer.start();
		const novel = files.get('Novel');
		if (novel === null) throw new Error('no folder');
		const names = (folder: typeof novel): string[] =>
			view.getSortedFolderItems(folder as never).map((item) => item.file.name);
		expect(names(novel)).toEqual(['Notes.md', '30_Synopsis', '10_Summary', 'Draft.md']);
		// The Vault root is outside the projects' scope, so its record waits for the whole-vault scope.
		expect(names(files.root)).toEqual(['Novel', 'Zed']);
		settings.explorerScope = 'vault';
		enhancer.settingsChanged('explorerScope');
		expect(names(files.root)).toEqual(['Zed', 'Novel']);
	});

	it('paints the counts of the rows on screen and keeps them current', async () => {
		const { enhancer, view, files, app, dom, totals, badgeOf } = harness({
			files: ['Novel/a.md', 'Novel/Deep/b.md', 'Novel/00_System/001_Project_Metadata.md', 'Novel/map.canvas'],
			totals: { 'Novel/a.md': 120, 'Novel/Deep/b.md': 30, 'Novel/00_System/001_Project_Metadata.md': 999 },
		});
		enhancer.start();
		await settle(dom);
		expect(badgeOf('Novel/a.md')).toBe('120');
		expect(badgeOf('Novel/Deep')).toBe('30');
		expect(badgeOf('Novel')).toBe('150');
		expect(badgeOf('Novel/map.canvas')).toBeNull();
		expect(view.fileItems['Novel/00_System/001_Project_Metadata.md']?.selfEl.querySelector(BADGE)).toBeNull();

		const note = files.get('Novel/a.md');
		if (note === null || !('stat' in note)) throw new Error('no note');
		files.touch(note, 2);
		totals['Novel/a.md'] = 200;
		app.vault.trigger('modify', note);
		await settle(dom);
		expect(badgeOf('Novel/a.md')).toBe('200');
		expect(badgeOf('Novel')).toBe('230');

		enhancer.setCounts(false);
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-counts-off')).toBe(true);
		expect(badgeOf('Novel/a.md')).toBeNull();
	});

	it('keeps the orders in step with renames and deletes, and prunes what is gone at the start', () => {
		const { enhancer, files, app, saved, settings } = harness({
			files: ['Novel/a.md', 'Novel/b.md'],
			settings: { explorerOrders: { Novel: ['b.md', 'a.md', 'gone.md'], Elsewhere: ['x.md'] } },
		});
		enhancer.start();
		expect(settings.explorerOrders).toEqual({ Novel: ['b.md', 'a.md'] });
		const a = files.get('Novel/a.md');
		const b = files.get('Novel/b.md');
		if (a === null || b === null) throw new Error('no notes');
		const oldPath = files.rename(a, 'Novel/c.md');
		app.vault.trigger('rename', a, oldPath);
		expect(settings.explorerOrders).toEqual({ Novel: ['b.md', 'c.md'] });
		files.remove(b);
		app.vault.trigger('delete', b);
		expect(settings.explorerOrders).toEqual({ Novel: ['c.md'] });
		expect(saved).toHaveLength(3);
	});

	it('turns arrange mode on with one hint, offers the move menu, and turns it off again', () => {
		const { enhancer, view, files, notices, settings } = harness({ files: ['Novel/a.md', 'Novel/b.md', 'Inbox/x.md'] });
		enhancer.start();
		expect(enhancer.toggleArrange()).toBe(true);
		expect(notices).toEqual(['explorer.arrangeHint']);
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-arranging')).toBe(true);
		const a = files.get('Novel/a.md');
		const x = files.get('Inbox/x.md');
		if (a === null || x === null) throw new Error('no notes');
		expect(enhancer.arrangeMenu(a)).not.toBeNull();
		expect(enhancer.arrangeMenu(x)).toBeNull();
		// The grips stand on the rows the mode reaches.
		expect(view.fileItems['Novel/a.md']?.selfEl.querySelector('.snowflake-method-explorer-grip')).not.toBeNull();
		expect(view.fileItems['Inbox/x.md']?.selfEl.querySelector('.snowflake-method-explorer-grip')).toBeNull();
		expect(enhancer.toggleArrange()).toBe(false);
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-arranging')).toBe(false);
		expect(view.fileItems['Novel/a.md']?.selfEl.querySelector('.snowflake-method-explorer-grip')).toBeNull();
		enhancer.toggleArrange();
		expect(notices).toHaveLength(1);
		expect(settings.explorerOrders).toEqual({});
	});

	it('hands the explorer back on dispose: names, tree, buttons and badges', async () => {
		const original: unknown = Reflect.get(FakeBaseItem.prototype, 'updateTitle');
		const { enhancer, view, dom, buttons } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Novel/00_System/001_Project_Metadata.md'],
			totals: { 'Novel/50_Manuscript/Draft.md': 7 },
		});
		enhancer.start();
		await settle(dom);
		expect(Reflect.get(FakeBaseItem.prototype, 'updateTitle')).not.toBe(original);
		expect(view.renderedPaths()).not.toContain('Novel/00_System');
		enhancer.dispose();
		expect(Reflect.get(FakeBaseItem.prototype, 'updateTitle')).toBe(original);
		expect(buttons()).toEqual([]);
		expect(view.fileItems['Novel/50_Manuscript']?.innerEl.textContent).toBe('50_Manuscript');
		expect(view.fileItems['Novel/50_Manuscript/Draft.md']?.selfEl.querySelector(BADGE)).toBeNull();
		expect(view.renderedPaths()).toContain('Novel/00_System');
	});

	it('leaves a feature off, once reported, when the explorer is not shaped as expected', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const dom = new CorkboardDom();
			const files = new FakeFiles();
			files.file('Novel/a.md');
			const app = new FakeApp(dom, files);
			const bare = {
				fileItems: {},
				containerEl: dom.container.createDiv({ cls: 'workspace-leaf-content' }),
				register: () => undefined,
			};
			app.leaves.push(new FakeLeaf(bare as unknown as FakeExplorerView));
			const enhancer = new ExplorerEnhancer({
				app: app as unknown as App,
				plugin: new FakePlugin() as unknown as Component,
				t: (key) => key,
				settings: () => ({
					explorerScope: 'projects', explorerTidy: true, explorerCounts: true, explorerHidePrefix: true,
					explorerHideFiles: true, explorerHiddenFiles: '', explorerHideFolders: true, explorerHiddenFolders: '',
					explorerNoteCounts: true, explorerFolderCounts: true, explorerOrders: {},
				}),
				saveOrders: () => undefined,
				saveToggle: () => undefined,
				projectRootOf: () => null,
				countNote: async () => null,
				noteCounted: () => undefined,
				breathe: async () => undefined,
				locale: () => 'en-US',
				notice: () => undefined,
			});
			cleanups.push(() => enhancer.dispose());
			expect(() => enhancer.start()).not.toThrow();
			expect(enhancer.toggleArrange()).toBe(false);
			expect(errors).toHaveBeenCalledTimes(1);
			enhancer.refresh();
			expect(errors).toHaveBeenCalledTimes(1);
		} finally {
			errors.mockRestore();
		}
	});
});
