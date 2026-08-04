import type { DocumentType, StepId } from './types';

export interface ManagedSectionDescriptor {
	id: string;
	nameKey: string;
}

const section = (id: string): ManagedSectionDescriptor => ({
	id,
	nameKey: `editor.managedSection.name.${id}`,
});

/**
 * Canonical v1 section contract shared by templates, persistence, the
 * dashboard, and editor guidance. Marker ids remain language-neutral.
 */
export const MANAGED_SECTIONS_BY_DOCUMENT: Readonly<
	Record<DocumentType, readonly ManagedSectionDescriptor[]>
> = {
	'project-metadata': [],
	'one-sentence-summary': [
		section('genre'),
		section('audience-reason-1'),
		section('one-sentence-summary'),
		section('candidate-title-1'),
		section('candidate-title-2'),
		section('candidate-title-3'),
		section('candidate-title-4'),
		section('candidate-title-5'),
		section('candidate-title-6'),
	],
	'one-paragraph-summary': [
		section('one-paragraph-summary'),
		section('description'),
	],
	'plot-synopsis': [section('plot-synopsis')],
	'long-synopsis': [section('long-synopsis')],
	character: [
		section('one-paragraph-storyline'),
		section('character-synopsis'),
		section('character-profile'),
	],
	scene: [
		section('scene-conflict'),
		section('scene-events'),
		section('scene-planning'),
	],
	draft: [],
	material: [],
	archive: [],
};

export function managedSectionsForDocument(
	documentType: DocumentType,
): readonly ManagedSectionDescriptor[] {
	return MANAGED_SECTIONS_BY_DOCUMENT[documentType];
}

export const PRIMARY_MANAGED_SECTION_BY_STEP: Readonly<
	Partial<Record<StepId, string>>
> = {
	1: 'one-sentence-summary',
	2: 'one-paragraph-summary',
	3: 'one-paragraph-storyline',
	4: 'plot-synopsis',
	5: 'character-synopsis',
	6: 'long-synopsis',
	7: 'character-profile',
	8: 'scene-conflict',
	9: 'scene-planning',
};

const MANAGED_SECTION_HIGHLIGHTS_BY_STEP: Readonly<
	Partial<Record<StepId, readonly string[]>>
> = {
	8: ['scene-conflict', 'scene-events'],
};

export function primaryManagedSectionForStep(step: StepId): string | null {
	return PRIMARY_MANAGED_SECTION_BY_STEP[step] ?? null;
}

export function managedSectionHighlightsForStep(
	step: StepId,
): readonly string[] {
	const primary = primaryManagedSectionForStep(step);
	return (
		MANAGED_SECTION_HIGHLIGHTS_BY_STEP[step] ??
		(primary === null ? [] : [primary])
	);
}
