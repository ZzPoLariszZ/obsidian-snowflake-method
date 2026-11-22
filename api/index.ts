import { Dispatcher } from './dispatch';
import type { ApiHost } from './host';
import { QUEUE_DEPTH } from './limits';
import { ApiContext } from './operations/context';
import { allHandlers } from './operations/registry';
import { OperationQueue } from './queue';
import { contract } from './spec/document';
import { readOperations } from './spec/operations';

export type { ApiHost } from './host';
export type { Access } from './spec/operations';

/**
 * The local API, made once by the plugin on the desktop. It is the
 * contract, a handler for each operation the contract calls available, and
 * one way in for both doors. Making it opens nothing: no port is listened
 * on and no command answers until the plugin, on the author's word, says so.
 */
export interface LocalApi {
	readonly dispatcher: Dispatcher;
}

export function createLocalApi(host: ApiHost): LocalApi {
	const document = contract();
	const context = new ApiContext(host, document, readOperations(document));
	return { dispatcher: new Dispatcher(context, allHandlers(), new OperationQueue(QUEUE_DEPTH)) };
}
