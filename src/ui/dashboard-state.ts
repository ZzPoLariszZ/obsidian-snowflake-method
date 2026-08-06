import { isStepId, type StepId } from '../domain';
import type { ManagedSectionIssueViewModel } from './view-model';

export interface DashboardViewStateSnapshot {
	projectPath: string | null;
	projectTitle: string | null;
	selectedStep: StepId;
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
	const state = { projectPath, projectTitle, selectedStep };
	return {
		state,
		changed:
			state.projectPath !== current.projectPath ||
			state.projectTitle !== current.projectTitle ||
			state.selectedStep !== current.selectedStep,
	};
}

export interface DashboardRenderSnapshot {
	projectId: string | null;
	step: StepId | null;
}

export interface DashboardRenderContinuity {
	/** The incoming render replaces a panel showing the same project. */
	sameProject: boolean;
	/** ...and the same step, so the main panel's scroll offset still applies. */
	samePanel: boolean;
	/** Pull the active step button into view rather than trusting the offset. */
	revealActiveStep: boolean;
}

/**
 * Every refresh rebuilds the dashboard from an empty container, which drops the
 * step list's scroll offset and every open disclosure with it. Carrying that
 * presentation state across a render is only correct while the author stays put:
 * a different project starts over, and a different step scrolls its own panel
 * back to the top while keeping the step list where the author left it.
 */
export function dashboardRenderContinuity(
	previous: DashboardRenderSnapshot,
	next: DashboardRenderSnapshot,
): DashboardRenderContinuity {
	const sameProject =
		previous.projectId !== null && previous.projectId === next.projectId;
	const samePanel =
		sameProject && previous.step !== null && previous.step === next.step;
	return { sameProject, samePanel, revealActiveStep: !samePanel };
}

/**
 * Only project-wide, author-blocking structure problems belong above the
 * dashboard layout. Auxiliary folders such as Material and Archive still
 * participate in project health, but are surfaced by the project manager and
 * the full health report instead of interrupting every writing step.
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
}

export function dashboardHasHealthIssues(model: DashboardHealthSource): boolean {
	return model.readOnly || [
		...model.structureIssues,
		...model.steps.flatMap((step) => step.healthIssues),
		...model.characters.flatMap((character) => character.healthIssues),
		...model.scenes.flatMap((scene) => scene.healthIssues),
	].some((issue) => issue.blocking);
}
