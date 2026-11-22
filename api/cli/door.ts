import type { Dispatcher, DispatchReply } from '../dispatch';
import { ApiError } from '../errors';
import { isRecord, type JsonObject } from '../json';
import { BRIDGE_BYTES } from '../limits';

/** The command the bridge answers under, in the form Obsidian asks of a plugin: its id, then the action. */
export const CLI_COMMAND = 'snowflake-method:api';

/** The flags the bridge takes, in the order they are shown. */
export const CLI_FLAGS = ['op', 'params', 'body', 'ifMatch', 'pretty'] as const;
export type CliFlagName = (typeof CLI_FLAGS)[number];

/** What stands where a flag shows its value, for the four that take one. */
export const CLI_FLAG_VALUES: Readonly<Record<Exclude<CliFlagName, 'pretty'>, string>> = {
	op: '<operationId>',
	params: '<json>',
	body: '<json>',
	ifMatch: '<etag>',
};

/** The operation a call with no `op` is taken to mean: what answers here. */
const DEFAULT_OPERATION = 'getApiRoot';

export interface CliDoorDeps {
	readonly dispatcher: Dispatcher;
	/** What every address stands under, so a place named in an answer reads as it does over HTTP. */
	readonly basePath: string;
	/** Whether the author has switched the bridge on. */
	enabled(): boolean;
}

/**
 * A flag's value as its JSON. A value that begins with `%` is read back out
 * of percent-encoding first: JSON never begins so, and a caller that sends
 * every value that way has no shell's quoting to get right.
 */
function decodeFlag(name: string, raw: string): string {
	if (!raw.startsWith('%')) return raw;
	try {
		return decodeURIComponent(raw);
	} catch {
		throw new ApiError('invalid-request', `The flag ${name} begins with % and is not percent-encoded text.`);
	}
}

function jsonFlag(name: string, text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new ApiError('invalid-request', `The flag ${name} is not JSON.`);
	}
}

const bytesOf = (text: string): number => new TextEncoder().encode(text).byteLength;

/** The version a caller names, without its quotes. */
function versionOf(raw: string): string | null {
	let value = raw.trim();
	if (value === '') return null;
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
	return value;
}

/**
 * The command line's door: one call through Obsidian's own `obsidian`
 * command, answered with one line of JSON.
 *
 * Obsidian hands a plugin's command nothing but words, a name and a value
 * each, and takes one string back. So an operation is named by its id, what
 * its address and its query would carry over HTTP travels as one JSON
 * object, the body as another, and the answer is an envelope that says in
 * its own words what a status line and headers would have said.
 *
 * No token is asked here. The command is run by somebody at this computer
 * who already has the vault before them, and the author's access level
 * holds as it does at the other door. Nothing is ever thrown: a throw
 * reaches the caller as bare text, which no program could read.
 */
export function createCliDoor(deps: CliDoorDeps): (flags: Readonly<Record<string, string>>) => Promise<string> {
	const envelope = (reply: DispatchReply): JsonObject => {
		const base: JsonObject = { ok: !reply.failed, status: reply.status, operationId: reply.operationId };
		if (reply.etag !== null) base['etag'] = reply.etag;
		if (reply.location !== null) base['location'] = `${deps.basePath}${reply.location}`;
		if (reply.failed) base['error'] = reply.body ?? null;
		else if (reply.body !== undefined) base['data'] = reply.body;
		return base;
	};

	const answer = async (flags: Readonly<Record<string, string>>, operationId: string): Promise<DispatchReply> => {
		if (!deps.enabled()) {
			throw new ApiError(
				'cli-bridge-off',
				'The command line bridge is switched off. The author switches it on in the plugin\'s settings, under Local API.',
			);
		}
		for (const name of Object.keys(flags)) {
			if (!(CLI_FLAGS as readonly string[]).includes(name)) {
				throw new ApiError(
					'invalid-request',
					`The flag ${name} is not known. An operation's own parameters go in params, as one JSON object.`,
				);
			}
		}
		const paramsText = flags['params'] === undefined ? null : decodeFlag('params', flags['params']);
		const bodyText = flags['body'] === undefined ? null : decodeFlag('body', flags['body']);
		if (bytesOf(paramsText ?? '') + bytesOf(bodyText ?? '') > BRIDGE_BYTES) {
			throw new ApiError(
				'payload-too-large',
				`A call through the command line may carry ${String(BRIDGE_BYTES)} bytes at most. Send longer text over HTTP.`,
			);
		}
		const params = paramsText === null ? {} : jsonFlag('params', paramsText);
		if (!isRecord(params)) throw new ApiError('invalid-request', 'The flag params must be a JSON object.');
		return deps.dispatcher.dispatch({
			operationId,
			params,
			body: bodyText === null ? undefined : jsonFlag('body', bodyText),
			ifMatch: flags['ifMatch'] === undefined ? null : versionOf(flags['ifMatch']),
			// Whoever runs the command is at this computer with the vault open.
			authenticated: true,
		});
	};

	return async (flags) => {
		const named = flags['op'];
		const operationId = named === undefined || named === 'true' || named === '' ? DEFAULT_OPERATION : named;
		let reply: DispatchReply;
		try {
			reply = await answer(flags, operationId);
		} catch (error) {
			reply = deps.dispatcher.refused(operationId, error);
		}
		return JSON.stringify(envelope(reply), null, flags['pretty'] === undefined ? undefined : 2);
	};
}
