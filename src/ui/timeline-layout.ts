/**
 * The timeline workspace's arithmetic, with no workspace to draw on: which
 * timelines a view shows and in what order, what layout that many make,
 * which of them the scene pool works on, and where a drag may land. Pure,
 * so the tests read it without a DOM.
 */

import {
	resolvedTimeOrder,
	scenePlacements,
	type ScenePresentation,
	type Timeline,
	type TimelineDocument,
	type TimelineTime,
	type TimelineView,
} from '../domain';
import type { WorldbuildingEntityViewModel } from './view-model';

/** One timeline stands alone in a wide lane; two or more stand side by side. */
export type TimelineLayoutKind = 'single' | 'multi';

/**
 * The timelines a view shows, in the order it shows them: the pinned one
 * first when the view holds it, then the view's own order. An id the
 * document no longer answers to is left out.
 */
export function laneOrder(
	view: Pick<TimelineView, 'timelines'>,
	held: Pick<TimelineDocument, 'timelines' | 'pinnedTimelineId'>,
): Timeline[] {
	const lanes: Timeline[] = [];
	for (const id of view.timelines) {
		const timeline = held.timelines.find((candidate) => candidate.id === id);
		if (timeline !== undefined) lanes.push(timeline);
	}
	const pinned = lanes.find((lane) => lane.id === held.pinnedTimelineId);
	if (pinned === undefined) return lanes;
	return [pinned, ...lanes.filter((lane) => lane !== pinned)];
}

export function layoutKind(lanes: readonly unknown[]): TimelineLayoutKind {
	return lanes.length > 1 ? 'multi' : 'single';
}

/**
 * The timeline the scene pool works on: the one a click chose while it is
 * still shown, else the pinned one when the view holds it, else the first.
 * Null with no lane at all.
 */
export function resolveActiveTimeline(
	lanes: readonly Pick<Timeline, 'id'>[],
	pinnedTimelineId: string | null,
	chosen: string | undefined,
): string | null {
	if (chosen !== undefined && lanes.some((lane) => lane.id === chosen)) return chosen;
	if (pinnedTimelineId !== null && lanes.some((lane) => lane.id === pinnedTimelineId)) {
		return pinnedTimelineId;
	}
	return lanes[0]?.id ?? null;
}

/** One shared time row: the note, or null where the project no longer has it. */
export interface TimeRowModel {
	timeId: string;
	time: WorldbuildingEntityViewModel | null;
}

/**
 * The rows a view shows: every time its lanes hold, once, in the view's
 * resolved order, each with its note where the project still has one.
 */
export function unionRows(
	view: Pick<TimelineView, 'timelines' | 'timeOrder'>,
	lanes: readonly Timeline[],
	times: readonly WorldbuildingEntityViewModel[],
): TimeRowModel[] {
	const byId = new Map(times.map((time) => [time.id, time] as const));
	return resolvedTimeOrder(view, lanes, times.map((time) => time.id)).map((timeId) => ({
		timeId,
		time: byId.get(timeId) ?? null,
	}));
}

/** What a lane holds at a time, or null where the timeline lacks the time. */
export function laneCell(timeline: Pick<Timeline, 'times'>, timeId: string): TimelineTime | null {
	return timeline.times.find((time) => time.timeId === timeId) ?? null;
}

/** The scenes a timeline has placed, wherever on it. */
export function assignedSceneIds(timeline: Pick<Timeline, 'times'>): Set<string> {
	return new Set(scenePlacements(timeline).keys());
}

/**
 * A list with one id moved in front of another, or to the end when no
 * anchor is named or the one named has gone since the surface was painted;
 * null where the id is not in the list or already stands there.
 */
export function reorderIds(
	ids: readonly string[],
	movedId: string,
	beforeId: string | null,
): string[] | null {
	if (!ids.includes(movedId) || beforeId === movedId) return null;
	const rest = ids.filter((id) => id !== movedId);
	const at = beforeId === null ? -1 : rest.indexOf(beforeId);
	const next = at === -1 ? [...rest, movedId] : [...rest.slice(0, at), movedId, ...rest.slice(at)];
	return next.every((id, index) => id === ids[index]) ? null : next;
}

/** The drag in flight, at one of the workspace's three levels. */
export type TimelineDrag =
	| { kind: 'time'; timeId: string }
	| { kind: 'row'; timelineId: string; timeId: string; rowId: string }
	| {
			kind: 'scene';
			sceneId: string;
			/** The active timeline when the drag began, the only one that takes the scene. */
			lockedTimelineId: string;
			source: { timelineId: string; rowId: string } | { pool: true };
	  };

/**
 * Whether a scene may land on a row: in Flat on any row of the locked lane,
 * in Stack on any but the row it comes from, whose stack has no order to
 * change. The lane itself is answered for by `laneAcceptsDrag`.
 */
export function rowAcceptsScene(
	drag: TimelineDrag | null,
	rowId: string,
	presentation: ScenePresentation,
): boolean {
	if (drag?.kind !== 'scene') return false;
	if (presentation === 'flat' || 'pool' in drag.source) return true;
	return drag.source.rowId !== rowId;
}

/** Under which name a row's stack remembers the card it shows, for the session. */
export function stackKey(viewId: string, timelineId: string, rowId: string): string {
	return `${viewId}|${timelineId}|${rowId}`;
}

/** The card a stack shows, kept within the cards it has; an empty stack shows its first, which is none. */
export function clampStackPosition(position: number | undefined, total: number): number {
	if (total <= 0 || position === undefined || !Number.isFinite(position)) return 0;
	return Math.min(Math.max(Math.trunc(position), 0), total - 1);
}

/** Whether a lane takes what is being dragged: its own rows, or a scene while it is the locked one. */
export function laneAcceptsDrag(drag: TimelineDrag | null, timelineId: string): boolean {
	if (drag === null || drag.kind === 'time') return false;
	return drag.kind === 'row' ? drag.timelineId === timelineId : drag.lockedTimelineId === timelineId;
}

/** How a lane's cells stand during a drag: the lane dragged over, locked out, or nothing in flight. */
export function cellDragState(
	drag: TimelineDrag | null,
	timelineId: string,
): 'lane' | 'locked' | 'idle' {
	if (drag === null || drag.kind === 'time') return 'idle';
	return laneAcceptsDrag(drag, timelineId) ? 'lane' : 'locked';
}

/** A box on the page, as the drop arithmetic reads one. */
export interface PlacementRect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/**
 * Where a dragged scene lands among the cards of a row laid out as a wrapped
 * flex: the line the pointer is on (or the first below it), then the first
 * card of that line whose middle is right of the pointer, else after the
 * line's last. A line of one card reads its middle top to bottom instead,
 * since the cards then stand in a column. Past every line is the end.
 */
export function placementIndexAt(
	rects: readonly PlacementRect[],
	point: { x: number; y: number },
): number {
	if (rects.length === 0) return 0;
	const lines: { top: number; bottom: number; first: number; last: number }[] = [];
	rects.forEach((rect, index) => {
		const line = lines[lines.length - 1];
		if (line !== undefined && rect.top < line.bottom && rect.bottom > line.top) {
			line.last = index;
			line.top = Math.min(line.top, rect.top);
			line.bottom = Math.max(line.bottom, rect.bottom);
		} else {
			lines.push({ top: rect.top, bottom: rect.bottom, first: index, last: index });
		}
	});
	const line = lines.find((candidate) => point.y < candidate.bottom);
	if (line === undefined) return rects.length;
	if (line.first === line.last) {
		const rect = rects[line.first]!;
		return point.y < (rect.top + rect.bottom) / 2 ? line.first : line.first + 1;
	}
	for (let index = line.first; index <= line.last; index += 1) {
		const rect = rects[index]!;
		if ((rect.left + rect.right) / 2 > point.x) return index;
	}
	return line.last + 1;
}
