/** The token out of an `Authorization` header, or null where the header carries none. */
export function bearerOf(header: string | null): string | null {
	if (header === null) return null;
	const found = /^Bearer +([^\s]+)$/iu.exec(header.trim());
	return found?.[1] ?? null;
}

async function digestOf(text: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Whether a caller holds the author's token.
 *
 * The two are never laid side by side. Each is put through SHA-256 and the
 * digests are compared whole, every byte of them whatever the first one
 * says, so how long the answer takes tells a caller nothing about how much
 * of its guess was right.
 */
export class TokenGate {
	private held: { token: string; digest: Uint8Array } | null = null;

	async admits(presented: string | null, token: string | null): Promise<boolean> {
		// With no token made there is nobody to let in.
		if (presented === null || token === null || token === '') return false;
		if (this.held?.token !== token) this.held = { token, digest: await digestOf(token) };
		const expected = this.held.digest;
		const given = await digestOf(presented);
		let difference = given.length ^ expected.length;
		for (let at = 0; at < expected.length; at += 1) difference |= (given[at] ?? 0) ^ (expected[at] ?? 0);
		return difference === 0;
	}
}
