import { boardOperations } from './boards';
import type { OperationGroup, OperationHandler } from './context';
import { manuscriptOperations } from './manuscript';
import { manuscriptWriteOperations } from './manuscript-writes';
import { memberWriteOperations } from './member-writes';
import { memberOperations } from './members';
import { projectOperations } from './projects';
import { recordOperations } from './records';
import { sessionOperations } from './sessions';
import { statisticsOperations } from './statistics';
import { stepOperations } from './steps';
import { systemOperations } from './system';
import { vocabularyOperations } from './vocabularies';

/** Every group of handlers this build carries. */
const GROUPS: readonly OperationGroup[] = [
	systemOperations,
	projectOperations,
	stepOperations,
	vocabularyOperations,
	memberOperations,
	memberWriteOperations,
	manuscriptOperations,
	manuscriptWriteOperations,
	recordOperations,
	statisticsOperations,
	sessionOperations,
	boardOperations,
];

/**
 * Every handler under the name of its operation. An operation is answered
 * when the contract calls it available and its handler stands here, and a
 * test holds the two lists equal: the contract cannot promise what has no
 * handler, and no handler can answer what the contract does not describe.
 */
export function allHandlers(): Map<string, OperationHandler> {
	const handlers = new Map<string, OperationHandler>();
	for (const group of GROUPS) {
		for (const [id, handler] of Object.entries(group)) {
			if (handlers.has(id)) throw new Error(`Two handlers answer the operation ${id}.`);
			handlers.set(id, handler);
		}
	}
	return handlers;
}
