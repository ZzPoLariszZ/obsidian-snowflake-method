/**
 * What the Story Structure view keeps between sessions, and the pure rules it
 * keeps it by: which visualization the tab shows, and how the ordered
 * corkboard is set. The families and their members are named here so the
 * view's strips, the commands and the tab titles read one list; a member not
 * built yet still has its place in it.
 */

import type { WorldbuildingKindId } from '../domain';
import { entityFilters, isEntityGroupField, type EntityFilters } from './entity-filters';
import { sceneFilters, type SceneFilters } from './scene-filters';

export const STORY_STRUCTURE_FAMILIES = [
	'corkboard',
	'freeform',
	'timeline',
	'beat-sheet',
	'relationship-graph',
] as const;
export type StoryStructureFamily = (typeof STORY_STRUCTURE_FAMILIES)[number];

export const STORY_STRUCTURE_VISUALIZATIONS = [
	'corkboard-ordered',
	'corkboard-freeform',
	'timeline',
	'beat-sheet',
	'relationship-graph',
] as const;
export type StoryStructureVisualization =
	(typeof STORY_STRUCTURE_VISUALIZATIONS)[number];
export const DEFAULT_STORY_STRUCTURE_VISUALIZATION: StoryStructureVisualization =
	'corkboard-ordered';

export function isStoryStructureVisualization(
	value: unknown,
): value is StoryStructureVisualization {
	return (STORY_STRUCTURE_VISUALIZATIONS as readonly unknown[]).includes(value);
}

/** The peer tab for a visualization; persisted corkboard keys stay compatible. */
export function visualizationFamily(
	key: StoryStructureVisualization,
): StoryStructureFamily {
	switch (key) {
		case 'corkboard-ordered':
			return 'corkboard';
		case 'corkboard-freeform':
			return 'freeform';
		case 'timeline':
		case 'beat-sheet':
		case 'relationship-graph':
			return key;
	}
}

/** The saved visualization opened by each peer tab. */
export function familyVisualization(
	family: StoryStructureFamily,
): StoryStructureVisualization {
	if (family === 'corkboard') return 'corkboard-ordered';
	if (family === 'freeform') return 'corkboard-freeform';
	return family;
}

export const CORKBOARD_MODES = ['compact', 'standard', 'gallery', 'extended'] as const;
export type CorkboardMode = (typeof CORKBOARD_MODES)[number];

export function isCorkboardMode(value: unknown): value is CorkboardMode {
	return (CORKBOARD_MODES as readonly unknown[]).includes(value);
}

export const CORKBOARD_GROUP_FIELDS = [
	'pov',
	'status',
	'category',
	'time',
	'location',
	'character',
	'color',
	'linked',
] as const;
export type CorkboardGroupField = (typeof CORKBOARD_GROUP_FIELDS)[number];

export function isCorkboardGroupField(
	value: unknown,
): value is CorkboardGroupField {
	return (CORKBOARD_GROUP_FIELDS as readonly unknown[]).includes(value);
}

/** How the corkboard is set: what a card shows, what the cards are gathered by, which way they run. */
export interface CorkboardSettings {
	mode: CorkboardMode;
	group: CorkboardGroupField | '';
	reversed: boolean;
}

/**
 * A board view's three sizes in px: how wide a card is, how tall the
 * standard card is, and how large the type in its text box. Each is 0 while
 * it is the board's own, which is the look every build before the sliders
 * drew: cards stretched from their least width, a card as tall as its style,
 * the theme's small type.
 */
export interface CorkboardCardSizes {
	cardWidth: number;
	cardHeight: number;
	textSize: number;
}

export const CORKBOARD_SIZE_KEYS = ['cardWidth', 'cardHeight', 'textSize'] as const;
export type CorkboardSizeKey = (typeof CORKBOARD_SIZE_KEYS)[number];

/**
 * The least and the most each slider offers, in px. A card runs from the
 * standard card's own measures, 240 px either way, to three times that; the
 * type from the card's smallest to three times it. Between the two ends a
 * slider moves a pixel at a time, so a card is any size the author likes
 * and not one of a few.
 */
export const CORKBOARD_SIZE_LIMITS: Readonly<Record<CorkboardSizeKey, { readonly min: number; readonly max: number }>> = {
	cardWidth: { min: 240, max: 720 },
	cardHeight: { min: 240, max: 720 },
	textSize: { min: 12, max: 36 },
};

/** Every whole pixel from one size to another, both counted. */
const everyPixel = ({ min, max }: { min: number; max: number }): readonly number[] =>
	Array.from({ length: max - min + 1 }, (_, at) => min + at);

/** The places each slider's handle may stand: every whole pixel between its two ends. */
export const CORKBOARD_SIZE_STOPS: Readonly<Record<CorkboardSizeKey, readonly number[]>> = {
	cardWidth: everyPixel(CORKBOARD_SIZE_LIMITS.cardWidth),
	cardHeight: everyPixel(CORKBOARD_SIZE_LIMITS.cardHeight),
	textSize: everyPixel(CORKBOARD_SIZE_LIMITS.textSize),
};

export function defaultCorkboardCardSizes(): CorkboardCardSizes {
	return { cardWidth: 0, cardHeight: 0, textSize: 0 };
}

/**
 * A stored size as the board may hold it: nothing or less is the board's
 * own, a number above it the nearest whole pixel between the slider's two
 * ends, and anything that is no number is not a size at all, which leaves
 * the one already held.
 */
export function readCorkboardSize(key: CorkboardSizeKey, value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	if (value <= 0) return 0;
	const { min, max } = CORKBOARD_SIZE_LIMITS[key];
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** The sizes a stored shape names, each only when it reads as one. */
export function readCorkboardSizes(value: unknown): Partial<CorkboardCardSizes> {
	if (typeof value !== 'object' || value === null) return {};
	const candidate = value as Record<string, unknown>;
	const sizes: Partial<CorkboardCardSizes> = {};
	for (const key of CORKBOARD_SIZE_KEYS) {
		const size = readCorkboardSize(key, candidate[key]);
		if (size !== undefined) sizes[key] = size;
	}
	return sizes;
}

/** How a surface's cards are drawn: their style and their three sizes, each size 0 while it is the surface's own. */
export type CorkboardLook = CorkboardCardSizes & { mode: CorkboardMode };

const sizesOf = (held: CorkboardCardSizes): CorkboardCardSizes => ({
	cardWidth: held.cardWidth,
	cardHeight: held.cardHeight,
	textSize: held.textSize,
});

export const sameCorkboardCardSizes = (left: CorkboardCardSizes, right: CorkboardCardSizes): boolean =>
	CORKBOARD_SIZE_KEYS.every((key) => left[key] === right[key]);

/**
 * The view a corkboard tab shows: `scene` for the scenes, `character` for the
 * characters, or a worldbuilding kind's id for that kind's notes. A kind id
 * never spells either built-in name: the registry refuses those names in
 * both languages.
 */
export type CorkboardView = WorldbuildingKindId;

export const CORKBOARD_SCENE_VIEW: CorkboardView = 'scene';
export const CORKBOARD_CHARACTER_VIEW: CorkboardView = 'character';

export function isCorkboardView(value: unknown): value is CorkboardView {
	return typeof value === 'string' && value.length > 0;
}

/** Whether a project can show the view: the two built-in views always, a kind's only while the project has the kind. */
export function corkboardViewAvailable(
	view: CorkboardView,
	kinds: readonly { id: string }[],
): boolean {
	return view === CORKBOARD_SCENE_VIEW || view === CORKBOARD_CHARACTER_VIEW || kinds.some((kind) => kind.id === view);
}

/** How a character or worldbuilding view of the board is set: as the scene view is, gathered by any field of its own, at sizes of its own. */
export interface CorkboardViewSettings extends CorkboardCardSizes {
	mode: CorkboardMode;
	group: string;
	reversed: boolean;
}

/**
 * The corkboard tab's own settings: the scene view's three and its sizes,
 * flat as every build has kept them, which view the tab shows, and every
 * other view's by view, each kept since the tab first showed it.
 */
export interface CorkboardTabSettings extends CorkboardSettings, CorkboardCardSizes {
	view: CorkboardView;
	views: Record<string, CorkboardViewSettings>;
}

export function defaultCorkboardViewSettings(): CorkboardViewSettings {
	return { mode: 'standard', group: '', reversed: false, ...defaultCorkboardCardSizes() };
}

/** Project defaults for newly opened tabs; grouping and filters stay in the tab. */
export type CorkboardPreferences = Pick<CorkboardSettings, 'mode' | 'reversed'> & CorkboardCardSizes;

/** Read only the preferences we persist, ignoring malformed or transient fields. */
export function readCorkboardPreferences(value: unknown): Partial<CorkboardPreferences> {
	if (typeof value !== 'object' || value === null) return {};
	const candidate = value as Record<string, unknown>;
	return {
		...(isCorkboardMode(candidate.mode) ? { mode: candidate.mode } : {}),
		...(typeof candidate.reversed === 'boolean' ? { reversed: candidate.reversed } : {}),
		...readCorkboardSizes(candidate),
	};
}

/**
 * How a scene pool is set: the three the corkboard keeps, and the three
 * sizes of its own cards. The pool is one card wide, so its card width is
 * its own width too.
 */
export type PoolSettings = CorkboardSettings & CorkboardCardSizes;

/** The look a workspace's lanes start in: compact cards at the workspace's own sizes. */
export function defaultLaneLook(): CorkboardLook {
	return { mode: 'compact', ...defaultCorkboardCardSizes() };
}

/**
 * How the timeline is set: the pool's settings, the look of the cards on
 * its lanes, and the two folds. The lanes' look is their own, set apart
 * from the pool's: a card may be one thing in the pool it is picked from
 * and another on the lane it is placed on. The lanes' type size is their
 * words' as well, the descriptions' and the sub-descriptions'.
 */
export interface TimelineSettings {
	pool: PoolSettings;
	lanes: CorkboardLook;
	/** The pool folded out of sight, the lanes taking its room. */
	poolCollapsed: boolean;
	/** The time column folded to its names alone. */
	timeCollapsed: boolean;
}

/** A one-column pool reads best compact, and the lanes start the same; the tab keeps what the author chose after. */
export function defaultTimelineSettings(): TimelineSettings {
	return {
		pool: { mode: 'compact', group: '', reversed: false, ...defaultCorkboardCardSizes() },
		lanes: defaultLaneLook(),
		poolCollapsed: false,
		timeCollapsed: false,
	};
}

/** How the beat sheet is set: the pool's settings and the sheet's own look, as the timeline keeps them, and the two folds. */
export interface BeatSheetSettings {
	pool: PoolSettings;
	lanes: CorkboardLook;
	/** The pool folded out of sight, the sheet taking its room. */
	poolCollapsed: boolean;
	/** The beat column folded to its names alone. */
	beatsCollapsed: boolean;
}

/** A one-column pool reads best compact here too, and the sheet's cards start the same. */
export function defaultBeatSheetSettings(): BeatSheetSettings {
	return {
		pool: { mode: 'compact', group: '', reversed: false, ...defaultCorkboardCardSizes() },
		lanes: defaultLaneLook(),
		poolCollapsed: false,
		beatsCollapsed: false,
	};
}

/**
 * How the freeform canvas is set: the view the tab shows, and its four
 * switches, the minimap on until it is put away, the grid, the drawing to
 * other nodes and the lock off until asked for. A project keeps each of its
 * views in a file of its own and no file is the whole project's, so which
 * one is on show is the tab's to remember; a tab that names none, or one
 * that has gone, shows the view changed last.
 */
export interface FreeformSettings {
	viewId: string | null;
	minimap: boolean;
	snap: boolean;
	/** A node moved or sized by hand is drawn level with the nodes about it. */
	snapObjects: boolean;
	/** Nothing on the canvas is moved, sized, joined, added or removed until the lock is let go. */
	readOnly: boolean;
}

export function defaultFreeformSettings(): FreeformSettings {
	return { viewId: null, minimap: true, snap: false, snapObjects: false, readOnly: false };
}

/**
 * The two views of the relationship graph tab: the project's entities drawn
 * by the plugin, and its scenes and manuscript, which open in Obsidian's own
 * graph in a tab of their own, this tab standing in for it.
 */
export const RELATIONSHIP_GRAPH_VIEWS = ['entities', 'scene-manuscript'] as const;
export type RelationshipGraphView = (typeof RELATIONSHIP_GRAPH_VIEWS)[number];

export function isRelationshipGraphView(value: unknown): value is RelationshipGraphView {
	return (RELATIONSHIP_GRAPH_VIEWS as readonly unknown[]).includes(value);
}

/** How the relationship graph tab is set: the view it shows, whether the controls panel stands open, and whether the timeline does. */
export interface RelationshipGraphSettings {
	view: RelationshipGraphView;
	controlsOpen: boolean;
	/** The timeline strip standing under the graph, which draws the graph as it stands at one time. */
	timelineOpen: boolean;
}

export function defaultRelationshipGraphSettings(): RelationshipGraphSettings {
	return { view: 'entities', controlsOpen: true, timelineOpen: false };
}

export interface StoryStructureViewStateSnapshot {
	projectPath: string | null;
	visualization: StoryStructureVisualization;
	corkboard: CorkboardTabSettings;
	timeline: TimelineSettings;
	beatSheet: BeatSheetSettings;
	freeform: FreeformSettings;
	relationshipGraph: RelationshipGraphSettings;
}

export function defaultStoryStructureState(): StoryStructureViewStateSnapshot {
	return {
		projectPath: null,
		visualization: DEFAULT_STORY_STRUCTURE_VISUALIZATION,
		corkboard: {
			mode: 'standard',
			group: '',
			reversed: false,
			...defaultCorkboardCardSizes(),
			view: CORKBOARD_SCENE_VIEW,
			views: {},
		},
		timeline: defaultTimelineSettings(),
		beatSheet: defaultBeatSheetSettings(),
		freeform: defaultFreeformSettings(),
		relationshipGraph: defaultRelationshipGraphSettings(),
	};
}

export interface StoryStructureViewStateUpdate {
	state: StoryStructureViewStateSnapshot;
	changed: boolean;
}

/** A board's three settings taken one by one over the current ones, each only when it is one of its own values. */
function mergeCorkboardSettings(current: CorkboardSettings, value: unknown): CorkboardSettings {
	const board =
		typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	return {
		mode: isCorkboardMode(board.mode) ? board.mode : current.mode,
		group: board.group === '' || isCorkboardGroupField(board.group) ? board.group : current.group,
		reversed: typeof board.reversed === 'boolean' ? board.reversed : current.reversed,
	};
}

const sameCorkboardSettings = (left: CorkboardSettings | CorkboardViewSettings, right: CorkboardSettings | CorkboardViewSettings): boolean =>
	left.mode === right.mode && left.group === right.group && left.reversed === right.reversed;

/** The sizes a stored shape names, each over the one held. */
const mergeCorkboardCardSizes = (current: CorkboardCardSizes, value: unknown): CorkboardCardSizes => ({
	...sizesOf(current),
	...readCorkboardSizes(value),
});

/** A pool's settings taken one by one over the current ones: the three, and each size that reads as one. */
const mergePoolSettings = (current: PoolSettings, value: unknown): PoolSettings => ({
	...mergeCorkboardSettings(current, value),
	...mergeCorkboardCardSizes(current, value),
});

const samePoolSettings = (left: PoolSettings, right: PoolSettings): boolean =>
	sameCorkboardSettings(left, right) && sameCorkboardCardSizes(left, right);

/**
 * The lanes' look taken over the one held: the style and each size the
 * stored shape names. A layout saved before the lanes had a look of their
 * own names none, and its pool's is taken instead, since until then the
 * pool's card style dressed the lanes too: a workspace opens looking as it
 * was left.
 */
const mergeLaneLook = (current: CorkboardLook, lanes: unknown, pool: unknown): CorkboardLook => {
	const named = typeof lanes === 'object' && lanes !== null ? lanes : pool;
	const stored = typeof named === 'object' && named !== null ? (named as Record<string, unknown>) : {};
	return {
		mode: isCorkboardMode(stored.mode) ? stored.mode : current.mode,
		...mergeCorkboardCardSizes(current, stored),
	};
};

const sameCorkboardLook = (left: CorkboardLook, right: CorkboardLook): boolean =>
	left.mode === right.mode && sameCorkboardCardSizes(left, right);

const sameCorkboardViews = (
	left: Record<string, CorkboardViewSettings>,
	right: Record<string, CorkboardViewSettings>,
): boolean => {
	const names = Object.keys(left);
	if (names.length !== Object.keys(right).length) return false;
	return names.every((name) => {
		const other = right[name];
		const own = left[name];
		return other !== undefined && own !== undefined && sameCorkboardSettings(own, other) && sameCorkboardCardSizes(own, other);
	});
};

/** An entity view's three taken one by one over the current ones; its grouping is any field of its own. */
function mergeCorkboardViewSettings(current: CorkboardViewSettings, value: unknown): CorkboardViewSettings {
	const board =
		typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	return {
		mode: isCorkboardMode(board.mode) ? board.mode : current.mode,
		group: board.group === '' || isEntityGroupField(board.group) ? board.group : current.group,
		reversed: typeof board.reversed === 'boolean' ? board.reversed : current.reversed,
		...mergeCorkboardCardSizes(current, value),
	};
}

/**
 * The tab's settings over the current ones: the scene view's three one by
 * one, the view where one is named, and every other view's three by view,
 * over the ones the tab already holds. A layout saved before views existed
 * names none and stays on the scenes; one naming a kind the project no
 * longer has is taken here and falls back where the model is known.
 */
function mergeCorkboardTabSettings(current: CorkboardTabSettings, value: unknown): CorkboardTabSettings {
	const board =
		typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	const views: Record<string, CorkboardViewSettings> = { ...current.views };
	const named = typeof board.views === 'object' && board.views !== null ? (board.views as Record<string, unknown>) : {};
	for (const [view, settings] of Object.entries(named)) {
		if (!isCorkboardView(view) || view === CORKBOARD_SCENE_VIEW) continue;
		views[view] = mergeCorkboardViewSettings(views[view] ?? defaultCorkboardViewSettings(), settings);
	}
	return {
		...mergeCorkboardSettings(current, value),
		...mergeCorkboardCardSizes(current, value),
		view: isCorkboardView(board.view) ? board.view : current.view,
		views,
	};
}

/**
 * The other views' settings a state names, each over the defaults, and no
 * others: what a tab moving to another project starts those views from, as
 * the scene view starts from the state's own two and the project's defaults.
 */
export function namedCorkboardViews(value: unknown): Record<string, CorkboardViewSettings> {
	return mergeCorkboardTabSettings(defaultStoryStructureState().corkboard, value).views;
}

/**
 * A restored state over the current one. A visualization this build knows
 * wins, a state naming none keeps the current, and one naming something
 * unknown lands on the corkboard, the family's first face. The
 * corkboard's settings are taken one by one, each only when it is one of
 * its own values.
 */
export function mergeStoryStructureViewState(
	current: StoryStructureViewStateSnapshot,
	value: unknown,
): StoryStructureViewStateUpdate {
	if (typeof value !== 'object' || value === null) {
		return { state: current, changed: false };
	}
	const candidate = value as Record<string, unknown>;
	const projectPath =
		typeof candidate.projectPath === 'string' || candidate.projectPath === null
			? candidate.projectPath
			: current.projectPath;
	const visualization = isStoryStructureVisualization(candidate.visualization)
		? candidate.visualization
		: candidate.visualization === undefined
			? current.visualization
			: DEFAULT_STORY_STRUCTURE_VISUALIZATION;
	const corkboard = mergeCorkboardTabSettings(current.corkboard, candidate.corkboard);
	const timelineCandidate =
		typeof candidate.timeline === 'object' && candidate.timeline !== null
			? (candidate.timeline as Record<string, unknown>)
			: {};
	const timeline: TimelineSettings = {
		pool: mergePoolSettings(current.timeline.pool, timelineCandidate.pool),
		lanes: mergeLaneLook(current.timeline.lanes, timelineCandidate.lanes, timelineCandidate.pool),
		poolCollapsed:
			typeof timelineCandidate.poolCollapsed === 'boolean'
				? timelineCandidate.poolCollapsed
				: current.timeline.poolCollapsed,
		timeCollapsed:
			typeof timelineCandidate.timeCollapsed === 'boolean'
				? timelineCandidate.timeCollapsed
				: current.timeline.timeCollapsed,
	};
	const beatSheetCandidate =
		typeof candidate.beatSheet === 'object' && candidate.beatSheet !== null
			? (candidate.beatSheet as Record<string, unknown>)
			: {};
	const beatSheet: BeatSheetSettings = {
		pool: mergePoolSettings(current.beatSheet.pool, beatSheetCandidate.pool),
		lanes: mergeLaneLook(current.beatSheet.lanes, beatSheetCandidate.lanes, beatSheetCandidate.pool),
		poolCollapsed:
			typeof beatSheetCandidate.poolCollapsed === 'boolean'
				? beatSheetCandidate.poolCollapsed
				: current.beatSheet.poolCollapsed,
		beatsCollapsed:
			typeof beatSheetCandidate.beatsCollapsed === 'boolean'
				? beatSheetCandidate.beatsCollapsed
				: current.beatSheet.beatsCollapsed,
	};
	const freeformCandidate =
		typeof candidate.freeform === 'object' && candidate.freeform !== null
			? (candidate.freeform as Record<string, unknown>)
			: {};
	const freeform: FreeformSettings = {
		viewId:
			freeformCandidate.viewId === null ||
			(typeof freeformCandidate.viewId === 'string' && freeformCandidate.viewId.length > 0)
				? freeformCandidate.viewId
				: current.freeform.viewId,
		minimap:
			typeof freeformCandidate.minimap === 'boolean'
				? freeformCandidate.minimap
				: current.freeform.minimap,
		snap:
			typeof freeformCandidate.snap === 'boolean'
				? freeformCandidate.snap
				: current.freeform.snap,
		snapObjects:
			typeof freeformCandidate.snapObjects === 'boolean'
				? freeformCandidate.snapObjects
				: current.freeform.snapObjects,
		readOnly:
			typeof freeformCandidate.readOnly === 'boolean'
				? freeformCandidate.readOnly
				: current.freeform.readOnly,
	};
	const graphCandidate =
		typeof candidate.relationshipGraph === 'object' && candidate.relationshipGraph !== null
			? (candidate.relationshipGraph as Record<string, unknown>)
			: {};
	const relationshipGraph: RelationshipGraphSettings = {
		view: isRelationshipGraphView(graphCandidate.view)
			? graphCandidate.view
			: current.relationshipGraph.view,
		controlsOpen:
			typeof graphCandidate.controlsOpen === 'boolean'
				? graphCandidate.controlsOpen
				: current.relationshipGraph.controlsOpen,
		timelineOpen:
			typeof graphCandidate.timelineOpen === 'boolean'
				? graphCandidate.timelineOpen
				: current.relationshipGraph.timelineOpen,
	};
	const state = { projectPath, visualization, corkboard, timeline, beatSheet, freeform, relationshipGraph };
	return {
		state,
		changed:
			state.projectPath !== current.projectPath ||
			state.visualization !== current.visualization ||
			!sameCorkboardSettings(state.corkboard, current.corkboard) ||
			!sameCorkboardCardSizes(state.corkboard, current.corkboard) ||
			state.corkboard.view !== current.corkboard.view ||
			!sameCorkboardViews(state.corkboard.views, current.corkboard.views) ||
			!samePoolSettings(state.timeline.pool, current.timeline.pool) ||
			!sameCorkboardLook(state.timeline.lanes, current.timeline.lanes) ||
			state.timeline.poolCollapsed !== current.timeline.poolCollapsed ||
			state.timeline.timeCollapsed !== current.timeline.timeCollapsed ||
			!samePoolSettings(state.beatSheet.pool, current.beatSheet.pool) ||
			!sameCorkboardLook(state.beatSheet.lanes, current.beatSheet.lanes) ||
			state.beatSheet.poolCollapsed !== current.beatSheet.poolCollapsed ||
			state.beatSheet.beatsCollapsed !== current.beatSheet.beatsCollapsed ||
			state.freeform.viewId !== current.freeform.viewId ||
			state.freeform.minimap !== current.freeform.minimap ||
			state.freeform.snap !== current.freeform.snap ||
			state.freeform.snapObjects !== current.freeform.snapObjects ||
			state.freeform.readOnly !== current.freeform.readOnly ||
			state.relationshipGraph.view !== current.relationshipGraph.view ||
			state.relationshipGraph.controlsOpen !== current.relationshipGraph.controlsOpen ||
			state.relationshipGraph.timelineOpen !== current.relationshipGraph.timelineOpen,
	};
}

/** A memory's three sizes alone, as the layout and the project's defaults keep them. */
export const corkboardCardSizesOf = sizesOf;

/**
 * What outlives a mount of the board: the settings the view persists, and
 * the search, the funnel's answers and the scroll, which last the session.
 * The field the cards are gathered by is any of the view's own, which only
 * the scene view's are the layout's to keep, so the view narrows it as it
 * saves.
 */
export interface CorkboardMemory<Filters = SceneFilters> extends CorkboardCardSizes {
	mode: CorkboardMode;
	/** The field the cards are gathered by, one of the view's own, or '' for none. */
	group: string;
	reversed: boolean;
	/** The view the memory belongs to. */
	view: CorkboardView;
	query: string;
	filters: Filters;
	scrollTop: number;
}

/** The scene view's memory: what a tab remembers for the board the pools deal too. */
export function corkboardMemory(settings?: CorkboardSettings & Partial<CorkboardCardSizes>): CorkboardMemory {
	const { mode, group, reversed } = settings ?? defaultStoryStructureState().corkboard;
	return {
		mode,
		group,
		reversed,
		...defaultCorkboardCardSizes(),
		...readCorkboardSizes(settings),
		view: CORKBOARD_SCENE_VIEW,
		query: '',
		filters: sceneFilters(),
		scrollTop: 0,
	};
}

/**
 * A character or worldbuilding view's memory: its card style, grouping and
 * direction are the view's own, as its search, funnel and scroll are, which
 * last the session.
 */
export function entityCorkboardMemory(
	view: CorkboardView,
	settings: Pick<CorkboardViewSettings, 'mode' | 'group' | 'reversed'> & Partial<CorkboardCardSizes>,
): CorkboardMemory<EntityFilters> {
	return {
		mode: settings.mode,
		group: settings.group,
		reversed: settings.reversed,
		...defaultCorkboardCardSizes(),
		...readCorkboardSizes(settings),
		view,
		query: '',
		filters: entityFilters(),
		scrollTop: 0,
	};
}

/**
 * What outlives a mount of the timeline: the pool's settings the view
 * persists, and what lasts the session -- the timeline chosen by a click in
 * each view, where each stack was browsed to, the pool's search, funnel and
 * scroll, and the workspace's own scroll.
 */
export interface TimelineMemory {
	/** The timeline made active by a click, by view id. */
	activeTimeline: Map<string, string>;
	/** Where each stack was browsed to, by view, timeline and row. */
	stackPositions: Map<string, number>;
	pool: CorkboardMemory;
	/** How the cards on the lanes are drawn, and the lanes' words set, which the view persists. */
	lanes: CorkboardLook;
	/** The pool folded away, which the view persists with the pool's settings. */
	poolCollapsed: boolean;
	/** The time column folded to its names, persisted the same way. */
	timeCollapsed: boolean;
	scroll: { left: number; top: number };
}

export function timelineMemory(settings?: TimelineSettings): TimelineMemory {
	const held = settings ?? defaultTimelineSettings();
	return {
		activeTimeline: new Map(),
		stackPositions: new Map(),
		pool: corkboardMemory(held.pool),
		lanes: { ...held.lanes },
		poolCollapsed: held.poolCollapsed,
		timeCollapsed: held.timeCollapsed,
		scroll: { left: 0, top: 0 },
	};
}

/**
 * What outlives a mount of the beat sheet: the pool's settings and the two
 * folds the view persists, and what lasts the session -- where each stack was
 * browsed to, the pool's search, funnel and scroll, and the workspace's own
 * scroll. Which sheet is shown is the file's to remember.
 */
export interface BeatSheetMemory {
	/** Where each stack was browsed to, by sheet and row. */
	stackPositions: Map<string, number>;
	pool: CorkboardMemory;
	/** How the cards on the sheet are drawn, and its words set. */
	lanes: CorkboardLook;
	poolCollapsed: boolean;
	beatsCollapsed: boolean;
	scroll: { left: number; top: number };
}

export function beatSheetMemory(settings?: BeatSheetSettings): BeatSheetMemory {
	const held = settings ?? defaultBeatSheetSettings();
	return {
		stackPositions: new Map(),
		pool: corkboardMemory(held.pool),
		lanes: { ...held.lanes },
		poolCollapsed: held.poolCollapsed,
		beatsCollapsed: held.beatsCollapsed,
		scroll: { left: 0, top: 0 },
	};
}

/**
 * What outlives a mount of the freeform canvas: the settings the view
 * persists, and what lasts the session -- where each view was looked at from
 * in this tab, which a view's file says only for a tab that has not looked
 * at it yet.
 */
export interface FreeformMemory extends FreeformSettings {
	/** Where each view stands in this tab, by view id. */
	viewports: Map<string, { x: number; y: number; zoom: number }>;
}

export function freeformMemory(settings?: FreeformSettings): FreeformMemory {
	return { ...(settings ?? defaultFreeformSettings()), viewports: new Map() };
}

/**
 * What outlives a mount of the relationship graph: the settings the view
 * persists, and what lasts the session -- the words searched for, the node
 * a local graph is drawn about, and where every node was left, so a frame
 * rebuilt for a language or a project reload draws the same picture rather
 * than settling a new one.
 */
export interface RelationshipGraphMemory extends RelationshipGraphSettings {
	query: string;
	/** The node the local graph is drawn about, or null for the whole graph. */
	focus: string | null;
	/** The time the timeline stands on, by its note's id; null for the first of them. */
	time: string | null;
	/** Where each node stood, by id, and whether it was pinned there. */
	positions: Map<string, { x: number; y: number; pinned: boolean }>;
}

export function relationshipGraphMemory(settings?: RelationshipGraphSettings): RelationshipGraphMemory {
	return { ...(settings ?? defaultRelationshipGraphSettings()), query: '', focus: null, time: null, positions: new Map() };
}
