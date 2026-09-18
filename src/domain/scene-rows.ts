/**
 * A row of scenes: the words an author writes beside a place in a story's
 * structure, and the scenes placed on them. A timeline keeps such rows under
 * each of its times and a beat sheet under each of its beats, and both keep
 * them the same way, so what a row is, how a stored one is read, and how an
 * ordered list of ids or rows takes a newcomer are stated here once. Nothing
 * here knows which document the row stands in.
 */

export const SCENE_PRESENTATIONS = ['flat', 'stack'] as const;
export type ScenePresentation = (typeof SCENE_PRESENTATIONS)[number];

export function isScenePresentation(value: unknown): value is ScenePresentation {
	return (SCENE_PRESENTATIONS as readonly unknown[]).includes(value);
}

/** One sub-description, with the scenes placed on it. */
export interface SceneRow {
	readonly id: string;
	/** What happens, changes or holds there; may be empty. */
	readonly text: string;
	/** Scene ids in the row's own order; a scene stands once in the whole lane the row belongs to. */
	readonly scenes: readonly string[];
}

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

/** The non-empty strings of a list, each once, in the order first met. */
export function uniqueIds(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const value of values) {
		if (!nonEmptyString(value) || seen.has(value)) continue;
		seen.add(value);
		kept.push(value);
	}
	return kept;
}

export const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * One row read leniently: it needs an id its lane has not used, its text
 * reads as empty where it is not a string, and a scene placed earlier in the
 * lane keeps its first place. The two sets are the lane's, filled as its rows
 * are read.
 */
export function readSceneRow(
	value: unknown,
	rowIds: Set<string>,
	placed: Set<string>,
): SceneRow | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || rowIds.has(entry.id)) return null;
	rowIds.add(entry.id);
	const scenes: string[] = [];
	if (Array.isArray(entry.scenes)) {
		for (const scene of entry.scenes) {
			if (!nonEmptyString(scene) || placed.has(scene)) continue;
			placed.add(scene);
			scenes.push(scene);
		}
	}
	return {
		id: entry.id,
		text: typeof entry.text === 'string' ? entry.text : '',
		scenes,
	};
}

/**
 * A list with one entry moved in front of another, or to the end when no
 * anchor is named or the one named has gone since the surface was painted.
 * Null where the entry is not in the list, or already stands there.
 */
export function movedBefore(
	list: readonly string[],
	id: string,
	beforeId: string | null,
): string[] | null {
	if (!list.includes(id) || beforeId === id) return null;
	const rest = list.filter((candidate) => candidate !== id);
	const at = beforeId === null ? -1 : rest.indexOf(beforeId);
	const next =
		at === -1 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
	return sameIds(next, list) ? null : next;
}

/** A list with one entry put before the anchor, or at the end when the anchor is not among them. */
export function insertedBefore<T extends { readonly id: string }>(
	list: readonly T[],
	item: T,
	beforeId: string | null,
): T[] {
	const at = beforeId === null ? -1 : list.findIndex((candidate) => candidate.id === beforeId);
	return at === -1 ? [...list, item] : [...list.slice(0, at), item, ...list.slice(at)];
}

/**
 * A row's scenes with one put before another of them, or at the end. The
 * scenes handed in no longer hold the one placed; an anchor that is the
 * scene itself reads as none.
 */
export function scenesWith(
	scenes: readonly string[],
	sceneId: string,
	beforeSceneId: string | null,
): string[] {
	const anchor = beforeSceneId === sceneId ? null : beforeSceneId;
	const at = anchor === null ? -1 : scenes.indexOf(anchor);
	return at === -1
		? [...scenes, sceneId]
		: [...scenes.slice(0, at), sceneId, ...scenes.slice(at)];
}
