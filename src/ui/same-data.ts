/**
 * Whether two values hold the same data.
 *
 * Primitives are the same when they are the same value. Arrays, plain
 * objects, maps, sets and dates are the same when they hold the same things
 * in the same places. Anything else, a function or an instance of a class,
 * is the same only as itself: nothing here guesses at what such a thing
 * means.
 *
 * Made for one question, asked by a dashboard after a reading that followed
 * a pane already on show: is the model just read the one that is drawn? A
 * yes lets the frame stand, with the caret, the open list and the scroll the
 * author has in it. A no costs a redraw, which is what was owed anyway, so
 * every doubt is answered no. A walk with no string built, and it stops at
 * the first difference.
 */
export function sameData(left: unknown, right: unknown): boolean {
	return same(left, right, 0);
}

/** Deeper than any model is laid: a value that loops back on itself is called different, not walked for ever. */
const DEEPEST = 64;

function same(left: unknown, right: unknown, depth: number): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
		return false;
	}
	if (depth > DEEPEST) return false;
	if (Array.isArray(left)) {
		if (!Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1) {
			if (!same(left[index], right[index], depth + 1)) return false;
		}
		return true;
	}
	if (Array.isArray(right)) return false;
	const kind: unknown = Object.getPrototypeOf(left);
	if (kind !== Object.getPrototypeOf(right)) return false;
	if (left instanceof Date) return left.getTime() === (right as Date).getTime();
	if (left instanceof Map) {
		const other = right as Map<unknown, unknown>;
		if (left.size !== other.size) return false;
		for (const [key, value] of left) {
			if (!other.has(key) || !same(value, other.get(key), depth + 1)) return false;
		}
		return true;
	}
	if (left instanceof Set) {
		const other = right as Set<unknown>;
		if (left.size !== other.size) return false;
		for (const member of left) {
			if (!other.has(member)) return false;
		}
		return true;
	}
	// An instance of a class is itself or it is something else.
	if (kind !== Object.prototype && kind !== null) return false;
	const here = left as Record<string, unknown>;
	const there = right as Record<string, unknown>;
	const keys = Object.keys(here);
	if (keys.length !== Object.keys(there).length) return false;
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(there, key)) return false;
		if (!same(here[key], there[key], depth + 1)) return false;
	}
	return true;
}
