import { HISTORY_FILE_SUFFIXES } from "../domain";
import { isPathAtOrBelow } from "../project-root";
import { PROJECT_PATH_LAYOUTS } from "./types";

/**
 * The modification history's files on disk: where a project's folder of
 * them stands under either language's layout, and which paths are the
 * plugin's own records there. The records themselves are read and written
 * by the history services; this is the part every vault event is asked.
 */

/** The folder tails the history folder's path ends in, one per project language. */
const HISTORY_FOLDER_TAILS = Object.values(PROJECT_PATH_LAYOUTS).map(
	(layout) => `/${layout.directories.modificationHistory}`,
);

const YEAR_FOLDER = /^\d{4}$/u;

/**
 * Whether a path is one of some project's modification history files: a
 * snapshot or event file with a device's own name, under a year folder,
 * under the whole history chain, so a file of the same name elsewhere is
 * an ordinary file, and so is one set aside as corrupt. Asked of every
 * vault event, so it reads the path and nothing else; the caller has
 * already checked the path belongs to a project.
 */
export function isModificationHistoryPath(path: string): boolean {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return false;
	const name = path.slice(slash + 1);
	const isRecord = HISTORY_FILE_SUFFIXES.some(
		(suffix) => name.length > suffix.length && name.endsWith(suffix),
	);
	if (!isRecord) return false;
	const yearFolder = path.slice(0, slash);
	const yearSlash = yearFolder.lastIndexOf("/");
	if (yearSlash <= 0) return false;
	if (!YEAR_FOLDER.test(yearFolder.slice(yearSlash + 1))) return false;
	const folder = yearFolder.slice(0, yearSlash);
	return HISTORY_FOLDER_TAILS.some((tail) => folder.endsWith(tail));
}

/** The first folder of every directory either layout lays out, by which a path from an older root is found again. */
const TOP_LEVEL_FOLDERS: ReadonlySet<string> = new Set(
	Object.values(PROJECT_PATH_LAYOUTS).flatMap((layout) =>
		Object.values(layout.directories).map((directory) => directory.split("/")[0] ?? directory),
	),
);

/**
 * A vault path as the history stores one: under the project's root. A
 * path recorded under a root the project has since left -- a session's
 * tally from before the folder was renamed -- is found again by the first
 * layout folder it passes through; one that passes through none is no
 * note the history can name, and null. The root itself is no note either.
 */
export function relativizeProjectPath(rootPath: string, path: string): string | null {
	if (rootPath.length > 0 && path !== rootPath && isPathAtOrBelow(path, rootPath)) {
		return path.slice(rootPath.length + 1);
	}
	const segments = path.split("/");
	// The last segment is the file itself: a file named like a folder is not in one.
	for (let i = 0; i < segments.length - 1; i += 1) {
		if (TOP_LEVEL_FOLDERS.has(segments[i] ?? "")) return segments.slice(i).join("/");
	}
	return null;
}
