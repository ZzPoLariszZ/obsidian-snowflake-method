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
	/**
	 * Written only by the plugin, but as canonical storage rather than a view:
	 * record sections whose content frontmatter cannot hold. The editor keeps
	 * the range read-only, and the reconcile pass must never touch it, because
	 * there is nothing else to regenerate it from.
	 */
	protected?: boolean;
	/**
	 * Left out of fresh notes and inserted the first time it has something to
	 * hold. Implies the absence is a state, so a deferred section is also
	 * `optional`.
	 */
	deferred?: boolean;
	/**
	 * A protected section that is a whole template's body rather than one of
	 * a member's record sections, so the editor's refusal notice points at
	 * the dashboard instead of a member form.
	 */
	templateBody?: boolean;
}

const section = (
	id: string,
	flags: Pick<
		ManagedSectionDescriptor,
		'optional' | 'legacy' | 'generated' | 'protected' | 'deferred' | 'templateBody'
	> = {},
): ManagedSectionDescriptor => ({
	id,
	nameKey: `editor.managedSection.name.${id}`,
	...flags,
});

const recordSection = (id: string): ManagedSectionDescriptor =>
	section(id, { optional: true, protected: true, deferred: true });

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
	// The custom-fields block trails the prose section it reads as part of:
	// each host section is its document's last, so the block sits under that
	// heading, after whatever the author wrote there. Deferred, so it exists
	// only once a form has fields to store; neither generated nor protected,
	// so the author may edit it and the reconcile pass never rewrites it.
	character: [
		section('character-fields', { optional: true, generated: true }),
		recordSection('world-status'),
		recordSection('relationships'),
		section('one-paragraph-storyline'),
		section('character-synopsis'),
		section('character-profile'),
		section('custom-fields', { optional: true, deferred: true }),
	],
	scene: [
		section('scene-fields', { optional: true, generated: true }),
		section('scene-conflict', { optional: true, legacy: true }),
		recordSection('world-status'),
		recordSection('relationships'),
		section('scene-events'),
		section('scene-planning'),
		section('custom-fields', { optional: true, deferred: true }),
	],
	worldbuilding: [
		section('entity-fields', { generated: true }),
		recordSection('world-status'),
		recordSection('relationships'),
		section('entity-notes'),
		section('custom-fields', { optional: true, deferred: true }),
	],
	// A definition node's `_self.md`: the generated block that reads out
	// where the node sits and what it means, and free prose after it.
	definition: [section('definition-fields', { generated: true })],
	// A template note's whole body: canonical storage for the fields it
	// seeds, managed from the dashboard. Its own id, because the protected
	// set is global and `custom-fields` must stay editable in member notes.
	template: [section('template-fields', { protected: true, templateBody: true })],
	draft: [],
	material: [],
	archive: [],
};

export function managedSectionsForDocument(
	documentType: DocumentType,
): readonly ManagedSectionDescriptor[] {
	return MANAGED_SECTIONS_BY_DOCUMENT[documentType];
}

/**
 * The sections a freshly created note carries: everything that is neither
 * legacy nor deferred until first use.
 */
export function templateSectionsForDocument(
	documentType: DocumentType,
): readonly ManagedSectionDescriptor[] {
	return MANAGED_SECTIONS_BY_DOCUMENT[documentType].filter(
		(descriptor) => descriptor.legacy !== true && descriptor.deferred !== true,
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

/**
 * Every id the editor refuses human edits inside: the generated views plus the
 * canonical record sections. What differs between the two is the reconcile
 * pass (views are rewritten from the properties, records never are) and the
 * notice explaining where to edit instead.
 */
export const PROTECTED_SECTION_IDS: ReadonlySet<string> = new Set(
	Object.values(MANAGED_SECTIONS_BY_DOCUMENT).flatMap((sections) =>
		sections
			.filter(
				(descriptor) =>
					descriptor.generated === true || descriptor.protected === true,
			)
			.map((descriptor) => descriptor.id),
	),
);

/**
 * Protected ids that are a template's whole body, for the notice that names
 * the dashboard rather than a member form. Derived, so the next template
 * flavor joins by declaring itself instead of by another string check.
 */
export const TEMPLATE_SECTION_IDS: ReadonlySet<string> = new Set(
	Object.values(MANAGED_SECTIONS_BY_DOCUMENT).flatMap((sections) =>
		sections
			.filter((descriptor) => descriptor.templateBody === true)
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
