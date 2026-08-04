import { describe, expect, it } from 'vitest';

import { countWritingLength } from '../../src/domain';

describe('writing length', () => {
	it('counts English words without counting punctuation or whitespace', () => {
		expect(countWritingLength("A well-written story doesn't drift."))
			.toEqual({ chineseCharacters: 0, englishWords: 5, total: 5 });
	});

	it('counts Chinese characters without counting punctuation', () => {
		expect(
			countWritingLength('“雪花写作法”，很好！？；：、（）《》【】……——'),
		).toEqual({
			chineseCharacters: 7,
			englishWords: 0,
			total: 7,
		});
	});

	it('keeps Chinese characters and English words separate in mixed prose', () => {
		expect(countWritingLength('一位 writer must 拯救 the city 2026.')).toEqual({
			chineseCharacters: 4,
			englishWords: 5,
			total: 9,
		});
	});

	it('handles supplementary Han characters and ignores emoji', () => {
		expect(countWritingLength('𠮷野家〇 ❄️')).toEqual({
			chineseCharacters: 4,
			englishWords: 0,
			total: 4,
		});
	});

	it('does not treat CJK punctuation and iteration marks as English words', () => {
		expect(countWritingLength('。、《》【】〃々')).toEqual({
			chineseCharacters: 0,
			englishWords: 0,
			total: 0,
		});
	});
});
