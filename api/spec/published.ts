import { cloneJson, isJsonObject, type JsonObject, type JsonValue } from '../json';
import type { ApiDocument } from './document';
import { METHODS, type OperationSpec } from './operations';

const COMPONENTS_PREFIX = '#/components/';

/** Every reference written anywhere under a value. */
function collectRefs(value: JsonValue, into: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) collectRefs(item, into);
		return;
	}
	if (!isJsonObject(value)) return;
	for (const [key, item] of Object.entries(value)) {
		if (key === '$ref' && typeof item === 'string') into.add(item);
		else collectRefs(item, into);
	}
}

/** The section and name a reference points at: `schemas` and `Problem`. */
function partsOf(ref: string): [string, string] | null {
	if (!ref.startsWith(COMPONENTS_PREFIX)) return null;
	const [section, name] = ref.slice(COMPONENTS_PREFIX.length).split('/');
	return section === undefined || name === undefined ? null : [section, name];
}

/**
 * The contract as a caller is shown it: the operations this build answers
 * and nothing else. The ones planned for later are in the project's file so
 * the whole design can be read in one place, and a caller that built its
 * tools from them would be offered doors that are not there yet. What only
 * they pointed at goes with them, and the server's address carries the port
 * the listener is on.
 */
export function publishedDocument(
	document: ApiDocument,
	operations: readonly OperationSpec[],
	port: number,
): JsonObject {
	const answered = new Set(operations.filter((operation) => operation.available).map((operation) => operation.id));
	const root = cloneJson(document.root);

	const paths: JsonObject = {};
	const tagsInUse = new Set<string>();
	for (const [path, item] of Object.entries(document.paths)) {
		const kept: JsonObject = {};
		let any = false;
		for (const [key, value] of Object.entries(cloneJson(item))) {
			const isOperation = (METHODS as readonly string[]).includes(key.toUpperCase());
			if (!isOperation) {
				kept[key] = value;
				continue;
			}
			const id = isJsonObject(value) ? value['operationId'] : undefined;
			if (typeof id !== 'string' || !answered.has(id) || !isJsonObject(value)) continue;
			kept[key] = value;
			any = true;
			const tags = value['tags'];
			if (Array.isArray(tags)) {
				for (const tag of tags) if (typeof tag === 'string') tagsInUse.add(tag);
			}
		}
		if (any) paths[path] = kept;
	}
	root['paths'] = paths;

	const tags = root['tags'];
	if (Array.isArray(tags)) {
		root['tags'] = tags.filter((tag) => isJsonObject(tag) && typeof tag['name'] === 'string' && tagsInUse.has(tag['name']));
	}

	const components = root['components'];
	if (isJsonObject(components)) {
		// What the kept operations point at, and what those point at in turn.
		const wanted = new Set<string>();
		const waiting: string[] = [];
		const take = (value: JsonValue): void => {
			const found = new Set<string>();
			collectRefs(value, found);
			for (const ref of found) {
				if (wanted.has(ref)) continue;
				wanted.add(ref);
				waiting.push(ref);
			}
		};
		take(paths);
		for (let ref = waiting.pop(); ref !== undefined; ref = waiting.pop()) {
			const parts = partsOf(ref);
			if (parts === null) continue;
			const section = components[parts[0]];
			const target = isJsonObject(section) ? section[parts[1]] : undefined;
			if (target !== undefined) take(target);
		}
		const kept: JsonObject = {};
		for (const [section, entries] of Object.entries(components)) {
			// How a caller proves itself is said whole, pointed at or not.
			if (section === 'securitySchemes' || !isJsonObject(entries)) {
				kept[section] = entries;
				continue;
			}
			const some: JsonObject = {};
			for (const [name, entry] of Object.entries(entries)) {
				if (wanted.has(`${COMPONENTS_PREFIX}${section}/${name}`)) some[name] = entry;
			}
			if (Object.keys(some).length > 0) kept[section] = some;
		}
		root['components'] = kept;
	}

	const servers = root['servers'];
	const first = Array.isArray(servers) ? servers[0] : undefined;
	const variables = isJsonObject(first) ? first['variables'] : undefined;
	const portVariable = isJsonObject(variables) ? variables['port'] : undefined;
	if (isJsonObject(portVariable)) portVariable['default'] = String(port);

	return root;
}
