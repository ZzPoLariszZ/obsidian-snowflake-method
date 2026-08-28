/**
 * Word frequency: tokens, their counts, and the filters that read them.
 *
 * Tokenization leans on the platform's own dictionary segmenter --
 * `Intl.Segmenter` with word granularity, the same ICU machinery that gives
 * 缓缓 and 突然 back as words -- because a jieba-quality segmentation ships
 * inside every runtime this plugin reaches, and bundling one would not. The
 * compile target predates the API, so it is reached through a structural
 * cast that doubles as the feature test; a runtime without it falls back to
 * Latin word runs plus CJK single characters, and the availability is part
 * of the tokenizer's fingerprint so two vocabularies never mix in one cache.
 *
 * The dictionary knows no invented names: 萧薰儿 comes back as three
 * fragments, and the surname alone tops the table. The roster is the cure --
 * a token lexicon built from every entity name and alias is consulted first,
 * each hit counted whole as one token under the label's normalized form, and
 * only the gaps between hits reach the segmenter. Matching follows the
 * mention matcher exactly: the same Unicode forms, the same word-boundary
 * rule, the same exact case, so a name is atomic precisely where a mention
 * would be found. A possessive right after a name -- Alice's -- folds into
 * the name rather than leaving a stray s behind.
 *
 * Per-note token maps are counted filter-free. Stopwords -- the built-in
 * lists and the reader's own -- and entity exclusion apply at aggregation,
 * so flipping a toggle re-reads nothing. Entity exclusion works by whole
 * normalized labels, which the lexicon's atomic tokens now meet exactly.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { buildPatternMatcher, type PatternEntry } from './aho-corasick';
import { analyzableRanges } from './analyzable-prose';
import { patternForms } from './entity-matcher';
import { fingerprint } from './fingerprint';
import type { CountableRange } from './markdown-scan';
import { hasWordBoundary } from './mentions';

/** Bump when tokenization rules change: it invalidates persisted tokens. */
export const WORD_TOKENIZER_VERSION = 1;

interface WordSegment {
	segment: string;
	isWordLike?: boolean;
}

interface WordSegmenter {
	segment(text: string): Iterable<WordSegment>;
}

/** The constructor shape the structural cast reaches for. */
export type WordSegmenterCtor = new (
	locale?: string,
	options?: { granularity?: string },
) => WordSegmenter;

function platformSegmenter(): WordSegmenterCtor | null {
	const intl = Intl as { Segmenter?: unknown };
	return typeof intl.Segmenter === 'function'
		? (intl.Segmenter as WordSegmenterCtor)
		: null;
}

export function hasWordSegmenter(): boolean {
	return platformSegmenter() !== null;
}

/** A token counts only when it holds a letter: numbers alone are not words. */
const HAS_LETTER = /[\p{L}\p{M}]/u;
const CJK_CHARACTER =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const FALLBACK_WORD = /[\p{L}\p{M}\p{N}_]/u;

/** One segmenter per locale, built once: the dictionaries are not small. */
const segmenters = new Map<string, WordSegmenter>();

function segmenterFor(
	locale: string,
	ctor: WordSegmenterCtor,
): WordSegmenter {
	if (ctor !== platformSegmenter()) {
		return new ctor(locale, { granularity: 'word' });
	}
	const kept = segmenters.get(locale);
	if (kept !== undefined) return kept;
	const built = new ctor(locale, { granularity: 'word' });
	segmenters.set(locale, built);
	return built;
}

const normalize = (token: string): string =>
	token.normalize('NFC').toLowerCase();

function countToken(counts: Map<string, number>, token: string): void {
	if (!HAS_LETTER.test(token)) return;
	const term = normalize(token);
	counts.set(term, (counts.get(term) ?? 0) + 1);
}

/**
 * Words without a segmenter: Latin-style runs gathered, CJK one character
 * at a time. Blunt, and honestly so -- the fingerprint tells the two
 * vocabularies apart.
 */
function fallbackTokens(counts: Map<string, number>, text: string): void {
	let run = '';
	const close = (): void => {
		if (run.length > 0) countToken(counts, run);
		run = '';
	};
	for (const character of text) {
		if (CJK_CHARACTER.test(character)) {
			close();
			countToken(counts, character);
			continue;
		}
		if (FALLBACK_WORD.test(character)) {
			run += character;
			continue;
		}
		close();
	}
	close();
}

/** One name found whole: the span it holds and the term it counts under. */
export interface AtomicToken {
	from: number;
	to: number;
	/** The label normalized the way tokens are -- what the count carries. */
	term: string;
}

/**
 * The tokenizer's user dictionary: the project's names and aliases, matched
 * ahead of the segmenter so an invented name is one token, not fragments.
 */
export interface TokenLexicon {
	/** Over the sorted label set: part of the tokens fingerprint. */
	readonly fingerprint: string;
	/** How many distinct labels the roster spelled. */
	readonly termCount: number;
	cut(body: string, range: CountableRange): AtomicToken[];
}

/**
 * Over the distinct trimmed labels alone, order blind: what invalidates
 * persisted tokens is the roster's spelling, nothing else.
 */
export function lexiconFingerprint(labels: readonly string[]): string {
	const distinct = new Set<string>();
	for (const label of labels) {
		const trimmed = label.trim();
		if (trimmed.length > 0) distinct.add(trimmed);
	}
	return fingerprint([...distinct].sort());
}

/**
 * Builds the lexicon the way the entity matcher is built -- the same Unicode
 * forms, exact case -- and reads its hits the way mentions are read: the
 * word-boundary rule with its CJK limitation, then leftmost-longest across
 * whatever overlaps, so the spans handed back never touch.
 */
export function buildTokenLexicon(labels: readonly string[]): TokenLexicon {
	const entries: PatternEntry<string>[] = [];
	const distinct = new Set<string>();
	for (const label of labels) {
		const trimmed = label.trim();
		if (trimmed.length === 0 || distinct.has(trimmed)) continue;
		distinct.add(trimmed);
		const term = normalize(trimmed);
		for (const form of patternForms(trimmed)) {
			entries.push({ pattern: form, payload: term });
		}
	}
	const matcher = buildPatternMatcher(entries);
	return {
		fingerprint: lexiconFingerprint(labels),
		termCount: distinct.size,
		cut(body: string, range: CountableRange): AtomicToken[] {
			if (matcher.patternCount === 0) return [];
			const hits = matcher
				.findAll(body.slice(range.from, range.to), range.from)
				.filter((hit) => hasWordBoundary(body, hit.from, hit.to, range))
				// Longest first at one start, so the greedy pass below keeps it.
				.sort((left, right) => left.from - right.from || right.to - left.to);
			const atoms: AtomicToken[] = [];
			let end = range.from;
			for (const hit of hits) {
				if (hit.from < end) continue;
				const term = hit.payloads[0];
				if (term === undefined) continue;
				atoms.push({ from: hit.from, to: hit.to, term });
				end = hit.to;
			}
			return atoms;
		},
	};
}

/**
 * Past a possessive glued to a name -- Alice's, straight or typographic --
 * so the suffix folds into the name instead of counting a stray s. A letter
 * right after the s means some other word, which is left alone.
 */
function skipPossessive(body: string, at: number, ceiling: number): number {
	const apostrophe = body.charAt(at);
	if (apostrophe !== "'" && apostrophe !== '’') return at;
	const suffix = body.charAt(at + 1);
	if ((suffix !== 's' && suffix !== 'S') || at + 2 > ceiling) return at;
	const after = at + 2 < ceiling ? body.charAt(at + 2) : '';
	return after !== '' && FALLBACK_WORD.test(after) ? at : at + 2;
}

/**
 * One note's tokens, counted. The analyzable stretches are read one at a
 * time so a token can never fuse across syntax, exactly as matches cannot;
 * within each stretch the lexicon's names are counted whole first and the
 * segmenter reads only the prose between them.
 */
export function tokenizeProse(
	body: string,
	excludeRanges: readonly CountableRange[],
	locale: string,
	lexicon: TokenLexicon | null = null,
	ctor: WordSegmenterCtor | null = platformSegmenter(),
): Map<string, number> {
	const counts = new Map<string, number>();
	const segmentInto = (slice: string): void => {
		if (slice.length === 0) return;
		if (ctor === null) {
			fallbackTokens(counts, slice);
			return;
		}
		for (const segment of segmenterFor(locale, ctor).segment(slice)) {
			if (segment.isWordLike !== true) continue;
			countToken(counts, segment.segment);
		}
	};
	for (const range of analyzableRanges(body, excludeRanges)) {
		let at = range.from;
		for (const atom of lexicon?.cut(body, range) ?? []) {
			segmentInto(body.slice(at, atom.from));
			countToken(counts, atom.term);
			at = skipPossessive(body, atom.to, range.to);
		}
		segmentInto(body.slice(at, range.to));
	}
	return counts;
}

/**
 * Function words English reading passes over. Curated, not exhaustive: the
 * reader's own list extends it.
 */
export const DEFAULT_STOPWORDS_EN: ReadonlySet<string> = new Set([
	'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an',
	'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before',
	'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did',
	'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
	'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
	'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
	'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
	'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or',
	'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
	'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the',
	'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
	'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
	'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
	'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
	'yourself', 'yourselves',
]);

/** Function words Chinese reading passes over, in the same spirit. */
export const DEFAULT_STOPWORDS_ZH: ReadonlySet<string> = new Set([
	'的', '了', '着', '在', '是', '我', '你', '他', '她', '它', '们',
	'我们', '你们', '他们', '她们', '它们', '这', '那', '这个', '那个',
	'这些', '那些', '这样', '那样', '一个', '一', '不', '没', '没有',
	'有', '和', '与', '及', '或', '而', '但', '也', '都', '就', '还',
	'又', '再', '很', '更', '最', '太', '被', '把', '让', '向', '从',
	'对', '给', '为', '以', '于', '之', '其', '此', '个', '只', '才',
	'已经', '可以', '什么', '怎么', '因为', '所以', '如果', '虽然',
	'但是', '而且', '然后', '呢', '吗', '吧', '啊', '哦', '嗯', '得',
	'地', '过', '要', '会', '能', '并', '等', '上', '下', '中',
]);

/**
 * The reader's own stopwords, read from free text: split on whitespace and
 * list punctuation, normalized like tokens so they meet in the middle.
 */
export function parseStopwords(text: string): Set<string> {
	const words = new Set<string>();
	for (const piece of text.split(/[\s,，、;；]+/u)) {
		const word = normalize(piece.trim());
		if (word.length > 0) words.add(word);
	}
	return words;
}

export interface FrequencyRow {
	term: string;
	count: number;
}

/** Per-note pair lists -- the persisted form -- folded into one map. */
export function mergeTokenCounts(
	maps: Iterable<readonly (readonly [string, number])[]>,
): Map<string, number> {
	const merged = new Map<string, number>();
	for (const pairs of maps) {
		for (const [term, count] of pairs) {
			merged.set(term, (merged.get(term) ?? 0) + count);
		}
	}
	return merged;
}

/**
 * The table's rows: filters applied here and nowhere earlier, the most
 * frequent first, ties read in locale order. `null` filters mean "keep".
 */
export function frequencyRows(
	merged: ReadonlyMap<string, number>,
	filters: {
		stopwords: ReadonlySet<string> | null;
		exclude: ReadonlySet<string> | null;
	},
): FrequencyRow[] {
	const rows: FrequencyRow[] = [];
	for (const [term, count] of merged) {
		if (filters.stopwords !== null && filters.stopwords.has(term)) continue;
		if (filters.exclude !== null && filters.exclude.has(term)) continue;
		rows.push({ term, count });
	}
	return rows.sort(
		(left, right) =>
			right.count - left.count || left.term.localeCompare(right.term),
	);
}
