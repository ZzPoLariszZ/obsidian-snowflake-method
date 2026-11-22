import { describe, expect, it } from 'vitest';

import { isJsonObject } from '../../api/json';
import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';
import { document, operations } from './helpers/spec';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

const DRAFT = '50_Manuscript/Draft.md';
const FIRST = '50_Manuscript/Chapter 1.md';
const SECOND = '50_Manuscript/Chapter 2.md';

interface Sent {
	params?: Body;
	body?: unknown;
	ifMatch?: string;
	/** Asked of the project in the archive and not of the working one. */
	archived?: boolean;
}

/**
 * One call of every change that gives something another name, or moves it.
 * Obsidian does each of these, rewrites the links that lead to what moved,
 * and where the author has it ask first, opens a dialog and answers only
 * when the dialog is answered. Through the API nobody answers.
 */
const RENAMES: Record<string, (golden: Golden) => Sent> = {
	updateProject: () => ({ body: { title: 'North Wind Rising', series: { name: 'Four Winds', book: 2 } } }),
	archiveProject: () => ({}),
	restoreProject: () => ({ archived: true }),
	updateCharacter: (golden) => ({ params: { characterId: golden.members.ben.characterId }, body: { name: 'Benjamin', goal: 'Home.' }, ifMatch: '*' }),
	updateScene: (golden) => ({ params: { sceneId: golden.members.morning.sceneId }, body: { title: 'The morning after', conflict: 'Nobody slept.' }, ifMatch: '*' }),
	updateEntity: (golden) => ({ params: { entityId: golden.members.guild.entityId }, body: { name: 'The Clock Guild', description: 'Keepers.' }, ifMatch: '*' }),
	updateKind: () => ({ params: { kindId: 'Faction' }, body: { name: 'Order', description: 'Sworn groups.' } }),
	updateDefinitionNode: () => ({
		params: { vocabulary: 'category', kindId: 'character', taxonomyPath: 'Guild/Clockmakers' },
		body: { name: 'Clocksmiths', description: 'Keepers of every clock.' },
	}),
	updateFieldTemplate: () => ({ params: { kindId: 'scene', templateName: 'Beats' }, body: { name: 'Turns' } }),
	renameManuscriptNote: () => ({ params: { notePath: DRAFT }, body: { title: 'Prologue' } }),
	// Between the two chapters, so the second moves up by one.
	createManuscriptNote: () => ({ body: { after: FIRST, body: 'An interlude.\n' } }),
	splitManuscriptNote: () => ({ params: { notePath: FIRST }, body: { at: { exact: 'stopped at midnight.' } }, ifMatch: '*' }),
	// The first chapter goes into the note before it, and the second takes its number.
	mergeManuscriptNoteWithNext: () => ({ params: { notePath: DRAFT } }),
	deleteManuscriptNote: () => ({ params: { notePath: FIRST, renumber: true }, ifMatch: '*' }),
};

const send = (golden: Golden, operationId: string, sent: Sent) =>
	golden.call(
		operationId,
		{ projectId: sent.archived === true ? golden.archived.id : golden.project.id, ...sent.params },
		{ body: sent.body, ...(sent.ifMatch === undefined ? {} : { ifMatch: sent.ifMatch }) },
	);

describe('a change that would rename something, while Obsidian asks before it updates links', () => {
	it('is refused before anything is written, and no editor of the author’s is closed for it', async () => {
		const golden = await createGolden({ asksAboutLinks: true });
		// Read once, so the archived project's link to its manuscript is already where the move left it.
		await golden.call('getProject', { projectId: golden.archived.id });
		golden.host.editors.length = 0;
		const before = vaultState(golden.host);
		for (const [operationId, row] of Object.entries(RENAMES)) {
			const reply = await send(golden, operationId, row(golden));
			expect([refusal(reply), faults(reply)], operationId).toEqual([[409, 'link-updates-ask'], []]);
			expect(typeof bodyOf(reply.body)['path'], operationId).toBe('string');
			expect(String(bodyOf(reply.body)['detail']), operationId).toContain('Automatically update internal links');
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.editors.filter((line) => line.startsWith('release'))).toEqual([]);
	});

	it('is made as ever where Obsidian updates links without asking', async () => {
		const landed: string[] = [];
		for (const [operationId, row] of Object.entries(RENAMES)) {
			// Each in a vault of its own: one renames what the next would have named.
			const golden = await createGolden();
			const reply = await send(golden, operationId, row(golden));
			if (!reply.failed) landed.push(operationId);
		}
		expect(landed).toEqual(Object.keys(RENAMES));
	});

	it('is said by every operation it can be the answer of', () => {
		const paths = document.root['paths'];
		const lists = (operationId: string): boolean => {
			for (const item of Object.values(isJsonObject(paths) ? paths : {})) {
				for (const operation of Object.values(isJsonObject(item) ? item : {})) {
					if (!isJsonObject(operation) || operation['operationId'] !== operationId) continue;
					const errors = operation['x-snowflake-errors'];
					return Array.isArray(errors) && errors.includes('link-updates-ask');
				}
			}
			return false;
		};
		// The project's repair may come to a note that has to be moved home, so it says so too.
		const saying = operations.filter((operation) => lists(operation.id)).map((operation) => operation.id);
		expect(saying.sort()).toEqual([...Object.keys(RENAMES), 'repairProject'].sort());
	});
});

describe('a change that renames nothing, while Obsidian asks before it updates links', () => {
	it('goes on working, and the API says of itself which way Obsidian is set', async () => {
		const golden = await createGolden({ asksAboutLinks: true });
		const root = await golden.call('getApiRoot');
		expect([bodyOf(root.body)['canRename'], faults(root)]).toEqual([false, []]);
		expect(bodyOf((await (await createGolden()).call('getApiRoot')).body)['canRename']).toBe(true);
		const pid = golden.project.id;
		const landed = async (operationId: string, params: Body, extra: { body?: unknown; ifMatch?: string } = {}): Promise<Body> => {
			const reply = await golden.call(operationId, { projectId: pid, ...params }, extra);
			expect([reply.failed, faults(reply)], `${operationId} ${JSON.stringify(reply.body)}`).toEqual([false, []]);
			return bodyOf(reply.body);
		};
		// The same operations as above, asked for what moves no note.
		await landed('updateProject', {}, { body: { series: { name: 'Four Winds', book: 2 } } });
		// Its own name sent back is not another name.
		await landed('updateCharacter', { characterId: golden.members.ben.characterId }, { body: { name: 'Ben', goal: 'Home.' }, ifMatch: '*' });
		await landed('updateScene', { sceneId: golden.members.morning.sceneId }, { body: { conflict: 'Nobody slept.' }, ifMatch: '*' });
		await landed('updateEntity', { entityId: golden.members.guild.entityId }, { body: { description: 'Keepers.' }, ifMatch: '*' });
		await landed('updateKind', { kindId: 'Faction' }, { body: { description: 'Sworn groups.' } });
		await landed('updateDefinitionNode', { vocabulary: 'category', kindId: 'character', taxonomyPath: 'Guild/Clockmakers' }, { body: { description: 'Keepers.' } });
		await landed('updateFieldTemplate', { kindId: 'scene', templateName: 'Beats' }, { body: { fields: [{ title: 'Turn', content: 'Late.' }] } });
		await landed('repairProject', {});
		// A note at the end moves no other, and neither does a change that is asked not to renumber.
		await landed('createManuscriptNote', {}, { body: { body: 'The thaw came.\n' } });
		await landed('splitManuscriptNote', { notePath: SECOND }, { body: { at: { exact: 'Nobody asked why.' }, title: 'Aftermath', renumber: false }, ifMatch: '*' });
		await landed('mergeManuscriptNoteWithNext', { notePath: DRAFT }, { body: { renumber: false } });
		await landed('deleteManuscriptNote', { notePath: SECOND, renumber: false }, { ifMatch: '*' });
		await landed('createCharacter', {}, { body: { name: 'Cy' } });
		await landed('createTask', {}, { body: { title: 'Count the bells' } });
	});
});
