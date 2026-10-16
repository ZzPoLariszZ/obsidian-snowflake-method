/**
 * The geometry of the entity view, ported from Obsidian's own graph so the
 * two read alike: how a disc is sized by its links and how it shrinks less
 * than the graph when zoomed out, when labels and lines fade, how a view is
 * fitted to its box, and how the lines between one pair of nodes curve
 * apart. Pure maths over points, so the tests can run without a canvas.
 */

import type { GraphViewport } from '../domain';

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** The native graph's zoom range. */
export const GRAPH_ZOOM_RANGE = { min: 1 / 128, max: 8 } as const;

/** What everything outside a highlight fades to. */
export const GRAPH_DIM_ALPHA = 0.2;

/** How far below a disc's centre its label sits, in screen pixels, beyond the drawn radius. */
export const GRAPH_LABEL_GAP = 4;

/** How wide an arrowhead is drawn, in screen pixels at line width 1. */
export const GRAPH_ARROW_SIZE = 8;

/** How near a line the pointer must be, in screen pixels, to be on it. */
export const GRAPH_LINE_HIT_TOLERANCE = 6;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function clampZoom(k: number): number {
	return clamp(k, GRAPH_ZOOM_RANGE.min, GRAPH_ZOOM_RANGE.max);
}

/** A disc's radius in world units at zoom 1: 8 to 30, growing with the square root of its links. */
export function nodeRadius(weight: number, nodeSize: number): number {
	return nodeSize * clamp(3 * Math.sqrt(weight + 1), 8, 30);
}

/**
 * The radius a disc is drawn with on screen: the world radius scaled by the
 * square root of the zoom, so discs shrink less than the graph when it is
 * zoomed out and grow less when it is zoomed in.
 */
export function drawnRadius(radius: number, k: number): number {
	return radius * Math.sqrt(k);
}

/** How opaque labels are at a zoom: full at 1, gone a stop below, moved by the fade threshold. */
export function textAlpha(k: number, textFade: number): number {
	return clamp(Math.log2(k) + 1 - textFade, 0, 1);
}

/** How opaque lines are at a zoom: full from 0.8, gone at 0.3. */
export function lineAlpha(k: number): number {
	return clamp(2 * (k - 0.3), 0, 1);
}

/** The width a line is drawn with on screen, which the zoom does not change. */
export function lineWidth(lineSize: number): number {
	return lineSize;
}

/** One step of the native graph's easing towards a target alpha. */
export function easeAlpha(current: number, target: number): number {
	const next = current * 0.9 + target * 0.1;
	return Math.abs(next - target) < 0.005 ? target : next;
}

export function toScreen(point: Point, view: GraphViewport): Point {
	return { x: point.x * view.k + view.x, y: point.y * view.k + view.y };
}

export function toWorld(point: Point, view: GraphViewport): Point {
	return { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k };
}

/** The view after a zoom by a factor about a screen point, which stays under the pointer. */
export function zoomAbout(view: GraphViewport, factor: number, about: Point): GraphViewport {
	const k = clampZoom(view.k * factor);
	const ratio = k / view.k;
	return {
		k,
		x: about.x - (about.x - view.x) * ratio,
		y: about.y - (about.y - view.y) * ratio,
	};
}

export function panBy(view: GraphViewport, dx: number, dy: number): GraphViewport {
	return { ...view, x: view.x + dx, y: view.y + dy };
}

/** A view with the world origin in the middle of a box at zoom 1. */
export function homeViewport(width: number, height: number): GraphViewport {
	return { x: width / 2, y: height / 2, k: 1 };
}

/**
 * The view that shows every given point with its radius inside a box, with
 * a margin, zoomed in no further than 1 so a small graph is not blown up.
 */
export function fitViewport(
	points: readonly Point[],
	radii: readonly number[],
	width: number,
	height: number,
	margin = 40,
): GraphViewport {
	if (points.length === 0 || width <= 0 || height <= 0) return homeViewport(width, height);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	points.forEach((point, at) => {
		const radius = radii[at] ?? 0;
		minX = Math.min(minX, point.x - radius);
		minY = Math.min(minY, point.y - radius);
		maxX = Math.max(maxX, point.x + radius);
		maxY = Math.max(maxY, point.y + radius);
	});
	const spanX = Math.max(maxX - minX, 1);
	const spanY = Math.max(maxY - minY, 1);
	const room = Math.max(1, Math.min(width, height) - 2 * margin);
	const k = clampZoom(Math.min(room / Math.max(spanX, spanY), Math.max(width, height) / Math.max(spanX, spanY), 1));
	const centreX = (minX + maxX) / 2;
	const centreY = (minY + maxY) / 2;
	return { k, x: width / 2 - centreX * k, y: height / 2 - centreY * k };
}

/**
 * How far a lane's control point stands off the straight line, in world
 * units: wider lanes for longer lines, but never so wide that a short line
 * loops.
 */
export function laneOffset(lane: number, distance: number): number {
	return lane * clamp(distance * 0.2, 12, 48);
}

/**
 * The control point of a line's curve between two points. Lanes were given
 * in the frame of the pair with the lower id first, so a line running the
 * other way takes the opposite side of the straight line and the two never
 * draw over each other. Lane 0 is the midpoint: a straight line.
 */
export function edgeControl(source: Point, target: Point, lane: number, forward: boolean): Point {
	const midX = (source.x + target.x) / 2;
	const midY = (source.y + target.y) / 2;
	if (lane === 0) return { x: midX, y: midY };
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const distance = Math.hypot(dx, dy);
	if (distance === 0) return { x: midX, y: midY };
	const offset = laneOffset(lane, distance) * (forward ? 1 : -1);
	return { x: midX + (-dy / distance) * offset, y: midY + (dx / distance) * offset };
}

/** A point on the quadratic curve, at 0 the source and at 1 the target. */
export function curvePoint(source: Point, control: Point, target: Point, t: number): Point {
	const u = 1 - t;
	return {
		x: u * u * source.x + 2 * u * t * control.x + t * t * target.x,
		y: u * u * source.y + 2 * u * t * control.y + t * t * target.y,
	};
}

/** Where a line's label sits: the curve's middle. */
export function edgeLabelAnchor(source: Point, control: Point, target: Point): Point {
	return curvePoint(source, control, target, 0.5);
}

export interface Arrowhead {
	readonly tip: Point;
	readonly left: Point;
	readonly right: Point;
}

/**
 * The arrowhead at the target's rim: the tip where the curve meets the
 * disc, the wings back along the curve's end direction.
 */
export function arrowhead(
	source: Point,
	control: Point,
	target: Point,
	targetRadius: number,
	size: number,
): Arrowhead {
	let dx = target.x - control.x;
	let dy = target.y - control.y;
	let length = Math.hypot(dx, dy);
	if (length === 0) {
		dx = target.x - source.x;
		dy = target.y - source.y;
		length = Math.hypot(dx, dy);
	}
	if (length === 0) return { tip: target, left: target, right: target };
	const ux = dx / length;
	const uy = dy / length;
	const tip = { x: target.x - ux * targetRadius, y: target.y - uy * targetRadius };
	const base = { x: tip.x - ux * size, y: tip.y - uy * size };
	const half = size / 2;
	return {
		tip,
		left: { x: base.x - uy * half, y: base.y + ux * half },
		right: { x: base.x + uy * half, y: base.y - ux * half },
	};
}

/** The nearest distance from a point to the curve, sampled along it. */
export function distanceToCurve(point: Point, source: Point, control: Point, target: Point, samples = 12): number {
	let nearest = Infinity;
	let previous = source;
	for (let step = 1; step <= samples; step += 1) {
		const next = curvePoint(source, control, target, step / samples);
		nearest = Math.min(nearest, distanceToSegment(point, previous, next));
		previous = next;
	}
	return nearest;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
	return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Whether a screen rectangle, grown by a margin, holds a point. */
export function inBox(point: Point, width: number, height: number, margin: number): boolean {
	return point.x >= -margin && point.y >= -margin && point.x <= width + margin && point.y <= height + margin;
}
