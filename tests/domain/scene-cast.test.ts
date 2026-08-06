import { describe, expect, it } from 'vitest';

import {
	addSceneCastMember,
	availableSceneCastMembers,
	normalizeSceneCast,
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
