import { describe, expect, it } from 'vitest';

import {
	dashboardHasHealthIssues,
	dashboardRenderContinuity,
	mergeDashboardViewState,
	shouldShowGlobalStructureIssue,
} from '../../src/ui/dashboard-state';

describe('dashboard restored state', () => {
	it('detects persisted project state that arrives after the view opens', () => {
		const update = mergeDashboardViewState(
			{ projectPath: null, projectTitle: null, selectedStep: 1 },
			{
				projectPath: 'Snowflake Projects/Novel/00_System/001_Project_Metadata.md',
				projectTitle: 'Novel',
				selectedStep: 4,
			},
		);

		expect(update).toEqual({
			state: {
				projectPath:
					'Snowflake Projects/Novel/00_System/001_Project_Metadata.md',
				projectTitle: 'Novel',
				selectedStep: 4,
			},
			changed: true,
		});
	});

	it('supports restoring an explicitly empty dashboard', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: 'Snowflake Projects/Novel/metadata.md',
				projectTitle: 'Novel',
				selectedStep: 3,
			},
			{ projectPath: null, projectTitle: null, selectedStep: 1 },
		);

		expect(update.state).toEqual({
			projectPath: null,
			projectTitle: null,
			selectedStep: 1,
		});
		expect(update.changed).toBe(true);
	});

	it('ignores invalid restored values without requesting a refresh', () => {
		const current = {
			projectPath: 'Snowflake Projects/Novel/metadata.md',
			projectTitle: 'Novel',
			selectedStep: 3 as const,
		};

		expect(
			mergeDashboardViewState(current, {
				projectPath: 10,
				projectTitle: false,
				selectedStep: 11,
			}),
		).toEqual({ state: current, changed: false });
	});
});

describe('dashboard render continuity', () => {
	it('carries scroll and disclosure state through a same-step refresh', () => {
		expect(
			dashboardRenderContinuity(
				{ projectId: 'novel', step: 9 },
				{ projectId: 'novel', step: 9 },
			),
		).toEqual({
			sameProject: true,
			samePanel: true,
			revealActiveStep: false,
		});
	});

	it('keeps the step list put but resets the panel when the step changes', () => {
		expect(
			dashboardRenderContinuity(
				{ projectId: 'novel', step: 1 },
				{ projectId: 'novel', step: 9 },
			),
		).toEqual({
			sameProject: true,
			samePanel: false,
			revealActiveStep: true,
		});
	});

	it('starts over when the dashboard switches to another project', () => {
		expect(
			dashboardRenderContinuity(
				{ projectId: 'novel', step: 9 },
				{ projectId: 'novella', step: 9 },
			),
		).toEqual({
			sameProject: false,
			samePanel: false,
			revealActiveStep: true,
		});
	});

	it('treats the first render after an empty dashboard as a fresh start', () => {
		expect(
			dashboardRenderContinuity(
				{ projectId: null, step: null },
				{ projectId: 'novel', step: 4 },
			),
		).toEqual({
			sameProject: false,
			samePanel: false,
			revealActiveStep: true,
		});
	});
});

describe('dashboard health indicator', () => {
	const healthyModel = {
		readOnly: false,
		structureIssues: [],
		steps: [{ healthIssues: [] }],
		characters: [],
		scenes: [],
	};

	it('is healthy when every issue source is clear', () => {
		expect(dashboardHasHealthIssues(healthyModel)).toBe(false);
	});

	it('includes auxiliary structure problems in the health indicator', () => {
		expect(
			dashboardHasHealthIssues({
				...healthyModel,
				structureIssues: [{ blocking: true }],
			}),
		).toBe(true);
	});

	it('marks a newer-schema read-only project as needing attention', () => {
		expect(
			dashboardHasHealthIssues({
				...healthyModel,
				readOnly: true,
			}),
		).toBe(true);
	});

	it('ignores non-blocking marker diagnostics', () => {
		expect(
			dashboardHasHealthIssues({
				...healthyModel,
				steps: [{ healthIssues: [{ blocking: false }] }],
			}),
		).toBe(false);
	});
});

describe('dashboard global structure issue placement', () => {
	it('keeps project metadata problems in the global dashboard notice', () => {
		expect(
			shouldShowGlobalStructureIssue({
				kind: 'structure',
				code: 'missing-metadata-field',
				stepIds: [],
			}),
		).toBe(true);
	});

	it('leaves auxiliary missing folders to the manager and health report', () => {
		expect(
			shouldShowGlobalStructureIssue({
				kind: 'structure',
				code: 'missing-directory',
				stepIds: [],
			}),
		).toBe(false);
	});

	it('leaves missing system templates to the manager and health report', () => {
		expect(
			shouldShowGlobalStructureIssue({
				kind: 'structure',
				code: 'missing-system-template',
				stepIds: [],
			}),
		).toBe(false);
	});

	it('leaves outdated system templates to the manager and health report', () => {
		expect(
			shouldShowGlobalStructureIssue({
				kind: 'structure',
				code: 'invalid-system-template',
				stepIds: [],
			}),
		).toBe(false);
	});

	it('does not duplicate step-scoped problems in the global notice', () => {
		expect(
			shouldShowGlobalStructureIssue({
				kind: 'structure',
				code: 'missing-artifact',
				stepIds: [1],
			}),
		).toBe(false);
	});
});
