import { describe, expect, it } from 'vitest';

import {
	analyzeMentions,
	applyOccurrenceIgnores,
	buildEntityMatcher,
	entityMatcherFingerprints,
	isMentionIgnore,
	mentionIgnoreOf,
	occurrenceContext,
	planMentionMarks,
	type EntityOccurrence,
	type MentionIgnore,
	type MentionSource,
} from '../../src/domain';

const source = (
	label: string,
	entry: 'name' | 'alias',
	memberPath: string,
	over: Partial<MentionSource> = {},
): MentionSource => ({
	label,
	entry,
	memberPath,
	memberName: memberPath.replace(/\.md$/u, '').split('/').pop() ?? memberPath,
	group: 'character',
	groupRank: 0,
	rank: 0,
	insert: `[[${memberPath.replace(/\.md$/u, '')}|${label}]]`,
	...over,
});

const alice = 'Demo/20_Character/Alice.md';
const bob = 'Demo/20_Character/Bob.md';

const mentions = (
	body: string,
	sources: MentionSource[],
	ignores: MentionIgnore[] = [],
	path = 'Demo/50_Manuscript/Chapter 1.md',
): EntityOccurrence[] =>
	analyzeMentions(path, body, [], buildEntityMatcher(sources), ignores);

describe('entity mentions', () => {
	it('lets the longest overlapping match win', () => {
		const body = '他们抵达黑塔城。';
		const found = mentions(body, [
			source('黑塔', 'name', 'Demo/60_Worldbuilding/62_Location/黑塔.md'),
			source('黑塔城', 'name', 'Demo/60_Worldbuilding/62_Location/黑塔城.md'),
		]);
		expect(found.map((entry) => entry.matchedText)).toEqual(['黑塔城']);
		expect(body.slice(found[0]?.from, found[0]?.to)).toBe('黑塔城');
		expect(found[0]?.resolution).toBe('unique');
	});

	it('never matches a Latin name inside another word', () => {
		expect(mentions('Malice struck.', [source('Alice', 'name', alice)])).toEqual(
			[],
		);
	});

	it('matches a Latin name against CJK neighbors, which are boundaries', () => {
		const found = mentions('小Alice是谁', [source('Alice', 'name', alice)]);
		expect(found.map((entry) => entry.matchedText)).toEqual(['Alice']);
	});

	it('matches a CJK name inside a longer word: the deliberate trade-off', () => {
		// Without segmentation 林 stands in 森林; the mitigation is registering
		// the longer form, which the longest-match rule already prefers.
		const found = mentions('森林深处', [
			source('林', 'name', 'Demo/20_Character/林.md'),
		]);
		expect(found.map((entry) => entry.matchedText)).toEqual(['林']);
	});

	it('matches case exactly: a lowercase rose is not the character', () => {
		const rose = source('Rose', 'name', 'Demo/20_Character/Rose.md');
		expect(mentions('a rose bloomed', [rose])).toEqual([]);
		expect(mentions('Rose bloomed', [rose])).toHaveLength(1);
	});

	it('matches whichever Unicode spelling the body carries, offsets exact', () => {
		const cafe = source('café', 'name', 'Demo/20_Character/Cafe.md');
		const nfd = 'at café today';
		const found = mentions(nfd, [cafe]);
		expect(found).toHaveLength(1);
		expect(nfd.slice(found[0]?.from, found[0]?.to)).toBe('café');
	});

	describe('resolution', () => {
		it('resolves plain text with one candidate as unique', () => {
			const [found] = mentions('Alice waited.', [
				source('Alice', 'name', alice),
			]);
			expect(found?.resolution).toBe('unique');
			expect(found?.resolvedMemberPath).toBe(alice);
		});

		it('resolves the visible text of a link to its member', () => {
			const [found] = mentions('[[Demo/20_Character/Alice|Alice]] waited.', [
				source('Alice', 'name', alice),
			]);
			expect(found?.resolution).toBe('wikilink');
			expect(found?.resolvedMemberPath).toBe(alice);
		});

		it('reads a bare shortest link as the member it names', () => {
			const [found] = mentions('[[Alice]] waited.', [
				source('Alice', 'name', alice),
			]);
			expect(found?.resolution).toBe('wikilink');
			expect(found?.resolvedMemberPath).toBe(alice);
		});

		it('reads a link pointing elsewhere as foreign, resolved to nobody', () => {
			const [found] = mentions('[[Somewhere/Else|Alice]] waited.', [
				source('Alice', 'name', alice),
			]);
			expect(found?.resolution).toBe('foreign-link');
			expect(found?.resolvedMemberPath).toBeNull();
		});

		it('keeps a shared alias ambiguous in plain text', () => {
			const [found] = mentions('小艾走了。', [
				source('小艾', 'alias', alice),
				source('小艾', 'alias', bob),
			]);
			expect(found?.resolution).toBe('ambiguous');
			expect(found?.resolvedMemberPath).toBeNull();
			expect(found?.candidates.map((c) => c.memberPath)).toEqual([alice, bob]);
		});

		it('lets a link collapse a shared alias to the member it names', () => {
			const [found] = mentions('[[Demo/20_Character/Alice|小艾]]走了。', [
				source('小艾', 'alias', alice),
				source('小艾', 'alias', bob),
			]);
			expect(found?.resolution).toBe('wikilink');
			expect(found?.resolvedMemberPath).toBe(alice);
			expect(found?.candidates.map((c) => c.memberPath)).toEqual([alice]);
		});
	});

	it('never matches across a syntax seam', () => {
		expect(mentions('A**lice** ran', [source('Alice', 'name', alice)])).toEqual(
			[],
		);
	});

	describe('ignores', () => {
		const shared = [source('小艾', 'alias', alice), source('小艾', 'alias', bob)];
		const path = 'Demo/50_Manuscript/Chapter 1.md';

		it('resolves what remains after one candidate is silenced', () => {
			const [found] = mentions('小艾走了。', shared, [
				{ scope: 'note', notePath: path, memberPath: bob, matchedText: '小艾' },
			]);
			expect(found?.resolution).toBe('unique');
			expect(found?.resolvedMemberPath).toBe(alice);
		});

		it('drops a mention whose only candidate is silenced everywhere', () => {
			expect(
				mentions('Alice waited.', [source('Alice', 'name', alice)], [
					{ scope: 'manuscript', memberPath: alice, matchedText: 'Alice' },
				]),
			).toEqual([]);
		});

		it('holds a note-scoped silence to its note', () => {
			const rule: MentionIgnore = {
				scope: 'note',
				notePath: 'Demo/50_Manuscript/Chapter 2.md',
				memberPath: alice,
				matchedText: 'Alice',
			};
			expect(
				mentions('Alice waited.', [source('Alice', 'name', alice)], [rule]),
			).toHaveLength(1);
		});

		it('silences one spot by its position among same-text mentions', () => {
			const found = mentions('Alice a Alice b Alice', [
				source('Alice', 'name', alice),
			]);
			expect(found).toHaveLength(3);
			const kept = applyOccurrenceIgnores(found, [
				{
					scope: 'occurrence',
					notePath: found[0]?.path ?? '',
					matchedText: 'Alice',
					ordinal: 1,
				},
			]);
			expect(kept.map((entry) => entry.from)).toEqual([
				found[0]?.from,
				found[2]?.from,
			]);
		});

		it('writes the rule a menu action means', () => {
			const found = mentions('Alice a Alice', [source('Alice', 'name', alice)]);
			const middle = found[1] as EntityOccurrence;
			expect(mentionIgnoreOf(middle, found, 'occurrence')).toEqual({
				scope: 'occurrence',
				notePath: middle.path,
				matchedText: 'Alice',
				ordinal: 1,
			});
			expect(mentionIgnoreOf(middle, found, 'manuscript')).toEqual({
				scope: 'manuscript',
				memberPath: alice,
				matchedText: 'Alice',
			});
		});

		it('recognizes only well-formed rules', () => {
			expect(
				isMentionIgnore({
					scope: 'note',
					notePath: 'a',
					memberPath: 'b',
					matchedText: 'c',
				}),
			).toBe(true);
			expect(
				isMentionIgnore({
					scope: 'occurrence',
					notePath: 'a',
					matchedText: 'c',
					ordinal: 0,
				}),
			).toBe(true);
			expect(isMentionIgnore({ scope: 'note', notePath: 'a' })).toBe(false);
			expect(
				isMentionIgnore({
					scope: 'occurrence',
					notePath: 'a',
					matchedText: 'c',
					ordinal: -1,
				}),
			).toBe(false);
			expect(isMentionIgnore(null)).toBe(false);
		});
	});

	describe('mark planning', () => {
		const body =
			'Alice met [[Demo/20_Character/Bob|Bob]] and [[Elsewhere|Alice]] and 小艾。';
		const sources = [
			source('Alice', 'name', alice),
			source('Bob', 'name', bob),
			source('小艾', 'alias', alice),
			source('小艾', 'alias', bob),
		];

		it('selects by mode over the resolution states', () => {
			const found = mentions(body, sources);
			expect(found.map((entry) => entry.resolution)).toEqual([
				'unique',
				'wikilink',
				'foreign-link',
				'ambiguous',
			]);
			expect(planMentionMarks(found, [], 'off')).toEqual([]);
			expect(
				planMentionMarks(found, [], 'all').map(
					(mark) => mark.occurrence.resolution,
				),
			).toEqual(['unique', 'wikilink', 'ambiguous']);
			expect(
				planMentionMarks(found, [], 'unlinked').map(
					(mark) => mark.occurrence.resolution,
				),
			).toEqual(['unique', 'ambiguous']);
			expect(
				planMentionMarks(found, [], 'first').map(
					(mark) => mark.occurrence.resolvedMemberPath,
				),
			).toEqual([alice, bob]);
		});

		it('dresses marks with their state classes', () => {
			const found = mentions(body, sources);
			const marks = planMentionMarks(found, [], 'all');
			expect(marks[0]?.classes).toBe(
				'snowflake-method-mention is-unlinked is-first',
			);
			expect(marks[1]?.classes).toBe(
				'snowflake-method-mention is-linked is-first',
			);
			expect(marks[2]?.classes).toBe(
				'snowflake-method-mention is-unlinked is-ambiguous',
			);
		});

		it('promotes the next mention when the first is silenced', () => {
			const found = mentions('Alice a Alice', [source('Alice', 'name', alice)]);
			const marks = planMentionMarks(
				found,
				[
					{
						scope: 'occurrence',
						notePath: found[0]?.path ?? '',
						matchedText: 'Alice',
						ordinal: 0,
					},
				],
				'first',
			);
			expect(marks.map((mark) => mark.from)).toEqual([found[1]?.from]);
		});
	});

	describe('fingerprints', () => {
		const sources = [
			source('Alice', 'name', alice),
			source('小艾', 'alias', alice),
		];

		it('holds steady across source order', () => {
			const forward = entityMatcherFingerprints(sources);
			const backward = entityMatcherFingerprints([...sources].reverse());
			expect(backward).toEqual(forward);
		});

		it('moves the metadata alone when a rank changes', () => {
			const before = entityMatcherFingerprints(sources);
			const after = entityMatcherFingerprints([
				{ ...(sources[0] as MentionSource), rank: 9 },
				sources[1] as MentionSource,
			]);
			expect(after.pattern).toBe(before.pattern);
			expect(after.metadata).not.toBe(before.metadata);
			expect(after.combined).not.toBe(before.combined);
		});

		it('moves the pattern when a label changes', () => {
			const before = entityMatcherFingerprints(sources);
			const after = entityMatcherFingerprints([
				{ ...(sources[0] as MentionSource), label: 'Alicia' },
				sources[1] as MentionSource,
			]);
			expect(after.pattern).not.toBe(before.pattern);
		});
	});

	describe('occurrence context', () => {
		it('clips to the radius, drops a partial word, and marks the cuts', () => {
			const body = 'alpha beta gamma Alice delta epsilon zeta';
			expect(occurrenceContext(body, 17, 22, 10)).toEqual({
				before: '…gamma ',
				match: 'Alice',
				after: ' delta…',
			});
		});

		it('stays on the occurrence line', () => {
			expect(occurrenceContext('one\nAlice\ntwo', 4, 9, 10)).toEqual({
				before: '',
				match: 'Alice',
				after: '',
			});
		});

		it('keeps a spaceless clip whole behind its ellipsis', () => {
			const body = '他们抵达黑塔城之后又继续前行了很远';
			expect(occurrenceContext(body, 4, 7, 5)).toEqual({
				before: '他们抵达',
				match: '黑塔城',
				after: '之后又继续…',
			});
		});

		it('takes a wider tail when asked, the lead-in held short', () => {
			// The modal clamps its rows to one line: a short window before the
			// match keeps it near the row's start, the tail fills the rest.
			const body = '他们抵达黑塔城之后又继续前行了很远';
			expect(occurrenceContext(body, 4, 7, 2, 6)).toEqual({
				before: '…抵达',
				match: '黑塔城',
				after: '之后又继续前…',
			});
		});

		it('reads around a linked mention as the page shows it', () => {
			// The occurrence bounds the alias; the window before it holds the
			// link's target in the source, and must never hand that back.
			const body = 'She saw [[Demo/20_Character/Alice|Amy]] again today.';
			const from = body.indexOf('Amy');
			expect(occurrenceContext(body, from, from + 3, 10)).toEqual({
				before: 'She saw ',
				match: 'Amy',
				after: ' again…',
			});
		});

		it('shows neighbouring links by their visible text', () => {
			const body =
				'Alice met [[Demo/20_Character/Bob|Bob]] near [[Demo/60_Worldbuilding/62_Location/黑塔城|黑塔城]] once.';
			expect(occurrenceContext(body, 0, 5, 12)).toEqual({
				before: '',
				match: 'Alice',
				after: ' met Bob…',
			});
		});
	});
});
