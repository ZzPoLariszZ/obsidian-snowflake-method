import { describe, expect, it, vi } from 'vitest';
import type { ViewState, WorkspaceLeaf } from 'obsidian';
import type { ProjectSnapshot } from '../../src/services';

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

import SnowflakeMethodPlugin from '../../src/main';
import { DASHBOARD_VIEW_TYPE, SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { MANUSCRIPT_VIEW_TYPE, SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { STORY_STRUCTURE_VIEW_TYPE, SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';

const firstPath = 'First/Project.md';
const secondPath = 'Second/Project.md';
const kinds = [DASHBOARD_VIEW_TYPE, STORY_STRUCTURE_VIEW_TYPE, MANUSCRIPT_VIEW_TYPE];
const root = {};

function projectLeaf(type: string, path: string, options: { deferred?: boolean; unloaded?: boolean } = {}) {
	const prototype = type === DASHBOARD_VIEW_TYPE ? SnowflakeDashboardView.prototype
		: type === STORY_STRUCTURE_VIEW_TYPE ? SnowflakeStoryStructureView.prototype
			: SnowflakeManuscriptView.prototype;
	const view = Object.create(prototype) as SnowflakeDashboardView | SnowflakeStoryStructureView | SnowflakeManuscriptView;
	const model = options.unloaded ? null : { path, projectPath: path, locale: 'zh-CN' };
	Object.assign(view, {
		projectPath: path,
		projectLocale: 'zh-CN',
		selectedStep: 4,
		model,
		lastRender: { model },
		state: { projectPath: path },
	});
	let state: ViewState = { type, state: { projectPath: path } };
	const leaf = {
		view: options.deferred ? {} : view,
		getRoot: () => root,
		getViewState: () => state,
		loadIfDeferred: vi.fn(() => {
			leaf.view = view;
			return Promise.resolve();
		}),
	};
	return { leaf, view, setPath: (projectPath: string) => { state = { type, state: { projectPath } }; } };
}

function pluginRouting() {
	let active: object | null = null;
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const loadProject = vi.fn((path: string) => Promise.resolve({ projectFile: path, locale: 'zh-CN' } as ProjectSnapshot));
	const listSegments = vi.fn((_project: ProjectSnapshot) => Promise.resolve([{ path: 'First/Manuscript/Chapter.md', title: 'Chapter' }]));
	const updateScene = vi.fn(() => Promise.resolve({ revision: 'saved' }));
	Object.assign(plugin, {
		app: { workspace: { rootSplit: root, getMostRecentLeaf: () => active } },
		settings: { recentProjectPath: secondPath, recentStep: 8 },
		currentProjectLocale: 'en',
		projectLeafActivation: 0,
		projects: { loadProject, updateScene, manuscript: { listSegments } },
		saveSettings: vi.fn(() => Promise.resolve()),
		rerenderStatisticsViews: vi.fn(),
	});
	const routing = plugin as unknown as { activateProjectLeaf(leaf: WorkspaceLeaf | null): Promise<void> };
	const activate = (leaf: object | null) => {
		active = leaf;
		return routing.activateProjectLeaf(leaf as WorkspaceLeaf | null);
	};
	return { plugin, loadProject, listSegments, updateScene, activate,
		setActive: (leaf: object | null) => { active = leaf; },
		route: (leaf: object) => routing.activateProjectLeaf(leaf as WorkspaceLeaf),
	};
}

describe.each(kinds)('active project routing: %s', (type) => {
	it('activates a loaded tab immediately without any content focus', async () => {
		const { leaf } = projectLeaf(type, firstPath);
		const { plugin, activate, loadProject } = pluginRouting();
		const activated = activate(leaf);
		expect(plugin.settings.recentProjectPath).toBe(firstPath);
		expect(plugin.settings.recentStep).toBe(type === DASHBOARD_VIEW_TYPE ? 4 : 8);
		expect(plugin).toMatchObject({ currentProjectLocale: 'zh-CN' });
		expect(loadProject).not.toHaveBeenCalled();
		await activated;
	});

	it('activates a restored deferred tab after its view loads', async () => {
		const { leaf } = projectLeaf(type, firstPath, { deferred: true });
		const { plugin, activate } = pluginRouting();
		await activate(leaf);
		expect(leaf.loadIfDeferred).toHaveBeenCalledOnce();
		expect(plugin.settings.recentProjectPath).toBe(firstPath);
	});

	it('resolves the saved owner while a startup model is still loading', async () => {
		const { leaf } = projectLeaf(type, firstPath, { unloaded: true });
		const { plugin, activate, loadProject } = pluginRouting();
		await activate(leaf);
		expect(loadProject).toHaveBeenCalledExactlyOnceWith(firstPath);
		expect(plugin.settings.recentProjectPath).toBe(firstPath);
	});

	it('never activates a background tab', async () => {
		const { leaf } = projectLeaf(type, firstPath);
		const { plugin, route } = pluginRouting();
		await route(leaf);
		expect(plugin.settings.recentProjectPath).toBe(secondPath);
		expect(leaf.loadIfDeferred).not.toHaveBeenCalled();
	});

	it('activates the owning project when the tab is in a popout window', async () => {
		const { leaf } = projectLeaf(type, firstPath);
		leaf.getRoot = () => ({ floating: true });
		const { plugin, activate } = pluginRouting();
		await activate(leaf);
		expect(plugin.settings.recentProjectPath).toBe(firstPath);
	});
});

describe('activation while switching tabs', () => {
	it('finishes startup activation when focus moves to a sidebar', async () => {
		const first = projectLeaf(MANUSCRIPT_VIEW_TYPE, firstPath, { unloaded: true });
		const { plugin, activate, loadProject, route } = pluginRouting();
		let release!: (project: ProjectSnapshot) => void;
		loadProject.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		const earlier = activate(first.leaf);
		await vi.waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
		// Obsidian keeps the manuscript as most recent root/floating tab while
		// emitting active-leaf-change for the sidebar that just gained focus.
		await route({ getViewState: () => ({ type: 'file-explorer' }) });
		release({ projectFile: firstPath, locale: 'en' } as ProjectSnapshot);
		await earlier;
		expect(plugin.settings.recentProjectPath).toBe(firstPath);
	});

	it('discards a deferred activation after another project becomes active', async () => {
		const first = projectLeaf(STORY_STRUCTURE_VIEW_TYPE, firstPath, { deferred: true });
		const second = projectLeaf(MANUSCRIPT_VIEW_TYPE, secondPath);
		let release!: () => void;
		first.leaf.loadIfDeferred.mockImplementationOnce(() => new Promise<void>((resolve) => {
			release = () => { first.leaf.view = first.view; resolve(); };
		}));
		const { plugin, activate } = pluginRouting();
		const earlier = activate(first.leaf);
		await activate(second.leaf);
		release();
		await earlier;
		expect(plugin.settings.recentProjectPath).toBe(secondPath);
	});

	it('discards a project read after the same leaf is rebound', async () => {
		const first = projectLeaf(MANUSCRIPT_VIEW_TYPE, firstPath, { unloaded: true });
		const { plugin, activate, loadProject } = pluginRouting();
		let release!: (project: ProjectSnapshot) => void;
		loadProject.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		const earlier = activate(first.leaf);
		await vi.waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
		first.setPath(secondPath);
		release({ projectFile: firstPath, locale: 'en' } as ProjectSnapshot);
		await earlier;
		expect(plugin.settings.recentProjectPath).toBe(secondPath);
	});

	it('does not activate an older read after focus leaves the main workspace tab', async () => {
		const first = projectLeaf(MANUSCRIPT_VIEW_TYPE, firstPath, { unloaded: true });
		const { plugin, activate, loadProject, setActive } = pluginRouting();
		let release!: (project: ProjectSnapshot) => void;
		loadProject.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		const earlier = activate(first.leaf);
		await vi.waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
		setActive(null);
		release({ projectFile: firstPath, locale: 'en' } as ProjectSnapshot);
		await earlier;
		expect(plugin.settings.recentProjectPath).toBe(secondPath);
	});
});

describe('project-scoped scene host operations', () => {
	it('saves a departing board to its owner without changing the active project', async () => {
		const { plugin, updateScene } = pluginRouting();
		const patch = { conflict: 'The gate is closed.', expectedRevision: 'original' };
		expect(await plugin.patchScene('scene-1', patch, firstPath)).toBe('saved');
		expect(updateScene).toHaveBeenCalledExactlyOnceWith(firstPath, 'scene-1', patch);
		expect(plugin.settings.recentProjectPath).toBe(secondPath);
	});

	it('lists manuscript notes from the requesting dashboard project', async () => {
		const { plugin, loadProject, listSegments } = pluginRouting();
		expect(await plugin.listManuscriptNotes(firstPath)).toEqual([
			{ path: 'First/Manuscript/Chapter.md', title: 'Chapter' },
		]);
		expect(loadProject).toHaveBeenCalledExactlyOnceWith(firstPath);
		expect(listSegments).toHaveBeenCalledWith(expect.objectContaining({ projectFile: firstPath }));
		expect(plugin.settings.recentProjectPath).toBe(secondPath);
	});
});
