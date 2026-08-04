export const SCENE_POV_OMNISCIENT = 'omniscient';
export const SCENE_POV_MULTIPLE = 'multiple';

export type ScenePovMode =
	| typeof SCENE_POV_OMNISCIENT
	| typeof SCENE_POV_MULTIPLE;

export function isScenePovMode(value: string): value is ScenePovMode {
	return value === SCENE_POV_OMNISCIENT || value === SCENE_POV_MULTIPLE;
}
