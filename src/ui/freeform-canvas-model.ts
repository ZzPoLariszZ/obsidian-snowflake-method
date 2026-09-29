/**
 * What the canvas engine works out, with nothing to draw on: how what it
 * holds is brought level with what the workspace says stands, how a gesture's
 * changes are taken in, what a gesture that has ended comes to, and where the
 * canvas is to be looked at from. Stated apart from the engine so the tests
 * read it without a document, and so the engine's one React file holds no
 * rule that could be wrong.
 */

import {
	CANVAS_FRAME_KIND,
	type CanvasBox,
	type CanvasEdge,
	type CanvasEdgeChange,
	type CanvasGeometryChange,
	type CanvasHeldEdge,
	type CanvasHeldNode,
	type CanvasNode,
	type CanvasNodeChange,
	type CanvasPoint,
	type CanvasSelection,
	type CanvasSide,
	type CanvasSize,
	type CanvasViewport,
	type ZoomBand,
} from './freeform-canvas-port';

// -- Depth ---------------------------------------------------------------------

/** How far under every other node the frames' band starts, which no count of nodes a view may hold reaches. */
const FRAME_BAND = 100_000;

/** A line stands over every frame and under every other node, so one that crosses a card runs behind it. */
export const CANVAS_EDGE_Z = 0;

/** A node's place in the engine's one order: the frames' band under the lines, every other node over them. */
export function canvasDepth(node: Pick<CanvasNode, 'kind' | 'z'>): number {
	return node.kind === CANVAS_FRAME_KIND ? node.z - FRAME_BAND : node.z + 1;
}

// -- The sides a line leaves by --------------------------------------------------

export interface CanvasHandleBox extends CanvasBox {
	side: CanvasSide;
}

/**
 * Where a node's four handles stand, from its size alone. Each is a box one
 * unit each way standing just inside the middle of its side, so a line ends
 * on the side itself: the engine reads a line's end off a right handle's far
 * edge, a bottom one's foot, a left one's near edge and a top one's head.
 * The stylesheet stands the handles' own elements in these very places, so
 * what the engine measures, where it can measure, is what it was told.
 */
export function handleBoxes(width: number, height: number): CanvasHandleBox[] {
	return [
		{ side: 'top', x: width / 2 - 0.5, y: 0, width: 1, height: 1 },
		{ side: 'right', x: width - 1, y: height / 2 - 0.5, width: 1, height: 1 },
		{ side: 'bottom', x: width / 2 - 0.5, y: height - 1, width: 1, height: 1 },
		{ side: 'left', x: 0, y: height / 2 - 0.5, width: 1, height: 1 },
	];
}

/**
 * The sides a line leaves and lands by where the view left the choice open:
 * across when the two stand further apart across than down, else down.
 */
export function autoSides(from: CanvasBox, to: CanvasBox): { fromSide: CanvasSide; toSide: CanvasSide } {
	const dx = to.x + to.width / 2 - (from.x + from.width / 2);
	const dy = to.y + to.height / 2 - (from.y + from.height / 2);
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
	}
	return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

// -- Bringing what is held level with what stands ----------------------------------

const sameNode = (left: CanvasNode, right: CanvasNode): boolean =>
	left === right || (
		left.id === right.id && left.kind === right.kind &&
		left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height &&
		left.z === right.z && left.frame === right.frame && left.revision === right.revision &&
		left.label === right.label && left.tone === right.tone && left.locked === right.locked &&
		left.connectable === right.connectable &&
		left.minWidth === right.minWidth && left.minHeight === right.minHeight
	);

const sameEdge = (left: CanvasEdge, right: CanvasEdge): boolean =>
	left === right || (
		left.id === right.id && left.from === right.from && left.fromSide === right.fromSide &&
		left.to === right.to && left.toSide === right.toSide && left.label === right.label &&
		left.arrow === right.arrow && left.line === right.line && left.revision === right.revision
	);

/**
 * The nodes held brought level with the nodes that stand. One that stands as
 * it stood is the very entry it was, so the engine draws nothing of it again;
 * one that moved is a new entry at its new place, chosen as it was chosen;
 * one that has gone is gone, its choosing with it. The list itself is the
 * very list it was where nothing in it moved.
 */
export function reconcileNodes(
	held: readonly CanvasHeldNode[],
	standing: readonly CanvasNode[],
): readonly CanvasHeldNode[] {
	const before = new Map(held.map((entry) => [entry.node.id, entry] as const));
	let moved = held.length !== standing.length;
	const next = standing.map((node, index) => {
		const was = before.get(node.id);
		if (was === undefined) {
			moved = true;
			return { node, selected: false, x: node.x, y: node.y, width: node.width, height: node.height };
		}
		const level =
			sameNode(was.node, node) &&
			was.x === node.x && was.y === node.y && was.width === node.width && was.height === node.height;
		if (level) {
			if (held[index] !== was) moved = true;
			return was;
		}
		moved = true;
		return { node, selected: was.selected, x: node.x, y: node.y, width: node.width, height: node.height };
	});
	return moved ? next : held;
}

export function reconcileEdges(
	held: readonly CanvasHeldEdge[],
	standing: readonly CanvasEdge[],
): readonly CanvasHeldEdge[] {
	const before = new Map(held.map((entry) => [entry.edge.id, entry] as const));
	let moved = held.length !== standing.length;
	const next = standing.map((edge, index) => {
		const was = before.get(edge.id);
		if (was !== undefined && sameEdge(was.edge, edge)) {
			if (held[index] !== was) moved = true;
			return was;
		}
		moved = true;
		return { edge, selected: was?.selected ?? false };
	});
	return moved ? next : held;
}

// -- Taking a gesture's changes in -------------------------------------------------

/**
 * What the engine reports of its nodes, taken in. A frame that moves carries
 * the nodes it holds by as far as it went, unless the same report moves them
 * itself: a frame and a member chosen and dragged together each move once.
 */
export function reduceNodeChanges(
	held: readonly CanvasHeldNode[],
	changes: readonly CanvasNodeChange[],
): readonly CanvasHeldNode[] {
	if (changes.length === 0) return held;
	const places = new Map<string, CanvasPoint>();
	const sizes = new Map<string, CanvasSize>();
	const chosen = new Map<string, boolean>();
	for (const change of changes) {
		if (change.kind === 'position') places.set(change.id, { x: change.x, y: change.y });
		else if (change.kind === 'size') sizes.set(change.id, { width: change.width, height: change.height });
		else chosen.set(change.id, change.selected);
	}
	const carried = new Map<string, CanvasPoint>();
	for (const entry of held) {
		if (entry.node.kind !== CANVAS_FRAME_KIND) continue;
		const to = places.get(entry.node.id);
		if (to === undefined || (to.x === entry.x && to.y === entry.y)) continue;
		carried.set(entry.node.id, { x: to.x - entry.x, y: to.y - entry.y });
	}
	let moved = false;
	const next = held.map((entry) => {
		const id = entry.node.id;
		let place = places.get(id);
		if (place === undefined && entry.node.frame !== null) {
			const delta = carried.get(entry.node.frame);
			if (delta !== undefined) place = { x: entry.x + delta.x, y: entry.y + delta.y };
		}
		const size = sizes.get(id);
		const selected = chosen.get(id) ?? entry.selected;
		const x = place?.x ?? entry.x;
		const y = place?.y ?? entry.y;
		const width = size?.width ?? entry.width;
		const height = size?.height ?? entry.height;
		if (
			x === entry.x && y === entry.y && width === entry.width && height === entry.height &&
			selected === entry.selected
		) {
			return entry;
		}
		moved = true;
		return { ...entry, x, y, width, height, selected };
	});
	return moved ? next : held;
}

export function reduceEdgeChanges(
	held: readonly CanvasHeldEdge[],
	changes: readonly CanvasEdgeChange[],
): readonly CanvasHeldEdge[] {
	if (changes.length === 0) return held;
	const chosen = new Map(changes.map((change) => [change.id, change.selected] as const));
	let moved = false;
	const next = held.map((entry) => {
		const selected = chosen.get(entry.edge.id);
		if (selected === undefined || selected === entry.selected) return entry;
		moved = true;
		return { ...entry, selected };
	});
	return moved ? next : held;
}

/** What is chosen now, in the order held. */
export function selectionOf(
	nodes: readonly CanvasHeldNode[],
	edges: readonly CanvasHeldEdge[],
): CanvasSelection {
	return {
		nodes: nodes.filter((entry) => entry.selected).map((entry) => entry.node.id),
		edges: edges.filter((entry) => entry.selected).map((entry) => entry.edge.id),
	};
}

export const sameSelection = (left: CanvasSelection, right: CanvasSelection): boolean =>
	left.nodes.length === right.nodes.length && left.edges.length === right.edges.length &&
	left.nodes.every((id, index) => id === right.nodes[index]) &&
	left.edges.every((id, index) => id === right.edges[index]);

/** The nodes and lines held with exactly those named chosen. */
export function withSelection(
	nodes: readonly CanvasHeldNode[],
	edges: readonly CanvasHeldEdge[],
	selection: CanvasSelection,
): { nodes: readonly CanvasHeldNode[]; edges: readonly CanvasHeldEdge[] } {
	const chosenNodes = new Set(selection.nodes);
	const chosenEdges = new Set(selection.edges);
	return {
		nodes: reduceNodeChanges(nodes, nodes.map((entry) => ({
			kind: 'select' as const, id: entry.node.id, selected: chosenNodes.has(entry.node.id),
		}))),
		edges: reduceEdgeChanges(edges, edges.map((entry) => ({
			kind: 'select' as const, id: entry.edge.id, selected: chosenEdges.has(entry.edge.id),
		}))),
	};
}

// -- What a gesture that has ended comes to -----------------------------------------

/** A place in whole units, which is what a view keeps. */
const unit = (value: number): number => Math.round(value);

/** The frame a point stands in: the one drawn topmost of those that hold it; null for open ground. */
export function frameAt(held: readonly CanvasHeldNode[], point: CanvasPoint): string | null {
	let found: CanvasHeldNode | null = null;
	for (const entry of held) {
		if (entry.node.kind !== CANVAS_FRAME_KIND) continue;
		if (point.x < entry.x || point.x > entry.x + entry.width) continue;
		if (point.y < entry.y || point.y > entry.y + entry.height) continue;
		if (found === null || entry.node.z >= found.node.z) found = entry;
	}
	return found?.node.id ?? null;
}

/**
 * What a gesture left behind, as the view is to be told it. A node is
 * reported where it stands other than the view has it: moved where only its
 * place changed, sized where its size did. A node that went only as far as
 * the frame that holds it is not reported at all, since the view carries a
 * frame's members with it. And a node that was itself moved is given to the
 * frame its middle came to rest in, or set free where it rests on open
 * ground: drop in to join, drag out to leave.
 */
export function gestureChanges(held: readonly CanvasHeldNode[]): CanvasGeometryChange[] {
	const changes: CanvasGeometryChange[] = [];
	const frames = new Map<string, CanvasHeldNode>();
	for (const entry of held) {
		if (entry.node.kind === CANVAS_FRAME_KIND) frames.set(entry.node.id, entry);
	}
	for (const entry of held) {
		const { node } = entry;
		const x = unit(entry.x);
		const y = unit(entry.y);
		const width = unit(entry.width);
		const height = unit(entry.height);
		const sized = width !== node.width || height !== node.height;
		const moved = x !== node.x || y !== node.y;
		if (!sized && !moved) continue;
		if (sized) {
			changes.push({ kind: 'resize', id: node.id, x, y, width, height });
			continue;
		}
		const frame = node.frame === null ? undefined : frames.get(node.frame);
		const carried =
			frame !== undefined &&
			unit(frame.x) - frame.node.x === x - node.x &&
			unit(frame.y) - frame.node.y === y - node.y &&
			unit(frame.width) === frame.node.width && unit(frame.height) === frame.node.height;
		if (carried) continue;
		changes.push({ kind: 'move', id: node.id, x, y });
		if (node.kind === CANVAS_FRAME_KIND) continue;
		const rests = frameAt(held, { x: entry.x + entry.width / 2, y: entry.y + entry.height / 2 });
		if (rests !== node.frame) changes.push({ kind: 'frame', id: node.id, frame: rests });
	}
	return changes;
}

/** Whether anything held stands other than the view has it, which is a gesture not yet told. */
export function hasUntold(held: readonly CanvasHeldNode[]): boolean {
	return held.some((entry) =>
		unit(entry.x) !== entry.node.x || unit(entry.y) !== entry.node.y ||
		unit(entry.width) !== entry.node.width || unit(entry.height) !== entry.node.height);
}

// -- Where the canvas is looked at from ---------------------------------------------

/** The sizes the two buttons walk through, as parts of the plane's own size. */
export const CANVAS_ZOOM_LADDER: readonly number[] = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** The room left round what is fitted into sight, in the window's own units. */
export const CANVAS_FIT_PADDING = 48;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The next size along the ladder, or the size held where the ladder ends or the bounds do. */
export function zoomStep(
	zoom: number,
	direction: 'in' | 'out',
	bounds: { min: number; max: number },
): number {
	const rungs = CANVAS_ZOOM_LADDER.filter((rung) => rung >= bounds.min && rung <= bounds.max);
	// A size a hair off a rung, as a pinch leaves it, is on that rung.
	const next = direction === 'in'
		? rungs.find((rung) => rung > zoom + 0.001)
		: [...rungs].reverse().find((rung) => rung < zoom - 0.001);
	return clamp(next ?? zoom, bounds.min, bounds.max);
}

/** The size as a whole percentage, which is what the canvas says of itself. */
export function zoomPercent(zoom: number): number {
	return Math.round(zoom * 100);
}

/**
 * The band a size falls in. Each line between two bands is crossed at one
 * size going out and at a larger one coming in, so a canvas resting near a
 * line does not change its cards' faces at every breath of the hand.
 */
export function zoomBandOf(zoom: number, previous: ZoomBand | null): ZoomBand {
	const order: readonly ZoomBand[] = ['far', 'compact', 'standard', 'extended'];
	/** The line under each band but the first: left at the first size going out, reached at the second coming in. */
	const lines: readonly { out: number; in: number }[] = [
		{ out: 0.27, in: 0.33 },
		{ out: 0.42, in: 0.48 },
		{ out: 0.84, in: 0.9 },
	];
	let at = previous === null ? 0 : order.indexOf(previous);
	if (previous === null) {
		// With no band held, the middle of each line decides.
		while (at < lines.length && zoom >= (lines[at]!.out + lines[at]!.in) / 2) at += 1;
		return order[at]!;
	}
	while (at < lines.length && zoom >= lines[at]!.in) at += 1;
	while (at > 0 && zoom < lines[at - 1]!.out) at -= 1;
	return order[at]!;
}

/** The box that holds every node named, as the engine holds them; null where none stands. */
export function boundsOf(held: readonly CanvasHeldNode[], ids?: ReadonlySet<string>): CanvasBox | null {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const entry of held) {
		if (ids !== undefined && !ids.has(entry.node.id)) continue;
		left = Math.min(left, entry.x);
		top = Math.min(top, entry.y);
		right = Math.max(right, entry.x + entry.width);
		bottom = Math.max(bottom, entry.y + entry.height);
	}
	if (left === Infinity) return null;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Where to look from so a box stands whole in sight with room about it, its
 * middle at the middle. Never nearer than the plane's own size: a lone small
 * card fitted is a card at its size, not one blown up to fill the window.
 */
export function fitViewport(
	box: CanvasBox,
	size: CanvasSize,
	bounds: { min: number; max: number },
): CanvasViewport {
	const roomAcross = Math.max(1, size.width - 2 * CANVAS_FIT_PADDING);
	const roomDown = Math.max(1, size.height - 2 * CANVAS_FIT_PADDING);
	const fitted = Math.min(roomAcross / Math.max(1, box.width), roomDown / Math.max(1, box.height));
	const zoom = clamp(Math.min(fitted, 1), bounds.min, Math.max(bounds.min, Math.min(bounds.max, 1)));
	return {
		x: size.width / 2 - (box.x + box.width / 2) * zoom,
		y: size.height / 2 - (box.y + box.height / 2) * zoom,
		zoom,
	};
}

/** The place on the plane that stands at the middle of what is in sight. */
export function centreOf(viewport: CanvasViewport, size: CanvasSize): CanvasPoint {
	return {
		x: (size.width / 2 - viewport.x) / viewport.zoom,
		y: (size.height / 2 - viewport.y) / viewport.zoom,
	};
}

/** Where to look from so a place on the plane stands at the middle, at the size named. */
export function centredOn(point: CanvasPoint, size: CanvasSize, zoom: number): CanvasViewport {
	return { x: size.width / 2 - point.x * zoom, y: size.height / 2 - point.y * zoom, zoom };
}

/** One step along the ladder about the middle of what is in sight, which therefore stays where it is. */
export function steppedViewport(
	viewport: CanvasViewport,
	size: CanvasSize,
	direction: 'in' | 'out',
	bounds: { min: number; max: number },
): CanvasViewport {
	const zoom = zoomStep(viewport.zoom, direction, bounds);
	return zoom === viewport.zoom ? viewport : centredOn(centreOf(viewport, size), size, zoom);
}

/** Whether a place to look from is one a canvas can take: every part a number, the size above nothing. */
export function isViewport(viewport: CanvasViewport): boolean {
	return Number.isFinite(viewport.x) && Number.isFinite(viewport.y) &&
		Number.isFinite(viewport.zoom) && viewport.zoom > 0;
}

export const sameViewport = (left: CanvasViewport, right: CanvasViewport): boolean =>
	left.x === right.x && left.y === right.y && left.zoom === right.zoom;
