/**
 * The relationship graph's timeline: the project's time notes as one axis,
 * a point each in the order the notes keep, and every relationship line
 * that names a time laid along it, so the graph can be drawn as it stands at
 * any one of them. Nothing here is stored; the timeline is built afresh
 * from the members and the time notes each time they are read.
 *
 * A line is dated by its `when` clauses, which belong to the whole line: a
 * line with two targets is two edges dated alike. A line with no time, or
 * whose time is plain words or a link to no time note, is undated. Where an
 * undated line stands is a rule of its own: at every point, as what was so
 * before the story's first time, or at the last alone, so the axis runs
 * through the dated lines and the rest comes in at its end. A note none of
 * whose lines is dated goes with its lines.
 *
 * A period whose two ends are both time notes is a stretch of the axis, and
 * a line dated by it stands from one end to the other, and on the period's
 * own point wherever the note is ranked. An older `from … to …` span is a
 * stretch the same way. A line dated by a point, or by a period without
 * both ends, says only when it began, and the rule says how long it lasts:
 * until the same note dates another line toward the same target at a later
 * time, or to the end of the axis.
 */

import type { RecordLine, RecordTerm } from '../templates';
import type { EntityGraph, GraphEdge, GraphMember, ResolveGraphTarget } from './relationship-graph';
import type { TimeKind } from './types';

/**
 * How long a line dated by a point stands. `latest` shows what each note
 * last said of each target: the line gives way to the next one the same
 * note dates toward the same target. `since` keeps every line from its time
 * on, so the picture only gains lines as the axis runs.
 */
export const GRAPH_TIME_RULES = ['latest', 'since'] as const;
export type GraphTimeRule = (typeof GRAPH_TIME_RULES)[number];
export const DEFAULT_GRAPH_TIME_RULE: GraphTimeRule = 'latest';

export function isGraphTimeRule(value: unknown): value is GraphTimeRule {
	return (GRAPH_TIME_RULES as readonly unknown[]).includes(value);
}

/**
 * Where the lines no time is said of stand along the axis, and with them
 * the notes none of whose lines is dated. `before` has them there before the
 * axis starts: every point shows them, and the dated lines come and go over
 * them. `after` holds them back until the axis ends: the points before the
 * last show the dated lines and their notes alone, and the rest stands on
 * the last.
 */
export const GRAPH_UNDATED_RULES = ['before', 'after'] as const;
export type GraphUndatedRule = (typeof GRAPH_UNDATED_RULES)[number];
export const DEFAULT_GRAPH_UNDATED_RULE: GraphUndatedRule = 'before';

export function isGraphUndatedRule(value: unknown): value is GraphUndatedRule {
	return (GRAPH_UNDATED_RULES as readonly unknown[]).includes(value);
}

/** A time note as the timeline reads it. */
export interface GraphTime {
	readonly id: string;
	readonly name: string;
	/** The note's vault path, which a line's `when` link leads to. */
	readonly path: string;
	readonly kind: TimeKind;
	/** A period's two ends as time ids, each null where it names no time note. */
	readonly start: string | null;
	readonly end: string | null;
}

/** A stretch of the axis, both ends counted. */
export interface TimeSpan {
	readonly from: number;
	readonly to: number;
}

export interface GraphTimeline {
	/** The axis: every time note, a point each, in the order given. */
	readonly times: readonly GraphTime[];
	/** The stretches each dated line stands over, in order and apart, by edge id. A line not here is undated. */
	readonly spans: ReadonlyMap<string, readonly TimeSpan[]>;
}

export const EMPTY_GRAPH_TIMELINE: GraphTimeline = { times: [], spans: new Map() };

export interface GraphTimelineInputs {
	readonly members: readonly GraphMember[];
	readonly graph: EntityGraph;
	/** The time notes in the order the axis runs. */
	readonly times: readonly GraphTime[];
	readonly resolve: ResolveGraphTarget;
	readonly rule: GraphTimeRule;
}

const stem = (path: string): string => path.trim().replace(/\.md$/u, '');

/**
 * What a line says of time: the points it began at, the stretches it is
 * held to, and the points it is shown at besides, a period's own, which
 * begin nothing and so end no other line.
 */
interface LineMarks {
	points: number[];
	spans: TimeSpan[];
	own: number[];
}

/** Stretches in order, the ones that touch or overlap made one. */
function mergeSpans(spans: readonly TimeSpan[]): TimeSpan[] {
	const ordered = [...spans].sort((a, b) => a.from - b.from || a.to - b.to);
	const merged: { from: number; to: number }[] = [];
	for (const span of ordered) {
		const standing = merged[merged.length - 1];
		if (standing !== undefined && span.from <= standing.to + 1) {
			standing.to = Math.max(standing.to, span.to);
			continue;
		}
		merged.push({ from: span.from, to: span.to });
	}
	return merged;
}

export function buildGraphTimeline(inputs: GraphTimelineInputs): GraphTimeline {
	const { members, graph, times, resolve, rule } = inputs;
	if (times.length === 0) return { times, spans: new Map() };
	const last = times.length - 1;
	const byId = new Map<string, number>();
	const byPath = new Map<string, number>();
	times.forEach((time, at) => {
		byId.set(time.id, at);
		byPath.set(stem(time.path), at);
	});

	/**
	 * The point a term names: a link that leads to a time note. A link
	 * written as the note's own path is found at once; any other is asked of
	 * the vault, which is the slower way.
	 */
	const pointOf = (term: RecordTerm, sourcePath: string): number | null => {
		if (term.kind !== 'link') return null;
		const direct = byPath.get(stem(term.path));
		if (direct !== undefined) return direct;
		const path = resolve(term.path, sourcePath);
		return path === null ? null : (byPath.get(stem(path)) ?? null);
	};
	/** The stretch a period covers, both its ends being time notes; null for a point, or a period that says less. */
	const stretchOf = (at: number): TimeSpan | null => {
		const time = times[at];
		if (time === undefined || time.kind !== 'period' || time.start === null || time.end === null) return null;
		const start = byId.get(time.start);
		const end = byId.get(time.end);
		if (start === undefined || end === undefined) return null;
		return { from: Math.min(start, end), to: Math.max(start, end) };
	};
	const marksOf = (line: RecordLine, sourcePath: string): LineMarks | null => {
		const marks: LineMarks = { points: [], spans: [], own: [] };
		for (const clause of line.clauses) {
			if (clause.kind === 'span') {
				const start = pointOf(clause.start, sourcePath);
				const end = pointOf(clause.end, sourcePath);
				if (start !== null && end !== null) {
					marks.spans.push({ from: Math.min(start, end), to: Math.max(start, end) });
				} else if (start !== null) {
					marks.points.push(start);
				} else if (end !== null) {
					marks.points.push(end);
				}
				continue;
			}
			if (clause.kind !== 'when') continue;
			const at = pointOf(clause.term, sourcePath);
			if (at === null) continue;
			const stretch = stretchOf(at);
			if (stretch === null) {
				marks.points.push(at);
				continue;
			}
			marks.spans.push(stretch);
			// The period's own point, wherever the note is ranked: standing on it shows what it dates.
			if (at < stretch.from || at > stretch.to) marks.own.push(at);
		}
		return marks.points.length === 0 && marks.spans.length === 0 ? null : marks;
	};

	const lineKey = (holder: string, record: number): string => `${holder}\n${String(record)}`;
	const edgesOfLine = new Map<string, GraphEdge[]>();
	for (const edge of graph.edges) {
		const key = lineKey(edge.source, edge.record);
		const held = edgesOfLine.get(key);
		if (held === undefined) edgesOfLine.set(key, [edge]);
		else held.push(edge);
	}

	const dated: { edge: GraphEdge; marks: LineMarks }[] = [];
	/** Every time a note began a dated line toward a target, by the pair in that order. */
	const starts = new Map<string, number[]>();
	const pairOf = (edge: GraphEdge): string => `${edge.source}\n${edge.target}`;
	for (const member of members) {
		member.relationships.forEach((line, record) => {
			const edges = edgesOfLine.get(lineKey(member.id, record));
			if (edges === undefined) return;
			const marks = marksOf(line, member.path);
			if (marks === null) return;
			for (const edge of edges) {
				dated.push({ edge, marks });
				if (rule !== 'latest') continue;
				const pair = pairOf(edge);
				const held = starts.get(pair) ?? [];
				held.push(...marks.points, ...marks.spans.map((span) => span.from));
				starts.set(pair, held);
			}
		});
	}
	for (const held of starts.values()) held.sort((a, b) => a - b);

	/** Where a line begun at a point ends: the point before the pair's next beginning, or the end of the axis. */
	const endOf = (edge: GraphEdge, at: number): number => {
		if (rule !== 'latest') return last;
		const next = starts.get(pairOf(edge))?.find((start) => start > at);
		return next === undefined ? last : next - 1;
	};
	const spans = new Map<string, readonly TimeSpan[]>();
	for (const { edge, marks } of dated) {
		spans.set(
			edge.id,
			mergeSpans([
				...marks.spans,
				...marks.own.map((at) => ({ from: at, to: at })),
				...marks.points.map((at) => ({ from: at, to: endOf(edge, at) })),
			]),
		);
	}
	return { times, spans };
}

/** Whether a line laid over these stretches stands at a point. */
export function standsAt(spans: readonly TimeSpan[], index: number): boolean {
	return spans.some((span) => span.from <= index && index <= span.to);
}

/**
 * The dated lines that do not stand at a point, by edge id: what a picture
 * of that time leaves out. `unrevealed` names lines that stand there but
 * are yet to be shown, which a time-lapse brings in one at a time.
 */
export function hiddenAt(
	timeline: GraphTimeline,
	index: number,
	unrevealed: Iterable<string> = [],
): Set<string> {
	const hidden = new Set<string>(unrevealed);
	for (const [id, spans] of timeline.spans) {
		if (!standsAt(spans, index)) hidden.add(id);
	}
	return hidden;
}

/**
 * What a picture holds that no time is said of: its undated lines, and the
 * nodes no dated line of it touches, a node with no line at all among them.
 * A picture with no dated line has no axis to hold anything back along,
 * which `dated` says.
 */
export interface UndatedParts {
	/** The undated lines among those given, in the order given. */
	readonly edges: readonly string[];
	/** The nodes among those given that none of the dated lines touches. */
	readonly nodes: ReadonlySet<string>;
	/** Whether any of the lines given is dated. */
	readonly dated: boolean;
}

export const NO_UNDATED_PARTS: UndatedParts = { edges: [], nodes: new Set(), dated: false };

export function undatedParts(
	timeline: GraphTimeline,
	nodes: Iterable<string>,
	edges: readonly GraphEdge[],
): UndatedParts {
	const undated: string[] = [];
	const touched = new Set<string>();
	for (const edge of edges) {
		if (!timeline.spans.has(edge.id)) {
			undated.push(edge.id);
			continue;
		}
		touched.add(edge.source);
		touched.add(edge.target);
	}
	const loose = new Set<string>();
	for (const id of nodes) if (!touched.has(id)) loose.add(id);
	return { edges: undated, nodes: loose, dated: undated.length < edges.length };
}

/**
 * Whether the undated lines and notes are held back at a point: under
 * `after`, at every point before the last. Nothing is held back from a
 * picture with no dated line, which the caller knows.
 */
export function undatedHeldAt(timeline: GraphTimeline, index: number, rule: GraphUndatedRule): boolean {
	return rule === 'after' && index < timeline.times.length - 1;
}

/** What a point changes of the point before it: the lines that begin there, and the ones that have ended. */
export interface TimeChange {
	readonly entering: readonly string[];
	readonly leaving: readonly string[];
}

/**
 * What each point of the axis changes among the lines given, which are the
 * ones a picture draws: lines the filters leave out change nothing anyone
 * sees. The first point is entered by every dated line that stands on it.
 * The lines come in the order given. Under `after` the undated lines enter
 * at the last point, behind the dated ones that begin there, so a
 * time-lapse brings them in at its end; where none of the lines is dated
 * there is nothing to come after, and they change nothing.
 */
export function timeChanges(
	timeline: GraphTimeline,
	edges: readonly GraphEdge[],
	undated: GraphUndatedRule = DEFAULT_GRAPH_UNDATED_RULE,
): TimeChange[] {
	const changes = timeline.times.map(() => ({ entering: [] as string[], leaving: [] as string[] }));
	const late: string[] = [];
	let dated = false;
	for (const edge of edges) {
		const spans = timeline.spans.get(edge.id);
		if (spans === undefined) {
			late.push(edge.id);
			continue;
		}
		dated = true;
		for (const span of spans) {
			changes[span.from]?.entering.push(edge.id);
			changes[span.to + 1]?.leaving.push(edge.id);
		}
	}
	// On an axis of one point the last is the first, and nothing was ever held back from it.
	if (undated === 'after' && dated && changes.length > 1) changes[changes.length - 1]?.entering.push(...late);
	return changes;
}

/** Whether two timelines lay the same lines along the same axis, so one already being played can carry on as the other. */
export function sameGraphTimeline(a: GraphTimeline, b: GraphTimeline): boolean {
	if (a === b) return true;
	if (a.times.length !== b.times.length || a.spans.size !== b.spans.size) return false;
	for (let at = 0; at < a.times.length; at += 1) {
		const left = a.times[at];
		const right = b.times[at];
		if (left?.id !== right?.id || left?.name !== right?.name || left?.kind !== right?.kind) return false;
	}
	for (const [id, spans] of a.spans) {
		const other = b.spans.get(id);
		if (other === undefined || other.length !== spans.length) return false;
		for (let at = 0; at < spans.length; at += 1) {
			if (spans[at]?.from !== other[at]?.from || spans[at]?.to !== other[at]?.to) return false;
		}
	}
	return true;
}
