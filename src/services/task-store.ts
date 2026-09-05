import { readTask, type Task } from "../domain";
import { JsonRecordStore, type JsonRecordStoreDeps } from "./json-record-store";
import {
	PROJECT_PATH_LAYOUTS,
	getProjectPathLayout,
	type ProjectRef,
} from "./types";

/**
 * The task file: every task the author wrote down for a project, one shared
 * JSON file kept by the record store (`json-record-store.ts`) in the order
 * the board shows them. One entry is read leniently: a task this build can
 * read is served even where its priority, its due date or one of its refs
 * is not, and only an entry that will not read at all -- one standing in a
 * column this build has never heard of among them -- is set aside as a
 * stray and carried through every write as it came.
 *
 * Its schema line is its own, apart from the revisions' and the
 * foreshadowing's, so any of the three can move without the others.
 */

export const TASK_STORE_SCHEMA_VERSION = 1;
export const TASK_FILE_NAME = "tasks.json";

/** The folder tails the task file's path ends in, one per project language. */
const TASK_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.tasks}`,
);

/**
 * Whether a path is some project's task file: the whole task-management
 * chain has to end the folder and the name has to be the file's own, so a
 * file of the same name elsewhere is an ordinary file. Asked of every vault
 * event, so it reads the path and nothing else; the caller has already
 * checked the path belongs to a project.
 */
export function isTaskFilePath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	if (path.slice(slash + 1) !== TASK_FILE_NAME) return false;
	const folder = path.slice(0, slash);
	return TASK_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

export class TaskStore {
	private readonly store: JsonRecordStore<Task>;

	constructor(deps: JsonRecordStoreDeps) {
		this.store = new JsonRecordStore<Task>(
			{
				pathOf: (project) => {
					const layout = getProjectPathLayout(project.locale);
					return `${project.rootPath}/${layout.directories.tasks}/${TASK_FILE_NAME}`;
				},
				schemaVersion: TASK_STORE_SCHEMA_VERSION,
				recordsKey: "tasks",
				readRecord: readTask,
			},
			deps,
		);
	}

	tasksPath(project: ProjectRef): string {
		return this.store.path(project);
	}

	/** The project's tasks in the board's order, read once per file version. */
	readTasks(project: ProjectRef): Promise<readonly Task[]> {
		return this.store.read(project);
	}

	/** Read-modify-write; null from `mutate` means nothing to change. */
	updateTasks(
		project: ProjectRef,
		mutate: (tasks: readonly Task[]) => Task[] | null,
	): Promise<boolean> {
		return this.store.update(project, mutate);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}
}
