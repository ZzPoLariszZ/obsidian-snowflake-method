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

/**
 * Built-in single-record compound properties. Each is one line in a note's
 * Details section: a value that may mix text and links, which frontmatter
 * cannot hold. Labels are built into the plugin copy, not user taxonomy.
 */
export const DETAILS_PROPERTY_IDS = ['age', 'owner'] as const;

export type DetailsPropertyId = (typeof DETAILS_PROPERTY_IDS)[number];

export interface WorldbuildingKindDefinition {
	id: WorldbuildingKind;
	/** The kind carries `snowflake-time-kind` / `-start` / `-end`. */
	timeFields: boolean;
	/** Single-record properties this kind's Details section holds. */
	detailsProperties: readonly DetailsPropertyId[];
}

export const WORLDBUILDING_KIND_DEFINITIONS: Readonly<
	Record<WorldbuildingKind, WorldbuildingKindDefinition>
> = {
	time: { id: 'time', timeFields: true, detailsProperties: [] },
	location: { id: 'location', timeFields: false, detailsProperties: [] },
	item: { id: 'item', timeFields: false, detailsProperties: ['owner'] },
};

/** Characters keep their own single-record property outside the registry. */
export const CHARACTER_DETAILS_PROPERTIES: readonly DetailsPropertyId[] = [
	'age',
];

/**
 * The taxonomy and record-label files a project carries at its worldbuilding
 * root. Category backs the `snowflake-category` links; the other two supply
 * the labels record lines link to.
 */
export const DEFINITION_FILE_IDS = [
	'category',
	'world-status',
	'relationship',
] as const;

export type DefinitionFileId = (typeof DEFINITION_FILE_IDS)[number];

/** Which definition file a record section draws its labels from. */
export const RECORD_SECTION_DEFINITION_FILE: Readonly<
	Record<string, DefinitionFileId>
> = {
	'world-status': 'world-status',
	relationships: 'relationship',
};

/**
 * Every member note carries categories under a namespace named after what the
 * note is, `Character/Race/Elf` and never a bare `Race/Elf`, so one Category
 * file can classify every kind of entity without collisions of meaning.
 */
export type CategoryNamespaceId = 'character' | 'scene' | WorldbuildingKind;

export const CATEGORY_NAMESPACE_IDS: readonly CategoryNamespaceId[] = [
	'character',
	'scene',
	...WORLDBUILDING_KINDS,
];
