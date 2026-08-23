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

/*
 * Case is folded with `toLowerCase`, never `toLocaleLowerCase`: the locale-aware
 * one folds by whatever locale the machine happens to run under, and under a
 * Turkish or Azeri one an I becomes a dotless ı, which the query's own i then
 * fails to match -- an entity gone from the list for no reason its author could
 * see. The V8 shortcut for plain Latin-1 hides it until one character of the name
 * is not Latin-1, which in a manuscript is any curly apostrophe and every Chinese
 * name. A matching key is not writing shown to anyone, so it wants the one
 * mapping that is the same everywhere, which is also what keeps the promise
 * above: the same numbers headless and live.
 */
function foldToPoints(text: string): string[] {
	return [...text.toLowerCase()];
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
 * How a candidate answered a query.
 *
 * `fromStart` says the candidate begins with what was typed, which is a
 * stronger claim on a name than the same letters found further in. It falls
 * out of the scoring rather than being asked for separately: answering it
 * apart meant folding both strings a second time and scanning them again, for
 * something the scorer had just worked out and thrown away.
 */
export interface FuzzyMatch {
	score: number;
	fromStart: boolean;
}

/**
 * Higher is better; null when the candidate does not match at all. The empty
 * query matches everything at zero, which keeps an unfiltered list in its
 * caller's own order, and begins nothing.
 *
 * An exact substring always outranks a scattered subsequence: substring
 * scores live at 600 and above, subsequence scores at 500 and below. Within
 * each band, earlier, word-aligned and tighter matches score higher.
 */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
	const q = foldToPoints(query.trim());
	if (q.length === 0) return { score: 0, fromStart: false };
	const c = foldToPoints(candidate);

	const at = substringAt(c, q);
	if (at >= 0) {
		let score = 1000 - at * 2 - Math.min(c.length - q.length, 100);
		if (at === 0) score += 50;
		if (wordStart(c, at)) score += 100;
		return { score: Math.max(600, score), fromStart: at === 0 };
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
	// A scattered match never begins the candidate: had it, the substring
	// branch above would have taken it.
	return { score: Math.min(500, score), fromStart: false };
}

/** The score alone, for callers with nothing to say about where it matched. */
export function fuzzyScore(query: string, candidate: string): number | null {
	return fuzzyMatch(query, candidate)?.score ?? null;
}
