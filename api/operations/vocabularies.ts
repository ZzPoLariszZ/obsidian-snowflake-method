import { normalizePath } from 'obsidian';

import { fileStem, foldName, type DefinitionFileId } from '../../src/domain';
import { checkDefinitionPath, worldbuildingKindFolder, type DefinitionNodeInfo, type ProjectSnapshot } from '../../src/services';
import { duplicateFieldTitle, type CustomField } from '../../src/templates';
import { kindIdsOf, kindOf } from '../dto/member';
import { definitionNodeOf, definitionTreeOf, fieldTemplateOf } from '../dto/vocabulary';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import {
	NOT_THE_AUTHOR,
	bodyOf,
	flagParam,
	optionalTextParam,
	textParam,
	type ApiContext,
	type OperationCall,
	type OperationGroup,
	type OperationResult,
} from './context';

/** The kind a call names in its address, where the project has it. */
function kindParam(project: ProjectSnapshot, call: OperationCall): string {
	const kind = textParam(call, 'kindId');
	if (!kindIdsOf(project).includes(kind)) {
		throw new ApiError('not-found', `The project has no kind ${kind}. listKinds gives the kinds there are.`);
	}
	return kind;
}

/** The vocabulary a call names. The contract holds it to the three there are. */
const vocabularyParam = (call: OperationCall): DefinitionFileId => textParam(call, 'vocabulary') as DefinitionFileId;

/**
 * Templates are read from their notes and not from Obsidian's index of
 * them, which runs a beat behind a write: a caller that has just saved a
 * template must find it in the very next list.
 */
const FROM_FILES = { from: 'files' } as const;

/**
 * The name of the field template new notes of a kind begin with, or null.
 * The project keeps it as a link to the template's note.
 */
async function defaultTemplateOf(context: ApiContext, project: ProjectSnapshot, kind: string): Promise<string | null> {
	const stored = await context.host.projects.kindTemplatePath(project, kind);
	return stored === null ? null : fileStem(normalizePath(stored));
}

/** A kind told as it stands now, with the field template its new notes begin with. */
async function tellKind(context: ApiContext, projectId: string, kind: string): Promise<JsonObject> {
	const { project } = await context.loadProject(projectId);
	const told = kindOf(project, kind, await defaultTemplateOf(context, project, kind));
	if (told === null) throw new ApiError('internal-error', 'The operation failed.');
	return told;
}

/** What a kind's name was refused for, as the contract names it. */
function kindRefusal(code: 'invalid-name' | 'taken' | 'full', name: string): ApiError {
	if (code === 'taken') {
		return new ApiError('duplicate-name', 'A kind already goes by that name. Names are told apart whatever their case.', { kind: 'kind', name });
	}
	if (code === 'full') return new ApiError('kind-limit-reached', 'The project holds as many kinds as it can.');
	return new ApiError('invalid-name', 'A kind is named as its folder is, so its name must be one a folder can have, with no slash and no number in front.', { name });
}

/** The word a call addresses in one kind's tree of one vocabulary, with the tree it stands in. */
async function findNode(
	context: ApiContext,
	project: ProjectSnapshot,
	vocabulary: DefinitionFileId,
	kind: string,
	taxonomyPath: string,
): Promise<{ node: DefinitionNodeInfo; nodes: readonly DefinitionNodeInfo[] }> {
	// A word is found whatever the case it is asked in, as the plugin itself finds it.
	const asked = foldName(taxonomyPath);
	const nodes = (await context.host.projects.listDefinitionForest(project, vocabulary))[kind]?.nodes ?? [];
	const node = nodes.find((entry) => foldName(entry.taxonomyPath) === asked);
	if (node === undefined) {
		throw new ApiError('not-found', `The kind ${kind} has no such word in that vocabulary. getVocabularyTree gives the words there are.`);
	}
	return { node, nodes };
}

/** The fields a body sends for a template, no two of one title. */
function fieldsOf(sent: unknown): CustomField[] {
	const fields = (Array.isArray(sent) ? sent : []).map((entry): CustomField => {
		const field = entry as { title: string; content: string };
		return { title: field.title, content: field.content };
	});
	const twice = duplicateFieldTitle(fields.map((field) => field.title));
	if (twice !== null) {
		throw new ApiError('duplicate-field-title', `Two of the fields are titled "${twice}". Titles are told apart whatever their case.`, { title: twice });
	}
	return fields;
}

/** What a template's name was refused for. */
function templateRefusal(code: 'invalid-name' | 'taken', name: string): ApiError {
	return code === 'taken'
		? new ApiError('duplicate-name', 'A field template of the kind already goes by that name.', { kind: 'field-template', name })
		: new ApiError('invalid-name', 'A template is named as its note is, so its name must be one a file can have.', { name });
}

/** One field template told in full, as it stands in its note now. */
async function tellTemplate(context: ApiContext, projectId: string, kind: string, name: string, status: 200 | 201): Promise<OperationResult> {
	const { project } = await context.loadProject(projectId);
	const template = ((await context.host.projects.listCustomFieldTemplates(project, FROM_FILES))[kind] ?? []).find((entry) => entry.name === name);
	if (template === undefined) throw new ApiError('internal-error', 'The operation failed.');
	const fields = await context.host.projects.customFieldTemplateFields(project, kind, name);
	const body = fieldTemplateOf(kind, template, template.name === (await defaultTemplateOf(context, project, kind)), fields);
	return status === 200
		? { status, body }
		: { status, body, location: `/projects/${encodeURIComponent(projectId)}/field-templates/${encodeURIComponent(kind)}/${encodeURIComponent(name)}` };
}

/**
 * Kinds, vocabularies and field templates, read and changed: what a project
 * has agreed on before any note is written. An agent reads these first, to
 * give a new note the words and the fields the author already uses.
 */
export const vocabularyOperations: OperationGroup = {
	listKinds: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const items: JsonObject[] = [];
		for (const id of kindIdsOf(project)) {
			const kind = kindOf(project, id, await defaultTemplateOf(context, project, id));
			if (kind !== null) items.push(kind);
		}
		return { status: 200, body: { items } };
	},

	getKind: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const id = kindParam(project, call);
		return { status: 200, body: kindOf(project, id, await defaultTemplateOf(context, project, id)) };
	},

	getVocabulary: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const vocabulary = vocabularyParam(call);
		const forest = await context.host.projects.listDefinitionForest(project, vocabulary);
		return {
			status: 200,
			body: {
				vocabulary,
				trees: kindIdsOf(project).flatMap((kind) => {
					const tree = forest[kind];
					return tree === undefined ? [] : [definitionTreeOf(vocabulary, kind, tree)];
				}),
			},
		};
	},

	getVocabularyTree: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const vocabulary = vocabularyParam(call);
		const kind = kindParam(project, call);
		const tree = (await context.host.projects.listDefinitionForest(project, vocabulary))[kind];
		if (tree === undefined) throw new ApiError('not-found', `The kind ${kind} keeps no such vocabulary.`);
		return { status: 200, body: definitionTreeOf(vocabulary, kind, tree) };
	},

	getDefinitionNode: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const vocabulary = vocabularyParam(call);
		const kind = kindParam(project, call);
		// A word is found whatever the case it is asked in, as the plugin itself finds it.
		const asked = foldName(textParam(call, 'taxonomyPath'));
		const tree = (await context.host.projects.listDefinitionForest(project, vocabulary))[kind];
		const node = tree?.nodes.find((entry) => foldName(entry.taxonomyPath) === asked);
		if (node === undefined) {
			throw new ApiError('not-found', `The kind ${kind} has no such word in that vocabulary. getVocabularyTree gives the words there are.`);
		}
		return { status: 200, body: definitionNodeOf(node) };
	},

	listFieldTemplates: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const only = optionalTextParam(call, 'kind');
		if (only !== null && !kindIdsOf(project).includes(only)) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: [{ pointer: 'params/kind', detail: `The project has no kind ${only}. listKinds gives the kinds there are.` }],
			});
		}
		const listing = await context.host.projects.listCustomFieldTemplates(project, FROM_FILES);
		const items: JsonObject[] = [];
		for (const kind of kindIdsOf(project)) {
			if (only !== null && kind !== only) continue;
			const chosen = await defaultTemplateOf(context, project, kind);
			for (const template of listing[kind] ?? []) items.push(fieldTemplateOf(kind, template, template.name === chosen));
		}
		return { status: 200, body: { items } };
	},

	getFieldTemplate: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const kind = kindParam(project, call);
		const name = textParam(call, 'templateName');
		const template = ((await context.host.projects.listCustomFieldTemplates(project, FROM_FILES))[kind] ?? []).find(
			(entry) => entry.name === name,
		);
		if (template === undefined) {
			throw new ApiError('not-found', `The kind ${kind} has no field template of that name. listFieldTemplates gives the ones there are.`);
		}
		const fields = await context.host.projects.customFieldTemplateFields(project, kind, name);
		return {
			status: 200,
			body: fieldTemplateOf(kind, template, template.name === (await defaultTemplateOf(context, project, kind)), fields),
		};
	},

	createKind: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const name = String(body['name']).trim();
		const made = await context.host.projects.createWorldbuildingKind(project, name, {
			...(typeof body['icon'] === 'string' ? { icon: body['icon'] } : {}),
			...(typeof body['description'] === 'string' ? { description: body['description'] } : {}),
		});
		if (!made.ok) throw kindRefusal(made.code, name);
		return {
			status: 201,
			body: await tellKind(context, projectId, made.kind.id),
			location: `/projects/${encodeURIComponent(projectId)}/kinds/${encodeURIComponent(made.kind.id)}`,
		};
	},

	updateKind: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		let kind = kindParam(project, call);
		const body = bodyOf(call);
		const standing = await tellKind(context, projectId, kind);
		const name = typeof body['name'] === 'string' ? body['name'].trim() : null;
		// A kind read and sent back whole names what it already is, which asks for nothing.
		const renamed = name !== null && name !== standing['name'];
		const looks = (['icon', 'description'] as const).filter((key) => key in body && (body[key] ?? null) !== standing[key]);
		if ((renamed || looks.length > 0) && standing['builtIn'] === true) {
			throw new ApiError('built-in-kind', 'Every project has this kind. It keeps its name and wears no icon, and only its field template can be set.');
		}
		const service = context.host.projects;
		const wanted = 'defaultFieldTemplate' in body ? body['defaultFieldTemplate'] : undefined;
		const noTemplate = (): ApiError =>
			new ApiError('invalid-reference', 'The kind has no field template of that name. listFieldTemplates gives the ones there are.', {
				pointer: '/defaultFieldTemplate',
			});
		/** The kind's template of the name sent, where its folder stands now. */
		const templateOf = async (name: string): Promise<{ path: string } | undefined> =>
			((await service.listCustomFieldTemplates(project.projectFile, FROM_FILES))[kind] ?? []).find((entry) => entry.name === name);
		// Looked for before anything is changed: a call that names a template the kind does not have is
		// refused with the kind under the name, and in the folder, it had.
		if (typeof wanted === 'string' && (await templateOf(wanted)) === undefined) throw noTemplate();
		if (renamed) {
			const moved = await service.renameWorldbuildingKind(project, kind, name);
			if (!moved.ok) throw kindRefusal(moved.code, name);
			kind = moved.kind.id;
		}
		if (looks.length > 0) {
			const said = (key: 'icon' | 'description'): string => {
				const value = key in body ? body[key] : standing[key];
				return typeof value === 'string' ? value : '';
			};
			await service.setKindAppearance(project.projectFile, kind, { icon: said('icon'), description: said('description') });
		}
		if (wanted !== undefined) {
			if (typeof wanted !== 'string') {
				await service.setKindTemplate(project.projectFile, kind, null);
			} else {
				// Found again where it stands now: a kind's templates move with its folder when it is renamed.
				const template = await templateOf(wanted);
				if (template === undefined) throw noTemplate();
				await service.setKindTemplate(project.projectFile, kind, template.path);
			}
		}
		return { status: 200, body: await tellKind(context, projectId, kind) };
	},

	deleteKind: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const kind = kindParam(project, call);
		if (project.worldbuildingKinds.find((entry) => entry.id === kind)?.custom !== true) {
			throw new ApiError('built-in-kind', 'Every project has this kind, and it cannot be deleted.');
		}
		const service = context.host.projects;
		const cost = await service.worldbuildingKindUsageByPath(project, kind);
		const index = context.members(project);
		const refs = (paths: readonly string[]): JsonObject[] => paths.map((path) => index.refAt(path));
		const named = cost.usage.listed.length + cost.usage.needsDecision.length + cost.usage.records.length;
		if ((cost.entityCount > 0 || named > 0) && !flagParam(call, 'force')) {
			throw new ApiError('in-use', 'The kind holds notes, which would go to the trash with it. Send force=true to delete it all the same.', {
				entities: cost.entityCount,
				usage: { listed: refs(cost.usage.listed), needsDecision: refs(cost.usage.needsDecision), records: refs(cost.usage.records) },
			});
		}
		const path = worldbuildingKindFolder(project, kind);
		await service.deleteWorldbuildingKind(project, kind);
		return {
			status: 200,
			body: {
				id: kind,
				path,
				entities: cost.entityCount,
				detached: refs(cost.usage.listed),
				dangling: refs([...new Set([...cost.usage.needsDecision, ...cost.usage.records])]),
			},
		};
	},

	createDefinitionNode: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const vocabulary = vocabularyParam(call);
		const kind = kindParam(project, call);
		const body = bodyOf(call);
		const asked = String(body['path']).trim();
		const check = checkDefinitionPath(asked);
		const refused = (code: 'invalid-segment' | 'too-deep', segment: string): ApiError =>
			new ApiError(
				code,
				code === 'too-deep' ? 'A vocabulary has seven levels at most.' : 'A part of the path is not a name a vocabulary word can have.',
				{ path: asked, segment },
			);
		if (!check.ok) throw refused(check.code, check.segment);
		const taxonomyPath = check.segments.join('/');
		const service = context.host.projects;
		const standing = (await service.listDefinitionForest(project, vocabulary))[kind]?.nodes ?? [];
		// A word notes use and nothing spells is not there yet, and adding it is how it is put right.
		if (standing.some((node) => !node.missing && foldName(node.taxonomyPath) === foldName(taxonomyPath))) {
			throw new ApiError('duplicate-name', 'The vocabulary already has that word.', { kind: vocabulary, name: taxonomyPath });
		}
		const added = await service.addDefinitionPath(
			project,
			kind,
			vocabulary,
			taxonomyPath,
			typeof body['description'] === 'string' ? body['description'] : '',
			NOT_THE_AUTHOR,
		);
		if (!added.ok) throw refused(added.code, added.segment);
		const { project: after } = await context.loadProject(projectId);
		const { node } = await findNode(context, after, vocabulary, kind, taxonomyPath);
		return {
			status: 201,
			body: definitionNodeOf(node),
			location: `/projects/${encodeURIComponent(projectId)}/vocabularies/${vocabulary}/${encodeURIComponent(kind)}/nodes/${encodeURIComponent(node.taxonomyPath)}`,
		};
	},

	updateDefinitionNode: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const vocabulary = vocabularyParam(call);
		const kind = kindParam(project, call);
		const { node } = await findNode(context, project, vocabulary, kind, textParam(call, 'taxonomyPath'));
		const body = bodyOf(call);
		const service = context.host.projects;
		let taxonomyPath = node.taxonomyPath;
		const name = typeof body['name'] === 'string' ? body['name'].trim() : null;
		if (name !== null && name !== node.name) {
			const moved = await service.renameDefinitionNode(project, kind, vocabulary, taxonomyPath, name);
			if (!moved.ok) {
				throw moved.code === 'taken'
					? new ApiError('duplicate-name', 'A word beside it already goes by that name.', { kind: vocabulary, name })
					: new ApiError('invalid-segment', 'That is not a name a vocabulary word can have.', { segment: moved.segment });
			}
			taxonomyPath = moved.taxonomyPath;
		}
		if (typeof body['description'] === 'string' && body['description'] !== node.description) {
			await service.updateDefinitionDescription(project.projectFile, kind, vocabulary, taxonomyPath, body['description'], NOT_THE_AUTHOR);
		}
		const { project: after } = await context.loadProject(projectId);
		return { status: 200, body: definitionNodeOf((await findNode(context, after, vocabulary, kind, taxonomyPath)).node) };
	},

	deleteDefinitionNode: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const vocabulary = vocabularyParam(call);
		const kind = kindParam(project, call);
		const { node, nodes } = await findNode(context, project, vocabulary, kind, textParam(call, 'taxonomyPath'));
		const stump = foldName(node.taxonomyPath);
		const felled = nodes.filter((entry) => foldName(entry.taxonomyPath) === stump || foldName(entry.taxonomyPath).startsWith(`${stump}/`));
		const categorized = [...new Set(felled.flatMap((entry) => entry.usage.listed))];
		const labelled = [...new Set(felled.flatMap((entry) => entry.usage.records))];
		if (categorized.length + labelled.length > 0 && !flagParam(call, 'force')) {
			throw new ApiError('in-use', 'Notes use the word, or a word under it. Send force=true to delete it all the same.', {
				categorized: categorized.length,
				labelled: labelled.length,
			});
		}
		await context.host.projects.deleteDefinitionNode(project, kind, vocabulary, node.taxonomyPath);
		return {
			status: 200,
			body: { vocabulary, kind, taxonomyPath: node.taxonomyPath, nodes: felled.length, categorized, labelled },
		};
	},

	createFieldTemplate: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const body = bodyOf(call);
		const kind = String(body['kind']);
		if (!kindIdsOf(project).includes(kind)) {
			throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
				errors: [{ pointer: '/kind', detail: `The project has no kind ${kind}. listKinds gives the kinds there are.` }],
			});
		}
		const name = String(body['name']).trim();
		const service = context.host.projects;
		const saved = await service.saveCustomFieldTemplate(
			project,
			kind,
			{ name, description: typeof body['description'] === 'string' ? body['description'] : '', fields: fieldsOf(body['fields']) },
			NOT_THE_AUTHOR,
		);
		if (!saved.ok) throw templateRefusal(saved.code, name);
		if (body['default'] === true) await service.setKindTemplate(project.projectFile, kind, saved.path);
		return tellTemplate(context, projectId, kind, name, 201);
	},

	updateFieldTemplate: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const project = await context.writableProject(projectId);
		const kind = kindParam(project, call);
		const standing = textParam(call, 'templateName');
		const service = context.host.projects;
		const template = ((await service.listCustomFieldTemplates(project, FROM_FILES))[kind] ?? []).find((entry) => entry.name === standing);
		if (template === undefined) {
			throw new ApiError('not-found', `The kind ${kind} has no field template of that name. listFieldTemplates gives the ones there are.`);
		}
		const body = bodyOf(call);
		const name = typeof body['name'] === 'string' ? body['name'].trim() : standing;
		const saved = await service.saveCustomFieldTemplate(
			project,
			kind,
			{
				name,
				description: typeof body['description'] === 'string' ? body['description'] : template.description,
				fields: 'fields' in body ? fieldsOf(body['fields']) : await service.customFieldTemplateFields(project, kind, standing),
			},
			{ previousName: standing, ...NOT_THE_AUTHOR },
		);
		if (!saved.ok) throw templateRefusal(saved.code, name);
		if (typeof body['default'] === 'boolean') {
			const { project: after } = await context.loadProject(projectId);
			const wasDefault = (await defaultTemplateOf(context, after, kind)) === name;
			if (body['default'] && !wasDefault) await service.setKindTemplate(after.projectFile, kind, saved.path);
			if (!body['default'] && wasDefault) await service.setKindTemplate(after.projectFile, kind, null);
		}
		return tellTemplate(context, projectId, kind, name, 200);
	},

	deleteFieldTemplate: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const kind = kindParam(project, call);
		await context.host.projects.deleteCustomFieldTemplate(project, kind, textParam(call, 'templateName'));
		return { status: 204 };
	},
};
