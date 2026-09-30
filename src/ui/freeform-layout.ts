/**
 * What the freeform workspace works out with nothing to draw on: how a view
 * is said to the canvas, which face a node shows at the size it is looked at,
 * where a new node lands, what a gesture that has ended asks of the view, and
 * whether two readings lay out the same. Pure, as the beat sheet's layout
 * module is, so the tests read every rule of it without a canvas.
 */

import {
	FREEFORM_SIZE,
	freeformStacking,
	type FreeformDisplayMode,
	type FreeformDocument,
	type FreeformEdge,
	type FreeformFrame,
	type FreeformPlace,
	type FreeformPlacement,
	type FreeformStep,
	type FreeformView,
} from '../domain';
import { autoSides } from './freeform-canvas-model';
import {
	CANVAS_FRAME_KIND,
	type CanvasEdge,
	type CanvasGeometryChange,
	type CanvasNode,
	type CanvasPoint,
	type CanvasScene,
	type CanvasSize,
	type ZoomBand,
} from './freeform-canvas-port';
import type { ResolvedNode } from './freeform-resources';

// -- The face a node shows -----------------------------------------------------

/** The three faces a node has, which the stylesheet dresses by name. */
export type FreeformFaceMode = 'compact' | 'standard' | 'extended';

export const FREEFORM_FACE_MODES: readonly FreeformFaceMode[] = ['compact', 'standard', 'extended'];

/**
 * The kinds of face there are, by how much room each of their modes needs:
 * a scene's card, a record's rows, a text's words, and the one line every
 * other kind shows.
 */
export type FreeformFaceKind = 'scene' | 'record' | 'text' | 'plain';

/**
 * How tall a box must be for a face to show each of its modes whole. A
 * scene's measures are the corkboard's own card in each of its styles; a
 * record's are its rows.
 */
export const FREEFORM_FACE_HEIGHTS: Readonly<Record<FreeformFaceKind, Readonly<Record<FreeformFaceMode, number>>>> = {
	scene: { compact: 80, standard: 240, extended: 304 },
	record: { compact: 56, standard: 160, extended: 320 },
	text: { compact: 56, standard: 56, extended: 56 },
	plain: { compact: 48, standard: 48, extended: 48 },
};

/** The kind of face a resolved node shows. */
export function faceKindOf(type: ResolvedNode['type']): FreeformFaceKind {
	switch (type) {
		case 'scene':
			return 'scene';
		case 'character':
		case 'worldbuilding':
		case 'task':
		case 'foreshadowing':
		case 'revision':
		case 'sticky-note':
		case 'file':
		case 'link':
			return 'record';
		case 'text':
			return 'text';
		default:
			return 'plain';
	}
}

/**
 * The face a node shows: the one the author chose, or, left to the canvas,
 * the fullest the size it is looked at allows that its box has room for,
 * so looking nearer never sizes a node. Far off a node shows its barest
 * face, which is all that can be read there.
 */
export function faceModeOf(
	mode: FreeformDisplayMode,
	band: ZoomBand,
	fit?: { kind: FreeformFaceKind; height: number },
): FreeformFaceMode {
	if (mode !== 'auto') return mode;
	let shown: FreeformFaceMode = band === 'far' ? 'compact' : band;
	if (fit === undefined) return shown;
	const heights = FREEFORM_FACE_HEIGHTS[fit.kind];
	while (shown !== 'compact' && fit.height < heights[shown]) {
		shown = shown === 'extended' ? 'standard' : 'compact';
	}
	return shown;
}

/**
 * How tall a node stands once a fuller face is chosen for it: as tall as it
 * was, or as tall as that face needs. Choosing a face is the keyboard's way
 * of sizing a node, so a box is grown and never shrunk by it.
 */
export function grownForMode(kind: FreeformFaceKind, mode: FreeformDisplayMode, height: number): number {
	if (mode === 'auto') return height;
	return Math.min(FREEFORM_SIZE.max, Math.max(height, FREEFORM_FACE_HEIGHTS[kind][mode]));
}

// -- A view said to the canvas ---------------------------------------------------

/** The least a node may be sized to by hand, so its menu and a word of it stay in reach. */
export const FREEFORM_NODE_MIN = { width: 96, height: 48 } as const;

/** How wide the grid is that nodes land on while the switch is on, in the plane's own units. */
export const FREEFORM_GRID = 20;

export interface FreeformSceneWords {
	/** What a placement stands for as the project has it now. */
	resolve: (placement: FreeformPlacement) => ResolvedNode;
	/** What a node is called, for a reader that cannot see it. */
	label: (node: ResolvedNode) => string;
	frameLabel: (frame: FreeformFrame) => string;
	/** What a line is called, by what it joins. */
	edgeName: (from: string, to: string) => string;
	/** Moves when what the node's face would draw moves, and only then. */
	revision: (node: ResolvedNode) => string;
	/** The node being typed into, which is neither moved nor sized meanwhile. */
	locked: (id: string) => boolean;
	/** Whether lines may be drawn from node to node. */
	connectable: boolean;
}

export interface FreeformSceneMade {
	scene: CanvasScene;
	/** What each node of the scene stands for, by id, for the faces to read. */
	nodes: ReadonlyMap<string, ResolvedNode>;
	frames: ReadonlyMap<string, FreeformFrame>;
}

/** A frame's tint as a class, never as a colour: the stylesheet holds the colours. */
export function frameTone(frame: Pick<FreeformFrame, 'color'>): string | null {
	return frame.color === null ? null : `is-tint-${frame.color}`;
}

/**
 * A view as the canvas takes it. Frames come first and every node follows in
 * the order it is painted, low under high, so two that share a depth stand
 * as the view keeps them. A line whose end has gone is not drawn; it stays
 * in the file, where its end may come back.
 */
export function sceneOf(view: FreeformView, words: FreeformSceneWords): FreeformSceneMade {
	const nodes: CanvasNode[] = [];
	const resolved = new Map<string, ResolvedNode>();
	const frames = new Map<string, FreeformFrame>();
	const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
	const names = new Map<string, string>();
	for (const frame of freeformStacking(view.frames)) {
		frames.set(frame.id, frame);
		boxes.set(frame.id, frame);
		const label = words.frameLabel(frame);
		names.set(frame.id, label);
		nodes.push({
			id: frame.id,
			kind: CANVAS_FRAME_KIND,
			x: frame.x,
			y: frame.y,
			width: frame.width,
			height: frame.height,
			z: frame.zIndex,
			frame: null,
			revision: `${frame.color ?? ''}\n${frame.title}`,
			label,
			tone: frameTone(frame),
			locked: words.locked(frame.id),
			connectable: words.connectable,
			minWidth: FREEFORM_NODE_MIN.width,
			minHeight: FREEFORM_NODE_MIN.height,
		});
	}
	for (const placement of freeformStacking(view.placements)) {
		const node = words.resolve(placement);
		resolved.set(placement.id, node);
		boxes.set(placement.id, placement);
		const label = words.label(node);
		names.set(placement.id, label);
		nodes.push({
			id: placement.id,
			kind: node.type,
			x: placement.x,
			y: placement.y,
			width: placement.width,
			height: placement.height,
			z: placement.zIndex,
			frame: placement.frameId !== null && frames.has(placement.frameId) ? placement.frameId : null,
			revision: words.revision(node),
			label,
			tone: null,
			locked: words.locked(placement.id),
			connectable: words.connectable,
			minWidth: FREEFORM_NODE_MIN.width,
			minHeight: FREEFORM_NODE_MIN.height,
		});
	}
	const edges: CanvasEdge[] = [];
	for (const edge of view.edges) {
		const from = boxes.get(edge.source);
		const to = boxes.get(edge.target);
		if (from === undefined || to === undefined) continue;
		edges.push(edgeOf(edge, from, to, words.edgeName(names.get(edge.source) ?? '', names.get(edge.target) ?? '')));
	}
	return { scene: { nodes, edges }, nodes: resolved, frames };
}

function edgeOf(
	edge: FreeformEdge,
	from: { x: number; y: number; width: number; height: number },
	to: { x: number; y: number; width: number; height: number },
	name: string,
): CanvasEdge {
	// A side the view left open is chosen here, by where the two stand now.
	const open = edge.sourceSide === null || edge.targetSide === null ? autoSides(from, to) : null;
	return {
		id: edge.id,
		from: edge.source,
		fromSide: edge.sourceSide ?? open?.fromSide ?? 'right',
		to: edge.target,
		toSide: edge.targetSide ?? open?.toSide ?? 'left',
		label: edge.label,
		name,
		arrow: edge.arrow,
		line: edge.line,
		revision: `${edge.arrow}|${edge.line}|${edge.label}|${name}`,
	};
}

export const EMPTY_FREEFORM_SCENE: CanvasScene = { nodes: [], edges: [] };

// -- What a gesture that has ended asks of the view -------------------------------

/**
 * A gesture's end said as one step: every node where it was left, at the
 * size it was left, and in the frame it came to rest in. One step, so a
 * selection dragged together is one change to take back. Null where the
 * gesture left nothing to say.
 */
export function placeStepOf(changes: readonly CanvasGeometryChange[]): FreeformStep | null {
	const places = new Map<string, FreeformPlace>();
	const framed = new Map<string, string | null>();
	for (const change of changes) {
		if (change.kind === 'frame') {
			framed.set(change.id, change.frame);
			continue;
		}
		places.set(change.id, change.kind === 'move'
			? { id: change.id, x: change.x, y: change.y }
			: { id: change.id, x: change.x, y: change.y, width: change.width, height: change.height });
	}
	if (places.size === 0) return null;
	// A node is given to a frame only as it is moved, so every such word has a place to ride on.
	for (const [id, frameId] of framed) {
		const place = places.get(id);
		if (place !== undefined) places.set(id, { ...place, frameId });
	}
	return { do: 'place', places: [...places.values()] };
}

// -- Where a new node lands --------------------------------------------------------

/** How far a node steps aside from one standing where it would land. */
export const FREEFORM_CASCADE = 24;

/** How many times a node steps aside before it lands where it is, on whatever stands there. */
const CASCADE_MAX = 40;

const snapped = (value: number, grid: number | null): number =>
	grid === null || !(grid > 0) ? Math.round(value) : Math.round(value / grid) * grid;

/**
 * Where a new node's corner goes so its middle stands at a place: the middle
 * of what is in sight, or where the ground's menu was opened. A node already
 * standing with its corner there sends the new one a step down and across,
 * and the next likewise, so several added at one spot fan out rather than
 * hide one another.
 */
export function landingAt(
	standing: readonly CanvasPoint[],
	middle: CanvasPoint,
	size: CanvasSize = FREEFORM_SIZE,
	grid: number | null = null,
): CanvasPoint {
	const taken = new Set(standing.map((corner) => `${String(corner.x)} ${String(corner.y)}`));
	const step = grid === null ? FREEFORM_CASCADE : Math.max(grid, Math.ceil(FREEFORM_CASCADE / grid) * grid);
	let x = snapped(middle.x - size.width / 2, grid);
	let y = snapped(middle.y - size.height / 2, grid);
	for (let tried = 0; tried < CASCADE_MAX && taken.has(`${String(x)} ${String(y)}`); tried += 1) {
		x += step;
		y += step;
	}
	return { x, y };
}

/** The corners every node of a view stands at, which a landing steps aside from. */
export function cornersOf(view: Pick<FreeformView, 'placements' | 'frames'>): CanvasPoint[] {
	return [
		...view.frames.map((frame) => ({ x: frame.x, y: frame.y })),
		...view.placements.map((placement) => ({ x: placement.x, y: placement.y })),
	];
}

/**
 * Where several new nodes land at once: the first where one would, and each
 * that follows a step down and across from the last, so they fan out from
 * the spot rather than hide one another.
 */
export function landingsAt(
	standing: readonly CanvasPoint[],
	middle: CanvasPoint,
	count: number,
	size: CanvasSize = FREEFORM_SIZE,
	grid: number | null = null,
): CanvasPoint[] {
	const taken = [...standing];
	const landings: CanvasPoint[] = [];
	for (let at = 0; at < count; at += 1) {
		const landing = landingAt(taken, middle, size, grid);
		landings.push(landing);
		taken.push(landing);
	}
	return landings;
}

/**
 * How tall a node stands once it holds what was typed into it: as tall as it
 * was, or as tall as the words need where that is taller. A node is never
 * made shorter than its author left it.
 */
export function grownHeight(height: number, needed: number): number {
	if (!Number.isFinite(needed)) return height;
	return Math.min(FREEFORM_SIZE.max, Math.max(height, Math.ceil(needed)));
}

// -- Whether two readings lay out the same -----------------------------------------

const signatures = new WeakMap<FreeformView, string>();

/**
 * All of a view that the workspace lays out, as one string. Where it was
 * last looked at from is left out, since a leaf keeps its own place to look
 * from, and so is when it was last changed, which nothing is drawn from.
 */
export function viewSignature(view: FreeformView): string {
	let signature = signatures.get(view);
	if (signature === undefined) {
		signature = JSON.stringify([view.id, view.name, view.placements, view.frames, view.edges]);
		signatures.set(view, signature);
	}
	return signature;
}

/**
 * Whether two readings lay the workspace out the same: the same views under
 * the same names, and the one on show holding what it held. What another
 * view holds is drawn nowhere until it is shown.
 */
export function laidOutAlike(painted: FreeformDocument, held: FreeformDocument, shown: string | null): boolean {
	if (painted === held) return true;
	if (painted.views.length !== held.views.length) return false;
	for (let at = 0; at < held.views.length; at += 1) {
		const before = painted.views[at]!;
		const after = held.views[at]!;
		if (before === after) continue;
		if (before.id !== after.id || before.name !== after.name) return false;
		if (after.id === shown && viewSignature(before) !== viewSignature(after)) return false;
	}
	return true;
}

// -- What a text node is called -------------------------------------------------------

/**
 * The first of a text node's words as plain words, for what the node is
 * called: the marks that make a heading, a list, a quotation or an emphasis
 * of them are how they are drawn, and no part of what they say. A link is
 * called by what it shows. Empty where the node holds no word.
 */
export function plainFirstLine(text: string, length: number): string {
	for (const line of text.split('\n')) {
		const plain = line
			// A heading's marks, a quotation's, a list's and a task's box, at the line's start.
			.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/u, '')
			// A link shows its words, or what it leads to where it has none.
			.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/gu, '$2')
			.replace(/!?\[\[([^\]]*)\]\]/gu, '$1')
			.replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
			// What marks an emphasis, a strike, a highlight or a run of code.
			.replace(/(\*\*|__|~~|==|\*|_|`)/gu, '')
			.trim();
		if (plain.length > 0) return plain.slice(0, length);
	}
	return '';
}

// -- What a view holds, counted ------------------------------------------------------

/** How many of a view's nodes keep words nowhere but on the view: its texts and its links. */
export function ownWordsCount(view: Pick<FreeformView, 'placements'>): number {
	return view.placements.filter(({ resource }) => resource.type === 'text' || resource.type === 'link').length;
}
