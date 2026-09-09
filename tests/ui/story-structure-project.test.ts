import { describe, expect, it, vi } from 'vitest';

import type { ViewState, WorkspaceLeaf } from 'obsidian';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {
			app: unknown;
			contentEl = { addClass: (): void => undefined };
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
			setState(): Promise<void> { return Promise.resolve(); }
			registerDomEvent(): void {}
		},
		Scope: class { register(): void {} },
		Keymap: { isModEvent: (event: MouseEvent) => event.metaKey ? 'tab' : false },
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class extends runtime.SearchComponent {
			private readonly input: CorkboardElement;
			constructor(container: CorkboardElement) {
				super();
				this.input = container.createDiv({ cls: 'search-input-container' }).createEl('input');
			}
			setValue(value: string): this { this.input.value = value; return this; }
			onChange(handler: (value: string) => void): this {
				this.input.addEventListener('input', () => handler(this.input.value));
				return this;
			}
		},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { t as translate } from '../../src/i18n';
import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardHandle } from '../../src/ui/corkboard-bridge';
import {
	STORY_STRUCTURE_VIEW_TYPE,
	SnowflakeStoryStructureView,
} from '../../src/ui/story-structure-view';
import type { DashboardHost, ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

const firstProject = 'First/First.md';
const secondProject = 'Second/Second.md';

function workspaceView() {
	let recent: string | null = secondProject;
	const workspace = {
		layoutReady: true,
		requestSaveLayout: vi.fn(),
		onLayoutReady: vi.fn((_callback: () => void) => undefined),
	};
	const loadDashboardModel = vi.fn((path: string) => Promise.resolve({
		path, projectId: path, title: path, locale: 'en',
	} as ProjectDashboardModel));
	const openStoryStructure = vi.fn(() => Promise.resolve());
	const activateProject = vi.fn();
	const view = new SnowflakeStoryStructureView({
		app: { scope: {}, workspace },
	} as unknown as WorkspaceLeaf, {
		host: { loadDashboardModel, openStoryStructure, activateProject,
			getRecentStep: () => 8 } as unknown as DashboardHost,
		fingerprint: () => `en|${recent ?? ''}`,
		recentProjectPath: () => recent,
		corkboardPreferences: () => ({}),
		rememberCorkboardPreferences: vi.fn(),
		corkboard: () => { throw new Error('The frame is stubbed in this test.'); },
	});
	const renderFrame = vi.fn();
	// Preserve the real state lifecycle and project reads; rendering the
	// corkboard and Obsidian tab headers is outside this ownership test.
	Object.assign(view, {
		renderFrame,
		updateHeader: vi.fn(),
		renderError: (error: unknown) => { throw error; },
	});
	return { view, workspace, loadDashboardModel, openStoryStructure, activateProject, renderFrame,
		setRecent: (path: string | null) => { recent = path; } };
}

describe('workspace header localization', () => {
	it.each(['en', 'zh-CN'] as const)('updates the visible header after the %s project loads', async (locale) => {
		const { view, loadDashboardModel } = workspaceView();
		const dom = new CorkboardDom();
		const header = dom.container.createDiv({ cls: 'view-header-title', text: 'Visualization workspace' });
		const tab = dom.container.createDiv({ cls: 'workspace-tab-header-inner-title' });
		Object.assign(view, { containerEl: dom.container });
		// Obsidian updates the tab label here, but initializes the visible
		// view title only once, before the asynchronous project read finishes.
		Object.assign(view.leaf, { updateHeader: () => tab.setText(view.getDisplayText()) });
		delete (view as unknown as { updateHeader?: () => void }).updateHeader;
		const { host } = (view as unknown as { controls(): CorkboardControls }).controls();
		const translateForProject: DashboardHost['translateForProject'] = (projectLocale, key, vars) =>
			translate(projectLocale ?? 'en', key, vars);
		Object.assign(host, { translateForProject });
		let finishRead!: (model: ProjectDashboardModel) => void;
		loadDashboardModel.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
		await view.setState({ projectPath: firstProject }, { history: false });
		const opening = view.onOpen();
		expect(header.textContent).toBe('Visualization workspace');

		const title = locale === 'zh-CN' ? '中文小说' : 'Novel';
		const model = { path: firstProject, projectId: 'first', title, locale } as ProjectDashboardModel;
		finishRead(model);
		await opening;
		const expected = locale === 'zh-CN' ? '中文小说 · 场景看板' : 'Novel · corkboard';
		expect(header.textContent).toBe(expected);
		expect(tab.textContent).toBe(expected);

		view.showVisualization('timeline');
		const timeline = locale === 'zh-CN' ? '中文小说 · 时间线' : 'Novel · timeline';
		expect(header.textContent).toBe(timeline);
		expect(tab.textContent).toBe(timeline);

		loadDashboardModel.mockResolvedValueOnce({ ...model, title: 'Renamed' });
		await view.refresh();
		expect(header.textContent).toBe(locale === 'zh-CN' ? 'Renamed · 时间线' : 'Renamed · timeline');
		expect(tab.textContent).toBe(header.textContent);
	});
});

describe('workspace project ownership', () => {
	it('keeps a restored project through dashboard switches and repeated refreshes', async () => {
		const { view, loadDashboardModel, setRecent } = workspaceView();
		await view.onOpen();
		await view.setState({ projectPath: firstProject, visualization: 'timeline' }, { history: false });
		loadDashboardModel.mockClear();

		setRecent(secondProject);
		await view.refresh();
		await view.refresh();

		expect(loadDashboardModel.mock.calls).toEqual([[firstProject], [firstProject]]);
		expect(view.projectPath()).toBe(firstProject);
		expect(view.getState()).toMatchObject({ projectPath: firstProject, visualization: 'timeline' });
	});

	it('waits for restored state and assigns a legacy tab to the recent project only once', async () => {
		const { view, workspace, loadDashboardModel, setRecent } = workspaceView();
		await view.onOpen();
		expect(loadDashboardModel).not.toHaveBeenCalled();

		await view.setState({ visualization: 'timeline' }, { history: false });
		expect(view.getState()).toMatchObject({ projectPath: secondProject });
		expect(workspace.requestSaveLayout).toHaveBeenCalled();
		loadDashboardModel.mockClear();
		setRecent(firstProject);
		await view.refresh();

		expect(loadDashboardModel).toHaveBeenCalledExactlyOnceWith(secondProject);
		expect(view.projectPath()).toBe(secondProject);
	});

	it('loads its saved project when startup layout becomes ready without a recent project', async () => {
		const { view, workspace, loadDashboardModel, renderFrame, setRecent } = workspaceView();
		workspace.layoutReady = false;
		setRecent(null);
		await view.onOpen();
		await view.setState({ projectPath: firstProject }, { history: false });
		expect(loadDashboardModel).not.toHaveBeenCalled();
		expect(workspace.onLayoutReady).toHaveBeenCalledOnce();

		workspace.layoutReady = true;
		workspace.onLayoutReady.mock.calls[0]?.[0]();
		await vi.waitFor(() => expect(renderFrame).toHaveBeenCalledOnce());

		expect(loadDashboardModel).toHaveBeenCalledExactlyOnceWith(firstProject);
		expect(view).toMatchObject({ model: { path: firstProject } });
	});

	it('retains an explicitly empty project instead of adopting another dashboard', async () => {
		const { view, loadDashboardModel } = workspaceView();
		await view.setState({ projectPath: null }, { history: false });
		await view.onOpen();
		await view.refresh();

		expect(loadDashboardModel).not.toHaveBeenCalled();
		expect(view.getState()).toMatchObject({ projectPath: null });
	});

	it('opens a modifier-clicked visualization for this workspace project', async () => {
		const { view, openStoryStructure } = workspaceView();
		await view.setState({ projectPath: firstProject }, { history: false });
		const choosing = view as unknown as { choose(key: string, event: MouseEvent): void };

		choosing.choose('timeline', { metaKey: true } as MouseEvent);

		expect(openStoryStructure).toHaveBeenCalledExactlyOnceWith('timeline', {
			newTab: true, projectPath: firstProject,
		});
	});

	it('activates the owning project for card operations after another dashboard became current', async () => {
		const { view, activateProject, setRecent } = workspaceView();
		await view.setState({ projectPath: firstProject }, { history: false });
		await view.onOpen();
		setRecent(secondProject);
		const controls = (view as unknown as { controls(): { activateProject(): void } }).controls();

		controls.activateProject();

		expect(activateProject).toHaveBeenCalledExactlyOnceWith(firstProject, 'en', 8);
	});

	it('discards an old project read when restored ownership changes during the read', async () => {
		const { view, loadDashboardModel, renderFrame } = workspaceView();
		let finishRead!: (model: ProjectDashboardModel) => void;
		loadDashboardModel.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
		await view.setState({ projectPath: firstProject }, { history: false });
		const opening = view.onOpen();
		const switching = view.setState({ projectPath: secondProject }, { history: false });
		await Promise.resolve();

		finishRead({ path: firstProject, projectId: firstProject, locale: 'en' } as ProjectDashboardModel);
		await Promise.all([opening, switching]);

		expect(loadDashboardModel.mock.calls).toEqual([[firstProject], [secondProject]]);
		expect(renderFrame).toHaveBeenCalledOnce();
		expect(view).toMatchObject({ model: { path: secondProject } });
	});

	it('saves to the renamed project without replacing the open corkboard', async () => {
		const { view, loadDashboardModel, renderFrame } = workspaceView();
		const dom = new CorkboardDom();
		const originalPath = 'First/00_System/001_Project_Metadata.md';
		const renamedPath = 'Renamed/00_System/001_Project_Metadata.md';
		let scene: SceneViewModel = {
			id: 'scene', path: 'First/40_Scene/Opening.md', title: 'Opening', rank: 0,
			progressStatus: 'in-progress', aliases: [], categoryPaths: [],
			povPath: '', povName: '', povMissing: false,
			times: [], locations: [], characterPaths: [], conflict: 'An obstacle', color: null,
			linkedManuscript: [], worldStatus: [], relationships: [], events: '',
			customFields: '', revision: 'initial', healthIssues: [], readOnly: false,
		};
		loadDashboardModel.mockImplementation((path) => Promise.resolve({
			path, projectId: 'stable-project', title: 'Novel', locale: 'en',
			scenes: [scene], characters: [], manuscriptPaths: [], readOnly: false,
		} as unknown as ProjectDashboardModel));
		const patchScene = vi.fn<DashboardHost['patchScene']>(async (_id, patch, path) => {
			if (path !== renamedPath) throw new Error('The original project path no longer exists.');
			scene = { ...scene, progressStatus: patch.progressStatus ?? null, revision: 'saved' };
			return scene.revision;
		});
		const internals = view as unknown as {
			controls(): CorkboardControls;
			frameKey(): string;
			board: CorkboardHandle | null;
			shownFrame: string | null;
		};
		const controls = internals.controls();
		Object.assign(controls.app, { metadataCache: { getFirstLinkpathDest: () => null } });
		Object.assign(controls.host, { patchScene, translateForProject: (_locale: unknown, key: string) => key });
		renderFrame.mockImplementation(() => {
			internals.board?.dispose();
			dom.container.empty();
			internals.board = renderCorkboard(dom.container as unknown as HTMLElement, controls);
			internals.shownFrame = internals.frameKey();
		});
		await view.onOpen();
		await view.setState({ projectPath: originalPath }, { history: false });
		const card = dom.container.querySelector('.snowflake-method-corkboard-card')!;

		scene = { ...scene, path: 'Renamed/40_Scene/Opening.md' };
		await view.setState({ projectPath: renamedPath }, { history: false });
		expect(renderFrame).toHaveBeenCalledOnce();
		expect(dom.container.querySelector('.snowflake-method-corkboard-card')).toBe(card);
		const status = card.querySelector('.snowflake-method-corkboard-status-select')!;
		status.value = 'complete';
		status.dispatch('change');

		await vi.waitFor(() => {
			expect(patchScene).toHaveBeenCalledExactlyOnceWith('scene', {
				progressStatus: 'complete', expectedRevision: 'initial',
			}, renamedPath);
			expect(scene.progressStatus).toBe('complete');
		});
		internals.board?.dispose();
	});

	it.each(['rename', 'switch', 'clear'] as const)(
		'keeps the displayed search and filters consistent when project ownership changes: %s',
		async (change) => {
			const { view, loadDashboardModel, renderFrame } = workspaceView();
			const dom = new CorkboardDom();
			dom.height = 100;
			const originalPath = 'First/00_System/001_Project_Metadata.md';
			const nextPath = change === 'clear' ? null : 'Renamed/00_System/001_Project_Metadata.md';
			const scene = (id: string, title: string, status: SceneViewModel['progressStatus']): SceneViewModel => ({
				id, path: `First/40_Scene/${id}.md`, title, rank: 0,
				progressStatus: status, aliases: [], categoryPaths: [], povPath: '', povName: '', povMissing: false,
				times: [], locations: [], characterPaths: [], conflict: '', color: null, linkedManuscript: [],
				worldStatus: [], relationships: [], events: '', customFields: '', revision: 'initial',
				healthIssues: [], readOnly: false,
			});
			loadDashboardModel.mockImplementation((path) => Promise.resolve({
				path,
				projectId: path !== originalPath && change === 'switch' ? 'other-project' : 'stable-project',
				title: 'Novel', locale: 'en',
				scenes: [scene('match', 'Opening', 'in-progress'), scene('other', 'Finale', 'in-progress'),
					scene('complete', 'Opening again', 'complete')],
				characters: [], manuscriptPaths: [], readOnly: false,
			} as unknown as ProjectDashboardModel));
			const internals = view as unknown as {
				controls(): CorkboardControls;
				frameKey(): string;
				board: CorkboardHandle | null;
				shownFrame: string | null;
			};
			const controls = internals.controls();
			Object.assign(controls.app, { metadataCache: { getFirstLinkpathDest: () => null } });
			Object.assign(controls.host, {
				translateForProject: (_locale: unknown, key: string, vars?: Record<string, unknown>) =>
					key === 'table.filteredCount' ? `${String(vars?.shown)}/${String(vars?.total)}` : key,
			});
			renderFrame.mockImplementation(() => {
				internals.board?.dispose();
				dom.container.empty();
				internals.board = controls.model() === null ? null : renderCorkboard(dom.container as unknown as HTMLElement, controls);
				internals.shownFrame = internals.frameKey();
			});
			await view.onOpen();
			await view.setState({ projectPath: originalPath }, { history: false });
			const input = dom.container.querySelector('input')!;
			input.value = 'Opening';
			input.dispatch('input');
			dom.flushFrame();
			controls.memory.filters.status = 'in-progress';
			internals.board!.refresh();
			const card = dom.container.querySelector('.snowflake-method-corkboard-card')!;
			const scroller = dom.container.querySelector('.snowflake-method-corkboard-scroll')!;
			scroller.scrollTop = 24;
			scroller.dispatch('scroll');
			expect(dom.container.querySelector('.snowflake-method-prose-state')?.textContent).toBe('1/3');

			await view.setState({ projectPath: nextPath }, { history: false });

			if (change === 'rename') {
				expect(renderFrame).toHaveBeenCalledOnce();
				expect(dom.container.querySelector('input')).toBe(input);
				expect(input.value).toBe('Opening');
				expect(controls.memory).toMatchObject({ query: 'Opening', filters: { status: 'in-progress' }, scrollTop: 24 });
				expect(dom.container.querySelectorAll('.snowflake-method-corkboard-card')).toEqual([card]);
				expect(dom.container.querySelector('.snowflake-method-prose-state')?.textContent).toBe('1/3');
			} else {
				expect(controls.memory).toMatchObject({ query: '', filters: { status: 'all' }, scrollTop: 0 });
				expect(renderFrame).toHaveBeenCalledTimes(2);
				expect(input.isConnected).toBe(false);
				if (change === 'switch') {
					expect(dom.container.querySelector('input')?.value).toBe('');
					expect(dom.container.querySelector('.snowflake-method-prose-state')?.textContent).toBe('');
				} else {
					expect(internals.board).toBeNull();
				}
			}
			internals.board?.dispose();
		},
	);
});

function structureLeaf(projectPath: string, root: object, deferred = false) {
	const view = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
	const showVisualization = vi.fn();
	Object.assign(view, { showVisualization, projectPath: () => projectPath });
	let state: ViewState = {
		type: STORY_STRUCTURE_VIEW_TYPE,
		state: { projectPath, visualization: 'timeline' },
	};
	const leaf = {
		view: deferred ? {} : view,
		getRoot: () => root,
		getViewState: () => state,
		setViewState: vi.fn((next: ViewState) => { state = next; return Promise.resolve(); }),
		loadIfDeferred: vi.fn(async () => { await Promise.resolve(); leaf.view = view; }),
		detach: vi.fn(),
	};
	return { leaf, showVisualization };
}

function pluginWithProjects(deferred = false) {
	const root = {};
	const first = structureLeaf(firstProject, root);
	const second = structureLeaf(secondProject, root, deferred);
	const created = structureLeaf(secondProject, root, true);
	const workspace = {
		rootSplit: root,
		getLeavesOfType: vi.fn((type: string) => type === STORY_STRUCTURE_VIEW_TYPE ? [first.leaf, second.leaf] : []),
		getLeaf: vi.fn(() => created.leaf),
		setActiveLeaf: vi.fn(),
		revealLeaf: vi.fn(() => Promise.resolve()),
	};
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, { app: { workspace }, settings: { recentProjectPath: secondProject } });
	return { plugin, workspace, first, second, created };
}

describe('opening a project workspace', () => {
	it.each([false, true])('reuses only the requested project workspace (deferred: %s)', async (deferred) => {
		const { plugin, workspace, first, second } = pluginWithProjects(deferred);

		await plugin.openStoryStructure('plotline');

		expect(workspace.getLeaf).not.toHaveBeenCalled();
		expect(first.leaf.loadIfDeferred).not.toHaveBeenCalled();
		expect(first.showVisualization).not.toHaveBeenCalled();
		expect(second.leaf.loadIfDeferred).toHaveBeenCalledOnce();
		expect(second.showVisualization).toHaveBeenCalledExactlyOnceWith('plotline');
		expect(workspace.setActiveLeaf).toHaveBeenCalledWith(second.leaf, { focus: true });
	});

	it('creates a workspace when only another project is open', async () => {
		const { plugin, workspace, first, created } = pluginWithProjects();
		workspace.getLeavesOfType.mockReturnValue([first.leaf]);

		await plugin.openStoryStructure();

		expect(first.leaf.setViewState).not.toHaveBeenCalled();
		expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('tab');
		expect(created.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
			type: STORY_STRUCTURE_VIEW_TYPE, active: true,
			state: { projectPath: secondProject, visualization: 'corkboard-ordered' },
		});
	});

	it('adopts a deferred legacy workspace while preserving its saved visualization and corkboard settings', async () => {
		const { plugin, workspace, second } = pluginWithProjects(true);
		const corkboard = { mode: 'compact', group: 'pov', reversed: true };
		await second.leaf.setViewState({
			type: STORY_STRUCTURE_VIEW_TYPE,
			state: { visualization: 'timeline', corkboard },
		});
		second.leaf.setViewState.mockClear();

		await plugin.openStoryStructure();

		expect(workspace.getLeaf).not.toHaveBeenCalled();
		expect(second.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
			type: STORY_STRUCTURE_VIEW_TYPE, active: true,
			state: { projectPath: secondProject, visualization: 'timeline', corkboard },
		});
		expect(second.leaf.setViewState.mock.invocationCallOrder[0]).toBeLessThan(
			second.leaf.loadIfDeferred.mock.invocationCallOrder[0] ?? 0,
		);
		expect(workspace.setActiveLeaf).toHaveBeenCalledWith(second.leaf, { focus: true });
	});

	it('prefers a bound project workspace over an earlier legacy tab', async () => {
		const { plugin, workspace, first, second } = pluginWithProjects(true);
		await first.leaf.setViewState({
			type: STORY_STRUCTURE_VIEW_TYPE, state: { visualization: 'beat-sheet' },
		});
		first.leaf.setViewState.mockClear();

		await plugin.openStoryStructure();

		expect(workspace.getLeaf).not.toHaveBeenCalled();
		expect(first.leaf.setViewState).not.toHaveBeenCalled();
		expect(first.leaf.loadIfDeferred).not.toHaveBeenCalled();
		expect(second.leaf.loadIfDeferred).toHaveBeenCalledOnce();
		expect(workspace.setActiveLeaf).toHaveBeenCalledWith(second.leaf, { focus: true });
	});

	it('does not adopt a workspace with an explicitly empty project as a legacy tab', async () => {
		const { plugin, workspace, first, created } = pluginWithProjects();
		await first.leaf.setViewState({
			type: STORY_STRUCTURE_VIEW_TYPE,
			state: { projectPath: null, visualization: 'timeline' },
		});
		first.leaf.setViewState.mockClear();
		workspace.getLeavesOfType.mockReturnValue([first.leaf]);

		await plugin.openStoryStructure();

		expect(first.leaf.setViewState).not.toHaveBeenCalled();
		expect(first.leaf.loadIfDeferred).not.toHaveBeenCalled();
		expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('tab');
		expect(created.leaf.getViewState().state).toMatchObject({ projectPath: secondProject });
	});

	it('uses an explicit project for a new workspace even when another dashboard is current', async () => {
		const { plugin, workspace, created } = pluginWithProjects();

		await plugin.openStoryStructure('beat-sheet', { newTab: true, projectPath: firstProject });

		expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('tab');
		expect(created.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
			type: STORY_STRUCTURE_VIEW_TYPE, active: true,
			state: { projectPath: firstProject, visualization: 'beat-sheet' },
		});
	});

	it.each([false, true])('detaches only the archived project workspace (deferred: %s)', (deferred) => {
		const { plugin, workspace, first, second } = pluginWithProjects(deferred);
		workspace.getLeavesOfType.mockImplementation((...args: unknown[]) =>
			args[0] === STORY_STRUCTURE_VIEW_TYPE ? [first.leaf, second.leaf] : []);
		const detaching = plugin as unknown as { detachProjectViews(path: string): void };

		detaching.detachProjectViews('Second');

		expect(first.leaf.detach).not.toHaveBeenCalled();
		expect(second.leaf.detach).toHaveBeenCalledOnce();
	});

	it.each([false, true])('preserves workspace settings when its project folder is renamed (deferred: %s)', async (deferred) => {
		const { plugin, first, second } = pluginWithProjects(deferred);
		const renaming = plugin as unknown as {
			renameProjectViews(oldPath: string, newPath: string): Promise<void>;
		};

		await renaming.renameProjectViews('Second', 'Renamed');

		expect(first.leaf.setViewState).not.toHaveBeenCalled();
		expect(second.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
			type: STORY_STRUCTURE_VIEW_TYPE,
			state: { projectPath: 'Renamed/Second.md', visualization: 'timeline' },
		});
		expect(second.leaf.loadIfDeferred).not.toHaveBeenCalled();
	});
});
