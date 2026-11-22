import type { DispatchReply } from '../../../api/dispatch';
import type { LocalApi } from '../../../api/index';
import {
	definitionRootPath,
	nodeSelfPath,
	toWikiLink,
	type CharacterRecord,
	type ProjectRef,
	type ProjectSnapshot,
	type SceneRecord,
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
	/** One call through the dispatcher, as a caller with the token. */
	call(
		operationId: string,
		params?: Record<string, unknown>,
		extra?: { body?: unknown; ifMatch?: string | null },
	): Promise<DispatchReply>;
	/** The project again as it stands now. */
	reload(): Promise<ProjectSnapshot>;
}

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
