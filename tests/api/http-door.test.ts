import { describe, expect, it, vi } from 'vitest';

import { Dispatcher } from '../../api/dispatch';
import { TokenGate, bearerOf } from '../../api/http/auth';
import { createHttpDoor, etagOf } from '../../api/http/door';
import { Router } from '../../api/http/router';
import { TOKEN_PREFIX, mintToken } from '../../api/http/token';
import type { JsonObject } from '../../api/json';
import { BODY_BYTES } from '../../api/limits';
import { ApiContext, type OperationHandler } from '../../api/operations/context';
import { OperationQueue } from '../../api/queue';
import { readDocument } from '../../api/spec/document';
import { readOperations } from '../../api/spec/operations';
import { createFakeHost, type FakeHost } from './helpers/fake-host';
import { place, type Answered, type ScriptedCall } from './helpers/fake-listener';
import { problemFaults } from './helpers/shapes';
import { document as contract } from './helpers/spec';

const operation = (id: string, access: string, extra: JsonObject = {}): JsonObject => ({
	operationId: id,
	'x-snowflake-access': access,
	'x-snowflake-availability': { status: 'available', round: 1 },
	responses: { '200': { description: 'Done.' } },
	...extra,
});

/** A small contract behind the door, with the real one's list of problems. */
const sample = readDocument({
	openapi: '3.1.0',
	info: { title: 'Sample', version: '1.0.0' },
	servers: [{ url: 'http://127.0.0.1:{port}/v1' }],
	paths: {
		'/': { get: operation('describe', 'read', { security: [], 'x-snowflake-direct': true }) },
		'/things': {
			get: operation('listThings', 'read'),
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
			put: operation('writeThing', 'write', {
				parameters: [{ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } }],
				requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
			}),
			delete: operation('deleteThing', 'delete'),
		},
	},
	'x-snowflake-problems': contract.root['x-snowflake-problems'] ?? {},
});

const TOKEN = 'snowflake_right';
const BEARER = { authorization: `Bearer ${TOKEN}` };

function setUp(handlers: Record<string, OperationHandler> = {}, start: Partial<FakeHost['state']> = {}) {
	const host = createFakeHost({ token: TOKEN, ...start });
	const operations = readOperations(sample);
	const dispatcher = new Dispatcher(new ApiContext(host, sample, operations), new Map(Object.entries(handlers)), new OperationQueue(8));
	const pauses: number[] = [];
	const door = createHttpDoor({
		dispatcher,
		router: new Router(operations, sample.basePath),
		basePath: sample.basePath,
		token: () => host.token(),
		port: () => 27125,
		pause: (ms) => {
			pauses.push(ms);
			return Promise.resolve();
		},
	});
	const ask = (call: ScriptedCall, hostHeader?: string): Promise<Answered | null> => place(door, call, hostHeader);
	return { host, door, pauses, ask };
}

const done: OperationHandler = () => ({ status: 200, body: { done: true } });
const codeOf = (answer: Answered | null): unknown => (answer?.json as { code?: unknown } | undefined)?.code;

describe('a call at the HTTP door', () => {
	it('is answered in JSON that nothing keeps and no page can read', async () => {
		const { ask } = setUp({ describe: done });
		const answer = await ask({ target: '/v1' });
		expect(answer?.status).toBe(200);
		expect(answer?.json).toEqual({ done: true });
		expect(answer?.headers).toEqual({
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
			'content-type': 'application/json; charset=utf-8',
			'content-length': '13',
		});
		expect(Object.keys(answer?.headers ?? {}).some((name) => name.startsWith('access-control-'))).toBe(false);
	});

	it('is told who it is: a caller with the token, or one without', async () => {
		const seen: boolean[] = [];
		const { ask } = setUp({
			describe: (call) => {
				seen.push(call.authenticated);
				return { status: 200 };
			},
		});
		await ask({ target: '/v1' });
		await ask({ target: '/v1', headers: BEARER });
		await ask({ target: '/v1', headers: { Authorization: `bearer   ${TOKEN}` } });
		expect(seen).toEqual([false, true, true]);
	});

	it('is told, after a wait, that its token is wrong, wherever it was going', async () => {
		const handler = vi.fn(done);
		const { ask, pauses } = setUp({ describe: handler, listThings: handler });
		for (const target of ['/v1', '/v1/things', '/v1/nonsense']) {
			const answer = await ask({ target, headers: { authorization: 'Bearer snowflake_wrong' } });
			expect(answer?.status, target).toBe(401);
			expect(codeOf(answer), target).toBe('unauthorized');
			expect(answer?.headers['www-authenticate'], target).toBe('Bearer');
			expect(problemFaults(answer?.json), target).toEqual([]);
		}
		expect(pauses).toEqual([400, 400, 400]);
		expect(handler).not.toHaveBeenCalled();
	});

	it('lets nobody in where no token has been made', async () => {
		const { ask } = setUp({ listThings: done }, { token: null });
		expect((await ask({ target: '/v1/things' }))?.status).toBe(401);
		expect((await ask({ target: '/v1/things', headers: { authorization: 'Bearer ' } }))?.status).toBe(401);
		expect((await ask({ target: '/v1/things', headers: { authorization: 'Bearer anything' } }))?.status).toBe(401);
	});

	it('needs the token for everything but what the contract leaves open, and is told before its body is read', async () => {
		const { ask, pauses } = setUp({ makeThing: done });
		const answer = await ask({ method: 'POST', target: '/v1/things', body: '{"name":"a"}', breaksOff: true });
		expect(answer?.status).toBe(401);
		// Nothing was guessed, so there is nothing to slow down.
		expect(pauses).toEqual([]);
	});
});

describe('who may have placed a call', () => {
	it('is this computer and nobody else', async () => {
		const { ask } = setUp({ describe: done });
		expect(await ask({ target: '/v1', remoteAddress: '192.168.1.20' })).toBeNull();
		expect(await ask({ target: '/v1', remoteAddress: null })).toBeNull();
		expect((await ask({ target: '/v1', remoteAddress: '::1' }))?.status).toBe(200);
		expect((await ask({ target: '/v1', remoteAddress: '::ffff:127.0.0.1' }))?.status).toBe(200);
	});

	it('names this listener as its host, by either of its two names and its own port', async () => {
		const { ask } = setUp({ describe: done });
		expect((await ask({ target: '/v1' }, 'localhost:27125'))?.status).toBe(200);
		expect((await ask({ target: '/v1' }, 'LOCALHOST:27125'))?.status).toBe(200);
		for (const other of ['evil.example', 'evil.example:27125', '127.0.0.1', '127.0.0.1:80', 'localhost.evil.example:27125', '']) {
			const answer = await ask({ target: '/v1' }, other);
			expect(answer?.status, other).toBe(421);
			expect(codeOf(answer), other).toBe('wrong-host');
		}
	});

	it('is no web page', async () => {
		const { ask } = setUp({ describe: done });
		const page = await ask({ target: '/v1', headers: { origin: 'https://evil.example' } });
		expect([page?.status, codeOf(page)]).toEqual([403, 'forbidden-origin']);
		expect((await ask({ target: '/v1', headers: { origin: 'null' } }))?.status).toBe(403);
		expect((await ask({ target: '/v1', headers: { 'sec-fetch-site': 'cross-site' } }))?.status).toBe(403);
		expect((await ask({ target: '/v1', headers: { 'sec-fetch-site': 'same-origin' } }))?.status).toBe(403);
		// What a browser sends for an address typed by hand.
		expect((await ask({ target: '/v1', headers: { 'sec-fetch-site': 'none' } }))?.status).toBe(200);
	});

	it('is let go without a word once too many wait to be told their token is wrong', async () => {
		const host = createFakeHost({ token: TOKEN });
		const operations = readOperations(sample);
		const releases: (() => void)[] = [];
		const door = createHttpDoor({
			dispatcher: new Dispatcher(new ApiContext(host, sample, operations), new Map(), new OperationQueue(8)),
			router: new Router(operations, sample.basePath),
			basePath: sample.basePath,
			token: () => TOKEN,
			port: () => 27125,
			pause: () =>
				new Promise((resolve) => {
					releases.push(resolve);
				}),
		});
		const wrong = { target: '/v1', headers: { authorization: 'Bearer snowflake_wrong' } };
		const waiting = Array.from({ length: 8 }, () => place(door, wrong));
		await vi.waitFor(() => {
			expect(releases).toHaveLength(8);
		});
		expect(await place(door, wrong)).toBeNull();
		for (const release of releases) release();
		expect((await Promise.all(waiting)).map((answer) => answer?.status)).toEqual(Array.from({ length: 8 }, () => 401));
		// With the line empty again the next one is told as before.
		const next = place(door, wrong);
		await vi.waitFor(() => {
			expect(releases).toHaveLength(9);
		});
		releases[8]?.();
		expect((await next)?.status).toBe(401);
	});
});

describe('where a call was going', () => {
	it('is told when nothing stands there, or when it stands under another method', async () => {
		const { ask } = setUp({ listThings: done });
		const nowhere = await ask({ target: '/v1/nonsense', headers: BEARER });
		expect([nowhere?.status, codeOf(nowhere)]).toEqual([404, 'not-found']);
		const wrong = await ask({ method: 'PATCH', target: '/v1/things', headers: BEARER });
		expect([wrong?.status, codeOf(wrong), wrong?.headers['allow']]).toEqual([405, 'method-not-allowed', 'GET, POST']);
		const asking = await ask({ method: 'OPTIONS', target: '/v1/things', headers: BEARER });
		expect([asking?.status, asking?.headers['allow']]).toEqual([405, 'GET, POST']);
	});

	it('hands the address’s values and the query’s to the operation', async () => {
		const seen: unknown[] = [];
		const { ask } = setUp({
			deleteThing: (call) => {
				seen.push(call.params);
				return { status: 204 };
			},
		});
		const answer = await ask({ method: 'DELETE', target: '/v1/things/a%2Fb', headers: BEARER });
		expect(answer?.status).toBe(204);
		expect(answer?.text).toBeNull();
		expect(answer?.headers['content-type']).toBeUndefined();
		expect(seen).toEqual([{ thingId: 'a/b' }]);
	});
});

describe('what a call carries', () => {
	const json = { ...BEARER, 'content-type': 'application/json' };

	it('is read as JSON, in however many pieces it arrives', async () => {
		const seen: unknown[] = [];
		const { ask } = setUp({
			makeThing: (call) => {
				seen.push(call.body);
				return { status: 201, body: { id: 'thing-1' }, etag: 'fp1-new', location: '/things/thing-1' };
			},
		});
		const answer = await ask({ method: 'POST', target: '/v1/things', headers: json, body: '{"name":"雪花"}', pieces: 5 });
		expect(answer?.status).toBe(201);
		expect(seen).toEqual([{ name: '雪花' }]);
		expect(answer?.headers['etag']).toBe('"fp1-new"');
		expect(answer?.headers['location']).toBe('/v1/things/thing-1');
	});

	it('may be sent as a merge patch, with or without a character set named', async () => {
		const { ask } = setUp({ makeThing: done });
		for (const type of ['application/merge-patch+json', 'application/json; charset=utf-8', 'Application/JSON']) {
			const answer = await ask({ method: 'POST', target: '/v1/things', headers: { ...BEARER, 'content-type': type }, body: '{"name":"a"}' });
			expect(answer?.status, type).toBe(200);
		}
	});

	it('is refused as anything but JSON', async () => {
		const handler = vi.fn(done);
		const { ask } = setUp({ makeThing: handler });
		const text = await ask({ method: 'POST', target: '/v1/things', headers: { ...BEARER, 'content-type': 'text/plain' }, body: 'name=a' });
		expect([text?.status, codeOf(text)]).toEqual([415, 'unsupported-media-type']);
		const broken = await ask({ method: 'POST', target: '/v1/things', headers: json, body: '{"name":' });
		expect([broken?.status, codeOf(broken)]).toEqual([400, 'invalid-request']);
		const bytes = await ask({ method: 'POST', target: '/v1/things', headers: json, body: new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]) });
		expect([bytes?.status, (bytes?.json as { detail?: unknown } | undefined)?.detail]).toEqual([400, 'The body is not UTF-8 text.']);
		expect(handler).not.toHaveBeenCalled();
	});

	it('is refused past the size the API takes, said so before it is read where the call says its size', async () => {
		const handler = vi.fn(done);
		const { ask } = setUp({ makeThing: handler });
		const declared = await ask({
			method: 'POST',
			target: '/v1/things',
			headers: { ...json, 'content-length': String(BODY_BYTES + 1) },
			body: '{}',
		});
		expect([declared?.status, codeOf(declared)]).toEqual([413, 'payload-too-large']);
		const streamed = await ask({
			method: 'POST',
			target: '/v1/things',
			headers: { ...json, 'content-length': '', 'transfer-encoding': 'chunked' },
			body: new Uint8Array(BODY_BYTES + 1).fill(0x20),
			pieces: 8,
		});
		expect([streamed?.status, codeOf(streamed)]).toEqual([413, 'payload-too-large']);
		expect(handler).not.toHaveBeenCalled();
	});

	it('is held against the contract like a call through any door', async () => {
		const { ask } = setUp({ makeThing: done, listThings: done });
		const answer = await ask({ method: 'POST', target: '/v1/things', headers: json, body: '{"nome":"a"}' });
		expect(answer?.status).toBe(400);
		expect(answer?.headers['content-type']).toBe('application/problem+json; charset=utf-8');
		expect(answer?.json).toMatchObject({ code: 'invalid-request', errors: [{ pointer: '', detail: 'The property name is required.' }, { pointer: '/nome' }] });
		const reading = await ask({ target: '/v1/things', headers: json, body: '{}' });
		expect(reading?.json).toMatchObject({ code: 'invalid-request', errors: [{ pointer: '', detail: 'This operation takes no body.' }] });
	});

	it('says which version it means to change, the quotes taken off', async () => {
		const seen: (string | null)[] = [];
		const { ask } = setUp({
			writeThing: (call) => {
				seen.push(call.ifMatch);
				return { status: 200 };
			},
		});
		const write = { method: 'PUT', target: '/v1/things/a', body: '{}' };
		expect(codeOf(await ask({ ...write, headers: json }))).toBe('precondition-required');
		await ask({ ...write, headers: { ...json, 'if-match': '"fp1-abc"' } });
		await ask({ ...write, headers: { ...json, 'if-match': 'W/"fp1-abc"' } });
		await ask({ ...write, headers: { ...json, 'if-match': 'fp1-abc' } });
		await ask({ ...write, headers: { ...json, 'if-match': '*' } });
		expect(seen).toEqual(['fp1-abc', 'fp1-abc', 'fp1-abc', '*']);
	});

	it('goes unanswered when the caller went away before it was whole', async () => {
		const handler = vi.fn(done);
		const { ask } = setUp({ makeThing: handler });
		expect(await ask({ method: 'POST', target: '/v1/things', headers: json, body: '{"name":"a"}', breaksOff: true })).toBeNull();
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('an answer that is a refusal', () => {
	it('says when to come back where the API is only busy or going', async () => {
		const { ask, host } = setUp({ listThings: done });
		host.state.leaving = true;
		const answer = await ask({ target: '/v1/things', headers: BEARER });
		expect([answer?.status, codeOf(answer), answer?.headers['retry-after']]).toEqual([503, 'leaving', '1']);
	});

	it('is the problem document, whatever went wrong', async () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { ask } = setUp({
				listThings: () => {
					throw new Error('Could not read Secret Novel');
				},
			});
			const answer = await ask({ target: '/v1/things', headers: BEARER });
			expect(answer?.status).toBe(500);
			expect(problemFaults(answer?.json)).toEqual([]);
			expect(answer?.text).not.toContain('Secret Novel');
		} finally {
			said.mockRestore();
		}
	});
});

describe('the token', () => {
	it('is thirty-two bytes of randomness in hexadecimal, different each time', () => {
		const first = mintToken();
		expect(first).toMatch(/^snowflake_[0-9a-f]{64}$/u);
		expect(first.startsWith(TOKEN_PREFIX)).toBe(true);
		expect(mintToken()).not.toBe(first);
	});

	it('is read out of the header that carries it', () => {
		expect(bearerOf('Bearer abc')).toBe('abc');
		expect(bearerOf('  bearer   abc  ')).toBe('abc');
		expect(bearerOf('Basic abc')).toBeNull();
		expect(bearerOf('Bearer')).toBeNull();
		expect(bearerOf('Bearer a b')).toBeNull();
		expect(bearerOf(null)).toBeNull();
	});

	it('lets in the one who holds it and nobody else', async () => {
		const gate = new TokenGate();
		expect(await gate.admits('snowflake_right', 'snowflake_right')).toBe(true);
		expect(await gate.admits('snowflake_wrong', 'snowflake_right')).toBe(false);
		expect(await gate.admits('snowflake_righ', 'snowflake_right')).toBe(false);
		expect(await gate.admits('', 'snowflake_right')).toBe(false);
		expect(await gate.admits(null, 'snowflake_right')).toBe(false);
		expect(await gate.admits('anything', null)).toBe(false);
		expect(await gate.admits('', '')).toBe(false);
		// A new token takes the old one's place at once.
		expect(await gate.admits('snowflake_right', 'snowflake_newer')).toBe(false);
		expect(await gate.admits('snowflake_newer', 'snowflake_newer')).toBe(true);
	});
});

describe('the version named in If-Match', () => {
	it('is read with or without its quotes', () => {
		expect(etagOf('"fp1-a"')).toBe('fp1-a');
		expect(etagOf(' W/"fp1-a" ')).toBe('fp1-a');
		expect(etagOf('fp1-a')).toBe('fp1-a');
		expect(etagOf('*')).toBe('*');
		expect(etagOf('')).toBeNull();
		expect(etagOf(null)).toBeNull();
	});
});
