import { describe, expect, it, vi } from 'vitest';

import { Dispatcher, type DispatchCall } from '../../api/dispatch';
import { ApiError } from '../../api/errors';
import type { JsonObject } from '../../api/json';
import { ApiContext, type OperationHandler } from '../../api/operations/context';
import { OperationQueue } from '../../api/queue';
import { readDocument } from '../../api/spec/document';
import { readOperations } from '../../api/spec/operations';
import { ConcurrentChangeError } from '../../src/repository/errors';
import { writesUnderWay } from '../../src/repository/writes-under-way';
import { createFakeHost, type FakeHost } from './helpers/fake-host';

const operation = (id: string, access: string, extra: JsonObject = {}): JsonObject => ({
	operationId: id,
	'x-snowflake-access': access,
	'x-snowflake-availability': { status: 'available', round: 1 },
	responses: { '200': { description: 'Done.' } },
	...extra,
});

/** A small contract with one operation of each kind the dispatcher tells apart. */
const sample = readDocument({
	openapi: '3.1.0',
	info: { title: 'Sample', version: '1.0.0' },
	servers: [{ url: 'http://127.0.0.1:{port}/v1' }],
	paths: {
		'/': { get: operation('describe', 'read', { security: [], 'x-snowflake-direct': true }) },
		'/things': {
			get: operation('listThings', 'read', {
				parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, default: 100 } }],
			}),
			post: operation('makeThing', 'write', {
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } },
						},
					},
				},
			}),
		},
		'/things/{thingId}': {
			parameters: [{ name: 'thingId', in: 'path', required: true, schema: { type: 'string' } }],
			patch: operation('changeThing', 'write', {
				parameters: [{ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } }],
			}),
			delete: operation('deleteThing', 'delete'),
		},
		'/later': {
			get: operation('readLater', 'read', { 'x-snowflake-availability': { status: 'planned', round: 2 } }),
		},
	},
	'x-snowflake-problems': {
		'invalid-request': { status: 400, title: 'Invalid.' },
		unauthorized: { status: 401, title: 'Unauthorized.' },
		'access-denied': { status: 403, title: 'Denied.' },
		'unknown-operation': { status: 404, title: 'Unknown.' },
		'not-found': { status: 404, title: 'Not found.' },
		'concurrent-change': { status: 412, title: 'Changed.' },
		'precondition-required': { status: 428, title: 'Precondition.' },
		'internal-error': { status: 500, title: 'Failed.' },
		'planned-operation': { status: 501, title: 'Planned.' },
		busy: { status: 503, title: 'Busy.' },
		leaving: { status: 503, title: 'Leaving.' },
	},
});

function setUp(handlers: Record<string, OperationHandler>, start: Partial<FakeHost['state']> = {}, depth = 8) {
	const host = createFakeHost(start);
	const context = new ApiContext(host, sample, readOperations(sample));
	const dispatcher = new Dispatcher(context, new Map(Object.entries(handlers)), new OperationQueue(depth));
	return { host, dispatcher };
}

const call = (operationId: string, extra: Partial<DispatchCall> = {}): DispatchCall => ({
	operationId,
	params: {},
	body: undefined,
	ifMatch: null,
	authenticated: true,
	...extra,
});

const done: OperationHandler = () => ({ status: 200, body: { done: true } });
const codeOf = (body: unknown): unknown => (body as { code?: unknown }).code;
const turn = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

describe('a call on its way to a handler', () => {
	it('is answered by the handler of its operation', async () => {
		const { dispatcher } = setUp({ listThings: (given) => ({ status: 200, body: { limit: given.params['limit'] as number }, etag: 'fp1-a' }) });
		expect(await dispatcher.dispatch(call('listThings', { params: { limit: '7' } }))).toEqual({
			status: 200,
			failed: false,
			operationId: 'listThings',
			body: { limit: 7 },
			etag: 'fp1-a',
			location: null,
		});
	});

	it('is turned away for an operation there is not', async () => {
		const { dispatcher } = setUp({});
		const reply = await dispatcher.dispatch(call('noSuchThing'));
		expect([reply.status, reply.failed, codeOf(reply.body)]).toEqual([404, true, 'unknown-operation']);
	});

	it('is told an operation is planned, whether or not a handler stands ready for it', async () => {
		const { dispatcher } = setUp({ readLater: done });
		expect(codeOf((await dispatcher.dispatch(call('readLater'))).body)).toBe('planned-operation');
		// And one the contract calls available with no handler behind it is not answered either.
		expect((await setUp({}).dispatcher.dispatch(call('listThings'))).status).toBe(501);
	});

	it('needs the token everywhere but where the contract says otherwise', async () => {
		const seen: boolean[] = [];
		const { dispatcher } = setUp({
			listThings: done,
			describe: (given) => {
				seen.push(given.authenticated);
				return { status: 200 };
			},
		});
		expect((await dispatcher.dispatch(call('listThings', { authenticated: false }))).status).toBe(401);
		expect((await dispatcher.dispatch(call('describe', { authenticated: false }))).status).toBe(200);
		expect((await dispatcher.dispatch(call('describe'))).status).toBe(200);
		expect(seen).toEqual([false, true]);
	});

	it('goes no further than the level the author set', async () => {
		const handlers = { listThings: done, makeThing: done, deleteThing: done };
		const make = call('makeThing', { body: { name: 'a' } });
		const remove = call('deleteThing', { params: { thingId: 'a' } });
		const reading = setUp(handlers, { access: 'read' }).dispatcher;
		expect((await reading.dispatch(call('listThings'))).status).toBe(200);
		expect(codeOf((await reading.dispatch(make)).body)).toBe('access-denied');
		expect(codeOf((await reading.dispatch(remove)).body)).toBe('access-denied');
		const writing = setUp(handlers, { access: 'write' }).dispatcher;
		expect((await writing.dispatch(make)).status).toBe(200);
		const denied = await writing.dispatch(remove);
		expect(denied.body).toMatchObject({ code: 'access-denied', needs: 'delete', level: 'write' });
		const deleting = setUp(handlers, { access: 'delete' }).dispatcher;
		expect((await deleting.dispatch(remove)).status).toBe(200);
	});

	it('is held against the contract before a handler sees it', async () => {
		const handler = vi.fn(done);
		const { dispatcher } = setUp({ makeThing: handler, listThings: handler });
		const reply = await dispatcher.dispatch(call('makeThing', { body: { name: 4, extra: true } }));
		expect(reply.status).toBe(400);
		expect(reply.body).toMatchObject({
			code: 'invalid-request',
			errors: [
				{ pointer: '/name', detail: 'Expected string, found integer.' },
				{ pointer: '/extra', detail: 'The property extra is not known here.' },
			],
		});
		expect((await dispatcher.dispatch(call('listThings', { params: { limit: 'many' } }))).status).toBe(400);
		expect(handler).not.toHaveBeenCalled();
	});

	it('must say which version it means to change where the contract asks', async () => {
		const seen: (string | null)[] = [];
		const { dispatcher } = setUp({
			changeThing: (given) => {
				seen.push(given.ifMatch);
				return { status: 200 };
			},
			listThings: (given) => {
				seen.push(given.ifMatch);
				return { status: 200 };
			},
		});
		const change = call('changeThing', { params: { thingId: 'a' } });
		expect(codeOf((await dispatcher.dispatch(change)).body)).toBe('precondition-required');
		expect((await dispatcher.dispatch({ ...change, ifMatch: 'fp1-a' })).status).toBe(200);
		// One sent where none is asked for is not handed on.
		expect((await dispatcher.dispatch(call('listThings', { ifMatch: 'fp1-a' }))).status).toBe(200);
		expect(seen).toEqual(['fp1-a', null]);
	});
});

describe('a call waiting for its turn', () => {
	it('waits until projects can be listed, unless it asks only about the API', async () => {
		const { host, dispatcher } = setUp({ listThings: done, describe: done }, { ready: false });
		expect((await dispatcher.dispatch(call('describe'))).status).toBe(200);
		let answered = false;
		const waiting = dispatcher.dispatch(call('listThings')).then((reply) => {
			answered = true;
			return reply;
		});
		await turn();
		expect(answered).toBe(false);
		host.becomeReady();
		expect((await waiting).status).toBe(200);
	});

	it('is not started once the plugin is going, even if it was already in line', async () => {
		const { host, dispatcher } = setUp({ listThings: done });
		host.state.leaving = true;
		expect(codeOf((await dispatcher.dispatch(call('listThings'))).body)).toBe('leaving');

		let release: () => void = () => {};
		const slow: OperationHandler = () =>
			new Promise((resolve) => {
				release = () => {
					resolve({ status: 200 });
				};
			});
		const second = vi.fn(done);
		const lined = setUp({ listThings: slow, makeThing: second });
		const first = lined.dispatcher.dispatch(call('listThings'));
		const next = lined.dispatcher.dispatch(call('makeThing', { body: { name: 'a' } }));
		await turn();
		lined.host.state.leaving = true;
		release();
		expect((await first).status).toBe(200);
		expect(codeOf((await next).body)).toBe('leaving');
		expect(second).not.toHaveBeenCalled();
	});

	it('is held to the level the author has set by the time its turn comes', async () => {
		// Let in while writing was allowed, and still waiting for the vault when the author took that back.
		const made = vi.fn(done);
		const { host, dispatcher } = setUp({ makeThing: made, listThings: done }, { ready: false, access: 'write' });
		const waiting = dispatcher.dispatch(call('makeThing', { body: { name: 'a' } }));
		const reading = dispatcher.dispatch(call('listThings'));
		await turn();
		host.state.access = 'read';
		host.becomeReady();
		const reply = await waiting;
		expect([reply.status, reply.body]).toMatchObject([403, { code: 'access-denied', needs: 'write', level: 'read' }]);
		expect(made).not.toHaveBeenCalled();
		// What the new level still allows goes on.
		expect((await reading).status).toBe(200);

		// And one waiting behind another call, with the level lowered meanwhile.
		let release: () => void = () => {};
		const slow: OperationHandler = () =>
			new Promise((resolve) => {
				release = () => {
					resolve({ status: 200 });
				};
			});
		const removed = vi.fn(done);
		const lined = setUp({ listThings: slow, deleteThing: removed });
		const first = lined.dispatcher.dispatch(call('listThings'));
		const next = lined.dispatcher.dispatch(call('deleteThing', { params: { thingId: 'a' } }));
		await turn();
		lined.host.state.access = 'write';
		release();
		expect((await first).status).toBe(200);
		expect((await next).body).toMatchObject({ code: 'access-denied', needs: 'delete', level: 'write' });
		expect(removed).not.toHaveBeenCalled();
	});

	it('is taken one at a time, and told when the line is too long', async () => {
		let release: () => void = () => {};
		const slow: OperationHandler = () =>
			new Promise((resolve) => {
				release = () => {
					resolve({ status: 200 });
				};
			});
		const { dispatcher } = setUp({ listThings: slow, makeThing: done }, {}, 1);
		const first = dispatcher.dispatch(call('listThings'));
		await turn();
		expect(codeOf((await dispatcher.dispatch(call('makeThing', { body: { name: 'a' } }))).body)).toBe('busy');
		release();
		expect((await first).status).toBe(200);
	});
});

describe('a change on its way to the disk', () => {
	it('is noted as a write for as long as its handler runs, and runs as the plugin’s own work', async () => {
		let during: Promise<void> | null = null;
		const { host, dispatcher } = setUp({
			makeThing: async () => {
				during = writesUnderWay();
				await turn();
				return { status: 201 };
			},
		});
		expect(writesUnderWay()).toBeNull();
		expect((await dispatcher.dispatch(call('makeThing', { body: { name: 'a' } }))).status).toBe(201);
		expect(during).not.toBeNull();
		expect(host.ranAsPlugin).toBe(1);
		await turn();
		expect(writesUnderWay()).toBeNull();
	});

	it('a reading is neither', async () => {
		let during: Promise<void> | null = Promise.resolve();
		const { host, dispatcher } = setUp({
			listThings: () => {
				during = writesUnderWay();
				return { status: 200 };
			},
		});
		await dispatcher.dispatch(call('listThings'));
		expect(during).toBeNull();
		expect(host.ranAsPlugin).toBe(0);
	});
});

describe('a handler that fails', () => {
	it('is answered with the problem the contract lists for it', async () => {
		const { dispatcher } = setUp({
			listThings: () => {
				throw new ApiError('not-found', 'No such thing.');
			},
			makeThing: () => Promise.reject(new ConcurrentChangeError('a.md', 'fp1-old', 'fp1-new')),
		});
		expect(await dispatcher.dispatch(call('listThings'))).toEqual({
			status: 404,
			failed: true,
			operationId: 'listThings',
			body: { type: '/problems/not-found', title: 'Not found.', status: 404, code: 'not-found', detail: 'No such thing.' },
			etag: null,
			location: null,
		});
		const stale = await dispatcher.dispatch(call('makeThing', { body: { name: 'a' } }));
		expect(stale.status).toBe(412);
		expect(stale.body).toMatchObject({ code: 'concurrent-change', currentEtag: 'fp1-new' });
	});

	it('says nothing of an unknown failure but that it failed, to the caller and to the console', async () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { dispatcher } = setUp({
				listThings: () => {
					throw new TypeError('Cannot read Snowflake Projects/Secret Novel/Chapter 1.md');
				},
			});
			const reply = await dispatcher.dispatch(call('listThings'));
			expect(reply.status).toBe(500);
			expect(JSON.stringify(reply.body)).not.toContain('Secret Novel');
			expect(said).toHaveBeenCalledTimes(1);
			const line = String(said.mock.calls[0]?.[0]);
			expect(line).toContain('listThings failed with TypeError');
			expect(line).not.toContain('Secret Novel');
		} finally {
			said.mockRestore();
		}
	});

	it('leaves the line open for the call after it', async () => {
		const { dispatcher } = setUp({
			listThings: () => {
				throw new ApiError('not-found', 'No.');
			},
			makeThing: done,
		});
		await dispatcher.dispatch(call('listThings'));
		expect((await dispatcher.dispatch(call('makeThing', { body: { name: 'a' } }))).status).toBe(200);
	});
});
