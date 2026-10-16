import { describe, expect, it } from 'vitest';

import { graphMembersOf } from '../../src/services/relationship-graph-service';
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
