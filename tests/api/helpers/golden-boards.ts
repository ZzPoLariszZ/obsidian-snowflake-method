import { RECORDS_MADE, type Golden } from './golden-project';

/**
 * The boards of the first project, laid out through the plugin's own
 * services: a timeline that follows Ada, a beat sheet and a freeform view
 * with something of everything on them, and beside each a second one with
 * nothing on it, for a test to delete. What stands on a board is known by
 * the ids it is made with here. The boards themselves are known by the ids
 * the services gave them.
 */
export interface GoldenBoards {
	timeline: string;
	spareTimeline: string;
	/** A view that shows the first timeline, and one that shows nothing. */
	view: string;
	spareView: string;
	sheet: string;
	spareSheet: string;
	/** A template of the author's own. */
	template: string;
	canvas: string;
	spareCanvas: string;
}

const seeded = new WeakMap<Golden, GoldenBoards>();

/** The boards a vault was given by `seedBoards`. */
export function boardsOf(golden: Golden): GoldenBoards {
	const boards = seeded.get(golden);
	if (boards === undefined) throw new Error('The vault was given no boards.');
	return boards;
}

export async function seedBoards(golden: Golden): Promise<GoldenBoards> {
	const service = golden.host.projects;
	const { ada, stops, morning, midnight } = golden.members;
	const made = { createdAt: RECORDS_MADE, updatedAt: RECORDS_MADE };
	const must = (id: string | null | undefined): string => {
		if (typeof id !== 'string' || id.length === 0) throw new Error('The board took what it was given.');
		return id;
	};

	const [timeline, spareTimeline] = await service.timeline.importTimelines(golden.project, [
		{
			name: 'Ada’s week',
			binding: { kind: 'character', id: ada.characterId, name: 'Ada' },
			times: [
				{
					timeId: midnight.entityId,
					rows: [
						{ id: 'row-stop', text: 'The clock stops.', scenes: [stops.sceneId] },
						{ id: 'row-quiet', text: 'Nobody speaks.', scenes: [] },
					],
				},
			],
			...made,
		},
		{ name: 'To delete', binding: null, times: [], ...made },
	]);
	const view = await service.timeline.createView(golden.project, { name: 'Side by side', timelines: [must(timeline)] });
	const spareView = await service.timeline.createView(golden.project, { name: 'Empty', timelines: [] });

	const [sheet, spareSheet] = await service.beatSheet.importSheets(golden.project, [
		{
			name: 'Winter',
			presentation: null,
			showSubDescriptions: true,
			reversed: false,
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
							rows: [
								{ id: 'row-hook', text: 'Midnight.', scenes: [stops.sceneId] },
								{ id: 'row-spare', text: 'Spare.', scenes: [] },
							],
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
		{ name: 'To delete', presentation: null, showSubDescriptions: true, reversed: false, ...made, acts: [] },
	]);
	const [template] = await service.beatSheet.importTemplates(
		golden.project,
		[{ name: 'Two halves', description: 'Mine.', structure: { acts: [{ label: 'Before', beats: [{ name: 'Open', description: 'Begin late.' }] }] } }],
		'skip',
	);

	const card = { x: 24, y: 64, width: 256, height: 160, displayMode: 'auto', zIndex: 1, frameId: null } as const;
	const canvas = await service.freeform.importView(golden.project, {
		name: 'Board',
		viewport: { x: 0, y: 0, zoom: 1 },
		...made,
		frames: [{ id: 'frame-cast', title: 'Cast', color: 'macaron-2', x: 0, y: 0, width: 600, height: 400, zIndex: 0 }],
		placements: [
			{ ...card, id: 'card-ada', resource: { type: 'entity', kind: 'character', id: ada.characterId, name: 'Ada' }, frameId: 'frame-cast' },
			{ ...card, id: 'card-text', resource: { type: 'text', text: 'Why does it stop?' }, zIndex: 2 },
		],
		edges: [{ id: 'line-asks', source: 'card-ada', target: 'card-text', sourceSide: null, targetSide: null, label: 'asks', arrow: 'end', line: 'solid' }],
		strays: { placements: [], frames: [], edges: [] },
	});
	const spareCanvas = await service.freeform.importView(golden.project, {
		name: 'To delete',
		viewport: { x: 0, y: 0, zoom: 1 },
		// Made a moment later, so the two keep the order they were made in.
		createdAt: RECORDS_MADE + 1000,
		updatedAt: RECORDS_MADE + 1000,
		frames: [],
		placements: [],
		edges: [],
		strays: { placements: [], frames: [], edges: [] },
	});

	const boards: GoldenBoards = {
		timeline: must(timeline),
		spareTimeline: must(spareTimeline),
		view: must(view),
		spareView: must(spareView),
		sheet: must(sheet),
		spareSheet: must(spareSheet),
		template: must(template),
		canvas: must(canvas),
		spareCanvas: must(spareCanvas),
	};
	seeded.set(golden, boards);
	return boards;
}
