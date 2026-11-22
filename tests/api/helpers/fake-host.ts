import type { ApiHost } from '../../../api/host';
import type { Access } from '../../../api/spec/operations';
import {
	DEFAULT_STOPWORDS,
	DIALOGUE_STYLE_TOKENS,
	compileChapterNumbering,
	parseQuotePair,
	type ChapterNumberingSettings,
	type DerivedTaskSources,
	type DialogueStyle,
	type MentionSource,
	type WritingSessionScope,
} from '../../../src/domain';
import {
	ModificationHistoryService,
	SnowflakeProjectService,
	WritingSessionService,
	entitiesOf,
	isStickyNotePath,
	toWikiLink,
	type NoteCountOptions,
	type ProjectSnapshot,
} from '../../../src/services';
import { entityGroupsOf } from '../../../src/ui/entity-form';
import { collectWikilinkTargets, type WikilinkSourceRecord } from '../../../src/ui/wikilink-complete';
import { createFakeEnvironment } from '../../helpers/fake-vault';

/**
 * The names a project's notes are mentioned by, gathered the way the plugin
 * gathers them for its own link popup.
 */
function mentionSourcesOf(project: ProjectSnapshot): MentionSource[] {
	const asSource = (record: { path: string; rank: number; aliases: string[] }, name: string): WikilinkSourceRecord => ({
		path: record.path,
		name,
		rank: record.rank,
		aliases: record.aliases,
	});
	const times = entitiesOf(project, 'time');
	return collectWikilinkTargets(
		{
			groups: entityGroupsOf(project.worldbuildingKinds),
			characters: project.characters.map((record) => asSource(record, record.name)),
			scenes: project.scenes.map((record) => asSource(record, record.title)),
			timeOf: (kind) =>
				times
					.filter((entity) => (kind === 'point' ? entity.timeKind === 'point' || entity.timeKind === null : entity.timeKind === kind))
					.map((entity) => asSource(entity, entity.name)),
			ofKind: (kind) => entitiesOf(project, kind).map((entity) => asSource(entity, entity.name)),
		},
		(group) => group,
		toWikiLink,
	);
}

/**
 * A plugin for the API to stand on in a test: the real project service on a
 * vault kept in memory, every other answer the real plugin gives made
 * settable, and a record of what was asked of it.
 */
export interface FakeHost extends ApiHost {
	state: {
		access: Access;
		ready: boolean;
		leaving: boolean;
		port: number;
		token: string | null;
		cli: boolean;
		/** The metadata note of the project the author last worked in. */
		current: string | null;
		/** The convention writing is counted by. */
		counting: NoteCountOptions;
		/** The day it is. */
		today: string;
		/** The words the author watches for. */
		sensitiveWords: string[];
		/** The quotation marks dialogue is read by. */
		dialogue: DialogueStyle[];
		/** Words the author added to the common ones a count of words leaves out. */
		stopwords: string[];
		/** The notes a session's words are shown in, and the ones the daily goal is set in. */
		sessionScope: WritingSessionScope;
		goalScope: WritingSessionScope;
		/**
		 * What the task board's derived cards are worked out from. The plugin
		 * gathers this from its own screens' readings, which are not here to
		 * be asked, so a test says what they would have found.
		 */
		derived: { sources: DerivedTaskSources; failed: boolean };
		/** The author's chapter numbering rule. */
		numbering: ChapterNumberingSettings;
		/** Whether Obsidian is set to ask before it updates the links to a note that moved. */
		asksAboutLinks: boolean;
	};
	/** The vault the services stand on, with its own records of what was read and written. */
	readonly environment: ReturnType<typeof createFakeEnvironment>;
	/** Makes the plugin ready, as Obsidian does once it has read the vault. */
	becomeReady(): void;
	/** How many pieces of work ran as the plugin's own. */
	ranAsPlugin: number;
	/**
	 * What was asked of the author's editors, in the order it was asked,
	 * with each body written set among it: `settle` and `release` with the
	 * notes named, and `write` with the note written.
	 */
	readonly editors: string[];
	/**
	 * What the author has typed and not saved, by note. Settling writes it
	 * to the note as the author's own, as a stream does, and forgets it.
	 */
	readonly typed: Map<string, string>;
	/**
	 * What the screens were told had changed, in the order they were told:
	 * `tasks`, `margin` or `stickyNotes`, and `deleted <id>` for a sticky
	 * note that is gone for good.
	 */
	readonly told: string[];
	/**
	 * Whose words each write carried, as the repository told it of every
	 * body written and every note made: true for the author's own typing. A
	 * test empties it and reads what one call added.
	 */
	readonly origins: boolean[];
}

export function createFakeHost(start: Partial<FakeHost['state']> = {}): FakeHost {
	const state: FakeHost['state'] = {
		access: 'delete',
		ready: true,
		leaving: false,
		port: 27125,
		token: 'snowflake_test',
		cli: true,
		current: null,
		counting: { mode: 'ms-word', headings: 'count' },
		today: '2026-03-10',
		sensitiveWords: [],
		dialogue: [DIALOGUE_STYLE_TOKENS.curly, DIALOGUE_STYLE_TOKENS.straight].flatMap((token) => parseQuotePair(token) ?? []),
		stopwords: [],
		sessionScope: 'project',
		goalScope: 'manuscript',
		numbering: { style: 'english', rules: [] },
		asksAboutLinks: false,
		derived: {
			sources: {
				dailyGoal: 0,
				goalNet: { day: 0, week: 0, month: 0 },
				daysInMonth: 31,
				unresolvedMentions: 0,
				sensitiveWords: 0,
				openForeshadowings: 0,
				unresolvedForeshadowings: 0,
				pendingRevisions: 0,
				unresolvedRevisions: 0,
				stickyNotes: 0,
			},
			failed: false,
		},
		...start,
	};
	let release: (() => void) | null = null;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const environment = createFakeEnvironment();
	// Noon of the day it is, in the zone every test reads days in.
	const now = (): number => Date.parse(`${state.today}T12:00:00.000Z`);
	// The records the services stamp are stamped by the same clock, so a test can say when a thing was changed.
	const projects = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache, undefined, { now });
	// A clock that runs nothing by itself: a breath is taken at once, and whatever waits on a real delay waits for the test to ask.
	const timers = {
		set: (handler: () => void, ms: number): unknown => {
			if (ms === 0) handler();
			return 0;
		},
		clear: (): void => undefined,
	};
	const nothingKept = { load: (): unknown => null, save: (): void => undefined };
	const origins: boolean[] = [];
	const editors: string[] = [];
	const told: string[] = [];
	const typed = new Map<string, string>();
	const mintedRecords = new Map<string, number>();
	projects.repository.onBodyWrite = (path, _before, _after, userInput) => {
		origins.push(userInput);
		editors.push(`write ${path}`);
	};
	projects.repository.onManagedFileCreated = (_path, _content, userInput) => {
		origins.push(userInput);
	};
	projects.repository.asksBeforeLinkUpdates = () => state.asksAboutLinks;
	const sessions = new WritingSessionService({
		repository: projects.repository,
		writingCount: projects.writingCount,
		recovery: nothingKept,
		untimedRecovery: nothingKept,
		deviceId: () => 'device-test',
		scope: () => state.sessionScope,
		goalScope: () => state.goalScope,
		isNoteOpen: () => false,
		trackUntimed: () => false,
		projectAtPath: () => null,
		countOptions: () => state.counting,
		timers,
		now,
		timezone: () => 'UTC',
	});
	let minted = 0;
	const history = new ModificationHistoryService({
		repository: projects.repository,
		writingCount: projects.writingCount,
		tallies: sessions,
		// Obsidian's own file recovery is not there to be read in a test.
		reader: () => null,
		projects: () => [],
		projectAtPath: () => null,
		frontmatterNow: () => null,
		countOptions: () => state.counting,
		cursor: nothingKept,
		pending: nothingKept,
		mint: () => {
			minted += 1;
			return `history-event-${String(minted)}`;
		},
		deviceId: () => 'device-test',
		timezone: () => 'UTC',
		timers,
		now,
	});
	// Wired as the plugin wires them: what is done to a record is put down in the history.
	projects.tasks.onEvent = (project, event) => {
		history.taskEvent(project, event);
	};
	projects.foreshadowing.onEvent = (project, event) => {
		history.threadEvent(project, event);
	};
	projects.revisions.onEvent = (project, event) => {
		history.revisionEvent(project, event);
	};
	const host: FakeHost = {
		state,
		environment,
		ranAsPlugin: 0,
		origins,
		editors,
		told,
		typed,
		becomeReady: () => {
			state.ready = true;
			release?.();
		},
		projects,
		sessions,
		history,
		roster: async () => ({
			active: await projects.discoverProjects(),
			archived: await projects.listArchivedProjects(),
		}),
		currentProjectPath: () => state.current,
		countOptions: () => state.counting,
		today: () => state.today,
		sessionScopes: () => ({ shown: state.sessionScope, goal: state.goalScope }),
		derivedTaskSources: () => Promise.resolve(state.derived),
		analysisConfig: (project) =>
			Promise.resolve({
				sensitiveTerms: state.sensitiveWords,
				dialogueStyles: state.dialogue,
				count: state.counting,
				locale: project.locale,
				entityTerms: mentionSourcesOf(project).map((source) => source.label),
			}),
		mentionSources: (project) => Promise.resolve(mentionSourcesOf(project)),
		frequencyFilters: (project) =>
			Promise.resolve({
				stopwords: new Set([...DEFAULT_STOPWORDS[project.locale], ...state.stopwords]),
				names: new Set(mentionSourcesOf(project).map((source) => source.label.trim().normalize('NFC').toLowerCase())),
			}),
		pluginVersion: () => '9.9.9',
		vaultName: () => 'Test Vault',
		projectsRoot: () => 'Snowflake Projects',
		port: () => state.port,
		access: () => state.access,
		token: () => state.token,
		cliEnabled: () => state.cli,
		ready: () => (state.ready ? Promise.resolve() : waiting),
		isReady: () => state.ready,
		leaving: () => state.leaving,
		asPlugin: async (run) => {
			host.ranAsPlugin += 1;
			return history.asPlugin(() => projects.repository.unattended(run));
		},
		asksBeforeLinkUpdates: () => state.asksAboutLinks,
		settleNotes: async (paths) => {
			editors.push(`settle ${paths.join(', ')}`);
			// A stream writes every note it holds typing for, whichever was asked after, and so does a sticky note's editor.
			for (const [path, body] of [...typed]) {
				typed.delete(path);
				if (isStickyNotePath(path)) {
					const standing = await projects.stickyNotes.read(path);
					if (standing !== null) await projects.stickyNotes.writeBody(path, body, standing.revision);
					continue;
				}
				const standing = await projects.manuscript.readSegment(path);
				await projects.manuscript.writeSegment(path, body, standing.revision);
			}
		},
		releaseNotes: (paths) => {
			editors.push(`release ${paths.join(', ')}`);
			return Promise.resolve();
		},
		chapterNumbering: () => compileChapterNumbering(state.numbering),
		now,
		// Ids a test can name: the first task made through the API is `task-made-1`.
		mint: (kind) => {
			const count = (mintedRecords.get(kind) ?? 0) + 1;
			mintedRecords.set(kind, count);
			return `${kind}-made-${String(count)}`;
		},
		recordsChanged: (what) => {
			told.push(what);
		},
		stickyNoteDeleted: (id) => {
			told.push(`deleted ${id}`);
		},
		// The project manager's work as the plugin does it, less the screens it keeps in step.
		createProject: (request) => projects.createProject({ ...request, userInput: false }),
		renameProject: async (project, title) => {
			const renamed = await projects.renameProject(project.projectFile, title, { userInput: false });
			// The plugin goes on working in the project it was working in, under the name it has now.
			if (state.current === project.projectFile) state.current = renamed.projectFile;
			return renamed;
		},
		setProjectSeries: (project, series) => projects.setSeries(project.projectFile, series),
		archiveProject: (project) => projects.archiveProject(project.projectFile),
		restoreProject: (project) => projects.restoreProject(project.projectFile),
	};
	return host;
}
