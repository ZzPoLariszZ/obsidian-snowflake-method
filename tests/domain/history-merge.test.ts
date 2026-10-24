import { describe, expect, it } from 'vitest';

import {
	mergeHistory,
	type HistoryEntry,
	type HistoryEventKind,
	type HistoryEventRecord,
	type HistoryEventSource,
	type HistoryMergeInput,
	type HistoryNoteEntry,
	type HistoryNoteKind,
	type HistorySnapshotSource,
	type HistorySubject,
	type HistoryTallyReading,
	type NoteSnapshotRecord,
} from '../../src/domain';

const D19 = '2026-10-19';
const D20 = '2026-10-20';
const D21 = '2026-10-21';
const D22 = '2026-10-22';
const at = (clock: string, day = D21): number => Date.parse(`${day}T${clock}Z`);

const row = (
	path: string,
	ts: number,
	words: number,
	delta: number | null,
	hash: string,
	extra: Partial<NoteSnapshotRecord> = {},
): NoteSnapshotRecord => ({ path, kind: 'scene', ts, words, delta, hash, ...extra });

const source = (
	device: string,
	rows: NoteSnapshotRecord[],
	convention: { countMode?: string; countHeadings?: string } = {},
): HistorySnapshotSource => ({
	device,
	file: {
		schemaVersion: 1,
		countMode: convention.countMode ?? 'ms-word',
		countHeadings: convention.countHeadings ?? 'count',
		snapshots: rows,
	},
});

const note = (path: string, kind: HistoryNoteKind = 'scene'): HistorySubject => ({
	type: 'note',
	path,
	kind,
});

const event = (
	id: string,
	ts: number,
	kind: HistoryEventKind,
	subject: HistorySubject,
	extra: Partial<HistoryEventRecord> = {},
): HistoryEventRecord => ({ id, ts, event: kind, origin: 'user', subject, ...extra });

const session = (
	id: string,
	day: string,
	startedAt: number,
	endedAt: number,
	files: HistoryTallyReading['files'],
): HistoryTallyReading => ({
	id,
	kind: 'session',
	day,
	startedAt,
	endedAt,
	focusMs: endedAt - startedAt,
	files,
});

const told = (device: string, events: readonly HistoryEventRecord[]): HistoryEventSource => ({
	device,
	events,
});

type MergeOverrides = Partial<Omit<HistoryMergeInput, 'events'>> & {
	/** Device a's events, where no device's own are given. */
	events?: readonly HistoryEventRecord[];
	sources?: readonly HistoryEventSource[];
};

const merge = ({ events = [], sources = [told('a', events)], ...overrides }: MergeOverrides = {}) =>
	mergeHistory({
		from: D20,
		through: D22,
		timeZone: 'UTC',
		snapshots: [],
		events: sources,
		tallies: [],
		exists: () => true,
		classify: () => null,
		...overrides,
	});

const notesOf = (entries: readonly HistoryEntry[]): HistoryNoteEntry[] =>
	entries.filter((entry): entry is HistoryNoteEntry => entry.kind === 'note');

const dayOf = (reading: ReturnType<typeof merge>, day: string) => {
	const found = reading.days.find((candidate) => candidate.day === day);
	if (found === undefined) throw new Error(`No day ${day}`);
	return found;
};

describe('merging the three records into one history', () => {
	it('reads a note under the name it has now, and keeps a reused path apart', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('A.md', at('10:00:00'), 100, null, 'h1'),
					row('A.md', at('10:05:00'), 120, 20, 'h2', { prevTs: at('10:00:00') }),
					row('B.md', at('09:00:00', D22), 150, 30, 'h3', { prevTs: at('10:05:00') }),
					// Another note, born under the old name after the rename.
					row('A.md', at('10:00:00', D22), 10, null, 'h9'),
				]),
			],
			events: [event('e1', at('11:00:00'), 'renamed', note('B.md'), { from: 'A.md' })],
			exists: (path) => path === 'B.md' || path === 'A.md',
		});
		const first = dayOf(reading, D21);
		expect(notesOf(first.entries)).toEqual([
			expect.objectContaining({
				id: `${D21}:B.md`,
				action: 'first-recorded',
				note: { path: 'B.md', kind: 'scene', exists: true },
				versions: 2,
				words: { added: 20, deleted: 0, net: 20 },
				source: 'snapshots',
				at: at('10:00:00'),
				until: at('10:05:00'),
			}),
		]);
		expect(first.entries.find((entry) => entry.kind === 'renamed')).toEqual({
			kind: 'renamed',
			id: 'rename:e1',
			day: D21,
			at: at('11:00:00'),
			until: at('11:00:00'),
			items: [{ from: 'A.md', note: { path: 'B.md', kind: 'scene', exists: true } }],
			inferred: false,
		});
		const second = dayOf(reading, D22);
		expect(notesOf(second.entries).map((entry) => [entry.note.path, entry.action, entry.words.net, entry.versions])).toEqual([
			['B.md', 'edited', 30, 1],
			['A.md', 'first-recorded', 0, 1],
		]);
		expect(first.notes).toBe(1);
		expect(second.notes).toBe(2);
		expect(reading.summary.notes).toBe(2);
	});

	it('ends a chain at a deletion, so a reused path keeps the old note under the old name', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('P.md', at('10:00:00', D20), 100, null, 'h1'),
					row('P.md', at('09:01:00'), 5, null, 'h2'),
				]),
			],
			events: [
				event('gone', at('12:00:00', D20), 'deleted', note('P.md')),
				event('born', at('09:00:00'), 'created', note('P.md'), { words: 5 }),
				event('moved', at('10:00:00'), 'renamed', note('Q.md'), { from: 'P.md' }),
			],
			exists: (path) => path === 'Q.md',
		});
		const before = dayOf(reading, D20);
		expect(notesOf(before.entries).map((entry) => [entry.action, entry.note.path, entry.words, entry.source])).toEqual([
			['first-recorded', 'P.md', { added: 0, deleted: 0, net: 0 }, 'snapshots'],
			['deleted', 'P.md', { added: 0, deleted: 100, net: -100 }, 'snapshots'],
		]);
		expect(notesOf(before.entries)[1]?.note.exists).toBe(false);
		const after = dayOf(reading, D21);
		expect(notesOf(after.entries)).toEqual([
			expect.objectContaining({
				action: 'created',
				origin: 'user',
				createdWords: 5,
				note: { path: 'Q.md', kind: 'scene', exists: true },
				// The author's creation makes the first version the whole note.
				words: { added: 5, deleted: 0, net: 5 },
				versions: 1,
				at: at('09:00:00'),
				until: at('09:01:00'),
			}),
		]);
		expect(before.events).toBe(1);
		expect(after.events).toBe(2);
	});

	it('drops the same version synced back, keeps it kept again on one device, and reads a device against the one before', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('S.md', at('09:00:00'), 80, null, 'h1'),
					row('S.md', at('10:00:00'), 100, 20, 'h3', { prevTs: at('09:00:00') }),
				]),
				source('b', [
					// The same text synced back, half a minute later.
					row('S.md', at('09:00:30'), 80, null, 'h1'),
					row('S.md', at('09:30:00'), 90, null, 'h2'),
					// The same text kept again on the same device: a version its dialog lists.
					row('S.md', at('09:31:00'), 90, 0, 'h2', { prevTs: at('09:30:00') }),
				]),
			],
		});
		const day = dayOf(reading, D21);
		expect(notesOf(day.entries)).toEqual([
			expect.objectContaining({
				action: 'first-recorded',
				versions: 4,
				words: { added: 20, deleted: 0, net: 20 },
			}),
		]);
	});

	it('reads a baseline after a creation by its origin: the author counts, the plugin and an import do not', () => {
		const from = { projectId: 'src', title: 'Book One' };
		const reading = merge({
			snapshots: [
				source('a', [
					row('X.md', at('09:01:00'), 7, null, 'hx'),
					row('Y.md', at('09:01:00'), 40, null, 'hy'),
					row('Z.md', at('09:01:00'), 300, null, 'hz'),
				]),
			],
			events: [
				event('x', at('09:00:00'), 'created', note('X.md'), { words: 7 }),
				event('y', at('09:00:00'), 'created', note('Y.md'), { origin: 'plugin', words: 40 }),
				event('z', at('09:00:00'), 'created', note('Z.md'), { origin: 'import', importedFrom: from, words: 300 }),
			],
		});
		const byPath = new Map(notesOf(dayOf(reading, D21).entries).map((entry) => [entry.note.path, entry]));
		expect(byPath.get('X.md')).toMatchObject({ action: 'created', origin: 'user', createdWords: 7, words: { added: 7, net: 7 } });
		expect(byPath.get('Y.md')).toMatchObject({ action: 'created', origin: 'plugin', createdWords: 40, words: { added: 0, net: 0 }, versions: 1 });
		expect(byPath.get('Z.md')).toMatchObject({ action: 'imported', origin: 'import', importedFrom: from, words: { added: 0, net: 0 }, versions: 1 });
		expect(byPath.get('X.md')?.since).toBeUndefined();
	});

	it('lets a creation written down a moment after the first version claim it, and no later', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('P.md', at('09:01:00'), 7, null, 'hp'),
					row('Q.md', at('09:01:00'), 9, null, 'hq'),
				]),
			],
			events: [
				event('p', at('09:01:01'), 'created', note('P.md'), { words: 7 }),
				event('q', at('09:01:03'), 'created', note('Q.md'), { words: 9 }),
			],
		});
		const byPath = new Map(notesOf(dayOf(reading, D21).entries).map((entry) => [entry.note.path, entry]));
		expect(byPath.get('P.md')).toMatchObject({ action: 'created', words: { added: 7, net: 7 }, versions: 1 });
		expect(byPath.get('Q.md')).toMatchObject({ action: 'created', words: { added: 0, net: 0 }, versions: 1 });
	});

	it('names the day the words reach back to only past the day before', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('A.md', at('09:00:00'), 30, 10, 'ha', { prevTs: at('20:00:00', D20) }),
					row('B.md', at('09:00:00'), 30, 10, 'hb', { prevTs: at('20:00:00', D19) }),
				]),
			],
			events: [],
		});
		const byPath = new Map(notesOf(dayOf(reading, D21).entries).map((entry) => [entry.note.path, entry]));
		expect(byPath.get('A.md')?.since).toBeUndefined();
		expect(byPath.get('B.md')?.since).toBe(D19);
	});

	it('gives a deletion the words the note had, and nothing where no version was kept', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('N.md', at('09:00:00'), 100, null, 'h1'),
					row('N.md', at('10:00:00'), 120, 20, 'h2', { prevTs: at('09:00:00') }),
				]),
			],
			events: [
				event('n', at('11:00:00'), 'deleted', note('N.md')),
				event('m', at('12:00:00'), 'deleted', note('M.md', 'character')),
			],
			exists: () => false,
		});
		const day = dayOf(reading, D21);
		expect(notesOf(day.entries).map((entry) => [entry.note.path, entry.action, entry.words, entry.source, entry.versions])).toEqual([
			['N.md', 'first-recorded', { added: 20, deleted: 0, net: 20 }, 'snapshots', 2],
			['N.md', 'deleted', { added: 0, deleted: 120, net: -120 }, 'snapshots', 0],
			['M.md', 'deleted', { added: 0, deleted: 0, net: 0 }, 'ledger', 0],
		]);
		expect(day.words).toEqual({ added: 20, deleted: 120, net: -100 });
		expect(day.events).toBe(2);
		expect(day.sources).toEqual(['snapshots', 'ledger']);
	});

	it("reads a day's words from one source: versions first, then sessions, never the ledger", () => {
		const reading = merge({
			snapshots: [source('a', [row('S.md', at('09:00:00'), 20, 20, 'h1', { prevTs: at('20:00:00', D19) })])],
			events: [event('c', at('08:00:00'), 'created', note('C.md', 'character'), { words: 12 })],
			tallies: [
				session('s1', D21, at('09:30:00'), at('10:00:00'), [{ path: 'S.md', added: 50, deleted: 5, net: 45 }]),
				session('s2', D22, at('09:00:00', D22), at('09:30:00', D22), [
					{ path: 'S.md', added: 3, deleted: 0, net: 3 },
					{ path: 'U.md', added: 8, deleted: 0, net: 8 },
					{ path: 'V.md', added: 1, deleted: 0, net: 1 },
				]),
				{
					id: 'u1',
					kind: 'untimed',
					day: D22,
					startedAt: null,
					endedAt: null,
					focusMs: 0,
					files: [{ path: 'S.md', added: 9, deleted: 1, net: 8 }],
				},
			],
			classify: (path) => (path === 'U.md' ? { path, kind: 'character', documentType: 'character' } : null),
		});
		const first = dayOf(reading, D21);
		const byPath = new Map(notesOf(first.entries).map((entry) => [entry.note.path, entry]));
		expect(byPath.get('S.md')).toMatchObject({
			source: 'snapshots',
			words: { added: 20, deleted: 0, net: 20 },
			sessions: 1,
			since: D19,
			at: at('09:00:00'),
			until: at('10:00:00'),
		});
		expect(byPath.get('C.md')).toMatchObject({ action: 'created', source: 'ledger', words: { net: 0 }, createdWords: 12, sessions: 0 });
		expect(first.sessions).toBe(1);
		const second = dayOf(reading, D22);
		const later = new Map(notesOf(second.entries).map((entry) => [entry.note.path, entry]));
		expect(later.get('S.md')).toMatchObject({
			action: 'edited',
			source: 'sessions',
			words: { added: 12, deleted: 1, net: 11 },
			versions: 0,
			sessions: 1,
		});
		expect(later.get('U.md')).toMatchObject({
			note: { path: 'U.md', kind: 'character', documentType: 'character', exists: true },
			words: { added: 8, net: 8 },
		});
		expect(later.has('V.md')).toBe(false);
		expect(second.sources).toEqual(['sessions']);
	});

	it("buckets by the reader's zone", () => {
		const reading = merge({
			timeZone: 'Asia/Shanghai',
			snapshots: [source('a', [row('S.md', Date.parse('2026-10-21T23:30:00Z'), 10, null, 'h1')])],
			tallies: [
				session('s', D22, Date.parse('2026-10-21T22:30:00Z'), Date.parse('2026-10-22T00:30:00Z'), []),
			],
		});
		expect(dayOf(reading, D21).entries).toEqual([]);
		const day = dayOf(reading, D22);
		expect(notesOf(day.entries)).toHaveLength(1);
		expect(day.sessions).toBe(1);
		expect(reading.summary.sessions).toBe(1);
	});

	it('tells renames within a moment of one another as one, and a lone rename as itself', () => {
		const reading = merge({
			events: [
				event('r1', at('10:00:00.000'), 'renamed', note('A1.md'), { from: 'A.md' }),
				event('r2', at('10:00:01.000'), 'renamed', note('B1.md'), { from: 'B.md' }),
				event('r3', at('10:00:02.500'), 'renamed', note('C1.md'), { from: 'C.md' }),
				event('r4', at('10:05:00.000'), 'renamed', note('D1.md'), { from: 'D.md' }),
				event('r5', at('11:00:00.000'), 'renamed', note('E1.md'), { from: 'E.md', origin: 'inferred' }),
			],
		});
		const day = dayOf(reading, D21);
		expect(
			day.entries.map((entry) =>
				entry.kind === 'renamed'
					? [entry.id, entry.items.map((item) => `${item.from}>${item.note.path}`), entry.inferred]
					: entry.kind,
			),
		).toEqual([
			['rename:r1', ['A.md>A1.md', 'B.md>B1.md', 'C.md>C1.md'], false],
			['rename:r4', ['D.md>D1.md'], false],
			['rename:r5', ['E.md>E1.md'], true],
		]);
		expect(day.notes).toBe(5);
		expect(day.events).toBe(3);
	});

	it('tells the notes one import brought as one, and keeps a note worked on that day', () => {
		const from = { projectId: 'src', title: 'Book One' };
		const other = { projectId: 'other', title: 'Book Two' };
		const reading = merge({
			snapshots: [
				source('a', [
					row('I1.md', at('09:00:30'), 300, null, 'h1'),
					row('I2.md', at('09:03:30'), 200, null, 'h2'),
					row('I3.md', at('09:05:30'), 150, null, 'h3'),
					row('I2.md', at('15:00:00'), 250, 50, 'h4', { prevTs: at('09:03:30') }),
					row('J1.md', at('09:04:30'), 20, null, 'hj'),
					row('I1.md', at('16:00:00'), 310, 10, 'h5', { prevTs: at('09:00:30') }),
				]),
			],
			events: [
				event('i1', at('09:00:00'), 'created', note('I1.md'), { origin: 'import', importedFrom: from, words: 300 }),
				event('i2', at('09:03:00'), 'created', note('I2.md'), { origin: 'import', importedFrom: from, words: 200 }),
				event('i3', at('09:05:00'), 'imported', note('I3.md'), { origin: 'import', importedFrom: from }),
				event('j1', at('09:04:00'), 'created', note('J1.md', 'character'), { origin: 'import', importedFrom: other, words: 20 }),
			],
		});
		const day = dayOf(reading, D21);
		expect(day.entries.map((entry) => entry.kind === 'imported' ? ['imported', entry.notes.map((n) => n.path), entry.created, entry.replaced, entry.versions] : [entry.kind, (entry as HistoryNoteEntry).note.path, (entry as HistoryNoteEntry).action])).toEqual([
			// The versions the import itself landed are the group's, even where the note was worked on after.
			['imported', ['I1.md', 'I2.md', 'I3.md'], 2, 1, 3],
			['note', 'J1.md', 'imported'],
			// The note's entry starts where the day's own work did, and tells only that.
			['note', 'I2.md', 'edited'],
			['note', 'I1.md', 'edited'],
		]);
		const group = day.entries.find((entry) => entry.kind === 'imported');
		expect(group?.kind === 'imported' ? group.from : null).toEqual(from);
		const kept = notesOf(day.entries).find((entry) => entry.note.path === 'I2.md');
		expect(kept).toMatchObject({ versions: 1, words: { added: 50, net: 50 }, source: 'snapshots', at: at('15:00:00') });
		expect(kept?.importedFrom).toBeUndefined();
		expect(kept?.origin).toBeUndefined();
		expect(notesOf(day.entries).find((entry) => entry.note.path === 'I1.md')).toMatchObject({ versions: 1, words: { added: 10, net: 10 }, at: at('16:00:00') });
		expect(day.notes).toBe(4);
		expect(day.versions).toBe(6);
		expect(day.events).toBe(2);
		expect(day.words).toEqual({ added: 60, deleted: 0, net: 60 });
	});

	it('keeps every day of the span, and sums them', () => {
		const reading = merge({
			snapshots: [source('a', [row('S.md', at('09:00:00'), 10, 10, 'h1', { prevTs: at('08:00:00') })])],
		});
		expect(reading.days.map((day) => day.day)).toEqual([D20, D21, D22]);
		expect(dayOf(reading, D20).entries).toEqual([]);
		expect(dayOf(reading, D22).entries).toEqual([]);
		expect(reading.summary).toMatchObject({
			words: { added: 10, deleted: 0, net: 10 },
			versions: 1,
			notes: 1,
			sessions: 0,
			events: 0,
			sources: ['snapshots'],
		});
	});

	it('tells tasks, threads and revisions by their events, a revision by the name its note has now', () => {
		const reading = merge({
			events: [
				event('t1', at('09:00:00'), 'task-created', { type: 'task', id: 'task-1', title: 'Write' }),
				event('t2', at('09:30:00'), 'task-status', { type: 'task', id: 'task-1', title: 'Write' }, { status: 'done' }),
				event('f1', at('10:00:00'), 'thread-status', { type: 'thread', id: 'fs-1', name: 'The key' }, { status: 'resolved' }),
				event('v1', at('10:30:00'), 'revision-proposed', { type: 'revision', id: 'rev-1', note: { path: 'A.md', kind: 'scene' } }),
				event('r1', at('11:00:00'), 'renamed', note('B.md'), { from: 'A.md' }),
				event('v2', at('11:30:00'), 'revision-accepted', { type: 'revision', id: 'rev-1', note: { path: 'B.md', kind: 'scene' } }),
			],
		});
		const day = dayOf(reading, D21);
		expect(day.entries.map((entry) => [entry.kind, entry.id])).toEqual([
			['task', 't1'],
			['task', 't2'],
			['thread', 'f1'],
			['revision', 'v1'],
			['renamed', 'rename:r1'],
			['revision', 'v2'],
		]);
		expect(day.entries[1]).toMatchObject({ event: 'task-status', status: 'done', task: { id: 'task-1', title: 'Write' } });
		expect(day.entries[2]).toMatchObject({ event: 'thread-status', status: 'resolved', thread: { id: 'fs-1', name: 'The key' } });
		expect(day.entries[3]).toMatchObject({ event: 'revision-proposed', revision: { id: 'rev-1' }, note: { path: 'B.md', kind: 'scene' } });
		expect(day.entries[5]).toMatchObject({ event: 'revision-accepted', note: { path: 'B.md' } });
		expect(day.events).toBe(6);
		expect(day.notes).toBe(1);
	});

	it('tells an event told by two devices once, and a change one device made twice as twice', () => {
		const reading = merge({
			sources: [
				told('a', [
					event('same', at('09:00:00'), 'task-created', { type: 'task', id: 'task-1', title: 'Write' }),
					event('r-a', at('10:00:00'), 'renamed', note('B.md'), { from: 'A.md' }),
					event('d-a', at('12:00:00'), 'deleted', note('C.md')),
					// The note made again and deleted again by the same hand within the day.
					event('d-c', at('12:30:00'), 'deleted', note('C.md')),
				]),
				told('b', [
					// The same file synced over, and device a's changes replayed by the sync.
					event('same', at('09:00:00'), 'task-created', { type: 'task', id: 'task-1', title: 'Write' }),
					event('r-b', at('10:00:05'), 'renamed', note('B.md'), { from: 'A.md' }),
					event('d-b', at('12:00:40'), 'deleted', note('C.md')),
					event('d-d', at('12:31:00'), 'deleted', note('C.md')),
					// A day on, the same rename is another rename.
					event('r-c', at('11:00:00', D22), 'renamed', note('B.md'), { from: 'A.md' }),
				]),
			],
		});
		const first = dayOf(reading, D21);
		expect(first.entries.map((entry) => entry.id)).toEqual([
			'same',
			'rename:r-a',
			`${D21}:C.md:deleted:d-a`,
			`${D21}:C.md:deleted:d-c`,
		]);
		expect(dayOf(reading, D22).entries.map((entry) => entry.id)).toEqual(['rename:r-c']);
	});

	it('sums a day across its kinds of note', () => {
		const reading = merge({
			snapshots: [
				source('a', [
					row('20_Character/Ada.md', at('09:10:00'), 110, 10, 'c1', { kind: 'character', prevTs: at('09:00:00') }),
					row('60_Worldbuilding/61_Time/Dawn.md', at('09:20:00'), 55, 5, 'w1', { kind: 'worldbuilding', wbKind: 'time', prevTs: at('09:00:00') }),
					row('40_Scene/One.md', at('14:00:00'), 97, -3, 's1', { prevTs: at('09:00:00') }),
					row('40_Scene/Two.md', at('14:30:00'), 40, 4, 's2', { prevTs: at('09:00:00') }),
				]),
			],
		});
		const day = dayOf(reading, D21);
		expect(day.notes).toBe(4);
		expect(day.versions).toBe(4);
		expect(day.words).toEqual({ added: 19, deleted: 3, net: 16 });
		expect(reading.summary.words).toEqual({ added: 19, deleted: 3, net: 16 });
	});
});
