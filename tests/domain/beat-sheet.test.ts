import { describe, expect, it } from 'vitest';

import {
	addBeat,
	addBeatRow,
	addBeatSheetAct,
	beatScenePlacements,
	beatSheetActStep,
	beatSheetFromStructure,
	beatSheetStructureOf,
	beatSheetTemplateNamesake,
	beatStep,
	createBeatSheet,
	deleteBeat,
	deleteBeatRow,
	deleteBeatSheet,
	deleteBeatSheetAct,
	deleteBeatSheetTemplate,
	derivedBeatSheetPresentation,
	editBeat,
	editBeatRow,
	emptyBeatSheetDocument,
	findBeat,
	findBeatRow,
	moveBeat,
	moveBeatRow,
	moveBeatSheetAct,
	placeBeatScene,
	readBeatSheet,
	readBeatSheetDocument,
	readBeatSheetTemplate,
	relabelBeatSheetAct,
	removeBeatScene,
	renameBeatSheet,
	saveBeatSheetTemplate,
	serializeBeatSheetDocument,
	setBeatSheetPresentation,
	setBeatSheetReversed,
	setBeatSheetSubDescriptions,
	setLastBeatSheet,
	shownBeatSheetId,
	type Beat,
	type BeatRow,
	type BeatSheet,
	type BeatSheetAct,
	type BeatSheetDocument,
	type BeatSheetTemplate,
} from '../../src/domain';

const row = (id: string, text = '', scenes: readonly string[] = []): BeatRow => ({ id, text, scenes });
const beat = (id: string, rows: readonly BeatRow[] = [], extra: Partial<Beat> = {}): Beat => ({
	id, name: `Beat ${id}`, description: '', rows, ...extra,
});
const act = (id: string, beats: readonly Beat[] = [], label = ''): BeatSheetAct => ({ id, label, beats });
const sheet = (id: string, acts: readonly BeatSheetAct[] = [], extra: Partial<BeatSheet> = {}): BeatSheet => ({
	id, name: `Sheet ${id}`, acts, presentation: null, showSubDescriptions: true, reversed: false, createdAt: 1, updatedAt: 1, ...extra,
});
const template = (id: string, name: string, extra: Partial<BeatSheetTemplate> = {}): BeatSheetTemplate => ({
	id, name, description: '', acts: [], createdAt: 1, updatedAt: 1, ...extra,
});
const doc = (sheets: readonly BeatSheet[] = [], extra: Partial<BeatSheetDocument> = {}): BeatSheetDocument => ({
	...emptyBeatSheetDocument(), sheets, ...extra,
});

/** The ids of a sheet's beats, act by act: the shape every move is checked against. */
const layout = (held: BeatSheetDocument | null, sheetId = 's'): string[][] =>
	held?.sheets.find((entry) => entry.id === sheetId)?.acts.map((entry) => entry.beats.map((b) => b.id)) ?? [];
const actIds = (held: BeatSheetDocument | null, sheetId = 's'): string[] =>
	held?.sheets.find((entry) => entry.id === sheetId)?.acts.map((entry) => entry.id) ?? [];
const rowsOf = (held: BeatSheetDocument | null, beatId: string, sheetId = 's'): BeatRow[] => {
	const found = held?.sheets.find((entry) => entry.id === sheetId);
	return found === undefined ? [] : [...(findBeat(found, beatId)?.beat.rows ?? [])];
};

const threeActs = (): BeatSheetDocument => doc([sheet('s', [
	act('a1', [beat('b1'), beat('b2')], 'Setup'),
	act('a2', []),
	act('a3', [beat('b3')], 'Resolution'),
])]);

describe('reading a stored beat sheet', () => {
	it('starts a project on no sheet at all, since a sheet is made from a template its author picks', () => {
		const fresh = emptyBeatSheetDocument();
		expect(fresh.sheets).toEqual([]);
		expect(fresh.templates).toEqual([]);
		expect(fresh.lastSheetId).toBeNull();
	});

	it('needs an id and a name, and reads the rest as far as it goes', () => {
		expect(readBeatSheet(null)).toBeNull();
		expect(readBeatSheet({ name: 'No id' })).toBeNull();
		expect(readBeatSheet({ id: 's', name: 7 })).toBeNull();
		expect(readBeatSheet({ id: 's', name: 'Bare' })).toEqual(sheet('s', [], { name: 'Bare', createdAt: 0, updatedAt: 0 }));
		const read = readBeatSheet({ id: 's', name: 'S', acts: 'none', presentation: 'pile', showSubDescriptions: false, createdAt: 5, updatedAt: 'late' });
		expect(read).toMatchObject({ acts: [], presentation: null, showSubDescriptions: false, createdAt: 5, updatedAt: 0 });
		expect(readBeatSheet({ id: 's', name: 'S', presentation: 'stack' })?.presentation).toBe('stack');
		// A sheet is shown from its beginning unless the file says plainly that it is turned about.
		expect(readBeatSheet({ id: 's', name: 'S' })?.reversed).toBe(false);
		expect(readBeatSheet({ id: 's', name: 'S', reversed: 'yes' })?.reversed).toBe(false);
		expect(readBeatSheet({ id: 's', name: 'S', reversed: true })?.reversed).toBe(true);
	});

	it('never reads an act\'s number from the file, and reads a label or words that are not a string as none', () => {
		const read = readBeatSheet({ id: 's', name: 'S', acts: [{ id: 'a1', number: 9, label: 4, beats: [{ id: 'b1', name: null, description: 3 }] }] });
		expect(read?.acts).toEqual([{ id: 'a1', label: '', beats: [{ id: 'b1', name: '', description: '', rows: [] }] }]);
	});

	it('gathers an act named twice and a beat named twice, keeping each first place and its words', () => {
		const read = readBeatSheet({
			id: 's', name: 'S',
			acts: [
				{ id: 'a1', label: 'First', beats: [{ id: 'b1', name: 'Opening', rows: [{ id: 'r1', text: 'One' }] }] },
				{ id: 'a2', label: 'Second', beats: [{ id: 'b1', name: 'A twin', rows: [{ id: 'r2', text: 'Two' }] }] },
				{ id: 'a1', label: 'A twin', beats: [{ id: 'b2', name: 'Later' }] },
			],
		});
		expect(read?.acts.map((entry) => [entry.id, entry.label, entry.beats.map((b) => b.id)])).toEqual([
			['a1', 'First', ['b1', 'b2']],
			['a2', 'Second', []],
		]);
		const gathered = read!.acts[0]!.beats[0]!;
		expect(gathered.name).toBe('Opening');
		expect(gathered.rows.map((entry) => entry.text)).toEqual(['One', 'Two']);
	});

	it('drops a row id met twice, keeps a scene where the sheet first placed it, and passes over what has no id', () => {
		const read = readBeatSheet({
			id: 's', name: 'S',
			acts: [
				{ label: 'No id', beats: [{ id: 'lost', name: 'Gone with its act' }] },
				{ id: 'a1', beats: [
					{ name: 'No id' },
					{ id: 'b1', name: 'B1', rows: [{ id: 'r1', text: 'Kept', scenes: ['scene-1', 'scene-2'] }, { id: 'r1', text: 'A twin' }] },
					{ id: 'b2', name: 'B2', rows: [{ id: 'r2', text: '', scenes: ['scene-2', 'scene-3'] }] },
				] },
			],
		});
		expect(read?.acts).toHaveLength(1);
		expect(read?.acts[0]!.beats.map((b) => b.id)).toEqual(['b1', 'b2']);
		expect(read?.acts[0]!.beats[0]!.rows).toEqual([row('r1', 'Kept', ['scene-1', 'scene-2'])]);
		expect(read?.acts[0]!.beats[1]!.rows).toEqual([row('r2', '', ['scene-3'])]);
	});

	it('reads a template leniently, with no ids under it', () => {
		expect(readBeatSheetTemplate({ name: 'No id' })).toBeNull();
		expect(readBeatSheetTemplate({ id: 't', name: 'Mine', acts: [{ label: 'One', beats: [{ name: 'Opening', description: 'Where it begins' }, 'junk', { name: 4 }] }, 'junk'] })).toEqual({
			id: 't', name: 'Mine', description: '', createdAt: 0, updatedAt: 0,
			acts: [{ label: 'One', beats: [{ name: 'Opening', description: 'Where it begins' }, { name: '', description: '' }] }],
		});
	});

	it('reads a document, keeping what it cannot read or place as strays, and the last sheet as found', () => {
		expect(readBeatSheetDocument({ sheets: [] })).toBeNull();
		expect(readBeatSheetDocument({ sheets: 'none', templates: [] })).toBeNull();
		const junk = { name: 'No id' };
		const twin = { id: 's', name: 'A twin' };
		const read = readBeatSheetDocument({
			sheets: [{ id: 's', name: 'S' }, junk, twin],
			templates: [{ id: 't', name: 'T' }, 'junk'],
			lastSheetId: 'someone-newer',
		});
		expect(read?.sheets.map((entry) => entry.name)).toEqual(['S']);
		expect(read?.strays.sheets).toEqual([junk, twin]);
		expect(read?.templates.map((entry) => entry.name)).toEqual(['T']);
		expect(read?.strays.templates).toEqual(['junk']);
		expect(read?.lastSheetId).toBe('someone-newer');
		expect(readBeatSheetDocument({ sheets: [], templates: [], lastSheetId: '' })?.lastSheetId).toBeNull();
	});

	it('writes the readable entries first and the strays after them', () => {
		const held = doc([sheet('s')], { templates: [template('t', 'T')], lastSheetId: 's', strays: { sheets: [{ odd: true }], templates: ['junk'] } });
		expect(serializeBeatSheetDocument(held)).toEqual({
			sheets: [sheet('s'), { odd: true }],
			templates: [template('t', 'T'), 'junk'],
			lastSheetId: 's',
		});
	});

	it('takes a stray out with the entry that shadowed it, and keeps one no reader can place', () => {
		const twin = { id: 's', name: 'A twin' };
		const junk = { odd: true };
		const held = doc([sheet('s')], { strays: { sheets: [twin, junk], templates: [] } });
		expect(deleteBeatSheet(held, 's')?.strays.sheets).toEqual([junk]);
		const templates = doc([], { templates: [template('t', 'T')], strays: { sheets: [], templates: [{ id: 't', name: 'A twin' }, junk] } });
		expect(deleteBeatSheetTemplate(templates, 't')?.strays.templates).toEqual([junk]);
	});
});

describe('sheets', () => {
	it('appends a sheet as its own reader would serve it, makes it the one opened last, and refuses a twin', () => {
		const made = createBeatSheet(doc([sheet('first')], { lastSheetId: 'first' }), sheet('s', [act('a1', [beat('b1')])]));
		expect(made?.sheets.map((entry) => entry.id)).toEqual(['first', 's']);
		expect(made?.lastSheetId).toBe('s');
		expect(createBeatSheet(made!, sheet('s'))).toBeNull();
	});

	it('renames, sets how the scenes are shown and whether the words are, stamping the change and writing nothing for none', () => {
		const held = doc([sheet('s')]);
		expect(renameBeatSheet(held, 's', 'Sheet s', 9)).toBeNull();
		expect(renameBeatSheet(held, 'gone', 'X', 9)).toBeNull();
		expect(renameBeatSheet(held, 's', 'Renamed', 9)?.sheets[0]).toMatchObject({ name: 'Renamed', updatedAt: 9, createdAt: 1 });
		expect(setBeatSheetPresentation(held, 's', null, 9)).toBeNull();
		expect(setBeatSheetPresentation(held, 's', 'stack', 9)?.sheets[0]).toMatchObject({ presentation: 'stack', updatedAt: 9 });
		expect(setBeatSheetSubDescriptions(held, 's', true, 9)).toBeNull();
		expect(setBeatSheetSubDescriptions(held, 's', false, 9)?.sheets[0]?.showSubDescriptions).toBe(false);
	});

	it('turns the showing of a sheet about and leaves the order it keeps alone', () => {
		const held = doc([sheet('s', [
			act('a1', [beat('b1', [row('r1', 'First'), row('r2', 'Second')]), beat('b2')], 'Setup'),
			act('a2', [beat('b3')]),
		])]);
		expect(setBeatSheetReversed(held, 's', false, 9)).toBeNull();
		expect(setBeatSheetReversed(held, 'gone', true, 9)).toBeNull();
		const turned = setBeatSheetReversed(held, 's', true, 9)!;
		expect(turned.sheets[0]).toMatchObject({ reversed: true, updatedAt: 9 });
		// The acts, the beats and the rows under them stand as they stood: the story has not moved.
		expect(turned.sheets[0]!.acts).toBe(held.sheets[0]!.acts);
		expect(readBeatSheetDocument(JSON.parse(JSON.stringify(serializeBeatSheetDocument(turned))) as Record<string, unknown>)?.sheets[0]?.reversed).toBe(true);
		expect(setBeatSheetReversed(turned, 's', false, 10)?.sheets[0]).toMatchObject({ reversed: false, updatedAt: 10 });
	});

	it('deletes a sheet and the memory of it as the last one opened', () => {
		const held = doc([sheet('s'), sheet('other')], { lastSheetId: 's' });
		const gone = deleteBeatSheet(held, 's');
		expect(gone?.sheets.map((entry) => entry.id)).toEqual(['other']);
		expect(gone?.lastSheetId).toBeNull();
		expect(deleteBeatSheet(held, 'other')?.lastSheetId).toBe('s');
		expect(deleteBeatSheet(held, 'gone')).toBeNull();
	});

	it('remembers the sheet opened last, or none, and shows the one picked, else that one, else the first', () => {
		const held = doc([sheet('s'), sheet('other')]);
		expect(setLastBeatSheet(held, 'gone')).toBeNull();
		expect(setLastBeatSheet(held, null)).toBeNull();
		const remembered = setLastBeatSheet(held, 'other')!;
		expect(remembered.lastSheetId).toBe('other');
		expect(remembered.sheets[1]).toBe(held.sheets[1]);
		expect(shownBeatSheetId(remembered, 's')).toBe('s');
		expect(shownBeatSheetId(remembered, 'gone')).toBe('other');
		expect(shownBeatSheetId(remembered, null)).toBe('other');
		expect(shownBeatSheetId(held, null)).toBe('s');
		expect(shownBeatSheetId(doc(), null)).toBeNull();
	});

	it('shows a sheet flat unless it says otherwise', () => {
		expect(derivedBeatSheetPresentation(sheet('s'))).toBe('flat');
		expect(derivedBeatSheetPresentation(sheet('s', [], { presentation: 'stack' }))).toBe('stack');
	});
});

describe('acts', () => {
	it('adds an act at the end, before another, or at the end when the anchor has gone, and refuses a twin', () => {
		const held = threeActs();
		expect(actIds(addBeatSheetAct(held, 's', { id: 'new', label: '' }, null, 9))).toEqual(['a1', 'a2', 'a3', 'new']);
		expect(actIds(addBeatSheetAct(held, 's', { id: 'new', label: 'Mid' }, 'a2', 9))).toEqual(['a1', 'new', 'a2', 'a3']);
		expect(actIds(addBeatSheetAct(held, 's', { id: 'new', label: '' }, 'gone', 9))).toEqual(['a1', 'a2', 'a3', 'new']);
		expect(addBeatSheetAct(held, 's', { id: 'a1', label: '' }, null, 9)).toBeNull();
		expect(addBeatSheetAct(held, 'gone', { id: 'new', label: '' }, null, 9)).toBeNull();
	});

	it('relabels an act, to no label as well, writing nothing for the same words', () => {
		const held = threeActs();
		expect(relabelBeatSheetAct(held, 's', 'a1', 'Setup', 9)).toBeNull();
		expect(relabelBeatSheetAct(held, 's', 'gone', 'X', 9)).toBeNull();
		expect(relabelBeatSheetAct(held, 's', 'a1', '', 9)?.sheets[0]?.acts[0]?.label).toBe('');
	});

	it('moves an act with all under it, so its number follows its place', () => {
		const held = threeActs();
		const moved = moveBeatSheetAct(held, 's', 'a3', 'a2', 9);
		expect(actIds(moved)).toEqual(['a1', 'a3', 'a2']);
		expect(layout(moved)).toEqual([['b1', 'b2'], ['b3'], []]);
		expect(actIds(moveBeatSheetAct(held, 's', 'a1', null, 9))).toEqual(['a2', 'a3', 'a1']);
		expect(moveBeatSheetAct(held, 's', 'a3', null, 9)).toBeNull();
		expect(moveBeatSheetAct(held, 's', 'gone', null, 9)).toBeNull();
	});

	it('steps an act up and down, with nowhere to go at the sheet\'s two ends', () => {
		const held = threeActs().sheets[0]!;
		expect(beatSheetActStep(held, 'a1', 'up')).toBeNull();
		expect(beatSheetActStep(held, 'a3', 'down')).toBeNull();
		expect(beatSheetActStep(held, 'a2', 'up')).toEqual({ beforeActId: 'a1' });
		expect(beatSheetActStep(held, 'a1', 'down')).toEqual({ beforeActId: 'a3' });
		expect(beatSheetActStep(held, 'a2', 'down')).toEqual({ beforeActId: null });
		expect(beatSheetActStep(held, 'gone', 'up')).toBeNull();
	});

	it('deletes an act with its beats, their rows and their placements', () => {
		const held = doc([sheet('s', [act('a1', [beat('b1', [row('r1', 'Words', ['scene-1'])])]), act('a2')])]);
		const gone = deleteBeatSheetAct(held, 's', 'a1', 9);
		expect(actIds(gone)).toEqual(['a2']);
		expect(beatScenePlacements(gone!.sheets[0]!).size).toBe(0);
		expect(deleteBeatSheetAct(held, 's', 'gone', 9)).toBeNull();
	});
});

describe('beats', () => {
	it('adds a beat to an act, before another of its beats or at the end, refusing a lost act or a twin anywhere in the sheet', () => {
		const held = threeActs();
		const draft = { id: 'new', name: 'New', description: 'What it is for' };
		expect(layout(addBeat(held, 's', 'a1', draft, 'b2', 9))).toEqual([['b1', 'new', 'b2'], [], ['b3']]);
		expect(layout(addBeat(held, 's', 'a2', draft, null, 9))).toEqual([['b1', 'b2'], ['new'], ['b3']]);
		expect(layout(addBeat(held, 's', 'a1', draft, 'b3', 9))).toEqual([['b1', 'b2', 'new'], [], ['b3']]);
		expect(addBeat(held, 's', 'gone', draft, null, 9)).toBeNull();
		expect(addBeat(held, 's', 'a2', { ...draft, id: 'b3' }, null, 9)).toBeNull();
		const added = addBeat(held, 's', 'a2', draft, null, 9)!;
		expect(findBeat(added.sheets[0]!, 'new')?.beat).toEqual({ id: 'new', name: 'New', description: 'What it is for', rows: [] });
	});

	it('edits a beat\'s name, its description or both, leaving what is not named as it stands', () => {
		const held = doc([sheet('s', [act('a1', [beat('b1', [], { name: 'Old', description: 'Was' })])])]);
		expect(editBeat(held, 's', 'b1', { name: 'Old' }, 9)).toBeNull();
		expect(editBeat(held, 's', 'b1', {}, 9)).toBeNull();
		expect(editBeat(held, 's', 'gone', { name: 'X' }, 9)).toBeNull();
		expect(findBeat(editBeat(held, 's', 'b1', { name: 'New' }, 9)!.sheets[0]!, 'b1')?.beat).toMatchObject({ name: 'New', description: 'Was' });
		expect(findBeat(editBeat(held, 's', 'b1', { description: '' }, 9)!.sheets[0]!, 'b1')?.beat).toMatchObject({ name: 'Old', description: '' });
	});

	it('moves a beat within its act, into another, onto an empty one, and to an act\'s end when the anchor is not there', () => {
		const held = threeActs();
		expect(layout(moveBeat(held, 's', 'b2', 'a1', 'b1', 9))).toEqual([['b2', 'b1'], [], ['b3']]);
		expect(layout(moveBeat(held, 's', 'b1', 'a3', 'b3', 9))).toEqual([['b2'], [], ['b1', 'b3']]);
		expect(layout(moveBeat(held, 's', 'b1', 'a2', null, 9))).toEqual([['b2'], ['b1'], ['b3']]);
		expect(layout(moveBeat(held, 's', 'b3', 'a1', 'gone', 9))).toEqual([['b1', 'b2', 'b3'], [], []]);
	});

	it('carries a beat\'s rows and their scenes with it', () => {
		const held = doc([sheet('s', [act('a1', [beat('b1', [row('r1', 'Words', ['scene-1'])])]), act('a2')])]);
		const moved = moveBeat(held, 's', 'b1', 'a2', null, 9)!;
		expect(rowsOf(moved, 'b1')).toEqual([row('r1', 'Words', ['scene-1'])]);
		expect(beatScenePlacements(moved.sheets[0]!).get('scene-1')).toEqual({ actId: 'a2', beatId: 'b1', rowId: 'r1', index: 0 });
	});

	it('writes nothing for a beat that already stands there, a beat or an act the sheet lacks, or itself as the anchor', () => {
		const held = threeActs();
		expect(moveBeat(held, 's', 'b1', 'a1', 'b2', 9)).toBeNull();
		expect(moveBeat(held, 's', 'b2', 'a1', null, 9)).toBeNull();
		expect(moveBeat(held, 's', 'b1', 'a1', 'b1', 9)).toBeNull();
		// An anchor the act does not hold reads as the act's end, which the beat that closes it is at already.
		expect(moveBeat(held, 's', 'b2', 'a1', 'b3', 9)).toBeNull();
		expect(moveBeat(held, 's', 'gone', 'a1', null, 9)).toBeNull();
		expect(moveBeat(held, 's', 'b1', 'gone', null, 9)).toBeNull();
	});

	it('steps a beat through the sheet as it is read: within its act, across an act\'s edge, through an empty act, and nowhere at the two ends', () => {
		const held = threeActs().sheets[0]!;
		expect(beatStep(held, 'b1', 'up')).toBeNull();
		expect(beatStep(held, 'b2', 'up')).toEqual({ actId: 'a1', beforeBeatId: 'b1' });
		expect(beatStep(held, 'b1', 'down')).toEqual({ actId: 'a1', beforeBeatId: null });
		// Off the end of its act, a beat lands in the act below, the empty one here, and from there in the one after.
		expect(beatStep(held, 'b2', 'down')).toEqual({ actId: 'a2', beforeBeatId: null });
		expect(beatStep(held, 'b3', 'up')).toEqual({ actId: 'a2', beforeBeatId: null });
		expect(beatStep(held, 'b3', 'down')).toBeNull();
		expect(beatStep(held, 'gone', 'up')).toBeNull();
		const stepped = moveBeat(doc([held]), 's', 'b2', 'a2', null, 9)!.sheets[0]!;
		expect(beatStep(stepped, 'b2', 'down')).toEqual({ actId: 'a3', beforeBeatId: 'b3' });
		expect(beatStep(stepped, 'b2', 'up')).toEqual({ actId: 'a1', beforeBeatId: null });
	});

	it('lands each step where the move then puts it', () => {
		let held = threeActs();
		for (const expected of [[['b1', 'b2'], ['b3'], []], [['b1', 'b2', 'b3'], [], []], [['b1', 'b3', 'b2'], [], []]]) {
			const step = beatStep(held.sheets[0]!, 'b3', 'up')!;
			held = moveBeat(held, 's', 'b3', step.actId, step.beforeBeatId, 9)!;
			expect(layout(held)).toEqual(expected);
		}
	});

	it('deletes a beat with its rows, unplacing their scenes', () => {
		const held = doc([sheet('s', [act('a1', [beat('b1', [row('r1', '', ['scene-1'])]), beat('b2')])])]);
		const gone = deleteBeat(held, 's', 'b1', 9);
		expect(layout(gone)).toEqual([['b2']]);
		expect(beatScenePlacements(gone!.sheets[0]!).size).toBe(0);
		expect(deleteBeat(held, 's', 'gone', 9)).toBeNull();
	});
});

describe('rows', () => {
	const held = (): BeatSheetDocument => doc([sheet('s', [
		act('a1', [beat('b1', [row('r1', 'One', ['scene-1']), row('r2', 'Two')]), beat('b2')]),
	])]);

	it('adds a row at the end or before a neighbour, taking a scene from where it stood, under a beat that must stand', () => {
		expect(rowsOf(addBeatRow(held(), 's', 'b1', { id: 'new', text: 'New' }, 'r2', 9), 'b1').map((entry) => entry.id)).toEqual(['r1', 'new', 'r2']);
		const taken = addBeatRow(held(), 's', 'b2', { id: 'new', text: '', scenes: ['scene-1', 'scene-1', 'scene-2'] }, null, 9);
		expect(rowsOf(taken, 'b2')).toEqual([row('new', '', ['scene-1', 'scene-2'])]);
		expect(rowsOf(taken, 'b1')[0]?.scenes).toEqual([]);
		// A beat that has gone has nothing to come back as, unlike a time a timeline may name again.
		expect(addBeatRow(held(), 's', 'gone', { id: 'new', text: '' }, null, 9)).toBeNull();
		expect(addBeatRow(held(), 's', 'b2', { id: 'r1', text: '' }, null, 9)).toBeNull();
	});

	it('edits a row, writing nothing for the same words', () => {
		expect(editBeatRow(held(), 's', 'r1', 'One', 9)).toBeNull();
		expect(editBeatRow(held(), 's', 'gone', 'X', 9)).toBeNull();
		expect(rowsOf(editBeatRow(held(), 's', 'r1', 'Changed', 9), 'b1')[0]).toEqual(row('r1', 'Changed', ['scene-1']));
	});

	it('moves a row with its scenes within a beat or to another, and nowhere for a beat the sheet lacks', () => {
		expect(rowsOf(moveBeatRow(held(), 's', 'r2', 'b1', 'r1', 9), 'b1').map((entry) => entry.id)).toEqual(['r2', 'r1']);
		const across = moveBeatRow(held(), 's', 'r1', 'b2', null, 9);
		expect(rowsOf(across, 'b2')).toEqual([row('r1', 'One', ['scene-1'])]);
		expect(rowsOf(across, 'b1').map((entry) => entry.id)).toEqual(['r2']);
		expect(moveBeatRow(held(), 's', 'r1', 'b1', 'r2', 9)).toBeNull();
		expect(moveBeatRow(held(), 's', 'r2', 'b1', null, 9)).toBeNull();
		expect(moveBeatRow(held(), 's', 'r1', 'gone', null, 9)).toBeNull();
		expect(moveBeatRow(held(), 's', 'gone', 'b2', null, 9)).toBeNull();
	});

	it('deletes a row, unplacing its scenes, and knows where every row stands', () => {
		const gone = deleteBeatRow(held(), 's', 'r1', 9)!;
		expect(rowsOf(gone, 'b1').map((entry) => entry.id)).toEqual(['r2']);
		expect(beatScenePlacements(gone.sheets[0]!).size).toBe(0);
		expect(deleteBeatRow(held(), 's', 'gone', 9)).toBeNull();
		expect(findBeatRow(held().sheets[0]!, 'r2')).toMatchObject({ index: 1 });
		expect(findBeatRow(held().sheets[0]!, 'gone')).toBeNull();
	});
});

describe('scene placements', () => {
	const held = (): BeatSheetDocument => doc([sheet('s', [
		act('a1', [beat('b1', [row('r1', '', ['scene-1', 'scene-2'])])]),
		act('a2', [beat('b2', [row('r2', '')])]),
	])]);

	it('places a scene at a row\'s end or before a neighbour, giving up where it stood: once in a whole sheet', () => {
		expect(rowsOf(placeBeatScene(held(), 's', 'scene-3', 'r1', 'scene-2', 9), 'b1')[0]?.scenes).toEqual(['scene-1', 'scene-3', 'scene-2']);
		const moved = placeBeatScene(held(), 's', 'scene-1', 'r2', null, 9);
		expect(rowsOf(moved, 'b2')[0]?.scenes).toEqual(['scene-1']);
		expect(rowsOf(moved, 'b1')[0]?.scenes).toEqual(['scene-2']);
		expect(rowsOf(placeBeatScene(held(), 's', 'scene-2', 'r1', 'scene-1', 9), 'b1')[0]?.scenes).toEqual(['scene-2', 'scene-1']);
	});

	it('writes nothing where the scene already stands, or the row is not the sheet\'s', () => {
		expect(placeBeatScene(held(), 's', 'scene-2', 'r1', null, 9)).toBeNull();
		expect(placeBeatScene(held(), 's', 'scene-1', 'r1', 'scene-2', 9)).toBeNull();
		expect(placeBeatScene(held(), 's', 'scene-1', 'gone', null, 9)).toBeNull();
	});

	it('removes a placement, and nothing for a scene that stands nowhere on the sheet', () => {
		expect(rowsOf(removeBeatScene(held(), 's', 'scene-1', 9), 'b1')[0]?.scenes).toEqual(['scene-2']);
		expect(removeBeatScene(held(), 's', 'scene-9', 9)).toBeNull();
	});
});

describe('templates', () => {
	const written = (): BeatSheet => sheet('s', [
		act('a1', [beat('b1', [row('r1', 'A sub-description', ['scene-1'])], { name: 'Opening', description: 'Where it begins' })], 'Setup'),
		act('a2', []),
	]);

	it('keeps a sheet\'s acts and beats, and nothing written under them', () => {
		expect(beatSheetStructureOf(written())).toEqual({
			acts: [
				{ label: 'Setup', beats: [{ name: 'Opening', description: 'Where it begins' }] },
				{ label: '', beats: [] },
			],
		});
	});

	it('makes a sheet from a structure with an id of its own for every act and beat', () => {
		let serial = 0;
		const made = beatSheetFromStructure(
			{ id: 'new', name: 'New', structure: beatSheetStructureOf(written()), now: 5 },
			(kind) => `${kind}-${String(++serial)}`,
		);
		expect(made).toMatchObject({ id: 'new', name: 'New', presentation: null, showSubDescriptions: true, createdAt: 5, updatedAt: 5 });
		expect(made.acts.map((entry) => [entry.id, entry.label, entry.beats.map((b) => [b.id, b.name, b.description, b.rows])])).toEqual([
			['act-1', 'Setup', [['beat-2', 'Opening', 'Where it begins', []]]],
			['act-3', '', []],
		]);
	});

	it('appends a template under the id handed in, and refuses a blank name', () => {
		const draft = { id: 't1', name: '  Mine  ', description: 'Mine own', structure: beatSheetStructureOf(written()) };
		const saved = saveBeatSheetTemplate(doc(), draft, 9)!;
		expect(saved.templates).toEqual([{ id: 't1', name: 'Mine', description: 'Mine own', acts: draft.structure.acts, createdAt: 9, updatedAt: 9 }]);
		expect(saveBeatSheetTemplate(doc(), { ...draft, name: '   ' }, 9)).toBeNull();
	});

	it('replaces a namesake where it stands, by folded name, keeping its id and the day it was made', () => {
		const held = doc([], { templates: [template('first', 'Other'), template('kept', 'My  Template', { createdAt: 2, description: 'Old' })] });
		expect(beatSheetTemplateNamesake(held, 'my template')?.id).toBe('kept');
		expect(beatSheetTemplateNamesake(held, '')).toBeUndefined();
		const saved = saveBeatSheetTemplate(held, { id: 'unused', name: 'my template', description: 'New', structure: beatSheetStructureOf(written()) }, 9)!;
		expect(saved.templates.map((entry) => entry.id)).toEqual(['first', 'kept']);
		expect(saved.templates[1]).toMatchObject({ id: 'kept', name: 'my template', description: 'New', createdAt: 2, updatedAt: 9 });
		expect(saved.templates[1]?.acts).toHaveLength(2);
		// Saved again as it stands, nothing is written.
		expect(saveBeatSheetTemplate(saved, { id: 'unused', name: 'my template', description: 'New', structure: beatSheetStructureOf(written()) }, 10)).toBeNull();
	});

	it('deletes a template, leaving the sheets made from it as they are', () => {
		const held = doc([written()], { templates: [template('t', 'T')] });
		const gone = deleteBeatSheetTemplate(held, 't')!;
		expect(gone.templates).toEqual([]);
		expect(gone.sheets).toBe(held.sheets);
		expect(deleteBeatSheetTemplate(held, 'gone')).toBeNull();
	});
});
