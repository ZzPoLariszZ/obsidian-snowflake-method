import { isRevision, type Revision } from "../domain";
import type { VaultRepository } from "../repository";
import { getProjectPathLayout, type ProjectRef } from "./types";

/**
 * The revision file: proposed manuscript changes, written the way the mention
 * ignores are written and for the same reason -- user data. One shared JSON
 * file per project that travels with the vault, atomic full rewrites through
 * read-modify-write, a stamp-memoized read, and a file that will not parse
 * set aside whole rather than destroyed. Two devices writing at once meet as
 * whole files and the later write wins, as the ignores do.
 *
 * Its schema line is its own: the mention constant guards the ignores'
 * quarantine and must never move because this format did.
 */

export const REVISION_STORE_SCHEMA_VERSION = 1;

export interface RevisionFile {
	schemaVersion: number;
	revisions: Revision[];
}

export interface RevisionStoreDeps {
	repository: VaultRepository;
	now: () => number;
	/** Told when a corrupt file was set aside, for a notice upstream. */
	onCorrupt?: (path: string) => void;
}

export class RevisionStore {
	/** Revisions by project root, valid only while the file's stamp holds. */
	private readonly memo = new Map<
		string,
		{ stamp: string; revisions: readonly Revision[] }
	>();

	constructor(private readonly deps: RevisionStoreDeps) {}

	revisionsPath(project: ProjectRef): string {
		const layout = getProjectPathLayout(project.locale);
		return `${project.rootPath}/${layout.directories.revisions}/revisions.json`;
	}

	/**
	 * The project's revisions, read once per file version: a stamp match
	 * answers from memory, anything else re-reads. A file that will not
	 * parse is quarantined and read as empty; a missing file is simply no
	 * revisions yet.
	 */
	async readRevisions(project: ProjectRef): Promise<readonly Revision[]> {
		const path = this.revisionsPath(project);
		const file = this.deps.repository.getFile(path);
		if (file === null) {
			this.memo.delete(project.rootPath);
			return [];
		}
		const stamp = `${String(file.stat.mtime)}:${String(file.stat.size)}`;
		const kept = this.memo.get(project.rootPath);
		if (kept !== undefined && kept.stamp === stamp) return kept.revisions;
		const content = await this.deps.repository.readPlainFile(path);
		const parsed = parseRevisionFile(content);
		if (parsed === null) {
			await this.quarantine(path);
			this.memo.delete(project.rootPath);
			return [];
		}
		this.memo.set(project.rootPath, { stamp, revisions: parsed.revisions });
		return parsed.revisions;
	}

	/**
	 * Read-modify-write with the ignores' quarantine choreography. A first
	 * create builds the folder chain on the way (createPlainFile ensures its
	 * parent), which is what lets a project made before this feature take a
	 * revision without waiting for a repair.
	 */
	async updateRevisions(
		project: ProjectRef,
		mutate: (revisions: readonly Revision[]) => Revision[] | null,
	): Promise<boolean> {
		const path = this.revisionsPath(project);
		this.memo.delete(project.rootPath);
		const serialize = (revisions: Revision[]): string =>
			`${JSON.stringify(
				{ schemaVersion: REVISION_STORE_SCHEMA_VERSION, revisions },
				null,
				"\t",
			)}\n`;
		if (this.deps.repository.getFile(path) === null) {
			const next = mutate([]);
			if (next === null) return false;
			await this.deps.repository.createPlainFile(path, serialize(next));
			return true;
		}
		let corrupt = false;
		let changed = false;
		await this.deps.repository.updatePlainFile(path, (current) => {
			const parsed = parseRevisionFile(current);
			if (parsed === null) {
				corrupt = true;
				return current;
			}
			const next = mutate(parsed.revisions);
			if (next === null) return current;
			changed = true;
			return serialize(next);
		});
		if (!corrupt) return changed;
		await this.quarantine(path);
		const next = mutate([]);
		if (next === null) return false;
		await this.deps.repository.createPlainFile(path, serialize(next));
		return true;
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.memo.delete(rootPath);
	}

	private async quarantine(path: string): Promise<void> {
		const aside = path.replace(
			/\.json$/u,
			`.corrupted-${String(this.deps.now())}.json`,
		);
		await this.deps.repository.renameFile(path, aside);
		this.deps.onCorrupt?.(aside);
	}
}

/**
 * Reads a revision file, or refuses it whole. Individual entries that fail
 * the shape are dropped rather than dooming the file; a schema this build
 * does not know refuses instead, so a downgrade quarantines rather than
 * silently rewriting what a newer build meant.
 */
function parseRevisionFile(content: string | null): RevisionFile | null {
	if (content === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const file = parsed as Record<string, unknown>;
	if (file.schemaVersion !== REVISION_STORE_SCHEMA_VERSION) return null;
	if (!Array.isArray(file.revisions)) return null;
	return {
		schemaVersion: REVISION_STORE_SCHEMA_VERSION,
		revisions: file.revisions.filter(isRevision),
	};
}
