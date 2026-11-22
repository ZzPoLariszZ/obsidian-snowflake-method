import contractText from '../openapi.yaml';
import { isJsonObject, isRecord, type JsonObject, type JsonValue } from '../json';

/**
 * The contract, read once. `openapi.yaml` is what the API promises, and
 * everything the API does about a call is decided from it: which address
 * leads to which operation, what a call may carry, what access it needs and
 * whether this build answers it at all. Nothing here knows any operation by
 * name.
 */
export interface ApiDocument {
	/** The whole document as it is written. */
	readonly root: JsonObject;
	/** Each address with the operations that stand at it. */
	readonly paths: Readonly<Record<string, JsonObject>>;
	/** What every address stands under, with no closing slash: `/v1`. */
	readonly basePath: string;
	/** The contract's own version. */
	readonly version: string;
}

const fail = (what: string): never => {
	throw new Error(`The API's contract is not as expected: ${what}.`);
};

/** The path part of a server's address, variables and all: `/v1` out of `http://127.0.0.1:{port}/v1`. */
const pathOfServer = (url: string): string => {
	const found = /^[a-z]+:\/\/[^/]+(\/.*)?$/u.exec(url);
	if (found === null) return fail('the server address has no host');
	const path = found[1] ?? '';
	return path.endsWith('/') ? path.slice(0, -1) : path;
};

/**
 * Looks the document over as far as the rest of the API leans on it. The
 * file is the project's own and the tests read every line of it, so this
 * does not check it for sense: it only refuses to go on with something that
 * is not a contract at all.
 */
export function readDocument(value: unknown): ApiDocument {
	if (!isRecord(value)) return fail('it is not an object');
	const root = value as JsonObject;
	const paths = root['paths'];
	if (!isJsonObject(paths)) return fail('it has no paths');
	const held: Record<string, JsonObject> = {};
	for (const [path, item] of Object.entries(paths)) {
		if (!isJsonObject(item)) return fail(`the path ${path} is not an object`);
		held[path] = item;
	}
	const info = root['info'];
	const version = isJsonObject(info) ? info['version'] : undefined;
	if (typeof version !== 'string') return fail('it has no version');
	const servers = root['servers'];
	const first = Array.isArray(servers) ? servers[0] : undefined;
	const url = isJsonObject(first) ? first['url'] : undefined;
	if (typeof url !== 'string') return fail('it names no server');
	return { root, paths: held, basePath: pathOfServer(url), version };
}

let held: ApiDocument | null = null;

/**
 * The contract this build was made with. It is carried as text and read
 * into the document the first time it is asked for, then kept. Where the
 * API never runs, on a phone or a tablet, nothing asks and nothing is read.
 */
export function contract(): ApiDocument {
	held ??= readDocument(JSON.parse(contractText()) as unknown);
	return held;
}

const REF_PREFIX = '#/';

/**
 * What a reference inside the document points at. Only the document's own
 * parts can be pointed at: a reference that leads out of the file, or
 * nowhere, is a fault in the contract, and the tests hold that there is none.
 */
export function resolveRef(document: ApiDocument, ref: string): JsonObject {
	if (!ref.startsWith(REF_PREFIX)) return fail(`the reference ${ref} leaves the document`);
	let at: JsonValue | undefined = document.root;
	for (const step of ref.slice(REF_PREFIX.length).split('/')) {
		const key = step.replace(/~1/gu, '/').replace(/~0/gu, '~');
		at = isJsonObject(at) ? at[key] : undefined;
	}
	if (!isJsonObject(at)) return fail(`the reference ${ref} leads nowhere`);
	return at;
}

/** The object itself, however many references stand in front of it. */
export function dereference(document: ApiDocument, value: JsonObject): JsonObject {
	let at = value;
	// A contract that points in a circle would otherwise never be left.
	for (let hops = 0; hops < 32; hops += 1) {
		const ref = at['$ref'];
		if (typeof ref !== 'string') return at;
		at = resolveRef(document, ref);
	}
	return fail('a reference points back at itself');
}
