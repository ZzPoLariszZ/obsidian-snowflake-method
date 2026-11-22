import { ApiError } from '../errors';
import type { ApiHost } from '../host';
import type { JsonObject, JsonValue } from '../json';
import type { ApiDocument } from '../spec/document';
import type { OperationSpec } from '../spec/operations';
import { publishedDocument } from '../spec/published';

/**
 * One call as a handler is given it: already found, allowed and held
 * against the contract, whichever door it came through.
 */
export interface OperationCall {
	readonly operation: OperationSpec;
	/** The address's and the query's values, typed as the contract types them. */
	readonly params: Readonly<Record<string, unknown>>;
	/** The body as the contract describes it, or undefined where there is none. */
	readonly body: unknown;
	/** The version the caller means to change: an etag, `*` for whichever stands, or null where none was sent. */
	readonly ifMatch: string | null;
	/** Whether the caller proved itself. Only the operations answered without a token ever see false. */
	readonly authenticated: boolean;
}

/** What a handler answers. The doors turn it into a reply of their own kind. */
export interface OperationResult {
	readonly status: 200 | 201 | 204;
	readonly body?: JsonValue;
	/** The version of the note the answer describes, for the caller's next change. */
	readonly etag?: string;
	/** Where the thing made or moved now stands, as an address under the base path. */
	readonly location?: string;
}

export type OperationHandler = (call: OperationCall, context: ApiContext) => OperationResult | Promise<OperationResult>;

/** The handlers of one group, each under the name the contract gives its operation. */
export type OperationGroup = Readonly<Record<string, OperationHandler>>;

/** What every handler works with: the plugin, and the contract it answers to. */
export class ApiContext {
	constructor(
		readonly host: ApiHost,
		readonly document: ApiDocument,
		readonly operations: readonly OperationSpec[],
	) {}

	/** The contract as a caller is shown it, with the port the author chose. */
	published(): JsonObject {
		return publishedDocument(this.document, this.operations, this.host.port());
	}
}

/**
 * A parameter the contract types as text. The call was held against the
 * contract before any handler saw it, so finding something else here means
 * the handler asked for a name its operation does not declare: a fault of
 * the API's own, and answered as one.
 */
export function textParam(call: OperationCall, name: string): string {
	const value = call.params[name];
	if (typeof value !== 'string') throw new ApiError('internal-error', 'The operation failed.');
	return value;
}

/** The same for one that may be left out. */
export function optionalTextParam(call: OperationCall, name: string): string | null {
	const value = call.params[name];
	return typeof value === 'string' ? value : null;
}

export function numberParam(call: OperationCall, name: string): number {
	const value = call.params[name];
	if (typeof value !== 'number') throw new ApiError('internal-error', 'The operation failed.');
	return value;
}

export function flagParam(call: OperationCall, name: string): boolean {
	return call.params[name] === true;
}

/** A list parameter's words, or none where it was left out. */
export function listParam(call: OperationCall, name: string): string[] {
	const value = call.params[name];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
