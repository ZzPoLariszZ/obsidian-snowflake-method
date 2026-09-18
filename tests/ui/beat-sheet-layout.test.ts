import { describe, expect, it } from 'vitest';

import type { Beat, BeatSheet, BeatSheetAct } from '../../src/domain';
import {
	actLandingAt,
	actTitle,
	assignedSceneIds,
	beatLandingAt,
	beatMoveIsNoop,
	beatPlaceName,
	beatStackKey,
	sheetAsLane,
	tableKey,
	tableOrder,
	type BeatLandingCandidate,
} from '../../src/ui/beat-sheet-layout';
import { splitKey } from '../../src/ui/timeline-layout';

const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(',')})`;

const beat = (id: string, extra: Partial<Beat> = {}): Beat => ({ id, name: `Beat ${id}`, description: '', rows: [], ...extra });
const act = (id: string, beats: Beat[], label = ''): BeatSheetAct => ({ id, label, beats });
const sheet = (acts: BeatSheetAct[]): BeatSheet => ({
	id: 's', name: 'Sheet', acts, presentation: null, showSubDescriptions: true, createdAt: 1, updatedAt: 1,
});

describe('the beat sheet layout', () => {
	it('sees a sheet as one lane of its beats, in the order the sheet is read', () => {
		const rows = [{ id: 'r1', text: 'Arrives', scenes: ['scene-1'] }];
		const lane = sheetAsLane(sheet([
			act('a1', [beat('b1', { rows }), beat('b2')]),
			act('a2', []),
			act('a3', [beat('b3')]),
		]));
		expect(lane.id).toBe('s');
		expect(lane.name).toBe('Sheet');
		expect(lane.times.map((time) => time.timeId)).toEqual(['b1', 'b2', 'b3']);
		// The rows are the beat's own, handed over and not copied: the cells compare them by identity.
		expect(lane.times[0]!.rows).toBe(rows);
	});

	it('gathers the scenes a sheet has placed, wherever on it', () => {
		const placed = assignedSceneIds(sheet([
			act('a1', [beat('b1', { rows: [{ id: 'r1', text: '', scenes: ['scene-1', 'scene-2'] }] })]),
			act('a2', [beat('b2', { rows: [{ id: 'r2', text: '', scenes: ['scene-3'] }, { id: 'r3', text: 'Bare', scenes: [] }] })]),
		]));
		expect([...placed].sort()).toEqual(['scene-1', 'scene-2', 'scene-3']);
		expect(assignedSceneIds(sheet([])).size).toBe(0);
	});

	it('keys a stack and a table entry so that neither can be mistaken for another', () => {
		expect(splitKey(beatStackKey('s', 'r1'))).toEqual(['s', 'r1']);
		// An act and its foot wear the same id, and an act's id may be a beat's: the kind keeps them apart.
		expect(new Set([tableKey('act', 'x'), tableKey('foot', 'x'), tableKey('beat', 'x')]).size).toBe(3);
		expect(splitKey(tableKey('beat', 'b1'))).toEqual(['beat', 'b1']);
	});

	it('reads the table act by act: a header, its beats with the first and the last marked, and a foot', () => {
		const entries = tableOrder(sheet([
			act('a1', [beat('b1'), beat('b2'), beat('b3')]),
			act('a2', []),
			act('a3', [beat('b4')]),
		]));
		expect(entries.map((entry) => `${entry.kind}:${entry.kind === 'beat' ? entry.beat.id : entry.act.id}`)).toEqual([
			'act:a1', 'beat:b1', 'beat:b2', 'beat:b3', 'foot:a1',
			'act:a2', 'foot:a2',
			'act:a3', 'beat:b4', 'foot:a3',
		]);
		expect(entries.filter((entry) => entry.kind === 'act').map((entry) => entry.kind === 'act' && entry.number)).toEqual([1, 2, 3]);
		const marks = entries.flatMap((entry) => (entry.kind === 'beat' ? [[entry.beat.id, entry.first, entry.last]] : []));
		expect(marks).toEqual([
			['b1', true, false],
			['b2', false, false],
			['b3', false, true],
			// A lone beat is both ends of its act's axis.
			['b4', true, true],
		]);
		expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
		expect(tableOrder(sheet([]))).toEqual([]);
	});

	it('calls an act by its number, and by its label too where it has one', () => {
		expect(actTitle(t, 2, '')).toBe('beatSheet.act.title(number=2)');
		expect(actTitle(t, 2, '   ')).toBe('beatSheet.act.title(number=2)');
		expect(actTitle(t, 1, '  Setup ')).toBe('beatSheet.act.titleLabelled(number=1,label=Setup)');
	});

	it('names where a beat stands by its act and itself, and nothing for a beat that has gone', () => {
		const held = sheet([act('a1', [beat('b1', { name: 'Catalyst' })], 'Setup'), act('a2', [beat('b2', { name: '  ' })])]);
		expect(beatPlaceName(t, held, 'b1')).toBe('beatSheet.act.titleLabelled(number=1,label=Setup) · Catalyst');
		expect(beatPlaceName(t, held, 'b2')).toBe('beatSheet.act.title(number=2) · beatSheet.beat.unnamed');
		expect(beatPlaceName(t, held, 'gone')).toBeNull();
	});

	describe('where a dragged beat lands', () => {
		// Two acts: a1 holds b1 and b2 (b2 being dragged, so left out), a2 is empty.
		const candidates: BeatLandingCandidate[] = [
			{ kind: 'beat', key: 'beat:b1', actId: 'a1', beatId: 'b1', middle: 60 },
			{ kind: 'foot', key: 'foot:a1', actId: 'a1', beatId: null, middle: 140 },
			{ kind: 'foot', key: 'foot:a2', actId: 'a2', beatId: null, middle: 200 },
		];

		it('lands before the first beat whose middle is below the pointer', () => {
			expect(beatLandingAt(candidates, 10)).toEqual({ key: 'beat:b1', actId: 'a1', beforeBeatId: 'b1' });
		});

		it("lands at an act's end on its foot, an empty act's included", () => {
			expect(beatLandingAt(candidates, 100)).toEqual({ key: 'foot:a1', actId: 'a1', beforeBeatId: null });
			expect(beatLandingAt(candidates, 180)).toEqual({ key: 'foot:a2', actId: 'a2', beforeBeatId: null });
		});

		it("lands at the last act's end past every entry, and nowhere with no act to land in", () => {
			expect(beatLandingAt(candidates, 900)).toEqual({ key: 'foot:a2', actId: 'a2', beforeBeatId: null });
			expect(beatLandingAt([], 10)).toBeNull();
		});
	});

	it('knows a move that would change nothing: onto itself, before its own neighbour, or to the end it already closes', () => {
		const held = sheet([act('a1', [beat('b1'), beat('b2'), beat('b3')]), act('a2', [beat('b4')])]);
		expect(beatMoveIsNoop(held, 'b1', 'a1', 'b1')).toBe(true);
		expect(beatMoveIsNoop(held, 'b1', 'a1', 'b2')).toBe(true);
		expect(beatMoveIsNoop(held, 'b3', 'a1', null)).toBe(true);
		// An anchor the act does not hold reads as the act's end, as the document's own move reads it.
		expect(beatMoveIsNoop(held, 'b3', 'a1', 'b4')).toBe(true);
		expect(beatMoveIsNoop(held, 'b1', 'a1', 'b3')).toBe(false);
		expect(beatMoveIsNoop(held, 'b1', 'a1', null)).toBe(false);
		// The same place in another act is a move.
		expect(beatMoveIsNoop(held, 'b3', 'a2', null)).toBe(false);
		expect(beatMoveIsNoop(held, 'gone', 'a1', null)).toBe(false);
	});

	it("lands a dragged act before the first act whose whole group's middle is below the pointer, or at the end", () => {
		const groups = [
			{ actId: 'a1', top: 0, bottom: 200 },
			{ actId: 'a3', top: 260, bottom: 300 },
		];
		expect(actLandingAt(groups, 50)).toEqual({ beforeActId: 'a1' });
		// Within the first group but past its middle: the act goes after it.
		expect(actLandingAt(groups, 150)).toEqual({ beforeActId: 'a3' });
		expect(actLandingAt(groups, 290)).toEqual({ beforeActId: null });
		expect(actLandingAt([], 0)).toEqual({ beforeActId: null });
	});
});
