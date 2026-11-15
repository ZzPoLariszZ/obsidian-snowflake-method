import { describe, expect, it } from 'vitest';

import { buildEntityGraph, labelLeaf, type EntityGraph, type GraphMember } from '../../src/domain/relationship-graph';
import {
	buildGraphTimeline,
	DEFAULT_GRAPH_TIME_RULE,
	DEFAULT_GRAPH_UNDATED_RULE,
	EMPTY_GRAPH_TIMELINE,
	GRAPH_TIME_RULES,
	GRAPH_UNDATED_RULES,
	hiddenAt,
	isGraphTimeRule,
	isGraphUndatedRule,
	NO_UNDATED_PARTS,
	sameGraphTimeline,
	standsAt,
	timeChanges,
	undatedHeldAt,
	undatedParts,
	type GraphTime,
	type GraphTimeRule,
	type GraphTimeline,
} from '../../src/domain/relationship-graph-timeline';
import type { RecordClause, RecordLine, RecordTerm } from '../../src/templates/record-lines';

const link = (path: string, name = path.split('/').pop()!): RecordTerm => ({ kind: 'link', path, name });
const text = (value: string): RecordTerm => ({ kind: 'text', text: value });
const to = (term: RecordTerm): RecordClause => ({ kind: 'target', term });
const when = (term: RecordTerm): RecordClause => ({ kind: 'when', term });
const at = (term: RecordTerm): RecordClause => ({ kind: 'at', term });
const between = (start: RecordTerm, end: RecordTerm): RecordClause => ({ kind: 'span', start, end });

/** A relationship line by its word, with its clauses in the order written. */
const line = (word: string, ...clauses: RecordClause[]): RecordLine => ({
	label: { path: `Demo/20_Character/23_Relationship/${word}/${labelLeaf(word)}`, display: word },
	value: '',
	clauses,
});

const TIME_FOLDER = 'Demo/60_Worldbuilding/61_Time';
const timePath = (name: string): string => `${TIME_FOLDER}/${name}.md`;
const point = (name: string): GraphTime => ({ id: `time-${name}`, name, path: timePath(name), kind: 'point', start: null, end: null });
const period = (name: string, start: string | null, end: string | null): GraphTime => ({
	id: `time-${name}`,
	name,
	path: timePath(name),
	kind: 'period',
	start: start === null ? null : `time-${start}`,
	end: end === null ? null : `time-${end}`,
});

/** Six years in a row, then a period between the first and the third, ranked after them all, and one that says no ends. */
const times: GraphTime[] = [
	point('Y1'), point('Y2'), point('Y3'), point('Y4'), point('Y5'), point('Y6'),
	period('Childhood', 'Y1', 'Y3'),
	period('Later', null, null),
];
/** A time by the full path its note has, as the plugin writes a link. */
const year = (name: string): RecordTerm => link(`${TIME_FOLDER}/${name}`);

const member = (id: string, name: string, relationships: RecordLine[] = [], kind = 'character'): GraphMember => ({
	id,
	group: kind === 'character' ? 'character' : 'worldbuilding',
	kind,
	name,
	aliases: [],
	path: kind === 'time' ? timePath(name) : `Demo/20_Character/${name}.md`,
	relationships,
});
const timeMembers = times.map((time) => member(time.id, time.name, [], 'time'));

function laid(people: GraphMember[], rule: GraphTimeRule = 'latest', axis: GraphTime[] = times) {
	const members = [...people, ...timeMembers];
	const resolve = (target: string): string | null =>
		members.find((candidate) => candidate.path.endsWith(`/${target.split('/').pop()!}.md`))?.path ?? null;
	const graph: EntityGraph = buildEntityGraph(members, resolve);
	const timeline = buildGraphTimeline({ members, graph, times: axis, resolve, rule });
	/** The stretches of the line a holder words so toward a target, as `from-to` pairs. */
	const spansOf = (holder: string, word: string, target: string): string[] | null => {
		const edge = graph.edges.find((candidate) => candidate.source === holder && candidate.label === word && candidate.target === target);
		if (edge === undefined) throw new Error(`no ${word} line from ${holder} to ${target}`);
		const spans = timeline.spans.get(edge.id);
		return spans === undefined ? null : spans.map((span) => `${String(span.from)}-${String(span.to)}`);
	};
	/** The words of the lines a holder has standing toward a target at a point. */
	const standing = (holder: string, target: string, index: number): string[] => {
		const hidden = hiddenAt(timeline, index);
		return graph.edges
			.filter((edge) => edge.source === holder && edge.target === target && !hidden.has(edge.id))
			.map((edge) => edge.label);
	};
	return { graph, timeline, spansOf, standing };
}

const bob = member('bob', 'Bob');
const carol = member('carol', 'Carol');

describe('the rule a dated line stands by', () => {
	it('names its two rules, the latest first', () => {
		expect([...GRAPH_TIME_RULES]).toEqual(['latest', 'since']);
		expect(DEFAULT_GRAPH_TIME_RULE).toBe('latest');
		expect(isGraphTimeRule('since')).toBe(true);
		expect(isGraphTimeRule('exact')).toBe(false);
		expect(isGraphTimeRule(undefined)).toBe(false);
	});

	const alice = member('alice', 'Alice', [
		line('Stranger', to(link('Bob')), when(year('Y1'))),
		line('Friend', to(link('Bob')), when(year('Y3'))),
		line('Enemy', to(link('Bob')), when(year('Y5'))),
		line('Sibling', to(link('Carol'))),
	]);

	it('shows what a note last said of a target: each dated line gives way to the next toward the same target', () => {
		const view = laid([alice, bob, carol]);
		expect(view.spansOf('alice', 'Stranger', 'bob')).toEqual(['0-1']);
		expect(view.spansOf('alice', 'Friend', 'bob')).toEqual(['2-3']);
		expect(view.spansOf('alice', 'Enemy', 'bob')).toEqual(['4-7']);
		expect([0, 1, 2, 3, 4, 5].map((index) => view.standing('alice', 'bob', index))).toEqual([
			['Stranger'], ['Stranger'], ['Friend'], ['Friend'], ['Enemy'], ['Enemy'],
		]);
		// A line with no time is undated: it has no stretch, and stands everywhere.
		expect(view.spansOf('alice', 'Sibling', 'carol')).toBeNull();
		expect([0, 3, 7].map((index) => view.standing('alice', 'carol', index))).toEqual([['Sibling'], ['Sibling'], ['Sibling']]);
	});

	it('keeps every line from its time on under the other rule', () => {
		const view = laid([alice, bob, carol], 'since');
		expect(view.spansOf('alice', 'Stranger', 'bob')).toEqual(['0-7']);
		expect(view.spansOf('alice', 'Friend', 'bob')).toEqual(['2-7']);
		expect(view.spansOf('alice', 'Enemy', 'bob')).toEqual(['4-7']);
		expect([0, 2, 4].map((index) => view.standing('alice', 'bob', index))).toEqual([
			['Stranger'], ['Stranger', 'Friend'], ['Stranger', 'Friend', 'Enemy'],
		]);
	});

	it('takes each note\'s word of each target apart: another target, or the same pair the other way, ends nothing', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Friend', to(link('Bob')), when(year('Y1'))),
				line('Mentor', to(link('Carol')), when(year('Y2'))),
			]),
			member('bob', 'Bob', [line('Rival', to(link('Alice')), when(year('Y3')))]),
			carol,
		]);
		expect(view.spansOf('alice', 'Friend', 'bob')).toEqual(['0-7']);
		expect(view.spansOf('alice', 'Mentor', 'carol')).toEqual(['1-7']);
		expect(view.spansOf('bob', 'Rival', 'alice')).toEqual(['2-7']);
	});

	it('lets two lines a note dates toward one target at one time stand together, and end together', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Friend', to(link('Bob')), when(year('Y2'))),
				line('Colleague', to(link('Bob')), when(year('Y2'))),
				line('Enemy', to(link('Bob')), when(year('Y4'))),
			]),
			bob,
		]);
		expect(view.standing('alice', 'bob', 1)).toEqual(['Friend', 'Colleague']);
		expect(view.standing('alice', 'bob', 2)).toEqual(['Friend', 'Colleague']);
		expect(view.standing('alice', 'bob', 3)).toEqual(['Enemy']);
		// Before the first of them, nothing dated stands.
		expect(view.standing('alice', 'bob', 0)).toEqual([]);
	});
});

describe('what a line\'s time covers', () => {
	it('lays a period between its two ends, and on its own point wherever the note is ranked', () => {
		const view = laid([member('alice', 'Alice', [line('Ward', to(link('Carol')), when(year('Childhood')))]), carol]);
		expect(view.spansOf('alice', 'Ward', 'carol')).toEqual(['0-2', '6-6']);
		expect([0, 2, 3, 5, 6, 7].map((index) => view.standing('alice', 'carol', index).length)).toEqual([1, 1, 0, 0, 1, 0]);
		// The other rule moves no end of it: a period says when it stops.
		expect(laid([member('alice', 'Alice', [line('Ward', to(link('Carol')), when(year('Childhood')))]), carol], 'since')
			.spansOf('alice', 'Ward', 'carol')).toEqual(['0-2', '6-6']);
	});

	it('takes a period ranked within its own ends as one stretch, and swaps ends written the wrong way round', () => {
		const within = [point('Y1'), period('Childhood', 'Y3', 'Y1'), point('Y2'), point('Y3'), point('Y4')];
		const view = laid([member('alice', 'Alice', [line('Ward', to(link('Carol')), when(year('Childhood')))]), carol], 'latest', within);
		expect(view.spansOf('alice', 'Ward', 'carol')).toEqual(['0-3']);
	});

	it('reads a period that names no ends, or an end that is no time note, as a point of its own', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Ally', to(link('Bob')), when(year('Later'))),
				line('Friend', to(link('Carol')), when(year('Half'))),
			]),
			bob,
			carol,
		], 'latest', [...times, period('Half', 'Y2', 'Gone')]);
		expect(view.spansOf('alice', 'Ally', 'bob')).toEqual(['7-8']);
		expect(view.spansOf('alice', 'Friend', 'carol')).toEqual(['8-8']);
	});

	it('ends a line begun at a point where a period toward the same target begins, and leaves the period its own end', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Stranger', to(link('Carol')), when(year('Y1'))),
				line('Ward', to(link('Carol')), when(year('Childhood'))),
				line('Friend', to(link('Carol')), when(year('Y5'))),
			]),
			carol,
		]);
		// The period begins at the first year too, so both stand there, and the line stands on until the fifth year's.
		expect(view.spansOf('alice', 'Stranger', 'carol')).toEqual(['0-3']);
		expect(view.spansOf('alice', 'Ward', 'carol')).toEqual(['0-2', '6-6']);
		// The period's own point, ranked after the years, shows the period's line and ends no other.
		expect(view.spansOf('alice', 'Friend', 'carol')).toEqual(['4-7']);
		expect(view.standing('alice', 'carol', 6)).toEqual(['Ward', 'Friend']);
	});

	it('ends a line begun at a point when a period toward the same target begins after it', () => {
		const axis = [point('Y1'), point('Y2'), point('Y3'), point('Y4'), point('Y5'), period('Exile', 'Y2', 'Y3')];
		const view = laid([
			member('alice', 'Alice', [
				line('Stranger', to(link('Carol')), when(year('Y1'))),
				line('Guard', to(link('Carol')), when(year('Exile'))),
				line('Friend', to(link('Carol')), when(year('Y5'))),
			]),
			carol,
		], 'latest', axis);
		expect(view.spansOf('alice', 'Stranger', 'carol')).toEqual(['0-0']);
		expect(view.spansOf('alice', 'Guard', 'carol')).toEqual(['1-2', '5-5']);
		// Nothing dated stands between the period's end and the next line's time.
		expect(view.standing('alice', 'carol', 3)).toEqual([]);
		expect(view.spansOf('alice', 'Friend', 'carol')).toEqual(['4-5']);
	});

	it('reads an older span as a stretch, its ends either way round, and a span with one end as a point', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Lodger', to(link('Bob')), between(year('Y4'), year('Y2'))),
				line('Tenant', to(link('Carol')), between(year('Y3'), text('the fire'))),
			]),
			bob,
			carol,
		]);
		expect(view.spansOf('alice', 'Lodger', 'bob')).toEqual(['1-3']);
		expect(view.spansOf('alice', 'Tenant', 'carol')).toEqual(['2-7']);
	});

	it('joins several times on one line, the ones that touch made one stretch', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Ward', to(link('Carol')), when(year('Childhood')), between(year('Y4'), year('Y5'))),
				line('Guest', to(link('Bob')), between(year('Y1'), year('Y2')), between(year('Y5'), year('Y6'))),
			]),
			bob,
			carol,
		]);
		expect(view.spansOf('alice', 'Ward', 'carol')).toEqual(['0-4', '6-6']);
		expect(view.spansOf('alice', 'Guest', 'bob')).toEqual(['0-1', '4-5']);
	});

	it('dates every target of a line alike, since the time is the line\'s', () => {
		const view = laid([member('alice', 'Alice', [line('Friend', to(link('Bob')), to(link('Carol')), when(year('Y3')))]), bob, carol]);
		expect(view.spansOf('alice', 'Friend', 'bob')).toEqual(['2-7']);
		expect(view.spansOf('alice', 'Friend', 'carol')).toEqual(['2-7']);
	});

	it('finds a time by a bare link through the vault, and leaves undated a time in plain words, a place, or a link to no time note', () => {
		const view = laid([
			member('alice', 'Alice', [
				line('Friend', to(link('Bob')), when(link('Y4'))),
				line('Ally', to(link('Bob')), when(text('the war'))),
				line('Rival', to(link('Bob')), when(link('Carol'))),
				line('Guest', to(link('Bob')), at(year('Y2'))),
				line('Heir', to(link('Bob')), when(link('Nowhere'))),
			]),
			bob,
			carol,
		]);
		expect(view.spansOf('alice', 'Friend', 'bob')).toEqual(['3-7']);
		for (const word of ['Ally', 'Rival', 'Guest', 'Heir']) expect(view.spansOf('alice', word, 'bob')).toBeNull();
	});

	it('lays nothing along an axis with no time on it', () => {
		const view = laid([member('alice', 'Alice', [line('Friend', to(link('Bob')), when(year('Y3')))]), bob], 'latest', []);
		expect(view.timeline.times).toEqual([]);
		expect(view.timeline.spans.size).toBe(0);
		expect(EMPTY_GRAPH_TIMELINE.spans.size).toBe(0);
	});
});

describe('reading a timeline', () => {
	const view = laid([
		member('alice', 'Alice', [
			line('Stranger', to(link('Bob')), when(year('Y1'))),
			line('Friend', to(link('Bob')), when(year('Y3'))),
			line('Sibling', to(link('Carol'))),
			line('Ward', to(link('Carol')), when(year('Childhood'))),
		]),
		bob,
		carol,
	]);
	const idOf = (word: string): string => view.graph.edges.find((edge) => edge.label === word)!.id;

	it('says whether a line stands at a point', () => {
		expect(standsAt([{ from: 1, to: 3 }], 0)).toBe(false);
		expect(standsAt([{ from: 1, to: 3 }], 1)).toBe(true);
		expect(standsAt([{ from: 1, to: 3 }], 3)).toBe(true);
		expect(standsAt([{ from: 1, to: 3 }, { from: 6, to: 6 }], 6)).toBe(true);
		expect(standsAt([], 0)).toBe(false);
	});

	it('names the dated lines a point leaves out, and the ones yet to be shown with them', () => {
		expect([...hiddenAt(view.timeline, 0)]).toEqual([idOf('Friend')]);
		expect([...hiddenAt(view.timeline, 4)].sort()).toEqual([idOf('Stranger'), idOf('Ward')].sort());
		expect(hiddenAt(view.timeline, 0, [idOf('Stranger')]).has(idOf('Stranger'))).toBe(true);
		expect(hiddenAt(view.timeline, 0).has(idOf('Sibling'))).toBe(false);
	});

	it('says what each point changes among the lines given, in their order', () => {
		const changes = timeChanges(view.timeline, view.graph.edges);
		expect(changes).toHaveLength(times.length);
		expect(changes[0]).toEqual({ entering: [idOf('Stranger'), idOf('Ward')], leaving: [] });
		expect(changes[1]).toEqual({ entering: [], leaving: [] });
		expect(changes[2]).toEqual({ entering: [idOf('Friend')], leaving: [idOf('Stranger')] });
		expect(changes[3]).toEqual({ entering: [], leaving: [idOf('Ward')] });
		expect(changes[6]).toEqual({ entering: [idOf('Ward')], leaving: [] });
		expect(changes[7]).toEqual({ entering: [], leaving: [idOf('Ward')] });
		// Lines a picture leaves out change nothing anyone sees.
		const some = view.graph.edges.filter((edge) => edge.label !== 'Ward');
		expect(timeChanges(view.timeline, some)[0]).toEqual({ entering: [idOf('Stranger')], leaving: [] });
		expect(timeChanges(view.timeline, [])[2]).toEqual({ entering: [], leaving: [] });
	});

	it('names its two rules for the lines that name no time, the one that has them there from the start first', () => {
		expect([...GRAPH_UNDATED_RULES]).toEqual(['before', 'after']);
		expect(DEFAULT_GRAPH_UNDATED_RULE).toBe('before');
		expect(isGraphUndatedRule('after')).toBe(true);
		expect(isGraphUndatedRule('always')).toBe(false);
		expect(isGraphUndatedRule(undefined)).toBe(false);
	});

	it('tells the undated lines of a picture from the dated, and the nodes no dated line touches', () => {
		const parts = undatedParts(view.timeline, view.graph.nodes.map((node) => node.id), view.graph.edges);
		expect(parts.edges).toEqual([idOf('Sibling')]);
		expect(parts.dated).toBe(true);
		// Alice, Bob and Carol each have a dated line; the time notes are touched by none.
		expect([...parts.nodes].sort()).toEqual(times.map((time) => time.id).sort());
		// A picture of the undated line alone has nothing dated in it, and both its ends are loose.
		const only = view.graph.edges.filter((edge) => edge.label === 'Sibling');
		expect(undatedParts(view.timeline, ['alice', 'carol'], only)).toEqual({
			edges: [idOf('Sibling')],
			nodes: new Set(['alice', 'carol']),
			dated: false,
		});
		// A node with no line at all is loose too, and a picture of nothing holds nothing.
		expect(undatedParts(view.timeline, ['alice', 'nobody'], view.graph.edges).nodes).toEqual(new Set(['nobody']));
		expect(undatedParts(view.timeline, [], [])).toEqual(NO_UNDATED_PARTS);
	});

	it('holds the undated back at every point before the last under the rule that has them after the end', () => {
		const last = times.length - 1;
		expect(undatedHeldAt(view.timeline, 0, 'after')).toBe(true);
		expect(undatedHeldAt(view.timeline, last - 1, 'after')).toBe(true);
		expect(undatedHeldAt(view.timeline, last, 'after')).toBe(false);
		for (let index = 0; index <= last; index += 1) expect(undatedHeldAt(view.timeline, index, 'before')).toBe(false);
		// An axis of one point has no point before its last, and an axis of none no point at all.
		expect(undatedHeldAt({ times: [times[0]!], spans: new Map() }, 0, 'after')).toBe(false);
		expect(undatedHeldAt(EMPTY_GRAPH_TIMELINE, 0, 'after')).toBe(false);
	});

	it('brings the undated lines in at the last point under that rule, behind the dated ones that begin there', () => {
		const last = times.length - 1;
		const before = timeChanges(view.timeline, view.graph.edges, 'before');
		expect(before).toEqual(timeChanges(view.timeline, view.graph.edges));
		expect(before.flatMap((change) => change.entering)).not.toContain(idOf('Sibling'));
		const after = timeChanges(view.timeline, view.graph.edges, 'after');
		expect(after[last]!.entering).toEqual([...before[last]!.entering, idOf('Sibling')]);
		expect(after[last]!.leaving).toEqual(before[last]!.leaving);
		expect(after.slice(0, last)).toEqual(before.slice(0, last));
		// With no dated line among those given there is no end to come after: the undated change nothing.
		const only = view.graph.edges.filter((edge) => edge.label === 'Sibling');
		expect(timeChanges(view.timeline, only, 'after').every((change) => change.entering.length === 0)).toBe(true);
		// On an axis of one point the last is the first, and nothing was held back from it.
		const lone = laid(
			[member('alice', 'Alice', [line('Stranger', to(link('Bob')), when(year('Y1'))), line('Sibling', to(link('Carol')))]), bob, carol],
			'latest',
			[point('Y1')],
		);
		const stranger = lone.graph.edges.find((edge) => edge.label === 'Stranger')!.id;
		expect(timeChanges(lone.timeline, lone.graph.edges, 'after')).toEqual([{ entering: [stranger], leaving: [] }]);
	});

	it('tells a timeline that reads the same from one that moved', () => {
		const again = laid([
			member('alice', 'Alice', [
				line('Stranger', to(link('Bob')), when(year('Y1'))),
				line('Friend', to(link('Bob')), when(year('Y3'))),
				line('Sibling', to(link('Carol'))),
				line('Ward', to(link('Carol')), when(year('Childhood'))),
			]),
			bob,
			carol,
		]).timeline;
		expect(sameGraphTimeline(view.timeline, view.timeline)).toBe(true);
		expect(sameGraphTimeline(view.timeline, again)).toBe(true);
		const redated = laid([member('alice', 'Alice', [line('Stranger', to(link('Bob')), when(year('Y2')))]), bob, carol]).timeline;
		expect(sameGraphTimeline(view.timeline, redated)).toBe(false);
		const renamed: GraphTimeline = { ...again, times: again.times.map((time, index) => (index === 0 ? { ...time, name: 'Year one' } : time)) };
		expect(sameGraphTimeline(view.timeline, renamed)).toBe(false);
		const shorter: GraphTimeline = { ...again, times: again.times.slice(0, 7) };
		expect(sameGraphTimeline(view.timeline, shorter)).toBe(false);
		const moved: GraphTimeline = { ...again, spans: new Map([...again.spans].map(([id, spans]) => [id, spans.map((span) => ({ from: span.from, to: span.to + 1 }))])) };
		expect(sameGraphTimeline(view.timeline, moved)).toBe(false);
	});
});
