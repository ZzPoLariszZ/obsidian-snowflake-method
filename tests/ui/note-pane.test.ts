import { describe, expect, it } from 'vitest';

import {
	routeNotePane,
	type NotePaneLeaf,
	type NotePaneRouteRequest,
} from '../../src/ui/note-pane';

const DASHBOARD = 'snowflake-method-dashboard';
const PROJECT_ID = 'project-alpha';
const SYNOPSIS = 'Novels/Alpha/30_Synopsis/Plot_Synopsis.md';
const DRAFT = 'Novels/Alpha/50_Manuscript/Draft.md';

function leaf(
	overrides: Partial<NotePaneLeaf<string, string>> &
		Pick<NotePaneLeaf<string, string>, 'leaf' | 'pane'>,
): NotePaneLeaf<string, string> {
	return {
		viewType: 'markdown',
		filePath: null,
		projectId: null,
		...overrides,
	};
}

function dashboardLeaf(id = 'dashboard', pane = 'pane-dashboard') {
	return leaf({ leaf: id, pane, viewType: DASHBOARD });
}

function request(
	overrides: Partial<NotePaneRouteRequest<string, string>>,
): NotePaneRouteRequest<string, string> {
	return {
		targetPath: SYNOPSIS,
		targetProjectId: PROJECT_ID,
		dashboardViewType: DASHBOARD,
		leaves: [dashboardLeaf()],
		notePane: null,
		activeLeaf: 'dashboard',
		preferSplit: true,
		canSplit: true,
		...overrides,
	};
}

describe('long-form note routing', () => {
	it('splits beside the dashboard when no companion pane exists', () => {
		expect(routeNotePane(request({}))).toEqual({
			kind: 'split',
			source: 'dashboard',
		});
	});

	it('reuses the companion pane instead of stacking another column', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf(),
					leaf({
						leaf: 'synopsis',
						pane: 'pane-notes',
						filePath: SYNOPSIS,
						projectId: PROJECT_ID,
					}),
				],
				notePane: 'pane-notes',
				targetPath: DRAFT,
			}),
		);

		expect(route).toEqual({
			kind: 'pane',
			pane: 'pane-notes',
			anchor: 'synopsis',
		});
	});

	it('switches to the tab that already shows the note', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf(),
					leaf({
						leaf: 'draft',
						pane: 'pane-notes',
						filePath: DRAFT,
						projectId: PROJECT_ID,
					}),
					leaf({
						leaf: 'synopsis',
						pane: 'pane-notes',
						filePath: SYNOPSIS,
						projectId: PROJECT_ID,
					}),
				],
				notePane: 'pane-notes',
			}),
		);

		expect(route).toEqual({ kind: 'reveal', leaf: 'synopsis' });
	});

	it('switches to an open note even when splitting is turned off', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf(),
					leaf({
						leaf: 'synopsis',
						pane: 'pane-user',
						filePath: SYNOPSIS,
						projectId: PROJECT_ID,
					}),
				],
				preferSplit: false,
			}),
		);

		expect(route).toEqual({ kind: 'reveal', leaf: 'synopsis' });
	});

	it('recreates the pane once the author has closed it', () => {
		const route = routeNotePane(
			request({
				leaves: [dashboardLeaf()],
				notePane: 'pane-notes',
			}),
		);

		expect(route).toEqual({ kind: 'split', source: 'dashboard' });
	});

	it('leaves panes the author arranged for unrelated notes alone', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf(),
					leaf({
						leaf: 'journal',
						pane: 'pane-user',
						filePath: 'Journal/2026-08-03.md',
					}),
					leaf({
						leaf: 'other-project',
						pane: 'pane-other',
						filePath: 'Novels/Beta/50_Manuscript/Draft.md',
						projectId: 'project-beta',
					}),
				],
			}),
		);

		expect(route).toEqual({ kind: 'split', source: 'dashboard' });
	});

	it('adopts the pane holding this project after the layout is restored', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf(),
					leaf({
						leaf: 'draft',
						pane: 'pane-notes',
						filePath: DRAFT,
						projectId: PROJECT_ID,
					}),
				],
				notePane: null,
			}),
		);

		expect(route).toEqual({
			kind: 'pane',
			pane: 'pane-notes',
			anchor: 'draft',
		});
	});

	it('splits away from a companion pane that took in the dashboard', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf('dashboard', 'pane-notes'),
					leaf({
						leaf: 'draft',
						pane: 'pane-notes',
						filePath: DRAFT,
						projectId: PROJECT_ID,
					}),
				],
				notePane: 'pane-notes',
			}),
		);

		expect(route).toEqual({ kind: 'split', source: 'dashboard' });
	});

	it('splits beside the dashboard the author is working in', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf('dashboard-alpha', 'pane-alpha'),
					dashboardLeaf('dashboard-beta', 'pane-beta'),
				],
				activeLeaf: 'dashboard-beta',
			}),
		);

		expect(route).toEqual({ kind: 'split', source: 'dashboard-beta' });
	});

	it('keeps the companion pane per session, not per dashboard', () => {
		const route = routeNotePane(
			request({
				leaves: [
					dashboardLeaf('dashboard-alpha', 'pane-alpha'),
					dashboardLeaf('dashboard-beta', 'pane-beta'),
					leaf({ leaf: 'notes', pane: 'pane-notes', filePath: DRAFT }),
				],
				activeLeaf: 'dashboard-beta',
				notePane: 'pane-notes',
			}),
		);

		expect(route).toEqual({
			kind: 'pane',
			pane: 'pane-notes',
			anchor: 'notes',
		});
	});

	it('falls back to a tab on mobile and on narrow windows', () => {
		expect(routeNotePane(request({ canSplit: false }))).toEqual({
			kind: 'tab',
		});
	});

	it('falls back to a tab when the split setting is off', () => {
		expect(routeNotePane(request({ preferSplit: false }))).toEqual({
			kind: 'tab',
		});
	});

	it('falls back to a tab when no dashboard is open', () => {
		const route = routeNotePane(
			request({
				leaves: [
					leaf({ leaf: 'journal', pane: 'pane-user', filePath: 'Journal.md' }),
				],
				activeLeaf: 'journal',
				targetProjectId: null,
			}),
		);

		expect(route).toEqual({ kind: 'tab' });
	});
});
