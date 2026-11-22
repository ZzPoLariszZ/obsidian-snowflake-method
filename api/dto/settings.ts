import type { ManuscriptExportOptions } from '../../src/services';
import type { AuthorSettings, PageSettings } from '../host';
import type { JsonObject } from '../json';
import { countingOf } from './manuscript';
import { quotationMarksOf } from './statistics';

/**
 * The author's settings as the API tells them: the ones that change what
 * it answers, what an export or a session falls back on where a call
 * leaves something out, and how the manuscript's page looks and behaves,
 * which is what the bar over the manuscript sets. Nothing of this device's
 * own is told, and nothing of the API's own access.
 */
function pageOf(page: PageSettings): JsonObject {
	const look = page.appearance;
	return {
		typewriter: page.typewriter,
		focus: page.focus,
		enterParagraph: page.enterParagraph,
		appearance: {
			fontFamily: look.fontFamily,
			fontSize: look.fontSize,
			lineHeight: look.lineHeight,
			contentWidth: look.contentWidth,
			paragraphSpacing: look.paragraphSpacing,
			firstLineIndent: look.firstLineIndent,
			textAlign: look.textAlign,
			hyphenation: look.hyphenation,
			tintLight: look.tintLight,
			tintDark: look.tintDark,
			guide: look.guide,
		},
		marks: {
			mentions: page.marks.mentions,
			sensitiveWords: page.marks.sensitiveWords,
			dialogue: page.marks.dialogue,
			customHighlights: page.marks.customHighlights,
		},
	};
}

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
		page: pageOf(settings.page),
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
