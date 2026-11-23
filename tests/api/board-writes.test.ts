import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_BEAT_SHEET_TEMPLATE_IDS, DEFAULT_GRAPH_FORCES, FREEFORM_LIMITS } from '../../src/domain';
import { seedBoards, type GoldenBoards } from './helpers/golden-boards';
import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];
const pointerOf = (reply: { body: unknown }): unknown => bodyOf(reply.body)['pointer'];

interface Ground {
	golden: Golden;
	boards: GoldenBoards;
	P: { projectId: string };
}

/** A vault of its own for each test, with boards laid out in it and what the screens were told of that forgotten. */
async function ground(start: Parameters<typeof createGolden>[0] = {}): Promise<Ground> {
	const golden = await createGolden(start);
	const boards = await seedBoards(golden);
	golden.host.told.length = 0;
	golden.host.origins.length = 0;
	return { golden, boards, P: { projectId: golden.project.id } };
}

/** A call that must land, with its answer held to the contract. */
async function ok(golden: Golden, operation: string, params: Body, body?: unknown, status = 200): Promise<Body> {
	const reply = await golden.call(operation, params, body === undefined ? {} : { body });
	expect([reply.status, faults(reply)], `${operation} ${JSON.stringify(reply.body)}`).toEqual([status, []]);
	return bodyOf(reply.body);
}

const idsOf = (list: unknown): unknown[] => (list as Body[]).map((entry) => entry['id']);
/** The rows a timeline keeps under a time, as it is told. */
const rowsUnder = (timeline: Body, timeId: string): Body[] =>
	((timeline['times'] as Body[]).find((entry) => bodyOf(entry['time'])['id'] === timeId)?.['rows'] ?? []) as Body[];
const rowOf = (rows: Body[], id: unknown): Body => rows.find((row) => row['id'] === id) ?? {};

describe('a timeline, made and changed', () => {
	it('is made under a name of its own, bound to a note of the world, and joins a view', async () => {
		const { golden, boards, P } = await ground();
		const { ben, stops, tower } = golden.members;
		const made = await ok(golden, 'createTimeline', P, { name: '  Ben’s week ', binding: { id: ben.characterId } }, 201);
		expect(made).toMatchObject({ name: 'Ben’s week', binding: { kind: 'character', id: ben.characterId, name: 'Ben', resolved: true }, times: [] });
		expect(golden.host.told).toEqual(['timeline']);
		const board = await ok(golden, 'getTimeline', P);
		// No view was looked at last, so it joins the board's first.
		const views = board['views'] as Body[];
		expect((views[0]?.['timelineIds'] as unknown[]).includes(made['id'])).toBe(true);
		expect((views.find((view) => view['id'] === boards.view)?.['timelineIds'] as unknown[]).includes(made['id'])).toBe(false);

		const aside = await ok(golden, 'createTimeline', P, { name: 'The tower', binding: { id: tower.entityId }, view: boards.view }, 201);
		const hidden = await ok(golden, 'createTimeline', P, { name: 'Unseen', view: null }, 201);
		const after = (await ok(golden, 'getTimeline', P))['views'] as Body[];
		expect(after.map((view) => [(view['timelineIds'] as unknown[]).includes(aside['id']), (view['timelineIds'] as unknown[]).includes(hidden['id'])])).toEqual([
			[false, false],
			[true, false],
			[false, false],
		]);

		const before = vaultState(golden.host);
		expect(refusal(await golden.call('createTimeline', P, { body: { name: 'ben’s  WEEK' } }))).toEqual([409, 'duplicate-name']);
		const scene = await golden.call('createTimeline', P, { body: { name: 'A scene', binding: { id: stops.sceneId } } });
		expect([refusal(scene), pointerOf(scene), faults(scene)]).toEqual([[422, 'invalid-reference'], '/binding', []]);
		expect(refusal(await golden.call('createTimeline', P, { body: { name: 'Nobody', binding: { id: 'character-gone' } } }))).toEqual([422, 'invalid-reference']);
		expect(pointerOf(await golden.call('createTimeline', P, { body: { name: 'Nowhere', view: 'timeline-view-gone' } }))).toBe('/view');
		expect(refusal(await golden.call('createTimeline', P, { body: { name: '   ' } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is renamed, bound again, pinned and deleted', async () => {
		const { golden, boards, P } = await ground();
		const at = { ...P, timelineId: boards.timeline };
		const read = ((await ok(golden, 'getTimeline', P))['timelines'] as Body[]).find((timeline) => timeline['id'] === boards.timeline) ?? {};
		// Read and sent back whole, it changes nothing.
		const before = vaultState(golden.host);
		await ok(golden, 'updateTimeline', at, read);
		expect(vaultState(golden.host)).toEqual(before);

		const changed = await ok(golden, 'updateTimeline', at, { name: 'Ada alone', binding: null, pinned: true });
		expect(changed).toMatchObject({ id: boards.timeline, name: 'Ada alone', binding: null });
		expect((await ok(golden, 'getTimeline', P))['pinnedTimelineId']).toBe(boards.timeline);
		// Taking the pin off another leaves this one's on.
		await ok(golden, 'updateTimeline', { ...P, timelineId: boards.spareTimeline }, { pinned: false });
		expect((await ok(golden, 'getTimeline', P))['pinnedTimelineId']).toBe(boards.timeline);
		await ok(golden, 'updateTimeline', at, { pinned: false });
		expect((await ok(golden, 'getTimeline', P))['pinnedTimelineId']).toBeNull();
		expect(refusal(await golden.call('updateTimeline', at, { body: { name: 'to DELETE' } }))).toEqual([409, 'duplicate-name']);

		const gone = await golden.call('deleteTimeline', at);
		expect([gone.status, gone.body]).toEqual([204, undefined]);
		const board = await ok(golden, 'getTimeline', P);
		expect(idsOf(board['timelines'])).toEqual([boards.spareTimeline]);
		expect((board['views'] as Body[]).some((view) => (view['timelineIds'] as unknown[]).includes(boards.timeline))).toBe(false);
		expect(refusal(await golden.call('deleteTimeline', at))).toEqual([404, 'not-found']);
		expect(refusal(await golden.call('updateTimeline', at, { body: { name: 'Back' } }))).toEqual([404, 'not-found']);
	});

	it('is given a time and loses one, each a time note of the project', async () => {
		const { golden, boards, P } = await ground();
		const { winter, midnight, tower } = golden.members;
		const at = { ...P, timelineId: boards.timeline };
		const added = await ok(golden, 'addTimelineTime', { ...at, timeId: winter.entityId });
		expect((added['times'] as Body[]).map((entry) => bodyOf(entry['time'])['id'])).toEqual([midnight.entityId, winter.entityId]);
		// A time already there is left as it is.
		const before = vaultState(golden.host);
		await ok(golden, 'addTimelineTime', { ...at, timeId: winter.entityId });
		expect(vaultState(golden.host)).toEqual(before);
		const place = await golden.call('addTimelineTime', { ...at, timeId: tower.entityId });
		expect([refusal(place), pointerOf(place)]).toEqual([[422, 'invalid-reference'], 'params/timeId']);
		expect(refusal(await golden.call('addTimelineTime', { ...at, timeId: 'entity-gone' }))).toEqual([422, 'invalid-reference']);

		const removed = await ok(golden, 'removeTimelineTime', { ...at, timeId: midnight.entityId });
		expect((removed['times'] as Body[]).map((entry) => bodyOf(entry['time'])['id'])).toEqual([winter.entityId]);
		expect(refusal(await golden.call('removeTimelineTime', { ...at, timeId: midnight.entityId }))).toEqual([404, 'not-found']);
		expect(refusal(await golden.call('addTimelineTime', { ...P, timelineId: 'timeline-gone', timeId: winter.entityId }))).toEqual([404, 'not-found']);
	});

	it('has rows written under its times, changed, moved and taken off', async () => {
		const { golden, boards, P } = await ground();
		const { winter, midnight, stops, morning } = golden.members;
		const at = { ...P, timelineId: boards.timeline };
		const first = await ok(golden, 'addTimelineRow', at, { time: { id: midnight.entityId }, text: ' The bell rings. ', before: 'row-quiet', scenes: [{ id: stops.sceneId }] }, 201);
		const rows = rowsUnder(bodyOf(first['timeline']), midnight.entityId);
		expect(idsOf(rows)).toEqual(['row-stop', first['id'], 'row-quiet']);
		// A scene stands once on a timeline, so the one already placed was moved.
		expect([rowOf(rows, first['id'])['text'], idsOf(rowOf(rows, first['id'])['scenes']), idsOf(rowOf(rows, 'row-stop')['scenes'])]).toEqual(['The bell rings.', [stops.sceneId], []]);

		// A time the timeline does not have yet joins it, and a row may carry scenes and say nothing.
		const second = await ok(golden, 'addTimelineRow', at, { time: { id: winter.entityId }, scenes: [{ id: morning.sceneId }] }, 201);
		expect(idsOf(rowsUnder(bodyOf(second['timeline']), winter.entityId))).toEqual([second['id']]);

		const row = { ...at, rowId: 'row-quiet' };
		expect(rowOf(rowsUnder(await ok(golden, 'updateTimelineRow', row, { text: 'Quiet.' }), midnight.entityId), 'row-quiet')['text']).toBe('Quiet.');
		const moved = await ok(golden, 'updateTimelineRow', row, { time: { id: winter.entityId }, before: second['id'] });
		expect([idsOf(rowsUnder(moved, winter.entityId)), idsOf(rowsUnder(moved, midnight.entityId))]).toEqual([
			['row-quiet', second['id']],
			['row-stop', first['id']],
		]);
		expect(idsOf(rowsUnder(await ok(golden, 'updateTimelineRow', row, { before: null }), winter.entityId))).toEqual([second['id'], 'row-quiet']);

		const before = vaultState(golden.host);
		expect(refusal(await golden.call('addTimelineRow', at, { body: { time: { id: midnight.entityId }, text: '  ' } }))).toEqual([400, 'invalid-request']);
		expect(pointerOf(await golden.call('addTimelineRow', at, { body: { time: { id: midnight.entityId }, text: 'x', before: 'row-quiet' } }))).toBe('/before');
		expect(pointerOf(await golden.call('addTimelineRow', at, { body: { time: { id: stops.sceneId }, text: 'x' } }))).toBe('/time');
		expect(pointerOf(await golden.call('addTimelineRow', at, { body: { time: { id: midnight.entityId }, scenes: [{ id: 'scene-gone' }] } }))).toBe('/scenes/0');
		expect(refusal(await golden.call('updateTimelineRow', row, { body: { text: '' } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('updateTimelineRow', row, { body: { before: 'row-quiet' } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('updateTimelineRow', { ...at, rowId: 'row-gone' }, { body: { text: 'x' } }))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);

		const cut = await ok(golden, 'deleteTimelineRow', row);
		expect(idsOf(rowsUnder(cut, winter.entityId))).toEqual([second['id']]);
		expect(refusal(await golden.call('deleteTimelineRow', row))).toEqual([404, 'not-found']);
	});

	it('has scenes placed in its rows and taken out of them', async () => {
		const { golden, boards, P } = await ground();
		const { midnight, stops, morning } = golden.members;
		const at = { ...P, timelineId: boards.timeline };
		const placed = await ok(golden, 'placeTimelineScene', { ...at, sceneId: morning.sceneId }, { row: 'row-stop', before: stops.sceneId });
		expect(idsOf(rowOf(rowsUnder(placed, midnight.entityId), 'row-stop')['scenes'])).toEqual([morning.sceneId, stops.sceneId]);
		const moved = await ok(golden, 'placeTimelineScene', { ...at, sceneId: stops.sceneId }, { row: 'row-quiet' });
		expect(rowsUnder(moved, midnight.entityId).map((row) => idsOf(row['scenes']))).toEqual([[morning.sceneId], [stops.sceneId]]);

		expect(pointerOf(await golden.call('placeTimelineScene', { ...at, sceneId: 'scene-gone' }, { body: { row: 'row-stop' } }))).toBe('params/sceneId');
		expect(pointerOf(await golden.call('placeTimelineScene', { ...at, sceneId: stops.sceneId }, { body: { row: 'row-gone' } }))).toBe('/row');
		expect(pointerOf(await golden.call('placeTimelineScene', { ...at, sceneId: stops.sceneId }, { body: { row: 'row-stop', before: 'scene-gone' } }))).toBe('/before');

		const taken = await ok(golden, 'removeTimelineScene', { ...at, sceneId: stops.sceneId });
		expect(rowsUnder(taken, midnight.entityId).map((row) => idsOf(row['scenes']))).toEqual([[morning.sceneId], []]);
		expect(refusal(await golden.call('removeTimelineScene', { ...at, sceneId: stops.sceneId }))).toEqual([404, 'not-found']);
		expect(golden.host.told.every((what) => what === 'timeline')).toBe(true);
	});

	it('is shown through views that are made, changed and deleted', async () => {
		const { golden, boards, P } = await ground();
		const { midnight, winter } = golden.members;
		const made = await ok(golden, 'createTimelineView', P, { name: 'Both', timelineIds: [boards.spareTimeline, boards.timeline, boards.timeline] }, 201);
		const board = bodyOf(made['board']);
		const view = (board['views'] as Body[]).find((entry) => entry['id'] === made['id']) ?? {};
		expect(view).toMatchObject({ name: 'Both', timelineIds: [boards.spareTimeline, boards.timeline], timeOrder: [], presentation: null, timesReversed: false });
		// The author is left looking at the view they were looking at.
		expect(board['lastViewId']).toBeNull();

		const at = { ...P, timelineViewId: String(made['id']) };
		const changed = await ok(golden, 'updateTimelineView', at, {
			name: 'Everything',
			timelineIds: [boards.timeline],
			timeOrder: [winter.entityId, midnight.entityId],
			presentation: 'stack',
			cardStyle: 'compact',
			showSubDescriptions: false,
			timesReversed: true,
		});
		expect((changed['views'] as Body[]).find((entry) => entry['id'] === made['id'])).toMatchObject({
			name: 'Everything',
			timelineIds: [boards.timeline],
			timeOrder: [winter.entityId, midnight.entityId],
			presentation: 'stack',
			cardStyle: 'compact',
			showSubDescriptions: false,
			timesReversed: true,
		});
		// Read and sent back whole, it changes nothing.
		const before = vaultState(golden.host);
		await ok(golden, 'updateTimelineView', at, (changed['views'] as Body[]).find((entry) => entry['id'] === made['id']));
		expect(vaultState(golden.host)).toEqual(before);

		expect(refusal(await golden.call('createTimelineView', P, { body: { name: 'side BY side' } }))).toEqual([409, 'duplicate-name']);
		expect(refusal(await golden.call('updateTimelineView', at, { body: { name: 'Empty' } }))).toEqual([409, 'duplicate-name']);
		expect(pointerOf(await golden.call('createTimelineView', P, { body: { name: 'Lost', timelineIds: ['timeline-gone'] } }))).toBe('/timelineIds/0');
		expect(pointerOf(await golden.call('updateTimelineView', at, { body: { timeOrder: [midnight.entityId, 'entity-gone'] } }))).toBe('/timeOrder/1');
		expect(refusal(await golden.call('updateTimelineView', at, { body: { presentation: 'heap' } }))).toEqual([400, 'invalid-request']);

		expect((await golden.call('deleteTimelineView', at)).status).toBe(204);
		expect(idsOf((await ok(golden, 'getTimeline', P))['views'])).not.toContain(made['id']);
		expect(refusal(await golden.call('deleteTimelineView', at))).toEqual([404, 'not-found']);
	});

	it('is left alone where a newer version of the plugin wrote the board', async () => {
		const { golden, P } = await ground();
		await golden.host.projects.repository.updatePlainFile(golden.host.projects.timeline.timelinePath(golden.project), (text) =>
			text.replace(/"schemaVersion": \d+/u, '"schemaVersion": 99'),
		);
		const before = vaultState(golden.host);
		const reply = await golden.call('createTimeline', P, { body: { name: 'Later' } });
		expect([refusal(reply), faults(reply)]).toEqual([[409, 'read-only'], []]);
		expect(refusal(await golden.call('createTimelineView', P, { body: { name: 'Later' } }))).toEqual([409, 'read-only']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a beat sheet, made and changed', () => {
	const actsOf = (sheet: Body): Body[] => sheet['acts'] as Body[];
	const beatsOf = (sheet: Body, actId: unknown): Body[] => (actsOf(sheet).find((act) => act['id'] === actId)?.['beats'] ?? []) as Body[];
	const beatOf = (sheet: Body, beatId: unknown): Body =>
		actsOf(sheet)
			.flatMap((act) => act['beats'] as Body[])
			.find((beat) => beat['id'] === beatId) ?? {};

	it('is laid out from a template, the plugin’s own or the author’s, and leaves the author where they were', async () => {
		const { golden, boards, P } = await ground();
		await golden.host.projects.beatSheet.setLastSheet(golden.project, boards.sheet);
		const reply = await golden.call('createBeatSheet', P, { body: { name: ' Spring ', templateId: 'three-act' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const made = bodyOf(reply.body);
		expect(reply.location).toBe(`/projects/${golden.project.id}/beat-sheets/${String(made['id'])}`);
		expect([made['name'], actsOf(made).length, actsOf(made).map((act) => act['number'])]).toEqual(['Spring', 3, [1, 2, 3]]);
		expect(actsOf(made).every((act) => (act['beats'] as Body[]).length > 0 && (act['beats'] as Body[]).every((beat) => (beat['rows'] as Body[]).length === 0))).toBe(true);
		expect((await ok(golden, 'listBeatSheets', P))['lastSheetId']).toBe(boards.sheet);

		const own = await ok(golden, 'createBeatSheet', P, { name: 'Summer', templateId: boards.template }, 201);
		expect(actsOf(own).map((act) => [act['label'], (act['beats'] as Body[]).map((beat) => [beat['name'], beat['description']])])).toEqual([['Before', [['Open', 'Begin late.']]]]);
		// Each of the plugin's own is there to start from.
		for (const templateId of BUILT_IN_BEAT_SHEET_TEMPLATE_IDS) await ok(golden, 'createBeatSheet', P, { name: `From ${templateId}`, templateId }, 201);

		const before = vaultState(golden.host);
		expect(refusal(await golden.call('createBeatSheet', P, { body: { name: 'SPRING', templateId: 'blank' } }))).toEqual([409, 'duplicate-name']);
		const lost = await golden.call('createBeatSheet', P, { body: { name: 'Autumn', templateId: 'beat-sheet-template-gone' } });
		expect([refusal(lost), pointerOf(lost)]).toEqual([[422, 'invalid-reference'], '/templateId']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told.every((what) => what === 'beatSheets')).toBe(true);
	});

	it('is renamed, drawn another way and deleted', async () => {
		const { golden, boards, P } = await ground();
		const at = { ...P, beatSheetId: boards.sheet };
		const read = await ok(golden, 'getBeatSheet', at);
		const before = vaultState(golden.host);
		await ok(golden, 'updateBeatSheet', at, read);
		expect(vaultState(golden.host)).toEqual(before);
		expect(await ok(golden, 'updateBeatSheet', at, { name: 'Deep winter', presentation: 'stack', showSubDescriptions: false, reversed: true })).toMatchObject({
			name: 'Deep winter',
			presentation: 'stack',
			showSubDescriptions: false,
			reversed: true,
		});
		expect(refusal(await golden.call('updateBeatSheet', at, { body: { name: 'to delete' } }))).toEqual([409, 'duplicate-name']);
		expect((await golden.call('deleteBeatSheet', at)).status).toBe(204);
		expect(idsOf((await ok(golden, 'listBeatSheets', P))['items'])).toEqual([boards.spareSheet]);
		expect(refusal(await golden.call('deleteBeatSheet', at))).toEqual([404, 'not-found']);
	});

	it('has acts added, relabelled, moved and deleted', async () => {
		const { golden, boards, P } = await ground();
		const at = { ...P, beatSheetId: boards.sheet };
		const added = await ok(golden, 'addBeatSheetAct', at, { label: ' Coda ', before: 'act-turn' }, 201);
		const sheet = bodyOf(added['beatSheet']);
		expect(actsOf(sheet).map((act) => [act['id'], act['number'], act['label']])).toEqual([
			['act-setup', 1, 'Setup'],
			[added['id'], 2, 'Coda'],
			['act-turn', 3, ''],
		]);
		const act = { ...at, actId: String(added['id']) };
		expect(idsOf(actsOf(await ok(golden, 'updateBeatSheetAct', act, { label: 'Aftermath', before: null })))).toEqual(['act-setup', 'act-turn', added['id']]);
		expect(actsOf(await ok(golden, 'updateBeatSheetAct', act, { before: 'act-setup' })).map((entry) => entry['label'])).toEqual(['Aftermath', 'Setup', '']);
		expect(pointerOf(await golden.call('addBeatSheetAct', at, { body: { label: 'x', before: 'act-gone' } }))).toBe('/before');
		expect(refusal(await golden.call('updateBeatSheetAct', act, { body: { before: added['id'] } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('updateBeatSheetAct', { ...at, actId: 'act-gone' }, { body: { label: 'x' } }))).toEqual([404, 'not-found']);
		// An act goes with its beats.
		expect(idsOf(actsOf(await ok(golden, 'deleteBeatSheetAct', { ...at, actId: 'act-setup' })))).toEqual([added['id'], 'act-turn']);
		expect(refusal(await golden.call('deleteBeatSheetAct', { ...at, actId: 'act-setup' }))).toEqual([404, 'not-found']);
	});

	it('has beats added, changed, moved between acts and deleted', async () => {
		const { golden, boards, P } = await ground();
		const at = { ...P, beatSheetId: boards.sheet };
		const added = await ok(golden, 'addBeat', at, { act: 'act-setup', name: ' Debate ', description: ' Stay or go. ', before: 'beat-incident' }, 201);
		const sheet = bodyOf(added['beatSheet']);
		expect(idsOf(beatsOf(sheet, 'act-setup'))).toEqual(['beat-hook', added['id'], 'beat-incident']);
		expect(beatOf(sheet, added['id'])).toEqual({ id: added['id'], name: 'Debate', description: 'Stay or go.', rows: [] });

		const beat = { ...at, beatId: String(added['id']) };
		expect(beatOf(await ok(golden, 'updateBeat', beat, { name: 'The debate', description: '' }), added['id'])).toMatchObject({ name: 'The debate', description: '' });
		const moved = await ok(golden, 'updateBeat', beat, { act: 'act-turn', before: 'beat-midpoint' });
		expect([idsOf(beatsOf(moved, 'act-setup')), idsOf(beatsOf(moved, 'act-turn'))]).toEqual([
			['beat-hook', 'beat-incident'],
			[added['id'], 'beat-midpoint'],
		]);
		expect(pointerOf(await golden.call('addBeat', at, { body: { act: 'act-gone', name: 'x' } }))).toBe('/act');
		expect(pointerOf(await golden.call('addBeat', at, { body: { act: 'act-turn', name: 'x', before: 'beat-hook' } }))).toBe('/before');
		expect(refusal(await golden.call('addBeat', at, { body: { act: 'act-turn', name: '  ' } }))).toEqual([400, 'invalid-request']);
		expect(pointerOf(await golden.call('updateBeat', beat, { body: { act: 'act-gone' } }))).toBe('/act');
		expect(refusal(await golden.call('updateBeat', { ...at, beatId: 'beat-gone' }, { body: { name: 'x' } }))).toEqual([404, 'not-found']);
		expect(idsOf(beatsOf(await ok(golden, 'deleteBeat', beat), 'act-turn'))).toEqual(['beat-midpoint']);
		expect(refusal(await golden.call('deleteBeat', beat))).toEqual([404, 'not-found']);
	});

	it('has rows written under its beats and scenes placed in them', async () => {
		const { golden, boards, P } = await ground();
		const { stops, morning } = golden.members;
		const at = { ...P, beatSheetId: boards.sheet };
		const added = await ok(golden, 'addBeatRow', at, { beat: 'beat-hook', text: ' Dawn. ', before: 'row-spare', scenes: [{ id: morning.sceneId }] }, 201);
		const rows = beatOf(bodyOf(added['beatSheet']), 'beat-hook')['rows'] as Body[];
		expect(rows.map((row) => [row['id'], row['text'], idsOf(row['scenes'])])).toEqual([
			['row-hook', 'Midnight.', [stops.sceneId]],
			[added['id'], 'Dawn.', [morning.sceneId]],
			['row-spare', 'Spare.', []],
		]);
		// A scene stands once in a sheet, so the row that carried it before no longer does.
		expect(idsOf(rowOf(beatOf(bodyOf(added['beatSheet']), 'beat-midpoint')['rows'] as Body[], 'row-mid')['scenes'])).toEqual([]);

		const row = { ...at, rowId: String(added['id']) };
		expect(rowOf(beatOf(await ok(golden, 'updateBeatRow', row, { text: 'First light.' }), 'beat-hook')['rows'] as Body[], added['id'])['text']).toBe('First light.');
		const moved = await ok(golden, 'updateBeatRow', row, { beat: 'beat-incident' });
		expect([idsOf(beatOf(moved, 'beat-incident')['rows']), idsOf(beatOf(moved, 'beat-hook')['rows'])]).toEqual([[added['id']], ['row-hook', 'row-spare']]);

		const placed = await ok(golden, 'placeBeatSheetScene', { ...at, sceneId: morning.sceneId }, { row: 'row-hook', before: stops.sceneId });
		expect(idsOf(rowOf(beatOf(placed, 'beat-hook')['rows'] as Body[], 'row-hook')['scenes'])).toEqual([morning.sceneId, stops.sceneId]);
		const taken = await ok(golden, 'removeBeatSheetScene', { ...at, sceneId: stops.sceneId });
		expect(idsOf(rowOf(beatOf(taken, 'beat-hook')['rows'] as Body[], 'row-hook')['scenes'])).toEqual([morning.sceneId]);

		expect(refusal(await golden.call('removeBeatSheetScene', { ...at, sceneId: stops.sceneId }))).toEqual([404, 'not-found']);
		expect(pointerOf(await golden.call('placeBeatSheetScene', { ...at, sceneId: 'scene-gone' }, { body: { row: 'row-hook' } }))).toBe('params/sceneId');
		expect(pointerOf(await golden.call('placeBeatSheetScene', { ...at, sceneId: stops.sceneId }, { body: { row: 'row-gone' } }))).toBe('/row');
		expect(pointerOf(await golden.call('addBeatRow', at, { body: { beat: 'beat-gone', text: 'x' } }))).toBe('/beat');
		expect(refusal(await golden.call('addBeatRow', at, { body: { beat: 'beat-hook' } }))).toEqual([400, 'invalid-request']);
		// A row that carries no scene must go on saying something.
		expect(refusal(await golden.call('updateBeatRow', { ...at, rowId: 'row-spare' }, { body: { text: ' ' } }))).toEqual([400, 'invalid-request']);
		expect(idsOf(beatOf(await ok(golden, 'deleteBeatRow', { ...at, rowId: 'row-spare' }), 'beat-hook')['rows'])).toEqual(['row-hook']);
		expect(refusal(await golden.call('deleteBeatRow', { ...at, rowId: 'row-spare' }))).toEqual([404, 'not-found']);
	});

	it('is kept as a template of the author’s own, which can be deleted where the plugin’s own cannot', async () => {
		const { golden, boards, P } = await ground();
		const saved = await ok(golden, 'saveBeatSheetTemplate', P, { beatSheet: boards.sheet, name: 'Winter shape', description: ' Two acts. ' }, 201);
		const own = (saved['items'] as Body[]).filter((template) => template['builtIn'] === false);
		expect(own.map((template) => [template['name'], template['description']])).toEqual([
			['Two halves', 'Mine.'],
			['Winter shape', 'Two acts.'],
		]);
		expect(((own[1]?.['acts'] ?? []) as Body[]).map((act) => [act['label'], (act['beats'] as Body[]).map((beat) => beat['name'])])).toEqual([
			['Setup', ['Hook', 'Inciting incident']],
			['', ['Midpoint']],
		]);
		expect((saved['items'] as Body[]).filter((template) => template['builtIn'] === true).length).toBe(BUILT_IN_BEAT_SHEET_TEMPLATE_IDS.length);
		// A template of that name, whatever its case, is replaced where it stands.
		const again = await ok(golden, 'saveBeatSheetTemplate', P, { beatSheet: boards.spareSheet, name: 'two HALVES' }, 201);
		expect((again['items'] as Body[]).filter((template) => template['builtIn'] === false).map((template) => [template['id'], template['name'], template['acts']])).toEqual([
			[boards.template, 'two HALVES', []],
			[own[1]?.['id'], 'Winter shape', own[1]?.['acts']],
		]);
		expect(pointerOf(await golden.call('saveBeatSheetTemplate', P, { body: { beatSheet: 'beat-sheet-gone', name: 'x' } }))).toBe('/beatSheet');

		expect((await golden.call('deleteBeatSheetTemplate', { ...P, beatSheetTemplateId: boards.template })).status).toBe(204);
		expect(refusal(await golden.call('deleteBeatSheetTemplate', { ...P, beatSheetTemplateId: boards.template }))).toEqual([404, 'not-found']);
		expect(refusal(await golden.call('deleteBeatSheetTemplate', { ...P, beatSheetTemplateId: 'three-act' }))).toEqual([400, 'invalid-request']);
	});
});

describe('the relationship graph, set as its own panel sets it', () => {
	it('is told as a project starts with it, and changed a setting at a time', async () => {
		const { golden, P } = await ground({ access: 'write' });
		const before = vaultState(golden.host);
		expect(await ok(golden, 'getRelationshipGraphView', P)).toEqual({
			filters: { hiddenKinds: ['scene'], hiddenLabels: [], unresolved: true, orphans: true },
			groups: null,
			display: { arrows: true, captions: 'relationship', textFade: 0, nodeSize: 1, lineSize: 1 },
			forces: { ...DEFAULT_GRAPH_FORCES },
			local: { depth: 1, incoming: true, outgoing: true, neighbours: false },
			timeline: { rule: 'latest', undated: 'before' },
			viewport: null,
		});
		// Reading how it is set writes no file for a project that has never moved a control.
		expect(vaultState(golden.host)).toEqual(before);

		const changed = await ok(golden, 'updateRelationshipGraphView', P, {
			filters: { hiddenKinds: ['scene', 'time', 'Faction', 'time'], hiddenLabels: ['Family/Sibling'], orphans: false },
			groups: [
				{ query: 'kind:character', color: '#AA3366' },
				{ query: 'Ada OR Ben', color: '#00aa88' },
			],
			display: { captions: 'both', nodeSize: 2.5 },
			forces: { repel: 15 },
			local: { depth: 3, neighbours: true },
			timeline: { rule: 'since' },
			viewport: { x: 10, y: -20, zoom: 0.5 },
		});
		expect(changed).toEqual({
			filters: { hiddenKinds: ['scene', 'time', 'Faction'], hiddenLabels: ['Family/Sibling'], unresolved: true, orphans: false },
			groups: [
				{ query: 'kind:character', color: '#aa3366' },
				{ query: 'Ada OR Ben', color: '#00aa88' },
			],
			display: { arrows: true, captions: 'both', textFade: 0, nodeSize: 2.5, lineSize: 1 },
			forces: { ...DEFAULT_GRAPH_FORCES, repel: 15 },
			local: { depth: 3, incoming: true, outgoing: true, neighbours: true },
			timeline: { rule: 'since', undated: 'before' },
			viewport: { x: 10, y: -20, zoom: 0.5 },
		});
		expect(golden.host.told).toEqual(['relationshipGraph']);
		expect(await ok(golden, 'getRelationshipGraphView', P)).toEqual(changed);
		// Read and sent back whole, it changes nothing.
		const standing = vaultState(golden.host);
		expect(await ok(golden, 'updateRelationshipGraphView', P, changed)).toEqual(changed);
		expect(vaultState(golden.host)).toEqual(standing);
		// Null gives every kind its own colour back, and lets the picture fit the screen again.
		const reset = await ok(golden, 'updateRelationshipGraphView', P, { groups: null, viewport: null });
		expect([reset['groups'], reset['viewport'], reset['display']]).toEqual([null, null, changed['display']]);
	});

	it('is refused a kind or a label the project does not have, and what its sliders do not reach', async () => {
		const { golden, P } = await ground();
		const before = vaultState(golden.host);
		const sent = (body: Body) => golden.call('updateRelationshipGraphView', P, { body });
		const kind = await sent({ filters: { hiddenKinds: ['scene', 'dragon'] } });
		expect([refusal(kind), pointerOf(kind), faults(kind)]).toEqual([[422, 'invalid-reference'], '/filters/hiddenKinds/1', []]);
		const label = await sent({ filters: { hiddenLabels: ['Family/Cousin'] } });
		expect([refusal(label), pointerOf(label)]).toEqual([[422, 'invalid-reference'], '/filters/hiddenLabels/0']);
		expect(refusal(await sent({ display: { nodeSize: 9 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ display: { captions: 'loud' } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ forces: { linkDistance: 5 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ local: { depth: 1.5 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ timeline: { rule: 'never' } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ groups: [{ query: 'Ada', color: 'red' }] }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ viewport: { x: 0, y: 0, zoom: 0 } }))).toEqual([400, 'invalid-request']);
		// A number written past what a number holds is no place. It was answered once, and then not kept.
		const past = await sent(JSON.parse('{"viewport":{"x":1e999,"y":0,"zoom":1}}') as Body);
		expect([refusal(past), JSON.stringify(past.body).includes('/viewport/x')]).toEqual([[400, 'invalid-request'], true]);
		// What the author is searching for is the open tab's own, and no part of this.
		expect(refusal(await sent({ query: 'Ada' }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
		golden.host.state.access = 'read';
		expect(refusal(await sent({ display: { arrows: false } }))).toEqual([403, 'access-denied']);
	});

	it('tells what the file holds within the contract, and takes it back whole, whatever the author has made', async () => {
		const { golden, P } = await ground({ access: 'write' });
		// More colour groups than a caller is likely to send, a query as long as the author cared to type, and a
		// zoom written by hand past what the graph stands at. The panel holds the author to none of the first two.
		const groups = Array.from({ length: 60 }, (_unused, at) => ({ query: `kind:character ${'Ada OR '.repeat(90)}Ben ${String(at)}`, color: '#336699' }));
		await golden.host.projects.relationshipGraph.updateEntities(golden.project, { groups, viewport: { x: 4, y: 9, k: 20 } });
		const told = await ok(golden, 'getRelationshipGraphView', P);
		expect((told['groups'] as Body[]).length).toBe(60);
		expect(String((told['groups'] as Body[])[0]?.['query']).length).toBeGreaterThan(500);
		expect(told['viewport']).toEqual({ x: 4, y: 9, zoom: 8 });
		// Read and sent back whole it is taken, and changes nothing.
		const standing = vaultState(golden.host);
		expect(await ok(golden, 'updateRelationshipGraphView', P, told)).toEqual(told);
		expect(vaultState(golden.host)).toEqual(standing);
		// And one setting changed beside them leaves them as they stand.
		const changed = await ok(golden, 'updateRelationshipGraphView', P, { ...told, display: { arrows: false } });
		expect([(changed['groups'] as Body[]).length, bodyOf(changed['display'])['arrows']]).toEqual([60, false]);
	});

	it('leaves a setting the author moved a moment before as it then stands', async () => {
		const { golden, P } = await ground({ access: 'write' });
		const service = golden.host.projects.relationshipGraph;
		const read = service.read.bind(service);
		// The author drags the node size in the open graph while the call is on its way. The slider's own
		// write lands after the call has read the view, and before the call writes.
		const slid = vi.spyOn(service, 'read').mockImplementationOnce(async (project) => {
			const held = await read(project);
			await service.updateEntities(project, { display: { ...held.entities.display, nodeSize: 2 } });
			return held;
		});
		const changed = await ok(golden, 'updateRelationshipGraphView', P, { display: { arrows: false }, forces: { repel: 15 } });
		slid.mockRestore();
		// The call set what it named, and the slider's place is kept.
		expect(changed['display']).toEqual({ arrows: false, captions: 'relationship', textFade: 0, nodeSize: 2, lineSize: 1 });
		expect(bodyOf(changed['forces'])['repel']).toBe(15);
	});
});

describe('a freeform view, made and changed', () => {
	const steps = (golden: Golden, P: Body, freeformViewId: string, list: Body[]) => golden.call('applyFreeformSteps', { ...P, freeformViewId }, { body: { steps: list } });

	it('is made under a name of its own, renamed and deleted', async () => {
		const { golden, boards, P } = await ground();
		const reply = await golden.call('createFreeformView', P, { body: { name: ' Second board ' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const made = bodyOf(reply.body);
		expect(reply.location).toBe(`/projects/${golden.project.id}/freeform-views/${String(made['id'])}`);
		expect(made).toMatchObject({ name: 'Second board', placements: [], frames: [], edges: [] });
		expect(refusal(await golden.call('createFreeformView', P, { body: { name: 'BOARD' } }))).toEqual([409, 'duplicate-name']);

		const at = { ...P, freeformViewId: boards.canvas };
		expect((await ok(golden, 'updateFreeformView', at, { name: 'Cast board' }))['name']).toBe('Cast board');
		expect(refusal(await golden.call('updateFreeformView', at, { body: { name: 'second BOARD' } }))).toEqual([409, 'duplicate-name']);
		// Read and sent back whole, it changes nothing.
		const before = vaultState(golden.host);
		await ok(golden, 'updateFreeformView', at, await ok(golden, 'getFreeformView', at));
		expect(vaultState(golden.host)).toEqual(before);
		// Where it opens is set alone, and the name stands.
		const placed = await ok(golden, 'updateFreeformView', at, { viewport: { x: -120, y: 40, zoom: 0.5 } });
		expect([placed['name'], placed['viewport']]).toEqual(['Cast board', { x: -120, y: 40, zoom: 0.5 }]);
		expect(refusal(await golden.call('updateFreeformView', at, { body: { viewport: { x: 0, y: 0, zoom: 9 } } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('updateFreeformView', at, { body: { viewport: { x: 0, y: 0 } } }))).toEqual([400, 'invalid-request']);
		const past = await golden.call('updateFreeformView', at, { body: JSON.parse('{"viewport":{"x":0,"y":-1e999,"zoom":1}}') as Body });
		expect([refusal(past), JSON.stringify(past.body).includes('/viewport/y')]).toEqual([[400, 'invalid-request'], true]);
		expect((await ok(golden, 'getFreeformView', at))['viewport']).toEqual({ x: -120, y: 40, zoom: 0.5 });

		expect((await golden.call('deleteFreeformView', { ...P, freeformViewId: boards.spareCanvas })).status).toBe(204);
		expect(idsOf((await ok(golden, 'listFreeformViews', P))['items'])).toEqual([boards.canvas, made['id']]);
		expect(refusal(await golden.call('deleteFreeformView', { ...P, freeformViewId: boards.spareCanvas }))).toEqual([404, 'not-found']);
		expect(golden.host.told.every((what) => what === 'freeform')).toBe(true);
	});

	it('takes a list of steps as one change, each new thing kept under an id the plugin makes', async () => {
		const { golden, boards, P } = await ground();
		const { ben } = golden.members;
		await golden.host.environment.fakeVault.seedFile(`${golden.project.rootPath}/80_Material/map.png`, 'not really a picture');
		const reply = await steps(golden, P, boards.canvas, [
			{
				do: 'add',
				placements: [
					{ id: 'ben', resource: { type: 'entity', member: { id: ben.characterId } }, x: 400, y: 80, frameId: 'frame-cast' },
					{ resource: { type: 'task', id: 'task-outline' }, x: 10.4, y: 500, width: 300, height: 120 },
					{ resource: { type: 'foreshadowing', id: 'foreshadowing-clock' }, x: 0, y: 700 },
					{ resource: { type: 'revision', id: 'revision-noon' }, x: 0, y: 900 },
					{ resource: { type: 'sticky-note', id: golden.stickyNotes.key.id }, x: 0, y: 1100 },
					{ resource: { type: 'file', relativePath: '80_Material/map.png' }, x: 0, y: 1300 },
					{ id: 'link', resource: { type: 'link', url: 'https://example.com/clocks', label: 'Clocks' }, x: 0, y: 1500 },
				],
			},
			{ do: 'add-frames', frames: [{ id: 'notes', title: 'Notes', color: 'macaron-4', x: -50, y: 450, width: 500, height: 1300 }] },
			{ do: 'connect', edges: [{ id: 'knows', source: 'card-ada', target: 'ben', label: 'sibling', arrow: 'both', line: 'dashed' }] },
			{ do: 'place', places: [{ id: 'link', x: 20, y: 1520, frameId: 'notes' }] },
			{ do: 'text', id: 'card-text', text: 'Why did it stop?' },
			{ do: 'edit-frame', id: 'notes', title: 'Loose ends', color: null },
			{ do: 'edit-edges', edits: [{ id: 'knows', label: 'brother' }] },
			{ do: 'delete', edges: ['line-asks'] },
		]);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const told = bodyOf(reply.body);
		const created = told['created'] as Body[];
		expect(created.map((entry) => [entry['kind'], entry['as']])).toEqual([
			['placement', 'ben'],
			['placement', null],
			['placement', null],
			['placement', null],
			['placement', null],
			['placement', null],
			['placement', 'link'],
			['frame', 'notes'],
			['edge', 'knows'],
		]);
		// Each is kept under an id of the plugin's own making, whatever the call named it.
		expect(created.every((entry) => String(entry['id']).startsWith(`freeform-${String(entry['kind'])}-`))).toBe(true);
		const idOf = (as: string): unknown => created.find((entry) => entry['as'] === as)?.['id'];
		const view = bodyOf(told['view']);
		const placements = view['placements'] as Body[];
		expect(placements.map((placement) => bodyOf(placement['resource'])['type'])).toEqual([
			'entity',
			'text',
			'entity',
			'task',
			'foreshadowing',
			'revision',
			'sticky-note',
			'file',
			'link',
		]);
		const card = (id: unknown): Body => placements.find((placement) => placement['id'] === id) ?? {};
		expect(card(idOf('ben'))).toMatchObject({ x: 400, y: 80, frameId: 'frame-cast', resource: { type: 'entity', member: { id: ben.characterId, name: 'Ben', resolved: true } } });
		expect(card(created[1]?.['id'])).toMatchObject({ x: 10, width: 300, height: 120, resource: { type: 'task', id: 'task-outline', name: 'Outline the thaw' } });
		expect(placements.slice(4, 7).map((placement) => bodyOf(placement['resource'])['name'])).toEqual(['The stopped clock', 'midnight', 'Ask Ben about the key.']);
		expect(card(idOf('link'))).toMatchObject({ x: 20, y: 1520, frameId: idOf('notes'), resource: { type: 'link', url: 'https://example.com/clocks', label: 'Clocks' } });
		expect(card('card-text')).toMatchObject({ resource: { type: 'text', text: 'Why did it stop?' } });
		expect((view['frames'] as Body[]).map((frame) => [frame['id'], frame['title'], frame['color']])).toEqual([
			['frame-cast', 'Cast', 'macaron-2'],
			[idOf('notes'), 'Loose ends', null],
		]);
		expect(view['edges']).toEqual([
			{ id: idOf('knows'), source: 'card-ada', target: idOf('ben'), sourceSide: null, targetSide: null, label: 'brother', arrow: 'both', line: 'dashed' },
		]);
		expect(golden.host.told).toEqual(['freeform']);
	});

	it('takes all of a call’s steps or none, and says which step the view would not take', async () => {
		const { golden, boards, P } = await ground();
		const before = vaultState(golden.host);
		const missing = await steps(golden, P, boards.canvas, [
			{ do: 'text', id: 'card-text', text: 'Changed.' },
			{ do: 'place', places: [{ id: 'card-gone', x: 0, y: 0 }] },
		]);
		expect([refusal(missing), pointerOf(missing), faults(missing)]).toEqual([[422, 'invalid-reference'], '/steps/1/places/0/id', []]);
		const self = await steps(golden, P, boards.canvas, [{ do: 'connect', edges: [{ source: 'card-ada', target: 'card-ada' }] }]);
		expect([refusal(self), JSON.stringify(self.body).includes('/steps/0')]).toEqual([[400, 'invalid-request'], true]);
		// A name is one thing's, for the length of the call, and never the id of something already there.
		const twice = await steps(golden, P, boards.canvas, [
			{ do: 'add', placements: [{ id: 'a', resource: { type: 'text', text: 'One' }, x: 0, y: 0 }] },
			{ do: 'add', placements: [{ id: 'a', resource: { type: 'text', text: 'Two' }, x: 0, y: 0 }] },
		]);
		expect(refusal(twice)).toEqual([400, 'invalid-request']);
		expect(refusal(await steps(golden, P, boards.canvas, [{ do: 'add', placements: [{ id: 'card-ada', resource: { type: 'text', text: 'x' }, x: 0, y: 0 }] }]))).toEqual([400, 'invalid-request']);
		const add = (resource: Body) => steps(golden, P, boards.canvas, [{ do: 'add', placements: [{ resource, x: 0, y: 0 }] }]);
		expect([refusal(await add({ type: 'entity', member: { id: 'character-gone' } })), pointerOf(await add({ type: 'entity', member: { id: 'character-gone' } }))]).toEqual([
			[422, 'invalid-reference'],
			'/steps/0/placements/0/resource/member',
		]);
		expect(refusal(await add({ type: 'task', id: 'task-gone' }))).toEqual([422, 'invalid-reference']);
		expect(refusal(await add({ type: 'file', relativePath: '80_Material/nowhere.png' }))).toEqual([422, 'invalid-reference']);
		expect(refusal(await add({ type: 'file', relativePath: '../outside.md' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await add({ type: 'link', url: 'ftp://example.com/x' }))).toEqual([400, 'invalid-request']);
		const crowd = Array.from({ length: FREEFORM_LIMITS.placements }, (_one, at) => ({ resource: { type: 'text', text: `Card ${String(at)}` }, x: at, y: 0 }));
		const full = await steps(golden, P, boards.canvas, [{ do: 'add', placements: crowd }]);
		expect([refusal(full), faults(full)]).toEqual([[409, 'view-full'], []]);
		expect(refusal(await steps(golden, P, 'freeform-view-gone', [{ do: 'delete', nodes: ['card-text'] }]))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
	});

	it('takes a thing off a view only at the delete level', async () => {
		const { golden, boards, P } = await ground({ access: 'write' });
		const before = vaultState(golden.host);
		const refused = await steps(golden, P, boards.canvas, [
			{ do: 'text', id: 'card-text', text: 'Changed.' },
			{ do: 'delete', nodes: ['card-text'] },
		]);
		expect([refusal(refused), faults(refused)]).toEqual([[403, 'access-denied'], []]);
		expect(bodyOf(refused.body)).toMatchObject({ needs: 'delete', level: 'write', pointer: '/steps/1' });
		// Asked before the view is looked for, as the level of an operation is.
		expect(refusal(await steps(golden, P, 'freeform-view-gone', [{ do: 'delete', nodes: ['card-text'] }]))).toEqual([403, 'access-denied']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
		// Every other step is a change, and the write level takes it.
		const changed = await steps(golden, P, boards.canvas, [{ do: 'text', id: 'card-text', text: 'Changed.' }]);
		expect([changed.status, faults(changed)]).toEqual([200, []]);
		golden.host.state.access = 'delete';
		const gone = await steps(golden, P, boards.canvas, [{ do: 'delete', nodes: ['card-text'] }]);
		expect([gone.status, faults(gone)]).toEqual([200, []]);
		expect(idsOf(bodyOf(bodyOf(gone.body)['view'])['placements'])).not.toContain('card-text');
	});

	it('shows a card another way, restacks, changes a link card and gives a line other ends, at the write level', async () => {
		const { golden, boards, P } = await ground({ access: 'write' });
		const reply = await steps(golden, P, boards.canvas, [
			{
				do: 'add',
				placements: [
					{ id: 'link', resource: { type: 'link', url: 'https://example.com/clocks', label: 'Clocks' }, x: 900, y: 900, displayMode: 'compact' },
					// Laid across the card of Ada, so there is something for it to pass.
					{ id: 'over', resource: { type: 'text', text: 'Over Ada.' }, x: 40, y: 80 },
				],
			},
			{ do: 'connect', edges: [{ id: 'sided', source: 'card-text', target: 'link', sourceSide: 'right', targetSide: 'left' }] },
			{ do: 'display', modes: [{ id: 'card-ada', mode: 'gallery' }, { id: 'over', mode: 'extended' }] },
			{ do: 'restack', ids: ['card-ada'], to: 'front' },
			{ do: 'link', id: 'link', url: 'https://example.com/bells', label: 'Bells' },
			// The line turned about, with a side of its own at one end.
			{ do: 'reconnect', id: 'line-asks', source: 'card-text', target: 'card-ada', sourceSide: 'top' },
		]);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const told = bodyOf(reply.body);
		const idOf = (as: string): unknown => (told['created'] as Body[]).find((entry) => entry['as'] === as)?.['id'];
		const stacked = (view: Body): unknown[] => idsOf([...(view['placements'] as Body[])].sort((a, b) => Number(a['zIndex']) - Number(b['zIndex'])));
		const view = bodyOf(told['view']);
		const card = (id: unknown): Body => (view['placements'] as Body[]).find((placement) => placement['id'] === id) ?? {};
		expect(card('card-ada')).toMatchObject({ displayMode: 'gallery', frameId: 'frame-cast' });
		expect(card(idOf('over'))).toMatchObject({ displayMode: 'extended' });
		expect(card(idOf('link'))).toMatchObject({ displayMode: 'compact', resource: { type: 'link', url: 'https://example.com/bells', label: 'Bells' } });
		expect(stacked(view)).toEqual(['card-text', idOf('link'), idOf('over'), 'card-ada']);
		expect(view['edges']).toEqual([
			{ id: 'line-asks', source: 'card-text', target: 'card-ada', sourceSide: 'top', targetSide: null, label: 'asks', arrow: 'end', line: 'solid' },
			{ id: idOf('sided'), source: 'card-text', target: idOf('link'), sourceSide: 'right', targetSide: 'left', label: '', arrow: 'end', line: 'solid' },
		]);
		expect(golden.host.told).toEqual(['freeform']);

		// One step back takes it under the nearest card it lies across, and no further.
		const lowered = await steps(golden, P, boards.canvas, [{ do: 'restack', ids: ['card-ada'], to: 'backward' }]);
		expect([lowered.status, faults(lowered)]).toEqual([200, []]);
		expect(stacked(bodyOf(bodyOf(lowered.body)['view']))).toEqual(['card-text', idOf('link'), 'card-ada', idOf('over')]);
		// What is left out of a change stays, and a side sent as null is the plugin's to choose again.
		const kept = await steps(golden, P, boards.canvas, [
			{ do: 'link', id: idOf('link'), label: 'Every bell' },
			{ do: 'reconnect', id: 'line-asks', sourceSide: null, targetSide: 'bottom' },
		]);
		const after = bodyOf(bodyOf(kept.body)['view']);
		expect((after['placements'] as Body[]).find((placement) => placement['id'] === idOf('link'))?.['resource']).toEqual({
			type: 'link',
			url: 'https://example.com/bells',
			label: 'Every bell',
		});
		expect((after['edges'] as Body[])[0]).toMatchObject({ source: 'card-text', target: 'card-ada', sourceSide: null, targetSide: 'bottom' });
		// A view already as asked is no failure, and is not written again.
		const before = vaultState(golden.host);
		const same = await steps(golden, P, boards.canvas, [
			{ do: 'display', modes: [{ id: 'card-ada', mode: 'gallery' }] },
			{ do: 'restack', ids: [idOf('over')], to: 'front' },
		]);
		expect([same.status, faults(same)]).toEqual([200, []]);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('refuses a step of those kinds that names the wrong thing, and writes nothing', async () => {
		const { golden, boards, P } = await ground();
		const before = vaultState(golden.host);
		const one = (step: Body) => steps(golden, P, boards.canvas, [step]);
		// A card of another kind than the step changes, a frame where a card is meant, and a thing that is not there.
		const wrongKind = await one({ do: 'link', id: 'card-text', label: 'No link' });
		expect([refusal(wrongKind), pointerOf(wrongKind), faults(wrongKind)]).toEqual([[422, 'invalid-reference'], '/steps/0', []]);
		expect(refusal(await one({ do: 'display', modes: [{ id: 'frame-cast', mode: 'compact' }] }))).toEqual([422, 'invalid-reference']);
		expect(refusal(await one({ do: 'restack', ids: ['card-gone'], to: 'front' }))).toEqual([422, 'invalid-reference']);
		expect(refusal(await one({ do: 'reconnect', id: 'line-gone', target: 'card-ada' }))).toEqual([422, 'invalid-reference']);
		expect(refusal(await one({ do: 'reconnect', id: 'line-asks', target: 'card-gone' }))).toEqual([422, 'invalid-reference']);
		// One id that names nothing is told where it is named, though the others of the step stand: nothing of the step is made.
		const named = async (step: Body): Promise<unknown[]> => {
			const reply = await one(step);
			return [refusal(reply), pointerOf(reply), faults(reply)];
		};
		const lost = (pointer: string): unknown[] => [[422, 'invalid-reference'], pointer, []];
		expect(await named({ do: 'display', modes: [{ id: 'card-ada', mode: 'compact' }, { id: 'card-gone', mode: 'compact' }] })).toEqual(lost('/steps/0/modes/1/id'));
		// A frame has no face to show another way.
		expect(await named({ do: 'display', modes: [{ id: 'card-ada', mode: 'compact' }, { id: 'frame-cast', mode: 'compact' }] })).toEqual(lost('/steps/0/modes/1/id'));
		expect(await named({ do: 'restack', ids: ['card-ada', 'frame-cast', 'card-gone'], to: 'front' })).toEqual(lost('/steps/0/ids/2'));
		expect(await named({ do: 'place', places: [{ id: 'card-ada', x: 5, y: 5 }, { id: 'card-gone', x: 5, y: 5 }] })).toEqual(lost('/steps/0/places/1/id'));
		expect(await named({ do: 'place', places: [{ id: 'card-text', x: 5, y: 5, frameId: 'frame-gone' }] })).toEqual(lost('/steps/0/places/0/frameId'));
		expect(await named({ do: 'edit-edges', edits: [{ id: 'line-asks', label: 'tells' }, { id: 'line-gone', label: 'tells' }] })).toEqual(lost('/steps/0/edits/1/id'));
		expect(await named({ do: 'add', placements: [{ resource: { type: 'text', text: 'Loose.' }, x: 0, y: 0, frameId: 'frame-gone' }] })).toEqual(lost('/steps/0/placements/0/frameId'));
		// A line from a thing to itself, and an address that is no web address.
		expect(refusal(await one({ do: 'reconnect', id: 'line-asks', target: 'card-ada' }))).toEqual([400, 'invalid-request']);
		const second = await steps(golden, P, boards.canvas, [
			{ do: 'add', placements: [{ id: 'link', resource: { type: 'link', url: 'https://example.com/a' }, x: 0, y: 0 }] },
			{ do: 'link', id: 'link', url: 'ftp://example.com/a' },
		]);
		expect([refusal(second), JSON.stringify(second.body).includes('/steps/1/url')]).toEqual([[400, 'invalid-request'], true]);
		// What the contract does not name is refused before the view is looked at.
		expect(refusal(await one({ do: 'display', modes: [{ id: 'card-ada', mode: 'huge' }] }))).toEqual([400, 'invalid-request']);
		expect(refusal(await one({ do: 'restack', ids: ['card-ada'], to: 'top' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await one({ do: 'restack', ids: [], to: 'front' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await one({ do: 'reconnect', id: 'line-asks', sourceSide: 'middle' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await one({ do: 'connect', edges: [{ source: 'card-text', target: 'card-ada', targetSide: 'middle' }] }))).toEqual([400, 'invalid-request']);
		expect(refusal(await one({ do: 'add', placements: [{ resource: { type: 'text', text: 'x' }, x: 0, y: 0, displayMode: 'huge' }] }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
	});

	it('writes the view a project starts with the first time something is put on it', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		const views = (await ok(golden, 'listFreeformViews', P))['items'] as Body[];
		expect(views.map((view) => view['id'])).toEqual(['freeform-view-main']);
		const before = Object.keys(vaultState(golden.host)).length;
		const reply = await steps(golden, P, 'freeform-view-main', [{ do: 'add', placements: [{ resource: { type: 'text', text: 'A first thought.' }, x: 0, y: 0 }] }]);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(Object.keys(vaultState(golden.host)).length).toBe(before + 1);
		expect(((await ok(golden, 'getFreeformView', { ...P, freeformViewId: 'freeform-view-main' }))['placements'] as Body[]).length).toBe(1);
	});

	it('renames a view and sets where it opens in one write', async () => {
		const { golden, boards, P } = await ground();
		const at = { ...P, freeformViewId: boards.canvas };
		const file = golden.host.projects.freeform.viewPath(golden.project, boards.canvas);
		const writes = (): number => golden.host.environment.fakeVault.processCalls.filter((path) => path === file).length;
		const before = writes();
		const changed = await ok(golden, 'updateFreeformView', at, { name: 'Cast and crew', viewport: { x: 12, y: -8, zoom: 1.5 } });
		expect([changed['name'], changed['viewport']]).toEqual(['Cast and crew', { x: 12, y: -8, zoom: 1.5 }]);
		// One change, so one write: a name never lands without its place, nor a place without its name.
		expect(writes() - before).toBe(1);
		expect(golden.host.told).toEqual(['freeform']);
	});

	it('leaves a name the author gave a view in the moment before, where the call names none or the old one', async () => {
		const { golden, boards, P } = await ground();
		const service = golden.host.projects.freeform;
		const at = { ...P, freeformViewId: boards.canvas };
		const read = await ok(golden, 'getFreeformView', at);
		// The author renames the view on their own screen between the call's reading of it and its write.
		const setView = service.setView.bind(service);
		const renaming = vi.spyOn(service, 'setView').mockImplementation(async (project, viewId, change) => {
			await service.renameView(project, viewId, 'Renamed on screen');
			return setView(project, viewId, change);
		});
		const placed = await ok(golden, 'updateFreeformView', at, { viewport: { x: 30, y: 60, zoom: 2 } });
		expect([placed['name'], placed['viewport']]).toEqual(['Renamed on screen', { x: 30, y: 60, zoom: 2 }]);
		// And the whole view sent back as it was read, under the name it had then, with another place.
		await service.renameView(golden.project, boards.canvas, String(read['name']));
		const echoed = await ok(golden, 'updateFreeformView', at, { ...structuredClone(read), viewport: { x: 5, y: 5, zoom: 1 } });
		renaming.mockRestore();
		expect([echoed['name'], echoed['viewport']]).toEqual(['Renamed on screen', { x: 5, y: 5, zoom: 1 }]);
	});

	it('writes the view a project starts with when a caller sets where it opens', async () => {
		const golden = await createGolden();
		const at = { projectId: golden.project.id, freeformViewId: 'freeform-view-main' };
		const before = Object.keys(vaultState(golden.host)).length;
		const placed = await ok(golden, 'updateFreeformView', at, { viewport: { x: 30, y: 60, zoom: 2 } });
		expect(placed['viewport']).toEqual({ x: 30, y: 60, zoom: 2 });
		expect(Object.keys(vaultState(golden.host)).length).toBe(before + 1);
		expect((await ok(golden, 'getFreeformView', at))['viewport']).toEqual({ x: 30, y: 60, zoom: 2 });
	});
});
