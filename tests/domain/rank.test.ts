import { describe, expect, it } from 'vitest';

import {
	RANK_GAP,
	moveScene,
	normalizeSceneRanks,
	rankBetween,
	repairSceneRanks,
	sortScenesByRank,
} from '../../src/domain';

interface TestScene {
	sceneId: string;
	rank: number;
	title: string;
}

function scene(sceneId: string, rank: number): TestScene {
	return { sceneId, rank, title: sceneId.toUpperCase() };
}

describe('scene ranks', () => {
	it('allocates interval ranks at the beginning, middle, and end', () => {
		expect(rankBetween()).toBe(RANK_GAP);
		expect(rankBetween(undefined, 2048)).toBe(1024);
		expect(rankBetween(1024, 2048)).toBe(1536);
		expect(rankBetween(2048)).toBe(3072);
	});

	it('signals when there is no safe integer gap', () => {
		expect(rankBetween(1, 2)).toBeNull();
		expect(rankBetween(2, 1)).toBeNull();
		expect(rankBetween(Number.MAX_SAFE_INTEGER)).toBeNull();
	});

	it('sorts by rank with a deterministic id tie-breaker', () => {
		const scenes = [scene('c', 20), scene('b', 10), scene('a', 10)];
		expect(sortScenesByRank(scenes).map(({ sceneId }) => sceneId)).toEqual([
			'a',
			'b',
			'c',
		]);
	});

	it('normally changes only the moved scene rank', () => {
		const a = scene('a', 1024);
		const b = scene('b', 2048);
		const c = scene('c', 3072);
		const moved = moveScene([a, b, c], 'c', 1);

		expect(moved.map(({ sceneId }) => sceneId)).toEqual(['a', 'c', 'b']);
		expect(moved.map(({ rank }) => rank)).toEqual([1024, 1536, 2048]);
		expect(moved[0]).toBe(a);
		expect(moved[2]).toBe(b);
		expect(moved[1]).not.toBe(c);
	});

	it('normalizes the full order when a gap is exhausted', () => {
		const moved = moveScene([scene('a', 1), scene('b', 2), scene('c', 3)], 'c', 1);
		expect(moved.map(({ sceneId }) => sceneId)).toEqual(['a', 'c', 'b']);
		expect(moved.map(({ rank }) => rank)).toEqual([1024, 2048, 3072]);
	});

	it('normalizes supplied order and can repair existing rank order', () => {
		const supplied = [scene('c', 30), scene('a', 10), scene('b', 20)];
		expect(normalizeSceneRanks(supplied).map(({ sceneId }) => sceneId)).toEqual([
			'c',
			'a',
			'b',
		]);
		expect(repairSceneRanks(supplied).map(({ sceneId }) => sceneId)).toEqual([
			'a',
			'b',
			'c',
		]);
	});

	it('rejects invalid moves and duplicate ids', () => {
		const scenes = [scene('a', 1), scene('b', 2)];
		expect(() => moveScene(scenes, 'missing', 0)).toThrow(/Unknown scene/u);
		expect(() => moveScene(scenes, 'a', -1)).toThrow(RangeError);
		expect(() => moveScene([scene('a', 1), scene('a', 2)], 'a', 1)).toThrow(
			/Duplicate/u,
		);
	});
});
