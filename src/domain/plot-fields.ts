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
