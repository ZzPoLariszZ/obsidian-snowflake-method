import { normalizePath } from 'obsidian';

import { fileStem, foldName, type DefinitionFileId } from '../../src/domain';
import type { ProjectSnapshot } from '../../src/services';
import { kindIdsOf, kindOf } from '../dto/member';
import { definitionNodeOf, definitionTreeOf, fieldTemplateOf } from '../dto/vocabulary';
import { ApiError } from '../errors';
import type { JsonObject } from '../json';
import { optionalTextParam, textParam, type ApiContext, type OperationCall, type OperationGroup } from './context';

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

/**
 * Kinds, vocabularies and field templates, read: what a project has agreed
 * on before any note is written. An agent reads these first, to give a new
 * note the words and the fields the author already uses.
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
};
