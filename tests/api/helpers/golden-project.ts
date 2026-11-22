import type { DispatchReply } from '../../../api/dispatch';
import type { LocalApi } from '../../../api/index';
import {
	captureOccurrencePlacement,
	captureRevision,
	type OccurrencePlacement,
	type SessionWordTotals,
	type Task,
	type WritingSessionRecord,
} from '../../../src/domain';
import {
	definitionRootPath,
	nodeSelfPath,
	toWikiLink,
	type CharacterRecord,
	type ProjectRef,
	type ProjectSnapshot,
	type SceneRecord,
	type StickyNoteRecord,
	type WorldbuildingRecord,
} from '../../../src/services';
import { serializeCustomFields, type RecordLine } from '../../../src/templates';
import { createFakeHost, type FakeHost } from './fake-host';
import { createTestApi } from './fake-listener';
import { problemFaults, shapeFaults } from './shapes';

/**
 * A small vault for the API to be asked about: one project with something
 * of everything in it, a second in another language, and a third in the
 * archive. Everything in it is made through the plugin's own services, so
 * what the API reads back is what the plugin itself would have written.
 */
export interface Golden {
	host: FakeHost;
	api: LocalApi;
	/** The project most tests ask about: English, the first book of a series, the author's current one. */
	project: ProjectSnapshot;
	/** A second project, in Simplified Chinese. */
	chinese: ProjectSnapshot;
	/** A third, standing in the archive. */
	archived: ProjectRef;
	/** The members of the first project, by a name each test can ask for. */
	members: {
		/** A major character with everything filled in: a category, a world status, a field of her own. */
		ada: CharacterRecord;
		/** A supporting character with a relationship to Ada. */
		ben: CharacterRecord;
		/** A scene seen through Ada, with both of them in it, at midnight in the clocktower. */
		stops: SceneRecord;
		/** A scene with nothing in it but its title, told all-knowingly. */
		morning: SceneRecord;
		/** A moment, and a period that begins at it. */
		midnight: WorldbuildingRecord;
		winter: WorldbuildingRecord;
		/** A place. */
		tower: WorldbuildingRecord;
		/** A note of a kind the author made. */
		guild: WorldbuildingRecord;
	};
	/** The manuscript's notes in reading order: the one a project is made with, then two chapters. */
	manuscript: { draft: string; first: string; second: string };
	/**
	 * The sticky notes of the first project: one with something to say, one
	 * made a day later and still blank, and one set aside. The tasks, the
	 * foreshadowing threads and the revisions beside them are known by the
	 * ids they are made with below.
	 */
	stickyNotes: { key: StickyNoteRecord; blank: StickyNoteRecord; old: StickyNoteRecord };
	/** One call through the dispatcher, as a caller with the token. */
	call(
		operationId: string,
		params?: Record<string, unknown>,
		extra?: { body?: unknown; ifMatch?: string | null },
	): Promise<DispatchReply>;
	/** The project again as it stands now. */
	reload(): Promise<ProjectSnapshot>;
}

/** What the two chapters say. */
export const CHAPTER_ONE = '# Chapter 1\n\nThe clock stopped at midnight.\n';
export const CHAPTER_TWO = 'Ben did not come home.\n\nNobody asked why.\n';

/** The moment the records beside the project were made: 3 February 2026, half past nine, universal time. */
export const RECORDS_MADE = Date.UTC(2026, 1, 3, 9, 30);

/** Where some words stand in a text. */
function spanOf(body: string, words: string): { from: number; to: number } {
	const from = body.indexOf(words);
	if (from < 0) throw new Error(`The text says "${words}".`);
	return { from, to: from + words.length };
}

/** Some words marked in a note, as the note stood when they were. */
function marked(path: string, body: string, words: string): OccurrencePlacement {
	const { from, to } = spanOf(body, words);
	return captureOccurrencePlacement(path, body, from, to);
}

/**
 * A sitting another device recorded, begun at a moment of universal time
 * and run for so many minutes of writing and so many with nothing written.
 */
function sitting(
	began: string,
	minutes: { writing: number; idle: number },
	writingMode: WritingSessionRecord['writingMode'],
	words: { project: SessionWordTotals; manuscript: SessionWordTotals },
	notes: WritingSessionRecord['files'],
): WritingSessionRecord {
	const at = Date.parse(began);
	const written = at + minutes.writing * 60_000;
	const ended = written + minutes.idle * 60_000;
	const stretch = (from: number, to: number): { startedAt: string; endedAt: string }[] =>
		to > from ? [{ startedAt: new Date(from).toISOString(), endedAt: new Date(to).toISOString() }] : [];
	return {
		id: `session-${began}`,
		schemaVersion: 1,
		startedAt: new Date(at).toISOString(),
		endedAt: new Date(ended).toISOString(),
		timezone: 'UTC',
		sessionType: 'stopwatch',
		startMode: 'manual',
		writingMode,
		stopReason: 'manual',
		activeIntervals: stretch(at, written),
		idleIntervals: stretch(written, ended),
		pausedIntervals: [],
		words,
		files: notes,
		timing: { idleThresholdSeconds: 60 },
	};
}

/** Where the plugin keeps a project's sittings, one file for each device and month. */
export const SESSIONS_FOLDER = '70_Tool/71_Data_Statistics/711_Writing_Session';

export const STEP_ONE_TEXT = {
	genre: 'Winter mystery',
	'one-sentence-summary': 'A clockmaker finds the town’s stopped clock is counting down to a death.',
	'candidate-title-1': 'North Wind',
};

export async function createGolden(start: Partial<FakeHost['state']> = {}): Promise<Golden> {
	const host = createFakeHost(start);
	const service = host.projects;
	const { api } = createTestApi(host);

	const created = await service.createProject({ title: 'North Wind', locale: 'en', series: { name: 'Four Winds', book: 1 } });
	const stepOne = created.artifacts[1];
	if (stepOne === undefined) throw new Error('A new project has the note of step 1.');
	await service.updateSections(stepOne.path, STEP_ONE_TEXT, stepOne.revision);
	await service.updateStepStatus(created, 1, 'complete');
	await service.updateStepStatus(created, 2, 'in-progress');

	// What the project has agreed on, before a note names it.
	await service.addDefinitionPath(created, 'character', 'category', 'Guild/Clockmakers', 'Keepers of the town clock.');
	await service.addDefinitionPath(created, 'character', 'world-status', 'Mood/Calm', 'At ease.');
	await service.addDefinitionPath(created, 'character', 'relationship', 'Family/Sibling', 'A brother or a sister.');
	const label = (vocabulary: 'world-status' | 'relationship', path: string): RecordLine['label'] => ({
		path: nodeSelfPath(definitionRootPath(created, 'character', vocabulary), path),
		display: path,
	});
	const made = await service.createWorldbuildingKind(created, 'Faction', { icon: 'flag', description: 'Groups with a cause.' });
	if (!made.ok) throw new Error('The project takes a kind named Faction.');

	const midnight = await service.createEntity(created, { kind: 'time', name: 'Midnight', timeKind: 'point', description: 'The hour the clock stopped.' });
	const winter = await service.createEntity(created, {
		kind: 'time',
		name: 'The long winter',
		timeKind: 'period',
		timeStart: toWikiLink(midnight.path, 'Midnight'),
		timeEnd: 'the first thaw',
	});
	const tower = await service.createEntity(created, {
		kind: 'location',
		name: 'Clocktower',
		description: 'The tallest thing in town.',
		notes: 'Four faces, one of them always wrong.',
		aliases: ['The tower'],
		progressStatus: 'complete',
	});
	const guild = await service.createEntity(created, { kind: 'Faction', name: 'The Guild' });

	const ada = await service.createCharacter(created, {
		name: 'Ada',
		type: 'major',
		aliases: ['The clockmaker'],
		categoryPaths: ['Guild/Clockmakers'],
		progressStatus: 'in-progress',
		color: 'macaron-3',
		oneSentenceStoryline: 'A clockmaker learns what her clock is counting.',
		motivation: 'To be right.',
		goal: 'Restart the clock.',
		conflict: 'The town would rather not know.',
		growth: 'She learns to ask for help.',
		oneParagraphStoryline: 'Ada climbs the tower every night for a week.',
		characterSynopsis: 'From Ada’s side, the week is one long repair.',
		characterProfile: 'Born in the tower. Left-handed.',
		worldStatus: [
			{
				label: label('world-status', 'Mood/Calm'),
				value: 'until the bell rings',
				clauses: [
					{ kind: 'at', term: { kind: 'link', path: tower.path.replace(/\.md$/u, ''), name: 'Clocktower' } },
					{ kind: 'when', term: { kind: 'link', path: midnight.path.replace(/\.md$/u, ''), name: 'Midnight' } },
				],
			},
		],
		customFields: serializeCustomFields('', [{ title: 'Voice', content: 'Low and even.' }]),
	});
	const ben = await service.createCharacter(created, {
		name: 'Ben',
		type: 'supporting',
		relationships: [
			{
				label: label('relationship', 'Family/Sibling'),
				value: 'the younger',
				clauses: [{ kind: 'target', term: { kind: 'link', path: ada.path.replace(/\.md$/u, ''), name: 'Ada' } }],
			},
		],
	});
	const stops = await service.createScene(created, {
		title: 'The clock stops',
		povPath: ada.path,
		characters: [ada.path, ben.path],
		times: [toWikiLink(midnight.path, 'Midnight'), 'one winter evening'],
		locations: [toWikiLink(tower.path, 'Clocktower')],
		conflict: 'Ada wants to climb. Ben wants her home.',
		events: 'The hands stop at twelve.',
		planning: 'Open on the silence.',
		progressStatus: 'complete',
	});
	const morning = await service.createScene(created, { title: 'Morning after', povPath: 'omniscient' });

	const template = await service.saveCustomFieldTemplate(created, 'character', {
		name: 'Voice sheet',
		description: 'How a character sounds.',
		fields: [
			{ title: 'Voice', content: '' },
			{ title: 'Catchphrase', content: 'None yet.' },
		],
	});
	if (!template.ok) throw new Error('The project takes a template named Voice sheet.');
	await service.setKindTemplate(created, 'character', template.path);
	await service.saveCustomFieldTemplate(created, 'scene', { name: 'Beats', description: '', fields: [{ title: 'Turn', content: '' }] });

	const draft = created.links.draft;
	if (draft === null) throw new Error('A new project has a manuscript note.');
	const [first, second] = await service.manuscript.appendSegments(
		created,
		[
			{ title: 'Chapter 1', body: CHAPTER_ONE },
			{ title: 'Chapter 2', body: CHAPTER_TWO },
		],
		{ userInput: true },
	);
	if (first === undefined || second === undefined) throw new Error('The manuscript took both chapters.');

	// What the author keeps beside the project. A note that has left the manuscript is still named by what was marked in it.
	const cut = `${draft.slice(0, draft.lastIndexOf('/'))}/Cut chapter.md`;
	const task = (id: string, title: string, rest: Partial<Task> = {}): Task => ({
		id,
		title,
		description: '',
		status: 'todo',
		priority: 'medium',
		dueDate: null,
		related: [],
		archived: false,
		createdAt: RECORDS_MADE,
		updatedAt: RECORDS_MADE,
		...rest,
	});
	await service.tasks.createMany(created, [
		task('task-outline', 'Outline the thaw', {
			description: 'Three beats at most.',
			priority: 'high',
			dueDate: '2026-03-01',
			updatedAt: RECORDS_MADE + 60_000,
			related: [
				{ kind: 'character', id: ada.characterId, name: 'Ada' },
				// Kept under a name and a kind the note has since left behind.
				{ kind: 'time', id: tower.entityId, name: 'The old tower' },
				// A note deleted since.
				{ kind: 'location', id: 'entity-gone', name: 'The old mill' },
			],
		}),
		task('task-letter', 'Write the letter', { status: 'done', dueDate: '2026-03-01' }),
		task('task-map', 'Draw the town map', { status: 'in-progress', priority: 'low' }),
		task('task-guild', 'Rename the guild', { priority: 'urgent', dueDate: '2026-04-01', archived: true }),
		// From a file that kept no moments.
		task('task-bell', 'Check the bell', { createdAt: 0, updatedAt: 0 }),
	]);
	await service.foreshadowing.createMany(created, [
		{
			id: 'foreshadowing-clock',
			name: 'The stopped clock',
			description: 'It is counting down.',
			status: 'active',
			related: [{ kind: 'character', id: ada.characterId, name: 'Ada' }],
			createdAt: RECORDS_MADE,
			updatedAt: RECORDS_MADE,
			// Kept in the order they were marked in, which is not the order they are read in.
			occurrences: [
				{ id: 'occurrence-payoff', role: 'payoff', note: 'Paid off quietly.', ...marked(second, CHAPTER_TWO, 'Nobody asked why') },
				{ id: 'occurrence-plant', role: 'plant', note: '', ...marked(first, CHAPTER_ONE, 'stopped at midnight') },
			],
		},
		{
			id: 'foreshadowing-letter',
			name: 'The unsent letter',
			description: '',
			status: 'planned',
			related: [],
			createdAt: RECORDS_MADE,
			updatedAt: RECORDS_MADE,
			occurrences: [],
		},
		{
			id: 'foreshadowing-key',
			name: 'The missing key',
			description: '',
			status: 'resolved',
			related: [],
			createdAt: RECORDS_MADE,
			updatedAt: RECORDS_MADE,
			occurrences: [
				// Marked in a chapter that has since left the manuscript.
				{ id: 'occurrence-stray', role: 'payoff', note: '', ...marked(cut, 'The key turned.\n', 'key turned') },
				// Marked before four characters were cut from the head of the chapter.
				{ id: 'occurrence-moved', role: 'reinforce', note: '', ...marked(second, `So. ${CHAPTER_TWO}`, 'did not come home') },
				// Marked over words the chapter no longer has.
				{ id: 'occurrence-lost', role: 'plant', note: '', ...marked(second, 'A key lay under the mat.\n', 'key lay under') },
			],
		},
	]);
	const neat = spanOf(CHAPTER_TWO, 'Nobody asked why.');
	const beat = spanOf(CHAPTER_TWO, 'Ben did not come home.').to;
	const noon = spanOf(CHAPTER_ONE, 'midnight');
	// Kept in the order they were proposed in.
	await service.revisions.createMany(created, [
		captureRevision(second, CHAPTER_TWO, 'delete', neat.from, neat.to, '', 'Too neat.', 'revision-neat', RECORDS_MADE),
		captureRevision(second, CHAPTER_TWO, 'insert', beat, beat, ' Not that night.', 'A beat more.', 'revision-beat', RECORDS_MADE + 1000),
		captureRevision(first, CHAPTER_ONE, 'replace', noon.from, noon.to, 'noon', 'Earlier is eerier.', 'revision-noon', RECORDS_MADE + 2000),
		// Proposed over words the chapter no longer has.
		captureRevision(second, 'Somebody asked why.\n', 'replace', 0, 8, 'Everybody', '', 'revision-lost', RECORDS_MADE + 3000),
		// Proposed in a chapter that has since left the manuscript.
		captureRevision(cut, 'The key turned.\n', 'replace', 4, 7, 'lock', '', 'revision-stray', RECORDS_MADE + 4000),
	]);
	const key = await service.stickyNotes.create(
		created,
		'macaron-1',
		new Date(Date.UTC(2026, 0, 5, 8)),
		0,
		'Ask **Ben** about the *key*.\n\n- And the bell.\n',
	);
	const blank = await service.stickyNotes.create(created, 'macaron-5', new Date(Date.UTC(2026, 0, 6, 8)), 0);
	const aside = await service.stickyNotes.create(created, 'macaron-2', new Date(Date.UTC(2026, 0, 4, 8)), 0, 'An old idea.', true);

	// What was done to the records is filed in the history now, as the plugin files it after a quiet moment.
	await host.history.flushNow();
	// Two sittings another device recorded: half an hour of drafting the day before it is, and a short revision this morning.
	const held = (added: number, deleted: number): SessionWordTotals => ({ start: 1000, end: 1000 + added - deleted, added, deleted, net: added - deleted });
	await host.environment.fakeVault.seedFile(
		`${created.rootPath}/${SESSIONS_FOLDER}/2026/2026_03_device-b_writing_session.json`,
		JSON.stringify({
			schemaVersion: 1,
			sessions: [
				sitting('2026-03-09T09:00:00.000Z', { writing: 30, idle: 0 }, 'draft', { project: held(220, 20), manuscript: held(150, 0) }, [
					{ path: '50_Manuscript/Chapter 1.md', added: 150, deleted: 0, net: 150, manuscript: true },
					{ path: '20_Character/Ada.md', added: 70, deleted: 20, net: 50, manuscript: false },
				]),
				sitting('2026-03-10T07:00:00.000Z', { writing: 20, idle: 5 }, 'revision', { project: held(10, 40), manuscript: held(10, 40) }, [
					{ path: '50_Manuscript/Chapter 2.md', added: 10, deleted: 40, net: -30, manuscript: true },
				]),
			],
		}),
	);

	const chinese = await service.createProject({ title: '北境之雪', locale: 'zh-CN' });
	const old = await service.createProject({ title: 'Old Draft', locale: 'en' });
	const archived = await service.archiveProject(old);

	const project = await service.loadProject(created.projectFile);
	host.state.current = project.projectFile;
	const character = (id: string): CharacterRecord => {
		const found = project.characters.find((entry) => entry.characterId === id);
		if (found === undefined) throw new Error('The project has the character.');
		return found;
	};
	const scene = (id: string): SceneRecord => {
		const found = project.scenes.find((entry) => entry.sceneId === id);
		if (found === undefined) throw new Error('The project has the scene.');
		return found;
	};
	const entity = (id: string): WorldbuildingRecord => {
		const found = Object.values(project.worldbuilding)
			.flat()
			.find((entry) => entry.entityId === id);
		if (found === undefined) throw new Error('The project has the worldbuilding note.');
		return found;
	};
	return {
		host,
		api,
		project,
		chinese,
		archived,
		// Each as the project holds it now, after everything that was written since it was made.
		members: {
			ada: character(ada.characterId),
			ben: character(ben.characterId),
			stops: scene(stops.sceneId),
			morning: scene(morning.sceneId),
			midnight: entity(midnight.entityId),
			winter: entity(winter.entityId),
			tower: entity(tower.entityId),
			guild: entity(guild.entityId),
		},
		manuscript: { draft, first, second },
		stickyNotes: { key, blank, old: aside },
		call: (operationId, params = {}, extra = {}) =>
			api.dispatcher.dispatch({
				operationId,
				params,
				body: extra.body,
				ifMatch: extra.ifMatch ?? null,
				authenticated: true,
			}),
		reload: () => service.loadProject(project.projectFile),
	};
}

/**
 * Where an answer falls short of what the contract promises for its
 * operation and status. Empty when it is exactly the described shape.
 */
export function faults(reply: DispatchReply): string[] {
	return reply.failed ? problemFaults(reply.body) : shapeFaults(reply.operationId, reply.status, reply.body);
}

/** Every file of the vault with its text, to tell whether anything was written. */
export function vaultState(host: FakeHost): Record<string, string> {
	return Object.fromEntries([...host.environment.fakeVault.contents.entries()].sort(([left], [right]) => (left < right ? -1 : 1)));
}
