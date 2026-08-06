import { describe, expect, it } from 'vitest';

import {
	addSceneCastMember,
	availableSceneCastMembers,
	isChoosableScenePov,
	normalizeSceneCast,
	scenesUsingCharacter,
} from '../../src/domain/scene';

const order = ['a.md', 'b.md', 'c.md', 'd.md'];

describe('adding a character to a scene cast', () => {
	it('keeps the cast in project order, not pick order', () => {
		let cast = addSceneCastMember(order, [], 'c.md');
		cast = addSceneCastMember(order, cast, 'a.md');
		cast = addSceneCastMember(order, cast, 'd.md');
		expect(cast).toEqual(['a.md', 'c.md', 'd.md']);
	});

	it('refuses a duplicate rather than listing a character twice', () => {
		const cast = addSceneCastMember(order, ['b.md'], 'b.md');
		expect(cast).toEqual(['b.md']);
	});

	it('drops cast entries the project no longer has', () => {
		const cast = addSceneCastMember(order, ['deleted.md', 'b.md'], 'a.md');
		expect(cast).toEqual(['a.md', 'b.md']);
	});
});

describe('characters still available to add', () => {
	const characters = order.map((path) => ({ path, name: path }));

	it('leaves out the ones already cast', () => {
		expect(
			availableSceneCastMembers(characters, ['b.md', 'd.md']).map(
				(character) => character.path,
			),
		).toEqual(['a.md', 'c.md']);
	});

	it('offers everything when the cast is empty', () => {
		expect(availableSceneCastMembers(characters, [])).toHaveLength(4);
	});

	it('offers nothing once every character is cast', () => {
		expect(availableSceneCastMembers(characters, order)).toEqual([]);
	});
});

describe('normalizing a saved cast', () => {
	it('drops a character the project no longer has', () => {
		expect(normalizeSceneCast(order, ['b.md', 'deleted.md'])).toEqual(['b.md']);
	});

	it('reorders a cast saved in pick order', () => {
		expect(normalizeSceneCast(order, ['d.md', 'a.md'])).toEqual([
			'a.md',
			'd.md',
		]);
	});

	it('collapses a duplicate that reached the file', () => {
		expect(normalizeSceneCast(order, ['c.md', 'c.md'])).toEqual(['c.md']);
	});
});

describe('naming a point of view whose character is gone', () => {
	// Mirrors the fallback in main.ts: with no character to name, the note's own
	// base name is the only name left, and the table shows ??? in its place.
	const displayName = (path: string): string =>
		(path.split('/').pop() ?? path).replace(/\.md$/u, '');

	it('falls back to the note name rather than the whole path', () => {
		expect(displayName('Demo/20_Character/BoC.md')).toBe('BoC');
	});

	it('handles a path with no folder', () => {
		expect(displayName('BoC.md')).toBe('BoC');
	});

	it('leaves a name that is not a markdown path alone', () => {
		expect(displayName('omniscient')).toBe('omniscient');
	});
});

describe('whether a stored point of view can still be chosen', () => {
	it('accepts the two point-of-view modes', () => {
		expect(isChoosableScenePov('omniscient', [])).toBe(true);
		expect(isChoosableScenePov('multiple', [])).toBe(true);
	});

	it('accepts a character the project still has', () => {
		expect(isChoosableScenePov('b.md', order)).toBe(true);
	});

	// The bug this guards: a <select> cannot display an option it does not have,
	// so the field looked empty while still holding -- and saving -- the old path.
	it('rejects a character the project no longer has', () => {
		expect(isChoosableScenePov('deleted.md', order)).toBe(false);
	});

	it('rejects an empty point of view, so saving is blocked until one is picked', () => {
		expect(isChoosableScenePov('', order)).toBe(false);
	});
});

describe('which scenes reference a character', () => {
	const scenes = [
		{ title: 'Arrival', povPath: 'a.md', characters: ['a.md', 'b.md'] },
		{ title: 'Departure', povPath: 'b.md', characters: ['a.md'] },
		{ title: 'Interlude', povPath: 'omniscient', characters: [] },
	];

	it('splits point of view from cast, because each costs something different', () => {
		expect(scenesUsingCharacter(scenes, 'a.md')).toEqual({
			pointOfView: ['Arrival'],
			cast: ['Arrival', 'Departure'],
		});
	});

	// A scene that is both loses its cast entry and needs a new point of view,
	// so it has to be named under both headings rather than counted once.
	it('lists a scene under both headings when it is both', () => {
		const usage = scenesUsingCharacter(scenes, 'a.md');
		expect(usage.pointOfView).toContain('Arrival');
		expect(usage.cast).toContain('Arrival');
	});

	it('reports nothing for a character no scene mentions', () => {
		expect(scenesUsingCharacter(scenes, 'unused.md')).toEqual({
			pointOfView: [],
			cast: [],
		});
	});

	it('does not mistake a point-of-view mode for a character', () => {
		expect(scenesUsingCharacter(scenes, 'omniscient').cast).toEqual([]);
	});
});
