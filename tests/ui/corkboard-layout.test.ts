import { describe, expect, it, vi } from 'vitest';

import {
	SCENE_DRAG_TYPE,
	adjacencyAllowed,
	buildLayout,
	cardPosition,
	columnsFor,
	corkboardMetrics,
	displayOrder,
	dropTargetAt,
	firstCardInView,
	insertBesideIndex,
	moveTargetIndex,
	povOptions,
	revealScrollTop,
	statusOptions,
	titleTaken,
	visibleCards,
	visibleHeads,
	visibleLines,
	visualNeighbours,
	type CorkboardScene,
	type DisplayOrder,
	type ShownScene,
} from '../../src/ui/corkboard-layout';

const t = (key: string): string => key;

const sceneOf = (
	id: string,
	overrides: Partial<CorkboardScene> = {},
): CorkboardScene => ({
	id,
	title: id,
	povPath: '',
	povName: '',
	progressStatus: null,
	color: null,
	categoryPaths: [],
	times: [],
	locations: [],
	characterPaths: [],
	linkedManuscript: [],
	...overrides,
});

const characters = [
	{ path: 'C/Ada.md', name: 'Ada' },
	{ path: 'C/Bo.md', name: 'Bo' },
];
const ctx = { t, characters, locale: 'en' };

const scenes: CorkboardScene[] = [
	sceneOf('One', {
		povPath: 'C/Bo.md',
		povName: 'Bo',
		progressStatus: 'complete',
		color: 'macaron-3',
		categoryPaths: ['Arc/A', 'Arc/B'],
		times: ['[[T/Spring|early spring]]'],
		characterPaths: ['C/Ada.md', 'C/Bo.md'],
		linkedManuscript: [{ raw: '[[M/Ch1]]', linktext: 'M/Ch1', label: 'Ch1' }],
	}),
	sceneOf('Two', {
		povPath: 'C/Ada.md',
		povName: 'Ada',
		progressStatus: 'in-progress',
		color: 'macaron-1',
		times: ['[[T/Winter]]'],
		locations: ['harbour'],
		characterPaths: ['C/Bo.md'],
	}),
	sceneOf('Three', {
		povPath: 'omniscient',
		povName: 'Omni',
		categoryPaths: ['Arc/A'],
		linkedManuscript: [
			{ raw: '[[M/Ch1#x]]', linktext: 'M/Ch1#x', label: 'Ch1 › x' },
		],
	}),
	sceneOf('Four', {
		povPath: 'C/Gone.md',
		povName: 'Gone',
		progressStatus: 'complete',
		color: 'macaron-3',
		characterPaths: ['C/Gone.md'],
	}),
	sceneOf('Five'),
];
const shown: ShownScene[] = scenes.map((scene, index) => ({ scene, index }));

const itemsOf = (order: DisplayOrder): number[][] =>
	order.groups.map((group) => group.items.map((item) => item.sceneIndex));
const labelsOf = (order: DisplayOrder): string[] =>
	order.groups.map((group) => group.label);

describe('the display order', () => {
	it('groups equivalent whole-note spellings once, resolving each in its source scene', () => {
		const references = ['[[Chapter]]', '[[Novel/Chapter]]'];
		const grouped = references.map((raw, index) => ({
			scene: sceneOf(String(index), { path: `Novel/Scenes/${String(index)}.md`,
				linkedManuscript: [{ raw, linktext: raw.slice(2, -2), label: 'Chapter' }] }), index,
		}));
		grouped[0]!.scene.linkedManuscript = [...grouped[0]!.scene.linkedManuscript, ...grouped[1]!.scene.linkedManuscript];
		const resolveLink = vi.fn(() => 'Novel/Chapter.md');
		const order = displayOrder(grouped, false, 'linked', { ...ctx, resolveLink });
		expect(order.groups).toHaveLength(1);
		expect(order.groups[0]?.key).toBe('linked:Novel/Chapter');
		expect(itemsOf(order)).toEqual([[0, 1]]);
		expect(resolveLink).toHaveBeenCalledWith('Chapter', 'Novel/Scenes/0.md');
	});

	it('keeps same-named destinations distinct and retains explicit alias and heading groups', () => {
		const rawLinks = ['[[Chapter]]', '[[Chapter]]', '[[Chapter|Prologue]]', '[[Chapter#Opening]]'];
		const grouped = rawLinks.map((raw, index) => ({
			scene: sceneOf(String(index), { path: `Part ${String(index)}/Scene.md`, linkedManuscript: [{
				raw, linktext: raw.slice(2, -2).split('|')[0]!, label: ['Chapter', 'Chapter', 'Prologue', 'Chapter › Opening'][index]!,
			}] }), index,
		}));
		const resolveLink = vi.fn((_target: string, source: string) => `${source.split('/')[0]}/Chapter.md`);
		const order = displayOrder(grouped, false, 'linked', { ...ctx, resolveLink });
		expect(new Set(order.groups.map((group) => group.key))).toEqual(new Set([
			'linked:Part 0/Chapter', 'linked:Part 1/Chapter', 'linked:Chapter', 'linked:Chapter#Opening',
		]));
		expect(resolveLink).toHaveBeenCalledTimes(2);
	});
	it('lays the shown scenes under one unlabeled group in narrative order when nothing groups them', () => {
		const order = displayOrder(shown, false, '', ctx);
		expect(order.groups).toHaveLength(1);
		expect(order.groups[0]?.key).toBe('');
		expect(order.groups[0]?.label).toBe('');
		expect(itemsOf(order)).toEqual([[0, 1, 2, 3, 4]]);
		expect(order.shown).toBe(5);
		expect(displayOrder([], false, '', ctx)).toEqual({ groups: [], shown: 0 });
	});

	it("reverses the sequence and keeps every item's narrative index", () => {
		expect(itemsOf(displayOrder(shown, true, '', ctx))).toEqual([
			[4, 3, 2, 1, 0],
		]);
	});

	it("groups by point of view in the cast's order, then omniscient, multi-POV and none", () => {
		const order = displayOrder(shown, false, 'pov', ctx);
		expect(labelsOf(order)).toEqual([
			'Ada',
			'Bo',
			'Gone',
			'Omni',
			'corkboard.none.pov',
		]);
		expect(itemsOf(order)).toEqual([[1], [0], [3], [2], [4]]);
		expect(order.groups[0]?.key).toBe('pov:C/Ada.md');
	});

	it("groups by progress status in the vocabulary's order with the unset last", () => {
		const order = displayOrder(shown, false, 'status', ctx);
		expect(labelsOf(order)).toEqual([
			'status.in-progress',
			'status.complete',
			'corkboard.none.status',
		]);
		expect(itemsOf(order)).toEqual([[1], [0, 3], [2, 4]]);
	});

	it('groups by colour in the macaron order with none last', () => {
		const order = displayOrder(shown, false, 'color', ctx);
		expect(labelsOf(order)).toEqual([
			'stickyNotes.color.macaron-1',
			'stickyNotes.color.macaron-3',
			'corkboard.none.color',
		]);
		expect(itemsOf(order)).toEqual([[1], [0, 3], [2, 4]]);
	});

	it('puts a scene with several categories, times, places, cast or links in every matching group', () => {
		expect(itemsOf(displayOrder(shown, false, 'category', ctx))).toEqual([
			[0, 2],
			[0],
			[1, 3, 4],
		]);
		expect(itemsOf(displayOrder(shown, false, 'character', ctx))).toEqual([
			[0],
			[0, 1],
			[3],
			[2, 4],
		]);
		expect(itemsOf(displayOrder(shown, false, 'linked', ctx))).toEqual([
			[0],
			[2],
			[1, 3, 4],
		]);
	});

	it('orders the free-text groups alphabetically in the locale with none last', () => {
		expect(labelsOf(displayOrder(shown, false, 'category', ctx))).toEqual([
			'Arc/A',
			'Arc/B',
			'corkboard.none.category',
		]);
		expect(labelsOf(displayOrder(shown, false, 'linked', ctx))).toEqual([
			'Ch1',
			'Ch1 › x',
			'corkboard.none.linked',
		]);
	});

	it('names time and location groups by the word the link shows', () => {
		expect(labelsOf(displayOrder(shown, false, 'time', ctx))).toEqual([
			'early spring',
			'Winter',
			'corkboard.none.time',
		]);
		expect(labelsOf(displayOrder(shown, false, 'location', ctx))).toEqual([
			'harbour',
			'corkboard.none.location',
		]);
	});

	it('names a character group by its current name and a gone character by its note stem', () => {
		expect(labelsOf(displayOrder(shown, false, 'character', ctx))).toEqual([
			'Ada',
			'Bo',
			'Gone',
			'corkboard.none.character',
		]);
	});

	it('reverses inside each group and leaves the groups where they stand', () => {
		const order = displayOrder(shown, true, 'category', ctx);
		expect(labelsOf(order)).toEqual(['Arc/A', 'Arc/B', 'corkboard.none.category']);
		expect(itemsOf(order)).toEqual([[2, 0], [0], [4, 3, 1]]);
	});

	it('counts distinct scenes, not memberships', () => {
		expect(displayOrder(shown, false, 'category', ctx).shown).toBe(5);
	});

	it('leaves its input alone', () => {
		const before = JSON.stringify(shown);
		displayOrder(shown, true, 'character', ctx);
		expect(JSON.stringify(shown)).toBe(before);
	});
});

const metrics = corkboardMetrics(1000, 'standard', 16);
const twoGroups: DisplayOrder = {
	groups: [
		{
			key: 'g1',
			label: 'First',
			items: [0, 1, 2, 3].map((sceneIndex) => ({ sceneIndex })),
		},
		{ key: 'g2', label: 'Second', items: [4, 5].map((sceneIndex) => ({ sceneIndex })) },
	],
	shown: 6,
};
const layout = buildLayout(twoGroups, metrics);

describe('the layout', () => {
	it('fits as many columns as the width allows, never fewer than one, and shares the width between them', () => {
		expect(columnsFor(1000, 256, 20)).toBe(3);
		expect(columnsFor(100, 256, 20)).toBe(1);
		expect(columnsFor(0, 256, 20)).toBe(1);
		expect(layout.columns).toBe(3);
		expect(layout.cardWidth).toBeCloseTo(920 / 3);
	});

	it('fills the available width without reserving an extra gap after the last column', () => {
		for (const width of [240, 600, 1000, 1600]) {
			const full = buildLayout(
				{
					groups: [{
						key: '',
						label: '',
						items: Array.from({ length: 20 }, (_, sceneIndex) => ({ sceneIndex })),
					}],
					shown: 20,
				},
				corkboardMetrics(width, 'standard', 16),
			);
			expect(cardPosition(full, 0).x).toBe(0);
			expect(cardPosition(full, full.columns - 1).x + full.cardWidth).toBeCloseTo(width);
		}
	});

	it('measures each mode in rem', () => {
		expect(metrics).toEqual({
			width: 1000,
			gap: 40,
			minCardWidth: 256,
			cardHeight: 240,
			headHeight: 36,
		});
		expect(corkboardMetrics(500, 'compact', 10).cardHeight).toBe(50);
		expect(corkboardMetrics(500, 'extended', 10).cardHeight).toBe(190);
	});

	it('uses the compact header and footer height for card placement and scrolling', () => {
		const compact = buildLayout(
			{
				groups: [{
					key: '',
					label: '',
					items: [0, 1, 2].map((sceneIndex) => ({ sceneIndex })),
				}],
				shown: 3,
			},
			corkboardMetrics(256, 'compact', 16, 76),
		);
		expect(compact.cardHeight).toBe(76);
		expect(cardPosition(compact, 1).y).toBe(116);
		expect(visibleCards(compact, visibleLines(compact, 116, 76, 0))).toEqual([1]);
		expect(revealScrollTop(compact, 2, 76)).toBe(232);
	});

	it('keeps full card modes fixed and falls back when compact content cannot be measured', () => {
		expect(corkboardMetrics(500, 'standard', 16, 76).cardHeight).toBe(240);
		expect(corkboardMetrics(500, 'extended', 16, 76).cardHeight).toBe(304);
		for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(corkboardMetrics(500, 'compact', 16, height).cardHeight).toBe(80);
		}
	});

	it("puts a group's head on a line of its own before its rows", () => {
		expect(layout.lines).toEqual([
			{ kind: 'head', key: 'g1', label: 'First' },
			{ kind: 'row', cards: [0, 1, 2] },
			{ kind: 'row', cards: [3] },
			{ kind: 'head', key: 'g2', label: 'Second' },
			{ kind: 'row', cards: [4, 5] },
		]);
		expect(layout.items.map((item) => item.sceneIndex)).toEqual([0, 1, 2, 3, 4, 5]);
		const plain = buildLayout(
			{ groups: [{ key: '', label: '', items: [{ sceneIndex: 0 }] }], shown: 1 },
			metrics,
		);
		expect(plain.lines).toEqual([{ kind: 'row', cards: [0] }]);
	});

	it('runs the offsets from the line heights up to the total', () => {
		expect(layout.offsets).toEqual([0, 36, 316, 596, 632, 912]);
		expect(layout.height).toBe(912);
	});

	it('places a card by its line and column', () => {
		expect(layout.places[2]).toEqual({ line: 1, column: 2 });
		expect(layout.places[3]).toEqual({ line: 2, column: 0 });
		expect(cardPosition(layout, 2).x).toBeCloseTo(2080 / 3);
		expect(cardPosition(layout, 2).y).toBe(36);
		expect(cardPosition(layout, 4)).toEqual({ x: 0, y: 632 });
		expect(cardPosition(layout, 9)).toEqual({ x: 0, y: 0 });
	});

	it('answers the lines in the window and the cards on them', () => {
		const lines = visibleLines(layout, 0, 340, 0);
		expect(lines).toEqual({ first: 0, count: 3 });
		expect(visibleCards(layout, lines)).toEqual([0, 1, 2, 3]);
		expect(visibleCards(layout, visibleLines(layout, 600, 200, 0))).toEqual([4, 5]);
	});

	it('lists the heads standing in the window', () => {
		expect(visibleHeads(layout, visibleLines(layout, 0, 300, 0))).toEqual(['g1']);
		expect(visibleHeads(layout, visibleLines(layout, 0, 900, 0))).toEqual([
			'g1',
			'g2',
		]);
	});

	it('finds the scroll that centres a card, never above the top', () => {
		expect(revealScrollTop(layout, 0, 300)).toBe(26);
		expect(revealScrollTop(layout, 0, 900)).toBe(0);
		expect(revealScrollTop(layout, 3, 300)).toBe(306);
		expect(revealScrollTop(layout, 4, 300)).toBe(612);
		expect(revealScrollTop(layout, 9, 300)).toBe(0);
	});

	it('names the first card in view', () => {
		expect(firstCardInView(layout, 0)).toBe(0);
		expect(firstCardInView(layout, 320)).toBe(3);
		expect(firstCardInView(layout, 640)).toBe(4);
		expect(firstCardInView(layout, 950)).toBeNull();
	});

	it('lays nothing out for an empty order', () => {
		const empty = buildLayout({ groups: [], shown: 0 }, metrics);
		expect(empty.lines).toEqual([]);
		expect(empty.items).toEqual([]);
		expect(empty.height).toBe(0);
		expect(visibleLines(empty, 0, 300, 2)).toEqual({ first: 0, count: 0 });
		expect(firstCardInView(empty, 0)).toBeNull();
	});
});

describe('where a drop lands', () => {
	it('finds a row near the end of a large board with logarithmic offset reads', () => {
		const large = buildLayout({ groups: [{ key: '', label: '', items: Array.from({ length: 10000 }, (_, sceneIndex) => ({ sceneIndex })) }], shown: 10000 }, metrics);
		const lastLine = large.lines.length - 1;
		const y = large.offsets[lastLine]!;
		let reads = 0;
		const offsets = new Proxy(large.offsets, { get: (target, key, receiver): unknown => {
			if (typeof key === 'string' && /^\d+$/u.test(key)) reads++;
			return Reflect.get(target, key, receiver) as unknown;
		} });
		expect(dropTargetAt({ ...large, offsets }, { x: 0, y })).toEqual({ before: 9999 });
		expect(reads).toBeLessThan(20);
	});
	it('is before the first card in the row whose middle is right of the pointer', () => {
		expect(dropTargetAt(layout, { x: 100, y: 100 })).toEqual({ before: 0 });
		expect(dropTargetAt(layout, { x: 300, y: 100 })).toEqual({ before: 1 });
		expect(dropTargetAt(layout, { x: 700, y: 100 })).toEqual({ before: 2 });
	});

	it("is after the row's last card, which is before the next row's first", () => {
		expect(dropTargetAt(layout, { x: 900, y: 100 })).toEqual({ before: 3 });
		expect(dropTargetAt(layout, { x: 200, y: 400 })).toEqual({ before: 4 });
	});

	it('is the very first above the first line and the end past the last', () => {
		expect(dropTargetAt(layout, { x: 500, y: -5 })).toEqual({ before: 0 });
		expect(dropTargetAt(layout, { x: 500, y: 912 })).toEqual({ before: 6 });
		expect(dropTargetAt(layout, { x: 500, y: 5000 })).toEqual({ before: 6 });
	});

	it('falls through a head to the row under it', () => {
		expect(dropTargetAt(layout, { x: 100, y: 10 })).toEqual({ before: 0 });
		expect(dropTargetAt(layout, { x: 100, y: 610 })).toEqual({ before: 4 });
	});

	it('is nowhere on an empty board', () => {
		expect(dropTargetAt(buildLayout({ groups: [], shown: 0 }, metrics), { x: 1, y: 1 })).toBeNull();
	});
});

describe('the narrative target of a move', () => {
	const ids = ['a', 'b', 'c', 'd'];

	it('puts the card before the one it lands on, counted without itself', () => {
		expect(moveTargetIndex(ids, 'd', 'b', false)).toBe(1);
		expect(moveTargetIndex(ids, 'a', 'c', false)).toBe(1);
	});

	it('moves to the end when it lands on nothing', () => {
		expect(moveTargetIndex(ids, 'a', null, false)).toBe(3);
	});

	it('reads a reversed board backwards: before means after, and the end means first', () => {
		expect(moveTargetIndex(ids, 'd', 'b', true)).toBe(2);
		expect(moveTargetIndex(ids, 'd', null, true)).toBe(0);
		expect(moveTargetIndex(ids, 'a', 'b', true)).toBe(1);
	});

	it.each([
		{ reversed: false, dragged: 'b', last: 'd', target: 3 },
		{ reversed: false, dragged: 'c', last: 'd', target: 3 },
		{ reversed: true, dragged: 'd', last: 'b', target: 1 },
		{ reversed: true, dragged: 'c', last: 'b', target: 1 },
	])('keeps an end drop inside the shown range: $dragged after $last, reversed $reversed', ({ reversed, dragged, last, target }) => {
		expect(moveTargetIndex(['a', 'b', 'c', 'd', 'e'], dragged, null, reversed, last)).toBe(target);
	});

	it.each([false, true])('does not move the last shown card beyond the range (reversed: %s)', (reversed) => {
		const last = reversed ? 'b' : 'd';
		expect(moveTargetIndex(['a', 'b', 'c', 'd', 'e'], last, null, reversed, last)).toBeNull();
		expect(moveTargetIndex(['a', 'b', 'c', 'd', 'e'], 'c', null, reversed, 'unknown')).toBeNull();
	});

	it('answers null when nothing would change or the card is unknown', () => {
		expect(moveTargetIndex(ids, 'b', 'c', false)).toBeNull();
		expect(moveTargetIndex(ids, 'd', null, false)).toBeNull();
		expect(moveTargetIndex(ids, 'a', null, true)).toBeNull();
		expect(moveTargetIndex(ids, 'b', 'b', false)).toBeNull();
		expect(moveTargetIndex(ids, 'z', 'a', false)).toBeNull();
		expect(moveTargetIndex(ids, 'a', 'z', false)).toBeNull();
	});
});

describe('where an inserted scene goes', () => {
	const ids = ['a', 'b', 'c', 'd'];

	it.each([false, true])('inserts at either side of every card (reversed: %s)', (reversed) => {
		const displayed = reversed ? [...ids].reverse() : ids;
		for (const [displayIndex, id] of displayed.entries()) {
			for (const side of ['before', 'after'] as const) {
				const after = insertBesideIndex(ids, id, side, reversed);
				expect(after).not.toBeNull();
				const updated = [...ids];
				updated.splice((after ?? -1) + 1, 0, 'new');
				const shown = reversed ? updated.reverse() : updated;
				const expected = [...displayed];
				expected.splice(displayIndex + (side === 'after' ? 1 : 0), 0, 'new');
				expect(shown).toEqual(expected);
			}
		}
	});

	it('represents narrative start as -1 and the end as the last index', () => {
		expect(insertBesideIndex(ids, 'a', 'before', false)).toBe(-1);
		expect(insertBesideIndex(ids, 'd', 'after', false)).toBe(3);
		expect(insertBesideIndex(ids, 'd', 'before', true)).toBe(3);
		expect(insertBesideIndex(ids, 'a', 'after', true)).toBe(-1);
	});

	it.each([false, true])('supports both ends of a single card (reversed: %s)', (reversed) => {
		expect(insertBesideIndex(['a'], 'a', 'before', reversed)).toBe(reversed ? 0 : -1);
		expect(insertBesideIndex(['a'], 'a', 'after', reversed)).toBe(reversed ? -1 : 0);
	});

	it('does not offer insertion beside an unknown card', () => {
		expect(insertBesideIndex(ids, 'z', 'before', false)).toBeNull();
		expect(insertBesideIndex(ids, 'z', 'after', true)).toBeNull();
		expect(insertBesideIndex([], 'a', 'before', false)).toBeNull();
	});
});

describe('visual neighbours', () => {
	it('steps by the eye, swapped on a reversed board and closed at the ends', () => {
		expect(visualNeighbours(0, 4, false)).toEqual({ up: null, down: 1 });
		expect(visualNeighbours(3, 4, false)).toEqual({ up: 2, down: null });
		expect(visualNeighbours(1, 4, false)).toEqual({ up: 0, down: 2 });
		expect(visualNeighbours(0, 4, true)).toEqual({ up: 1, down: null });
		expect(visualNeighbours(3, 4, true)).toEqual({ up: null, down: 2 });
		expect(visualNeighbours(0, 1, true)).toEqual({ up: null, down: null });
	});
});

describe('adjacency', () => {
	const rest = {
		filtered: false,
		query: '',
		group: '' as const,
		readOnly: false,
		anySceneReadOnly: false,
	};

	it('allows the neighbourly actions only in plain order with nothing searched, filtered, grouped or read-only', () => {
		expect(adjacencyAllowed(rest)).toBe(true);
		expect(adjacencyAllowed({ ...rest, query: '   ' })).toBe(true);
		expect(adjacencyAllowed({ ...rest, filtered: true })).toBe(false);
		expect(adjacencyAllowed({ ...rest, query: 'a' })).toBe(false);
		expect(adjacencyAllowed({ ...rest, group: 'pov' })).toBe(false);
		expect(adjacencyAllowed({ ...rest, readOnly: true })).toBe(false);
		expect(adjacencyAllowed({ ...rest, anySceneReadOnly: true })).toBe(false);
	});
});

describe('inline options', () => {
	it('offers omniscient, multi-POV and every character, and keeps a missing or empty point of view as a disabled choice', () => {
		expect(povOptions({ povPath: 'C/Ada.md', povName: 'Ada' }, characters, t)).toEqual([
			{ value: 'omniscient', label: 'modal.scene.povOmniscient', disabled: false },
			{ value: 'multiple', label: 'modal.scene.povMultiple', disabled: false },
			{ value: 'C/Ada.md', label: 'Ada', disabled: false },
			{ value: 'C/Bo.md', label: 'Bo', disabled: false },
		]);
		expect(povOptions({ povPath: '', povName: '' }, characters, t)[0]).toEqual({
			value: '',
			label: '',
			disabled: true,
		});
		const gone = povOptions({ povPath: 'C/Gone.md', povName: 'Gone' }, characters, t);
		expect(gone).toHaveLength(5);
		expect(gone[4]).toEqual({ value: 'C/Gone.md', label: 'Gone', disabled: true });
	});

	it('offers the four statuses, and a disabled empty choice while none is set', () => {
		expect(statusOptions('complete', t).map((option) => option.value)).toEqual([
			'not-started',
			'in-progress',
			'in-revision',
			'complete',
		]);
		const unset = statusOptions(null, t);
		expect(unset).toHaveLength(5);
		expect(unset[0]).toEqual({ value: '', label: '', disabled: true });
		expect(unset[1]?.label).toBe('status.not-started');
	});

	it("refuses a title another scene holds, case-folded, and accepts the scene's own", () => {
		const held = [
			{ id: 's1', title: 'One' },
			{ id: 's2', title: 'Two' },
		];
		expect(titleTaken('  one ', 's2', held)).toBe(true);
		expect(titleTaken('ONE', 's1', held)).toBe(false);
		expect(titleTaken('Three', 's1', held)).toBe(false);
	});

	it('carries the scene drag type the dashboard uses', () => {
		expect(SCENE_DRAG_TYPE).toBe('application/x-snowflake-scene');
	});
});
