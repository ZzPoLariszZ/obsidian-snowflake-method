import { describe, expect, it, vi } from 'vitest';

import type { ViewState } from 'obsidian';
import type { SceneFormIntent } from '../../src/ui/view-model';

// The real plugin routes the request; only Obsidian's workspace and view
// drawing are replaced, including the placeholder view restored after reload.
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
import {
	DASHBOARD_VIEW_TYPE,
	SnowflakeDashboardView,
} from '../../src/ui/dashboard-view';

const projectPath = 'Novel/Novel.md';
const rootSplit = {};
const sceneIntent: SceneFormIntent = { mode: 'edit', id: 'scene-1' };

function dashboardLeaf(
	path = projectPath,
	deferred = false,
	loading: Promise<void> = Promise.resolve(),
	root = rootSplit,
) {
	const dashboard = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
	const openSceneForm = vi.fn((_intent: SceneFormIntent) => Promise.resolve('saved-scene'));
	const openCharacterForm = vi.fn((_id: string) => Promise.resolve());
	const queueRefreshWhenShown = vi.fn();
	Object.assign(dashboard, {
		getProjectPath: () => path,
		openSceneForm,
		openCharacterForm,
		queueRefreshWhenShown,
	});
	let state: ViewState = {
		type: DASHBOARD_VIEW_TYPE,
		state: { projectPath: path, selectedStep: 4 },
	};
	const leaf = {
		view: deferred ? {} : dashboard,
		getRoot: () => root,
		getViewState: () => state,
		setViewState: vi.fn((next: ViewState) => {
			state = next;
			return Promise.resolve();
		}),
		loadIfDeferred: vi.fn(async () => {
			await loading;
			leaf.view = dashboard;
		}),
	};
	return { leaf, openSceneForm, openCharacterForm, queueRefreshWhenShown };
}

function pluginWith(leaves: ReturnType<typeof dashboardLeaf>['leaf'][]) {
	const from = {};
	let activeLeaf: object = from;
	const created = dashboardLeaf(projectPath, true);
	const workspace = {
		rootSplit,
		getLeavesOfType: vi.fn((_type: string) => leaves),
		getMostRecentLeaf: vi.fn((_root: object) => activeLeaf),
		getLeaf: vi.fn((_kind: string) => {
			// Obsidian puts a newly made tab in front even when its subsequent
			// view state asks to remain inactive.
			activeLeaf = created.leaf;
			leaves.push(created.leaf);
			return created.leaf;
		}),
		revealLeaf: vi.fn((leaf: object) => {
			activeLeaf = leaf;
			return Promise.resolve();
		}),
		setActiveLeaf: vi.fn((leaf: object, _options: { focus: boolean }) => {
			activeLeaf = leaf;
		}),
	};
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	Object.assign(plugin, {
		app: { workspace },
		settings: { recentProjectPath: projectPath, recentStep: 8 },
	});
	return { plugin, workspace, from, created, activeLeaf: () => activeLeaf };
}

const forms = [
	{
		name: 'scene',
		open: (plugin: SnowflakeMethodPlugin) => plugin.openSceneForm(sceneIntent),
		called: (dashboard: ReturnType<typeof dashboardLeaf>) => {
			expect(dashboard.openSceneForm).toHaveBeenCalledExactlyOnceWith(sceneIntent);
		},
	},
	{
		name: 'character',
		open: (plugin: SnowflakeMethodPlugin) => plugin.openCharacterForm('character-1'),
		called: (dashboard: ReturnType<typeof dashboardLeaf>) => {
			expect(dashboard.openCharacterForm).toHaveBeenCalledExactlyOnceWith('character-1');
		},
	},
];

describe.each(forms)('$name forms requested from another surface', ({ open, called }) => {
	it('loads and reuses the matching deferred dashboard without creating a duplicate', async () => {
		let finishLoading!: () => void;
		const loading = new Promise<void>((resolve) => { finishLoading = resolve; });
		const restored = dashboardLeaf(projectPath, true, loading);
		const { plugin, workspace, from, activeLeaf } = pluginWith([restored.leaf]);
		const opening = open(plugin);
		try {
			expect(restored.leaf.loadIfDeferred).toHaveBeenCalledOnce();
			expect(workspace.getLeaf).not.toHaveBeenCalled();
			expect(restored.openSceneForm).not.toHaveBeenCalled();
			expect(restored.openCharacterForm).not.toHaveBeenCalled();
		} finally {
			finishLoading();
			await opening;
		}
		called(restored);
		expect(restored.leaf.setViewState).not.toHaveBeenCalled();
		expect(restored.leaf.getViewState().state?.selectedStep).toBe(4);
		expect(restored.queueRefreshWhenShown).toHaveBeenCalledOnce();
		expect(activeLeaf()).toBe(from);
	});

	it('reuses a matching loaded dashboard and keeps the requesting surface active', async () => {
		const loaded = dashboardLeaf();
		const { plugin, workspace, from, activeLeaf } = pluginWith([loaded.leaf]);
		await open(plugin);
		called(loaded);
		expect(workspace.getLeaf).not.toHaveBeenCalled();
		expect(loaded.leaf.setViewState).not.toHaveBeenCalled();
		expect(activeLeaf()).toBe(from);
	});

	it.each(['absent', 'another project', 'another root'] as const)(
		'creates a background dashboard when the matching main-workspace tab is %s',
		async (existing) => {
			const unrelated = dashboardLeaf(
				existing === 'another project' ? 'Other/Other.md' : projectPath,
				true,
				Promise.resolve(),
				existing === 'another root' ? {} : rootSplit,
			);
			const { plugin, workspace, from, created, activeLeaf } = pluginWith(
				existing === 'absent' ? [] : [unrelated.leaf],
			);
			await open(plugin);
			called(created);
			expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('tab');
			expect(created.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
				type: DASHBOARD_VIEW_TYPE,
				active: false,
				state: { projectPath, selectedStep: 8 },
			});
			expect(created.leaf.loadIfDeferred).toHaveBeenCalledOnce();
			expect(unrelated.leaf.loadIfDeferred).not.toHaveBeenCalled();
			expect(created.queueRefreshWhenShown).toHaveBeenCalledOnce();
			expect(workspace.revealLeaf).toHaveBeenCalledExactlyOnceWith(from);
			expect(workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(from, { focus: true });
			expect(activeLeaf()).toBe(from);
		},
	);
});
