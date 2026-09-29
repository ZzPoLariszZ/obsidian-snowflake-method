import { describe, expect, it } from 'vitest';

import type { ProjectWorldbuildingKind } from '../../src/domain';
import { kindIcon } from '../../src/ui/kind-icon';

const kind = (
	id: string,
	custom: boolean,
	icon: string | null = null,
): ProjectWorldbuildingKind => ({
	id,
	folderName: `64_${id}`,
	custom,
	icon,
	description: null,
});

const model = {
	worldbuildingKinds: [
		kind('time', false),
		kind('location', false),
		kind('item', false),
		kind('Faction', true, 'swords'),
		kind('Rumour', true),
	],
};

describe('kindIcon', () => {
	it('gives the two member kinds and the three built-ins their own marks', () => {
		expect(kindIcon(model, 'character')).toBe('user');
		expect(kindIcon(model, 'scene')).toBe('clapperboard');
		expect(kindIcon(model, 'time')).toBe('clock');
		expect(kindIcon(model, 'location')).toBe('map-pin');
		expect(kindIcon(model, 'item')).toBe('gem');
	});

	it('gives an authored kind the icon its author chose', () => {
		expect(kindIcon(model, 'Faction')).toBe('swords');
	});

	it('falls back to the one shape for a kind that chose none, or that the project lacks', () => {
		expect(kindIcon(model, 'Rumour')).toBe('shapes');
		expect(kindIcon(model, 'Gone')).toBe('shapes');
		expect(kindIcon({ worldbuildingKinds: [] }, 'Faction')).toBe('shapes');
	});

	it('never lets an authored kind of a built-in name take the built-in mark away', () => {
		expect(
			kindIcon({ worldbuildingKinds: [kind('time', true, 'hourglass')] }, 'time'),
		).toBe('clock');
	});
});
