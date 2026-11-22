import type { IncomingCall } from '../../src/services/desktop-listener';

export type BodyRead =
	| { readonly ok: true; readonly bytes: Uint8Array }
	/** It ran past the limit; the caller went away before it was whole. */
	| { readonly ok: false; readonly reason: 'too-large' | 'broken' };

/**
 * A call's body, read to its end or to the limit, whichever comes first.
 * Past the limit nothing more is kept: the answer is ready at once, and
 * what the caller goes on sending is let fall.
 */
export function readBody(incoming: IncomingCall, limit: number): Promise<BodyRead> {
	return new Promise((resolve) => {
		const parts: Uint8Array[] = [];
		let size = 0;
		let settled = false;
		const settle = (read: BodyRead): void => {
			if (settled) return;
			settled = true;
			resolve(read);
		};
		incoming.onChunk((chunk) => {
			if (settled) return;
			size += chunk.byteLength;
			if (size > limit) {
				parts.length = 0;
				settle({ ok: false, reason: 'too-large' });
				return;
			}
			parts.push(chunk);
		});
		incoming.onBroken(() => {
			settle({ ok: false, reason: 'broken' });
		});
		incoming.onEnd(() => {
			const bytes = new Uint8Array(size);
			let at = 0;
			for (const part of parts) {
				bytes.set(part, at);
				at += part.byteLength;
			}
			settle({ ok: true, bytes });
		});
	});
}

export type BodyParsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly detail: string };

/**
 * A body read as JSON. It must be UTF-8 through and through: text that is
 * not would be mended in silence by a looser reading, and a note written
 * from it would carry the mending.
 */
export function parseJsonBody(bytes: Uint8Array): BodyParsed {
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return { ok: false, detail: 'The body is not UTF-8 text.' };
	}
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch {
		return { ok: false, detail: 'The body is not JSON.' };
	}
}
