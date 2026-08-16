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
 * The name itself while nothing holds it, and otherwise the first of
 * "Name 2", "Name 3", … that nothing holds. Restore flows lean on it: a
 * collision found on the way back is repaired rather than refused, because
 * refusing would strand the returning copy behind a name its author may not
 * remember having given away.
 */
export function freeName(name: string, taken: readonly string[]): string {
	if (!isNameTaken(taken, name)) return name;
	for (let index = 2; ; index += 1) {
		const candidate = `${name} ${index}`;
		if (!isNameTaken(taken, candidate)) return candidate;
	}
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
