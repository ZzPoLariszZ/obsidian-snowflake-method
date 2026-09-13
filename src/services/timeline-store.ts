import {
	freshTimelineDocument,
	readTimelineDocument,
	serializeTimelineDocument,
	type TimelineDocument,
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
 * The timeline file: every timeline the author laid out for a project and
 * every view over them, one shared JSON document kept by the document store
 * (`json-document-store.ts`). The document is read leniently: a timeline or
 * a view this build can read is served even where one of its rows or
 * placements is not, and an entry that will not read at all -- or one
 * wearing an id an earlier entry took -- is set aside as a stray and carried
 * through every write as it came.
 *
 * Its schema line is its own, apart from the task file's and the rest, so
 * any of them can move without the others.
 */

export const TIMELINE_STORE_SCHEMA_VERSION = 1;
export const TIMELINE_FILE_NAME = "timeline.json";

/** The folder tails the timeline file's path ends in, one per project language. */
const TIMELINE_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.timeline}`,
);

/**
 * Whether a path is some project's timeline file: the whole visualization
 * chain has to end the folder and the name has to be the file's own, so a
 * file of the same name elsewhere is an ordinary file. Asked of every vault
 * event, so it reads the path and nothing else; the caller has already
 * checked the path belongs to a project.
 */
export function isTimelineFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (path.slice(slash + 1) !== TIMELINE_FILE_NAME) return false;
	const folder = path.slice(0, slash);
	return TIMELINE_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

export class TimelineStore {
	private readonly store: JsonDocumentStore<TimelineDocument>;

	constructor(deps: JsonDocumentStoreDeps) {
		this.store = new JsonDocumentStore<TimelineDocument>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.timeline}/${TIMELINE_FILE_NAME}`;
				},
				schemaVersion: TIMELINE_STORE_SCHEMA_VERSION,
				empty: (project) => freshTimelineDocument(project.locale),
				readDocument: readTimelineDocument,
				writeDocument: serializeTimelineDocument,
			},
			deps,
		);
	}

	timelinePath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's timelines and views, read once per file version; shared, so never mutated. */
	readDocument(project: ProjectRef): Promise<TimelineDocument> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateDocument(
		project: ProjectRef,
		mutate: (held: TimelineDocument) => TimelineDocument | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
