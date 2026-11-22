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

/** A member as another answer names it. */
const refOf = (kind: string, id: string, name: string, path: string): Body => ({ kind, id, name, path, resolved: true });

describe('a character, made', () => {
	it('needs only a name, goes to the end of the author’s list, and is answered in full with a version that stands', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const reply = await golden.call('createCharacter', P, { body: { name: '  Cy ' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const made = bodyOf(reply.body);
		expect(made).toMatchObject({
			kind: 'character',
			name: 'Cy',
			path: 'Snowflake Projects/North Wind/20_Character/Cy.md',
			index: 2,
			role: null,
			progressStatus: null,
			aliases: [],
			categories: [],
			color: null,
			worldStatus: [],
			relationships: [],
			customFields: [],
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/characters/${String(made['id'])}`);
		expect(reply.etag).toBe(made['etag']);
		// The version answered is the one the note keeps: nothing of the plugin's own moves it a moment later.
		const read = await golden.call('getCharacter', { ...P, characterId: made['id'] });
		expect(bodyOf(read.body)).toEqual(made);
		expect(golden.host.origins.length).toBeGreaterThan(0);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('takes everything a character can be given, the notes it names by their ids and the vocabulary by its words', async () => {
		const golden = await fresh();
		const { ada, tower, midnight } = golden.members;
		const reply = await golden.call(
			'createCharacter',
			{ projectId: golden.project.id },
			{
				body: {
					name: 'Cy',
					role: 'minor',
					aliases: ['The apprentice', '  '],
					categories: ['guild/clockmakers'],
					progressStatus: 'in-progress',
					color: 'macaron-5',
					oneSentenceStoryline: 'An apprentice learns to listen.',
					motivation: 'To be useful.',
					characterProfile: 'Fifteen. Quick hands.',
					worldStatus: [
						{
							label: 'Mood/Calm',
							text: 'at the bench',
							clauses: [
								{ kind: 'at', term: { id: tower.entityId } },
								{ kind: 'when', term: { id: midnight.entityId } },
							],
						},
					],
					relationships: [{ label: 'Family/Sibling', clauses: [{ kind: 'target', term: { id: ada.characterId } }] }],
					customFields: [
						{ title: 'Voice', content: 'Quick and quiet.' },
						{ title: 'Tell', content: '' },
					],
				},
			},
		);
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			name: 'Cy',
			role: 'minor',
			aliases: ['The apprentice'],
			// The role is a word of the category vocabulary too, and the word asked for is spelled as the vocabulary spells it.
			categories: ['Minor', 'Guild/Clockmakers'],
			progressStatus: 'in-progress',
			color: 'macaron-5',
			oneSentenceStoryline: 'An apprentice learns to listen.',
			motivation: 'To be useful.',
			goal: '',
			characterProfile: 'Fifteen. Quick hands.',
			worldStatus: [
				{
					label: 'Mood/Calm',
					text: 'at the bench',
					clauses: [
						{ kind: 'at', term: refOf('location', tower.entityId, 'Clocktower', tower.path) },
						{ kind: 'when', term: refOf('time', midnight.entityId, 'Midnight', midnight.path) },
					],
				},
			],
			relationships: [
				{ label: 'Family/Sibling', text: '', clauses: [{ kind: 'target', term: refOf('character', ada.characterId, 'Ada', ada.path) }] },
			],
			customFields: [
				{ title: 'Voice', content: 'Quick and quiet.' },
				{ title: 'Tell', content: '' },
			],
		});
	});

	it('is refused a name another character goes by, and nothing is made', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const reply = await golden.call('createCharacter', { projectId: golden.project.id }, { body: { name: 'ADA' } });
		expect(refusal(reply)).toEqual([409, 'duplicate-name']);
		expect(faults(reply)).toEqual([]);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused a word its vocabulary does not have, unless it is asked to add it', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const slip = await golden.call('createCharacter', P, { body: { name: 'Cy', categories: ['Guild/Clockmakrs'] } });
		expect(refusal(slip)).toEqual([422, 'unknown-vocabulary-node']);
		expect(bodyOf(slip.body)).toMatchObject({ pointer: '/categories/0', vocabulary: 'category', path: 'Guild/Clockmakrs' });
		const label = await golden.call('createCharacter', P, { body: { name: 'Cy', worldStatus: [{ label: 'Mood/Restless' }] } });
		expect(refusal(label)).toEqual([422, 'unknown-vocabulary-node']);
		expect(bodyOf(label.body)).toMatchObject({ pointer: '/worldStatus/0/label', vocabulary: 'world-status' });
		expect(vaultState(golden.host)).toEqual(before);

		const added = await golden.call('createCharacter', P, {
			body: { name: 'Cy', categories: ['Guild/Apprentices'], worldStatus: [{ label: 'Mood/Restless' }], createMissingVocabulary: true },
		});
		expect([added.status, faults(added)]).toEqual([201, []]);
		expect(bodyOf(added.body)['categories']).toEqual(['Guild/Apprentices']);
		const tree = await golden.call('getVocabularyTree', { ...P, vocabulary: 'category', kindId: 'character' });
		expect((bodyOf(tree.body)['nodes'] as Body[]).map((node) => node['taxonomyPath'])).toContain('Guild/Apprentices');
	});

	it('is refused a word no vocabulary could hold, even when asked to add it', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const deep = await golden.call('createCharacter', P, {
			body: { name: 'Cy', categories: ['a/b/c/d/e/f/g/h'], createMissingVocabulary: true },
		});
		expect(refusal(deep)).toEqual([422, 'too-deep']);
		const odd = await golden.call('createCharacter', P, { body: { name: 'Cy', categories: ['Guild/Clock|makers'], createMissingVocabulary: true } });
		expect(refusal(odd)).toEqual([422, 'invalid-segment']);
		expect(faults(odd)).toEqual([]);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused an id that names no note, two fields of one title, and a body that is not its shape', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const nobody = await golden.call('createCharacter', P, {
			body: { name: 'Cy', relationships: [{ label: 'Family/Sibling', clauses: [{ kind: 'target', term: { id: 'character-nobody' } }] }] },
		});
		expect(refusal(nobody)).toEqual([422, 'invalid-reference']);
		expect(bodyOf(nobody.body)).toMatchObject({ pointer: '/relationships/0/clauses/0/term', id: 'character-nobody' });
		// A clause is a word in front of a note: a place after `at`, a time after `when`, and never plain words.
		const place = await golden.call('createCharacter', P, {
			body: { name: 'Cy', worldStatus: [{ label: 'Mood/Calm', clauses: [{ kind: 'at', term: { id: golden.members.ada.characterId } }] }] },
		});
		expect(refusal(place)).toEqual([422, 'invalid-reference']);
		expect(bodyOf(place.body)).toMatchObject({ pointer: '/worldStatus/0/clauses/0/term' });
		const words = await golden.call('createCharacter', P, {
			body: { name: 'Cy', worldStatus: [{ label: 'Mood/Calm', clauses: [{ kind: 'when', term: { text: 'most mornings' } }] }] },
		});
		expect(refusal(words)).toEqual([400, 'invalid-request']);
		const twice = await golden.call('createCharacter', P, {
			body: { name: 'Cy', customFields: [{ title: 'Voice', content: 'a' }, { title: 'voice', content: 'b' }] },
		});
		expect(refusal(twice)).toEqual([422, 'duplicate-field-title']);
		for (const body of [{}, { name: ' ' }, { name: 'Cy', role: 'villain' }, { name: 'Cy', rank: 3 }, { name: 'Cy', aliases: 'The apprentice' }]) {
			expect(refusal(await golden.call('createCharacter', P, { body })), JSON.stringify(body)).toEqual([400, 'invalid-request']);
		}
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a character, changed', () => {
	it('has what is sent changed and the rest left as it was, against the version it was read at', async () => {
		const golden = await fresh();
		const { ada } = golden.members;
		const params = { projectId: golden.project.id, characterId: ada.characterId };
		const before = bodyOf((await golden.call('getCharacter', params)).body);
		const reply = await golden.call('updateCharacter', params, {
			body: { motivation: 'To be believed.', role: 'supporting', aliases: ['The clockmaker', 'Miss A'] },
			ifMatch: String(before['etag']),
		});
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const after = bodyOf(reply.body);
		expect(after).toMatchObject({
			id: ada.characterId,
			motivation: 'To be believed.',
			role: 'supporting',
			aliases: ['The clockmaker', 'Miss A'],
			categories: ['Supporting', 'Guild/Clockmakers'],
			// Not sent, and as it was.
			goal: before['goal'],
			worldStatus: before['worldStatus'],
			customFields: before['customFields'],
		});
		expect(after['etag']).not.toBe(before['etag']);
		expect(reply.etag).toBe(after['etag']);
		expect(bodyOf((await golden.call('getCharacter', params)).body)).toEqual(after);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('is renamed with its note, its id staying and every link to it following', async () => {
		const golden = await fresh();
		const { ada, stops } = golden.members;
		const params = { projectId: golden.project.id, characterId: ada.characterId };
		const reply = await golden.call('updateCharacter', params, { body: { name: 'Adeline' }, ifMatch: ada.revision });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ id: ada.characterId, name: 'Adeline', path: 'Snowflake Projects/North Wind/20_Character/Adeline.md' });
		const scene = bodyOf((await golden.call('getScene', { projectId: golden.project.id, sceneId: stops.sceneId })).body);
		expect(bodyOf(bodyOf(scene['pov'])['character'])).toMatchObject({ id: ada.characterId, name: 'Adeline', resolved: true });
	});

	it('is refused without a version and against one the note has left behind, and takes any where the caller says so', async () => {
		const golden = await fresh();
		const { ben } = golden.members;
		const params = { projectId: golden.project.id, characterId: ben.characterId };
		const before = vaultState(golden.host);
		expect(refusal(await golden.call('updateCharacter', params, { body: { goal: 'Home.' } }))).toEqual([428, 'precondition-required']);
		const stale = await golden.call('updateCharacter', params, { body: { goal: 'Home.' }, ifMatch: 'fp1-0000000000000000' });
		expect(refusal(stale)).toEqual([412, 'concurrent-change']);
		expect(bodyOf(stale.body)['currentEtag']).toBe(ben.revision);
		expect(vaultState(golden.host)).toEqual(before);
		const any = await golden.call('updateCharacter', params, { body: { goal: 'Home.' }, ifMatch: '*' });
		expect([any.status, bodyOf(any.body)['goal']]).toEqual([200, 'Home.']);
	});

	it('takes a character read and sent back whole, and comes out saying what it said', async () => {
		const golden = await fresh();
		const { ada } = golden.members;
		const params = { projectId: golden.project.id, characterId: ada.characterId };
		const read = bodyOf((await golden.call('getCharacter', params)).body);
		const reply = await golden.call('updateCharacter', params, { body: structuredClone(read), ifMatch: String(read['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const { etag: _was, ...said } = read;
		const { etag: _is, ...says } = bodyOf(reply.body);
		expect(says).toEqual(said);
	});

	it('replaces a list that is sent, and empties one sent empty', async () => {
		const golden = await fresh();
		const { ada } = golden.members;
		const params = { projectId: golden.project.id, characterId: ada.characterId };
		const reply = await golden.call('updateCharacter', params, {
			body: { aliases: [], worldStatus: [], customFields: [{ title: 'Voice', content: 'Lower now.' }], progressStatus: null, color: null },
			ifMatch: ada.revision,
		});
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			aliases: [],
			worldStatus: [],
			customFields: [{ title: 'Voice', content: 'Lower now.' }],
			progressStatus: null,
			color: null,
		});
	});

	it('is not found under an id the project does not have', async () => {
		const golden = await fresh();
		const reply = await golden.call('updateCharacter', { projectId: golden.project.id, characterId: 'character-nobody' }, { body: {}, ifMatch: '*' });
		expect(refusal(reply)).toEqual([404, 'not-found']);
	});
});

describe('what names a note', () => {
	it('is told by what deleting the note would cost each note that names it', async () => {
		const golden = await fresh();
		const { ada, ben, stops } = golden.members;
		const reply = await golden.call('getMemberUsage', { projectId: golden.project.id, memberId: ada.characterId });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const scene = refOf('scene', stops.sceneId, 'The clock stops', stops.path);
		expect(reply.body).toEqual({
			member: refOf('character', ada.characterId, 'Ada', ada.path),
			// The scene lists her in its cast, and is seen through her eyes.
			listed: [scene],
			needsDecision: [scene],
			// Ben's note says he is her sibling.
			records: [refOf('character', ben.characterId, 'Ben', ben.path)],
		});
		const nobody = await golden.call('getMemberUsage', { projectId: golden.project.id, memberId: 'character-nobody' });
		expect(refusal(nobody)).toEqual([404, 'not-found']);
	});
});

describe('a character, deleted', () => {
	it('is refused while other notes name it, with which they are, and nothing is touched', async () => {
		const golden = await fresh();
		const { ada, ben, stops } = golden.members;
		const before = vaultState(golden.host);
		const reply = await golden.call('deleteCharacter', { projectId: golden.project.id, characterId: ada.characterId }, { ifMatch: ada.revision });
		expect(refusal(reply)).toEqual([409, 'in-use']);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)['usage']).toEqual({
			listed: [refOf('scene', stops.sceneId, 'The clock stops', stops.path)],
			needsDecision: [refOf('scene', stops.sceneId, 'The clock stops', stops.path)],
			records: [refOf('character', ben.characterId, 'Ben', ben.path)],
		});
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('goes to the trash where the caller says to go ahead, the lists losing it and the rest left naming it', async () => {
		const golden = await fresh();
		const { ada, ben, stops } = golden.members;
		const P = { projectId: golden.project.id };
		const reply = await golden.call('deleteCharacter', { ...P, characterId: ada.characterId, force: true }, { ifMatch: ada.revision });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const scene = refOf('scene', stops.sceneId, 'The clock stops', stops.path);
		expect(reply.body).toEqual({
			kind: 'character',
			id: ada.characterId,
			name: 'Ada',
			path: ada.path,
			detached: [scene],
			dangling: [scene, refOf('character', ben.characterId, 'Ben', ben.path)],
			picturesKept: [],
		});
		expect(golden.host.environment.fakeFileManager.trashCalls).toEqual([ada.path]);
		expect(items((await golden.call('listCharacters', P)).body).map((character) => character['name'])).toEqual(['Ben']);
		const after = bodyOf((await golden.call('getScene', { ...P, sceneId: stops.sceneId })).body);
		// The cast is a list and has lost her. Whose eyes the scene is seen through is left pointing at nothing.
		expect((after['characters'] as Body[]).map((entry) => entry['name'])).toEqual(['Ben']);
		expect(bodyOf(bodyOf(after['pov'])['character'])).toMatchObject({ resolved: false, id: null });
	});

	it('goes at once where no note names it', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const made = bodyOf((await golden.call('createCharacter', P, { body: { name: 'Cy' } })).body);
		const reply = await golden.call('deleteCharacter', { ...P, characterId: made['id'] }, { ifMatch: String(made['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ name: 'Cy', detached: [], dangling: [] });
	});

	it('is refused without a version, and against one the note has left behind', async () => {
		const golden = await fresh();
		const { ben } = golden.members;
		const params = { projectId: golden.project.id, characterId: ben.characterId, force: true };
		const before = vaultState(golden.host);
		expect(refusal(await golden.call('deleteCharacter', params))).toEqual([428, 'precondition-required']);
		const stale = await golden.call('deleteCharacter', params, { ifMatch: 'fp1-0000000000000000' });
		expect(refusal(stale)).toEqual([412, 'concurrent-change']);
		expect(bodyOf(stale.body)['currentEtag']).toBe(ben.revision);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a character, moved', () => {
	const names = async (golden: Golden): Promise<unknown[]> =>
		items((await golden.call('listCharacters', { projectId: golden.project.id })).body).map((character) => character['name']);

	it('is put at an index, before another or after another, and keeps its place in its note', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const { ada, ben } = golden.members;
		const cy = bodyOf((await golden.call('createCharacter', P, { body: { name: 'Cy' } })).body);
		expect(await names(golden)).toEqual(['Ada', 'Ben', 'Cy']);

		const first = await golden.call('moveCharacter', { ...P, characterId: cy['id'] }, { body: { index: 0 } });
		expect([first.status, faults(first)]).toEqual([200, []]);
		expect(bodyOf(first.body)).toMatchObject({ name: 'Cy', index: 0 });
		expect(bodyOf(first.body)['etag']).not.toBe(cy['etag']);
		expect(await names(golden)).toEqual(['Cy', 'Ada', 'Ben']);

		await golden.call('moveCharacter', { ...P, characterId: cy['id'] }, { body: { after: ada.characterId } });
		expect(await names(golden)).toEqual(['Ada', 'Cy', 'Ben']);
		await golden.call('moveCharacter', { ...P, characterId: ben.characterId }, { body: { before: ada.characterId } });
		expect(await names(golden)).toEqual(['Ben', 'Ada', 'Cy']);
		// Past the end is the end.
		const last = await golden.call('moveCharacter', { ...P, characterId: ben.characterId }, { body: { index: 99 } });
		expect(bodyOf(last.body)['index']).toBe(2);
		expect(await names(golden)).toEqual(['Ada', 'Cy', 'Ben']);
	});

	it('is refused a place beside a note that is not in its list, or beside itself', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const { ada, stops } = golden.members;
		const before = vaultState(golden.host);
		const scene = await golden.call('moveCharacter', { ...P, characterId: ada.characterId }, { body: { before: stops.sceneId } });
		expect(refusal(scene)).toEqual([422, 'invalid-reference']);
		const self = await golden.call('moveCharacter', { ...P, characterId: ada.characterId }, { body: { after: ada.characterId } });
		expect(refusal(self)).toEqual([422, 'invalid-reference']);
		const both = await golden.call('moveCharacter', { ...P, characterId: ada.characterId }, { body: { index: 1, before: 'x' } });
		expect(refusal(both)).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a scene, made and changed', () => {
	it('names its point of view, its cast, its times and its places by their ids, and its manuscript notes by their addresses', async () => {
		const golden = await fresh();
		const { ada, ben, midnight, tower } = golden.members;
		const reply = await golden.call(
			'createScene',
			{ projectId: golden.project.id },
			{
				body: {
					title: 'The thaw',
					pov: { mode: 'character', character: { id: ben.characterId } },
					characters: [{ id: ben.characterId }, { id: ada.characterId }],
					times: [{ id: midnight.entityId }, { text: 'three days on' }],
					locations: [{ id: tower.entityId }],
					conflict: 'Ben wants the clock left alone.',
					events: 'The ice goes out.',
					planning: 'Close on the bell.',
					linkedManuscript: [{ relativePath: '50_Manuscript/Chapter 2.md' }],
					progressStatus: 'not-started',
				},
			},
		);
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const made = bodyOf(reply.body);
		expect(made).toMatchObject({
			kind: 'scene',
			title: 'The thaw',
			index: 2,
			pov: { mode: 'character', character: refOf('character', ben.characterId, 'Ben', ben.path) },
			characters: [refOf('character', ben.characterId, 'Ben', ben.path), refOf('character', ada.characterId, 'Ada', ada.path)],
			times: [refOf('time', midnight.entityId, 'Midnight', midnight.path), { text: 'three days on' }],
			locations: [refOf('location', tower.entityId, 'Clocktower', tower.path)],
			conflict: 'Ben wants the clock left alone.',
			events: 'The ice goes out.',
			planning: 'Close on the bell.',
			linkedManuscript: [{ path: golden.manuscript.second }],
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/scenes/${String(made['id'])}`);
		const read = await golden.call('getScene', { projectId: golden.project.id, sceneId: made['id'] });
		expect(bodyOf(read.body)).toEqual(made);
	});

	it('is refused an id of the wrong kind for the place it is put in, and a manuscript note that is not there', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const { ada, tower } = golden.members;
		const before = vaultState(golden.host);
		const cast = await golden.call('createScene', P, { body: { title: 'New', characters: [{ id: tower.entityId }] } });
		expect(refusal(cast)).toEqual([422, 'invalid-reference']);
		expect(bodyOf(cast.body)).toMatchObject({ pointer: '/characters/0' });
		const when = await golden.call('createScene', P, { body: { title: 'New', times: [{ id: tower.entityId }] } });
		expect(refusal(when)).toEqual([422, 'invalid-reference']);
		const eyes = await golden.call('createScene', P, { body: { title: 'New', pov: { mode: 'character', character: { id: tower.entityId } } } });
		expect(bodyOf(eyes.body)).toMatchObject({ code: 'invalid-reference', pointer: '/pov/character/0' });
		const note = await golden.call('createScene', P, {
			body: { title: 'New', linkedManuscript: [{ relativePath: ada.path.slice('Snowflake Projects/North Wind/'.length) }] },
		});
		expect(bodyOf(note.body)).toMatchObject({ code: 'invalid-reference', pointer: '/linkedManuscript/0/relativePath' });
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('has its point of view changed, taken off, and its lists replaced', async () => {
		const golden = await fresh();
		const { stops, ben } = golden.members;
		const params = { projectId: golden.project.id, sceneId: stops.sceneId };
		const all = await golden.call('updateScene', params, { body: { pov: { mode: 'omniscient' }, characters: [{ id: ben.characterId }], times: [] }, ifMatch: stops.revision });
		expect([all.status, faults(all)]).toEqual([200, []]);
		expect(bodyOf(all.body)).toMatchObject({ pov: { mode: 'omniscient' }, times: [], title: 'The clock stops' });
		expect((bodyOf(all.body)['characters'] as Body[]).map((entry) => entry['name'])).toEqual(['Ben']);
		const none = await golden.call('updateScene', params, { body: { pov: null }, ifMatch: String(bodyOf(all.body)['etag']) });
		expect([none.status, bodyOf(none.body)['pov']]).toEqual([200, null]);
	});

	it('takes a scene read and sent back whole, and comes out saying what it said', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, sceneId: golden.members.stops.sceneId };
		const read = bodyOf((await golden.call('getScene', params)).body);
		const reply = await golden.call('updateScene', params, { body: structuredClone(read), ifMatch: String(read['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const { etag: _was, ...said } = read;
		const { etag: _is, ...says } = bodyOf(reply.body);
		expect(says).toEqual(said);
	});

	it('is moved among the scenes and deleted from among them', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const { stops, morning } = golden.members;
		const moved = await golden.call('moveScene', { ...P, sceneId: morning.sceneId }, { body: { before: stops.sceneId } });
		expect([moved.status, faults(moved), bodyOf(moved.body)['index']]).toEqual([200, [], 0]);
		const reply = await golden.call('deleteScene', { ...P, sceneId: morning.sceneId }, { ifMatch: String(bodyOf(moved.body)['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ kind: 'scene', name: 'Morning after', detached: [], dangling: [] });
		expect(items((await golden.call('listScenes', P)).body).map((scene) => scene['title'])).toEqual(['The clock stops']);
	});
});

describe('a worldbuilding note, made and changed', () => {
	it('is made in the kind named, a period with both its ends', async () => {
		const golden = await fresh();
		const { midnight } = golden.members;
		const reply = await golden.call(
			'createEntity',
			{ projectId: golden.project.id },
			{ body: { kind: 'time', name: 'The thaw', description: 'When the river opens.', time: { kind: 'period', start: { id: midnight.entityId }, end: { text: 'the first green' } } } },
		);
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const made = bodyOf(reply.body);
		expect(made).toMatchObject({
			kind: 'time',
			name: 'The thaw',
			description: 'When the river opens.',
			time: { kind: 'period', start: refOf('time', midnight.entityId, 'Midnight', midnight.path), end: { text: 'the first green' } },
			notes: '',
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/entities/${String(made['id'])}`);
		// And in a kind the author made.
		const faction = await golden.call('createEntity', { projectId: golden.project.id }, { body: { kind: 'Faction', name: 'The Watch', notes: 'Six of them.' } });
		expect([faction.status, faults(faction)]).toEqual([201, []]);
		expect(bodyOf(faction.body)).toMatchObject({ kind: 'Faction', name: 'The Watch', notes: 'Six of them.', time: null, index: 1 });
	});

	it('is refused a period with one end, a kind the project does not have, and a kind that is not worldbuilding', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const half = await golden.call('createEntity', P, { body: { kind: 'time', name: 'Half', time: { kind: 'period', start: { text: 'spring' } } } });
		expect(refusal(half)).toEqual([422, 'invalid-time-span']);
		expect(faults(half)).toEqual([]);
		for (const kind of ['weather', 'character', 'scene']) {
			const reply = await golden.call('createEntity', P, { body: { kind, name: 'Anything' } });
			expect(refusal(reply), kind).toEqual([400, 'invalid-request']);
			expect(bodyOf(reply.body)['errors'], kind).toMatchObject([{ pointer: '/kind' }]);
		}
		expect(refusal(await golden.call('createEntity', P, { body: { name: 'No kind' } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('has what is sent changed, one end of a period held against the other as it stands', async () => {
		const golden = await fresh();
		const { winter, tower } = golden.members;
		const P = { projectId: golden.project.id };
		// The long winter runs from Midnight to the first thaw.
		const ended = await golden.call('updateEntity', { ...P, entityId: winter.entityId }, { body: { time: { end: { text: 'the last frost' } } }, ifMatch: winter.revision });
		expect([ended.status, faults(ended)]).toEqual([200, []]);
		expect(bodyOf(bodyOf(ended.body)['time'])).toMatchObject({ kind: 'period', end: { text: 'the last frost' } });
		expect(bodyOf(bodyOf(bodyOf(ended.body)['time'])['start'])).toMatchObject({ name: 'Midnight', resolved: true });
		const open = await golden.call('updateEntity', { ...P, entityId: winter.entityId }, { body: { time: { end: null } }, ifMatch: '*' });
		expect(refusal(open)).toEqual([422, 'invalid-time-span']);

		const place = await golden.call('updateEntity', { ...P, entityId: tower.entityId }, {
			body: { description: 'Taller than the church.', aliases: ['The tower', 'Old Tom'], time: { kind: 'point' } },
			ifMatch: tower.revision,
		});
		expect([place.status, faults(place)]).toEqual([200, []]);
		// A place has no time to keep, and what was sent of one is passed over.
		expect(bodyOf(place.body)).toMatchObject({ description: 'Taller than the church.', aliases: ['The tower', 'Old Tom'], time: null, notes: 'Four faces, one of them always wrong.' });
	});

	it('takes a note read and sent back whole, and comes out saying what it said', async () => {
		const golden = await fresh();
		for (const entity of [golden.members.winter, golden.members.tower, golden.members.guild]) {
			const params = { projectId: golden.project.id, entityId: entity.entityId };
			const read = bodyOf((await golden.call('getEntity', params)).body);
			const reply = await golden.call('updateEntity', params, { body: structuredClone(read), ifMatch: String(read['etag']) });
			expect([reply.status, faults(reply)], entity.name).toEqual([200, []]);
			const { etag: _was, ...said } = read;
			const { etag: _is, ...says } = bodyOf(reply.body);
			expect(says, entity.name).toEqual(said);
		}
	});

	it('is moved within its kind, and deleted only with a go-ahead while notes name it', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const { midnight, winter, stops, ada } = golden.members;
		const moved = await golden.call('moveEntity', { ...P, entityId: winter.entityId }, { body: { before: midnight.entityId } });
		expect([moved.status, faults(moved), bodyOf(moved.body)['index']]).toEqual([200, [], 0]);
		const other = await golden.call('moveEntity', { ...P, entityId: winter.entityId }, { body: { after: golden.members.tower.entityId } });
		expect(refusal(other)).toEqual([422, 'invalid-reference']);

		const current = bodyOf((await golden.call('getEntity', { ...P, entityId: midnight.entityId })).body);
		const held = await golden.call('deleteEntity', { ...P, entityId: midnight.entityId }, { ifMatch: String(current['etag']) });
		expect(refusal(held)).toEqual([409, 'in-use']);
		const usage = bodyOf(bodyOf(held.body)['usage']);
		// The scene lists it among its times, the winter begins at it, and Ada's world status says when.
		expect((usage['listed'] as Body[]).map((entry) => entry['id'])).toEqual([stops.sceneId]);
		expect((usage['needsDecision'] as Body[]).map((entry) => entry['id'])).toEqual([winter.entityId]);
		expect((usage['records'] as Body[]).map((entry) => entry['id'])).toEqual([ada.characterId]);
		const reply = await golden.call('deleteEntity', { ...P, entityId: midnight.entityId, force: true }, { ifMatch: String(current['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ kind: 'time', name: 'Midnight' });
		expect((bodyOf(reply.body)['dangling'] as Body[]).map((entry) => entry['id'])).toEqual([winter.entityId, ada.characterId]);
	});
});
