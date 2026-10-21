import { describe, expect, it } from 'vitest';

import {
	EVENT_FILE_SUFFIX,
	SNAPSHOT_FILE_SUFFIX,
	historyFilePath,
	historyFolder,
	historyYearFolder,
} from '../../src/domain';

const root = 'Snowflake Projects/Novel';
const dir = '70_Tool/71_Data_Statistics/714_Modification_History';
// 2026-10-21 03:00 UTC.
const T0 = Date.UTC(2026, 9, 21, 3);

describe('where the modification history is filed', () => {
	it('keeps every year under the history folder, with or without a root', () => {
		expect(historyFolder(root, dir)).toBe(`${root}/${dir}`);
		expect(historyFolder('', dir)).toBe(dir);
		expect(historyYearFolder(root, dir, '2026')).toBe(`${root}/${dir}/2026`);
		expect(historyYearFolder('', dir, '2026')).toBe(`${dir}/2026`);
	});

	it('names a file with the year, the month, the device and the record kind', () => {
		expect(historyFilePath(root, dir, T0, 'UTC', 'device-1', SNAPSHOT_FILE_SUFFIX)).toBe(
			`${root}/${dir}/2026/2026_10_device-1_note_snapshots.json`,
		);
		expect(historyFilePath('', dir, T0, 'UTC', 'device-1', EVENT_FILE_SUFFIX)).toBe(
			`${dir}/2026/2026_10_device-1_history_events.json`,
		);
	});

	it('files the month by the day in the device zone', () => {
		// 2026-10-31 20:00 UTC is already November in Shanghai.
		const late = Date.UTC(2026, 9, 31, 20);
		expect(historyFilePath(root, dir, late, 'UTC', 'd', SNAPSHOT_FILE_SUFFIX)).toContain(
			'/2026/2026_10_d_',
		);
		expect(
			historyFilePath(root, dir, late, 'Asia/Shanghai', 'd', SNAPSHOT_FILE_SUFFIX),
		).toContain('/2026/2026_11_d_');
		// And the year folder turns with the month.
		const eve = Date.UTC(2026, 11, 31, 20);
		expect(historyFilePath(root, dir, eve, 'Asia/Shanghai', 'd', EVENT_FILE_SUFFIX)).toBe(
			`${root}/${dir}/2027/2027_01_d_history_events.json`,
		);
	});
});
