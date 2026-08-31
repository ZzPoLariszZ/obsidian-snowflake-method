import { describe, expect, it } from 'vitest';

import {
	analyzeMentions,
	buildEntityMatcher,
	captureRevision,
	combineMentionMarks,
	dialogueRanges,
	planDialogueMarks,
	planMentionMarks,
	planRevisionMarks,
	type CountableRange,
	type MentionMark,
	type MentionSource,
} from '../../src/domain';
import { projectMentionMarks } from '../../src/ui/mention-marks';

const source = (
	label: string,
	entry: 'name' | 'alias',
	memberPath: string,
): MentionSource => ({
	label,
	entry,
	memberPath,
	memberName: memberPath.replace(/\.md$/u, '').split('/').pop() ?? memberPath,
	group: 'character',
	groupRank: 0,
	rank: 0,
	insert: `[[${memberPath.replace(/\.md$/u, '')}|${label}]]`,
});

const alice = source('Alice', 'name', 'Demo/20_Character/Alice.md');

const marksFor = (
	body: string,
	sources: MentionSource[],
	excludeRanges: CountableRange[] = [],
): MentionMark[] =>
	planMentionMarks(
		analyzeMentions(
			'note.md',
			body,
			excludeRanges,
			buildEntityMatcher(sources),
			[],
		),
		[],
		'all',
	);

describe('rendered mention mapping', () => {
	it('maps a mark across syntax onto the visible sequence', () => {
		// Visible characters: s o A l i c e r a n — the marks are not shown.
		const body = 'so **Alice** ran';
		const spans = projectMentionMarks(body, marksFor(body, [alice]));
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ from: 2, to: 7, index: 0, text: 'Alice' });
	});

	it('maps a link alias where the page shows it', () => {
		const body = '去[[Demo/20_Character/Alice|小艾]]了';
		const spans = projectMentionMarks(body, [
			...marksFor(body, [source('小艾', 'alias', 'Demo/20_Character/Alice.md')]),
		]);
		// Visible characters: 去 小 艾 了 — the target never shows.
		expect(spans[0]).toMatchObject({ from: 1, to: 3, text: '小艾' });
	});

	it('carries a two-word name whole, its own whitespace dropped', () => {
		const body = 'the Black Tower stands';
		const spans = projectMentionMarks(body, [
			...marksFor(body, [
				source('Black Tower', 'name', 'Demo/60_Worldbuilding/63_Item/Black Tower.md'),
			]),
		]);
		expect(spans[0]).toMatchObject({ from: 3, to: 13, text: 'BlackTower' });
	});

	it('counts under the same exclusions the analysis ran with', () => {
		const body = 'IGNORED Alice';
		const excluded: CountableRange[] = [{ from: 0, to: 8 }];
		const withExcludes = projectMentionMarks(
			body,
			marksFor(body, [alice], excluded),
			excluded,
		);
		expect(withExcludes[0]).toMatchObject({ from: 0, to: 5 });
		const without = projectMentionMarks(body, marksFor(body, [alice]));
		expect(without[0]).toMatchObject({ from: 7, to: 12 });
	});
});

describe('combined families on the visible sequence', () => {
	it('keeps every family addressable by its combined index', () => {
		const body = 'so **Alice** saw the fog';
		const combined = combineMentionMarks(marksFor(body, [alice]), [
			{
				from: 21,
				to: 24,
				classes: 'snowflake-method-highlight is-deco-color',
				title: 'Weather',
				occurrence: {
					type: 'highlight',
					path: 'note.md',
					from: 21,
					to: 24,
					matchedText: 'fog',
					ruleId: 'rule-one',
				},
			},
		]);
		const spans = projectMentionMarks(body, combined);
		expect(spans.map((span) => [span.index, span.text])).toEqual([
			[0, 'Alice'],
			[1, 'fog'],
		]);
		expect(spans[1]?.mark.title).toBe('Weather');
	});
});

describe('marks that span syntax', () => {
	it('verifies a quoted stretch by its visible characters', () => {
		const body = '他说：「**走**吧」。';
		const marks = planDialogueMarks(
			'note.md',
			body,
			dialogueRanges(body, [{ open: '「', close: '」' }]),
		);
		const spans = projectMentionMarks(body, marks);
		expect(spans).toHaveLength(1);
		// The emphasis marks never show, so the wrap must expect 「走吧」.
		expect(spans[0]?.text).toBe('「走吧」');
	});
});

describe('the revision layer on the rendered half', () => {
	it('projects a revision range across syntax like any other mark', () => {
		const body = 'so **grey heron** ran';
		const from = body.indexOf('grey');
		const { plan } = planRevisionMarks('note.md', body, [
			captureRevision('note.md', body, 'replace', from, from + 10, 'crane', '', 'rev-1', 7),
		]);
		const spans = projectMentionMarks(body, plan);
		expect(spans).toHaveLength(1);
		// Visible: s o g r e y h e r o n r a n -- the asterisks are not shown.
		expect(spans[0]).toMatchObject({ from: 2, to: 11, text: 'greyheron' });
		expect(spans[0]?.mark.classes).toBe('snowflake-method-revision is-replace');
	});

	it('an insertion carrier is one visible character wide', () => {
		const body = 'before after';
		const point = body.indexOf(' ');
		const { plan } = planRevisionMarks('note.md', body, [
			captureRevision('note.md', body, 'insert', point, point, 'x', '', 'rev-2', 7),
		]);
		const spans = projectMentionMarks(body, plan);
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ from: 6, to: 7, text: 'a' });
		expect(spans[0]?.mark.classes).toBe(
			'snowflake-method-revision is-insertion',
		);
	});

	it('rides apart from the mention layer, whose indices it never shifts', () => {
		const body = 'so Alice ran';
		const mentionMarks = marksFor(body, [alice]);
		const { plan } = planRevisionMarks('note.md', body, [
			captureRevision('note.md', body, 'replace', 0, body.length, 'x', '', 'rev-3', 7),
		]);
		const mentionSpans = projectMentionMarks(body, mentionMarks);
		const revisionSpans = projectMentionMarks(body, plan);
		expect(mentionSpans[0]?.index).toBe(0);
		expect(revisionSpans[0]?.index).toBe(0);
		expect(mentionSpans[0]?.text).toBe('Alice');
		expect(revisionSpans[0]?.text).toBe('soAliceran');
	});
});
