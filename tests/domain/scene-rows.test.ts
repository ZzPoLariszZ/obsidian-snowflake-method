import { describe, expect, it } from 'vitest';

import {
	SCENE_PRESENTATIONS,
	insertedBefore,
	isScenePresentation,
	movedBefore,
	readSceneRow,
	sameIds,
	scenesWith,
	uniqueIds,
	type SceneRow,
} from '../../src/domain';

const row = (id: string, text = '', scenes: readonly string[] = []): SceneRow => ({ id, text, scenes });

describe('how scenes are shown', () => {
	it('knows flat and stack, and nothing else', () => {
		expect([...SCENE_PRESENTATIONS]).toEqual(['flat', 'stack']);
		expect(isScenePresentation('flat')).toBe(true);
		expect(isScenePresentation('stack')).toBe(true);
		expect(isScenePresentation('pile')).toBe(false);
		expect(isScenePresentation(null)).toBe(false);
	});
});

describe('reading a stored row', () => {
	it('needs an id the lane has not used, and remembers the one it took', () => {
		const rowIds = new Set<string>(['taken']);
		const placed = new Set<string>();
		expect(readSceneRow(null, rowIds, placed)).toBeNull();
		expect(readSceneRow('row', rowIds, placed)).toBeNull();
		expect(readSceneRow({ text: 'No id' }, rowIds, placed)).toBeNull();
		expect(readSceneRow({ id: '' }, rowIds, placed)).toBeNull();
		expect(readSceneRow({ id: 'taken', text: 'A twin' }, rowIds, placed)).toBeNull();
		expect(readSceneRow({ id: 'r1', text: 'Arrives' }, rowIds, placed)).toEqual(row('r1', 'Arrives'));
		expect(rowIds.has('r1')).toBe(true);
		// The id it took is taken for the next row the lane reads.
		expect(readSceneRow({ id: 'r1', text: 'Again' }, rowIds, placed)).toBeNull();
	});

	it('reads words that are not a string as none, and scenes that are not a list as none', () => {
		expect(readSceneRow({ id: 'r1', text: 7, scenes: 'scene-1' }, new Set(), new Set())).toEqual(row('r1'));
	});

	it('keeps a scene where the lane first placed it, and skips what is not a scene id', () => {
		const rowIds = new Set<string>();
		const placed = new Set<string>(['scene-1']);
		expect(
			readSceneRow({ id: 'r1', text: '', scenes: ['scene-1', 'scene-2', '', 3, 'scene-2', 'scene-3'] }, rowIds, placed),
		).toEqual(row('r1', '', ['scene-2', 'scene-3']));
		expect([...placed]).toEqual(['scene-1', 'scene-2', 'scene-3']);
	});
});

describe('lists of ids', () => {
	it('keeps the non-empty strings of a list, each once, in the order first met', () => {
		expect(uniqueIds(['b', 'a', 'b', '', 4, null, 'c', 'a'])).toEqual(['b', 'a', 'c']);
		expect(uniqueIds('a')).toEqual([]);
		expect(uniqueIds(undefined)).toEqual([]);
	});

	it('tells two lists alike by their entries in order', () => {
		expect(sameIds([], [])).toBe(true);
		expect(sameIds(['a', 'b'], ['a', 'b'])).toBe(true);
		expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(false);
		expect(sameIds(['a'], ['a', 'b'])).toBe(false);
	});

	it('moves an entry before another, or to the end when no anchor is named or the one named has gone', () => {
		expect(movedBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
		expect(movedBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
		expect(movedBefore(['a', 'b', 'c'], 'a', 'gone')).toEqual(['b', 'c', 'a']);
	});

	it('answers null for an entry the list lacks, an anchor that is the entry, and a move that moves nothing', () => {
		expect(movedBefore(['a', 'b'], 'x', 'a')).toBeNull();
		expect(movedBefore(['a', 'b'], 'a', 'a')).toBeNull();
		expect(movedBefore(['a', 'b', 'c'], 'a', 'b')).toBeNull();
		expect(movedBefore(['a', 'b', 'c'], 'c', null)).toBeNull();
	});
});

describe('putting a newcomer among the rest', () => {
	it('puts a row before the anchor, or at the end when the anchor is not among them', () => {
		const rows = [row('r1'), row('r2')];
		const added = row('r3');
		expect(insertedBefore(rows, added, 'r2').map((entry) => entry.id)).toEqual(['r1', 'r3', 'r2']);
		expect(insertedBefore(rows, added, null).map((entry) => entry.id)).toEqual(['r1', 'r2', 'r3']);
		expect(insertedBefore(rows, added, 'gone').map((entry) => entry.id)).toEqual(['r1', 'r2', 'r3']);
		expect(insertedBefore([], added, 'r1')).toEqual([added]);
		// The list handed in is never the one handed back.
		expect(rows.map((entry) => entry.id)).toEqual(['r1', 'r2']);
	});

	it('places a scene before another of the row, or at its end, reading itself as no anchor', () => {
		expect(scenesWith(['a', 'b'], 'c', 'b')).toEqual(['a', 'c', 'b']);
		expect(scenesWith(['a', 'b'], 'c', null)).toEqual(['a', 'b', 'c']);
		expect(scenesWith(['a', 'b'], 'c', 'gone')).toEqual(['a', 'b', 'c']);
		expect(scenesWith(['a', 'b'], 'c', 'c')).toEqual(['a', 'b', 'c']);
		expect(scenesWith([], 'c', 'a')).toEqual(['c']);
	});
});
