import { normalizePath } from 'obsidian';

import { entitiesOf, toWikiLink, type ProjectSnapshot, type WorldbuildingRecord } from '../../src/services';
import { characterOf, entityOf, hasTimeFields, sceneOf } from '../dto/member';
import { MemberDraft, characterChanges, entityChanges, sceneChanges } from '../dto/member-input';
import { ApiError, changedSince } from '../errors';
import type { JsonObject } from '../json';
import {
	NOT_THE_AUTHOR,
	bodyOf,
	flagParam,
	revisionOf,
	textParam,
	type ApiContext,
	type OperationCall,
	type OperationGroup,
	type OperationResult,
} from './context';

type Sent = Readonly<Record<string, unknown>>;

const gone = (what: string): ApiError =>
	new ApiError('not-found', `There is no ${what} with that id in the project. It may have been deleted. List them again.`);

/** What a body's ids and vocabulary words are held against, for a note of one kind. */
async function draftFor(context: ApiContext, project: ProjectSnapshot, kind: string, body: Sent): Promise<MemberDraft> {
	const service = context.host.projects;
	return new MemberDraft(
		project,
		context.members(project),
		{
			category: await service.listDefinitionForest(project, 'category'),
			'world-status': await service.listDefinitionForest(project, 'world-status'),
			relationship: await service.listDefinitionForest(project, 'relationship'),
		},
		kind,
		body['createMissingVocabulary'] === true,
	);
}

/**
 * What a new note is made from. A call that names no fields of the author's
 * own begins the note with those of its kind's default field template, as
 * the plugin's own form opens on them. One that names them, an empty list
 * among them, is taken at its word.
 */
async function starting(context: ApiContext, project: ProjectSnapshot, kind: string, body: Sent): Promise<Sent> {
	if ('customFields' in body) return body;
	const fields = await context.host.projects.kindTemplateFields(project, kind);
	return fields.length === 0 ? body : { ...body, customFields: fields.map((field) => ({ title: field.title, content: field.content })) };
}

/** A worldbuilding note found by its id among every kind's notes, with its place in its kind. */
function findEntity(project: ProjectSnapshot, id: string): { entity: WorldbuildingRecord; place: number } | null {
	for (const kind of project.worldbuildingKinds) {
		const place = entitiesOf(project, kind.id).findIndex((entity) => entity.entityId === id);
		const entity = entitiesOf(project, kind.id)[place];
		if (entity !== undefined) return { entity, place };
	}
	return null;
}

/**
 * A note told in full as it stands after a write. The overview a note
 * carries of its own properties is brought level first: the plugin does that
 * by itself a second after any change, and the version handed back here
 * would be a stale one by then.
 */
async function answer(
	context: ApiContext,
	projectId: string,
	path: string,
	tell: (project: ProjectSnapshot) => { body: JsonObject; etag: string; id: string } | null,
	made: string | null,
): Promise<OperationResult> {
	let { project } = await context.loadProject(projectId);
	if (await context.host.projects.reconcileMemberFieldsBlock(project, path)) {
		({ project } = await context.loadProject(projectId));
	}
	const told = tell(project);
	if (told === null) throw new ApiError('internal-error', 'The operation failed.');
	return made === null
		? { status: 200, body: told.body, etag: told.etag }
		: { status: 201, body: told.body, etag: told.etag, location: `/projects/${encodeURIComponent(projectId)}/${made}/${encodeURIComponent(told.id)}` };
}

const tellCharacter =
	(context: ApiContext, id: string) =>
	(project: ProjectSnapshot): { body: JsonObject; etag: string; id: string } | null => {
		const place = project.characters.findIndex((character) => character.characterId === id);
		const character = project.characters[place];
		return character === undefined
			? null
			: { body: characterOf(context.members(project), character, place, true), etag: character.revision, id };
	};

const tellScene =
	(context: ApiContext, id: string) =>
	(project: ProjectSnapshot): { body: JsonObject; etag: string; id: string } | null => {
		const place = project.scenes.findIndex((scene) => scene.sceneId === id);
		const scene = project.scenes[place];
		return scene === undefined ? null : { body: sceneOf(context.members(project), scene, place, true), etag: scene.revision, id };
	};

const tellEntity =
	(context: ApiContext, id: string) =>
	(project: ProjectSnapshot): { body: JsonObject; etag: string; id: string } | null => {
		const found = findEntity(project, id);
		return found === null
			? null
			: { body: entityOf(context.members(project), found.entity, found.place, true), etag: found.entity.revision, id };
	};

/** Where a move puts a note among the others of its list, as the services take it. */
function moveTarget(body: Sent, id: string): (order: readonly string[]) => number | null {
	return (order) => {
		const from = order.indexOf(id);
		if (from === -1) return null;
		if (typeof body['index'] === 'number') return Math.min(body['index'], order.length - 1);
		const before = 'before' in body;
		const other = String(before ? body['before'] : body['after']);
		const at = order.indexOf(other);
		if (at === -1 || other === id) {
			throw new ApiError(
				'invalid-reference',
				other === id ? 'A note cannot be put before or after itself.' : 'No note of that id stands in the same list.',
				{ pointer: before ? '/before' : '/after', id: other },
			);
		}
		// Where the other stands once the note being moved has left its place.
		const beside = at - (from < at ? 1 : 0);
		return before ? beside : beside + 1;
	};
}

interface Doomed {
	kind: string;
	id: string;
	name: string;
	path: string;
	revision: string;
	gallery: string[];
}

/**
 * One note sent to the trash. Asked for a note other notes name, it is
 * refused with which they are unless the caller says to go ahead. The
 * plugin's own screen asks the author the same thing in a dialog.
 */
async function trash(context: ApiContext, call: OperationCall, project: ProjectSnapshot, member: Doomed): Promise<OperationResult> {
	if (revisionOf(call, member.revision) !== member.revision) throw changedSince(member.revision);
	const service = context.host.projects;
	const usage = await service.memberUsageByPath(project, member.path);
	const index = context.members(project);
	const refs = (paths: readonly string[]): JsonObject[] => paths.map((path) => index.refAt(path));
	const named = usage.listed.length + usage.needsDecision.length + usage.records.length;
	if (named > 0 && !flagParam(call, 'force')) {
		throw new ApiError('in-use', 'Other notes of the project name it. Send force=true to delete it all the same.', {
			usage: { listed: refs(usage.listed), needsDecision: refs(usage.needsDecision), records: refs(usage.records) },
		});
	}
	const { trashFailed } = await service.trashMember(project, member);
	return {
		status: 200,
		body: {
			kind: member.kind,
			id: member.id,
			name: member.name,
			path: member.path,
			detached: refs(usage.listed),
			dangling: refs([...new Set([...usage.needsDecision, ...usage.records])]),
			picturesKept: trashFailed,
		},
	};
}

/**
 * Characters, scenes and worldbuilding notes, changed. Every one goes
 * through the service the plugin's own forms save through, so a note made
 * here is the note a form would have made, and a name already taken, a
 * version left behind and a damaged section are refused as a form's save is.
 */
export const memberWriteOperations: OperationGroup = {
	createCharacter: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = await starting(context, project, 'character', bodyOf(call));
		// A role is one of the three or left out here: only a change may say null, to take one off.
		const { type, ...changes } = characterChanges(await draftFor(context, project, 'character', body), body, { customFields: '' });
		const made = await context.host.projects.createCharacterIn(
			project,
			{ ...changes, ...(type === undefined || type === null ? {} : { type }), name: String(body['name']).trim() },
			NOT_THE_AUTHOR,
		);
		return answer(context, projectId, made.path, tellCharacter(context, made.characterId), 'characters');
	},

	updateCharacter: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'characterId');
		const character = project.characters.find((entry) => entry.characterId === id);
		if (character === undefined) throw gone('character');
		const body = bodyOf(call);
		const changes = characterChanges(await draftFor(context, project, 'character', body), body, character);
		const saved = await context.host.projects.updateCharacterIn(
			project,
			id,
			{ ...changes, expectedRevision: revisionOf(call, character.revision) },
			NOT_THE_AUTHOR,
		);
		return answer(context, projectId, saved.path, tellCharacter(context, id), null);
	},

	deleteCharacter: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'characterId');
		const character = project.characters.find((entry) => entry.characterId === id);
		if (character === undefined) throw gone('character');
		return trash(context, call, project, { ...character, kind: 'character', id });
	},

	moveCharacter: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'characterId');
		const character = project.characters.find((entry) => entry.characterId === id);
		if (character === undefined) throw gone('character');
		await context.host.projects.reorderCharacter(project, id, moveTarget(bodyOf(call), id));
		return answer(context, projectId, character.path, tellCharacter(context, id), null);
	},

	createScene: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = await starting(context, project, 'scene', bodyOf(call));
		const draft = await draftFor(context, project, 'scene', body);
		const changes = sceneChanges(draft, body, { customFields: '' }, await manuscriptLinks(context, project, body));
		const made = await context.host.projects.createSceneIn(project, { ...changes, title: String(body['title']).trim() }, NOT_THE_AUTHOR);
		return answer(context, projectId, made.path, tellScene(context, made.sceneId), 'scenes');
	},

	updateScene: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'sceneId');
		const scene = project.scenes.find((entry) => entry.sceneId === id);
		if (scene === undefined) throw gone('scene');
		const body = bodyOf(call);
		const draft = await draftFor(context, project, 'scene', body);
		const changes = sceneChanges(draft, body, scene, await manuscriptLinks(context, project, body));
		const saved = await context.host.projects.updateSceneIn(
			project,
			id,
			{ ...changes, expectedRevision: revisionOf(call, scene.revision) },
			NOT_THE_AUTHOR,
		);
		return answer(context, projectId, saved.path, tellScene(context, id), null);
	},

	deleteScene: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'sceneId');
		const scene = project.scenes.find((entry) => entry.sceneId === id);
		if (scene === undefined) throw gone('scene');
		return trash(context, call, project, { ...scene, kind: 'scene', id, name: scene.title });
	},

	moveScene: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'sceneId');
		const scene = project.scenes.find((entry) => entry.sceneId === id);
		if (scene === undefined) throw gone('scene');
		await context.host.projects.reorderScene(project, id, moveTarget(bodyOf(call), id));
		return answer(context, projectId, scene.path, tellScene(context, id), null);
	},

	createEntity: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const kind = String(body['kind']);
		if (!project.worldbuildingKinds.some((entry) => entry.id === kind)) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: [{ pointer: '/kind', detail: `The project has no worldbuilding kind ${kind}. listKinds gives the kinds there are.` }],
			});
		}
		const sent = await starting(context, project, kind, body);
		const draft = await draftFor(context, project, kind, sent);
		const changes = entityChanges(draft, sent, { customFields: '', timeKind: null, timeStart: '', timeEnd: '' }, hasTimeFields(kind));
		const made = await context.host.projects.createEntityIn(project, { ...changes, kind, name: String(body['name']).trim() }, NOT_THE_AUTHOR);
		return answer(context, projectId, made.path, tellEntity(context, made.entityId), 'entities');
	},

	updateEntity: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'entityId');
		const found = findEntity(project, id);
		if (found === null) throw gone('worldbuilding note');
		const { entity } = found;
		const body = bodyOf(call);
		const draft = await draftFor(context, project, entity.kind, body);
		const changes = entityChanges(draft, body, entity, hasTimeFields(entity.kind));
		const saved = await context.host.projects.updateEntityIn(
			project,
			id,
			{ ...changes, expectedRevision: revisionOf(call, entity.revision) },
			NOT_THE_AUTHOR,
		);
		return answer(context, projectId, saved.path, tellEntity(context, id), null);
	},

	deleteEntity: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const id = textParam(call, 'entityId');
		const found = findEntity(project, id);
		if (found === null) throw gone('worldbuilding note');
		return trash(context, call, project, { ...found.entity, id });
	},

	moveEntity: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const id = textParam(call, 'entityId');
		const found = findEntity(project, id);
		if (found === null) throw gone('worldbuilding note');
		await context.host.projects.reorderEntity(project, found.entity.kind, id, moveTarget(bodyOf(call), id));
		return answer(context, projectId, found.entity.path, tellEntity(context, id), null);
	},
};

/**
 * What a scene's links to the manuscript are built with. A note is named
 * by its address and must be one of this project's manuscript notes. A link
 * as a read gave it is kept as it stands, with whatever heading it points at.
 */
async function manuscriptLinks(
	context: ApiContext,
	project: ProjectSnapshot,
	body: Sent,
): Promise<(sent: unknown, pointer: string) => string> {
	const notes = 'linkedManuscript' in body ? await context.host.projects.manuscript.listSegmentsFromFiles(project) : [];
	return (sent, pointer) => {
		const entry = (typeof sent === 'object' && sent !== null ? sent : {}) as Sent;
		if (typeof entry['link'] === 'string') return entry['link'];
		const wanted = normalizePath(`${project.rootPath}/${String(entry['relativePath'])}`);
		const note = notes.find((segment) => segment.path === wanted);
		if (note === undefined) {
			throw new ApiError('invalid-reference', 'The manuscript has no note at that address. listManuscriptNotes gives the addresses there are.', {
				pointer: `${pointer}/relativePath`,
			});
		}
		return toWikiLink(note.path, note.title);
	};
}
