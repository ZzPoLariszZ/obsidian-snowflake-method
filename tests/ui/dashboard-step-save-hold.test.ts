// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest';

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

// Discarding a draft asks first; these panes are always told yes.
vi.mock('../../src/ui/modals', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/ui/modals')>()),
	confirmDraftDiscard: () => Promise.resolve(true),
}));

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

beforeAll(() => {
	installObsidianDom(window);
});

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';

function makeModel(): ProjectDashboardModel {
	return {
		path: PROJECT,
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
		stepFields: {
			2: { 'one-paragraph-summary': 'A paragraph.', description: '' },
			6: { 'long-synopsis': 'Long.' },
		},
		stepRevisions: { 2: 'r2', 6: 'r6' },
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

/** A host whose save waits on the test, then writes what it was given or refuses it. */
function makeHost() {
	const model = makeModel();
	let held: Promise<void> | null = null;
	let refuse = false;
	const saveStepFields = vi.fn(async (step: 2 | 6, fields: Record<string, string>) => {
		if (held !== null) await held;
		if (refuse) throw new Error('The note changed while it was being written.');
		model.stepFields[step] = { ...fields };
		model.stepRevisions[step] = `saved-${String(step)}`;
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
	/** Holds the next save until the returned release is called. */
	const hold = (): (() => void) => {
		let release = (): void => undefined;
		held = new Promise<void>((resolve) => {
			release = resolve;
		});
		return release;
	};
	return { host, model, saveStepFields, hold, refuseSaves: () => { refuse = true; } };
}

function mount(host: ReturnType<typeof makeHost>['host'], step: 2 | 6) {
	const root = document.body.createDiv();
	const view = new SnowflakeDashboardView(
		{ app: {}, detach: vi.fn() } as unknown as WorkspaceLeaf,
		host as unknown as DashboardHost,
	);
	Object.assign(view, {
		contentEl: root,
		containerEl: root,
		projectPath: PROJECT,
		stateDelivered: true,
		stepChosen: true,
		selectedStep: step,
		selectedPane: { kind: 'step', step },
		updateViewTitle: vi.fn(),
		renderStepNavigation: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepHeader: vi.fn(),
		renderStepDescription: vi.fn(),
	});
	const box = (cls: string): HTMLElement => root.querySelector<HTMLElement>(`.${cls}`) as HTMLElement;
	const button = (label: string): HTMLButtonElement =>
		Array.from(root.querySelectorAll<HTMLButtonElement>('.snowflake-method-actions button')).find(
			(one) => one.textContent === label,
		) as HTMLButtonElement;
	const save = (): HTMLButtonElement => button('common.save');
	const discard = (): HTMLButtonElement => button('actions.discardDraft');
	const type = (cls: string, words: string): void => {
		box(cls).append(words);
		box(cls).dispatchEvent(new Event('input', { bubbles: true }));
	};
	return { view, box, save, discard, type };
}

const SYNOPSIS = 'snowflake-method-synopsis-input';
const PARAGRAPH = 'snowflake-method-one-paragraph-summary-input';
const DESCRIPTION = 'snowflake-method-description-input';

describe('a step save holds its boxes still', () => {
	it('holds a synopsis box drawn again while its save runs, and frees it once the words are written', async () => {
		const { host, model, saveStepFields, hold } = makeHost();
		const { view, box, save, type } = mount(host, 6);
		await view.refresh();
		type(SYNOPSIS, ' First.');
		const release = hold();
		save().click();
		await flush();
		expect(box(SYNOPSIS).getAttribute('contenteditable')).toBe('false');
		// A refresh before the save is done draws the box again: held, as the
		// first was, so nothing can be typed into the draft the save lets go.
		await view.refresh();
		expect(box(SYNOPSIS).getAttribute('contenteditable')).toBe('false');
		expect(save().disabled).toBe(true);
		release();
		await flush();
		expect(saveStepFields).toHaveBeenCalledOnce();
		expect(model.stepFields[6]?.['long-synopsis']).toBe('Long. First.');
		expect(box(SYNOPSIS).getAttribute('contenteditable')).toBe('plaintext-only');
		expect(box(SYNOPSIS).textContent).toBe('Long. First.');
		expect(save().disabled).toBe(false);
	});

	it('frees a box drawn held when its save is refused, keeping the words as a draft', async () => {
		const { host, model, hold, refuseSaves } = makeHost();
		const { view, box, type, save } = mount(host, 6);
		await view.refresh();
		type(SYNOPSIS, ' Kept.');
		const release = hold();
		refuseSaves();
		save().click();
		await flush();
		await view.refresh();
		expect(box(SYNOPSIS).getAttribute('contenteditable')).toBe('false');
		release();
		await flush();
		expect(model.stepFields[6]?.['long-synopsis']).toBe('Long.');
		expect(box(SYNOPSIS).getAttribute('contenteditable')).toBe('plaintext-only');
		expect(box(SYNOPSIS).textContent).toBe('Long. Kept.');
	});

	it('holds the same step open in another dashboard, and draws it again with the words written', async () => {
		const { host, model, hold } = makeHost();
		const one = mount(host, 6);
		await one.view.refresh();
		const two = mount(host, 6);
		await two.view.refresh();
		one.type(SYNOPSIS, ' First.');
		const release = hold();
		one.save().click();
		await flush();
		// The draft is one for both dashboards, so neither takes words while it is written.
		expect(two.box(SYNOPSIS).getAttribute('contenteditable')).toBe('false');
		expect(two.save().disabled).toBe(true);
		release();
		await flush();
		expect(model.stepFields[6]?.['long-synopsis']).toBe('Long. First.');
		for (const view of [one, two]) {
			expect(view.box(SYNOPSIS).textContent).toBe('Long. First.');
			expect(view.box(SYNOPSIS).getAttribute('contenteditable')).toBe('plaintext-only');
			expect(view.save().disabled).toBe(false);
		}
	});

	it('frees another dashboard’s box drawn held while a refused save ran', async () => {
		const { host, hold, refuseSaves } = makeHost();
		const one = mount(host, 6);
		await one.view.refresh();
		one.type(SYNOPSIS, ' Kept.');
		const release = hold();
		refuseSaves();
		one.save().click();
		await flush();
		const two = mount(host, 6);
		await two.view.refresh();
		expect(two.box(SYNOPSIS).getAttribute('contenteditable')).toBe('false');
		release();
		await flush();
		for (const view of [one, two]) {
			expect(view.box(SYNOPSIS).textContent).toBe('Long. Kept.');
			expect(view.box(SYNOPSIS).getAttribute('contenteditable')).toBe('plaintext-only');
			expect(view.save().disabled).toBe(false);
		}
	});

	it('holds both of step 2’s boxes for the length of the save', async () => {
		const { host, model, hold } = makeHost();
		const { view, box, save, type } = mount(host, 2);
		await view.refresh();
		type(PARAGRAPH, ' More.');
		const release = hold();
		save().click();
		await flush();
		expect(box(PARAGRAPH).getAttribute('contenteditable')).toBe('false');
		expect(box(DESCRIPTION).getAttribute('contenteditable')).toBe('false');
		await view.refresh();
		expect(box(PARAGRAPH).getAttribute('contenteditable')).toBe('false');
		expect(box(DESCRIPTION).getAttribute('contenteditable')).toBe('false');
		release();
		await flush();
		expect(model.stepFields[2]?.['one-paragraph-summary']).toBe('A paragraph. More.');
		expect(box(PARAGRAPH).getAttribute('contenteditable')).toBe('plaintext-only');
		expect(box(DESCRIPTION).getAttribute('contenteditable')).toBe('plaintext-only');
	});
});
