import { describe, expect, it } from 'vitest';

import type { CanvasData } from 'obsidian/canvas';

import {
	CANVAS_CARD_HEIGHT,
	CANVAS_CARD_WIDTH,
	CANVAS_COLOR_OF,
	CANVAS_TEXT_HEIGHT,
	MACARON_COLORS,
	beatSheetCanvas,
	canvasColorOf,
	canvasIdMint,
	canvasIdOf,
	freeformAutoSides,
	freeformCanvas,
	newFreeformView,
	sameCanvasContent,
	serializeCanvas,
	shownTimelines,
	timelineCanvas,
	type BeatSheet,
	type CanvasExportWords,
	type CanvasNoteRef,
	type FreeformCanvasResolver,
	type FreeformEdge,
	type FreeformFrame,
	type FreeformPlacement,
	type FreeformResource,
	type FreeformView,
	type Timeline,
	type TimelineCanvasResolver,
	type TimelineView,
} from '../../src/domain';

const id = canvasIdOf;

const words: CanvasExportWords = {
	missing: (of, kind) => `missing:${of}:${kind}`,
	lastSeen: (name) => `lastSeen:${name}`,
	missingScene: 'missing:scene',
	missingTime: 'missing:time',
	untitledBeat: 'untitled:beat',
	actTitle: (number, label) => (label.length === 0 ? `Act ${String(number)}` : `Act ${String(number)} - ${label}`),
	recordKind: (type) => `kind:${type}`,
};

// -- Freeform fixtures ---------------------------------------------------------

const text = (id: string): FreeformResource => ({ type: 'text', text: `words of ${id}` });
const scene = (id: string, name = id): FreeformResource => ({ type: 'entity', kind: 'scene', id, name });

const placement = (id: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	id, resource: text(id), x: 0, y: 0, width: 100, height: 60, displayMode: 'auto', zIndex: 0, frameId: null, ...extra,
});
const frame = (id: string, extra: Partial<FreeformFrame> = {}): FreeformFrame => ({
	id, title: `Frame ${id}`, color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0, ...extra,
});
const edge = (id: string, source: string, target: string, extra: Partial<FreeformEdge> = {}): FreeformEdge => ({
	id, source, target, sourceSide: null, targetSide: null, label: '', arrow: 'end', line: 'solid', ...extra,
});
const view = (extra: Partial<FreeformView> = {}): FreeformView => ({
	...newFreeformView({ id: 'v', name: 'View', now: 1 }), ...extra,
});

const notes: Record<string, CanvasNoteRef> = {
	s1: { path: 'P/40_Scene/One.md', color: 'macaron-2' },
	c1: { path: 'P/20_Character/Ada.md', color: null },
};
const resolve: FreeformCanvasResolver = {
	entity: (id) => notes[id] ?? null,
	stickyNote: (id) => (id === 'n1' ? { path: 'P/70_Tool/72_Task_Management/724_Sticky_Note/a.md', color: 'macaron-5' } : null),
	record: (type, id) => (type === 'task' && id === 'k' ? 'Do it' : type === 'revision' && id === 'blank' ? '' : null),
	file: (path) => `P/${path}`,
};

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const card = (x: number, y: number) => box(x, y, CANVAS_CARD_WIDTH, CANVAS_CARD_HEIGHT);
const wordsBox = (x: number, y: number) => box(x, y, CANVAS_CARD_WIDTH, CANVAS_TEXT_HEIGHT);

describe('colour', () => {
	it('puts every macaron on a preset by its hue, and no colour on no key', () => {
		expect(CANVAS_COLOR_OF).toEqual({
			'macaron-1': '1', 'macaron-2': '2', 'macaron-3': '3', 'macaron-4': '4',
			'macaron-5': '5', 'macaron-6': '5', 'macaron-7': '6', 'macaron-8': '6',
		});
		for (const color of MACARON_COLORS) expect(canvasColorOf(color)).toBe(CANVAS_COLOR_OF[color]);
		expect(canvasColorOf(null)).toBeUndefined();
	});
});

describe('ids', () => {
	it('derives sixteen hex digits from a key, the same every time and different for another', () => {
		expect(id('node:a')).toMatch(/^[0-9a-f]{16}$/u);
		expect(id('node:a')).toBe(id('node:a'));
		expect(id('node:a')).not.toBe(id('node:b'));
	});

	it('re-keys a collision the same way each time', () => {
		const clashing = (key: string): string => (key.startsWith('a') && !key.includes('#') ? 'same' : key);
		const first = canvasIdMint(clashing);
		const second = canvasIdMint(clashing);
		expect([first('a1'), first('a2'), first('b')]).toEqual(['same', 'a2#2', 'b']);
		expect([second('a1'), second('a2'), second('b')]).toEqual(['same', 'a2#2', 'b']);
	});
});

describe('the file', () => {
	const data: CanvasData = {
		nodes: [
			{ id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300, color: '4', label: 'Frame' },
			{ id: 'f', type: 'file', file: 'P/40_Scene/One.md', x: 10, y: 20, width: 256, height: 240, color: '2' },
			{ id: 't', type: 'text', text: 'One\nTwo', x: 0, y: 0, width: 256, height: 96 },
			{ id: 'l', type: 'link', url: 'https://example.com', x: 1, y: 2, width: 3, height: 4 },
		],
		edges: [{ id: 'e', fromNode: 'f', fromSide: 'right', toNode: 't', toSide: 'left', toEnd: 'none', label: 'leads' }],
	};

	it('writes the shape Obsidian writes: one record a line, tabs, its key order, no newline at the end', () => {
		expect(serializeCanvas(data)).toBe(
			'{\n\t"nodes":[\n'
			+ '\t\t{"id":"g","type":"group","x":0,"y":0,"width":400,"height":300,"color":"4","label":"Frame"},\n'
			+ '\t\t{"id":"f","type":"file","file":"P/40_Scene/One.md","x":10,"y":20,"width":256,"height":240,"color":"2"},\n'
			+ '\t\t{"id":"t","type":"text","text":"One\\nTwo","x":0,"y":0,"width":256,"height":96},\n'
			+ '\t\t{"id":"l","type":"link","url":"https://example.com","x":1,"y":2,"width":3,"height":4}\n'
			+ '\t],\n\t"edges":[\n'
			+ '\t\t{"id":"e","fromNode":"f","fromSide":"right","toNode":"t","toSide":"left","toEnd":"none","label":"leads"}\n'
			+ '\t]\n}',
		);
		expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
	});

	it('reads a file Obsidian saved again, metadata and all, as saying the same', () => {
		const resaved = '{\n\t"nodes":[\n\t\t{"id":"t","type":"text","text":"Hi","x":0,"y":0,"width":256,"height":96}\n\t],\n'
			+ '\t"edges":[],\n\t"metadata":{\n\t\t"version":"1.0-1.0",\n\t\t"frontmatter":{}\n\t}\n}';
		const held: CanvasData = { nodes: [{ id: 't', type: 'text', text: 'Hi', x: 0, y: 0, width: 256, height: 96 }], edges: [] };
		expect(sameCanvasContent(resaved, held)).toBe(true);
		expect(sameCanvasContent(JSON.stringify({ edges: [], nodes: [{ x: 0, y: 0, id: 't', height: 96, width: 256, text: 'Hi', type: 'text' }] }, null, 2), held)).toBe(true);
		expect(sameCanvasContent('{}', { nodes: [], edges: [] })).toBe(true);
	});

	it('reads the nodes and edges in whatever order Obsidian wrote them back', () => {
		const held: CanvasData = {
			nodes: [
				{ id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 300, label: 'Frame' },
				{ id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 256, height: 96 },
				{ id: 'b', type: 'text', text: 'B', x: 300, y: 0, width: 256, height: 96 },
			],
			edges: [
				{ id: 'e1', fromNode: 'a', toNode: 'b' },
				{ id: 'e2', fromNode: 'b', toNode: 'g' },
			],
		};
		const shuffled = JSON.stringify({ nodes: [held.nodes[1], held.nodes[2], held.nodes[0]], edges: [held.edges[1], held.edges[0]] });
		expect(sameCanvasContent(shuffled, held)).toBe(true);
		const oneGone = JSON.stringify({ nodes: [held.nodes[1], held.nodes[0]], edges: held.edges });
		expect(sameCanvasContent(oneGone, held)).toBe(false);
	});

	it('lets a picture or a player keep the height Obsidian gave it, and counts every other size', () => {
		const held: CanvasData = {
			nodes: [
				{ id: 'p', type: 'file', file: 'P/80_Material/Figure file.PNG', x: 0, y: 0, width: 800, height: 500 },
				{ id: 'v', type: 'file', file: 'P/80_Material/Video file.mov', x: 0, y: 600, width: 800, height: 500 },
				{ id: 'n', type: 'file', file: 'P/40_Scene/One.md', x: 900, y: 0, width: 256, height: 240 },
			],
			edges: [],
		};
		const fitted = JSON.stringify({ nodes: [{ ...held.nodes[0]!, height: 450 }, { ...held.nodes[1]!, height: 450 }, held.nodes[2]!], edges: [] });
		expect(sameCanvasContent(fitted, held)).toBe(true);
		const widened = JSON.stringify({ nodes: [{ ...held.nodes[0]!, width: 400 }, held.nodes[1]!, held.nodes[2]!], edges: [] });
		expect(sameCanvasContent(widened, held)).toBe(false);
		const noteGrown = JSON.stringify({ nodes: [held.nodes[0]!, held.nodes[1]!, { ...held.nodes[2]!, height: 300 }], edges: [] });
		expect(sameCanvasContent(noteGrown, held)).toBe(false);
	});

	it('tells a changed node apart, and text that is no canvas', () => {
		const held: CanvasData = { nodes: [{ id: 't', type: 'text', text: 'Hi', x: 0, y: 0, width: 256, height: 96 }], edges: [] };
		expect(sameCanvasContent(serializeCanvas({ ...held, nodes: [{ ...held.nodes[0]!, x: 1 }] }), held)).toBe(false);
		expect(sameCanvasContent(serializeCanvas(held), { ...held, edges: [{ id: 'e', fromNode: 't', toNode: 't' }] })).toBe(false);
		expect(sameCanvasContent('not json', held)).toBe(false);
		expect(sameCanvasContent('[]', { nodes: [], edges: [] })).toBe(false);
	});
});

describe('a freeform view', () => {
	const laid = view({
		frames: [frame('f1', { zIndex: 1, color: 'macaron-4', x: 10, y: 10 }), frame('f2', { title: '' })],
		placements: [
			placement('t1', { zIndex: 0 }),
			placement('k1', { resource: { type: 'task', id: 'k', name: 'Do' }, zIndex: 1 }),
			placement('s1', { resource: scene('s1'), zIndex: 2, x: 300, width: 100 }),
			placement('l1', { resource: { type: 'link', url: 'https://example.com', label: 'Example' }, zIndex: 3 }),
			placement('p1', { resource: { type: 'file', path: '80_Material/map.png' }, zIndex: 4 }),
			placement('n1', { resource: { type: 'sticky-note', id: 'n1', name: 'Note' }, zIndex: 5 }),
			placement('m1', { resource: scene('gone', 'Old'), zIndex: 6 }),
			placement('m2', { resource: { type: 'sticky-note', id: 'gone', name: ' ' }, zIndex: 7 }),
		],
		edges: [
			edge('e1', 's1', 't1'),
			edge('e2', 'f1', 's1', { sourceSide: 'bottom', targetSide: 'top', arrow: 'both', label: 'holds', line: 'dashed' }),
			edge('e3', 'k1', 's1', { line: 'dotted' }),
			edge('e4', 's1', 'nobody'),
		],
	});

	it('paints the frames as groups under every placement, each band low to high', () => {
		const { nodes } = freeformCanvas(laid, resolve, words);
		expect(nodes.map((node) => node.id)).toEqual([
			id('frame:f2'), id('frame:f1'),
			id('node:t1'), id('node:k1'), id('node:s1'), id('node:l1'), id('node:p1'), id('node:n1'), id('node:m1'), id('node:m2'),
		]);
		expect(nodes[0]).toStrictEqual({ id: id('frame:f2'), type: 'group', x: 0, y: 0, width: 400, height: 300 });
		expect(nodes[1]).toStrictEqual({ id: id('frame:f1'), type: 'group', x: 10, y: 10, width: 400, height: 300, color: '4', label: 'Frame f1' });
	});

	it('names a note by its path with its tint, keeps words, addresses and files, and says a task by its kind and title', () => {
		const { nodes } = freeformCanvas(laid, resolve, words);
		expect(nodes[2]).toStrictEqual({ id: id('node:t1'), type: 'text', text: 'words of t1', x: 0, y: 0, width: 100, height: 60 });
		expect(nodes[3]).toStrictEqual({ id: id('node:k1'), type: 'text', text: '**kind:task**\n\nDo it', x: 0, y: 0, width: 100, height: 60 });
		expect(nodes[4]).toStrictEqual({ id: id('node:s1'), type: 'file', file: 'P/40_Scene/One.md', x: 300, y: 0, width: 100, height: 60, color: '2' });
		expect(nodes[5]).toStrictEqual({ id: id('node:l1'), type: 'link', url: 'https://example.com', x: 0, y: 0, width: 100, height: 60 });
		expect(nodes[6]).toStrictEqual({ id: id('node:p1'), type: 'file', file: 'P/80_Material/map.png', x: 0, y: 0, width: 100, height: 60 });
		expect(nodes[7]).toStrictEqual({
			id: id('node:n1'), type: 'file', file: 'P/70_Tool/72_Task_Management/724_Sticky_Note/a.md', x: 0, y: 0, width: 100, height: 60, color: '5',
		});
	});

	it('stands in for a note or a record that has gone with what it was and what it was last called', () => {
		const { nodes } = freeformCanvas(laid, resolve, words);
		expect(nodes[8]).toStrictEqual({ id: id('node:m1'), type: 'text', text: 'missing:entity:scene\n\nlastSeen:Old', x: 0, y: 0, width: 100, height: 60 });
		expect(nodes[9]).toStrictEqual({ id: id('node:m2'), type: 'text', text: 'missing:sticky-note:sticky-note', x: 0, y: 0, width: 100, height: 60 });
		const records = freeformCanvas(view({ placements: [
			placement('g1', { resource: { type: 'foreshadowing', id: 'gone', name: 'Old thread' } }),
			placement('r1', { resource: { type: 'revision', id: 'blank', name: 'Was' }, x: 200 }),
		] }), resolve, words);
		expect(records.nodes.map((node) => node.type === 'text' ? node.text : node.type)).toEqual([
			'missing:foreshadowing:foreshadowing\n\nlastSeen:Old thread',
			'**kind:revision**',
		]);
	});

	it('keeps every edge with the sides chosen or the engine’s, its arrowheads and its label, a dashed one to a task included, and drops one whose end names nothing', () => {
		const { edges } = freeformCanvas(laid, resolve, words);
		expect(edges).toStrictEqual([
			{ id: id('edge:e1'), fromNode: id('node:s1'), fromSide: 'left', toNode: id('node:t1'), toSide: 'right' },
			{ id: id('edge:e2'), fromNode: id('frame:f1'), fromSide: 'bottom', fromEnd: 'arrow', toNode: id('node:s1'), toSide: 'top', label: 'holds' },
			{ id: id('edge:e3'), fromNode: id('node:k1'), fromSide: 'right', toNode: id('node:s1'), toSide: 'left' },
		]);
	});

	it('marks each kind of arrow as the canvas does', () => {
		const ends = (arrow: FreeformEdge['arrow']) => {
			const { edges } = freeformCanvas(
				view({ placements: [placement('a'), placement('b', { x: 500 })], edges: [edge('e', 'a', 'b', { arrow })] }),
				resolve,
				words,
			);
			const { fromEnd, toEnd } = edges[0]!;
			return { fromEnd, toEnd };
		};
		expect(ends('none')).toEqual({ fromEnd: undefined, toEnd: 'none' });
		expect(ends('start')).toEqual({ fromEnd: 'arrow', toEnd: 'none' });
		expect(ends('end')).toEqual({ fromEnd: undefined, toEnd: undefined });
		expect(ends('both')).toEqual({ fromEnd: 'arrow', toEnd: undefined });
	});

	it('chooses the sides across when the two stand further apart across than down, and across on a tie', () => {
		const at = (x: number, y: number) => box(x, y, 10, 10);
		expect(freeformAutoSides(at(0, 0), at(100, 0))).toEqual({ fromSide: 'right', toSide: 'left' });
		expect(freeformAutoSides(at(100, 0), at(0, 0))).toEqual({ fromSide: 'left', toSide: 'right' });
		expect(freeformAutoSides(at(0, 0), at(0, 100))).toEqual({ fromSide: 'bottom', toSide: 'top' });
		expect(freeformAutoSides(at(0, 100), at(0, 0))).toEqual({ fromSide: 'top', toSide: 'bottom' });
		expect(freeformAutoSides(at(0, 0), at(50, 50))).toEqual({ fromSide: 'right', toSide: 'left' });
	});

	it('makes the same canvas twice, with no key left undefined', () => {
		const once = freeformCanvas(laid, resolve, words);
		expect(freeformCanvas(laid, resolve, words)).toStrictEqual(once);
		for (const record of [...once.nodes, ...once.edges]) {
			expect(Object.values(record).every((value) => value !== undefined)).toBe(true);
		}
		expect(freeformCanvas(view(), resolve, words)).toStrictEqual({ nodes: [], edges: [] });
	});
});

// -- Timeline fixtures ---------------------------------------------------------

const lane = (id: string, times: Timeline['times'], extra: Partial<Timeline> = {}): Timeline => ({
	id, name: `Lane ${id}`, binding: null, times, createdAt: 7, updatedAt: 7, ...extra,
});
const timelineView = (extra: Partial<TimelineView> = {}): TimelineView => ({
	id: 'v', name: 'View', timelines: ['A', 'B'], timeOrder: ['t1', 't2'], presentation: 'flat', cardStyle: null,
	showSubDescriptions: true, timesReversed: false, createdAt: 7, updatedAt: 7, ...extra,
});
const A = lane('A', [
	{ timeId: 't1', rows: [{ id: 'r1', text: 'First', scenes: ['s1', 's2'] }] },
	{ timeId: 't2', rows: [{ id: 'r2', text: '', scenes: ['s3'] }] },
]);
const B = lane('B', [{ timeId: 't1', rows: [{ id: 'r3', text: 'Also', scenes: [] }] }]);
const held = { timelines: [A, B], pinnedTimelineId: null };
const sceneNotes: Record<string, CanvasNoteRef> = {
	s1: { path: 'S1.md', color: 'macaron-1' },
	s2: { path: 'S2.md', color: null },
};
const timeResolve: TimelineCanvasResolver = {
	scene: (id) => sceneNotes[id] ?? null,
	time: (id) => (id === 't1' ? { path: 'T1.md', color: 'macaron-7' } : null),
};
const canonical = ['t1', 't2'];

describe('a timeline view', () => {
	it('stands the times down a column and one group a lane beside them, the lane as wide as its widest row', () => {
		const { nodes, edges } = timelineCanvas(timelineView(), held, canonical, timeResolve, words);
		expect(edges).toEqual([]);
		expect(nodes).toStrictEqual([
			{ id: id('lane:A'), type: 'group', x: 480, y: 0, width: 1360, height: 720, label: 'Lane A' },
			{ id: id('lane:B'), type: 'group', x: 1920, y: 0, width: 480, height: 720, label: 'Lane B' },
			{ id: id('time:t1'), type: 'file', file: 'T1.md', ...card(0, 40), color: '6' },
			{ id: id('row:A:r1'), type: 'text', text: 'First', ...wordsBox(520, 40) },
			{ id: id('scene:A:s1'), type: 'file', file: 'S1.md', ...card(960, 40), color: '1' },
			{ id: id('scene:A:s2'), type: 'file', file: 'S2.md', ...card(1400, 40) },
			{ id: id('row:B:r3'), type: 'text', text: 'Also', ...wordsBox(1960, 40) },
			{ id: id('time:t2'), type: 'text', text: 'missing:time', ...card(0, 380) },
			{ id: id('scene:A:s3'), type: 'text', text: 'missing:scene', ...card(520, 380) },
		]);
	});

	it('takes none of the screen’s switches: words hidden, scenes stacked or times turned about change nothing', () => {
		const plain = timelineCanvas(timelineView(), held, canonical, timeResolve, words);
		const switched = timelineCanvas(
			timelineView({ presentation: 'stack', showSubDescriptions: false, timesReversed: true }),
			held, canonical, timeResolve, words,
		);
		expect(switched).toStrictEqual(plain);
	});

	it('reads a row’s height off its tallest cell', () => {
		const tall = { timelines: [lane('T', [{ timeId: 't1', rows: [
			{ id: 'r1', text: 'One', scenes: [] },
			{ id: 'r2', text: 'Two', scenes: ['s1'] },
		] }]), B], pinnedTimelineId: null };
		const { nodes } = timelineCanvas(timelineView({ timelines: ['T', 'B'] }), tall, canonical, timeResolve, words);
		expect(nodes.slice(0, 2).map((node) => [node.id, node.height])).toEqual([[id('lane:T'), 40 + (120 + 40 + 300) + 40], [id('lane:B'), 540]]);
		expect(nodes.find((node) => node.id === id('row:T:r2'))).toMatchObject(wordsBox(520, 200));
		expect(nodes.find((node) => node.id === id('scene:T:s1'))).toMatchObject(card(960, 200));
	});

	it('stands the pinned lane first, and runs the times in the order the view keeps', () => {
		const pinned = timelineCanvas(timelineView(), { ...held, pinnedTimelineId: 'B' }, canonical, timeResolve, words);
		expect(pinned.nodes.slice(0, 2).map((node) => [node.id, node.x])).toEqual([[id('lane:B'), 480], [id('lane:A'), 1040]]);
		expect(shownTimelines({ timelines: ['A', 'gone', 'B'] }, { ...held, pinnedTimelineId: 'B' }).map((shown) => shown.id)).toEqual(['B', 'A']);
		const ordered = timelineCanvas(timelineView({ timeOrder: ['t2', 't1'] }), held, canonical, timeResolve, words);
		expect(ordered.nodes.filter((node) => node.id === id('time:t2') || node.id === id('time:t1')).map((node) => [node.id, node.y]))
			.toEqual([[id('time:t2'), 40], [id('time:t1'), 380]]);
	});

	it('writes no words for a row that has none, and a row with nothing to show takes no room', () => {
		const { nodes } = timelineCanvas(timelineView(), held, canonical, timeResolve, words);
		expect(nodes.map((node) => node.id)).not.toContain(id('row:A:r2'));
		const bare = { timelines: [lane('E', [{ timeId: 't1', rows: [{ id: 'r0', text: '  ', scenes: [] }] }])], pinnedTimelineId: null };
		const { nodes: none } = timelineCanvas(timelineView({ timelines: ['E'] }), bare, canonical, timeResolve, words);
		expect(none.map((node) => node.id)).toEqual([id('lane:E'), id('time:t1')]);
		expect(none[0]).toMatchObject({ width: 480, height: 380 });
	});

	it('stands a scene placed on two lanes twice, an empty lane as a label alone, and an empty view as nothing', () => {
		const twice = { timelines: [A, lane('C', [{ timeId: 't1', rows: [{ id: 'r9', text: '', scenes: ['s1'] }] }])], pinnedTimelineId: null };
		const { nodes } = timelineCanvas(timelineView({ timelines: ['A', 'C'] }), twice, canonical, timeResolve, words);
		expect(nodes.filter((node) => node.type === 'file' && node.file === 'S1.md').map((node) => node.id))
			.toEqual([id('scene:A:s1'), id('scene:C:s1')]);
		const bare = timelineCanvas(timelineView({ timelines: ['D'] }), { timelines: [lane('D', [])], pinnedTimelineId: null }, [], timeResolve, words);
		expect(bare.nodes).toStrictEqual([{ id: id('lane:D'), type: 'group', x: 480, y: 0, width: 480, height: 80, label: 'Lane D' }]);
		expect(timelineCanvas(timelineView({ timelines: [] }), held, canonical, timeResolve, words)).toStrictEqual({ nodes: [], edges: [] });
	});
});

// -- Beat sheet fixtures -------------------------------------------------------

const sheet = (extra: Partial<BeatSheet> = {}): BeatSheet => ({
	id: 's',
	name: 'Sheet',
	acts: [
		{
			id: 'a1',
			label: 'Setup',
			beats: [
				{ id: 'b1', name: 'Opening', description: 'Start ', rows: [{ id: 'r1', text: 'Row', scenes: ['s1'] }] },
				{ id: 'b2', name: ' ', description: '', rows: [] },
			],
		},
		{ id: 'a2', label: '', beats: [{ id: 'b3', name: 'End', description: '', rows: [{ id: 'r2', text: '', scenes: ['s2', 's3'] }] }] },
	],
	presentation: null,
	showSubDescriptions: true,
	reversed: false,
	createdAt: 7,
	updatedAt: 7,
	...extra,
});
const beatResolve = {
	scene: (id: string): CanvasNoteRef | null =>
		id === 's1' ? { path: 'S1.md', color: 'macaron-3' } : id === 's2' ? { path: 'S2.md', color: null } : null,
};

describe('a beat sheet', () => {
	it('stacks the acts as groups of one width, each beat a band with its words at the left and its rows beside', () => {
		const { nodes, edges } = beatSheetCanvas(sheet(), beatResolve, words);
		expect(edges).toEqual([]);
		expect(nodes).toStrictEqual([
			{ id: id('act:a1'), type: 'group', x: 0, y: 0, width: 1360, height: 720, label: 'Act 1 - Setup' },
			{ id: id('act:a2'), type: 'group', x: 0, y: 800, width: 1360, height: 380, label: 'Act 2' },
			{ id: id('beat:b1'), type: 'text', text: '## Opening\n\nStart', ...card(40, 40) },
			{ id: id('row:r1'), type: 'text', text: 'Row', ...wordsBox(480, 40) },
			{ id: id('scene:s1'), type: 'file', file: 'S1.md', ...card(920, 40), color: '3' },
			{ id: id('beat:b2'), type: 'text', text: '## untitled:beat', ...card(40, 380) },
			{ id: id('beat:b3'), type: 'text', text: '## End', ...card(40, 840) },
			{ id: id('scene:s2'), type: 'file', file: 'S2.md', ...card(480, 840) },
			{ id: id('scene:s3'), type: 'text', text: 'missing:scene', ...card(920, 840) },
		]);
	});

	it('takes none of the screen’s switches: a sheet shown from its end, stacked or with its words hidden exports the same', () => {
		const plain = beatSheetCanvas(sheet(), beatResolve, words);
		expect(beatSheetCanvas(sheet({ reversed: true, presentation: 'stack', showSubDescriptions: false }), beatResolve, words)).toStrictEqual(plain);
	});
});
