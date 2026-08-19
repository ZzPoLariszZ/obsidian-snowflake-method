import { describe, expect, it } from 'vitest';

import {
	WRITING_COUNT_MODES,
	countWriting,
	countsCharacters,
	type WritingCountMode,
} from '../../src/domain';

const at = (text: string, mode: WritingCountMode): number =>
	countWriting(text, { mode }).total;
const jinjiang = (text: string): number => at(text, 'jinjiang');
const chenggua = (text: string): number => at(text, 'chenggua');
const qidian = (text: string): number => at(text, 'qidian');
const processor = (text: string): number => at(text, 'ms-word');

/**
 * Every string put through the three tools themselves, with the number each
 * one gave back. Read together they are the specification, and a change that
 * breaks a row is a change that stops agreeing with the tool the row came
 * from. `null` means that tool was never asked, so nothing is asserted:
 * filling those in from the rules would be writing down a guess and reading
 * it back as evidence.
 */
type Measurement = readonly [
	text: string,
	jinjiang: number | null,
	chenggua: number | null,
	qidian: number | null,
	msWord: number | null,
];

const MEASURED: readonly Measurement[] = [
	['!', 1, 1, 1, 1],
	['!!', 2, 1, 1, 1],
	['Hello!!', 7, 1, 1, 1],
	['你好!!', 4, 3, 3, 3],
	['来着......', 8, 3, 3, 3],
	['你.好', 3, 3, 3, 3],
	['你.hao', 5, 2, 2, 2],
	['？！', 2, 2, 2, 2],
	['你好？', 3, 3, 3, 3],
	['你好？！', 4, 4, 4, 4],
	['你好?', 2, 3, 3, 3],
	['你好???', 2, 3, 3, 3],
	['你好-', 3, 3, 2, 3],
	['你好--', 4, 3, 2, 3],
	['你好—', 3, 3, 3, 2],
	['你好——', 4, 4, 4, 2],
	['你好……', 4, 4, 4, 3],
	['你好......', 8, 3, 3, 3],
	['你好。。。', 5, 5, 5, 5],
	['“请把手放上来吧。”', 10, 10, 10, 10],
	['“请把手放上来吧!”', 10, 10, 10, 9],
	['“!请把手放上来吧!”', 11, 11, 11, 9],
	['"请把手放上来吧。"', 10, 10, 10, 10],
	['"请把手放上来吧!"', 10, 9, 10, 9],
	['"!!请把手放上来吧!!!"', 14, 9, 11, 9],
	['~', 1, 1, 1, 1],
	['~~~', 3, 1, 1, 1],
	['❄️', 1, null, 2, 1],
	['❤️', 1, null, 2, 1],
	['👀', 1, null, 0, 1],
	['𠮷野家的招牌', 6, 7, 7, 6],
	['他说：“别动！”她没动。', 12, 12, 12, 12],
	['第一章——开始', 7, 7, 7, 5],
	['甲-乙-丙 和 A-B-C', 11, 7, 5, 7],
	['价格是￥1,000.50（含税）', 16, 9, 11, 9],
	['“~~~”和"!!!"和……', 14, 8, 10, 5],
	['§§ ¿Qué? «bonjour»', 15, 3, 8, 3],
	['doesn’t 与 don\'t 都写了', 16, 8, 8, 6],
	['Hello, world! 你好，世界！', 18, 8, 9, 8],
	['Hello, world', 11, 2, 3, 2],
	['1,000', 5, 1, 3, 1],
	['Qué?', 3, 1, 3, 1],
	['§§', 2, 1, 1, 1],
	['甲!乙', 3, 3, 3, 3],
	['привет', 6, 6, 6, 1],
	['café', 4, 1, 2, 1],
	['1.5', 3, 1, 1, 1],
	['Hello, world!', 12, 2, 3, 2],
];

describe('writing count, against the tools themselves', () => {
	it.each(MEASURED)(
		'%j',
		(text, official, platform, qidianCount, msWord) => {
			if (official !== null) expect(jinjiang(text)).toBe(official);
			if (platform !== null) expect(chenggua(text)).toBe(platform);
			if (qidianCount !== null) expect(qidian(text)).toBe(qidianCount);
			if (msWord !== null) expect(processor(text)).toBe(msWord);
		},
	);
});

describe('writing count', () => {
	it('counts English words without counting whitespace', () => {
		expect(countWriting("A well-written story doesn't drift.", {
			mode: 'ms-word',
		})).toEqual({
			cjkCharacters: 0,
			words: 5,
			punctuationMarks: 0,
			charactersWithSpaces: 35,
			charactersNoSpaces: 31,
			total: 5,
		});
	});

	it('counts Chinese characters', () => {
		expect(countWriting('雪花写作法很好', { mode: 'chenggua' })).toEqual({
			cjkCharacters: 7,
			words: 0,
			punctuationMarks: 0,
			charactersWithSpaces: 7,
			charactersNoSpaces: 7,
			total: 7,
		});
	});

	it('keeps Chinese characters and English words separate in mixed prose', () => {
		expect(
			countWriting('一位 writer must 拯救 the city 2026', { mode: 'chenggua' }),
		).toEqual({
			cjkCharacters: 4,
			words: 5,
			punctuationMarks: 0,
			charactersWithSpaces: 31,
			charactersNoSpaces: 25,
			total: 9,
		});
	});

	it('counts Japanese kana by character, the long vowel mark included', () => {
		for (const count of [jinjiang, chenggua, processor, qidian]) {
			expect(count('コーヒーとお茶')).toBe(7);
		}
	});

	it('counts Korean hangul by character', () => {
		for (const count of [jinjiang, chenggua, processor, qidian]) {
			expect(count('안녕하세요')).toBe(5);
		}
	});

	it('never counts an iteration mark as a word', () => {
		for (const mode of WRITING_COUNT_MODES) {
			expect(countWriting('々〃', { mode }).words).toBe(0);
		}
	});

	it('keeps a hyphenated word whole in every convention that has words', () => {
		expect(chenggua('well-written')).toBe(1);
		expect(qidian('well-written')).toBe(1);
		expect(processor('well-written')).toBe(1);
		// Jinjiang has none: the hyphen is a character like the rest.
		expect(jinjiang('well-written')).toBe(12);
	});

	it('reads a dash as a separator only for a word processor', () => {
		expect(processor('one—two')).toBe(2);
		expect(chenggua('one—two')).toBe(3);
		expect(qidian('one—two')).toBe(3);
	});

	it('says a Jinjiang count is made of characters, not words', () => {
		expect(countWriting('你好 Hello, 世界!', { mode: 'jinjiang' })).toEqual({
			cjkCharacters: 4,
			words: 5,
			punctuationMarks: 2,
			charactersWithSpaces: 13,
			charactersNoSpaces: 11,
			total: 11,
		});
		expect(countsCharacters('jinjiang')).toBe(true);
		for (const mode of ['chenggua', 'qidian', 'ms-word'] as const) {
			expect(countsCharacters(mode)).toBe(false);
		}
	});

	/**
	 * 〇 is a numeral the ideograph property passes over, spelled into
	 * CJK_CHARACTER by hand. Without this pin, a simplification to bare
	 * script properties would drop it into the punctuation class -- the
	 * totals would survive, and the character count would quietly shrink.
	 */
	it('counts 〇 as a character, not a mark', () => {
		expect(countWriting('一九〇五', { mode: 'jinjiang' })).toEqual({
			cjkCharacters: 4,
			words: 0,
			punctuationMarks: 0,
			charactersWithSpaces: 4,
			charactersNoSpaces: 4,
			total: 4,
		});
	});
});
