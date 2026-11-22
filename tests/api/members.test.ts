import { beforeAll, describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

let golden: Golden;
beforeAll(async () => {
	golden = await createGolden();
});

const pid = (): string => golden.project.id;

describe('every member of a project, in one list', () => {
	it('names each character, scene and worldbuilding note with its id, kind by kind', async () => {
		const reply = await golden.call('listMembers', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((member) => [member['kind'], member['name']])).toEqual([
			['character', 'Ada'],
			['character', 'Ben'],
			['scene', 'The clock stops'],
			['scene', 'Morning after'],
			['time', 'Midnight'],
			['time', 'The long winter'],
			['location', 'Clocktower'],
			['Faction', 'The Guild'],
		]);
		expect(items(reply.body)[0]).toEqual({
			kind: 'character',
			id: golden.members.ada.characterId,
			name: 'Ada',
			path: golden.members.ada.path,
			aliases: ['The clockmaker'],
		});
	});

	it('finds a note by any of its names, whatever the case', async () => {
		const byAlias = await golden.call('listMembers', { projectId: pid(), q: 'CLOCKMAKER' });
		expect(items(byAlias.body).map((member) => member['name'])).toEqual(['Ada']);
		const several = await golden.call('listMembers', { projectId: pid(), q: 'clock' });
		expect(items(several.body).map((member) => member['name'])).toEqual(['Ada', 'The clock stops', 'Clocktower']);
		const none = await golden.call('listMembers', { projectId: pid(), q: 'dragon' });
		expect(bodyOf(none.body)).toMatchObject({ items: [], total: 0 });
	});

	it('narrows to one kind, and refuses a kind the project does not have', async () => {
		const times = await golden.call('listMembers', { projectId: pid(), kind: 'time' });
		expect(items(times.body).map((member) => member['name'])).toEqual(['Midnight', 'The long winter']);
		const made = await golden.call('listMembers', { projectId: pid(), kind: 'Faction' });
		expect(items(made.body).map((member) => member['name'])).toEqual(['The Guild']);
		const slip = await golden.call('listMembers', { projectId: pid(), kind: 'faction' });
		expect(slip.status).toBe(400);
		expect(bodyOf(slip.body)).toMatchObject({ code: 'invalid-request', errors: [{ pointer: 'params/kind' }] });
		expect(faults(slip)).toEqual([]);
	});
});

describe('the characters', () => {
	it('are listed in short, in the author’s order', async () => {
		const reply = await golden.call('listCharacters', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body)).toHaveLength(2);
		expect(items(reply.body)[0]).toEqual({
			kind: 'character',
			id: golden.members.ada.characterId,
			name: 'Ada',
			path: golden.members.ada.path,
			etag: golden.members.ada.revision,
			index: 0,
			readOnly: false,
			damaged: false,
			needsMigration: false,
			role: 'major',
			progressStatus: 'in-progress',
			aliases: ['The clockmaker'],
			// The role is itself a word of the category vocabulary, and stands first.
			categories: ['Major', 'Guild/Clockmakers'],
			color: 'macaron-3',
			oneSentenceStoryline: 'A clockmaker learns what her clock is counting.',
		});
		expect(items(reply.body)[1]).toMatchObject({ name: 'Ben', index: 1, role: 'supporting', progressStatus: null, color: null });
	});

	it('are told in full where that is asked for', async () => {
		const reply = await golden.call('listCharacters', { projectId: pid(), view: 'full' });
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body)[0]).toMatchObject({ characterProfile: 'Born in the tower. Left-handed.' });
		expect(bodyOf(reply.body)['limit']).toBe(100);
		const capped = await golden.call('listCharacters', { projectId: pid(), view: 'full', limit: '500' });
		expect(bodyOf(capped.body)['limit']).toBe(100);
		expect(bodyOf((await golden.call('listCharacters', { projectId: pid(), limit: '500' })).body)['limit']).toBe(500);
	});

	it('are narrowed by role, by progress and by name', async () => {
		const names = async (params: Record<string, unknown>): Promise<unknown[]> =>
			items((await golden.call('listCharacters', { projectId: pid(), ...params })).body).map((character) => character['name']);
		expect(await names({ role: 'supporting' })).toEqual(['Ben']);
		expect(await names({ role: 'minor' })).toEqual([]);
		expect(await names({ progressStatus: 'in-progress' })).toEqual(['Ada']);
		expect(await names({ q: 'ben' })).toEqual(['Ben']);
		expect((await golden.call('listCharacters', { projectId: pid(), role: 'hero' })).status).toBe(400);
	});

	it('keep their place in the author’s order when the list is narrowed', async () => {
		const reply = await golden.call('listCharacters', { projectId: pid(), role: 'supporting' });
		expect(items(reply.body)[0]).toMatchObject({ name: 'Ben', index: 1 });
	});
});

describe('one character', () => {
	it('is told in full: the three steps it is written in, how it stands, and its own fields', async () => {
		const reply = await golden.call('getCharacter', { projectId: pid(), characterId: golden.members.ada.characterId });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(reply.etag).toBe(golden.members.ada.revision);
		const ada = bodyOf(reply.body);
		expect(ada).toMatchObject({
			name: 'Ada',
			motivation: 'To be right.',
			goal: 'Restart the clock.',
			conflict: 'The town would rather not know.',
			growth: 'She learns to ask for help.',
			oneParagraphStoryline: 'Ada climbs the tower every night for a week.',
			characterProfile: 'Born in the tower. Left-handed.',
			relationships: [],
			unrecognizedWorldStatus: [],
			unrecognizedRelationships: [],
			customFields: [{ title: 'Voice', content: 'Low and even.' }],
			gallery: [],
			galleryMain: null,
		});
	});

	it('tells a line about how it stands by its parts, each note it names by that note’s id', async () => {
		const ada = bodyOf((await golden.call('getCharacter', { projectId: pid(), characterId: golden.members.ada.characterId })).body);
		expect(ada['worldStatus']).toEqual([
			{
				label: 'Mood/Calm',
				labelPath: 'Snowflake Projects/North Wind/20_Character/22_World_Status/Mood/Calm/Calm.md',
				text: 'until the bell rings',
				clauses: [
					{
						kind: 'at',
						term: { kind: 'location', id: golden.members.tower.entityId, name: 'Clocktower', path: golden.members.tower.path, resolved: true },
					},
					{
						kind: 'when',
						term: { kind: 'time', id: golden.members.midnight.entityId, name: 'Midnight', path: golden.members.midnight.path, resolved: true },
					},
				],
			},
		]);
	});

	it('tells who a relationship is with', async () => {
		const ben = bodyOf((await golden.call('getCharacter', { projectId: pid(), characterId: golden.members.ben.characterId })).body);
		expect(ben['relationships']).toEqual([
			{
				label: 'Family/Sibling',
				labelPath: 'Snowflake Projects/North Wind/20_Character/23_Relationship/Family/Sibling/Sibling.md',
				text: 'the younger',
				clauses: [
					{
						kind: 'target',
						term: { kind: 'character', id: golden.members.ada.characterId, name: 'Ada', path: golden.members.ada.path, resolved: true },
					},
				],
			},
		]);
	});

	it('says a note it names is gone, by the name that is left of it', async () => {
		const broken = await createGolden();
		await broken.host.projects.repository.trashFile(broken.members.tower.path);
		const reply = await broken.call('getCharacter', { projectId: broken.project.id, characterId: broken.members.ada.characterId });
		expect(faults(reply)).toEqual([]);
		const clauses = (bodyOf(reply.body)['worldStatus'] as Body[])[0]?.['clauses'] as Body[];
		expect(clauses[0]).toEqual({ kind: 'at', term: { kind: null, id: null, name: 'Clocktower', path: null, resolved: false } });
		expect(clauses[1]).toMatchObject({ kind: 'when', term: { resolved: true } });
	});

	it('is not found under an id the project does not have, nor under another kind’s', async () => {
		const missing = await golden.call('getCharacter', { projectId: pid(), characterId: 'character-nonsense' });
		expect([missing.status, bodyOf(missing.body)['code']]).toEqual([404, 'not-found']);
		const scene = await golden.call('getCharacter', { projectId: pid(), characterId: golden.members.stops.sceneId });
		expect(scene.status).toBe(404);
		expect(faults(scene)).toEqual([]);
	});
});

describe('the scenes', () => {
	it('are listed in short, in the order of the scene list', async () => {
		const reply = await golden.call('listScenes', { projectId: pid() });
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body)[0]).toEqual({
			kind: 'scene',
			id: golden.members.stops.sceneId,
			title: 'The clock stops',
			path: golden.members.stops.path,
			etag: golden.members.stops.revision,
			index: 0,
			readOnly: false,
			damaged: false,
			needsMigration: false,
			progressStatus: 'complete',
			aliases: [],
			categories: [],
			color: null,
			pov: {
				mode: 'character',
				character: { kind: 'character', id: golden.members.ada.characterId, name: 'Ada', path: golden.members.ada.path, resolved: true },
			},
			conflict: 'Ada wants to climb. Ben wants her home.',
		});
		expect(items(reply.body)[1]).toMatchObject({ title: 'Morning after', index: 1, pov: { mode: 'omniscient' }, conflict: '' });
	});

	it('are narrowed to the scenes a character is in', async () => {
		const withBen = await golden.call('listScenes', { projectId: pid(), character: golden.members.ben.characterId });
		expect(items(withBen.body).map((scene) => scene['title'])).toEqual(['The clock stops']);
		const withNobody = await golden.call('listScenes', { projectId: pid(), character: 'character-nonsense' });
		expect(items(withNobody.body)).toEqual([]);
		const done = await golden.call('listScenes', { projectId: pid(), progressStatus: 'complete', q: 'clock' });
		expect(items(done.body).map((scene) => scene['title'])).toEqual(['The clock stops']);
	});

	it('are each told in full: who, when, where, what happens and how it is planned', async () => {
		const reply = await golden.call('getScene', { projectId: pid(), sceneId: golden.members.stops.sceneId });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(reply.etag).toBe(golden.members.stops.revision);
		const scene = bodyOf(reply.body);
		expect((scene['characters'] as Body[]).map((character) => [character['name'], character['id']])).toEqual([
			['Ada', golden.members.ada.characterId],
			['Ben', golden.members.ben.characterId],
		]);
		// A time that is a note of the project, and one that is only words.
		expect(scene['times']).toEqual([
			{ kind: 'time', id: golden.members.midnight.entityId, name: 'Midnight', path: golden.members.midnight.path, resolved: true },
			{ text: 'one winter evening' },
		]);
		expect(scene['locations']).toEqual([
			{ kind: 'location', id: golden.members.tower.entityId, name: 'Clocktower', path: golden.members.tower.path, resolved: true },
		]);
		expect(scene).toMatchObject({ events: 'The hands stop at twelve.', planning: 'Open on the silence.', linkedManuscript: [], customFields: [] });
	});

	it('say whose eyes they are seen through even once that character is gone', async () => {
		const broken = await createGolden();
		await broken.host.projects.repository.trashFile(broken.members.ada.path);
		const reply = await broken.call('getScene', { projectId: broken.project.id, sceneId: broken.members.stops.sceneId });
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)['pov']).toEqual({
			mode: 'character',
			character: { kind: null, id: null, name: 'Ada', path: null, resolved: false },
		});
	});

	it('say which manuscript notes they are written in', async () => {
		const linked = await createGolden();
		const draft = linked.project.links.draft;
		if (draft === null) throw new Error('The project has a manuscript.');
		await linked.host.projects.updateScene(linked.project, linked.members.morning.sceneId, {
			expectedRevision: linked.members.morning.revision,
			linkedManuscript: [`[[${draft.replace(/\.md$/u, '')}#Opening|the opening]]`, '[[Nowhere at all]]'],
		});
		const reply = await linked.call('getScene', { projectId: linked.project.id, sceneId: linked.members.morning.sceneId });
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)['linkedManuscript']).toEqual([
			{ link: `[[${draft.replace(/\.md$/u, '')}#Opening|the opening]]`, path: draft },
			{ link: '[[Nowhere at all]]', path: null },
		]);
	});
});

describe('the worldbuilding notes', () => {
	it('are listed kind by kind, each with when it is where its kind says when', async () => {
		const reply = await golden.call('listEntities', { projectId: pid() });
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((entity) => [entity['kind'], entity['name'], entity['index']])).toEqual([
			['time', 'Midnight', 0],
			['time', 'The long winter', 1],
			['location', 'Clocktower', 0],
			['Faction', 'The Guild', 0],
		]);
		expect(items(reply.body)[0]).toMatchObject({
			description: 'The hour the clock stopped.',
			time: { kind: 'point', start: null, end: null },
		});
		// A period between a moment that is a note and one that is only words.
		expect(items(reply.body)[1]?.['time']).toEqual({
			kind: 'period',
			start: { kind: 'time', id: golden.members.midnight.entityId, name: 'Midnight', path: golden.members.midnight.path, resolved: true },
			end: { text: 'the first thaw' },
		});
		expect(items(reply.body)[2]).toMatchObject({ time: null, aliases: ['The tower'], progressStatus: 'complete' });
	});

	it('are narrowed to one kind, a kind the author made included', async () => {
		const names = async (params: Record<string, unknown>): Promise<unknown[]> =>
			items((await golden.call('listEntities', { projectId: pid(), ...params })).body).map((entity) => entity['name']);
		expect(await names({ kind: 'location' })).toEqual(['Clocktower']);
		expect(await names({ kind: 'Faction' })).toEqual(['The Guild']);
		expect(await names({ kind: 'item' })).toEqual([]);
		expect(await names({ q: 'tower' })).toEqual(['Clocktower']);
		expect((await golden.call('listEntities', { projectId: pid(), kind: 'Nation' })).status).toBe(400);
		// Characters and scenes are kinds, and not worldbuilding.
		const character = await golden.call('listEntities', { projectId: pid(), kind: 'character' });
		expect(character.status).toBe(400);
		expect(faults(character)).toEqual([]);
	});

	it('are each told in full under their id, whatever their kind', async () => {
		const tower = await golden.call('getEntity', { projectId: pid(), entityId: golden.members.tower.entityId });
		expect(tower.status).toBe(200);
		expect(faults(tower)).toEqual([]);
		expect(tower.etag).toBe(golden.members.tower.revision);
		expect(bodyOf(tower.body)).toMatchObject({
			kind: 'location',
			name: 'Clocktower',
			notes: 'Four faces, one of them always wrong.',
			worldStatus: [],
			customFields: [],
		});
		const guild = await golden.call('getEntity', { projectId: pid(), entityId: golden.members.guild.entityId });
		expect(bodyOf(guild.body)).toMatchObject({ kind: 'Faction', name: 'The Guild', time: null });
		expect(faults(guild)).toEqual([]);
		expect((await golden.call('getEntity', { projectId: pid(), entityId: 'entity-nonsense' })).status).toBe(404);
	});
});

describe('members, read', () => {
	it('leave the vault as it was', async () => {
		const before = vaultState(golden.host);
		await golden.call('listMembers', { projectId: pid() });
		await golden.call('listCharacters', { projectId: pid(), view: 'full' });
		await golden.call('getCharacter', { projectId: pid(), characterId: golden.members.ada.characterId });
		await golden.call('listScenes', { projectId: pid(), view: 'full' });
		await golden.call('getScene', { projectId: pid(), sceneId: golden.members.stops.sceneId });
		await golden.call('listEntities', { projectId: pid(), view: 'full' });
		await golden.call('getEntity', { projectId: pid(), entityId: golden.members.tower.entityId });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});

	it('answer for a project in another language under the same names', async () => {
		const reply = await golden.call('listMembers', { projectId: golden.chinese.id });
		expect(reply.status).toBe(200);
		expect(bodyOf(reply.body)).toMatchObject({ items: [], total: 0 });
	});
});
