import { describe, expect, it } from 'vitest';

import { buildEntityGraph, defaultEntityGraphState, type GraphMember } from '../../src/domain';
import type { RecordLine, RecordTerm } from '../../src/templates/record-lines';
import { edgeHighlight, highlightOf, matchHighlight, pictureOf, tabOrder } from '../../src/ui/relationship-graph-model';

const link = (name: string): RecordTerm => ({ kind: 'link', path: name, name });
const line = (labelPath: string, ...targets: RecordTerm[]): RecordLine => ({
	label: { path: `Demo/20_Character/23_Relationship/${labelPath}/${labelPath}`, display: labelPath },
	value: '',
	clauses: targets.map((term) => ({ kind: 'target' as const, term })),
});
const member = (id: string, group: GraphMember['group'], kind: string, name: string, relationships: RecordLine[] = []): GraphMember => ({
	id,
	group,
	kind,
	name,
	aliases: [],
	path: `Demo/${name}.md`,
	relationships,
});

const members = [
	member('character-1', 'character', 'character', 'Alice', [line('Family', link('Bob')), line('Member', link('Harbour'))]),
	member('character-2', 'character', 'character', 'Bob', [line('Family', link('Alice')), line('Rival', link('Ghost'))]),
	member('character-3', 'character', 'character', 'Carol'),
	member('entity-1', 'worldbuilding', 'location', 'Harbour'),
	member('entity-2', 'worldbuilding', 'faction', 'Guild'),
	member('scene-1', 'scene', 'scene', 'Arrival', [line('Family', link('Alice'))]),
];
const graph = buildEntityGraph(members, (target) => members.find((m) => m.name === target)?.path ?? null);
const state = defaultEntityGraphState();

const picture = (overrides: Partial<Parameters<typeof pictureOf>[0]> = {}) =>
	pictureOf({ graph, state, search: '', focus: null, customKinds: ['faction'], ...overrides });
const names = (nodes: readonly { name: string }[]): string[] => nodes.map((node) => node.name);

describe('the picture the filters leave', () => {
	it('starts without scenes, with unresolved targets and orphans, every node coloured by kind', () => {
		const shown = picture();
		expect(names(shown.nodes)).toEqual(['Alice', 'Bob', 'Carol', 'Harbour', 'Guild', 'Ghost']);
		expect(shown.edges.map((edge) => edge.id)).toEqual([
			'character-1|0|character-2|Family',
			'character-1|1|entity-1|Member',
			'character-2|0|character-1|Family',
			'character-2|1|unresolved:Ghost|Rival',
		]);
		expect(shown.hidden).toEqual({ nodes: 1, edges: 1 });
		expect(shown.matches).toBeNull();
		expect(shown.local).toBe(false);
		expect(Object.fromEntries([...shown.colors].map(([id, color]) => [id, color]))).toEqual({
			'character-1': { by: 'accent', name: 'purple' },
			'character-2': { by: 'accent', name: 'purple' },
			'character-3': { by: 'accent', name: 'purple' },
			'entity-1': { by: 'accent', name: 'green' },
			'entity-2': { by: 'accent', name: 'pink' },
			'unresolved:Ghost': { by: 'unresolved' },
		});
	});

	it('turns kinds, unresolved targets, orphans and relationship words on and off', () => {
		const withScenes = picture({ state: { ...state, filters: { ...state.filters, kindsOff: [] } } });
		expect(names(withScenes.nodes)).toContain('Arrival');
		expect(withScenes.edges).toHaveLength(5);

		const noGhost = picture({ state: { ...state, filters: { ...state.filters, unresolved: false } } });
		expect(names(noGhost.nodes)).not.toContain('Ghost');
		expect(noGhost.edges).toHaveLength(3);

		const noOrphans = picture({ state: { ...state, filters: { ...state.filters, orphans: false } } });
		expect(names(noOrphans.nodes)).toEqual(['Alice', 'Bob', 'Harbour', 'Ghost']);

		const noFamily = picture({ state: { ...state, filters: { ...state.filters, labelsOff: ['Family'] } } });
		expect(noFamily.edges.map((edge) => edge.label)).toEqual(['Member', 'Rival']);
		// Nodes the hidden lines joined stay, since orphans are shown.
		expect(names(noFamily.nodes)).toContain('Carol');
	});

	it('keeps every node and line under a search and hands on what it found, hidden nodes among them', () => {
		const shown = picture({ search: 'kind:character' });
		expect(names(shown.nodes)).toEqual(['Alice', 'Bob', 'Carol', 'Harbour', 'Guild', 'Ghost']);
		expect(shown.edges).toHaveLength(4);
		expect(shown.matches).toEqual(new Set(['character-1', 'character-2', 'character-3']));
		// A scene the filters hide still answers, so the shell can tell what it found from what it shows.
		const hidden = picture({ search: 'arrival' });
		expect(names(hidden.nodes)).not.toContain('Arrival');
		expect(hidden.matches).toEqual(new Set(['scene-1']));
	});

	it('draws a local graph around the focus from the lines the filters left', () => {
		const around = picture({ focus: 'character-2' });
		expect(around.local).toBe(true);
		expect(names(around.nodes).sort()).toEqual(['Alice', 'Bob', 'Ghost']);
		expect(around.edges).toHaveLength(3);
		// A focus the filters hide, or the graph lacks, leaves the whole picture.
		expect(picture({ focus: 'scene-1' }).local).toBe(false);
		expect(picture({ focus: 'nobody' }).local).toBe(false);
	});

	it('colours by the groups when there are any: first match wins, the rest stay plain', () => {
		const grouped = picture({
			state: {
				...state,
				groups: [
					{ query: 'kind:location', color: '#ff0000' },
					{ query: 'alice OR harbour', color: '#00ff00' },
				],
			},
		});
		expect(grouped.colors.get('entity-1')).toEqual({ by: 'hex', hex: '#ff0000' });
		expect(grouped.colors.get('character-1')).toEqual({ by: 'hex', hex: '#00ff00' });
		expect(grouped.colors.get('character-2')).toEqual({ by: 'plain' });
		expect(grouped.colors.get('unresolved:Ghost')).toEqual({ by: 'unresolved' });
	});
});

describe('highlights and the tab walk', () => {
	it('lights the node under the pointer with its neighbours and their lines', () => {
		const shown = picture();
		const lit = highlightOf(shown, 'character-1')!;
		expect([...lit.nodes].sort()).toEqual(['character-1', 'character-2', 'entity-1']);
		expect(lit.edges.size).toBe(3);
		expect(highlightOf(shown, null)).toBeNull();
		const edge = shown.edges[3]!;
		expect(edgeHighlight(edge)).toEqual({ nodes: new Set(['character-2', 'unresolved:Ghost']), edges: new Set([edge.id]) });
	});

	it('lights what the search found with its lines and their other ends, and nothing when none of it is shown', () => {
		const found = matchHighlight(picture({ search: 'alice' }))!;
		expect([...found.nodes].sort()).toEqual(['character-1', 'character-2', 'entity-1']);
		expect(found.edges.size).toBe(3);
		expect(matchHighlight(picture())).toBeNull();
		const none = matchHighlight(picture({ search: 'arrival' }))!;
		expect(none.nodes.size).toBe(0);
		expect(none.edges.size).toBe(0);
	});

	it('walks the shown nodes by name', () => {
		expect(names(tabOrder(picture().nodes))).toEqual(['Alice', 'Bob', 'Carol', 'Ghost', 'Guild', 'Harbour']);
	});
});
