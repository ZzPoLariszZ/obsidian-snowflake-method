import { describe, expect, it } from "vitest";

import {
	EVENT_FILE_SUFFIX,
	SNAPSHOT_FILE_SUFFIX,
	historyFilePath,
} from "../../src/domain";
import { PROJECT_PATH_LAYOUTS, isModificationHistoryPath } from "../../src/services";

const root = "Snowflake Projects/Novel";
const T0 = Date.UTC(2026, 9, 21, 3);

describe("telling the modification history's files from the rest", () => {
	it.each(Object.entries(PROJECT_PATH_LAYOUTS))(
		"knows both record kinds under the %s layout",
		(_locale, layout) => {
			const dir = layout.directories.modificationHistory;
			for (const suffix of [SNAPSHOT_FILE_SUFFIX, EVENT_FILE_SUFFIX] as const) {
				expect(
					isModificationHistoryPath(historyFilePath(root, dir, T0, "UTC", "device-1", suffix)),
				).toBe(true);
			}
		},
	);

	it("wants the whole chain, a year folder and a device's own name", () => {
		const dir = PROJECT_PATH_LAYOUTS.en.directories.modificationHistory;
		const home = `${root}/${dir}/2026`;
		// The session file beside it in the statistics chain.
		expect(
			isModificationHistoryPath(
				`${root}/70_Tool/71_Data_Statistics/711_Writing_Session/2026/2026_10_device-1_writing_session.json`,
			),
		).toBe(false);
		// The same name under only the tail of the chain, or under none of it.
		expect(
			isModificationHistoryPath(`${root}/714_Modification_History/2026/2026_10_device-1_note_snapshots.json`),
		).toBe(false);
		expect(isModificationHistoryPath("2026/2026_10_device-1_note_snapshots.json")).toBe(false);
		// Straight in the history folder, with no year between.
		expect(isModificationHistoryPath(`${root}/${dir}/2026_10_device-1_note_snapshots.json`)).toBe(false);
		// A folder in the year's place that is not a year.
		expect(isModificationHistoryPath(`${root}/${dir}/old/2026_10_device-1_note_snapshots.json`)).toBe(false);
		// A file set aside as corrupt, and a name that is nothing but the suffix.
		expect(isModificationHistoryPath(`${home}/2026_10_device-1_note_snapshots.corrupted-99.json`)).toBe(false);
		expect(isModificationHistoryPath(`${home}/_history_events.json`)).toBe(false);
		// The folders themselves.
		expect(isModificationHistoryPath(home)).toBe(false);
		expect(isModificationHistoryPath(`${root}/${dir}`)).toBe(false);
	});
});
