/**
 * The worldbuilding kind registry. A kind is a subtype of the single
 * `worldbuilding` document type, carried in `snowflake-worldbuilding-kind`,
 * rather than a document type of its own: user-defined kinds arrive in a later
 * release and must not require widening a closed union. Everything a kind
 * varies by is data here; localized folder, file and base names stay with the
 * layers that own naming (the path layout and the template copy).
 */

export const WORLDBUILDING_KINDS = ['time', 'location', 'item'] as const;

export type WorldbuildingKind = (typeof WORLDBUILDING_KINDS)[number];

export function isWorldbuildingKind(
	value: unknown,
): value is WorldbuildingKind {
	return (
		typeof value === 'string' &&
		(WORLDBUILDING_KINDS as readonly string[]).includes(value)
	);
}

export interface WorldbuildingKindDefinition {
	id: WorldbuildingKind;
	/** The kind carries `snowflake-time-kind` / `-start` / `-end`. */
	timeFields: boolean;
}

export const WORLDBUILDING_KIND_DEFINITIONS: Readonly<
	Record<WorldbuildingKind, WorldbuildingKindDefinition>
> = {
	time: { id: 'time', timeFields: true },
	location: { id: 'location', timeFields: false },
	item: { id: 'item', timeFields: false },
};

/**
 * The taxonomy and record-label files every entity kind carries in the folder
 * its notes live in. Category backs the `snowflake-category` links; the other
 * two supply the labels record lines link to.
 */
export const DEFINITION_FILE_IDS = [
	'category',
	'world-status',
	'relationship',
] as const;

export type DefinitionFileId = (typeof DEFINITION_FILE_IDS)[number];

export function isDefinitionFileId(
	value: unknown,
): value is DefinitionFileId {
	return (
		typeof value === 'string' &&
		(DEFINITION_FILE_IDS as readonly string[]).includes(value)
	);
}

/**
 * The note every definition node folder holds, without its extension. The
 * folder is what makes the node exist; this file is where its description and
 * anything a later release attaches will live, and the underscore keeps it
 * sorted above the child folders it shares a listing with. No display ever
 * shows this name: links carry the taxonomy path as their alias, and every
 * fallback strips it.
 */
export const DEFINITION_NODE_BASENAME = '_self';

/**
 * Every kind of entity the universal model covers: the two member kinds that
 * predate worldbuilding plus the worldbuilding kinds. Each one owns its own
 * set of definition files, so vocabularies are scoped to the kind an entity
 * is: heading uniqueness only has to hold within one file, and a character's
 * relationship labels are the character kind's, whatever those relationships
 * point at.
 */
export const ENTITY_KINDS = [
	'character',
	'scene',
	...WORLDBUILDING_KINDS,
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];
