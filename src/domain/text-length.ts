export interface WritingLength {
	chineseCharacters: number;
	englishWords: number;
	total: number;
}

const CHINESE_CHARACTER = /(?:\p{Unified_Ideograph}|〇)/gu;
const ENGLISH_WORD =
	/[\p{Script=Latin}\p{Decimal_Number}]+(?:['’\-\u2010-\u2015][\p{Script=Latin}\p{Decimal_Number}]+)*/gu;

/**
 * Counts Chinese ideographs individually and Latin word tokens separately.
 * Whitespace, punctuation, symbols, and emoji do not contribute to either count.
 */
export function countWritingLength(text: string): WritingLength {
	const chineseCharacters = Array.from(text.matchAll(CHINESE_CHARACTER)).length;
	const withoutChinese = text.replace(CHINESE_CHARACTER, ' ');
	const englishWords = withoutChinese.match(ENGLISH_WORD)?.length ?? 0;
	return {
		chineseCharacters,
		englishWords,
		total: chineseCharacters + englishWords,
	};
}
