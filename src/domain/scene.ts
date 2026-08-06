export const SCENE_POV_OMNISCIENT = 'omniscient';
export const SCENE_POV_MULTIPLE = 'multiple';

export type ScenePovMode =
	| typeof SCENE_POV_OMNISCIENT
	| typeof SCENE_POV_MULTIPLE;

export function isScenePovMode(value: string): value is ScenePovMode {
	return value === SCENE_POV_OMNISCIENT || value === SCENE_POV_MULTIPLE;
}

/**
 * Puts a scene's cast in the order the project maintains rather than the order
 * the author happened to pick them in, and drops both duplicates and entries
 * missing from `order` — the latter name a character the project no longer has,
 * which the editor can neither show nor remove.
 */
export function normalizeSceneCast(
	order: readonly string[],
	cast: readonly string[],
): string[] {
	const selected = new Set(cast);
	return order.filter((path) => selected.has(path));
}

/** Adds one character to a scene's cast, refusing a duplicate. */
export function addSceneCastMember(
	order: readonly string[],
	cast: readonly string[],
	add: string,
): string[] {
	return normalizeSceneCast(order, [...cast, add]);
}

/** The characters still available to add, in project order. */
export function availableSceneCastMembers<T extends { path: string }>(
	characters: readonly T[],
	cast: readonly string[],
): T[] {
	const selected = new Set(cast);
	return characters.filter((character) => !selected.has(character.path));
}
