import type { ChapterNumbering, DerivedTaskSources, MentionSource, ProjectLanguage, WritingSessionScope } from '../src/domain';
import type {
	AnalysisConfig,
	ModificationHistoryService,
	NoteCountOptions,
	ProjectRef,
	ProjectSeries,
	ProjectSnapshot,
	SnowflakeProjectService,
	WritingSessionService,
} from '../src/services';
import type { Access } from './spec/operations';

/**
 * What the plugin hands the local API. The API is given the services and a
 * handful of answers only the plugin can give, and nothing of the screens:
 * no view, no dialog, no notice. Everything here is asked for by name, so
 * what the API can reach is read off this one list.
 */
export interface ApiHost {
	/** The plugin's own service for projects, with every other service it owns. */
	readonly projects: SnowflakeProjectService;
	/** The plugin's record of the author's sittings, on every device that writes in the vault. */
	readonly sessions: WritingSessionService;
	/** The plugin's record of what happened to each project's notes and records. */
	readonly history: ModificationHistoryService;
	/**
	 * Every project under the folder the author keeps projects in, and every
	 * one in the archive beside them, each by its title.
	 */
	roster(): Promise<{ active: ProjectRef[]; archived: ProjectRef[] }>;
	/** The metadata note of the project the author last worked in, or null. */
	currentProjectPath(): string | null;
	/**
	 * What the cards the plugin derives for the task board are worked out
	 * from: the author's goal with how far the writing has come, and how
	 * much is waiting in each place the board points at. `failed` says one
	 * of them could not be read, and is told as nothing waiting there.
	 */
	derivedTaskSources(project: ProjectSnapshot): Promise<{ sources: DerivedTaskSources; failed: boolean }>;
	/** The convention writing is counted by, as the author set it. */
	countOptions(): NoteCountOptions;
	/** The day it is on this computer's calendar, as `YYYY-MM-DD`: the day the author's own boards go by. */
	today(): string;
	/** The notes a session's words are counted in as the author is shown them, and the ones the daily goal is set in. */
	sessionScopes(): { shown: WritingSessionScope; goal: WritingSessionScope };
	/**
	 * What the manuscript's analysis reads of the author's settings, for one
	 * project: the words to watch for, the quotation marks that are read,
	 * and the convention writing is counted by.
	 */
	analysisConfig(project: ProjectSnapshot): Promise<AnalysisConfig>;
	/**
	 * The names and aliases a project's notes are mentioned by: the very
	 * ones the plugin offers when a link is typed, so what the API finds is
	 * what the author's own screens mark.
	 */
	mentionSources(project: ProjectSnapshot): Promise<readonly MentionSource[]>;
	/**
	 * What a count of the words used most leaves out unless it is asked to
	 * keep them: the common words of the project's language with the
	 * author's own additions, and the names of the project's notes.
	 */
	frequencyFilters(project: ProjectSnapshot): Promise<{ stopwords: ReadonlySet<string>; names: ReadonlySet<string> }>;
	/** The plugin's version, as its manifest states it. */
	pluginVersion(): string;
	/** The name of the vault this window has open. */
	vaultName(): string;
	/** The folder the author keeps projects in, as a path in the vault. Empty for the vault's own top folder. */
	projectsRoot(): string;
	/** The port the author chose for the listener. */
	port(): number;
	/** How far the author lets a caller go. */
	access(): Access;
	/** The access token, or null where none has been made or the store for secrets cannot be read. */
	token(): string | null;
	/** Whether the author lets calls in through Obsidian's own command line. */
	cliEnabled(): boolean;
	/**
	 * Settles once the plugin can list projects, which is after Obsidian has
	 * read the vault. `isReady` answers the same question without waiting.
	 */
	ready(): Promise<void>;
	isReady(): boolean;
	/** The plugin is being switched off, or the window is going. No call is started after this. */
	leaving(): boolean;
	/**
	 * Runs work whose writes are the plugin's own and not the author's
	 * typing. Whatever the history would put down to the author while it
	 * runs is put down to the plugin instead.
	 */
	asPlugin<T>(run: () => Promise<T>): Promise<T>;
	/**
	 * What the author has typed into these notes and not yet saved is
	 * written to their files, the editors left as they stand. Asked before a
	 * note is changed, so that the change is made against the author's
	 * latest words and never over them.
	 */
	settleNotes(paths: readonly string[]): Promise<void>;
	/**
	 * The plugin's own editor on each of these notes is closed, where one
	 * is open. Asked once a change is sure to be made: an editor left
	 * standing would write its own text back over the change the next time
	 * the author typed.
	 */
	releaseNotes(paths: readonly string[]): Promise<void>;
	/** The author's chapter numbering rule, or null while none is switched on. */
	chapterNumbering(): ChapterNumbering | null;
	/**
	 * The work of the plugin's project manager, without its words: each does
	 * what a button there does, under the folder the author keeps projects
	 * in, and keeps the plugin's own picture of the projects in step. A
	 * project made here is not made the one the author is working in.
	 */
	createProject(request: { title: string; locale: ProjectLanguage; series: ProjectSeries | null }): Promise<ProjectSnapshot>;
	renameProject(project: ProjectRef, title: string): Promise<ProjectSnapshot>;
	setProjectSeries(project: ProjectRef, series: ProjectSeries | null): Promise<void>;
	archiveProject(project: ProjectRef): Promise<ProjectRef>;
	restoreProject(project: ProjectRef): Promise<{ project: ProjectSnapshot; renamedFrom: string | null }>;
}
