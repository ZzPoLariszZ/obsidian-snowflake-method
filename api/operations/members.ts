import { entitiesOf, type ProjectSnapshot, type WorldbuildingRecord } from '../../src/services';
import { characterOf, entityOf, kindIdsOf, memberOf, namesHold, sceneOf } from '../dto/member';
import { ApiError } from '../errors';
import { pageOf } from '../paging';
import { optionalTextParam, textParam, type OperationCall, type OperationGroup } from './context';

/** The most items a list gives to an answer when each is told in full. */
const MOST_IN_FULL = 100;

const isFull = (call: OperationCall): boolean => textParam(call, 'view') === 'full';
const most = (call: OperationCall): number => (isFull(call) ? MOST_IN_FULL : Number.POSITIVE_INFINITY);

/** Refuses a filter that names a kind the project does not have: a slip there would otherwise read as an empty list. */
export function knownKind(project: ProjectSnapshot, kind: string | null): string | null {
	if (kind === null || kindIdsOf(project).includes(kind)) return kind;
	throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
		errors: [{ pointer: 'params/kind', detail: `The project has no kind ${kind}. listKinds gives the kinds there are.` }],
	});
}

const gone = (what: string): ApiError =>
	new ApiError('not-found', `There is no ${what} with that id in the project. It may have been deleted. List them again.`);

/**
 * Characters, scenes and worldbuilding notes, read. All of them come out
 * of the plugin's one reading of the project, in the author's own order,
 * so a list costs nothing a dashboard has not already paid for.
 */
export const memberOperations: OperationGroup = {
	listMembers: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const kind = knownKind(project, optionalTextParam(call, 'kind'));
		const asked = optionalTextParam(call, 'q');
		const rows = context
			.members(project)
			.entries.filter((member) => (kind === null || member.kind === kind) && namesHold([member.name, ...member.aliases], asked));
		return { status: 200, body: pageOf(rows, call, memberOf) };
	},

	listCharacters: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const index = context.members(project);
		const role = optionalTextParam(call, 'role');
		const progress = optionalTextParam(call, 'progressStatus');
		const asked = optionalTextParam(call, 'q');
		const rows = project.characters
			.map((record, place) => ({ record, place }))
			.filter(
				({ record }) =>
					(role === null || record.type === role) &&
					(progress === null || record.progressStatus === progress) &&
					namesHold([record.name, ...record.aliases], asked),
			);
		const full = isFull(call);
		return { status: 200, body: pageOf(rows, call, ({ record, place }) => characterOf(index, record, place, full), most(call)) };
	},

	getCharacter: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const id = textParam(call, 'characterId');
		const place = project.characters.findIndex((character) => character.characterId === id);
		const character = project.characters[place];
		if (character === undefined) throw gone('character');
		return { status: 200, body: characterOf(context.members(project), character, place, true), etag: character.revision };
	},

	listScenes: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const index = context.members(project);
		const characterId = optionalTextParam(call, 'character');
		const progress = optionalTextParam(call, 'progressStatus');
		const asked = optionalTextParam(call, 'q');
		// A scene keeps its cast by where each character's note stands.
		const castPath =
			characterId === null ? null : (project.characters.find((character) => character.characterId === characterId)?.path ?? '');
		const rows = project.scenes
			.map((record, place) => ({ record, place }))
			.filter(
				({ record }) =>
					(castPath === null || record.characters.includes(castPath)) &&
					(progress === null || record.progressStatus === progress) &&
					namesHold([record.title, ...record.aliases], asked),
			);
		const full = isFull(call);
		return { status: 200, body: pageOf(rows, call, ({ record, place }) => sceneOf(index, record, place, full), most(call)) };
	},

	getScene: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const id = textParam(call, 'sceneId');
		const place = project.scenes.findIndex((scene) => scene.sceneId === id);
		const scene = project.scenes[place];
		if (scene === undefined) throw gone('scene');
		return { status: 200, body: sceneOf(context.members(project), scene, place, true), etag: scene.revision };
	},

	listEntities: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const index = context.members(project);
		const kind = knownKind(project, optionalTextParam(call, 'kind'));
		if (kind === 'character' || kind === 'scene') {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: [{ pointer: 'params/kind', detail: `Notes of the kind ${kind} are read with their own operations, not as worldbuilding notes.` }],
			});
		}
		const progress = optionalTextParam(call, 'progressStatus');
		const asked = optionalTextParam(call, 'q');
		// Kind by kind in the order the author keeps the kinds, each kind's notes in their own order.
		const rows: { record: WorldbuildingRecord; place: number }[] = [];
		for (const entry of project.worldbuildingKinds) {
			if (kind !== null && entry.id !== kind) continue;
			entitiesOf(project, entry.id).forEach((record, place) => {
				if ((progress === null || record.progressStatus === progress) && namesHold([record.name, ...record.aliases], asked)) {
					rows.push({ record, place });
				}
			});
		}
		const full = isFull(call);
		return { status: 200, body: pageOf(rows, call, ({ record, place }) => entityOf(index, record, place, full), most(call)) };
	},

	getEntity: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const id = textParam(call, 'entityId');
		for (const entry of project.worldbuildingKinds) {
			const bucket = entitiesOf(project, entry.id);
			const place = bucket.findIndex((entity) => entity.entityId === id);
			const entity = bucket[place];
			if (entity === undefined) continue;
			return { status: 200, body: entityOf(context.members(project), entity, place, true), etag: entity.revision };
		}
		throw gone('worldbuilding note');
	},
};
