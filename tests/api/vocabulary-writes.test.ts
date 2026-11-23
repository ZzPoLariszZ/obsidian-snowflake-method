import { describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

/** A vault of its own for each test, with what the repository was told of its making forgotten. */
async function fresh(): Promise<Golden> {
	const golden = await createGolden();
	golden.host.origins.length = 0;
	return golden;
}
const WORLD = 'Snowflake Projects/North Wind/60_Worldbuilding';

describe('a kind, made', () => {
	it('is added beside the others under its name, with its folder, and can hold notes at once', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const reply = await golden.call('createKind', P, { body: { name: ' Creature ', icon: 'paw-print', description: 'What walks the ice.' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(reply.body).toEqual({
			id: 'Creature',
			group: 'worldbuilding',
			builtIn: false,
			name: 'Creature',
			// The author's first kind took 64.
			path: `${WORLD}/65_Creature`,
			icon: 'paw-print',
			description: 'What walks the ice.',
			hasTimeFields: false,
			defaultFieldTemplate: null,
			count: 0,
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/kinds/Creature`);
		expect(items((await golden.call('listKinds', P)).body).map((kind) => kind['id'])).toEqual([
			'character',
			'scene',
			'time',
			'location',
			'item',
			'Faction',
			'Creature',
		]);
		const note = await golden.call('createEntity', P, { body: { kind: 'Creature', name: 'Ice wolf' } });
		expect([note.status, bodyOf(note.body)['path']]).toEqual([201, `${WORLD}/65_Creature/Ice wolf.md`]);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('is refused a name a kind already goes by, a built-in one included, and a name a folder cannot have', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		for (const name of ['faction', 'Time', 'Character']) {
			expect(refusal(await golden.call('createKind', P, { body: { name } })), name).toEqual([409, 'duplicate-name']);
		}
		for (const name of ['Beasts/Birds', '12_Things']) {
			const reply = await golden.call('createKind', P, { body: { name } });
			expect(refusal(reply), name).toEqual([422, 'invalid-name']);
			expect(faults(reply)).toEqual([]);
		}
		expect(refusal(await golden.call('createKind', P, { body: { name: '  ' } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a kind, changed', () => {
	it('is renamed with its folder and its id, every note of it following', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const reply = await golden.call('updateKind', { ...P, kindId: 'Faction' }, { body: { name: 'Order' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ id: 'Order', name: 'Order', path: `${WORLD}/64_Order`, count: 1, description: 'Groups with a cause.' });
		const guild = await golden.call('getEntity', { ...P, entityId: golden.members.guild.entityId });
		expect(bodyOf(guild.body)).toMatchObject({ kind: 'Order', path: `${WORLD}/64_Order/The Guild.md` });
		expect(refusal(await golden.call('getKind', { ...P, kindId: 'Faction' }))).toEqual([404, 'not-found']);
	});

	it('has its icon and what it is for changed and taken off, and the template its notes begin with set', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const looks = await golden.call('updateKind', { ...P, kindId: 'Faction' }, { body: { icon: 'shield', description: 'Sworn groups.' } });
		expect([looks.status, faults(looks)]).toEqual([200, []]);
		expect(bodyOf(looks.body)).toMatchObject({ icon: 'shield', description: 'Sworn groups.' });
		const bare = await golden.call('updateKind', { ...P, kindId: 'Faction' }, { body: { icon: null } });
		expect(bodyOf(bare.body)).toMatchObject({ icon: null, description: 'Sworn groups.' });

		// New characters begin with the voice sheet. A scene has a template and begins with none.
		const scene = await golden.call('updateKind', { ...P, kindId: 'scene' }, { body: { defaultFieldTemplate: 'Beats' } });
		expect([scene.status, bodyOf(scene.body)['defaultFieldTemplate']]).toEqual([200, 'Beats']);
		const none = await golden.call('updateKind', { ...P, kindId: 'character' }, { body: { defaultFieldTemplate: null } });
		expect([none.status, bodyOf(none.body)['defaultFieldTemplate']]).toEqual([200, null]);
		const unknown = await golden.call('updateKind', { ...P, kindId: 'scene' }, { body: { defaultFieldTemplate: 'Voice sheet' } });
		expect(refusal(unknown)).toEqual([422, 'invalid-reference']);
		expect(bodyOf(unknown.body)['pointer']).toBe('/defaultFieldTemplate');
	});

	it('keeps the kinds every project has as they are, and takes one of them read and sent back whole', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		expect(refusal(await golden.call('updateKind', { ...P, kindId: 'character' }, { body: { name: 'People' } }))).toEqual([409, 'built-in-kind']);
		expect(refusal(await golden.call('updateKind', { ...P, kindId: 'location' }, { body: { icon: 'map-pin' } }))).toEqual([409, 'built-in-kind']);
		const read = bodyOf((await golden.call('getKind', { ...P, kindId: 'location' })).body);
		const echoed = await golden.call('updateKind', { ...P, kindId: 'location' }, { body: structuredClone(read) });
		expect([echoed.status, echoed.body]).toEqual([200, read]);
		expect(refusal(await golden.call('updateKind', { ...P, kindId: 'Faction' }, { body: { name: 'time' } }))).toEqual([409, 'duplicate-name']);
		expect(refusal(await golden.call('updateKind', { ...P, kindId: 'weather' }, { body: {} }))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a kind, deleted', () => {
	it('is refused while it holds notes, with what going ahead would cost, and goes with them where the caller says so', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const held = await golden.call('deleteKind', { ...P, kindId: 'Faction' });
		expect(refusal(held)).toEqual([409, 'in-use']);
		expect(faults(held)).toEqual([]);
		expect(bodyOf(held.body)).toMatchObject({ entities: 1, usage: { listed: [], needsDecision: [], records: [] } });
		expect(vaultState(golden.host)).toEqual(before);

		const reply = await golden.call('deleteKind', { ...P, kindId: 'Faction', force: true });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(reply.body).toEqual({ id: 'Faction', path: `${WORLD}/64_Faction`, entities: 1, detached: [], dangling: [] });
		expect(items((await golden.call('listKinds', P)).body).map((kind) => kind['id'])).not.toContain('Faction');
		expect(Object.keys(vaultState(golden.host)).some((path) => path.startsWith(`${WORLD}/64_Faction/`))).toBe(false);
	});

	it('goes at once where it holds nothing, and never where every project has it', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		await golden.call('createKind', P, { body: { name: 'Creature' } });
		const reply = await golden.call('deleteKind', { ...P, kindId: 'Creature' });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ id: 'Creature', entities: 0 });
		for (const kindId of ['item', 'character']) {
			expect(refusal(await golden.call('deleteKind', { ...P, kindId, force: true })), kindId).toEqual([409, 'built-in-kind']);
		}
	});
});

describe('a word of a vocabulary, added', () => {
	const NODES = { vocabulary: 'category', kindId: 'character' };
	const paths = async (golden: Golden): Promise<unknown[]> =>
		(bodyOf((await golden.call('getVocabularyTree', { projectId: golden.project.id, ...NODES })).body)['nodes'] as Body[]).map(
			(node) => node['taxonomyPath'],
		);

	it('is added by its path under the words that are there, with what it means', async () => {
		const golden = await fresh();
		const reply = await golden.call('createDefinitionNode', { projectId: golden.project.id, ...NODES }, {
			body: { path: ' Guild / Apprentices ', description: 'Still learning.' },
		});
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			taxonomyPath: 'Guild/Apprentices',
			name: 'Apprentices',
			depth: 2,
			parent: 'Guild',
			description: 'Still learning.',
			state: 'ok',
			usage: { categorized: 0, labelled: 0 },
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/vocabularies/category/character/nodes/Guild%2FApprentices`);
		expect(golden.host.origins.length).toBeGreaterThan(0);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('brings the words above it with it where the tree does not have them', async () => {
		const golden = await fresh();
		const reply = await golden.call('createDefinitionNode', { projectId: golden.project.id, ...NODES }, { body: { path: 'Trade/Smiths/Farriers' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(await paths(golden)).toEqual(expect.arrayContaining(['Trade', 'Trade/Smiths', 'Trade/Smiths/Farriers']));
	});

	it('is refused a word the tree has, whatever its case, and a path no tree could hold', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, ...NODES };
		const before = vaultState(golden.host);
		expect(refusal(await golden.call('createDefinitionNode', params, { body: { path: 'guild/clockmakers' } }))).toEqual([409, 'duplicate-name']);
		expect(refusal(await golden.call('createDefinitionNode', params, { body: { path: 'a/b/c/d/e/f/g/h' } }))).toEqual([422, 'too-deep']);
		const odd = await golden.call('createDefinitionNode', params, { body: { path: 'Guild/Clock|makers' } });
		expect(refusal(odd)).toEqual([422, 'invalid-segment']);
		expect(faults(odd)).toEqual([]);
		expect(refusal(await golden.call('createDefinitionNode', { ...params, kindId: 'weather' }, { body: { path: 'Storm' } }))).toEqual([404, 'not-found']);
		expect(refusal(await golden.call('createDefinitionNode', { ...params, vocabulary: 'moods' }, { body: { path: 'Calm' } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a word of a vocabulary, changed and deleted', () => {
	const WORD = { vocabulary: 'category', kindId: 'character', taxonomyPath: 'Guild/Clockmakers' };

	it('is renamed where it stands, every note sorted under it following', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const reply = await golden.call('updateDefinitionNode', { ...P, ...WORD }, { body: { name: 'Horologists', description: 'Keepers of every clock.' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			taxonomyPath: 'Guild/Horologists',
			name: 'Horologists',
			parent: 'Guild',
			description: 'Keepers of every clock.',
			usage: { categorized: 1, labelled: 0 },
		});
		const ada = await golden.call('getCharacter', { ...P, characterId: golden.members.ada.characterId });
		expect(bodyOf(ada.body)['categories']).toEqual(['Major', 'Guild/Horologists']);
		expect(refusal(await golden.call('getDefinitionNode', { ...P, ...WORD }))).toEqual([404, 'not-found']);
	});

	it('takes a word read and sent back whole, and is refused a name a word beside it goes by', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const read = bodyOf((await golden.call('getDefinitionNode', { ...P, ...WORD })).body);
		const before = vaultState(golden.host);
		const echoed = await golden.call('updateDefinitionNode', { ...P, ...WORD }, { body: structuredClone(read) });
		expect([echoed.status, echoed.body]).toEqual([200, read]);
		// Major and Minor stand side by side at the top of the tree.
		const taken = await golden.call('updateDefinitionNode', { ...P, ...WORD, taxonomyPath: 'Minor' }, { body: { name: 'major' } });
		expect(refusal(taken)).toEqual([409, 'duplicate-name']);
		const odd = await golden.call('updateDefinitionNode', { ...P, ...WORD }, { body: { name: 'Clock/makers' } });
		expect(refusal(odd)).toEqual([422, 'invalid-segment']);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused its deletion while notes use it or a word under it, and goes with those words where the caller says so', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const held = await golden.call('deleteDefinitionNode', { ...P, ...WORD, taxonomyPath: 'Guild' });
		expect(refusal(held)).toEqual([409, 'in-use']);
		expect(bodyOf(held.body)).toMatchObject({ categorized: 1, labelled: 0 });
		expect(vaultState(golden.host)).toEqual(before);

		const reply = await golden.call('deleteDefinitionNode', { ...P, ...WORD, taxonomyPath: 'Guild', force: true });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(reply.body).toEqual({ vocabulary: 'category', kind: 'character', taxonomyPath: 'Guild', nodes: 2, categorized: ['Ada'], labelled: [] });
		const ada = await golden.call('getCharacter', { ...P, characterId: golden.members.ada.characterId });
		// The category is an entry in a list, and has gone from it.
		expect(bodyOf(ada.body)['categories']).toEqual(['Major']);
	});

	it('leaves a record line written under a deleted word as the author wrote it', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const family = { vocabulary: 'relationship', kindId: 'character', taxonomyPath: 'Family/Sibling' };
		expect(bodyOf((await golden.call('deleteDefinitionNode', { ...P, ...family })).body)).toMatchObject({ code: 'in-use', labelled: 1 });
		const reply = await golden.call('deleteDefinitionNode', { ...P, ...family, force: true });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ nodes: 1, categorized: [], labelled: ['Ben'] });
		const ben = bodyOf((await golden.call('getCharacter', { ...P, characterId: golden.members.ben.characterId })).body);
		expect(ben['relationships']).toMatchObject([{ label: 'Family/Sibling', text: 'the younger' }]);
	});

	it('goes at once where nothing uses it', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, vocabulary: 'world-status', kindId: 'character', taxonomyPath: 'Missing' };
		const reply = await golden.call('deleteDefinitionNode', params);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ nodes: 1, categorized: [], labelled: [] });
		expect(refusal(await golden.call('deleteDefinitionNode', params))).toEqual([404, 'not-found']);
	});
});

describe('a field template, made, changed and deleted', () => {
	it('is saved under a name for one kind, and made the one its notes begin with where that is asked', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const reply = await golden.call('createFieldTemplate', P, {
			body: { kind: 'scene', name: 'Stakes', description: 'What is at risk.', fields: [{ title: 'Stake', content: '' }, { title: 'Cost', content: 'Unknown.' }], default: true },
		});
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(reply.body).toEqual({
			kind: 'scene',
			name: 'Stakes',
			description: 'What is at risk.',
			path: 'Snowflake Projects/North Wind/40_Scene/44_Custom_Field/Stakes.md',
			default: true,
			fields: [
				{ title: 'Stake', content: '' },
				{ title: 'Cost', content: 'Unknown.' },
			],
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/field-templates/scene/Stakes`);
		expect(items((await golden.call('listFieldTemplates', { ...P, kind: 'scene' })).body).map((template) => [template['name'], template['default']])).toEqual([
			['Beats', false],
			['Stakes', true],
		]);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('is refused a name another template of the kind goes by, two fields of one title, and a kind the project does not have', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		expect(refusal(await golden.call('createFieldTemplate', P, { body: { kind: 'scene', name: 'beats' } }))).toEqual([409, 'duplicate-name']);
		const twice = await golden.call('createFieldTemplate', P, { body: { kind: 'scene', name: 'Pairs', fields: [{ title: 'A', content: '' }, { title: 'a', content: '' }] } });
		expect(refusal(twice)).toEqual([422, 'duplicate-field-title']);
		expect(refusal(await golden.call('createFieldTemplate', P, { body: { kind: 'scene', name: 'Sub/Name' } }))).toEqual([422, 'invalid-name']);
		// Dots alone are no name for a note either, at the making and at the renaming.
		expect(refusal(await golden.call('createFieldTemplate', P, { body: { kind: 'scene', name: '...' } }))).toEqual([422, 'invalid-name']);
		expect(refusal(await golden.call('updateFieldTemplate', { ...P, kindId: 'scene', templateName: 'Beats' }, { body: { name: '..' } }))).toEqual([422, 'invalid-name']);
		const kind = await golden.call('createFieldTemplate', P, { body: { kind: 'weather', name: 'Fronts' } });
		expect(refusal(kind)).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
		// The same name is free under another kind.
		expect((await golden.call('createFieldTemplate', P, { body: { kind: 'location', name: 'Beats' } })).status).toBe(201);
	});

	it('is renamed, its fields replaced, and stays the one its kind’s notes begin with', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const params = { ...P, kindId: 'character', templateName: 'Voice sheet' };
		const reply = await golden.call('updateFieldTemplate', params, { body: { name: 'Voice', fields: [{ title: 'Pitch', content: 'Low.' }] } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			name: 'Voice',
			// Not sent, and as it was.
			description: 'How a character sounds.',
			default: true,
			fields: [{ title: 'Pitch', content: 'Low.' }],
		});
		expect(bodyOf((await golden.call('getKind', { ...P, kindId: 'character' })).body)['defaultFieldTemplate']).toBe('Voice');
		expect(refusal(await golden.call('getFieldTemplate', params))).toEqual([404, 'not-found']);

		const off = await golden.call('updateFieldTemplate', { ...params, templateName: 'Voice' }, { body: { default: false } });
		expect([off.status, bodyOf(off.body)['default']]).toEqual([200, false]);
		expect(bodyOf((await golden.call('getKind', { ...P, kindId: 'character' })).body)['defaultFieldTemplate']).toBeNull();
	});

	it('takes a template read and sent back whole', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, kindId: 'character', templateName: 'Voice sheet' };
		const read = bodyOf((await golden.call('getFieldTemplate', params)).body);
		const reply = await golden.call('updateFieldTemplate', params, { body: structuredClone(read) });
		expect([reply.status, reply.body]).toEqual([200, read]);
	});

	it('goes to the trash with nothing left to say, and its kind’s notes begin with no template', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const params = { ...P, kindId: 'character', templateName: 'Voice sheet' };
		const reply = await golden.call('deleteFieldTemplate', params);
		expect([reply.status, reply.body, faults(reply)]).toEqual([204, undefined, []]);
		expect(bodyOf((await golden.call('getKind', { ...P, kindId: 'character' })).body)['defaultFieldTemplate']).toBeNull();
		expect(items((await golden.call('listFieldTemplates', { ...P, kind: 'character' })).body)).toEqual([]);
		expect(refusal(await golden.call('deleteFieldTemplate', params))).toEqual([404, 'not-found']);
	});
});
