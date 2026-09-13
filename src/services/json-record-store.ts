import {
	JsonDocumentStore,
	type JsonDocumentStoreDeps,
} from "./json-document-store";
import type { ProjectRef } from "./types";

/**
 * One JSON file of records the author wrote, kept per project: an array of
 * entries under one key, laid over the document store
 * (`json-document-store.ts`), which is where the file's keeping is stated --
 * the stamp-memoized read, the atomic rewrite, the quarantine of a file that
 * will not read and the refusal of one written to a newer schema.
 *
 * The revisions, the foreshadowing and the tasks are its tenants, each with
 * a file of its own, a schema line of its own and a reader of its own for
 * one entry. What this layer adds is the care taken with the single entry:
 * one this build cannot read is set apart rather than dooming the file, and
 * carried through every write exactly as it was found, so a record a sync
 * merge bent out of shape waits for a build that can read it instead of
 * vanishing under an unrelated save.
 */

export type JsonRecordStoreDeps = JsonDocumentStoreDeps;

/** What one record file is: where it stands, what it holds, how one entry reads. */
export interface JsonRecordShape<T> {
	pathOf: (project: ProjectRef) => string;
	/** The schema line this build writes, and refuses to read past. */
	schemaVersion: number;
	/** The key the array stands under in the file. */
	recordsKey: string;
	/**
	 * One stored entry read leniently, or null. A reader rather than a guard,
	 * because a record may hold members of its own that this build can read
	 * around: it answers what it could make of the entry.
	 */
	readRecord: (value: unknown) => T | null;
}

/** The records this build could read, and the entries it could not, kept as found. */
interface RecordDocument<T> {
	records: readonly T[];
	strays: readonly unknown[];
}

export class JsonRecordStore<T> {
	private readonly store: JsonDocumentStore<RecordDocument<T>>;

	constructor(shape: JsonRecordShape<T>, deps: JsonRecordStoreDeps) {
		this.store = new JsonDocumentStore<RecordDocument<T>>(
			{
				pathOf: shape.pathOf,
				schemaVersion: shape.schemaVersion,
				empty: () => ({ records: [], strays: [] }),
				readDocument: (file) => {
					const entries = file[shape.recordsKey];
					if (!Array.isArray(entries)) return null;
					const records: T[] = [];
					const strays: unknown[] = [];
					for (const entry of entries) {
						const record = shape.readRecord(entry);
						if (record !== null) records.push(record);
						else strays.push(entry);
					}
					return { records, strays };
				},
				// The entries this build could not read go back as they came.
				writeDocument: (held) => ({
					[shape.recordsKey]: [...held.records, ...held.strays],
				}),
			},
			deps,
		);
	}

	path(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's records, read once per file version; a stray is not served. */
	async read(project: ProjectRef): Promise<readonly T[]> {
		return (await this.store.read(project)).records;
	}

	/** Read-modify-write over the records alone; null from `mutate` means nothing to change. */
	update(
		project: ProjectRef,
		mutate: (records: readonly T[]) => T[] | null,
	): Promise<boolean> {
		return this.store.update(project, (held) => {
			const next = mutate(held.records);
			return next === null ? null : { records: next, strays: held.strays };
		});
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
