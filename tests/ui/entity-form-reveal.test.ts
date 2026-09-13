import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectDashboardModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

// Keep Obsidian's window and modal drawing outside this test, while running
// the dashboard's form routing and the worldbuilding modal's real initialization.
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
import { EntityFormModal } from '../../src/ui/modals';

const entity = (fields: Partial<WorldbuildingEntityViewModel> = {}): WorldbuildingEntityViewModel => ({
	id: 'entity-1',
	path: 'Novel/60_Worldbuilding/61_Time/Dawn.md',
	name: 'Dawn',
	kind: 'time',
	rank: 1,
	progressStatus: 'not-started',
	aliases: [],
	categoryPaths: [],
	description: 'First light',
	timeKind: 'point',
	timeStart: '',
	timeEnd: '',
	timeStartMissing: false,
	timeEndMissing: false,
	worldStatus: [],
	relationships: [],
	customFields: '',
	revision: 'before-edit',
	readOnly: false,
	healthIssues: [],
	...fields,
});

function dashboard(entities: WorldbuildingEntityViewModel[]) {
	const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
	const refresh = vi.fn(async () => undefined);
	const updateEntity = vi.fn(async () => undefined);
	const createEntity = vi.fn(async () => ({ id: 'entity-9', path: 'Novel/60_Worldbuilding/61_Time/Dusk.md' }));
	const loadDashboardModel = vi.fn(async () => ({
		path: 'Novel/Novel.md',
		scenes: [],
		characters: [],
		worldbuilding: { time: entities },
		worldbuildingKinds: [{ id: 'time', folderName: '61_Time', custom: false }],
		readOnly: false,
	} as unknown as ProjectDashboardModel));
	Object.assign(view, {
		app: {},
		host: { loadDashboardModel, updateEntity, createEntity },
		projectPath: 'Novel/Novel.md',
		projectLocale: 'en',
		selectedStep: 8,
		t: (key: string) => key,
		refresh,
		memberFormContext: vi.fn(() => Promise.resolve(undefined)),
	});
	const opened: EntityFormModal[] = [];
	vi.spyOn(EntityFormModal.prototype, 'open').mockImplementation(function (this: EntityFormModal) {
		opened.push(this);
	});
	vi.spyOn(EntityFormModal.prototype, 'onClose').mockImplementation(() => undefined);
	const revealed = vi.spyOn(EntityFormModal.prototype, 'revealDescription').mockImplementation(() => undefined);
	return { view, refresh, opened, revealed, updateEntity, createEntity, loadDashboardModel };
}

const submit = (form: EntityFormModal, request: unknown): Promise<void> =>
	(form as unknown as { submitHandler(request: unknown): Promise<void> }).submitHandler(request);

afterEach(() => vi.restoreAllMocks());

describe('worldbuilding forms opened from another surface', () => {
	it('opens the editor on its description and reports the save without reloading the hidden dashboard', async () => {
		const { view, opened, revealed, updateEntity, refresh, loadDashboardModel } = dashboard([entity()]);
		const onSaved = vi.fn();
		const closing = view.openEntityForm({ mode: 'edit', id: 'entity-1', section: 'description' }, onSaved);
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0]!;
		expect(revealed).toHaveBeenCalledOnce();
		await submit(form, { kind: 'time', name: 'Dawn', description: 'Changed' });
		expect(updateEntity).toHaveBeenCalledExactlyOnceWith('entity-1', { kind: 'time', name: 'Dawn', description: 'Changed' }, 'Novel/Novel.md');
		expect(onSaved).toHaveBeenCalledOnce();
		expect(loadDashboardModel).toHaveBeenCalledOnce();
		expect(refresh).not.toHaveBeenCalled();
		expect(view).toMatchObject({ refreshQueuedWhileHidden: true });
		form.onClose();
		expect(await closing).toBeNull();
	});

	it('leaves the description where it is unless asked to open on it', async () => {
		const { view, opened, revealed } = dashboard([entity()]);
		const closing = view.openEntityForm({ mode: 'edit', id: 'entity-1' });
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		expect(revealed).not.toHaveBeenCalled();
		opened[0]!.onClose();
		await closing;
	});

	it('makes a note of the kind from the preset, and reports its id', async () => {
		const { view, opened, createEntity } = dashboard([]);
		const onSaved = vi.fn();
		const closing = view.openEntityForm(
			{ mode: 'create', kind: 'time', preset: { name: 'Dusk', timeKind: 'point', lockTimeKind: true } },
			onSaved,
		);
		await vi.waitFor(() => expect(opened).toHaveLength(1));
		const form = opened[0]!;
		await submit(form, { kind: 'time', name: 'Dusk', description: '' });
		expect(createEntity).toHaveBeenCalledExactlyOnceWith({ kind: 'time', name: 'Dusk', description: '' }, 'Novel/Novel.md');
		expect(onSaved).toHaveBeenCalledOnce();
		form.onClose();
		expect(await closing).toBe('entity-9');
	});

	it('does not open an editor for a note that cannot be written, or one that is gone', async () => {
		const { view, opened } = dashboard([entity({ readOnly: true })]);
		expect(await view.openEntityForm({ mode: 'edit', id: 'entity-1', section: 'description' })).toBeNull();
		expect(await view.openEntityForm({ mode: 'edit', id: 'entity-2' })).toBeNull();
		expect(opened).toHaveLength(0);
	});
});
