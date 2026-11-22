/** What every token the plugin makes begins with, so one found lying about can be told for what it is. */
export const TOKEN_PREFIX = 'snowflake_';

const TOKEN_BYTES = 32;

/**
 * A new access token: thirty-two bytes of the system's own randomness,
 * written out in hexadecimal. It is made on this computer, kept in
 * Obsidian's store for secrets, and shown to nobody but the author who
 * copies it.
 */
export function mintToken(): string {
	const bytes = new Uint8Array(TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	let hex = '';
	for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
	return `${TOKEN_PREFIX}${hex}`;
}
