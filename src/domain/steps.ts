import {
	STEP_IDS,
	type DocumentType,
	type StepFingerprintMap,
	type StepId,
	type StepStatus,
	type StepStatusMap,
} from './types';
import { fingerprint } from './fingerprint';

export interface StepDefinition {
	id: StepId;
	titleKey: `steps.${StepId}.title`;
	descriptionKey: `steps.${StepId}.description`;
	artifacts: readonly DocumentType[];
	dependencies: readonly StepId[];
	optional: boolean;
}

export const STEP_DEFINITIONS: readonly StepDefinition[] = [
	{
		id: 1,
		titleKey: 'steps.1.title',
		descriptionKey: 'steps.1.description',
		artifacts: ['one-sentence-summary'],
		dependencies: [],
		optional: false,
	},
	{
		id: 2,
		titleKey: 'steps.2.title',
		descriptionKey: 'steps.2.description',
		artifacts: ['one-paragraph-summary'],
		dependencies: [1],
		optional: false,
	},
	{
		id: 3,
		titleKey: 'steps.3.title',
		descriptionKey: 'steps.3.description',
		artifacts: ['character'],
		dependencies: [],
		optional: false,
	},
	{
		id: 4,
		titleKey: 'steps.4.title',
		descriptionKey: 'steps.4.description',
		artifacts: ['plot-synopsis'],
		dependencies: [2],
		optional: false,
	},
	{
		id: 5,
		titleKey: 'steps.5.title',
		descriptionKey: 'steps.5.description',
		artifacts: ['character'],
		dependencies: [3],
		optional: false,
	},
	{
		id: 6,
		titleKey: 'steps.6.title',
		descriptionKey: 'steps.6.description',
		artifacts: ['long-synopsis'],
		dependencies: [4],
		optional: false,
	},
	{
		id: 7,
		titleKey: 'steps.7.title',
		descriptionKey: 'steps.7.description',
		artifacts: ['character'],
		dependencies: [5],
		optional: false,
	},
	{
		id: 8,
		titleKey: 'steps.8.title',
		descriptionKey: 'steps.8.description',
		artifacts: ['scene'],
		dependencies: [6],
		optional: false,
	},
	{
		id: 9,
		titleKey: 'steps.9.title',
		descriptionKey: 'steps.9.description',
		artifacts: ['scene'],
		dependencies: [8],
		optional: true,
	},
	{
		id: 10,
		titleKey: 'steps.10.title',
		descriptionKey: 'steps.10.description',
		artifacts: ['draft'],
		dependencies: [1, 2, 3, 4, 5, 6, 7, 8, 9],
		optional: false,
	},
] as const;

const DEFINITION_BY_ID = new Map(
	STEP_DEFINITIONS.map((definition) => [definition.id, definition]),
);

/**
 * All downstream steps whose work may need another look when a step changes.
 * Character work feeds back into the two plot synopses and scene planning as
 * well as the character chain itself; review then flows to their dependants.
 */
export const REVIEW_IMPACTS: Readonly<Record<StepId, readonly StepId[]>> = {
	1: [2, 4, 6, 8, 9, 10],
	2: [4, 6, 8, 9, 10],
	3: [4, 5, 6, 7, 8],
	4: [6, 8, 9, 10],
	5: [4, 6, 7, 8],
	6: [8, 9, 10],
	7: [4, 6, 8],
	8: [9, 10],
	9: [10],
	10: [],
};

export function getStepDefinition(stepId: StepId): StepDefinition {
	const definition = DEFINITION_BY_ID.get(stepId);
	if (definition === undefined) {
		throw new RangeError(`Unknown Snowflake step: ${String(stepId)}`);
	}
	return definition;
}

export function createDefaultStepStatuses(): StepStatusMap {
	return {
		1: 'not-started',
		2: 'not-started',
		3: 'not-started',
		4: 'not-started',
		5: 'not-started',
		6: 'not-started',
		7: 'not-started',
		8: 'not-started',
		9: 'not-started',
		10: 'not-started',
	};
}

export function canSetStepStatus(
	stepId: StepId,
	status: StepStatus,
): boolean {
	if (stepId === 10) {
		return status === 'not-started' || status === 'complete';
	}
	return status !== 'skipped' || stepId === 9;
}

export function assertStepStatus(
	stepId: StepId,
	status: StepStatus,
): void {
	if (!canSetStepStatus(stepId, status)) {
		if (stepId === 10) {
			throw new Error(
				`Snowflake step 10 only supports not-started or complete; received ${status}.`,
			);
		}
		throw new Error(`Only Snowflake step 9 can be skipped; received step ${stepId}.`);
	}
}

export function setStepStatus(
	statuses: Readonly<StepStatusMap>,
	stepId: StepId,
	status: StepStatus,
): StepStatusMap {
	assertStepStatus(stepId, status);
	const next = { ...statuses, [stepId]: status };
	if (
		isStepHandled(stepId, status) &&
		!areStepPrerequisitesComplete(next, stepId)
	) {
		next[stepId] = 'not-started';
	}
	return enforceStepStatusDependencies(next);
}

export function isStepHandled(stepId: StepId, status: StepStatus): boolean {
	return status === 'complete' || (stepId === 9 && status === 'skipped');
}

export function getFirstIncompleteStep(
	statuses: Readonly<StepStatusMap>,
): StepId {
	return (
		STEP_IDS.find((stepId) => !isStepHandled(stepId, statuses[stepId])) ?? 10
	);
}

export function areStepPrerequisitesComplete(
	statuses: Readonly<StepStatusMap>,
	stepId: StepId,
): boolean {
	return getStepDefinition(stepId).dependencies.every((dependency) =>
		isStepHandled(dependency, statuses[dependency]),
	);
}

export function enforceStepStatusDependencies(
	statuses: Readonly<StepStatusMap>,
): StepStatusMap {
	const enforced = { ...statuses };
	for (const stepId of STEP_IDS) {
		if (
			isStepHandled(stepId, enforced[stepId]) &&
			!getStepDefinition(stepId).dependencies.every((dependency) => {
				const status = enforced[dependency];
				return isStepHandled(dependency, status) || status === 'in-revision';
			})
		) {
			enforced[stepId] = 'not-started';
		}
	}
	return enforced;
}

export function getReviewImpacts(changedStep: StepId): readonly StepId[] {
	return REVIEW_IMPACTS[changedStep];
}

export function getReviewSources(targetStep: StepId): StepId[] {
	return STEP_IDS.filter((sourceStep) =>
		REVIEW_IMPACTS[sourceStep].includes(targetStep),
	);
}

/**
 * Fingerprints the upstream context a particular target step has reviewed.
 * Storing one context fingerprint per target lets authors clear review hints
 * independently instead of globally acknowledging an upstream change.
 */
export function reviewContextFingerprint(
	targetStep: StepId,
	currentFingerprints: Readonly<StepFingerprintMap>,
): string {
	return fingerprint(
		getReviewSources(targetStep).map((sourceStep) => ({
			sourceStep,
			fingerprint: currentFingerprints[sourceStep] ?? null,
		})),
	);
}

export function calculateContextNeedsReview(
	currentFingerprints: Readonly<StepFingerprintMap>,
	reviewedContexts: Readonly<StepFingerprintMap>,
): StepId[] {
	return STEP_IDS.filter((targetStep) => {
		const reviewed = reviewedContexts[targetStep];
		return (
			reviewed !== undefined &&
			reviewed !== reviewContextFingerprint(targetStep, currentFingerprints)
		);
	});
}

/**
 * Returns downstream steps needing review because an upstream fingerprint is
 * absent from, or differs from, the fingerprint last acknowledged by the user.
 */
export function calculateNeedsReview(
	currentFingerprints: Readonly<StepFingerprintMap>,
	lastReviewedFingerprints: Readonly<StepFingerprintMap>,
): StepId[] {
	const affected = new Set<StepId>();

	for (const changedStep of STEP_IDS) {
		const current = currentFingerprints[changedStep];
		if (current === undefined) continue;
		if (current === lastReviewedFingerprints[changedStep]) continue;

		for (const impactedStep of REVIEW_IMPACTS[changedStep]) {
			affected.add(impactedStep);
		}
	}

	return STEP_IDS.filter((stepId) => affected.has(stepId));
}

export function getProgress(statuses: Readonly<StepStatusMap>): {
	completed: number;
	total: number;
	percent: number;
} {
	const completed = STEP_IDS.filter((stepId) => {
		const status = statuses[stepId];
		return status === 'complete' || (stepId === 9 && status === 'skipped');
	}).length;
	return {
		completed,
		total: STEP_IDS.length,
		percent: Math.round((completed / STEP_IDS.length) * 100),
	};
}
