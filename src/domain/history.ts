import { calendarDay, monthKeyOfDay } from './calendar';

/**
 * The modification history: what happened to a project's notes, day by day,
 * kept as numbers. Two record kinds, each filed per device and per month as
 * the writing sessions are, so sync never has to merge a file: the versions
 * Obsidian's File recovery kept of a note, reduced to a word count and a
 * fingerprint each, and the events the plugin itself made -- a note
 * created, renamed, deleted or imported, a task, a foreshadowing or a
 * revision changed. The text of a version is never kept.
 */

export const SNAPSHOT_FILE_SUFFIX = '_note_snapshots.json';
export const EVENT_FILE_SUFFIX = '_history_events.json';

/** The two record kinds the history folder holds, by the suffix each file's name ends in. */
export const HISTORY_FILE_SUFFIXES = [SNAPSHOT_FILE_SUFFIX, EVENT_FILE_SUFFIX] as const;

export type HistoryFileSuffix = (typeof HISTORY_FILE_SUFFIXES)[number];

/** The folder every year of a project's history is filed under. */
export function historyFolder(projectRoot: string, historyDir: string): string {
	return projectRoot.length === 0 ? historyDir : `${projectRoot}/${historyDir}`;
}

/** The year folder a month's files stand in, for gathering a whole month. */
export function historyYearFolder(
	projectRoot: string,
	historyDir: string,
	year: string,
): string {
	return `${historyFolder(projectRoot, historyDir)}/${year}`;
}

/**
 * Where one device files one month of one record kind:
 * `<root>/<history dir>/<year>/<year>_<month>_<device><suffix>`. The month
 * is the moment's day in the device's zone, as the sessions file theirs,
 * and the device id keeps two installations from ever appending to the
 * same file; a reader gathers a month by prefix and suffix.
 */
export function historyFilePath(
	projectRoot: string,
	historyDir: string,
	ms: number,
	timeZone: string,
	deviceId: string,
	suffix: HistoryFileSuffix,
): string {
	const { year, month } = monthKeyOfDay(calendarDay(ms, timeZone));
	return `${historyYearFolder(projectRoot, historyDir, year)}/${year}_${month}_${deviceId}${suffix}`;
}
