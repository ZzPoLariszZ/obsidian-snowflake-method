import { HISTORY_FILE_SUFFIXES } from "../domain";
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
