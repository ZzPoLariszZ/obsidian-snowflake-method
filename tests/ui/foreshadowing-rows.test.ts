import { describe, expect, it } from 'vitest';

import {
	captureOccurrence,
	orderForeshadowings,
	orderOccurrences,
	revealSpan,
	type EntityRosterEntry,
	type Foreshadowing,
	type ForeshadowingOccurrence,
	type ForeshadowingStatus,
} from '../../src/domain';
import {
	filterForeshadowingItems,
	flattenForeshadowingRows,
	foreshadowingTableItems,
	type ForeshadowingFilters,
	type ForeshadowingNoteReading,
	type ForeshadowingTableItem,
} from '../../src/ui/foreshadowing-rows';

const ONE = '50_Manuscript/Chapter 1.md';
const TWO = '50_Manuscript/Chapter 2.md';
const BODY = 'The grey heron stood in the shallows, watching the water.';
const BODY_TWO = 'Later the key was found under the loose board by the door.';

const occurrence = (
	id: string,
	from: number,
	to: number,
	options: { path?: string; body?: string; role?: 'plant' | 'reinforce' | 'payoff'; note?: string } = {},
): ForeshadowingOccurrence =>
	captureOccurrence(
		options.path ?? ONE,
		options.body ?? BODY,
		from,
		to,
		options.role ?? 'plant',
		options.note ?? '',
		id,
	);

const item = (
	id: string,
	occurrences: ForeshadowingOccurrence[],
	options: { status?: ForeshadowingStatus; name?: string; createdAt?: number; related?: Foreshadowing['related'] } = {},
): Foreshadowing => ({
	id,
	name: options.name ?? `Thread ${id}`,
	description: 'A key disappears.',
	status: options.status ?? 'active',
	related: options.related ?? [],
	createdAt: options.createdAt ?? 1,
	updatedAt: 1,
	occurrences,
});

const notes = (
	entries: [string, ForeshadowingNoteReading][],
): Map<string, ForeshadowingNoteReading> => new Map(entries);
const both = notes([
	[ONE, { title: 'Chapter 1', body: BODY }],
	[TWO, { title: 'Chapter 2', body: BODY_TWO }],
]);
const roster: EntityRosterEntry[] = [
	{ kind: 'character', id: 'character-alice', name: 'Alice Grey', path: '20/Alice.md', group: 'character' },
];
const labels = {
	status: (status: ForeshadowingStatus): string => `status:${status}`,
	role: (role: string): string => `role:${role}`,
	unresolved: 'Unresolved',
};
const none: ForeshadowingFilters = { status: '', role: '', standing: '' };

describe('shaping the foreshadowing table', () => {
	it('gives a thread one row per occurrence, and one row when it has none', () => {
		const rows = foreshadowingTableItems(
			[item('three', [occurrence('a', 4, 14), occurrence('b', 30, 38), occurrence('c', 10, 13, { path: TWO, body: BODY_TWO })]), item('empty', [])],
			both,
			roster,
		);
		expect(rows.map((row) => [row.id, row.span, row.occurrences.length])).toEqual([
			['three', 3, 3],
			['empty', 1, 0],
		]);
	});

	it('re-anchors against the body it is handed', () => {
		const grown = `Once, ${BODY}`;
		const [row] = foreshadowingTableItems(
			[item('t', [occurrence('a', 4, 14)])],
			notes([[ONE, { title: 'Chapter 1', body: grown }]]),
			roster,
		);
		expect(row?.occurrences[0]).toMatchObject({ standing: 'live', from: 10, to: 20, title: 'Chapter 1' });
		expect(row?.occurrences[0]?.reveal).toEqual(revealSpan(grown, 10, 20));
	});

	it('reads an unreadable or unlisted chapter as unresolved, at the stored offsets', () => {
		const rows = foreshadowingTableItems(
			[item('t', [occurrence('a', 4, 14), occurrence('s', 0, 3, { path: '50_Manuscript/Nine.md', body: 'The end.' })])],
			notes([[ONE, { title: 'Chapter 1', body: null }]]),
			roster,
		);
		expect(rows[0]?.occurrences.map((o) => [o.id, o.standing, o.from, o.to, o.reveal, o.title])).toEqual([
			['a', 'unresolved', 4, 14, null, 'Chapter 1'],
			['s', 'unresolved', 0, 3, null, 'Nine'],
		]);
	});

	it('orders occurrences and threads exactly as the domain does', () => {
		const items = [
			item('later', [occurrence('l', 30, 38)], { status: 'active', createdAt: 5 }),
			item('planned', [occurrence('p', 10, 13, { path: TWO, body: BODY_TWO })], { status: 'planned' }),
			item('early', [occurrence('e2', 10, 13, { path: TWO, body: BODY_TWO }), occurrence('e1', 4, 14)], { status: 'active', createdAt: 9 }),
			item('none', [], { status: 'active', createdAt: 2 }),
		];
		const paths = [ONE, TWO];
		const bodyOf = (path: string): string | null => both.get(path)?.body ?? null;
		const rows = foreshadowingTableItems(items, both, roster);
		expect(rows.map((row) => row.id)).toEqual(orderForeshadowings(items, paths, bodyOf).map((it) => it.id));
		expect(rows.map((row) => row.id)).toEqual(['planned', 'early', 'later', 'none']);
		const early = rows.find((row) => row.id === 'early');
		expect(early?.occurrences.map((o) => o.id)).toEqual(
			orderOccurrences(items[2]!, paths, bodyOf).map((o) => o.id),
		);
		expect(early?.occurrences.map((o) => o.id)).toEqual(['e1', 'e2']);
	});

	it('resolves related names through the roster and keeps a missing one by its stored name', () => {
		const [row] = foreshadowingTableItems(
			[item('t', [], { related: [
				{ kind: 'character', id: 'character-alice', name: 'Alice' },
				{ kind: 'scene', id: 'scene-gone', name: 'The heist' },
			] })],
			both,
			roster,
		);
		expect(row?.related.map((ref) => [ref.name, ref.missing])).toEqual([
			['Alice Grey', false],
			['The heist', true],
		]);
	});
});

describe('searching and filtering the foreshadowing table', () => {
	const shaped = (): ForeshadowingTableItem[] =>
		foreshadowingTableItems(
			[
				item('key', [occurrence('plant', 4, 14, { note: 'first seen' }), occurrence('pay', 10, 13, { path: TWO, body: BODY_TWO, role: 'payoff' })], { name: 'Silver key', status: 'active', related: [{ kind: 'character', id: 'character-alice', name: 'Alice' }] }),
				item('lock', [occurrence('lost', 4, 14)], { name: 'Three knocks', status: 'planned' }),
				item('bare', [], { name: 'Nothing yet', status: 'resolved' }),
			],
			notes([
				[ONE, { title: 'Chapter 1', body: BODY.replace('grey heron', 'blue heron') }],
				[TWO, { title: 'Chapter 2', body: BODY_TWO }],
			]),
			roster,
		);

	it('an empty query with no filters keeps everything and marks nothing', () => {
		const match = filterForeshadowingItems(shaped(), '  ', none, labels);
		expect(match.items.map((row) => row.id)).toEqual(['lock', 'key', 'bare']);
		expect(match.matched.size).toBe(0);
	});

	it('the status filter drops whole threads and marks nothing', () => {
		const match = filterForeshadowingItems(shaped(), '', { ...none, status: 'planned' }, labels);
		expect(match.items.map((row) => row.id)).toEqual(['lock']);
		expect(match.matched.size).toBe(0);
	});

	it('the role filter keeps threads holding that role, marks those rows, and drops a bare thread', () => {
		const match = filterForeshadowingItems(shaped(), '', { ...none, role: 'payoff' }, labels);
		expect(match.items.map((row) => row.id)).toEqual(['key']);
		expect([...match.matched]).toEqual(['pay']);
	});

	it('the unresolved filter keeps only threads with an occurrence the chapter lost', () => {
		const match = filterForeshadowingItems(shaped(), '', { ...none, standing: 'unresolved' }, labels);
		expect(match.items.map((row) => row.id)).toEqual(['lock', 'key']);
		expect([...match.matched].sort()).toEqual(['lost', 'plant']);
	});

	it('finds a thread by each field the reader can see', () => {
		const rows = shaped();
		const by = (query: string): [string[], string[]] => {
			const match = filterForeshadowingItems(rows, query, none, labels);
			return [match.items.map((row) => row.id), [...match.matched].sort()];
		};
		expect(by('silver')).toEqual([['key'], []]);
		expect(by('disappears')).toEqual([['lock', 'key', 'bare'], []]);
		expect(by('alice grey')).toEqual([['key'], []]);
		expect(by('status:resolved')).toEqual([['bare'], []]);
		expect(by('role:payoff')).toEqual([['key'], ['pay']]);
		expect(by('chapter 2')).toEqual([['key'], ['pay']]);
		expect(by('first seen')).toEqual([['key'], ['plant']]);
		expect(by('grey heron')).toEqual([['lock', 'key'], ['lost', 'plant']]);
		expect(by('unresolved')).toEqual([['lock', 'key'], ['lost', 'plant']]);
		expect(by('埋设')).toEqual([[], []]);
	});

	it('composes the filters, keeps every row of a standing thread, and leaves its input alone', () => {
		const rows = shaped();
		const before = JSON.stringify(rows);
		// The query lands on the thread's name; the funnel then says which of
		// its rows to indicate, and the status filter can still drop it whole.
		const match = filterForeshadowingItems(rows, 'silver', { status: 'active', role: 'plant', standing: '' }, labels);
		expect(match.items.map((row) => row.id)).toEqual(['key']);
		expect(match.items[0]?.occurrences).toHaveLength(2);
		expect([...match.matched]).toEqual(['plant']);
		expect(filterForeshadowingItems(rows, 'silver', { status: 'planned', role: 'plant', standing: '' }, labels).items).toEqual([]);
		// A funnel the thread cannot answer drops it even when the query lands.
		expect(filterForeshadowingItems(rows, 'silver', { status: '', role: 'reinforce', standing: '' }, labels).items).toEqual([]);
		expect(JSON.stringify(rows)).toBe(before);
	});
});

describe('flattening the table for the virtual window', () => {
	it('lays one row per occurrence, a bare thread as one row, with head and tail marked', () => {
		const rows = flattenForeshadowingRows(
			foreshadowingTableItems(
				[item('two', [occurrence('a', 4, 14), occurrence('b', 30, 38)]), item('bare', [])],
				both,
				roster,
			),
			new Set(['b']),
		);
		expect(rows.map((row) => [row.key, row.groupHead, row.groupTail, row.matched, row.occurrence?.id ?? null])).toEqual([
			['two:a', true, false, false, 'a'],
			['two:b', false, true, true, 'b'],
			['bare:', true, true, false, null],
		]);
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
	});
});
