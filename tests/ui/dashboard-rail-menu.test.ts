// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

/** What a menu was given, in order. */
interface MenuRow {
	title?: string;
	icon?: string;
	checked?: boolean;
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
		showAtMouseEvent(): this { return this; }
		showAtPosition(): this { return this; }
		onHide(): void {}
		addSeparator(): this { this.rows.push({ separator: true }); return this; }
		addItem(build: (item: unknown) => void): this {
			const row: MenuRow = {};
			this.rows.push(row);
			const item = {
				setTitle(title: string) { row.title = title; return item; },
				setIcon(icon: string) { row.icon = icon; return item; },
				setChecked(checked: boolean) { row.checked = checked; return item; },
				setDisabled(disabled: boolean) { row.disabled = disabled; return item; },
				setIsLabel() { return item; },
				onClick(click: () => void) { row.click = click; return item; },
			};
			build(item);
			return this;
		}
	}
	return {
		...runtime,
		Menu,
		getIcon: () => null,
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

import { SnowflakeDashboardView, railMenuIcon, railMenuTitle } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

const PROJECT = 'Novel/00_System/001_Project_Metadata.md';

function makeModel(): ProjectDashboardModel {
	return {
		path: PROJECT,
		projectId: 'novel',
		title: 'Novel',
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

function mount(step = 3) {
	const model = makeModel();
	const selectStep = vi.fn(() => Promise.resolve());
	const host = {
		getRecentStep: () => 3,
		isFreeformModeEnabled: () => false,
		translateForProject: (_locale: unknown, key: string) => key,
		writingCountMode: () => 'ms-word',
		syncCertificateCelebration: () => Promise.resolve(false),
		listProjects: () => Promise.resolve([{
			path: model.path, rootPath: 'Novel', projectId: 'novel', title: 'Novel', readOnly: false,
			series: null, hasStructureIssues: false, hasMarkerIssues: false,
		}]),
		loadDashboardModel: () => Promise.resolve(model),
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
		selectedStep: step,
		selectedPane: { kind: 'step', step },
		updateViewTitle: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepHeader: vi.fn(),
		renderStepDescription: vi.fn(),
	});
	const button = (): HTMLButtonElement =>
		root.querySelector<HTMLButtonElement>('.snowflake-method-rail-menu') as HTMLButtonElement;
	return { view, root, button, selectStep, host };
}

const titles = (rows: MenuRow[]): string[] => rows.map((row) => (row.separator === true ? '---' : row.title ?? ''));

/**
 * The rail's stand-in on a phone: a bar naming the pane on show, which opens
 * every rail row and the project switcher as one menu, built from the rows
 * the rail drew so the two can never disagree.
 */
describe('the dashboard rail on a phone', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		menus.length = 0;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.classList.remove('is-phone');
	});

	it('hides the rail, keeps the fold command away and names the pane on the bar', async () => {
		document.body.classList.add('is-phone');
		const { view, root, button } = mount();
		await view.refresh();
		expect(root.classList.contains('is-rail-hidden')).toBe(true);
		expect(view.canToggleRail()).toBe(false);
		expect(button().querySelector('.snowflake-method-rail-menu-label')?.textContent).toBe('Step 3');
		expect(button().querySelector('.snowflake-method-rail-menu-mark')?.textContent).toBe('steps.number.3');
		expect(button().getAttribute('aria-label')).toBe('dashboard.navigate: Step 3');
	});

	it('opens the rail’s rows and the project switcher as one menu, the pane on show marked', async () => {
		document.body.classList.add('is-phone');
		const { view, button, selectStep } = mount();
		await view.refresh();
		button().click();
		const rows = menus[menus.length - 1] ?? [];
		expect(titles(rows)).toEqual([
			...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => `steps.number.${String(id)} · Step ${String(id)}`),
			'---',
			'dashboard.definition.category',
			'dashboard.definition.world-status',
			'dashboard.definition.relationship',
			'dashboard.customFields',
			'---',
			'dashboard.statistics',
			'dashboard.tasks',
			'---',
			'Novel',
			'---',
			'actions.importFromProject',
			'dashboard.manageProjects',
		]);
		expect(rows[2]?.checked).toBe(true);
		expect(rows[0]?.checked).toBe(false);
		expect(rows[0]?.icon).toBe('circle-check');
		expect(rows[2]?.icon).toBe('circle-dot');
		expect(rows[11]?.icon).toBe('tags');
		expect(button().getAttribute('aria-expanded')).toBe('true');
		rows[0]?.click?.();
		await flush();
		expect(selectStep).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('stands the footer’s new project and health check buttons beside the bar', async () => {
		document.body.classList.add('is-phone');
		const { view, root, host } = mount();
		await view.refresh();
		const row = root.querySelector<HTMLElement>('.snowflake-method-rail-menu-row');
		const buttons = [...(row?.querySelectorAll<HTMLButtonElement>(
			'.snowflake-method-project-actions button.snowflake-method-toolbar-button',
		) ?? [])];
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'actions.newProject',
			'actions.repair',
		]);
		expect(buttons[1]?.classList.contains('is-health-healthy')).toBe(true);
		buttons[0]?.click();
		await flush();
		expect(host.importSources).toHaveBeenCalledExactlyOnceWith(null);
		buttons[1]?.click();
		await flush();
		expect(host.checkCurrentProject).toHaveBeenCalledOnce();
	});

	it('keeps the rail and its fold off a phone', async () => {
		const { view, root } = mount();
		await view.refresh();
		expect(root.classList.contains('is-rail-hidden')).toBe(false);
		expect(view.canToggleRail()).toBe(true);
		expect(root.querySelector('.snowflake-method-step-nav')).not.toBeNull();
		// Drawn all the same, for a tablet split to a phone's width: the stylesheet shows it.
		expect(root.querySelector('.snowflake-method-rail-menu-row')).not.toBeNull();
		// The footer's two buttons stand in the rail and in the hidden row alike.
		expect(root.querySelectorAll('.snowflake-method-project-actions')).toHaveLength(2);
	});
});

describe('a rail row as a menu row', () => {
	it('shows a step by its number and how far along it is', () => {
		expect(railMenuTitle({ leading: { text: '3' }, label: 'Characters' })).toBe('3 · Characters');
		expect(railMenuIcon({ leading: { text: '3' }, indicator: { status: 'complete' }, damaged: false })).toBe('circle-check');
		expect(railMenuIcon({ leading: { text: '3' }, indicator: { status: 'in-revision' }, damaged: false })).toBe('rotate-ccw');
		expect(railMenuIcon({ leading: { text: '3' }, indicator: { status: 'skipped' }, damaged: false })).toBe('circle-minus');
		expect(railMenuIcon({ leading: { text: '3' }, indicator: { status: 'not-started' }, damaged: false })).toBe('circle');
	});

	it('keeps a kind’s icon and puts the warning first', () => {
		expect(railMenuTitle({ leading: { icon: 'map' }, label: 'Places' })).toBe('Places');
		expect(railMenuIcon({ leading: { icon: 'map' }, indicator: { count: 4 }, damaged: false })).toBe('map');
		expect(railMenuIcon({ leading: { icon: 'map' }, indicator: { count: 4 }, damaged: true })).toBe('triangle-alert');
	});
});

/**
 * The doors to the visualization workspace, which is not offered on a phone:
 * the member steps' button opens the base there, its menu names no
 * visualization, the scene list's hint leaves the workspace out, and the
 * rail's menu leaves out its row (above). A device class that flips while
 * the dashboard stands draws the doors again.
 */
describe('the doors to the workspace on a phone', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		menus.length = 0;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.classList.remove('is-phone');
	});

	const trigger = (root: HTMLElement): void => {
		root.querySelector<HTMLButtonElement>('.snowflake-method-base-split-button .snowflake-method-character-action-menu-trigger')?.click();
	};

	it('open the workspace from the character step off a phone, every visualization in the menu', async () => {
		const { view, root } = mount();
		await view.refresh();
		expect(root.querySelector('.snowflake-method-open-base')?.textContent).toBe('actions.openWorkspace');
		trigger(root);
		const rows = menus[menus.length - 1] ?? [];
		expect(titles(rows).filter((title) => title === 'actions.openVisualization')).toHaveLength(5);
		expect(root.querySelector('.snowflake-method-workspace-entry')).not.toBeNull();
	});

	it('open the base from the character step on a phone, no visualization in the menu', async () => {
		document.body.classList.add('is-phone');
		const { view, root } = mount();
		await view.refresh();
		expect(root.querySelector('.snowflake-method-open-base')?.textContent).toBe('actions.openBase');
		trigger(root);
		const rows = menus[menus.length - 1] ?? [];
		expect(titles(rows)).not.toContain('actions.openVisualization');
		expect(titles(rows)).toContain('actions.restoreBase');
	});

	it('leave the scene list’s hint without the workspace on a phone, and keep it elsewhere', async () => {
		const wide = mount(8);
		await wide.view.refresh();
		expect(wide.root.querySelector('.snowflake-method-hint-link')).not.toBeNull();
		document.body.classList.add('is-phone');
		const phone = mount(8);
		await phone.view.refresh();
		expect(phone.root.querySelector('.snowflake-method-hint-link')).toBeNull();
		expect(phone.root.querySelectorAll('.snowflake-method-hint-emphasis').length).toBe(
			wide.root.querySelectorAll('.snowflake-method-hint-emphasis').length,
		);
	});

	it('draw the doors again when the device class flips', async () => {
		const { view, root } = mount();
		await view.refresh();
		expect(root.querySelector('.snowflake-method-open-base')?.textContent).toBe('actions.openWorkspace');
		document.body.classList.add('is-phone');
		view.deviceClassChanged();
		await flush();
		expect(root.querySelector('.snowflake-method-open-base')?.textContent).toBe('actions.openBase');
	});
});
