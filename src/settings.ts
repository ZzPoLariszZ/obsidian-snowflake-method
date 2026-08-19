import {
	App,
	Notice,
	moment,
	normalizePath,
	PluginSettingTab,
	type Setting,
	type SettingDefinitionItem,
} from 'obsidian';

import type SnowflakeMethodPlugin from './main';
import {
	BAND_SPANS,
	DATE_FORMATS,
	READING_MEASURES,
	TREND_RANGES,
	WEEK_START_DAYS,
	WRITING_MODES,
	WRITING_SESSION_SCOPES,
	WRITING_SESSION_TYPES,
	isDateFormat,
	isWeekStartDay,
	isWritingCountHeadings,
	isWritingCountMode,
	weekdayLabels,
	type BandSpan,
	type DateFormat,
	type ReadingMeasure,
	type WeekStartDay,
	type WritingCountHeadings,
	type WritingCountMode,
	type WritingMode,
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
	/** The line being written held at the middle of the page. */
	manuscriptTypewriter: boolean;
	manuscriptFocusLevel: ManuscriptFocusLevel;
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
	showTableActionsColumn: true,
	createFromField: 'form',
	manuscriptWindow: 5,
	showManuscriptPath: true,
	showManuscriptSequence: false,
	manuscriptTypewriter: true,
	manuscriptFocusLevel: 'off',
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
	'showTableActionsColumn',
	'createFromField',
	'manuscriptWindow',
	'showManuscriptPath',
	'showManuscriptSequence',
	'manuscriptTypewriter',
	'manuscriptFocusLevel',
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
		manuscriptTypewriter:
			typeof raw.manuscriptTypewriter === 'boolean'
				? raw.manuscriptTypewriter
				: DEFAULT_SETTINGS.manuscriptTypewriter,
		manuscriptFocusLevel: readFocusLevel(raw),
		sessionIdleThresholdSeconds: integerIn(
			raw.sessionIdleThresholdSeconds,
			30,
			300,
			DEFAULT_SETTINGS.sessionIdleThresholdSeconds,
		),
		sessionCountdownMinutes: integerIn(
			raw.sessionCountdownMinutes,
			5,
			180,
			DEFAULT_SETTINGS.sessionCountdownMinutes,
		),
		sessionPomodoroWorkMinutes: integerIn(
			raw.sessionPomodoroWorkMinutes,
			5,
			90,
			DEFAULT_SETTINGS.sessionPomodoroWorkMinutes,
		),
		sessionPomodoroBreakMinutes: integerIn(
			raw.sessionPomodoroBreakMinutes,
			1,
			30,
			DEFAULT_SETTINGS.sessionPomodoroBreakMinutes,
		),
		sessionPomodoroAutoRepeat:
			typeof raw.sessionPomodoroAutoRepeat === 'boolean'
				? raw.sessionPomodoroAutoRepeat
				: DEFAULT_SETTINGS.sessionPomodoroAutoRepeat,
		sessionDailyWordGoalProject: integerIn(
			raw.sessionDailyWordGoalProject,
			0,
			1_000_000,
			DEFAULT_SETTINGS.sessionDailyWordGoalProject,
		),
		sessionDailyWordGoalManuscript: integerIn(
			raw.sessionDailyWordGoalManuscript,
			0,
			1_000_000,
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
			0,
			1_440,
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

/** An integer inside the range, or the default: rejected, never clamped. */
function integerIn(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	return typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= min &&
		value <= max
		? value
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

export class SnowflakeSettingTab extends PluginSettingTab {
	private readonly owner: SnowflakeMethodPlugin;

	constructor(app: App, plugin: SnowflakeMethodPlugin) {
		super(app, plugin);
		this.owner = plugin;
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

	private t(key: string): string {
		// This page is global UI, so 'project' falls back to Obsidian's language
		// -- but an explicit English or Chinese choice has to be honoured here,
		// including on the control that sets it.
		return translate(
			resolveGlobalLocale(this.owner.settings.uiLocale, moment.locale()),
			key,
		);
	}


	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
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
				name: this.t('settings.split.name'),
				desc: this.t('settings.split.desc'),
				control: {
					type: 'toggle',
					key: 'openLongTextInSplit',
					defaultValue: DEFAULT_SETTINGS.openLongTextInSplit,
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
				name: this.t('settings.protectBoundaries.name'),
				desc: this.t('settings.protectBoundaries.desc'),
				control: {
					type: 'toggle',
					key: 'protectManagedBoundaries',
					defaultValue: DEFAULT_SETTINGS.protectManagedBoundaries,
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
			// Under a heading of their own: three settings that mean nothing to an
			// author who never opens the manuscript, and that would otherwise sit
			// among the ones that govern the whole plugin.
			{
				type: 'group',
				heading: this.t('settings.manuscript.heading'),
				cls: 'snowflake-method-manuscript-settings',
				items: [
					{
						name: this.t('settings.manuscriptWindow.name'),
						desc: this.t('settings.manuscriptWindow.desc'),
						control: {
							type: 'slider',
							key: 'manuscriptWindow',
							defaultValue: DEFAULT_SETTINGS.manuscriptWindow,
							min: 0,
							max: 25,
							step: 1,
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
				],
			},
			// A session starts from the status bar or the palette. What lives here
			// is what a new one starts with, and how the statistics read it back:
			// what counts as a word, then the clock, then how a session begins, then
			// the goal, then how the numbers are shown. A session already running
			// keeps what it began under.
			{
				type: 'group',
				heading: this.t('settings.session.heading'),
				cls: 'snowflake-method-session-settings',
				items: [
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
						control: {
							type: 'slider',
							key: 'sessionIdleThresholdSeconds',
							defaultValue: DEFAULT_SETTINGS.sessionIdleThresholdSeconds,
							min: 30,
							max: 300,
							step: 15,
						},
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
				],
			},
		];
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
		const dress = (): void => {
			const level = this.owner.settings.manuscriptFocusLevel;
			value.setText(this.t(labelKeys[level]));
			setting.setDesc(this.t(`settings.manuscriptFocus.${level}`));
		};
		dress();
		setting.addSlider((slider) =>
			slider
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
				}),
		);
	}

	/**
	 * Builds the project-root field into a setting row, and reports back how to
	 * take it down again — the list it can leave open outlives the row itself.
	 */
	private renderProjectRoot(setting: Setting): () => void {
		const field = buildProjectRootField(this.app, setting.controlEl, {
			label: this.t('settings.projectRoot.name'),
			placeholder: this.t('settings.projectRoot.placeholder'),
			currentRoot: this.owner.settings.projectRoot,
			onChooseRoot: (root) => {
				void this.commitProjectRoot(root, field);
			},
		});
		const commit = (): void => {
			void this.commitProjectRoot(field.inputEl.value, field);
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
			case 'manuscriptTypewriter':
				if (typeof value === 'boolean') {
					this.owner.settings.manuscriptTypewriter = value;
				}
				break;
			case 'manuscriptFocusLevel':
				if (isManuscriptFocusLevel(value)) {
					this.owner.settings.manuscriptFocusLevel = value;
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
			// Typed rather than dragged, so a whole number is what the field
			// means rather than what it can only produce: 1500.5 words is a
			// goal of 1501 rather than a goal that silently failed to save.
			case 'sessionDailyWordGoalProject':
				if (typeof value === 'number' && Number.isFinite(value)) {
					this.owner.settings.sessionDailyWordGoalProject =
						Math.max(0, Math.round(value));
				}
				break;
			case 'sessionDailyWordGoalManuscript':
				if (typeof value === 'number' && Number.isFinite(value)) {
					this.owner.settings.sessionDailyWordGoalManuscript =
						Math.max(0, Math.round(value));
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

		await this.owner.saveSettings();
		// handleSettingsChanged rebuilds this page for the keys whose rows
		// describe the value in force; uiLocale is rebuilt here because every
		// label on the page is resolved through it.
		await this.owner.handleSettingsChanged(key);
		if (key === 'uiLocale') this.update();
	}
}
