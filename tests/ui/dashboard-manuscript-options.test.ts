import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { MemberFormContext } from '../../src/ui/modals';
import { sceneFilterRows, sceneFilters } from '../../src/ui/scene-filters';
import type { ProjectDashboardModel } from '../../src/ui/view-model';

const projectA = 'Novel A/Project.md';
const projectB = 'Novel B/Project.md';
const notesA = [
	{ path: 'Novel A/Manuscript/Part One/Chapter.md', title: 'Chapter' },
	{ path: 'Novel A/Manuscript/Part Two/Chapter.md', title: 'Chapter' },
];
const notesB = [{ path: 'Novel B/Manuscript/Opening.md', title: 'Opening' }];

function model(path: string): ProjectDashboardModel {
	return {
		path,
		projectId: path,
		characters: [],
		scenes: [],
		worldbuildingKinds: [],
		worldbuilding: {},
	} as unknown as ProjectDashboardModel;
}

interface DashboardOptions {
	loadManuscriptNotes(model: ProjectDashboardModel): Promise<void>;
	manuscriptNotesFor(model: ProjectDashboardModel): typeof notesA;
	memberFormContext(model: ProjectDashboardModel, kind: 'scene'): Promise<MemberFormContext>;
}

function dashboards() {
	// Project B is active. A lookup without an explicit path consequently
	// answers B, even when a background or split dashboard is drawing A.
	const listManuscriptNotes = vi.fn((path = projectB) =>
		Promise.resolve(path === projectA ? notesA : notesB),
	);
	const host = {
		listManuscriptNotes,
		listDefinitionPaths: () => Promise.resolve([]),
		definitionFilePaths: () => Promise.resolve({
			category: '', 'world-status': '', relationship: '',
		}),
	};
	const view = (): DashboardOptions => {
		const dashboard = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		Object.assign(dashboard, { host, app: {}, manuscriptNotes: null, t: (key: string) => key });
		return dashboard as unknown as DashboardOptions;
	};
	return { first: view(), second: view(), listManuscriptNotes };
}

describe('manuscript options in dashboards for different projects', () => {
	it('keeps each split dashboard filter scoped to its model while another project is active', async () => {
		const { first, second, listManuscriptNotes } = dashboards();
		const firstModel = model(projectA);
		const secondModel = model(projectB);
		await Promise.all([
			first.loadManuscriptNotes(firstModel),
			second.loadManuscriptNotes(secondModel),
		]);
		expect(listManuscriptNotes.mock.calls).toEqual([[projectA], [projectB]]);
		expect(first.manuscriptNotesFor(firstModel)).toEqual(notesA);
		expect(second.manuscriptNotesFor(secondModel)).toEqual(notesB);
		const rows = sceneFilterRows((key) => key, firstModel, sceneFilters(), {
			categoryPaths: [], manuscriptNotes: first.manuscriptNotesFor(firstModel),
		});
		const linked = rows.find((row) => row.label === 'table.sceneLinked');
		if (linked === undefined || linked.presentation === 'number-range') {
			throw new Error('Missing linked manuscript filter');
		}
		expect(linked.options()).toEqual([
			{ value: 'Novel A/Manuscript/Part One/Chapter', label: 'Chapter' },
			{ value: 'Novel A/Manuscript/Part Two/Chapter', label: 'Chapter' },
		]);
	});

	it('gives scene forms full path links from their own project even when note titles repeat', async () => {
		const { first, listManuscriptNotes } = dashboards();
		const context = await first.memberFormContext(model(projectA), 'scene');
		expect(listManuscriptNotes).toHaveBeenCalledExactlyOnceWith(projectA);
		expect(context.manuscriptNotes()).toEqual([
			{ value: '[[Novel A/Manuscript/Part One/Chapter]]', label: 'Chapter' },
			{ value: '[[Novel A/Manuscript/Part Two/Chapter]]', label: 'Chapter' },
		]);
	});
});

describe('loaded dashboard workspace context', () => {
	function view() {
		const dashboard = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		Object.assign(dashboard, {
			projectPath: projectA,
			projectLocale: 'zh-CN',
			lastRender: { model: model(projectA) },
		});
		return dashboard;
	}

	it('supplies the loaded project immediately without refreshing', () => {
		expect(view().workspaceProjectContext()).toEqual({ path: projectA, locale: 'zh-CN' });
	});

	it.each([
		{ projectPath: null },
		{ projectLocale: null },
		{ lastRender: null },
		{ lastRender: { model: null } },
		{ projectPath: projectB },
	])('waits for a matching project model after incomplete or changed state: %j', (state) => {
		const dashboard = view();
		Object.assign(dashboard, state);
		expect(dashboard.workspaceProjectContext()).toBeNull();
	});
});
