import { describe, expect, it } from 'vitest';

import {
	analyzeMentions,
	buildEntityMatcher,
	planMentionMarks,
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
