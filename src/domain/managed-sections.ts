import type { DocumentType, StepId } from './types';

export interface ManagedSectionDescriptor {
	id: string;
	nameKey: string;
	/**
	 * May be absent without being damage: a fields block a note has not been
	 * migrated to carry yet, or a legacy section migration has already removed.
	 */
	optional?: boolean;
	/**
	 * No longer part of new notes. Still inspected so a remaining copy is not
	 * reported as an unknown section, still readable as a fallback store, and
	 * removed by the migration.
	 */
	legacy?: boolean;
	/**
	 * Written only by the plugin, as a view of the note's properties. The
	 * editor keeps the whole range read-only and the reconcile pass rewrites
	 * any change that reaches the file anyway.
	 */
	generated?: boolean;
}

const section = (
	id: string,
	flags: Pick<
		ManagedSectionDescriptor,
		'optional' | 'legacy' | 'generated'
	> = {},
): ManagedSectionDescriptor => ({
	id,
	nameKey: `editor.managedSection.name.${id}`,
	...flags,
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
		section('character-fields', { optional: true, generated: true }),
		section('one-paragraph-storyline'),
		section('character-synopsis'),
		section('character-profile'),
	],
	scene: [
		section('scene-fields', { optional: true, generated: true }),
		section('scene-conflict', { optional: true, legacy: true }),
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

/** The sections a freshly created note carries: everything not legacy. */
export function templateSectionsForDocument(
	documentType: DocumentType,
): readonly ManagedSectionDescriptor[] {
	return MANAGED_SECTIONS_BY_DOCUMENT[documentType].filter(
		(descriptor) => descriptor.legacy !== true,
	);
}

/** Every generated section id, for the editor's read-only handling. */
export const GENERATED_SECTION_IDS: ReadonlySet<string> = new Set(
	Object.values(MANAGED_SECTIONS_BY_DOCUMENT).flatMap((sections) =>
		sections
			.filter((descriptor) => descriptor.generated === true)
			.map((descriptor) => descriptor.id),
	),
);

/** Ids whose absence is a state of the note, not damage to it. */
export function optionalSectionIds(documentType: DocumentType): Set<string> {
	return new Set(
		MANAGED_SECTIONS_BY_DOCUMENT[documentType]
			.filter((descriptor) => descriptor.optional === true)
			.map((descriptor) => descriptor.id),
	);
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
	8: 'scene-events',
	9: 'scene-planning',
};

const MANAGED_SECTION_HIGHLIGHTS_BY_STEP: Readonly<
	Partial<Record<StepId, readonly string[]>>
> = {
	3: ['character-fields', 'one-paragraph-storyline'],
	8: ['scene-fields', 'scene-events'],
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
