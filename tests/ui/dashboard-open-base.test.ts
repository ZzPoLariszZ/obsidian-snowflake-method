// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

/** What the split button's menu was given, in order. */
interface MenuRow {
	title?: string;
	icon?: string;
	disabled?: boolean;
	separator?: true;
	click?: () => void;
}
const { menus } = vi.hoisted(() => ({ menus: [] as MenuRow[][] }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Menu {
		private readonly rows: MenuRow[] = [];
		constructor() { menus.push(this.rows); }
		setParentElement(): this { return this; }
		onHide(): void {}
		showAtMouseEvent(): this { return this; }
		addSeparator(): this { this.rows.push({ separator: true }); return this; }
		addItem(build: (item: unknown) => void): this {
			const row: MenuRow = {};
			this.rows.push(row);
			const item = {
				setTitle(title: string) { row.title = title; return item; },
				setIcon(icon: string) { row.icon = icon; return item; },
				setDisabled(disabled: boolean) { row.disabled = disabled; return item; },
				onClick(click: () => void) { row.click = click; return item; },
			};
			build(item);
			return this;
		}
	}
	return {
		...runtime,
		Menu,
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

/** The project, with one worldbuilding kind when a pane of a kind is wanted. */
function makeModel(kind?: string): ProjectDashboardModel {
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
			healthIssues: [], gallery: [], galleryMain: null,
		})),
		stepFields: {},
		stepRevisions: {},
		characters: [],
		scenes: [],
		manuscriptPaths: [],
		worldbuildingKinds: kind === undefined ? [] : [{ id: kind, custom: false }],
		worldbuilding: kind === undefined ? {} : { [kind]: [] },
		definitions: {},
		customFieldTemplates: {},
		outdatedNotes: 0,
		structureIssues: [],
		lastManuscriptNote: null,
	} as unknown as ProjectDashboardModel;
}

async function flush(): Promise<void> {
	for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(step: number, kind?: string) {
	const model = makeModel(kind);
	const openStoryStructure = vi.fn(() => Promise.resolve());
	const openProjectBase = vi.fn(() => Promise.resolve());
	const host = {
		getRecentStep: () => step,
		isFreeformModeEnabled: () => false,
		translateForProject: (_locale: unknown, key: string) => key,
		writingCountMode: () => 'ms-word',
		syncCertificateCelebration: () => Promise.resolve(false),
		listProjects: () => Promise.resolve([{ path: model.path, title: 'Novel' }]),
		loadDashboardModel: () => Promise.resolve(model),
		openStep: vi.fn(() => Promise.resolve()),
		showsTableActionsColumn: () => false,
		showsTableProgressStatus: () => false,
		openStoryStructure,
		openProjectBase,
	};
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
		selectedPane: kind === undefined ? { kind: 'step', step } : { kind: 'worldbuilding', wbKind: kind },
		updateViewTitle: vi.fn(),
		renderStepNavigation: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepHeader: vi.fn(),
		renderStepDescription: vi.fn(),
	});
	const split = (): HTMLElement =>
		root.querySelector<HTMLElement>('.snowflake-method-base-split-button') as HTMLElement;
	const primary = (): HTMLButtonElement =>
		split().querySelector<HTMLButtonElement>('.snowflake-method-open-base') as HTMLButtonElement;
	const openMenu = (): MenuRow[] => {
		split().querySelector<HTMLButtonElement>('.snowflake-method-character-action-menu-trigger')?.click();
		return menus[menus.length - 1] ?? [];
	};
	return { view, root, primary, openMenu, openStoryStructure, openProjectBase };
}

/**
 * The panel button of the collections: the character steps open the
 * corkboard on its character view, a worldbuilding kind's pane on the view
 * named after the kind, the scene steps bring the workspace forward as it
 * stands, and all keep their base one menu row away.
 */
describe('the Open workspace button', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		menus.length = 0;
		document.body.replaceChildren();
	});

	it.each([3, 5, 7] as const)('opens the corkboard on the character view from step %i', async (step) => {
		const { view, primary, openStoryStructure } = mount(step);
		await view.refresh();
		expect(primary().textContent).toBe('actions.openWorkspace');
		primary().click();
		await flush();
		expect(openStoryStructure).toHaveBeenCalledExactlyOnceWith('corkboard-ordered', {
			projectPath: PROJECT,
			corkboardView: 'character',
		});
	});

	it('keeps the base and the other visualizations in the menu on a character step', async () => {
		const { view, openMenu, openStoryStructure, openProjectBase } = mount(3);
		await view.refresh();
		const rows = openMenu();
		expect(rows.map((row) => row.separator === true ? '---' : row.title)).toEqual([
			'actions.openVisualization',
			'actions.openVisualization',
			'actions.openVisualization',
			'actions.openVisualization',
			'actions.openVisualization',
			'---',
			'actions.openBase',
			'actions.restoreBase',
		]);
		// The corkboard row lands on the character view too, the timeline does not.
		rows[0]?.click?.();
		rows[2]?.click?.();
		await flush();
		expect(openStoryStructure).toHaveBeenNthCalledWith(1, 'corkboard-ordered', {
			projectPath: PROJECT,
			corkboardView: 'character',
		});
		expect(openStoryStructure).toHaveBeenNthCalledWith(2, 'timeline', { projectPath: PROJECT });
		rows[6]?.click?.();
		await flush();
		expect(openProjectBase).toHaveBeenCalledExactlyOnceWith('characters');
	});

	it('opens the corkboard on the kind’s own view from a worldbuilding kind’s pane', async () => {
		const { view, primary, openMenu, openStoryStructure, openProjectBase } = mount(3, 'location');
		await view.refresh();
		expect(primary().textContent).toBe('actions.openWorkspace');
		primary().click();
		await flush();
		expect(openStoryStructure).toHaveBeenCalledExactlyOnceWith('corkboard-ordered', {
			projectPath: PROJECT,
			corkboardView: 'location',
		});
		const rows = openMenu();
		expect(rows.map((row) => row.separator === true ? '---' : row.title)).toEqual([
			'actions.openVisualization',
			'actions.openVisualization',
			'actions.openVisualization',
			'actions.openVisualization',
			'actions.openVisualization',
			'---',
			'actions.openBase',
			'actions.restoreBase',
		]);
		// The corkboard row lands on the kind's view, the timeline opens as it stands.
		rows[0]?.click?.();
		rows[2]?.click?.();
		await flush();
		expect(openStoryStructure).toHaveBeenNthCalledWith(2, 'corkboard-ordered', {
			projectPath: PROJECT,
			corkboardView: 'location',
		});
		expect(openStoryStructure).toHaveBeenNthCalledWith(3, 'timeline', { projectPath: PROJECT });
		rows[6]?.click?.();
		await flush();
		expect(openProjectBase).toHaveBeenCalledExactlyOnceWith('location');
	});

	it('opens the kind’s base on a phone, where the workspace is not offered', async () => {
		document.body.classList.add('is-phone');
		try {
			const { view, primary, openMenu, openProjectBase } = mount(3, 'location');
			await view.refresh();
			expect(primary().textContent).toBe('actions.openBase');
			primary().click();
			await flush();
			expect(openProjectBase).toHaveBeenCalledExactlyOnceWith('location');
			expect(openMenu().map((row) => row.title)).toEqual(['actions.restoreBase', 'actions.openBase']);
		} finally {
			document.body.classList.remove('is-phone');
		}
	});

	it.each([8, 9] as const)('brings the workspace forward as it stands from step %i', async (step) => {
		const { view, primary, openMenu, openStoryStructure } = mount(step);
		await view.refresh();
		expect(primary().textContent).toBe('actions.openWorkspace');
		primary().click();
		await flush();
		expect(openStoryStructure).toHaveBeenCalledExactlyOnceWith(undefined, { projectPath: PROJECT });
		const rows = openMenu();
		rows[0]?.click?.();
		await flush();
		expect(openStoryStructure).toHaveBeenLastCalledWith('corkboard-ordered', { projectPath: PROJECT });
		expect(rows.map((row) => row.title).filter((title) => title !== undefined && !title.startsWith('actions.openV')))
			.toEqual(['actions.openBase', 'actions.restoreBase']);
	});
});
