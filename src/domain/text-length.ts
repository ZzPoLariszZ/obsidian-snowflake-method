export const WRITING_COUNT_MODES = [
	'jinjiang',
	'chenggua',
	'qidian',
	'ms-word',
] as const;

/**
 * Which convention the writing count follows, each measured against the tool
 * it is named for.
 *
 * `jinjiang` stands apart from the other three: it counts characters, not
 * words. Everything that is not whitespace counts one, letter or mark or
 * emoji alike, so `Hello, world` is eleven to it.
 *
 * The rest read writing the same way and the marks around it differently.
 * `chenggua` is Chenggua: Latin script is read in words, every other script
 * one character at a time, and the marks Chinese writing leans on -- the CJK
 * block and the typographic block that holds “” …… —— -- count one each.
 * Ordinary marks ride along with the word they touch. The settings tab does
 * not offer it; it is kept because its rules are measured and because a
 * setting saved before it was withdrawn still has to mean something.
 *
 * `ms-word` is a word processor: the same, except that the typographic block
 * counts nothing on its own, its dashes part the words either side of them,
 * and every script is read in words.
 *
 * `qidian` is Qidian and NovelBuddy: the same as Chenggua, but the line
 * between "word" and "character" is drawn at ASCII rather than at Latin, so
 * café is two to it. A mark outside ASCII never joins the word beside it, a
 * quotation mark and a comma always count, and a hyphen never does.
 */
export type WritingCountMode = (typeof WRITING_COUNT_MODES)[number];

export function isWritingCountMode(value: unknown): value is WritingCountMode {
	return (
		value === 'jinjiang' ||
		value === 'chenggua' ||
		value === 'qidian' ||
		value === 'ms-word'
	);
}

/**
 * Whether a convention counts characters one at a time rather than gathering
 * them into words. What a count is made of is said differently when it is.
 */
export function countsCharacters(mode: WritingCountMode): boolean {
	return mode === 'jinjiang';
}

export interface WritingCount {
	/** Everything counted one at a time rather than gathered into a word. */
	cjkCharacters: number;
	words: number;
	punctuationMarks: number;
	total: number;
}

export interface WritingCountOptions {
	mode: WritingCountMode;
}

/**
 * Text counted by character wherever it appears: Han ideographs, kana, and
 * hangul. ー is katakana's long vowel but belongs to no script table, and 〇
 * is a numeral the ideograph property passes over; both are spelled in by
 * hand, and 〇 is read here before the CJK block below takes it.
 */
const CJK_CHARACTER =
	/[\p{Unified_Ideograph}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3007\u30fc\uff70]/u;

/**
 * Marks that take a character's room on the page and are counted like one:
 * the CJK block, whose iteration mark 々 and ditto mark 〃 Unicode files as
 * letters, and the fullwidth forms, whose ranges step around the letters and
 * digits inside them.
 */
const CJK_PUNCTUATION =
	/[\u3001-\u303f\ufe10-\ufe1f\ufe30-\ufe6f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\uffe0-\uffee]/u;

/**
 * The typographic block: “” ‘’ …… —— and their neighbours. Chinese writing
 * spends these like characters and both platform conventions count them that
 * way, so `第一章——开始` is seven to them. A word processor gathers them into
 * the run beside them instead, apart from the dashes below.
 */
const GENERAL_PUNCTUATION = /[\u2000-\u206f]/u;

/**
 * Dashes a word processor reads as separators, parting the words either side
 * without being counted. The plain hyphen is not one of them: it joins words,
 * and standing alone it counts as a mark.
 */
const WORD_PROCESSOR_SEPARATOR = /[\u2013\u2014\u2015]/u;

/** Hyphens Qidian passes over: inside a word or alone, they are worth nothing. */
const QIDIAN_HYPHEN = /[\u002d\u2010\u2011]/u;

/** Marks Qidian always counts, however tightly they sit against a word. */
const QIDIAN_ALWAYS_COUNTS = /[",]/u;

/**
 * What Jinjiang's count passes over, spelled from what it answers rather than
 * from a rule anybody wrote down. A variation selector is the spelling of the
 * character before it and not a character of its own, so \u2744\ufe0f is one. The ASCII
 * question mark it simply does not see: `\u4f60\u597d?` and `\u4f60\u597d???` are both two to
 * it, and `Qu\u00e9?` three. Its fullwidth \uff1f counts like everything else.
 */
const UNCOUNTED_CHARACTER = /[\ufe00-\ufe0f?]/u;

const SYMBOL_OR_SELECTOR = /[\p{S}\ufe00-\ufe0f]/u;
const LATIN = /\p{Script=Latin}/u;
const LETTER = /[\p{L}\p{M}]/u;
const WORD_CHARACTER = /[\p{L}\p{Nd}]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

function isAscii(character: string): boolean {
	return (character.codePointAt(0) ?? 0) <= 0x7f;
}

/**
 * Past the BMP both platform conventions read a surrogate pair rather than a
 * character: writing there counts twice, and an emoji counts not at all.
 */
function isAstral(character: string): boolean {
	return (character.codePointAt(0) ?? 0) > 0xffff;
}

/**
 * Every character on the page, one each. Nothing is gathered into a word, so
 * the middle number is the letters and digits rather than the words they
 * spell, and the marks Chinese writing spends stand with the ordinary ones.
 */
function countEveryCharacter(text: string): WritingCount {
	let cjkCharacters = 0;
	let letters = 0;
	let punctuationMarks = 0;
	for (const character of text) {
		if (WHITESPACE.test(character)) continue;
		if (UNCOUNTED_CHARACTER.test(character)) continue;
		if (CJK_CHARACTER.test(character)) cjkCharacters += 1;
		else if (CJK_PUNCTUATION.test(character) || PUNCTUATION.test(character)) {
			punctuationMarks += 1;
		} else letters += 1;
	}
	return {
		cjkCharacters,
		words: letters,
		punctuationMarks,
		total: cjkCharacters + letters + punctuationMarks,
	};
}

/** The writing in a piece of text, counted by the convention asked for. */
export function countWriting(
	text: string,
	options: WritingCountOptions = { mode: 'jinjiang' },
): WritingCount {
	if (countsCharacters(options.mode)) return countEveryCharacter(text);
	const wordProcessor = options.mode === 'ms-word';
	const qidian = options.mode === 'qidian';
	let cjkCharacters = 0;
	let words = 0;
	let punctuationMarks = 0;
	// The run being read, and what it holds. `foreign` marks a run of
	// punctuation from outside ASCII, which Qidian never lets a word absorb:
	// it is closed and counted on its own, so `«bonjour»` is three to it and
	// one to everybody else.
	let runHasWord = false;
	let runHasPunctuation = false;
	let runIsForeign = false;
	const closeRun = (): void => {
		if (runHasWord) words += 1;
		else if (runHasPunctuation) punctuationMarks += 1;
		runHasWord = false;
		runHasPunctuation = false;
		runIsForeign = false;
	};
	/** A mark that takes a character's room: closes the run and counts one. */
	const standsAlone = (): void => {
		closeRun();
		punctuationMarks += 1;
	};

	for (const character of text) {
		if (WHITESPACE.test(character)) {
			closeRun();
			continue;
		}
		// A hyphen leaves the run open around it, so `well-written` stays the
		// one word it reads as while counting nothing itself.
		if (qidian && QIDIAN_HYPHEN.test(character)) continue;
		if (!wordProcessor && isAstral(character)) {
			closeRun();
			if (CJK_CHARACTER.test(character)) cjkCharacters += 2;
			continue;
		}
		if (wordProcessor && WORD_PROCESSOR_SEPARATOR.test(character)) {
			closeRun();
			continue;
		}
		if (CJK_CHARACTER.test(character)) {
			closeRun();
			cjkCharacters += 1;
			continue;
		}
		if (CJK_PUNCTUATION.test(character)) {
			standsAlone();
			continue;
		}
		if (!wordProcessor && GENERAL_PUNCTUATION.test(character)) {
			standsAlone();
			continue;
		}
		if (qidian && QIDIAN_ALWAYS_COUNTS.test(character)) {
			standsAlone();
			continue;
		}
		if (qidian && !isAscii(character) && SYMBOL_OR_SELECTOR.test(character)) {
			closeRun();
			if (!isAstral(character)) punctuationMarks += 1;
			continue;
		}
		// Where a convention draws the line between writing gathered into
		// words and writing counted a character at a time. A word processor
		// draws it nowhere and reads every script in words.
		const countedAlone = wordProcessor
			? false
			: LETTER.test(character) &&
				(qidian ? !isAscii(character) : !LATIN.test(character));
		if (countedAlone) {
			closeRun();
			cjkCharacters += 1;
			continue;
		}
		// A run of marks from outside ASCII stands apart from the words
		// around it for Qidian, so it is closed before and after.
		const foreign = qidian && !isAscii(character) && PUNCTUATION.test(character);
		if (foreign !== runIsForeign) closeRun();
		runIsForeign = foreign;
		if (WORD_CHARACTER.test(character)) runHasWord = true;
		else if (PUNCTUATION.test(character)) runHasPunctuation = true;
	}
	closeRun();

	return {
		cjkCharacters,
		words,
		punctuationMarks,
		total: cjkCharacters + words + punctuationMarks,
	};
}
