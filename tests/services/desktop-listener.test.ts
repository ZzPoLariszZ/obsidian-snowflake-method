import { Platform } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';

import {
	LOOPBACK_ADDRESS,
	desktopListenerFactory,
	type CallHandler,
	type LoopbackListener,
	type LoopbackListenerFactory,
} from '../../src/services/desktop-listener';
import { desktopListenerModule } from '../../src/services/desktop-process';

describe('answering on a port', () => {
	const desktop = Platform.isDesktop;
	afterEach(() => {
		Platform.isDesktop = desktop;
	});

	it('has no listener on a phone or a tablet, where there is no Node to reach', async () => {
		Platform.isDesktop = false;
		expect(await desktopListenerFactory()).toBeNull();
	});

	it('answers on this computer’s own address', () => {
		expect(LOOPBACK_ADDRESS).toBe('127.0.0.1');
	});
});

// A listener started for real on a port the system picks, and called by the
// test's own Node. What is pinned is the bridge itself: a call handed over
// as it arrived, an answer sent as it was given, and how a taken port and a
// stop are told.
interface Answer {
	status: number;
	headers: { get(name: string): string | null };
	text(): Promise<string>;
}

const place = (
	globalThis as unknown as {
		fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Answer>;
	}
).fetch;

async function factory(): Promise<LoopbackListenerFactory> {
	const found = await desktopListenerFactory();
	if (found === null) throw new Error('A desktop has a listener.');
	return found;
}

describe('a listener started for real', () => {
	const open: LoopbackListener[] = [];
	afterEach(async () => {
		await Promise.all(open.splice(0).map((listener) => listener.close()));
	});

	/**
	 * Whether this machine lets a test open a port at all, asked of Node
	 * itself and not of the listener under test: a sandbox that forbids it
	 * forbids Node too.
	 */
	async function portsAllowed(): Promise<boolean> {
		// What Node's own server is taken to hold, as the plugin spells out what it uses of it.
		interface Probe {
			once(event: 'error', heard: () => void): void;
			listen(port: number, host: string, ready: () => void): void;
			close(done: () => void): void;
		}
		const node = (await desktopListenerModule()) as { createServer(): Probe } | null;
		if (node === null) return false;
		return new Promise((resolve) => {
			const probe = node.createServer();
			probe.once('error', () => {
				resolve(false);
			});
			probe.listen(0, LOOPBACK_ADDRESS, () => {
				probe.close(() => {
					resolve(true);
				});
			});
		});
	}

	/**
	 * Starts one on any free port. Null only where this machine lets a test
	 * have none, which is no fault of the listener and is skipped. A
	 * listener that will not start where a port can be had is a broken
	 * listener, and fails the test that asked for it.
	 */
	async function listen(handle: CallHandler): Promise<LoopbackListener | null> {
		const outcome = await (await factory()).listen(0, handle);
		if (!outcome.ok) {
			if (await portsAllowed()) throw new Error(`The listener did not start on a machine that has ports to give: ${outcome.reason}.`);
			return null;
		}
		open.push(outcome.listener);
		return outcome.listener;
	}

	it('hands a call over as it arrived and sends back what it is given', async (context) => {
		const seen: Record<string, unknown> = {};
		const listener = await listen((incoming, reply) => {
			const parts: Uint8Array[] = [];
			incoming.onChunk((chunk) => {
				parts.push(chunk);
			});
			incoming.onEnd(() => {
				seen['method'] = incoming.method;
				seen['target'] = incoming.target;
				seen['remote'] = incoming.remoteAddress;
				seen['type'] = incoming.header('Content-Type');
				seen['missing'] = incoming.header('x-not-sent');
				seen['body'] = new TextDecoder().decode(
					parts.reduce((whole, part) => new Uint8Array([...whole, ...part]), new Uint8Array()),
				);
				reply.send(201, { 'content-type': 'application/json; charset=utf-8', etag: '"fp1-a"' }, new TextEncoder().encode('{"made":true}'));
				// A second answer to the same call is not sent.
				reply.send(500, {}, null);
			});
		});
		if (listener === null) {
			context.skip();
			return;
		}
		expect(listener.port).toBeGreaterThan(0);
		const answer = await place(`http://127.0.0.1:${String(listener.port)}/v1/things/a%2Fb?limit=5`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"name":"雪"}',
		});
		expect(answer.status).toBe(201);
		expect(answer.headers.get('etag')).toBe('"fp1-a"');
		expect(await answer.text()).toBe('{"made":true}');
		expect(seen).toEqual({
			method: 'POST',
			// Undecoded: the API splits an address on its slashes before it reads the parts.
			target: '/v1/things/a%2Fb?limit=5',
			remote: '127.0.0.1',
			type: 'application/json',
			missing: null,
			body: '{"name":"雪"}',
		});
	});

	it('sends an answer with no body as one', async (context) => {
		const listener = await listen((incoming, reply) => {
			incoming.onEnd(() => {
				reply.send(204, {}, null);
			});
			// A call with no body has to be read to its end all the same.
			incoming.onChunk(() => {});
		});
		if (listener === null) {
			context.skip();
			return;
		}
		const answer = await place(`http://127.0.0.1:${String(listener.port)}/`, { method: 'DELETE' });
		expect(answer.status).toBe(204);
		expect(await answer.text()).toBe('');
	});

	it('says so when the port is another program’s', async (context) => {
		const first = await listen(() => {});
		if (first === null) {
			context.skip();
			return;
		}
		const second = await (await factory()).listen(first.port, () => {});
		expect(second).toEqual({ ok: false, reason: 'in-use' });
	});

	it('stops answering when it is closed, however often that is asked', async (context) => {
		const listener = await listen((incoming, reply) => {
			incoming.onChunk(() => {});
			incoming.onEnd(() => {
				reply.send(200, {}, null);
			});
		});
		if (listener === null) {
			context.skip();
			return;
		}
		const address = `http://127.0.0.1:${String(listener.port)}/`;
		expect((await place(address)).status).toBe(200);
		await Promise.all([listener.close(), listener.close()]);
		await expect(place(address)).rejects.toBeDefined();
		// And the port is free for the next one.
		const again = await (await factory()).listen(listener.port, () => {});
		expect(again.ok).toBe(true);
		if (again.ok) open.push(again.listener);
	});
});
