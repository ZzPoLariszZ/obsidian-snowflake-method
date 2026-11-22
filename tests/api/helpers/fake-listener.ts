import type { ServerStatus } from '../../../api/http/server';
import { createLocalApi, type LocalApi } from '../../../api/index';
import type {
	CallHandler,
	IncomingCall,
	ListenOutcome,
	LoopbackListenerFactory,
	OutgoingReply,
} from '../../../src/services/desktop-listener';
import type { FakeHost } from './fake-host';

/** One call for a door to answer, scripted. */
export interface ScriptedCall {
	method?: string;
	target: string;
	headers?: Record<string, string>;
	/** Text is sent as UTF-8. Bytes are sent as they are. */
	body?: string | Uint8Array;
	/** The body in this many pieces rather than one. */
	pieces?: number;
	remoteAddress?: string | null;
	/** The caller goes away before its body is whole. */
	breaksOff?: boolean;
}

export interface Answered {
	status: number;
	headers: Record<string, string>;
	/** The body as text, or null where the answer had none. */
	text: string | null;
	/** The body read as JSON, or undefined where there was none. */
	json: unknown;
}

/**
 * Hands a scripted call to a door and resolves to its answer, or to null
 * where the door let the connection go without one.
 */
export function place(handle: CallHandler, call: ScriptedCall, host = '127.0.0.1:27125'): Promise<Answered | null> {
	return new Promise((resolve) => {
		const headers: Record<string, string> = { host };
		for (const [name, value] of Object.entries(call.headers ?? {})) headers[name.toLowerCase()] = value;
		const bytes = typeof call.body === 'string' ? new TextEncoder().encode(call.body) : (call.body ?? null);
		if (bytes !== null && headers['content-length'] === undefined) headers['content-length'] = String(bytes.byteLength);
		if (bytes !== null && headers['content-type'] === undefined) headers['content-type'] = 'application/json';

		const chunkListeners: ((chunk: Uint8Array) => void)[] = [];
		const endListeners: (() => void)[] = [];
		const brokenListeners: (() => void)[] = [];
		let started = false;
		// The body arrives once something listens for its end, a turn later,
		// as a real one arrives after the handler has gone back to the loop.
		const deliver = (): void => {
			if (started) return;
			started = true;
			queueMicrotask(() => {
				if (bytes !== null) {
					const pieces = Math.max(1, call.pieces ?? 1);
					const size = Math.ceil(bytes.byteLength / pieces);
					for (let at = 0; at < bytes.byteLength; at += Math.max(1, size)) {
						const chunk = bytes.slice(at, at + Math.max(1, size));
						for (const listener of chunkListeners) listener(chunk);
					}
				}
				if (call.breaksOff === true) for (const listener of brokenListeners) listener();
				else for (const listener of endListeners) listener();
			});
		};
		const incoming: IncomingCall = {
			method: call.method ?? 'GET',
			target: call.target,
			remoteAddress: call.remoteAddress === undefined ? '127.0.0.1' : call.remoteAddress,
			header: (name) => headers[name.toLowerCase()] ?? null,
			onChunk: (listener) => {
				chunkListeners.push(listener);
			},
			onEnd: (listener) => {
				endListeners.push(listener);
				deliver();
			},
			onBroken: (listener) => {
				brokenListeners.push(listener);
			},
			drop: () => {
				resolve(null);
			},
		};
		let sent = false;
		const reply: OutgoingReply = {
			send: (status, sentHeaders, body) => {
				if (sent) return;
				sent = true;
				const text = body === null ? null : new TextDecoder().decode(body);
				resolve({
					status,
					headers: Object.fromEntries(Object.entries(sentHeaders).map(([name, value]) => [name.toLowerCase(), value])),
					text,
					json: text === null || text === '' ? undefined : (JSON.parse(text) as unknown),
				});
			},
		};
		handle(incoming, reply);
		if (call.breaksOff === true && endListeners.length === 0) {
			// A door that never read the body hears nothing of its breaking off.
			queueMicrotask(() => {
				if (!sent) resolve(null);
			});
		}
	});
}

/** A device's listeners for a test: nothing is opened, and what was started is kept to be called. */
export interface FakeListeners extends LoopbackListenerFactory {
	/** The doors standing, by the port each answers on. */
	readonly open: Map<number, CallHandler>;
	/** What the next start is answered with, where it is not to succeed. */
	refuse: Exclude<ListenOutcome, { ok: true }>['reason'] | null;
	/** How many listeners were ever started and how many closed. */
	started: number;
	closed: number;
}

export function createFakeListeners(): FakeListeners {
	const listeners: FakeListeners = {
		open: new Map(),
		refuse: null,
		started: 0,
		closed: 0,
		listen: (port, handle) => {
			if (listeners.refuse !== null) return Promise.resolve({ ok: false, reason: listeners.refuse });
			if (listeners.open.has(port)) return Promise.resolve({ ok: false, reason: 'in-use' });
			// Port 0 is the system's to choose.
			const bound = port === 0 ? 49152 + listeners.started : port;
			listeners.open.set(bound, handle);
			listeners.started += 1;
			return Promise.resolve({
				ok: true,
				listener: {
					port: bound,
					close: () => {
						if (listeners.open.delete(bound)) listeners.closed += 1;
						return Promise.resolve();
					},
				},
			});
		},
	};
	return listeners;
}

/** The API on a fake plugin and a fake device, with what its listener told of itself. */
export interface TestApi {
	api: LocalApi;
	listeners: FakeListeners;
	statuses: ServerStatus[];
	/** Every wait the API asked for, in milliseconds. */
	pauses: number[];
}

export function createTestApi(host: FakeHost, device: { listeners?: FakeListeners | null } = {}): TestApi {
	const listeners = device.listeners === undefined ? createFakeListeners() : device.listeners;
	const statuses: ServerStatus[] = [];
	const pauses: number[] = [];
	const api = createLocalApi(host, {
		listeners: () => Promise.resolve(listeners),
		pause: (ms) => {
			pauses.push(ms);
			return Promise.resolve();
		},
		serverChanged: (status) => {
			statuses.push(status);
		},
	});
	return { api, listeners: listeners ?? createFakeListeners(), statuses, pauses };
}
