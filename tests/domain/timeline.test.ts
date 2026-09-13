import { describe, expect, it } from 'vitest';

import {
	activeTimelineFor,
	addTimelineRow,
	addTimelineTime,
	bindTimeline,
	createTimeline,
	createTimelineView,
	deleteTimeline,
	deleteTimelineRow,
	deleteTimelineView,
	derivedPresentation,
	editTimelineRow,
	emptyTimelineDocument,
	isTimelineBindingKind,
	moveTimelineInView,
	moveTimelineRow,
	pinTimeline,
	placeTimelineScene,
	pruneMissingFromTimelines,
	readTimeline,
	readTimelineDocument,
	readTimelineView,
	removeTimelineScene,
	removeTimelineTime,
	renameTimeline,
	renameTimelineView,
	resolvedTimeOrder,
	scenePlacements,
	serializeTimelineDocument,
	setLastTimelineView,
	setViewCardStyle,
	setViewPresentation,
	setViewTimeOrder,
	setViewTimelines,
	unassignedScenes,
	type Timeline,
	type TimelineDocument,
	type TimelineRow,
	type TimelineTime,
	type TimelineView,
} from '../../src/domain';

const row = (id: string, text = '', scenes: readonly string[] = []): TimelineRow => ({ id, text, scenes });
const time = (timeId: string, rows: readonly TimelineRow[] = []): TimelineTime => ({ timeId, rows });
const timeline = (id: string, times: readonly TimelineTime[] = [], extra: Partial<Timeline> = {}): Timeline => ({
	id, name: `Timeline ${id}`, binding: null, times, createdAt: 1, updatedAt: 1, ...extra,
});
const view = (id: string, timelines: readonly string[] = [], extra: Partial<TimelineView> = {}): TimelineView => ({
	id, name: `View ${id}`, timelines, timeOrder: [], presentation: null, cardStyle: null, createdAt: 1, updatedAt: 1, ...extra,
});
const doc = (
	timelines: readonly Timeline[] = [],
	views: readonly TimelineView[] = [],
	extra: Partial<TimelineDocument> = {},
): TimelineDocument => ({ ...emptyTimelineDocument(), timelines, views, ...extra });

const alice = { kind: 'character', id: 'character-alice', name: 'Alice' };
const rowsOf = (held: TimelineDocument, timelineId: string, timeId: string): TimelineRow[] =>
	[...(held.timelines.find((t) => t.id === timelineId)?.times.find((c) => c.timeId === timeId)?.rows ?? [])];
const timeIdsOf = (held: TimelineDocument, timelineId: string): string[] =>
	held.timelines.find((t) => t.id === timelineId)?.times.map((c) => c.timeId) ?? [];

describe('reading a stored timeline', () => {
	it('needs an id and a name, and reads the rest as far as it goes', () => {
		expect(readTimeline(null)).toBeNull();
		expect(readTimeline({ name: 'x' })).toBeNull();
		expect(readTimeline({ id: '', name: 'x' })).toBeNull();
		expect(readTimeline({ id: 'tl-1', name: 7 })).toBeNull();
		expect(readTimeline({ id: 'tl-1', name: 'Main', times: 'no', createdAt: 'x' })).toEqual({
			id: 'tl-1', name: 'Main', binding: null, times: [], createdAt: 0, updatedAt: 0,
		});
	});

	it('keeps a binding by its limbs, and drops one a timeline may not follow', () => {
		const bound = readTimeline({ id: 'tl-1', name: 'Alice', binding: { ...alice, extra: 1 } });
		expect(bound?.binding).toEqual(alice);
		expect(readTimeline({ id: 'tl-1', name: 'x', binding: { kind: 'scene', id: 's', name: 'S' } })?.binding).toBeNull();
		expect(readTimeline({ id: 'tl-1', name: 'x', binding: { kind: 'time', id: 't', name: 'T' } })?.binding).toBeNull();
		expect(readTimeline({ id: 'tl-1', name: 'x', binding: { kind: 'character' } })?.binding).toBeNull();
		expect(isTimelineBindingKind('location')).toBe(true);
	});

	it('merges a time named twice, drops a row id met twice, and keeps a scene where it first stood', () => {
		const read = readTimeline({
			id: 'tl-1', name: 'x',
			times: [
				{ timeId: 't-1', rows: [{ id: 'r-1', text: 'one', scenes: ['s-1', 's-2', '', 7] }, { id: 'r-1', text: 'twin' }] },
				{ timeId: 't-2', rows: [{ id: 'r-2', text: 'two', scenes: ['s-2', 's-3'] }] },
				{ timeId: 't-1', rows: [{ id: 'r-3', text: 3, scenes: 'no' }, 'junk', { id: '', text: 'x' }] },
				{ timeId: '' }, 'junk',
			],
		});
		expect(read?.times).toEqual([
			{ timeId: 't-1', rows: [{ id: 'r-1', text: 'one', scenes: ['s-1', 's-2'] }, { id: 'r-3', text: '', scenes: [] }] },
			{ timeId: 't-2', rows: [{ id: 'r-2', text: 'two', scenes: ['s-3'] }] },
		]);
	});

	it('reads a view leniently, its lists deduped and its choices checked', () => {
		expect(readTimelineView({ id: 'v-1' })).toBeNull();
		expect(readTimelineView({
			id: 'v-1', name: 'Main', timelines: ['a', 'b', 'a', ''], timeOrder: ['t-2', 't-1', 't-2'],
			presentation: 'stack', cardStyle: 'wide', createdAt: 5, updatedAt: 6,
		})).toEqual({
			id: 'v-1', name: 'Main', timelines: ['a', 'b'], timeOrder: ['t-2', 't-1'],
			presentation: 'stack', cardStyle: null, createdAt: 5, updatedAt: 6,
		});
		expect(readTimelineView({ id: 'v-1', name: 'x', presentation: 'grid', cardStyle: 'compact' })).toMatchObject({
			presentation: null, cardStyle: 'compact',
		});
	});

	it('reads a document, keeping what it cannot read or place as strays', () => {
		expect(readTimelineDocument({ timelines: [] })).toBeNull();
		expect(readTimelineDocument({ timelines: 'x', views: [] })).toBeNull();
		const read = readTimelineDocument({
			timelines: [{ id: 'tl-1', name: 'a' }, { id: 'tl-1', name: 'twin' }, { name: 'nameless' }],
			views: [{ id: 'v-1', name: 'v' }, 7],
			pinnedTimelineId: 'tl-stray', lastViewId: '', extra: true,
		});
		expect(read?.timelines.map((t) => t.id)).toEqual(['tl-1']);
		expect(read?.views.map((v) => v.id)).toEqual(['v-1']);
		expect(read?.strays).toEqual({ timelines: [{ id: 'tl-1', name: 'twin' }, { name: 'nameless' }], views: [7] });
		expect(read?.pinnedTimelineId).toBe('tl-stray');
		expect(read?.lastViewId).toBeNull();
	});

	it('writes the readable entries first and the strays after them', () => {
		const held = doc([timeline('tl-1')], [view('v-1')], {
			pinnedTimelineId: 'tl-1', lastViewId: 'v-1', strays: { timelines: [{ x: 1 }], views: [{ y: 2 }] },
		});
		expect(serializeTimelineDocument(held)).toEqual({
			timelines: [timeline('tl-1'), { x: 1 }], views: [view('v-1'), { y: 2 }], pinnedTimelineId: 'tl-1', lastViewId: 'v-1',
		});
	});
});

describe('timelines', () => {
	it('appends a new timeline by its limbs, and refuses a twin or a forbidden binding', () => {
		const held = doc([timeline('tl-1')]);
		const made = createTimeline(held, timeline('tl-2', [], { binding: { ...alice, extra: 1 } as never }));
		expect(made?.timelines.map((t) => t.id)).toEqual(['tl-1', 'tl-2']);
		expect(made?.timelines[1]?.binding).toEqual(alice);
		expect(createTimeline(held, timeline('tl-1'))).toBeNull();
		expect(createTimeline(held, timeline('tl-3', [], { binding: { kind: 'scene', id: 's', name: 'S' } }))).toBeNull();
	});

	it('renames and binds, stamping the change and writing nothing for none', () => {
		const held = doc([timeline('tl-1')]);
		expect(renameTimeline(held, 'tl-1', 'Main', 9)?.timelines[0]).toMatchObject({ name: 'Main', updatedAt: 9 });
		expect(renameTimeline(held, 'tl-1', 'Timeline tl-1', 9)).toBeNull();
		expect(renameTimeline(held, 'tl-9', 'x', 9)).toBeNull();
		const bound = bindTimeline(held, 'tl-1', alice, 9);
		expect(bound?.timelines[0]).toMatchObject({ binding: alice, updatedAt: 9 });
		expect(bindTimeline(bound!, 'tl-1', { ...alice }, 10)).toBeNull();
		expect(bindTimeline(bound!, 'tl-1', null, 10)?.timelines[0]?.binding).toBeNull();
		expect(bindTimeline(held, 'tl-1', { kind: 'time', id: 't', name: 'T' }, 9)).toBeNull();
	});

	it('deletes a timeline out of every view and the pin, leaving an emptied view standing', () => {
		const held = doc([timeline('tl-1'), timeline('tl-2')], [view('v-1', ['tl-1', 'tl-2']), view('v-2', ['tl-1'])], {
			pinnedTimelineId: 'tl-1', lastViewId: 'v-2',
		});
		const gone = deleteTimeline(held, 'tl-1');
		expect(gone?.timelines.map((t) => t.id)).toEqual(['tl-2']);
		expect(gone?.views.map((v) => v.timelines)).toEqual([['tl-2'], []]);
		expect(gone?.pinnedTimelineId).toBeNull();
		expect(gone?.lastViewId).toBe('v-2');
		expect(gone?.views[0]?.updatedAt).toBe(1);
		expect(deleteTimeline(held, 'tl-9')).toBeNull();
	});

	it('pins one timeline or none', () => {
		const held = doc([timeline('tl-1')]);
		expect(pinTimeline(held, 'tl-1')?.pinnedTimelineId).toBe('tl-1');
		expect(pinTimeline(held, 'tl-9')).toBeNull();
		expect(pinTimeline(held, null)).toBeNull();
		expect(pinTimeline(pinTimeline(held, 'tl-1')!, null)?.pinnedTimelineId).toBeNull();
	});
});

describe('views', () => {
	it('creates, renames and deletes views without touching timelines', () => {
		const held = doc([timeline('tl-1')], [], { lastViewId: null });
		const made = createTimelineView(held, view('v-1', ['tl-1', 'tl-1', 'tl-stray'], { timeOrder: ['t-1', 't-1'] }));
		expect(made?.views[0]).toMatchObject({ timelines: ['tl-1', 'tl-stray'], timeOrder: ['t-1'] });
		expect(createTimelineView(made!, view('v-1'))).toBeNull();
		expect(renameTimelineView(made!, 'v-1', 'Main', 9)?.views[0]).toMatchObject({ name: 'Main', updatedAt: 9 });
		expect(renameTimelineView(made!, 'v-1', 'View v-1', 9)).toBeNull();
		const last = setLastTimelineView(made!, 'v-1');
		expect(last?.lastViewId).toBe('v-1');
		expect(setLastTimelineView(made!, 'v-9')).toBeNull();
		expect(setLastTimelineView(last!, 'v-1')).toBeNull();
		const gone = deleteTimelineView(last!, 'v-1');
		expect(gone?.views).toEqual([]);
		expect(gone?.lastViewId).toBeNull();
		expect(gone?.timelines).toHaveLength(1);
		expect(deleteTimelineView(held, 'v-9')).toBeNull();
	});

	it('sets, moves and orders what a view shows', () => {
		const held = doc([timeline('a'), timeline('b'), timeline('c')], [view('v-1', ['a', 'b', 'c'])]);
		expect(setViewTimelines(held, 'v-1', ['c', 'a', 'a', ''], 9)?.views[0]).toMatchObject({ timelines: ['c', 'a'], updatedAt: 9 });
		expect(setViewTimelines(held, 'v-1', ['a', 'b', 'c'], 9)).toBeNull();
		expect(moveTimelineInView(held, 'v-1', 'c', 'a', 9)?.views[0]?.timelines).toEqual(['c', 'a', 'b']);
		expect(moveTimelineInView(held, 'v-1', 'a', null, 9)?.views[0]?.timelines).toEqual(['b', 'c', 'a']);
		expect(moveTimelineInView(held, 'v-1', 'a', 'gone', 9)?.views[0]?.timelines).toEqual(['b', 'c', 'a']);
		expect(moveTimelineInView(held, 'v-1', 'a', 'b', 9)).toBeNull();
		expect(moveTimelineInView(held, 'v-1', 'c', null, 9)).toBeNull();
		expect(moveTimelineInView(held, 'v-1', 'z', null, 9)).toBeNull();
		expect(setViewTimeOrder(held, 'v-1', ['t-2', 't-1', 't-2'], 9)?.views[0]?.timeOrder).toEqual(['t-2', 't-1']);
		expect(setViewTimeOrder(held, 'v-1', [], 9)).toBeNull();
		expect(setViewPresentation(held, 'v-1', 'stack', 9)?.views[0]?.presentation).toBe('stack');
		expect(setViewPresentation(held, 'v-1', null, 9)).toBeNull();
		expect(setViewCardStyle(held, 'v-1', 'compact', 9)?.views[0]?.cardStyle).toBe('compact');
		expect(setViewCardStyle(held, 'v-1', null, 9)).toBeNull();
		expect(setViewTimelines(held, 'v-9', [], 9)).toBeNull();
	});
});

describe('times and rows', () => {
	it('adds and removes a time, rows and all', () => {
		const held = doc([timeline('tl-1', [time('t-1', [row('r-1', 'one', ['s-1'])])])]);
		expect(addTimelineTime(held, 'tl-1', 't-2', 9)?.timelines[0]).toMatchObject({
			times: [time('t-1', [row('r-1', 'one', ['s-1'])]), time('t-2')], updatedAt: 9,
		});
		expect(addTimelineTime(held, 'tl-1', 't-1', 9)).toBeNull();
		expect(addTimelineTime(held, 'tl-9', 't-1', 9)).toBeNull();
		expect(removeTimelineTime(held, 'tl-1', 't-1', 9)?.timelines[0]?.times).toEqual([]);
		expect(removeTimelineTime(held, 'tl-1', 't-9', 9)).toBeNull();
	});

	it('adds a row at the end, before a neighbour, under a time it adds on the way, taking a scene from where it stood', () => {
		const held = doc([timeline('tl-1', [time('t-1', [row('r-1', 'one', ['s-1']), row('r-2', 'two')])])]);
		expect(rowsOf(addTimelineRow(held, 'tl-1', 't-1', { id: 'r-3', text: 'three' }, null, 9)!, 'tl-1', 't-1').map((r) => r.id)).toEqual(['r-1', 'r-2', 'r-3']);
		expect(rowsOf(addTimelineRow(held, 'tl-1', 't-1', { id: 'r-3', text: 'three' }, 'r-2', 9)!, 'tl-1', 't-1').map((r) => r.id)).toEqual(['r-1', 'r-3', 'r-2']);
		expect(rowsOf(addTimelineRow(held, 'tl-1', 't-1', { id: 'r-3', text: 'three' }, 'gone', 9)!, 'tl-1', 't-1').map((r) => r.id)).toEqual(['r-1', 'r-2', 'r-3']);
		const elsewhere = addTimelineRow(held, 'tl-1', 't-2', { id: 'r-3', text: 'three', scenes: ['s-1', 's-9', 's-1'] }, null, 9)!;
		expect(timeIdsOf(elsewhere, 'tl-1')).toEqual(['t-1', 't-2']);
		expect(rowsOf(elsewhere, 'tl-1', 't-2')).toEqual([row('r-3', 'three', ['s-1', 's-9'])]);
		expect(rowsOf(elsewhere, 'tl-1', 't-1')[0]?.scenes).toEqual([]);
		expect(addTimelineRow(held, 'tl-1', 't-1', { id: 'r-1', text: 'twin' }, null, 9)).toBeNull();
		expect(addTimelineRow(held, 'tl-9', 't-1', { id: 'r-3', text: 'x' }, null, 9)).toBeNull();
	});

	it('edits a row, writing nothing for the same words', () => {
		const held = doc([timeline('tl-1', [time('t-1', [row('r-1', 'one')])])]);
		expect(rowsOf(editTimelineRow(held, 'tl-1', 'r-1', 'once', 9)!, 'tl-1', 't-1')[0]?.text).toBe('once');
		expect(editTimelineRow(held, 'tl-1', 'r-1', 'one', 9)).toBeNull();
		expect(editTimelineRow(held, 'tl-1', 'r-9', 'x', 9)).toBeNull();
	});

	it('moves a row with its scenes within a time, to another time, or to a time it adds', () => {
		const held = doc([timeline('tl-1', [
			time('t-1', [row('r-1', 'one', ['s-1']), row('r-2', 'two'), row('r-3', 'three')]),
			time('t-2', [row('r-4', 'four')]),
		])]);
		expect(rowsOf(moveTimelineRow(held, 'tl-1', 'r-3', 't-1', 'r-2', 9)!, 'tl-1', 't-1').map((r) => r.id)).toEqual(['r-1', 'r-3', 'r-2']);
		const across = moveTimelineRow(held, 'tl-1', 'r-1', 't-2', null, 9)!;
		expect(rowsOf(across, 'tl-1', 't-1').map((r) => r.id)).toEqual(['r-2', 'r-3']);
		expect(rowsOf(across, 'tl-1', 't-2')).toEqual([row('r-4', 'four'), row('r-1', 'one', ['s-1'])]);
		expect(rowsOf(moveTimelineRow(held, 'tl-1', 'r-1', 't-2', 'r-4', 9)!, 'tl-1', 't-2').map((r) => r.id)).toEqual(['r-1', 'r-4']);
		const fresh = moveTimelineRow(held, 'tl-1', 'r-1', 't-3', null, 9)!;
		expect(timeIdsOf(fresh, 'tl-1')).toEqual(['t-1', 't-2', 't-3']);
		expect(rowsOf(fresh, 'tl-1', 't-3').map((r) => r.id)).toEqual(['r-1']);
		expect(moveTimelineRow(held, 'tl-1', 'r-3', 't-1', null, 9)).toBeNull();
		expect(moveTimelineRow(held, 'tl-1', 'r-1', 't-1', 'r-2', 9)).toBeNull();
		expect(moveTimelineRow(held, 'tl-1', 'r-1', 't-1', 'r-1', 9)).toBeNull();
		expect(moveTimelineRow(held, 'tl-1', 'r-9', 't-1', null, 9)).toBeNull();
	});

	it('deletes a row, unplacing its scenes', () => {
		const held = doc([timeline('tl-1', [time('t-1', [row('r-1', 'one', ['s-1']), row('r-2', 'two')])])]);
		const gone = deleteTimelineRow(held, 'tl-1', 'r-1', 9)!;
		expect(rowsOf(gone, 'tl-1', 't-1').map((r) => r.id)).toEqual(['r-2']);
		expect(unassignedScenes(gone.timelines[0]!, ['s-1', 's-2'])).toEqual(['s-1', 's-2']);
		expect(deleteTimelineRow(held, 'tl-1', 'r-9', 9)).toBeNull();
	});
});

describe('scene placements', () => {
	const held = doc([timeline('tl-1', [
		time('t-1', [row('r-1', 'one', ['s-1', 's-2']), row('r-2', 'two', ['s-3'])]),
		time('t-2', [row('r-3', 'three')]),
	])]);

	it("places a scene at a row's end or before a neighbour, giving up where it stood", () => {
		expect(rowsOf(placeTimelineScene(held, 'tl-1', 's-9', 'r-2', null, 9)!, 'tl-1', 't-1')[1]?.scenes).toEqual(['s-3', 's-9']);
		expect(rowsOf(placeTimelineScene(held, 'tl-1', 's-9', 'r-1', 's-2', 9)!, 'tl-1', 't-1')[0]?.scenes).toEqual(['s-1', 's-9', 's-2']);
		const moved = placeTimelineScene(held, 'tl-1', 's-1', 'r-3', null, 9)!;
		expect(rowsOf(moved, 'tl-1', 't-1').map((r) => r.scenes)).toEqual([['s-2'], ['s-3']]);
		expect(rowsOf(moved, 'tl-1', 't-2')[0]?.scenes).toEqual(['s-1']);
		expect(moved.timelines[0]?.updatedAt).toBe(9);
		expect(rowsOf(placeTimelineScene(held, 'tl-1', 's-2', 'r-1', 's-1', 9)!, 'tl-1', 't-1')[0]?.scenes).toEqual(['s-2', 's-1']);
		expect(rowsOf(placeTimelineScene(held, 'tl-1', 's-1', 'r-1', 's-1', 9)!, 'tl-1', 't-1')[0]?.scenes).toEqual(['s-2', 's-1']);
		expect(rowsOf(placeTimelineScene(held, 'tl-1', 's-3', 'r-1', 'gone', 9)!, 'tl-1', 't-1').map((r) => r.scenes)).toEqual([['s-1', 's-2', 's-3'], []]);
	});

	it('writes nothing where the scene already stands, or the row is not the timeline\'s', () => {
		expect(placeTimelineScene(held, 'tl-1', 's-2', 'r-1', null, 9)).toBeNull();
		expect(placeTimelineScene(held, 'tl-1', 's-1', 'r-1', 's-2', 9)).toBeNull();
		expect(placeTimelineScene(held, 'tl-1', 's-1', 'r-9', null, 9)).toBeNull();
		expect(placeTimelineScene(held, 'tl-9', 's-1', 'r-1', null, 9)).toBeNull();
	});

	it('removes a placement, and knows where every scene stands', () => {
		const gone = removeTimelineScene(held, 'tl-1', 's-2', 9)!;
		expect(rowsOf(gone, 'tl-1', 't-1')[0]?.scenes).toEqual(['s-1']);
		expect(removeTimelineScene(held, 'tl-1', 's-9', 9)).toBeNull();
		expect([...scenePlacements(held.timelines[0]!).entries()]).toEqual([
			['s-1', { timeId: 't-1', rowId: 'r-1', index: 0 }],
			['s-2', { timeId: 't-1', rowId: 'r-1', index: 1 }],
			['s-3', { timeId: 't-1', rowId: 'r-2', index: 0 }],
		]);
		expect(unassignedScenes(held.timelines[0]!, ['s-4', 's-3', 's-5'])).toEqual(['s-4', 's-5']);
	});

	it('prunes only what it is handed: scenes, times, or both', () => {
		const withView = doc(held.timelines, [view('v-1', ['tl-1'], { timeOrder: ['t-2', 't-1', 't-7'] })]);
		const scenes = pruneMissingFromTimelines(withView, { sceneIds: new Set(['s-1', 's-3']) }, 9)!;
		expect(rowsOf(scenes, 'tl-1', 't-1').map((r) => r.scenes)).toEqual([['s-1'], ['s-3']]);
		expect(timeIdsOf(scenes, 'tl-1')).toEqual(['t-1', 't-2']);
		expect(scenes.views[0]?.timeOrder).toEqual(['t-2', 't-1', 't-7']);
		expect(scenes.timelines[0]?.updatedAt).toBe(9);
		const times = pruneMissingFromTimelines(withView, { timeIds: new Set(['t-1']) }, 9)!;
		expect(timeIdsOf(times, 'tl-1')).toEqual(['t-1']);
		expect(times.views[0]).toMatchObject({ timeOrder: ['t-1'], updatedAt: 9 });
		expect(rowsOf(times, 'tl-1', 't-1')[0]?.scenes).toEqual(['s-1', 's-2']);
		expect(pruneMissingFromTimelines(withView, { sceneIds: new Set(['s-1', 's-2', 's-3']), timeIds: new Set(['t-1', 't-2', 't-7']) }, 9)).toBeNull();
		expect(pruneMissingFromTimelines(withView, {}, 9)).toBeNull();
	});
});

describe('what the views derive', () => {
	it('shows one timeline flat and several stacked unless the view says', () => {
		expect(derivedPresentation(view('v', []))).toBe('flat');
		expect(derivedPresentation(view('v', ['a']))).toBe('flat');
		expect(derivedPresentation(view('v', ['a', 'b']))).toBe('stack');
		expect(derivedPresentation(view('v', ['a', 'b'], { presentation: 'flat' }))).toBe('flat');
	});

	it('makes the pinned timeline active where the view holds it, else the first', () => {
		expect(activeTimelineFor(view('v', ['a', 'b']), 'b')).toBe('b');
		expect(activeTimelineFor(view('v', ['a', 'b']), 'c')).toBe('a');
		expect(activeTimelineFor(view('v', ['a', 'b']), null)).toBe('a');
		expect(activeTimelineFor(view('v', []), 'c')).toBeNull();
		expect(activeTimelineFor(null, 'c')).toBe('c');
	});

	it('orders the times: as stored, then the canonical order, then what the project lost', () => {
		const timelines = [
			timeline('a', [time('t-3'), time('t-1'), time('gone-a')]),
			timeline('b', [time('t-2'), time('t-1'), time('gone-b')]),
			timeline('c', [time('t-9')]),
		];
		const order = resolvedTimeOrder(view('v', ['a', 'b', 'missing'], { timeOrder: ['t-1', 't-9', 'unused'] }), timelines, ['t-2', 't-3', 't-1']);
		expect(order).toEqual(['t-1', 't-2', 't-3', 'gone-a', 'gone-b']);
		expect(resolvedTimeOrder(view('v', []), timelines, ['t-1'])).toEqual([]);
	});
});
