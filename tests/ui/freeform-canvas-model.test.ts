import { describe, expect, it } from 'vitest';

import {
	CANVAS_EDGE_Z,
	CANVAS_FIT_PADDING,
	autoSides,
	boundsOf,
	canvasDepth,
	centreOf,
	centredOn,
	fitViewport,
	frameAt,
	gestureChanges,
	handleBoxes,
	hasUntold,
	isViewport,
	nearestSide,
	reconcileEdges,
	reconcileNodes,
	reduceEdgeChanges,
	reduceNodeChanges,
	sameSelection,
	selectionOf,
	sideMiddle,
	snapSized,
	snappedToObjects,
	steppedViewport,
	wheelZoomFactor,
	withSelection,
	zoomBandOf,
	zoomPercent,
	zoomStep,
	zoomedAbout,
} from '../../src/ui/freeform-canvas-model';
import type {
	CanvasEdge,
	CanvasHeldEdge,
	CanvasHeldNode,
	CanvasNode,
	ZoomBand,
} from '../../src/ui/freeform-canvas-port';

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
	id, kind: 'text', x: 0, y: 0, width: 100, height: 60, z: 0, frame: null, revision: 'r1', label: id,
	tone: null, locked: false, connectable: true, minWidth: 32, minHeight: 32, ...extra,
});
const frame = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode =>
	node(id, { kind: 'frame', width: 400, height: 300, ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<CanvasEdge> = {}): CanvasEdge => ({
	id, from, fromSide: 'right', to, toSide: 'left', label: '', name: `${from} to ${to}`, arrow: 'end', line: 'solid', revision: 'r1', ...extra,
});
const hold = (nodes: readonly CanvasNode[]): readonly CanvasHeldNode[] => reconcileNodes([], nodes);
const bounds = { min: 0.1, max: 4 };

describe('depth', () => {
	it('stands every frame under the lines and every other node over them', () => {
		expect(canvasDepth(frame('f', { z: 49 }))).toBeLessThan(CANVAS_EDGE_Z);
		expect(canvasDepth(node('n', { z: 0 }))).toBeGreaterThan(CANVAS_EDGE_Z);
		expect(canvasDepth(node('n', { z: 3 }))).toBeGreaterThan(canvasDepth(node('m', { z: 2 })));
		expect(canvasDepth(frame('f', { z: 3 }))).toBeGreaterThan(canvasDepth(frame('g', { z: 2 })));
	});
});

describe('the sides a line leaves by', () => {
	it('stands a handle just inside the middle of each side, so a line ends on the side itself', () => {
		const boxes = handleBoxes(200, 80);
		expect(boxes.map((box) => box.side)).toEqual(['top', 'right', 'bottom', 'left']);
		// As the engine reads a line's end off a handle: the head, the far edge, the foot, the near edge.
		const ends = boxes.map((box) => {
			if (box.side === 'top') return [box.x + box.width / 2, box.y];
			if (box.side === 'right') return [box.x + box.width, box.y + box.height / 2];
			if (box.side === 'bottom') return [box.x + box.width / 2, box.y + box.height];
			return [box.x, box.y + box.height / 2];
		});
		expect(ends).toEqual([[100, 0], [200, 40], [100, 80], [0, 40]]);
	});

	it('chooses across for two that stand further apart across than down, else down', () => {
		const at = (x: number, y: number) => ({ x, y, width: 100, height: 60 });
		expect(autoSides(at(0, 0), at(500, 100))).toEqual({ fromSide: 'right', toSide: 'left' });
		expect(autoSides(at(500, 0), at(0, 100))).toEqual({ fromSide: 'left', toSide: 'right' });
		expect(autoSides(at(0, 0), at(100, 500))).toEqual({ fromSide: 'bottom', toSide: 'top' });
		expect(autoSides(at(0, 500), at(100, 0))).toEqual({ fromSide: 'top', toSide: 'bottom' });
		expect(autoSides(at(0, 0), at(0, 0))).toEqual({ fromSide: 'right', toSide: 'left' });
	});

	it('stands the middle of each side where the engine ends a line by it', () => {
		const box = { x: 10, y: 20, width: 200, height: 80 };
		expect(sideMiddle(box, 'top')).toEqual({ x: 110, y: 20 });
		expect(sideMiddle(box, 'right')).toEqual({ x: 210, y: 60 });
		expect(sideMiddle(box, 'bottom')).toEqual({ x: 110, y: 100 });
		expect(sideMiddle(box, 'left')).toEqual({ x: 10, y: 60 });
	});

	it('lands a line let go on a node by the side whose middle stands nearest, the head and the right first where two stand as near', () => {
		const wide = { x: 0, y: 0, width: 400, height: 100 };
		expect(nearestSide(wide, { x: 390, y: 50 })).toBe('right');
		expect(nearestSide(wide, { x: 10, y: 50 })).toBe('left');
		expect(nearestSide(wide, { x: 200, y: 10 })).toBe('top');
		expect(nearestSide(wide, { x: 200, y: 90 })).toBe('bottom');
		// Towards the end of a wide box the end's own side is taken, though the drop stands at the head's edge.
		expect(nearestSide(wide, { x: 350, y: 5 })).toBe('right');
		expect(nearestSide(wide, { x: 250, y: 5 })).toBe('top');
		// The very middle stands as near to the head as to the foot: the head.
		expect(nearestSide(wide, { x: 200, y: 50 })).toBe('top');
		// A tall box's middle stands as near to the right as to the left: the right.
		expect(nearestSide({ x: 0, y: 0, width: 100, height: 400 }, { x: 50, y: 200 })).toBe('right');
		// A point beyond the box is read the same way.
		expect(nearestSide(wide, { x: 500, y: 50 })).toBe('right');
		// Where the box stands matters as much as its size.
		expect(nearestSide({ x: 1_000, y: 1_000, width: 400, height: 100 }, { x: 1_010, y: 1_050 })).toBe('left');
	});
});

describe('bringing what is held level with what stands', () => {
	it('holds a node that is new where the view has it, not chosen', () => {
		expect(hold([node('a', { x: 5, y: 6 })])).toEqual([
			{ node: node('a', { x: 5, y: 6 }), selected: false, x: 5, y: 6, width: 100, height: 60 },
		]);
	});

	it('hands back the very list where nothing moved, and the very entry of a node that stands as it stood', () => {
		const held = hold([node('a'), node('b')]);
		expect(reconcileNodes(held, [node('a'), node('b')])).toBe(held);
		const next = reconcileNodes(held, [node('a'), node('b', { revision: 'r2' })]);
		expect(next).not.toBe(held);
		expect(next[0]).toBe(held[0]);
		expect(next[1]).not.toBe(held[1]);
	});

	it('keeps what was chosen through a change, and lets a node that has gone go', () => {
		const held = reduceNodeChanges(hold([node('a'), node('b')]), [{ kind: 'select', id: 'b', selected: true }]);
		const next = reconcileNodes(held, [node('b', { x: 40 }), node('c')]);
		expect(next.map((entry) => [entry.node.id, entry.selected, entry.x])).toEqual([['b', true, 40], ['c', false, 0]]);
	});

	it('takes the view’s word over a place a gesture left, once the view says another', () => {
		const dragged = reduceNodeChanges(hold([node('a')]), [{ kind: 'position', id: 'a', x: 70, y: 0, dragging: false }]);
		// The write was refused, and the view says the node stands where it stood.
		expect(reconcileNodes(dragged, [node('a')])[0]).toMatchObject({ x: 0, y: 0 });
		// The write landed, and the view says the node stands where it was left.
		expect(reconcileNodes(dragged, [node('a', { x: 70 })])[0]).toMatchObject({ x: 70, node: { x: 70 } });
	});

	it('notices an order that moved, though every entry is the one it was', () => {
		const held = hold([node('a'), node('b')]);
		const next = reconcileNodes(held, [node('b'), node('a')]);
		expect(next).not.toBe(held);
		expect(next.map((entry) => entry.node.id)).toEqual(['b', 'a']);
		expect(next[0]).toBe(held[1]);
	});

	it('does the same for the lines', () => {
		const held = reconcileEdges([], [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]);
		expect(reconcileEdges(held, [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')])).toBe(held);
		const chosen = reduceEdgeChanges(held, [{ kind: 'select', id: 'e2', selected: true }]);
		const next = reconcileEdges(chosen, [edge('e1', 'a', 'b'), edge('e2', 'b', 'c', { label: 'then' })]);
		expect(next[0]).toBe(chosen[0]);
		expect(next[1]).toMatchObject({ selected: true, edge: { label: 'then' } });
		expect(reconcileEdges(next, [edge('e1', 'a', 'b')])).toHaveLength(1);
	});
});

describe('taking a gesture’s changes in', () => {
	it('moves, sizes and chooses what is named, and hands back the very list for a report that changes nothing', () => {
		const held = hold([node('a'), node('b')]);
		expect(reduceNodeChanges(held, [])).toBe(held);
		expect(reduceNodeChanges(held, [{ kind: 'position', id: 'a', x: 0, y: 0, dragging: true }])).toBe(held);
		expect(reduceNodeChanges(held, [{ kind: 'select', id: 'gone', selected: true }])).toBe(held);
		const next = reduceNodeChanges(held, [
			{ kind: 'position', id: 'a', x: 10.5, y: 20, dragging: true },
			{ kind: 'size', id: 'b', width: 300, height: 200, resizing: true },
			{ kind: 'select', id: 'b', selected: true },
		]);
		expect(next[0]).toMatchObject({ x: 10.5, y: 20, selected: false });
		expect(next[1]).toMatchObject({ width: 300, height: 200, selected: true });
		// What the view says is left as the view said it.
		expect(next[0]?.node).toBe(held[0]?.node);
	});

	it('carries a frame’s members by as far as the frame went', () => {
		const held = hold([frame('f', { x: 100, y: 100 }), node('in', { x: 120, y: 160, frame: 'f' }), node('out', { x: 900, y: 900 })]);
		const next = reduceNodeChanges(held, [{ kind: 'position', id: 'f', x: 130, y: 90, dragging: true }]);
		expect(next.map((entry) => [entry.x, entry.y])).toEqual([[130, 90], [150, 150], [900, 900]]);
		// And again from where the first step left them.
		const again = reduceNodeChanges(next, [{ kind: 'position', id: 'f', x: 140, y: 90, dragging: true }]);
		expect(again.map((entry) => [entry.x, entry.y])).toEqual([[140, 90], [160, 150], [900, 900]]);
	});

	it('moves a member once that is dragged together with its frame', () => {
		const held = hold([frame('f', { x: 100, y: 100 }), node('in', { x: 120, y: 160, frame: 'f' })]);
		const next = reduceNodeChanges(held, [
			{ kind: 'position', id: 'f', x: 130, y: 100, dragging: true },
			{ kind: 'position', id: 'in', x: 150, y: 160, dragging: true },
		]);
		expect(next[1]).toMatchObject({ x: 150, y: 160 });
	});

	it('moves no member for a frame that was only sized', () => {
		const held = hold([frame('f'), node('in', { x: 20, y: 60, frame: 'f' })]);
		const next = reduceNodeChanges(held, [{ kind: 'size', id: 'f', width: 800, height: 600, resizing: true }]);
		expect(next[1]).toBe(held[1]);
	});

	it('moves no member for a frame sized from its near corner, though the corner moved', () => {
		const held = hold([frame('f', { x: 100, y: 100 }), node('in', { x: 120, y: 160, frame: 'f' })]);
		const next = reduceNodeChanges(held, [
			{ kind: 'position', id: 'f', x: 80, y: 90, dragging: false },
			{ kind: 'size', id: 'f', width: 420, height: 310, resizing: true },
		]);
		expect(next[0]).toMatchObject({ x: 80, y: 90, width: 420, height: 310 });
		expect(next[1]).toBe(held[1]);
	});

	it('brings each side a hand moved to the grid while nodes land on it, and leaves the side that stood', () => {
		const held = hold([node('b', { x: 100, y: 100, width: 100, height: 60 })]);
		// The near side pulled out lands on the grid; the far side stood, and the size follows.
		const near = reduceNodeChanges(held, [
			{ kind: 'position', id: 'b', x: 87, y: 100, dragging: false },
			{ kind: 'size', id: 'b', width: 113, height: 60, resizing: true },
		], 20);
		expect(near[0]).toMatchObject({ x: 80, y: 100, width: 120, height: 60 });
		// The far sides alone.
		const far = reduceNodeChanges(held, [{ kind: 'size', id: 'b', width: 113, height: 71, resizing: true }], 20);
		expect(far[0]).toMatchObject({ x: 100, y: 100, width: 120, height: 80 });
		// Without the grid, the hand's own figures stand.
		const free = reduceNodeChanges(held, [{ kind: 'size', id: 'b', width: 113, height: 71, resizing: true }]);
		expect(free[0]).toMatchObject({ width: 113, height: 71 });
		// A side that would bring the box under its least size steps back out a line at a time.
		const least = reduceNodeChanges(held, [
			{ kind: 'position', id: 'b', x: 190, y: 100, dragging: false },
			{ kind: 'size', id: 'b', width: 10, height: 60, resizing: true },
		], 20);
		expect(least[0]).toMatchObject({ x: 160, y: 100, width: 40, height: 60 });
		// A report that leaves the box as it stands, once on the grid, hands back the very entry.
		expect(reduceNodeChanges(near, [{ kind: 'size', id: 'b', width: 127, height: 60, resizing: true }], 20)).toBe(near);
	});

	it('snaps a box by its sides, and takes a grid of nothing for no grid', () => {
		const stood = { x: 100, y: 100, width: 100, height: 60 };
		const least = { width: 32, height: 32 };
		// A side moved back near where it stood lands there again.
		expect(snapSized({ x: 100, y: 93, width: 100, height: 67 }, stood, 20, least)).toEqual(stood);
		// Two sides moved at once, from the far corner.
		expect(snapSized({ x: 100, y: 100, width: 131, height: 89 }, stood, 20, least)).toEqual({ x: 100, y: 100, width: 140, height: 80 });
		// The far side stepped out where the near one stood.
		expect(snapSized({ x: 100, y: 100, width: 10, height: 60 }, stood, 20, least)).toEqual({ x: 100, y: 100, width: 40, height: 60 });
		const next = { x: 103, y: 100, width: 97, height: 60 };
		expect(snapSized(next, stood, 0, least)).toBe(next);
	});

	it('draws what moves level with a node that stands, within reach, and says the lines it drew to', () => {
		const held = hold([node('a', { x: 0, y: 0, width: 100, height: 60 }), node('b', { x: 300, y: 200, width: 100, height: 60 })]);
		// Within reach of b's near side each way: drawn to both by the one move.
		const near = snappedToObjects(held, [{ kind: 'position', id: 'a', x: 304, y: 197, dragging: true }], 6);
		expect(near.changes).toEqual([{ kind: 'position', id: 'a', x: 300, y: 200, dragging: true }]);
		expect(near.guides).toEqual({ x: 300, y: 200 });
		// A far side comes level with a near one too; nothing across the other way.
		const edge = snappedToObjects(held, [{ kind: 'position', id: 'a', x: 196, y: 500, dragging: true }], 6);
		expect(edge.changes[0]).toMatchObject({ x: 200, y: 500 });
		expect(edge.guides).toEqual({ x: 300, y: null });
		// Out of reach, the report stands as it came, the very array; and no reach is no drawing.
		const changes = [{ kind: 'position' as const, id: 'a', x: 150, y: 400, dragging: true }];
		expect(snappedToObjects(held, changes, 6)).toEqual({ changes, guides: null });
		expect(snappedToObjects(held, changes, 6).changes).toBe(changes);
		expect(snappedToObjects(held, [{ kind: 'position', id: 'a', x: 304, y: 197, dragging: true }], 0).guides).toBeNull();
	});

	it('moves a whole drag by one move, round the box of everything that moves, and takes no line from what a moving frame carries', () => {
		const held = hold([
			frame('f', { x: 0, y: 0, width: 400, height: 300 }),
			node('in', { x: 20, y: 20, frame: 'f' }),
			node('b', { x: 1_000, y: 0, width: 100, height: 60 }),
		]);
		// The frame's far side comes 4 short of b's near one; its member rides along and is no line to draw to.
		const drawn = snappedToObjects(held, [{ kind: 'position', id: 'f', x: 596, y: 0, dragging: true }], 6);
		expect(drawn.changes).toEqual([{ kind: 'position', id: 'f', x: 600, y: 0, dragging: true }]);
		expect(drawn.guides).toEqual({ x: 1_000, y: 0 });
		// Two dragged together move by the one move, their box drawn as one: here its near side to the frame's far one.
		const pair = snappedToObjects(held, [
			{ kind: 'position', id: 'in', x: 404, y: 500, dragging: true },
			{ kind: 'position', id: 'b', x: 1_004, y: 500, dragging: true },
		], 6);
		expect(pair.changes.map((change) => (change.kind === 'position' ? change.x : null))).toEqual([400, 1_000]);
		expect(pair.guides).toEqual({ x: 400, y: null });
	});

	it('draws only the sides a hand moved, each on its own, when a node is sized', () => {
		const held = hold([
			node('a', { x: 0, y: 0, width: 100, height: 60 }),
			node('b', { x: 300, y: 200, width: 100, height: 60 }),
			node('c', { x: -150, y: 500, width: 100, height: 60 }),
		]);
		// The far side pulled to within reach of b's near one lands on it; the near side stood and stays.
		const far = snappedToObjects(held, [{ kind: 'size', id: 'a', width: 297, height: 60, resizing: true }], 6);
		expect(far.changes).toEqual([{ kind: 'size', id: 'a', width: 300, height: 60, resizing: true }]);
		expect(far.guides).toEqual({ x: 300, y: null });
		// The near side pulled lands on c's far one, and the far side keeps its place.
		const near = snappedToObjects(held, [
			{ kind: 'position', id: 'a', x: -53, y: 0, dragging: false },
			{ kind: 'size', id: 'a', width: 153, height: 60, resizing: true },
		], 6);
		expect(near.changes).toEqual([
			{ kind: 'position', id: 'a', x: -50, y: 0, dragging: false },
			{ kind: 'size', id: 'a', width: 150, height: 60, resizing: true },
		]);
		expect(near.guides).toEqual({ x: -50, y: null });
	});

	it('says what is chosen, in the order held, and sets exactly what is named as chosen', () => {
		const nodes = reduceNodeChanges(hold([node('a'), node('b'), node('c')]), [
			{ kind: 'select', id: 'c', selected: true }, { kind: 'select', id: 'a', selected: true },
		]);
		const edges = reduceEdgeChanges(reconcileEdges([], [edge('e1', 'a', 'b')]), [{ kind: 'select', id: 'e1', selected: true }]);
		expect(selectionOf(nodes, edges)).toEqual({ nodes: ['a', 'c'], edges: ['e1'] });
		const set = withSelection(nodes, edges, { nodes: ['b', 'gone'], edges: [] });
		expect(selectionOf(set.nodes, set.edges)).toEqual({ nodes: ['b'], edges: [] });
		expect(withSelection(set.nodes, set.edges, { nodes: ['b'], edges: [] }).nodes).toBe(set.nodes);
		expect(sameSelection({ nodes: ['a'], edges: [] }, { nodes: ['a'], edges: [] })).toBe(true);
		expect(sameSelection({ nodes: ['a'], edges: [] }, { nodes: ['b'], edges: [] })).toBe(false);
		expect(sameSelection({ nodes: ['a'], edges: [] }, { nodes: ['a'], edges: ['e'] })).toBe(false);
	});
});

describe('what a gesture that has ended comes to', () => {
	const moved = (held: readonly CanvasHeldNode[], id: string, x: number, y: number): readonly CanvasHeldNode[] =>
		reduceNodeChanges(held, [{ kind: 'position', id, x, y, dragging: false }]);

	it('reports nothing for what stands as the view has it, and nothing for less than a unit', () => {
		const held = hold([node('a'), node('b')]);
		expect(gestureChanges(held)).toEqual([]);
		expect(hasUntold(held)).toBe(false);
		const nudged = moved(held, 'a', 0.4, -0.4);
		expect(gestureChanges(nudged)).toEqual([]);
		expect(hasUntold(nudged)).toBe(false);
	});

	it('reports a node moved, in whole units, and one sized with the corner its sizing left it', () => {
		const held = reduceNodeChanges(hold([node('a'), node('b', { x: 500 })]), [
			{ kind: 'position', id: 'a', x: 30.6, y: 40.2, dragging: false },
			{ kind: 'position', id: 'b', x: 480, y: 0, dragging: false },
			{ kind: 'size', id: 'b', width: 140.4, height: 60, resizing: false },
		]);
		expect(hasUntold(held)).toBe(true);
		expect(gestureChanges(held)).toEqual([
			{ kind: 'move', id: 'a', x: 31, y: 40 },
			{ kind: 'resize', id: 'b', x: 480, y: 0, width: 140, height: 60 },
		]);
	});

	it('reports a frame that moved and none of the members it carried', () => {
		const held = hold([frame('f', { x: 100, y: 100 }), node('in', { x: 120, y: 160, frame: 'f' }), node('also', { x: 300, y: 160, frame: 'f' })]);
		const dragged = reduceNodeChanges(held, [{ kind: 'position', id: 'f', x: 160, y: 80, dragging: false }]);
		expect(gestureChanges(dragged)).toEqual([{ kind: 'move', id: 'f', x: 160, y: 80 }]);
	});

	it('gives a node to the frame its middle came to rest in, and sets one free that rests on open ground', () => {
		const held = hold([
			frame('f', { x: 0, y: 0, width: 400, height: 300 }),
			node('in', { x: 20, y: 60, frame: 'f' }),
			node('out', { x: 900, y: 900 }),
		]);
		expect(gestureChanges(moved(held, 'out', 100, 100))).toEqual([
			{ kind: 'move', id: 'out', x: 100, y: 100 },
			{ kind: 'frame', id: 'out', frame: 'f' },
		]);
		expect(gestureChanges(moved(held, 'in', 700, 60))).toEqual([
			{ kind: 'move', id: 'in', x: 700, y: 60 },
			{ kind: 'frame', id: 'in', frame: null },
		]);
		// Moved within the frame that holds it, a node stays the frame's.
		expect(gestureChanges(moved(held, 'in', 200, 100))).toEqual([{ kind: 'move', id: 'in', x: 200, y: 100 }]);
		// Its corner may hang over the edge: where its middle rests is what says.
		expect(gestureChanges(moved(held, 'in', 340, 260))).toEqual([{ kind: 'move', id: 'in', x: 340, y: 260 }]);
		expect(gestureChanges(moved(held, 'in', 360, 280))).toEqual([
			{ kind: 'move', id: 'in', x: 360, y: 280 },
			{ kind: 'frame', id: 'in', frame: null },
		]);
	});

	it('takes the topmost frame where two lie across each other, and never gives a frame to a frame', () => {
		const held = hold([
			frame('under', { x: 0, y: 0, width: 400, height: 300, z: 0 }),
			frame('over', { x: 200, y: 100, width: 400, height: 300, z: 1 }),
			node('n', { x: 900, y: 900 }),
		]);
		expect(frameAt(held, { x: 300, y: 200 })).toBe('over');
		expect(frameAt(held, { x: 100, y: 50 })).toBe('under');
		expect(frameAt(held, { x: 1000, y: 1000 })).toBeNull();
		expect(gestureChanges(moved(held, 'over', 100, 50))).toEqual([{ kind: 'move', id: 'over', x: 100, y: 50 }]);
	});

	it('reports a member moved on its own while its frame moved too', () => {
		const held = hold([frame('f', { x: 0, y: 0 }), node('in', { x: 20, y: 60, frame: 'f' })]);
		const dragged = reduceNodeChanges(held, [
			{ kind: 'position', id: 'f', x: 50, y: 0, dragging: false },
			{ kind: 'position', id: 'in', x: 300, y: 200, dragging: false },
		]);
		expect(gestureChanges(dragged)).toEqual([
			{ kind: 'move', id: 'f', x: 50, y: 0 },
			{ kind: 'move', id: 'in', x: 300, y: 200 },
		]);
	});
});

describe('where the canvas is looked at from', () => {
	it('walks the ladder a rung at a time and stops at its ends and at the bounds', () => {
		expect(zoomStep(1, 'in', bounds)).toBe(1.25);
		expect(zoomStep(1, 'out', bounds)).toBe(0.75);
		expect(zoomStep(0.8, 'in', bounds)).toBe(1);
		expect(zoomStep(0.8, 'out', bounds)).toBe(0.75);
		expect(zoomStep(4, 'in', bounds)).toBe(4);
		expect(zoomStep(0.1, 'out', bounds)).toBe(0.1);
		expect(zoomStep(1, 'in', { min: 0.5, max: 1 })).toBe(1);
		expect(zoomStep(0.5, 'out', { min: 0.5, max: 2 })).toBe(0.5);
		// A size a hair off a rung, as a pinch leaves it, is on that rung.
		expect(zoomStep(0.9995, 'in', bounds)).toBe(1.25);
		expect(zoomStep(1.0005, 'out', bounds)).toBe(0.75);
	});

	it('says its size as a whole percentage', () => {
		expect(zoomPercent(0.75)).toBe(75);
		expect(zoomPercent(0.333)).toBe(33);
		expect(zoomPercent(1)).toBe(100);
	});

	it('crosses each line between two bands at one size going out and at a larger one coming in', () => {
		const walk = (sizes: number[], from: ZoomBand | null): ZoomBand[] => {
			let band = from;
			return sizes.map((zoom) => (band = zoomBandOf(zoom, band)));
		};
		expect(walk([1, 0.88, 0.85, 0.83, 0.86, 0.89, 0.9], 'extended')).toEqual([
			'extended', 'extended', 'extended', 'standard', 'standard', 'standard', 'extended',
		]);
		expect(walk([0.45, 0.41, 0.47, 0.48], 'standard')).toEqual(['standard', 'compact', 'compact', 'standard']);
		expect(walk([0.3, 0.26, 0.32, 0.33], 'compact')).toEqual(['compact', 'far', 'far', 'compact']);
		// A leap across several lines lands where the size says.
		expect(zoomBandOf(0.1, 'extended')).toBe('far');
		expect(zoomBandOf(2, 'far')).toBe('extended');
	});

	it('takes the middle of each line for a canvas that holds no band yet', () => {
		expect(zoomBandOf(1, null)).toBe('extended');
		expect(zoomBandOf(0.75, null)).toBe('standard');
		expect(zoomBandOf(0.44, null)).toBe('compact');
		expect(zoomBandOf(0.25, null)).toBe('far');
	});

	it('measures the box that holds what is named, where a gesture has left it', () => {
		const held = moved(hold([node('a'), node('b', { x: 300, y: 200 })]), 'a', -50, -40);
		expect(boundsOf(held)).toEqual({ x: -50, y: -40, width: 450, height: 300 });
		expect(boundsOf(held, new Set(['b']))).toEqual({ x: 300, y: 200, width: 100, height: 60 });
		expect(boundsOf(held, new Set(['gone']))).toBeNull();
		expect(boundsOf([])).toBeNull();

		function moved(nodes: readonly CanvasHeldNode[], id: string, x: number, y: number): readonly CanvasHeldNode[] {
			return reduceNodeChanges(nodes, [{ kind: 'position', id, x, y, dragging: false }]);
		}
	});

	it('fits a box whole into sight with room about it, its middle at the middle', () => {
		const size = { width: 1000, height: 600 };
		const wide = fitViewport({ x: 0, y: 0, width: 4000, height: 1000 }, size, bounds);
		expect(wide.zoom).toBeCloseTo((1000 - 2 * CANVAS_FIT_PADDING) / 4000);
		expect(centreOf(wide, size)).toEqual({ x: 2000, y: 500 });
		const tall = fitViewport({ x: 100, y: 100, width: 100, height: 5040 }, size, bounds);
		expect(tall.zoom).toBeCloseTo(0.1);
		expect(centreOf(tall, size).x).toBeCloseTo(150);
	});

	it('fits a lone small card at its own size, and never further out than the bounds allow', () => {
		const size = { width: 1000, height: 600 };
		const small = fitViewport({ x: 40, y: 40, width: 100, height: 60 }, size, bounds);
		expect(small.zoom).toBe(1);
		expect(centreOf(small, size)).toEqual({ x: 90, y: 70 });
		expect(fitViewport({ x: 0, y: 0, width: 1_000_000, height: 10 }, size, bounds).zoom).toBe(0.1);
		// A canvas not yet measured fits nothing to nothing, and says no impossible size.
		expect(isViewport(fitViewport({ x: 0, y: 0, width: 0, height: 0 }, { width: 0, height: 0 }, bounds))).toBe(true);
	});

	it('steps about the middle of what is in sight, which stays where it is', () => {
		const size = { width: 800, height: 600 };
		const from = { x: -200, y: 50, zoom: 1 };
		const middle = centreOf(from, size);
		const nearer = steppedViewport(from, size, 'in', bounds);
		expect(nearer.zoom).toBe(1.25);
		expect(centreOf(nearer, size)).toEqual(middle);
		const end = { x: 0, y: 0, zoom: 4 };
		expect(steppedViewport(end, size, 'in', bounds)).toBe(end);
		expect(centredOn({ x: 100, y: 100 }, size, 2)).toEqual({ x: 200, y: 100, zoom: 2 });
	});

	it('knows a place to look from that no canvas can take', () => {
		expect(isViewport({ x: 0, y: 0, zoom: 1 })).toBe(true);
		expect(isViewport({ x: NaN, y: 0, zoom: 1 })).toBe(false);
		expect(isViewport({ x: 0, y: Infinity, zoom: 1 })).toBe(false);
		expect(isViewport({ x: 0, y: 0, zoom: 0 })).toBe(false);
	});
});

describe('sizing the plane by the wheel', () => {
	it('sizes the plane about a point, which stays under the pointer, and keeps the size within the bounds', () => {
		const viewport = { x: 100, y: 50, zoom: 1 };
		const about = { x: 300, y: 250 };
		const under = (at: { x: number; y: number; zoom: number }) => ({ x: (about.x - at.x) / at.zoom, y: (about.y - at.y) / at.zoom });
		const doubled = zoomedAbout(viewport, about, 2, bounds);
		expect(doubled).toEqual({ x: -100, y: -150, zoom: 2 });
		expect(under(doubled)).toEqual(under(viewport));
		const capped = zoomedAbout(viewport, about, 10, bounds);
		expect(capped.zoom).toBe(4);
		expect(under(capped)).toEqual(under(viewport));
		// At a bound already, the plane is handed back as it is.
		const atMost = { ...viewport, zoom: 4 };
		expect(zoomedAbout(atMost, about, 2, bounds)).toBe(atMost);
	});

	it('measures a turn of the wheel as the engine does: a hundred pixels up is a fifth of a doubling', () => {
		expect(wheelZoomFactor(-100, 0)).toBeCloseTo(2 ** 0.2, 12);
		expect(wheelZoomFactor(100, 0) * wheelZoomFactor(-100, 0)).toBeCloseTo(1, 12);
		expect(wheelZoomFactor(-1, 1)).toBeCloseTo(2 ** 0.05, 12);
		expect(wheelZoomFactor(1, 2)).toBe(0.5);
	});
});

describe('the lines held', () => {
	it('hands back the very list for a report that changes nothing', () => {
		const held: readonly CanvasHeldEdge[] = reconcileEdges([], [edge('e1', 'a', 'b')]);
		expect(reduceEdgeChanges(held, [])).toBe(held);
		expect(reduceEdgeChanges(held, [{ kind: 'select', id: 'e1', selected: false }])).toBe(held);
		expect(reduceEdgeChanges(held, [{ kind: 'select', id: 'gone', selected: true }])).toBe(held);
	});
});
