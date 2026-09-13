import type { VaultRepository } from "../repository";
import {
	createOrUpdatePlainFile,
	fileStamp,
	parseJsonObject,
	quarantineJsonFile,
} from "./json-store";
import type { ProjectRef } from "./types";

/**
 * One JSON file the author's work is kept in, per project, the way the
 * mention ignores are kept and for the same reason -- user data. One shared
 * file that travels with the vault, atomic full rewrites through
 * read-modify-write, a stamp-memoized read, and a file that will not parse
 * set aside whole rather than destroyed. Two devices writing at once meet as
 * whole files and the later write wins, as the ignores do.
 *
 * The store knows where a file stands and how to keep it, and nothing about
 * what the file means: a tenant hands in the shape of its document -- where
 * the file is, the schema line it writes, what an empty document is, how a
 * parsed object reads into one and how one is written back. The record
 * stores (`json-record-store.ts`) are one such tenant, laying an array of
 * records over this; the timeline lays a whole document with two collections
 * and a few scalars over the same choreography.
 *
 * One place this parts company with the ignores, because the stakes are not
 * the same. An ignore rule is a preference and can be made again in a moment;
 * a document here is writing the author cannot get back. So a file this build
 * cannot READ is set aside, and a file it can read but was written to a
 * schema it does not KNOW is left exactly where it is -- untouched, unwritten
 * and reported -- rather than renamed aside as damage. On a synced vault the
 * second case is ordinary: one device updates before the other, and the older
 * one must not answer by quarantining everything the newer one holds. What a
 * reader makes of a single entry it cannot read is the reader's own affair:
 * a record store carries such an entry through every write as it was found.
 */

export interface JsonDocumentStoreDeps {
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

/** What one document file is: where it stands, and how a document reads and writes. */
export interface JsonDocumentShape<D> {
	pathOf: (project: ProjectRef) => string;
	/** The schema line this build writes, and refuses to read past. */
	schemaVersion: number;
	/**
	 * What a missing file, a foreign one and a freshly quarantined one read
	 * as, and what the first write mutates from. Called for a fresh value
	 * each time, so a caller may keep what it is handed; told the project,
	 * for a document that starts differently per project.
	 */
	empty: (project: ProjectRef) => D;
	/**
	 * The parsed object read into a document, the schema line already
	 * checked. Null means the object is not this document at all -- damage,
	 * which the store sets aside. Anything the reader can read around, it
	 * should: an entry it cannot read is the reader's to carry, not the
	 * store's to lose.
	 */
	readDocument: (file: Record<string, unknown>) => D | null;
	/** The object written under the schema line; whatever was carried goes back here. */
	writeDocument: (held: D) => Record<string, unknown>;
}

/** What a reading of the file came to. */
type JsonDocumentReading<D> =
	| { state: "read"; held: D }
	/** Plainly a document file, and written to a schema this build lacks. */
	| { state: "foreign"; version: number }
	| { state: "unreadable" };

export class JsonDocumentStore<D> {
	/** The document by project root, valid only while the file's stamp holds. */
	private readonly memo = new Map<string, { stamp: string; held: D }>();
	/**
	 * Reads under way, by project root. Every stream and every dashboard asks
	 * in the same tick after a mutation empties the memo, and each would
	 * otherwise read and parse the same file; the first read answers them all.
	 */
	private readonly pending = new Map<string, Promise<D>>();

	constructor(
		private readonly shape: JsonDocumentShape<D>,
		private readonly deps: JsonDocumentStoreDeps,
	) {}

	path(project: ProjectRef): string {
		return this.shape.pathOf(project);
	}

	/**
	 * The project's document, read once per file version: a stamp match
	 * answers from memory, anything else re-reads. A file that will not parse
	 * is quarantined and read as empty; one written to a schema this build
	 * does not know is read as empty and otherwise left alone; a missing file
	 * is simply an empty document.
	 *
	 * The empty answer for a foreign file is memoized against its stamp like
	 * any other reading, so the notice upstream is given once per version of
	 * the file rather than on every dress. What is memoized is shared by
	 * every reader, so a document is treated as immutable once read.
	 */
	async read(project: ProjectRef): Promise<D> {
		const path = this.path(project);
		const file = this.deps.repository.getFile(path);
		if (file === null) {
			this.memo.delete(project.rootPath);
			return this.shape.empty(project);
		}
		const stamp = fileStamp(file);
		const kept = this.memo.get(project.rootPath);
		if (kept !== undefined && kept.stamp === stamp) return kept.held;
		const underway = this.pending.get(project.rootPath);
		if (underway !== undefined) return underway;
		const reading = (async (): Promise<D> => {
			const content = await this.deps.repository.readPlainFile(path);
			const read = this.parse(content);
			if (read.state === "foreign") {
				const held = this.shape.empty(project);
				this.memo.set(project.rootPath, { stamp, held });
				this.deps.onForeign?.(path, read.version);
				return held;
			}
			if (read.state === "unreadable") {
				await this.quarantine(path);
				this.memo.delete(project.rootPath);
				return this.shape.empty(project);
			}
			this.memo.set(project.rootPath, { stamp, held: read.held });
			return read.held;
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
	 * parent), which is what lets a project made before the feature take a
	 * document without waiting for a repair.
	 */
	async update(
		project: ProjectRef,
		mutate: (held: D) => D | null,
	): Promise<boolean> {
		const path = this.path(project);
		const serialize = (held: D): string =>
			`${JSON.stringify(
				{
					schemaVersion: this.shape.schemaVersion,
					...this.shape.writeDocument(held),
				},
				null,
				"\t",
			)}\n`;
		if (this.deps.repository.getFile(path) === null) {
			const next = mutate(this.shape.empty(project));
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
			const reading = this.parse(current);
			if (reading.state === "foreign") {
				foreign = reading.version;
				return current;
			}
			if (reading.state === "unreadable") {
				corrupt = true;
				return current;
			}
			const next = mutate(reading.held);
			if (next === null) return current;
			changed = true;
			return serialize(next);
		});
		// The memo is let go only over a write. A mutate that found nothing
		// to change, and a write refused below, both leave the file exactly
		// as the memo describes it -- and a memo dropped anyway costs the next
		// reader a read and a parse of the same bytes, and for a foreign file
		// a second notice about the same version, against the one-per-version
		// promise `read` makes.
		if (changed) this.memo.delete(project.rootPath);
		// Refused, not rewritten and not set aside: writing this build's own
		// schema over it would drop everything the newer build understood
		// and this one could not read. The caller answers false, which the
		// card in the margin already knows how to say.
		if (foreign !== null) {
			this.deps.onForeign?.(path, foreign);
			return false;
		}
		if (!corrupt) return changed;
		await this.quarantine(path);
		this.memo.delete(project.rootPath);
		const next = mutate(this.shape.empty(project));
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

	/**
	 * Reads a document file, or says why it could not.
	 *
	 * The schema line is read before anything else about the shape, because
	 * it is what says whose shape to expect. A build that knows more may lay
	 * the file out differently, and a shape test made first would call that
	 * damage and set the file aside -- the one thing this store promises a
	 * synced vault it will never do. A schema from the future is refused, not
	 * read; one from the past belongs to a migration, of which there are none
	 * yet, so it is damage in the plain sense: nothing ever wrote it.
	 */
	private parse(content: string | null): JsonDocumentReading<D> {
		const file = parseJsonObject(content);
		if (file === null) return { state: "unreadable" };
		if (typeof file.schemaVersion !== "number") {
			return { state: "unreadable" };
		}
		if (file.schemaVersion > this.shape.schemaVersion) {
			return { state: "foreign", version: file.schemaVersion };
		}
		if (file.schemaVersion < this.shape.schemaVersion) {
			// The migration arm: a file written by an earlier schema is brought
			// up to this one here. Version 1 is the first there has been.
			return { state: "unreadable" };
		}
		const parsed = this.shape.readDocument(file);
		return parsed === null
			? { state: "unreadable" }
			: { state: "read", held: parsed };
	}
}
