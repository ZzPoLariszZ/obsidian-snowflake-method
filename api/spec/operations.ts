import { isJsonObject, type JsonObject, type JsonValue } from '../json';
import { dereference, type ApiDocument } from './document';

/** What an operation does to the author's work, and so which access level it needs. */
export type Access = 'read' | 'write' | 'delete';

export const ACCESS_LEVELS: readonly Access[] = ['read', 'write', 'delete'];

/** Whether an author who chose `level` lets an operation of class `needed` through. */
export const allows = (level: Access, needed: Access): boolean =>
	ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(needed);

export type Method = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';

export const METHODS: readonly Method[] = ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'];

/** One step of an address: a word that must stand there, or a place a value goes. */
export type PathSegment =
	| { readonly kind: 'literal'; readonly text: string }
	| { readonly kind: 'parameter'; readonly name: string };

export interface OperationParameter {
	readonly name: string;
	readonly where: 'path' | 'query';
	readonly required: boolean;
	readonly schema: JsonObject;
}

/** Whether a call must say which version of a note it means to change. */
export type Precondition = 'required' | 'optional' | 'none';

export interface OperationSpec {
	readonly id: string;
	readonly method: Method;
	/** The address as the contract writes it, under the base path: `/projects/{projectId}`. */
	readonly path: string;
	readonly segments: readonly PathSegment[];
	readonly access: Access;
	/** Whether this build answers it. A planned one is in the contract for review only. */
	readonly available: boolean;
	readonly round: number;
	/** Answered without a token. */
	readonly open: boolean;
	/** Answered at once: it waits for nothing and stands in no queue. */
	readonly direct: boolean;
	readonly parameters: readonly OperationParameter[];
	readonly precondition: Precondition;
	readonly body: { readonly required: boolean; readonly schema: JsonObject } | null;
}

const fail = (what: string): never => {
	throw new Error(`The API's contract is not as expected: ${what}.`);
};

const IF_MATCH = 'if-match';

/** The steps of an address, each literal or a parameter's place. */
export function segmentsOf(path: string): PathSegment[] {
	if (path === '/') return [];
	return path
		.slice(1)
		.split('/')
		.map<PathSegment>((step) =>
			step.startsWith('{') && step.endsWith('}')
				? { kind: 'parameter', name: step.slice(1, -1) }
				: { kind: 'literal', text: step },
		);
}

function readParameters(
	document: ApiDocument,
	id: string,
	lists: readonly (JsonValue | undefined)[],
): { parameters: OperationParameter[]; precondition: Precondition } {
	const parameters: OperationParameter[] = [];
	let precondition: Precondition = 'none';
	for (const list of lists) {
		if (list === undefined) continue;
		if (!Array.isArray(list)) return fail(`${id} has parameters that are not a list`);
		for (const entry of list) {
			if (!isJsonObject(entry)) return fail(`${id} has a parameter that is not an object`);
			const parameter = dereference(document, entry);
			const name = parameter['name'];
			const where = parameter['in'];
			if (typeof name !== 'string') return fail(`${id} has a parameter with no name`);
			const required = parameter['required'] === true;
			if (where === 'header') {
				// The one header the contract declares is the version a change is
				// made against. It travels its own way through the API, since the
				// command line has no headers to put it in.
				if (name.toLowerCase() !== IF_MATCH) return fail(`${id} declares the header ${name}`);
				precondition = required ? 'required' : 'optional';
				continue;
			}
			if (where !== 'path' && where !== 'query') return fail(`${id} has the parameter ${name} in no known place`);
			const schema = parameter['schema'];
			if (!isJsonObject(schema)) return fail(`${id} has the parameter ${name} with no schema`);
			parameters.push({ name, where, required: where === 'path' ? true : required, schema });
		}
	}
	return { parameters, precondition };
}

function readBody(document: ApiDocument, id: string, value: JsonValue | undefined): OperationSpec['body'] {
	if (value === undefined) return null;
	if (!isJsonObject(value)) return fail(`${id} has a body that is not an object`);
	const body = dereference(document, value);
	const content = body['content'];
	if (!isJsonObject(content)) return fail(`${id} has a body with no content`);
	// A body is JSON, whichever of the two names a change is sent under.
	const media = content['application/json'] ?? content['application/merge-patch+json'];
	const schema = isJsonObject(media) ? media['schema'] : undefined;
	if (!isJsonObject(schema)) return fail(`${id} has a body with no schema`);
	return { required: body['required'] === true, schema };
}

const isAccess = (value: unknown): value is Access =>
	typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);

/**
 * Every operation the contract describes, the planned ones among them, in
 * the order it is written.
 */
export function readOperations(document: ApiDocument): OperationSpec[] {
	const operations: OperationSpec[] = [];
	for (const [path, item] of Object.entries(document.paths)) {
		for (const method of METHODS) {
			const operation = item[method.toLowerCase()];
			if (operation === undefined) continue;
			if (!isJsonObject(operation)) return fail(`${method} ${path} is not an object`);
			const id = operation['operationId'];
			if (typeof id !== 'string') return fail(`${method} ${path} has no operationId`);
			const access = operation['x-snowflake-access'];
			if (!isAccess(access)) return fail(`${id} names no access class`);
			const availability = operation['x-snowflake-availability'];
			if (!isJsonObject(availability)) return fail(`${id} does not say whether it is available`);
			const status = availability['status'];
			const round = availability['round'];
			if (status !== 'available' && status !== 'planned') return fail(`${id} has an unknown availability`);
			if (typeof round !== 'number') return fail(`${id} names no round`);
			const security = operation['security'];
			const { parameters, precondition } = readParameters(document, id, [item['parameters'], operation['parameters']]);
			operations.push({
				id,
				method,
				path,
				segments: segmentsOf(path),
				access,
				available: status === 'available',
				round,
				open: Array.isArray(security) && security.length === 0,
				direct: operation['x-snowflake-direct'] === true,
				parameters,
				precondition,
				body: readBody(document, id, operation['requestBody']),
			});
		}
	}
	return operations;
}
