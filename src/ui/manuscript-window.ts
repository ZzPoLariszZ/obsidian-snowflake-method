/**
 * Which segments of a manuscript are held in memory, and which are let go.
 *
 * Kept free of Obsidian types, and of the DOM, so the rule can be exercised
 * without a workspace — the same separation `note-pane.ts` and
 * `dashboard-state.ts` keep. `manuscript-view.ts` mounts and unmounts whatever
 * this decides.
 */

import { windowAround, type Located } from '../domain';

export interface WindowRequest {
	/** The whole manuscript, in reading order. */
	segments: readonly Located[];
	/** The segment the window is centred on, or null to centre on the first. */
	activePath: string | null;
	/** How many segments to hold on either side of the active one. */
	before: number;
	after: number;
	/** What is mounted at the moment. */
	loaded: readonly string[];
	/**
	 * A segment being edited. It stays mounted wherever the window moves to,
	 * because taking an editor away from under an author mid-sentence to save
	 * memory would be the worst trade this code could make.
	 */
	editing?: string | null;
}

export interface WindowPlan {
	/** Everything that should be mounted afterwards, in reading order. */
	visible: string[];
	/** Not mounted yet, in reading order. */
	mount: string[];
	/** Mounted, and no longer wanted. */
	unmount: string[];
	/**
	 * Whether the window reaches the ends of the manuscript. Read from the
	 * manuscript rather than from the window: a slice that stops five segments
	 * early has not reached the end of the book, and offering to start a new
	 * chapter there would be offering it in the middle of one.
	 */
	atStart: boolean;
	atEnd: boolean;
}

export function planWindow(request: WindowRequest): WindowPlan {
	const window = windowAround(
		request.segments,
		request.activePath ?? request.segments[0]?.path ?? '',
		request.before,
		request.after,
	);

	const wanted = new Set(window.segments.map((segment) => segment.path));
	const editing = request.editing ?? null;
	if (editing !== null && request.segments.some((s) => s.path === editing)) {
		wanted.add(editing);
	}

	// Reading order throughout, so a caller can insert a mounted block by
	// walking the list rather than by working out where it belongs.
	const visible = request.segments
		.filter((segment) => wanted.has(segment.path))
		.map((segment) => segment.path);
	const loaded = new Set(request.loaded);

	return {
		visible,
		mount: visible.filter((path) => !loaded.has(path)),
		unmount: request.loaded.filter((path) => !wanted.has(path)),
		atStart: window.atStart,
		atEnd: window.atEnd,
	};
}

/**
 * The segment a reader is looking at: the last one whose top edge has passed
 * the reading line, which sits a little below the top of the viewport so that
 * a heading scrolling into view counts as arriving rather than as leaving.
 */
export function activeSegmentAt(
	offsets: readonly { path: string; top: number; bottom: number }[],
	scrollTop: number,
	viewportHeight: number,
): string | null {
	if (offsets.length === 0) return null;
	const line = scrollTop + viewportHeight * 0.25;
	let active = offsets[0]?.path ?? null;
	for (const offset of offsets) {
		if (offset.top <= line) active = offset.path;
		else break;
	}
	return active;
}
