import { describe, expect, it } from 'vitest';

import {
	combineMentionMarks,
	compileCustomHighlightRules,
	highlightRulesFingerprint,
	newHighlightRuleId,
	planHighlightMarks,
	sanitizeCustomHighlightRules,
	type CustomHighlightRule,
	type MentionMark,
} from '../../src/domain';

const rule = (over: Partial<CustomHighlightRule>): CustomHighlightRule => ({
	id: 'rule-one',
	name: 'Weather',
	kind: 'literal',
	patterns: ['fog'],
	enabled: true,
	decoration: 'background',
	color: null,
	...over,
});

describe('sanitizing stored rules', () => {
	it('reads junk as no rules at all', () => {
		expect(sanitizeCustomHighlightRules(undefined)).toEqual([]);
		expect(sanitizeCustomHighlightRules('rules')).toEqual([]);
		expect(sanitizeCustomHighlightRules({ length: 1 })).toEqual([]);
	});

	it('drops entries missing their shape and keeps the rest', () => {
		const kept = sanitizeCustomHighlightRules([
			rule({}),
			{ id: '', kind: 'literal', patterns: [] },
			{ id: 'no-kind', kind: 'fancy', patterns: [] },
			{ id: 'no-patterns', kind: 'regex', patterns: 'a' },
			null,
		]);
		expect(kept.map((entry) => entry.id)).toEqual(['rule-one']);
	});

	it('drops empty patterns and fills missing dress with defaults', () => {
		const kept = sanitizeCustomHighlightRules([
			{ id: 'r', kind: 'literal', patterns: ['fog', '  ', ''] },
		]);
		expect(kept).toEqual([
			{
				id: 'r',
				name: '',
				kind: 'literal',
				patterns: ['fog'],
				enabled: true,
				decoration: 'background',
				color: null,
			},
		]);
	});

	it('keeps only colors spelled as hex', () => {
		const colored = (color: unknown): string | null =>
			sanitizeCustomHighlightRules([rule({ color: color as string })])[0]
				?.color ?? null;
		expect(colored('#aabbcc')).toBe('#aabbcc');
		expect(colored('#AABBCCDD')).toBe('#AABBCCDD');
		expect(colored('red')).toBeNull();
		expect(colored('#abc')).toBeNull();
		expect(colored('#aabbcc; background: url(x)')).toBeNull();
	});

	it('keeps the first reading of a duplicated id', () => {
		const kept = sanitizeCustomHighlightRules([
			rule({ patterns: ['first'] }),
			rule({ patterns: ['second'] }),
		]);
		expect(kept).toHaveLength(1);
		expect(kept[0]?.patterns).toEqual(['first']);
	});

	it('hands out ids that survive its own reading', () => {
		const id = newHighlightRuleId();
		expect(sanitizeCustomHighlightRules([rule({ id })])[0]?.id).toBe(id);
		expect(newHighlightRuleId()).not.toBe(id);
	});
});

describe('the compilation fingerprint', () => {
	it('ignores what is read live at plan time', () => {
		const base = highlightRulesFingerprint([rule({})]);
		expect(
			highlightRulesFingerprint([
				rule({ name: 'Renamed', color: '#aabbcc', decoration: 'wavy' }),
			]),
		).toBe(base);
	});

	it('moves with patterns and with the enabled set', () => {
		const base = highlightRulesFingerprint([rule({})]);
		expect(highlightRulesFingerprint([rule({ patterns: ['mist'] })])).not.toBe(
			base,
		);
		expect(highlightRulesFingerprint([rule({ enabled: false })])).not.toBe(
			base,
		);
	});

	it('lets a disabled rule change without a rebuild', () => {
		const disabled = rule({ id: 'off', enabled: false });
		const base = highlightRulesFingerprint([rule({}), disabled]);
		expect(
			highlightRulesFingerprint([
				rule({}),
				{ ...disabled, patterns: ['changed'] },
			]),
		).toBe(base);
	});
});

describe('collecting literal matches', () => {
	it('finds a word with exact offsets and leaves other words alone', () => {
		const body = 'The fog came in, and foggy panes held it.';
		const compiled = compileCustomHighlightRules([rule({})]);
		const hits = compiled.collect(body);
		expect(hits).toHaveLength(1);
		const hit = hits[0];
		expect(body.slice(hit?.from ?? 0, hit?.to ?? 0)).toBe('fog');
	});

	it('matches inside a CJK run, the shared limitation', () => {
		const body = '他们走进森林深处。';
		const compiled = compileCustomHighlightRules([
			rule({ patterns: ['林'] }),
		]);
		expect(compiled.collect(body)).toHaveLength(1);
	});

	it('matches the other Unicode spelling of a pattern', () => {
		const decomposed = 'cafe\u0301';
		const body = `Au ${decomposed} demain`;
		const compiled = compileCustomHighlightRules([
			rule({ patterns: ['café'] }),
		]);
		const hit = compiled.collect(body)[0];
		expect(body.slice(hit?.from ?? 0, hit?.to ?? 0)).toBe(decomposed);
	});

	it('never reaches into code', () => {
		const body = 'Plain fog here, `fog` in code.';
		const compiled = compileCustomHighlightRules([rule({})]);
		expect(compiled.collect(body)).toHaveLength(1);
	});

	it('answers every rule that registered the same pattern', () => {
		const compiled = compileCustomHighlightRules([
			rule({ id: 'a' }),
			rule({ id: 'b', decoration: 'bold' }),
		]);
		const hits = compiled.collect('The fog.');
		expect(hits.map((hit) => hit.ruleId).sort()).toEqual(['a', 'b']);
	});

	it('skips disabled rules and reports nothing to scan', () => {
		const compiled = compileCustomHighlightRules([rule({ enabled: false })]);
		expect(compiled.matchableCount).toBe(0);
		expect(compiled.collect('The fog.')).toEqual([]);
	});
});

describe('collecting regex matches', () => {
	it('lands offsets in the original body across markdown', () => {
		const body = 'A `code` line was very quiet indeed.';
		const compiled = compileCustomHighlightRules([
			rule({ kind: 'regex', patterns: ['\\bvery\\s+\\w+'] }),
		]);
		const hit = compiled.collect(body)[0];
		expect(body.slice(hit?.from ?? 0, hit?.to ?? 0)).toBe('very quiet');
	});

	it('emits nothing where a pattern matches empty, and still ends', () => {
		const body = 'b aaa b';
		const compiled = compileCustomHighlightRules([
			rule({ kind: 'regex', patterns: ['a*'] }),
		]);
		const hits = compiled.collect(body);
		expect(hits).toHaveLength(1);
		expect(body.slice(hits[0]?.from ?? 0, hits[0]?.to ?? 0)).toBe('aaa');
	});

	it('sets a broken pattern aside and keeps matching the rest', () => {
		const compiled = compileCustomHighlightRules([
			rule({ id: 'broken', kind: 'regex', patterns: ['('] }),
			rule({ id: 'sound', patterns: ['fog'] }),
		]);
		expect([...compiled.brokenRuleIds]).toEqual(['broken']);
		expect(compiled.matchableCount).toBe(1);
		expect(compiled.collect('The fog.')).toHaveLength(1);
	});
});

describe('planning highlight marks', () => {
	const body = 'The fog came in.';

	it('dresses a hit with its rule and remembers the spot', () => {
		const rules = [
			rule({ name: 'Weather words', decoration: 'wavy', color: '#aabbcc' }),
		];
		const marks = planHighlightMarks(
			'Demo/50_Manuscript/One.md',
			body,
			[{ ruleId: 'rule-one', from: 4, to: 7 }],
			rules,
		);
		expect(marks).toEqual([
			{
				from: 4,
				to: 7,
				classes: 'snowflake-method-highlight is-deco-wavy',
				title: 'Weather words',
				styleVar: '--snowflake-method-highlight-color: #aabbcc',
				occurrence: {
					type: 'highlight',
					path: 'Demo/50_Manuscript/One.md',
					from: 4,
					to: 7,
					matchedText: 'fog',
					ruleId: 'rule-one',
				},
			},
		]);
	});

	it('offers no title for a nameless rule and no style without a color', () => {
		const marks = planHighlightMarks(
			'note.md',
			body,
			[{ ruleId: 'rule-one', from: 4, to: 7 }],
			[rule({ name: '' })],
		);
		expect(marks[0]?.title).toBeUndefined();
		expect(marks[0]?.styleVar).toBeUndefined();
	});

	it('drops a hit whose rule is gone', () => {
		expect(
			planHighlightMarks('note.md', body, [{ ruleId: 'gone', from: 0, to: 3 }], [
				rule({}),
			]),
		).toEqual([]);
	});
});

describe('combining mark sets', () => {
	const mark = (
		from: number,
		to: number,
		label: string,
	): MentionMark => ({
		from,
		to,
		classes: label,
		occurrence: {
			type: 'highlight',
			path: 'note.md',
			from,
			to,
			matchedText: '',
			ruleId: label,
		},
	});

	it('lets an earlier set keep its ground whole', () => {
		const combined = combineMentionMarks(
			[mark(4, 9, 'entity')],
			[mark(6, 12, 'custom'), mark(20, 24, 'clear')],
		);
		expect(combined.map((entry) => entry.classes)).toEqual([
			'entity',
			'clear',
		]);
	});

	it('settles a set against itself: start, then length, then order', () => {
		const combined = combineMentionMarks([
			mark(5, 8, 'later-short'),
			mark(5, 12, 'later-long'),
			mark(2, 6, 'earliest'),
			mark(20, 24, 'tie-listed-first'),
			mark(20, 24, 'tie-listed-second'),
		]);
		expect(combined.map((entry) => entry.classes)).toEqual([
			'earliest',
			'tie-listed-first',
		]);
	});

	it('hands back sorted, non-overlapping marks from empty or full sets', () => {
		expect(combineMentionMarks([], [])).toEqual([]);
		const combined = combineMentionMarks(
			[mark(10, 12, 'b')],
			[mark(0, 2, 'a')],
		);
		expect(combined.map((entry) => entry.from)).toEqual([0, 10]);
	});
});
