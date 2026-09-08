import { describe, expect, it } from 'vitest';

import {
	categoryWithin,
	clearSceneFilters,
	filterScenes,
	linkNamesNote,
	sceneFilterRows,
	sceneFiltered,
	sceneFilters,
	termName,
	type SceneFilters,
} from '../../src/ui/scene-filters';
import type { SceneViewModel } from '../../src/ui/view-model';

const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}:${JSON.stringify(vars)}`;

const scene = (
	id: string,
	overrides: Partial<SceneViewModel> = {},
): SceneViewModel => ({
	id,
	path: `Scenes/${id}.md`,
	title: id,
	rank: 1024,
	progressStatus: null,
	aliases: [],
	categoryPaths: [],
	povPath: '',
	povName: '',
	povMissing: false,
	times: [],
	locations: [],
	characterPaths: [],
	conflict: '',
	color: null,
	linkedManuscript: [],
	worldStatus: [],
	relationships: [],
	events: '',
	customFields: '',
	revision: 'r1',
	readOnly: false,
	healthIssues: [],
	...overrides,
});

const link = (raw: string, target: string, label: string) => ({
	raw,
	linktext: target,
	target,
	label,
});

const characterNames = new Map([
	['Characters/Ada.md', 'Ada'],
	['Characters/Bo.md', 'Bo'],
]);
const context = { t, characterNames };

const scenes: SceneViewModel[] = [
	scene('Dawn', {
		progressStatus: 'complete',
		categoryPaths: ['Arc/Rise'],
		povPath: 'Characters/Ada.md',
		povName: 'Ada',
		times: ['[[Times/Spring|the spring]]'],
		locations: ['the harbour'],
		characterPaths: ['Characters/Ada.md'],
		conflict: 'The tide turns first.',
		color: 'macaron-2',
		linkedManuscript: [
			link('[[Manuscript/Chapter 08#Scene 12]]', 'Manuscript/Chapter 08', 'Chapter 08 › Scene 12'),
		],
	}),
	scene('Noon', {
		aliases: ['Midday'],
		progressStatus: 'in-progress',
		categoryPaths: ['Arc/Fall/Deep'],
		povPath: 'omniscient',
		povName: 'modal.scene.povOmniscient',
		characterPaths: ['Characters/Bo.md'],
		color: 'macaron-5',
		linkedManuscript: [link('[[Chapter 09|Nine]]', 'Chapter 09', 'Nine')],
	}),
	scene('Dusk', {
		times: ['[[Times/Spring]]'],
		locations: ['[[Places/Harbour|the harbour]]'],
		characterPaths: ['Characters/Ada.md', 'Characters/Bo.md'],
	}),
];

const ids = (shown: readonly { scene: SceneViewModel }[]): string[] =>
	shown.map((entry) => entry.scene.id);

const asked = (overrides: Partial<SceneFilters>): SceneFilters => ({
	...sceneFilters(),
	...overrides,
});

describe('the scene funnel', () => {
	it('starts with every question unasked', () => {
		expect(sceneFilters()).toEqual({
			status: 'all',
			category: '',
			pov: '',
			time: '',
			location: '',
			character: '',
			color: '',
			linked: '',
		});
		expect(sceneFiltered(sceneFilters())).toBe(false);
	});

	it('reports when any question is asked', () => {
		for (const key of Object.keys(sceneFilters()) as (keyof SceneFilters)[]) {
			const filters = sceneFilters();
			(filters as unknown as Record<string, string>)[key] =
				key === 'status' ? 'complete' : key === 'color' ? 'macaron-1' : 'x';
			expect(sceneFiltered(filters)).toBe(true);
		}
	});

	it('clears every question in place', () => {
		const filters = asked({ status: 'complete', pov: 'omniscient', linked: 'a' });
		clearSceneFilters(filters);
		expect(filters).toEqual(sceneFilters());
	});

	it('keeps every scene while nothing is asked', () => {
		expect(ids(filterScenes(scenes, '', sceneFilters(), context))).toEqual([
			'Dawn',
			'Noon',
			'Dusk',
		]);
		expect(
			filterScenes(scenes, '  ', sceneFilters(), context).map(
				(entry) => entry.index,
			),
		).toEqual([0, 1, 2]);
	});

	it('keeps the scenes a colour names', () => {
		expect(
			ids(filterScenes(scenes, '', asked({ color: 'macaron-5' }), context)),
		).toEqual(['Noon']);
	});

	it('keeps the scenes linked to a manuscript note whatever heading or alias the link carries', () => {
		expect(
			ids(
				filterScenes(
					scenes,
					'',
					asked({ linked: 'Manuscript/Chapter 08' }),
					context,
				),
			),
		).toEqual(['Dawn']);
		// A link written the short way still names the note under its folder.
		expect(
			ids(
				filterScenes(
					scenes,
					'',
					asked({ linked: 'Manuscript/Chapter 09' }),
					context,
				),
			),
		).toEqual(['Noon']);
		expect(linkNamesNote('Chapter 09', 'Manuscript/Chapter 09.md')).toBe(true);
		expect(linkNamesNote('Chapter 09', 'Manuscript/Old Chapter 09.md')).toBe(
			false,
		);
		expect(linkNamesNote('', 'Manuscript/Chapter 09.md')).toBe(false);
	});

	it('narrows by point of view, status, category subtree, time, location and cast', () => {
		const run = (overrides: Partial<SceneFilters>): string[] =>
			ids(filterScenes(scenes, '', asked(overrides), context));
		expect(run({ pov: 'Characters/Ada.md' })).toEqual(['Dawn']);
		expect(run({ pov: 'omniscient' })).toEqual(['Noon']);
		expect(run({ status: 'in-progress' })).toEqual(['Noon']);
		expect(run({ category: 'Arc' })).toEqual(['Dawn', 'Noon']);
		expect(run({ category: 'Arc/Fall' })).toEqual(['Noon']);
		expect(run({ time: 'the spring' })).toEqual(['Dawn']);
		expect(run({ time: 'Spring' })).toEqual(['Dusk']);
		expect(run({ location: 'the harbour' })).toEqual(['Dawn', 'Dusk']);
		expect(run({ character: 'Characters/Bo.md' })).toEqual(['Noon', 'Dusk']);
		expect(run({ character: 'Characters/Bo.md', status: 'in-progress' })).toEqual([
			'Noon',
		]);
		expect(categoryWithin('Arc/Fall/Deep', 'Arc/Fall')).toBe(true);
		expect(categoryWithin('Arc/Fallen', 'Arc/Fall')).toBe(false);
		expect(termName('[[Times/Spring|the spring]]')).toBe('the spring');
		expect(termName('[[Times/Spring]]')).toBe('Spring');
		expect(termName(' the harbour ')).toBe('the harbour');
	});

	it('matches the query against names, aliases, cast, links and the status label', () => {
		const run = (query: string): string[] =>
			ids(filterScenes(scenes, query, sceneFilters(), context));
		expect(run('midday')).toEqual(['Noon']);
		expect(run('ada')).toEqual(['Dawn', 'Dusk']);
		expect(run('status.complete')).toEqual(['Dawn']);
		expect(run('Scene 12')).toEqual(['Dawn']);
		expect(run('tide')).toEqual(['Dawn']);
		expect(run('nothing here')).toEqual([]);
	});

	it("lists the funnel rows in the table's order with colour and linked manuscript last", () => {
		const filters = asked({ color: 'macaron-2' });
		const rows = sceneFilterRows(
			t,
			{
				characters: [{ path: 'Characters/Ada.md', name: 'Ada' }],
				worldbuilding: {
					time: [{ name: 'Spring' }],
					location: [{ name: 'Harbour' }, { name: '' }],
				},
			},
			filters,
			{
				categoryPaths: ['Arc', 'Arc/Rise'],
				manuscriptNotes: [{ path: 'Manuscript/Chapter 08.md', title: 'Chapter 08' }],
			},
		);
		expect(rows.map((row) => row.label)).toEqual([
			'table.progressStatus',
			'table.category',
			'table.scenePov',
			'table.sceneTime',
			'table.sceneLocation',
			'table.sceneCharacters',
			'table.sceneColor',
			'table.sceneLinked',
		]);
		expect(rows.map((row) => row.empty)).toEqual(['all', '', '', '', '', '', '', '']);
		expect(rows[2]?.options().map((option) => option.value)).toEqual([
			'omniscient',
			'multiple',
			'Characters/Ada.md',
		]);
		expect(rows[4]?.options().map((option) => option.value)).toEqual(['Harbour']);
		expect(rows[6]?.value).toBe('macaron-2');
		expect(rows[6]?.options()).toHaveLength(8);
		expect(rows[7]?.options()).toEqual([
			{ value: 'Manuscript/Chapter 08', label: 'Chapter 08' },
		]);
		rows[7]?.apply('Manuscript/Chapter 08');
		rows[6]?.apply('not a colour');
		rows[0]?.apply('nonsense');
		expect(filters.linked).toBe('Manuscript/Chapter 08');
		expect(filters.color).toBe('');
		expect(filters.status).toBe('all');
	});

	it('leaves the scenes alone', () => {
		const before = JSON.stringify(scenes);
		filterScenes(scenes, 'ada', asked({ color: 'macaron-2' }), context);
		expect(JSON.stringify(scenes)).toBe(before);
	});
});
