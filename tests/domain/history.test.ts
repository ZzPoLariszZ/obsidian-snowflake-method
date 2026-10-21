import { describe, expect, it } from 'vitest';

import {
	EVENT_FILE_SUFFIX,
	HISTORY_EVENT_KINDS,
	SNAPSHOT_FILE_SUFFIX,
	emptyHistoryEventMonthFile,
	emptyNoteSnapshotMonthFile,
	historyFilePath,
	historyFolder,
	historyYearFolder,
	parseHistoryEventMonthFile,
	parseHistoryEventRecord,
	parseNoteSnapshotMonthFile,
	parseNoteSnapshotRecord,
	serializeHistoryEventMonthFile,
	serializeNoteSnapshotMonthFile,
	snapshotConvention,
	snapshotKey,
	subjectTypeOfEvent,
	withHistoryEvents,
	withSnapshots,
	type HistoryEventRecord,
	type NoteSnapshotMonthFile,
	type NoteSnapshotRecord,
} from '../../src/domain';

const root = 'Snowflake Projects/Novel';
const dir = '70_Tool/71_Data_Statistics/714_Modification_History';
// 2026-10-21 03:00 UTC.
const T0 = Date.UTC(2026, 9, 21, 3);

describe('where the modification history is filed', () => {
	it('keeps every year under the history folder, with or without a root', () => {
		expect(historyFolder(root, dir)).toBe(`${root}/${dir}`);
		expect(historyFolder('', dir)).toBe(dir);
		expect(historyYearFolder(root, dir, '2026')).toBe(`${root}/${dir}/2026`);
		expect(historyYearFolder('', dir, '2026')).toBe(`${dir}/2026`);
	});

	it('names a file with the year, the month, the device and the record kind', () => {
		expect(historyFilePath(root, dir, T0, 'UTC', 'device-1', SNAPSHOT_FILE_SUFFIX)).toBe(
			`${root}/${dir}/2026/2026_10_device-1_note_snapshots.json`,
		);
		expect(historyFilePath('', dir, T0, 'UTC', 'device-1', EVENT_FILE_SUFFIX)).toBe(
			`${dir}/2026/2026_10_device-1_history_events.json`,
		);
	});

	it('files the month by the day in the device zone', () => {
		// 2026-10-31 20:00 UTC is already November in Shanghai.
		const late = Date.UTC(2026, 9, 31, 20);
		expect(historyFilePath(root, dir, late, 'UTC', 'd', SNAPSHOT_FILE_SUFFIX)).toContain(
			'/2026/2026_10_d_',
		);
		expect(
			historyFilePath(root, dir, late, 'Asia/Shanghai', 'd', SNAPSHOT_FILE_SUFFIX),
		).toContain('/2026/2026_11_d_');
		// And the year folder turns with the month.
		const eve = Date.UTC(2026, 11, 31, 20);
		expect(historyFilePath(root, dir, eve, 'Asia/Shanghai', 'd', EVENT_FILE_SUFFIX)).toBe(
			`${root}/${dir}/2027/2027_01_d_history_events.json`,
		);
	});
});

// ---- The versions File recovery kept ----

const row = (overrides: Partial<NoteSnapshotRecord> = {}): NoteSnapshotRecord => ({
	path: '40_Scene/Twelve.md',
	kind: 'scene',
	ts: T0,
	words: 120,
	delta: null,
	hash: 'fp1-aaaa',
	...overrides,
});

const snapshotFile = (rows: NoteSnapshotRecord[]): NoteSnapshotMonthFile => ({
	schemaVersion: 1,
	countMode: 'qidian',
	countHeadings: 'count',
	snapshots: rows,
});

/** Through the text on disk and back, as the stores read it. */
const stored = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('reading stored versions back', () => {
	it('round-trips a snapshot file, every optional field with it', () => {
		const file = snapshotFile([
			row(),
			row({ ts: T0 + 300_000, words: 150, delta: 30, prevTs: T0, hash: 'fp1-bbbb' }),
			row({
				path: '60_Worldbuilding/62_Location/Harbour.md',
				kind: 'worldbuilding',
				wbKind: 'location',
				documentType: 'worldbuilding',
				countMode: 'ms-word',
				countHeadings: 'skip-h1',
			}),
			row({ path: '30_Synopsis/Plot.md', kind: 'step', step: 4, documentType: 'plot-synopsis' }),
			row({ path: '80_Material/Notes.md', kind: 'other' }),
		]);
		expect(parseNoteSnapshotMonthFile(stored(file))).toEqual(file);
		expect(parseNoteSnapshotMonthFile(JSON.parse(serializeNoteSnapshotMonthFile(file)))).toEqual(file);
		expect(serializeNoteSnapshotMonthFile(file).endsWith('\n')).toBe(true);
	});

	it.each([
		['a moment before the epoch', { ts: -1 }],
		['a moment that is not a number', { ts: '1' }],
		['a count below zero', { words: -5 }],
		['a delta that names no previous version', { delta: 3 }],
		['a previous version with no delta against it', { prevTs: T0 }],
		['a delta that is not a number', { delta: 'x' }],
		['a kind the history has no word for', { kind: 'poem' }],
		['an empty fingerprint', { hash: '' }],
		['a step that is not one note', { step: 3 }],
		['an empty path', { path: '' }],
		['a document type the plugin does not write', { documentType: 'poem' }],
	])('rejects a row with %s, and the file with it', (_what, overrides) => {
		const bad = { ...row(), ...overrides } as unknown;
		expect(parseNoteSnapshotRecord(bad)).toBeNull();
		expect(parseNoteSnapshotMonthFile(stored(snapshotFile([row(), bad as NoteSnapshotRecord])))).toBeNull();
	});

	it('rejects a file whose own header it cannot read', () => {
		expect(parseNoteSnapshotMonthFile({ ...snapshotFile([]), schemaVersion: 2 })).toBeNull();
		expect(parseNoteSnapshotMonthFile({ ...snapshotFile([]), countMode: '' })).toBeNull();
		expect(parseNoteSnapshotMonthFile({ ...snapshotFile([]), countHeadings: undefined })).toBeNull();
		expect(parseNoteSnapshotMonthFile({ ...snapshotFile([]), snapshots: {} })).toBeNull();
		expect(parseNoteSnapshotMonthFile([])).toBeNull();
		expect(parseNoteSnapshotMonthFile(null)).toBeNull();
	});

	it('drops a convention stamp it cannot read, and keeps the row', () => {
		expect(parseNoteSnapshotRecord({ ...row(), countMode: 7, countHeadings: '' })).toEqual(row());
	});

	it("reads a row's convention from the file unless the row says otherwise", () => {
		const file = emptyNoteSnapshotMonthFile('qidian', 'count');
		expect(snapshotConvention(file, row())).toEqual({ countMode: 'qidian', countHeadings: 'count' });
		expect(snapshotConvention(file, row({ countHeadings: 'skip-all' }))).toEqual({
			countMode: 'qidian',
			countHeadings: 'skip-all',
		});
	});

	it('adds rows once each, in order of their moments', () => {
		const first = row();
		const later = row({ ts: T0 + 600_000, hash: 'fp1-cccc' });
		const between = row({ ts: T0 + 300_000, hash: 'fp1-bbbb' });
		const file = withSnapshots(snapshotFile([later]), [first]);
		expect(file.snapshots).toEqual([first, later]);
		// The same version seen again stays as it was first kept, whatever
		// the second sighting says about it.
		const again = withSnapshots(file, [row({ hash: 'fp1-other', words: 1 }), between]);
		expect(again.snapshots).toEqual([first, between, later]);
		expect(snapshotKey(first)).toBe(`${String(T0)}:40_Scene/Twelve.md`);
		// Two notes at one moment come out in a fixed order.
		const other = row({ path: '20_Character/Ada.md', kind: 'character' });
		expect(withSnapshots(snapshotFile([first]), [other]).snapshots).toEqual([other, first]);
		// Nothing new, nothing rewritten.
		expect(withSnapshots(again, [first, later])).toBe(again);
		expect(withSnapshots(again, [])).toBe(again);
	});
});

// ---- The changes the plugin made ----

const event = (overrides: Partial<HistoryEventRecord> = {}): HistoryEventRecord => ({
	id: 'history-event-1',
	ts: T0,
	event: 'created',
	origin: 'user',
	subject: { type: 'note', path: '20_Character/Ada.md', kind: 'character' },
	words: 40,
	...overrides,
});

describe('reading stored events back', () => {
	it('round-trips an event file with every kind of subject', () => {
		const file = {
			schemaVersion: 1 as const,
			events: [
				event(),
				event({ id: 'history-event-2', event: 'renamed', from: '40_Scene/Eleven.md', words: undefined }),
				event({
					id: 'history-event-3',
					event: 'imported',
					origin: 'import',
					importedFrom: { projectId: 'project-1', title: 'Clocktower Snow' },
					words: undefined,
				}),
				event({
					id: 'history-event-4',
					event: 'task-status',
					subject: { type: 'task', id: 'task-1', title: 'Fix the ending' },
					status: 'done',
					words: undefined,
				}),
				event({
					id: 'history-event-5',
					event: 'thread-status',
					subject: { type: 'thread', id: 'thread-1', name: 'The locket' },
					status: 'resolved',
					words: undefined,
				}),
				event({
					id: 'history-event-6',
					event: 'revision-accepted',
					subject: {
						type: 'revision',
						id: 'revision-1',
						note: { path: '50_Manuscript/Three.md', kind: 'manuscript' },
					},
					words: undefined,
				}),
				event({
					id: 'history-event-7',
					event: 'task-archived',
					origin: 'plugin',
					subject: { type: 'task', id: 'task-1', title: 'Fix the ending' },
					words: undefined,
				}),
			],
		};
		// `words: undefined` is only how the helper is told to leave the field
		// off; the file on disk never has it, and the reading never does.
		const expected = stored(file);
		expect(parseHistoryEventMonthFile(expected)).toEqual(expected);
		expect(parseHistoryEventMonthFile(JSON.parse(serializeHistoryEventMonthFile(file)))).toEqual(expected);
		expect(parseHistoryEventRecord(stored(file.events[1]))).toHaveProperty('from', '40_Scene/Eleven.md');
	});

	it.each([
		['a task event about a note', { event: 'task-created' }],
		['a note event about a task', { subject: { type: 'task', id: 'task-1', title: 'x' } }],
		['a rename that says nothing about where from', { event: 'renamed' }],
		['a task moved to a thread status', { event: 'task-status', subject: { type: 'task', id: 't', title: 'x' }, status: 'resolved' }],
		['a thread marked with a task status', { event: 'thread-status', subject: { type: 'thread', id: 't', name: 'x' }, status: 'done' }],
		['an import from nowhere', { importedFrom: { projectId: '', title: 'x' } }],
		['a count below zero', { words: -1 }],
		['an origin the history has no word for', { origin: 'sync' }],
		['an event the history has no word for', { event: 'edited' }],
		['an empty id', { id: '' }],
		['a moment that is not a number', { ts: 'now' }],
		['a revision in a note the history has no word for', {
			event: 'revision-proposed',
			subject: { type: 'revision', id: 'r', note: { path: 'x.md', kind: 'poem' } },
		}],
		['a subject of no known type', { subject: { type: 'chapter', id: 'c' } }],
	])('rejects an event with %s, and the file with it', (_what, overrides) => {
		const bad = { ...event(), ...overrides } as unknown;
		expect(parseHistoryEventRecord(bad)).toBeNull();
		expect(
			parseHistoryEventMonthFile(stored({ schemaVersion: 1, events: [event(), bad] })),
		).toBeNull();
	});

	it('reads a where-from or a status off no event but its own', () => {
		expect(parseHistoryEventRecord({ ...event(), from: 'Old.md', status: 'done' })).toEqual(event());
	});

	it('rejects a file whose own header it cannot read', () => {
		expect(parseHistoryEventMonthFile({ schemaVersion: 2, events: [] })).toBeNull();
		expect(parseHistoryEventMonthFile({ schemaVersion: 1, events: {} })).toBeNull();
		expect(parseHistoryEventMonthFile('[]')).toBeNull();
		expect(emptyHistoryEventMonthFile()).toEqual({ schemaVersion: 1, events: [] });
	});

	it('adds events once each by id, in order of their moments', () => {
		const first = event();
		const later = event({ id: 'history-event-2', ts: T0 + 60_000 });
		const file = withHistoryEvents(emptyHistoryEventMonthFile(), [later, first]);
		expect(file.events).toEqual([first, later]);
		// A second device's copy of the same event is the same event.
		const again = withHistoryEvents(file, [event({ ts: T0 + 1 })]);
		expect(again).toBe(file);
		expect(withHistoryEvents(file, []).events).toEqual([first, later]);
	});

	it('knows which subject each kind of event is about', () => {
		expect(HISTORY_EVENT_KINDS).toHaveLength(14);
		for (const kind of HISTORY_EVENT_KINDS) {
			const [head] = kind.split('-');
			const expected =
				head === 'task' || head === 'thread' || head === 'revision' ? head : 'note';
			expect([kind, subjectTypeOfEvent(kind)]).toEqual([kind, expected]);
		}
	});
});
