import {
	isDefinitionFileId,
	isStepId,
	isWorldbuildingKind,
	type DefinitionFileId,
	type StepId,
	type WorldbuildingKind,
} from '../domain';
import type { ManagedSectionIssueViewModel } from './view-model';

/**
 * What the main panel is showing: one step, one worldbuilding kind, or one
 * of the definition vocabularies.
 */
export type DashboardPane =
	| { kind: 'step'; step: StepId }
	| { kind: 'worldbuilding'; wbKind: WorldbuildingKind }
	| { kind: 'definition'; definitionId: DefinitionFileId };

/** A stable identity for a pane, for continuity and change comparisons. */
export function dashboardPaneKey(pane: DashboardPane): string {
	if (pane.kind === 'step') return `step-${pane.step}`;
	if (pane.kind === 'worldbuilding') return `wb-${pane.wbKind}`;
	return `def-${pane.definitionId}`;
}

export function parseDashboardPane(value: unknown): DashboardPane | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Record<string, unknown>;
	if (candidate.kind === 'step' && isStepId(candidate.step)) {
		return { kind: 'step', step: candidate.step };
	}
	if (
		candidate.kind === 'worldbuilding' &&
		isWorldbuildingKind(candidate.wbKind)
	) {
		return { kind: 'worldbuilding', wbKind: candidate.wbKind };
	}
	if (
		candidate.kind === 'definition' &&
		isDefinitionFileId(candidate.definitionId)
	) {
		return { kind: 'definition', definitionId: candidate.definitionId };
	}
	return null;
}

export interface DashboardRailCollapse {
	steps: boolean;
	worldbuilding: boolean;
}

export interface DashboardViewStateSnapshot {
	projectPath: string | null;
	projectTitle: string | null;
	/** Kept alongside the pane so state written by older builds still lands. */
	selectedStep: StepId;
	selectedPane: DashboardPane;
	railCollapsed: DashboardRailCollapse;
}

export interface DashboardViewStateUpdate {
	state: DashboardViewStateSnapshot;
	changed: boolean;
}

export function mergeDashboardViewState(
	current: DashboardViewStateSnapshot,
	value: unknown,
): DashboardViewStateUpdate {
	if (typeof value !== 'object' || value === null) {
		return { state: current, changed: false };
	}
	const candidate = value as Record<string, unknown>;
	const projectPath =
		typeof candidate.projectPath === 'string' || candidate.projectPath === null
			? candidate.projectPath
			: current.projectPath;
	const projectTitle =
		typeof candidate.projectTitle === 'string' ||
		candidate.projectTitle === null
			? candidate.projectTitle
			: current.projectTitle;
	const selectedStep =
		typeof candidate.selectedStep === 'number' &&
		isStepId(candidate.selectedStep)
			? candidate.selectedStep
			: current.selectedStep;
	// A pane saved by this build wins; a state from an older build carries only
	// the step, which is a pane all the same.
	const selectedPane =
		parseDashboardPane(candidate.selectedPane) ??
		(typeof candidate.selectedStep === 'number' &&
		isStepId(candidate.selectedStep)
			? { kind: 'step' as const, step: candidate.selectedStep }
			: current.selectedPane);
	const collapseCandidate = candidate.railCollapsed as
		| Record<string, unknown>
		| undefined;
	const railCollapsed: DashboardRailCollapse = {
		steps:
			typeof collapseCandidate?.steps === 'boolean'
				? collapseCandidate.steps
				: current.railCollapsed.steps,
		worldbuilding:
			typeof collapseCandidate?.worldbuilding === 'boolean'
				? collapseCandidate.worldbuilding
				: current.railCollapsed.worldbuilding,
	};
	const state = {
		projectPath,
		projectTitle,
		selectedStep,
		selectedPane,
		railCollapsed,
	};
	return {
		state,
		changed:
			state.projectPath !== current.projectPath ||
			state.projectTitle !== current.projectTitle ||
			state.selectedStep !== current.selectedStep ||
			dashboardPaneKey(state.selectedPane) !==
				dashboardPaneKey(current.selectedPane) ||
			state.railCollapsed.steps !== current.railCollapsed.steps ||
			state.railCollapsed.worldbuilding !== current.railCollapsed.worldbuilding,
	};
}

/**
 * Whether one member's searchable fields contain the query, matched the way
 * the option pickers match: lower-cased, anywhere in the text. An empty query
 * matches everyone, so a search box at rest filters nothing out.
 */
export function memberMatches(
	texts: readonly string[],
	query: string,
): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return texts.some((text) => text.toLocaleLowerCase().includes(needle));
}

export interface DashboardRenderSnapshot {
	projectId: string | null;
	/** The pane key on show, from `dashboardPaneKey`. */
	pane: string | null;
}

export interface DashboardRenderContinuity {
	/** The incoming render replaces a panel showing the same project. */
	sameProject: boolean;
	/** ...and the same pane, so the main panel's scroll offset still applies. */
	samePanel: boolean;
	/** Pull the active step button into view rather than trusting the offset. */
	revealActiveStep: boolean;
}

/**
 * Every refresh rebuilds the dashboard from an empty container, which drops the
 * step list's scroll offset and every open disclosure with it. Carrying that
 * presentation state across a render is only correct while the author stays put:
 * a different project starts over, and a different pane scrolls its own panel
 * back to the top while keeping the rail where the author left it.
 */
export function dashboardRenderContinuity(
	previous: DashboardRenderSnapshot,
	next: DashboardRenderSnapshot,
): DashboardRenderContinuity {
	const sameProject =
		previous.projectId !== null && previous.projectId === next.projectId;
	const samePanel =
		sameProject && previous.pane !== null && previous.pane === next.pane;
	return { sameProject, samePanel, revealActiveStep: !samePanel };
}

/**
 * Only problems with the project itself belong above the dashboard layout:
 * what it is called and what the plugin knows about it. Auxiliary folders such
 * as Material and Archive still participate in project health, but are surfaced
 * by the project manager and the full health report instead of interrupting
 * every writing step.
 */
export function shouldShowGlobalStructureIssue(
	issue: Pick<
		ManagedSectionIssueViewModel,
		'kind' | 'code' | 'stepIds'
	>,
): boolean {
	return issue.kind === 'structure' && issue.stepIds.length === 0 && [
		'missing-metadata-field',
		'invalid-metadata-field',
		// A folder renamed from the file explorer leaves the dashboard showing a
		// name the Vault no longer uses. Nothing about that interrupts writing,
		// which is exactly why it has to be said here rather than waited for.
		'mismatched-project-folder',
	].includes(issue.code);
}

interface DashboardHealthSource {
	readOnly: boolean;
	structureIssues: readonly Pick<ManagedSectionIssueViewModel, 'blocking'>[];
	steps: readonly {
		healthIssues: readonly Pick<ManagedSectionIssueViewModel, 'blocking'>[];
	}[];
	characters: readonly {
		healthIssues: readonly Pick<ManagedSectionIssueViewModel, 'blocking'>[];
	}[];
	scenes: readonly {
		healthIssues: readonly Pick<ManagedSectionIssueViewModel, 'blocking'>[];
	}[];
	worldbuilding: Readonly<
		Record<
			string,
			readonly {
				healthIssues: readonly Pick<ManagedSectionIssueViewModel, 'blocking'>[];
			}[]
		>
	>;
}

export function dashboardHasHealthIssues(model: DashboardHealthSource): boolean {
	return model.readOnly || [
		...model.structureIssues,
		...model.steps.flatMap((step) => step.healthIssues),
		...model.characters.flatMap((character) => character.healthIssues),
		...model.scenes.flatMap((scene) => scene.healthIssues),
		...Object.values(model.worldbuilding).flatMap((entities) =>
			entities.flatMap((entity) => entity.healthIssues),
		),
	].some((issue) => issue.blocking);
}
