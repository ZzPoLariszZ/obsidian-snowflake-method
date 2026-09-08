import { describe, expect, it, vi } from 'vitest';
import type { ViewState, WorkspaceLeaf } from 'obsidian';
import { CorkboardDom } from '../helpers/corkboard-dom';
import { createFakeEnvironment } from '../helpers/fake-vault';

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
			setValue(): this { return this; }
		},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { ManagedFileNotFoundError, InvalidManagedDocumentError } from '../../src/repository';
import { FRONTMATTER_KEYS, SnowflakeProjectService } from '../../src/services';
import { DASHBOARD_VIEW_TYPE, SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { MANUSCRIPT_VIEW_TYPE } from '../../src/ui/manuscript-view';
import { STORY_STRUCTURE_VIEW_TYPE, SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';
import type { FilterPanel } from '../../src/ui/filter-panel';
import type { CorkboardHandle } from '../../src/ui/corkboard-bridge';
import type { CorkboardMemory } from '../../src/ui/story-structure-state';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';

const projectPath = 'Novels/Alpha/00_System/001_Project_Metadata.md';
const dashboardModel = {
	path: projectPath, projectId: 'stable-project', title: 'Alpha', locale: 'en',
} as ProjectDashboardModel;

function workspaceView() {
	const dom = new CorkboardDom();
	const content = dom.container.createDiv();
	const createDiv = dom.container.createDiv.bind(dom.container);
	dom.container.createDiv = (spec) => {
		const child = createDiv(spec);
		Object.assign(child, { style: child.styles });
		return child;
	};
	Object.assign(dom.win, { activeDocument: dom.doc, innerWidth: 1000, innerHeight: 800 });
	const removedListener = vi.spyOn(dom.win, 'removeEventListener');
	const workspace = { layoutReady: true, requestSaveLayout: vi.fn() };
	const loadDashboardModel = vi.fn<DashboardHost['loadDashboardModel']>(async () => dashboardModel);
	const host = {
		loadDashboardModel,
		translateForProject: (_locale: unknown, key: string) => key,
	} as unknown as DashboardHost;
	let fingerprint = 'en|en';
	let shown = false;
	const board: CorkboardHandle = {
		refresh: vi.fn(), dispose: vi.fn(), remeasure: vi.fn(),
		reveal: vi.fn(),
		saveFocusedConflict: () => false,
	};
	const view = new SnowflakeStoryStructureView({ app: { scope: {}, workspace } } as unknown as WorkspaceLeaf, {
		host,
		fingerprint: () => fingerprint,
		recentProjectPath: () => projectPath,
		corkboardPreferences: () => ({ mode: 'standard', reversed: false }),
		rememberCorkboardPreferences: vi.fn(),
		corkboard: () => board,
	});
	Object.assign(view, { contentEl: content, containerEl: { isShown: () => shown } });
	const internals = view as unknown as { filterPanel: FilterPanel; shownFingerprint: string | null; memory: CorkboardMemory };
	return { view, internals, loadDashboardModel, host, content, dom, board, removedListener,
		setShown: (value: boolean) => { shown = value; },
		setFingerprint: (value: string) => { fingerprint = value; } };
}

async function serviceProject() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const project = await service.createProject({ name: 'Alpha', rootPath: 'Novels', locale: 'en' });
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, { projects: service });
	return { ...env, service, project, plugin };
}

async function duplicateCharacterId(env: Awaited<ReturnType<typeof serviceProject>>) {
	const first = await env.service.createCharacter(env.project, { name: 'First' });
	const second = await env.service.createCharacter(env.project, { name: 'Second' });
	await env.fakeFileManager.processFrontMatter(env.fakeVault.getFileByPath(second.path)!, (frontmatter) => {
		frontmatter[FRONTMATTER_KEYS.characterId] = first.characterId;
	});
}

describe('Claude lifecycle findings: production errors and real user paths', () => {
	it('#2 retargets every saved project view and the manuscript anchor without loading deferred leaves', async () => {
		const env = await serviceProject();
		const oldPath = env.project.projectFile;
		const newRoot = `${env.project.rootPath} Draft`;
		const leafFor = (type: string) => {
			let state: ViewState = { type, state: { projectPath: oldPath,
				...(type === MANUSCRIPT_VIEW_TYPE ? { anchorPath: `${env.project.rootPath}/50_Manuscript/Chapter.md` } : {}),
			} };
			return {
				view: {},
				getViewState: () => state,
				setViewState: vi.fn(async (next: ViewState) => { state = next; }),
				loadIfDeferred: vi.fn(),
			};
		};
		const dashboard = leafFor(DASHBOARD_VIEW_TYPE);
		const manuscript = leafFor(MANUSCRIPT_VIEW_TYPE);
		const structure = leafFor(STORY_STRUCTURE_VIEW_TYPE);
		const leaves = new Map([
			[DASHBOARD_VIEW_TYPE, [dashboard]], [MANUSCRIPT_VIEW_TYPE, [manuscript]],
			[STORY_STRUCTURE_VIEW_TYPE, [structure]],
		]);
		Object.assign(env.plugin, { app: { workspace: { getLeavesOfType: (type: string) => leaves.get(type) ?? [] } } });
		env.fakeVault.rename(env.project.rootPath, newRoot);
		await (env.plugin as unknown as { renameProjectViews(oldPath: string, newPath: string): Promise<void> })
			.renameProjectViews(env.project.rootPath, newRoot);

		const newPath = oldPath.replace(env.project.rootPath, newRoot);
		for (const leaf of [structure, dashboard, manuscript]) {
			expect(leaf.getViewState().state?.projectPath).toBe(newPath);
			expect(leaf.setViewState).toHaveBeenCalledOnce();
			expect(leaf.loadIfDeferred).not.toHaveBeenCalled();
		}
		expect(manuscript.getViewState().state?.anchorPath).toBe(`${newRoot}/50_Manuscript/Chapter.md`);
		await expect(env.plugin.loadManuscript(newPath)).resolves.toMatchObject({ projectPath: newPath });

		const detach = vi.fn();
		const render = vi.fn();
		const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		Object.assign(view, {
			projectPath: newPath, stateDelivered: true, refreshing: false, render,
			keepingFocus: (paint: () => void) => paint(),
			leaf: { detach }, host: { listProjects: async () => [], loadDashboardModel: async (path: string) => {
				const project = await env.service.loadProject(path);
				return { path: project.projectFile };
			} },
		});
		await view.refresh();
		expect(detach).not.toHaveBeenCalled();
		expect(render).toHaveBeenCalledWith([], { path: newPath });
	});

	it('#2 plugin rename updates deferred dashboard titles and manuscript anchors even without vault-event delivery', async () => {
		const env = await serviceProject();
		const leaves = [DASHBOARD_VIEW_TYPE, STORY_STRUCTURE_VIEW_TYPE, MANUSCRIPT_VIEW_TYPE].map((type) => {
			let state: ViewState = { type, state: {
				projectPath: env.project.projectFile,
				...(type === DASHBOARD_VIEW_TYPE ? { projectTitle: 'Alpha', selectedStep: 8 } : {}),
				...(type === MANUSCRIPT_VIEW_TYPE ? { anchorPath: `${env.project.rootPath}/50_Manuscript/Chapter.md` } : {}),
			} };
			return {
				view: {}, getViewState: () => state, loadIfDeferred: vi.fn(),
				setViewState: vi.fn(async (next: ViewState) => { state = next; }),
			};
		});
		Object.assign(env.plugin, {
			app: { workspace: { getLeavesOfType: (type: string) => leaves.filter((leaf) => leaf.getViewState().type === type) } },
			settings: { recentProjectPath: env.project.projectFile },
			projectLocalesById: new Map(), invalidateProjectHealth: vi.fn(),
			saveSettings: vi.fn(async () => undefined), listProjects: async () => [], t: (key: string) => key,
		});
		await (env.plugin as unknown as {
			renameManagedProject(option: { path: string; rootPath: string }, title: string): Promise<unknown>;
		}).renameManagedProject({ path: env.project.projectFile, rootPath: env.project.rootPath }, 'Alpha Draft');
		const newRoot = `${env.project.rootPath} Draft`;
		const newPath = env.project.projectFile.replace(env.project.rootPath, newRoot);
		for (const leaf of leaves) {
			expect(leaf.getViewState().state?.projectPath).toBe(newPath);
			expect(leaf.loadIfDeferred).not.toHaveBeenCalled();
		}
		expect(leaves[0]?.getViewState().state).toMatchObject({ projectTitle: 'Alpha Draft', selectedStep: 8 });
		expect(leaves[2]?.getViewState().state?.anchorPath).toBe(`${newRoot}/50_Manuscript/Chapter.md`);
		expect(env.plugin.settings.recentProjectPath).toBe(newPath);
	});

	it('#2 updates the dashboard title after a vault event already retargeted its saved path', async () => {
		const env = await serviceProject();
		const nextPath = env.project.projectFile.replace('/Alpha/', '/Alpha Draft/');
		let saved: ViewState = { type: DASHBOARD_VIEW_TYPE, state: { projectPath: nextPath, projectTitle: 'Alpha' } };
		const leaf = { getViewState: () => saved, setViewState: vi.fn(async (state: ViewState) => { saved = state; }) };
		Object.assign(env.plugin, { app: { workspace: { getLeavesOfType: (type: string) => type === DASHBOARD_VIEW_TYPE ? [leaf] : [] } } });
		await (env.plugin as unknown as {
			renameProjectViews(oldPath: string, newPath: string, project: unknown): Promise<void>;
		}).renameProjectViews(env.project.rootPath, `${env.project.rootPath} Draft`, {
			path: nextPath, projectId: env.project.id, title: 'Alpha Draft', locale: 'en',
		});
		expect(saved.state).toMatchObject({ projectPath: nextPath, projectTitle: 'Alpha Draft' });
	});

	it('#9 quietly ignores a deleted project when its saved tab is reactivated', async () => {
		const env = await serviceProject();
		env.fakeVault.delete(env.project.rootPath);
		const loadProject = vi.spyOn(env.service, 'loadProject');
		const view = Object.create(SnowflakeStoryStructureView.prototype) as SnowflakeStoryStructureView;
		Object.assign(view, { model: null, state: { projectPath: env.project.projectFile } });
		const leaf = {
			view, loadIfDeferred: vi.fn(async () => undefined),
			getViewState: () => ({ type: STORY_STRUCTURE_VIEW_TYPE, state: { projectPath: env.project.projectFile } }),
		};
		Object.assign(env.plugin, { projectLeafActivation: 0, app: { workspace: { getMostRecentLeaf: () => leaf } } });
		const routing = env.plugin as unknown as { activateProjectLeaf(leaf: unknown): Promise<void> };
		for (let click = 0; click < 3; click++) {
			await expect(routing.activateProjectLeaf(leaf)).resolves.toBeUndefined();
		}
		expect(loadProject).toHaveBeenCalledTimes(3);
	});

	it('#13 clears the old project search, filters and scroll when a workspace is retargeted', async () => {
		const { view, internals } = workspaceView();
		await view.setState({ projectPath }, { history: false });
		internals.memory.query = 'hidden search';
		internals.memory.filters.character = 'Novels/Alpha/20_Characters/Hero.md';
		internals.memory.filters.status = 'complete';
		internals.memory.scrollTop = 420;
		await view.setState({ projectPath: 'Novels/Beta/00_System/001_Project_Metadata.md' }, { history: false });
		expect(internals.memory).toMatchObject({ query: '', scrollTop: 0, filters: { character: '', status: 'all' } });
	});

	it.each(['timeline', 'plotline', 'beat-sheet', 'corkboard-freeform'])('#14 preserves the %s frame and focused tab on a refresh', async (visualization) => {
		const { view, content, dom } = workspaceView();
		await view.setState({ projectPath, visualization }, { history: false });
		await view.onOpen();
		const original = content.querySelector('.snowflake-method-tabs')!;
		const button = original.querySelector('button')!;
		button.focus();
		await view.refresh();
		expect(content.querySelector('.snowflake-method-tabs')).toBe(original);
		expect(dom.doc.activeElement).toBe(button);
	});

	it('#14 control: corkboard refresh preserves the frame and its focused tab', async () => {
		const { view, content, dom } = workspaceView();
		await view.setState({ projectPath, visualization: 'corkboard-ordered' }, { history: false });
		await view.onOpen();
		const original = content.querySelector('.snowflake-method-tabs')!;
		const button = original.querySelector('button')!;
		button.focus();
		await view.refresh();
		expect(content.querySelector('.snowflake-method-tabs')).toBe(original);
		expect(dom.doc.activeElement).toBe(button);
	});

	it('#14 preserves an empty project frame across refreshes', async () => {
		const { view, content } = workspaceView();
		await view.setState({ projectPath: null }, { history: false });
		await view.onOpen();
		const original = content.querySelector('.snowflake-method-tabs');
		await view.refresh();
		expect(content.querySelector('.snowflake-method-tabs')).toBe(original);
	});

	it('#19 deletion counterexample: production null model closes the open popover without entering error rendering', async () => {
		const env = await serviceProject();
		const { view, internals, content, loadDashboardModel } = workspaceView();
		await view.setState({ projectPath: env.project.projectFile }, { history: false });
		await view.onOpen();
		internals.filterPanel.open(content.createEl('button') as unknown as HTMLElement, [], () => undefined);
		env.fakeVault.delete(env.project.projectFile);
		loadDashboardModel.mockImplementation(env.plugin.loadDashboardModel.bind(env.plugin));
		await view.refresh();
		expect(internals.filterPanel.isOpen()).toBe(false);
		expect(content.querySelector('p')?.textContent).toBe('storyStructure.noProject');
	});

	it('#19 closes the body popover and releases its listeners when duplicate character ids prevent loading', async () => {
		const env = await serviceProject();
		const { view, internals, content, dom, loadDashboardModel, removedListener } = workspaceView();
		await view.setState({ projectPath: env.project.projectFile }, { history: false });
		await view.onOpen();
		const anchor = content.createEl('button');
		internals.filterPanel.open(anchor as unknown as HTMLElement, [], () => undefined);
		await duplicateCharacterId(env);
		await expect(env.plugin.loadDashboardModel(env.project.projectFile)).rejects.toBeInstanceOf(InvalidManagedDocumentError);
		loadDashboardModel.mockImplementation(env.plugin.loadDashboardModel.bind(env.plugin));
		await view.refresh();
		expect(content.querySelector('p')?.textContent).toContain('storyStructure.loadFailed');
		expect(internals.filterPanel.isOpen()).toBe(false);
		expect(dom.container.querySelectorAll('.snowflake-method-filter-panel')).toHaveLength(0);
		expect(anchor.isConnected).toBe(false);
		expect(removedListener).toHaveBeenCalledTimes(3);
		expect(dom.observers.filter((observer) => observer.disconnected)).toHaveLength(1);
		await view.onClose();
		expect(internals.filterPanel.isOpen()).toBe(false);
	});

	it('#22 counterexample: a later thrown failure preserves the known fingerprint and does not trigger hidden rereads', async () => {
		const { view, loadDashboardModel, internals } = workspaceView();
		await view.setState({ projectPath }, { history: false });
		await view.onOpen();
		loadDashboardModel.mockRejectedValue(new Error('Transient read failure'));
		await view.refresh();
		expect(internals.shownFingerprint).toBe('en|en');
		loadDashboardModel.mockClear();
		for (let event = 0; event < 3; event++) { view.queueRefreshWhenShown(); view.rerender(); }
		await Promise.resolve();
		expect(loadDashboardModel).not.toHaveBeenCalled();
	});

	it('#22 defers an initially failing hidden tab until reveal and recovers on a later reveal', async () => {
		const env = await serviceProject();
		await duplicateCharacterId(env);
		const { view, loadDashboardModel, internals, setShown } = workspaceView();
		loadDashboardModel.mockImplementation(env.plugin.loadDashboardModel.bind(env.plugin));
		await view.setState({ projectPath: env.project.projectFile }, { history: false });
		await view.onOpen();
		expect(internals.shownFingerprint).toBeNull();
		loadDashboardModel.mockClear();
		for (let event = 0; event < 3; event++) {
			view.queueRefreshWhenShown();
			view.rerender();
		}
		expect(loadDashboardModel).not.toHaveBeenCalled();
		setShown(true);
		view.onResize();
		await vi.waitFor(() => expect(loadDashboardModel).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(view).toMatchObject({ refreshing: false }));
		setShown(false);
		view.rerender();
		loadDashboardModel.mockResolvedValue(dashboardModel);
		setShown(true);
		view.onResize();
		await vi.waitFor(() => expect(internals.shownFingerprint).toBe('en|en'));
		loadDashboardModel.mockClear();
		for (let event = 0; event < 3; event++) { view.queueRefreshWhenShown(); view.rerender(); }
		expect(loadDashboardModel).not.toHaveBeenCalled();
	});

	it('#22 deleted metadata also records its fingerprint: missing is a successful empty model', async () => {
		const env = await serviceProject();
		env.fakeVault.delete(env.project.projectFile);
		const { view, loadDashboardModel, internals } = workspaceView();
		loadDashboardModel.mockImplementation(env.plugin.loadDashboardModel.bind(env.plugin));
		await view.setState({ projectPath: env.project.projectFile }, { history: false });
		await view.onOpen();
		expect(internals.shownFingerprint).toBe('en|en');
		loadDashboardModel.mockClear();
		view.queueRefreshWhenShown();
		view.rerender();
		expect(loadDashboardModel).not.toHaveBeenCalled();
	});

	it('#22 defers a locale change while hidden and redraws once the tab is revealed', async () => {
		const { view, loadDashboardModel, internals, setFingerprint, setShown } = workspaceView();
		await view.setState({ projectPath }, { history: false });
		await view.onOpen();
		setFingerprint('zh-CN|en');
		loadDashboardModel.mockClear();
		for (let event = 0; event < 3; event++) view.rerender();
		expect(loadDashboardModel).not.toHaveBeenCalled();
		setShown(true);
		view.onResize();
		await vi.waitFor(() => expect(internals.shownFingerprint).toBe('zh-CN|en'));
		expect(loadDashboardModel).toHaveBeenCalledOnce();
	});

	it('production missing-file exception type is distinct from data corruption', async () => {
		const env = await serviceProject();
		env.fakeVault.delete(env.project.projectFile);
		await expect(env.service.loadProject(env.project.projectFile)).rejects.toBeInstanceOf(ManagedFileNotFoundError);
		await expect(env.plugin.loadDashboardModel(env.project.projectFile)).resolves.toBeNull();
	});
});
