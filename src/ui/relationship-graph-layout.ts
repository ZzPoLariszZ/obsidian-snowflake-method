/**
 * The geometry of the entity view, ported from Obsidian's own graph so the
 * two read alike: how a disc is sized by its links and how it shrinks less
 * than the graph when zoomed out, when labels and arrowheads fade, how a
 * view is fitted to its box, how the zoom glides to where the wheel sends
 * it, and how the lines between one pair of nodes curve apart. Obsidian draws its graph in device pixels, a world unit
 * being one device pixel at zoom 1, so a disc, a line and an arrowhead
 * take the same device pixels on every display; the view here maps world
 * units to CSS pixels, so the scalars take the pixel ratio and give CSS
 * pixels, with the native zoom being the view's times that ratio. Pure
 * maths over points, so the tests can run without a canvas.
 */

import type { GraphViewport } from '../domain';

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** The native graph's zoom range. */
export const GRAPH_ZOOM_RANGE = { min: 1 / 128, max: 8 } as const;

/** How far the zoom glides towards its target in one frame, as a share of the gap: the native graph's step. */
export const GRAPH_ZOOM_GLIDE = 0.15;

/** The ratio within which the zoom and its target count as met, so the glide stops where it is: a snap would show. */
export const GRAPH_ZOOM_SETTLE = 0.01;

/** How many wheel pixels zoom by the native step of one and a half. */
const WHEEL_STEP_PIXELS = 120;

/** What everything outside a highlight fades to. */
export const GRAPH_DIM_ALPHA = 0.2;

/** How far below a disc's centre its label sits, in screen pixels, beyond the drawn radius. */
export const GRAPH_LABEL_GAP = 4;

/** How long an arrowhead is, in device pixels at line width 1: the native polygon's four units at two pixels each. */
export const GRAPH_ARROW_SIZE = 8;

/** How far back from the tip the notch between an arrowhead's wings sits, as a share of its length. */
export const GRAPH_ARROW_NOTCH = 0.75;

/** How near a line the pointer must be, in screen pixels, to be on it. */
export const GRAPH_LINE_HIT_TOLERANCE = 6;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The zoom held to the native range, which is set in device pixels. */
export function clampZoom(k: number, dpr = 1): number {
	return clamp(k, GRAPH_ZOOM_RANGE.min / dpr, GRAPH_ZOOM_RANGE.max / dpr);
}

/** A disc's radius in world units at zoom 1: 8 to 30, growing with the square root of its links. */
export function nodeRadius(weight: number, nodeSize: number): number {
	return nodeSize * clamp(3 * Math.sqrt(weight + 1), 8, 30);
}

/**
 * The radius a disc is drawn with, in CSS pixels: the world radius scaled
 * by the square root of the native zoom, so discs shrink less than the
 * graph when it is zoomed out and grow less when it is zoomed in.
 */
export function drawnRadius(radius: number, k: number, dpr = 1): number {
	return (radius * Math.sqrt(k * dpr)) / dpr;
}

/** How opaque labels are at a zoom: full at native 1, gone a stop below, moved by the fade threshold. */
export function textAlpha(k: number, textFade: number, dpr = 1): number {
	return clamp(Math.log2(k * dpr) + 1 - textFade, 0, 1);
}

/** How opaque arrowheads are at a zoom: full from native 0.8, gone at 0.3. Lines keep their colour's alpha at every zoom. */
export function arrowAlpha(k: number, dpr = 1): number {
	return clamp(2 * (k * dpr - 0.3), 0, 1);
}

/** The width a line is drawn with, in CSS pixels: the line size in device pixels, which the zoom does not change. */
export function lineWidth(lineSize: number, dpr = 1): number {
	return lineSize / dpr;
}

/** How long an arrowhead is drawn, in CSS pixels: the native length grown with the square root of the line size. */
export function arrowSize(lineSize: number, dpr = 1): number {
	return (GRAPH_ARROW_SIZE * Math.sqrt(lineSize)) / dpr;
}

/** How far from a target's centre an arrowhead's tip stands, in CSS pixels: the drawn radius and one world unit, as the native graph leaves it. */
export function arrowStandoff(radius: number, k: number, dpr = 1): number {
	return drawnRadius(radius, k, dpr) + k;
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

/** The view at another zoom with a screen point keeping its world place. */
const rezoom = (view: GraphViewport, k: number, about: Point): GraphViewport => {
	const ratio = k / view.k;
	return {
		k,
		x: about.x - (about.x - view.x) * ratio,
		y: about.y - (about.y - view.y) * ratio,
	};
};

/** The view after a zoom by a factor about a screen point, which stays under the pointer. */
export function zoomAbout(view: GraphViewport, factor: number, about: Point, dpr = 1): GraphViewport {
	return rezoom(view, clampZoom(view.k * factor, dpr), about);
}

/**
 * The zoom factor a wheel turn asks for, the native graph's: one and a half
 * for every 120 pixels, a line counting 40 and a page 800, upwards zooming
 * in.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
	let pixels = deltaY;
	if (deltaMode === 1) pixels *= 40;
	else if (deltaMode === 2) pixels *= 800;
	return Math.pow(1.5, -pixels / WHEEL_STEP_PIXELS);
}

/**
 * One frame of the zoom's glide towards its target, about a screen point
 * that keeps its world place: the native graph covers 15% of the gap a
 * frame and stops once within 1%, where it stays rather than snap. The same
 * view comes back when there is nothing left to glide.
 */
export function glideZoom(view: GraphViewport, target: number, about: Point): GraphViewport {
	const apart = target > view.k ? target / view.k : view.k / target;
	if (apart - 1 < GRAPH_ZOOM_SETTLE) return view;
	return rezoom(view, view.k + (target - view.k) * GRAPH_ZOOM_GLIDE, about);
}

export function panBy(view: GraphViewport, dx: number, dy: number): GraphViewport {
	return { ...view, x: view.x + dx, y: view.y + dy };
}

/** A view with the world origin in the middle of a box at native zoom 1. */
export function homeViewport(width: number, height: number, dpr = 1): GraphViewport {
	return { x: width / 2, y: height / 2, k: 1 / dpr };
}

/**
 * The view that shows every given point with its radius inside a box, with
 * a margin, zoomed in no further than native 1 so a small graph is not
 * blown up.
 */
export function fitViewport(
	points: readonly Point[],
	radii: readonly number[],
	width: number,
	height: number,
	dpr = 1,
	margin = 40,
): GraphViewport {
	if (points.length === 0 || width <= 0 || height <= 0) return homeViewport(width, height, dpr);
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
	const k = clampZoom(Math.min(room / Math.max(spanX, spanY), Math.max(width, height) / Math.max(spanX, spanY), 1 / dpr), dpr);
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
	/** Between the wings, so the head is the native graph's notched chevron. */
	readonly notch: Point;
	readonly right: Point;
}

/**
 * The arrowhead at the target: the tip a standoff from the target's
 * centre, the wings back along the curve's end direction and the notch
 * between them.
 */
export function arrowhead(
	source: Point,
	control: Point,
	target: Point,
	standoff: number,
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
	if (length === 0) return { tip: target, left: target, notch: target, right: target };
	const ux = dx / length;
	const uy = dy / length;
	const tip = { x: target.x - ux * standoff, y: target.y - uy * standoff };
	const base = { x: tip.x - ux * size, y: tip.y - uy * size };
	const half = size / 2;
	const back = size * GRAPH_ARROW_NOTCH;
	return {
		tip,
		left: { x: base.x - uy * half, y: base.y + ux * half },
		notch: { x: tip.x - ux * back, y: tip.y - uy * back },
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
