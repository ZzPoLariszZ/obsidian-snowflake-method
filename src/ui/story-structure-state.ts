/**
 * What the Story Structure view keeps between sessions, and the pure rules it
 * keeps it by: which visualization the tab shows, and how the ordered
 * corkboard is set. The families and their members are named here so the
 * view's strips, the commands and the tab titles read one list; a member not
 * built yet still has its place in it.
 */

import { sceneFilters, type SceneFilters } from './scene-filters';

export const STORY_STRUCTURE_FAMILIES = [
	'corkboard',
	'freeform',
	'timeline',
	'beat-sheet',
] as const;
export type StoryStructureFamily = (typeof STORY_STRUCTURE_FAMILIES)[number];

export const STORY_STRUCTURE_VISUALIZATIONS = [
	'corkboard-ordered',
	'corkboard-freeform',
	'timeline',
	'beat-sheet',
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

export const CORKBOARD_MODES = ['compact', 'standard', 'extended'] as const;
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

/** Project defaults for newly opened tabs; grouping and filters stay in the tab. */
export type CorkboardPreferences = Pick<CorkboardSettings, 'mode' | 'reversed'>;

/** Read only the preferences we persist, ignoring malformed or transient fields. */
export function readCorkboardPreferences(value: unknown): Partial<CorkboardPreferences> {
	if (typeof value !== 'object' || value === null) return {};
	const candidate = value as Record<string, unknown>;
	return {
		...(isCorkboardMode(candidate.mode) ? { mode: candidate.mode } : {}),
		...(typeof candidate.reversed === 'boolean' ? { reversed: candidate.reversed } : {}),
	};
}

/** How the timeline is set: the pool's three the corkboard keeps, its card style dressing the lanes too, and the two folds. */
export interface TimelineSettings {
	pool: CorkboardSettings;
	/** The pool folded out of sight, the lanes taking its room. */
	poolCollapsed: boolean;
	/** The time column folded to its names alone. */
	timeCollapsed: boolean;
}

/** A one-column pool reads best compact, and the lanes follow it; the tab keeps what the author chose after. */
export function defaultTimelineSettings(): TimelineSettings {
	return { pool: { mode: 'compact', group: '', reversed: false }, poolCollapsed: false, timeCollapsed: false };
}

export interface StoryStructureViewStateSnapshot {
	projectPath: string | null;
	visualization: StoryStructureVisualization;
	corkboard: CorkboardSettings;
	timeline: TimelineSettings;
}

export function defaultStoryStructureState(): StoryStructureViewStateSnapshot {
	return {
		projectPath: null,
		visualization: DEFAULT_STORY_STRUCTURE_VISUALIZATION,
		corkboard: { mode: 'standard', group: '', reversed: false },
		timeline: defaultTimelineSettings(),
	};
}

export interface StoryStructureViewStateUpdate {
	state: StoryStructureViewStateSnapshot;
	changed: boolean;
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
	const board =
		typeof candidate.corkboard === 'object' && candidate.corkboard !== null
			? (candidate.corkboard as Record<string, unknown>)
			: {};
	const corkboard: CorkboardSettings = {
		mode: isCorkboardMode(board.mode) ? board.mode : current.corkboard.mode,
		group:
			board.group === '' || isCorkboardGroupField(board.group)
				? board.group
				: current.corkboard.group,
		reversed:
			typeof board.reversed === 'boolean'
				? board.reversed
				: current.corkboard.reversed,
	};
	const timelineCandidate =
		typeof candidate.timeline === 'object' && candidate.timeline !== null
			? (candidate.timeline as Record<string, unknown>)
			: {};
	const pool =
		typeof timelineCandidate.pool === 'object' && timelineCandidate.pool !== null
			? (timelineCandidate.pool as Record<string, unknown>)
			: {};
	const timeline: TimelineSettings = {
		pool: {
			mode: isCorkboardMode(pool.mode) ? pool.mode : current.timeline.pool.mode,
			group:
				pool.group === '' || isCorkboardGroupField(pool.group)
					? pool.group
					: current.timeline.pool.group,
			reversed:
				typeof pool.reversed === 'boolean'
					? pool.reversed
					: current.timeline.pool.reversed,
		},
		poolCollapsed:
			typeof timelineCandidate.poolCollapsed === 'boolean'
				? timelineCandidate.poolCollapsed
				: current.timeline.poolCollapsed,
		timeCollapsed:
			typeof timelineCandidate.timeCollapsed === 'boolean'
				? timelineCandidate.timeCollapsed
				: current.timeline.timeCollapsed,
	};
	const state = { projectPath, visualization, corkboard, timeline };
	return {
		state,
		changed:
			state.projectPath !== current.projectPath ||
			state.visualization !== current.visualization ||
			state.corkboard.mode !== current.corkboard.mode ||
			state.corkboard.group !== current.corkboard.group ||
			state.corkboard.reversed !== current.corkboard.reversed ||
			state.timeline.pool.mode !== current.timeline.pool.mode ||
			state.timeline.pool.group !== current.timeline.pool.group ||
			state.timeline.pool.reversed !== current.timeline.pool.reversed ||
			state.timeline.poolCollapsed !== current.timeline.poolCollapsed ||
			state.timeline.timeCollapsed !== current.timeline.timeCollapsed,
	};
}

/**
 * What outlives a mount of the board: the settings the view persists, and
 * the search, the funnel's answers and the scroll, which last the session.
 */
export interface CorkboardMemory extends CorkboardSettings {
	query: string;
	filters: SceneFilters;
	scrollTop: number;
}

export function corkboardMemory(settings?: CorkboardSettings): CorkboardMemory {
	return {
		...(settings ?? defaultStoryStructureState().corkboard),
		query: '',
		filters: sceneFilters(),
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
		poolCollapsed: held.poolCollapsed,
		timeCollapsed: held.timeCollapsed,
		scroll: { left: 0, top: 0 },
	};
}
