/**
 * The picture the entity view draws: the graph as the filters, the focus
 * and the colour groups leave it, with the nodes the search found marked
 * on it. The search takes nothing away: a relationship is a line between
 * two nodes, so a picture narrowed to a name would show a lone disc, and
 * the search lights what it finds instead and dims the rest, as the other
 * workspaces' searches do. Pure, so the shell can work it out on every
 * change and hand the engine what to draw; the engine keeps positions by
 * node id, so a picture that drops a node and later brings it back finds
 * it where it stood.
 *
 * With the timeline open the picture is of one time: the dated lines that
 * do not stand at it are left out before the focus and the orphans are
 * read, so a node with no line standing goes with the Orphans toggle as any
 * other does, and the lines left are laned among themselves. Where the
 * undated lines are held back to the axis's end, the nodes no dated line
 * touches are held back with them, each until a line of its own is drawn.
 * What does not
 * change with the time, the kinds and words shown, the search and the
 * groups' matches, is worked out once as the picture's base, and each time
 * drawn from it.
 */

import {
	assignLanes,
	defaultGraphColorName,
	indexGraphForQueries,
	localGraph,
	matchIndexedQuery,
	UNRESOLVED_GROUP,
	type EntityGraph,
	type EntityGraphState,
	type GraphEdge,
	type GraphNode,
	type GraphQueryIndex,
} from '../domain';

/** How a node is coloured: a theme accent by name, a group's own colour, the plain node colour or the faint unresolved one. */
export type NodeColor =
	| { readonly by: 'accent'; readonly name: string }
	| { readonly by: 'hex'; readonly hex: string }
	| { readonly by: 'plain' }
	| { readonly by: 'unresolved' };

export interface GraphPicture {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly colors: ReadonlyMap<string, NodeColor>;
	/** The node ids the search answers across the whole graph, hidden ones among them, or null with no search. */
	readonly matches: ReadonlySet<string> | null;
	/** Whether a focus narrowed the picture to a local graph. */
	readonly local: boolean;
	/** How many nodes and lines the filters and the focus left out. */
	readonly hidden: { readonly nodes: number; readonly edges: number };
}

export interface PictureInputs {
	readonly graph: EntityGraph;
	readonly state: EntityGraphState;
	/** The toolbar's words, which mark the picture and never narrow it. */
	readonly search: string;
	/** The node a local graph is drawn around, or null for the whole graph. */
	readonly focus: string | null;
	/** The project's custom worldbuilding kind ids in order, which the default colours cycle through. */
	readonly customKinds: readonly string[];
	/** The grammar's index of the graph, to keep across pictures of one graph. */
	readonly index?: GraphQueryIndex;
	/** The dated lines that do not stand at the time the timeline is on, by edge id; null or absent for the whole graph. */
	readonly hidden?: ReadonlySet<string> | null;
	/** The nodes held back until a line left in the picture reaches them; null or absent where none is. */
	readonly held?: ReadonlySet<string> | null;
}

/**
 * What a picture is drawn from whatever the time: the nodes the kinds
 * leave, the lines among them the words leave, what the search found and
 * what each colour group matches. The lines here are the ones a timeline
 * counts its changes over, since a line the filters put away changes
 * nothing anyone sees.
 */
export interface PictureBase {
	readonly graph: EntityGraph;
	readonly state: EntityGraphState;
	readonly customKinds: readonly string[];
	readonly shown: ReadonlySet<string>;
	readonly edges: readonly GraphEdge[];
	readonly matches: ReadonlySet<string> | null;
	/** What each colour group matches, in the groups' order; empty under the default colours. */
	readonly groupMatches: readonly (ReadonlySet<string> | null)[];
}

export const EMPTY_PICTURE: GraphPicture = {
	nodes: [],
	edges: [],
	colors: new Map(),
	matches: null,
	local: false,
	hidden: { nodes: 0, edges: 0 },
};

export function pictureBase(inputs: Omit<PictureInputs, 'focus' | 'hidden' | 'held'>): PictureBase {
	const { graph, state, customKinds } = inputs;
	const index = inputs.index ?? indexGraphForQueries(graph);
	const kindsOff = new Set(state.filters.kindsOff);
	const labelsOff = new Set(state.filters.labelsOff);
	const shown = new Set<string>();
	for (const node of graph.nodes) {
		if (node.group === UNRESOLVED_GROUP ? !state.filters.unresolved : kindsOff.has(node.kind)) continue;
		shown.add(node.id);
	}
	return {
		graph,
		state,
		customKinds,
		shown,
		edges: graph.edges.filter(
			(edge) => shown.has(edge.source) && shown.has(edge.target) && !labelsOff.has(edge.labelPath),
		),
		matches: matchIndexedQuery(inputs.search, index),
		groupMatches: state.groups === null ? [] : state.groups.map((group) => matchIndexedQuery(group.query, index)),
	};
}

export function pictureOf(inputs: PictureInputs): GraphPicture {
	return pictureFrom(pictureBase(inputs), inputs.focus, inputs.hidden ?? null, inputs.held ?? null);
}

/**
 * The picture of a base about a focus, at the time whose missing lines are
 * given, or at none. The nodes held back are left out until a line of the
 * picture reaches them, whatever the Orphans toggle says of a node with no
 * line: they are not there yet, where an orphan is.
 */
export function pictureFrom(
	base: PictureBase,
	focus: string | null,
	hidden: ReadonlySet<string> | null = null,
	held: ReadonlySet<string> | null = null,
): GraphPicture {
	const { graph, state, customKinds, matches, groupMatches } = base;
	let shown: ReadonlySet<string> = base.shown;
	let edges = hidden === null ? base.edges : base.edges.filter((edge) => !hidden.has(edge.id));
	if (held !== null && held.size > 0) {
		const reached = new Set<string>();
		for (const edge of edges) {
			reached.add(edge.source);
			reached.add(edge.target);
		}
		// The node a local graph is drawn about is the picture's reason, and stands whatever is held back.
		shown = new Set([...shown].filter((id) => !held.has(id) || reached.has(id) || id === focus));
	}

	let local = false;
	if (focus !== null && shown.has(focus)) {
		const within = shown;
		const reach = localGraph({ nodes: graph.nodes.filter((node) => within.has(node.id)), edges }, focus, state.local);
		shown = new Set(reach.nodes);
		edges = edges.filter((edge) => reach.edges.has(edge.id));
		local = true;
	}
	if (!state.filters.orphans) {
		const linked = new Set<string>();
		for (const edge of edges) {
			linked.add(edge.source);
			linked.add(edge.target);
		}
		// The node a local graph is drawn about is the picture's reason: it
		// stands at a time when none of its lines do.
		const kept = local ? focus : null;
		shown = new Set([...shown].filter((id) => linked.has(id) || id === kept));
	}
	const nodes = graph.nodes.filter((node) => shown.has(node.id));
	// At a time, the lines left are laned among themselves: one left alone between its two nodes runs straight.
	if (hidden !== null) edges = assignLanes(edges);

	const colors = new Map<string, NodeColor>();
	for (const node of nodes) {
		if (node.group === UNRESOLVED_GROUP) {
			colors.set(node.id, { by: 'unresolved' });
			continue;
		}
		if (state.groups === null) {
			colors.set(node.id, { by: 'accent', name: defaultGraphColorName(node.kind, customKinds) });
			continue;
		}
		const at = groupMatches.findIndex((match) => match !== null && match.has(node.id));
		colors.set(node.id, at < 0 ? { by: 'plain' } : { by: 'hex', hex: state.groups[at]!.color });
	}
	return {
		nodes,
		edges,
		colors,
		matches,
		local,
		hidden: { nodes: graph.nodes.length - nodes.length, edges: graph.edges.length - edges.length },
	};
}

export interface GraphHighlight {
	readonly nodes: ReadonlySet<string>;
	readonly edges: ReadonlySet<string>;
}

/** The node under the pointer, its neighbours and the lines between them; null with nothing under the pointer. */
export function highlightOf(picture: Pick<GraphPicture, 'edges'>, hovered: string | null): GraphHighlight | null {
	if (hovered === null) return null;
	const nodes = new Set<string>([hovered]);
	const edges = new Set<string>();
	for (const edge of picture.edges) {
		if (edge.source !== hovered && edge.target !== hovered) continue;
		edges.add(edge.id);
		nodes.add(edge.source);
		nodes.add(edge.target);
	}
	return { nodes, edges };
}

/** The line under the pointer and its two ends. */
export function edgeHighlight(edge: GraphEdge): GraphHighlight {
	return { nodes: new Set([edge.source, edge.target]), edges: new Set([edge.id]) };
}

/**
 * The nodes the search found, each with its lines and the nodes at their
 * other ends, so a name found shows whom it is tied to; null with no
 * search. A search that finds none of the shown nodes lights nothing, and
 * the whole picture dims to say so.
 */
export function matchHighlight(picture: Pick<GraphPicture, 'nodes' | 'edges' | 'matches'>): GraphHighlight | null {
	const { matches } = picture;
	if (matches === null) return null;
	const nodes = new Set<string>();
	for (const node of picture.nodes) if (matches.has(node.id)) nodes.add(node.id);
	const edges = new Set<string>();
	for (const edge of picture.edges) {
		if (!matches.has(edge.source) && !matches.has(edge.target)) continue;
		edges.add(edge.id);
		nodes.add(edge.source);
		nodes.add(edge.target);
	}
	return { nodes, edges };
}

/** The shown nodes in the order Tab walks them: by name, then by id so two of one name keep an order. */
export function tabOrder(nodes: readonly GraphNode[]): GraphNode[] {
	return [...nodes].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
