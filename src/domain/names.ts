/**
 * The form two names are compared in.
 *
 * Case and surrounding space are folded away because a reader telling two names
 * apart cannot see either. Runs of whitespace collapse for the same reason, and
 * because the file name a note is given collapses them too — so "Ada  Lovelace"
 * and "Ada Lovelace" would be asking for the same note. Composed first, so a
 * name typed with combining accents matches the same name typed with precomposed
 * ones, which no author would expect to be two different characters.
 */
export function foldName(value: string): string {
	return value
		.normalize('NFC')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLocaleLowerCase();
}

/**
 * Whether `name` is one of `taken`. An empty name is never taken: it fails the
 * required check instead, which says something more useful about it.
 */
export function isNameTaken(
	taken: readonly string[],
	name: string,
): boolean {
	const folded = foldName(name);
	if (folded.length === 0) return false;
	return taken.some((candidate) => foldName(candidate) === folded);
}

/**
 * A name a file or folder can actually be given. Lossy on purpose — what a
 * path cannot hold is dropped rather than escaped — so a file name can never
 * be read back as the name it came from.
 */
export function safeFileName(value: string): string {
	const normalized = value
		.trim()
		.replace(/[\\/:*?"<>|#[\]^]/gu, '-')
		.replace(/\s+/gu, ' ')
		.replace(/\.+$/gu, '')
		.trim();
	if (!normalized || normalized === '.' || normalized === '..') {
		throw new Error('The name does not contain a safe file name.');
	}
	return normalized;
}

/** The file name of a path, without the Markdown extension. */
export function fileStem(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	return name.endsWith('.md') ? name.slice(0, -3) : name;
}
