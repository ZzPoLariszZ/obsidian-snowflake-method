/**
 * What the relationship graph's entity view keeps between sessions, and the
 * pure rules it keeps it by: which kinds and relationship words are shown,
 * how the nodes are coloured, how the picture is drawn, how hard the forces
 * pull, how far a local graph reaches, and where the view was left. Node
 * positions are not kept: the layout settles afresh each time, as it does in
 * Obsidian's own graph. The shape mirrors the native graph's options so the
 * controls read alike, and every reader here is lenient, so a file written
 * by hand or by another build still opens.
 */

/** How a line is captioned: by the relationship word, the record's own text, both or neither. */
export const GRAPH_LABEL_MODES = ['none', 'relationship', 'text', 'both'] as const;
export type GraphLabelMode = (typeof GRAPH_LABEL_MODES)[number];

export function isGraphLabelMode(value: unknown): value is GraphLabelMode {
	return (GRAPH_LABEL_MODES as readonly unknown[]).includes(value);
}

export interface EntityGraphFilters {
	/** Node kinds hidden: `character`, `scene`, or a worldbuilding kind id. Scenes start hidden. */
	readonly kindsOff: readonly string[];
	/** Relationship words whose lines are hidden. */
	readonly labelsOff: readonly string[];
	/** Whether a target that resolves to no note is drawn as a faint node of its own. */
	readonly unresolved: boolean;
	/** Whether a node with no line is drawn at all. */
	readonly orphans: boolean;
}

/** One colour group: the nodes a query matches take the colour, the first matching group winning. */
export interface EntityGraphGroup {
	readonly query: string;
	/** A CSS colour as the colour picker gives it, `#rrggbb`. */
	readonly color: string;
}

export interface EntityGraphDisplay {
	readonly arrows: boolean;
	readonly labels: GraphLabelMode;
	/** The native graph's text fade threshold, -3 to 3. */
	readonly textFade: number;
	/** Multipliers over the native node radius and line width. */
	readonly nodeSize: number;
	readonly lineSize: number;
}

/** Slider positions, in the native graph's own ranges, not the strengths they map to. */
export interface EntityGraphForces {
	/** 0 to 1. */
	readonly center: number;
	/** 0 to 20. */
	readonly repel: number;
	/** 0 to 1. */
	readonly link: number;
	/** 30 to 500, in world units. */
	readonly linkDistance: number;
}

export interface EntityGraphLocal {
	/** Hops from the focused node, 1 to 5. */
	readonly depth: number;
	readonly incoming: boolean;
	readonly outgoing: boolean;
	/** Whether lines between two reached nodes are shown too. */
	readonly neighbours: boolean;
}

/** Where the view stands, in the native graph's units: a world unit is one device pixel at zoom 1. */
export interface GraphViewport {
	readonly x: number;
	readonly y: number;
	/** The zoom. */
	readonly k: number;
}

export interface EntityGraphState {
	readonly filters: EntityGraphFilters;
	/** Null means the per-kind default colours. */
	readonly groups: readonly EntityGraphGroup[] | null;
	readonly display: EntityGraphDisplay;
	readonly forces: EntityGraphForces;
	readonly local: EntityGraphLocal;
	/** Where the view was left, or null for a view not yet moved, which fits the graph to the screen. */
	readonly viewport: GraphViewport | null;
}

// --- the native graph's ranges and defaults ----------------------------------

export const GRAPH_TEXT_FADE_RANGE = { min: -3, max: 3, step: 0.1 } as const;
export const GRAPH_NODE_SIZE_RANGE = { min: 0.1, max: 5, step: 0.1 } as const;
export const GRAPH_LINE_SIZE_RANGE = { min: 0.1, max: 5, step: 0.1 } as const;
export const GRAPH_CENTER_RANGE = { min: 0, max: 1, step: 0.01 } as const;
export const GRAPH_REPEL_RANGE = { min: 0, max: 20, step: 0.01 } as const;
export const GRAPH_LINK_RANGE = { min: 0, max: 1, step: 0.01 } as const;
export const GRAPH_LINK_DISTANCE_RANGE = { min: 30, max: 500, step: 1 } as const;
export const GRAPH_LOCAL_DEPTH_RANGE = { min: 1, max: 5, step: 1 } as const;

/**
 * The native graph's slider for a force strength: Obsidian keeps strengths
 * on a log scale so the slider's middle is a useful force, not a tenth of
 * the maximum. `forceSlider` is where a strength sits on the slider and
 * `sliderForce` the strength a slider position asks for; each undoes the
 * other over (0, 1].
 */
export function forceSlider(strength: number): number {
	return 1 - Math.log(strength * 0.99 + 0.01) / Math.log(0.01);
}

export function sliderForce(position: number): number {
	return (Math.pow(0.01, 1 - position) - 0.01) / 0.99;
}

/** The repel slider is cubed before it is a strength, so its low end is fine-grained. */
export function repelStrength(position: number): number {
	return position * position * position;
}

/** The native defaults: centre force 0.1, repel 10, link 1 and distance 250, as slider positions. */
export const DEFAULT_GRAPH_FORCES: EntityGraphForces = {
	center: forceSlider(0.1),
	repel: 10,
	link: forceSlider(1),
	linkDistance: 250,
};

export function defaultEntityGraphState(): EntityGraphState {
	return {
		filters: { kindsOff: ['scene'], labelsOff: [], unresolved: true, orphans: true },
		groups: null,
		display: { arrows: true, labels: 'relationship', textFade: 0, nodeSize: 1, lineSize: 1 },
		forces: DEFAULT_GRAPH_FORCES,
		local: { depth: 1, incoming: true, outgoing: true, neighbours: false },
		viewport: null,
	};
}

// --- default colours -----------------------------------------------------------

/** The accent names of Obsidian's `--color-<name>-rgb` variables the default groups draw with. */
export const GRAPH_DEFAULT_COLOR_NAMES = {
	character: 'purple',
	scene: 'orange',
	time: 'cyan',
	location: 'green',
	item: 'yellow',
} as const;

/** The names custom kinds cycle through, in the project's kind order. */
export const GRAPH_CUSTOM_KIND_COLOR_NAMES = ['pink', 'blue', 'red'] as const;

/**
 * The accent name a node kind is coloured with by default: a built-in kind
 * has its own, a custom kind takes the next of three in turn, so two
 * projects with the same kinds colour them the same.
 */
export function defaultGraphColorName(kind: string, customKinds: readonly string[]): string {
	if (kind in GRAPH_DEFAULT_COLOR_NAMES) {
		return GRAPH_DEFAULT_COLOR_NAMES[kind as keyof typeof GRAPH_DEFAULT_COLOR_NAMES];
	}
	const at = customKinds.indexOf(kind);
	const index = at < 0 ? 0 : at % GRAPH_CUSTOM_KIND_COLOR_NAMES.length;
	return GRAPH_CUSTOM_KIND_COLOR_NAMES[index]!;
}

// --- reading stored shapes -----------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const boolOr = (value: unknown, fallback: boolean): boolean =>
	typeof value === 'boolean' ? value : fallback;

/** A finite number clamped into a range, or the fallback for anything else. */
const numberIn = (
	value: unknown,
	range: { readonly min: number; readonly max: number },
	fallback: number,
): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(range.max, Math.max(range.min, value));
};

/** The strings of a list, deduplicated and in order; anything else reads as the fallback. */
const stringList = (value: unknown, fallback: readonly string[]): readonly string[] => {
	if (!Array.isArray(value)) return fallback;
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry === 'string' && entry.length > 0) seen.add(entry);
	}
	return [...seen];
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const readGroups = (value: unknown): readonly EntityGraphGroup[] | null => {
	if (!Array.isArray(value)) return null;
	const groups: EntityGraphGroup[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		if (typeof entry.query !== 'string') continue;
		if (typeof entry.color !== 'string' || !HEX_COLOR.test(entry.color)) continue;
		groups.push({ query: entry.query, color: entry.color.toLowerCase() });
	}
	return groups;
};

const readViewport = (value: unknown): GraphViewport | null => {
	if (!isRecord(value)) return null;
	const { x, y, k } = value;
	if (typeof x !== 'number' || typeof y !== 'number' || typeof k !== 'number') return null;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(k) || k <= 0) return null;
	return { x, y, k };
};

/**
 * The stored state read leniently: every part that reads is kept, every
 * part that does not falls back to its default, and nothing throws. A
 * missing object is the default state whole.
 */
export function readEntityGraphState(value: unknown): EntityGraphState {
	const base = defaultEntityGraphState();
	if (!isRecord(value)) return base;
	const filters = isRecord(value.filters) ? value.filters : {};
	const display = isRecord(value.display) ? value.display : {};
	const forces = isRecord(value.forces) ? value.forces : {};
	const local = isRecord(value.local) ? value.local : {};
	return {
		filters: {
			kindsOff: stringList(filters.kindsOff, base.filters.kindsOff),
			labelsOff: stringList(filters.labelsOff, base.filters.labelsOff),
			unresolved: boolOr(filters.unresolved, base.filters.unresolved),
			orphans: boolOr(filters.orphans, base.filters.orphans),
		},
		groups: readGroups(value.groups),
		display: {
			arrows: boolOr(display.arrows, base.display.arrows),
			labels: isGraphLabelMode(display.labels) ? display.labels : base.display.labels,
			textFade: numberIn(display.textFade, GRAPH_TEXT_FADE_RANGE, base.display.textFade),
			nodeSize: numberIn(display.nodeSize, GRAPH_NODE_SIZE_RANGE, base.display.nodeSize),
			lineSize: numberIn(display.lineSize, GRAPH_LINE_SIZE_RANGE, base.display.lineSize),
		},
		forces: {
			center: numberIn(forces.center, GRAPH_CENTER_RANGE, base.forces.center),
			repel: numberIn(forces.repel, GRAPH_REPEL_RANGE, base.forces.repel),
			link: numberIn(forces.link, GRAPH_LINK_RANGE, base.forces.link),
			linkDistance: numberIn(
				forces.linkDistance,
				GRAPH_LINK_DISTANCE_RANGE,
				base.forces.linkDistance,
			),
		},
		local: {
			depth: Math.round(numberIn(local.depth, GRAPH_LOCAL_DEPTH_RANGE, base.local.depth)),
			incoming: boolOr(local.incoming, base.local.incoming),
			outgoing: boolOr(local.outgoing, base.local.outgoing),
			neighbours: boolOr(local.neighbours, base.local.neighbours),
		},
		viewport: readViewport(value.viewport),
	};
}

/** The state as it is written: the same shape, with nothing to translate. */
export function serializeEntityGraphState(state: EntityGraphState): Record<string, unknown> {
	return {
		filters: {
			kindsOff: [...state.filters.kindsOff],
			labelsOff: [...state.filters.labelsOff],
			unresolved: state.filters.unresolved,
			orphans: state.filters.orphans,
		},
		groups: state.groups === null ? null : state.groups.map((group) => ({ ...group })),
		display: { ...state.display },
		forces: { ...state.forces },
		local: { ...state.local },
		viewport: state.viewport === null ? null : { ...state.viewport },
	};
}

/**
 * A change laid over the state, one part at a time: a patch names whole
 * parts, so a caller that moves one slider hands in the forces entire, as
 * the controls hold them anyway.
 */
export function patchEntityGraphState(
	state: EntityGraphState,
	patch: Partial<EntityGraphState>,
): EntityGraphState {
	return {
		filters: patch.filters ?? state.filters,
		groups: patch.groups === undefined ? state.groups : patch.groups,
		display: patch.display ?? state.display,
		forces: patch.forces ?? state.forces,
		local: patch.local ?? state.local,
		viewport: patch.viewport === undefined ? state.viewport : patch.viewport,
	};
}

/** Whether two states say the same thing, so a write that changes nothing can be skipped. */
export function sameEntityGraphState(a: EntityGraphState, b: EntityGraphState): boolean {
	return JSON.stringify(serializeEntityGraphState(a)) === JSON.stringify(serializeEntityGraphState(b));
}
