/**
 * A small deterministic fuzzy matcher for the wikilink suggestions.
 *
 * Obsidian ships one, but it is not part of the test runtime's stub, and a
 * scorer whose behaviour differs between the app and the tests would make
 * ordering assertions meaningless. This one is ours end to end: the same
 * numbers fall out headless and live. It works code point by code point, so
 * a CJK query matches a CJK name the way a Latin one matches Latin.
 */

/** Word characters in the blocking sense: only ASCII words hold together. */
const WORD = /[a-z0-9]/u;

function foldToPoints(text: string): string[] {
	return [...text.toLocaleLowerCase()];
}

function wordStart(candidate: readonly string[], at: number): boolean {
	if (at === 0) return true;
	const before = candidate[at - 1];
	return before === undefined || !WORD.test(before);
}

function substringAt(
	candidate: readonly string[],
	query: readonly string[],
): number {
	outer: for (let at = 0; at + query.length <= candidate.length; at += 1) {
		for (const [offset, point] of query.entries()) {
			if (candidate[at + offset] !== point) continue outer;
		}
		return at;
	}
	return -1;
}

/**
 * Whether the candidate begins with the query, folded the way `fuzzyScore`
 * folds: what an author types from the start of a name is a stronger claim
 * on it than the same letters found further in. The empty query begins
 * nothing.
 */
export function matchesFromStart(query: string, candidate: string): boolean {
	const q = foldToPoints(query.trim());
	if (q.length === 0) return false;
	return substringAt(foldToPoints(candidate), q) === 0;
}

/**
 * Higher is better; null when the candidate does not match at all. The empty
 * query matches everything at zero, which keeps an unfiltered list in its
 * caller's own order.
 *
 * An exact substring always outranks a scattered subsequence: substring
 * scores live at 600 and above, subsequence scores at 500 and below. Within
 * each band, earlier, word-aligned and tighter matches score higher.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
	const q = foldToPoints(query.trim());
	if (q.length === 0) return 0;
	const c = foldToPoints(candidate);

	const at = substringAt(c, q);
	if (at >= 0) {
		let score = 1000 - at * 2 - Math.min(c.length - q.length, 100);
		if (at === 0) score += 50;
		if (wordStart(c, at)) score += 100;
		return Math.max(600, score);
	}

	let score = 0;
	let cursor = 0;
	let previous = -2;
	for (const point of q) {
		let found = -1;
		for (let index = cursor; index < c.length; index += 1) {
			if (c[index] === point) {
				found = index;
				break;
			}
		}
		if (found < 0) return null;
		score += 10;
		if (found === previous + 1) score += 15;
		if (wordStart(c, found)) score += 20;
		if (previous >= 0) score -= Math.min(found - previous - 1, 20);
		previous = found;
		cursor = found + 1;
	}
	score -= Math.min(c.length - q.length, 50);
	return Math.min(500, score);
}
