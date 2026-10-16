import {
	defaultRelationshipGraphDocument,
	readRelationshipGraphDocument,
	serializeRelationshipGraphDocument,
	type RelationshipGraphDocument,
} from "../domain";
import {
	JsonDocumentStore,
	type JsonDocumentStoreDeps,
} from "./json-document-store";
import {
	PROJECT_PATH_LAYOUTS,
	getProjectPathLayout,
	type ProjectRef,
} from "./types";

/**
 * The relationship graph's file: how a project's two graph views are looked
 * at, one JSON document kept by the document store
 * (`json-document-store.ts`) beside the timeline's and the beat sheet's. Its
 * schema line is its own, apart from theirs, so any of them can move without
 * the others.
 */

export const RELATIONSHIP_GRAPH_STORE_SCHEMA_VERSION = 1;
export const RELATIONSHIP_GRAPH_FILE_NAME = "relationship-graph.json";

/** The folder tails the file's path ends in, one per project language. */
const RELATIONSHIP_GRAPH_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.relationshipGraph}`,
);

/**
 * Whether a path is some project's relationship graph file: the whole
 * visualization chain has to end the folder and the name has to be the
 * file's own, so a file of the same name elsewhere is an ordinary file.
 * Asked of every vault event, so it reads the path and nothing else; the
 * caller has already checked the path belongs to a project.
 */
export function isRelationshipGraphFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (path.slice(slash + 1) !== RELATIONSHIP_GRAPH_FILE_NAME) return false;
	const folder = path.slice(0, slash);
	return RELATIONSHIP_GRAPH_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

export class RelationshipGraphStore {
	private readonly store: JsonDocumentStore<RelationshipGraphDocument>;

	constructor(deps: JsonDocumentStoreDeps) {
		this.store = new JsonDocumentStore<RelationshipGraphDocument>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.relationshipGraph}/${RELATIONSHIP_GRAPH_FILE_NAME}`;
				},
				schemaVersion: RELATIONSHIP_GRAPH_STORE_SCHEMA_VERSION,
				empty: () => defaultRelationshipGraphDocument(),
				readDocument: readRelationshipGraphDocument,
				writeDocument: serializeRelationshipGraphDocument,
			},
			deps,
		);
	}

	relationshipGraphPath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's document, read once per file version; shared, so never mutated. */
	readDocument(project: ProjectRef): Promise<RelationshipGraphDocument> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateDocument(
		project: ProjectRef,
		mutate: (held: RelationshipGraphDocument) => RelationshipGraphDocument | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
