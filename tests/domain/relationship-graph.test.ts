import { describe, expect, it } from 'vitest';

import {
	buildEntityGraph,
	labelLeaf,
	localGraph,
	matchGraphQuery,
	pairKey,
	UNRESOLVED_NODE_PREFIX,
	type GraphMember,
} from '../../src/domain/relationship-graph';
import type { RecordLine, RecordTerm } from '../../src/templates/record-lines';

const link = (path: string, name = path.split('/').pop()!): RecordTerm => ({ kind: 'link', path, name });
const text = (value: string): RecordTerm => ({ kind: 'text', text: value });

/** A relationship line: the vocabulary note, the holder's own words, and one target per arrow. */
const line = (labelPath: string, value: string, ...targets: RecordTerm[]): RecordLine => ({
	label: { path: `Demo/20_Character/23_Relationship/${labelPath}/${labelLeaf(labelPath)}`, display: labelPath },
	value,
	clauses: targets.map((term) => ({ kind: 'target' as const, term })),
});

const member = (
	id: string,
	group: GraphMember['group'],
	kind: string,
	name: string,
	relationships: RecordLine[] = [],
	aliases: string[] = [],
): GraphMember => ({
	id,
	group,
	kind,
	name,
	aliases,
	path: `Demo/${group === 'character' ? '20_Character' : group === 'scene' ? '40_Scene' : '60_Worldbuilding/62_Location'}/${name}.md`,
	relationships,
});

/** Links resolve to the member whose note has the link's leaf as its name, within Demo. */
const resolve = (members: GraphMember[]) => (target: string): string | null =>
	members.find((candidate) => candidate.path.endsWith(`/${target.split('/').pop()!}.md`))?.path ?? null;

const alice = member('character-1', 'character', 'character', 'Alice', [
	line('Family', 'her brother', link('Demo/20_Character/Bob')),
	line('Social/Friend', '', link('Carol'), link('Bob')),
]);
const bob = member('character-2', 'character', 'character', 'Bob', [line('Family', 'his sister', link('Alice'))], ['Robert']);
const carol = member('character-3', 'character', 'character', 'Carol');
const harbour = member('entity-1', 'worldbuilding', 'location', 'Harbour', [
	line('Member', 'home port', link('Alice')),
	line('Member', '', text('The Fleet')),
	line('Member', '', link('Nobody')),
]);
const scene = member('scene-1', 'scene', 'scene', 'Arrival', [line('Family', '', link('Alice'))]);
const members = [alice, bob, carol, harbour, scene];

describe('building the entity graph', () => {
	const graph = buildEntityGraph(members, resolve(members));

	it('makes a node of every member and one faint node per target that leads nowhere', () => {
		expect(graph.nodes.map((node) => node.id)).toEqual([
			'character-1',
			'character-2',
			'character-3',
			'entity-1',
			'scene-1',
			`${UNRESOLVED_NODE_PREFIX}The Fleet`,
			`${UNRESOLVED_NODE_PREFIX}Nobody`,
		]);
		const fleet = graph.nodes.find((node) => node.id === `${UNRESOLVED_NODE_PREFIX}The Fleet`)!;
		expect(fleet).toMatchObject({ group: 'unresolved', kind: 'unresolved', name: 'The Fleet', path: null, weight: 1 });
		expect(graph.nodes.find((node) => node.id === 'character-2')).toMatchObject({
			group: 'character',
			kind: 'character',
			name: 'Bob',
			aliases: ['Robert'],
			path: 'Demo/20_Character/Bob.md',
		});
	});

	it('draws one line per arrow, from holder to target, worded by the vocabulary leaf', () => {
		const lines = graph.edges.map((edge) => [edge.source, edge.target, edge.label, edge.labelPath, edge.text, edge.record]);
		expect(lines).toEqual([
			['character-1', 'character-2', 'Family', 'Family', 'her brother', 0],
			['character-1', 'character-3', 'Friend', 'Social/Friend', '', 1],
			['character-1', 'character-2', 'Friend', 'Social/Friend', '', 1],
			['character-2', 'character-1', 'Family', 'Family', 'his sister', 0],
			['entity-1', 'character-1', 'Member', 'Member', 'home port', 0],
			['entity-1', `${UNRESOLVED_NODE_PREFIX}The Fleet`, 'Member', 'Member', '', 1],
			['entity-1', `${UNRESOLVED_NODE_PREFIX}Nobody`, 'Member', 'Member', '', 2],
			['scene-1', 'character-1', 'Family', 'Family', '', 0],
		]);
		expect(graph.edges[0]!.id).toBe('character-1|0|character-2|Family');
		expect(graph.labels).toEqual(['Family', 'Social/Friend', 'Member']);
	});

	it('spreads the lines between one pair into lanes either side of the straight line', () => {
		const between = graph.edges.filter((edge) => pairKey(edge.source, edge.target) === pairKey('character-1', 'character-2'));
		expect(between.map((edge) => edge.lane)).toEqual([-1, 0, 1]);
		expect(graph.edges.find((edge) => edge.target === 'character-3')!.lane).toBe(0);
	});

	it('weighs a node by every line that touches it', () => {
		const weights = Object.fromEntries(graph.nodes.map((node) => [node.name, node.weight]));
		expect(weights).toEqual({ Alice: 6, Bob: 3, Carol: 1, Harbour: 3, Arrival: 1, 'The Fleet': 1, Nobody: 1 });
	});

	it('draws nothing for a line without a target, a target of oneself or an empty text target', () => {
		const loner = member('character-9', 'character', 'character', 'Loner', [
			{ label: { path: 'Demo/20_Character/23_Relationship/Rival/Rival', display: 'Rival' }, value: 'with no one', clauses: [] },
			line('Rival', '', link('Loner')),
			line('Rival', '', text('   ')),
		]);
		const built = buildEntityGraph([loner], resolve([loner]));
		expect(built.edges).toEqual([]);
		expect(built.nodes.map((node) => node.id)).toEqual(['character-9']);
		expect(built.labels).toEqual([]);
	});

	it('tells two lines of one record to one target apart', () => {
		const twice = member('character-9', 'character', 'character', 'Twice', [line('Rival', '', link('Alice'), link('Alice'))]);
		const built = buildEntityGraph([twice, alice], resolve([twice, alice]));
		expect(built.edges.slice(0, 2).map((edge) => edge.id)).toEqual([
			'character-9|0|character-1|Rival',
			'character-9|0|character-1|Rival|2',
		]);
	});

	it('reads the leaf of a taxonomy path and falls back to the label note when the display is blank', () => {
		expect(labelLeaf('Social/Friend')).toBe('Friend');
		expect(labelLeaf('Family')).toBe('Family');
		expect(labelLeaf(' Family / ')).toBe('Family');
		const blank = member('character-9', 'character', 'character', 'Blank', [
			{ label: { path: 'Demo/20_Character/23_Relationship/Rival/Rival', display: '  ' }, value: '', clauses: [{ kind: 'target', term: link('Alice') }] },
		]);
		const built = buildEntityGraph([blank, alice], resolve([blank, alice]));
		expect(built.edges[0]).toMatchObject({ label: 'Rival', labelPath: 'Rival' });
	});
});

describe('the query grammar', () => {
	const graph = buildEntityGraph(members, resolve(members));
	const names = (query: string): string[] | null => {
		const matches = matchGraphQuery(query, graph);
		return matches === null ? null : graph.nodes.filter((node) => matches.has(node.id)).map((node) => node.name);
	};

	it('matches names and aliases by folded substring, and nothing for an empty query', () => {
		expect(names('')).toBeNull();
		expect(names('   ')).toBeNull();
		expect(names('ali')).toEqual(['Alice']);
		expect(names('ROBERT')).toEqual(['Bob']);
		expect(names('"the fleet"')).toEqual(['The Fleet']);
		expect(names('o')).toEqual(['Bob', 'Carol', 'Harbour', 'Nobody']);
	});

	it('knows kind, path and relationship, and nothing else', () => {
		expect(names('kind:character')).toEqual(['Alice', 'Bob', 'Carol']);
		expect(names('kind:Location')).toEqual(['Harbour']);
		expect(names('kind:unresolved')).toEqual(['The Fleet', 'Nobody']);
		expect(names('path:40_Scene')).toEqual(['Arrival']);
		expect(names('path:"20_Character/Bob"')).toEqual(['Bob']);
		expect(names('relationship:family')).toEqual(['Alice', 'Bob', 'Arrival']);
		expect(names('relationship:"social/friend"')).toEqual(['Alice', 'Bob', 'Carol']);
		expect(names('tag:#x')).toEqual([]);
	});

	it('takes not, or and parentheses, with and between the rest', () => {
		expect(names('kind:character -bob')).toEqual(['Alice', 'Carol']);
		expect(names('bob OR carol')).toEqual(['Bob', 'Carol']);
		expect(names('kind:character (bob OR carol)')).toEqual(['Bob', 'Carol']);
		expect(names('-(kind:character OR kind:scene)')).toEqual(['Harbour', 'The Fleet', 'Nobody']);
		expect(names('kind:location relationship:member -fleet')).toEqual(['Harbour']);
	});

	it('shrugs at a lone operator, an unclosed quote or a stray parenthesis', () => {
		expect(names('OR')).toBeNull();
		expect(names('-')).toBeNull();
		expect(names('- bob')).toEqual(['Bob']);
		expect(names('-bob -')).toEqual(['Alice', 'Carol', 'Harbour', 'Arrival', 'The Fleet', 'Nobody']);
		expect(names('"carol')).toEqual(['Carol']);
		expect(names('(bob')).toEqual(['Bob']);
		expect(names('bob)')).toEqual(['Bob']);
		expect(names(') carol')).toEqual(['Carol']);
	});
});

describe('the local graph', () => {
	const graph = buildEntityGraph(members, resolve(members));
	const reach = (focus: string, depth: number, incoming = true, outgoing = true, neighbours = false) => {
		const local = localGraph(graph, focus, { depth, incoming, outgoing, neighbours });
		return { nodes: [...local.nodes].sort(), edges: local.edges.size };
	};

	it('walks one hop both ways, then another', () => {
		expect(reach('character-2', 1)).toEqual({ nodes: ['character-1', 'character-2'], edges: 3 });
		expect(reach('character-2', 2).nodes).toEqual(['character-1', 'character-2', 'character-3', 'entity-1', 'scene-1']);
	});

	it('follows only the direction asked for', () => {
		expect(reach('character-1', 1, false, true)).toEqual({ nodes: ['character-1', 'character-2', 'character-3'], edges: 3 });
		expect(reach('character-1', 1, true, false)).toEqual({ nodes: ['character-1', 'character-2', 'entity-1', 'scene-1'], edges: 3 });
	});

	it('adds the lines between reached nodes only when asked', () => {
		// Carol and Bob are both one hop from Alice; no line joins them, but Bob's own line to Alice was not walked outward.
		expect(reach('character-1', 1, false, true, false).edges).toBe(3);
		expect(reach('character-1', 1, false, true, true).edges).toBe(4);
	});

	it('reaches nothing from a node the graph does not hold', () => {
		expect(reach('character-404', 3)).toEqual({ nodes: [], edges: 0 });
	});
});
