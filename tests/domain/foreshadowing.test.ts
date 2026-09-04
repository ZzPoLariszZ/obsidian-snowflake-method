import { describe, expect, it } from 'vitest';

import {
	FORESHADOWING_STATUSES,
	OCCURRENCE_ROLES,
	REVISION_CONTEXT_CHARS,
	anchorOccurrence,
	captureOccurrence,
	compareOccurrencesAtOneSpot,
	firstAppearance,
	isForeshadowing,
	isForeshadowingOccurrence,
	occurrenceSpot,
	orderForeshadowings,
	orderOccurrences,
	passageTravels,
	planForeshadowingMarks,
	readForeshadowing,
	refreshOccurrenceAnchors,
	resolveEntityRefs,
	type Foreshadowing,
	type ForeshadowingOccurrence,
	type ForeshadowingStatus,
	type OccurrenceRole,
} from '../../src/domain';

const ONE = '50/one.md';
const TWO = '50/two.md';
const BODY = 'The grey heron stood in the shallows, watching the water.';
const BODY_TWO = 'Later the key was found under the loose board by the door.';

const occurrence = (
	id: string,
	from: number,
	to: number,
	options: {
		path?: string;
		body?: string;
		role?: OccurrenceRole;
		note?: string;
	} = {},
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
	options: {
		status?: ForeshadowingStatus;
		createdAt?: number;
		name?: string;
	} = {},
): Foreshadowing => ({
	id,
	name: options.name ?? 'The missing key',
	description: 'A key disappears.',
	status: options.status ?? 'active',
	related: [{ kind: 'character', id: 'character-alice', name: 'Alice' }],
	createdAt: options.createdAt ?? 100,
	updatedAt: 100,
	occurrences,
});

const bodies = new Map<string, string>([
	[ONE, BODY],
	[TWO, BODY_TWO],
]);
const bodyOf = (path: string): string | null => bodies.get(path) ?? null;

describe('reading stored foreshadowing', () => {
	it('accepts what a capture writes', () => {
		const stored = item('fs-1', [occurrence('occ-1', 4, 14)]);
		expect(isForeshadowing(stored)).toBe(true);
		expect(readForeshadowing(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
	});

	it('refuses a thread with a bad limb, a status or a role outside its list', () => {
		const stored = item('fs-1', [occurrence('occ-1', 4, 14)]);
		expect(readForeshadowing({ ...stored, name: 7 })).toBeNull();
		expect(readForeshadowing({ ...stored, status: 'done' })).toBeNull();
		expect(readForeshadowing({ ...stored, createdAt: 'yesterday' })).toBeNull();
		expect(readForeshadowing(null)).toBeNull();
		expect(
			isForeshadowingOccurrence({ ...occurrence('occ-1', 4, 14), role: 'hint' }),
		).toBe(false);
	});

	it('drops one malformed occurrence and keeps the thread and its others', () => {
		const good = occurrence('occ-1', 4, 14);
		const other = occurrence('occ-2', 20, 28);
		const stored = item('fs-1', [good, other]);
		const read = readForeshadowing({
			...stored,
			occurrences: [good, { ...other, from: 'twenty' }, 'junk'],
		});
		expect(read?.occurrences).toEqual([good]);
		expect(read?.name).toBe(stored.name);
		expect(isForeshadowing({ ...stored, occurrences: [good, 'junk'] })).toBe(false);
	});

	it('drops one malformed related ref and keeps the thread', () => {
		const stored = item('fs-1', []);
		const read = readForeshadowing({
			...stored,
			related: [...stored.related, { kind: 'scene' }, 4],
		});
		expect(read?.related).toEqual(stored.related);
	});

	it('refuses a range that does not cover the text it remembers, and a zero-width one', () => {
		const good = occurrence('occ-1', 4, 14);
		expect(isForeshadowingOccurrence(good)).toBe(true);
		expect(isForeshadowingOccurrence({ ...good, to: 15 })).toBe(false);
		expect(isForeshadowingOccurrence({ ...good, originalText: 'grey' })).toBe(false);
		expect(
			isForeshadowingOccurrence({ ...good, from: 4, to: 4, originalText: '' }),
		).toBe(false);
	});
});

describe('capturing and anchoring an occurrence', () => {
	it('reads the covered text and its context off the body', () => {
		const captured = occurrence('occ-1', 30, 38);
		expect(captured.originalText).toBe(BODY.slice(30, 38));
		expect(captured.before).toBe(BODY.slice(30 - REVISION_CONTEXT_CHARS, 30));
		expect(captured.after).toBe(BODY.slice(38, 38 + REVISION_CONTEXT_CHARS));
		expect(captured.role).toBe('plant');
		expect(captured.path).toBe(ONE);
	});

	it('is anchored at its offsets, moved by typing before it, unresolved when edited inside', () => {
		const captured = occurrence('occ-1', 4, 14);
		expect(anchorOccurrence(BODY, captured)).toEqual({
			state: 'anchored',
			from: 4,
			to: 14,
		});
		expect(anchorOccurrence(`Once, ${BODY}`, captured)).toEqual({
			state: 'moved',
			from: 10,
			to: 20,
		});
		expect(
			anchorOccurrence(BODY.replace('grey heron', 'blue heron'), captured),
		).toEqual({ state: 'conflict' });
	});

	it('tells a duplicated passage apart by its context, and calls a tie unresolved', () => {
		const twice = `${BODY} The grey heron stood in the mud.`;
		const captured = occurrence('occ-1', 4, 14, { body: twice });
		const shifted = `Once, ${twice}`;
		expect(anchorOccurrence(shifted, captured)).toEqual({
			state: 'moved',
			from: 10,
			to: 20,
		});
		const framed = 'X grey heron X';
		const ambiguous = occurrence('occ-1', 2, 12, { body: framed });
		expect(
			anchorOccurrence('Y X grey heron X grey heron X', ambiguous).state,
		).toBe('conflict');
	});
});

describe('levelling occurrences with a saved body', () => {
	it('a moved occurrence takes its found offsets and fresh contexts, and the thread keeps its clock', () => {
		const stored = item('fs-1', [occurrence('occ-1', 4, 14)]);
		const grown = `Once, ${BODY}`;
		const { next, changed } = refreshOccurrenceAnchors(grown, ONE, [stored]);
		expect(changed).toBe(true);
		const [levelled] = next;
		expect(levelled?.occurrences[0]).toMatchObject({
			from: 10,
			to: 20,
			before: 'Once, The ',
			after: BODY.slice(14, 14 + REVISION_CONTEXT_CHARS),
		});
		expect(levelled?.updatedAt).toBe(stored.updatedAt);
	});

	it('levels only the note handed in and returns the others by identity', () => {
		const elsewhere = item('fs-2', [
			occurrence('occ-2', 10, 13, { path: TWO, body: BODY_TWO }),
		]);
		const here = item('fs-1', [occurrence('occ-1', 4, 14)]);
		const { next } = refreshOccurrenceAnchors(`Once, ${BODY}`, ONE, [
			elsewhere,
			here,
		]);
		expect(next[0]).toBe(elsewhere);
		expect(next[1]).not.toBe(here);
	});

	it('leaves an unresolved occurrence exactly as stored', () => {
		const stored = item('fs-1', [occurrence('occ-1', 4, 14)]);
		const { next, changed } = refreshOccurrenceAnchors(
			BODY.replace('grey heron', 'blue heron'),
			ONE,
			[stored],
		);
		expect(changed).toBe(false);
		expect(next[0]).toBe(stored);
	});

	it('answers changed false and the same members when nothing moved', () => {
		const stored = item('fs-1', [occurrence('occ-1', 4, 14)]);
		const { next, changed } = refreshOccurrenceAnchors(BODY, ONE, [stored]);
		expect(changed).toBe(false);
		expect(next).toEqual([stored]);
		expect(next[0]).toBe(stored);
	});
});

describe('ordering foreshadowing', () => {
	const paths = [ONE, TWO];

	it('status leads, in the order the statuses are listed', () => {
		const at = (): ForeshadowingOccurrence[] => [occurrence('occ', 4, 14)];
		const items = [
			item('abandoned', at(), { status: 'abandoned' }),
			item('resolved', at(), { status: 'resolved' }),
			item('planned', at(), { status: 'planned' }),
			item('active', at(), { status: 'active' }),
		];
		expect(orderForeshadowings(items, paths, bodyOf).map((it) => it.id)).toEqual(
			FORESHADOWING_STATUSES.slice(),
		);
	});

	it('within a status the earlier note wins, then the earlier offset', () => {
		const items = [
			item('late-in-one', [occurrence('a', 30, 38)]),
			item('in-two', [occurrence('b', 10, 13, { path: TWO, body: BODY_TWO })]),
			item('early-in-one', [occurrence('c', 4, 14)]),
		];
		expect(orderForeshadowings(items, paths, bodyOf).map((it) => it.id)).toEqual([
			'early-in-one',
			'late-in-one',
			'in-two',
		]);
	});

	it('derives first appearance from the body, not from the store', () => {
		const heron = occurrence('heron', 4, 14);
		const water = occurrence('water', 48, 53);
		const items = [item('water', [water]), item('heron', [heron])];
		const swapped = 'The water stood in the shallows, watching the grey heron.';
		const read = (path: string): string | null => (path === ONE ? swapped : null);
		expect(orderForeshadowings(items, paths, read).map((it) => it.id)).toEqual([
			'water',
			'heron',
		]);
		expect(firstAppearance(items[1]!, paths, read)).toEqual({ note: 0, at: 46 });
	});

	it('an unresolved occurrence still places its thread, by its stored offsets', () => {
		const gone = item('gone', [occurrence('a', 4, 14)]);
		const standing = item('standing', [occurrence('b', 30, 38)]);
		const read = (path: string): string | null =>
			path === ONE ? BODY.replace('grey heron', 'blue heron') : null;
		expect(firstAppearance(gone, paths, read)).toEqual({ note: 0, at: 4 });
		expect(orderForeshadowings([standing, gone], paths, read).map((it) => it.id)).toEqual([
			'gone',
			'standing',
		]);
	});

	it('a thread with no occurrence, or none on a listed note, sorts last within its status', () => {
		const empty = item('empty', [], { createdAt: 1 });
		const stray = item('stray', [occurrence('s', 0, 3, { path: '50/nine.md', body: 'The end.' })], {
			createdAt: 2,
		});
		const placed = item('placed', [occurrence('p', 30, 38)], { createdAt: 3 });
		expect(orderForeshadowings([empty, stray, placed], paths, bodyOf).map((it) => it.id)).toEqual([
			'placed',
			'empty',
			'stray',
		]);
	});

	it('breaks equal places on the older thread, then the id, and leaves the input alone', () => {
		const younger = item('b-younger', [occurrence('y', 4, 14)], { createdAt: 9 });
		const older = item('c-older', [occurrence('o', 4, 14)], { createdAt: 1 });
		const twin = item('a-twin', [occurrence('t', 4, 14)], { createdAt: 9 });
		const input = [younger, older, twin];
		expect(orderForeshadowings(input, paths, bodyOf).map((it) => it.id)).toEqual([
			'c-older',
			'a-twin',
			'b-younger',
		]);
		expect(input.map((it) => it.id)).toEqual(['b-younger', 'c-older', 'a-twin']);
	});

	it('walks one thread across two notes in manuscript order', () => {
		const thread = item('fs', [
			occurrence('payoff', 10, 13, { path: TWO, body: BODY_TWO, role: 'payoff' }),
			occurrence('plant', 4, 14),
			occurrence('echo', 30, 38, { role: 'reinforce' }),
		]);
		expect(orderOccurrences(thread, paths, bodyOf).map((occ) => occ.id)).toEqual([
			'plant',
			'echo',
			'payoff',
		]);
		expect(orderOccurrences(thread, [TWO], bodyOf).map((occ) => occ.id)).toEqual([
			'payoff',
		]);
	});

	it('breaks a shared spot on the id, the rule the stack and the arrows share', () => {
		const thread = item('fs', [occurrence('b', 4, 14), occurrence('a', 4, 14)]);
		expect(orderOccurrences(thread, paths, bodyOf).map((occ) => occ.id)).toEqual(['a', 'b']);
		expect(compareOccurrencesAtOneSpot({ id: 'a' }, { id: 'b' })).toBeLessThan(0);
	});
});

describe('the foreshadowing dress', () => {
	it('marks each anchored occurrence with its role and status, silent and titled', () => {
		const thread = item('fs', [occurrence('occ', 4, 14, { role: 'payoff' })], {
			status: 'resolved',
			name: 'The key',
		});
		const { plan } = planForeshadowingMarks(ONE, BODY, [thread]);
		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			from: 4,
			to: 14,
			classes: 'snowflake-method-foreshadowing is-payoff is-resolved',
			title: 'The key',
			silent: true,
		});
	});

	it('keys anchors by occurrence id and matches the text at the anchor', () => {
		const thread = item('fs', [occurrence('occ', 4, 14)]);
		const { plan, anchors } = planForeshadowingMarks(ONE, `Once, ${BODY}`, [thread]);
		expect(anchors.get('occ')).toEqual({ from: 10, to: 20 });
		expect(plan[0]?.occurrence).toEqual({
			type: 'foreshadowing',
			path: ONE,
			from: 10,
			to: 20,
			matchedText: 'grey heron',
			foreshadowingId: 'fs',
			occurrenceId: 'occ',
		});
	});

	it('sets an unresolved occurrence apart with its thread, and out of the plan', () => {
		const lost = occurrence('lost', 4, 14);
		const kept = occurrence('kept', 30, 38);
		const thread = item('fs', [lost, kept]);
		const { plan, anchors, conflicts } = planForeshadowingMarks(
			ONE,
			BODY.replace('grey heron', 'blue heron'),
			[thread],
		);
		expect(conflicts).toEqual([{ item: thread, occurrence: lost }]);
		expect(plan.map((mark) => mark.from)).toEqual([30]);
		expect([...anchors.keys()]).toEqual(['kept']);
	});

	it('leaves other notes alone, keeps overlaps, and sorts by where each begins', () => {
		const elsewhere = occurrence('two', 10, 13, { path: TWO, body: BODY_TWO });
		const wide = occurrence('wide', 4, 28);
		const inner = occurrence('inner', 9, 14);
		const later = occurrence('later', 30, 38);
		const threads = [item('fs-1', [later, elsewhere]), item('fs-2', [inner, wide])];
		const { plan, anchors } = planForeshadowingMarks(ONE, BODY, threads);
		expect(plan.map((mark) => [mark.from, mark.to])).toEqual([
			[4, 28],
			[9, 14],
			[30, 38],
		]);
		expect(anchors.has('two')).toBe(false);
	});
});

describe('entity refs against the roster', () => {
	const roster = [
		{
			kind: 'character',
			id: 'character-alice',
			name: 'Alice Grey',
			path: '30/Alice Grey.md',
			group: 'character',
		},
		{
			kind: 'location',
			id: 'entity-door',
			name: 'The door',
			path: '65/The door.md',
			group: 'location',
		},
	];

	it('resolves a renamed entity through its id to the roster', () => {
		expect(
			resolveEntityRefs([{ kind: 'character', id: 'character-alice', name: 'Alice' }], roster),
		).toEqual([
			{
				kind: 'character',
				id: 'character-alice',
				name: 'Alice Grey',
				path: '30/Alice Grey.md',
				missing: false,
			},
		]);
	});

	it('marks a deleted entity missing and keeps the stored name', () => {
		expect(resolveEntityRefs([{ kind: 'scene', id: 'scene-gone', name: 'The heist' }], roster)).toEqual([
			{ kind: 'scene', id: 'scene-gone', name: 'The heist', path: '', missing: true },
		]);
	});

	it('follows an entity moved between kinds and reports the roster kind', () => {
		expect(resolveEntityRefs([{ kind: 'item', id: 'entity-door', name: 'Door' }], roster)[0]).toMatchObject({
			kind: 'location',
			name: 'The door',
			missing: false,
		});
	});
});

describe('the shared passage rules a thread leans on', () => {
	it('sends a range beginning at the cut and keeps one above it', () => {
		const atCut = occurrenceSpot(occurrence('a', 30, 38));
		const above = occurrenceSpot(occurrence('b', 4, 14));
		expect(passageTravels(BODY, atCut, 30)).toBe(true);
		expect(passageTravels(BODY, above, 30)).toBe(false);
		expect(passageTravels(BODY, atCut, 20)).toBe(true);
	});

	it('never reads an occurrence as an insertion', () => {
		expect(occurrenceSpot(occurrence('a', 4, 14)).kind).toBe('replace');
		expect(OCCURRENCE_ROLES).toEqual(['plant', 'reinforce', 'payoff']);
	});
});
