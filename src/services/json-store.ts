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

/** What a reader keeps of each file: the stamp it was parsed at, and the parse. */
export type StampedMemo<T> = Map<string, { stamp: string; file: T | null }>;

/**
 * One JSON file parsed once per on-disk state: the stamp is the file's
 * stat, the memo is the caller's, and anything that rewrites a file moves
 * its stat and misses here. One protocol for every record kind that reads
 * a folder of files, so a change to the stamping can never reach one memo
 * and miss another.
 */
export async function readStampedJson<T>(
	repository: VaultRepository,
	memo: StampedMemo<T>,
	file: { path: string; stat: { mtime: number; size: number } },
	parse: (content: string | null) => T | null,
): Promise<T | null> {
	const stamp = fileStamp(file);
	const kept = memo.get(file.path);
	if (kept !== undefined && kept.stamp === stamp) return kept.file;
	const parsed = parse(await repository.readPlainFile(file.path));
	memo.set(file.path, { stamp, file: parsed });
	return parsed;
}

/**
 * One record into its JSON file: created when the file is absent, else
 * parsed, merged and rewritten in one transform. A file that will not
 * parse is never destroyed: it is set aside whole, and a healthy file
 * starts where the next record can land again. One choreography for every
 * append-only record file, quarantine included, so the writers cannot
 * drift. Answers with the path a corrupt file was set aside under, or null
 * when the file was healthy, so the caller can say so in its own voice.
 */
export async function appendJsonRecordFile<T>(
	repository: VaultRepository,
	now: () => number,
	path: string,
	parse: (content: string | null) => T | null,
	serialize: (file: T) => string,
	build: { fresh: () => T; merge: (parsed: T) => T },
): Promise<{ aside: string | null }> {
	if (repository.getFile(path) === null) {
		await repository.createPlainFile(path, serialize(build.fresh()));
		return { aside: null };
	}
	let corrupt = false;
	await repository.updatePlainFile(path, (current) => {
		const parsed = parse(current);
		if (parsed === null) {
			corrupt = true;
			return current;
		}
		return serialize(build.merge(parsed));
	});
	if (!corrupt) return { aside: null };
	const aside = await quarantineJsonFile(repository, now, path);
	await repository.createPlainFile(path, serialize(build.fresh()));
	return { aside };
}
