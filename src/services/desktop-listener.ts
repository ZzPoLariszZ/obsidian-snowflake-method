import { desktopListenerModule } from './desktop-process';

/**
 * Answering on a port of this computer, for the local API, on the desktop
 * alone. Node's own listener is asked for exactly one thing: to hear calls
 * made to this computer by programs on this computer. The address is not a
 * setting. Nothing here speaks to another machine, and nothing here places
 * a call of its own.
 *
 * What a call means is no business of this file. It hands each one over as
 * it arrived and sends back what it is given, and the API on the other side
 * never sees Node at all: what it is handed is the few things below, which
 * a test can stand in for.
 */

/** The only address the listener ever answers on: this computer's own. */
export const LOOPBACK_ADDRESS = '127.0.0.1';

/** One call as it arrives. */
export interface IncomingCall {
	readonly method: string;
	/** What was asked for, as it was sent: the path and the query, undecoded. */
	readonly target: string;
	/** Where the call came from, as the system reports it. */
	readonly remoteAddress: string | null;
	/** A header's value by its lowercase name: the first, where it was sent more than once. */
	header(name: string): string | null;
	/** Hears the body as it arrives. */
	onChunk(listener: (chunk: Uint8Array) => void): void;
	/** Hears that the body is whole. */
	onEnd(listener: () => void): void;
	/** Hears that the caller went away before it was. */
	onBroken(listener: () => void): void;
	/** Lets the connection go with no answer. */
	drop(): void;
}

/** The answer to one call. It is sent once, and a second sending does nothing. */
export interface OutgoingReply {
	send(status: number, headers: Readonly<Record<string, string>>, body: Uint8Array | null): void;
}

export type CallHandler = (incoming: IncomingCall, reply: OutgoingReply) => void;

export interface LoopbackListener {
	/** The port it answers on. */
	readonly port: number;
	/** Stops answering and lets every connection go. Settles once it has, and never rejects. */
	close(): Promise<void>;
}

export type ListenOutcome =
	| { ok: true; listener: LoopbackListener }
	| {
			ok: false;
			/** Another program has the port; the system will not give it; anything else. */
			reason: 'in-use' | 'denied' | 'failed';
	  };

export interface LoopbackListenerFactory {
	/** Starts answering on a port of this computer. Port 0 asks the system for any free one. */
	listen(port: number, handle: CallHandler): Promise<ListenOutcome>;
}

// --- Node's module, as far as it is used --------------------------------------

interface SocketLike {
	remoteAddress?: unknown;
	destroy(): unknown;
}

interface IncomingLike {
	method?: unknown;
	url?: unknown;
	headers: Record<string, unknown>;
	socket: SocketLike;
	on(event: 'data', listener: (chunk: unknown) => void): unknown;
	on(event: 'end' | 'aborted', listener: () => void): unknown;
	on(event: 'error', listener: (error: unknown) => void): unknown;
}

interface OutgoingLike {
	headersSent: boolean;
	writeHead(status: number, headers: Record<string, string>): unknown;
	end(body?: Uint8Array): unknown;
	on(event: 'error', listener: (error: unknown) => void): unknown;
}

interface ServerLike {
	maxConnections?: number;
	listen(port: number, host: string, done: () => void): unknown;
	close(done: () => void): unknown;
	closeAllConnections?: () => void;
	address(): unknown;
	on(event: 'error', listener: (error: unknown) => void): unknown;
	on(event: 'clientError', listener: (error: unknown, socket: SocketLike) => void): unknown;
}

interface ListenerModuleLike {
	createServer(handler: (incoming: IncomingLike, outgoing: OutgoingLike) => void): ServerLike;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isListenerModule = (value: unknown): value is ListenerModuleLike =>
	isRecord(value) && typeof value['createServer'] === 'function';

/** How many connections may stand open at once. A handful of local programs need no more. */
const MOST_CONNECTIONS = 32;

function incomingOf(incoming: IncomingLike): IncomingCall {
	// A call broken off raises an error of its own, which would otherwise
	// reach the window as an uncaught one.
	incoming.on('error', () => {});
	return {
		method: typeof incoming.method === 'string' ? incoming.method : '',
		target: typeof incoming.url === 'string' ? incoming.url : '',
		remoteAddress: typeof incoming.socket.remoteAddress === 'string' ? incoming.socket.remoteAddress : null,
		header: (name) => {
			const value = incoming.headers[name.toLowerCase()];
			if (typeof value === 'string') return value;
			const first: unknown = Array.isArray(value) ? value[0] : null;
			return typeof first === 'string' ? first : null;
		},
		onChunk: (listener) => {
			incoming.on('data', (chunk) => {
				if (chunk instanceof Uint8Array) listener(chunk);
				else if (typeof chunk === 'string') listener(new TextEncoder().encode(chunk));
			});
		},
		onEnd: (listener) => {
			incoming.on('end', listener);
		},
		onBroken: (listener) => {
			incoming.on('aborted', listener);
		},
		drop: () => {
			try {
				incoming.socket.destroy();
			} catch {
				// Gone already.
			}
		},
	};
}

function replyOf(outgoing: OutgoingLike): OutgoingReply {
	outgoing.on('error', () => {});
	let sent = false;
	return {
		send: (status, headers, body) => {
			if (sent || outgoing.headersSent) return;
			sent = true;
			try {
				outgoing.writeHead(status, { ...headers });
				if (body === null) outgoing.end();
				else outgoing.end(body);
			} catch {
				// The caller went away between its call and the answer.
			}
		},
	};
}

function start(node: ListenerModuleLike, port: number, handle: CallHandler): Promise<ListenOutcome> {
	return new Promise((resolve) => {
		let settled = false;
		let server: ServerLike;
		try {
			server = node.createServer((incoming, outgoing) => {
				handle(incomingOf(incoming), replyOf(outgoing));
			});
		} catch {
			resolve({ ok: false, reason: 'failed' });
			return;
		}
		server.maxConnections = MOST_CONNECTIONS;
		server.on('error', (error) => {
			// An error before it answers is why it does not: the port is
			// another program's, or the system will not give it. One after
			// that is a connection's own and changes nothing for the listener.
			if (settled) return;
			settled = true;
			const code = isRecord(error) ? error['code'] : null;
			resolve({ ok: false, reason: code === 'EADDRINUSE' ? 'in-use' : code === 'EACCES' ? 'denied' : 'failed' });
		});
		// Something that is not a call at all is let go without a word.
		server.on('clientError', (_error, socket) => {
			try {
				socket.destroy();
			} catch {
				// Gone already.
			}
		});
		try {
			server.listen(port, LOOPBACK_ADDRESS, () => {
				if (settled) return;
				settled = true;
				const address = server.address();
				const bound = isRecord(address) && typeof address['port'] === 'number' ? address['port'] : port;
				let closing: Promise<void> | null = null;
				resolve({
					ok: true,
					listener: {
						port: bound,
						close: () => {
							closing ??= new Promise<void>((closed) => {
								try {
									server.close(() => {
										closed();
									});
									// A connection kept open by a caller that is done with it
									// would otherwise hold the port until that caller let go.
									server.closeAllConnections?.();
								} catch {
									closed();
								}
							});
							return closing;
						},
					},
				});
			});
		} catch {
			if (!settled) {
				settled = true;
				resolve({ ok: false, reason: 'failed' });
			}
		}
	});
}

/**
 * The desktop's way to answer on a port, or null where there is none: on a
 * phone or a tablet, and on a desktop whose Node could not be reached.
 */
export async function desktopListenerFactory(): Promise<LoopbackListenerFactory | null> {
	const loaded = await desktopListenerModule();
	if (!isListenerModule(loaded)) return null;
	return { listen: (port, handle) => start(loaded, port, handle) };
}
