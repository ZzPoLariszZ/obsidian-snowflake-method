import {
	EVENT_FILE_SUFFIX,
	HISTORY_FILE_SUFFIXES,
	SNAPSHOT_FILE_SUFFIX,
	addMonths,
	historyFolder,
	historyYearFolder,
	monthsBetween,
	parseHistoryEventMonthFile,
	parseNoteSnapshotMonthFile,
	type HistoryEventMonthFile,
	type HistoryEventSource,
	type HistorySnapshotSource,
	type NoteSnapshotMonthFile,
} from "../domain";
import { pathUnderRoot } from "../project-root";
import type { VaultRepository } from "../repository";
import { fileStamp, parseJsonObject, readStampedJson, type StampedMemo } from "./json-store";
import { PROJECT_PATH_LAYOUTS, getProjectPathLayout, type ProjectRef } from "./types";

/**
 * The modification history's files on disk: where a project's folder of
 * them stands under either language's layout, which paths are the
 * plugin's own records there, and one reading of every file a span needs.
 * The records themselves are written by the history services; this is the
 * part every vault event is asked, and the part every reading begins with.
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
	const under = pathUnderRoot(path, rootPath);
	if (under !== null) return under;
	const segments = path.split("/");
	// The last segment is the file itself: a file named like a folder is not in one.
	for (let i = 0; i < segments.length - 1; i += 1) {
		if (TOP_LEVEL_FOLDERS.has(segments[i] ?? "")) return segments.slice(i).join("/");
	}
	return null;
}

// --- reading a span's files -------------------------------------------------

/** What one reading of a project's history files found, and when it must be read again. */
export interface HistoryFiles {
	snapshots: HistorySnapshotSource[];
	events: HistoryEventSource[];
	/** Every file read, each with its stat: a different string is a different on-disk state. */
	stamps: string;
}

/** The parsed files kept between readings, one memo per record kind. */
export interface HistoryFileMemos {
	snapshots: StampedMemo<NoteSnapshotMonthFile>;
	events: StampedMemo<HistoryEventMonthFile>;
}

export function createHistoryFileMemos(): HistoryFileMemos {
	return { snapshots: new Map(), events: new Map() };
}

const parseSnapshotFile = (content: string | null): NoteSnapshotMonthFile | null =>
	parseNoteSnapshotMonthFile(parseJsonObject(content));

const parseEventFile = (content: string | null): HistoryEventMonthFile | null =>
	parseHistoryEventMonthFile(parseJsonObject(content));

/** The device a history file is named for: what stands between its year and month and its suffix. */
const deviceOf = (name: string, suffix: string): string =>
	name.slice(0, -suffix.length).replace(/^\d{4}_\d{2}_/u, "");

/**
 * Every device's history files a span reads: the snapshot files of the
 * months around it, since a day's first version is read against the one
 * before it, which may stand in the month before; and every event file
 * there is, since a note's identity follows a chain of renames that may
 * begin anywhere. Each file is parsed once per on-disk state. A file that
 * will not parse is passed over here, and set aside by the writer that
 * next touches it, so a reading never destroys what it cannot read.
 */
export async function gatherHistoryFiles(
	repository: VaultRepository,
	project: ProjectRef,
	from: string,
	through: string,
	memos: HistoryFileMemos,
): Promise<HistoryFiles> {
	const directory = getProjectPathLayout(project.locale).directories.modificationHistory;
	const snapshots: HistorySnapshotSource[] = [];
	const events: HistoryEventSource[] = [];
	const stamps: string[] = [];
	for (const { year, months } of monthsBetween(addMonths(from, -1), addMonths(through, 1))) {
		const folder = historyYearFolder(project.rootPath, directory, year);
		const prefixes = months.map((month) => `${year}_${month}_`);
		for (const file of repository.listDirectFiles(folder)) {
			if (!file.name.endsWith(SNAPSHOT_FILE_SUFFIX)) continue;
			const prefix = prefixes.find((candidate) => file.name.startsWith(candidate));
			if (prefix === undefined) continue;
			stamps.push(`${file.path}@${fileStamp(file)}`);
			const parsed = await readStampedJson(repository, memos.snapshots, file, parseSnapshotFile);
			if (parsed === null) continue;
			snapshots.push({ device: deviceOf(file.name, SNAPSHOT_FILE_SUFFIX), file: parsed });
		}
	}
	for (const file of repository.listFilesBelow(historyFolder(project.rootPath, directory))) {
		if (!file.name.endsWith(EVENT_FILE_SUFFIX) || !isModificationHistoryPath(file.path)) continue;
		stamps.push(`${file.path}@${fileStamp(file)}`);
		const parsed = await readStampedJson(repository, memos.events, file, parseEventFile);
		if (parsed === null) continue;
		events.push({ device: deviceOf(file.name, EVENT_FILE_SUFFIX), events: parsed.events });
	}
	return { snapshots, events, stamps: stamps.join("\n") };
}
