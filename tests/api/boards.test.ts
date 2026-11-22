import { beforeAll, describe, expect, it } from 'vitest';

import { BUILT_IN_BEAT_SHEET_TEMPLATE_IDS, DERIVED_TASK_KEYS } from '../../src/domain';
import { RECORDS_MADE, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

const MADE = '2026-02-03T09:30:00.000Z';

let golden: Golden;
let timelineId = '';
let viewId = '';
let sheetId = '';
let canvasId = '';

const pid = (): string => golden.project.id;
const call = async (operation: string, params: Body = {}): Promise<Body> => {
	const reply = await golden.call(operation, { projectId: pid(), ...params });
	expect([reply.status, faults(reply)], operation).toEqual([200, []]);
	return bodyOf(reply.body);
};

/** A member as another answer names it. */
const refOf = (kind: string, id: string, name: string, path: string): Body => ({ kind, id, name, path, resolved: true });

beforeAll(async () => {
	golden = await createGolden();
	const service = golden.host.projects;
	const { ada, stops, morning, midnight } = golden.members;
	const made = { createdAt: RECORDS_MADE, updatedAt: RECORDS_MADE };

	// A timeline that follows Ada: two rows at midnight, and one at a time whose note has since been deleted.
	const [timeline] = await service.timeline.importTimelines(golden.project, [
		{
			name: 'Ada’s week',
			binding: { kind: 'character', id: ada.characterId, name: 'Ada before she was renamed' },
			times: [
				{
					timeId: midnight.entityId,
					rows: [
						{ id: 'row-stop', text: 'The clock stops.', scenes: [stops.sceneId] },
						{ id: 'row-quiet', text: '', scenes: [] },
					],
				},
				{ timeId: 'entity-gone', rows: [{ id: 'row-after', text: 'After.', scenes: [morning.sceneId, 'scene-gone'] }] },
			],
			...made,
		},
	]);
	timelineId = timeline ?? '';
	viewId = (await service.timeline.createView(golden.project, { name: 'Side by side', timelines: [timelineId] })) ?? '';
	await service.timeline.pinTimeline(golden.project, timelineId);

	const [sheet] = await service.beatSheet.importSheets(golden.project, [
		{
			name: 'Winter',
			presentation: 'stack',
			showSubDescriptions: true,
			reversed: true,
			...made,
			acts: [
				{
					id: 'act-setup',
					label: 'Setup',
					beats: [
						{
							id: 'beat-hook',
							name: 'Hook',
							description: 'The clock stops.',
							rows: [{ id: 'row-hook', text: 'Midnight.', scenes: [stops.sceneId] }],
						},
						{ id: 'beat-incident', name: 'Inciting incident', description: '', rows: [] },
					],
				},
				{
					id: 'act-turn',
					label: '',
					beats: [{ id: 'beat-midpoint', name: 'Midpoint', description: '', rows: [{ id: 'row-mid', text: '', scenes: [morning.sceneId] }] }],
				},
			],
		},
	]);
	sheetId = sheet ?? '';
	await service.beatSheet.importTemplates(
		golden.project,
		[
			{
				name: 'Two halves',
				description: 'Mine.',
				structure: {
					acts: [
						{ label: 'Before', beats: [{ name: 'Open', description: 'Begin late.' }] },
						{ label: 'After', beats: [] },
					],
				},
			},
		],
		'skip',
	);

	const card = { x: 24, y: 64, width: 256, height: 160, displayMode: 'auto', zIndex: 1, frameId: null } as const;
	canvasId =
		(await service.freeform.importView(golden.project, {
			name: 'Board',
			viewport: { x: 10, y: 20, zoom: 1.5 },
			...made,
			frames: [{ id: 'frame-cast', title: 'Cast', color: 'macaron-2', x: 0, y: 0, width: 600, height: 400, zIndex: 0 }],
			placements: [
				{ ...card, id: 'card-ada', resource: { type: 'entity', kind: 'character', id: ada.characterId, name: 'An older name' }, frameId: 'frame-cast' },
				{ ...card, id: 'card-key', resource: { type: 'entity', kind: 'item', id: 'entity-gone', name: 'The key' }, displayMode: 'compact' },
				{ ...card, id: 'card-task', resource: { type: 'task', id: 'task-outline', name: 'Outline the thaw' } },
				{ ...card, id: 'card-file', resource: { type: 'file', path: '80_Material/map.png' } },
				{ ...card, id: 'card-link', resource: { type: 'link', url: 'https://example.com/clocks', label: 'Clocks' } },
				{ ...card, id: 'card-text', resource: { type: 'text', text: '**Why** does it stop?' }, zIndex: 2 },
			],
			edges: [
				{ id: 'line-asks', source: 'card-ada', target: 'card-text', sourceSide: 'right', targetSide: null, label: 'asks', arrow: 'end', line: 'dashed' },
			],
			strays: { placements: [], frames: [], edges: [] },
		})) ?? '';
	expect([timelineId, viewId, sheetId, canvasId].every((id) => id.length > 0)).toBe(true);
});

describe('the tasks the plugin derives', () => {
	it('are none where no goal is set and nothing is waiting', async () => {
		expect(await call('listDerivedTasks')).toEqual({ items: [], complete: true });
	});

	it('are a card for each goal and for each place something waits, in the order a column shows them', async () => {
		const busy = await createGolden({
			derived: {
				sources: {
					dailyGoal: 500,
					goalNet: { day: 500, week: 1200, month: 0 },
					daysInMonth: 31,
					unresolvedMentions: 3,
					sensitiveWords: 0,
					openForeshadowings: 1,
					unresolvedForeshadowings: 0,
					pendingRevisions: 5,
					unresolvedRevisions: 2,
					stickyNotes: 2,
				},
				failed: true,
			},
		});
		const reply = await busy.call('listDerivedTasks', { projectId: busy.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toEqual({
			items: [
				// The day's goal is met, the week's is under way, and nothing has been written this month.
				{ key: 'dailyGoal', status: 'done', count: null, progress: { net: 500, goal: 500 } },
				{ key: 'weeklyGoal', status: 'in-progress', count: null, progress: { net: 1200, goal: 3500 } },
				{ key: 'monthlyGoal', status: 'todo', count: null, progress: { net: 0, goal: 15500 } },
				{ key: 'unresolvedMentions', status: 'todo', count: 3, progress: null },
				{ key: 'openForeshadowings', status: 'todo', count: 1, progress: null },
				{ key: 'pendingRevisions', status: 'todo', count: 5, progress: null },
				{ key: 'unresolvedRevisions', status: 'todo', count: 2, progress: null },
				{ key: 'stickyNotes', status: 'todo', count: 2, progress: null },
			],
			// One of the places could not be read, and the answer says so.
			complete: false,
		});
		const keys = items(reply.body).map((card) => card['key']);
		expect(keys).toEqual(DERIVED_TASK_KEYS.filter((key) => keys.includes(key)));
	});
});

describe('the timelines', () => {
	it('are given with the times each names, the rows under each time and the scenes on each row, each as the note it leads to now', async () => {
		const board = await call('getTimeline');
		const { ada, stops, morning, midnight } = golden.members;
		expect(board['timelines']).toEqual([
			{
				id: timelineId,
				name: 'Ada’s week',
				// Kept under an older name. The note says what it is called now.
				binding: refOf('character', ada.characterId, 'Ada', ada.path),
				times: [
					{
						time: refOf('time', midnight.entityId, 'Midnight', midnight.path),
						rows: [
							{ id: 'row-stop', text: 'The clock stops.', scenes: [refOf('scene', stops.sceneId, 'The clock stops', stops.path)] },
							{ id: 'row-quiet', text: '', scenes: [] },
						],
					},
					{
						// A time whose note is gone is still a time the timeline names, and so is a scene.
						time: { kind: 'time', id: 'entity-gone', name: '', path: null, resolved: false },
						rows: [
							{
								id: 'row-after',
								text: 'After.',
								scenes: [
									refOf('scene', morning.sceneId, 'Morning after', morning.path),
									{ kind: 'scene', id: 'scene-gone', name: '', path: null, resolved: false },
								],
							},
						],
					},
				],
				createdAt: MADE,
				updatedAt: MADE,
			},
		]);
		expect(board).toMatchObject({ pinnedTimelineId: timelineId });
	});

	it('are given with their views, the one every project starts with first', async () => {
		const views = (await call('getTimeline'))['views'] as Body[];
		// A timeline brought in is put on the first view by the plugin itself.
		expect(views.map((view) => [view['id'], view['name'], view['timelineIds']])).toEqual([
			['timeline-view-main', 'Main', [timelineId]],
			[viewId, 'Side by side', [timelineId]],
		]);
		expect(views[1]).toMatchObject({ timeOrder: [], presentation: null, cardStyle: null, showSubDescriptions: true, timesReversed: false });
	});

	it('are one empty view and no timeline for a project that has made none, under the name its language gives the view', async () => {
		const reply = await golden.call('getTimeline', { projectId: golden.chinese.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const board = bodyOf(reply.body);
		expect(board).toMatchObject({ timelines: [], pinnedTimelineId: null, lastViewId: null });
		expect((board['views'] as Body[]).map((view) => [view['id'], view['createdAt']])).toEqual([['timeline-view-main', null]]);
		expect(String((board['views'] as Body[])[0]?.['name'])).not.toBe('Main');
	});
});

describe('the beat sheets', () => {
	it('are listed by what each holds, and read one by one with their acts, beats, rows and scenes', async () => {
		const list = await call('listBeatSheets');
		expect(list).toEqual({
			items: [{ id: sheetId, name: 'Winter', acts: 2, beats: 3, scenes: 2, createdAt: MADE, updatedAt: MADE }],
			lastSheetId: null,
		});
		const { stops, morning } = golden.members;
		expect(await call('getBeatSheet', { beatSheetId: sheetId })).toEqual({
			id: sheetId,
			name: 'Winter',
			presentation: 'stack',
			showSubDescriptions: true,
			// Shown from its end, and told in the story's own order all the same.
			reversed: true,
			createdAt: MADE,
			updatedAt: MADE,
			acts: [
				{
					id: 'act-setup',
					number: 1,
					label: 'Setup',
					beats: [
						{
							id: 'beat-hook',
							name: 'Hook',
							description: 'The clock stops.',
							rows: [{ id: 'row-hook', text: 'Midnight.', scenes: [refOf('scene', stops.sceneId, 'The clock stops', stops.path)] }],
						},
						{ id: 'beat-incident', name: 'Inciting incident', description: '', rows: [] },
					],
				},
				{
					id: 'act-turn',
					number: 2,
					label: '',
					beats: [
						{
							id: 'beat-midpoint',
							name: 'Midpoint',
							description: '',
							rows: [{ id: 'row-mid', text: '', scenes: [refOf('scene', morning.sceneId, 'Morning after', morning.path)] }],
						},
					],
				},
			],
		});
	});

	it('are not found one by one under an id the project does not have', async () => {
		const reply = await golden.call('getBeatSheet', { projectId: pid(), beatSheetId: 'beat-sheet-nowhere' });
		expect([reply.status, bodyOf(reply.body)['code'], faults(reply)]).toEqual([404, 'not-found', []]);
		expect(await golden.call('listBeatSheets', { projectId: golden.chinese.id })).toMatchObject({
			status: 200,
			body: { items: [], lastSheetId: null },
		});
	});

	it('can be started from the structures the plugin ships, worded in the project’s language, and from the author’s own', async () => {
		const templates = items(await call('listBeatSheetTemplates'));
		expect(templates.map((template) => [template['id'], template['builtIn']]).slice(0, -1)).toEqual(
			BUILT_IN_BEAT_SHEET_TEMPLATE_IDS.map((id) => [id, true]),
		);
		const threeActs = templates.find((template) => template['id'] === 'three-act');
		expect((threeActs?.['acts'] as Body[]).length).toBe(3);
		expect(templates[templates.length - 1]).toMatchObject({
			name: 'Two halves',
			description: 'Mine.',
			builtIn: false,
			acts: [
				{ label: 'Before', beats: [{ name: 'Open', description: 'Begin late.' }] },
				{ label: 'After', beats: [] },
			],
		});
		const chinese = await golden.call('listBeatSheetTemplates', { projectId: golden.chinese.id });
		expect([chinese.status, faults(chinese)]).toEqual([200, []]);
		expect(items(chinese.body)).toHaveLength(BUILT_IN_BEAT_SHEET_TEMPLATE_IDS.length);
		// The same structure under the name the other language gives it.
		expect(items(chinese.body)[1]?.['id']).toBe('three-act');
		expect(items(chinese.body)[1]?.['name']).not.toBe(threeActs?.['name']);
	});
});

describe('the freeform views', () => {
	it('are listed by what each holds', async () => {
		expect(await call('listFreeformViews')).toEqual({
			items: [{ id: canvasId, name: 'Board', placements: 6, frames: 1, edges: 1, createdAt: MADE, updatedAt: MADE }],
		});
	});

	it('are read one by one with every card and what it shows, every frame and every line', async () => {
		const view = await call('getFreeformView', { freeformViewId: canvasId });
		const { ada } = golden.members;
		expect(view).toMatchObject({
			id: canvasId,
			name: 'Board',
			viewport: { x: 10, y: 20, zoom: 1.5 },
			frames: [{ id: 'frame-cast', title: 'Cast', color: 'macaron-2', x: 0, y: 0, width: 600, height: 400, zIndex: 0 }],
			edges: [
				{ id: 'line-asks', source: 'card-ada', target: 'card-text', sourceSide: 'right', targetSide: null, label: 'asks', arrow: 'end', line: 'dashed' },
			],
		});
		const cards = view['placements'] as Body[];
		expect(cards.map((card) => [card['id'], card['resource']])).toEqual([
			// A note, told as it is now and not as the card last saw it.
			['card-ada', { type: 'entity', member: refOf('character', ada.characterId, 'Ada', ada.path) }],
			// A note that is gone keeps what the card knew of it.
			['card-key', { type: 'entity', member: { kind: 'item', id: 'entity-gone', name: 'The key', path: null, resolved: false } }],
			['card-task', { type: 'task', id: 'task-outline', name: 'Outline the thaw' }],
			['card-file', { type: 'file', path: 'Snowflake Projects/North Wind/80_Material/map.png', relativePath: '80_Material/map.png' }],
			['card-link', { type: 'link', url: 'https://example.com/clocks', label: 'Clocks' }],
			['card-text', { type: 'text', text: '**Why** does it stop?' }],
		]);
		expect(cards[0]).toMatchObject({ x: 24, y: 64, width: 256, height: 160, displayMode: 'auto', zIndex: 1, frameId: 'frame-cast' });
		expect(cards[1]).toMatchObject({ displayMode: 'compact', frameId: null });
	});

	it('are not found one by one under an id the project does not have', async () => {
		const reply = await golden.call('getFreeformView', { projectId: pid(), freeformViewId: 'freeform-nowhere' });
		expect([reply.status, bodyOf(reply.body)['code'], faults(reply)]).toEqual([404, 'not-found', []]);
		const other = await golden.call('getFreeformView', { projectId: golden.chinese.id, freeformViewId: canvasId });
		expect(other.status).toBe(404);
	});
});

describe('the relationship graph', () => {
	it('has a node for every member and a line for every relationship a note records', async () => {
		const graph = await call('getRelationshipGraph');
		const { ada, ben } = golden.members;
		const nodes = graph['nodes'] as Body[];
		// Two characters, two scenes, two times, a place and a faction.
		expect(nodes).toHaveLength(8);
		expect(nodes.slice(0, 2)).toEqual([
			{ id: ada.characterId, group: 'character', kind: 'character', name: 'Ada', aliases: ['The clockmaker'], path: ada.path, weight: 1 },
			{ id: ben.characterId, group: 'character', kind: 'character', name: 'Ben', aliases: [], path: ben.path, weight: 1 },
		]);
		expect(nodes.map((node) => node['group'])).toEqual([
			'character',
			'character',
			'scene',
			'scene',
			'worldbuilding',
			'worldbuilding',
			'worldbuilding',
			'worldbuilding',
		]);
		// Ben's note says he is Ada's sibling, the younger.
		expect(graph['edges']).toMatchObject([
			{ source: ben.characterId, target: ada.characterId, label: 'Sibling', labelPath: 'Family/Sibling', text: 'the younger', record: 0 },
		]);
		expect(graph['labels']).toEqual(['Family/Sibling']);
	});

	it('gives a relationship that points at a note that is gone a node of its own', async () => {
		const broken = await createGolden();
		await broken.host.projects.repository.trashFile(broken.members.ada.path);
		const reply = await broken.call('getRelationshipGraph', { projectId: broken.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const nodes = bodyOf(reply.body)['nodes'] as Body[];
		const lost = nodes.filter((node) => node['group'] === 'unresolved');
		expect(lost).toMatchObject([{ kind: 'unresolved', name: 'Ada', path: null, weight: 1 }]);
		expect(String(lost[0]?.['id'])).toMatch(/^unresolved:/u);
		expect(bodyOf(reply.body)['edges']).toMatchObject([{ source: broken.members.ben.characterId, target: lost[0]?.['id'] }]);
	});
});

describe('the boards, read', () => {
	it('leave the vault as it was, a project that has made none included', async () => {
		const before = vaultState(golden.host);
		for (const projectId of [pid(), golden.chinese.id]) {
			for (const operation of ['listDerivedTasks', 'getTimeline', 'listBeatSheets', 'listBeatSheetTemplates', 'listFreeformViews', 'getRelationshipGraph']) {
				const reply = await golden.call(operation, { projectId });
				expect([reply.status, faults(reply)], `${operation} ${projectId}`).toEqual([200, []]);
			}
		}
		await call('getBeatSheet', { beatSheetId: sheetId });
		await call('getFreeformView', { freeformViewId: canvasId });
		// No file is made for a board a project has not used: the first view of a timeline is told and not written.
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});
});
