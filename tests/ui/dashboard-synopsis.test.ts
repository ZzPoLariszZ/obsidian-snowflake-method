// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
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

const confirmDraftDiscard = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock('../../src/ui/modals', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/ui/modals')>()),
	confirmDraftDiscard,
}));

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

const LONG = Array.from(
	{ length: 40 },
	(_, index) => `Paragraph ${String(index + 1)} of a long synopsis.`,
).join('\n\n');

function makeModel(): ProjectDashboardModel {
	return {
		path: 'Novel/00_System/001_Project_Metadata.md',
		projectId: 'novel',
		title: 'Novel',
		locale: 'en',
		readOnly: false,
		readOnlyReason: null,
		steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({
			id,
			title: `Step ${String(id)}`,
			description: '',
			status: 'in-progress',
			optional: false,
			artifactPath: `Novel/step-${String(id)}.md`,
			contentReadOnly: false,
			healthIssues: [],
		})),
		stepFields: { 4: { 'plot-synopsis': 'Plot.' }, 6: { 'long-synopsis': LONG } },
		stepRevisions: { 4: 'r4', 6: 'r6' },
		characters: [],
		scenes: [],
		manuscriptPaths: [],
		worldbuildingKinds: [],
		worldbuilding: {},
		definitions: {},
		customFieldTemplates: {},
		outdatedNotes: 0,
		structureIssues: [],
		lastManuscriptNote: null,
	} as unknown as ProjectDashboardModel;
}

async function flush(): Promise<void> {
	for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeHost() {
	const model = makeModel();
	let held: Promise<void> | null = null;
	const saveStepFields = vi.fn(async () => {
		if (held !== null) await held;
	});
	const host = {
		getRecentStep: () => 6,
		isFreeformModeEnabled: () => false,
		translateForProject: (_locale: unknown, key: string) => key,
		writingCountMode: () => 'ms-word',
		syncCertificateCelebration: () => Promise.resolve(false),
		listProjects: () => Promise.resolve([{ path: model.path, title: 'Novel' }]),
		loadDashboardModel: () => Promise.resolve(model),
		saveStepFields,
		openStep: vi.fn(() => Promise.resolve()),
		showsTableActionsColumn: () => false,
		showsTableProgressStatus: () => false,
	};
	return { host, model, saveStepFields, hold: (until: Promise<void> | null) => { held = until; } };
}

function mount(host: ReturnType<typeof makeHost>['host']) {
	const root = document.body.createDiv();
	const view = new SnowflakeDashboardView(
		{ app: {}, detach: vi.fn() } as unknown as WorkspaceLeaf,
		host as unknown as DashboardHost,
	);
	Object.assign(view, {
		contentEl: root,
		containerEl: root,
		projectPath: 'Novel/00_System/001_Project_Metadata.md',
		stateDelivered: true,
		stepChosen: true,
		selectedStep: 6,
		selectedPane: { kind: 'step', step: 6 },
		updateViewTitle: vi.fn(),
		renderStepNavigation: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepHeader: vi.fn(),
		renderStepDescription: vi.fn(),
	});
	const box = (): HTMLElement => root.querySelector<HTMLElement>('.snowflake-method-synopsis-input') as HTMLElement;
	const button = (label: string): HTMLButtonElement =>
		Array.from(root.querySelectorAll<HTMLButtonElement>('.snowflake-method-actions button')).find(
			(one) => one.textContent === label,
		) as HTMLButtonElement;
	const type = (words: string): void => {
		box().append(words);
		box().dispatchEvent(new Event('input', { bubbles: true }));
	};
	return { view, root, box, button, type };
}

/**
 * The long synopsis boxes of steps 4 and 6: the words held while a save is
 * written, the place and the caret kept across a refresh, and the unsaved
 * words kept past the tab and asked about before they go.
 */
describe('the synopsis box', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		confirmDraftDiscard.mockReset();
	});

	it('takes no words while a save is written, and takes them again if it fails', async () => {
		const { host, hold, saveStepFields } = makeHost();
		const { view, box, button, type } = mount(host);
		await view.refresh();
		type(' More.');
		let release = (): void => undefined;
		hold(new Promise<void>((resolve) => { release = resolve; }));
		button('common.save').click();
		await flush();
		expect(saveStepFields).toHaveBeenCalledTimes(1);
		expect(box().getAttribute('contenteditable')).toBe('false');
		release();
		await flush();
		// Drawn again from the saved note, and open to typing.
		expect(box().getAttribute('contenteditable')).toBe('plaintext-only');

		saveStepFields.mockImplementationOnce(() => Promise.reject(new Error('refused')));
		hold(null);
		type(' Again.');
		const before = box();
		button('common.save').click();
		await flush();
		expect(box()).toBe(before);
		expect(before.getAttribute('contenteditable')).toBe('plaintext-only');
	});

	it('keeps its place and the caret across a refresh', async () => {
		const { host } = makeHost();
		const { view, box, type } = mount(host);
		await view.refresh();
		const first = box();
		first.focus();
		type(' A line typed just now.');
		first.scrollTop = 600;
		await view.refresh();
		const second = box();
		expect(second).not.toBe(first);
		expect(second.scrollTop).toBe(600);
		expect(document.activeElement).toBe(second);
	});

	it('keeps unsaved words past the tab, and asks before they are let go', async () => {
		const { host } = makeHost();
		const first = mount(host);
		await first.view.refresh();
		first.type(' Unsaved words.');
		// Another dashboard over the same host, as after the tab is closed and opened again.
		const second = mount(host);
		await second.view.refresh();
		expect(second.box().textContent?.endsWith('Unsaved words.')).toBe(true);

		confirmDraftDiscard.mockResolvedValueOnce(false);
		second.button('actions.discardDraft').click();
		await flush();
		expect(confirmDraftDiscard).toHaveBeenCalledTimes(1);
		expect(second.box().textContent?.endsWith('Unsaved words.')).toBe(true);

		confirmDraftDiscard.mockResolvedValueOnce(true);
		second.button('actions.discardDraft').click();
		await flush();
		expect(second.box().textContent).toBe(LONG);

		// With nothing unsaved, Discard only loads the note again.
		second.button('actions.discardDraft').click();
		await flush();
		expect(confirmDraftDiscard).toHaveBeenCalledTimes(2);
	});
});
