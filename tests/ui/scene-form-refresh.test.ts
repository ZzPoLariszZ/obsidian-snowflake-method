import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

// Keep Obsidian's window and modal drawing outside this test, while running
// the dashboard's form routing and the scene modal's real initialization.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
	}
	return {
		...runtime,
		Modal,
		ItemView: class {},
		FuzzySuggestModal: class extends Modal {},
		SuggestModal: class extends Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import { sceneFilters } from '../../src/ui/scene-filters';
import { CreateSceneModal } from '../../src/ui/modals';

const scene = (fields: Partial<SceneViewModel> = {}): SceneViewModel => ({
	id: 'scene-1',
	path: 'Novel/Scenes/Arrival.md',
	title: 'Arrival',
	rank: 1,
	progressStatus: 'not-started',
	aliases: [],
	categoryPaths: [],
	povPath: '',
	povName: '',
	povMissing: false,
	times: [],
	locations: [],
	characterPaths: [],
	conflict: 'The gate is locked.',
	color: null,
	linkedManuscript: [],
	worldStatus: [],
	relationships: [],
	events: '',
	customFields: '',
	revision: 'before-card-edit',
	readOnly: false,
	healthIssues: [],
	...fields,
});

function dashboard(read: () => Promise<SceneViewModel[]>) {
	// A hidden dashboard already has a model, but the active corkboard has
	// saved a newer reading of the same scene. Only refresh replaces it.
	const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
	const activateProject = vi.fn();
	const refresh = vi.fn(async () => {
		const scenes = await read();
		Object.assign(view, { lastRender: { model: { scenes, characters: [] } } });
	});
	Object.assign(view, {
		app: {},
		host: { activateProject },
		projectPath: 'Novel/Novel.md',
		projectLocale: 'en',
		selectedStep: 8,
		t: (key: string) => key,
		lastRender: { model: { scenes: [scene()], characters: [] } },
		refresh,
		memberFormContext: vi.fn(() => Promise.resolve(undefined)),
		creatingCharacter: vi.fn(() => null),
	});
	const opened: CreateSceneModal[] = [];
	vi.spyOn(CreateSceneModal.prototype, 'open').mockImplementation(function (this: CreateSceneModal) {
		opened.push(this);
	});
	vi.spyOn(CreateSceneModal.prototype, 'onClose').mockImplementation(() => undefined);
	return { view, refresh, opened, activateProject };
}

afterEach(() => vi.restoreAllMocks());

describe('scene forms opened from another surface', () => {
	it('initializes the modal from saved card edits even when the dashboard already has a model', async () => {
		const saved = scene({
			title: 'The breached gate',
			progressStatus: 'in-progress',
			conflict: 'The guards demand the missing permit.',
			revision: 'after-card-edits',
		});
		const { view, refresh, opened, activateProject } = dashboard(() => Promise.resolve([saved]));
		const closing = view.openSceneForm({ mode: 'edit', id: saved.id });
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0];
		expect(form).toBeDefined();
		try {
			expect(form).toMatchObject({
				title: saved.title,
				progressStatus: saved.progressStatus,
				conflict: saved.conflict,
				expectedRevision: saved.revision,
			});
			expect(refresh).toHaveBeenCalledOnce();
			expect(activateProject).not.toHaveBeenCalled();
		} finally {
			form?.onClose();
			await closing;
		}
	});

	it('waits for the refreshed scene before constructing its modal', async () => {
		let finishRead!: (scenes: SceneViewModel[]) => void;
		const reading = new Promise<SceneViewModel[]>((resolve) => {
			finishRead = resolve;
		});
		const { view, opened } = dashboard(() => reading);
		const closing = view.openSceneForm({ mode: 'edit', id: 'scene-1' });
		await Promise.resolve();
		await Promise.resolve();
		try {
			expect(opened).toHaveLength(0);
		} finally {
			finishRead([scene({ revision: 'fresh-read' })]);
			await vi.waitFor(() => expect(opened).toHaveLength(1));
			opened[0]?.onClose();
			await closing;
		}
		expect(opened[0]).toMatchObject({ expectedRevision: 'fresh-read' });
	});

	it('does not open an editor for a scene removed since the dashboard was drawn', async () => {
		const { view, opened } = dashboard(() => Promise.resolve([]));
		const closing = view.openSceneForm({ mode: 'edit', id: 'scene-1' });
		// Allow both the read and form initialization to settle before closing
		// any unexpected modal, so a regression fails without leaving a wait.
		await new Promise((resolve) => setTimeout(resolve, 0));
		opened[0]?.onClose();
		expect(await closing).toBeNull();
		expect(opened).toHaveLength(0);
	});
});


describe('scene form protection and requesting-surface state', () => {
	it.each(['scene-readonly', 'project-readonly', 'damaged'] as const)('does not open a form for %s', async (state) => {
		const record = scene({
			readOnly: state === 'scene-readonly',
			healthIssues: state === 'damaged' ? [{ blocking: true }] as SceneViewModel['healthIssues'] : [],
		});
		const { view, opened } = dashboard(() => Promise.resolve([record]));
		if (state === 'project-readonly') Object.assign(view, { refresh: async () => {
			Object.assign(view, { lastRender: { model: { scenes: [record], characters: [], readOnly: true } } });
		} });
		expect(await view.openSceneForm({ mode: 'edit', id: record.id })).toBeNull();
		expect(opened).toHaveLength(0);
	});

	it.each([null, 0])('external creation preserves dashboard filters and scroll (afterIndex %s)', async (afterIndex) => {
		const { view, opened } = dashboard(() => Promise.resolve([scene()]));
		const savedModel = { path: 'Novel/Novel.md', scenes: [scene()], characters: [] } as unknown as ProjectDashboardModel;
		const createScene = vi.fn(() => Promise.resolve({ id: 'new', path: 'Novel/Scenes/New.md' }));
		const reorderScene = vi.fn(() => Promise.resolve());
		const revealScene = vi.fn();
		const filters = { ...sceneFilters(), status: 'complete' as const };
		Object.assign(view, {
			host: { createScene, reorderScene }, sceneQuery: 'gate', sceneFilters: filters, sceneScroll: 123,
			revealScene,
			refresh: async () => { Object.assign(view, { lastRender: { model: savedModel } }); },
		});
		const closing = view.openSceneForm({ mode: 'create', afterIndex });
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0]!;
		try {
			const submit = (form as unknown as { submitHandler: (request: unknown) => Promise<void> }).submitHandler;
			await submit({ title: 'New' });
			expect(createScene).toHaveBeenCalledWith({ title: 'New' }, 'Novel/Novel.md');
			expect(view).toMatchObject({ sceneQuery: 'gate', sceneScroll: 123 });
			expect(filters.status).toBe('complete');
			expect(revealScene).not.toHaveBeenCalled();
			if (afterIndex !== null) expect(reorderScene).toHaveBeenCalledWith('new', 1, 'Novel/Novel.md');
		} finally {
			form.onClose();
			await closing;
		}
	});
});
