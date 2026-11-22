import { describe, expect, it, vi } from 'vitest';

import { CLI_COMMAND, CLI_FLAGS, CLI_FLAG_VALUES, createCliDoor } from '../../api/cli/door';
import { Dispatcher } from '../../api/dispatch';
import type { JsonObject } from '../../api/json';
import { BRIDGE_BYTES } from '../../api/limits';
import { ApiContext, type OperationHandler } from '../../api/operations/context';
import { OperationQueue } from '../../api/queue';
import { readDocument } from '../../api/spec/document';
import { readOperations } from '../../api/spec/operations';
import { createFakeHost, type FakeHost } from './helpers/fake-host';
import { createTestApi } from './helpers/fake-listener';
import { problemFaults } from './helpers/shapes';
import { document as contract } from './helpers/spec';

const operation = (id: string, access: string, extra: JsonObject = {}): JsonObject => ({
	operationId: id,
	'x-snowflake-access': access,
	'x-snowflake-availability': { status: 'available', round: 1 },
	responses: { '200': { description: 'Done.' } },
	...extra,
});

const sample = readDocument({
	openapi: '3.1.0',
	info: { title: 'Sample', version: '1.0.0' },
	servers: [{ url: 'http://127.0.0.1:{port}/v1' }],
	paths: {
		'/': { get: operation('getApiRoot', 'read', { security: [], 'x-snowflake-direct': true }) },
		'/things': {
			get: operation('listThings', 'read', {
				parameters: [
					{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, default: 100 } },
					{ name: 'q', in: 'query', schema: { type: 'string' } },
				],
			}),
		},
		'/things/{thingId}': {
			parameters: [{ name: 'thingId', in: 'path', required: true, schema: { type: 'string' } }],
			put: operation('writeThing', 'write', {
				parameters: [{ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
						},
					},
				},
			}),
		},
	},
	'x-snowflake-problems': contract.root['x-snowflake-problems'] ?? {},
});

function setUp(handlers: Record<string, OperationHandler> = {}, start: Partial<FakeHost['state']> = {}) {
	const host = createFakeHost(start);
	const dispatcher = new Dispatcher(new ApiContext(host, sample, readOperations(sample)), new Map(Object.entries(handlers)), new OperationQueue(8));
	const door = createCliDoor({ dispatcher, basePath: sample.basePath, enabled: () => host.cliEnabled() });
	const run = async (flags: Record<string, string>): Promise<Record<string, unknown>> => JSON.parse(await door(flags)) as Record<string, unknown>;
	return { host, door, run };
}

const done: OperationHandler = () => ({ status: 200, body: { done: true } });
const encode = (value: unknown): string => encodeURIComponent(JSON.stringify(value));

describe('the command the bridge answers under', () => {
	it('is the plugin’s id and the action, as Obsidian asks of a plugin’s command', () => {
		expect(CLI_COMMAND).toBe('snowflake-method:api');
	});

	it('takes five flags, none of them the one Obsidian rewrites', () => {
		expect([...CLI_FLAGS]).toEqual(['op', 'params', 'body', 'ifMatch', 'pretty']);
		// Obsidian turns a bare `json` or `csv` into a `format` flag for any command that declares one.
		expect(CLI_FLAGS as readonly string[]).not.toContain('format');
		expect(Object.keys(CLI_FLAG_VALUES)).toEqual(['op', 'params', 'body', 'ifMatch']);
	});
});

describe('a call through the command line', () => {
	it('names its operation and is answered with one line of JSON', async () => {
		const { door } = setUp({ listThings: done });
		const line = await door({ op: 'listThings' });
		expect(line).toBe('{"ok":true,"status":200,"operationId":"listThings","data":{"done":true}}');
		expect(line).not.toContain('\n');
	});

	it('is spread over lines when that is asked for', async () => {
		const { door } = setUp({ listThings: done });
		expect(await door({ op: 'listThings', pretty: 'true' })).toBe(
			['{', '  "ok": true,', '  "status": 200,', '  "operationId": "listThings",', '  "data": {', '    "done": true', '  }', '}'].join('\n'),
		);
	});

	it('asks what answers here when it names no operation', async () => {
		const { run } = setUp({ getApiRoot: (call) => ({ status: 200, body: { authenticated: call.authenticated } }) });
		expect(await run({})).toEqual({ ok: true, status: 200, operationId: 'getApiRoot', data: { authenticated: true } });
		// A flag said bare arrives with the word `true` as its value.
		expect((await run({ op: 'true' }))['operationId']).toBe('getApiRoot');
	});

	it('carries the address’s and the query’s values as one JSON object, typed or as text', async () => {
		const seen: unknown[] = [];
		const { run } = setUp({
			listThings: (call) => {
				seen.push(call.params);
				return { status: 200 };
			},
		});
		await run({ op: 'listThings', params: '{"limit":5,"q":"snow"}' });
		await run({ op: 'listThings', params: '{"limit":"5"}' });
		await run({ op: 'listThings' });
		expect(seen).toEqual([{ limit: 5, q: 'snow' }, { limit: 5 }, { limit: 100 }]);
	});

	it('carries the body as another, and the version it means to change as a flag', async () => {
		const seen: unknown[] = [];
		const { run } = setUp({
			writeThing: (call) => {
				seen.push([call.params, call.body, call.ifMatch]);
				return { status: 200, etag: 'fp1-new', location: '/things/a' };
			},
		});
		const write = { op: 'writeThing', params: '{"thingId":"a/b"}', body: '{"text":"line one\\nline two"}' };
		expect(await run({ ...write, ifMatch: 'fp1-old' })).toEqual({
			ok: true,
			status: 200,
			operationId: 'writeThing',
			etag: 'fp1-new',
			location: '/v1/things/a',
		});
		await run({ ...write, ifMatch: '"fp1-old"' });
		expect(seen).toEqual([
			[{ thingId: 'a/b' }, { text: 'line one\nline two' }, 'fp1-old'],
			[{ thingId: 'a/b' }, { text: 'line one\nline two' }, 'fp1-old'],
		]);
		expect(await run(write)).toMatchObject({ ok: false, status: 428, error: { code: 'precondition-required' } });
	});

	it('reads a value that begins with a percent sign back out of percent-encoding', async () => {
		const seen: unknown[] = [];
		const { run } = setUp({
			writeThing: (call) => {
				seen.push([call.params, call.body]);
				return { status: 200 };
			},
		});
		const reply = await run({
			op: 'writeThing',
			params: encode({ thingId: '正文/第一章.md' }),
			body: encode({ text: '"quoted" & \'single\'\n雪' }),
			ifMatch: '*',
		});
		expect(reply['ok']).toBe(true);
		expect(seen).toEqual([[{ thingId: '正文/第一章.md' }, { text: '"quoted" & \'single\'\n雪' }]]);
	});
});

describe('a call the bridge turns away', () => {
	it('is told the bridge is off, in the same envelope, when the author has not switched it on', async () => {
		const handler = vi.fn(done);
		const { run } = setUp({ listThings: handler }, { cli: false });
		const reply = await run({ op: 'listThings' });
		expect(reply).toMatchObject({ ok: false, status: 403, operationId: 'listThings', error: { code: 'cli-bridge-off' } });
		expect(problemFaults(reply['error'])).toEqual([]);
		expect(handler).not.toHaveBeenCalled();
	});

	it('goes no further than the level the author set', async () => {
		const { run } = setUp({ writeThing: done }, { access: 'read' });
		const reply = await run({ op: 'writeThing', params: '{"thingId":"a"}', body: '{"text":"a"}', ifMatch: '*' });
		expect(reply).toMatchObject({ ok: false, status: 403, error: { code: 'access-denied', needs: 'write', level: 'read' } });
	});

	it('is told of a flag it should not have used, and where a parameter goes instead', async () => {
		const { run } = setUp({ listThings: done });
		const reply = await run({ op: 'listThings', limit: '5' });
		expect(reply).toMatchObject({
			ok: false,
			status: 400,
			error: { code: 'invalid-request', detail: "The flag limit is not known. An operation's own parameters go in params, as one JSON object." },
		});
	});

	it('is told what is wrong with a value that is not what its flag takes', async () => {
		const { run } = setUp({ listThings: done, writeThing: done });
		const detail = async (flags: Record<string, string>): Promise<unknown> =>
			((await run(flags))['error'] as { detail?: unknown } | undefined)?.detail;
		expect(await detail({ op: 'listThings', params: '{limit:5}' })).toBe('The flag params is not JSON.');
		expect(await detail({ op: 'listThings', params: '[1,2]' })).toBe('The flag params must be a JSON object.');
		expect(await detail({ op: 'listThings', params: '%E0%A4%A' })).toBe('The flag params begins with % and is not percent-encoded text.');
		expect(await detail({ op: 'writeThing', params: '{"thingId":"a"}', body: 'plain words', ifMatch: '*' })).toBe('The flag body is not JSON.');
	});

	it('is held against the contract like a call through any door', async () => {
		const { run } = setUp({ listThings: done });
		expect(await run({ op: 'listThings', params: '{"limit":0,"page":2}' })).toMatchObject({
			ok: false,
			status: 400,
			error: {
				code: 'invalid-request',
				errors: [
					{ pointer: 'params/limit', detail: 'Must be at least 1.' },
					{ pointer: 'params/page', detail: 'The parameter page is not known here.' },
				],
			},
		});
		expect(await run({ op: 'noSuchThing' })).toMatchObject({ ok: false, status: 404, operationId: 'noSuchThing', error: { code: 'unknown-operation' } });
	});

	it('is told to use the other door for more than a command line should carry', async () => {
		const handler = vi.fn(done);
		const { run } = setUp({ writeThing: handler });
		const long = JSON.stringify({ text: '雪'.repeat(BRIDGE_BYTES / 3) });
		const reply = await run({ op: 'writeThing', params: '{"thingId":"a"}', body: long, ifMatch: '*' });
		expect(reply).toMatchObject({ ok: false, status: 413, error: { code: 'payload-too-large' } });
		expect(handler).not.toHaveBeenCalled();
	});

	it('never throws, whatever it is handed', async () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { door } = setUp({
				listThings: () => {
					throw new Error('Could not read Secret Novel');
				},
			});
			const line = await door({ op: 'listThings' });
			expect(JSON.parse(line)).toMatchObject({ ok: false, status: 500, error: { code: 'internal-error' } });
			expect(line).not.toContain('Secret Novel');
		} finally {
			said.mockRestore();
		}
	});
});

describe('the bridge on the real contract', () => {
	it('answers what the HTTP door answers, without a token', async () => {
		const host = createFakeHost({ access: 'write' });
		const { api } = createTestApi(host);
		const root = JSON.parse(await api.cli({})) as { data?: Record<string, unknown> };
		expect(root.data).toMatchObject({ service: 'snowflake-method', authenticated: true, access: 'write' });
		const described = JSON.parse(await api.cli({ op: 'getOpenApiDocument' })) as { ok: boolean; data?: { openapi?: unknown } };
		expect([described.ok, described.data?.openapi]).toEqual([true, '3.1.0']);
		host.state.cli = false;
		expect(JSON.parse(await api.cli({}))).toMatchObject({ ok: false, status: 403 });
	});
});
