/**
 * The mark each kind of note goes by, stated once for every surface that
 * shows one: the dashboard's rail and its tables, and the cards a canvas
 * deals. A built-in wears its own, an authored kind the one its author chose.
 */

import { isWorldbuildingKind, type ProjectWorldbuildingKind } from '../domain';

const WORLDBUILDING_KIND_ICONS: Record<'time' | 'location' | 'item', string> = {
	time: 'clock',
	location: 'map-pin',
	item: 'gem',
};

/** Every custom kind wears the one icon; the built-ins keep their own. */
const CUSTOM_KIND_ICON = 'shapes';

const ENTITY_KIND_ICONS: Record<
	'character' | 'scene' | 'time' | 'location' | 'item',
	string
> = {
	character: 'user',
	scene: 'clapperboard',
	...WORLDBUILDING_KIND_ICONS,
};

/**
 * The face a kind wears wherever it appears: a built-in's own icon, an
 * authored kind's chosen one, and the generic shape only when nothing chose.
 */
export function kindIcon(
	model: { worldbuildingKinds: readonly ProjectWorldbuildingKind[] },
	kind: string,
): string {
	if (kind === 'character' || kind === 'scene' || isWorldbuildingKind(kind)) {
		return ENTITY_KIND_ICONS[kind];
	}
	const descriptor = model.worldbuildingKinds.find(
		(candidate) => candidate.id === kind,
	);
	return descriptor?.icon ?? CUSTOM_KIND_ICON;
}
