import type { JsonObject, JsonValue } from './json';
import { numberParam, type OperationCall } from './operations/context';

/**
 * One page of a list, in the shape every list answers in: the items, how
 * many there are in all, and where the next page begins. The order is the
 * list's own, which is the author's: nothing is sorted here.
 *
 * The call's `offset` and `limit` were given their defaults and held to
 * their bounds by the contract before a handler saw them. A list whose
 * items are heavy to tell may hold a page to fewer, and the answer then
 * says the limit it kept to.
 *
 * Only the items of the page are told: `each` is asked for those and no
 * others, so a long list costs what one page of it costs.
 */
export function pageOf<T>(
	items: readonly T[],
	call: OperationCall,
	each: (item: T) => JsonValue,
	most: number = Number.POSITIVE_INFINITY,
): JsonObject {
	const offset = numberParam(call, 'offset');
	const limit = Math.min(numberParam(call, 'limit'), most);
	const shown = items.slice(offset, offset + limit);
	const next = offset + shown.length;
	return {
		items: shown.map(each),
		total: items.length,
		offset,
		limit,
		nextOffset: next < items.length ? next : null,
	};
}
