import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceLeaf } from 'obsidian';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app: unknown;
			constructor(public leaf: { app: unknown }) { this.app = leaf.app; }
		},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { DashboardHost, ProjectDashboardModel } from '../../src/ui/view-model';

/**
 * Retained panel nodes can lose their browser scroll offsets while detached.
 * Keep the dashboard's actual render lifecycle and state keeper; replace only
 * the panel drawing and browser layout with scrollers that reproduce that loss.
 */
function dashboard() {
	const table = { scrollTop: 29_697 };
	const frequency = { scrollTop: 880 };
	const oldTab = { scrollTop: 300 };
	let tab = oldTab;
	let main = { scrollTop: 40 };
	const rail = { scrollTop: 120, querySelector: () => null };
	let mounted = true;
	const root = {
		dataset: {},
		matches: () => false,
		querySelectorAll: () => [],
		querySelector: (selector: string) => {
			if (!mounted) return null;
			switch (selector) {
				case '.snowflake-method-step-nav-scroll': return rail;
				case '.snowflake-method-main': return main;
				case '.snowflake-method-tab-scroll': return tab;
				case '.snowflake-method-tab-scroll .snowflake-method-table-body': return table;
				case '.snowflake-method-prose-frequency-list': return frequency;
				default: return null;
			}
		},
		empty: () => {
			mounted = false;
			// The frame nodes are replaced; the panel's nodes are retained but
			// their scroll offsets are lost when layout observes the detachment.
			table.scrollTop = 0;
			frequency.scrollTop = 0;
		},
		addClass: () => undefined,
		createDiv: () => root,
	};
	const view = new SnowflakeDashboardView({ app: {} } as unknown as WorkspaceLeaf, {
		getRecentStep: () => 8,
		isFreeformModeEnabled: () => true,
	} as DashboardHost);
	Object.assign(view, {
		contentEl: root,
		stepChosen: true,
		selectedPane: { kind: 'statistics' },
		renderedProjectId: 'pressure',
		renderedPaneKey: 'statistics',
		updateViewTitle: vi.fn(),
		releaseMemberControls: vi.fn(),
		renderMigrationCallout: vi.fn(),
		renderStepNavigation: vi.fn(),
		renderSelectedStep: () => {
			main = { scrollTop: 0 };
			tab = { scrollTop: 0 };
			mounted = true;
		},
	});
	const model = {
		path: 'Pressure/00_System/001_Project_Metadata.md',
		projectId: 'pressure',
		title: 'Pressure',
		locale: 'en',
		readOnly: false,
		structureIssues: [],
	} as unknown as ProjectDashboardModel;
	return {
		view, table, frequency, oldTab,
		tab: () => tab,
		main: () => main,
		rebuild: (projectId = model.projectId) => {
			(view as unknown as { render(projects: [], model: ProjectDashboardModel): void })
				.render([], { ...model, projectId });
		},
	};
}

describe('dashboard statistics scroll through a frame refresh', () => {
	it('keeps the chapter, word-list and outer reading positions when retained panels are detached', () => {
		const panel = dashboard();

		panel.rebuild();

		expect(panel.tab()).not.toBe(panel.oldTab);
		expect(panel.tab().scrollTop).toBe(300);
		expect(panel.main().scrollTop).toBe(40);
		expect(panel.table.scrollTop).toBe(29_697);
		expect(panel.frequency.scrollTop).toBe(880);
	});

	it.each(['project', 'pane'])('does not carry the old reading position to another %s', (change) => {
		const panel = dashboard();
		if (change === 'pane') Object.assign(panel.view, { selectedPane: { kind: 'tasks' } });

		panel.rebuild(change === 'project' ? 'another-project' : 'pressure');

		expect(panel.tab().scrollTop).toBe(0);
		expect(panel.main().scrollTop).toBe(0);
		expect(panel.table.scrollTop).toBe(0);
		expect(panel.frequency.scrollTop).toBe(0);
	});
});
