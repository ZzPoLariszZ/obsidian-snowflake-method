import { describe, expect, it } from 'vitest';

import { isJsonObject } from '../../api/json';
import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';
import { document, operations } from './helpers/spec';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

const FIRST = '50_Manuscript/Chapter 1.md';

interface Sent {
	params?: Body;
	body?: unknown;
	ifMatch?: string;
	/** Asked of no project: the one that makes a project. */
	noProject?: boolean;
}

/**
 * One call of every change that files a note or a folder under a name a
 * caller sends, each with a name no file could be called by. The contract
 * holds a name to having something in it, which dots have. A file's name
 * loses the dots at its ends, and of dots alone nothing is left.
 *
 * Each call carries something else as well where it can, to show that none
 * of it lands on its own: a field to save, a word to add to a vocabulary,
 * notes to renumber.
 */
const UNNAMEABLE: Record<string, (golden: Golden) => Sent> = {
	createProject: () => ({ noProject: true, body: { title: '...', language: 'en' } }),
	updateProject: () => ({ body: { title: '..', series: { name: 'Four Winds', book: 2 } } }),
	createCharacter: () => ({ body: { name: '...', categories: ['Lighthouse keepers'], createMissingVocabulary: true } }),
	updateCharacter: (golden) => ({ params: { characterId: golden.members.ben.characterId }, body: { name: '...', goal: 'Home.' }, ifMatch: '*' }),
	createScene: () => ({ body: { title: '. .', categories: ['Night scenes'], createMissingVocabulary: true } }),
	updateScene: (golden) => ({ params: { sceneId: golden.members.morning.sceneId }, body: { title: '..', conflict: 'Nobody slept.' }, ifMatch: '*' }),
	createEntity: () => ({ body: { kind: 'location', name: '.', categories: ['Harbours'], createMissingVocabulary: true } }),
	updateEntity: (golden) => ({ params: { entityId: golden.members.guild.entityId }, body: { name: '...', description: 'Keepers.' }, ifMatch: '*' }),
	// Between the two chapters, so the second would have moved up by one.
	createManuscriptNote: () => ({ body: { after: FIRST, title: '...', body: 'An interlude.\n' } }),
	renameManuscriptNote: () => ({ params: { notePath: FIRST }, body: { title: '..' } }),
	splitManuscriptNote: () => ({ params: { notePath: FIRST }, body: { at: { exact: 'stopped at midnight.' }, title: '...' }, ifMatch: '*' }),
};

const send = (golden: Golden, operationId: string, sent: Sent) =>
	golden.call(
		operationId,
		{ ...(sent.noProject === true ? {} : { projectId: golden.project.id }), ...sent.params },
		{ body: sent.body, ...(sent.ifMatch === undefined ? {} : { ifMatch: sent.ifMatch }) },
	);

describe('a name no file could be called by', () => {
	it('is refused as the name it is, before anything is written, and no editor of the author’s is closed for it', async () => {
		const golden = await createGolden();
		golden.host.editors.length = 0;
		const before = vaultState(golden.host);
		for (const [operationId, row] of Object.entries(UNNAMEABLE)) {
			const sent = row(golden);
			const reply = await send(golden, operationId, sent);
			expect([refusal(reply), faults(reply)], operationId).toEqual([[422, 'invalid-name'], []]);
			// The name is said back, so a caller that sent several things knows which it was.
			const asked = bodyOf(sent.body);
			expect(String(bodyOf(reply.body)['name']).trim(), operationId).toBe(String(asked['name'] ?? asked['title']));
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.editors.filter((line) => line.startsWith('release'))).toEqual([]);
	});

	it('is said by every operation it can be the answer of', () => {
		const paths = document.root['paths'];
		const lists = (operationId: string): boolean => {
			for (const item of Object.values(isJsonObject(paths) ? paths : {})) {
				for (const operation of Object.values(isJsonObject(item) ? item : {})) {
					if (!isJsonObject(operation) || operation['operationId'] !== operationId) continue;
					const errors = operation['x-snowflake-errors'];
					return Array.isArray(errors) && errors.includes('invalid-name');
				}
			}
			return false;
		};
		// A kind and a field template are named as a folder and a note are, and say so in words of their own.
		const saying = operations.filter((operation) => operation.available && lists(operation.id)).map((operation) => operation.id);
		expect(saying.sort()).toEqual([...Object.keys(UNNAMEABLE), 'createKind', 'updateKind', 'createFieldTemplate', 'updateFieldTemplate'].sort());
	});

	it('is still a name where something is left once the dots at its ends are taken off', async () => {
		const golden = await createGolden();
		const made = await golden.call('createCharacter', { projectId: golden.project.id }, { body: { name: '...Ada Lovelace...' } });
		expect([made.status, faults(made)]).toEqual([201, []]);
		// The note keeps the name as it was sent, and is filed under what a file can be called.
		expect(bodyOf(made.body)).toMatchObject({ name: '...Ada Lovelace...' });
		expect(String(bodyOf(made.body)['path']).endsWith('/Ada Lovelace.md')).toBe(true);
	});
});
