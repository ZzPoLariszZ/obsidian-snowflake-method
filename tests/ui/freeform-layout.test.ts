import { describe, expect, it } from 'vitest';

import {
	FREEFORM_SIZE,
	newFreeformView,
	type FreeformEdge,
	type FreeformFrame,
	type FreeformPlacement,
	type FreeformView,
} from '../../src/domain';
import { CANVAS_FRAME_KIND } from '../../src/ui/freeform-canvas-port';
import {
	FREEFORM_CASCADE,
	FREEFORM_FACE_HEIGHTS,
	FREEFORM_GRID,
	FREEFORM_NODE_MIN,
	cornersOf,
	faceKindOf,
	faceModeOf,
	frameTone,
	grownForMode,
	grownHeight,
	laidOutAlike,
	landingAt,
	landingsAt,
	ownWordsCount,
	placeStepOf,
	plainFirstLine,
	sceneOf,
	viewSignature,
	type FreeformSceneWords,
} from '../../src/ui/freeform-layout';
import type { ResolvedNode } from '../../src/ui/freeform-resources';

const text = (id: string, words: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	id,
	resource: { type: 'text', text: words },
	x: 0,
	y: 0,
	width: 200,
	height: 100,
	displayMode: 'auto',
	zIndex: 0,
	frameId: null,
	...extra,
});

const link = (id: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	...text(id, ''),
	resource: { type: 'link', url: 'https://example.com/a', label: 'A' },
	...extra,
});

const frame = (id: string, extra: Partial<FreeformFrame> = {}): FreeformFrame => ({
	id, title: `Frame ${id}`, color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0, ...extra,
});

const edge = (id: string, source: string, target: string, extra: Partial<FreeformEdge> = {}): FreeformEdge => ({
	id, source, target, sourceSide: null, targetSide: null, label: '', arrow: 'end', line: 'solid', ...extra,
});

const view = (extra: Partial<FreeformView> = {}): FreeformView => ({
	...newFreeformView({ id: 'freeform-view-a', name: 'A', now: 1 }),
	...extra,
});

const words = (extra: Partial<FreeformSceneWords> = {}): FreeformSceneWords => ({
	resolve: (placement): ResolvedNode =>
		placement.resource.type === 'text'
			? { type: 'text', placement, text: placement.resource.text }
			: { type: 'link', placement, url: 'https://example.com/a', label: 'A', host: 'example.com' },
	label: (node) => (node.type === 'text' ? node.text : 'A'),
	frameLabel: (one) => one.title,
	revision: (node) => (node.type === 'text' ? node.text : 'link'),
	locked: () => false,
	connectable: false,
	...extra,
});

describe('the face a node shows', () => {
	it('shows the face the author chose, however near the canvas is looked at', () => {
		for (const band of ['far', 'compact', 'standard', 'extended'] as const) {
			expect(faceModeOf('compact', band)).toBe('compact');
			expect(faceModeOf('standard', band)).toBe('standard');
			expect(faceModeOf('extended', band)).toBe('extended');
		}
	});

	it('left to the canvas, shows the fullest face the size it is looked at allows', () => {
		expect(faceModeOf('auto', 'extended')).toBe('extended');
		expect(faceModeOf('auto', 'standard')).toBe('standard');
		expect(faceModeOf('auto', 'compact')).toBe('compact');
		// Far off a node shows its barest face, which is all that can be read there.
		expect(faceModeOf('auto', 'far')).toBe('compact');
	});

	it('left to the canvas, shows no fuller a face than its box has room for, so looking nearer sizes nothing', () => {
		const { scene, record } = FREEFORM_FACE_HEIGHTS;
		expect(faceModeOf('auto', 'extended', { kind: 'scene', height: scene.extended })).toBe('extended');
		expect(faceModeOf('auto', 'extended', { kind: 'scene', height: scene.extended - 1 })).toBe('standard');
		expect(faceModeOf('auto', 'extended', { kind: 'scene', height: scene.standard - 1 })).toBe('compact');
		expect(faceModeOf('auto', 'standard', { kind: 'record', height: record.standard })).toBe('standard');
		expect(faceModeOf('auto', 'standard', { kind: 'record', height: 10 })).toBe('compact');
		// The barest face is shown whatever the room, and a face chosen by hand is shown whatever the room.
		expect(faceModeOf('auto', 'compact', { kind: 'record', height: 1 })).toBe('compact');
		expect(faceModeOf('extended', 'extended', { kind: 'scene', height: 1 })).toBe('extended');
		// A text's and a plain face's fuller faces need no more room than the barest.
		expect(faceModeOf('auto', 'extended', { kind: 'text', height: 56 })).toBe('extended');
		expect(faceModeOf('auto', 'extended', { kind: 'plain', height: 48 })).toBe('extended');
	});

	it('knows which kind of face each kind of node shows', () => {
		expect(faceKindOf('scene')).toBe('scene');
		expect(faceKindOf('character')).toBe('record');
		expect(faceKindOf('worldbuilding')).toBe('record');
		expect(faceKindOf('text')).toBe('text');
		for (const type of ['task', 'foreshadowing', 'revision', 'sticky-note', 'file', 'link', 'pending', 'missing'] as const) {
			expect(faceKindOf(type), type).toBe('plain');
		}
	});

	it('grows a box to the face chosen for it by hand, and never shrinks it', () => {
		const { scene } = FREEFORM_FACE_HEIGHTS;
		expect(grownForMode('scene', 'extended', 100)).toBe(scene.extended);
		expect(grownForMode('scene', 'standard', 1_000)).toBe(1_000);
		expect(grownForMode('scene', 'compact', 100)).toBe(100);
		expect(grownForMode('record', 'auto', 10)).toBe(10);
		expect(grownForMode('text', 'extended', 10)).toBe(FREEFORM_FACE_HEIGHTS.text.extended);
	});
});

describe('a view said to the canvas', () => {
	it('says every frame first and every node after, each in the order it is painted', () => {
		const made = sceneOf(view({
			frames: [frame('f2', { zIndex: 3 }), frame('f1', { zIndex: 1 })],
			placements: [text('p3', 'three', { zIndex: 5 }), text('p1', 'one', { zIndex: 2 }), text('p2', 'two', { zIndex: 2 })],
		}), words());
		// Two that share a depth stand as the view keeps them.
		expect(made.scene.nodes.map((node) => node.id)).toEqual(['f1', 'f2', 'p1', 'p2', 'p3']);
		expect(made.scene.nodes.map((node) => node.z)).toEqual([1, 3, 2, 2, 5]);
		expect(made.scene.nodes.map((node) => node.kind)).toEqual([CANVAS_FRAME_KIND, CANVAS_FRAME_KIND, 'text', 'text', 'text']);
	});

	it('says a node where it stands, at its size, by what it is called and what it shows', () => {
		const placement = text('p1', 'Words', { x: 40, y: -20, width: 320, height: 180, zIndex: 4 });
		const made = sceneOf(view({ placements: [placement] }), words({
			label: () => 'Called',
			revision: () => 'Shown',
			locked: (id) => id === 'p1',
			connectable: true,
		}));
		expect(made.scene.nodes).toEqual([{
			id: 'p1', kind: 'text', x: 40, y: -20, width: 320, height: 180, z: 4, frame: null,
			revision: 'Shown', label: 'Called', tone: null, locked: true, connectable: true,
			minWidth: FREEFORM_NODE_MIN.width, minHeight: FREEFORM_NODE_MIN.height,
		}]);
		expect(made.nodes.get('p1')).toEqual({ type: 'text', placement, text: 'Words' });
	});

	it('says a frame by its title and its tint, which is a class and never a colour', () => {
		const tinted = frame('f1', { title: 'Act one', color: 'macaron-3' });
		const made = sceneOf(view({ frames: [tinted, frame('f2', { title: '' })] }), words({
			frameLabel: (one) => (one.title.length > 0 ? one.title : 'Untitled'),
		}));
		expect(made.scene.nodes.map((node) => [node.label, node.tone, node.frame])).toEqual([
			['Act one', 'is-tint-macaron-3', null],
			['Untitled', null, null],
		]);
		expect(made.frames.get('f1')).toBe(tinted);
		expect(frameTone({ color: null })).toBeNull();
		// A frame's title and its tint are what its face draws, so they are what moves its revision.
		const retitled = sceneOf(view({ frames: [{ ...tinted, title: 'Act two' }] }), words());
		const retinted = sceneOf(view({ frames: [{ ...tinted, color: 'macaron-4' }] }), words());
		const moved = sceneOf(view({ frames: [{ ...tinted, x: 900 }] }), words());
		const was = made.scene.nodes[0]!.revision;
		expect(retitled.scene.nodes[0]!.revision).not.toBe(was);
		expect(retinted.scene.nodes[0]!.revision).not.toBe(was);
		expect(moved.scene.nodes[0]!.revision).toBe(was);
	});

	it('gives a node to the frame that holds it, and to none where that frame has gone', () => {
		const made = sceneOf(view({
			frames: [frame('f1')],
			placements: [text('p1', 'in', { frameId: 'f1' }), text('p2', 'lost', { frameId: 'gone' }), text('p3', 'free')],
		}), words());
		expect(made.scene.nodes.slice(1).map((node) => node.frame)).toEqual(['f1', null, null]);
	});

	it('draws a line by the sides the view names, and chooses the sides it left open by where the two stand', () => {
		const made = sceneOf(view({
			placements: [
				text('left', 'l', { x: 0, y: 0 }),
				text('right', 'r', { x: 600, y: 0 }),
				text('below', 'b', { x: 0, y: 600 }),
			],
			edges: [
				edge('e1', 'left', 'right'),
				edge('e2', 'left', 'below'),
				edge('e3', 'right', 'left'),
				edge('e4', 'left', 'right', { sourceSide: 'top', targetSide: 'bottom', label: 'then', arrow: 'both', line: 'dashed' }),
				edge('e5', 'left', 'right', { sourceSide: 'top' }),
			],
		}), words());
		expect(made.scene.edges.map((one) => [one.id, one.fromSide, one.toSide])).toEqual([
			['e1', 'right', 'left'],
			['e2', 'bottom', 'top'],
			['e3', 'left', 'right'],
			['e4', 'top', 'bottom'],
			// The side named is kept; the one left open is chosen.
			['e5', 'top', 'left'],
		]);
		expect(made.scene.edges[3]).toMatchObject({ from: 'left', to: 'right', label: 'then', arrow: 'both', line: 'dashed' });
		expect(made.scene.edges[3]!.revision).not.toBe(made.scene.edges[0]!.revision);
	});

	it('draws no line whose end has gone, and a line to a frame as one to any node', () => {
		const made = sceneOf(view({
			frames: [frame('f1', { x: 900 })],
			placements: [text('p1', 'one')],
			edges: [edge('e1', 'p1', 'gone'), edge('e2', 'gone', 'p1'), edge('e3', 'p1', 'f1')],
		}), words());
		expect(made.scene.edges.map((one) => one.id)).toEqual(['e3']);
	});

	it('says the same view the same way, so a canvas told it twice draws nothing twice', () => {
		const held = view({ frames: [frame('f1')], placements: [text('p1', 'one', { frameId: 'f1' })], edges: [edge('e1', 'p1', 'f1')] });
		expect(sceneOf(held, words()).scene).toEqual(sceneOf(JSON.parse(JSON.stringify(held)) as FreeformView, words()).scene);
	});
});

describe('what a gesture that has ended asks of the view', () => {
	it('says every node moved or sized in one step', () => {
		expect(placeStepOf([
			{ kind: 'move', id: 'p1', x: 10, y: 20 },
			{ kind: 'resize', id: 'p2', x: 30, y: 40, width: 300, height: 200 },
		])).toEqual({
			do: 'place',
			places: [{ id: 'p1', x: 10, y: 20 }, { id: 'p2', x: 30, y: 40, width: 300, height: 200 }],
		});
	});

	it('gives a node to the frame it came to rest in, or sets it free, on the place it was moved to', () => {
		expect(placeStepOf([
			{ kind: 'move', id: 'p1', x: 10, y: 20 },
			{ kind: 'frame', id: 'p1', frame: 'f1' },
			{ kind: 'move', id: 'p2', x: 30, y: 40 },
			{ kind: 'frame', id: 'p2', frame: null },
			{ kind: 'move', id: 'p3', x: 50, y: 60 },
		])).toEqual({
			do: 'place',
			places: [
				{ id: 'p1', x: 10, y: 20, frameId: 'f1' },
				{ id: 'p2', x: 30, y: 40, frameId: null },
				// A node that kept its frame names none, so the frame it has is left alone.
				{ id: 'p3', x: 50, y: 60 },
			],
		});
	});

	it('says nothing for a gesture that left nothing to say', () => {
		expect(placeStepOf([])).toBeNull();
		// A word of a frame with no place to ride on is no change to a node's place.
		expect(placeStepOf([{ kind: 'frame', id: 'p1', frame: 'f1' }])).toBeNull();
	});
});

describe('where a new node lands', () => {
	it('stands its middle at the place named', () => {
		expect(landingAt([], { x: 500, y: 300 })).toEqual({
			x: 500 - FREEFORM_SIZE.width / 2,
			y: 300 - FREEFORM_SIZE.height / 2,
		});
		expect(landingAt([], { x: 0.4, y: -0.6 }, { width: 101, height: 51 })).toEqual({ x: -50, y: -26 });
	});

	it('steps aside from a node standing where it would land, and from the next', () => {
		const first = landingAt([], { x: 500, y: 300 });
		const second = landingAt([first], { x: 500, y: 300 });
		const third = landingAt([first, second], { x: 500, y: 300 });
		expect(second).toEqual({ x: first.x + FREEFORM_CASCADE, y: first.y + FREEFORM_CASCADE });
		expect(third).toEqual({ x: first.x + 2 * FREEFORM_CASCADE, y: first.y + 2 * FREEFORM_CASCADE });
		// One standing anywhere else is no reason to step aside.
		expect(landingAt([{ x: first.x + 1, y: first.y }], { x: 500, y: 300 })).toEqual(first);
	});

	it('lands on the grid while the switch is on, and steps aside along it', () => {
		const first = landingAt([], { x: 507, y: 293 }, FREEFORM_SIZE, FREEFORM_GRID);
		expect(first.x % FREEFORM_GRID).toBe(0);
		expect(first.y % FREEFORM_GRID).toBe(0);
		const second = landingAt([first], { x: 507, y: 293 }, FREEFORM_SIZE, FREEFORM_GRID);
		expect(second.x % FREEFORM_GRID).toBe(0);
		expect(second.x).toBeGreaterThan(first.x);
		expect(second.x - first.x).toBeGreaterThanOrEqual(FREEFORM_CASCADE);
	});

	it('gives up stepping aside rather than go on for ever', () => {
		const taken = Array.from({ length: 200 }, (_, index) => ({ x: index * FREEFORM_CASCADE, y: index * FREEFORM_CASCADE }));
		const landed = landingAt(taken, { x: FREEFORM_SIZE.width / 2, y: FREEFORM_SIZE.height / 2 });
		expect(Number.isFinite(landed.x)).toBe(true);
		expect(landed.x).toBe(40 * FREEFORM_CASCADE);
	});

	it('lands several at once, each a step from the last, stepping aside from what stands already', () => {
		const first = landingAt([], { x: 500, y: 300 });
		const landings = landingsAt([first], { x: 500, y: 300 }, 3);
		expect(landings).toEqual([
			{ x: first.x + FREEFORM_CASCADE, y: first.y + FREEFORM_CASCADE },
			{ x: first.x + 2 * FREEFORM_CASCADE, y: first.y + 2 * FREEFORM_CASCADE },
			{ x: first.x + 3 * FREEFORM_CASCADE, y: first.y + 3 * FREEFORM_CASCADE },
		]);
		expect(landingsAt([], { x: 500, y: 300 }, 0)).toEqual([]);
		// On the grid, each lands on it.
		const gridded = landingsAt([], { x: 507, y: 293 }, 2, FREEFORM_SIZE, FREEFORM_GRID);
		expect(gridded.every((landing) => landing.x % FREEFORM_GRID === 0 && landing.y % FREEFORM_GRID === 0)).toBe(true);
		expect(gridded[0]).not.toEqual(gridded[1]);
	});

	it('reads the corners of every node of a view, frames and all', () => {
		expect(cornersOf(view({
			frames: [frame('f1', { x: 1, y: 2 })],
			placements: [text('p1', 'one', { x: 3, y: 4 })],
		}))).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
	});

	it('grows a node to what its words need, and never makes it shorter than its author left it', () => {
		expect(grownHeight(160, 240.2)).toBe(241);
		expect(grownHeight(160, 100)).toBe(160);
		expect(grownHeight(160, 0)).toBe(160);
		expect(grownHeight(160, Number.NaN)).toBe(160);
		expect(grownHeight(160, 1_000_000)).toBe(FREEFORM_SIZE.max);
	});
});

describe('whether two readings lay out the same', () => {
	const shown = view({ placements: [text('p1', 'one')] });
	const other = view({ id: 'freeform-view-b', name: 'B', placements: [text('q1', 'one')] });
	const reparsed = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

	it('takes a file read again as the file it was', () => {
		const held = { views: [shown, other] };
		expect(laidOutAlike(held, held, shown.id)).toBe(true);
		expect(laidOutAlike(held, reparsed(held), shown.id)).toBe(true);
	});

	it('takes no notice of where a view was looked at from, nor of when it was changed', () => {
		const moved = { ...shown, viewport: { x: 40, y: 50, zoom: 2 }, updatedAt: 99 };
		expect(laidOutAlike({ views: [shown, other] }, { views: [moved, other] }, shown.id)).toBe(true);
		expect(viewSignature(moved)).toBe(viewSignature(shown));
	});

	it('sees the view on show change, and a view named again, made or gone', () => {
		const before = { views: [shown, other] };
		expect(laidOutAlike(before, { views: [{ ...shown, placements: [text('p1', 'two')] }, other] }, shown.id)).toBe(false);
		expect(laidOutAlike(before, { views: [{ ...shown, placements: [text('p1', 'one', { x: 1 })] }, other] }, shown.id)).toBe(false);
		expect(laidOutAlike(before, { views: [shown, { ...other, name: 'C' }] }, shown.id)).toBe(false);
		expect(laidOutAlike(before, { views: [shown] }, shown.id)).toBe(false);
		expect(laidOutAlike(before, { views: [other, shown] }, shown.id)).toBe(false);
	});

	it('takes no notice of what a view that is not on show holds', () => {
		const changed = { ...other, placements: [text('q1', 'another'), text('q2', 'more')] };
		expect(laidOutAlike({ views: [shown, other] }, { views: [shown, changed] }, shown.id)).toBe(true);
		// Shown, the same change is one to lay out.
		expect(laidOutAlike({ views: [shown, other] }, { views: [shown, changed] }, other.id)).toBe(false);
	});
});

describe('what a text node is called', () => {
	it('is called by the first of its words, passing over lines that hold none', () => {
		expect(plainFirstLine('First\nsecond', 80)).toBe('First');
		expect(plainFirstLine('\n   \n\tThird line  \nfourth', 80)).toBe('Third line');
		expect(plainFirstLine('', 80)).toBe('');
		expect(plainFirstLine('  \n\n', 80)).toBe('');
	});

	it('leaves out the marks its words are drawn by', () => {
		expect(plainFirstLine('## The heist', 80)).toBe('The heist');
		expect(plainFirstLine('###### Deep', 80)).toBe('Deep');
		expect(plainFirstLine('> quoted words', 80)).toBe('quoted words');
		expect(plainFirstLine('- a point', 80)).toBe('a point');
		expect(plainFirstLine('* another', 80)).toBe('another');
		expect(plainFirstLine('12. numbered', 80)).toBe('numbered');
		expect(plainFirstLine('- [ ] to do', 80)).toBe('to do');
		expect(plainFirstLine('- [x] done', 80)).toBe('done');
		expect(plainFirstLine('> - ## nested', 80)).toBe('nested');
		expect(plainFirstLine('Three **people**, *one* vault, `code` and ~~struck~~ ==lit==', 80))
			.toBe('Three people, one vault, code and struck lit');
	});

	it('calls a link by what it shows', () => {
		expect(plainFirstLine('See [[Arrival]] first', 80)).toBe('See Arrival first');
		expect(plainFirstLine('See [[Scenes/Arrival|the arrival]]', 80)).toBe('See the arrival');
		expect(plainFirstLine('Read [the site](https://example.com) now', 80)).toBe('Read the site now');
		expect(plainFirstLine('![[picture.png]]', 80)).toBe('picture.png');
	});

	it('passes over a line that is marks alone, and keeps a number that is no list', () => {
		expect(plainFirstLine('---\n## \nWords', 80)).toBe('---');
		expect(plainFirstLine('**\nWords', 80)).toBe('Words');
		expect(plainFirstLine('2026 was the year', 80)).toBe('2026 was the year');
		expect(plainFirstLine('#tag is no heading', 80)).toBe('#tag is no heading');
	});

	it('is cut to the length it is given', () => {
		expect(plainFirstLine('## ' + 'a'.repeat(200), 80)).toBe('a'.repeat(80));
	});

	it('keeps words of every script', () => {
		expect(plainFirstLine('## 第一章 **开端**', 80)).toBe('第一章 开端');
	});
});

describe('what a view holds of its own', () => {
	it('counts the nodes whose words live nowhere but on the view', () => {
		expect(ownWordsCount(view({
			placements: [
				text('p1', 'one'),
				link('p2'),
				{ ...text('p3', ''), resource: { type: 'entity', kind: 'scene', id: 's1', name: 'Arrival' } },
				{ ...text('p4', ''), resource: { type: 'file', path: 'Notes/a.md' } },
			],
		}))).toBe(2);
		expect(ownWordsCount(view())).toBe(0);
	});
});
