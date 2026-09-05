import { readForeshadowing, type Foreshadowing } from "../domain";
import { JsonRecordStore, type JsonRecordStoreDeps } from "./json-record-store";
import { getProjectPathLayout, type ProjectRef } from "./types";

/**
 * The foreshadowing file: every thread the author is tracking, with its
 * occurrences inside it, one shared JSON file per project kept by the record
 * store (`json-record-store.ts`). One entry is read leniently: a thread this
 * build can read is served even where one of its occurrences or refs is not,
 * and only a thread that will not read at all is set aside as a stray.
 *
 * Its schema line is its own, apart from the revisions', so either format
 * can move without the other.
 */

export const FORESHADOWING_STORE_SCHEMA_VERSION = 1;

export class ForeshadowingStore {
	private readonly store: JsonRecordStore<Foreshadowing>;

	constructor(deps: JsonRecordStoreDeps) {
		this.store = new JsonRecordStore<Foreshadowing>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.foreshadowing}/foreshadowing.json`;
				},
				schemaVersion: FORESHADOWING_STORE_SCHEMA_VERSION,
				recordsKey: "foreshadowings",
				readRecord: readForeshadowing,
			},
			deps,
		);
	}

	foreshadowingPath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's threads, read once per file version. */
	readForeshadowings(project: ProjectRef): Promise<readonly Foreshadowing[]> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateForeshadowings(
		project: ProjectRef,
		mutate: (items: readonly Foreshadowing[]) => Foreshadowing[] | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
