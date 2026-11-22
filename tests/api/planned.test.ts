import { describe, expect, it } from 'vitest';

import { isJsonObject } from '../../api/json';
import { publishedDocument } from '../../api/spec/published';
import { createGolden, faults, vaultState } from './helpers/golden-project';
import { document, operations } from './helpers/spec';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;

const planned = operations.filter((operation) => !operation.available);
const answered = operations.filter((operation) => operation.available);

/**
 * The contract describes more than this build answers. What is planned is
 * written down so it can be read and argued with before it is built, and a
 * caller is never shown it as something it can ask for.
 */
describe('the operations planned for later rounds', () => {
	it('are written down for each round after the first', () => {
		const rounds = new Map<number, number>();
		for (const operation of planned) rounds.set(operation.round, (rounds.get(operation.round) ?? 0) + 1);
		expect([...rounds.keys()].sort()).toEqual([2, 3, 4, 5]);
		expect(planned.length).toBeGreaterThan(40);
		expect(answered.every((operation) => operation.round === 1)).toBe(true);
	});

	it('answer that they are planned, whatever is sent and whatever the author allows, and touch nothing', async () => {
		const golden = await createGolden({ access: 'delete' });
		const before = vaultState(golden.host);
		for (const operation of planned) {
			const reply = await golden.call(operation.id, { projectId: golden.project.id }, { body: {} });
			expect([reply.status, bodyOf(reply.body)['code'], faults(reply)], operation.id).toEqual([501, 'planned-operation', []]);
			expect(String(bodyOf(reply.body)['detail']), operation.id).toContain(operation.id);
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});

	it('are left out of what a caller is shown, with every shape only they use', () => {
		const shown = publishedDocument(document, operations, 27125);
		const text = JSON.stringify(shown);
		for (const operation of planned) expect(text, operation.id).not.toContain(`"operationId":"${operation.id}"`);
		for (const operation of answered) expect(text, operation.id).toContain(`"operationId":"${operation.id}"`);
		const components = shown['components'];
		const schemas = isJsonObject(components) && isJsonObject(components['schemas']) ? components['schemas'] : {};
		// Shapes of the later rounds, and one of the first for comparison.
		for (const name of ['FreeformStep', 'SearchHit', 'ImportReport', 'Settings', 'MentionIgnore']) expect(schemas[name], name).toBeUndefined();
		expect(schemas['Task']).toBeDefined();
		// And no address that only a planned operation stands at.
		const paths = isJsonObject(shown['paths']) ? Object.keys(shown['paths']) : [];
		expect(paths).not.toContain('/settings');
		expect(paths).not.toContain('/projects/{projectId}/search');
		expect(paths).toContain('/projects/{projectId}/timeline');
	});

	it('change nothing of what the answered operations are', () => {
		// An address may hold both: the board is read now and written later.
		const board = operations.filter((operation) => operation.path === '/projects/{projectId}/beat-sheets');
		expect(board.map((operation) => [operation.id, operation.available])).toEqual([
			['listBeatSheets', true],
			['createBeatSheet', false],
		]);
	});
});
