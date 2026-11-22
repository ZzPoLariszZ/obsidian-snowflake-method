import type { ApiHost } from '../../../api/host';
import type { Access } from '../../../api/spec/operations';
import { DEFAULT_STOPWORDS, DIALOGUE_STYLE_TOKENS, parseQuotePair, type DialogueStyle, type MentionSource } from '../../../src/domain';
import {
	SnowflakeProjectService,
	entitiesOf,
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
	};
	/** The vault the services stand on, with its own records of what was read and written. */
	readonly environment: ReturnType<typeof createFakeEnvironment>;
	/** Makes the plugin ready, as Obsidian does once it has read the vault. */
	becomeReady(): void;
	/** How many pieces of work ran as the plugin's own. */
	ranAsPlugin: number;
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
		...start,
	};
	let release: (() => void) | null = null;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const environment = createFakeEnvironment();
	const projects = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
	const host: FakeHost = {
		state,
		environment,
		ranAsPlugin: 0,
		becomeReady: () => {
			state.ready = true;
			release?.();
		},
		projects,
		roster: async () => ({
			active: await projects.discoverProjects(),
			archived: await projects.listArchivedProjects(),
		}),
		currentProjectPath: () => state.current,
		countOptions: () => state.counting,
		today: () => state.today,
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
			return run();
		},
	};
	return host;
}
