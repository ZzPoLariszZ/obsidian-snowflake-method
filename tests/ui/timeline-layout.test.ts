import { describe, expect, it } from 'vitest';

import type { Timeline, TimelineView } from '../../src/domain';
import {
	cellDragState,
	clampStackPosition,
	laneAcceptsDrag,
	laneCell,
	laneOrder,
	layoutKind,
	placementIndexAt,
	reorderIds,
	resolveActiveTimeline,
	rowAcceptsScene,
	stackKey,
	unionRows,
	assignedSceneIds,
	type TimelineDrag,
} from '../../src/ui/timeline-layout';
import type { WorldbuildingEntityViewModel } from '../../src/ui/view-model';

const timeline = (id: string): Timeline => ({
	id, name: `Timeline ${id}`, binding: null, times: [], createdAt: 1, updatedAt: 1,
});
const view = (timelines: string[]): TimelineView => ({
	id: 'v', name: 'View', timelines, timeOrder: [], presentation: null, cardStyle: null, showSubDescriptions: true, timesReversed: false, createdAt: 1, updatedAt: 1,
});

describe('the lanes a view shows', () => {
	const timelines = [timeline('a'), timeline('b'), timeline('c')];

	it('follows the view, the pinned timeline first, dropping ids the document lost', () => {
		expect(laneOrder(view(['c', 'gone', 'a']), { timelines, pinnedTimelineId: null }).map((lane) => lane.id)).toEqual(['c', 'a']);
		expect(laneOrder(view(['c', 'a', 'b']), { timelines, pinnedTimelineId: 'a' }).map((lane) => lane.id)).toEqual(['a', 'c', 'b']);
		expect(laneOrder(view(['c', 'a']), { timelines, pinnedTimelineId: 'b' }).map((lane) => lane.id)).toEqual(['c', 'a']);
		expect(laneOrder(view([]), { timelines, pinnedTimelineId: 'a' })).toEqual([]);
	});

	it('stands one lane alone and several side by side', () => {
		expect(layoutKind([])).toBe('single');
		expect(layoutKind([1])).toBe('single');
		expect(layoutKind([1, 2])).toBe('multi');
	});

	it('makes active the lane a click chose, else the pinned one, else the first', () => {
		const lanes = [timeline('a'), timeline('b')];
		expect(resolveActiveTimeline(lanes, null, undefined)).toBe('a');
		expect(resolveActiveTimeline(lanes, 'b', undefined)).toBe('b');
		expect(resolveActiveTimeline(lanes, 'c', undefined)).toBe('a');
		expect(resolveActiveTimeline(lanes, 'b', 'a')).toBe('a');
		expect(resolveActiveTimeline(lanes, 'b', 'gone')).toBe('b');
		expect(resolveActiveTimeline([], 'b', 'a')).toBeNull();
	});
});

describe('the rows of times and what a lane holds', () => {
	const note = (id: string): WorldbuildingEntityViewModel => ({ id, name: id } as unknown as WorldbuildingEntityViewModel);
	const lanes = [
		{ ...timeline('a'), times: [{ timeId: 't-2', rows: [{ id: 'r1', text: '', scenes: ['s-1', 's-2'] }] }, { timeId: 'gone', rows: [] }] },
		{ ...timeline('b'), times: [{ timeId: 't-1', rows: [] }] },
	];

	it('unites the lanes\' times in the view\'s order, the notes beside them where they still stand', () => {
		const rows = unionRows({ timelines: ['a', 'b'], timeOrder: ['t-1'] }, lanes, [note('t-2'), note('t-1'), note('t-3')]);
		expect(rows.map((row) => [row.timeId, row.time?.id ?? null])).toEqual([['t-1', 't-1'], ['t-2', 't-2'], ['gone', null]]);
		expect(laneCell(lanes[0]!, 't-2')?.rows).toHaveLength(1);
		expect(laneCell(lanes[0]!, 't-1')).toBeNull();
		expect([...assignedSceneIds(lanes[0]!)]).toEqual(['s-1', 's-2']);
	});

	it('moves an id before another or to the foot, and answers null for no move', () => {
		expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
		expect(reorderIds(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
		expect(reorderIds(['a', 'b', 'c'], 'a', 'gone')).toEqual(['b', 'c', 'a']);
		expect(reorderIds(['a', 'b', 'c'], 'a', 'b')).toBeNull();
		expect(reorderIds(['a', 'b', 'c'], 'c', null)).toBeNull();
		expect(reorderIds(['a', 'b', 'c'], 'c', 'c')).toBeNull();
		expect(reorderIds(['a', 'b', 'c'], 'z', null)).toBeNull();
	});

	it('lets a lane take its own rows and the locked lane a scene, and nothing take a time', () => {
		const rowDrag = { kind: 'row', timelineId: 'a', timeId: 't', rowId: 'r' } as const;
		const sceneDrag = { kind: 'scene', sceneId: 's', lockedTimelineId: 'b', source: { pool: true } } as const;
		expect(laneAcceptsDrag(rowDrag, 'a')).toBe(true);
		expect(laneAcceptsDrag(rowDrag, 'b')).toBe(false);
		expect(laneAcceptsDrag(sceneDrag, 'b')).toBe(true);
		expect(laneAcceptsDrag(sceneDrag, 'a')).toBe(false);
		expect(laneAcceptsDrag({ kind: 'time', timeId: 't' }, 'a')).toBe(false);
		expect(laneAcceptsDrag(null, 'a')).toBe(false);
		expect(cellDragState(rowDrag, 'a')).toBe('lane');
		expect(cellDragState(rowDrag, 'b')).toBe('locked');
		expect(cellDragState({ kind: 'time', timeId: 't' }, 'a')).toBe('idle');
		expect(cellDragState(null, 'a')).toBe('idle');
	});
});

describe('where a scene lands among the cards of a row', () => {
	const box = (top: number, left: number, height = 40, width = 100) => ({ top, bottom: top + height, left, right: left + width });

	it("reads a column of cards top to bottom, by each card's middle", () => {
		const column = [box(0, 0), box(50, 0), box(100, 0)];
		expect(placementIndexAt([], { x: 10, y: 10 })).toBe(0);
		expect(placementIndexAt(column, { x: 10, y: 10 })).toBe(0);
		expect(placementIndexAt(column, { x: 10, y: 30 })).toBe(1);
		expect(placementIndexAt(column, { x: 10, y: 55 })).toBe(1);
		expect(placementIndexAt(column, { x: 10, y: 125 })).toBe(3);
		expect(placementIndexAt(column, { x: 10, y: 500 })).toBe(3);
	});

	it('reads a wrapped line left to right, and the line the pointer is on or the first below it', () => {
		const wrapped = [box(0, 0), box(0, 120), box(0, 240), box(50, 0), box(50, 120)];
		expect(placementIndexAt(wrapped, { x: 10, y: 20 })).toBe(0);
		expect(placementIndexAt(wrapped, { x: 130, y: 20 })).toBe(1);
		expect(placementIndexAt(wrapped, { x: 200, y: 20 })).toBe(2);
		expect(placementIndexAt(wrapped, { x: 400, y: 20 })).toBe(3);
		expect(placementIndexAt(wrapped, { x: 130, y: 60 })).toBe(4);
		expect(placementIndexAt(wrapped, { x: 400, y: 60 })).toBe(5);
		expect(placementIndexAt(wrapped, { x: 10, y: 45 })).toBe(3);
	});
});

describe('the stack a row shows its scenes as', () => {
	const fromPool: TimelineDrag = { kind: 'scene', sceneId: 's', lockedTimelineId: 'a', source: { pool: true } };
	const fromRow: TimelineDrag = { kind: 'scene', sceneId: 's', lockedTimelineId: 'a', source: { timelineId: 'a', rowId: 'r1' } };

	it('keeps the place shown within the cards the row has', () => {
		expect(clampStackPosition(undefined, 3)).toBe(0);
		expect(clampStackPosition(2, 3)).toBe(2);
		expect(clampStackPosition(5, 3)).toBe(2);
		expect(clampStackPosition(-1, 3)).toBe(0);
		expect(clampStackPosition(1.7, 3)).toBe(1);
		expect(clampStackPosition(Number.NaN, 3)).toBe(0);
		expect(clampStackPosition(2, 0)).toBe(0);
	});

	it('remembers the place under the view, the lane and the row', () => {
		expect(stackKey('v', 'a', 'r1')).toBe('v|a|r1');
		expect(stackKey('v', 'a', 'r1')).not.toBe(stackKey('w', 'a', 'r1'));
	});

	it('takes a scene on any row lying flat, and on any stack but the one it comes from', () => {
		expect(rowAcceptsScene(fromRow, 'r1', 'flat')).toBe(true);
		expect(rowAcceptsScene(fromRow, 'r1', 'stack')).toBe(false);
		expect(rowAcceptsScene(fromRow, 'r2', 'stack')).toBe(true);
		expect(rowAcceptsScene(fromPool, 'r1', 'stack')).toBe(true);
		expect(rowAcceptsScene({ kind: 'time', timeId: 't' }, 'r1', 'stack')).toBe(false);
		expect(rowAcceptsScene(null, 'r1', 'flat')).toBe(false);
	});
});
