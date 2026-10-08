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
	FakeFolderItem,
	FakeLeaf,
	FakePlugin,
	settle,
} from '../helpers/explorer-fake';

const BADGE = '.snowflake-method-explorer-count';
const BUTTONS = ['tidy', 'immersive', 'arrange', 'counts'].map((kind) => `snowflake-method-explorer-button-${kind}`);

/** A menu that keeps what the explorer's move items would do, so a test can press one. */
class CapturingMenu {
	readonly items: { title: string; click: (() => void) | null }[] = [];
	addItem(build: (item: unknown) => void): this {
		const entry = { title: '', click: null as (() => void) | null };
		const item = {
			setSection: (): unknown => item,
			setTitle: (title: string): unknown => { entry.title = title; return item; },
			setIcon: (): unknown => item,
			setDisabled: (): unknown => item,
			setIsLabel: (): unknown => item,
			onClick: (callback: () => void): unknown => { entry.click = callback; return item; },
		};
		build(item);
		this.items.push(entry);
		return this;
	}
	addSeparator(): this { return this; }
	press(title: string): void {
		const entry = this.items.find((item) => item.title === title);
		if (entry?.click == null) throw new Error(`no item ${title}`);
		entry.click();
	}
}

interface HarnessOptions {
	files: string[];
	roots?: string[];
	settings?: Partial<ExplorerSettingsView>;
	totals?: Record<string, number | null>;
	ready?: boolean;
	deferred?: boolean;
	/** The project the author is working in, as the host would answer it. */
	current?: string | null;
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
		explorerImmersive: false,
		explorerImmersiveFolds: [],
		...options.settings,
	};
	const current = { root: options.current === undefined ? null : options.current };
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
		saveFolds: (paths) => {
			settings.explorerImmersiveFolds = [...paths];
		},
		currentProjectRoot: () => current.root,
		projectRootOf: (path) => projectRootContaining(path, roots),
		pluginFolders: () => ({ root: '/', archive: 'Snowflake Archive', exports: 'Snowflake Export' }),
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
	return { dom, files, app, view, settings, plugin, saved, toggles, notices, totals, enhancer, badgeOf, buttons, current };
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
			'snowflake-method-explorer-button-immersive',
			'snowflake-method-explorer-button-arrange',
			'snowflake-method-explorer-button-counts',
		]);
		const tidy = open.view.buttonsEl.children[0];
		expect(tidy?.classes.has('is-active')).toBe(true);
		expect(tidy?.getAttribute('aria-label')).toBe('explorer.tidyOn\nexplorer.tidyTurnOff');
		// No hook is left on the view: a leaf that leaves the workspace is let go of at the next layout change.
		expect(open.view.registered).toHaveLength(0);
		open.app.leaves.length = 0;
		open.app.workspace.trigger('layout-change');
		expect(open.buttons()).toEqual([]);

		const deferred = harness({ files: ['Novel/50_Manuscript/Draft.md'], deferred: true });
		deferred.enhancer.start();
		expect(deferred.buttons()).toEqual([]);
	});

	it('makes the row buttons once the rows arrive, for a view dressed before it had any', async () => {
		const { enhancer, view, files, app, dom, buttons } = harness({ files: [] });
		enhancer.start();
		expect(buttons()).toEqual([BUTTONS[0], BUTTONS[2]]);
		const note = files.file('Novel/50_Manuscript/Draft.md');
		for (const path of ['Novel', 'Novel/50_Manuscript', 'Novel/50_Manuscript/Draft.md']) {
			const entry = files.get(path);
			if (entry !== null) view.onCreate(entry);
		}
		app.vault.trigger('create', note);
		view.requestSort();
		await settle(dom);
		expect(buttons()).toEqual(BUTTONS);
		expect(view.fileItems['Novel/50_Manuscript']?.innerEl.textContent).toBe('Manuscript');
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

		// A refresh while the box is open leaves what was typed alone.
		view.startRenameFile(folder);
		item.innerEl.setText(['50', 'Draft'].join('_'));
		enhancer.settingsChanged('explorerOrders');
		expect(item.innerEl.textContent).toBe('50_Draft');
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
			files: ['Novel/10_Summary/', 'Novel/30_Synopsis/', 'Novel/Draft.md', 'Novel/Notes.md', 'Zed/', 'Novel/', 'Inbox/b.md', 'Inbox/a.md'],
			settings: { explorerOrders: { Novel: ['Notes.md', '30_Synopsis'], '': ['Zed', 'Novel'], Inbox: ['b.md', 'a.md'] } },
		});
		enhancer.start();
		const novel = files.get('Novel');
		const inbox = files.get('Inbox');
		if (novel === null || inbox === null) throw new Error('no folder');
		const names = (folder: typeof novel): string[] =>
			view.getSortedFolderItems(folder as never).map((item) => item.file.name);
		expect(names(novel)).toEqual(['Notes.md', '30_Synopsis', '10_Summary', 'Draft.md']);
		// The folder holding the projects is one of the plugin's own places, so the projects themselves can be arranged...
		expect(names(files.root)).toEqual(['Zed', 'Novel', 'Inbox']);
		// ...while a folder of the author's own waits for the whole-vault scope.
		expect(names(inbox)).toEqual(['a.md', 'b.md']);
		settings.explorerScope = 'vault';
		enhancer.settingsChanged('explorerScope');
		expect(names(inbox)).toEqual(['b.md', 'a.md']);
	});

	it('reaches the archive and the export folder as its own places', async () => {
		const { enhancer, view, dom, badgeOf } = harness({
			files: ['Snowflake Archive/Old/50_Manuscript/Draft.md', 'Snowflake Archive/Old/00_System/001_Project_Metadata.md', 'Snowflake Export/Old/001 Dawn.md', 'Novel/a.md'],
			roots: ['Novel', 'Snowflake Archive/Old'],
			totals: { 'Snowflake Archive/Old/50_Manuscript/Draft.md': 40, 'Snowflake Export/Old/001 Dawn.md': 7, 'Novel/a.md': 1 },
		});
		enhancer.start();
		await settle(dom);
		expect(badgeOf('Snowflake Archive')).toBe('40');
		expect(badgeOf('Snowflake Export')).toBe('7');
		expect(view.renderedPaths()).not.toContain('Snowflake Archive/Old/00_System');
		expect(view.fileItems['Snowflake Archive/Old/50_Manuscript']?.innerEl.textContent).toBe('Manuscript');
		enhancer.toggleArrange();
		expect(enhancer.arrangeMenu(view.fileItems['Snowflake Export/Old/001 Dawn.md']?.file as never)).not.toBeNull();
		expect(enhancer.arrangeMenu(view.fileItems['Novel']?.file as never)).not.toBeNull();
		expect(enhancer.arrangeMenu(view.fileItems['Novel/a.md']?.file as never)).not.toBeNull();
	});

	it('shows only the current project, folds the rest, follows the author, and opens the folds again', async () => {
		const { enhancer, view, settings, notices, dom, current, app } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/50_Manuscript/Draft.md', 'Inbox/a.md', 'Roadmap.md'],
			roots: ['Novel', 'Other'],
			current: 'Novel',
		});
		enhancer.start();
		const covered = (path: string): boolean =>
			view.fileItems[path]?.selfEl.classList.contains('snowflake-method-explorer-covered') ?? false;
		const folded = (path: string): boolean => {
			const item = view.fileItems[path];
			return item instanceof FakeFolderItem && item.collapsed;
		};
		// Every folder stands open before the cover goes up.
		expect(folded('Other')).toBe(false);
		expect(enhancer.setImmersive(true)).toBe(true);
		expect(settings.explorerImmersive).toBe(true);
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive')).toBe(true);
		expect(covered('Novel')).toBe(false);
		expect(covered('Novel/50_Manuscript/Draft.md')).toBe(false);
		expect(covered('Other')).toBe(true);
		expect(covered('Inbox/a.md')).toBe(true);
		expect(covered('Roadmap.md')).toBe(true);
		expect(folded('Other')).toBe(true);
		expect(folded('Inbox')).toBe(true);
		expect(folded('Novel')).toBe(false);
		expect(folded('Novel/50_Manuscript')).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual(expect.arrayContaining(['Other', 'Inbox', 'Novel/50_Manuscript']));
		// The bars fade with their distance from the project.
		await settle(dom);
		const fadeOf = (path: string): string | undefined =>
			(view.fileItems[path]?.selfEl as unknown as { styles: Record<string, string> } | undefined)?.styles['--snowflake-method-explorer-fade'];
		expect(fadeOf('Roadmap.md')).toBeDefined();
		expect(fadeOf('Novel')).toBeUndefined();
		// A tab of the other project brought to the front draws the cover around that one.
		current.root = 'Other';
		enhancer.followCurrentProject();
		app.workspace.trigger('active-leaf-change', null);
		expect(covered('Other')).toBe(false);
		expect(covered('Novel')).toBe(true);
		expect(folded('Other')).toBe(false);
		// Down again: the folds come back.
		expect(enhancer.setImmersive(false)).toBe(false);
		expect(settings.explorerImmersive).toBe(false);
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive')).toBe(false);
		expect(covered('Novel')).toBe(false);
		expect(folded('Inbox')).toBe(false);
		expect(folded('Other')).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual([]);
		// With no current project the mode is on all the same, says so, and
		// covers nothing until a project comes to the front.
		current.root = null;
		expect(enhancer.setImmersive(true)).toBe(true);
		expect(settings.explorerImmersive).toBe(true);
		expect(notices).toEqual(['explorer.immersiveNoProject']);
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive')).toBe(false);
		expect(folded('Novel')).toBe(false);
		current.root = 'Other';
		enhancer.followCurrentProject();
		expect(view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive')).toBe(true);
		expect(covered('Novel')).toBe(true);
		expect(folded('Novel')).toBe(true);
		expect(settings.explorerImmersiveFolds).toEqual(expect.arrayContaining(['Novel', 'Inbox']));
		expect(enhancer.setImmersive(false)).toBe(false);
		expect(folded('Novel')).toBe(false);
		// The two modes take turns, and the blocked one's button steps back.
		current.root = 'Novel';
		const buttonOf = (kind: string) => view.buttonsEl.children.find((button) => button.classes.has(`snowflake-method-explorer-button-${kind}`));
		expect(enhancer.setImmersive(true)).toBe(true);
		expect(enhancer.toggleArrange()).toBe(false);
		expect(notices[notices.length - 1]).toBe('explorer.arrangeBlocked');
		expect(buttonOf('arrange')?.classes.has('is-blocked')).toBe(true);
		expect(enhancer.setImmersive(false)).toBe(false);
		expect(buttonOf('arrange')?.classes.has('is-blocked')).toBe(false);
		expect(enhancer.toggleArrange()).toBe(true);
		expect(enhancer.setImmersive(true)).toBe(false);
		expect(notices[notices.length - 1]).toBe('explorer.immersiveBlocked');
		expect(buttonOf('immersive')?.classes.has('is-blocked')).toBe(true);
		enhancer.exitArrange();
		expect(buttonOf('immersive')?.classes.has('is-blocked')).toBe(false);
	});

	it('follows the setting too, stands by default around the project at hand, and sets arrange mode aside', () => {
		const { enhancer, view, settings, notices } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/50_Manuscript/Draft.md', 'Inbox/a.md'],
			roots: ['Novel', 'Other'],
			current: 'Novel',
			settings: { explorerImmersive: true },
		});
		const folded = (path: string): boolean => {
			const item = view.fileItems[path];
			return item instanceof FakeFolderItem && item.collapsed;
		};
		const up = (): boolean => view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive');
		enhancer.start();
		// On at the start with nothing remembered: the view folds around the
		// project, and the open folders are remembered first.
		expect(up()).toBe(true);
		expect(folded('Other')).toBe(true);
		expect(folded('Novel')).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual(expect.arrayContaining(['Other', 'Inbox']));
		// The settings page wrote the flag off: the cover comes down and the folds open again.
		settings.explorerImmersive = false;
		enhancer.settingsChanged('explorerImmersive');
		expect(up()).toBe(false);
		expect(folded('Other')).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual([]);
		// Written on again while arranging: arrange mode steps aside, with no notice of its own.
		expect(enhancer.toggleArrange()).toBe(true);
		settings.explorerImmersive = true;
		enhancer.settingsChanged('explorerImmersive');
		expect(enhancer.arranging).toBe(false);
		expect(up()).toBe(true);
		expect(folded('Other')).toBe(true);
		expect(notices).not.toContain('explorer.immersiveNoProject');
		expect(notices).not.toContain('explorer.immersiveBlocked');
	});

	it('goes up once the projects are known, when it was on before the scan reported', () => {
		const { enhancer, view, current } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/50_Manuscript/Draft.md'],
			roots: ['Novel', 'Other'],
			current: null,
			settings: { explorerImmersive: true },
		});
		const up = (): boolean => view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive');
		enhancer.start();
		expect(up()).toBe(false);
		current.root = 'Novel';
		enhancer.projectsChanged();
		expect(up()).toBe(true);
		const other = view.fileItems['Other'];
		expect(other instanceof FakeFolderItem && other.collapsed).toBe(true);
	});

	it("lets only the plugin's own entries move within the project list", () => {
		const { enhancer, view, files } = harness({
			files: ['Novel/a.md', 'Roadmap.md', 'Inbox/x.md', 'Snowflake Archive/', 'Snowflake Export/'],
		});
		enhancer.start();
		enhancer.toggleArrange();
		const grip = (path: string): boolean =>
			view.fileItems[path]?.selfEl.querySelector('.snowflake-method-explorer-grip') !== null;
		expect(grip('Novel')).toBe(true);
		expect(grip('Snowflake Archive')).toBe(true);
		expect(grip('Snowflake Export')).toBe(true);
		expect(grip('Roadmap.md')).toBe(false);
		expect(grip('Inbox')).toBe(false);
		const roadmap = files.get('Roadmap.md');
		const inbox = files.get('Inbox');
		if (roadmap === null || inbox === null) throw new Error('no entries');
		expect(enhancer.arrangeMenu(roadmap)).toBeNull();
		expect(enhancer.arrangeMenu(inbox)).toBeNull();
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

	it('keeps the folds of a cover taken down while no explorer was open, and opens them in the next', () => {
		const { enhancer, view, settings, app } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/50_Manuscript/Draft.md'],
			roots: ['Novel', 'Other'],
			current: 'Novel',
		});
		const folded = (path: string): boolean => {
			const item = view.fileItems[path];
			return item instanceof FakeFolderItem && item.collapsed;
		};
		enhancer.start();
		expect(enhancer.setImmersive(true)).toBe(true);
		expect(folded('Other')).toBe(true);
		// The explorer leaf goes, the sidebar collapsed say, and the cover comes down meanwhile.
		app.leaves.length = 0;
		app.workspace.trigger('layout-change');
		expect(enhancer.setImmersive(false)).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual(expect.arrayContaining(['Other']));
		expect(folded('Other')).toBe(true);
		// The leaf is back: the folds open, and are let go of.
		app.leaves.push(new FakeLeaf(view));
		app.workspace.trigger('layout-change');
		expect(folded('Other')).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual([]);
	});

	it('follows an immersive flag that arrived from outside with the other settings', () => {
		const { enhancer, view, settings } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/50_Manuscript/Draft.md'],
			roots: ['Novel', 'Other'],
			current: 'Novel',
		});
		const up = (): boolean => view.navFileContainerEl.classes.has('snowflake-method-explorer-immersive');
		const folded = (path: string): boolean => {
			const item = view.fileItems[path];
			return item instanceof FakeFolderItem && item.collapsed;
		};
		enhancer.start();
		settings.explorerImmersive = true;
		enhancer.settingsChanged('explorerOrders');
		expect(up()).toBe(true);
		expect(folded('Other')).toBe(true);
		settings.explorerImmersive = false;
		enhancer.settingsChanged('explorerOrders');
		expect(up()).toBe(false);
		expect(folded('Other')).toBe(false);
		expect(settings.explorerImmersiveFolds).toEqual([]);
	});

	it('opens a folder again that changed its name while the cover was up, and forgets one that went', () => {
		const { enhancer, view, files, app, settings } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/Notes/a.md', 'Other/Drafts/b.md'],
			roots: ['Novel'],
			current: 'Novel',
		});
		const folded = (path: string): boolean => {
			const item = view.fileItems[path];
			return item instanceof FakeFolderItem && item.collapsed;
		};
		enhancer.start();
		enhancer.setImmersive(true);
		expect(settings.explorerImmersiveFolds).toEqual(expect.arrayContaining(['Other', 'Other/Notes', 'Other/Drafts']));
		const other = files.get('Other');
		const notes = files.get('Other/Notes');
		const drafts = files.get('Other/Drafts');
		if (other === null || notes === null || drafts === null) throw new Error('no folders');
		// Obsidian tells the folder's rename and then each descendant's.
		for (const [entry, next] of [[other, 'Archive 2025'], [notes, 'Archive 2025/Notes'], [drafts, 'Archive 2025/Drafts']] as const) {
			const oldPath = files.rename(entry, next);
			app.vault.trigger('rename', entry, oldPath);
			view.onRename(entry, oldPath);
		}
		files.remove(drafts);
		app.vault.trigger('delete', drafts);
		view.onDelete(drafts);
		expect(settings.explorerImmersiveFolds).toEqual(expect.arrayContaining(['Archive 2025', 'Archive 2025/Notes']));
		expect(settings.explorerImmersiveFolds).not.toContain('Archive 2025/Drafts');
		expect(enhancer.setImmersive(false)).toBe(false);
		expect(folded('Archive 2025')).toBe(false);
		expect(folded('Archive 2025/Notes')).toBe(false);
	});

	it('reads the order of the rows once per change, not once per scroll', async () => {
		const { enhancer, view, dom } = harness({
			files: ['Novel/50_Manuscript/Draft.md', 'Other/a.md'],
			roots: ['Novel', 'Other'],
			current: 'Novel',
			settings: { explorerImmersive: true },
		});
		enhancer.start();
		await settle(dom);
		const sorted = vi.spyOn(view, 'getSortedFolderItems');
		try {
			view.navFileContainerEl.dispatch('scroll');
			await settle(dom);
			view.navFileContainerEl.dispatch('scroll');
			await settle(dom);
			expect(sorted).not.toHaveBeenCalled();
			// A click may have turned a fold, so the order is read again.
			view.navFileContainerEl.dispatch('click');
			await settle(dom);
			expect(sorted).toHaveBeenCalled();
		} finally {
			sorted.mockRestore();
		}
	});

	it('writes an order over the whole folder, the hidden entries keeping their places', async () => {
		const { enhancer, view, files, settings, dom } = harness({
			files: ['Novel/00_System/001_Project_Metadata.md', 'Novel/10_Summary/', 'Novel/30_Synopsis/', 'Novel/50_Manuscript/'],
		});
		enhancer.start();
		enhancer.toggleArrange();
		const synopsis = files.get('Novel/30_Synopsis');
		const novel = files.get('Novel');
		if (synopsis === null || novel === null) throw new Error('no folders');
		const build = enhancer.arrangeMenu(synopsis);
		if (build === null) throw new Error('no menu');
		const menu = new CapturingMenu();
		build(menu as never, 'snowflake-method');
		// The places are counted among the shown entries: up from the second shown row is above the first.
		menu.press('actions.moveUp');
		await settle(dom);
		expect(settings.explorerOrders).toEqual({ Novel: ['00_System', '30_Synopsis', '10_Summary', '50_Manuscript'] });
		const names = (): string[] => view.getSortedFolderItems(novel as never).map((item) => item.file.name);
		expect(names()).toEqual(['30_Synopsis', '10_Summary', '50_Manuscript']);
		// Shown again, the system folder stands where it always did.
		enhancer.setTidy(false);
		expect(names()).toEqual(['00_System', '30_Synopsis', '10_Summary', '50_Manuscript']);
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
					explorerImmersive: false, explorerImmersiveFolds: [],
				}),
				saveOrders: () => undefined,
				saveToggle: () => undefined,
				saveFolds: () => undefined,
				currentProjectRoot: () => null,
				projectRootOf: () => null,
				pluginFolders: () => ({ root: '/', archive: 'Snowflake Archive', exports: 'Snowflake Export' }),
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
