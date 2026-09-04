/**
 * The arithmetic of the sticky-note surfaces, kept apart from the DOM that
 * uses it: where a floating panel may stand and how large it may be, what a
 * drag or a resize does to it, which cards a repaint keeps, and how a long
 * list is laid down a few cards a frame. Pure, so every rule is tested
 * without a window.
 */

import { STICKY_NOTE_ALPHA_MAX, type StickyNoteFloatState } from '../domain';

export interface FloatGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface PointerPoint {
	x: number;
	y: number;
}

/**
 * No panel smaller than this, in rem, whatever a drag or a stored state says.
 * The width is what the head needs to show the whole clock beside its five
 * buttons without an ellipsis.
 */
export const FLOAT_MIN_REM = { width: 22, height: 8 } as const;

/** A new panel's size, in rem. */
export const FLOAT_DEFAULT_REM = { width: 24, height: 18 } as const;

/** How much of a panel stays inside the window on every side: a grip's worth. */
export const FLOAT_HEAD_REACH = 64;

export const FLOAT_ORIGIN_PX = 24;
export const FLOAT_CASCADE_PX = 28;
export const FLOAT_CASCADE_WRAP = 8;

function finite(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/**
 * A geometry the window can show: no smaller than the floor, no larger than
 * the window, and never so far out that the head is beyond reach.
 */
export function clampFloatGeometry(
	geometry: FloatGeometry,
	viewport: Viewport,
	remPx: number,
): FloatGeometry {
	const minWidth = FLOAT_MIN_REM.width * remPx;
	const minHeight = FLOAT_MIN_REM.height * remPx;
	const width = clamp(
		finite(geometry.width, minWidth),
		minWidth,
		Math.max(minWidth, viewport.width),
	);
	const height = clamp(
		finite(geometry.height, minHeight),
		minHeight,
		Math.max(minHeight, viewport.height),
	);
	const leftmost = FLOAT_HEAD_REACH - width;
	const x = clamp(
		finite(geometry.x, 0),
		leftmost,
		Math.max(leftmost, viewport.width - FLOAT_HEAD_REACH),
	);
	const y = clamp(
		finite(geometry.y, 0),
		0,
		Math.max(0, viewport.height - FLOAT_HEAD_REACH / 2),
	);
	return { x, y, width, height };
}

/** Where a new panel opens: stepped down from the corner for each one already open, around again after eight. */
export function defaultFloatGeometry(
	viewport: Viewport,
	openCount: number,
	remPx: number,
): FloatGeometry {
	const step = (openCount % FLOAT_CASCADE_WRAP) * FLOAT_CASCADE_PX;
	return clampFloatGeometry(
		{
			x: FLOAT_ORIGIN_PX + step,
			y: FLOAT_ORIGIN_PX + step,
			width: FLOAT_DEFAULT_REM.width * remPx,
			height: FLOAT_DEFAULT_REM.height * remPx,
		},
		viewport,
		remPx,
	);
}

export function defaultFloatState(geometry: FloatGeometry): StickyNoteFloatState {
	return {
		open: true,
		...geometry,
		locked: false,
		alpha: STICKY_NOTE_ALPHA_MAX,
		mode: 'viewing',
	};
}

export interface PointerStart {
	pointer: PointerPoint;
	box: FloatGeometry;
}

export function dragGeometry(start: PointerStart, pointer: PointerPoint): FloatGeometry {
	return {
		...start.box,
		x: start.box.x + (pointer.x - start.pointer.x),
		y: start.box.y + (pointer.y - start.pointer.y),
	};
}

/** Which edge or corner a resize pulls: compass points, a corner named by both. */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/**
 * A resize from any edge or corner: the side pulled follows the pointer and
 * the opposite side stays where it was, even at the floor, so pulling the
 * left edge past the minimum never walks the right edge along.
 */
export function resizeGeometry(
	start: PointerStart,
	pointer: PointerPoint,
	edge: ResizeEdge = 'se',
	minimum: { width: number; height: number } = { width: 0, height: 0 },
): FloatGeometry {
	const dx = pointer.x - start.pointer.x;
	const dy = pointer.y - start.pointer.y;
	let { x, y, width, height } = start.box;
	if (edge.includes('e')) width = Math.max(minimum.width, start.box.width + dx);
	if (edge.includes('w')) {
		width = Math.max(minimum.width, start.box.width - dx);
		x = start.box.x + start.box.width - width;
	}
	if (edge.includes('s')) height = Math.max(minimum.height, start.box.height + dy);
	if (edge.includes('n')) {
		height = Math.max(minimum.height, start.box.height - dy);
		y = start.box.y + start.box.height - height;
	}
	return { x, y, width, height };
}

export interface CardRepaintPlan {
	/** Cards to take down. */
	remove: string[];
	/** Cards standing on, in their previous order. */
	keep: string[];
	/** Cards to make, in the order they take their place. */
	add: string[];
	/** The order the shown cards end up in; a pinned card left out of it stays where it stands. */
	order: string[];
}

/**
 * Which cards a repaint takes down, keeps and makes. A pinned card -- one
 * being edited -- stays even when the filter dropped it, so typing is never
 * interrupted by a search; the caller pins only cards whose note still
 * exists, so nothing archived or deleted hides behind a pin.
 */
export function planCardRepaint(
	previous: readonly string[],
	next: readonly string[],
	pinned: readonly string[],
): CardRepaintPlan {
	const nextSet = new Set(next);
	const previousSet = new Set(previous);
	const pinnedSet = new Set(pinned);
	return {
		remove: previous.filter((id) => !nextSet.has(id) && !pinnedSet.has(id)),
		keep: previous.filter((id) => nextSet.has(id) || pinnedSet.has(id)),
		add: next.filter((id) => !previousSet.has(id)),
		order: [...next],
	};
}

/**
 * Lays `items` down `size` at a time, the first batch now and each later one
 * on a frame, so a long list opens without a stall. Stops when `live` says
 * the surface is gone or the returned cancel has been called.
 */
export function batchSchedule<T>(
	items: readonly T[],
	size: number,
	render: (item: T, index: number) => void,
	requestFrame: (callback: () => void) => void,
	live: () => boolean,
): () => void {
	let cancelled = false;
	let done = 0;
	const step = (): void => {
		if (cancelled || !live()) return;
		const end = Math.min(items.length, done + Math.max(1, size));
		for (; done < end; done += 1) {
			const item = items[done];
			if (item !== undefined) render(item, done);
		}
		if (done < items.length) requestFrame(step);
	};
	step();
	return () => {
		cancelled = true;
	};
}

function twoDigits(value: number): string {
	return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * A note's birth as a card shows it: on the head as a plain clock,
 * `2026-09-04 06:14:32`, the same shape in every locale so the heads line up
 * in a column of cards; in the tooltip in the locale's own words.
 */
export function formatStickyCreated(
	createdAt: number,
	locale: string,
	timeZone?: string,
): { short: string; full: string } {
	const date = new Date(createdAt);
	if (!Number.isFinite(date.getTime())) return { short: '', full: '' };
	const zone = timeZone === undefined ? {} : { timeZone };
	const parts = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		hourCycle: 'h23',
		...zone,
	}).formatToParts(date);
	const read = (type: Intl.DateTimeFormatPartTypes): number =>
		Number(parts.find((part) => part.type === type)?.value ?? '0');
	const short = `${String(read('year'))}-${twoDigits(read('month'))}-${twoDigits(read('day'))} ${twoDigits(read('hour'))}:${twoDigits(read('minute'))}:${twoDigits(read('second'))}`;
	const full = new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		...zone,
	}).format(date);
	return { short, full };
}
