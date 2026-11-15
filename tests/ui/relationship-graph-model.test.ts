import { describe, expect, it } from 'vitest';

import { buildEntityGraph, defaultEntityGraphState, type GraphMember } from '../../src/domain';
import type { RecordLine, RecordTerm } from '../../src/templates/record-lines';
import { edgeHighlight, highlightOf, matchHighlight, pictureBase, pictureFrom, pictureOf, tabOrder } from '../../src/ui/relationship-graph-model';

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

describe('the picture of one time', () => {
	const both = 'character-1|0|character-2|Family';
	const back = 'character-2|0|character-1|Family';
	const member = 'character-1|1|entity-1|Member';
	const rival = 'character-2|1|unresolved:Ghost|Rival';

	it('leaves out the lines that do not stand at it, and counts them among the hidden', () => {
		const shown = picture({ hidden: new Set([both, rival]) });
		expect(shown.edges.map((edge) => edge.id)).toEqual([member, back]);
		// With orphans shown every node stands, whatever lines it has left.
		expect(names(shown.nodes)).toEqual(['Alice', 'Bob', 'Carol', 'Harbour', 'Guild', 'Ghost']);
		expect(shown.hidden).toEqual({ nodes: 1, edges: 3 });
		// No time at all is the whole graph.
		expect(picture({ hidden: null }).edges).toHaveLength(4);
		expect(picture({ hidden: new Set() }).edges).toHaveLength(4);
	});

	it('takes the lines away before the orphans are read, so a node with none standing goes with the toggle', () => {
		const noOrphans = { ...state, filters: { ...state.filters, orphans: false } };
		expect(names(picture({ state: noOrphans, hidden: new Set([member, rival]) }).nodes)).toEqual(['Alice', 'Bob']);
		expect(names(picture({ state: noOrphans, hidden: new Set([both, back, member, rival]) }).nodes)).toEqual([]);
	});

	it('lanes the lines left among themselves: one left alone between its two nodes runs straight', () => {
		// The two Family lines between Alice and Bob run either side of the straight line while both stand.
		expect(picture().edges.filter((edge) => edge.label === 'Family').map((edge) => edge.lane)).toEqual([-0.5, 0.5]);
		expect(picture({ hidden: new Set() }).edges.filter((edge) => edge.label === 'Family').map((edge) => edge.lane)).toEqual([-0.5, 0.5]);
		const alone = picture({ hidden: new Set([both]) }).edges.find((edge) => edge.id === back);
		expect(alone?.lane).toBe(0);
	});

	it('draws a local graph over the lines standing, and keeps the node it is drawn about when none of its lines do', () => {
		const local = picture({ focus: 'character-1', hidden: new Set([member]) });
		expect(names(local.nodes)).toEqual(['Alice', 'Bob']);
		const noOrphans = { ...state, filters: { ...state.filters, orphans: false } };
		const bare = picture({ state: noOrphans, focus: 'character-1', hidden: new Set([both, back, member]) });
		expect(names(bare.nodes)).toEqual(['Alice']);
		expect(bare.edges).toEqual([]);
		expect(bare.local).toBe(true);
	});

	it('holds a node back until a line of the picture reaches it, whatever the orphans toggle says', () => {
		// Carol, the Harbour, the Guild and the Ghost are held back: only the ones a standing line reaches are drawn.
		const held = new Set(['character-3', 'entity-1', 'entity-2', 'unresolved:Ghost']);
		const reached = picture({ hidden: new Set([rival]), held });
		expect(names(reached.nodes)).toEqual(['Alice', 'Bob', 'Harbour']);
		expect(reached.edges.map((edge) => edge.id)).toEqual([both, member, back]);
		// With every line of theirs away, none of the held is there, though orphans are shown: they are not there yet.
		const none = picture({ hidden: new Set([member, rival]), held });
		expect(names(none.nodes)).toEqual(['Alice', 'Bob']);
		expect(state.filters.orphans).toBe(true);
		// A node not held back stands as an orphan as ever.
		expect(names(picture({ hidden: new Set([both, back, member, rival]), held }).nodes)).toEqual(['Alice', 'Bob']);
		// Nothing held, or an empty holding, is the picture as it was.
		expect(names(picture({ hidden: new Set([member, rival]), held: null }).nodes)).toEqual(['Alice', 'Bob', 'Carol', 'Harbour', 'Guild', 'Ghost']);
		expect(names(picture({ hidden: new Set([member, rival]), held: new Set() }).nodes)).toEqual(['Alice', 'Bob', 'Carol', 'Harbour', 'Guild', 'Ghost']);
		// The count of what is left out takes the held with it.
		expect(none.hidden).toEqual({ nodes: 5, edges: 3 });
	});

	it('keeps the node a local graph is drawn about, held back or not, and reads the orphans after the holding', () => {
		const held = new Set(['character-3', 'entity-1']);
		// Carol has no line at all: held back she is gone, but a local graph about her still shows her.
		expect(names(picture({ hidden: new Set(), held }).nodes)).not.toContain('Carol');
		const about = picture({ focus: 'character-3', hidden: new Set(), held });
		expect(about.local).toBe(true);
		expect(names(about.nodes)).toEqual(['Carol']);
		// With orphans off the held and the orphans go alike, and a held node a line reaches stays.
		const noOrphans = { ...state, filters: { ...state.filters, orphans: false } };
		expect(names(picture({ state: noOrphans, hidden: new Set([rival]), held }).nodes)).toEqual(['Alice', 'Bob', 'Harbour']);
	});

	it('draws every time from one base, whose lines are the ones the filters leave', () => {
		const base = pictureBase({ graph, state: { ...state, filters: { ...state.filters, labelsOff: ['Rival'] } }, search: 'alice', customKinds: ['faction'] });
		expect(base.edges.map((edge) => edge.id)).toEqual([both, member, back]);
		expect([...(base.matches ?? [])]).toEqual(['character-1']);
		const first = pictureFrom(base, null, new Set([both]));
		const second = pictureFrom(base, null, new Set([member]));
		expect(first.edges.map((edge) => edge.id)).toEqual([member, back]);
		expect(second.edges.map((edge) => edge.id)).toEqual([both, back]);
		// What does not change with the time is the base's own.
		expect(first.matches).toBe(base.matches);
		expect(second.matches).toBe(base.matches);
		expect(pictureFrom(base, null).edges).toBe(base.edges);
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
