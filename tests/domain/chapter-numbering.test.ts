import { describe, expect, it } from 'vitest';

import {
	chapterRuleProblem,
	compileChapterNumbering,
	compileChapterRule,
	formatChapterNumber,
	isChapterNumberingStyle,
	parseChineseNumeral,
	proposeChapterNumber,
	proposeChapterRemoval,
	runningChapterRule,
	sanitizeChapterNumberRules,
	toChineseNumeral,
	type ChapterNumbering,
	type ChapterNumberingSettings,
	type ChapterNumberRule,
	type ChapterRuleKind,
} from '../../src/domain';

const custom = (
	kind: ChapterRuleKind,
	text: string,
	seed = '',
	enabled = true,
): ChapterNumberRule => ({ id: `${kind}:${text}`, kind, text, seed, enabled });

const rule = (
	style: ChapterNumberingSettings['style'],
	rules: ChapterNumberRule[] = [],
): ChapterNumbering => {
	const numbering = compileChapterNumbering({ style, rules });
	if (numbering === null) throw new Error(`${style} did not compile`);
	return numbering;
};

describe('Chinese numerals', () => {
	it('spells numbers as chapter titles do', () => {
		expect(toChineseNumeral(1)).toBe('一');
		expect(toChineseNumeral(2)).toBe('二');
		expect(toChineseNumeral(10)).toBe('十');
		expect(toChineseNumeral(11)).toBe('十一');
		expect(toChineseNumeral(20)).toBe('二十');
		expect(toChineseNumeral(99)).toBe('九十九');
		expect(toChineseNumeral(100)).toBe('一百');
		expect(toChineseNumeral(101)).toBe('一百零一');
		expect(toChineseNumeral(110)).toBe('一百一十');
		expect(toChineseNumeral(111)).toBe('一百一十一');
		expect(toChineseNumeral(1000)).toBe('一千');
		expect(toChineseNumeral(1001)).toBe('一千零一');
		expect(toChineseNumeral(1010)).toBe('一千零一十');
		expect(toChineseNumeral(1100)).toBe('一千一百');
		expect(toChineseNumeral(2005)).toBe('二千零五');
		expect(toChineseNumeral(9999)).toBe('九千九百九十九');
	});

	it('reads every spelling it writes, from one to nine thousand and more', () => {
		for (let value = 1; value <= 9999; value += 1) {
			expect(parseChineseNumeral(toChineseNumeral(value)), String(value)).toBe(
				value,
			);
		}
	});

	it('reads the spellings titles use that it would not write', () => {
		expect(parseChineseNumeral('两百')).toBe(200);
		expect(parseChineseNumeral('一十')).toBe(10);
		expect(parseChineseNumeral('百')).toBe(100);
		expect(parseChineseNumeral('二十〇')).toBe(20);
		expect(parseChineseNumeral('')).toBeNull();
		expect(parseChineseNumeral('零')).toBeNull();
		expect(parseChineseNumeral('第一')).toBeNull();
	});

	it('leaves a number it cannot spell as digits', () => {
		expect(toChineseNumeral(0)).toBe('0');
		expect(toChineseNumeral(10000)).toBe('10000');
	});
});

describe('the preset rules', () => {
	it('read, raise and head a Chinese numeral title', () => {
		const chinese = rule('chinese');
		expect(chinese.read('第十章 相遇')).toMatchObject({ number: 10, from: 1, to: 2 });
		expect(chinese.increment('第十章 相遇')).toBe('第十一章 相遇');
		expect(chinese.increment('第 九 章')).toBe('第 十 章');
		expect(chinese.head('第十一章 相遇')).toBe('第十一章');
		expect(chinese.seed()).toBe('第一章');
		expect(chinese.read('第1章 相遇')).toBeNull();
		expect(chinese.read('番外 相遇')).toBeNull();
	});

	it('read, raise and head a spaced Arabic title', () => {
		const spaced = rule('chinese-arabic');
		expect(spaced.read('第 2 章 相遇')).toMatchObject({ number: 2, from: 2, to: 3 });
		expect(spaced.increment('第 2 章 相遇')).toBe('第 3 章 相遇');
		expect(spaced.increment('第9章')).toBe('第10章');
		expect(spaced.head('第 3 章 相遇')).toBe('第 3 章');
		expect(spaced.seed()).toBe('第 1 章');
		expect(spaced.read('第二章')).toBeNull();
	});

	it('read, raise and head an English title, whatever its case', () => {
		const english = rule('english');
		expect(english.read('Chapter 12: The Road')).toMatchObject({ number: 12 });
		expect(english.increment('Chapter 12: The Road')).toBe('Chapter 13: The Road');
		expect(english.increment('chapter 1')).toBe('chapter 2');
		expect(english.head('Chapter 13: The Road')).toBe('Chapter 13');
		expect(english.seed()).toBe('Chapter 1');
		expect(english.read('Prologue')).toBeNull();
	});

	it('keeps a zero-padded width when raising the number', () => {
		expect(rule('english').increment('Chapter 0009 The Road')).toBe(
			'Chapter 0010 The Road',
		);
		expect(rule('chinese-arabic').increment('第0099章')).toBe('第0100章');
		expect(rule('chinese-arabic').increment('第 9 章')).toBe('第 10 章');
	});

	it('changes only the number, a later number in the title left alone', () => {
		expect(rule('chinese-arabic').increment('第3章 3只猫')).toBe('第4章 3只猫');
		expect(rule('english').increment('Chapter 3 - 3 Doors')).toBe(
			'Chapter 4 - 3 Doors',
		);
	});
});

describe('a format rule', () => {
	it('reads through the pattern its format describes and seeds with it spelled for one', () => {
		const numbering = compileChapterRule(custom('format', '第{nnnn}章'));
		expect(numbering?.read('第0003章 相遇')).toMatchObject({ number: 3, from: 1, to: 5 });
		expect(numbering?.increment('第0003章 相遇')).toBe('第0004章 相遇');
		expect(numbering?.head('第0004章 相遇')).toBe('第0004章');
		expect(numbering?.seed()).toBe('第0001章');
		expect(numbering?.read('相遇')).toBeNull();
	});

	it('matches the style as written: {nnnn} is that many digits, and spaces stand where the format has them', () => {
		const spaced = compileChapterRule(custom('format', '第 {nnnn} 章'));
		expect(spaced?.read('第 0003 章 相遇')).toMatchObject({ number: 3, from: 2, to: 6 });
		// A name in another style is not numbered under this one.
		expect(spaced?.read('第 3 章 相遇')).toBeNull();
		expect(spaced?.read('第0003章 相遇')).toBeNull();
		const tight = compileChapterRule(custom('format', '第{nnnn}章'));
		expect(tight?.read('第 0003 章 相遇')).toBeNull();
		expect(tight?.read('第3章 相遇')).toBeNull();
		// {n} is any width, as the presets read.
		const any = compileChapterRule(custom('format', '第 {n} 章'));
		expect(any?.read('第 3 章 相遇')).toMatchObject({ number: 3 });
		expect(any?.read('第 0003 章 相遇')).toMatchObject({ number: 3 });
		// So a manuscript numbered in another style starts over in this one.
		if (spaced === null) throw new Error('did not compile');
		expect(
			proposeChapterNumber(['第 1 章 a', '第 2 章 b'], 2, spaced),
		).toEqual({ head: '第 0001 章', followers: [] });
	});

	it('is blind to case, as the English preset is, and keeps the title its own spelling', () => {
		const numbering = compileChapterRule(custom('format', 'Chapter {nnnn}'));
		expect(numbering?.read('chapter 0012 The Road')).toMatchObject({ number: 12 });
		expect(numbering?.read('Chapter 12 The Road')).toBeNull();
		expect(numbering?.increment('Chapter 0012 The Road')).toBe('Chapter 0013 The Road');
		expect(numbering?.head('Chapter 0013 The Road')).toBe('Chapter 0013');
		expect(numbering?.seed()).toBe('Chapter 0001');
	});

	it('reads and writes Chinese numerals through {zh}', () => {
		const numbering = compileChapterRule(custom('format', '卷{zh}'));
		expect(numbering?.increment('卷十 归途')).toBe('卷十一 归途');
		expect(numbering?.seed()).toBe('卷一');
		expect(numbering?.head('卷十一 归途')).toBe('卷十一');
	});

	it('takes the first placeholder as the number and matches the rest as written', () => {
		const numbering = compileChapterRule(custom('format', 'Part {n} of 9 (draft)'));
		expect(numbering?.read('Part 2 of 9 (draft) The Road')).toMatchObject({ number: 2, from: 5, to: 6 });
		expect(numbering?.increment('Part 2 of 9 (draft) The Road')).toBe('Part 3 of 9 (draft) The Road');
		// The parentheses are literal, not a group of the pattern's own.
		expect(numbering?.read('Part 2 of 9 draft The Road')).toBeNull();
		const twice = compileChapterRule(custom('format', '{n}-{zh}'));
		expect(twice?.read('3-三 x')).toMatchObject({ number: 3, from: 0, to: 1 });
	});

	it('spells the format placeholders', () => {
		expect(formatChapterNumber('第{n}章', 7)).toBe('第7章');
		expect(formatChapterNumber('第{nn}章', 7)).toBe('第07章');
		expect(formatChapterNumber('Chapter {nnnn}', 7)).toBe('Chapter 0007');
		expect(formatChapterNumber('第{zh}章', 12)).toBe('第十二章');
		expect(formatChapterNumber('{n}-{zh}', 3)).toBe('3-三');
	});
});

describe('a regex rule', () => {
	const padded = custom('regex', '^第\\s*(?!0000)\\d{4}\\s*章\\s+.+$', '第0001章');
	const english = custom('regex', '^Chapter (?!0000)\\d{4}\\s+.+$');

	it('finds the number inside a match that has no group of its own', () => {
		const numbering = compileChapterRule(padded);
		expect(numbering?.read('第0003章 相遇')).toMatchObject({ number: 3, from: 1, to: 5 });
		expect(numbering?.increment('第0003章 相遇')).toBe('第0004章 相遇');
		expect(numbering?.head('第0004章 相遇')).toBe('第0004章');
		// The pattern asks for a title after the number, so a bare head is not one.
		expect(numbering?.read('第0003章')).toBeNull();
		expect(numbering?.read('第0000章 相遇')).toBeNull();
		const chapters = compileChapterRule(english);
		expect(chapters?.increment('Chapter 0012 The Road')).toBe('Chapter 0013 The Road');
		expect(chapters?.head('Chapter 0013 The Road')).toBe('Chapter 0013');
	});

	it('seeds with the first number written beside it, or not at all', () => {
		expect(compileChapterRule(padded)?.seed()).toBe('第0001章');
		expect(compileChapterRule(english)?.seed()).toBeNull();
		const unseeded = compileChapterRule(english);
		if (unseeded === null) throw new Error('did not compile');
		expect(proposeChapterNumber([], 0, unseeded)).toEqual({ head: null, followers: [] });
		expect(proposeChapterNumber(['Prologue'], 1, unseeded)).toEqual({ head: null, followers: [] });
	});

	it('takes the first group as the number when the pattern has one', () => {
		const numbering = compileChapterRule(custom('regex', '^Part (\\d+) of (\\d+)'));
		expect(numbering?.read('Part 2 of 9')).toMatchObject({ number: 2, from: 5, to: 6 });
		expect(numbering?.increment('Part 2 of 9')).toBe('Part 3 of 9');
	});

	it('reads Chinese numerals through a custom pattern', () => {
		const numbering = compileChapterRule(custom('regex', '^卷([一二三四五六七八九十百]+)', '卷一'));
		expect(numbering?.increment('卷十 归途')).toBe('卷十一 归途');
		expect(numbering?.seed()).toBe('卷一');
	});
});

describe('the custom rules together', () => {
	it('names what is wrong with a rule, and compiles nothing from it', () => {
		expect(chapterRuleProblem('regex', '^第(\\d')).toBe('pattern');
		expect(compileChapterRule(custom('regex', '^第(\\d'))).toBeNull();
		expect(chapterRuleProblem('format', '第章')).toBe('format');
		expect(compileChapterRule(custom('format', '第章'))).toBeNull();
		expect(chapterRuleProblem('format', '第{nnnn}章')).toBeNull();
		expect(chapterRuleProblem('regex', '^第\\d+章')).toBeNull();
		expect(compileChapterRule(null)).toBeNull();
	});

	it('runs the one rule that is enabled, and none when none is', () => {
		const paused = custom('format', 'Chapter {n}', '', false);
		const running = custom('format', '第{zh}章');
		expect(runningChapterRule([paused, running])?.text).toBe('第{zh}章');
		expect(runningChapterRule([paused])).toBeNull();
		expect(rule('custom', [paused, running]).seed()).toBe('第一章');
		expect(compileChapterNumbering({ style: 'custom', rules: [paused] })).toBeNull();
		expect(compileChapterNumbering({ style: 'custom', rules: [] })).toBeNull();
	});

	it('reads stored rules back with junk dropped and one rule running at most', () => {
		const kept = sanitizeChapterNumberRules([
			{ id: 'a', kind: 'format', text: ' 第{nnnn}章 ', enabled: true },
			{ id: 'b', kind: 'regex', text: '^Chapter \\d+', seed: ' Chapter 1 ', enabled: true },
			{ id: 'c', kind: 'format', text: '卷{zh}' },
			{ id: 'a', kind: 'format', text: 'again' },
			{ id: 'd', kind: 'roman', text: 'Chapter {n}' },
			{ id: 'e', kind: 'format', text: '   ' },
			{ id: '', kind: 'format', text: 'Chapter {n}' },
			'Chapter {n}',
			null,
		]);
		expect(kept).toEqual([
			{ id: 'a', kind: 'format', text: '第{nnnn}章', seed: '', enabled: true },
			{ id: 'b', kind: 'regex', text: '^Chapter \\d+', seed: 'Chapter 1', enabled: false },
			{ id: 'c', kind: 'format', text: '卷{zh}', seed: '', enabled: false },
		]);
		expect(sanitizeChapterNumberRules('rules')).toEqual([]);
		// The first rule found running is the one kept running.
		const later = sanitizeChapterNumberRules([
			{ id: 'a', kind: 'format', text: 'A {n}', enabled: false },
			{ id: 'b', kind: 'format', text: 'B {n}', enabled: true },
		]);
		expect(later.map((entry) => entry.enabled)).toEqual([false, true]);
	});

	it('is off when asked to be', () => {
		expect(compileChapterNumbering({ style: 'off', rules: [] })).toBeNull();
		expect(isChapterNumberingStyle('custom')).toBe(true);
		expect(isChapterNumberingStyle('roman')).toBe(false);
	});
});

describe('proposing the next number', () => {
	const titles = ['第一章 陨落', '第二章 斗气', '番外 回忆', '第三章 客人', '第四章 云岚宗'];
	const chinese = rule('chinese');

	it('raises the number of the note before, and moves the numbered notes after up by one', () => {
		expect(proposeChapterNumber(titles, 2, chinese)).toEqual({
			head: '第三章',
			followers: [
				{ index: 3, title: '第三章 客人', next: '第四章 客人' },
				{ index: 4, title: '第四章 云岚宗', next: '第五章 云岚宗' },
			],
		});
	});

	it('offers nothing after an unnumbered note while the manuscript is numbered', () => {
		expect(proposeChapterNumber(titles, 3, chinese)).toEqual({
			head: null,
			followers: [],
		});
	});

	it('starts from one before the first note, moving every numbered note up', () => {
		expect(proposeChapterNumber(titles, 0, chinese)).toEqual({
			head: '第一章',
			followers: [
				{ index: 0, title: '第一章 陨落', next: '第二章 陨落' },
				{ index: 1, title: '第二章 斗气', next: '第三章 斗气' },
				{ index: 3, title: '第三章 客人', next: '第四章 客人' },
				{ index: 4, title: '第四章 云岚宗', next: '第五章 云岚宗' },
			],
		});
	});

	it('starts from one in an empty manuscript, or one numbered by no rule', () => {
		expect(proposeChapterNumber([], 0, chinese)).toEqual({ head: '第一章', followers: [] });
		expect(proposeChapterNumber(['序章', '番外'], 2, chinese)).toEqual({
			head: '第一章',
			followers: [],
		});
	});

	it('appends after the last note with nothing to move', () => {
		expect(proposeChapterNumber(titles, titles.length, chinese)).toEqual({
			head: '第五章',
			followers: [],
		});
		// A place past the end is the end.
		expect(proposeChapterNumber(titles, 99, chinese).head).toBe('第五章');
	});

	it('keeps each follower in its own spelling', () => {
		const mixed = ['第 1 章 一', '第 2 章 二', '第03章 三'];
		expect(proposeChapterNumber(mixed, 1, rule('chinese-arabic'))).toEqual({
			head: '第 2 章',
			followers: [
				{ index: 1, title: '第 2 章 二', next: '第 3 章 二' },
				{ index: 2, title: '第03章 三', next: '第04章 三' },
			],
		});
	});
});

describe('lowering a number', () => {
	it('moves a number down by one in its own spelling', () => {
		expect(rule('chinese').decrement('第十一章 相遇')).toBe('第十章 相遇');
		expect(rule('chinese-arabic').decrement('第 10 章 相遇')).toBe('第 9 章 相遇');
		expect(rule('english').decrement('Chapter 0010 The Road')).toBe(
			'Chapter 0009 The Road',
		);
		expect(rule('english').decrement('Chapter 3 - 3 Doors')).toBe(
			'Chapter 2 - 3 Doors',
		);
	});

	it('has nowhere to go from one, and nothing to do for an unnumbered name', () => {
		expect(rule('english').decrement('Chapter 1')).toBeNull();
		expect(rule('chinese').decrement('第一章')).toBeNull();
		expect(rule('english').decrement('Prologue')).toBeNull();
	});
});

describe('proposing the numbers after a removal', () => {
	const titles = ['第一章 陨落', '第二章 斗气', '番外 回忆', '第三章 客人', '第四章 云岚宗'];
	const chinese = rule('chinese');

	it('moves the numbered notes after a numbered note down by one, closing the gap', () => {
		expect(proposeChapterRemoval(titles, 1, chinese)).toEqual({
			followers: [
				{ index: 3, title: '第三章 客人', next: '第二章 客人' },
				{ index: 4, title: '第四章 云岚宗', next: '第三章 云岚宗' },
			],
		});
	});

	it('moves nothing for an unnumbered note going, since the count did not hold it', () => {
		expect(proposeChapterRemoval(titles, 2, chinese)).toEqual({ followers: [] });
	});

	it('moves nothing after the last note, or for a place that is not a note', () => {
		expect(proposeChapterRemoval(titles, 4, chinese)).toEqual({ followers: [] });
		expect(proposeChapterRemoval(titles, 99, chinese)).toEqual({ followers: [] });
		expect(proposeChapterRemoval([], 0, chinese)).toEqual({ followers: [] });
	});

	it('leaves a note numbered one where it is, having nothing below one to offer', () => {
		expect(proposeChapterRemoval(['第一章 甲', '第一章 乙'], 0, chinese)).toEqual({
			followers: [],
		});
	});

	it('undoes what an insertion proposed', () => {
		const inserted = proposeChapterNumber(titles, 2, chinese);
		const moved = titles.map(
			(title, index) =>
				inserted.followers.find((follower) => follower.index === index)?.next ??
				title,
		);
		const withNew = [
			...moved.slice(0, 2),
			`${String(inserted.head)} 新`,
			...moved.slice(2),
		];
		expect(withNew).toEqual([
			'第一章 陨落',
			'第二章 斗气',
			'第三章 新',
			'番外 回忆',
			'第四章 客人',
			'第五章 云岚宗',
		]);
		const removed = proposeChapterRemoval(withNew, 2, chinese);
		const restored = withNew.map(
			(title, index) =>
				removed.followers.find((follower) => follower.index === index)?.next ??
				title,
		);
		restored.splice(2, 1);
		expect(restored).toEqual(titles);
	});
});
