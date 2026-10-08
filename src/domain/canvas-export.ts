/**
 * A workspace view as an Obsidian canvas: the freeform's placements, frames
 * and edges as the canvas's nodes, groups and edges; a timeline's times,
 * lanes and rows and a beat sheet's acts, beats and rows laid out on a grid
 * of the exporter's own, since those two workspaces keep no geometry. The
 * canvas names each note by its path and nothing else: the file is a copy
 * the workspace never reads back, so what would not survive the move (a
 * line's dashes, a link's label) is left out rather than invented, and a
 * record that is no note stands as the words that name it.
 *
 * Everything here is pure. What a resource comes to on the canvas is asked
 * of a resolver the caller hands in, and the few words a canvas carries that
 * no author wrote come in as words. The ids are worked out from the view's
 * own ids, so one view exported twice makes the same bytes.
 */

import type {
	AllCanvasNodeData,
	CanvasColor,
	CanvasData,
	CanvasEdgeData,
	CanvasFileData,
	CanvasGroupData,
	CanvasLinkData,
	CanvasTextData,
} from 'obsidian/canvas';

import type { BeatSheet } from './beat-sheet';
import { fingerprint, stableSerialize } from './fingerprint';
import {
	findFreeformNode,
	freeformStacking,
	type FreeformBox,
	type FreeformPlacement,
	type FreeformSide,
	type FreeformView,
} from './freeform';
import type { MacaronColor } from './macaron';
import type { SceneRow } from './scene-rows';
import { resolvedTimeOrder, type Timeline, type TimelineDocument, type TimelineView } from './timeline';

// -- Sizes -----------------------------------------------------------------
//
// The grid a timeline or a beat sheet is laid out on takes Obsidian's own
// scale, not the workspaces': a canvas shows a note's words inside its
// node, so a card as small as the lane's is too small to read there. Every
// length is a multiple of the canvas's 20-unit dot grid, so what is laid
// out stands on the dots as a hand-placed node does. A freeform view keeps
// its own sizes, which are the author's.

/** A card's width: Obsidian's own default for a node that shows a file. */
export const CANVAS_CARD_WIDTH = 400;
/** A note's node and a missing note's stand-in. */
export const CANVAS_CARD_HEIGHT = 300;
/** A sub-description's words: four lines or so at the card's width. */
export const CANVAS_TEXT_HEIGHT = 120;
/** Between the nodes of a band, and between the rows of a grid: two dots. */
export const CANVAS_GAP = 40;
/** The room a group leaves its members on every side; its label floats above the group, outside it. */
export const CANVAS_GROUP_PADDING = 40;
/** Between one lane's group and the next, and between one act's and the next: room for the next group's label. */
export const CANVAS_GROUP_GAP = 80;
/** Between the time column and the first lane. */
export const CANVAS_COLUMN_GAP = 80;

// -- Colour ----------------------------------------------------------------

/**
 * The macaron palette on Obsidian's six presets, by hue: a preset follows
 * the theme where a pastel hex would stand faint on a border drawn at seven
 * tenths and a ground at seven hundredths. Two pairs share a preset, since
 * the canvas has no blue and no second purple.
 */
export const CANVAS_COLOR_OF: Readonly<Record<MacaronColor, CanvasColor>> = {
	'macaron-1': '1',
	'macaron-2': '2',
	'macaron-3': '3',
	'macaron-4': '4',
	'macaron-5': '5',
	'macaron-6': '5',
	'macaron-7': '6',
	'macaron-8': '6',
};

export function canvasColorOf(color: MacaronColor | null): CanvasColor | undefined {
	return color === null ? undefined : CANVAS_COLOR_OF[color];
}

// -- Ids -------------------------------------------------------------------

/** A sixteen-hex id from one of the plugin's own keys: the fingerprint's two words, the shape Obsidian mints. */
export function canvasIdOf(key: string): string {
	return fingerprint(key).slice(4);
}

/**
 * A mint that never hands the same id out twice in one canvas: a key whose
 * id is taken is asked again as `key#2`, `key#3`, so the same keys asked in
 * the same order answer the same ids every time.
 */
export function canvasIdMint(hash: (key: string) => string = canvasIdOf): (key: string) => string {
	const taken = new Set<string>();
	return (key) => {
		let candidate = hash(key);
		for (let turn = 2; taken.has(candidate); turn += 1) candidate = hash(`${key}#${String(turn)}`);
		taken.add(candidate);
		return candidate;
	};
}

// -- The file --------------------------------------------------------------

type CanvasRecord = Record<string, unknown>;

/** A node as Obsidian writes one: the id and type first, what it holds, where it stands, then its colour and a group's label. */
function nodeRecord(node: AllCanvasNodeData): CanvasRecord {
	const record: CanvasRecord = { id: node.id, type: node.type };
	switch (node.type) {
		case 'text':
			record.text = node.text;
			break;
		case 'file':
			record.file = node.file;
			if (node.subpath !== undefined) record.subpath = node.subpath;
			break;
		case 'link':
			record.url = node.url;
			break;
		case 'group':
			break;
	}
	record.x = node.x;
	record.y = node.y;
	record.width = node.width;
	record.height = node.height;
	if (node.color !== undefined) record.color = node.color;
	if (node.type === 'group' && node.label !== undefined) record.label = node.label;
	return record;
}

function edgeRecord(edge: CanvasEdgeData): CanvasRecord {
	const record: CanvasRecord = { id: edge.id, fromNode: edge.fromNode };
	if (edge.fromSide !== undefined) record.fromSide = edge.fromSide;
	if (edge.fromEnd !== undefined) record.fromEnd = edge.fromEnd;
	record.toNode = edge.toNode;
	if (edge.toSide !== undefined) record.toSide = edge.toSide;
	if (edge.toEnd !== undefined) record.toEnd = edge.toEnd;
	if (edge.color !== undefined) record.color = edge.color;
	if (edge.label !== undefined) record.label = edge.label;
	return record;
}

function canvasRecords(data: CanvasData): { nodes: CanvasRecord[]; edges: CanvasRecord[] } {
	return { nodes: data.nodes.map(nodeRecord), edges: data.edges.map(edgeRecord) };
}

/** The file extensions Obsidian shows as a picture or a player on a canvas, and fits to their own proportions. */
const CANVAS_MEDIA_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif',
	'mp4', 'mov', 'webm', 'mkv', 'ogv', 'm4v',
]);

function isCanvasMediaPath(path: string): boolean {
	const dot = path.lastIndexOf('.');
	return dot !== -1 && CANVAS_MEDIA_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * A record as it is compared: a picture's or a player's node loses its
 * height, since Obsidian sets that itself the first time the canvas is
 * shown, to the media's own proportions at the width the node has. That
 * is Obsidian's doing, not the author's, so it is no change to ask about.
 */
function comparable(record: CanvasRecord): CanvasRecord {
	if (record.type !== 'file' || typeof record.file !== 'string' || !isCanvasMediaPath(record.file)) return record;
	const { height: _height, ...rest } = record;
	return rest;
}

/**
 * The text of a canvas file as Obsidian itself writes one: each node and
 * edge on a line of its own, tab indented, compact, and no newline after
 * the last brace.
 */
export function serializeCanvas(data: CanvasData): string {
	const list = (records: readonly CanvasRecord[]): string =>
		records.length === 0
			? '[]'
			: `[\n${records.map((record) => `\t\t${JSON.stringify(record)}`).join(',\n')}\n\t]`;
	const { nodes, edges } = canvasRecords(data);
	return `{\n\t"nodes":${list(nodes)},\n\t"edges":${list(edges)}\n}`;
}

/**
 * Whether a canvas file already says what the data says: the same nodes and
 * the same edges, whatever else the file holds and however it is laid out.
 * Obsidian re-saves a canvas with a metadata block of its own, its own
 * whitespace and its nodes in an order of its own, and fits a picture's or
 * a player's node to the media's proportions as it first shows it, so the
 * bytes are no measure of whether anything changed.
 */
export function sameCanvasContent(existing: string, data: CanvasData): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(existing);
	} catch {
		return false;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
	const held = parsed as Record<string, unknown>;
	const asRecords = (list: unknown): CanvasRecord[] =>
		Array.isArray(list)
			? list.map((entry) => (typeof entry === 'object' && entry !== null ? (entry as CanvasRecord) : { value: entry }))
			: [];
	const mine = canvasRecords(data);
	return (
		stableSerialize({ nodes: byId(asRecords(held.nodes).map(comparable)), edges: byId(asRecords(held.edges)) })
		=== stableSerialize({ nodes: byId(mine.nodes.map(comparable)), edges: byId(mine.edges) })
	);
}

/** Records in the order of their ids: Obsidian writes a canvas's nodes in an order of its own, which says nothing of what they are. */
function byId(records: readonly CanvasRecord[]): CanvasRecord[] {
	const key = (record: CanvasRecord): string => (typeof record.id === 'string' ? record.id : '');
	return [...records].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));
}

// -- What the caller hands in ------------------------------------------------

/** A note as the canvas names it: where it stands in the vault, and the tint it wears. */
export interface CanvasNoteRef {
	readonly path: string;
	readonly color: MacaronColor | null;
}

/** The records a placement names that are rows of the plugin's own files, not notes. */
export type FreeformCanvasRecordType = 'task' | 'foreshadowing' | 'revision';

export interface FreeformCanvasResolver {
	/** The note an entity placement names, by its id alone, whatever kind the placement kept; null once the note has gone. */
	entity(id: string, kind: string): CanvasNoteRef | null;
	stickyNote(id: string): CanvasNoteRef | null;
	/** What a task, a thread or a revision is called now; null once the record has gone. */
	record(type: FreeformCanvasRecordType, id: string): string | null;
	/** The vault path of a file placed by its path from the project's root. */
	file(path: string): string;
}

export interface SceneCanvasResolver {
	scene(id: string): CanvasNoteRef | null;
}

export interface TimelineCanvasResolver extends SceneCanvasResolver {
	time(id: string): CanvasNoteRef | null;
}

/** The words a canvas carries that no author wrote, in the project's language, as the workspaces say them. */
export interface CanvasExportWords {
	/** What a placement whose resource has gone is called, by what it was: an entity of some kind, a sticky note, or a record. */
	missing(of: 'entity' | 'sticky-note' | FreeformCanvasRecordType, kind: string): string;
	lastSeen(name: string): string;
	/** What a kind of record is called, for the first line of its node. */
	recordKind(type: FreeformCanvasRecordType): string;
	missingScene: string;
	missingTime: string;
	untitledBeat: string;
	actTitle(number: number, label: string): string;
}

// -- Nodes -----------------------------------------------------------------

function withColor(color: MacaronColor | null): { color?: CanvasColor } {
	const preset = canvasColorOf(color);
	return preset === undefined ? {} : { color: preset };
}

function fileNode(id: string, box: FreeformBox, note: CanvasNoteRef): CanvasFileData {
	return {
		id,
		type: 'file',
		file: note.path,
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
		...withColor(note.color),
	};
}

function textNode(id: string, box: FreeformBox, text: string): CanvasTextData {
	return { id, type: 'text', text, x: box.x, y: box.y, width: box.width, height: box.height };
}

function linkNode(id: string, box: FreeformBox, url: string): CanvasLinkData {
	return { id, type: 'link', url, x: box.x, y: box.y, width: box.width, height: box.height };
}

function groupNode(id: string, box: FreeformBox, label: string, color: MacaronColor | null): CanvasGroupData {
	return {
		id,
		type: 'group',
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
		...withColor(color),
		...(label.length === 0 ? {} : { label }),
	};
}

/** The same nodes moved by a vector. */
function translated(nodes: readonly AllCanvasNodeData[], dx: number, dy: number): AllCanvasNodeData[] {
	return nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }));
}

// -- Freeform ----------------------------------------------------------------

/**
 * The sides a line leaves and lands by where the view left the choice open:
 * across when the two stand further apart across than down, else down. The
 * canvas engine chooses the same way, so the file shows what the view did.
 */
export function freeformAutoSides(from: FreeformBox, to: FreeformBox): { fromSide: FreeformSide; toSide: FreeformSide } {
	const dx = to.x + to.width / 2 - (from.x + from.width / 2);
	const dy = to.y + to.height / 2 - (from.y + from.height / 2);
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
	}
	return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

/** What a missing resource's stand-in says: what it was, and what it was last called, when it was called anything. */
function missingText(what: string, name: string, words: CanvasExportWords): string {
	return name.trim().length === 0 ? what : `${what}\n\n${words.lastSeen(name)}`;
}

/**
 * One placement as a node. A task, a thread and a revision are rows of the
 * plugin's own files, which the canvas cannot open, so each becomes words:
 * what kind of record it is, and what it is called now.
 */
function placedNode(
	placement: FreeformPlacement,
	mintId: () => string,
	resolve: FreeformCanvasResolver,
	words: CanvasExportWords,
): AllCanvasNodeData {
	const { resource } = placement;
	switch (resource.type) {
		case 'task':
		case 'foreshadowing':
		case 'revision': {
			const name = resolve.record(resource.type, resource.id);
			if (name === null) {
				return textNode(mintId(), placement, missingText(words.missing(resource.type, resource.type), resource.name, words));
			}
			const kind = `**${words.recordKind(resource.type)}**`;
			return textNode(mintId(), placement, name.trim().length === 0 ? kind : `${kind}\n\n${name.trim()}`);
		}
		case 'entity': {
			const note = resolve.entity(resource.id, resource.kind);
			if (note !== null) return fileNode(mintId(), placement, note);
			return textNode(mintId(), placement, missingText(words.missing('entity', resource.kind), resource.name, words));
		}
		case 'sticky-note': {
			const note = resolve.stickyNote(resource.id);
			if (note !== null) return fileNode(mintId(), placement, note);
			return textNode(mintId(), placement, missingText(words.missing('sticky-note', resource.type), resource.name, words));
		}
		case 'file':
			return fileNode(mintId(), placement, { path: resolve.file(resource.path), color: null });
		case 'link':
			return linkNode(mintId(), placement, resource.url);
		case 'text':
			return textNode(mintId(), placement, resource.text);
	}
}

/**
 * A freeform view as a canvas. The frames come first as groups, under every
 * placement, each band low to high as the view paints it; a placement keeps
 * its own place and size. An edge keeps the sides the view chose and takes
 * the engine's choice where the view made none, its arrowheads as the
 * canvas marks them, and its label; the line's dashes have no place in the
 * file. An edge whose end names nothing on the view goes with it.
 */
export function freeformCanvas(
	view: FreeformView,
	resolve: FreeformCanvasResolver,
	words: CanvasExportWords,
): CanvasData {
	const mint = canvasIdMint();
	const ids = new Map<string, string>();
	const nodes: AllCanvasNodeData[] = [];
	for (const frame of freeformStacking(view.frames)) {
		const id = mint(`frame:${frame.id}`);
		ids.set(frame.id, id);
		nodes.push(groupNode(id, frame, frame.title, frame.color));
	}
	for (const placement of freeformStacking(view.placements)) {
		const node = placedNode(placement, () => mint(`node:${placement.id}`), resolve, words);
		ids.set(placement.id, node.id);
		nodes.push(node);
	}
	const edges: CanvasEdgeData[] = [];
	for (const edge of view.edges) {
		const fromNode = ids.get(edge.source);
		const toNode = ids.get(edge.target);
		const from = findFreeformNode(view, edge.source);
		const to = findFreeformNode(view, edge.target);
		if (fromNode === undefined || toNode === undefined || from === undefined || to === undefined) continue;
		const chosen = freeformAutoSides(from, to);
		edges.push({
			id: mint(`edge:${edge.id}`),
			fromNode,
			fromSide: edge.sourceSide ?? chosen.fromSide,
			...(edge.arrow === 'start' || edge.arrow === 'both' ? { fromEnd: 'arrow' as const } : {}),
			toNode,
			toSide: edge.targetSide ?? chosen.toSide,
			...(edge.arrow === 'none' || edge.arrow === 'start' ? { toEnd: 'none' as const } : {}),
			...(edge.label.length === 0 ? {} : { label: edge.label }),
		});
	}
	return { nodes, edges };
}

// -- Rows of scenes ------------------------------------------------------------
//
// A view's display switches (the words hidden, the scenes stacked behind one
// card, the order turned about) say how the screen shows the document, and
// nothing of what it holds, so the canvas takes none of them: every row's
// words are written, the scenes stand beside them, and the times, the acts
// and the beats run in the order the document keeps.

/** A piece of a grid laid out from its own corner, to be moved to where it stands. */
interface Block {
	readonly width: number;
	readonly height: number;
	readonly nodes: readonly AllCanvasNodeData[];
}

const card = (x: number, y: number): FreeformBox => ({ x, y, width: CANVAS_CARD_WIDTH, height: CANVAS_CARD_HEIGHT });

/**
 * One sub-description row as a band: its words, when it has any, then its
 * scenes beside them in a line. A row with nothing to show takes no room
 * at all.
 */
function rowBlock(
	row: SceneRow,
	keyOf: (kind: 'row' | 'scene', id: string) => string,
	resolve: SceneCanvasResolver,
	words: CanvasExportWords,
	mint: (key: string) => string,
): Block | null {
	const text = row.text.trim();
	const hasText = text.length > 0;
	if (!hasText && row.scenes.length === 0) return null;
	const nodes: AllCanvasNodeData[] = [];
	if (hasText) {
		nodes.push(textNode(mint(keyOf('row', row.id)), { x: 0, y: 0, width: CANVAS_CARD_WIDTH, height: CANVAS_TEXT_HEIGHT }, text));
	}
	row.scenes.forEach((sceneId, index) => {
		const box = card((hasText ? CANVAS_CARD_WIDTH + CANVAS_GAP : 0) + index * (CANVAS_CARD_WIDTH + CANVAS_GAP), 0);
		const note = resolve.scene(sceneId);
		const id = mint(keyOf('scene', sceneId));
		nodes.push(note === null ? textNode(id, box, words.missingScene) : fileNode(id, box, note));
	});
	const parts = (hasText ? 1 : 0) + row.scenes.length;
	return {
		width: parts * CANVAS_CARD_WIDTH + (parts - 1) * CANVAS_GAP,
		height: Math.max(hasText ? CANVAS_TEXT_HEIGHT : 0, row.scenes.length > 0 ? CANVAS_CARD_HEIGHT : 0),
		nodes,
	};
}

/** Bands piled down the page with a gap between, as wide as the widest; null where none has anything to show. */
function stackedBlocks(blocks: readonly (Block | null)[]): Block | null {
	const shown = blocks.filter((block): block is Block => block !== null);
	if (shown.length === 0) return null;
	const nodes: AllCanvasNodeData[] = [];
	let y = 0;
	for (const block of shown) {
		nodes.push(...translated(block.nodes, 0, y));
		y += block.height + CANVAS_GAP;
	}
	return {
		width: Math.max(...shown.map((block) => block.width)),
		height: y - CANVAS_GAP,
		nodes,
	};
}

// -- Timeline ------------------------------------------------------------------

/**
 * The timelines a view shows, in the order it shows them: the pinned one
 * first when the view holds it, then the view's own order. An id the
 * document no longer answers to is left out.
 */
export function shownTimelines(
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

/**
 * A timeline view as a canvas: the times down a column at the left, in the
 * order the view keeps them, and one group a lane beside it, as tall as
 * every row together, each lane's rows of scenes standing level with their
 * time. A row is as tall as the tallest cell in it, and a lane as wide as
 * its widest. A scene on two lanes stands twice, once in each. A lane with
 * no time at all is a group holding its padding alone.
 */
export function timelineCanvas(
	view: TimelineView,
	held: Pick<TimelineDocument, 'timelines' | 'pinnedTimelineId'>,
	canonicalTimeIds: readonly string[],
	resolve: TimelineCanvasResolver,
	words: CanvasExportWords,
): CanvasData {
	const mint = canvasIdMint();
	const lanes = shownTimelines(view, held);
	const times = resolvedTimeOrder(view, lanes, canonicalTimeIds);
	const cells = lanes.map((lane) =>
		times.map((timeId) => {
			const time = lane.times.find((candidate) => candidate.timeId === timeId);
			if (time === undefined) return null;
			return stackedBlocks(
				time.rows.map((row) => rowBlock(row, (kind, id) => `${kind}:${lane.id}:${id}`, resolve, words, mint)),
			);
		}),
	);
	const innerWidths = lanes.map((_, lane) =>
		Math.max(CANVAS_CARD_WIDTH, ...cells[lane]!.map((cell) => cell?.width ?? 0)),
	);
	const rowHeights = times.map((_, row) =>
		Math.max(CANVAS_CARD_HEIGHT, ...lanes.map((_, lane) => cells[lane]![row]?.height ?? 0)),
	);
	const rowTops: number[] = [];
	let top = CANVAS_GROUP_PADDING;
	for (const height of rowHeights) {
		rowTops.push(top);
		top += height + CANVAS_GAP;
	}
	const innerHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, times.length - 1) * CANVAS_GAP;
	const groupHeight = CANVAS_GROUP_PADDING + innerHeight + CANVAS_GROUP_PADDING;
	const groupLefts: number[] = [];
	let left = CANVAS_CARD_WIDTH + CANVAS_COLUMN_GAP;
	for (const width of innerWidths) {
		groupLefts.push(left);
		left += width + 2 * CANVAS_GROUP_PADDING + CANVAS_GROUP_GAP;
	}
	const nodes: AllCanvasNodeData[] = [];
	lanes.forEach((lane, index) => {
		const box = { x: groupLefts[index]!, y: 0, width: innerWidths[index]! + 2 * CANVAS_GROUP_PADDING, height: groupHeight };
		nodes.push(groupNode(mint(`lane:${lane.id}`), box, lane.name, null));
	});
	times.forEach((timeId, row) => {
		const note = resolve.time(timeId);
		const id = mint(`time:${timeId}`);
		const box = card(0, rowTops[row]!);
		nodes.push(note === null ? textNode(id, box, words.missingTime) : fileNode(id, box, note));
		lanes.forEach((_, lane) => {
			const cell = cells[lane]![row];
			if (cell === null || cell === undefined) return;
			nodes.push(...translated(cell.nodes, groupLefts[lane]! + CANVAS_GROUP_PADDING, rowTops[row]!));
		});
	});
	return { nodes, edges: [] };
}

// -- Beat sheet ------------------------------------------------------------------

/**
 * A beat sheet as a canvas: one group an act, down the page in the story's
 * order, all of one width; in each, one band a beat, the beat's name and
 * description in a text node at the left that stands as tall as the band,
 * and the beat's rows of scenes beside it.
 */
export function beatSheetCanvas(
	sheet: BeatSheet,
	resolve: SceneCanvasResolver,
	words: CanvasExportWords,
): CanvasData {
	const mint = canvasIdMint();
	const acts = sheet.acts;
	const bands = acts.map((act) =>
		act.beats.map((beat) => {
			const rows = stackedBlocks(beat.rows.map((row) => rowBlock(row, (kind, id) => `${kind}:${id}`, resolve, words, mint)));
			return {
				beat,
				rows,
				width: CANVAS_CARD_WIDTH + (rows === null ? 0 : CANVAS_GAP + rows.width),
				height: Math.max(CANVAS_CARD_HEIGHT, rows?.height ?? 0),
			};
		}),
	);
	const innerWidth = Math.max(CANVAS_CARD_WIDTH, ...bands.flat().map((band) => band.width));
	const groupWidth = innerWidth + 2 * CANVAS_GROUP_PADDING;
	let top = 0;
	const boxes = bands.map((list) => {
		const inner = list.reduce((sum, band) => sum + band.height, 0) + Math.max(0, list.length - 1) * CANVAS_GAP;
		const height = CANVAS_GROUP_PADDING + inner + CANVAS_GROUP_PADDING;
		const box = { x: 0, y: top, width: groupWidth, height };
		top += height + CANVAS_GROUP_GAP;
		return box;
	});
	const nodes: AllCanvasNodeData[] = [];
	acts.forEach((act, index) => {
		nodes.push(groupNode(mint(`act:${act.id}`), boxes[index]!, words.actTitle(index + 1, act.label), null));
	});
	acts.forEach((_, index) => {
		let bandTop = boxes[index]!.y + CANVAS_GROUP_PADDING;
		for (const band of bands[index]!) {
			const name = band.beat.name.trim();
			const description = band.beat.description.trim();
			const text = `## ${name.length === 0 ? words.untitledBeat : name}${description.length === 0 ? '' : `\n\n${description}`}`;
			const box = { x: CANVAS_GROUP_PADDING, y: bandTop, width: CANVAS_CARD_WIDTH, height: band.height };
			nodes.push(textNode(mint(`beat:${band.beat.id}`), box, text));
			if (band.rows !== null) {
				nodes.push(...translated(band.rows.nodes, CANVAS_GROUP_PADDING + CANVAS_CARD_WIDTH + CANVAS_GAP, bandTop));
			}
			bandTop += band.height + CANVAS_GAP;
		}
	});
	return { nodes, edges: [] };
}
