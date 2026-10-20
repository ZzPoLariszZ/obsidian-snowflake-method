/**
 * The kinds of part a project can take from another: the design notes and
 * what hangs off them, the manuscript, and the tool records. Named apart
 * from the import model so the provenance document can read them without
 * reading the model.
 */

export const IMPORT_PART_KINDS = [
	'step',
	'character',
	'scene',
	'worldbuilding',
	'vocabulary',
	'custom-field-template',
	'picture',
	'chapter',
	'task',
	'foreshadowing',
	'revision',
	'sticky-note',
	'freeform-view',
	'timeline',
	'beat-sheet',
	'beat-sheet-template',
] as const;

export type ImportPartKind = (typeof IMPORT_PART_KINDS)[number];

/**
 * The kinds a later run compares by design: these are updated from their
 * source where the copy was left alone. Every other kind is brought over
 * once and remembered, so a second run neither doubles nor rewrites it.
 */
export const IMPORT_DESIGN_KINDS: ReadonlySet<ImportPartKind> = new Set<ImportPartKind>([
	'step',
	'character',
	'scene',
	'worldbuilding',
	'vocabulary',
	'custom-field-template',
]);
