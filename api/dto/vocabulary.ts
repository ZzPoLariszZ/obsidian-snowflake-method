import type { CustomField } from '../../src/templates';
import type { CustomFieldTemplateInfo, DefinitionNodeInfo, DefinitionTreeInfo } from '../../src/services';
import type { JsonObject } from '../json';

/**
 * A project's vocabularies and field templates as the API tells them. A
 * word of a vocabulary is a folder with a note in it, and is told by its
 * path in the tree, which is what a note's category or a record line's
 * label names it by.
 */

export function definitionNodeOf(node: DefinitionNodeInfo): JsonObject {
	const cut = node.taxonomyPath.lastIndexOf('/');
	return {
		taxonomyPath: node.taxonomyPath,
		name: node.name,
		depth: node.depth,
		parent: cut === -1 ? null : node.taxonomyPath.slice(0, cut),
		description: node.description,
		path: node.selfPath,
		folderPath: node.folderPath,
		// Notes use the word and nothing spells it, or its folder stands without its note.
		state: node.missing ? 'missing-folder' : node.missingSelf ? 'missing-note' : 'ok',
		usage: { categorized: node.usage.listed.length, labelled: node.usage.records.length },
	};
}

export function definitionTreeOf(vocabulary: string, kind: string, tree: DefinitionTreeInfo): JsonObject {
	return { vocabulary, kind, path: tree.rootPath, nodes: tree.nodes.map(definitionNodeOf) };
}

export function fieldTemplateOf(
	kind: string,
	template: CustomFieldTemplateInfo,
	isDefault: boolean,
	fields?: readonly CustomField[],
): JsonObject {
	const told: JsonObject = {
		kind,
		name: template.name,
		description: template.description,
		path: template.path,
		default: isDefault,
	};
	if (fields !== undefined) told['fields'] = fields.map((field) => ({ title: field.title, content: field.content }));
	return told;
}
