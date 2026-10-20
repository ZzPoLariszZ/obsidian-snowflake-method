/**
 * The entity graph: a project's characters, scenes and worldbuilding notes
 * as nodes, and every relationship record line as a line between the note
 * that holds it and the note it points at. Nothing here is stored; the graph
 * is built afresh from the members each time they are read, so it can never
 * disagree with the notes.
 *
 * A relationship line reads `[[…/Family/Family|Family]]: text -> [[Bob]]`:
 * the label is a vocabulary note, the value is the holder's own words, and
 * each `->` clause is one target. The vocabulary note is never a node; its
 * leaf is the word written on the line. A target that leads to no member is
 * a node of its own, faint and named by the link, so a broken link shows
 * where it matters.
 */

import { foldName } from './names';
import type { RecordLine } from '../templates';

export type GraphMemberGroup = 'character' | 'scene' | 'worldbuilding';

/** As much of a member as the graph reads. */
export interface GraphMember {
	readonly id: string;
	readonly group: GraphMemberGroup;
	/** `character`, `scene` or a worldbuilding kind id. */
	readonly kind: string;
	readonly name: string;
	readonly aliases: readonly string[];
	/** The note's vault path. */
	readonly path: string;
	readonly relationships: readonly RecordLine[];
}

/** Where a relationship's link leads from the note that holds it: the note's vault path, or null. */
export type ResolveGraphTarget = (link: string, sourcePath: string) => string | null;

export const UNRESOLVED_GROUP = 'unresolved';
export const UNRESOLVED_NODE_PREFIX = 'unresolved:';

export interface GraphNode {
	readonly id: string;
	readonly group: GraphMemberGroup | typeof UNRESOLVED_GROUP;
	/** The member's kind, or `unresolved`. */
	readonly kind: string;
	readonly name: string;
	readonly aliases: readonly string[];
	/** The note's vault path; null for a target that leads nowhere. */
	readonly path: string | null;
	/** How many lines touch the node, which sizes its disc. */
	readonly weight: number;
}

export interface GraphEdge {
	readonly id: string;
	readonly source: string;
	readonly target: string;
	/** The relationship word: the taxonomy path's leaf. */
	readonly label: string;
	/** The taxonomy path, which tells two leaves of one name apart. */
	readonly labelPath: string;
	/** The record's own text. */
	readonly text: string;
	/** The line's index among the holder's relationships, which finds its card in the form. */
	readonly record: number;
	/**
	 * Where the line runs among the lines between its two nodes: 0 alone,
	 * else spread either side of the straight line, in the frame of the pair
	 * with the lower id first.
	 */
	readonly lane: number;
}

export interface EntityGraph {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	/** Every relationship taxonomy path on a line, in first-seen order. */
	readonly labels: readonly string[];
}

export const EMPTY_ENTITY_GRAPH: EntityGraph = { nodes: [], edges: [], labels: [] };

/** The word on a line: the last segment of its taxonomy path. */
export function labelLeaf(labelPath: string): string {
	const parts = labelPath.split('/').filter((part) => part.trim().length > 0);
	return parts.length === 0 ? labelPath.trim() : parts[parts.length - 1]!.trim();
}

/** The two ends of an edge in one order, whichever way the line runs. */
export function pairKey(a: string, b: string): string {
	return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

interface MutableNode {
	id: string;
	group: GraphMemberGroup | typeof UNRESOLVED_GROUP;
	kind: string;
	name: string;
	aliases: readonly string[];
	path: string | null;
	weight: number;
}

export function buildEntityGraph(
	members: readonly GraphMember[],
	resolve: ResolveGraphTarget,
): EntityGraph {
	const byPath = new Map<string, GraphMember>();
	const nodes = new Map<string, MutableNode>();
	for (const member of members) {
		byPath.set(member.path, member);
		nodes.set(member.id, {
			id: member.id,
			group: member.group,
			kind: member.kind,
			name: member.name,
			aliases: member.aliases,
			path: member.path,
			weight: 0,
		});
	}
	const unresolved = (key: string, name: string): string => {
		const id = `${UNRESOLVED_NODE_PREFIX}${key}`;
		if (!nodes.has(id)) {
			nodes.set(id, { id, group: UNRESOLVED_GROUP, kind: UNRESOLVED_GROUP, name, aliases: [], path: null, weight: 0 });
		}
		return id;
	};
	const edges: { edge: GraphEdge; lane: number }[] = [];
	const ids = new Set<string>();
	const labels: string[] = [];
	const pairs = new Map<string, number[]>();
	for (const member of members) {
		member.relationships.forEach((line, record) => {
			const labelPath = line.label.display.trim().length > 0 ? line.label.display.trim() : labelLeaf(line.label.path);
			for (const clause of line.clauses) {
				if (clause.kind !== 'target') continue;
				const term = clause.term;
				let targetId: string;
				if (term.kind === 'link') {
					const path = resolve(term.path, member.path);
					const found = path === null ? undefined : byPath.get(path);
					targetId = found?.id ?? unresolved(term.path, term.name.trim().length > 0 ? term.name : term.path);
				} else {
					const text = term.text.trim();
					if (text.length === 0) continue;
					targetId = unresolved(text, text);
				}
				// A line to oneself has no second end to draw to.
				if (targetId === member.id) continue;
				if (!labels.includes(labelPath)) labels.push(labelPath);
				let id = `${member.id}|${record}|${targetId}|${labelPath}`;
				for (let n = 2; ids.has(id); n += 1) id = `${member.id}|${record}|${targetId}|${labelPath}|${n}`;
				ids.add(id);
				const edge: GraphEdge = {
					id,
					source: member.id,
					target: targetId,
					label: labelLeaf(labelPath),
					labelPath,
					text: line.value,
					record,
					lane: 0,
				};
				const at = edges.push({ edge, lane: 0 }) - 1;
				const key = pairKey(member.id, targetId);
				pairs.set(key, [...(pairs.get(key) ?? []), at]);
				nodes.get(member.id)!.weight += 1;
				nodes.get(targetId)!.weight += 1;
			}
		});
	}
	for (const group of pairs.values()) {
		if (group.length < 2) continue;
		group.forEach((at, index) => {
			edges[at]!.lane = index - (group.length - 1) / 2;
		});
	}
	return {
		nodes: [...nodes.values()],
		edges: edges.map(({ edge, lane }) => (lane === 0 ? edge : { ...edge, lane })),
		labels,
	};
}

// --- the query grammar ------------------------------------------------------------

/**
 * The small grammar the Filters search and the colour groups share, in the
 * native graph's spirit: words match a node's name or aliases, `kind:` its
 * kind, `path:` its note's path, `relationship:` a word on one of its lines;
 * `"a phrase"`, `-` for not, `OR`, and parentheses. An operator the grammar
 * does not know matches nothing, so a typo shows as an empty picture rather
 * than as everything.
 */
type QueryNode =
	| { type: 'word'; text: string }
	| { type: 'field'; field: string; text: string }
	| { type: 'not'; inner: QueryNode }
	| { type: 'and'; parts: QueryNode[] }
	| { type: 'or'; parts: QueryNode[] };

type Token =
	| { type: 'open' }
	| { type: 'close' }
	| { type: 'or' }
	| { type: 'not' }
	| { type: 'term'; field: string | null; text: string };

const FIELD_PATTERN = /^([a-z]+):/i;

function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let at = 0;
	const readQuoted = (): string => {
		// `at` stands on the opening quote.
		let end = text.indexOf('"', at + 1);
		if (end < 0) end = text.length;
		const quoted = text.slice(at + 1, end);
		at = Math.min(text.length, end + 1);
		return quoted;
	};
	const readBare = (): string => {
		const start = at;
		while (at < text.length && !/[\s()]/.test(text[at]!)) at += 1;
		return text.slice(start, at);
	};
	while (at < text.length) {
		const char = text[at]!;
		if (/\s/.test(char)) {
			at += 1;
		} else if (char === '(') {
			tokens.push({ type: 'open' });
			at += 1;
		} else if (char === ')') {
			tokens.push({ type: 'close' });
			at += 1;
		} else if (char === '-' && (at + 1 >= text.length || /[\s)]/.test(text[at + 1]!))) {
			// A minus with nothing to negate is no operator at all.
			at += 1;
		} else if (char === '-') {
			tokens.push({ type: 'not' });
			at += 1;
		} else if (char === '"') {
			tokens.push({ type: 'term', field: null, text: readQuoted() });
		} else {
			const rest = text.slice(at);
			const field = FIELD_PATTERN.exec(rest);
			if (field !== null) {
				at += field[0].length;
				const value = text[at] === '"' ? readQuoted() : readBare();
				tokens.push({ type: 'term', field: field[1]!.toLowerCase(), text: value });
			} else {
				const word = readBare();
				if (word.toUpperCase() === 'OR') tokens.push({ type: 'or' });
				else tokens.push({ type: 'term', field: null, text: word });
			}
		}
	}
	return tokens;
}

function parse(tokens: Token[]): QueryNode | null {
	let at = 0;
	const peek = (): Token | undefined => tokens[at];
	const parseUnary = (): QueryNode | null => {
		const token = peek();
		if (token === undefined) return null;
		if (token.type === 'not') {
			at += 1;
			const inner = parseUnary();
			return inner === null ? null : { type: 'not', inner };
		}
		if (token.type === 'open') {
			at += 1;
			const inner = parseOr();
			if (peek()?.type === 'close') at += 1;
			return inner;
		}
		if (token.type === 'term') {
			at += 1;
			if (token.text.length === 0) return null;
			return token.field === null
				? { type: 'word', text: token.text }
				: { type: 'field', field: token.field, text: token.text };
		}
		return null;
	};
	const parseAnd = (): QueryNode | null => {
		const parts: QueryNode[] = [];
		while (at < tokens.length) {
			const token = peek()!;
			if (token.type === 'or' || token.type === 'close') break;
			const before = at;
			const part = parseUnary();
			if (part !== null) parts.push(part);
			// A token the grammar had nothing to make of is stepped over.
			if (at === before) at += 1;
		}
		return parts.length === 0 ? null : parts.length === 1 ? parts[0]! : { type: 'and', parts };
	};
	const parseOr = (): QueryNode | null => {
		const parts: QueryNode[] = [];
		const first = parseAnd();
		if (first !== null) parts.push(first);
		while (peek()?.type === 'or') {
			at += 1;
			const next = parseAnd();
			if (next !== null) parts.push(next);
		}
		return parts.length === 0 ? null : parts.length === 1 ? parts[0]! : { type: 'or', parts };
	};
	const first = parseOr();
	const parts: QueryNode[] = first === null ? [] : [first];
	// A stray closing parenthesis ends a group that was never opened; what
	// follows still counts, however many there are.
	while (at < tokens.length) {
		if (peek()?.type === 'close') {
			at += 1;
			continue;
		}
		const more = parseOr();
		if (more === null) break;
		parts.push(more);
	}
	return parts.length === 0 ? null : parts.length === 1 ? parts[0]! : { type: 'and', parts };
}

const fold = (text: string): string => foldName(text).toLowerCase();

/** What each node offers the grammar, folded once per graph. */
interface NodeIndex {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly kind: string;
	readonly path: string;
	/** Every relationship word and taxonomy path on a line the node holds or receives. */
	readonly relationships: readonly string[];
}

function indexGraph(graph: EntityGraph): Map<string, NodeIndex> {
	const relationships = new Map<string, Set<string>>();
	for (const edge of graph.edges) {
		for (const end of [edge.source, edge.target]) {
			const set = relationships.get(end) ?? new Set<string>();
			set.add(fold(edge.label));
			set.add(fold(edge.labelPath));
			relationships.set(end, set);
		}
	}
	const index = new Map<string, NodeIndex>();
	for (const node of graph.nodes) {
		index.set(node.id, {
			name: fold(node.name),
			aliases: node.aliases.map(fold),
			kind: fold(node.kind),
			path: fold(node.path ?? ''),
			relationships: [...(relationships.get(node.id) ?? [])],
		});
	}
	return index;
}

function evaluate(query: QueryNode, entry: NodeIndex): boolean {
	switch (query.type) {
		case 'word': {
			const text = fold(query.text);
			return entry.name.includes(text) || entry.aliases.some((alias) => alias.includes(text));
		}
		case 'field': {
			const text = fold(query.text);
			if (query.field === 'kind') return entry.kind === text;
			if (query.field === 'path') return entry.path.includes(text);
			if (query.field === 'relationship') return entry.relationships.some((word) => word.includes(text));
			return false;
		}
		case 'not':
			return !evaluate(query.inner, entry);
		case 'and':
			return query.parts.every((part) => evaluate(part, entry));
		case 'or':
			return query.parts.some((part) => evaluate(part, entry));
	}
}

/**
 * The nodes a query answers, as a set of ids; null for a query with no
 * terms, which is no query at all. A graph is indexed once per call, so a
 * caller with several queries over one graph should ask for its index first
 * and use `matchIndexedQuery`.
 */
export function matchGraphQuery(text: string, graph: EntityGraph): ReadonlySet<string> | null {
	return matchIndexedQuery(text, indexGraph(graph));
}

export type GraphQueryIndex = ReadonlyMap<string, NodeIndex>;

export function indexGraphForQueries(graph: EntityGraph): GraphQueryIndex {
	return indexGraph(graph);
}

export function matchIndexedQuery(text: string, index: GraphQueryIndex): ReadonlySet<string> | null {
	const query = parse(tokenize(text));
	if (query === null) return null;
	const matches = new Set<string>();
	for (const [id, entry] of index) {
		if (evaluate(query, entry)) matches.add(id);
	}
	return matches;
}

// --- the local graph ------------------------------------------------------------

export interface LocalGraphReach {
	/** Hops from the focused node. */
	readonly depth: number;
	readonly incoming: boolean;
	readonly outgoing: boolean;
	/** Whether lines between two reached nodes are shown too, beyond the ones walked. */
	readonly neighbours: boolean;
}

export interface LocalGraph {
	readonly nodes: ReadonlySet<string>;
	readonly edges: ReadonlySet<string>;
}

/**
 * The nodes within reach of one, walking lines outward, inward or both, and
 * the lines walked; with `neighbours`, every line between two reached nodes.
 * A focus the graph does not hold reaches nothing.
 */
export function localGraph(
	graph: Pick<EntityGraph, 'nodes' | 'edges'>,
	focus: string,
	reach: LocalGraphReach,
): LocalGraph {
	const nodes = new Set<string>();
	const edges = new Set<string>();
	if (!graph.nodes.some((node) => node.id === focus)) return { nodes, edges };
	const outgoing = new Map<string, GraphEdge[]>();
	const incoming = new Map<string, GraphEdge[]>();
	for (const edge of graph.edges) {
		outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
		incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
	}
	nodes.add(focus);
	let frontier = [focus];
	for (let hop = 0; hop < reach.depth && frontier.length > 0; hop += 1) {
		const next: string[] = [];
		for (const id of frontier) {
			const walked = [
				...(reach.outgoing ? (outgoing.get(id) ?? []) : []),
				...(reach.incoming ? (incoming.get(id) ?? []) : []),
			];
			for (const edge of walked) {
				edges.add(edge.id);
				const other = edge.source === id ? edge.target : edge.source;
				if (!nodes.has(other)) {
					nodes.add(other);
					next.push(other);
				}
			}
		}
		frontier = next;
	}
	if (reach.neighbours) {
		for (const edge of graph.edges) {
			if (nodes.has(edge.source) && nodes.has(edge.target)) edges.add(edge.id);
		}
	}
	return { nodes, edges };
}
