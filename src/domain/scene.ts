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

export interface SceneCharacterUsage {
	/** Scene titles whose point of view is this character. */
	pointOfView: string[];
	/** Scene titles listing this character in their cast. */
	cast: string[];
}

/**
 * Which scenes a character is referenced by, split because deleting them costs
 * each kind something different: a cast entry can simply go, while a point of
 * view leaves the scene needing a decision only the author can make. A scene
 * that is both appears in both lists.
 */
export function scenesUsingCharacter(
	scenes: readonly {
		title: string;
		povPath: string | null;
		characters: readonly string[];
	}[],
	characterPath: string,
): SceneCharacterUsage {
	return {
		pointOfView: scenes
			.filter((scene) => scene.povPath === characterPath)
			.map((scene) => scene.title),
		cast: scenes
			.filter((scene) => scene.characters.includes(characterPath))
			.map((scene) => scene.title),
	};
}

/**
 * Whether a stored point of view is one the editor can actually offer: a mode,
 * or a character the project still has. Anything else — most often a character
 * since deleted — has no control to select it, so it must not survive an edit
 * unchallenged.
 */
export function isChoosableScenePov(
	povPath: string,
	characterPaths: readonly string[],
): boolean {
	return isScenePovMode(povPath) || characterPaths.includes(povPath);
}

/** The characters still available to add, in project order. */
export function availableSceneCastMembers<T extends { path: string }>(
	characters: readonly T[],
	cast: readonly string[],
): T[] {
	const selected = new Set(cast);
	return characters.filter((character) => !selected.has(character.path));
}
