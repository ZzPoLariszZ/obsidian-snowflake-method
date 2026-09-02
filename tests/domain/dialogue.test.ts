import { describe, expect, it } from 'vitest';

import {
	DIALOGUE_PRESENTATIONS,
	DIALOGUE_STYLE_TOKENS,
	dialogueOccurrencesOf,
	dialogueRanges,
	dialogueSplit,
	isDialoguePresentation,
	parseQuotePair,
	planDialogueMarks,
	type DialogueStyle,
} from '../../src/domain';

const styles = (...tokens: readonly string[]): DialogueStyle[] =>
	tokens
		.map((token) => parseQuotePair(token))
		.filter((style): style is DialogueStyle => style !== null);

const all = styles(...Object.values(DIALOGUE_STYLE_TOKENS));

const quoted = (body: string, using: readonly DialogueStyle[] = all): string[] =>
	dialogueRanges(body, using).map((range) => body.slice(range.from, range.to));

describe('reading quote pairs', () => {
	it('reads a two-character token and refuses the rest', () => {
		expect(parseQuotePair('「」')).toEqual({ open: '「', close: '」' });
		expect(parseQuotePair('""')).toEqual({ open: '"', close: '"' });
		expect(parseQuotePair('“')).toBeNull();
		expect(parseQuotePair('“”"')).toBeNull();
	});
});

describe('finding dialogue ranges', () => {
	it('reads a plain quoted stretch, marks included', () => {
		expect(quoted('他说：「你来了。」然后坐下。')).toEqual(['「你来了。」']);
	});

	it('collapses a nested quotation into the outer range', () => {
		expect(quoted('「他说『走吧』就走了」')).toEqual(['「他说『走吧』就走了」']);
		expect(quoted('“He said "go" and left”')).toEqual([
			'“He said "go" and left”',
		]);
	});

	it('toggles straight quotes and keeps them apart', () => {
		expect(quoted('He said "hi" and then "bye".')).toEqual(['"hi"', '"bye"']);
	});

	it('closes an unmatched open at the paragraph end', () => {
		expect(quoted('「话没说完\n\n下一段没有引号。')).toEqual(['「话没说完']);
	});

	it('flows through a soft-wrapped line inside one paragraph', () => {
		expect(quoted('「第一行\n第二行」')).toEqual(['「第一行\n第二行」']);
	});

	it('reads a stray closing mark as prose', () => {
		expect(quoted('他说」了什么。')).toEqual([]);
	});

	it('is blind to apostrophes and to disabled styles', () => {
		expect(quoted("don't stop", styles('""'))).toEqual([]);
		expect(quoted('「你好」', styles('“”'))).toEqual([]);
		expect(dialogueRanges('「你好」', [])).toEqual([]);
	});

	it('never reads quotes inside code', () => {
		expect(quoted('`「code」`之外「真话」')).toEqual(['「真话」']);
	});

	it('orders ranges by where they stand', () => {
		const body = '「一」和“二”。';
		const ranges = dialogueRanges(body, all);
		expect(ranges.map((range) => body.slice(range.from, range.to))).toEqual([
			'「一」',
			'“二”',
		]);
	});
});

describe('splitting the writing at the quotes', () => {
	it('counts inside and outside, the marks to neither', () => {
		const body = '他说：「你好啊」然后走了。';
		const split = dialogueSplit(body, dialogueRanges(body, all));
		expect(split.dialogue).toEqual({ cjk: 3, words: 0 });
		expect(split.narrative).toEqual({ cjk: 6, words: 0 });
	});

	it('splits Latin dialogue into words', () => {
		const body = 'He said "come back soon" and waved.';
		const split = dialogueSplit(body, dialogueRanges(body, all));
		expect(split.dialogue).toEqual({ cjk: 0, words: 3 });
		expect(split.narrative).toEqual({ cjk: 0, words: 4 });
	});

	it('reads everything as narrative when nothing is quoted', () => {
		const split = dialogueSplit('平静的一天。', []);
		expect(split.dialogue).toEqual({ cjk: 0, words: 0 });
		expect(split.narrative).toEqual({ cjk: 5, words: 0 });
	});
});

describe('occurrences', () => {
	it('slices the quoted text fresh', () => {
		const body = '他说：「走吧」。';
		const occurrences = dialogueOccurrencesOf(
			'note.md',
			body,
			dialogueRanges(body, all),
		);
		expect(occurrences).toEqual([
			{
				type: 'dialogue',
				path: 'note.md',
				from: 3,
				to: 7,
				matchedText: '「走吧」',
			},
		]);
	});
});

describe('the dialogue dress', () => {
	it('plans one plain mark per range, the quoted text carried', () => {
		const body = '他说：「走吧」。';
		const marks = planDialogueMarks(
			'note.md',
			body,
			dialogueRanges(body, all),
		);
		expect(marks).toEqual([
			{
				from: 3,
				to: 7,
				classes: 'snowflake-method-dialogue',
				// Dress only: a quoted stretch answers no menu of its own.
				silent: true,
				occurrence: {
					type: 'dialogue',
					path: 'note.md',
					from: 3,
					to: 7,
					matchedText: '「走吧」',
				},
			},
		]);
	});

	it('names its three presentations and refuses the rest', () => {
		expect(DIALOGUE_PRESENTATIONS).toEqual(['off', 'highlight', 'focus']);
		expect(isDialoguePresentation('focus')).toBe(true);
		expect(isDialoguePresentation('fade')).toBe(false);
	});
});
