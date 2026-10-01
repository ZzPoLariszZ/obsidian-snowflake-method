/**
 * Freeform: a project's resources set out on a plane, kept apart from the
 * notes and the records they point at. A view is one plane: placements, each
 * one appearance of a resource at a place and a size; frames, each a titled
 * ground that gathers placements; edges drawn between them; and where the
 * author last stood looking. Nothing here duplicates a resource: an entity is
 * named by the stable id its note carries, a task, a thread, a revision and a
 * sticky note by the id of its record, a file by its path inside the project.
 * Only a link's address and a text node's words are kept here whole, since
 * they live nowhere else.
 *
 * A resource may stand on a view as often as the author likes, and on as many
 * views. A placement has an id of its own, and a view's ids are that view's
 * alone. Every coordinate is the plane's own, whatever frame holds the node,
 * so a frame that will not read leaves its members where they stood.
 *
 * A change is a list of steps taken together or not at all, and each step
 * taken answers with the steps that take it back, worked out against the view
 * as it stood: what undoes a change is known where the change is made.
 *
 * Everything below is pure, as the timeline's module is: readers that take a
 * stored shape leniently, steps that answer a new view or say why not, and
 * queries the surfaces read from.
 */

import { isMacaronColor, type MacaronColor } from './macaron';

export const FREEFORM_RESOURCE_TYPES = [
	'entity',
	'task',
	'foreshadowing',
	'revision',
	'sticky-note',
	'file',
	'link',
	'text',
] as const;
export type FreeformResourceType = (typeof FREEFORM_RESOURCE_TYPES)[number];

/** The kinds of record a placement names by the id the record carries. */
export const FREEFORM_RECORD_TYPES = ['task', 'foreshadowing', 'revision', 'sticky-note'] as const;
export type FreeformRecordType = (typeof FREEFORM_RECORD_TYPES)[number];

export function isFreeformRecordType(value: unknown): value is FreeformRecordType {
	return (FREEFORM_RECORD_TYPES as readonly unknown[]).includes(value);
}

export interface FreeformEntityResource {
	readonly type: 'entity';
	/** 'character', 'scene' or a worldbuilding kind id, as last seen; the project's own word wins while the note stands. */
	readonly kind: string;
	/** The note's snowflake-character-id, -scene-id or -entity-id. */
	readonly id: string;
	/** The label last seen, kept only so a note that has gone can still be called something. */
	readonly name: string;
}

export interface FreeformRecordResource {
	readonly type: FreeformRecordType;
	readonly id: string;
	/** The label last seen: a task's title, a thread's name, a note's first words, the words a revision was made over. */
	readonly name: string;
}

export interface FreeformFileResource {
	readonly type: 'file';
	/** From the project's root, so a project renamed moves nothing; never absolute, never climbing out. */
	readonly path: string;
}

export interface FreeformLinkResource {
	readonly type: 'link';
	/** An http or https address. */
	readonly url: string;
	/** What the author calls it; empty where the address speaks for itself. */
	readonly label: string;
}

export interface FreeformTextResource {
	readonly type: 'text';
	/** The node's own words, Markdown; they live here and nowhere else. */
	readonly text: string;
}

export type FreeformResource =
	| FreeformEntityResource
	| FreeformRecordResource
	| FreeformFileResource
	| FreeformLinkResource
	| FreeformTextResource;

/** Auto lets the zoom choose among the three card styles. */
export const FREEFORM_DISPLAY_MODES = ['auto', 'compact', 'standard', 'extended'] as const;
export type FreeformDisplayMode = (typeof FREEFORM_DISPLAY_MODES)[number];

export function isFreeformDisplayMode(value: unknown): value is FreeformDisplayMode {
	return (FREEFORM_DISPLAY_MODES as readonly unknown[]).includes(value);
}

/** One appearance of a resource on a view: how it is shown, and nothing of what it is. */
export interface FreeformPlacement {
	readonly id: string;
	readonly resource: FreeformResource;
	/** The top left corner on the plane, in whole units, whatever frame holds it. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly displayMode: FreeformDisplayMode;
	/** Its place among the placements, low under high; equals stand in the order kept. */
	readonly zIndex: number;
	/** The frame that holds it; null for one that stands free. */
	readonly frameId: string | null;
}

/** A titled ground. It names no resource, so it is no placement. */
export interface FreeformFrame {
	readonly id: string;
	readonly title: string;
	readonly color: MacaronColor | null;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	/** Its place among the frames, which all stand under every placement. */
	readonly zIndex: number;
}

export const FREEFORM_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type FreeformSide = (typeof FREEFORM_SIDES)[number];

export function isFreeformSide(value: unknown): value is FreeformSide {
	return (FREEFORM_SIDES as readonly unknown[]).includes(value);
}

export const FREEFORM_ARROWS = ['none', 'end', 'both'] as const;
export type FreeformArrow = (typeof FREEFORM_ARROWS)[number];

export function isFreeformArrow(value: unknown): value is FreeformArrow {
	return (FREEFORM_ARROWS as readonly unknown[]).includes(value);
}

export const FREEFORM_LINES = ['solid', 'dashed', 'dotted'] as const;
export type FreeformLine = (typeof FREEFORM_LINES)[number];

export function isFreeformLine(value: unknown): value is FreeformLine {
	return (FREEFORM_LINES as readonly unknown[]).includes(value);
}

/** A line drawn between two things on a view. It says nothing of what it joins, and changes nothing of them. */
export interface FreeformEdge {
	readonly id: string;
	/** A placement or a frame of the same view, by id. */
	readonly source: string;
	readonly target: string;
	/** The side it leaves by; null leaves the choice to the paint. */
	readonly sourceSide: FreeformSide | null;
	readonly targetSide: FreeformSide | null;
	readonly label: string;
	readonly arrow: FreeformArrow;
	readonly line: FreeformLine;
}

/** Where a leaf stood looking. Written with a change to the view, or as the view is left; never for a pan alone. */
export interface FreeformViewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

export interface FreeformView {
	readonly id: string;
	readonly name: string;
	readonly placements: readonly FreeformPlacement[];
	readonly frames: readonly FreeformFrame[];
	readonly edges: readonly FreeformEdge[];
	readonly viewport: FreeformViewport;
	readonly createdAt: number;
	/** Bumped by a change to what stands on the view or to its name; looking about never touches it. */
	readonly updatedAt: number;
	/** Entries this build could not read or could not place, re-emitted after the readable ones on every write. */
	readonly strays: {
		readonly placements: readonly unknown[];
		readonly frames: readonly unknown[];
		readonly edges: readonly unknown[];
	};
}

/** A project's views, in the order they were made. Each is a file of its own; the store lays the one over the many. */
export interface FreeformDocument {
	readonly views: readonly FreeformView[];
}

/** How much one view may hold, and how long the words kept in it may run. */
export interface FreeformLimits {
	placements: number;
	frames: number;
	edges: number;
	textLength: number;
	labelLength: number;
}

/**
 * Settled by measuring on a project of 3,000 scenes: at 500 nodes every
 * gesture keeps its frames (a pan with all in sight at 60 a second, 6 ms of
 * work a frame); at 1,000 the browser's own bookkeeping of a thousand
 * moving boxes takes 16 ms a frame on its own, and a pan drops to 30. Words
 * beyond these are what a node can show, not what a file can hold.
 */
export const FREEFORM_LIMITS: Readonly<FreeformLimits> = {
	placements: 500,
	frames: 50,
	edges: 1000,
	textLength: 10_000,
	labelLength: 200,
};

/** What a node measures where its stored size will not read, and the bounds a size is kept within. */
export const FREEFORM_SIZE = { width: 256, height: 160, min: 32, max: 8192 } as const;

/** How far out and how far in a view may be looked at. */
export const FREEFORM_ZOOM = { min: 0.1, max: 4 } as const;

/** How far from the plane's middle anything may stand: far past any use, and well within what a number holds exactly. */
const FREEFORM_REACH = 10_000_000;

/** The room a frame made around its members leaves them, and the room its title takes above them. */
export const FREEFORM_FRAME_PADDING = 24;
export const FREEFORM_FRAME_HEAD = 40;

export const DEFAULT_FREEFORM_VIEWPORT: FreeformViewport = { x: 0, y: 0, zoom: 1 };

export function emptyFreeformDocument(): FreeformDocument {
	return { views: [] };
}

// --- reading stored shapes -------------------------------------------------

const finiteOrZero = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : 0;

const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A place on the plane in whole units, kept within reach. */
const unit = (value: number): number =>
	Math.round(Math.min(FREEFORM_REACH, Math.max(-FREEFORM_REACH, value)));

/** A size in whole units within the bounds; the default where the value will not read. */
const sizeOf = (value: unknown, otherwise: number): number =>
	finite(value) && value > 0
		? Math.round(Math.min(FREEFORM_SIZE.max, Math.max(FREEFORM_SIZE.min, value)))
		: otherwise;

const HTTP_ADDRESS = /^https?:\/\/[^\s]+$/iu;

/** Whether an address is one a link node may keep: http or https, and nothing with a gap in it. */
export function isFreeformAddress(value: unknown): value is string {
	return typeof value === 'string' && HTTP_ADDRESS.test(value);
}

/**
 * Whether a path is one a file node may keep: written from the project's
 * root with forward slashes, never absolute and never climbing out of it.
 */
export function isFreeformResourcePath(value: unknown): value is string {
	if (!nonEmptyString(value)) return false;
	if (value.startsWith('/') || value.includes('\\')) return false;
	return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/**
 * What a placement names, read leniently: the type must be one this build
 * knows and what identifies the resource must hold, and a label that will
 * not read is read as none. Null where the resource will not read, which
 * makes its placement a stray: a type this build has never heard of is a
 * newer build's, and reading it as any other would show the author something
 * they never placed.
 */
export function readFreeformResource(value: unknown): FreeformResource | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	switch (entry.type) {
		case 'entity':
			if (!nonEmptyString(entry.kind) || !nonEmptyString(entry.id)) return null;
			return { type: 'entity', kind: entry.kind, id: entry.id, name: stringOrEmpty(entry.name) };
		case 'task':
		case 'foreshadowing':
		case 'revision':
		case 'sticky-note':
			if (!nonEmptyString(entry.id)) return null;
			return { type: entry.type, id: entry.id, name: stringOrEmpty(entry.name) };
		case 'file':
			return isFreeformResourcePath(entry.path) ? { type: 'file', path: entry.path } : null;
		case 'link':
			return isFreeformAddress(entry.url)
				? { type: 'link', url: entry.url, label: stringOrEmpty(entry.label) }
				: null;
		case 'text':
			return typeof entry.text === 'string' ? { type: 'text', text: entry.text } : null;
		default:
			return null;
	}
}

/** The highest place standing in a band, or one under nothing where the band is empty. */
const topOf = (band: readonly { zIndex: number }[]): number =>
	band.reduce((top, entry) => Math.max(top, entry.zIndex), -1);

/**
 * One frame read leniently: its id must be new to the view and its corner
 * must be a place, and the rest is read as far as it goes. Null where the
 * frame itself will not read.
 */
function readFrame(value: unknown, taken: Set<string>, top: number): FreeformFrame | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || taken.has(entry.id)) return null;
	if (!finite(entry.x) || !finite(entry.y)) return null;
	return {
		id: entry.id,
		title: stringOrEmpty(entry.title),
		color: isMacaronColor(entry.color) ? entry.color : null,
		x: unit(entry.x),
		y: unit(entry.y),
		width: sizeOf(entry.width, FREEFORM_SIZE.width),
		height: sizeOf(entry.height, FREEFORM_SIZE.height),
		zIndex: finite(entry.zIndex) ? Math.round(entry.zIndex) : top + 1,
	};
}

/**
 * One placement read leniently: its id must be new to the view, its
 * resource must read and its corner must be a place, since there is no
 * honest place to give a node that says none. A size that will not read is
 * the default, a mode this build has not heard of is left to the zoom, and a
 * frame that is not among those read holds nothing: the node stands free
 * where it stood.
 */
function readPlacement(
	value: unknown,
	taken: Set<string>,
	frames: ReadonlySet<string>,
	top: number,
): FreeformPlacement | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || taken.has(entry.id)) return null;
	if (!finite(entry.x) || !finite(entry.y)) return null;
	const resource = readFreeformResource(entry.resource);
	if (resource === null) return null;
	return {
		id: entry.id,
		resource,
		x: unit(entry.x),
		y: unit(entry.y),
		width: sizeOf(entry.width, FREEFORM_SIZE.width),
		height: sizeOf(entry.height, FREEFORM_SIZE.height),
		displayMode: isFreeformDisplayMode(entry.displayMode) ? entry.displayMode : 'auto',
		zIndex: finite(entry.zIndex) ? Math.round(entry.zIndex) : top + 1,
		frameId: nonEmptyString(entry.frameId) && frames.has(entry.frameId) ? entry.frameId : null,
	};
}

/**
 * One edge read leniently: its id must be new among the edges, and both its
 * ends must be nodes that read and not one and the same. Null otherwise, and
 * the edge is carried as a stray rather than dropped: the end it names may be
 * a placement this build set aside, which a newer one reads.
 */
function readEdge(value: unknown, taken: Set<string>, nodes: ReadonlySet<string>): FreeformEdge | null {
	if (typeof value !== 'object' || value === null) return null;
	const entry = value as Record<string, unknown>;
	if (!nonEmptyString(entry.id) || taken.has(entry.id)) return null;
	if (!nonEmptyString(entry.source) || !nonEmptyString(entry.target)) return null;
	if (entry.source === entry.target) return null;
	if (!nodes.has(entry.source) || !nodes.has(entry.target)) return null;
	return {
		id: entry.id,
		source: entry.source,
		target: entry.target,
		sourceSide: isFreeformSide(entry.sourceSide) ? entry.sourceSide : null,
		targetSide: isFreeformSide(entry.targetSide) ? entry.targetSide : null,
		label: stringOrEmpty(entry.label),
		arrow: isFreeformArrow(entry.arrow) ? entry.arrow : 'end',
		line: isFreeformLine(entry.line) ? entry.line : 'solid',
	};
}

/** Where a leaf stood, read as far as it goes: a part that will not read is the plane's middle at its own size. */
export function readFreeformViewport(value: unknown): FreeformViewport {
	if (typeof value !== 'object' || value === null) return DEFAULT_FREEFORM_VIEWPORT;
	const entry = value as Record<string, unknown>;
	if (!finite(entry.x) || !finite(entry.y) || !finite(entry.zoom) || entry.zoom <= 0) {
		return DEFAULT_FREEFORM_VIEWPORT;
	}
	return {
		x: entry.x,
		y: entry.y,
		zoom: Math.min(FREEFORM_ZOOM.max, Math.max(FREEFORM_ZOOM.min, entry.zoom)),
	};
}

/**
 * A view's file read into a view, or null where it is not one at all. The id
 * is the file's own name and never the one written inside, so a file copied
 * or renamed by hand cannot disagree with itself. A list that is absent reads
 * as empty, and one that stands as anything but a list is damage: a list
 * written over it would lose whatever it was. Frames are read first, since a
 * placement names the frame that holds it and an edge may end on either.
 */
export function readFreeformView(file: Record<string, unknown>, id: string): FreeformView | null {
	if (typeof file.name !== 'string') return null;
	const lists: Record<'placements' | 'frames' | 'edges', unknown[]> = { placements: [], frames: [], edges: [] };
	for (const key of ['placements', 'frames', 'edges'] as const) {
		const stored = file[key];
		if (stored === undefined) continue;
		if (!Array.isArray(stored)) return null;
		lists[key] = stored;
	}
	const taken = new Set<string>();
	const frames: FreeformFrame[] = [];
	const strayFrames: unknown[] = [];
	for (const entry of lists.frames) {
		const frame = readFrame(entry, taken, topOf(frames));
		if (frame === null) {
			strayFrames.push(entry);
			continue;
		}
		taken.add(frame.id);
		frames.push(frame);
	}
	const frameIds = new Set(frames.map((frame) => frame.id));
	const placements: FreeformPlacement[] = [];
	const strayPlacements: unknown[] = [];
	for (const entry of lists.placements) {
		const placement = readPlacement(entry, taken, frameIds, topOf(placements));
		if (placement === null) {
			strayPlacements.push(entry);
			continue;
		}
		taken.add(placement.id);
		placements.push(placement);
	}
	const edgeIds = new Set<string>();
	const edges: FreeformEdge[] = [];
	const strayEdges: unknown[] = [];
	for (const entry of lists.edges) {
		const edge = readEdge(entry, edgeIds, taken);
		if (edge === null) {
			strayEdges.push(entry);
			continue;
		}
		edgeIds.add(edge.id);
		edges.push(edge);
	}
	return {
		id,
		name: file.name,
		placements,
		frames,
		edges,
		viewport: readFreeformViewport(file.viewport),
		createdAt: finiteOrZero(file.createdAt),
		updatedAt: finiteOrZero(file.updatedAt),
		strays: { placements: strayPlacements, frames: strayFrames, edges: strayEdges },
	};
}

/** The object written under the schema line: the readable entries first, the strays after. */
export function serializeFreeformView(held: FreeformView): Record<string, unknown> {
	return {
		id: held.id,
		name: held.name,
		placements: [...held.placements, ...held.strays.placements],
		frames: [...held.frames, ...held.strays.frames],
		edges: [...held.edges, ...held.strays.edges],
		viewport: held.viewport,
		createdAt: held.createdAt,
		updatedAt: held.updatedAt,
	};
}

// --- queries ---------------------------------------------------------------

export function findFreeformView(held: FreeformDocument, id: string): FreeformView | undefined {
	return held.views.find((view) => view.id === id);
}

/**
 * The view to show: the one picked while it stands, else the one changed
 * last, else none. Which view a leaf shows is the leaf's own to remember,
 * since no file is the whole project's.
 */
export function shownFreeformViewId(held: FreeformDocument, picked: string | null): string | null {
	if (picked !== null && findFreeformView(held, picked) !== undefined) return picked;
	let latest: FreeformView | null = null;
	for (const view of held.views) {
		if (latest === null || view.updatedAt > latest.updatedAt) latest = view;
	}
	return latest?.id ?? null;
}

export function findFreeformPlacement(
	view: Pick<FreeformView, 'placements'>,
	id: string,
): FreeformPlacement | undefined {
	return view.placements.find((placement) => placement.id === id);
}

export function findFreeformFrame(view: Pick<FreeformView, 'frames'>, id: string): FreeformFrame | undefined {
	return view.frames.find((frame) => frame.id === id);
}

export function findFreeformEdge(view: Pick<FreeformView, 'edges'>, id: string): FreeformEdge | undefined {
	return view.edges.find((edge) => edge.id === id);
}

/** A placement or a frame, by the id an edge's end would name it by. */
export function findFreeformNode(
	view: Pick<FreeformView, 'placements' | 'frames'>,
	id: string,
): FreeformPlacement | FreeformFrame | undefined {
	return findFreeformPlacement(view, id) ?? findFreeformFrame(view, id);
}

/** The placements a frame holds, in the order the view keeps them. */
export function freeformFrameMembers(
	view: Pick<FreeformView, 'placements'>,
	frameId: string,
): FreeformPlacement[] {
	return view.placements.filter((placement) => placement.frameId === frameId);
}

/** Every edge that starts or ends on one of the nodes named. */
export function freeformEdgesOf(view: Pick<FreeformView, 'edges'>, nodeIds: ReadonlySet<string>): FreeformEdge[] {
	return view.edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
}

export interface FreeformBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The box that holds every node named, or null where none of them stands. */
export function freeformBounds(
	view: Pick<FreeformView, 'placements' | 'frames'>,
	ids: readonly string[],
): FreeformBox | null {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const id of ids) {
		const node = findFreeformNode(view, id);
		if (node === undefined) continue;
		left = Math.min(left, node.x);
		top = Math.min(top, node.y);
		right = Math.max(right, node.x + node.width);
		bottom = Math.max(bottom, node.y + node.height);
	}
	if (left === Infinity) return null;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A band as it is painted, low under high; equals stand in the order kept. */
export function freeformStacking<T extends { readonly zIndex: number }>(band: readonly T[]): T[] {
	return band
		.map((entry, index) => ({ entry, index }))
		.sort((left, right) => left.entry.zIndex - right.entry.zIndex || left.index - right.index)
		.map(({ entry }) => entry);
}

/** The families of record and file the view places, so only those are read for it. */
export function freeformPlacedTypes(view: Pick<FreeformView, 'placements'>): Set<FreeformRecordType | 'file'> {
	const placed = new Set<FreeformRecordType | 'file'>();
	for (const { resource } of view.placements) {
		if (resource.type === 'file' || isFreeformRecordType(resource.type)) placed.add(resource.type);
	}
	return placed;
}

/** Every file the view places, by its path from the project's root, each once. */
export function freeformPlacedFilePaths(view: Pick<FreeformView, 'placements'>): string[] {
	const paths = new Set<string>();
	for (const { resource } of view.placements) {
		if (resource.type === 'file') paths.add(resource.path);
	}
	return [...paths];
}

/**
 * What says two placements show the same thing: the type and what identifies
 * the resource. Null for a text and a link, which are never the same thing
 * twice, since each is its own words.
 */
export function freeformResourceKey(resource: FreeformResource): string | null {
	switch (resource.type) {
		case 'entity':
			return `entity ${resource.id}`;
		case 'file':
			return `file ${resource.path}`;
		case 'link':
		case 'text':
			return null;
		default:
			return `${resource.type} ${resource.id}`;
	}
}

/** How many more of each the view has room for. */
export function freeformRoom(
	view: Pick<FreeformView, 'placements' | 'frames' | 'edges'>,
	limits: Readonly<FreeformLimits> = FREEFORM_LIMITS,
): { placements: number; frames: number; edges: number } {
	return {
		placements: Math.max(0, limits.placements - view.placements.length),
		frames: Math.max(0, limits.frames - view.frames.length),
		edges: Math.max(0, limits.edges - view.edges.length),
	};
}

// --- views -----------------------------------------------------------------

/** A view with nothing on it yet, looked at from the plane's middle. */
export function newFreeformView(draft: { id: string; name: string; now: number }): FreeformView {
	return {
		id: draft.id,
		name: draft.name,
		placements: [],
		frames: [],
		edges: [],
		viewport: DEFAULT_FREEFORM_VIEWPORT,
		createdAt: draft.now,
		updatedAt: draft.now,
		strays: { placements: [], frames: [], edges: [] },
	};
}

/** The id of the view a project starts with, fixed so every read of a folder not yet written finds the same view. */
export const MAIN_FREEFORM_VIEW_ID = 'freeform-view-main';

/**
 * What a project reads before any view of its own is written: one view,
 * named in the project's language, so the workspace opens onto a view
 * rather than a hint, as the timeline's does. The first change to it
 * writes it; until then it is no file.
 */
export function freshFreeformDocument(locale: 'en' | 'zh-CN'): FreeformDocument {
	return { views: [newFreeformView({ id: MAIN_FREEFORM_VIEW_ID, name: locale === 'zh-CN' ? '主视图' : 'Main', now: 0 })] };
}

export function renameFreeformView(held: FreeformView, name: string, now: number): FreeformView | null {
	return held.name === name ? null : { ...held, name, updatedAt: now };
}

const sameViewport = (left: FreeformViewport, right: FreeformViewport): boolean =>
	left.x === right.x && left.y === right.y && left.zoom === right.zoom;

/** What a resource is called now, by the placement that shows it. */
export type FreeformLabels = ReadonlyMap<string, { name: string; kind?: string }>;

/** A placement whose resource is called by the name it goes by now; itself where it already is, or keeps no name. */
function relabelled(placement: FreeformPlacement, label: { name: string; kind?: string } | undefined): FreeformPlacement {
	if (label === undefined) return placement;
	const resource = placement.resource;
	if (resource.type === 'entity') {
		const kind = label.kind ?? resource.kind;
		return resource.name === label.name && resource.kind === kind
			? placement
			: { ...placement, resource: { ...resource, name: label.name, kind } };
	}
	if (isFreeformRecordType(resource.type)) {
		const record = resource as FreeformRecordResource;
		return record.name === label.name ? placement : { ...placement, resource: { ...record, name: label.name } };
	}
	return placement;
}

/**
 * What a leaf leaves behind as it goes from a view: where it stood looking,
 * and the names its resources go by now, so one that goes missing later is
 * called what it was last called. Nothing on the view moved, so the view's
 * own stamp is left as it was. Null when all of it is already so.
 */
export function leaveFreeformView(
	held: FreeformView,
	left: { viewport?: FreeformViewport; labels?: FreeformLabels },
): FreeformView | null {
	const viewport = left.viewport === undefined ? held.viewport : readFreeformViewport(left.viewport);
	let relabelledAny = false;
	const labels = left.labels;
	const placements = labels === undefined
		? held.placements
		: held.placements.map((placement) => {
			const next = relabelled(placement, labels.get(placement.id));
			if (next !== placement) relabelledAny = true;
			return next;
		});
	if (!relabelledAny && sameViewport(viewport, held.viewport)) return null;
	return { ...held, viewport, placements: relabelledAny ? placements : held.placements };
}

/**
 * Carries the files a view places along with a rename. `carried` answers
 * where a path stands now, or null for one the rename did not move. The
 * view's stamp is left alone: the plugin ran this errand, not the author.
 * Null when no path was carried.
 */
export function renameFreeformFilePaths(
	held: FreeformView,
	carried: (path: string) => string | null,
): FreeformView | null {
	let moved = false;
	const placements = held.placements.map((placement) => {
		if (placement.resource.type !== 'file') return placement;
		const next = carried(placement.resource.path);
		if (next === null || next === placement.resource.path || !isFreeformResourcePath(next)) return placement;
		moved = true;
		return { ...placement, resource: { type: 'file' as const, path: next } };
	});
	return moved ? { ...held, placements } : null;
}

// --- steps -----------------------------------------------------------------

export interface FreeformPlacementDraft {
	id: string;
	resource: FreeformResource;
	x: number;
	y: number;
	width?: number;
	height?: number;
	displayMode?: FreeformDisplayMode;
	frameId?: string | null;
}

export interface FreeformFrameDraft {
	id: string;
	title: string;
	color: MacaronColor | null;
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export interface FreeformEdgeDraft {
	id: string;
	source: string;
	target: string;
	sourceSide?: FreeformSide | null;
	targetSide?: FreeformSide | null;
	label?: string;
	arrow?: FreeformArrow;
	line?: FreeformLine;
}

/** Where a node is to stand and how large; a frame held is named only where it is to change. */
export interface FreeformPlace {
	id: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	frameId?: string | null;
}

export type FreeformRestack = 'front' | 'forward' | 'backward' | 'back';

/**
 * One thing done to a view. A gesture is a list of them, taken together or
 * not at all: a drop that moves a node into a frame, a paste, a frame made
 * round a selection.
 */
export type FreeformStep =
	| { do: 'add'; placements: readonly FreeformPlacementDraft[] }
	| { do: 'add-frames'; frames: readonly FreeformFrameDraft[] }
	| { do: 'group'; frame: { id: string; title: string; color: MacaronColor | null }; members: readonly string[] }
	| { do: 'connect'; edges: readonly FreeformEdgeDraft[] }
	| { do: 'place'; places: readonly FreeformPlace[] }
	| { do: 'reframe'; members: readonly { id: string; frameId: string | null }[] }
	| { do: 'display'; modes: readonly { id: string; mode: FreeformDisplayMode }[] }
	| { do: 'restack'; ids: readonly string[]; to: FreeformRestack }
	| { do: 'stack'; order: readonly { id: string; zIndex: number }[] }
	| { do: 'text'; id: string; text: string }
	| { do: 'link'; id: string; url?: string; label?: string }
	| { do: 'edit-frame'; id: string; title?: string; color?: MacaronColor | null }
	| {
		do: 'reconnect';
		id: string;
		source?: string;
		target?: string;
		sourceSide?: FreeformSide | null;
		targetSide?: FreeformSide | null;
	}
	| { do: 'edit-edges'; edits: readonly { id: string; label?: string; arrow?: FreeformArrow; line?: FreeformLine }[] }
	| { do: 'delete'; nodes: readonly string[]; edges: readonly string[] }
	| {
		do: 'restore';
		placements: readonly FreeformPlacement[];
		frames: readonly FreeformFrame[];
		edges: readonly FreeformEdge[];
	};

/**
 * What a change came to: the view now says what was asked, what it names is
 * not there, the view has no room for it, or it is no change a view can take.
 */
export type FreeformCame = 'written' | 'absent' | 'full' | 'refused';

/** A step taken: the view after it, and the steps that take it back, in the order they are to be taken. */
interface StepTaken {
	view: FreeformView;
	inverse: FreeformStep[];
}

/** 'same' is a step that found the view already as asked, which is no failure and nothing to undo. */
type StepAnswer = StepTaken | 'same' | Exclude<FreeformCame, 'written'>;

const nodeIdsOf = (view: FreeformView): Set<string> =>
	new Set([...view.frames.map((frame) => frame.id), ...view.placements.map((placement) => placement.id)]);

function addPlacements(
	view: FreeformView,
	drafts: readonly FreeformPlacementDraft[],
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	if (drafts.length === 0) return 'same';
	if (view.placements.length + drafts.length > limits.placements) return 'full';
	const taken = nodeIdsOf(view);
	const frames = new Set(view.frames.map((frame) => frame.id));
	let top = topOf(view.placements);
	const added: FreeformPlacement[] = [];
	for (const draft of drafts) {
		if (!nonEmptyString(draft.id) || taken.has(draft.id)) return 'refused';
		if (!finite(draft.x) || !finite(draft.y)) return 'refused';
		const resource = readFreeformResource(draft.resource);
		if (resource === null) return 'refused';
		if (resource.type === 'text' && resource.text.length > limits.textLength) return 'refused';
		if (resource.type === 'link' && resource.label.length > limits.labelLength) return 'refused';
		taken.add(draft.id);
		top += 1;
		added.push({
			id: draft.id,
			resource,
			x: unit(draft.x),
			y: unit(draft.y),
			width: sizeOf(draft.width, FREEFORM_SIZE.width),
			height: sizeOf(draft.height, FREEFORM_SIZE.height),
			displayMode: isFreeformDisplayMode(draft.displayMode) ? draft.displayMode : 'auto',
			zIndex: top,
			// A frame that has gone since the node was aimed at it holds nothing: the node lands free.
			frameId: nonEmptyString(draft.frameId) && frames.has(draft.frameId) ? draft.frameId : null,
		});
	}
	return {
		view: { ...view, placements: [...view.placements, ...added] },
		inverse: [{ do: 'delete', nodes: added.map((placement) => placement.id), edges: [] }],
	};
}

function addFrames(
	view: FreeformView,
	drafts: readonly FreeformFrameDraft[],
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	if (drafts.length === 0) return 'same';
	if (view.frames.length + drafts.length > limits.frames) return 'full';
	const taken = nodeIdsOf(view);
	let top = topOf(view.frames);
	const added: FreeformFrame[] = [];
	for (const draft of drafts) {
		if (!nonEmptyString(draft.id) || taken.has(draft.id)) return 'refused';
		if (!finite(draft.x) || !finite(draft.y)) return 'refused';
		if (typeof draft.title !== 'string' || draft.title.length > limits.labelLength) return 'refused';
		taken.add(draft.id);
		top += 1;
		added.push({
			id: draft.id,
			title: draft.title,
			color: isMacaronColor(draft.color) ? draft.color : null,
			x: unit(draft.x),
			y: unit(draft.y),
			width: sizeOf(draft.width, FREEFORM_SIZE.width),
			height: sizeOf(draft.height, FREEFORM_SIZE.height),
			zIndex: top,
		});
	}
	return {
		view: { ...view, frames: [...view.frames, ...added] },
		inverse: [{ do: 'delete', nodes: added.map((frame) => frame.id), edges: [] }],
	};
}

/**
 * A frame made round the placements named, which it then holds. Those of
 * them that have gone are passed over, and with none left standing there is
 * nothing to make a frame round.
 */
function groupPlacements(
	view: FreeformView,
	frame: { id: string; title: string; color: MacaronColor | null },
	members: readonly string[],
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	const named = new Set(members);
	const standing = view.placements.filter((placement) => named.has(placement.id));
	if (standing.length === 0) return 'absent';
	const box = freeformBounds(view, standing.map((placement) => placement.id));
	if (box === null) return 'absent';
	const made = addFrames(view, [{
		id: frame.id,
		title: frame.title,
		color: frame.color,
		x: box.x - FREEFORM_FRAME_PADDING,
		y: box.y - FREEFORM_FRAME_PADDING - FREEFORM_FRAME_HEAD,
		width: box.width + 2 * FREEFORM_FRAME_PADDING,
		height: box.height + 2 * FREEFORM_FRAME_PADDING + FREEFORM_FRAME_HEAD,
	}], limits);
	if (typeof made === 'string') return made === 'same' ? 'refused' : made;
	return {
		view: {
			...made.view,
			placements: made.view.placements.map((placement) =>
				named.has(placement.id) ? { ...placement, frameId: frame.id } : placement),
		},
		// The frame goes first, which frees its members; then each is given back to the frame that held it.
		inverse: [
			...made.inverse,
			{
				do: 'reframe',
				members: standing
					.filter((placement) => placement.frameId !== null)
					.map((placement) => ({ id: placement.id, frameId: placement.frameId })),
			},
		],
	};
}

function connectNodes(
	view: FreeformView,
	drafts: readonly FreeformEdgeDraft[],
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	if (drafts.length === 0) return 'same';
	if (view.edges.length + drafts.length > limits.edges) return 'full';
	const nodes = nodeIdsOf(view);
	const taken = new Set(view.edges.map((edge) => edge.id));
	const added: FreeformEdge[] = [];
	for (const draft of drafts) {
		if (!nonEmptyString(draft.id) || taken.has(draft.id)) return 'refused';
		if (draft.source === draft.target) return 'refused';
		if (!nodes.has(draft.source) || !nodes.has(draft.target)) return 'absent';
		const label = draft.label ?? '';
		if (typeof label !== 'string' || label.length > limits.labelLength) return 'refused';
		taken.add(draft.id);
		added.push({
			id: draft.id,
			source: draft.source,
			target: draft.target,
			sourceSide: isFreeformSide(draft.sourceSide) ? draft.sourceSide : null,
			targetSide: isFreeformSide(draft.targetSide) ? draft.targetSide : null,
			label,
			arrow: isFreeformArrow(draft.arrow) ? draft.arrow : 'end',
			line: isFreeformLine(draft.line) ? draft.line : 'solid',
		});
	}
	return {
		view: { ...view, edges: [...view.edges, ...added] },
		inverse: [{ do: 'delete', nodes: [], edges: added.map((edge) => edge.id) }],
	};
}

/**
 * Nodes stood where they are told, at the size they are told. A place is a
 * target and never a distance, so a write made twice moves nothing twice. A
 * frame moved carries the placements it holds by as far as it went, as the
 * view has them when the step is taken; a member named beside its frame
 * takes the place it was itself given. A node that has gone is passed over,
 * and with none of those named still standing the step names nothing.
 */
function placeNodes(view: FreeformView, places: readonly FreeformPlace[]): StepAnswer {
	const asked = new Map<string, FreeformPlace>();
	for (const place of places) {
		if (!finite(place.x) || !finite(place.y)) return 'refused';
		asked.set(place.id, place);
	}
	const frameIds = new Set(view.frames.map((frame) => frame.id));
	let stood = false;
	const before: FreeformPlace[] = [];
	const carried = new Map<string, { dx: number; dy: number }>();
	const frames = view.frames.map((frame) => {
		const to = asked.get(frame.id);
		if (to === undefined) return frame;
		stood = true;
		const x = unit(to.x);
		const y = unit(to.y);
		const width = to.width === undefined ? frame.width : sizeOf(to.width, frame.width);
		const height = to.height === undefined ? frame.height : sizeOf(to.height, frame.height);
		if (x === frame.x && y === frame.y && width === frame.width && height === frame.height) return frame;
		if (x !== frame.x || y !== frame.y) carried.set(frame.id, { dx: x - frame.x, dy: y - frame.y });
		before.push({ id: frame.id, x: frame.x, y: frame.y, width: frame.width, height: frame.height });
		return { ...frame, x, y, width, height };
	});
	let lost = false;
	const placements = view.placements.map((placement) => {
		const to = asked.get(placement.id);
		const was: FreeformPlace = {
			id: placement.id,
			x: placement.x,
			y: placement.y,
			width: placement.width,
			height: placement.height,
			frameId: placement.frameId,
		};
		if (to === undefined) {
			const delta = placement.frameId === null ? undefined : carried.get(placement.frameId);
			if (delta === undefined) return placement;
			before.push(was);
			return { ...placement, x: unit(placement.x + delta.dx), y: unit(placement.y + delta.dy) };
		}
		stood = true;
		if (nonEmptyString(to.frameId) && !frameIds.has(to.frameId)) lost = true;
		const frameId = to.frameId === undefined ? placement.frameId : to.frameId;
		const x = unit(to.x);
		const y = unit(to.y);
		const width = to.width === undefined ? placement.width : sizeOf(to.width, placement.width);
		const height = to.height === undefined ? placement.height : sizeOf(to.height, placement.height);
		if (
			x === placement.x && y === placement.y && width === placement.width &&
			height === placement.height && frameId === placement.frameId
		) {
			return placement;
		}
		before.push(was);
		return { ...placement, x, y, width, height, frameId };
	});
	if (lost || !stood) return 'absent';
	if (before.length === 0) return 'same';
	return { view: { ...view, frames, placements }, inverse: [{ do: 'place', places: before }] };
}

/** Placements given to a frame, or set free of theirs, where they stand. */
function reframePlacements(
	view: FreeformView,
	members: readonly { id: string; frameId: string | null }[],
): StepAnswer {
	const asked = new Map(members.map((member) => [member.id, member.frameId] as const));
	const frameIds = new Set(view.frames.map((frame) => frame.id));
	for (const frameId of asked.values()) {
		if (frameId !== null && !frameIds.has(frameId)) return 'absent';
	}
	let stood = false;
	const before: { id: string; frameId: string | null }[] = [];
	const placements = view.placements.map((placement) => {
		const frameId = asked.get(placement.id);
		if (frameId === undefined) return placement;
		stood = true;
		if (frameId === placement.frameId) return placement;
		before.push({ id: placement.id, frameId: placement.frameId });
		return { ...placement, frameId };
	});
	if (members.length === 0) return 'same';
	if (!stood) return 'absent';
	if (before.length === 0) return 'same';
	return { view: { ...view, placements }, inverse: [{ do: 'reframe', members: before }] };
}

function setDisplayModes(
	view: FreeformView,
	modes: readonly { id: string; mode: FreeformDisplayMode }[],
): StepAnswer {
	if (modes.length === 0) return 'same';
	const asked = new Map<string, FreeformDisplayMode>();
	for (const entry of modes) {
		if (!isFreeformDisplayMode(entry.mode)) return 'refused';
		asked.set(entry.id, entry.mode);
	}
	let stood = false;
	const before: { id: string; mode: FreeformDisplayMode }[] = [];
	const placements = view.placements.map((placement) => {
		const mode = asked.get(placement.id);
		if (mode === undefined) return placement;
		stood = true;
		if (mode === placement.displayMode) return placement;
		before.push({ id: placement.id, mode: placement.displayMode });
		return { ...placement, displayMode: mode };
	});
	if (!stood) return 'absent';
	if (before.length === 0) return 'same';
	return { view: { ...view, placements }, inverse: [{ do: 'display', modes: before }] };
}

const overlaps = (left: FreeformBox, right: FreeformBox): boolean =>
	left.x < right.x + right.width && right.x < left.x + left.width &&
	left.y < right.y + right.height && right.y < left.y + left.height;

/**
 * One band in a new order. To the front and to the back, what is chosen
 * goes to the band's end or its head, in the order it stood in. One step
 * forward, each chosen node rises to stand just over the nearest node above
 * it that it lies across and that was not itself chosen, and stays where no
 * such node is: among hundreds of nodes a step past whatever happens to be
 * numbered next would show nothing. One step backward is the same, downward.
 */
function reordered<T extends FreeformBox & { readonly id: string; readonly zIndex: number }>(
	band: readonly T[],
	chosen: ReadonlySet<string>,
	to: FreeformRestack,
): T[] {
	const order = freeformStacking(band);
	if (to === 'front' || to === 'back') {
		const moved = order.filter((entry) => chosen.has(entry.id));
		const rest = order.filter((entry) => !chosen.has(entry.id));
		return to === 'front' ? [...rest, ...moved] : [...moved, ...rest];
	}
	const next = [...order];
	const upward = to === 'forward';
	// The one furthest along goes first, so one chosen node never climbs over another.
	const walk = upward ? [...order].reverse() : order;
	for (const entry of walk) {
		if (!chosen.has(entry.id)) continue;
		const at = next.indexOf(entry);
		let landing = -1;
		if (upward) {
			for (let index = at + 1; index < next.length; index += 1) {
				const other = next[index]!;
				if (!chosen.has(other.id) && overlaps(entry, other)) {
					landing = index;
					break;
				}
			}
		} else {
			for (let index = at - 1; index >= 0; index -= 1) {
				const other = next[index]!;
				if (!chosen.has(other.id) && overlaps(entry, other)) {
					landing = index;
					break;
				}
			}
		}
		if (landing === -1) continue;
		next.splice(at, 1);
		// Going up, taking the entry out drew the landing down by one, so the
		// place just over it is the landing's old one; going down, the landing
		// stands where it stood and the entry goes in under it.
		next.splice(landing, 0, entry);
	}
	return next;
}

/** A band numbered afresh from nothing in the order handed in; an entry whose number did not move is itself. */
function renumbered<T extends { readonly id: string; readonly zIndex: number }>(
	band: readonly T[],
	order: readonly T[],
	before: { id: string; zIndex: number }[],
): readonly T[] {
	const places = new Map(order.map((entry, index) => [entry.id, index] as const));
	let moved = false;
	const next = band.map((entry) => {
		const zIndex = places.get(entry.id) ?? entry.zIndex;
		if (zIndex === entry.zIndex) return entry;
		moved = true;
		before.push({ id: entry.id, zIndex: entry.zIndex });
		return { ...entry, zIndex };
	});
	return moved ? next : band;
}

/** Nodes raised or lowered among their own kind: frames among frames, placements among placements. */
function restackNodes(view: FreeformView, ids: readonly string[], to: FreeformRestack): StepAnswer {
	const chosen = new Set(ids);
	const stood =
		view.frames.some((frame) => chosen.has(frame.id)) ||
		view.placements.some((placement) => chosen.has(placement.id));
	if (ids.length === 0) return 'same';
	if (!stood) return 'absent';
	const before: { id: string; zIndex: number }[] = [];
	const frames = view.frames.some((frame) => chosen.has(frame.id))
		? renumbered(view.frames, reordered(view.frames, chosen, to), before)
		: view.frames;
	const placements = view.placements.some((placement) => chosen.has(placement.id))
		? renumbered(view.placements, reordered(view.placements, chosen, to), before)
		: view.placements;
	if (before.length === 0) return 'same';
	return { view: { ...view, frames, placements }, inverse: [{ do: 'stack', order: before }] };
}

/** Nodes given the very places in their bands that are named, which is what takes a restack back. */
function stackNodes(view: FreeformView, order: readonly { id: string; zIndex: number }[]): StepAnswer {
	if (order.length === 0) return 'same';
	const asked = new Map<string, number>();
	for (const entry of order) {
		if (!finite(entry.zIndex)) return 'refused';
		asked.set(entry.id, Math.round(entry.zIndex));
	}
	let stood = false;
	const before: { id: string; zIndex: number }[] = [];
	const restack = <T extends { readonly id: string; readonly zIndex: number }>(band: readonly T[]): readonly T[] => {
		let moved = false;
		const next = band.map((entry) => {
			const zIndex = asked.get(entry.id);
			if (zIndex === undefined) return entry;
			stood = true;
			if (zIndex === entry.zIndex) return entry;
			moved = true;
			before.push({ id: entry.id, zIndex: entry.zIndex });
			return { ...entry, zIndex };
		});
		return moved ? next : band;
	};
	const frames = restack(view.frames);
	const placements = restack(view.placements);
	if (!stood) return 'absent';
	if (before.length === 0) return 'same';
	return { view: { ...view, frames, placements }, inverse: [{ do: 'stack', order: before }] };
}

function editText(view: FreeformView, id: string, text: string, limits: Readonly<FreeformLimits>): StepAnswer {
	const placement = findFreeformPlacement(view, id);
	if (placement === undefined || placement.resource.type !== 'text') return 'absent';
	if (typeof text !== 'string' || text.length > limits.textLength) return 'refused';
	if (placement.resource.text === text) return 'same';
	const was = placement.resource.text;
	return {
		view: {
			...view,
			placements: view.placements.map((candidate) =>
				candidate === placement ? { ...placement, resource: { type: 'text' as const, text } } : candidate),
		},
		inverse: [{ do: 'text', id, text: was }],
	};
}

function editLink(
	view: FreeformView,
	id: string,
	change: { url?: string; label?: string },
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	const placement = findFreeformPlacement(view, id);
	if (placement === undefined || placement.resource.type !== 'link') return 'absent';
	const was = placement.resource;
	const url = change.url ?? was.url;
	const label = change.label ?? was.label;
	if (!isFreeformAddress(url)) return 'refused';
	if (typeof label !== 'string' || label.length > limits.labelLength) return 'refused';
	if (url === was.url && label === was.label) return 'same';
	return {
		view: {
			...view,
			placements: view.placements.map((candidate) =>
				candidate === placement ? { ...placement, resource: { type: 'link' as const, url, label } } : candidate),
		},
		inverse: [{ do: 'link', id, url: was.url, label: was.label }],
	};
}

function editFrame(
	view: FreeformView,
	id: string,
	change: { title?: string; color?: MacaronColor | null },
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	const frame = findFreeformFrame(view, id);
	if (frame === undefined) return 'absent';
	const title = change.title ?? frame.title;
	const color = change.color === undefined ? frame.color : change.color;
	if (typeof title !== 'string' || title.length > limits.labelLength) return 'refused';
	if (color !== null && !isMacaronColor(color)) return 'refused';
	if (title === frame.title && color === frame.color) return 'same';
	return {
		view: {
			...view,
			frames: view.frames.map((candidate) => (candidate === frame ? { ...frame, title, color } : candidate)),
		},
		inverse: [{ do: 'edit-frame', id, title: frame.title, color: frame.color }],
	};
}

function reconnectEdge(
	view: FreeformView,
	id: string,
	change: { source?: string; target?: string; sourceSide?: FreeformSide | null; targetSide?: FreeformSide | null },
): StepAnswer {
	const edge = findFreeformEdge(view, id);
	if (edge === undefined) return 'absent';
	const source = change.source ?? edge.source;
	const target = change.target ?? edge.target;
	const sourceSide = change.sourceSide === undefined ? edge.sourceSide : change.sourceSide;
	const targetSide = change.targetSide === undefined ? edge.targetSide : change.targetSide;
	if (source === target) return 'refused';
	if (sourceSide !== null && !isFreeformSide(sourceSide)) return 'refused';
	if (targetSide !== null && !isFreeformSide(targetSide)) return 'refused';
	const nodes = nodeIdsOf(view);
	if (!nodes.has(source) || !nodes.has(target)) return 'absent';
	if (
		source === edge.source && target === edge.target &&
		sourceSide === edge.sourceSide && targetSide === edge.targetSide
	) {
		return 'same';
	}
	return {
		view: {
			...view,
			edges: view.edges.map((candidate) =>
				candidate === edge ? { ...edge, source, target, sourceSide, targetSide } : candidate),
		},
		inverse: [{
			do: 'reconnect',
			id,
			source: edge.source,
			target: edge.target,
			sourceSide: edge.sourceSide,
			targetSide: edge.targetSide,
		}],
	};
}

function editEdges(
	view: FreeformView,
	edits: readonly { id: string; label?: string; arrow?: FreeformArrow; line?: FreeformLine }[],
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	if (edits.length === 0) return 'same';
	const asked = new Map<string, { label?: string; arrow?: FreeformArrow; line?: FreeformLine }>();
	for (const edit of edits) {
		if (edit.label !== undefined && (typeof edit.label !== 'string' || edit.label.length > limits.labelLength)) {
			return 'refused';
		}
		if (edit.arrow !== undefined && !isFreeformArrow(edit.arrow)) return 'refused';
		if (edit.line !== undefined && !isFreeformLine(edit.line)) return 'refused';
		asked.set(edit.id, edit);
	}
	let stood = false;
	const before: { id: string; label: string; arrow: FreeformArrow; line: FreeformLine }[] = [];
	const edges = view.edges.map((edge) => {
		const edit = asked.get(edge.id);
		if (edit === undefined) return edge;
		stood = true;
		const label = edit.label ?? edge.label;
		const arrow = edit.arrow ?? edge.arrow;
		const line = edit.line ?? edge.line;
		if (label === edge.label && arrow === edge.arrow && line === edge.line) return edge;
		before.push({ id: edge.id, label: edge.label, arrow: edge.arrow, line: edge.line });
		return { ...edge, label, arrow, line };
	});
	if (!stood) return 'absent';
	if (before.length === 0) return 'same';
	return { view: { ...view, edges }, inverse: [{ do: 'edit-edges', edits: before }] };
}

/** The id a stray would wear were it read, for the one case a stray is looked into: a twin of something deleted. */
const strayId = (entry: unknown): string | null => {
	if (typeof entry !== 'object' || entry === null) return null;
	const id = (entry as Record<string, unknown>).id;
	return nonEmptyString(id) ? id : null;
};

/**
 * Nodes and edges taken off the view. An edge goes with either of its ends.
 * A frame's members stay where they stand, free of it, unless they are named
 * too. Nothing the view points at is touched: the note, the record and the
 * file behind a placement are no part of the view. What goes is handed back
 * whole as the way to restore it.
 */
function deleteFromView(view: FreeformView, nodes: readonly string[], edges: readonly string[]): StepAnswer {
	if (nodes.length === 0 && edges.length === 0) return 'same';
	const goingNodes = new Set(nodes);
	const goingEdges = new Set(edges);
	const lostFrames = view.frames.filter((frame) => goingNodes.has(frame.id));
	const lostPlacements = view.placements.filter((placement) => goingNodes.has(placement.id));
	const gone = new Set([...lostFrames, ...lostPlacements].map((node) => node.id));
	const lostEdges = view.edges.filter((edge) =>
		goingEdges.has(edge.id) || gone.has(edge.source) || gone.has(edge.target));
	if (gone.size === 0 && lostEdges.length === 0) return 'absent';
	const freedFrames = new Set(lostFrames.map((frame) => frame.id));
	const freed: { id: string; frameId: string | null }[] = [];
	const placements = view.placements
		.filter((placement) => !gone.has(placement.id))
		.map((placement) => {
			if (placement.frameId === null || !freedFrames.has(placement.frameId)) return placement;
			freed.push({ id: placement.id, frameId: placement.frameId });
			return { ...placement, frameId: null };
		});
	const lostEdgeIds = new Set(lostEdges.map((edge) => edge.id));
	const inverse: FreeformStep[] = [
		{ do: 'restore', placements: lostPlacements, frames: lostFrames, edges: lostEdges },
	];
	if (freed.length > 0) inverse.push({ do: 'reframe', members: freed });
	return {
		view: {
			...view,
			frames: view.frames.filter((frame) => !gone.has(frame.id)),
			placements,
			edges: view.edges.filter((edge) => !lostEdgeIds.has(edge.id)),
			strays: {
				// Only a stray wearing a deleted id could stand in its place on the
				// next read, so only such a twin goes with it.
				placements: view.strays.placements.filter((entry) => !gone.has(strayId(entry) ?? '')),
				frames: view.strays.frames.filter((entry) => !gone.has(strayId(entry) ?? '')),
				edges: view.strays.edges.filter((entry) => !lostEdgeIds.has(strayId(entry) ?? '')),
			},
		},
		inverse,
	};
}

/**
 * What was taken off put back as it was: the same ids, the same places in
 * their bands, the same frames holding the same members. An id taken since
 * is a refusal, and an edge whose end has gone since is an absence, since a
 * restoring that put back only some of what went would say it had undone a
 * change it had not.
 */
function restoreToView(
	view: FreeformView,
	lost: {
		placements: readonly FreeformPlacement[];
		frames: readonly FreeformFrame[];
		edges: readonly FreeformEdge[];
	},
	limits: Readonly<FreeformLimits>,
): StepAnswer {
	if (lost.placements.length === 0 && lost.frames.length === 0 && lost.edges.length === 0) return 'same';
	if (view.placements.length + lost.placements.length > limits.placements) return 'full';
	if (view.frames.length + lost.frames.length > limits.frames) return 'full';
	if (view.edges.length + lost.edges.length > limits.edges) return 'full';
	const taken = nodeIdsOf(view);
	const frames: FreeformFrame[] = [];
	for (const entry of lost.frames) {
		const frame = readFrame(entry, taken, topOf([...view.frames, ...frames]));
		if (frame === null) return 'refused';
		taken.add(frame.id);
		frames.push(frame);
	}
	const frameIds = new Set([...view.frames, ...frames].map((frame) => frame.id));
	const placements: FreeformPlacement[] = [];
	for (const entry of lost.placements) {
		const placement = readPlacement(entry, taken, frameIds, topOf([...view.placements, ...placements]));
		if (placement === null) return 'refused';
		taken.add(placement.id);
		placements.push(placement);
	}
	const edgeIds = new Set(view.edges.map((edge) => edge.id));
	const edges: FreeformEdge[] = [];
	for (const entry of lost.edges) {
		if (edgeIds.has(entry.id)) return 'refused';
		if (!taken.has(entry.source) || !taken.has(entry.target)) return 'absent';
		const edge = readEdge(entry, edgeIds, taken);
		if (edge === null) return 'refused';
		edgeIds.add(edge.id);
		edges.push(edge);
	}
	return {
		view: {
			...view,
			frames: [...view.frames, ...frames],
			placements: [...view.placements, ...placements],
			edges: [...view.edges, ...edges],
		},
		inverse: [{
			do: 'delete',
			nodes: [...frames.map((frame) => frame.id), ...placements.map((placement) => placement.id)],
			edges: edges.map((edge) => edge.id),
		}],
	};
}

function takeStep(view: FreeformView, step: FreeformStep, limits: Readonly<FreeformLimits>): StepAnswer {
	switch (step.do) {
		case 'add':
			return addPlacements(view, step.placements, limits);
		case 'add-frames':
			return addFrames(view, step.frames, limits);
		case 'group':
			return groupPlacements(view, step.frame, step.members, limits);
		case 'connect':
			return connectNodes(view, step.edges, limits);
		case 'place':
			return step.places.length === 0 ? 'same' : placeNodes(view, step.places);
		case 'reframe':
			return reframePlacements(view, step.members);
		case 'display':
			return setDisplayModes(view, step.modes);
		case 'restack':
			return restackNodes(view, step.ids, step.to);
		case 'stack':
			return stackNodes(view, step.order);
		case 'text':
			return editText(view, step.id, step.text, limits);
		case 'link':
			return editLink(view, step.id, step, limits);
		case 'edit-frame':
			return editFrame(view, step.id, step, limits);
		case 'reconnect':
			return reconnectEdge(view, step.id, step);
		case 'edit-edges':
			return editEdges(view, step.edits, limits);
		case 'delete':
			return deleteFromView(view, step.nodes, step.edges);
		case 'restore':
			return restoreToView(view, step, limits);
	}
}

export interface FreeformTransaction {
	came: FreeformCame;
	/** The view as the steps left it; the view handed in, itself, where they left it as it was. */
	view: FreeformView;
	/** The steps that take the change back, in the order they are to be taken; none where nothing changed. */
	inverse: readonly FreeformStep[];
	changed: boolean;
}

/**
 * A list of steps taken together or not at all. One that names what is not
 * there, finds no room or is no change a view can take leaves the view as it
 * was and says which; one that finds the view already as asked is passed
 * over. With every step passed over the view is written all the same in the
 * sense that matters: it says what was asked.
 */
export function applyFreeformSteps(
	held: FreeformView,
	steps: readonly FreeformStep[],
	now: number,
	limits: Readonly<FreeformLimits> = FREEFORM_LIMITS,
): FreeformTransaction {
	let view = held;
	const inverse: FreeformStep[] = [];
	for (const step of steps) {
		const answer = takeStep(view, step, limits);
		if (answer === 'same') continue;
		if (typeof answer === 'string') return { came: answer, view: held, inverse: [], changed: false };
		view = answer.view;
		// What was done last is taken back first.
		inverse.unshift(...answer.inverse);
	}
	if (view === held) return { came: 'written', view: held, inverse: [], changed: false };
	return { came: 'written', view: { ...view, updatedAt: now }, inverse, changed: true };
}

// --- the clip --------------------------------------------------------------

/** What a copy holds: nodes and the edges among them, with the corner they are measured from. */
export interface FreeformClip {
	readonly placements: readonly FreeformPlacement[];
	readonly frames: readonly FreeformFrame[];
	readonly edges: readonly FreeformEdge[];
	readonly origin: { readonly x: number; readonly y: number };
}

/**
 * What a copy of a selection takes: the nodes chosen, the members of the
 * frames chosen, and every edge both of whose ends are taken. Null where
 * none of what was chosen stands.
 */
export function copyFreeformSelection(
	view: FreeformView,
	selection: { nodes: readonly string[] },
): FreeformClip | null {
	const chosen = new Set(selection.nodes);
	const frames = view.frames.filter((frame) => chosen.has(frame.id));
	const held = new Set(frames.map((frame) => frame.id));
	const placements = view.placements.filter((placement) =>
		chosen.has(placement.id) || (placement.frameId !== null && held.has(placement.frameId)));
	const taken = new Set([...frames.map((frame) => frame.id), ...placements.map((placement) => placement.id)]);
	if (taken.size === 0) return null;
	const box = freeformBounds(view, [...taken]);
	return {
		placements,
		frames,
		edges: view.edges.filter((edge) => taken.has(edge.source) && taken.has(edge.target)),
		origin: { x: box?.x ?? 0, y: box?.y ?? 0 },
	};
}

/**
 * The steps that lay a copy down with its corner at a place, every node and
 * edge under an id of its own from the mint handed in. A member keeps the
 * frame that held it only where that frame was copied with it.
 */
export function freeformClipSteps(
	clip: FreeformClip,
	at: { x: number; y: number },
	mint: (kind: 'placement' | 'frame' | 'edge') => string,
): { steps: FreeformStep[]; nodes: string[] } {
	const dx = at.x - clip.origin.x;
	const dy = at.y - clip.origin.y;
	const ids = new Map<string, string>();
	const frames: FreeformFrameDraft[] = freeformStacking(clip.frames).map((frame) => {
		const id = mint('frame');
		ids.set(frame.id, id);
		return {
			id,
			title: frame.title,
			color: frame.color,
			x: frame.x + dx,
			y: frame.y + dy,
			width: frame.width,
			height: frame.height,
		};
	});
	const placements: FreeformPlacementDraft[] = freeformStacking(clip.placements).map((placement) => {
		const id = mint('placement');
		ids.set(placement.id, id);
		return {
			id,
			resource: placement.resource,
			x: placement.x + dx,
			y: placement.y + dy,
			width: placement.width,
			height: placement.height,
			displayMode: placement.displayMode,
			frameId: placement.frameId === null ? null : ids.get(placement.frameId) ?? null,
		};
	});
	const edges: FreeformEdgeDraft[] = clip.edges.flatMap((edge) => {
		const source = ids.get(edge.source);
		const target = ids.get(edge.target);
		if (source === undefined || target === undefined) return [];
		return [{
			id: mint('edge'),
			source,
			target,
			sourceSide: edge.sourceSide,
			targetSide: edge.targetSide,
			label: edge.label,
			arrow: edge.arrow,
			line: edge.line,
		}];
	});
	const steps: FreeformStep[] = [];
	if (frames.length > 0) steps.push({ do: 'add-frames', frames });
	if (placements.length > 0) steps.push({ do: 'add', placements });
	if (edges.length > 0) steps.push({ do: 'connect', edges });
	return { steps, nodes: [...frames.map((frame) => frame.id), ...placements.map((placement) => placement.id)] };
}
