export const STEP_ONE_SECTION_IDS = [
	'genre',
	'audience-reason-1',
	'one-sentence-summary',
	'candidate-title-1',
	'candidate-title-2',
	'candidate-title-3',
	'candidate-title-4',
	'candidate-title-5',
	'candidate-title-6',
] as const;

export type StepOneSectionId = (typeof STEP_ONE_SECTION_IDS)[number];

export const STEP_TWO_SECTION_IDS = [
	'one-paragraph-summary',
	'description',
] as const;

export type StepTwoSectionId = (typeof STEP_TWO_SECTION_IDS)[number];

export const STEP_FOUR_SECTION_IDS = ['plot-synopsis'] as const;

export const STEP_SIX_SECTION_IDS = ['long-synopsis'] as const;

/**
 * The steps the dashboard writes from a box of its own rather than through a
 * note's editor: the two summaries and the two synopses, each a note of one
 * or more managed sections the box is bound to, keyed by step.
 */
export const STEP_SECTION_IDS = {
	1: STEP_ONE_SECTION_IDS,
	2: STEP_TWO_SECTION_IDS,
	4: STEP_FOUR_SECTION_IDS,
	6: STEP_SIX_SECTION_IDS,
} as const;

export type EditableStepId = keyof typeof STEP_SECTION_IDS;
