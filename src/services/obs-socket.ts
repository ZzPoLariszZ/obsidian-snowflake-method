import {
	OBS_CLOSE_PASSWORD,
	OBS_CLOSE_VERSION,
	decodeObsMessage,
	encodeObsCall,
	encodeObsIdentify,
	obsAuthentication,
} from '../domain';

/**
 * One conversation with OBS's WebSocket server: the greeting, the proof of
 * the password where OBS asks one, then things asked and answered by id,
 * and the events OBS sends unasked. The socket itself is handed in, so a
 * test speaks to a scripted OBS and nothing here opens a connection.
 *
 * Nothing asked of OBS ever throws: an answer says whether it was done,
 * and a conversation that ended or went silent answers for itself.
 */

/** A WebSocket as far as the conversation needs one. */
export interface SocketLike {
	send(text: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number }) => void) | null;
	onerror: (() => void) | null;
}

/** What OBS answered. A code of 0 says the conversation ended first, -1 that no answer came in time. */
export type ObsAnswer =
	| { ok: true; data: Record<string, unknown> }
	| { ok: false; code: number; comment: string | null };

export const OBS_ANSWER_ENDED = 0;
export const OBS_ANSWER_SILENT = -1;

export type ObsConnection =
	| { ok: true }
	| {
			ok: false;
			/** Nothing listens there; it wants a password and none was given; the one given is wrong; it speaks an older tongue; it never finished the greeting. */
			reason: 'refused' | 'password-needed' | 'password-wrong' | 'old' | 'silent';
	  };

export interface ObsEvent {
	type: string;
	data: Record<string, unknown>;
}

export interface ObsSocketDeps {
	/** Opens a socket to an address on this computer. */
	open(url: string): SocketLike;
	timers: {
		set(handler: () => void, ms: number): unknown;
		clear(handle: unknown): void;
	};
	/** A fresh id for one thing asked. */
	mint(): string;
}

/** How long the greeting may take, and how long one answer. */
const GREETING_MS = 5000;
const ANSWER_MS = 8000;
/** The code a socket closes with when it failed and no one closed it. */
const CLOSE_ABNORMAL = 1006;

/** OBS is only ever spoken to on this computer: the address is no setting. */
export function obsAddress(port: number): string {
	return `ws://127.0.0.1:${String(port)}`;
}

export class ObsSocket {
	private socket: SocketLike | null = null;
	private identified = false;
	private readonly waiting = new Map<string, { settle: (answer: ObsAnswer) => void; timer: unknown }>();
	private readonly eventListeners = new Set<(event: ObsEvent) => void>();
	private readonly closeListeners = new Set<(code: number) => void>();

	constructor(private readonly deps: ObsSocketDeps) {}

	/** True from the end of the greeting until the conversation ends. */
	get open(): boolean {
		return this.socket !== null && this.identified;
	}

	/**
	 * Opens the conversation and sees the greeting through. The password is
	 * used for the proof alone: it is in no message sent.
	 */
	connect(port: number, password: string | null): Promise<ObsConnection> {
		this.close();
		return new Promise((resolve) => {
			let settled = false;
			let socket: SocketLike;
			const finish = (outcome: ObsConnection): void => {
				if (settled) return;
				settled = true;
				this.deps.timers.clear(timer);
				if (!outcome.ok) {
					if (this.socket === socket) this.socket = null;
					socket.onclose = null;
					socket.onmessage = null;
					socket.onerror = null;
					socket.onopen = null;
					try {
						socket.close();
					} catch {
						// Already closed, or never opened: there is nothing left to close.
					}
				}
				resolve(outcome);
			};
			const timer = this.deps.timers.set(() => {
				finish({ ok: false, reason: 'silent' });
			}, GREETING_MS);
			try {
				socket = this.deps.open(obsAddress(port));
			} catch {
				// Unreachable in a browser, where a refusal arrives as an error
				// and a close; a factory that throws is read the same.
				socket = { send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
				finish({ ok: false, reason: 'refused' });
				return;
			}
			this.socket = socket;
			this.identified = false;
			socket.onmessage = (event) => {
				const message = decodeObsMessage(event.data);
				if (message === null) return;
				if (!settled) {
					if (message.kind === 'hello') {
						const asked = message.authentication;
						if (asked === null) {
							socket.send(encodeObsIdentify(null));
							return;
						}
						if (password === null || password.length === 0) {
							finish({ ok: false, reason: 'password-needed' });
							return;
						}
						void obsAuthentication(password, asked.salt, asked.challenge).then(
							(proof) => {
								if (!settled && this.socket === socket) socket.send(encodeObsIdentify(proof));
							},
							() => {
								finish({ ok: false, reason: 'silent' });
							},
						);
						return;
					}
					if (message.kind === 'identified') {
						this.identified = true;
						finish({ ok: true });
					}
					return;
				}
				this.receive(message);
			};
			socket.onclose = (event) => {
				if (!settled) {
					finish({
						ok: false,
						reason:
							event.code === OBS_CLOSE_PASSWORD
								? 'password-wrong'
								: event.code === OBS_CLOSE_VERSION
									? 'old'
									: 'refused',
					});
					return;
				}
				if (this.socket !== socket) return;
				this.ended(event.code);
			};
			socket.onerror = () => {
				// A socket reports an error only as it fails. Electron follows it
				// with a close, which then finds nothing left to do. Where no
				// close follows, the error is the only word of the end there is.
				if (!settled) {
					finish({ ok: false, reason: 'refused' });
					return;
				}
				if (this.socket !== socket) return;
				socket.onclose = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onopen = null;
				try {
					socket.close();
				} catch {
					// Failed already: there is nothing left to close.
				}
				this.ended(CLOSE_ABNORMAL);
			};
		});
	}

	/** Asks one thing of OBS. Never rejects. */
	call(type: string, data?: Record<string, unknown>): Promise<ObsAnswer> {
		const socket = this.socket;
		if (socket === null || !this.identified) {
			return Promise.resolve({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
		}
		return new Promise((resolve) => {
			const id = this.deps.mint();
			const timer = this.deps.timers.set(() => {
				this.waiting.delete(id);
				resolve({ ok: false, code: OBS_ANSWER_SILENT, comment: null });
			}, ANSWER_MS);
			this.waiting.set(id, { settle: resolve, timer });
			try {
				socket.send(encodeObsCall(id, type, data));
			} catch {
				this.waiting.delete(id);
				this.deps.timers.clear(timer);
				resolve({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
			}
		});
	}

	/** Hears what OBS says unasked. Returns the release. */
	listen(listener: (event: ObsEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	/** Hears the conversation end from OBS's side, never from a `close()` here. Returns the release. */
	onEnded(listener: (code: number) => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}

	/** Ends the conversation from this side. Whatever still waits is answered as ended. */
	close(): void {
		const socket = this.socket;
		this.socket = null;
		this.identified = false;
		this.settleWaiting();
		if (socket === null) return;
		socket.onclose = null;
		socket.onmessage = null;
		socket.onerror = null;
		socket.onopen = null;
		try {
			socket.close();
		} catch {
			// Closed already.
		}
	}

	private receive(message: NonNullable<ReturnType<typeof decodeObsMessage>>): void {
		if (message.kind === 'answer') {
			const waiting = this.waiting.get(message.id);
			// An answer nobody waits for any more came after its time ran out.
			if (waiting === undefined) return;
			this.waiting.delete(message.id);
			this.deps.timers.clear(waiting.timer);
			waiting.settle(
				message.ok
					? { ok: true, data: message.data }
					: { ok: false, code: message.code, comment: message.comment },
			);
			return;
		}
		if (message.kind === 'event') {
			for (const listener of [...this.eventListeners]) listener({ type: message.type, data: message.data });
		}
	}

	private ended(code: number): void {
		this.socket = null;
		this.identified = false;
		this.settleWaiting();
		for (const listener of [...this.closeListeners]) listener(code);
	}

	private settleWaiting(): void {
		const waiting = [...this.waiting.values()];
		this.waiting.clear();
		for (const entry of waiting) {
			this.deps.timers.clear(entry.timer);
			entry.settle({ ok: false, code: OBS_ANSWER_ENDED, comment: null });
		}
	}
}

/** The window's own WebSocket behind the shape the conversation speaks through. */
export function windowSocket(url: string): SocketLike {
	const socket = new WebSocket(url);
	const like: SocketLike = {
		send: (text) => {
			socket.send(text);
		},
		close: () => {
			socket.close();
		},
		onopen: null,
		onmessage: null,
		onclose: null,
		onerror: null,
	};
	socket.onopen = () => {
		like.onopen?.();
	};
	socket.onmessage = (event: MessageEvent<unknown>) => {
		like.onmessage?.({ data: event.data });
	};
	socket.onclose = (event) => {
		like.onclose?.({ code: event.code });
	};
	socket.onerror = () => {
		like.onerror?.();
	};
	return like;
}
