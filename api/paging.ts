import type { JsonObject, JsonValue } from './json';
import { numberParam, type OperationCall } from './operations/context';

/**
 * One page of a list, in the shape every list answers in: the items, how
 * many there are in all, and where the next page begins. The order is the
 * list's own, which is the author's: nothing is sorted here.
 *
 * The call's `offset` and `limit` were given their defaults and held to
 * their bounds by the contract before a handler saw them.
 */
export function pageOf(items: readonly JsonValue[], call: OperationCall): JsonObject {
	const offset = numberParam(call, 'offset');
	const limit = numberParam(call, 'limit');
	const shown = items.slice(offset, offset + limit);
	const next = offset + shown.length;
	return {
		items: shown,
		total: items.length,
		offset,
		limit,
		nextOffset: next < items.length ? next : null,
	};
}
