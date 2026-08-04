import { describe, expect, it } from 'vitest';

import {
	STEP_DEFINITIONS,
	STEP_IDS,
	assertStepStatus,
	areStepPrerequisitesComplete,
	calculateContextNeedsReview,
	calculateNeedsReview,
	canSetStepStatus,
	createDefaultStepStatuses,
	getProgress,
	getFirstIncompleteStep,
	getReviewImpacts,
	getReviewSources,
	getStepDefinition,
	setStepStatus,
	reviewContextFingerprint,
} from '../../src/domain';

describe('Snowflake step definitions', () => {
	it('defines all ten steps once and in order', () => {
		expect(STEP_DEFINITIONS.map(({ id }) => id)).toEqual(STEP_IDS);
		expect(new Set(STEP_DEFINITIONS.map(({ id }) => id))).toHaveLength(10);
	});

	it('models the two method chains and final completion prerequisites', () => {
		expect(getStepDefinition(2).dependencies).toEqual([1]);
		expect(getStepDefinition(4).dependencies).toEqual([2]);
		expect(getStepDefinition(6).dependencies).toEqual([4]);
		expect(getStepDefinition(8).dependencies).toEqual([6]);
		expect(getStepDefinition(9).dependencies).toEqual([8]);
		expect(getStepDefinition(10).dependencies).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(getStepDefinition(5).dependencies).toEqual([3]);
		expect(getStepDefinition(7).dependencies).toEqual([5]);
	});

	it('marks only step 9 as optional', () => {
		expect(STEP_DEFINITIONS.filter(({ optional }) => optional).map(({ id }) => id)).toEqual([
			9,
		]);
	});
});

describe('manual step status', () => {
	it('allows every regular status on every step', () => {
		for (const step of STEP_IDS.filter((candidate) => candidate !== 10)) {
			for (const status of [
				'not-started',
				'in-progress',
				'in-revision',
				'complete',
			] as const) {
				expect(canSetStepStatus(step, status)).toBe(true);
			}
		}
	});

	it('allows only not started and complete on step 10', () => {
		expect(canSetStepStatus(10, 'not-started')).toBe(true);
		expect(canSetStepStatus(10, 'complete')).toBe(true);
		expect(canSetStepStatus(10, 'in-progress')).toBe(false);
		expect(canSetStepStatus(10, 'in-revision')).toBe(false);
		expect(canSetStepStatus(10, 'skipped')).toBe(false);
		expect(() => assertStepStatus(10, 'in-progress')).toThrow(
			/step 10 only supports/u,
		);
	});

	it('allows skipped only on step 9', () => {
		for (const step of STEP_IDS) {
			expect(canSetStepStatus(step, 'skipped')).toBe(step === 9);
		}
		expect(() => assertStepStatus(8, 'skipped')).toThrow(/step 9/u);
		expect(() => assertStepStatus(9, 'skipped')).not.toThrow();
	});

	it('updates a copied status map and keeps earlier work unchanged', () => {
		const initial = createDefaultStepStatuses();
		const updated = setStepStatus(initial, 1, 'complete');
		expect(initial[1]).toBe('not-started');
		expect(updated[1]).toBe('complete');
	});

	it('counts a skipped step 9 as progress', () => {
		const statuses = { ...createDefaultStepStatuses(), 9: 'skipped' as const };
		expect(getProgress(statuses)).toEqual({ completed: 1, total: 10, percent: 10 });
	});

	it('does not count a step in revision as complete', () => {
		const statuses = setStepStatus(createDefaultStepStatuses(), 2, 'in-revision');
		expect(getProgress(statuses)).toEqual({ completed: 0, total: 10, percent: 0 });
	});

	it('locates the first unfinished step for a newly opened project window', () => {
		const statuses = {
			...createDefaultStepStatuses(),
			1: 'complete' as const,
			2: 'complete' as const,
			3: 'in-revision' as const,
		};
		expect(getFirstIncompleteStep(statuses)).toBe(3);
	});

	it('treats a skipped optional step as handled when locating work', () => {
		const statuses = Object.fromEntries(
			STEP_IDS.map((step) => [step, step === 9 ? 'skipped' : 'complete']),
		) as ReturnType<typeof createDefaultStepStatuses>;
		expect(getFirstIncompleteStep(statuses)).toBe(10);
	});

	it('does not complete a step before its prerequisite', () => {
		let statuses = setStepStatus(createDefaultStepStatuses(), 4, 'complete');
		expect(statuses[4]).toBe('not-started');
		statuses = setStepStatus(statuses, 2, 'in-progress');
		expect(statuses[2]).toBe('in-progress');
	});

	it('preserves downstream work while a completed plot step is in revision', () => {
		let statuses = createDefaultStepStatuses();
		for (const step of [1, 2, 4, 6, 8] as const) {
			statuses = setStepStatus(statuses, step, 'complete');
		}
		statuses = setStepStatus(statuses, 9, 'skipped');
		statuses = setStepStatus(statuses, 4, 'in-revision');
		expect(statuses[4]).toBe('in-revision');
		expect(statuses[6]).toBe('complete');
		expect(statuses[8]).toBe('complete');
		expect(statuses[9]).toBe('skipped');
	});

	it('preserves downstream work while a completed character step is in revision', () => {
		let statuses = createDefaultStepStatuses();
		for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
			statuses = setStepStatus(statuses, step, 'complete');
		}
		statuses = setStepStatus(statuses, 10, 'complete');
		expect(areStepPrerequisitesComplete(statuses, 10)).toBe(true);

		statuses = setStepStatus(statuses, 3, 'in-revision');
		expect(statuses[3]).toBe('in-revision');
		expect(statuses[5]).toBe('complete');
		expect(statuses[7]).toBe('complete');
		expect(statuses[4]).toBe('complete');
		expect(statuses[6]).toBe('complete');
		expect(statuses[8]).toBe('complete');
		expect(statuses[9]).toBe('complete');
		expect(statuses[10]).toBe('complete');
	});

	it('does not allow a revision prerequisite to unlock new completion', () => {
		let statuses = setStepStatus(createDefaultStepStatuses(), 1, 'in-revision');
		statuses = setStepStatus(statuses, 2, 'complete');
		expect(statuses[1]).toBe('in-revision');
		expect(statuses[2]).toBe('not-started');
	});

	it('still cascades resets for not-started and in-progress prerequisites', () => {
		let statuses = createDefaultStepStatuses();
		for (const step of [1, 2, 4, 6, 8, 9] as const) {
			statuses = setStepStatus(statuses, step, 'complete');
		}
		statuses = setStepStatus(statuses, 4, 'in-progress');
		expect(statuses[6]).toBe('not-started');
		expect(statuses[8]).toBe('not-started');
		expect(statuses[9]).toBe('not-started');
	});
});

describe('review influence', () => {
	it('propagates plot work through the downstream plot chain', () => {
		expect(getReviewImpacts(4)).toEqual([6, 8, 9, 10]);
	});

	it('prompts plot, scene, and character reviews after character changes', () => {
		expect(getReviewImpacts(3)).toEqual([4, 5, 6, 7, 8]);
		expect(getReviewImpacts(7)).toEqual([4, 6, 8]);
	});

	it('reports impacts only for changed, present fingerprints', () => {
		expect(
			calculateNeedsReview(
				{ 1: 'new-one', 3: 'same', 6: 'new-six' },
				{ 1: 'old-one', 3: 'same' },
			),
		).toEqual([2, 4, 6, 8, 9, 10]);
	});

	it('does not mark the changed step itself or invent missing changes', () => {
		expect(calculateNeedsReview({ 8: 'same' }, { 8: 'same' })).toEqual([]);
		expect(calculateNeedsReview({}, { 1: 'old' })).toEqual([]);
		expect(calculateNeedsReview({ 10: 'changed' }, {})).toEqual([]);
	});

	it('tracks review context independently for each downstream target', () => {
		const initial = { 1: 'one', 2: 'two', 4: 'four' };
		const reviewed = {
			2: reviewContextFingerprint(2, initial),
			4: reviewContextFingerprint(4, initial),
		};
		expect(getReviewSources(4)).toEqual([1, 2, 3, 5, 7]);
		expect(calculateContextNeedsReview(initial, reviewed)).toEqual([]);
		expect(
			calculateContextNeedsReview({ ...initial, 1: 'changed' }, reviewed),
		).toEqual([2, 4]);
	});
});
