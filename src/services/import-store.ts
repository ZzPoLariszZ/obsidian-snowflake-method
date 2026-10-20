import {
	emptyImportProvenanceDocument,
	readImportProvenanceDocument,
	serializeImportProvenanceDocument,
	type ImportProvenanceDocument,
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
 * The import provenance file: where a project's imported parts came from,
 * one JSON document kept by the document store (`json-document-store.ts`)
 * beside the visualization files. Its schema line is its own, apart from
 * theirs, so any of them can move without the others.
 */

export const IMPORT_STORE_SCHEMA_VERSION = 1;
export const IMPORT_FILE_NAME = "imports.json";

/** The folder tails the file's path ends in, one per project language. */
const IMPORT_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.imports}`,
);

/**
 * Whether a path is some project's import file: the whole tool chain has
 * to end the folder and the name has to be the file's own, so a file of
 * the same name elsewhere is an ordinary file. Asked of every vault event,
 * so it reads the path and nothing else; the caller has already checked
 * the path belongs to a project.
 */
export function isImportFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (path.slice(slash + 1) !== IMPORT_FILE_NAME) return false;
	const folder = path.slice(0, slash);
	return IMPORT_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

export class ImportStore {
	private readonly store: JsonDocumentStore<ImportProvenanceDocument>;

	constructor(deps: JsonDocumentStoreDeps) {
		this.store = new JsonDocumentStore<ImportProvenanceDocument>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.imports}/${IMPORT_FILE_NAME}`;
				},
				schemaVersion: IMPORT_STORE_SCHEMA_VERSION,
				empty: () => emptyImportProvenanceDocument(),
				readDocument: readImportProvenanceDocument,
				writeDocument: serializeImportProvenanceDocument,
			},
			deps,
		);
	}

	importPath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's document, read once per file version; shared, so never mutated. */
	readDocument(project: ProjectRef): Promise<ImportProvenanceDocument> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateDocument(
		project: ProjectRef,
		mutate: (held: ImportProvenanceDocument) => ImportProvenanceDocument | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
