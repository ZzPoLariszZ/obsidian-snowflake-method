import { describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';
import { operations } from './helpers/spec';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;

/** One call as a test sends it. */
interface Sent {
	params?: Body;
	body?: unknown;
	ifMatch?: string;
}

/**
 * One call of every operation that changes something, as it would be made
 * of the project whose id is handed in. What each is refused for below is
 * decided before anything it names inside the project is looked for, so
 * the ids of the first project's notes do for any project.
 *
 * `of` says what the operation is about: a project that must be one of the
 * working ones, a project that must stand in the archive, or no project.
 */
const WRITES: Record<string, { of: 'project' | 'archived' | 'none'; send: (projectId: string, golden: Golden) => Sent }> = {
	createProject: { of: 'none', send: () => ({ body: { title: 'Another book', language: 'en' } }) },
	updateProject: { of: 'project', send: (projectId) => ({ params: { projectId }, body: { title: 'Another name' } }) },
	archiveProject: { of: 'project', send: (projectId) => ({ params: { projectId } }) },
	restoreProject: { of: 'archived', send: (projectId) => ({ params: { projectId } }) },
	repairProject: { of: 'project', send: (projectId) => ({ params: { projectId } }) },
	setStepStatus: { of: 'project', send: (projectId) => ({ params: { projectId, step: 2 }, body: { status: 'complete' } }) },
	updateStepText: {
		of: 'project',
		send: (projectId) => ({ params: { projectId, step: 1 }, body: { sections: { genre: 'Thriller' } }, ifMatch: '*' }),
	},
	createCharacter: { of: 'project', send: (projectId) => ({ params: { projectId }, body: { name: 'Cy', motivation: 'To be useful.' } }) },
	updateCharacter: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, characterId: golden.members.ben.characterId }, body: { goal: 'Home.' }, ifMatch: '*' }),
	},
	deleteCharacter: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, characterId: golden.members.ben.characterId, force: true }, ifMatch: '*' }),
	},
	moveCharacter: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, characterId: golden.members.ada.characterId }, body: { index: 1 } }),
	},
	createScene: { of: 'project', send: (projectId) => ({ params: { projectId }, body: { title: 'The thaw', events: 'The ice goes out.' } }) },
	updateScene: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, sceneId: golden.members.morning.sceneId }, body: { conflict: 'Nobody slept.' }, ifMatch: '*' }),
	},
	deleteScene: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, sceneId: golden.members.morning.sceneId, force: true }, ifMatch: '*' }),
	},
	moveScene: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, sceneId: golden.members.stops.sceneId }, body: { index: 1 } }),
	},
	createEntity: { of: 'project', send: (projectId) => ({ params: { projectId }, body: { kind: 'location', name: 'Harbour', notes: 'Iced in.' } }) },
	updateEntity: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, entityId: golden.members.guild.entityId }, body: { description: 'Keepers of the clock.' }, ifMatch: '*' }),
	},
	deleteEntity: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, entityId: golden.members.guild.entityId, force: true }, ifMatch: '*' }),
	},
	moveEntity: {
		of: 'project',
		send: (projectId, golden) => ({ params: { projectId, entityId: golden.members.winter.entityId }, body: { index: 0 } }),
	},
	createKind: { of: 'project', send: (projectId) => ({ params: { projectId }, body: { name: 'Creature', description: 'What walks the ice.' } }) },
	updateKind: { of: 'project', send: (projectId) => ({ params: { projectId, kindId: 'Faction' }, body: { description: 'Sworn groups.' } }) },
	deleteKind: { of: 'project', send: (projectId) => ({ params: { projectId, kindId: 'Faction', force: true } }) },
	createDefinitionNode: {
		of: 'project',
		send: (projectId) => ({ params: { projectId, vocabulary: 'category', kindId: 'character' }, body: { path: 'Guild/Apprentices', description: 'Still learning.' } }),
	},
	updateDefinitionNode: {
		of: 'project',
		send: (projectId) => ({
			params: { projectId, vocabulary: 'category', kindId: 'character', taxonomyPath: 'Guild/Clockmakers' },
			body: { description: 'Keepers of every clock.' },
		}),
	},
	deleteDefinitionNode: {
		of: 'project',
		send: (projectId) => ({ params: { projectId, vocabulary: 'world-status', kindId: 'character', taxonomyPath: 'Missing', force: true } }),
	},
	createFieldTemplate: {
		of: 'project',
		send: (projectId) => ({ params: { projectId }, body: { kind: 'scene', name: 'Stakes', fields: [{ title: 'Stake', content: 'Everything.' }] } }),
	},
	updateFieldTemplate: {
		of: 'project',
		send: (projectId) => ({ params: { projectId, kindId: 'scene', templateName: 'Beats' }, body: { fields: [{ title: 'Turn', content: 'Late.' }] } }),
	},
	deleteFieldTemplate: { of: 'project', send: (projectId) => ({ params: { projectId, kindId: 'character', templateName: 'Voice sheet' } }) },
};

const changing = operations.filter((operation) => operation.available && operation.access !== 'read');
const send = (golden: Golden, operationId: string, projectId: string) => {
	const sent = WRITES[operationId]?.send(projectId, golden) ?? {};
	return golden.call(operationId, sent.params ?? {}, { body: sent.body, ...(sent.ifMatch === undefined ? {} : { ifMatch: sent.ifMatch }) });
};

/**
 * What holds for every operation that changes something, whichever it is:
 * the author's access level, and the two kinds of project nothing may be
 * changed in. An operation added to the contract without a line above
 * fails the first test here, so none can go without being held to the rest.
 */
describe('every operation that changes something', () => {
	it('has a call here to be held by', () => {
		expect(Object.keys(WRITES).sort()).toEqual(changing.map((operation) => operation.id).sort());
	});

	it('is refused where the author allows reading only, and nothing is written', async () => {
		const golden = await createGolden({ access: 'read' });
		const before = vaultState(golden.host);
		for (const operation of changing) {
			const reply = await send(golden, operation.id, WRITES[operation.id]?.of === 'archived' ? golden.archived.id : golden.project.id);
			expect([reply.status, bodyOf(reply.body)['code'], faults(reply)], operation.id).toEqual([403, 'access-denied', []]);
			expect(bodyOf(reply.body), operation.id).toMatchObject({ needs: operation.access, level: 'read' });
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});

	it('is refused a delete where the author allows writing and not deleting', async () => {
		const golden = await createGolden({ access: 'write' });
		const before = vaultState(golden.host);
		for (const operation of changing.filter((entry) => entry.access === 'delete')) {
			const reply = await send(golden, operation.id, golden.project.id);
			expect([reply.status, bodyOf(reply.body)['code']], operation.id).toEqual([403, 'access-denied']);
			expect(bodyOf(reply.body), operation.id).toMatchObject({ needs: 'delete', level: 'write' });
		}
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused in a project a newer version of the plugin wrote, which stays as it was', async () => {
		const golden = await createGolden();
		// The project's own note says it was written to a schema this build has not heard of.
		await golden.host.projects.repository.updatePlainFile(golden.project.projectFile, (text) =>
			text.replace(/"snowflake-schema": \d+/u, '"snowflake-schema": 99'),
		);
		const read = await golden.call('getProject', { projectId: golden.project.id });
		expect(bodyOf(read.body)['readOnly']).toBe(true);
		const before = vaultState(golden.host);
		for (const operation of changing.filter((entry) => WRITES[entry.id]?.of === 'project')) {
			const reply = await send(golden, operation.id, golden.project.id);
			expect([reply.status, bodyOf(reply.body)['code'], faults(reply)], operation.id).toEqual([409, 'read-only', []]);
		}
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused in a project that stands in the archive, where only the restore is taken', async () => {
		const golden = await createGolden();
		// Read once, so the link to its manuscript is already where the move left it.
		await golden.call('getProject', { projectId: golden.archived.id });
		const before = vaultState(golden.host);
		for (const operation of changing.filter((entry) => WRITES[entry.id]?.of === 'project')) {
			const reply = await send(golden, operation.id, golden.archived.id);
			expect([reply.status, bodyOf(reply.body)['code'], faults(reply)], operation.id).toEqual([409, 'project-archived', []]);
		}
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('writes nothing as the author’s own typing', async () => {
		const golden = await createGolden();
		golden.host.origins.length = 0;
		// What moves or puts away the project itself comes last, so the rest find it where it was.
		const last = ['updateProject', 'archiveProject'];
		const ordered = [...changing.filter((entry) => !last.includes(entry.id)), ...changing.filter((entry) => last.includes(entry.id))];
		const landed: string[] = [];
		for (const operation of ordered) {
			const reply = await send(golden, operation.id, WRITES[operation.id]?.of === 'archived' ? golden.archived.id : golden.project.id);
			if (!reply.failed) landed.push(operation.id);
		}
		// Most of them land, so this is said of real writes and not of refusals.
		expect(landed.length).toBeGreaterThan(ordered.length / 2);
		// Whatever each came to, no body it wrote and no note it made was told as the author's.
		expect(golden.host.origins.length).toBeGreaterThan(0);
		expect(golden.host.origins.filter((userInput) => userInput)).toEqual([]);
	});
});
