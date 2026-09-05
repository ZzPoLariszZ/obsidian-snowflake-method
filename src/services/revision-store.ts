import { isRevision, type Revision } from "../domain";
import { JsonRecordStore, type JsonRecordStoreDeps } from "./json-record-store";
import { getProjectPathLayout, type ProjectRef } from "./types";

/**
 * The revision file: proposed manuscript changes, one shared JSON file per
 * project kept by the record store (`json-record-store.ts`), which is where
 * the reading, the quarantine and the refusal of a newer schema are spelled
 * out once for every file of the author's own writing.
 *
 * Its schema line is its own: the mention constant guards the ignores'
 * quarantine, the foreshadowing constant its own file, and neither must move
 * because this format did.
 */

export const REVISION_STORE_SCHEMA_VERSION = 1;

export class RevisionStore {
	private readonly store: JsonRecordStore<Revision>;

	constructor(deps: JsonRecordStoreDeps) {
		this.store = new JsonRecordStore<Revision>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.revisions}/revisions.json`;
				},
				schemaVersion: REVISION_STORE_SCHEMA_VERSION,
				recordsKey: "revisions",
				readRecord: (value) => (isRevision(value) ? value : null),
			},
			deps,
		);
	}

	revisionsPath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's revisions, read once per file version. */
	readRevisions(project: ProjectRef): Promise<readonly Revision[]> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateRevisions(
		project: ProjectRef,
		mutate: (revisions: readonly Revision[]) => Revision[] | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
