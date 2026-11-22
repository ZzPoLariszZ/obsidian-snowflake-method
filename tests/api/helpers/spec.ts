import text from '../../../api/openapi.yaml?raw';
import { isJsonObject, type JsonObject, type JsonValue } from '../../../api/json';
import { contract } from '../../../api/spec/document';
import { METHODS, readOperations, type OperationSpec } from '../../../api/spec/operations';

/** The contract as the build carries it, and as the file writes it. */
export const document = contract();
export const operations: readonly OperationSpec[] = readOperations(document);
export const specText: string = text;

/** A value where the contract should have words: the words, or nothing where it has something else. */
export const textOf = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

/** One operation as the contract writes it, with where it stands. */
export interface WrittenOperation {
	id: string;
	method: string;
	path: string;
	written: JsonObject;
}

export function writtenOperations(): WrittenOperation[] {
	const found: WrittenOperation[] = [];
	for (const [path, item] of Object.entries(document.paths)) {
		for (const method of METHODS) {
			const written = item[method.toLowerCase()];
			if (!isJsonObject(written)) continue;
			const id = written['operationId'];
			found.push({ id: typeof id === 'string' ? id : `${method} ${path}`, method, path, written });
		}
	}
	return found;
}

/** Every reference written anywhere under a value, each with the JSON Pointer it stands at. */
export function refsUnder(value: JsonValue, at = ''): { pointer: string; ref: string }[] {
	if (Array.isArray(value)) return value.flatMap((item, index) => refsUnder(item, `${at}/${String(index)}`));
	if (!isJsonObject(value)) return [];
	return Object.entries(value).flatMap(([key, item]) =>
		key === '$ref' && typeof item === 'string' ? [{ pointer: at, ref: item }] : refsUnder(item, `${at}/${key}`),
	);
}

/** The problem codes the contract lists, each with its status. */
export function problemRegistry(): Record<string, { status: number; title: string }> {
	const registry = document.root['x-snowflake-problems'];
	if (!isJsonObject(registry)) throw new Error('The contract lists no problems.');
	const found: Record<string, { status: number; title: string }> = {};
	for (const [code, entry] of Object.entries(registry)) {
		if (!isJsonObject(entry)) throw new Error(`The problem ${code} is not an object.`);
		const status = entry['status'];
		const title = entry['title'];
		if (typeof status !== 'number' || typeof title !== 'string') {
			throw new Error(`The problem ${code} lacks its status or its title.`);
		}
		found[code] = { status, title };
	}
	return found;
}
