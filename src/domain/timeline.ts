/**
 * Timelines: what the author lays out along a story's time, kept apart from
 * the notes it points at. A timeline holds, for each time note it names, a
 * list of sub-description rows, and each row carries the scenes placed on
 * it; a view composes one or more timelines under one display order of
 * times and one way of showing scenes. Nothing here duplicates a note: a
 * time is named by its `snowflake-entity-id`, a scene by its
 * `snowflake-scene-id`, and the entity a timeline stands for by the same
 * `EntityRef` the tasks and the foreshadowing use. The labels come from the
 * notes at every dress, so a rename never has to reach this file.
 *
 * Everything below is pure: readers that take a stored shape leniently,
 * mutations that answer a new document or null when nothing would change,
 * and queries the surfaces read from. The store and the service keep the
 * file; this module knows what a timeline means.
 */

import { isEntityRef, type EntityRef } from './foreshadowing';

export const SCENE_PRESENTATIONS = ['flat', 'stack'] as const;
export type ScenePresentation = (typeof SCENE_PRESENTATIONS)[number];

export function isScenePresentation(value: unknown): value is ScenePresentation {
	return (SCENE_PRESENTATIONS as readonly unknown[]).includes(value);
}

export const TIMELINE_CARD_STYLES = ['compact', 'standard', 'extended'] as const;
export type TimelineCardStyle = (typeof TIMELINE_CARD_STYLES)[number];

export function isTimelineCardStyle(value: unknown): value is TimelineCardStyle {
	return (TIMELINE_CARD_STYLES as readonly unknown[]).includes(value);
}

/** A timeline may stand for any entity but a scene or a time, which are what it lays out. */
export function isTimelineBindingKind(kind: string): boolean {
	return kind !== 'scene' && kind !== 'time';
}

/** One sub-description of a time on one timeline, with the scenes placed on it. */
export interface TimelineRow {
	readonly id: string;
	/** What happens, changes or holds at that time; may be empty. */
	readonly text: string;
	/** Scene ids in the row's own order; a scene stands once in a whole timeline. */
	readonly scenes: readonly string[];
}

/** One time note on one timeline: the rows the timeline writes under it. */
export interface TimelineTime {
	/** The time note's snowflake-entity-id. */
	readonly timeId: string;
	readonly rows: readonly TimelineRow[];
}

export interface Timeline {
	readonly id: string;
	readonly name: string;
	/** The entity the timeline follows, never a scene or a time; null for a custom one. */
	readonly binding: EntityRef | null;
	/** In the order the times were added; a view keeps the order they are shown in. */
	readonly times: readonly TimelineTime[];
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface TimelineView {
	readonly id: string;
	readonly name: string;
	/** The timelines shown, in the view's own order. */
	readonly timelines: readonly string[];
	/** The time display order, the view's alone; may name times the view no longer shows. */
	readonly timeOrder: readonly string[];
	/** How the scenes are shown; null means the layout's own default. */
	readonly presentation: ScenePresentation | null;
	/** Reserved for a card style of the view's own; null while the pool's display control dresses the lanes. */
	readonly cardStyle: TimelineCardStyle | null;
	/** Whether the lanes show their rows' words; a view that keeps them away shows the scenes alone. */
	readonly showSubDescriptions: boolean;
	/** Whether the times run latest first; the rows under each keep their own order either way. */
	readonly timesReversed: boolean;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface TimelineDocument {
	readonly timelines: readonly Timeline[];
	readonly views: readonly TimelineView[];
	/** The one timeline shown first and made active wherever it is; null for none. */
	readonly pinnedTimelineId: string | null;
	/** The view opened last, so the workspace opens where it was left. */
	readonly lastViewId: string | null;
	/** Entries this build could not read, re-emitted after the readable ones on every write. */
	readonly strays: {
		readonly timelines: readonly unknown[];
		readonly views: readonly unknown[];
	};
}

export function emptyTimelineDocument(): TimelineDocument {
	return {
		timelines: [],
		views: [],
		pinnedTimelineId: null,
		lastViewId: null,
		strays: { timelines: [], views: [] },
	};
}

/** The id of the view a project starts with, fixed so every read of a file not yet written finds the same view. */
export const MAIN_TIMELINE_VIEW_ID = 'timeline-view-main';

/**
 * What a project reads before its timeline file is written: one view, named
 * in the project's language, so the workspace opens onto a view rather than
 * a hint. The first change writes it with the rest.
 */
export function freshTimelineDocument(locale: 'en' | 'zh-CN'): TimelineDocument {
	return {
		...emptyTimelineDocument(),
		views: [{
			id: MAIN_TIMELINE_VIEW_ID,
			name: locale === 'zh-CN' ? '主视图' : 'Main',
			timelines: [],
			timeOrder: [],
			presentation: null,
			cardStyle: null,
			showSubDescriptions: true,
			timesReversed: false,
			createdAt: 0,
			updatedAt: 0,
		}],
	};
}

/** The object written under the schema line: the readable entries first, the strays after. */
export function serializeTimelineDocument(held: TimelineDocument): Record<string, unknown> {
	return {
		timelines: [...held.timelines, ...held.strays.timelines],
		views: [...held.views, ...held.strays.views],
		pinnedTimelineId: held.pinnedTimelineId,
		lastViewId: held.lastViewId,
	};
}

// --- reading stored shapes -------------------------------------------------

const finiteOrZero = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

/** The limbs of a ref alone, whatever else rode in on the object. */
const refOf = (ref: EntityRef): EntityRef => ({
	kind: ref.kind,
	id: ref.id,
	name: ref.name,
});

const sameRef = (left: EntityRef | null, right: EntityRef | null): boolean =>
	left === right ||
	(left !== null &&
		right !== null &&
		left.kind === right.kind &&
		left.id === right.id &&
		left.name === right.name);

/** The non-empty strings of a list, each once, in the order first met. */
function uniqueIds(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const value of values) {
		if (!nonEmptyString(value) || seen.has(value)) continue;
		seen.add(value);
		kept.push(value);
	}
	return kept;
}

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * One row read leniently: it needs an id the timeline has not used, its text
 * reads as empty where it is not a string, and a scene placed earlier in the
 * timeline keeps its first place.
 */
function readRow(
	value: unknown,
	rowIds: Set<string>,
	placed: Set<string>,
): TimelineRow | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || rowIds.has(entry.id)) return null;
	rowIds.add(entry.id);
	const scenes: string[] = [];
	if (Array.isArray(entry.scenes)) {
		for (const scene of entry.scenes) {
			if (!nonEmptyString(scene) || placed.has(scene)) continue;
			placed.add(scene);
			scenes.push(scene);
		}
	}
	return {
		id: entry.id,
		text: typeof entry.text === 'string' ? entry.text : '',
		scenes,
	};
}

/**
 * One timeline read leniently: the id and the name must hold, and the rest
 * is read as far as it goes. A binding of a kind a timeline may not follow
 * reads as no binding; a time named twice keeps its first place and gathers
 * the later rows; a row id met twice drops the later row; a scene placed
 * twice keeps its first place. Null where the timeline itself will not
 * read, which the store sets aside as a stray.
 */
export function readTimeline(value: unknown): Timeline | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || typeof entry.name !== 'string') return null;
	const binding =
		isEntityRef(entry.binding) && isTimelineBindingKind(entry.binding.kind)
			? refOf(entry.binding)
			: null;
	const times: TimelineTime[] = [];
	const rowsByTime = new Map<string, TimelineRow[]>();
	const rowIds = new Set<string>();
	const placed = new Set<string>();
	if (Array.isArray(entry.times)) {
		for (const item of entry.times) {
			if (typeof item !== 'object' || item === null) continue;
			const time = item as Record<string, unknown>;
			if (!nonEmptyString(time.timeId)) continue;
			let rows = rowsByTime.get(time.timeId);
			if (rows === undefined) {
				rows = [];
				rowsByTime.set(time.timeId, rows);
				times.push({ timeId: time.timeId, rows });
			}
			if (!Array.isArray(time.rows)) continue;
			for (const raw of time.rows) {
				const row = readRow(raw, rowIds, placed);
				if (row !== null) rows.push(row);
			}
		}
	}
	return {
		id: entry.id,
		name: entry.name,
		binding,
		times,
		createdAt: finiteOrZero(entry.createdAt),
		updatedAt: finiteOrZero(entry.updatedAt),
	};
}

/** One view read leniently: id and name must hold; the lists are deduped, the choices checked. */
export function readTimelineView(value: unknown): TimelineView | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || typeof entry.name !== 'string') return null;
	return {
		id: entry.id,
		name: entry.name,
		timelines: uniqueIds(entry.timelines),
		timeOrder: uniqueIds(entry.timeOrder),
		presentation: isScenePresentation(entry.presentation) ? entry.presentation : null,
		cardStyle: isTimelineCardStyle(entry.cardStyle) ? entry.cardStyle : null,
		// Absent from the views 0.20.0 wrote, which showed the words.
		showSubDescriptions: entry.showSubDescriptions !== false,
		// Absent from the views before the choice, which ran first to last.
		timesReversed: entry.timesReversed === true,
		createdAt: finiteOrZero(entry.createdAt),
		updatedAt: finiteOrZero(entry.updatedAt),
	};
}

/**
 * The file's object read into a document, or null where it is not one at
 * all. An entry that will not read, or one whose id an earlier entry already
 * took, is kept as a stray rather than served. The pin and the last view are
 * kept as found, unchecked: what they name may be a stray this build cannot
 * read, and clearing them would lose a newer build's choice.
 */
export function readTimelineDocument(file: Record<string, unknown>): TimelineDocument | null {
	if (!Array.isArray(file.timelines) || !Array.isArray(file.views)) return null;
	const readInto = <T extends { id: string }>(
		entries: unknown[],
		read: (value: unknown) => T | null,
	): { kept: T[]; strays: unknown[] } => {
		const ids = new Set<string>();
		const kept: T[] = [];
		const strays: unknown[] = [];
		for (const entry of entries) {
			const record = read(entry);
			if (record === null || ids.has(record.id)) {
				strays.push(entry);
				continue;
			}
			ids.add(record.id);
			kept.push(record);
		}
		return { kept, strays };
	};
	const timelines = readInto(file.timelines, readTimeline);
	const views = readInto(file.views, readTimelineView);
	return {
		timelines: timelines.kept,
		views: views.kept,
		pinnedTimelineId: nonEmptyString(file.pinnedTimelineId) ? file.pinnedTimelineId : null,
		lastViewId: nonEmptyString(file.lastViewId) ? file.lastViewId : null,
		strays: { timelines: timelines.strays, views: views.strays },
	};
}

// --- queries ---------------------------------------------------------------

export function findTimeline(held: TimelineDocument, id: string): Timeline | undefined {
	return held.timelines.find((timeline) => timeline.id === id);
}

export function findTimelineView(held: TimelineDocument, id: string): TimelineView | undefined {
	return held.views.find((view) => view.id === id);
}

export interface ScenePlacement {
	timeId: string;
	rowId: string;
	/** Where the scene stands among the row's scenes. */
	index: number;
}

/** Where every placed scene stands on one timeline. */
export function scenePlacements(
	timeline: Pick<Timeline, 'times'>,
): Map<string, ScenePlacement> {
	const placements = new Map<string, ScenePlacement>();
	for (const time of timeline.times) {
		for (const row of time.rows) {
			row.scenes.forEach((sceneId, index) => {
				placements.set(sceneId, { timeId: time.timeId, rowId: row.id, index });
			});
		}
	}
	return placements;
}

/** The scenes, in the order given, that the timeline has not placed. */
export function unassignedScenes(
	timeline: Pick<Timeline, 'times'>,
	sceneIds: readonly string[],
): string[] {
	const placed = scenePlacements(timeline);
	return sceneIds.filter((sceneId) => !placed.has(sceneId));
}

/** How a view shows its scenes when it has not said: flat for one timeline, stacked for more. */
export function derivedPresentation(
	view: Pick<TimelineView, 'timelines' | 'presentation'>,
): ScenePresentation {
	return view.presentation ?? (view.timelines.length <= 1 ? 'flat' : 'stack');
}

/**
 * The timeline the scene pool works on when a view opens: the pinned one
 * when the view holds it, else the view's first; with no view at all, the
 * pinned one alone.
 */
export function activeTimelineFor(
	view: Pick<TimelineView, 'timelines'> | null,
	pinnedTimelineId: string | null,
): string | null {
	if (view === null) return pinnedTimelineId;
	if (pinnedTimelineId !== null && view.timelines.includes(pinnedTimelineId)) {
		return pinnedTimelineId;
	}
	return view.timelines[0] ?? null;
}

/**
 * The order a view shows its times in: the stored order, kept to the times
 * its timelines hold; then the times those timelines hold that the order
 * has not placed, in the canonical order the time notes keep; then, last,
 * any time the project no longer has, in the order first met. Never reads
 * or writes the notes' own rank.
 */
export function resolvedTimeOrder(
	view: Pick<TimelineView, 'timelines' | 'timeOrder'>,
	timelines: readonly Timeline[],
	canonicalTimeIds: readonly string[],
): string[] {
	const present: string[] = [];
	const presentSet = new Set<string>();
	for (const timelineId of view.timelines) {
		const timeline = timelines.find((candidate) => candidate.id === timelineId);
		if (timeline === undefined) continue;
		for (const time of timeline.times) {
			if (presentSet.has(time.timeId)) continue;
			presentSet.add(time.timeId);
			present.push(time.timeId);
		}
	}
	const ordered = view.timeOrder.filter((timeId) => presentSet.has(timeId));
	const placed = new Set(ordered);
	const canonical = canonicalTimeIds.filter(
		(timeId) => presentSet.has(timeId) && !placed.has(timeId),
	);
	for (const timeId of canonical) placed.add(timeId);
	const gone = present.filter((timeId) => !placed.has(timeId));
	return [...ordered, ...canonical, ...gone];
}

// --- mutations -------------------------------------------------------------

/**
 * A list with one entry moved in front of another, or to the end when no
 * anchor is named or the one named has gone since the surface was painted.
 * Null where the entry is not in the list, or already stands there.
 */
function movedBefore(
	list: readonly string[],
	id: string,
	beforeId: string | null,
): string[] | null {
	if (!list.includes(id) || beforeId === id) return null;
	const rest = list.filter((candidate) => candidate !== id);
	const at = beforeId === null ? -1 : rest.indexOf(beforeId);
	const next =
		at === -1 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
	return sameList(next, list) ? null : next;
}

function replaceTimeline(
	held: TimelineDocument,
	id: string,
	change: (timeline: Timeline) => Timeline | null,
	now: number,
): TimelineDocument | null {
	const timeline = findTimeline(held, id);
	if (timeline === undefined) return null;
	const next = change(timeline);
	if (next === null) return null;
	const stamped: Timeline = { ...next, updatedAt: now };
	return {
		...held,
		timelines: held.timelines.map((candidate) =>
			candidate === timeline ? stamped : candidate,
		),
	};
}

function replaceView(
	held: TimelineDocument,
	id: string,
	change: (view: TimelineView) => TimelineView | null,
	now: number,
): TimelineDocument | null {
	const view = findTimelineView(held, id);
	if (view === undefined) return null;
	const next = change(view);
	if (next === null) return null;
	const stamped: TimelineView = { ...next, updatedAt: now };
	return {
		...held,
		views: held.views.map((candidate) => (candidate === view ? stamped : candidate)),
	};
}

/** Appends a timeline; null when its id already stands or its binding is of a kind it may not follow. */
export function createTimeline(
	held: TimelineDocument,
	timeline: Timeline,
): TimelineDocument | null {
	if (findTimeline(held, timeline.id) !== undefined) return null;
	if (timeline.binding !== null && !isTimelineBindingKind(timeline.binding.kind)) {
		return null;
	}
	return {
		...held,
		timelines: [
			...held.timelines,
			{
				...timeline,
				binding: timeline.binding === null ? null : refOf(timeline.binding),
			},
		],
	};
}

export function renameTimeline(
	held: TimelineDocument,
	id: string,
	name: string,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, id, (timeline) =>
		timeline.name === name ? null : { ...timeline, name }, now);
}

/** Points the timeline at an entity, or at none; refused for a scene or a time. */
export function bindTimeline(
	held: TimelineDocument,
	id: string,
	binding: EntityRef | null,
	now: number,
): TimelineDocument | null {
	if (binding !== null && !isTimelineBindingKind(binding.kind)) return null;
	return replaceTimeline(held, id, (timeline) =>
		sameRef(timeline.binding, binding)
			? null
			: { ...timeline, binding: binding === null ? null : refOf(binding) }, now);
}

/**
 * Takes a timeline out: from the document, from every view that showed it
 * and from the pin. A view left with no timeline stands, empty, for the
 * author to fill or delete.
 */
export function deleteTimeline(held: TimelineDocument, id: string): TimelineDocument | null {
	if (findTimeline(held, id) === undefined) return null;
	return {
		...held,
		timelines: held.timelines.filter((timeline) => timeline.id !== id),
		views: held.views.map((view) =>
			view.timelines.includes(id)
				? { ...view, timelines: view.timelines.filter((candidate) => candidate !== id) }
				: view,
		),
		pinnedTimelineId: held.pinnedTimelineId === id ? null : held.pinnedTimelineId,
	};
}

/** Pins one timeline, or none; null when nothing moves or the id names no timeline. */
export function pinTimeline(held: TimelineDocument, id: string | null): TimelineDocument | null {
	if (id !== null && findTimeline(held, id) === undefined) return null;
	if (held.pinnedTimelineId === id) return null;
	return { ...held, pinnedTimelineId: id };
}

/** Appends a view; null when its id already stands. Its lists are deduped on the way in. */
export function createTimelineView(
	held: TimelineDocument,
	view: TimelineView,
): TimelineDocument | null {
	if (findTimelineView(held, view.id) !== undefined) return null;
	return {
		...held,
		views: [
			...held.views,
			{ ...view, timelines: uniqueIds(view.timelines), timeOrder: uniqueIds(view.timeOrder) },
		],
	};
}

export function renameTimelineView(
	held: TimelineDocument,
	id: string,
	name: string,
	now: number,
): TimelineDocument | null {
	return replaceView(held, id, (view) => (view.name === name ? null : { ...view, name }), now);
}

/** Takes a view out, and the memory of it as the last one opened; its timelines stand. */
export function deleteTimelineView(held: TimelineDocument, id: string): TimelineDocument | null {
	if (findTimelineView(held, id) === undefined) return null;
	return {
		...held,
		views: held.views.filter((view) => view.id !== id),
		lastViewId: held.lastViewId === id ? null : held.lastViewId,
	};
}

/** Remembers the view opened last, or none; null when nothing moves or the id names no view. */
export function setLastTimelineView(
	held: TimelineDocument,
	id: string | null,
): TimelineDocument | null {
	if (id !== null && findTimelineView(held, id) === undefined) return null;
	if (held.lastViewId === id) return null;
	return { ...held, lastViewId: id };
}

/**
 * The whole list of a view's timelines, in order. Whether an id names a
 * timeline is not checked: a stray's id handed back stays where it was.
 */
export function setViewTimelines(
	held: TimelineDocument,
	viewId: string,
	timelineIds: readonly string[],
	now: number,
): TimelineDocument | null {
	const next = uniqueIds(timelineIds);
	return replaceView(held, viewId, (view) =>
		sameList(view.timelines, next) ? null : { ...view, timelines: next }, now);
}

/** One of a view's timelines moved in front of another, or to the end. */
export function moveTimelineInView(
	held: TimelineDocument,
	viewId: string,
	timelineId: string,
	beforeTimelineId: string | null,
	now: number,
): TimelineDocument | null {
	return replaceView(held, viewId, (view) => {
		const next = movedBefore(view.timelines, timelineId, beforeTimelineId);
		return next === null ? null : { ...view, timelines: next };
	}, now);
}

/** The view's time display order, as handed; the notes' own rank is never touched. */
export function setViewTimeOrder(
	held: TimelineDocument,
	viewId: string,
	timeIds: readonly string[],
	now: number,
): TimelineDocument | null {
	const next = uniqueIds(timeIds);
	return replaceView(held, viewId, (view) =>
		sameList(view.timeOrder, next) ? null : { ...view, timeOrder: next }, now);
}

export function setViewPresentation(
	held: TimelineDocument,
	viewId: string,
	presentation: ScenePresentation | null,
	now: number,
): TimelineDocument | null {
	return replaceView(held, viewId, (view) =>
		view.presentation === presentation ? null : { ...view, presentation }, now);
}

export function setViewCardStyle(
	held: TimelineDocument,
	viewId: string,
	cardStyle: TimelineCardStyle | null,
	now: number,
): TimelineDocument | null {
	return replaceView(held, viewId, (view) =>
		view.cardStyle === cardStyle ? null : { ...view, cardStyle }, now);
}

/** Shows the rows' words on the view's lanes, or keeps them away. */
export function setViewSubDescriptions(
	held: TimelineDocument,
	viewId: string,
	shown: boolean,
	now: number,
): TimelineDocument | null {
	return replaceView(held, viewId, (view) =>
		view.showSubDescriptions === shown ? null : { ...view, showSubDescriptions: shown }, now);
}

/** Runs the view's times latest first, or first to last again; the rows under each are untouched. */
export function setViewTimesReversed(
	held: TimelineDocument,
	viewId: string,
	reversed: boolean,
	now: number,
): TimelineDocument | null {
	return replaceView(held, viewId, (view) =>
		view.timesReversed === reversed ? null : { ...view, timesReversed: reversed }, now);
}

/** A time joins the timeline with no rows yet; null when it already stands there. */
export function addTimelineTime(
	held: TimelineDocument,
	timelineId: string,
	timeId: string,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) =>
		timeline.times.some((time) => time.timeId === timeId)
			? null
			: { ...timeline, times: [...timeline.times, { timeId, rows: [] }] }, now);
}

/** A time leaves the timeline with its rows and their placements; the views' orders stand. */
export function removeTimelineTime(
	held: TimelineDocument,
	timelineId: string,
	timeId: string,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) =>
		timeline.times.some((time) => time.timeId === timeId)
			? { ...timeline, times: timeline.times.filter((time) => time.timeId !== timeId) }
			: null, now);
}

/** The timeline with every placement of the scenes named taken out, or itself when none stood. */
function withoutScenes(timeline: Timeline, sceneIds: ReadonlySet<string>): Timeline {
	if (sceneIds.size === 0) return timeline;
	let changed = false;
	const times = timeline.times.map((time) => {
		let touched = false;
		const rows = time.rows.map((row) => {
			if (!row.scenes.some((sceneId) => sceneIds.has(sceneId))) return row;
			touched = true;
			return { ...row, scenes: row.scenes.filter((sceneId) => !sceneIds.has(sceneId)) };
		});
		if (!touched) return time;
		changed = true;
		return { ...time, rows };
	});
	return changed ? { ...timeline, times } : timeline;
}

/** The timeline with one time's rows replaced, the time added at the end when it was absent. */
function withRows(
	timeline: Timeline,
	timeId: string,
	rows: readonly TimelineRow[],
): Timeline {
	if (timeline.times.some((time) => time.timeId === timeId)) {
		return {
			...timeline,
			times: timeline.times.map((time) => (time.timeId === timeId ? { ...time, rows } : time)),
		};
	}
	return { ...timeline, times: [...timeline.times, { timeId, rows }] };
}

/** Where a row stands, by its id, or nothing. */
function rowPlace(
	timeline: Pick<Timeline, 'times'>,
	rowId: string,
): { time: TimelineTime; row: TimelineRow; index: number } | null {
	for (const time of timeline.times) {
		const index = time.rows.findIndex((row) => row.id === rowId);
		if (index !== -1) return { time, row: time.rows[index]!, index };
	}
	return null;
}

/** Rows with one put before the anchor, or at the end when the anchor is not among them. */
function rowsWith(
	rows: readonly TimelineRow[],
	row: TimelineRow,
	beforeRowId: string | null,
): TimelineRow[] {
	const at = beforeRowId === null ? -1 : rows.findIndex((candidate) => candidate.id === beforeRowId);
	return at === -1 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
}

/**
 * A new row under a time, before a neighbour or at the end, the time joining
 * the timeline on the way when it was absent: a view's grid is every time
 * across every lane, and an empty cell is a place to write. The row's id
 * must be new to the timeline. Scenes placed on the way lose any earlier
 * place on this timeline, since a scene stands once on it.
 */
export function addTimelineRow(
	held: TimelineDocument,
	timelineId: string,
	timeId: string,
	row: { id: string; text: string; scenes?: readonly string[] },
	beforeRowId: string | null,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) => {
		if (rowPlace(timeline, row.id) !== null) return null;
		const scenes = uniqueIds(row.scenes ?? []);
		const cleared = withoutScenes(timeline, new Set(scenes));
		const time = cleared.times.find((candidate) => candidate.timeId === timeId);
		const rows = rowsWith(time?.rows ?? [], { id: row.id, text: row.text, scenes }, beforeRowId);
		return withRows(cleared, timeId, rows);
	}, now);
}

export function editTimelineRow(
	held: TimelineDocument,
	timelineId: string,
	rowId: string,
	text: string,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) => {
		const place = rowPlace(timeline, rowId);
		if (place === null || place.row.text === text) return null;
		const rows = place.time.rows.map((row) => (row === place.row ? { ...row, text } : row));
		return withRows(timeline, place.time.timeId, rows);
	}, now);
}

/**
 * A row moved, with its scenes, before a neighbour under a time of the same
 * timeline, or to that time's end; the time joins the timeline when it was
 * absent. Null when the row already stands exactly there.
 */
export function moveTimelineRow(
	held: TimelineDocument,
	timelineId: string,
	rowId: string,
	toTimeId: string,
	beforeRowId: string | null,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) => {
		const place = rowPlace(timeline, rowId);
		if (place === null || beforeRowId === rowId) return null;
		const sourceRows = place.time.rows.filter((row) => row !== place.row);
		const taken = withRows(timeline, place.time.timeId, sourceRows);
		const target = taken.times.find((candidate) => candidate.timeId === toTimeId);
		const rows = rowsWith(target?.rows ?? [], place.row, beforeRowId);
		if (
			place.time.timeId === toTimeId &&
			rows.length === place.time.rows.length &&
			rows.every((row, index) => row === place.time.rows[index])
		) {
			return null;
		}
		return withRows(taken, toTimeId, rows);
	}, now);
}

/** A row leaves the timeline; its scenes are simply unplaced. */
export function deleteTimelineRow(
	held: TimelineDocument,
	timelineId: string,
	rowId: string,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) => {
		const place = rowPlace(timeline, rowId);
		if (place === null) return null;
		return withRows(
			timeline,
			place.time.timeId,
			place.time.rows.filter((row) => row !== place.row),
		);
	}, now);
}

/**
 * A scene placed on a row, before another scene of that row or at its end,
 * any earlier place on this timeline given up first: a scene stands once on
 * a timeline, and moving it is where it stands changing. Null when the row
 * is not the timeline's, or the scene already stands exactly there.
 */
export function placeTimelineScene(
	held: TimelineDocument,
	timelineId: string,
	sceneId: string,
	rowId: string,
	beforeSceneId: string | null,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) => {
		if (rowPlace(timeline, rowId) === null) return null;
		const cleared = withoutScenes(timeline, new Set([sceneId]));
		const place = rowPlace(cleared, rowId);
		if (place === null) return null;
		const anchor = beforeSceneId === sceneId ? null : beforeSceneId;
		const at = anchor === null ? -1 : place.row.scenes.indexOf(anchor);
		const scenes =
			at === -1
				? [...place.row.scenes, sceneId]
				: [...place.row.scenes.slice(0, at), sceneId, ...place.row.scenes.slice(at)];
		const before = rowPlace(timeline, rowId);
		if (before !== null && sameList(before.row.scenes, scenes)) return null;
		const rows = place.time.rows.map((row) => (row === place.row ? { ...row, scenes } : row));
		return withRows(cleared, place.time.timeId, rows);
	}, now);
}

/** A scene's place on the timeline given up; the scene itself is untouched. */
export function removeTimelineScene(
	held: TimelineDocument,
	timelineId: string,
	sceneId: string,
	now: number,
): TimelineDocument | null {
	return replaceTimeline(held, timelineId, (timeline) => {
		const cleared = withoutScenes(timeline, new Set([sceneId]));
		return cleared === timeline ? null : cleared;
	}, now);
}

/**
 * Placements of scenes, and times, the project no longer has, taken out
 * wherever they stand; each set is optional and only what is handed in is
 * pruned. A time pruned leaves every view's order as well. Never called on a
 * reading's behalf: a note missing today may be back tomorrow from sync, and
 * the surfaces show a missing reference as missing until the author says.
 */
export function pruneMissingFromTimelines(
	held: TimelineDocument,
	known: { sceneIds?: ReadonlySet<string>; timeIds?: ReadonlySet<string> },
	now: number,
): TimelineDocument | null {
	let changed = false;
	const timelines = held.timelines.map((timeline) => {
		let next = timeline;
		if (known.timeIds !== undefined) {
			const timeIds = known.timeIds;
			if (next.times.some((time) => !timeIds.has(time.timeId))) {
				next = { ...next, times: next.times.filter((time) => timeIds.has(time.timeId)) };
			}
		}
		if (known.sceneIds !== undefined) {
			const sceneIds = known.sceneIds;
			const unknown = new Set<string>();
			for (const time of next.times) {
				for (const row of time.rows) {
					for (const sceneId of row.scenes) if (!sceneIds.has(sceneId)) unknown.add(sceneId);
				}
			}
			next = withoutScenes(next, unknown);
		}
		if (next === timeline) return timeline;
		changed = true;
		return { ...next, updatedAt: now };
	});
	const views = held.views.map((view) => {
		const timeIds = known.timeIds;
		if (timeIds === undefined || view.timeOrder.every((timeId) => timeIds.has(timeId))) {
			return view;
		}
		changed = true;
		return {
			...view,
			timeOrder: view.timeOrder.filter((timeId) => timeIds.has(timeId)),
			updatedAt: now,
		};
	});
	return changed ? { ...held, timelines, views } : null;
}
