/**
 * The corkboard's arithmetic, with no board to draw on: how the
 * shown scenes are gathered and ordered for display, where each card and
 * group head stands on a canvas of fixed-size cards, which of them a window
 * shows, where a drop lands, and what a move or an insertion means in the
 * narrative order once the board may be running backwards or in groups.
 */

import {
	MACARON_COLORS,
	PROGRESS_STATUSES,
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	fileStem,
	foldName,
	type MacaronColor,
	type ProgressStatus,
} from '../domain';
import type { Translate } from './modals';
import { wholeManuscriptDestination } from './linked-manuscript';
import { termName } from './scene-filters';
import type { CorkboardGroupField, CorkboardMode } from './story-structure-state';
import { rowAtOrBefore, rowOffsets, virtualWindow } from './virtual-table';

/** The dashboard's scene drag type, spelled the same so the two never mix. */
export const SCENE_DRAG_TYPE = 'application/x-snowflake-scene';

/** The slice of a scene's view model the board's arithmetic reads. */
export interface CorkboardScene {
	id: string;
	path?: string;
	title: string;
	povPath: string;
	povName: string;
	progressStatus: ProgressStatus | null;
	color: MacaronColor | null;
	categoryPaths: readonly string[];
	times: readonly string[];
	locations: readonly string[];
	characterPaths: readonly string[];
	linkedManuscript: readonly { raw: string; linktext: string; label: string }[];
}

/** What the funnel answers: a scene and its place in the narrative order. */
export interface ShownScene {
	scene: CorkboardScene;
	index: number;
}

export interface DisplayItem {
	/** The scene's place in the narrative order, which the circle shows. */
	sceneIndex: number;
}

export interface DisplayGroup {
	key: string;
	/** '' for the one group a board with no grouping has. */
	label: string;
	items: DisplayItem[];
}

export interface DisplayOrder {
	groups: DisplayGroup[];
	/** How many scenes are on the board, each counted once however many groups hold it. */
	shown: number;
}

export interface GroupContext {
	t: Translate;
	/** The cast in project order: the point-of-view and character groups follow it. */
	characters: readonly { path: string; name: string }[];
	locale: string;
	/** Resolve in the source scene's context; callers may share their snapshot link cache. */
	resolveLink?: (target: string, sourcePath: string) => string | null;
}

interface GroupValue {
	key: string;
	label: string;
	/** Where the group stands among its field's: a lower rank first, then the label. */
	rank: number;
}

const NONE_RANK = Number.MAX_SAFE_INTEGER;

function groupValues(
	scene: CorkboardScene,
	field: CorkboardGroupField,
	ctx: GroupContext,
): GroupValue[] {
	switch (field) {
		case 'pov': {
			if (scene.povPath === '') return [];
			const at = ctx.characters.findIndex(
				(character) => character.path === scene.povPath,
			);
			const rank =
				scene.povPath === SCENE_POV_OMNISCIENT
					? ctx.characters.length + 1
					: scene.povPath === SCENE_POV_MULTIPLE
						? ctx.characters.length + 2
						: at === -1
							? ctx.characters.length
							: at;
			return [{ key: scene.povPath, label: scene.povName, rank }];
		}
		case 'status':
			return scene.progressStatus === null
				? []
				: [
						{
							key: scene.progressStatus,
							label: ctx.t(`status.${scene.progressStatus}`),
							rank: PROGRESS_STATUSES.indexOf(scene.progressStatus),
						},
					];
		case 'color':
			return scene.color === null
				? []
				: [
						{
							key: scene.color,
							label: ctx.t(`stickyNotes.color.${scene.color}`),
							rank: MACARON_COLORS.indexOf(scene.color),
						},
					];
		case 'category':
			return scene.categoryPaths.map((path) => ({
				key: path,
				label: path,
				rank: 0,
			}));
		case 'time':
		case 'location':
			return (field === 'time' ? scene.times : scene.locations).map(
				(value) => {
					const name = termName(value);
					return { key: name, label: name, rank: 0 };
				},
			);
		case 'character':
			return scene.characterPaths.map((path) => ({
				key: path,
				label:
					ctx.characters.find((character) => character.path === path)
						?.name ?? fileStem(path),
				rank: 0,
			}));
		case 'linked':
			return scene.linkedManuscript.map((link) => {
				const destination = ctx.resolveLink === undefined ? null : wholeManuscriptDestination(
					link.raw, (target) => ctx.resolveLink?.(target, scene.path ?? '') ?? null,
				);
				return {
					key: destination?.replace(/\.md$/u, '') ?? link.linktext,
					label: link.label,
					rank: 0,
				};
			});
	}
}

/**
 * The shown scenes in the order the board draws them: one unlabeled group
 * in narrative order when nothing gathers them, else a group per value of
 * the field, a scene with several values standing in each. The groups run
 * in their field's own order where it has one (the cast, the statuses, the
 * macarons) and by label elsewhere, the scenes without a value last; inside
 * a group the narrative order holds, backwards when the board is reversed.
 */
export function displayOrder(
	shown: readonly ShownScene[],
	reversed: boolean,
	group: CorkboardGroupField | '',
	ctx: GroupContext,
): DisplayOrder {
	const sequence = reversed ? [...shown].reverse() : [...shown];
	if (group === '') {
		return {
			groups:
				sequence.length === 0
					? []
					: [
							{
								key: '',
								label: '',
								items: sequence.map((entry) => ({ sceneIndex: entry.index })),
							},
						],
			shown: shown.length,
		};
	}
	const gathered = new Map<string, GroupValue & { items: DisplayItem[] }>();
	const place = (value: GroupValue, item: DisplayItem): void => {
		const key = `${group}:${value.key}`;
		const standing = gathered.get(key);
		if (standing === undefined) {
			gathered.set(key, { ...value, key, items: [item] });
		} else {
			standing.items.push(item);
		}
	};
	const none: GroupValue = {
		key: '',
		label: ctx.t(`corkboard.none.${group}`),
		rank: NONE_RANK,
	};
	for (const entry of sequence) {
		const values = groupValues(entry.scene, group, ctx);
		const item = { sceneIndex: entry.index };
		if (values.length === 0) place(none, item);
		const placed = new Set<string>();
		for (const value of values) {
			if (placed.has(value.key)) continue;
			placed.add(value.key);
			place(value, item);
		}
	}
	const ordered = [...gathered.values()].sort(
		(a, b) =>
			a.rank - b.rank ||
			(a.rank === NONE_RANK ? 0 : a.label.localeCompare(b.label, ctx.locale)),
	);
	return {
		groups: ordered.map(({ key, label, items }) => ({ key, label, items })),
		shown: shown.length,
	};
}

/** The board's measures in rem: a card's least width, the gap, a head, a card per mode. */
export const CORKBOARD_REM = {
	minCardWidth: 16,
	/** A 1.25rem insertion button has 0.625rem of room on each side. */
	gap: 2.5,
	headHeight: 2.25,
	cardHeight: { compact: 5, standard: 15, extended: 19 },
} as const;

export interface CorkboardMetrics {
	/** The width the cards may take, in px. */
	width: number;
	gap: number;
	minCardWidth: number;
	cardHeight: number;
	headHeight: number;
}

export function corkboardMetrics(
	width: number,
	mode: CorkboardMode,
	remPx: number,
	/** The rendered header, footer and card borders, measured in the current theme. */
	compactHeightPx?: number,
): CorkboardMetrics {
	const measuredCompactHeight =
		mode === 'compact' &&
		compactHeightPx !== undefined &&
		Number.isFinite(compactHeightPx) &&
		compactHeightPx > 0
			? compactHeightPx
			: null;
	return {
		width,
		gap: CORKBOARD_REM.gap * remPx,
		minCardWidth: CORKBOARD_REM.minCardWidth * remPx,
		cardHeight: measuredCompactHeight ?? CORKBOARD_REM.cardHeight[mode] * remPx,
		headHeight: CORKBOARD_REM.headHeight * remPx,
	};
}

/** As many columns as the width holds at the least card width, never fewer than one. */
export function columnsFor(
	width: number,
	minCardWidth: number,
	gap: number,
): number {
	if (!(width > 0) || !(minCardWidth > 0)) return 1;
	return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

export type LayoutLine =
	| { kind: 'head'; key: string; label: string }
	| { kind: 'row'; cards: number[] };

export interface CardPlace {
	line: number;
	column: number;
}

export interface CorkboardLayout {
	columns: number;
	cardWidth: number;
	cardHeight: number;
	gap: number;
	headHeight: number;
	lines: LayoutLine[];
	/** Where each line starts, and one more: the height of the whole canvas. */
	offsets: number[];
	/** Every card in display order, across the groups. */
	items: DisplayItem[];
	/** Each card's line and column, by display index. */
	places: CardPlace[];
	height: number;
}

/**
 * The canvas: a labelled group opens with a head line, and its cards fill
 * rows of `columns`, each row a card high and a gap. An unlabeled group has
 * no head. The width is shared out between the columns.
 */
export function buildLayout(
	order: DisplayOrder,
	metrics: CorkboardMetrics,
): CorkboardLayout {
	const columns = columnsFor(metrics.width, metrics.minCardWidth, metrics.gap);
	const cardWidth =
		metrics.width > 0
			? (metrics.width - (columns - 1) * metrics.gap) / columns
			: metrics.minCardWidth;
	const lines: LayoutLine[] = [];
	const heights: number[] = [];
	const items: DisplayItem[] = [];
	const places: CardPlace[] = [];
	for (const group of order.groups) {
		if (group.label !== '') {
			lines.push({ kind: 'head', key: group.key, label: group.label });
			heights.push(metrics.headHeight);
		}
		for (let at = 0; at < group.items.length; at += columns) {
			const cards: number[] = [];
			for (
				let column = 0;
				column < columns && at + column < group.items.length;
				column += 1
			) {
				const item = group.items[at + column]!;
				cards.push(items.length);
				places.push({ line: lines.length, column });
				items.push(item);
			}
			lines.push({ kind: 'row', cards });
			heights.push(metrics.cardHeight + metrics.gap);
		}
	}
	const offsets = rowOffsets(heights);
	return {
		columns,
		cardWidth,
		cardHeight: metrics.cardHeight,
		gap: metrics.gap,
		headHeight: metrics.headHeight,
		lines,
		offsets,
		items,
		places,
		height: offsets[heights.length] ?? 0,
	};
}

export function cardPosition(
	layout: CorkboardLayout,
	displayIndex: number,
): { x: number; y: number } {
	const place = layout.places[displayIndex];
	if (place === undefined) return { x: 0, y: 0 };
	return {
		x: place.column * (layout.cardWidth + layout.gap),
		y: layout.offsets[place.line] ?? 0,
	};
}

/** The lines a scroller at this position shows, with the overscan either side. */
export function visibleLines(
	layout: CorkboardLayout,
	scrollTop: number,
	viewportHeight: number,
	overscan: number,
): { first: number; count: number } {
	const span = virtualWindow(scrollTop, viewportHeight, layout.offsets, overscan);
	return { first: span.first, count: span.count };
}

/** The display indexes of the cards on the lines in the window. */
export function visibleCards(
	layout: CorkboardLayout,
	lines: { first: number; count: number },
): number[] {
	const cards: number[] = [];
	for (let at = lines.first; at < lines.first + lines.count; at += 1) {
		const line = layout.lines[at];
		if (line?.kind === 'row') cards.push(...line.cards);
	}
	return cards;
}

/** The keys of the group heads on the lines in the window. */
export function visibleHeads(
	layout: CorkboardLayout,
	lines: { first: number; count: number },
): string[] {
	const heads: string[] = [];
	for (let at = lines.first; at < lines.first + lines.count; at += 1) {
		const line = layout.lines[at];
		if (line?.kind === 'head') heads.push(line.key);
	}
	return heads;
}

/** The scroll that centres a card's row in the viewport, never above the top. */
export function revealScrollTop(
	layout: CorkboardLayout,
	displayIndex: number,
	viewportHeight: number,
): number {
	const place = layout.places[displayIndex];
	if (place === undefined) return 0;
	const top = layout.offsets[place.line] ?? 0;
	const height = (layout.offsets[place.line + 1] ?? top) - top;
	const centred = top - Math.max(0, (viewportHeight - height) / 2);
	return Math.max(0, Math.min(centred, Math.max(0, layout.height - viewportHeight)));
}

/** The first card on the first row at or under the scroll position, or null with none. */
export function firstCardInView(
	layout: CorkboardLayout,
	scrollTop: number,
): number | null {
	for (let at = 0; at < layout.lines.length; at += 1) {
		const line = layout.lines[at];
		if (line?.kind !== 'row') continue;
		if ((layout.offsets[at + 1] ?? 0) > scrollTop) return line.cards[0] ?? null;
	}
	return null;
}

/**
 * Where a drop at a point on the canvas lands: before the display index it
 * names, `items.length` meaning after the last card. In a row it is the
 * first card whose middle is right of the pointer, else after the row's
 * last; a group head falls through to the row under it; above the first
 * line is the very first, past the last is the end.
 */
export function dropTargetAt(
	layout: CorkboardLayout,
	point: { x: number; y: number },
): { before: number } | null {
	if (layout.items.length === 0) return null;
	if (point.y < 0) return { before: 0 };
	if (point.y >= layout.height) return { before: layout.items.length };
	let at = rowAtOrBefore(layout.offsets, point.y);
	while (at < layout.lines.length && layout.lines[at]?.kind !== 'row') at += 1;
	const line = layout.lines[at];
	if (line === undefined || line.kind !== 'row') {
		return { before: layout.items.length };
	}
	for (const card of line.cards) {
		const column = layout.places[card]?.column ?? 0;
		const middle = column * (layout.cardWidth + layout.gap) + layout.cardWidth / 2;
		if (middle > point.x) return { before: card };
	}
	return { before: (line.cards[line.cards.length - 1] ?? -1) + 1 };
}

/**
 * The narrative index a dragged scene should take, the way `moveRanked`
 * counts it: its place in the list once it has left it. Before a card means
 * right before it; landing on nothing means after the last displayed card.
 * A reversed board reads backwards: before a card is right after it, and
 * after the last displayed card is right before it in narrative order.
 * Without a displayed end, the full list supplies that boundary.
 * Null when nothing would change, or the ids are not the board's.
 */
export function moveTargetIndex(
	orderIds: readonly string[],
	draggedId: string,
	beforeId: string | null,
	reversed: boolean,
	lastShownId: string | null = null,
): number | null {
	const from = orderIds.indexOf(draggedId);
	if (from === -1 || beforeId === draggedId) return null;
	const rest = orderIds.filter((id) => id !== draggedId);
	let target: number;
	if (beforeId === null) {
		if (lastShownId === draggedId) return null;
		if (lastShownId === null) {
			target = reversed ? 0 : rest.length;
		} else {
			const at = rest.indexOf(lastShownId);
			if (at === -1) return null;
			target = reversed ? at : at + 1;
		}
	} else {
		const at = rest.indexOf(beforeId);
		if (at === -1) return null;
		target = reversed ? at + 1 : at;
	}
	return target === from ? null : target;
}

/**
 * The narrative index a new scene beside a displayed card should follow.
 * Before and after follow the eye, so reverse on a reversed board. An index
 * of -1 inserts at the narrative start; null means the card is unknown.
 */
export function insertBesideIndex(
	orderIds: readonly string[],
	sceneId: string,
	side: 'before' | 'after',
	reversed: boolean,
): number | null {
	const at = orderIds.indexOf(sceneId);
	if (at === -1) return null;
	const follows = (side === 'after') !== reversed;
	return follows ? at : at - 1;
}

/** Where Move up and Move down take a card by the eye: swapped on a reversed board, closed at the ends. */
export function visualNeighbours(
	index: number,
	total: number,
	reversed: boolean,
): { up: number | null; down: number | null } {
	const earlier = index > 0 ? index - 1 : null;
	const later = index < total - 1 ? index + 1 : null;
	return reversed
		? { up: later, down: earlier }
		: { up: earlier, down: later };
}

/**
 * Whether the actions that read the cards' neighbours are on: dragging,
 * moving up and down, and the "+" between two cards. Only while the board
 * shows a continuous range once in its plain order, and nothing is read-only.
 */
export function adjacencyAllowed(state: {
	/** A filter besides the continuous scene-number range is active. */
	filtered: boolean;
	query: string;
	group: CorkboardGroupField | '';
	readOnly: boolean;
	anySceneReadOnly: boolean;
}): boolean {
	return (
		!state.filtered &&
		state.query.trim().length === 0 &&
		state.group === '' &&
		!state.readOnly &&
		!state.anySceneReadOnly
	);
}

export interface CardSelectOption {
	value: string;
	label: string;
	disabled: boolean;
}

/**
 * The point-of-view select's options: the two modes and every character.
 * A scene with no point of view keeps an empty choice, disabled, so the
 * select shows nothing until one is picked; one whose character is gone
 * keeps the stored path under the name the card shows, disabled likewise.
 */
export function povOptions(
	scene: Pick<CorkboardScene, 'povPath' | 'povName'>,
	characters: readonly { path: string; name: string }[],
	t: Translate,
): CardSelectOption[] {
	const options: CardSelectOption[] = [
		{ value: SCENE_POV_OMNISCIENT, label: t('modal.scene.povOmniscient'), disabled: false },
		{ value: SCENE_POV_MULTIPLE, label: t('modal.scene.povMultiple'), disabled: false },
		...characters.map((character) => ({
			value: character.path,
			label: character.name,
			disabled: false,
		})),
	];
	if (scene.povPath === '') {
		return [{ value: '', label: '', disabled: true }, ...options];
	}
	if (options.some((option) => option.value === scene.povPath)) return options;
	return [...options, { value: scene.povPath, label: scene.povName, disabled: true }];
}

/** The status select's options, with an empty disabled choice while none is set. */
export function statusOptions(
	current: ProgressStatus | null,
	t: Translate,
): CardSelectOption[] {
	return [
		...(current === null ? [{ value: '', label: '', disabled: true }] : []),
		...PROGRESS_STATUSES.map((status) => ({
			value: status,
			label: t(`status.${status}`),
			disabled: false,
		})),
	];
}

/** Whether another scene already holds the title, folded the way the form folds names. */
export function titleTaken(
	title: string,
	ownId: string,
	scenes: readonly { id: string; title: string }[],
): boolean {
	const folded = foldName(title);
	return scenes.some(
		(scene) => scene.id !== ownId && foldName(scene.title) === folded,
	);
}
