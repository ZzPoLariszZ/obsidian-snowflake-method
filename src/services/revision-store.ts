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
 *
 * One place this parts company with the ignores, because the stakes are not
 * the same. An ignore rule is a preference and can be made again in a moment;
 * a revision is writing the author cannot get back. So a file this build
 * cannot READ is set aside, and a file it can read but was written to a
 * schema it does not KNOW is left exactly where it is -- untouched, unwritten
 * and reported -- rather than renamed aside as damage. On a synced vault the
 * second case is ordinary: one device updates before the other, and the older
 * one must not answer by quarantining every proposal the newer one holds.
 */

export const REVISION_STORE_SCHEMA_VERSION = 1;

export interface RevisionStoreDeps {
	repository: VaultRepository;
	now: () => number;
	/** Told when a corrupt file was set aside, for a notice upstream. */
	onCorrupt?: (path: string) => void;
	/**
	 * Told when the file was written by a build that knows a schema this one
	 * does not. Nothing has been touched: the reader is asked to update
	 * rather than told something was lost.
	 */
	onForeign?: (path: string, version: number) => void;
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
	 * answers from memory, anything else re-reads. A file that will not parse
	 * is quarantined and read as empty; one written to a schema this build
	 * does not know is read as empty and otherwise left alone; a missing file
	 * is simply no revisions yet.
	 *
	 * The empty answer for a foreign file is memoized against its stamp like
	 * any other reading, so the notice upstream is given once per version of
	 * the file rather than on every dress.
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
		const reading = parseRevisionFile(content);
		if (reading.state === 'foreign') {
			this.memo.set(project.rootPath, { stamp, revisions: [] });
			this.deps.onForeign?.(path, reading.version);
			return [];
		}
		if (reading.state === 'unreadable') {
			await this.quarantine(path);
			this.memo.delete(project.rootPath);
			return [];
		}
		this.memo.set(project.rootPath, { stamp, revisions: reading.revisions });
		return reading.revisions;
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
		let foreign: number | null = null;
		let changed = false;
		await this.deps.repository.updatePlainFile(path, (current) => {
			const reading = parseRevisionFile(current);
			if (reading.state === 'foreign') {
				foreign = reading.version;
				return current;
			}
			if (reading.state === 'unreadable') {
				corrupt = true;
				return current;
			}
			const next = mutate(reading.revisions);
			if (next === null) return current;
			changed = true;
			return serialize(next);
		});
		// Refused, not rewritten and not set aside: writing this build's own
		// schema over it would drop every proposal the newer build understood
		// and this one could not read. The caller answers false, which the
		// card in the margin already knows how to say.
		if (foreign !== null) {
			this.deps.onForeign?.(path, foreign);
			return false;
		}
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

/** What a reading of the file came to. */
export type RevisionFileReading =
	| { state: "read"; revisions: Revision[] }
	/** Plainly a revision file, and written to a schema this build lacks. */
	| { state: "foreign"; version: number }
	| { state: "unreadable" };

/**
 * Reads a revision file, or says why it could not.
 *
 * Individual entries that fail the shape are dropped rather than dooming the
 * file. A schema line this build does not know is told apart from damage: the
 * file parsed, it says what it is, and the only thing wrong with it is that
 * it was written by a build that knows more. That answer is what keeps a
 * synced vault's older device from setting the newer one's work aside.
 *
 * When the version is one day raised, an OLDER file belongs in a migration
 * arm here rather than in `foreign` -- refusing is the safe answer for a
 * schema from the future, not for one from the past.
 */
function parseRevisionFile(content: string | null): RevisionFileReading {
	if (content === null) return { state: "unreadable" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return { state: "unreadable" };
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { state: "unreadable" };
	}
	const file = parsed as Record<string, unknown>;
	if (!Array.isArray(file.revisions)) return { state: "unreadable" };
	if (typeof file.schemaVersion !== "number") return { state: "unreadable" };
	if (file.schemaVersion !== REVISION_STORE_SCHEMA_VERSION) {
		return { state: "foreign", version: file.schemaVersion };
	}
	return { state: "read", revisions: file.revisions.filter(isRevision) };
}
