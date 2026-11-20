// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		getIcon: () => null,
		Notice: class {
			constructor(message: unknown) {
				notices.push(String(message));
			}
		},
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) {
				this.app = leaf.app;
			}
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';

function makeModel(title = 'Novel'): ProjectDashboardModel {
	return {
		path: PROJECT,
		projectId: 'novel',
		title,
		locale: 'en',
		readOnly: false,
		readOnlyReason: null,
		series: null,
		updatableFrom: [],
		steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({
			id,
			title: `Step ${String(id)}`,
			description: '',
			status: id < 3 ? 'complete' : 'in-progress',
			optional: false,
			artifactPath: `Novel/step-${String(id)}.md`,
			contentReadOnly: false,
			healthIssues: [], gallery: [], galleryMain: null,
		})),
		stepFields: {},
		stepRevisions: {},
		characters: [],
		scenes: [],
		manuscriptPaths: [],
		worldbuildingKinds: [],
		worldbuilding: {},
		definitions: { category: {}, 'world-status': {}, relationship: {} },
		customFieldTemplates: {},
		outdatedNotes: 0,
		structureIssues: [],
		lastManuscriptNote: null,
	} as unknown as ProjectDashboardModel;
}

async function flush(): Promise<void> {
	for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Mounted {
	view: SnowflakeDashboardView;
	root: HTMLElement;
	/** The model the host hands over next. */
	model: { current: ProjectDashboardModel };
	/** The host's count of changes; absent on a host that keeps none. */
	epoch: { value: number };
	listProjects: Mock<() => Promise<unknown[]>>;
	loadDashboardModel: Mock<() => Promise<ProjectDashboardModel>>;
	selectStep: Mock<(step: number) => Promise<void>>;
	/** The rail row with this label, pressed. */
	press(label: string): void;
	/** Which pane the frame on screen was drawn for, and from which project title. */
	shown(): { pane: string | null; title: string | null };
}

function mount(options: { counts?: boolean } = {}): Mounted {
	const model = { current: makeModel() };
	const epoch = { value: 1 };
	const listProjects = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([{
		path: PROJECT, rootPath: 'Novel', projectId: 'novel', title: model.current.title, readOnly: false,
		series: null, hasStructureIssues: false, hasMarkerIssues: false,
	}]));
	const loadDashboardModel = vi.fn<() => Promise<ProjectDashboardModel>>(() => Promise.resolve(model.current));
	const selectStep = vi.fn<(step: number) => Promise<void>>(() => Promise.resolve());
	const host = {
		getRecentStep: () => 3,
		isFreeformModeEnabled: () => false,
		translateForProject: (_locale: unknown, key: string) => key,
		writingCountMode: () => 'ms-word',
		syncCertificateCelebration: () => Promise.resolve(false),
		listProjects,
		loadDashboardModel,
		openStep: vi.fn(() => Promise.resolve()),
		selectStep,
		selectWorldbuildingKind: vi.fn(() => Promise.resolve()),
		showsTableActionsColumn: () => false,
		showsTableProgressStatus: () => false,
		openStoryStructure: vi.fn(() => Promise.resolve()),
		openProjectBase: vi.fn(() => Promise.resolve()),
		importSources: vi.fn(() => Promise.resolve([])),
		getDefaultProjectLocale: () => 'en' as const,
		checkCurrentProject: vi.fn(() => Promise.resolve({ entries: [], summary: 'messages.healthCheckPassed' })),
		...(options.counts === false ? {} : { dashboardEpoch: () => epoch.value }),
	};
	const root = document.body.createDiv();
	const view = new SnowflakeDashboardView(
		{ app: { workspace: { requestSaveLayout: vi.fn() } }, detach: vi.fn() } as unknown as WorkspaceLeaf,
		host as unknown as DashboardHost,
	);
	Object.assign(view, {
		contentEl: root,
		containerEl: root,
		projectPath: PROJECT,
		stateDelivered: true,
		stepChosen: true,
		selectedStep: 3,
		selectedPane: { kind: 'step', step: 3 },
		updateViewTitle: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepHeader: vi.fn(),
		renderStepDescription: vi.fn(),
		// These panes mount whole panels of their own, which are not what is
		// under test: which pane was asked for is.
		renderStatisticsPane: vi.fn(),
		renderTasksPane: vi.fn(),
		renderCustomFieldsPane: vi.fn(),
		renderDefinitionPane: vi.fn(),
	});
	const press = (label: string): void => {
		const button = Array.from(
			root.querySelectorAll<HTMLButtonElement>('.snowflake-method-step-button'),
		).find((candidate) => candidate.getAttribute('aria-label') === label);
		if (button === undefined) throw new Error(`No rail row called ${label}`);
		button.click();
	};
	const shown = (): { pane: string | null; title: string | null } => ({
		pane:
			root.querySelector('.snowflake-method-step-button.is-active')?.getAttribute('aria-label') ?? null,
		title: root.querySelector('.snowflake-method-project-switcher-label')?.textContent ?? null,
	});
	return { view, root, model, epoch, listProjects, loadDashboardModel, selectStep, press, shown };
}

/**
 * A change of pane draws from the model in hand, at once, and reads the
 * project again only where the host says something moved. Reading first was
 * a second of nothing on a phone with a project of thousands of notes.
 */
describe('changing pane on the dashboard', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		notices.length = 0;
		document.body.replaceChildren();
	});

	it('draws the pane at once from the model in hand, and reads nothing while the host’s count stands', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		expect(mounted.shown().pane).toBe('Step 3');
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(1);

		mounted.press('Step 5');
		// Before any promise has had a turn: the tap itself drew it.
		expect(mounted.shown().pane).toBe('Step 5');
		await flush();
		expect(mounted.shown().pane).toBe('Step 5');
		expect(mounted.listProjects).toHaveBeenCalledTimes(1);
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(1);
		expect(mounted.selectStep).toHaveBeenCalledExactlyOnceWith(5);

		// And again, any number of times, every kind of pane.
		for (const label of ['Step 8', 'dashboard.statistics', 'dashboard.tasks', 'dashboard.customFields', 'dashboard.definition.category', 'Step 1']) {
			mounted.press(label);
			expect(mounted.shown().pane, label).toBe(label);
		}
		await flush();
		expect(mounted.listProjects).toHaveBeenCalledTimes(1);
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(1);
	});

	it('reads the project again where the host’s count has moved, after drawing the pane', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		// Something changed somewhere: a note was written, a setting saved.
		mounted.epoch.value += 1;
		mounted.model.current = makeModel('Novel, retitled');

		mounted.press('Step 5');
		// Drawn at once from what is in hand, old title and all.
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel' });
		await flush();
		// And then from what the host read.
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled' });
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);

		// The count now stands at what that reading began from: no more reading.
		mounted.press('Step 6');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
		expect(mounted.shown()).toEqual({ pane: 'Step 6', title: 'Novel, retitled' });
	});

	it('does not trust a reading that a change overtook', async () => {
		const mounted = mount();
		// The change lands while the project is being read: the reading began
		// before it and may or may not hold it.
		mounted.loadDashboardModel.mockImplementationOnce(() => {
			mounted.epoch.value += 1;
			return Promise.resolve(mounted.model.current);
		});
		await mounted.view.refresh();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(1);
		mounted.press('Step 5');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});

	it('asks a host that keeps no count every time, and still draws first', async () => {
		const mounted = mount({ counts: false });
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.press('Step 5');
		await flush();
		// The host has not answered, and the pane stands all the same.
		expect(mounted.shown().pane).toBe('Step 5');
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
		answer(makeModel('Novel, read again'));
		await flush();
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, read again' });
		mounted.press('Step 6');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
	});

	it('joins a reading already under way rather than trusting the model it is replacing', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.epoch.value += 1;
		const reading = mounted.view.refresh();
		await flush();
		mounted.press('Step 5');
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel' });
		mounted.model.current = makeModel('Novel, read again');
		answer(mounted.model.current);
		await reading;
		await flush();
		// The reading drew the pane now chosen, not the one it was asked from.
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, read again' });
	});

	it('reads first where there is no model in hand to draw from', async () => {
		const mounted = mount();
		// Never drawn: a tap can only come from a command or a restored frame.
		Object.assign(mounted.view, { selectedPane: { kind: 'step', step: 4 }, selectedStep: 4 });
		(mounted.view as unknown as { showPane(): void }).showPane();
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(1);
		expect(mounted.shown().pane).toBe('Step 4');
	});

	it('says a failure to remember the step, and keeps the pane it drew', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		mounted.selectStep.mockImplementationOnce(() => Promise.reject(new Error('the settings would not save')));
		mounted.press('Step 7');
		expect(mounted.shown().pane).toBe('Step 7');
		await flush();
		expect(notices).toEqual(['the settings would not save']);
		expect(mounted.shown().pane).toBe('Step 7');
	});

	it('owes a dashboard told of a change while hidden its reading at the next change of pane', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		mounted.view.queueRefreshWhenShown();
		mounted.press('Step 5');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});
});
