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
 * Per-note token maps are counted filter-free. Stopwords -- the built-in
 * lists and the reader's own -- and entity exclusion apply at aggregation,
 * so flipping a toggle re-reads nothing.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { analyzableRanges } from './analyzable-prose';
import type { CountableRange } from './markdown-scan';

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

/**
 * One note's tokens, counted. The analyzable stretches are read one at a
 * time so a token can never fuse across syntax, exactly as matches cannot.
 */
export function tokenizeProse(
	body: string,
	excludeRanges: readonly CountableRange[],
	locale: string,
	ctor: WordSegmenterCtor | null = platformSegmenter(),
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const range of analyzableRanges(body, excludeRanges)) {
		const slice = body.slice(range.from, range.to);
		if (ctor === null) {
			fallbackTokens(counts, slice);
			continue;
		}
		for (const segment of segmenterFor(locale, ctor).segment(slice)) {
			if (segment.isWordLike !== true) continue;
			countToken(counts, segment.segment);
		}
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
