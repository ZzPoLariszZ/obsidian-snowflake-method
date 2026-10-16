import {
	defaultEntityGraphState,
	readEntityGraphState,
	serializeEntityGraphState,
	type EntityGraphState,
} from './relationship-graph-state';

/**
 * The relationship graph's file: what the scenes-and-manuscript view last
 * set on Obsidian's own graph, and how the entity view is filtered, coloured,
 * drawn and left. One document per project, kept by the document store
 * (`services/json-document-store.ts`) under the visualization chain, read
 * leniently: a part this build cannot read falls back to its default, a
 * top-level key it does not know is carried through every write as it came.
 *
 * Nothing about a relationship itself is kept here. The lines of the entity
 * view are the record lines in the notes, and the lines of the native view
 * are the notes' manuscript links, so this file holds only how they are
 * looked at.
 */

/**
 * The options Obsidian's graph keeps, as its data engine hands them out and
 * takes them back, and as they stand in `.obsidian/graph.json`. Read by
 * shape, not by name: the only fields read into are the ones the project
 * preset writes, and the rest ride along as the engine gave them.
 */
export interface NativeGraphOptions {
	readonly search: string;
	readonly showTags: boolean;
	readonly showAttachments: boolean;
	readonly hideUnresolved: boolean;
	readonly showOrphans: boolean;
	readonly colorGroups: readonly NativeGraphColorGroup[];
	readonly showArrow: boolean;
	readonly textFadeMultiplier: number;
	readonly nodeSizeMultiplier: number;
	readonly lineSizeMultiplier: number;
	readonly centerStrength: number;
	readonly repelStrength: number;
	readonly linkStrength: number;
	readonly linkDistance: number;
	/** The zoom, which the engine applies on set; absent in a preset, so the graph fits itself. */
	readonly scale?: number;
	/** Whether the controls panel is folded shut. */
	readonly close?: boolean;
	/** The four `collapse-*` flags and anything newer, kept as given. */
	readonly [extra: string]: unknown;
}

export interface NativeGraphColorGroup {
	readonly query: string;
	/** The engine's colour: an alpha and a packed `0xRRGGBB`. */
	readonly color: { readonly a: number; readonly rgb: number };
}

/** The native options the scenes-and-manuscript graph was left with, and for which project root. */
export interface SceneManuscriptGraphMemory {
	readonly options: NativeGraphOptions;
	/** The project root the `path:` filters were written for; a renamed root is re-prefixed on the next open. */
	readonly rootPath: string;
	/** When the options were taken from the graph, in epoch milliseconds. */
	readonly updatedAt: number;
}

export interface RelationshipGraphDocument {
	readonly sceneManuscript: SceneManuscriptGraphMemory | null;
	readonly entities: EntityGraphState;
	/** Top-level keys this build does not know, written back as they came. */
	readonly strays: Readonly<Record<string, unknown>>;
}

const KNOWN_KEYS = new Set(['schemaVersion', 'sceneManuscript', 'entities']);

export function defaultRelationshipGraphDocument(): RelationshipGraphDocument {
	return { sceneManuscript: null, entities: defaultEntityGraphState(), strays: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const readColorGroup = (value: unknown): NativeGraphColorGroup | null => {
	if (!isRecord(value) || typeof value.query !== 'string' || !isRecord(value.color)) return null;
	const { a, rgb } = value.color;
	if (!isFiniteNumber(a) || !isFiniteNumber(rgb)) return null;
	return { query: value.query, color: { a, rgb } };
};

/**
 * The engine's options read by shape. The fields the preset sets must each
 * be there and of their type, or the whole is not a set of options; a colour
 * group that will not read is dropped rather than failing the rest, and
 * every other key is kept as it came.
 */
export function readNativeGraphOptions(value: unknown): NativeGraphOptions | null {
	if (!isRecord(value)) return null;
	const booleans = ['showTags', 'showAttachments', 'hideUnresolved', 'showOrphans', 'showArrow'] as const;
	const numbers = [
		'textFadeMultiplier',
		'nodeSizeMultiplier',
		'lineSizeMultiplier',
		'centerStrength',
		'repelStrength',
		'linkStrength',
		'linkDistance',
	] as const;
	if (typeof value.search !== 'string') return null;
	if (!booleans.every((key) => typeof value[key] === 'boolean')) return null;
	if (!numbers.every((key) => isFiniteNumber(value[key]))) return null;
	if (!Array.isArray(value.colorGroups)) return null;
	const colorGroups = value.colorGroups
		.map(readColorGroup)
		.filter((group): group is NativeGraphColorGroup => group !== null);
	const extras: Record<string, unknown> = {};
	for (const [key, extra] of Object.entries(value)) {
		if (key === 'search' || key === 'colorGroups') continue;
		if ((booleans as readonly string[]).includes(key) || (numbers as readonly string[]).includes(key)) continue;
		if (key === 'scale' && !isFiniteNumber(extra)) continue;
		if (key === 'close' && typeof extra !== 'boolean') continue;
		extras[key] = extra;
	}
	return {
		...extras,
		search: value.search,
		showTags: value.showTags as boolean,
		showAttachments: value.showAttachments as boolean,
		hideUnresolved: value.hideUnresolved as boolean,
		showOrphans: value.showOrphans as boolean,
		colorGroups,
		showArrow: value.showArrow as boolean,
		textFadeMultiplier: value.textFadeMultiplier as number,
		nodeSizeMultiplier: value.nodeSizeMultiplier as number,
		lineSizeMultiplier: value.lineSizeMultiplier as number,
		centerStrength: value.centerStrength as number,
		repelStrength: value.repelStrength as number,
		linkStrength: value.linkStrength as number,
		linkDistance: value.linkDistance as number,
	};
}

const readSceneManuscript = (value: unknown): SceneManuscriptGraphMemory | null => {
	if (!isRecord(value)) return null;
	const options = readNativeGraphOptions(value.options);
	if (options === null || typeof value.rootPath !== 'string') return null;
	return {
		options,
		rootPath: value.rootPath,
		updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : 0,
	};
};

/**
 * The file's object read into a document. Unlike the record documents, there
 * is no entry here that could fail on its own and be set aside: a part that
 * will not read is simply its default, so the only object that is not this
 * document at all is one that is not an object.
 */
export function readRelationshipGraphDocument(
	file: Record<string, unknown>,
): RelationshipGraphDocument | null {
	const strays: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(file)) {
		if (!KNOWN_KEYS.has(key)) strays[key] = value;
	}
	return {
		sceneManuscript: readSceneManuscript(file.sceneManuscript),
		entities: readEntityGraphState(file.entities),
		strays,
	};
}

/** The object written under the schema line: the known parts first, the strays after. */
export function serializeRelationshipGraphDocument(
	held: RelationshipGraphDocument,
): Record<string, unknown> {
	return {
		sceneManuscript:
			held.sceneManuscript === null
				? null
				: {
						options: held.sceneManuscript.options,
						rootPath: held.sceneManuscript.rootPath,
						updatedAt: held.sceneManuscript.updatedAt,
					},
		entities: serializeEntityGraphState(held.entities),
		...held.strays,
	};
}

// --- changes -------------------------------------------------------------------

/** The native options remembered for a root, or null where nothing changed. */
export function rememberSceneManuscriptOptions(
	held: RelationshipGraphDocument,
	options: NativeGraphOptions,
	rootPath: string,
	now: number,
): RelationshipGraphDocument | null {
	const kept = held.sceneManuscript;
	if (
		kept !== null &&
		kept.rootPath === rootPath &&
		JSON.stringify(kept.options) === JSON.stringify(options)
	) {
		return null;
	}
	return { ...held, sceneManuscript: { options, rootPath, updatedAt: now } };
}

/** The memory let go, so the next open builds the project's preset again; null where there was none. */
export function forgetSceneManuscriptOptions(
	held: RelationshipGraphDocument,
): RelationshipGraphDocument | null {
	if (held.sceneManuscript === null) return null;
	return { ...held, sceneManuscript: null };
}
