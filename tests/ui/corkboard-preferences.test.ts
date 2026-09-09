import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {
			app: unknown;
			contentEl = { addClass: (): void => undefined, empty: (): void => undefined };
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
			setState(): Promise<void> { return Promise.resolve(); }
			registerDomEvent(): void {}
		},
		Scope: class { register(): void {} },
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import type { CorkboardControls } from '../../src/ui/corkboard-bridge';
import { sceneFilters } from '../../src/ui/scene-filters';
import type { CorkboardPreferences } from '../../src/ui/story-structure-state';
import { SnowflakeStoryStructureView } from '../../src/ui/story-structure-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';

const firstProject = 'First/First.md';
const secondProject = 'Second/Second.md';
const firstProjectId = 'project-first';
const secondProjectId = 'project-second';
const preferenceKey = (projectId: string): string =>
	`snowflake-method-corkboard-preferences:${projectId}`;

function preferenceStore(initial: Record<string, unknown> = {}) {
	const stored = new Map(Object.entries(initial));
	const app = {
		loadLocalStorage: vi.fn((key: string): unknown => stored.get(key)),
		saveLocalStorage: vi.fn((key: string, value: unknown) => { stored.set(key, value); }),
	};
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as {
		corkboardPreferences(projectId: string): Partial<CorkboardPreferences>;
		rememberCorkboardPreferences(projectId: string, changes: Partial<CorkboardPreferences>, onlyIfMissing?: boolean): void;
	};
	Object.assign(plugin, { app });
	return {
		stored, app,
		read: (projectId: string) => plugin.corkboardPreferences(projectId),
		write: (projectId: string, changes: Partial<CorkboardPreferences>, onlyIfMissing?: boolean) =>
			plugin.rememberCorkboardPreferences(projectId, changes, onlyIfMissing),
	};
}

function workspaceView(store: ReturnType<typeof preferenceStore>) {
	const workspace = { layoutReady: true, requestSaveLayout: vi.fn() };
	const loadDashboardModel = vi.fn((path: string) => Promise.resolve({
		path, projectId: path === firstProject ? firstProjectId : secondProjectId, title: path, locale: 'en',
	} as ProjectDashboardModel));
	const view = new SnowflakeStoryStructureView({
		app: { scope: {}, workspace },
	} as unknown as WorkspaceLeaf, {
		host: { loadDashboardModel } as unknown as DashboardHost,
		fingerprint: () => 'en',
		recentProjectPath: () => firstProject,
		corkboardPreferences: store.read,
		rememberCorkboardPreferences: store.write,
		corkboard: () => { throw new Error('The frame is stubbed in this test.'); },
	});
	// Keep the real view lifecycle, preference storage and board callbacks;
	// scene rendering does not affect which settings survive closing a tab.
	Object.assign(view, {
		renderFrame: vi.fn(), updateHeader: vi.fn(),
		renderError: (error: unknown) => { throw error; },
	});
	const controls = (view as unknown as { controls(): CorkboardControls }).controls();
	return { view, controls, workspace, loadDashboardModel };
}

async function openView(
	store: ReturnType<typeof preferenceStore>,
	projectPath = firstProject,
	corkboard?: Record<string, unknown>,
) {
	const fixture = workspaceView(store);
	await fixture.view.setState({ projectPath, corkboard }, { history: false });
	await fixture.view.onOpen();
	return fixture;
}

describe('corkboard preferences across closed tabs', () => {
	it('reopens with the chosen card style and order, without grouping, search or filters', async () => {
		const store = preferenceStore();
		const first = await openView(store);
		first.controls.memory.mode = 'extended';
		first.controls.remember({ mode: 'extended' });
		first.controls.memory.reversed = true;
		first.controls.remember({ reversed: true });
		first.controls.memory.group = 'pov';
		first.controls.remember();
		first.controls.memory.query = 'missing permit';
		first.controls.memory.filters.status = 'in-progress';
		first.controls.memory.scrollTop = 900;
		const savesBeforeClose = store.app.saveLocalStorage.mock.calls.length;

		await first.view.onClose();
		expect(store.app.saveLocalStorage).toHaveBeenCalledTimes(savesBeforeClose);
		const reopened = await openView(store);

		expect(reopened.controls.memory).toEqual({
			mode: 'extended', reversed: true, group: '', query: '',
			filters: sceneFilters(), scrollTop: 0,
		});
		expect(store.stored.get(preferenceKey(firstProjectId))).toEqual({ mode: 'extended', reversed: true });
	});

	it('keeps different project preferences independent', async () => {
		const store = preferenceStore();
		const first = await openView(store);
		first.controls.memory.mode = 'compact';
		first.controls.remember({ mode: 'compact' });
		const second = await openView(store, secondProject);
		second.controls.memory.mode = 'extended';
		second.controls.memory.reversed = true;
		second.controls.remember({ mode: 'extended', reversed: true });
		await first.view.onClose();
		await second.view.onClose();

		expect((await openView(store)).controls.memory).toMatchObject({ mode: 'compact', reversed: false });
		expect((await openView(store, secondProject)).controls.memory).toMatchObject({ mode: 'extended', reversed: true });
	});

	it('preserves a restored tab layout over defaults without replacing shared preferences', async () => {
		const store = preferenceStore({
			[preferenceKey(firstProjectId)]: { mode: 'extended', reversed: true },
		});
		const restored = await openView(store, firstProject, { mode: 'compact', reversed: false, group: 'status' });

		expect(restored.controls.memory).toMatchObject({ mode: 'compact', reversed: false, group: 'status' });
		expect(store.app.saveLocalStorage).not.toHaveBeenCalled();
		expect((await openView(store)).controls.memory).toMatchObject({ mode: 'extended', reversed: true, group: '' });
	});

	it('uses defaults for omitted restored fields and migrates only missing stored preferences', async () => {
		const store = preferenceStore({ [preferenceKey(firstProjectId)]: { mode: 'extended' } });
		const restored = await openView(store, firstProject, { reversed: true, group: 'pov' });

		expect(restored.controls.memory).toMatchObject({ mode: 'extended', reversed: true, group: 'pov' });
		expect(store.stored.get(preferenceKey(firstProjectId))).toEqual({ mode: 'extended', reversed: true });
	});

	it('does not overwrite an unknown saved mode while opening or changing order', async () => {
		const key = preferenceKey(firstProjectId);
		const store = preferenceStore({ [key]: { mode: 'future-mode', futureField: 'keep' } });
		const opened = await openView(store);
		expect(opened.controls.memory.mode).toBe('standard');
		expect(store.stored.get(key)).toEqual({ mode: 'future-mode', futureField: 'keep', reversed: false });
		opened.controls.remember({ reversed: true });
		expect(store.stored.get(key)).toEqual({ mode: 'future-mode', futureField: 'keep', reversed: true });
		opened.controls.remember({ mode: 'compact' });
		expect(store.stored.get(key)).toEqual({ mode: 'compact', futureField: 'keep', reversed: true });
	});

	it('does not let a stale tab grouping change or close overwrite another tab preference change', async () => {
		const store = preferenceStore();
		const stale = await openView(store);
		const current = await openView(store);
		current.controls.memory.mode = 'extended';
		current.controls.remember({ mode: 'extended' });
		current.controls.memory.reversed = true;
		current.controls.remember({ reversed: true });
		store.app.saveLocalStorage.mockClear();

		stale.controls.memory.group = 'pov';
		stale.controls.remember();
		await stale.view.onClose();

		expect(store.app.saveLocalStorage).not.toHaveBeenCalled();
		expect((await openView(store)).controls.memory).toMatchObject({ mode: 'extended', reversed: true, group: '' });
	});

	it('does not reapply shared defaults or save on a loaded tab refresh', async () => {
		const store = preferenceStore();
		const first = await openView(store);
		store.write(firstProjectId, { mode: 'extended', reversed: true });
		store.app.saveLocalStorage.mockClear();
		first.controls.memory.query = 'scene';
		first.controls.memory.group = 'pov';

		await first.view.refresh();
		await first.view.refresh();

		expect(first.controls.memory).toMatchObject({ mode: 'standard', reversed: false, group: 'pov', query: 'scene' });
		expect(store.app.saveLocalStorage).not.toHaveBeenCalled();
	});

	it('applies the project defaults when a view receives a different project', async () => {
		const store = preferenceStore({
			[preferenceKey(firstProjectId)]: { mode: 'compact', reversed: false },
			[preferenceKey(secondProjectId)]: { mode: 'extended', reversed: true },
		});
		const { view, controls } = await openView(store);

		await view.setState({ projectPath: secondProject }, { history: false });

		expect(controls.memory).toMatchObject({ mode: 'extended', reversed: true });
		expect(store.app.saveLocalStorage).not.toHaveBeenCalled();
	});
});

describe('stored corkboard preferences', () => {
	it('merges changed fields with the latest stored preferences', () => {
		const store = preferenceStore({ [preferenceKey(firstProjectId)]: { mode: 'extended', reversed: false } });

		store.write(firstProjectId, { reversed: true });
		expect(store.read(firstProjectId)).toEqual({ mode: 'extended', reversed: true });
		store.write(firstProjectId, { mode: 'compact' });
		expect(store.read(firstProjectId)).toEqual({ mode: 'compact', reversed: true });
	});

	it.each([null, 'compact', []])('ignores malformed storage: %j', (value) => {
		const store = preferenceStore({ [preferenceKey(firstProjectId)]: value });

		expect(store.read(firstProjectId)).toEqual({});
		store.write(firstProjectId, { mode: 'compact' });
		expect(store.stored.get(preferenceKey(firstProjectId))).toEqual({ mode: 'compact' });
	});

	it('reads known durable fields while preserving other stored fields on writes', () => {
		const store = preferenceStore({
			[preferenceKey(firstProjectId)]: { mode: 'compact', reversed: true, group: 'pov', query: 'scene' },
		});

		expect(store.read(firstProjectId)).toEqual({ mode: 'compact', reversed: true });
		store.write(firstProjectId, { mode: 'extended' });
		expect(store.stored.get(preferenceKey(firstProjectId))).toEqual({ mode: 'extended', reversed: true, group: 'pov', query: 'scene' });
	});

	it('preserves a newer card mode until the author explicitly changes that field', () => {
		const store = preferenceStore({
			[preferenceKey(firstProjectId)]: { mode: 'future-mode', reversed: false, futureLayout: { columns: 4 } },
		});
		expect(store.read(firstProjectId)).toEqual({ reversed: false });
		store.write(firstProjectId, { reversed: true });
		expect(store.stored.get(preferenceKey(firstProjectId))).toEqual({ mode: 'future-mode', reversed: true, futureLayout: { columns: 4 } });
		store.write(firstProjectId, { mode: 'compact' });
		expect(store.stored.get(preferenceKey(firstProjectId))).toEqual({ mode: 'compact', reversed: true, futureLayout: { columns: 4 } });
	});
});
