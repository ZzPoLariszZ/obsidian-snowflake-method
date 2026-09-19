import { describe, expect, it } from 'vitest';

import type { Beat, BeatSheet, BeatSheetAct } from '../../src/domain';
import {
	actLandingAt,
	actTitle,
	assignedSceneIds,
	beatLandingAt,
	beatPlaceName,
	beatStackKey,
	sheetAsLane,
	shownActs,
	shownBeats,
	storedAnchor,
	storedDirection,
	tableKey,
	tableOrder,
	type BeatLandingCandidate,
} from '../../src/ui/beat-sheet-layout';
import { splitKey } from '../../src/ui/timeline-layout';

const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(',')})`;

const beat = (id: string, extra: Partial<Beat> = {}): Beat => ({ id, name: `Beat ${id}`, description: '', rows: [], ...extra });
const act = (id: string, beats: Beat[], label = ''): BeatSheetAct => ({ id, label, beats });
const sheet = (acts: BeatSheetAct[], reversed = false): BeatSheet => ({
	id: 's', name: 'Sheet', acts, presentation: null, showSubDescriptions: true, reversed, createdAt: 1, updatedAt: 1,
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

	it('reads the table act by act: a header, its beats with the first marked, and a foot', () => {
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
		// An act's axis is drawn from its first beat; where it ends is the foot of the last one's cell, which needs no mark.
		const marks = entries.flatMap((entry) => (entry.kind === 'beat' ? [[entry.beat.id, entry.first]] : []));
		expect(marks).toEqual([['b1', true], ['b2', false], ['b3', false], ['b4', true]]);
		expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
		expect(tableOrder(sheet([]))).toEqual([]);
	});

	describe('a sheet shown from its end', () => {
		const rows = [{ id: 'r1', text: 'First', scenes: [] }, { id: 'r2', text: 'Second', scenes: [] }];
		const acts = (): BeatSheetAct[] => [
			act('a1', [beat('b1', { rows }), beat('b2'), beat('b3')]),
			act('a2', []),
			act('a3', [beat('b4')]),
		];

		it('runs its acts and each act\'s beats the other way, and keeps each act the number the story gives it', () => {
			const turned = sheet(acts(), true);
			expect(shownActs(turned).map((entry) => entry.id)).toEqual(['a3', 'a2', 'a1']);
			expect(shownBeats(turned, turned.acts[0]!).map((entry) => entry.id)).toEqual(['b3', 'b2', 'b1']);
			const entries = tableOrder(turned);
			expect(entries.map((entry) => `${entry.kind}:${entry.kind === 'beat' ? entry.beat.id : entry.act.id}`)).toEqual([
				'act:a3', 'beat:b4', 'foot:a3',
				'act:a2', 'foot:a2',
				'act:a1', 'beat:b3', 'beat:b2', 'beat:b1', 'foot:a1',
			]);
			expect(entries.flatMap((entry) => (entry.kind === 'act' ? [[entry.act.id, entry.number]] : []))).toEqual([['a3', 3], ['a2', 2], ['a1', 1]]);
			// The axis is drawn from the first beat as the screen has them.
			expect(entries.flatMap((entry) => (entry.kind === 'beat' ? [[entry.beat.id, entry.first]] : []))).toEqual([
				['b4', true], ['b3', true], ['b2', false], ['b1', false],
			]);
			// Nothing is turned about in what the sheet keeps, and a sheet shown from its beginning is handed over as it is kept.
			expect(turned.acts.map((entry) => entry.id)).toEqual(['a1', 'a2', 'a3']);
			expect(shownActs(sheet(acts())).map((entry) => entry.id)).toEqual(['a1', 'a2', 'a3']);
		});

		it('leaves what stands under a beat as it is kept, and hands the cells the beats as the screen has them', () => {
			const lane = sheetAsLane(sheet(acts(), true));
			expect(lane.times.map((time) => time.timeId)).toEqual(['b4', 'b3', 'b2', 'b1']);
			expect(lane.times[3]!.rows).toBe(rows);
			expect(lane.times[3]!.rows.map((row) => row.id)).toEqual(['r1', 'r2']);
		});

		it('says a place named on the screen as the document keeps it', () => {
			// Shown as kept, the anchor is handed over as it stands.
			expect(storedAnchor(['b1', 'b2', 'b3'], 'b2', false)).toBe('b2');
			expect(storedAnchor(['b1', 'b2', 'b3'], null, false)).toBeNull();
			// Shown from its end, b3 over b2 over b1. Before b2 on the screen is after it in the story: before b3.
			expect(storedAnchor(['b3', 'b2', 'b1'], 'b2', true)).toBe('b3');
			// Before the one at the head of the screen is the story's end.
			expect(storedAnchor(['b3', 'b2', 'b1'], 'b3', true)).toBeNull();
			// The foot of the screen is the story's beginning: before the one shown last.
			expect(storedAnchor(['b3', 'b2', 'b1'], null, true)).toBe('b1');
			// An anchor the list does not hold reads as the foot, and an empty list has one place.
			expect(storedAnchor(['b3', 'b2', 'b1'], 'gone', true)).toBe('b1');
			expect(storedAnchor([], null, true)).toBeNull();
		});

		it('takes a step up the screen as a step down the story, and the other way about', () => {
			expect([storedDirection('up', false), storedDirection('down', false)]).toEqual(['up', 'down']);
			expect([storedDirection('up', true), storedDirection('down', true)]).toEqual(['down', 'up']);
		});
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
			{ key: 'beat:b1', actId: 'a1', beatId: 'b1', middle: 60 },
			{ key: 'foot:a1', actId: 'a1', beatId: null, middle: 140 },
			{ key: 'foot:a2', actId: 'a2', beatId: null, middle: 200 },
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
