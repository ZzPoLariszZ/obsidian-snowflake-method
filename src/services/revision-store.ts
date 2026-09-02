import { isRevision, type Revision } from "../domain";
import type { VaultRepository } from "../repository";
import {
	createOrUpdatePlainFile,
	fileStamp,
	parseJsonObject,
	quarantineJsonFile,
} from "./json-store";
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
 * one must not answer by quarantining every proposal the newer one holds. The
 * same care goes down to the single entry: one this build cannot read is
 * carried through every write as it was found, where the ignores would let
 * it go.
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
	/**
	 * Reads under way, by project root. Every stream and every dashboard asks
	 * in the same tick after a mutation empties the memo, and each would
	 * otherwise read and parse the same file; the first read answers them all.
	 */
	private readonly pending = new Map<string, Promise<readonly Revision[]>>();

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
		const stamp = fileStamp(file);
		const kept = this.memo.get(project.rootPath);
		if (kept !== undefined && kept.stamp === stamp) return kept.revisions;
		const underway = this.pending.get(project.rootPath);
		if (underway !== undefined) return underway;
		const reading = (async (): Promise<readonly Revision[]> => {
			const content = await this.deps.repository.readPlainFile(path);
			const read = parseRevisionFile(content);
			if (read.state === 'foreign') {
				this.memo.set(project.rootPath, { stamp, revisions: [] });
				this.deps.onForeign?.(path, read.version);
				return [];
			}
			if (read.state === 'unreadable') {
				await this.quarantine(path);
				this.memo.delete(project.rootPath);
				return [];
			}
			this.memo.set(project.rootPath, { stamp, revisions: read.revisions });
			return read.revisions;
		})();
		this.pending.set(project.rootPath, reading);
		try {
			return await reading;
		} finally {
			this.pending.delete(project.rootPath);
		}
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
		const serialize = (revisions: unknown[]): string =>
			`${JSON.stringify(
				{ schemaVersion: REVISION_STORE_SCHEMA_VERSION, revisions },
				null,
				"\t",
			)}\n`;
		if (this.deps.repository.getFile(path) === null) {
			const next = mutate([]);
			if (next === null) return false;
			await createOrUpdatePlainFile(
				this.deps.repository,
				path,
				serialize(next),
			);
			this.memo.delete(project.rootPath);
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
			// The entries this build could not read go back as they came.
			return serialize([...next, ...reading.strays]);
		});
		// The memo is let go only over a write. A mutate that found nothing
		// to change, and a write refused below, both leave the file exactly
		// as the memo describes it -- and a memo dropped anyway costs the next
		// reader a read and a parse of the same bytes, and for a foreign file
		// a second notice about the same version, against the one-per-version
		// promise `readRevisions` makes.
		if (changed) this.memo.delete(project.rootPath);
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
		this.memo.delete(project.rootPath);
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
		const aside = await quarantineJsonFile(
			this.deps.repository,
			this.deps.now,
			path,
		);
		this.deps.onCorrupt?.(aside);
	}
}

/** What a reading of the file came to. */
export type RevisionFileReading =
	| {
			state: "read";
			revisions: Revision[];
			/**
			 * The entries this build could not read as revisions, kept as they
			 * were found. They are not served, but they are not thrown away
			 * either: the next write puts them back exactly, so a record a
			 * sync merge bent out of shape waits for a build that can read it
			 * instead of vanishing under an unrelated save.
			 */
			strays: unknown[];
	  }
	/** Plainly a revision file, and written to a schema this build lacks. */
	| { state: "foreign"; version: number }
	| { state: "unreadable" };

/**
 * Reads a revision file, or says why it could not.
 *
 * The schema line is read before anything else about the shape, because it
 * is what says whose shape to expect. A build that knows more may lay the
 * file out differently, and a shape test made first would call that damage
 * and set the file aside -- the one thing this store promises a synced vault
 * it will never do. A schema from the future is refused, not read; one from
 * the past belongs to a migration, of which there are none yet, so it is
 * damage in the plain sense: nothing ever wrote it.
 *
 * Individual entries that fail the shape are set apart rather than dooming
 * the file, and carried through every write untouched.
 */
function parseRevisionFile(content: string | null): RevisionFileReading {
	const file = parseJsonObject(content);
	if (file === null) return { state: "unreadable" };
	if (typeof file.schemaVersion !== "number") return { state: "unreadable" };
	if (file.schemaVersion > REVISION_STORE_SCHEMA_VERSION) {
		return { state: "foreign", version: file.schemaVersion };
	}
	if (file.schemaVersion < REVISION_STORE_SCHEMA_VERSION) {
		// The migration arm: a file written by an earlier schema is brought
		// up to this one here. Version 1 is the first there has been.
		return { state: "unreadable" };
	}
	if (!Array.isArray(file.revisions)) return { state: "unreadable" };
	const revisions: Revision[] = [];
	const strays: unknown[] = [];
	for (const entry of file.revisions) {
		if (isRevision(entry)) revisions.push(entry);
		else strays.push(entry);
	}
	return { state: "read", revisions, strays };
}
