import type { ManuscriptExportOptions } from '../../src/services';
import type { AuthorSettings } from '../host';
import type { JsonObject } from '../json';
import { countingOf } from './manuscript';
import { quotationMarksOf } from './statistics';

/**
 * The author's settings as the API tells them: the ones that change what
 * it answers, and what an export or a session falls back on where a call
 * leaves something out. Nothing of how the plugin looks is told, nothing of
 * this device's own, and nothing of the API's own access.
 */
export function settingsOf(settings: AuthorSettings, exporting: ManuscriptExportOptions): JsonObject {
	return {
		counting: countingOf(settings.counting),
		chapterNumbering: { style: settings.chapterNumbering },
		dailyGoals: { project: settings.dailyGoals.project, manuscript: settings.dailyGoals.manuscript, scope: settings.dailyGoals.scope },
		sessionScope: settings.sessionScope,
		session: {
			type: settings.session.type,
			writingMode: settings.session.writingMode,
			countdownMinutes: settings.session.countdownMinutes,
			pomodoroWorkMinutes: settings.session.pomodoroWorkMinutes,
			pomodoroBreakMinutes: settings.session.pomodoroBreakMinutes,
			pomodoroAutoRepeat: settings.session.pomodoroAutoRepeat,
		},
		dialogueMarks: settings.dialogueMarks.map(quotationMarksOf),
		sensitiveWords: [...settings.sensitiveWords],
		export: {
			folder: exporting.folder,
			format: exporting.format,
			layout: exporting.layout,
			separator: exporting.separator,
			indent: exporting.indent,
			paragraphSpacing: exporting.paragraphSpacing,
		},
	};
}
