import { describe, expect, it } from 'vitest';

import {
	coerceFreeformPane,
	dashboardHasHealthIssues,
	dashboardPaneKey,
	dashboardRenderContinuity,
	FREEFORM_STEPS,
	isFreeformStep,
	memberMatches,
	mergeDashboardViewState,
	shouldShowGlobalStructureIssue,
	type DashboardPane,
} from '../../src/ui/dashboard-state';
import type { StepId } from '../../src/domain';

const DEFAULT_PANE = { kind: 'step', step: 1 } as const;
const OPEN_RAIL = { steps: false, worldbuilding: false, creationTools: false };

describe('dashboard restored state', () => {
	it('detects persisted project state that arrives after the view opens', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: null,
				projectTitle: null,
				selectedStep: 1,
				selectedPane: DEFAULT_PANE,
				railCollapsed: OPEN_RAIL,
			},
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
				// A state written by an older build carries only the step, which
				// is a pane all the same.
				selectedPane: { kind: 'step', step: 4 },
				railCollapsed: OPEN_RAIL,
			},
			changed: true,
		});
	});

	it('restores a worldbuilding pane and the rail folds', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: null,
				projectTitle: null,
				selectedStep: 1,
				selectedPane: DEFAULT_PANE,
				railCollapsed: OPEN_RAIL,
			},
			{
				selectedPane: { kind: 'worldbuilding', wbKind: 'time' },
				railCollapsed: { steps: true, worldbuilding: false },
			},
		);

		expect(update.state.selectedPane).toEqual({
			kind: 'worldbuilding',
			wbKind: 'time',
		});
		expect(update.state.railCollapsed).toEqual({
			steps: true,
			worldbuilding: false,
			creationTools: false,
		});
		expect(update.changed).toBe(true);
	});

	it('restores the statistics pane and the creation tools fold', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: null,
				projectTitle: null,
				selectedStep: 1,
				selectedPane: DEFAULT_PANE,
				railCollapsed: OPEN_RAIL,
			},
			{
				selectedPane: { kind: 'statistics' },
				railCollapsed: { creationTools: true },
			},
		);

		expect(update.state.selectedPane).toEqual({ kind: 'statistics' });
		expect(update.state.railCollapsed.creationTools).toBe(true);
		expect(update.changed).toBe(true);
		expect(dashboardPaneKey(update.state.selectedPane)).toBe('statistics');
	});

	it('restores a definition pane and keys it apart from the others', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: null,
				projectTitle: null,
				selectedStep: 1,
				selectedPane: DEFAULT_PANE,
				railCollapsed: OPEN_RAIL,
			},
			{ selectedPane: { kind: 'definition', definitionId: 'world-status' } },
		);

		expect(update.state.selectedPane).toEqual({
			kind: 'definition',
			definitionId: 'world-status',
		});
		expect(update.changed).toBe(true);
		expect(dashboardPaneKey(update.state.selectedPane)).toBe(
			'def-world-status',
		);
		// A vocabulary this build does not know is not a pane.
		expect(
			mergeDashboardViewState(update.state, {
				selectedPane: { kind: 'definition', definitionId: 'weather' },
			}).changed,
		).toBe(false);
	});

	it('restores the custom-fields pane', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: null,
				projectTitle: null,
				selectedStep: 1,
				selectedPane: DEFAULT_PANE,
				railCollapsed: OPEN_RAIL,
			},
			{ selectedPane: { kind: 'custom-fields' } },
		);

		expect(update.state.selectedPane).toEqual({ kind: 'custom-fields' });
		expect(update.changed).toBe(true);
		expect(dashboardPaneKey(update.state.selectedPane)).toBe('custom-fields');
	});

	it('supports restoring an explicitly empty dashboard', () => {
		const update = mergeDashboardViewState(
			{
				projectPath: 'Snowflake Projects/Novel/metadata.md',
				projectTitle: 'Novel',
				selectedStep: 3,
				selectedPane: { kind: 'step', step: 3 },
				railCollapsed: OPEN_RAIL,
			},
			{ projectPath: null, projectTitle: null, selectedStep: 1 },
		);

		expect(update.state).toEqual({
			projectPath: null,
			projectTitle: null,
			selectedStep: 1,
			selectedPane: { kind: 'step', step: 1 },
			railCollapsed: OPEN_RAIL,
		});
		expect(update.changed).toBe(true);
	});

	it('ignores invalid restored values without requesting a refresh', () => {
		const current = {
			projectPath: 'Snowflake Projects/Novel/metadata.md',
			projectTitle: 'Novel',
			selectedStep: 3 as const,
			selectedPane: { kind: 'step', step: 3 } as const,
			railCollapsed: OPEN_RAIL,
		};

		expect(
			mergeDashboardViewState(current, {
				projectPath: 10,
				projectTitle: false,
				selectedStep: 11,
				// A blank kind names nothing; a worded one is some project's kind.
				selectedPane: { kind: 'worldbuilding', wbKind: '  ' },
				railCollapsed: { steps: 'yes' },
			}),
		).toEqual({ state: current, changed: false });
	});

	it('restores a custom kind pane by its id alone', () => {
		const current = {
			projectPath: 'Snowflake Projects/Novel/metadata.md',
			projectTitle: 'Novel',
			selectedStep: 3 as const,
			selectedPane: { kind: 'step', step: 3 } as const,
			railCollapsed: OPEN_RAIL,
		};
		const update = mergeDashboardViewState(current, {
			selectedPane: { kind: 'worldbuilding', wbKind: 'Faction' },
		});
		expect(update.changed).toBe(true);
		expect(update.state.selectedPane).toEqual({
			kind: 'worldbuilding',
			wbKind: 'Faction',
		});
	});
});

describe('dashboard render continuity', () => {
	it('carries scroll and disclosure state through a same-pane refresh', () => {
		expect(
			dashboardRenderContinuity(
				{ projectId: 'novel', pane: 'step-9' },
				{ projectId: 'novel', pane: 'step-9' },
			),
		).toEqual({
			sameProject: true,
			samePanel: true,
			revealActiveStep: false,
		});
	});

	it('keeps the rail put but resets the panel when the pane changes', () => {
		expect(
			dashboardRenderContinuity(
				{ projectId: 'novel', pane: 'step-1' },
				{ projectId: 'novel', pane: 'wb-time' },
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
				{ projectId: 'novel', pane: 'step-9' },
				{ projectId: 'novella', pane: 'step-9' },
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
				{ projectId: null, pane: null },
				{ projectId: 'novel', pane: 'step-4' },
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
		worldbuilding: { time: [], location: [], item: [] },
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

	it('announces a project folder renamed out from under its stored name', () => {
		expect(
			shouldShowGlobalStructureIssue({
				kind: 'structure',
				code: 'mismatched-project-folder',
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

describe('member table search', () => {
	it('matches without regard to case, anywhere in any field', () => {
		expect(memberMatches(['Prince Kael', 'major'], 'kael')).toBe(true);
		expect(memberMatches(['Prince Kael', 'major'], 'MAJOR')).toBe(true);
		expect(memberMatches(['Prince Kael', 'major'], 'ince k')).toBe(true);
	});

	it('lets everyone through while the search box is empty', () => {
		expect(memberMatches(['Prince Kael'], '')).toBe(true);
		expect(memberMatches(['Prince Kael'], '   ')).toBe(true);
		expect(memberMatches([], '')).toBe(true);
	});

	it('holds back a member none of whose fields carry the query', () => {
		expect(memberMatches(['Prince Kael', 'major'], 'minor')).toBe(false);
		expect(memberMatches([], 'kael')).toBe(false);
	});

	it('ignores the whitespace around a query, not the one inside it', () => {
		expect(memberMatches(['Prince Kael'], '  prince kael  ')).toBe(true);
		expect(memberMatches(['PrinceKael'], 'prince kael')).toBe(false);
	});
});

describe('freeform mode panes', () => {
	it('keeps characters and scenes as the steps freeform mode shows', () => {
		expect(FREEFORM_STEPS).toEqual([7, 8]);
		expect(isFreeformStep(7)).toBe(true);
		expect(isFreeformStep(8)).toBe(true);
		expect(isFreeformStep(1)).toBe(false);
		expect(isFreeformStep(10)).toBe(false);
	});

	it('lets the surviving step panes and every non-step pane stand', () => {
		const characters: DashboardPane = { kind: 'step', step: 7 };
		const scenes: DashboardPane = { kind: 'step', step: 8 };
		const kind: DashboardPane = { kind: 'worldbuilding', wbKind: 'time' };
		const definition: DashboardPane = {
			kind: 'definition',
			definitionId: 'category',
		};
		const customFields: DashboardPane = { kind: 'custom-fields' };
		const statistics: DashboardPane = { kind: 'statistics' };
		expect(coerceFreeformPane(characters)).toBe(characters);
		expect(coerceFreeformPane(scenes)).toBe(scenes);
		expect(coerceFreeformPane(kind)).toBe(kind);
		expect(coerceFreeformPane(definition)).toBe(definition);
		expect(coerceFreeformPane(customFields)).toBe(customFields);
		expect(coerceFreeformPane(statistics)).toBe(statistics);
	});

	it('lands every hidden step pane on characters', () => {
		const hidden: StepId[] = [1, 2, 3, 4, 5, 6, 9, 10];
		for (const step of hidden) {
			expect(coerceFreeformPane({ kind: 'step', step })).toEqual({
				kind: 'step',
				step: 7,
			});
		}
	});
});
