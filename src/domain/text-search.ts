/**
 * Finding words in a manuscript as a find bar finds them, and putting other
 * words in their place.
 *
 * A query is the words themselves or a regular expression, in any case or
 * only the case typed, anywhere or only where it stands as whole words. It is
 * asked of the text as written, syntax and all, which is the text a
 * replacement edits: the stream shows rendered prose, but it writes Markdown.
 *
 * Whole words are told the way a mention is (see `hasWordBoundary`): a match
 * is refused only where a letter or digit at its edge runs on into another,
 * and the CJK scripts draw no word edges, so in Chinese the option holds
 * every match.
 *
 * A replacement for a regular expression reads JavaScript's own `$1`, `$&`
 * and `$<name>`, and `\n`, `\t` and `\\` as a line break, a tab and a
 * backslash, as a code editor's find bar reads them. For the words
 * themselves it is the words, as typed.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { hasWordBoundary } from './mentions';

export interface TextSearchOptions {
	/** Only the case as typed; off, A and a are one letter. */
	caseSensitive: boolean;
	/** Only where the match stands as whole words. */
	wholeWord: boolean;
	/** The query is a regular expression rather than the words to find. */
	regex: boolean;
}

export interface TextRange {
	from: number;
	to: number;
}

/** A query ready to run: the pattern, and the same pattern pinned to a place. */
export interface TextSearch {
	readonly regex: boolean;
	readonly wholeWord: boolean;
	/** Global, for walking a text from the start. */
	readonly pattern: RegExp;
	/** Sticky, for asking whether a match still stands at one offset. */
	readonly pinned: RegExp;
}

/** What a query compiles to: a search, or why the expression will not read. */
export type CompiledTextSearch =
	| { ok: true; search: TextSearch }
	| { ok: false; error: string };

const SPECIAL = /[.*+?^${}()|[\]\\]/gu;

/**
 * The query compiled, or null when there is nothing to look for. An
 * expression that will not read under the Unicode flag is tried once more
 * without it, because a pattern written for the older dialect -- an escaped
 * hyphen, say -- is still the pattern the author meant.
 */
export function compileTextSearch(
	query: string,
	options: TextSearchOptions,
): CompiledTextSearch | null {
	if (query.length === 0) return null;
	const source = options.regex ? query : query.replace(SPECIAL, '\\$&');
	const fold = options.caseSensitive ? '' : 'i';
	const attempts = options.regex ? [`gmu${fold}`, `gm${fold}`] : [`gu${fold}`];
	let error = '';
	for (const flags of attempts) {
		try {
			const pattern = new RegExp(source, flags);
			const pinned = new RegExp(source, `${flags.replace('g', '')}y`);
			return {
				ok: true,
				search: {
					regex: options.regex,
					wholeWord: options.wholeWord,
					pattern,
					pinned,
				},
			};
		} catch (thrown) {
			error = thrown instanceof Error ? thrown.message : String(thrown);
		}
	}
	return { ok: false, error };
}

/** One code point on from `at`: a surrogate pair is never split. */
function stepPast(text: string, at: number): number {
	const unit = text.charCodeAt(at);
	if (unit >= 0xd800 && unit <= 0xdbff) {
		const next = text.charCodeAt(at + 1);
		if (next >= 0xdc00 && next <= 0xdfff) return at + 2;
	}
	return at + 1;
}

/** Whether a match counts: it holds something, and stands on its own when asked to. */
function counts(text: string, search: TextSearch, from: number, to: number): boolean {
	if (to <= from) return false;
	return !search.wholeWord || hasWordBoundary(text, from, to, { from: 0, to: text.length });
}

/**
 * Every match in one text, in order, none overlapping. A match of nothing
 * is passed over -- a find bar has nothing to show for one -- and so is one
 * that is not a whole word when whole words are asked for, the search going
 * on from the character after its start, where a whole word may yet begin.
 */
function* eachMatch(text: string, search: TextSearch): Generator<RegExpExecArray> {
	const { pattern } = search;
	pattern.lastIndex = 0;
	for (;;) {
		const match = pattern.exec(text);
		if (match === null) return;
		const from = match.index;
		const to = from + match[0].length;
		if (!counts(text, search, from, to)) {
			pattern.lastIndex = stepPast(text, from);
			continue;
		}
		yield match;
		// The generator may be left before the walk ends, and the pattern is
		// shared: the place it stands at is taken again on the next pull.
		pattern.lastIndex = to;
	}
}

/** The matches in one text, in order, at most `limit` of them. */
export function findTextMatches(
	text: string,
	search: TextSearch,
	limit = Number.POSITIVE_INFINITY,
): TextRange[] {
	const found: TextRange[] = [];
	if (limit <= 0) return found;
	for (const match of eachMatch(text, search)) {
		found.push({ from: match.index, to: match.index + match[0].length });
		if (found.length >= limit) break;
	}
	return found;
}

/** The match standing exactly at a range, or null when the text there no longer answers. */
function matchAt(text: string, search: TextSearch, range: TextRange): RegExpExecArray | null {
	const { pinned } = search;
	pinned.lastIndex = range.from;
	const match = pinned.exec(text);
	if (match === null || match.index !== range.from) return null;
	if (match.index + match[0].length !== range.to) return null;
	return counts(text, search, range.from, range.to) ? match : null;
}

/**
 * A replacement as a code editor's find bar reads it: `\n`, `\t` and `\\`
 * become a line break, a tab and one backslash, and any other backslash is
 * left standing. Only for a regular expression.
 */
export function unescapeReplacement(template: string): string {
	return template.replace(/\\([nt\\])/gu, (_all, code: string) =>
		code === 'n' ? '\n' : code === 't' ? '\t' : '\\',
	);
}

/**
 * What one match is replaced with under JavaScript's own rules: `$$`, `$&`,
 * `` $` ``, `$'`, `$1` to `$99` for the groups there are, and `$<name>`
 * where the pattern names its groups. Anything else after a `$` stands as
 * written, as it does in `String.prototype.replace`.
 */
export function expandReplacement(
	template: string,
	match: RegExpExecArray,
	text: string,
): string {
	const matched = match[0];
	const start = match.index;
	const end = start + matched.length;
	const captures = match.length - 1;
	const isDigit = (char: string): boolean => char >= '0' && char <= '9';
	let result = '';
	for (let at = 0; at < template.length; at += 1) {
		const char = template.charAt(at);
		const next = template.charAt(at + 1);
		if (char !== '$' || next === '') {
			result += char;
			continue;
		}
		if (next === '$') {
			result += '$';
			at += 1;
		} else if (next === '&') {
			result += matched;
			at += 1;
		} else if (next === '`') {
			result += text.slice(0, start);
			at += 1;
		} else if (next === "'") {
			result += text.slice(end);
			at += 1;
		} else if (isDigit(next)) {
			const after = template.charAt(at + 2);
			const two = isDigit(after) ? Number(next + after) : 0;
			const one = Number(next);
			if (two >= 1 && two <= captures) {
				result += match[two] ?? '';
				at += 2;
			} else if (one >= 1 && one <= captures) {
				result += match[one] ?? '';
				at += 1;
			} else {
				result += '$';
			}
		} else if (next === '<' && match.groups !== undefined) {
			const close = template.indexOf('>', at + 2);
			if (close === -1) {
				result += '$';
			} else {
				result += match.groups[template.slice(at + 2, close)] ?? '';
				at = close;
			}
		} else {
			result += '$';
		}
	}
	return result;
}

/**
 * What the match at a range is replaced with, or null when the text there no
 * longer answers the search -- the range was found in a text since edited.
 * Asked of the whole text, so an expression that looks behind or ahead of its
 * match is answered as it was when the match was found.
 */
export function replacementFor(
	text: string,
	search: TextSearch,
	range: TextRange,
	template: string,
): string | null {
	const match = matchAt(text, search, range);
	if (match === null) return null;
	return search.regex
		? expandReplacement(unescapeReplacement(template), match, text)
		: template;
}

/** One stretch of a text and what goes in its place. */
export interface TextReplacement extends TextRange {
	insert: string;
}

/**
 * What every match in one text is replaced with, in order: one edit per
 * match, so an editor can make them as one change and keep everything
 * between them where it was.
 */
export function replacementsIn(
	text: string,
	search: TextSearch,
	template: string,
): TextReplacement[] {
	const unescaped = search.regex ? unescapeReplacement(template) : template;
	const replacements: TextReplacement[] = [];
	for (const match of eachMatch(text, search)) {
		const from = match.index;
		replacements.push({
			from,
			to: from + match[0].length,
			insert: search.regex ? expandReplacement(unescaped, match, text) : unescaped,
		});
	}
	return replacements;
}

/** A text with its replacements made; they arrive in order and none overlaps. */
export function applyReplacements(
	text: string,
	replacements: readonly TextReplacement[],
): string {
	let result = '';
	let kept = 0;
	for (const replacement of replacements) {
		result += text.slice(kept, replacement.from) + replacement.insert;
		kept = replacement.to;
	}
	return replacements.length === 0 ? text : result + text.slice(kept);
}

/** Every match in one text replaced at once, with how many there were. */
export function replaceTextMatches(
	text: string,
	search: TextSearch,
	template: string,
): { text: string; count: number } {
	const replacements = replacementsIn(text, search, template);
	return { text: applyReplacements(text, replacements), count: replacements.length };
}
