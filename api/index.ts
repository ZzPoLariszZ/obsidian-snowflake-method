import type { LoopbackListenerFactory } from '../src/services/desktop-listener';
import { createCliDoor } from './cli/door';
import { Dispatcher } from './dispatch';
import type { ApiHost } from './host';
import { createHttpDoor } from './http/door';
import { Router } from './http/router';
import { ApiServer, type ServerStatus } from './http/server';
import { QUEUE_DEPTH } from './limits';
import { ApiContext } from './operations/context';
import { allHandlers } from './operations/registry';
import { OperationQueue } from './queue';
import { contract } from './spec/document';
import { readOperations } from './spec/operations';

export { CLI_COMMAND, CLI_FLAGS, CLI_FLAG_VALUES, type CliFlagName } from './cli/door';
export type { ApiHost } from './host';
export type { ServerStatus } from './http/server';
export { mintToken } from './http/token';
export { ACCESS_LEVELS, type Access } from './spec/operations';

/** What the API needs of the device and cannot reach for itself. */
export interface LocalApiDeps {
	/** The desktop's way to answer on a port, or null where there is none. */
	listeners(): Promise<LoopbackListenerFactory | null>;
	/** Settles after a wait, on the plugin's own clock. */
	pause(ms: number): Promise<void>;
	/** Told each time the listener starts, stops or fails. */
	serverChanged(status: ServerStatus): void;
}

/**
 * The local API, made once by the plugin on the desktop. It is the
 * contract, a handler for each operation the contract calls available, and
 * one way in for both doors. Making it opens nothing: no port is listened
 * on and no command answers until the plugin, on the author's word, says so.
 */
export interface LocalApi {
	readonly dispatcher: Dispatcher;
	/** The HTTP door's listener, started and stopped by the plugin. */
	readonly server: ApiServer;
	/** The command line's door: the flags of one call in, one line of JSON out. It never rejects. */
	readonly cli: (flags: Readonly<Record<string, string>>) => Promise<string>;
}

export function createLocalApi(host: ApiHost, deps: LocalApiDeps): LocalApi {
	const document = contract();
	const operations = readOperations(document);
	const context = new ApiContext(host, document, operations);
	const dispatcher = new Dispatcher(context, allHandlers(), new OperationQueue(QUEUE_DEPTH));
	const router = new Router(operations, document.basePath);
	const server = new ApiServer({
		listeners: () => deps.listeners(),
		door: (port) =>
			createHttpDoor({
				dispatcher,
				router,
				basePath: document.basePath,
				token: () => host.token(),
				port,
				pause: (ms) => deps.pause(ms),
			}),
		token: () => host.token(),
		changed: (status) => {
			deps.serverChanged(status);
		},
	});
	const cli = createCliDoor({ dispatcher, basePath: document.basePath, enabled: () => host.cliEnabled() });
	return { dispatcher, server, cli };
}
