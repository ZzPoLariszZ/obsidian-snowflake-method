import { describe, expect, it } from 'vitest';

import {
	distributionPath,
	distributionSpans,
	groupByChapter,
	occurrenceOffsets,
} from '../../src/ui/entities-rows';

describe('the mention distribution', () => {
	const order = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];

	it('raises one span over a run of mentioned chapters', () => {
		expect(distributionSpans(order, new Set(['b.md', 'c.md']))).toEqual([
			{ start: 0.2, end: 0.6 },
		]);
	});

	it('keeps separated chapters as separate pulses', () => {
		expect(distributionSpans(order, new Set(['a.md', 'c.md', 'e.md']))).toEqual(
			[
				{ start: 0, end: 0.2 },
				{ start: 0.4, end: 0.6 },
				{ start: 0.8, end: 1 },
			],
		);
	});

	it('closes a run that reaches the last chapter', () => {
		expect(distributionSpans(order, new Set(['d.md', 'e.md']))).toEqual([
			{ start: 0.6, end: 1 },
		]);
	});

	it('draws nothing off an empty book or an unmentioned one', () => {
		expect(distributionSpans([], new Set(['a.md']))).toEqual([]);
		expect(distributionSpans(order, new Set())).toEqual([]);
		expect(distributionSpans(order, new Set(['x.md']))).toEqual([]);
	});

	it('writes the wave on a baseline that leads in and out', () => {
		expect(distributionPath([], 100, 12)).toBe('M 0 10.5 H 100');
		expect(
			distributionPath([{ start: 0.2, end: 0.6 }], 100, 12),
		).toBe('M 0 10.5 H 22.4 V 1.5 H 59.2 V 10.5 H 100');
		expect(distributionPath([{ start: 0, end: 1 }], 100, 12)).toBe(
			'M 0 10.5 H 4 V 1.5 H 96 V 10.5 H 100',
		);
	});
});

describe('grouping by chapter', () => {
	it('gathers in first-seen order and keeps each group ordered', () => {
		const grouped = groupByChapter([
			{ path: 'a.md', from: 1 },
			{ path: 'a.md', from: 9 },
			{ path: 'c.md', from: 2 },
			{ path: 'a.md', from: 20 },
		]);
		expect(grouped.map((group) => group.path)).toEqual(['a.md', 'c.md']);
		expect(grouped[0]?.occurrences.map((entry) => entry.from)).toEqual([
			1, 9, 20,
		]);
	});

	it('groups nothing as nothing', () => {
		expect(groupByChapter([])).toEqual([]);
	});
});

describe('walking an ordinal back to its offsets', () => {
	it('lands on the nth same-text occurrence, zero-based', () => {
		expect(occurrenceOffsets('雾里有雾。', '雾', 0)).toEqual({
			from: 0,
			to: 1,
		});
		expect(occurrenceOffsets('雾里有雾。', '雾', 1)).toEqual({
			from: 3,
			to: 4,
		});
	});

	it('counts without overlaps, the way the matcher hit', () => {
		expect(occurrenceOffsets('aaaa', 'aa', 1)).toEqual({ from: 2, to: 4 });
	});

	it('answers nothing where the ordinal no longer lands', () => {
		expect(occurrenceOffsets('雾里有雾。', '雾', 2)).toBeNull();
		expect(occurrenceOffsets('fog', 'rope', 0)).toBeNull();
		expect(occurrenceOffsets('fog', '', 0)).toBeNull();
	});
});
