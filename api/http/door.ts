import type { CallHandler, IncomingCall, OutgoingReply } from '../../src/services/desktop-listener';
import type { Dispatcher, DispatchReply } from '../dispatch';
import { ApiError } from '../errors';
import { BODY_BYTES } from '../limits';
import { TokenGate, bearerOf } from './auth';
import { parseJsonBody, readBody } from './body';
import type { Router } from './router';

export interface HttpDoorDeps {
	readonly dispatcher: Dispatcher;
	readonly router: Router;
	/** What every address stands under: `/v1`. */
	readonly basePath: string;
	/** The author's token, or null where none has been made. */
	token(): string | null;
	/** The port the listener answers on, which a call must name as its host. */
	port(): number;
	/** Settles after a wait, for a caller that got the token wrong. */
	pause(ms: number): Promise<void>;
}

/** How long a caller with a wrong token waits to be told so, and how many may wait at once. */
const WRONG_TOKEN_PAUSE_MS = 400;
const MOST_WAITING_WRONG = 8;

const JSON_TYPE = 'application/json; charset=utf-8';
const PROBLEM_TYPE = 'application/problem+json; charset=utf-8';
const BODY_TYPES = ['application/json', 'application/merge-patch+json'];

/** This computer, by each name the system gives a call from itself. */
const isLoopback = (address: string | null): boolean =>
	address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

/** The version a caller names in `If-Match`, without its quotes: `*` for whichever stands, null for none. */
export function etagOf(header: string | null): string | null {
	if (header === null) return null;
	let value = header.trim();
	if (value === '') return null;
	if (value.startsWith('W/')) value = value.slice(2);
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
	return value;
}

const carriesBody = (incoming: IncomingCall): boolean => {
	const length = incoming.header('content-length');
	return (length !== null && length.trim() !== '0') || incoming.header('transfer-encoding') !== null;
};

/**
 * The HTTP door: one call from the listener, taken from its first line to
 * its answer.
 *
 * Before anything of the call is read, it is asked who could have placed
 * it. The listener answers on this computer alone, and still three things
 * are refused here. A call from another address, which nothing should be
 * able to make. A call that names another host, which is how a web page
 * tricks a browser into calling a local port under a name of its own. And
 * any call a browser says a page placed. No header that would let a page
 * read an answer is ever sent.
 *
 * Then the address, then the token, and only for a caller that may go on is
 * the body read at all.
 */
export function createHttpDoor(deps: HttpDoorDeps): CallHandler {
	const gate = new TokenGate();
	let waitingWrong = 0;

	const send = (reply: OutgoingReply, answer: DispatchReply, extra: Readonly<Record<string, string>> = {}): void => {
		const headers: Record<string, string> = {
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			...extra,
		};
		if (answer.etag !== null) headers['ETag'] = `"${answer.etag}"`;
		if (answer.location !== null) headers['Location'] = `${deps.basePath}${answer.location}`;
		if (answer.status === 401) headers['WWW-Authenticate'] = 'Bearer';
		if (answer.status === 503) headers['Retry-After'] = '1';
		if (answer.body === undefined) {
			reply.send(answer.status, headers, null);
			return;
		}
		const bytes = new TextEncoder().encode(JSON.stringify(answer.body));
		headers['Content-Type'] = answer.failed ? PROBLEM_TYPE : JSON_TYPE;
		headers['Content-Length'] = String(bytes.byteLength);
		reply.send(answer.status, headers, bytes);
	};

	const refuse = (
		reply: OutgoingReply,
		code: string,
		detail: string,
		extra: Readonly<Record<string, string>> = {},
		operationId = '',
	): void => {
		send(reply, deps.dispatcher.refused(operationId, new ApiError(code, detail)), extra);
	};

	const answer = async (incoming: IncomingCall, reply: OutgoingReply): Promise<void> => {
		if (!isLoopback(incoming.remoteAddress)) {
			incoming.drop();
			return;
		}
		const port = String(deps.port());
		const host = (incoming.header('host') ?? '').trim().toLowerCase();
		if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
			refuse(reply, 'wrong-host', 'This listener answers for 127.0.0.1 and localhost on its own port, and for no other name.');
			return;
		}
		const site = incoming.header('sec-fetch-site');
		if (incoming.header('origin') !== null || (site !== null && site.trim().toLowerCase() !== 'none')) {
			refuse(reply, 'forbidden-origin', 'A call placed by a web page is refused. Call from a program on this computer.');
			return;
		}

		const presented = bearerOf(incoming.header('authorization'));
		const authenticated = await gate.admits(presented, deps.token());
		if (presented !== null && !authenticated) {
			// Told after a wait, so guessing is slow, and never told at all
			// once too many are waiting: there is nothing to tell them apart
			// by, all of them being this computer.
			if (waitingWrong >= MOST_WAITING_WRONG) {
				incoming.drop();
				return;
			}
			waitingWrong += 1;
			try {
				await deps.pause(WRONG_TOKEN_PAUSE_MS);
			} finally {
				waitingWrong -= 1;
			}
			refuse(reply, 'unauthorized', 'That is not the access token. Copy it again from the plugin\'s settings.');
			return;
		}

		const route = deps.router.route(incoming.method, incoming.target);
		if (route.kind === 'none') {
			refuse(reply, 'not-found', 'Nothing stands at that address.');
			return;
		}
		if (route.kind === 'wrong-method') {
			refuse(reply, 'method-not-allowed', `That address takes ${route.allow.join(', ')}.`, { Allow: route.allow.join(', ') });
			return;
		}
		const operation = route.operation;
		if (!operation.open && !authenticated) {
			// Said here, before the body is read: a caller that may not go on
			// is not listened to at length.
			refuse(reply, 'unauthorized', "Send the access token from the plugin's settings as a bearer token.", {}, operation.id);
			return;
		}

		let body: unknown = undefined;
		if (carriesBody(incoming)) {
			const type = (incoming.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
			if (!BODY_TYPES.includes(type)) {
				refuse(reply, 'unsupported-media-type', 'Send the body as application/json.', {}, operation.id);
				return;
			}
			const declared = Number(incoming.header('content-length') ?? '0');
			if (Number.isFinite(declared) && declared > BODY_BYTES) {
				refuse(reply, 'payload-too-large', `A body may be ${String(BODY_BYTES)} bytes at most.`, {}, operation.id);
				return;
			}
			const read = await readBody(incoming, BODY_BYTES);
			if (!read.ok) {
				if (read.reason === 'too-large') {
					refuse(reply, 'payload-too-large', `A body may be ${String(BODY_BYTES)} bytes at most.`, {}, operation.id);
				}
				return;
			}
			if (read.bytes.byteLength > 0) {
				const parsed = parseJsonBody(read.bytes);
				if (!parsed.ok) {
					refuse(reply, 'invalid-request', parsed.detail, {}, operation.id);
					return;
				}
				body = parsed.value;
			}
		}

		send(
			reply,
			await deps.dispatcher.dispatch({
				operationId: operation.id,
				params: route.params,
				body,
				ifMatch: etagOf(incoming.header('if-match')),
				authenticated,
			}),
		);
	};

	return (incoming, reply) => {
		answer(incoming, reply).catch((error: unknown) => {
			send(reply, deps.dispatcher.refused('', error));
		});
	};
}
