import { describe, expect, it } from 'vitest';

import { graphMembersOf, graphTimesOf } from '../../src/services/relationship-graph-service';
import type { ProjectSnapshot } from '../../src/services/types';

/** As much of a snapshot as the listing reads. */
const snapshot = {
	characters: [
		{ id: 'character-1', name: 'Alice', aliases: ['Ally'], path: 'Demo/20_Character/Alice.md', relationships: [{ label: { path: 'x', display: 'Family' }, value: '', clauses: [] }] },
	],
	scenes: [{ id: 'scene-1', title: 'Arrival', aliases: [], path: 'Demo/40_Scene/Arrival.md', relationships: [] }],
	worldbuildingKinds: [
		{ id: 'time', folderName: '61_Time', custom: false, icon: null, description: null },
		{ id: 'location', folderName: '62_Location', custom: false, icon: null, description: null },
		{ id: 'faction', folderName: '64_Faction', custom: true, icon: null, description: null },
	],
	worldbuilding: {
		location: [{ id: 'entity-2', kind: 'location', name: 'Harbour', aliases: [], path: 'Demo/60_Worldbuilding/62_Location/Harbour.md', relationships: [] }],
		faction: [{ id: 'entity-3', kind: 'faction', name: 'Guild', aliases: ['The Guild'], path: 'Demo/60_Worldbuilding/64_Faction/Guild.md', relationships: [] }],
	},
} as unknown as ProjectSnapshot;

describe('listing a project for the entity graph', () => {
	it('names every member with its kind, in project order, scenes by their title', () => {
		const members = graphMembersOf(snapshot);
		expect(members.map((member) => [member.id, member.group, member.kind, member.name])).toEqual([
			['character-1', 'character', 'character', 'Alice'],
			['scene-1', 'scene', 'scene', 'Arrival'],
			['entity-2', 'worldbuilding', 'location', 'Harbour'],
			['entity-3', 'worldbuilding', 'faction', 'Guild'],
		]);
		expect(members[0]).toMatchObject({ aliases: ['Ally'], path: 'Demo/20_Character/Alice.md' });
		expect(members[0]!.relationships).toHaveLength(1);
		expect(members[3]!.aliases).toEqual(['The Guild']);
	});
});

describe('listing a project\'s times for the graph\'s timeline', () => {
	const folder = 'Demo/60_Worldbuilding/61_Time';
	const time = (id: string, name: string, timeKind: 'point' | 'period' | null, timeStart = '', timeEnd = '') => ({
		id, kind: 'time', name, aliases: [], path: `${folder}/${name}.md`, relationships: [], timeKind, timeStart, timeEnd,
	});
	const project = {
		worldbuilding: {
			time: [
				time('time-1', 'Dawn', 'point'),
				time('time-2', 'The siege', 'period', `[[${folder}/Dawn]]`, '[[Dusk|nightfall]]'),
				time('time-3', 'Dusk', null),
				time('time-4', 'The long winter', 'period', 'before the thaw', '[[Nowhere]]'),
				// A point keeps no ends, whatever its note still holds.
				time('time-5', 'Noon', 'point', '[[Dawn]]', '[[Dusk]]'),
			],
		},
	} as unknown as ProjectSnapshot;
	/** Links resolve to the time whose note has the link's leaf as its name. */
	const resolve = (link: string): string | null => {
		const leaf = link.split('/').pop()!;
		return ['Dawn', 'Dusk'].includes(leaf) ? `${folder}/${leaf}.md` : null;
	};

	it('keeps the notes\' own order, reads a note of no kind as a point, and resolves a period\'s ends to time notes', () => {
		expect(graphTimesOf(project, resolve)).toEqual([
			{ id: 'time-1', name: 'Dawn', path: `${folder}/Dawn.md`, kind: 'point', start: null, end: null },
			{ id: 'time-2', name: 'The siege', path: `${folder}/The siege.md`, kind: 'period', start: 'time-1', end: 'time-3' },
			{ id: 'time-3', name: 'Dusk', path: `${folder}/Dusk.md`, kind: 'point', start: null, end: null },
			{ id: 'time-4', name: 'The long winter', path: `${folder}/The long winter.md`, kind: 'period', start: null, end: null },
			{ id: 'time-5', name: 'Noon', path: `${folder}/Noon.md`, kind: 'point', start: null, end: null },
		]);
	});

	it('answers nothing for a project with no time notes', () => {
		expect(graphTimesOf({ worldbuilding: {} } as unknown as ProjectSnapshot, resolve)).toEqual([]);
	});
});
