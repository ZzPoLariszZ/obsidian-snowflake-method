import type { VaultRepository } from "../repository";

/**
 * What every JSON file the plugin keeps has in common, stated once: how a
 * file is told apart from its last reading, how one that will not parse is
 * set aside, and how a first write lands when another write may be landing
 * at the same moment. The mention ignores, the revisions and the session
 * records each read and write their own shape over these.
 */

/** A file's version, as the read memos tell one version from the next. */
export function fileStamp(file: {
	stat: { mtime: number; size: number };
}): string {
	return `${String(file.stat.mtime)}:${String(file.stat.size)}`;
}

/** The content as a JSON object, or null for anything else at all. */
export function parseJsonObject(
	content: string | null,
): Record<string, unknown> | null {
	if (content === null) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * Sets a file that will not parse aside whole, under a name that says when,
 * and answers with that name. Nothing is destroyed: the author can open what
 * was set aside and see what it held.
 */
export async function quarantineJsonFile(
	repository: VaultRepository,
	now: () => number,
	path: string,
): Promise<string> {
	const aside = path.replace(/\.json$/u, `.corrupted-${String(now())}.json`);
	await repository.renameFile(path, aside);
	return aside;
}

/**
 * Creates the file, or writes over one that appeared in the meantime. Two
 * writers can race the first-ever create -- a quiet timer against a walk's
 * end, two views saving at once -- and a create that fails while the file
 * now stands falls through to the update instead of failing the write.
 */
export async function createOrUpdatePlainFile(
	repository: VaultRepository,
	path: string,
	content: string,
): Promise<void> {
	if (repository.getFile(path) === null) {
		try {
			await repository.createPlainFile(path, content);
			return;
		} catch (error) {
			if (repository.getFile(path) === null) throw error;
		}
	}
	await repository.updatePlainFile(path, () => content);
}
