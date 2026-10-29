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
		SearchComponent: class extends runtime.SearchComponent {
			setValue(_value: string): this {
				return this;
			}
		},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

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
			healthIssues: [], gallery: [], galleryMain: null,
		})),
		stepFields: {},
		stepRevisions: {},
		characters: [],
		scenes: [],
		manuscriptPaths: [],
		worldbuildingKinds: [],
		worldbuilding: {},
		definitions: {},
		customFieldTemplates: {
			character: [
				{ name: 'Face', description: 'What a face gives away.', path: 'Novel/70_Tool/Templates/Face.md' },
				{ name: 'Voice', description: '', path: 'Novel/70_Tool/Templates/Voice.md' },
			],
		},
		outdatedNotes: 0,
		structureIssues: [],
		lastManuscriptNote: null,
	} as unknown as ProjectDashboardModel;
}

function mount() {
	const model = makeModel();
	const host = {
		getRecentStep: () => 1,
		isFreeformModeEnabled: () => false,
		translateForProject: (_locale: unknown, key: string) => key,
		writingCountMode: () => 'ms-word',
		syncCertificateCelebration: () => Promise.resolve(false),
		listProjects: () => Promise.resolve([{ path: model.path, title: 'Novel' }]),
		loadDashboardModel: () => Promise.resolve(model),
		saveStepFields: vi.fn(() => Promise.resolve()),
		openStep: vi.fn(() => Promise.resolve()),
		showsTableActionsColumn: () => true,
		showsTableProgressStatus: () => false,
	};
	const root = document.body.createDiv();
	const view = new SnowflakeDashboardView(
		{ app: {}, detach: vi.fn() } as unknown as WorkspaceLeaf,
		host as unknown as DashboardHost,
	);
	Object.assign(view, {
		contentEl: root,
		containerEl: root,
		projectPath: model.path,
		stateDelivered: true,
		stepChosen: true,
		selectedStep: 1,
		selectedPane: { kind: 'custom-fields' },
		updateViewTitle: vi.fn(),
		renderStepNavigation: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepHeader: vi.fn(),
		renderStepDescription: vi.fn(),
	});
	return { view, root };
}

/**
 * The custom field pane's template rows: in a pane too narrow for their
 * columns they stack into cards, and a card names each of its fields the
 * way the character and scene cards do, so a name is not left standing in
 * the value column beside an empty label.
 */
describe('the template table', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('labels every cell of a template row for the stacked cards', async () => {
		const { view, root } = mount();
		await view.refresh();
		for (const toggle of root.querySelectorAll<HTMLButtonElement>(
			'button.snowflake-method-definition-section-toggle[aria-expanded="false"]',
		)) {
			toggle.click();
		}
		const rows = Array.from(
			root.querySelectorAll<HTMLTableRowElement>('.snowflake-method-template-table tbody tr'),
		).filter((row) => row.querySelector('.snowflake-method-table-primary') !== null);
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			const labels = Array.from(row.querySelectorAll('td')).map((cell) => cell.getAttribute('data-label') ?? '');
			expect(labels.slice(0, 2)).toEqual(['table.name', 'table.description']);
			expect(labels.every((label) => label !== '')).toBe(true);
		}
		expect(rows[1]?.querySelector('td:nth-child(2)')?.textContent).toBe('');
		root.remove();
	});
});
