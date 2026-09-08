import {
	App,
	Modal,
	Notice,
	moment,
	normalizePath,
	PluginSettingTab,
	setIcon,
	setTooltip,
	Setting,
	type SettingDefinition,
	type SettingDefinitionItem,
	type ExtraButtonComponent,
	type SliderComponent,
} from 'obsidian';

import type SnowflakeMethodPlugin from './main';
import {
	BAND_SPANS,
	CONTENT_WIDTH_STOPS,
	DATE_FORMATS,
	FIRST_LINE_INDENT_STOPS,
	FONT_SIZE_STOPS,
	LINE_HEIGHT_STOPS,
	DEFAULT_MANUSCRIPT_PRESENTATION,
	DIALOGUE_PRESENTATIONS,
	MENTION_HIGHLIGHT_MODES,
	MANUSCRIPT_TINTS,
	PARAGRAPH_SPACING_STOPS,
	PRESENTATION_THEME_VARS,
	READING_MEASURES,
	TREND_RANGES,
	WEEK_START_DAYS,
	WRITING_MODES,
	SESSION_LIMITS,
	WRITING_SESSION_SCOPES,
	WRITING_SESSION_TYPES,
	clampSessionValue,
	isDateFormat,
	isManuscriptGuide,
	isManuscriptTextAlign,
	isDialoguePresentation,
	newChapterRuleId,
	sanitizeChapterNumberRules,
	isChapterNumberingStyle,
	isExportFormat,
	isExportLayout,
	isExportSeparator,
	isMentionHighlightMode,
	isMilestoneInterval,
	isMilestoneMode,
	newHighlightRuleId,
	rememberFontFamily,
	sanitizeCustomHighlightRules,
	isWeekStartDay,
	isWritingCountHeadings,
	isWritingCountMode,
	sanitizeContentWidth,
	sanitizeFirstLineIndent,
	sanitizeFontFamily,
	sanitizeFontSize,
	sanitizeGuide,
	sanitizeHyphenation,
	sanitizeLineHeight,
	sanitizeParagraphSpacing,
	sanitizeRecentFonts,
	sanitizeTextAlign,
	sanitizeTint,
	weekdayLabels,
	type BandSpan,
	type CustomHighlightRule,
	type DateFormat,
	type DialoguePresentation,
	type ManuscriptGuide,
	type ManuscriptTextAlign,
	type ManuscriptTint,
	type ChapterNumberingStyle,
	type ChapterNumberRule,
	type ExportFormat,
	type ExportLayout,
	type ExportSeparator,
	type MentionHighlightMode,
	type MilestoneMode,
	type ReadingMeasure,
	type ManuscriptPresentation,
	type WeekStartDay,
	type WritingCountHeadings,
	type WritingCountMode,
	type WritingMode,
	type SessionLimit,
	type WritingSessionScope,
	type WritingSessionType,
} from './domain';
import {
	resolveGlobalLocale,
	t as translate,
	type UiLocalePreference,
} from './i18n';
import {
	displayProjectRoot,
	isValidProjectRoot,
	normalizeProjectRoot,
} from './project-root';
import { wireCardDrag } from './ui/entity-form';
import {
	addFontFamilyPicker,
	addStopSlider,
	addTintSwatches,
} from './ui/presentation-controls';
import {
	buildProjectRootField,
	type ProjectRootField,
} from './ui/project-root-field';

export type { UiLocalePreference } from './i18n';
export type ProjectLocale = 'en' | 'zh-CN';
export type DefaultProjectLocale = 'system' | ProjectLocale;

/**
 * How far focus reaches, each level containing the one before it: `on` fades
 * all but the paragraph being written, `deep` fades the plugin's own
 * dashboards with everything else, and `solo` hides the rest of the app
 * outright while a stream is in front.
 */
export type ManuscriptFocusLevel = 'off' | 'on' | 'deep' | 'solo';

/**
 * What a field does when it is asked for a note the project does not have.
 * `form` opens the note's own form, so everything about it is said at once;
 * `now` makes the note from its name alone and leaves the rest for later,
 * which keeps the author in the form they were already filling in.
 */
export type CreateFromFieldMode = 'form' | 'now';

export interface SnowflakeSettings {
	settingsSchemaVersion: 6;
	projectRoot: string;
	uiLocale: UiLocalePreference;
	defaultProjectLocale: DefaultProjectLocale;
	/**
	 * The dashboard with the ten steps set aside: no progress or step list,
	 * characters and scenes standing with the worldbuilding kinds. Purely a
	 * way of looking — notes, statuses, and structure stay as they are.
	 */
	freeformMode: boolean;
	/**
	 * Which convention the writing count follows. An author counts by
	 * whichever one the place they write for counts by, and the places do not
	 * agree: Jinjiang counts characters where the rest count words.
	 */
	writingCountMode: WritingCountMode;
	/**
	 * What headings are worth to the writing count. A note's own name stands
	 * at the top of it as a first-level heading, written by the plugin rather
	 * than by the author, which is why passing over that one alone is offered
	 * apart from passing over every heading like it.
	 */
	writingCountHeadings: WritingCountHeadings;
	openLongTextInSplit: boolean;
	protectManagedBoundaries: boolean;
	reduceMotion: boolean;
	/**
	 * How far along each member note is, written under its name in the tables.
	 * Off unless it is asked for: it is a line on every row of every table, and
	 * the note's own form is where it is set and read.
	 */
	showTableProgressStatus: boolean;
	/** Whether the task board shows the cards it derives from the other modules. */
	showDerivedTasks: boolean;
	/**
	 * Whether a table gives its rows' actions a column of buttons. Off, they sit
	 * behind one menu at the end of the row, which hands the widest column back
	 * to what the row is about.
	 */
	showTableActionsColumn: boolean;
	/** What a picker does when asked for a note that does not exist yet. */
	createFromField: CreateFromFieldMode;
	/** Manuscript notes kept loaded on each side of the one being read. */
	manuscriptWindow: number;
	showManuscriptPath: boolean;
	showManuscriptSequence: boolean;
	/** Word milestones drawn in the margin beside the rows the count reaches. */
	manuscriptMilestones: boolean;
	/** Whether the count runs on through the manuscript or restarts per note. */
	manuscriptMilestoneMode: MilestoneMode;
	/** Units of the writing count between one milestone and the next. */
	manuscriptMilestoneInterval: number;
	/** How a new manuscript note is offered its number, if at all. */
	manuscriptChapterNumbering: ChapterNumberingStyle;
	/** The custom rules, of which one runs at a time; read when the style is custom. */
	manuscriptChapterNumberRules: ChapterNumberRule[];
	/** The Vault folder exports go under; empty for the folder beside the projects. */
	exportFolder: string;
	exportFormat: ExportFormat;
	/** Begin every exported paragraph with the manuscript's indent. */
	exportIndent: boolean;
	/** Keep the blank lines between exported paragraphs as written. */
	exportParagraphSpacing: boolean;
	/** The whole manuscript as one file, or one file per note in a folder. */
	exportManuscriptLayout: ExportLayout;
	/** What stands between two notes in a single exported file. */
	exportChapterSeparator: ExportSeparator;
	/** The line being written held at the middle of the page. */
	manuscriptTypewriter: boolean;
	manuscriptFocusLevel: ManuscriptFocusLevel;
	/** Which entity mentions the stream marks where they stand in the prose. */
	manuscriptMentionHighlight: MentionHighlightMode;
	/** Brackets and quotes close themselves in the manuscript editor. */
	manuscriptAutoPairBrackets: boolean;
	/** Emphasis markers close themselves in the manuscript editor. */
	manuscriptAutoPairMarkdown: boolean;
	/** Enter puts the paragraph break Markdown needs; Shift+Enter the plain break. */
	manuscriptEnterParagraph: boolean;
	/** The manuscript's typeface as typed; empty for the theme's text font. */
	manuscriptFontFamily: string;
	/** The faces most recently set, newest first, for the top of the picker. */
	manuscriptRecentFonts: string[];
	/** Pixels; 0 for the theme's text size. */
	manuscriptFontSize: number;
	/** Unitless; 0 for the theme's line height. */
	manuscriptLineHeight: number;
	/** Pixels of text column; 0 for the width Obsidian gives a note. */
	manuscriptContentWidth: number;
	/** The gap between paragraphs, in lines; never below a quarter of one. */
	manuscriptParagraphSpacing: number;
	/** How far the first line of a paragraph is set in, in em. */
	manuscriptFirstLineIndent: number;
	/** How paragraphs sit in the column: the theme's ragged right, or justified. */
	manuscriptTextAlign: ManuscriptTextAlign;
	/** Long words broken at line ends with a hyphen, from the browser's dictionary. */
	manuscriptHyphenation: boolean;
	/** The page's color in light mode: '' for the theme's, else #rrggbb. */
	manuscriptTintLight: string;
	/** The page's color in dark mode: '' for the theme's, else #rrggbb. */
	manuscriptTintDark: string;
	/** Lines drawn under the text to write along, if any. */
	manuscriptGuide: ManuscriptGuide;
	/** The master switch over every custom highlight rule at once. */
	customHighlightsEnabled: boolean;
	/**
	 * The custom highlight rules: literal or regular-expression, dress only.
	 * Their matches are transient; the rules are all that persists.
	 */
	customHighlightRules: CustomHighlightRule[];
	/** Dress alone: whether registered sensitive words are marked in the
	 *  manuscript. An empty word list is what turns the counting off. */
	sensitiveHighlight: boolean;
	/** The sensitive words themselves, one term per line. */
	sensitiveWords: string;
	/** Which quote styles open dialogue: “ ”, " ", 「 」, 『 』. All four off
	 *  is what turns dialogue reading off. */
	dialogueQuotesCurly: boolean;
	dialogueQuotesStraight: boolean;
	dialogueQuotesCorner: boolean;
	dialogueQuotesWhite: boolean;
	/** How the stream shows dialogue: not at all, tinted, or all else faded. */
	dialoguePresentation: DialoguePresentation;
	/** Reading speed over space-delimited words, for the statistics. */
	readingWordsPerMinute: number;
	/** Reading speed over CJK characters, for the statistics. */
	readingCjkCharactersPerMinute: number;
	/** The reader's own stopwords for word frequency, free text. */
	customStopwords: string;
	/** Seconds without an edit before a session's focus time turns idle. */
	sessionIdleThresholdSeconds: number;
	sessionCountdownMinutes: number;
	/** The pomodoro work period; shown to the author as its focus time. */
	sessionPomodoroWorkMinutes: number;
	sessionPomodoroBreakMinutes: number;
	sessionPomodoroAutoRepeat: boolean;
	/**
	 * Net words a day is aimed at, one target per scope. Both are kept, and
	 * `sessionDailyGoalScope` says which is the one being aimed at, so switching
	 * what the charts are showing never moves the target.
	 */
	sessionDailyWordGoalProject: number;
	sessionDailyWordGoalManuscript: number;
	/**
	 * Which of the two daily goals is the one being aimed at. Named for the
	 * goal it chooses between rather than for the session: a session has no
	 * goal of its own, and calling this the session's goal scope invited
	 * exactly that reading.
	 */
	sessionDailyGoalScope: WritingSessionScope;
	/** The clock a session starts on from the widget, and from the palette. */
	sessionDefaultType: WritingSessionType;
	/** The stage of the writing a session begins in. */
	sessionWritingMode: WritingMode;
	/**
	 * Which reading of the writing every widget shows. A session records both
	 * the project's words and the manuscript's, so this decides nothing about
	 * what is kept and everything about what is read.
	 */
	sessionScope: WritingSessionScope;
	/** Minutes a stopwatch sitting is aimed at, or 0 for no expectation. */
	sessionStopwatchExpectedMinutes: number;
	/** Focus mode on starts a strict stopwatch session; off ends it. */
	sessionAutoWithFocusMode: boolean;
	/**
	 * Whether writing outside a session is recorded into the daily untimed
	 * record. Time-related metrics stay session-only either way.
	 */
	sessionTrackUntimedWords: boolean;
	/** The day a week is drawn from, which the writing heatmap lays out by. */
	sessionWeekStart: WeekStartDay;
	/** How a day is written wherever the writing statistics name one. */
	sessionDateFormat: DateFormat;
	/** Which stretch the recent-trend chart is looking back over. */
	sessionTrendDays: number;
	/**
	 * What every reading of the writing is measuring: the trend plots it, the
	 * year shades it, the calendar writes it under its dates and the parts of
	 * the day divide it. One number, because asking one of them a question is
	 * asking all of them.
	 */
	sessionReadingMeasure: ReadingMeasure;
	/**
	 * Whether the annual contribution is shading whether the day's goal was
	 * met instead. It is the one reading the others cannot show, so it is the
	 * one that does not travel with them.
	 */
	sessionHeatmapGoal: boolean;
	/** Which sittings the time-of-day reading is drawn from. */
	sessionBandSpan: BandSpan;
	recentProjectPath: string | null;
	recentStep: number;
	certificateCelebrations: Record<string, true>;
	/** The manuscript note last worked in, by project id. */
	recentManuscriptNotes: Record<string, string>;
}

export const DEFAULT_SETTINGS: SnowflakeSettings = {
	settingsSchemaVersion: 6,
	projectRoot: '',
	uiLocale: 'project',
	defaultProjectLocale: 'system',
	freeformMode: false,
	writingCountMode: 'ms-word',
	writingCountHeadings: 'skip-first-h1',
	openLongTextInSplit: true,
	protectManagedBoundaries: true,
	reduceMotion: false,
	showTableProgressStatus: false,
	showDerivedTasks: true,
	showTableActionsColumn: true,
	createFromField: 'form',
	manuscriptWindow: 5,
	showManuscriptPath: true,
	showManuscriptSequence: false,
	manuscriptMilestones: false,
	manuscriptMilestoneMode: 'chapter',
	manuscriptMilestoneInterval: 500,
	manuscriptChapterNumbering: 'off',
	manuscriptChapterNumberRules: [],
	exportFolder: '',
	exportFormat: 'txt',
	exportIndent: true,
	exportParagraphSpacing: false,
	exportManuscriptLayout: 'single',
	exportChapterSeparator: 'blank',
	manuscriptTypewriter: true,
	manuscriptAutoPairBrackets: true,
	manuscriptAutoPairMarkdown: true,
	manuscriptEnterParagraph: true,
	manuscriptFocusLevel: 'off',
	manuscriptMentionHighlight: 'off',
	// Read from the dress rather than written out again. These eleven had been
	// a second copy of `DEFAULT_MANUSCRIPT_PRESENTATION`, kept in step by hand
	// and by nothing else: the sanitizers fall back to the domain's table while
	// a fresh install got this one, so the two disagreeing meant a stored value
	// repaired to a number no new vault would ever be given, and the reset
	// button on a row putting back something the page had never shown.
	manuscriptFontFamily: DEFAULT_MANUSCRIPT_PRESENTATION.fontFamily,
	manuscriptRecentFonts: [],
	manuscriptFontSize: DEFAULT_MANUSCRIPT_PRESENTATION.fontSize,
	manuscriptLineHeight: DEFAULT_MANUSCRIPT_PRESENTATION.lineHeight,
	manuscriptContentWidth: DEFAULT_MANUSCRIPT_PRESENTATION.contentWidth,
	manuscriptParagraphSpacing: DEFAULT_MANUSCRIPT_PRESENTATION.paragraphSpacing,
	manuscriptFirstLineIndent: DEFAULT_MANUSCRIPT_PRESENTATION.firstLineIndent,
	manuscriptTextAlign: DEFAULT_MANUSCRIPT_PRESENTATION.textAlign,
	manuscriptHyphenation: DEFAULT_MANUSCRIPT_PRESENTATION.hyphenation,
	manuscriptTintLight: DEFAULT_MANUSCRIPT_PRESENTATION.tintLight,
	manuscriptTintDark: DEFAULT_MANUSCRIPT_PRESENTATION.tintDark,
	manuscriptGuide: DEFAULT_MANUSCRIPT_PRESENTATION.guide,
	customHighlightsEnabled: true,
	customHighlightRules: [],
	sensitiveHighlight: true,
	sensitiveWords: '',
	dialogueQuotesCurly: true,
	dialogueQuotesStraight: true,
	dialogueQuotesCorner: true,
	dialogueQuotesWhite: true,
	dialoguePresentation: 'off',
	readingWordsPerMinute: 250,
	readingCjkCharactersPerMinute: 400,
	customStopwords: '',
	sessionIdleThresholdSeconds: 60,
	sessionCountdownMinutes: 45,
	sessionPomodoroWorkMinutes: 25,
	sessionPomodoroBreakMinutes: 5,
	sessionPomodoroAutoRepeat: true,
	sessionDailyWordGoalProject: 6000,
	sessionDailyWordGoalManuscript: 4000,
	sessionDailyGoalScope: 'manuscript',
	sessionDefaultType: 'pomodoro',
	sessionWritingMode: 'draft',
	sessionScope: 'project',
	sessionStopwatchExpectedMinutes: 0,
	sessionWeekStart: 'monday',
	sessionDateFormat: 'YYYY/MM/DD',
	sessionTrendDays: 30,
	sessionReadingMeasure: 'net',
	sessionHeatmapGoal: false,
	sessionBandSpan: 'all',
	sessionAutoWithFocusMode: true,
	sessionTrackUntimedWords: true,
	recentProjectPath: null,
	recentStep: 1,
	certificateCelebrations: {},
	recentManuscriptNotes: {},
};

const SETTINGS_KEYS = new Set<keyof SnowflakeSettings>([
	'settingsSchemaVersion',
	'projectRoot',
	'uiLocale',
	'defaultProjectLocale',
	'freeformMode',
	'writingCountMode',
	'writingCountHeadings',
	'openLongTextInSplit',
	'protectManagedBoundaries',
	'reduceMotion',
	'showTableProgressStatus',
	'showDerivedTasks',
	'showTableActionsColumn',
	'createFromField',
	'manuscriptWindow',
	'showManuscriptPath',
	'showManuscriptSequence',
	'manuscriptMilestones',
	'manuscriptMilestoneMode',
	'manuscriptMilestoneInterval',
	'manuscriptChapterNumbering',
	'manuscriptChapterNumberRules',
	'exportFolder',
	'exportFormat',
	'exportIndent',
	'exportParagraphSpacing',
	'exportManuscriptLayout',
	'exportChapterSeparator',
	'manuscriptTypewriter',
	'manuscriptAutoPairBrackets',
	'manuscriptAutoPairMarkdown',
	'manuscriptEnterParagraph',
	'manuscriptFocusLevel',
	'manuscriptMentionHighlight',
	'manuscriptFontFamily',
	'manuscriptRecentFonts',
	'manuscriptFontSize',
	'manuscriptLineHeight',
	'manuscriptContentWidth',
	'manuscriptParagraphSpacing',
	'manuscriptFirstLineIndent',
	'manuscriptTextAlign',
	'manuscriptHyphenation',
	'manuscriptTintLight',
	'manuscriptTintDark',
	'manuscriptGuide',
	'customHighlightsEnabled',
	'customHighlightRules',
	'sensitiveHighlight',
	'sensitiveWords',
	'dialogueQuotesCurly',
	'dialogueQuotesStraight',
	'dialogueQuotesCorner',
	'dialogueQuotesWhite',
	'dialoguePresentation',
	'readingWordsPerMinute',
	'readingCjkCharactersPerMinute',
	'customStopwords',
	'sessionIdleThresholdSeconds',
	'sessionCountdownMinutes',
	'sessionPomodoroWorkMinutes',
	'sessionPomodoroBreakMinutes',
	'sessionPomodoroAutoRepeat',
	'sessionDailyWordGoalProject',
	'sessionDailyWordGoalManuscript',
	'sessionDailyGoalScope',
	'sessionDefaultType',
	'sessionWritingMode',
	'sessionScope',
	'sessionStopwatchExpectedMinutes',
	'sessionAutoWithFocusMode',
	'sessionTrackUntimedWords',
	'sessionWeekStart',
	'sessionDateFormat',
	'sessionTrendDays',
	'sessionReadingMeasure',
	'sessionHeatmapGoal',
	'sessionBandSpan',
	'recentProjectPath',
	'recentStep',
	'certificateCelebrations',
	'recentManuscriptNotes',
]);

/**
 * The keys that dress the manuscript page. A change to one reaches every open
 * stream at once, as variables on the page, and touches nothing else -- no
 * count to recompute, no dashboard to redraw -- which is what lets a slider
 * be dragged live.
 */
/**
 * Which setting holds each value of the page's dress.
 *
 * Written as a record over the dress's own fields, so a field added to
 * `ManuscriptPresentation` and forgotten here will not compile. That matters
 * more than it looks: the set below decides which changes reach an open stream
 * at once, and a key missing from it gave a setting that saved perfectly well
 * and never showed up until the view was rebuilt -- with nothing failing to
 * say so.
 */
export const PRESENTATION_SETTINGS_KEYS: Record<
	keyof ManuscriptPresentation,
	keyof SnowflakeSettings
> = {
	fontFamily: 'manuscriptFontFamily',
	fontSize: 'manuscriptFontSize',
	lineHeight: 'manuscriptLineHeight',
	contentWidth: 'manuscriptContentWidth',
	paragraphSpacing: 'manuscriptParagraphSpacing',
	firstLineIndent: 'manuscriptFirstLineIndent',
	textAlign: 'manuscriptTextAlign',
	hyphenation: 'manuscriptHyphenation',
	tintLight: 'manuscriptTintLight',
	tintDark: 'manuscriptTintDark',
	guide: 'manuscriptGuide',
};

const MANUSCRIPT_PRESENTATION_KEYS = new Set<keyof SnowflakeSettings>(
	Object.values(PRESENTATION_SETTINGS_KEYS),
);

export function isManuscriptPresentationKey(key: string): boolean {
	return MANUSCRIPT_PRESENTATION_KEYS.has(key as keyof SnowflakeSettings);
}

export function sanitizeSettings(input: unknown): SnowflakeSettings {
	const raw = isRecord(input) ? input : {};
	const projectRoot =
		typeof raw.projectRoot === 'string'
			? normalizeProjectRoot(raw.projectRoot)
			: DEFAULT_SETTINGS.projectRoot;
	const uiLocale =
		(raw.settingsSchemaVersion === 2 ||
			raw.settingsSchemaVersion === 3 ||
			raw.settingsSchemaVersion === 4 ||
			raw.settingsSchemaVersion === 5 ||
			raw.settingsSchemaVersion === 6) &&
		isUiLocale(raw.uiLocale)
			? raw.uiLocale
			: DEFAULT_SETTINGS.uiLocale;
	const defaultProjectLocale = isDefaultProjectLocale(raw.defaultProjectLocale)
		? raw.defaultProjectLocale
		: DEFAULT_SETTINGS.defaultProjectLocale;
	const recentStep =
		typeof raw.recentStep === 'number' &&
		Number.isInteger(raw.recentStep) &&
		raw.recentStep >= 1 &&
		raw.recentStep <= 10
			? raw.recentStep
			: DEFAULT_SETTINGS.recentStep;
	const certificateCelebrations: Record<string, true> = {};
	if (isRecord(raw.certificateCelebrations)) {
		for (const [projectId, celebrated] of Object.entries(
			raw.certificateCelebrations,
		)) {
			if (projectId.length > 0 && celebrated === true) {
				certificateCelebrations[projectId] = true;
			}
		}
	}

	// Held to a range a window can be drawn from: nothing to hold on a side,
	// and enough to read around a chapter without loading a novel.
	const manuscriptWindow =
		typeof raw.manuscriptWindow === 'number' &&
		Number.isInteger(raw.manuscriptWindow) &&
		raw.manuscriptWindow >= 0 &&
		raw.manuscriptWindow <= 25
			? raw.manuscriptWindow
			: DEFAULT_SETTINGS.manuscriptWindow;

	const recentManuscriptNotes: Record<string, string> = {};
	if (isRecord(raw.recentManuscriptNotes)) {
		for (const [projectId, path] of Object.entries(raw.recentManuscriptNotes)) {
			if (projectId.length > 0 && typeof path === 'string' && path.length > 0) {
				recentManuscriptNotes[projectId] = normalizePath(path);
			}
		}
	}

	return {
		settingsSchemaVersion: 6,
		projectRoot,
		uiLocale,
		defaultProjectLocale,
		freeformMode:
			typeof raw.freeformMode === 'boolean'
				? raw.freeformMode
				: DEFAULT_SETTINGS.freeformMode,
		writingCountMode: isWritingCountMode(raw.writingCountMode)
			? raw.writingCountMode
			: DEFAULT_SETTINGS.writingCountMode,
		writingCountHeadings: isWritingCountHeadings(raw.writingCountHeadings)
			? raw.writingCountHeadings
			: DEFAULT_SETTINGS.writingCountHeadings,
		openLongTextInSplit:
			typeof raw.openLongTextInSplit === 'boolean'
				? raw.openLongTextInSplit
				: DEFAULT_SETTINGS.openLongTextInSplit,
		protectManagedBoundaries:
			typeof raw.protectManagedBoundaries === 'boolean'
				? raw.protectManagedBoundaries
				: DEFAULT_SETTINGS.protectManagedBoundaries,
		reduceMotion:
			typeof raw.reduceMotion === 'boolean'
				? raw.reduceMotion
				: DEFAULT_SETTINGS.reduceMotion,
		showTableProgressStatus:
			typeof raw.showTableProgressStatus === 'boolean'
				? raw.showTableProgressStatus
				: DEFAULT_SETTINGS.showTableProgressStatus,
		showDerivedTasks:
			typeof raw.showDerivedTasks === 'boolean'
				? raw.showDerivedTasks
				: DEFAULT_SETTINGS.showDerivedTasks,
		showTableActionsColumn:
			typeof raw.showTableActionsColumn === 'boolean'
				? raw.showTableActionsColumn
				: DEFAULT_SETTINGS.showTableActionsColumn,
		createFromField: isCreateFromFieldMode(raw.createFromField)
			? raw.createFromField
			: DEFAULT_SETTINGS.createFromField,
		manuscriptWindow,
		showManuscriptPath:
			typeof raw.showManuscriptPath === 'boolean'
				? raw.showManuscriptPath
				: DEFAULT_SETTINGS.showManuscriptPath,
		showManuscriptSequence:
			typeof raw.showManuscriptSequence === 'boolean'
				? raw.showManuscriptSequence
				: DEFAULT_SETTINGS.showManuscriptSequence,
		manuscriptMilestones:
			typeof raw.manuscriptMilestones === 'boolean'
				? raw.manuscriptMilestones
				: DEFAULT_SETTINGS.manuscriptMilestones,
		manuscriptMilestoneMode: isMilestoneMode(raw.manuscriptMilestoneMode)
			? raw.manuscriptMilestoneMode
			: DEFAULT_SETTINGS.manuscriptMilestoneMode,
		manuscriptMilestoneInterval: isMilestoneInterval(
			raw.manuscriptMilestoneInterval,
		)
			? raw.manuscriptMilestoneInterval
			: DEFAULT_SETTINGS.manuscriptMilestoneInterval,
		manuscriptChapterNumbering: isChapterNumberingStyle(
			raw.manuscriptChapterNumbering,
		)
			? raw.manuscriptChapterNumbering
			: DEFAULT_SETTINGS.manuscriptChapterNumbering,
		manuscriptChapterNumberRules: sanitizeChapterNumberRules(
			raw.manuscriptChapterNumberRules,
		),
		exportFolder:
			typeof raw.exportFolder === 'string'
				? normalizeProjectRoot(raw.exportFolder)
				: DEFAULT_SETTINGS.exportFolder,
		exportFormat: isExportFormat(raw.exportFormat)
			? raw.exportFormat
			: DEFAULT_SETTINGS.exportFormat,
		exportIndent:
			typeof raw.exportIndent === 'boolean'
				? raw.exportIndent
				: DEFAULT_SETTINGS.exportIndent,
		exportParagraphSpacing:
			typeof raw.exportParagraphSpacing === 'boolean'
				? raw.exportParagraphSpacing
				: DEFAULT_SETTINGS.exportParagraphSpacing,
		exportManuscriptLayout: isExportLayout(raw.exportManuscriptLayout)
			? raw.exportManuscriptLayout
			: DEFAULT_SETTINGS.exportManuscriptLayout,
		exportChapterSeparator: isExportSeparator(raw.exportChapterSeparator)
			? raw.exportChapterSeparator
			: DEFAULT_SETTINGS.exportChapterSeparator,
		manuscriptTypewriter:
			typeof raw.manuscriptTypewriter === 'boolean'
				? raw.manuscriptTypewriter
				: DEFAULT_SETTINGS.manuscriptTypewriter,
		manuscriptAutoPairBrackets:
			typeof raw.manuscriptAutoPairBrackets === 'boolean'
				? raw.manuscriptAutoPairBrackets
				: DEFAULT_SETTINGS.manuscriptAutoPairBrackets,
		manuscriptAutoPairMarkdown:
			typeof raw.manuscriptAutoPairMarkdown === 'boolean'
				? raw.manuscriptAutoPairMarkdown
				: DEFAULT_SETTINGS.manuscriptAutoPairMarkdown,
		manuscriptEnterParagraph:
			typeof raw.manuscriptEnterParagraph === 'boolean'
				? raw.manuscriptEnterParagraph
				: DEFAULT_SETTINGS.manuscriptEnterParagraph,
		manuscriptFocusLevel: readFocusLevel(raw),
		manuscriptMentionHighlight: isMentionHighlightMode(
			raw.manuscriptMentionHighlight,
		)
			? raw.manuscriptMentionHighlight
			: DEFAULT_SETTINGS.manuscriptMentionHighlight,
		manuscriptFontFamily: sanitizeFontFamily(raw.manuscriptFontFamily),
		manuscriptRecentFonts: sanitizeRecentFonts(raw.manuscriptRecentFonts),
		manuscriptFontSize: sanitizeFontSize(raw.manuscriptFontSize),
		manuscriptLineHeight: sanitizeLineHeight(raw.manuscriptLineHeight),
		manuscriptContentWidth: sanitizeContentWidth(raw.manuscriptContentWidth),
		manuscriptParagraphSpacing: sanitizeParagraphSpacing(
			raw.manuscriptParagraphSpacing,
		),
		manuscriptFirstLineIndent: sanitizeFirstLineIndent(
			raw.manuscriptFirstLineIndent,
		),
		manuscriptTextAlign: sanitizeTextAlign(raw.manuscriptTextAlign),
		manuscriptHyphenation: sanitizeHyphenation(raw.manuscriptHyphenation),
		manuscriptTintLight: sanitizeTint(raw.manuscriptTintLight),
		manuscriptTintDark: sanitizeTint(raw.manuscriptTintDark),
		manuscriptGuide: sanitizeGuide(raw.manuscriptGuide),
		customHighlightsEnabled:
			typeof raw.customHighlightsEnabled === 'boolean'
				? raw.customHighlightsEnabled
				: DEFAULT_SETTINGS.customHighlightsEnabled,
		customHighlightRules: sanitizeCustomHighlightRules(
			raw.customHighlightRules,
		),
		sensitiveHighlight:
			typeof raw.sensitiveHighlight === 'boolean'
				? raw.sensitiveHighlight
				: DEFAULT_SETTINGS.sensitiveHighlight,
		sensitiveWords: boundedText(raw.sensitiveWords),
		dialogueQuotesCurly:
			typeof raw.dialogueQuotesCurly === 'boolean'
				? raw.dialogueQuotesCurly
				: DEFAULT_SETTINGS.dialogueQuotesCurly,
		dialogueQuotesStraight:
			typeof raw.dialogueQuotesStraight === 'boolean'
				? raw.dialogueQuotesStraight
				: DEFAULT_SETTINGS.dialogueQuotesStraight,
		dialogueQuotesCorner:
			typeof raw.dialogueQuotesCorner === 'boolean'
				? raw.dialogueQuotesCorner
				: DEFAULT_SETTINGS.dialogueQuotesCorner,
		dialogueQuotesWhite:
			typeof raw.dialogueQuotesWhite === 'boolean'
				? raw.dialogueQuotesWhite
				: DEFAULT_SETTINGS.dialogueQuotesWhite,
		dialoguePresentation: isDialoguePresentation(raw.dialoguePresentation)
			? raw.dialoguePresentation
			: DEFAULT_SETTINGS.dialoguePresentation,
		readingWordsPerMinute: readingSpeed(
			raw.readingWordsPerMinute,
			DEFAULT_SETTINGS.readingWordsPerMinute,
			2000,
		),
		readingCjkCharactersPerMinute: readingSpeed(
			raw.readingCjkCharactersPerMinute,
			DEFAULT_SETTINGS.readingCjkCharactersPerMinute,
			3000,
		),
		customStopwords: boundedText(raw.customStopwords),
		sessionIdleThresholdSeconds: integerIn(
			raw.sessionIdleThresholdSeconds,
			'idleThresholdSeconds',
			DEFAULT_SETTINGS.sessionIdleThresholdSeconds,
		),
		sessionCountdownMinutes: integerIn(
			raw.sessionCountdownMinutes,
			'countdownMinutes',
			DEFAULT_SETTINGS.sessionCountdownMinutes,
		),
		sessionPomodoroWorkMinutes: integerIn(
			raw.sessionPomodoroWorkMinutes,
			'pomodoroWorkMinutes',
			DEFAULT_SETTINGS.sessionPomodoroWorkMinutes,
		),
		sessionPomodoroBreakMinutes: integerIn(
			raw.sessionPomodoroBreakMinutes,
			'pomodoroBreakMinutes',
			DEFAULT_SETTINGS.sessionPomodoroBreakMinutes,
		),
		sessionPomodoroAutoRepeat:
			typeof raw.sessionPomodoroAutoRepeat === 'boolean'
				? raw.sessionPomodoroAutoRepeat
				: DEFAULT_SETTINGS.sessionPomodoroAutoRepeat,
		sessionDailyWordGoalProject: integerIn(
			raw.sessionDailyWordGoalProject,
			'dailyWordGoal',
			DEFAULT_SETTINGS.sessionDailyWordGoalProject,
		),
		sessionDailyWordGoalManuscript: integerIn(
			raw.sessionDailyWordGoalManuscript,
			'dailyWordGoal',
			DEFAULT_SETTINGS.sessionDailyWordGoalManuscript,
		),
		sessionDailyGoalScope: (WRITING_SESSION_SCOPES as readonly unknown[]).includes(
			raw.sessionDailyGoalScope,
		)
			? (raw.sessionDailyGoalScope as WritingSessionScope)
			: DEFAULT_SETTINGS.sessionDailyGoalScope,
		sessionDefaultType: (WRITING_SESSION_TYPES as readonly unknown[]).includes(
			raw.sessionDefaultType,
		)
			? (raw.sessionDefaultType as WritingSessionType)
			: DEFAULT_SETTINGS.sessionDefaultType,
		// Zero is the way a goal is turned off rather than a goal of nothing,
		// so it is a value the range keeps rather than one it corrects.
		sessionWritingMode: (WRITING_MODES as readonly unknown[]).includes(
			raw.sessionWritingMode,
		)
			? (raw.sessionWritingMode as WritingMode)
			: DEFAULT_SETTINGS.sessionWritingMode,
		sessionStopwatchExpectedMinutes: integerIn(
			raw.sessionStopwatchExpectedMinutes,
			'stopwatchExpectedMinutes',
			DEFAULT_SETTINGS.sessionStopwatchExpectedMinutes,
		),
		sessionScope: (WRITING_SESSION_SCOPES as readonly unknown[]).includes(
			raw.sessionScope,
		)
			? (raw.sessionScope as WritingSessionScope)
			: DEFAULT_SETTINGS.sessionScope,
		sessionAutoWithFocusMode:
			typeof raw.sessionAutoWithFocusMode === 'boolean'
				? raw.sessionAutoWithFocusMode
				: DEFAULT_SETTINGS.sessionAutoWithFocusMode,
		sessionTrackUntimedWords:
			typeof raw.sessionTrackUntimedWords === 'boolean'
				? raw.sessionTrackUntimedWords
				: DEFAULT_SETTINGS.sessionTrackUntimedWords,
		sessionWeekStart: isWeekStartDay(raw.sessionWeekStart)
			? raw.sessionWeekStart
			: DEFAULT_SETTINGS.sessionWeekStart,
		sessionDateFormat: isDateFormat(raw.sessionDateFormat)
			? raw.sessionDateFormat
			: DEFAULT_SETTINGS.sessionDateFormat,
		// Which readings the statistics were last left on. They are the pane's
		// own memory rather than anything the settings page offers, which is
		// why they have no row: a chart the author chose stays chosen.
		sessionTrendDays: (TREND_RANGES as readonly unknown[]).includes(
			raw.sessionTrendDays,
		)
			? (raw.sessionTrendDays as number)
			: DEFAULT_SETTINGS.sessionTrendDays,
		sessionReadingMeasure: (READING_MEASURES as readonly unknown[]).includes(
			raw.sessionReadingMeasure,
		)
			? (raw.sessionReadingMeasure as ReadingMeasure)
			: DEFAULT_SETTINGS.sessionReadingMeasure,
		sessionHeatmapGoal:
			typeof raw.sessionHeatmapGoal === 'boolean'
				? raw.sessionHeatmapGoal
				: DEFAULT_SETTINGS.sessionHeatmapGoal,
		sessionBandSpan: (BAND_SPANS as readonly unknown[]).includes(
			raw.sessionBandSpan,
		)
			? (raw.sessionBandSpan as BandSpan)
			: DEFAULT_SETTINGS.sessionBandSpan,
		recentProjectPath:
			typeof raw.recentProjectPath === 'string'
				? normalizePath(raw.recentProjectPath)
				: null,
		recentStep,
		certificateCelebrations,
		recentManuscriptNotes,
	};
}

export function isCreateFromFieldMode(
	value: unknown,
): value is CreateFromFieldMode {
	return value === 'form' || value === 'now';
}

/**
 * A number held inside the limit the dialogs also enforce: clamped, so a
 * value that worked yesterday never silently becomes the default tomorrow.
 * Only what is not a number at all falls back.
 */
function integerIn(value: unknown, limit: SessionLimit, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? clampSessionValue(limit, value)
		: fallback;
}

/** Free-text list fields held to a size a settings file stays comfortable at. */
const TEXT_SETTING_LIMIT = 20000;

function boundedText(value: unknown): string {
	return typeof value === 'string' ? value.slice(0, TEXT_SETTING_LIMIT) : '';
}

/** A reading speed: clamped like the session numbers, never silently reset. */
function readingSpeed(value: unknown, fallback: number, max: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(max, Math.max(10, Math.round(value)))
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isManuscriptFocusLevel(
	value: unknown,
): value is ManuscriptFocusLevel {
	return (
		value === 'off' || value === 'on' || value === 'deep' || value === 'solo'
	);
}

/**
 * The stored focus level — or, from a file written while focus was three
 * switches, the level those switches added up to.
 */
function readFocusLevel(raw: Record<string, unknown>): ManuscriptFocusLevel {
	if (isManuscriptFocusLevel(raw.manuscriptFocusLevel)) {
		return raw.manuscriptFocusLevel;
	}
	if (raw.manuscriptSolo === true) return 'solo';
	if (raw.manuscriptFocus === true) {
		return raw.manuscriptFocusFadesDashboard === true ? 'deep' : 'on';
	}
	return DEFAULT_SETTINGS.manuscriptFocusLevel;
}

function isUiLocale(value: unknown): value is UiLocalePreference {
	return (
		value === 'project' ||
		value === 'system' ||
		value === 'en' ||
		value === 'zh-CN'
	);
}

function isDefaultProjectLocale(value: unknown): value is DefaultProjectLocale {
	return value === 'system' || value === 'en' || value === 'zh-CN';
}

/**
 * How long the settings page waits before showing a value changed elsewhere.
 * Long enough that a slider dragged in the popover rebuilds this page once at
 * the end rather than at every stop it crosses.
 */
const PRESENTATION_SYNC_MS = 150;

/** Every count the window slider offers, nought to twenty-five: the
 *  typography sliders' own dress, worn by the one behaviour slider. */
const MANUSCRIPT_WINDOW_STOPS: readonly number[] = Array.from(
	{ length: 26 },
	(_, at) => at,
);

/** Every stop the idle slider offers, the session limits walked in
 *  quarter-minute steps -- the typography sliders' dress on session time. */
const SESSION_IDLE_STOPS: readonly number[] = Array.from(
	{
		length:
			(SESSION_LIMITS.idleThresholdSeconds.max -
				SESSION_LIMITS.idleThresholdSeconds.min) /
				15 +
			1,
	},
	(_, at) => SESSION_LIMITS.idleThresholdSeconds.min + at * 15,
);

/** The four families' choices, drafted in a dialog and saved together. */
interface HighlightOptionsDraft {
	entities: MentionHighlightMode;
	sensitive: boolean;
	dialogue: DialoguePresentation;
	custom: boolean;
}

/**
 * One dialog for the whole highlight dress: Entities, Sensitive words,
 * Dialogues and Custom highlight each a dropdown, applied only when Save is
 * pressed -- closing any other way keeps what stood.
 */
class HighlightOptionsModal extends Modal {
	constructor(
		app: App,
		private readonly options: {
			t: (key: string) => string;
			current: HighlightOptionsDraft;
			save: (next: HighlightOptionsDraft) => Promise<void>;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const t = this.options.t;
		// The compact form's own cloth: stacked names in the form's face, no
		// dividers, and every control stretched to one shared width.
		this.modalEl.addClass('snowflake-method-compact-form-modal');
		this.contentEl.addClass('snowflake-method-project-form');
		this.titleEl.setText(t('settings.mentionHighlight.name'));
		const draft: HighlightOptionsDraft = { ...this.options.current };
		const off = t('settings.mentionHighlight.off');
		const on = t('settings.mentionHighlight.on');
		new Setting(this.contentEl)
			.setName(t('settings.mentionHighlight.entities'))
			.addDropdown((dropdown) => {
				for (const mode of MENTION_HIGHLIGHT_MODES) {
					dropdown.addOption(mode, t(`settings.mentionHighlight.${mode}`));
				}
				dropdown.setValue(draft.entities).onChange((value) => {
					draft.entities = value as MentionHighlightMode;
				});
			});
		new Setting(this.contentEl)
			.setName(t('settings.sensitiveWords.heading'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('off', off)
					.addOption('on', on)
					.setValue(draft.sensitive ? 'on' : 'off')
					.onChange((value) => {
						draft.sensitive = value === 'on';
					});
			});
		new Setting(this.contentEl)
			.setName(t('settings.mentionHighlight.dialogues'))
			.addDropdown((dropdown) => {
				for (const mode of DIALOGUE_PRESENTATIONS) {
					dropdown.addOption(
						mode,
						t(`settings.dialoguePresentation.${mode}`),
					);
				}
				dropdown.setValue(draft.dialogue).onChange((value) => {
					draft.dialogue = value as DialoguePresentation;
				});
			});
		new Setting(this.contentEl)
			.setName(t('settings.mentionHighlight.custom'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('off', off)
					.addOption('on', on)
					.setValue(draft.custom ? 'on' : 'off')
					.onChange((value) => {
						draft.custom = value === 'on';
					});
			});
		const actions = this.contentEl.createDiv({
			cls: 'snowflake-method-modal-actions',
		});
		const save = actions.createEl('button', {
			cls: 'mod-cta',
			text: t('common.save'),
			attr: { type: 'button' },
		});
		save.addEventListener('click', () => {
			void this.options
				.save(draft)
				.then(() => {
					this.close();
				})
				.catch(() => {
					// The dialog stays for another try, and says why it is
					// still here rather than swallowing the refusal.
					new Notice(t('settings.mentionHighlight.saveFailed'));
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class SnowflakeSettingTab extends PluginSettingTab {
	private readonly owner: SnowflakeMethodPlugin;
	/** Raised while this page is the one writing, so it does not answer itself. */
	private writing = false;
	private syncTimer: number | null = null;

	constructor(app: App, plugin: SnowflakeMethodPlugin) {
		super(app, plugin);
		this.owner = plugin;
	}

	/**
	 * Told when a value this page shows was changed somewhere else.
	 *
	 * The popover over a manuscript writes the same settings this page does,
	 * and in Obsidian 1.13 the settings open in a window of their own, so both
	 * can be on screen at once. A row left showing the old value is not merely
	 * stale: the next nudge of that slider writes the old value's neighbour,
	 * quietly undoing what was chosen in the popover. The page is rebuilt from
	 * the settings instead, which is the one thing that reaches the declared
	 * rows as well as the drawn ones.
	 *
	 * Not while this page is the one writing, which would rebuild a control
	 * under the hand dragging it, and not once per stop of someone else's drag
	 * either: the last change of a flurry is the one worth showing.
	 */
	refreshPresentationRows(): void {
		if (this.writing) return;
		const win = this.containerEl.win;
		if (this.syncTimer !== null) win.clearTimeout(this.syncTimer);
		this.syncTimer = win.setTimeout(() => {
			this.syncTimer = null;
			this.update();
		}, PRESENTATION_SYNC_MS);
	}

	hide(): void {
		if (this.syncTimer !== null) {
			this.containerEl.win.clearTimeout(this.syncTimer);
			this.syncTimer = null;
		}
		// The scope class rides the settings pane itself, which every tab
		// shares: when another tab takes the pane, the cloth leaves with us
		// rather than dressing whoever renders there next.
		this.containerEl.removeClass('snowflake-method-settings');
		super.hide();
	}

	/**
	 * A description that breaks where its copy breaks. The page renders a
	 * description as text, so a newline in it would otherwise close up into a
	 * space; a fragment carries the break itself, and its text is still what
	 * the settings search reads. Falls back to the copy as written where there
	 * is no document to build one in, which is how the tests read these rows.
	 */
	private lines(key: string): string | DocumentFragment {
		const text = this.t(key);
		if (typeof createFragment === 'undefined') return text;
		return createFragment((fragment) => {
			for (const [at, line] of text.split('\n').entries()) {
				if (at > 0) fragment.createEl('br');
				fragment.appendText(line);
			}
		});
	}

	/** The language this page is written in, which its calendar names follow. */
	private locale(): string {
		return resolveGlobalLocale(this.owner.settings.uiLocale, moment.locale());
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		// This page is global UI, so 'project' falls back to Obsidian's language
		// -- but an explicit English or Chinese choice has to be honoured here,
		// including on the control that sets it.
		return translate(
			resolveGlobalLocale(this.owner.settings.uiLocale, moment.locale()),
			key,
			vars,
		);
	}


	/** Which fold sections stand open: the page rests folded the way the
	 *  dashboard's kind sections do, and a closed section's rows are not
	 *  rendered at all -- the ledger lives for the app session. */
	private readonly openSections = new Set<string>();

	/**
	 * Rides first among every section's items and never shows: its render is
	 * the hook that dresses the section's card -- the group's own heading
	 * turned into the dashboard sections' fold toggle, chevron and all, and
	 * the rows beneath hidden while the section rests closed. One card holds
	 * the heading and its rows, so the fold and what it opens share one
	 * ground. A toggle moves classes alone, never a re-render; an update()
	 * from elsewhere rebuilds the page and this render dresses it again.
	 */
	private sectionDress(key: string): SettingDefinition {
		return {
			name: '',
			render: (setting) => {
				// The scope the fold styling hangs from -- the declarative
				// renderer owns the page, so the class rides the rows in.
				this.containerEl.addClass('snowflake-method-settings');
				const row = setting.settingEl;
				row.addClass('snowflake-method-settings-dress');
				const card = row.closest('.setting-group');
				if (!(card instanceof HTMLElement)) return;
				card.addClass('snowflake-method-settings-section');
				const heading = card.querySelector('.setting-item-heading');
				if (!(heading instanceof HTMLElement)) return;
				const apply = (): void => {
					const open = this.openSections.has(key);
					card.toggleClass('is-collapsed', !open);
					heading.setAttribute('aria-expanded', String(open));
				};
				if (!heading.hasClass('snowflake-method-settings-fold')) {
					heading.addClass('snowflake-method-settings-fold');
					heading.setAttribute('role', 'button');
					heading.setAttribute('tabindex', '0');
					heading.prepend(
						createSpan({
							cls: 'snowflake-method-definition-section-chevron snowflake-method-disclosure-icon',
							attr: { 'aria-hidden': 'true' },
						}),
					);
					const flip = (): void => {
						if (!this.openSections.delete(key)) {
							this.openSections.add(key);
						}
						apply();
					};
					heading.addEventListener('click', flip);
					heading.addEventListener('keydown', (event) => {
						if (event.key !== 'Enter' && event.key !== ' ') return;
						event.preventDefault();
						flip();
					});
				}
				apply();
			},
		};
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: this.t('settings.section.general'),
				items: [
					this.sectionDress('general'),
				{
					name: this.t('settings.projectRoot.name'),
					desc: this.t('settings.projectRoot.desc'),
					// Rendered rather than declared as a `folder` control, so this is
					// the same field the project manager offers — one frame, one list,
					// one set of manners — instead of two controls that merely ask the
					// same question.
					render: (setting) => this.renderProjectRoot(setting),
				},
				{
					name: this.t('settings.uiLocale.name'),
					desc: this.t('settings.uiLocale.desc'),
					control: {
						type: 'dropdown',
						key: 'uiLocale',
						defaultValue: DEFAULT_SETTINGS.uiLocale,
						options: {
							project: this.t('settings.locale.project'),
							system: this.t('settings.locale.system'),
							en: 'English',
							'zh-CN': '简体中文',
						},
					},
				},
				{
					name: this.t('settings.projectLocale.name'),
					desc: this.t('settings.projectLocale.desc'),
					control: {
						type: 'dropdown',
						key: 'defaultProjectLocale',
						defaultValue: DEFAULT_SETTINGS.defaultProjectLocale,
						options: {
							system: this.t('settings.locale.system'),
							en: 'English',
							'zh-CN': '简体中文',
						},
					},
				},
				{
					name: this.t('settings.freeformMode.name'),
					desc: this.lines('settings.freeformMode.desc'),
					control: {
						type: 'toggle',
						key: 'freeformMode',
						defaultValue: DEFAULT_SETTINGS.freeformMode,
					},
				},
					{
						name: this.t('settings.section.display'),
						render: (setting) => {
							setting.setHeading();
						},
					},
				{
					name: this.t('settings.split.name'),
					desc: this.t('settings.split.desc'),
					control: {
						type: 'toggle',
						key: 'openLongTextInSplit',
						defaultValue: DEFAULT_SETTINGS.openLongTextInSplit,
					},
				},
				{
					name: this.t('settings.tableActionsColumn.name'),
					desc: this.lines('settings.tableActionsColumn.desc'),
					control: {
						type: 'toggle',
						key: 'showTableActionsColumn',
						defaultValue: DEFAULT_SETTINGS.showTableActionsColumn,
					},
				},
				{
					name: this.t('settings.tableProgressStatus.name'),
					desc: this.t('settings.tableProgressStatus.desc'),
					control: {
						type: 'toggle',
						key: 'showTableProgressStatus',
						defaultValue: DEFAULT_SETTINGS.showTableProgressStatus,
					},
				},
				{
					name: this.t('settings.reduceMotion.name'),
					desc: this.t('settings.reduceMotion.desc'),
					control: {
						type: 'toggle',
						key: 'reduceMotion',
						defaultValue: DEFAULT_SETTINGS.reduceMotion,
					},
				},
					{
						name: this.t('settings.section.editing'),
						render: (setting) => {
							setting.setHeading();
						},
					},
				{
					name: this.t('settings.createFromField.name'),
					desc: this.t('settings.createFromField.desc'),
					control: {
						type: 'dropdown',
						key: 'createFromField',
						defaultValue: DEFAULT_SETTINGS.createFromField,
						options: {
							form: this.t('settings.createFromField.form'),
							now: this.t('settings.createFromField.now'),
						},
					},
				},
				{
					name: this.t('settings.protectBoundaries.name'),
					desc: this.t('settings.protectBoundaries.desc'),
					control: {
						type: 'toggle',
						key: 'protectManagedBoundaries',
						defaultValue: DEFAULT_SETTINGS.protectManagedBoundaries,
					},
				},
				],
			},
			// Under a heading of their own: three settings that mean nothing to an
			// author who never opens the manuscript, and that would otherwise sit
			// among the ones that govern the whole plugin.
			{
				type: 'group',
				heading: this.t('settings.manuscript.heading'),
				cls: 'snowflake-method-manuscript-settings',
				items: [
					this.sectionDress('manuscript'),
					{
						name: this.t('settings.manuscriptWindow.name'),
						desc: this.t('settings.manuscriptWindow.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'manuscriptWindow',
								MANUSCRIPT_WINDOW_STOPS,
								(value) => String(value),
							),
					},
					{
						name: this.t('settings.manuscriptTypewriter.name'),
						desc: this.t('settings.manuscriptTypewriter.desc'),
						control: {
							type: 'toggle',
							key: 'manuscriptTypewriter',
							defaultValue: DEFAULT_SETTINGS.manuscriptTypewriter,
						},
					},
					{
						name: this.t('settings.manuscriptFocus.name'),
						desc: '',
						// Rendered rather than declared: the row's own name carries the
						// level in force and its description explains it, both rewritten
						// as the slider moves — and, being built at display time, both
						// read right however the level was changed while this page was
						// closed.
						render: (setting) => this.renderFocusMode(setting),
					},
					{
						name: this.t('settings.mentionHighlight.name'),
						desc: this.t('settings.mentionHighlight.desc'),
						render: (setting) => {
							this.renderHighlightMatrix(setting);
						},
					},
					{
						name: this.t('settings.manuscriptEnterParagraph.name'),
						desc: this.lines('settings.manuscriptEnterParagraph.desc'),
						control: {
							type: 'toggle',
							key: 'manuscriptEnterParagraph',
							defaultValue: DEFAULT_SETTINGS.manuscriptEnterParagraph,
						},
					},
					{
						name: this.t('settings.manuscriptAutoPairBrackets.name'),
						desc: this.t('settings.manuscriptAutoPairBrackets.desc'),
						control: {
							type: 'toggle',
							key: 'manuscriptAutoPairBrackets',
							defaultValue: DEFAULT_SETTINGS.manuscriptAutoPairBrackets,
						},
					},
					{
						name: this.t('settings.manuscriptAutoPairMarkdown.name'),
						desc: this.t('settings.manuscriptAutoPairMarkdown.desc'),
						control: {
							type: 'toggle',
							key: 'manuscriptAutoPairMarkdown',
							defaultValue: DEFAULT_SETTINGS.manuscriptAutoPairMarkdown,
						},
					},
					{
						name: this.t('settings.manuscriptPath.name'),
						desc: this.t('settings.manuscriptPath.desc'),
						control: {
							type: 'toggle',
							key: 'showManuscriptPath',
							defaultValue: DEFAULT_SETTINGS.showManuscriptPath,
						},
					},
					{
						name: this.t('settings.manuscriptSequence.name'),
						desc: this.t('settings.manuscriptSequence.desc'),
						control: {
							type: 'toggle',
							key: 'showManuscriptSequence',
							defaultValue: DEFAULT_SETTINGS.showManuscriptSequence,
						},
					},
					// The word milestones, under a heading of their own: a reading
					// aid over the count, kept apart from how the page behaves.
					{
						name: this.t('settings.milestones.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.manuscriptMilestones.name'),
						desc: this.t('settings.manuscriptMilestones.desc'),
						control: {
							type: 'toggle',
							key: 'manuscriptMilestones',
							defaultValue: DEFAULT_SETTINGS.manuscriptMilestones,
						},
					},
					{
						name: this.t('settings.manuscriptMilestoneMode.name'),
						desc: this.t('settings.manuscriptMilestoneMode.desc'),
						control: {
							type: 'dropdown',
							key: 'manuscriptMilestoneMode',
							defaultValue: DEFAULT_SETTINGS.manuscriptMilestoneMode,
							options: {
								manuscript: this.t('settings.manuscriptMilestoneMode.manuscript'),
								chapter: this.t('settings.manuscriptMilestoneMode.chapter'),
							},
						},
					},
					{
						name: this.t('settings.manuscriptMilestoneInterval.name'),
						desc: this.t('settings.manuscriptMilestoneInterval.desc'),
						control: {
							type: 'number',
							key: 'manuscriptMilestoneInterval',
							defaultValue: DEFAULT_SETTINGS.manuscriptMilestoneInterval,
							min: 1,
							step: 1,
							validate: (value) =>
								isMilestoneInterval(value)
									? undefined
									: this.t('settings.manuscriptMilestoneInterval.invalid'),
						},
					},
					// The number a new note is offered, under a heading of its own.
					{
						name: this.t('settings.chapterNumbering.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.manuscriptChapterNumbering.name'),
						control: {
							type: 'dropdown',
							key: 'manuscriptChapterNumbering',
							defaultValue: DEFAULT_SETTINGS.manuscriptChapterNumbering,
							options: {
								off: this.t('settings.manuscriptChapterNumbering.off'),
								chinese: this.t('settings.manuscriptChapterNumbering.chinese'),
								'chinese-arabic': this.t(
									'settings.manuscriptChapterNumbering.chineseArabic',
								),
								english: this.t('settings.manuscriptChapterNumbering.english'),
								custom: this.t('settings.manuscriptChapterNumbering.custom'),
							},
						},
					},
					// The custom rules, drawn as the highlight rules are and shown
					// only while the style is custom: the dropdown's own change
					// re-reads the page, so the shelf follows the choice at once.
					{
						name: '',
						visible: () =>
							this.owner.settings.manuscriptChapterNumbering === 'custom',
						render: (setting) => {
							this.renderNumberRules(setting);
						},
					},
				// The page's dress, under a heading of its own: what the manuscript
				// looks like is a different question from how it behaves, and an
				// author who has found the look they want never needs to come back
				// here. The same controls are offered over the manuscript itself,
				// from the formatting bar.
					{
						name: this.t('settings.manuscriptAppearance.heading'),
						render: (setting) => {
							setting.setHeading();
							// The stylesheet walks from this heading to the choice rows
							// under it, which are the last of the group; the rows above
							// keep the app's own dropdown widths.
							setting.settingEl.addClass('snowflake-method-appearance-heading');
						},
					},
					{
						name: this.t('settings.manuscriptFontFamily.name'),
						desc: this.lines('settings.manuscriptFontFamily.desc'),
						render: (setting) => this.renderFontFamily(setting),
					},
					{
						name: this.t('settings.manuscriptFontSize.name'),
						desc: this.t('settings.manuscriptFontSize.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'manuscriptFontSize',
								FONT_SIZE_STOPS,
								(value) =>
									value === 0
										? this.t('settings.manuscriptAppearance.themeDefault')
										: this.t('settings.manuscriptAppearance.pixels', { value }),
								PRESENTATION_THEME_VARS.fontSize,
							),
					},
					{
						name: this.t('settings.manuscriptLineHeight.name'),
						desc: this.t('settings.manuscriptLineHeight.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'manuscriptLineHeight',
								LINE_HEIGHT_STOPS,
								(value) =>
									value === 0
										? this.t('settings.manuscriptAppearance.themeDefault')
										: String(value),
								PRESENTATION_THEME_VARS.lineHeight,
							),
					},
					{
						name: this.t('settings.manuscriptContentWidth.name'),
						desc: this.t('settings.manuscriptContentWidth.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'manuscriptContentWidth',
								CONTENT_WIDTH_STOPS,
								(value) =>
									value === 0
										? this.t('settings.manuscriptAppearance.themeDefault')
										: this.t('settings.manuscriptAppearance.pixels', { value }),
								PRESENTATION_THEME_VARS.contentWidth,
							),
					},
					{
						name: this.t('settings.manuscriptParagraphSpacing.name'),
						desc: this.t('settings.manuscriptParagraphSpacing.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'manuscriptParagraphSpacing',
								PARAGRAPH_SPACING_STOPS,
								(value) =>
									this.t(
										value === 1
											? 'settings.manuscriptParagraphSpacing.line'
											: 'settings.manuscriptParagraphSpacing.lines',
										{ value },
									),
							),
					},
					{
						name: this.t('settings.manuscriptFirstLineIndent.name'),
						desc: this.t('settings.manuscriptFirstLineIndent.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'manuscriptFirstLineIndent',
								FIRST_LINE_INDENT_STOPS,
								(value) =>
									value === 0
										? this.t('settings.manuscriptFirstLineIndent.none')
										: this.t('settings.manuscriptFirstLineIndent.value', { value }),
							),
					},
					{
						name: this.t('settings.manuscriptTextAlign.name'),
						desc: this.t('settings.manuscriptTextAlign.desc'),
						control: {
							type: 'dropdown',
							key: 'manuscriptTextAlign',
							defaultValue: DEFAULT_SETTINGS.manuscriptTextAlign,
							options: {
								start: this.t('settings.manuscriptTextAlign.start'),
								justify: this.t('settings.manuscriptTextAlign.justify'),
							},
						},
					},
					{
						name: this.t('settings.manuscriptGuide.name'),
						desc: this.t('settings.manuscriptGuide.desc'),
						control: {
							type: 'dropdown',
							key: 'manuscriptGuide',
							defaultValue: DEFAULT_SETTINGS.manuscriptGuide,
							options: {
								none: this.t('settings.manuscriptGuide.none'),
								solid: this.t('settings.manuscriptGuide.solid'),
								dashed: this.t('settings.manuscriptGuide.dashed'),
							},
						},
					},
					{
						name: this.t('settings.manuscriptHyphenation.name'),
						desc: this.t('settings.manuscriptHyphenation.desc'),
						control: {
							type: 'toggle',
							key: 'manuscriptHyphenation',
							defaultValue: DEFAULT_SETTINGS.manuscriptHyphenation,
						},
					},
					{
						name: this.t('settings.manuscriptTintLight.name'),
						desc: this.t('settings.manuscriptTintLight.desc'),
						render: (setting) =>
							this.renderTint(setting, 'manuscriptTintLight', MANUSCRIPT_TINTS.light),
					},
					{
						name: this.t('settings.manuscriptTintDark.name'),
						desc: this.t('settings.manuscriptTintDark.desc'),
						render: (setting) =>
							this.renderTint(setting, 'manuscriptTintDark', MANUSCRIPT_TINTS.dark),
					},
				],
			},
			{
				type: 'group',
				heading: this.t('dashboard.statistics'),
				items: [
					this.sectionDress('statistics'),
					// A session starts from the status bar or the palette. What lives here
					// is what a new one starts with, and how the statistics read it back:
					// what counts as a word, then the clock, then how a session begins, then
					// the goal, then how the numbers are shown. A session already running
					// keeps what it began under.
					{
						name: this.t('settings.session.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.writingCountMode.name'),
						desc: this.t('settings.writingCountMode.desc'),
						control: {
							type: 'dropdown',
							key: 'writingCountMode',
							defaultValue: DEFAULT_SETTINGS.writingCountMode,
							options: {
								jinjiang: this.t('settings.writingCountMode.jinjiang'),
								qidian: this.t('settings.writingCountMode.qidian'),
								'ms-word': this.t('settings.writingCountMode.msWord'),
							},
						},
					},
					{
						name: this.t('settings.writingCountHeadings.name'),
						desc: this.t('settings.writingCountHeadings.desc'),
						control: {
							type: 'dropdown',
							key: 'writingCountHeadings',
							defaultValue: DEFAULT_SETTINGS.writingCountHeadings,
							options: {
								count: this.t('settings.writingCountHeadings.count'),
								'skip-first-h1': this.t(
									'settings.writingCountHeadings.skipFirstH1',
								),
								'skip-h1': this.t('settings.writingCountHeadings.skipH1'),
								'skip-all': this.t('settings.writingCountHeadings.skipAll'),
							},
						},
					},
					{
						name: this.t('settings.sessionDefaultType.name'),
						desc: this.t('settings.sessionDefaultType.desc'),
						control: {
							type: 'dropdown',
							key: 'sessionDefaultType',
							defaultValue: DEFAULT_SETTINGS.sessionDefaultType,
							options: Object.fromEntries(
								WRITING_SESSION_TYPES.map((type) => [
									type,
									this.t(`session.type.${type}`),
								]),
							),
						},
					},
					{
						name: this.t('settings.sessionIdleThreshold.name'),
						desc: this.t('settings.sessionIdleThreshold.desc'),
						render: (setting) =>
							this.renderStops(
								setting,
								'sessionIdleThresholdSeconds',
								SESSION_IDLE_STOPS,
								(value) =>
									this.t('settings.sessionIdleThreshold.seconds', {
										value,
									}),
							),
					},
					{
						name: this.t('settings.sessionWritingMode.name'),
						desc: this.t('settings.sessionWritingMode.desc'),
						control: {
							type: 'dropdown',
							key: 'sessionWritingMode',
							defaultValue: DEFAULT_SETTINGS.sessionWritingMode,
							options: Object.fromEntries(
								WRITING_MODES.map((mode) => [
									mode,
									this.t(`session.mode.${mode}`),
								]),
							),
						},
					},
					{
						name: this.t('settings.sessionAutoStart.name'),
						// The name is the whole of it; a gloss would only say
						// the same words again.
						desc: '',
						control: {
							type: 'toggle',
							key: 'sessionAutoWithFocusMode',
							defaultValue: DEFAULT_SETTINGS.sessionAutoWithFocusMode,
						},
					},
					{
						name: this.t('settings.sessionTrackUntimed.name'),
						desc: this.t('settings.sessionTrackUntimed.desc'),
						control: {
							type: 'toggle',
							key: 'sessionTrackUntimedWords',
							defaultValue: DEFAULT_SETTINGS.sessionTrackUntimedWords,
						},
					},
					{
						name: this.t('settings.sessionScope.name'),
						desc: this.t('settings.sessionScope.desc'),
						control: {
							type: 'dropdown',
							key: 'sessionScope',
							defaultValue: DEFAULT_SETTINGS.sessionScope,
							options: Object.fromEntries(
								WRITING_SESSION_SCOPES.map((scope) => [
									scope,
									this.t(`session.scope.${scope}`),
								]),
							),
						},
					},
					// Typed rather than dragged, because this is the same number the
					// widget's own dialog asks for and a goal is set once and left.
					{
						name: this.t('settings.sessionDailyGoalProject.name'),
						desc: this.lines('settings.sessionDailyGoalProject.desc'),
						control: {
							type: 'number',
							key: 'sessionDailyWordGoalProject',
							defaultValue: DEFAULT_SETTINGS.sessionDailyWordGoalProject,
							min: 0,
							step: 1,
						},
					},
					{
						name: this.t('settings.sessionDailyGoalManuscript.name'),
						desc: this.lines('settings.sessionDailyGoalManuscript.desc'),
						control: {
							type: 'number',
							key: 'sessionDailyWordGoalManuscript',
							defaultValue:
								DEFAULT_SETTINGS.sessionDailyWordGoalManuscript,
							min: 0,
							step: 1,
						},
					},
					{
						name: this.t('settings.sessionWeekStart.name'),
						desc: this.t('settings.sessionWeekStart.desc'),
						control: {
							type: 'dropdown',
							key: 'sessionWeekStart',
							defaultValue: DEFAULT_SETTINGS.sessionWeekStart,
							// Named by the platform's own calendar rather than by
							// this plugin's copy: a weekday reads the same for
							// everyone who speaks a language, and is not this
							// plugin's to translate.
							options: Object.fromEntries(
								WEEK_START_DAYS.map((day, at) => [
									day,
									weekdayLabels(this.locale(), 'long')[at] ?? day,
								]),
							),
						},
					},
					{
						name: this.t('settings.sessionDateFormat.name'),
						desc: this.t('settings.sessionDateFormat.desc'),
						control: {
							type: 'dropdown',
							key: 'sessionDateFormat',
							defaultValue: DEFAULT_SETTINGS.sessionDateFormat,
							// A format names its own parts, in every language.
							options: Object.fromEntries(
								DATE_FORMATS.map((format) => [format, format]),
							),
						},
					},
					{
						name: this.t('settings.proseStatistics.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.readingWordsPerMinute.name'),
						control: {
							type: 'number',
							key: 'readingWordsPerMinute',
							defaultValue: DEFAULT_SETTINGS.readingWordsPerMinute,
							min: 10,
							step: 10,
						},
					},
					{
						name: this.t('settings.readingCjkCharactersPerMinute.name'),
						control: {
							type: 'number',
							key: 'readingCjkCharactersPerMinute',
							defaultValue: DEFAULT_SETTINGS.readingCjkCharactersPerMinute,
							min: 10,
							step: 10,
						},
					},
					{
						name: this.t('settings.customStopwords.name'),
						desc: this.lines('settings.customStopwords.desc'),
						control: {
							type: 'textarea',
							key: 'customStopwords',
							defaultValue: DEFAULT_SETTINGS.customStopwords,
						},
					},
					{
						name: this.t('settings.section.sensitiveRules'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.sensitiveWords.list'),
						desc: this.lines('settings.sensitiveWords.listDesc'),
						control: {
							type: 'textarea',
							key: 'sensitiveWords',
							defaultValue: DEFAULT_SETTINGS.sensitiveWords,
						},
					},
					{
						name: this.t('settings.dialogue.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.dialogue.quotesCurly'),
						desc: '',
						control: {
							type: 'toggle',
							key: 'dialogueQuotesCurly',
							defaultValue: DEFAULT_SETTINGS.dialogueQuotesCurly,
						},
					},
					{
						name: this.t('settings.dialogue.quotesStraight'),
						desc: '',
						control: {
							type: 'toggle',
							key: 'dialogueQuotesStraight',
							defaultValue: DEFAULT_SETTINGS.dialogueQuotesStraight,
						},
					},
					{
						name: this.t('settings.dialogue.quotesCorner'),
						desc: '',
						control: {
							type: 'toggle',
							key: 'dialogueQuotesCorner',
							defaultValue: DEFAULT_SETTINGS.dialogueQuotesCorner,
						},
					},
					{
						name: this.t('settings.dialogue.quotesWhite'),
						desc: '',
						control: {
							type: 'toggle',
							key: 'dialogueQuotesWhite',
							defaultValue: DEFAULT_SETTINGS.dialogueQuotesWhite,
						},
					},
					{
						name: this.t('settings.customMatching.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					// The rules themselves: the plugin's one settings-owned
					// collection, drawn as the entity form's record cards --
					// the handle that moves one, the body that opens it, the
					// pause that rests it, and the trash that removes it.
					{
						name: '',
						render: (setting) => {
							this.renderCustomRules(setting);
						},
					},
				],
			},
			// What leaves the Vault as plain text, and how it is laid out on the
			// way out. Its own section: an export is neither the plugin's manner
			// nor the manuscript's dress.
			{
				type: 'group',
				heading: this.t('settings.section.export'),
				items: [
					this.sectionDress('export'),
					{
						name: this.t('settings.exportFolder.name'),
						desc: this.lines('settings.exportFolder.desc'),
						// The project root's own field rather than the app's folder
						// box, so the page's two folder rows are one control.
						render: (setting) => this.renderExportFolder(setting),
					},
					{
						name: this.t('settings.exportFormat.name'),
						desc: this.lines('settings.exportFormat.desc'),
						control: {
							type: 'dropdown',
							key: 'exportFormat',
							defaultValue: DEFAULT_SETTINGS.exportFormat,
							options: {
								txt: this.t('settings.exportFormat.txt'),
								md: this.t('settings.exportFormat.md'),
							},
						},
					},
					{
						name: this.t('settings.exportIndent.name'),
						desc: this.lines('settings.exportIndent.desc'),
						control: {
							type: 'toggle',
							key: 'exportIndent',
							defaultValue: DEFAULT_SETTINGS.exportIndent,
						},
					},
					{
						name: this.t('settings.exportParagraphSpacing.name'),
						desc: this.lines('settings.exportParagraphSpacing.desc'),
						control: {
							type: 'toggle',
							key: 'exportParagraphSpacing',
							defaultValue: DEFAULT_SETTINGS.exportParagraphSpacing,
						},
					},
					{
						name: this.t('settings.exportManuscript.heading'),
						render: (setting) => {
							setting.setHeading();
						},
					},
					{
						name: this.t('settings.exportManuscriptLayout.name'),
						desc: this.lines('settings.exportManuscriptLayout.desc'),
						control: {
							type: 'dropdown',
							key: 'exportManuscriptLayout',
							defaultValue: DEFAULT_SETTINGS.exportManuscriptLayout,
							options: {
								single: this.t('settings.exportManuscriptLayout.single'),
								folder: this.t('settings.exportManuscriptLayout.folder'),
							},
						},
					},
					{
						name: this.t('settings.exportChapterSeparator.name'),
						desc: this.t('settings.exportChapterSeparator.desc'),
						// Only a single file has anything between its notes, so the
						// row stands only while that is the layout.
						visible: () => this.owner.settings.exportManuscriptLayout === 'single',
						control: {
							type: 'dropdown',
							key: 'exportChapterSeparator',
							defaultValue: DEFAULT_SETTINGS.exportChapterSeparator,
							options: {
								blank: this.t('settings.exportChapterSeparator.blank'),
								rule: this.t('settings.exportChapterSeparator.rule'),
								asterisks: this.t('settings.exportChapterSeparator.asterisks'),
							},
						},
					},
				],
			},
		];
	}

	private customRuleKindLabel(kind: CustomHighlightRule['kind']): string {
		return this.t(
			kind === 'literal'
				? 'settings.customMatching.kindLiteral'
				: 'settings.customMatching.kindRegex',
		);
	}

	/** Every rule's card name, in order: its own, or its kind's when unnamed. */
	customRuleNames(): string[] {
		return this.owner.settings.customHighlightRules.map((rule) =>
			rule.name.length > 0
				? rule.name
				: this.customRuleKindLabel(rule.kind),
		);
	}

	/**
	 * The rules drawn as the entity form's record cards, on the bare ground of
	 * their settings row: each card a handle, a clickable body that opens the
	 * editor, a pause button saying whether the rule runs, and the trash. The
	 * add button stands under the cards, where the next rule will appear.
	 */
	private renderCustomRules(setting: Setting): void {
		const row = setting.settingEl;
		row.empty();
		row.addClass('snowflake-method-settings-rules');
		const names = this.customRuleNames();
		const cards = row.createDiv({ cls: 'snowflake-method-record-cards' });
		// One holder per render: a drop redraws the page, which retires the
		// cards along with whatever drag they were part of.
		const dragState: { dragging: number | null } = { dragging: null };
		names.forEach((name, index) => {
			this.renderCustomRuleCard(cards, name, index, dragState);
		});
		const add = row.createEl('button', {
			cls: 'snowflake-method-record-add',
			text: this.t('settings.customMatching.add'),
			attr: { type: 'button' },
		});
		add.addEventListener('click', () => {
			void this.addCustomRule();
		});
	}

	private renderCustomRuleCard(
		cards: HTMLElement,
		name: string,
		index: number,
		dragState: { dragging: number | null },
	): void {
		const rule = this.owner.settings.customHighlightRules[index];
		if (rule === undefined) return;
		const card = cards.createDiv({
			cls: 'snowflake-method-record-card snowflake-method-settings-rule',
		});
		card.toggleClass('is-paused', !rule.enabled);
		const handle = card.createDiv({
			cls: 'snowflake-method-record-drag',
			attr: { 'aria-label': this.t('form.record.reorder') },
		});
		setIcon(handle, 'grip-vertical');
		wireCardDrag(card, handle, dragState, index, (from) => {
			void this.reorderCustomRules(from, index);
		});
		const body = card.createDiv({
			cls: 'snowflake-method-record-body snowflake-method-settings-rule-body',
			attr: { role: 'button', tabindex: '0' },
		});
		body.createDiv({
			cls: 'snowflake-method-settings-rule-name',
			text: name,
		});
		const edit = (): void => {
			void this.editCustomRule(index);
		};
		body.addEventListener('click', edit);
		body.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			edit();
		});
		const pause = card.createEl('button', {
			cls: 'snowflake-method-record-card-pause clickable-icon',
			attr: {
				type: 'button',
				'aria-label': this.t(
					rule.enabled
						? 'settings.customMatching.pause'
						: 'settings.customMatching.resume',
				),
			},
		});
		setIcon(pause, rule.enabled ? 'pause' : 'play');
		pause.addEventListener('click', () => {
			void this.toggleCustomRule(index);
		});
		const close = card.createEl('button', {
			cls: 'snowflake-method-record-card-close clickable-icon',
			attr: {
				type: 'button',
				'aria-label': this.t('modal.highlightRule.deleteTitle', {
					name,
				}),
			},
		});
		setIcon(close, 'trash-2');
		close.addEventListener('click', () => {
			void this.deleteCustomRule(index);
		});
	}

	/** Rests a running rule or wakes a paused one, in place. */
	private async toggleCustomRule(index: number): Promise<void> {
		await this.owner.updateCustomHighlightRules(
			this.owner.settings.customHighlightRules.map((kept, at) =>
				at === index ? { ...kept, enabled: !kept.enabled } : kept,
			),
		);
		this.update();
	}

	private async addCustomRule(): Promise<void> {
		const result = await this.owner.promptHighlightRule(this.translator(), {
			title: this.t('modal.highlightRule.createTitle'),
			submitLabel: this.t('common.add'),
		});
		if (result === null) return;
		// A rule is born running: whether it runs lives on the card's own
		// pause button, not in the dialog.
		await this.owner.updateCustomHighlightRules([
			...this.owner.settings.customHighlightRules,
			{ id: newHighlightRuleId(), enabled: true, ...result },
		]);
		this.update();
	}

	private async editCustomRule(index: number): Promise<void> {
		const rule = this.owner.settings.customHighlightRules[index];
		if (rule === undefined) return;
		const result = await this.owner.promptHighlightRule(this.translator(), {
			title: this.t('modal.highlightRule.editTitle'),
			submitLabel: this.t('common.save'),
			initial: rule,
		});
		if (result === null) return;
		await this.owner.updateCustomHighlightRules(
			this.owner.settings.customHighlightRules.map((kept, at) =>
				// The kind stays what it was: the modal locked it too.
				at === index ? { ...kept, ...result, kind: kept.kind } : kept,
			),
		);
		this.update();
	}

	private async deleteCustomRule(index: number): Promise<void> {
		const rule = this.owner.settings.customHighlightRules[index];
		if (rule === undefined) return;
		const name =
			rule.name.length > 0 ? rule.name : this.customRuleKindLabel(rule.kind);
		const confirmed = await this.owner.confirmHighlightRuleDeletion(
			this.translator(),
			name,
		);
		if (confirmed) {
			await this.owner.updateCustomHighlightRules(
				this.owner.settings.customHighlightRules.filter(
					(kept, at) => at !== index,
				),
			);
		}
		// Rendered either way: a declined delete puts the row back.
		this.update();
	}

	private async reorderCustomRules(from: number, to: number): Promise<void> {
		const rules = [...this.owner.settings.customHighlightRules];
		const [moved] = rules.splice(from, 1);
		if (moved === undefined) return;
		rules.splice(to, 0, moved);
		await this.owner.updateCustomHighlightRules(rules);
		this.update();
	}

	/**
	 * The custom numbering rules, drawn as the highlight rules are: a card
	 * per rule with its text, the handle that moves it, a pause button
	 * saying whether it runs, and the trash, the add button beneath. One
	 * runs at a time, and the cards say which.
	 */
	private renderNumberRules(setting: Setting): void {
		const row = setting.settingEl;
		row.empty();
		row.addClass('snowflake-method-settings-rules');
		const rules = this.owner.settings.manuscriptChapterNumberRules;
		const cards = row.createDiv({ cls: 'snowflake-method-record-cards' });
		// One holder per render: a drop redraws the page, which retires the
		// cards along with whatever drag they were part of.
		const dragState: { dragging: number | null } = { dragging: null };
		rules.forEach((rule, index) => {
			this.renderNumberRuleCard(cards, rule, index, dragState);
		});
		const add = row.createEl('button', {
			cls: 'snowflake-method-record-add',
			text: this.t('settings.chapterNumberRules.add'),
			attr: { type: 'button' },
		});
		add.addEventListener('click', () => {
			void this.addNumberRule();
		});
	}

	private renderNumberRuleCard(
		cards: HTMLElement,
		rule: ChapterNumberRule,
		index: number,
		dragState: { dragging: number | null },
	): void {
		const card = cards.createDiv({
			cls: 'snowflake-method-record-card snowflake-method-settings-rule',
		});
		card.toggleClass('is-paused', !rule.enabled);
		const handle = card.createDiv({
			cls: 'snowflake-method-record-drag',
			attr: { 'aria-label': this.t('form.record.reorder') },
		});
		setIcon(handle, 'grip-vertical');
		wireCardDrag(card, handle, dragState, index, (from) => {
			void this.reorderNumberRules(from, index);
		});
		const body = card.createDiv({
			cls: 'snowflake-method-record-body snowflake-method-settings-rule-body',
			attr: { role: 'button', tabindex: '0' },
		});
		body.createDiv({
			cls: 'snowflake-method-settings-rule-name',
			text: rule.text,
		});
		const edit = (): void => {
			void this.editNumberRule(index);
		};
		body.addEventListener('click', edit);
		body.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			edit();
		});
		const pause = card.createEl('button', {
			cls: 'snowflake-method-record-card-pause clickable-icon',
			attr: {
				type: 'button',
				'aria-label': this.t(
					rule.enabled
						? 'settings.chapterNumberRules.pause'
						: 'settings.chapterNumberRules.resume',
				),
			},
		});
		setIcon(pause, rule.enabled ? 'pause' : 'play');
		pause.addEventListener('click', () => {
			void this.toggleNumberRule(index);
		});
		const close = card.createEl('button', {
			cls: 'snowflake-method-record-card-close clickable-icon',
			attr: {
				type: 'button',
				'aria-label': this.t('modal.chapterNumberRule.deleteTitle', {
					name: rule.text,
				}),
			},
		});
		setIcon(close, 'trash-2');
		close.addEventListener('click', () => {
			void this.deleteNumberRule(index);
		});
	}

	/**
	 * Rests the running rule, or wakes a paused one and rests whichever ran:
	 * one rule runs at a time, so waking is also the way to switch.
	 */
	private async toggleNumberRule(index: number): Promise<void> {
		await this.owner.updateChapterNumberRules(
			this.owner.settings.manuscriptChapterNumberRules.map((kept, at) =>
				at === index
					? { ...kept, enabled: !kept.enabled }
					: { ...kept, enabled: false },
			),
		);
		this.update();
	}

	private async addNumberRule(): Promise<void> {
		const result = await this.owner.promptChapterNumberRule(this.translator(), {
			title: this.t('modal.chapterNumberRule.createTitle'),
			submitLabel: this.t('common.add'),
		});
		if (result === null) return;
		// A rule is born running, and one runs at a time: the one that ran
		// rests, and its card's own pause button wakes it again.
		await this.owner.updateChapterNumberRules([
			...this.owner.settings.manuscriptChapterNumberRules.map((kept) => ({
				...kept,
				enabled: false,
			})),
			{ id: newChapterRuleId(), enabled: true, ...result },
		]);
		this.update();
	}

	private async editNumberRule(index: number): Promise<void> {
		const rule = this.owner.settings.manuscriptChapterNumberRules[index];
		if (rule === undefined) return;
		const result = await this.owner.promptChapterNumberRule(this.translator(), {
			title: this.t('modal.chapterNumberRule.editTitle'),
			submitLabel: this.t('common.save'),
			initial: rule,
		});
		if (result === null) return;
		await this.owner.updateChapterNumberRules(
			this.owner.settings.manuscriptChapterNumberRules.map((kept, at) =>
				// The kind stays what it was: the dialog locked it too.
				at === index ? { ...kept, ...result, kind: kept.kind } : kept,
			),
		);
		this.update();
	}

	private async deleteNumberRule(index: number): Promise<void> {
		const rule = this.owner.settings.manuscriptChapterNumberRules[index];
		if (rule === undefined) return;
		const confirmed = await this.owner.confirmChapterNumberRuleDeletion(
			this.translator(),
			rule.text,
		);
		if (confirmed) {
			await this.owner.updateChapterNumberRules(
				this.owner.settings.manuscriptChapterNumberRules.filter(
					(kept, at) => at !== index,
				),
			);
		}
		// Rendered either way: a declined delete puts the row back.
		this.update();
	}

	private async reorderNumberRules(from: number, to: number): Promise<void> {
		const rules = [...this.owner.settings.manuscriptChapterNumberRules];
		const [moved] = rules.splice(from, 1);
		if (moved === undefined) return;
		rules.splice(to, 0, moved);
		await this.owner.updateChapterNumberRules(rules);
		this.update();
	}

	/** The tab's own copy handed to a dialog in the shape dialogs take. */
	private translator(): (
		key: string,
		vars?: Record<string, string | number>,
	) => string {
		return (key, vars) => this.t(key, vars);
	}

	/**
	 * The focus row: a four-stop slider from everything bright to nothing but
	 * the manuscript, in the manner of a graded effort control. The row's name
	 * names the level in force and the description explains it, both rewritten
	 * in place as the slider moves — never a rebuild, so a drag is not
	 * interrupted by the page changing under it.
	 */
	private renderFocusMode(setting: Setting): void {
		setting.settingEl.addClass('snowflake-method-focus-row');
		const levels: readonly ManuscriptFocusLevel[] = [
			'off',
			'on',
			'deep',
			'solo',
		];
		const labelKeys: Record<ManuscriptFocusLevel, string> = {
			off: 'settings.manuscriptFocus.levelOff',
			on: 'settings.manuscriptFocus.levelOn',
			deep: 'settings.manuscriptFocus.levelDeep',
			solo: 'settings.manuscriptFocus.levelSolo',
		};
		setting.setName(this.t('settings.manuscriptFocus.name'));
		// Where an ordinary slider shows its number, this one names the level —
		// a number would only be the same fact in a language nobody chose.
		const value = setting.controlEl.createSpan({
			cls: 'snowflake-method-focus-value',
		});
		let reset: ExtraButtonComponent | null = null;
		let slider: SliderComponent | null = null;
		const dress = (): void => {
			const level = this.owner.settings.manuscriptFocusLevel;
			value.setText(this.t(labelKeys[level]));
			setting.setDesc(this.t(`settings.manuscriptFocus.${level}`));
			// Nothing to put back while focus is already where the button would
			// take it, and the app dims an icon that says it is disabled.
			const spent = level === DEFAULT_SETTINGS.manuscriptFocusLevel;
			if (reset !== null) {
				reset.setDisabled(spent);
				reset.extraSettingsEl.setAttribute('aria-disabled', String(spent));
			}
		};
		// The button the appearance sliders carry, on the slider's left: focus
		// back to what it was before anything was chosen.
		setting.addExtraButton((component) => {
			reset = component;
			component.extraSettingsEl.addClass('snowflake-method-presentation-reset');
			component
				.setIcon('rotate-ccw')
				.setTooltip(this.t('settings.manuscriptAppearance.reset'))
				.onClick(() => {
					const level = DEFAULT_SETTINGS.manuscriptFocusLevel;
					if (level === this.owner.settings.manuscriptFocusLevel) return;
					void this.setControlValue('manuscriptFocusLevel', level).then(() => {
						// Stored first, so the handle's own answer to being put
						// here is the nothing the guard below makes of it.
						slider?.setValue(Math.max(0, levels.indexOf(level)));
						dress();
					});
				});
		});
		setting.addSlider((component) => {
			slider = component;
			component
				.setLimits(0, levels.length - 1, 1)
				.setValue(
					Math.max(
						0,
						levels.indexOf(this.owner.settings.manuscriptFocusLevel),
					),
				)
				// Answered while the handle moves, not when it is let go: the name
				// and the sentence under the title are how the stops are told apart,
				// so they have to keep up with the drag.
				.setInstant(true)
				.onChange((picked) => {
					const level = levels[picked] ?? 'off';
					if (level === this.owner.settings.manuscriptFocusLevel) return;
					void this.setControlValue('manuscriptFocusLevel', level).then(dress);
				});
		});
		dress();
	}

	/**
	 * A slider over stops for one of the page's measures, the stop named
	 * beside it and a button on its left that puts the measure back to what
	 * it was before anything was chosen. The key is stored as any other, and
	 * what was stored is shown back, so a value held to its range reads as
	 * what it became.
	 */
	/**
	 * The highlight options behind one gear: a dialog with the four families
	 * as dropdowns -- Entities, Sensitive words, Dialogues, Custom highlight
	 * -- and a Save that writes them together, so the whole dress is set in
	 * one place. The manuscript toolbar's menu offers the same four live.
	 */
	private renderHighlightMatrix(setting: Setting): void {
		const button = setting.controlEl.createEl('button', {
			cls: 'clickable-icon snowflake-method-highlight-menu',
			attr: { type: 'button', 'aria-haspopup': 'dialog' },
		});
		setIcon(button, 'settings');
		setTooltip(button, this.t('settings.mentionHighlight.name'));
		button.addEventListener('click', () => {
			new HighlightOptionsModal(this.app, {
				t: (key) => this.t(key),
				current: {
					entities: this.owner.settings.manuscriptMentionHighlight,
					sensitive: this.owner.settings.sensitiveHighlight,
					dialogue: this.owner.settings.dialoguePresentation,
					custom: this.owner.settings.customHighlightsEnabled,
				},
				save: async (next) => {
					// One write for all four, not four writes in a row: a
					// refusal mid-sequence would leave some families applied
					// and some mutated-but-unsaved, silently flushed by the
					// next unrelated save. All or nothing instead.
					const settings = this.owner.settings;
					const before: HighlightOptionsDraft = {
						entities: settings.manuscriptMentionHighlight,
						sensitive: settings.sensitiveHighlight,
						dialogue: settings.dialoguePresentation,
						custom: settings.customHighlightsEnabled,
					};
					settings.manuscriptMentionHighlight = next.entities;
					settings.sensitiveHighlight = next.sensitive;
					settings.dialoguePresentation = next.dialogue;
					settings.customHighlightsEnabled = next.custom;
					try {
						await this.owner.saveSettings();
					} catch (error) {
						// The disk refused: memory steps back to what the
						// disk still holds, so nothing dangles half-applied.
						settings.manuscriptMentionHighlight = before.entities;
						settings.sensitiveHighlight = before.sensitive;
						settings.dialoguePresentation = before.dialogue;
						settings.customHighlightsEnabled = before.custom;
						throw error;
					}
					this.writing = true;
					try {
						await this.owner.handleSettingsChanged(
							'manuscriptMentionHighlight',
						);
						await this.owner.handleSettingsChanged('sensitiveHighlight');
						await this.owner.handleSettingsChanged('dialoguePresentation');
						await this.owner.handleSettingsChanged(
							'customHighlightsEnabled',
						);
					} finally {
						this.writing = false;
					}
				},
			}).open();
		});
	}

	private renderStops(
		setting: Setting,
		key:
			| 'manuscriptFontSize'
			| 'manuscriptLineHeight'
			| 'manuscriptContentWidth'
			| 'manuscriptParagraphSpacing'
			| 'manuscriptFirstLineIndent'
			| 'manuscriptWindow'
			| 'sessionIdleThresholdSeconds',
		stops: readonly number[],
		format: (value: number) => string,
		themeVar?: string,
	): void {
		const handle = addStopSlider(setting, {
			stops,
			value: this.owner.settings[key],
			resetValue: DEFAULT_SETTINGS[key],
			resetLabel: this.t('settings.manuscriptAppearance.reset'),
			themeVar,
			format,
			onPick: (value) => {
				if (value === this.owner.settings[key]) return;
				void this.setControlValue(key, value).then(() => {
					handle.sync(this.owner.settings[key]);
				});
			},
		});
	}

	/** The page's ground for one mode: swatches and the color picker. */
	private renderTint(
		setting: Setting,
		key: 'manuscriptTintLight' | 'manuscriptTintDark',
		presets: readonly ManuscriptTint[],
	): void {
		const handle = addTintSwatches(setting, {
			value: this.owner.settings[key],
			presets: presets.map((tint) => ({
				hex: tint.hex,
				label: this.t(`settings.manuscriptTint.${tint.name}`),
			})),
			labels: {
				themeDefault: this.t('settings.manuscriptTint.themeDefault'),
				custom: this.t('settings.manuscriptTint.custom'),
			},
			onPick: (value) => {
				if (value === this.owner.settings[key]) return;
				void this.setControlValue(key, value).then(() => {
					handle.sync(this.owner.settings[key]);
				});
			},
		});
	}

	/**
	 * The font, picked from what this machine has. Reports back how to take the
	 * list down again: it can be left open when the page goes away.
	 */
	private renderFontFamily(setting: Setting): () => void {
		const name = this.t('settings.manuscriptFontFamily.name');
		const handle = addFontFamilyPicker(this.app, setting, {
			value: this.owner.settings.manuscriptFontFamily,
			themeLabel: this.t('settings.manuscriptFontFamily.placeholder'),
			placeholder: this.t('settings.manuscriptFontFamily.placeholder'),
			label: name,
			recent: () => this.owner.settings.manuscriptRecentFonts,
			sections: {
				recent: this.t('settings.manuscriptFontFamily.recent'),
				all: this.t('settings.manuscriptFontFamily.all'),
			},
			useLabel: (typed) =>
				this.t('settings.manuscriptFontFamily.use', { value: typed }),
			missingLabel: (face) =>
				this.t('settings.manuscriptFontFamily.missing', { value: face }),
			onPick: (value) => {
				void this.setControlValue('manuscriptFontFamily', value).then(() => {
					handle.sync(this.owner.settings.manuscriptFontFamily);
				});
			},
		});
		return () => handle.destroy?.();
	}

	/**
	 * Builds the project-root field into a setting row, and reports back how to
	 * take it down again — the list it can leave open outlives the row itself.
	 */
	private renderProjectRoot(setting: Setting): () => void {
		return this.renderFolderField(setting, {
			label: this.t('settings.projectRoot.name'),
			placeholder: this.t('settings.projectRoot.placeholder'),
			current: () => this.owner.settings.projectRoot,
			display: displayProjectRoot,
			offerVaultRoot: true,
			commit: (value, field) => this.commitProjectRoot(value, field),
		});
	}

	/**
	 * The export folder, asked for with the project root's field. An empty
	 * box is the folder beside the projects, which the placeholder names, so
	 * the empty string reads as nothing rather than as the vault root, and
	 * the vault root is not in the list: nothing would stand for it.
	 */
	private renderExportFolder(setting: Setting): () => void {
		return this.renderFolderField(setting, {
			label: this.t('settings.exportFolder.name'),
			placeholder: this.t('settings.exportFolder.placeholder'),
			current: () => this.owner.settings.exportFolder,
			display: (root) => normalizeProjectRoot(root),
			offerVaultRoot: false,
			commit: (value, field) => this.commitExportFolder(value, field),
		});
	}

	private renderFolderField(
		setting: Setting,
		spec: {
			label: string;
			placeholder: string;
			current: () => string;
			display: (root: string) => string;
			offerVaultRoot: boolean;
			commit: (value: string, field: ProjectRootField) => Promise<void>;
		},
	): () => void {
		const field = buildProjectRootField(this.app, setting.controlEl, {
			label: spec.label,
			placeholder: spec.placeholder,
			currentRoot: spec.current(),
			display: spec.display,
			offerVaultRoot: spec.offerVaultRoot,
			onChooseRoot: (root) => {
				void spec.commit(root, field);
			},
		});
		const commit = (): void => {
			void spec.commit(field.inputEl.value, field);
		};
		// Committing on the way out would fight the chevron, which takes focus off
		// the box on its way to opening the list.
		field.inputEl.addEventListener('blur', (event) => {
			const next = event.relatedTarget;
			if (next instanceof HTMLElement && next === field.selectorEl) return;
			commit();
		});
		field.inputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			commit();
		});
		return () => field.destroy();
	}

	/**
	 * Takes a root the author typed or picked. A path the Vault could never hold
	 * is refused and the field put back to what is in force, so the box never
	 * shows a root the plugin is not using.
	 */
	private async commitProjectRoot(
		value: string,
		field: ProjectRootField,
	): Promise<void> {
		if (!isValidProjectRoot(value)) {
			new Notice(this.t('modal.projectManager.projectRootInvalid'));
			field.showValue(this.owner.settings.projectRoot);
			return;
		}
		const root = normalizeProjectRoot(value);
		if (root !== this.owner.settings.projectRoot) {
			await this.setControlValue('projectRoot', root);
		}
		field.showValue(this.owner.settings.projectRoot);
	}

	/**
	 * Takes an export folder the author typed or picked, refused and put back
	 * the same way as a project root; an empty box is the default folder.
	 */
	private async commitExportFolder(
		value: string,
		field: ProjectRootField,
	): Promise<void> {
		if (!isValidProjectRoot(value)) {
			new Notice(this.t('settings.exportFolder.invalid'));
			field.showValue(this.owner.settings.exportFolder);
			return;
		}
		const folder = normalizeProjectRoot(value);
		if (folder !== this.owner.settings.exportFolder) {
			await this.setControlValue('exportFolder', folder);
		}
		field.showValue(this.owner.settings.exportFolder);
	}

	getControlValue(key: string): unknown {
		if (!SETTINGS_KEYS.has(key as keyof SnowflakeSettings)) {
			return undefined;
		}
		if (key === 'projectRoot') {
			return displayProjectRoot(this.owner.settings.projectRoot);
		}
		return this.owner.settings[key as keyof SnowflakeSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!SETTINGS_KEYS.has(key as keyof SnowflakeSettings)) {
			return;
		}

		switch (key) {
			case 'projectRoot':
				if (typeof value === 'string') {
					this.owner.settings.projectRoot = normalizeProjectRoot(value);
				}
				break;
			case 'uiLocale':
				if (isUiLocale(value)) this.owner.settings.uiLocale = value;
				break;
			case 'defaultProjectLocale':
				if (isDefaultProjectLocale(value)) {
					this.owner.settings.defaultProjectLocale = value;
				}
				break;
			case 'freeformMode':
				if (typeof value === 'boolean') {
					this.owner.settings.freeformMode = value;
				}
				break;
			case 'writingCountMode':
				if (isWritingCountMode(value)) {
					this.owner.settings.writingCountMode = value;
				}
				break;
			case 'writingCountHeadings':
				if (isWritingCountHeadings(value)) {
					this.owner.settings.writingCountHeadings = value;
				}
				break;
			case 'openLongTextInSplit':
				if (typeof value === 'boolean') {
					this.owner.settings.openLongTextInSplit = value;
				}
				break;
			case 'reduceMotion':
				if (typeof value === 'boolean') {
					this.owner.settings.reduceMotion = value;
				}
				break;
			case 'protectManagedBoundaries':
				if (typeof value === 'boolean') {
					this.owner.settings.protectManagedBoundaries = value;
				}
				break;
			case 'showTableProgressStatus':
				if (typeof value === 'boolean') {
					this.owner.settings.showTableProgressStatus = value;
				}
				break;
			case 'showTableActionsColumn':
				if (typeof value === 'boolean') {
					this.owner.settings.showTableActionsColumn = value;
				}
				break;
			case 'createFromField':
				if (isCreateFromFieldMode(value)) {
					this.owner.settings.createFromField = value;
				}
				break;
			case 'manuscriptWindow':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.manuscriptWindow = value;
				}
				break;
			case 'showManuscriptPath':
				if (typeof value === 'boolean') {
					this.owner.settings.showManuscriptPath = value;
				}
				break;
			case 'showManuscriptSequence':
				if (typeof value === 'boolean') {
					this.owner.settings.showManuscriptSequence = value;
				}
				break;
			case 'manuscriptMilestones':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptMilestones = value;
				}
				break;
			case 'manuscriptMilestoneMode':
				if (isMilestoneMode(value)) {
					this.owner.settings.manuscriptMilestoneMode = value;
				}
				break;
			case 'manuscriptMilestoneInterval':
				if (isMilestoneInterval(value)) {
					this.owner.settings.manuscriptMilestoneInterval = value;
				}
				break;
			case 'manuscriptChapterNumbering':
				if (isChapterNumberingStyle(value)) {
					this.owner.settings.manuscriptChapterNumbering = value;
					// The custom rule's rows follow the choice at once.
					this.update();
				}
				break;
			case 'exportFolder':
				if (typeof value === 'string') {
					this.owner.settings.exportFolder = normalizeProjectRoot(value);
				}
				break;
			case 'exportFormat':
				if (isExportFormat(value)) this.owner.settings.exportFormat = value;
				break;
			case 'exportIndent':
				if (typeof value === 'boolean') this.owner.settings.exportIndent = value;
				break;
			case 'exportParagraphSpacing':
				if (typeof value === 'boolean') {
					this.owner.settings.exportParagraphSpacing = value;
				}
				break;
			case 'exportManuscriptLayout':
				if (isExportLayout(value)) {
					this.owner.settings.exportManuscriptLayout = value;
					// The separator row follows the layout at once.
					this.update();
				}
				break;
			case 'exportChapterSeparator':
				if (isExportSeparator(value)) {
					this.owner.settings.exportChapterSeparator = value;
				}
				break;
			case 'manuscriptTypewriter':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptTypewriter = value;
				}
				break;
			case 'manuscriptAutoPairBrackets':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptAutoPairBrackets = value;
				}
				break;
			case 'manuscriptAutoPairMarkdown':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptAutoPairMarkdown = value;
				}
				break;
			case 'manuscriptEnterParagraph':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptEnterParagraph = value;
				}
				break;
			case 'manuscriptFocusLevel':
				if (isManuscriptFocusLevel(value)) {
					this.owner.settings.manuscriptFocusLevel = value;
				}
				break;
			// The page's dress. Each value is held to the same range the load
			// path holds it to, so what a slider, a swatch or a field hands over
			// lands exactly as it would have from disk.
			case 'manuscriptFontFamily':
				if (typeof value === 'string') {
					this.owner.settings.manuscriptFontFamily = sanitizeFontFamily(value);
					// The face goes to the top of the picker's list wherever it
					// was set, so both places offer the same recent few.
					this.owner.settings.manuscriptRecentFonts = rememberFontFamily(
						this.owner.settings.manuscriptRecentFonts,
						this.owner.settings.manuscriptFontFamily,
					);
				}
				break;
			case 'manuscriptFontSize':
				if (typeof value === 'number') {
					this.owner.settings.manuscriptFontSize = sanitizeFontSize(value);
				}
				break;
			case 'manuscriptLineHeight':
				if (typeof value === 'number') {
					this.owner.settings.manuscriptLineHeight = sanitizeLineHeight(value);
				}
				break;
			case 'manuscriptContentWidth':
				if (typeof value === 'number') {
					this.owner.settings.manuscriptContentWidth =
						sanitizeContentWidth(value);
				}
				break;
			case 'manuscriptParagraphSpacing':
				if (typeof value === 'number') {
					this.owner.settings.manuscriptParagraphSpacing =
						sanitizeParagraphSpacing(value);
				}
				break;
			case 'manuscriptFirstLineIndent':
				if (typeof value === 'number') {
					this.owner.settings.manuscriptFirstLineIndent =
						sanitizeFirstLineIndent(value);
				}
				break;
			case 'manuscriptTextAlign':
				if (isManuscriptTextAlign(value)) {
					this.owner.settings.manuscriptTextAlign = value;
				}
				break;
			case 'manuscriptHyphenation':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptHyphenation = value;
				}
				break;
			case 'manuscriptTintLight':
				if (typeof value === 'string') {
					this.owner.settings.manuscriptTintLight = sanitizeTint(value);
				}
				break;
			case 'manuscriptTintDark':
				if (typeof value === 'string') {
					this.owner.settings.manuscriptTintDark = sanitizeTint(value);
				}
				break;
			case 'manuscriptGuide':
				if (isManuscriptGuide(value)) {
					this.owner.settings.manuscriptGuide = value;
				}
				break;
			// The analysis switches. The rules array itself has no case here:
			// its list mutates through the plugin's own update path, the way
			// the recent fonts do.
			case 'customHighlightsEnabled':
				if (typeof value === 'boolean') {
					this.owner.settings.customHighlightsEnabled = value;
				}
				break;
			case 'sensitiveHighlight':
				if (typeof value === 'boolean') {
					this.owner.settings.sensitiveHighlight = value;
				}
				break;
			case 'sensitiveWords':
				if (typeof value === 'string') {
					this.owner.settings.sensitiveWords = boundedText(value);
				}
				break;
			case 'dialogueQuotesCurly':
				if (typeof value === 'boolean') {
					this.owner.settings.dialogueQuotesCurly = value;
				}
				break;
			case 'dialogueQuotesStraight':
				if (typeof value === 'boolean') {
					this.owner.settings.dialogueQuotesStraight = value;
				}
				break;
			case 'dialogueQuotesCorner':
				if (typeof value === 'boolean') {
					this.owner.settings.dialogueQuotesCorner = value;
				}
				break;
			case 'dialogueQuotesWhite':
				if (typeof value === 'boolean') {
					this.owner.settings.dialogueQuotesWhite = value;
				}
				break;
			case 'dialoguePresentation':
				if (isDialoguePresentation(value)) {
					this.owner.settings.dialoguePresentation = value;
				}
				break;
			case 'readingWordsPerMinute':
				if (typeof value === 'number') {
					this.owner.settings.readingWordsPerMinute = readingSpeed(
						value,
						DEFAULT_SETTINGS.readingWordsPerMinute,
						2000,
					);
				}
				break;
			case 'readingCjkCharactersPerMinute':
				if (typeof value === 'number') {
					this.owner.settings.readingCjkCharactersPerMinute = readingSpeed(
						value,
						DEFAULT_SETTINGS.readingCjkCharactersPerMinute,
						3000,
					);
				}
				break;
			case 'customStopwords':
				if (typeof value === 'string') {
					this.owner.settings.customStopwords = boundedText(value);
				}
				break;
			case 'manuscriptMentionHighlight':
				if (isMentionHighlightMode(value)) {
					this.owner.settings.manuscriptMentionHighlight = value;
				}
				break;
			case 'sessionIdleThresholdSeconds':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.sessionIdleThresholdSeconds = value;
				}
				break;
			case 'sessionCountdownMinutes':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.sessionCountdownMinutes = value;
				}
				break;
			case 'sessionPomodoroWorkMinutes':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.sessionPomodoroWorkMinutes = value;
				}
				break;
			case 'sessionPomodoroBreakMinutes':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.sessionPomodoroBreakMinutes = value;
				}
				break;
			case 'sessionPomodoroAutoRepeat':
				if (typeof value === 'boolean') {
					this.owner.settings.sessionPomodoroAutoRepeat = value;
				}
				break;
			case 'sessionAutoWithFocusMode':
				if (typeof value === 'boolean') {
					this.owner.settings.sessionAutoWithFocusMode = value;
				}
				break;
			case 'sessionTrackUntimedWords':
				if (typeof value === 'boolean') {
					this.owner.settings.sessionTrackUntimedWords = value;
				}
				break;
			// Typed rather than dragged, so a whole number is what the field
			// means rather than what it can only produce: 1500.5 words is a
			// goal of 1501 rather than a goal that silently failed to save.
			case 'sessionDailyWordGoalProject':
				if (typeof value === 'number' && Number.isFinite(value)) {
					this.owner.settings.sessionDailyWordGoalProject =
						clampSessionValue('dailyWordGoal', value);
				}
				break;
			case 'sessionDailyWordGoalManuscript':
				if (typeof value === 'number' && Number.isFinite(value)) {
					this.owner.settings.sessionDailyWordGoalManuscript =
						clampSessionValue('dailyWordGoal', value);
				}
				break;
			case 'sessionDailyGoalScope':
				if ((WRITING_SESSION_SCOPES as readonly unknown[]).includes(value)) {
					this.owner.settings.sessionDailyGoalScope = value as WritingSessionScope;
				}
				break;
			case 'sessionDefaultType':
				if ((WRITING_SESSION_TYPES as readonly unknown[]).includes(value)) {
					this.owner.settings.sessionDefaultType = value as WritingSessionType;
				}
				break;
			case 'sessionWritingMode':
				if ((WRITING_MODES as readonly unknown[]).includes(value)) {
					this.owner.settings.sessionWritingMode = value as WritingMode;
				}
				break;
			case 'sessionStopwatchExpectedMinutes':
				if (typeof value === 'number' && Number.isInteger(value)) {
					this.owner.settings.sessionStopwatchExpectedMinutes = value;
				}
				break;
			case 'sessionScope':
				if ((WRITING_SESSION_SCOPES as readonly unknown[]).includes(value)) {
					this.owner.settings.sessionScope = value as WritingSessionScope;
				}
				break;
			case 'sessionWeekStart':
				if (isWeekStartDay(value)) {
					this.owner.settings.sessionWeekStart = value;
				}
				break;
			case 'sessionDateFormat':
				if (isDateFormat(value)) {
					this.owner.settings.sessionDateFormat = value;
				}
				break;
			default:
				// A key with no case above is saved and announced but never stored,
				// so the control moves and nothing happens. Every key in
				// SETTINGS_KEYS needs a case here; the test below holds it to that.
				break;
		}

		this.writing = true;
		try {
			// A presentation key dresses the page from the settings in memory and
			// wants nothing from the disk, so it is answered first and the file
			// catches up once the slider stops. Everything else is written before
			// it is announced, since what hears of it may go on to read the file.
			// Either way the announcement reaches this page again through
			// refreshPresentationRows, which declines while this flag is up: the
			// row that started it is already showing what it wrote.
			if (isManuscriptPresentationKey(key)) {
				await this.owner.handleSettingsChanged(key);
				this.owner.saveSettingsSoon();
			} else {
				await this.owner.saveSettings();
				await this.owner.handleSettingsChanged(key);
			}
		} finally {
			this.writing = false;
		}
		// uiLocale is rebuilt here because every label on the page is resolved
		// through it.
		if (key === 'uiLocale') this.update();
	}
}
