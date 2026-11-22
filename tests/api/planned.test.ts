import { describe, expect, it } from 'vitest';

import { Dispatcher } from '../../api/dispatch';
import { isJsonObject, type JsonObject } from '../../api/json';
import { QUEUE_DEPTH } from '../../api/limits';
import { ApiContext } from '../../api/operations/context';
import { allHandlers } from '../../api/operations/registry';
import { OperationQueue } from '../../api/queue';
import { readDocument } from '../../api/spec/document';
import { readOperations } from '../../api/spec/operations';
import { publishedDocument } from '../../api/spec/published';
import { createGolden, faults, vaultState } from './helpers/golden-project';
import { document } from './helpers/spec';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;

/**
 * Operations of the contract taken to be planned for the tests below: one
 * that stands alone at its address with shapes nothing else uses, one that
 * shares its address with an operation that is answered, and one that
 * changes a record.
 */
const HELD_BACK = ['searchProject', 'createBeatSheet', 'updateTask'];

/** The contract with those operations marked as planned for a round to come, and everything else as it is. */
function heldBack(): { held: ReturnType<typeof readDocument>; operations: ReturnType<typeof readOperations> } {
	const root = JSON.parse(JSON.stringify(document.root)) as JsonObject;
	const paths = root['paths'];
	for (const item of Object.values(isJsonObject(paths) ? paths : {})) {
		for (const operation of Object.values(isJsonObject(item) ? item : {})) {
			const id = isJsonObject(operation) ? operation['operationId'] : null;
			if (!isJsonObject(operation) || typeof id !== 'string' || !HELD_BACK.includes(id)) continue;
			operation['x-snowflake-availability'] = { status: 'planned', round: 9 };
		}
	}
	const held = readDocument(root);
	return { held, operations: readOperations(held) };
}

/**
 * The contract may describe more than a build answers. What is planned is
 * written down so it can be read and argued with before it is built, and a
 * caller is never shown it as something it can ask for. Every operation is
 * answered now, so the rule is held here on a copy of the contract with a
 * few operations marked as planned.
 */
describe('an operation the contract plans for a later round', () => {
	it('answers that it is planned, whatever is sent and whatever the author allows, and touches nothing', async () => {
		const golden = await createGolden({ access: 'delete' });
		const { held, operations } = heldBack();
		// The handlers are all there. It is the contract that says the operation is not answered yet.
		const dispatcher = new Dispatcher(new ApiContext(golden.host, held, operations), allHandlers(), new OperationQueue(QUEUE_DEPTH));
		const before = vaultState(golden.host);
		for (const id of HELD_BACK) {
			const reply = await dispatcher.dispatch({
				operationId: id,
				params: { projectId: golden.project.id, q: 'clock', taskId: 'task-map' },
				body: {},
				ifMatch: null,
				authenticated: true,
			});
			expect([reply.status, bodyOf(reply.body)['code'], faults(reply)], id).toEqual([501, 'planned-operation', []]);
			expect(String(bodyOf(reply.body)['detail']), id).toContain(id);
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
		// An operation left as it was is answered as ever.
		const answered = await dispatcher.dispatch({
			operationId: 'listBeatSheets',
			params: { projectId: golden.project.id },
			body: undefined,
			ifMatch: null,
			authenticated: true,
		});
		expect(answered.status).toBe(200);
	});

	it('is left out of what a caller is shown, with every shape only it uses', () => {
		const { held, operations } = heldBack();
		const shown = publishedDocument(held, operations, 27125);
		const text = JSON.stringify(shown);
		for (const operation of operations) {
			expect(text.includes(`"operationId":"${operation.id}"`), operation.id).toBe(operation.available);
		}
		expect(operations.filter((operation) => HELD_BACK.includes(operation.id)).map((operation) => operation.available)).toEqual([false, false, false]);
		const components = shown['components'];
		const schemas = isJsonObject(components) && isJsonObject(components['schemas']) ? components['schemas'] : {};
		for (const name of ['SearchHit', 'SearchPage', 'BeatSheetCreate', 'TaskPatch']) expect(schemas[name], name).toBeUndefined();
		// A shape an answered operation still uses is kept.
		expect(schemas['Task']).toBeDefined();
		expect(schemas['BeatSheet']).toBeDefined();
		// No address is shown that only a planned operation stands at, and one that an answered operation shares is.
		const paths = isJsonObject(shown['paths']) ? shown['paths'] : {};
		expect(Object.keys(paths)).not.toContain('/projects/{projectId}/search');
		const sheets = paths['/projects/{projectId}/beat-sheets'];
		expect(isJsonObject(sheets) ? Object.keys(sheets).filter((key) => key !== 'parameters') : []).toEqual(['get']);
	});

	it('is shown in the contract as it stands, where it is answered', () => {
		const standing = readOperations(document);
		const text = JSON.stringify(publishedDocument(document, standing, 27125));
		for (const operation of standing) {
			expect(text.includes(`"operationId":"${operation.id}"`), operation.id).toBe(operation.available);
		}
	});
});
