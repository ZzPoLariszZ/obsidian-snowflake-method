import { describe, expect, it } from 'vitest';

import {
	RANK_GAP,
	moveRanked,
	normalizeRanks,
	rankBetween,
	repairRanks,
	sortByRank,
} from '../../src/domain';

interface TestRecord {
	id: string;
	rank: number;
	title: string;
}

function record(id: string, rank: number): TestRecord {
	return { id, rank, title: id.toUpperCase() };
}

describe('ranks', () => {
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
		const records = [record('c', 20), record('b', 10), record('a', 10)];
		expect(sortByRank(records).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
	});

	it('normally changes only the moved record rank', () => {
		const a = record('a', 1024);
		const b = record('b', 2048);
		const c = record('c', 3072);
		const moved = moveRanked([a, b, c], 'c', 1);

		expect(moved.map(({ id }) => id)).toEqual(['a', 'c', 'b']);
		expect(moved.map(({ rank }) => rank)).toEqual([1024, 1536, 2048]);
		expect(moved[0]).toBe(a);
		expect(moved[2]).toBe(b);
		expect(moved[1]).not.toBe(c);
	});

	it('normalizes the full order when a gap is exhausted', () => {
		const moved = moveRanked(
			[record('a', 1), record('b', 2), record('c', 3)],
			'c',
			1,
		);
		expect(moved.map(({ id }) => id)).toEqual(['a', 'c', 'b']);
		expect(moved.map(({ rank }) => rank)).toEqual([1024, 2048, 3072]);
	});

	it('normalizes supplied order and can repair existing rank order', () => {
		const supplied = [record('c', 30), record('a', 10), record('b', 20)];
		expect(normalizeRanks(supplied).map(({ id }) => id)).toEqual([
			'c',
			'a',
			'b',
		]);
		expect(repairRanks(supplied).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
	});

	it('rejects invalid moves and duplicate ids', () => {
		const records = [record('a', 1), record('b', 2)];
		expect(() => moveRanked(records, 'missing', 0)).toThrow(/Unknown record/u);
		expect(() => moveRanked(records, 'a', -1)).toThrow(RangeError);
		expect(() => moveRanked([record('a', 1), record('a', 2)], 'a', 1)).toThrow(
			/Duplicate/u,
		);
	});
});
