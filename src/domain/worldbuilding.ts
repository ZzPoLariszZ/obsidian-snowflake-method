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
 * Any worldbuilding kind a note can carry: a built-in id, or a custom kind's
 * name exactly as the author typed it. Custom ids are user text, so the type
 * is open; what makes one real is the project's registry.
 */
export type WorldbuildingKindId = string;

/**
 * One kind of a project, built-in or authored. The registry entry is the
 * folder name; the id is the folder name without its ordering prefix, which
 * is also what every note of the kind carries.
 */
export interface ProjectWorldbuildingKind {
	id: WorldbuildingKindId;
	/** The folder under the worldbuilding directory, `61_Time` or `64_Faction`. */
	folderName: string;
	custom: boolean;
	/**
	 * How an authored kind presents itself: its icon id and the sentence its
	 * pane stands under. Null where unset — and always null for a built-in,
	 * whose looks belong to the program.
	 */
	icon: string | null;
	description: string | null;
}

/** The kind id a registry folder name spells: the leaf minus its ordering prefix. */
export function kindIdFromFolderName(folderName: string): string {
	return folderName.replace(/^\d+[A-Za-z]?_/u, '');
}

/**
 * The ordering prefixes an authored kind's folder can wear, in the order they
 * are handed out: 64 through 69 after the built-ins, then 6A through 6Z so
 * the family never spills into 70 and the folders above it. Thirty-two kinds
 * is the whole run; a project that reaches 6Z adds no more.
 */
export const CUSTOM_KIND_PREFIXES: readonly string[] = [
	'64',
	'65',
	'66',
	'67',
	'68',
	'69',
	...Array.from({ length: 26 }, (_, at) => `6${String.fromCharCode(65 + at)}`),
];

/**
 * The prefix the next authored kind's folder gets: the first slot in the run
 * no living kind occupies, so a deleted kind's slot is free again the moment
 * it goes. Null only when all thirty-two slots are in use at once — the rail
 * order is the registry's, not the folder number's, so a reclaimed low slot
 * shuffles nothing the author sees.
 */
export function nextCustomKindPrefix(
	kinds: readonly ProjectWorldbuildingKind[],
): string | null {
	const occupied = new Set(
		kinds
			.filter((kind) => kind.custom)
			.map((kind) => kind.folderName.split('_')[0] ?? ''),
	);
	return CUSTOM_KIND_PREFIXES.find((prefix) => !occupied.has(prefix)) ?? null;
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

/**
 * An entity kind by id where the set is open: `character`, `scene`, or any
 * worldbuilding kind of the project at hand, custom ones included. The same
 * open string as a kind id, aliased so a signature says which family of ids
 * it answers for. Code that enumerates a fixed set keeps `EntityKind`.
 */
export type EntityKindId = WorldbuildingKindId;

/** The worldbuilding kinds of a project, as entity kind ids in rail order. */
export function entityKindIds(
	kinds: readonly ProjectWorldbuildingKind[],
): EntityKindId[] {
	return ['character', 'scene', ...kinds.map((kind) => kind.id)];
}
