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
		series: null,
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

	it('leaves the frame as it stands where the reading behind a pane finds nothing new', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		// Something was written that no dashboard draws: the count moved,
		// and the project reads as it did, value for value.
		mounted.epoch.value += 1;
		mounted.model.current = makeModel();
		mounted.press('Step 5');
		const drawn = mounted.root.querySelector('.snowflake-method-step-button.is-active');
		expect(drawn?.getAttribute('aria-label')).toBe('Step 5');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
		// Not drawn a second time: the very nodes of the first frame stand.
		expect(drawn?.isConnected).toBe(true);
		expect(mounted.root.querySelector('.snowflake-method-step-button.is-active')).toBe(drawn);
		// And the frame took the reading's count for its own: the next pane reads nothing.
		mounted.press('Step 6');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});

	it('draws again for anyone else who asks, whatever the reading finds', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		const drawn = mounted.root.querySelector('.snowflake-method-step-button.is-active');
		// A refresh asked for by a save, a setting or a change of state is owed its frame.
		await mounted.view.refresh();
		expect(drawn?.isConnected).toBe(false);
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});

	it('draws again where such an asking arrives while the reading behind a pane is out', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.epoch.value += 1;
		mounted.press('Step 5');
		const drawn = mounted.root.querySelector('.snowflake-method-step-button.is-active');
		// Someone else asks for a frame meanwhile.
		const asked = mounted.view.refresh();
		answer(makeModel());
		await asked;
		await flush();
		expect(drawn?.isConnected).toBe(false);
		expect(mounted.shown().pane).toBe('Step 5');
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
	});

	it('says so in the frame when the pane cannot be drawn from the model in hand', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		const failing = vi
			.spyOn(mounted.view as unknown as { renderSelectedStep(): void }, 'renderSelectedStep')
			.mockImplementationOnce(() => {
				throw new Error('This pane cannot be drawn');
			});
		// Nothing is thrown out of the tap.
		expect(() => {
			mounted.press('Step 5');
		}).not.toThrow();
		expect(failing).toHaveBeenCalled();
		const panel = mounted.root.querySelector('.snowflake-method-panel');
		expect(panel?.querySelector('h2')?.textContent).toBe('errors.dashboard');
		expect(panel?.querySelector('p')?.textContent).toBe('This pane cannot be drawn');
		// And the way back works: Retry reads and draws.
		panel?.querySelector('button')?.click();
		await flush();
		expect(mounted.shown().pane).toBe('Step 5');
	});

	it('gives a search box drawn anew its focus and its selection back', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		const draw = (): HTMLInputElement => {
			const field = mounted.root.createDiv({ cls: 'snowflake-method-field' });
			field.createEl('label', { text: 'Search' });
			const input = field.createEl('input', { attr: { type: 'search' } });
			input.value = 'Ada';
			return input;
		};
		const first = draw();
		first.focus();
		first.setSelectionRange(1, 2);
		expect(document.activeElement).toBe(first);
		let second: HTMLInputElement | null = null;
		(mounted.view as unknown as { keepingFocus(work: () => void): void }).keepingFocus(() => {
			// A frame rebuild: the box is another node, holding the same words.
			mounted.root.empty();
			second = draw();
		});
		expect(document.activeElement).toBe(second);
		expect(second!.selectionStart).toBe(1);
		expect(second!.selectionEnd).toBe(2);

		// A box that reads otherwise is not the box that was being typed in.
		let third: HTMLInputElement | null = null;
		(mounted.view as unknown as { keepingFocus(work: () => void): void }).keepingFocus(() => {
			mounted.root.empty();
			third = draw();
			third.value = 'Bea';
		});
		expect(document.activeElement).not.toBe(third);
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

	it('says so where a host fails to remember the step, and keeps the pane it drew', async () => {
		// The plugin's own host does not fail here: it notes the step and
		// writes it a moment later, on a timer nothing waits for. This holds
		// the view to its side of the bargain for a host that does.
		const mounted = mount();
		await mounted.view.refresh();
		mounted.selectStep.mockImplementationOnce(() => Promise.reject(new Error('the settings would not save')));
		mounted.press('Step 7');
		expect(mounted.shown().pane).toBe('Step 7');
		await flush();
		expect(notices).toEqual(['the settings would not save']);
		expect(mounted.shown().pane).toBe('Step 7');
	});

	it('asks for no second reading while one that began at the host’s present count is out', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.epoch.value += 1;
		const reading = mounted.view.refresh();
		await flush();
		// A burst of taps while that reading is out: each is drawn at once, and
		// none of them sends the project to be read again behind it.
		for (const label of ['Step 5', 'dashboard.tasks', 'Step 6']) {
			mounted.press(label);
			expect(mounted.shown()).toEqual({ pane: label, title: 'Novel' });
		}
		answer(makeModel('Novel, read again'));
		await reading;
		await flush();
		expect(mounted.shown()).toEqual({ pane: 'Step 6', title: 'Novel, read again' });
		expect(mounted.listProjects).toHaveBeenCalledTimes(2);
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});

	it('reads again behind a reading under way that a change has overtaken', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.epoch.value += 1;
		const reading = mounted.view.refresh();
		await flush();
		// Something is written after that reading began: it may not hold it.
		mounted.epoch.value += 1;
		mounted.press('Step 5');
		mounted.model.current = makeModel('Novel, written since');
		answer(makeModel('Novel, read too early'));
		await reading;
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, written since' });
	});

	it('keeps a reading the health test let stand, and draws the next pane from it without reading', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		const frame = mounted.root.querySelector('.snowflake-method-step-button.is-active');
		// A sticky note is saved: the count moves, and the reading finds more
		// than the verdict it was asked about.
		mounted.epoch.value += 1;
		mounted.model.current = makeModel('Novel, retitled');
		await mounted.view.reconcileHealth();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
		// The verdict stands, and so does the frame.
		expect(frame?.isConnected).toBe(true);
		expect(mounted.shown()).toEqual({ pane: 'Step 3', title: 'Novel' });

		mounted.press('Step 5');
		// Drawn at once from the newest reading, not from the frame's older one.
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled' });
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
		// And it is the frame's own now: the next pane is drawn from it too.
		mounted.press('Step 6');
		await flush();
		expect(mounted.shown()).toEqual({ pane: 'Step 6', title: 'Novel, retitled' });
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});

	it('does not trust a kept reading that a change overtook', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		mounted.epoch.value += 1;
		mounted.model.current = makeModel('Novel, retitled');
		await mounted.view.reconcileHealth();
		mounted.epoch.value += 1;
		mounted.model.current = makeModel('Novel, retitled twice');
		mounted.press('Step 5');
		// The newest reading in hand is drawn first, and the project read again.
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled' });
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled twice' });
	});

	it('lets a later frame put a kept reading out of mind', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		mounted.epoch.value += 1;
		mounted.model.current = makeModel('Novel, retitled');
		await mounted.view.reconcileHealth();
		// Someone asks for a frame, and the reading behind it finds a third title.
		mounted.epoch.value += 1;
		mounted.model.current = makeModel('Novel, retitled twice');
		await mounted.view.refresh();
		expect(mounted.shown().title).toBe('Novel, retitled twice');
		mounted.press('Step 5');
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled twice' });
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
	});

	it('has a health reading already out draw for a pane chosen meanwhile', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.epoch.value += 1;
		const health = mounted.view.reconcileHealth();
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
		mounted.press('Step 5');
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel' });
		// The verdict has not moved, and the frame is drawn all the same: the
		// pane was drawn from a model this reading replaces.
		answer(makeModel('Novel, retitled'));
		await health;
		await flush();
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled' });
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(2);
	});

	it('reads again where a health reading a pane took for its own fails', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let fail = (_error: Error): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((_resolve, reject) => { fail = reject; }),
		);
		mounted.epoch.value += 1;
		const health = mounted.view.reconcileHealth();
		await flush();
		mounted.press('Step 5');
		mounted.model.current = makeModel('Novel, retitled');
		fail(new Error('the note would not read'));
		await health;
		await flush();
		// No error over the pane: the reading the pane was owed is made, and drawn.
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
		expect(mounted.shown()).toEqual({ pane: 'Step 5', title: 'Novel, retitled' });
	});

	it('does not take a reading for a pane\u2019s own once the drawing itself has moved the count', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		let answer = (_model: ProjectDashboardModel): void => undefined;
		mounted.loadDashboardModel.mockImplementationOnce(
			() => new Promise<ProjectDashboardModel>((resolve) => { answer = resolve; }),
		);
		mounted.epoch.value += 1;
		const reading = mounted.view.refresh();
		await flush();
		// The drawing of the pane sets something going that the reading under way began before.
		const drawing = vi
			.spyOn(mounted.view as unknown as { renderSelectedStep(): void }, 'renderSelectedStep')
			.mockImplementationOnce(() => {
				mounted.epoch.value += 1;
			});
		mounted.press('Step 5');
		expect(drawing).toHaveBeenCalled();
		answer(makeModel());
		await reading;
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
	});

	it('draws nothing for a health reading that fails, and reads again at the next pane', async () => {
		const mounted = mount();
		await mounted.view.refresh();
		mounted.epoch.value += 1;
		mounted.loadDashboardModel.mockImplementationOnce(() => Promise.reject(new Error('the note would not read')));
		await mounted.view.reconcileHealth();
		// Nothing is said over the frame, and nothing is kept from it.
		expect(mounted.shown()).toEqual({ pane: 'Step 3', title: 'Novel' });
		mounted.press('Step 5');
		await flush();
		expect(mounted.loadDashboardModel).toHaveBeenCalledTimes(3);
		expect(mounted.shown().pane).toBe('Step 5');
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
