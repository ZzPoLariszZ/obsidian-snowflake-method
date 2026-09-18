import {
	emptyBeatSheetDocument,
	readBeatSheetDocument,
	serializeBeatSheetDocument,
	type BeatSheetDocument,
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
 * The beat sheet file: every sheet the author laid out for a project and
 * every template they saved from one, one shared JSON document kept by the
 * document store (`json-document-store.ts`) as the timeline's is. The
 * document is read leniently: a sheet this build can read is served even
 * where one of its acts, beats or rows is not, and an entry that will not
 * read at all -- or one wearing an id an earlier entry took -- is set aside
 * as a stray and carried through every write as it came.
 *
 * Its schema line is its own, apart from the timeline's and the rest, so any
 * of them can move without the others.
 */

export const BEAT_SHEET_STORE_SCHEMA_VERSION = 1;
export const BEAT_SHEET_FILE_NAME = "beat-sheet.json";

/** The folder tails the beat sheet file's path ends in, one per project language. */
const BEAT_SHEET_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.beatSheet}`,
);

/**
 * Whether a path is some project's beat sheet file: the whole visualization
 * chain has to end the folder and the name has to be the file's own, so a
 * file of the same name elsewhere, and a copy set aside as damaged, is an
 * ordinary file. Asked of every vault event, so it reads the path and
 * nothing else; the caller has already checked the path belongs to a project.
 */
export function isBeatSheetFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (path.slice(slash + 1) !== BEAT_SHEET_FILE_NAME) return false;
	const folder = path.slice(0, slash);
	return BEAT_SHEET_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

export class BeatSheetStore {
	private readonly store: JsonDocumentStore<BeatSheetDocument>;

	constructor(deps: JsonDocumentStoreDeps) {
		this.store = new JsonDocumentStore<BeatSheetDocument>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.beatSheet}/${BEAT_SHEET_FILE_NAME}`;
				},
				schemaVersion: BEAT_SHEET_STORE_SCHEMA_VERSION,
				empty: () => emptyBeatSheetDocument(),
				readDocument: readBeatSheetDocument,
				writeDocument: serializeBeatSheetDocument,
			},
			deps,
		);
	}

	beatSheetPath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's sheets and templates, read once per file version; shared, so never mutated. */
	readDocument(project: ProjectRef): Promise<BeatSheetDocument> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateDocument(
		project: ProjectRef,
		mutate: (held: BeatSheetDocument) => BeatSheetDocument | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
