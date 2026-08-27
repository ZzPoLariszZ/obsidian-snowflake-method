import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
	analyzeMentions,
	buildEntityMatcher,
	planMentionMarks,
	type MentionMark,
	type MentionSource,
} from '../../src/domain';
import { mentionDecorations } from '../../src/editor';

const alice: MentionSource = {
	label: 'Alice',
	entry: 'name',
	memberPath: 'Demo/20_Character/Alice.md',
	memberName: 'Alice',
	group: 'character',
	groupRank: 0,
	rank: 0,
	insert: '[[Demo/20_Character/Alice|Alice]]',
};

const marksOf = (body: string): MentionMark[] =>
	planMentionMarks(
		analyzeMentions('note.md', body, [], buildEntityMatcher([alice]), []),
		[],
		'all',
	);

const ranges = (
	set: ReturnType<typeof mentionDecorations>,
	length: number,
): { from: number; to: number; classes: string }[] => {
	const found: { from: number; to: number; classes: string }[] = [];
	set.between(0, length, (from, to, value) => {
		found.push({
			from,
			to,
			classes: (value.spec as { class: string }).class,
		});
	});
	return found;
};

describe('mention highlight decorations', () => {
	it('carries each mark and its occurrence into the set', () => {
		const body = 'Alice met nobody. Alice left.';
		const set = mentionDecorations(marksOf(body));
		const found = ranges(set, body.length);
		expect(found.map((entry) => body.slice(entry.from, entry.to))).toEqual([
			'Alice',
			'Alice',
		]);
		expect(found[0]?.classes).toBe(
			'snowflake-method-mention is-unlinked is-first',
		);
		let occurrence: unknown = null;
		set.between(0, 5, (from, to, value) => {
			occurrence = (value.spec as { mentionMark: MentionMark }).mentionMark
				.occurrence;
		});
		expect(occurrence).toMatchObject({ matchedText: 'Alice', from: 0 });
	});

	it('tracks its ranges through a change the way typing maps them', () => {
		const body = 'so Alice ran';
		const set = mentionDecorations(marksOf(body));
		// Words typed before the mention slide it whole; the classes ride along.
		const shifted = set.map(
			ChangeSet.of([{ from: 0, insert: 'and ' }], body.length),
		);
		expect(ranges(shifted, body.length + 4)).toMatchObject([
			{ from: 7, to: 12 },
		]);
		// A deletion swallowing the mention takes the decoration with it.
		const swallowed = set.map(
			ChangeSet.of([{ from: 2, to: 9 }], body.length),
		);
		expect(ranges(swallowed, body.length)).toEqual([]);
	});
});

describe('dress-only decorations', () => {
	it('carries a mark title and inline custom property as attributes', () => {
		const mark: MentionMark = {
			from: 4,
			to: 7,
			classes: 'snowflake-method-highlight is-deco-wavy',
			title: 'Weather words',
			styleVar: '--snowflake-method-highlight-color: #aabbcc',
			occurrence: {
				type: 'highlight',
				path: 'note.md',
				from: 4,
				to: 7,
				matchedText: 'fog',
				ruleId: 'rule-one',
			},
		};
		const set = mentionDecorations([mark]);
		let attributes: unknown = null;
		set.between(0, 10, (from, to, value) => {
			attributes = (value.spec as { attributes?: unknown }).attributes;
		});
		expect(attributes).toEqual({
			title: 'Weather words',
			style: '--snowflake-method-highlight-color: #aabbcc',
		});
	});

	it('adds no attributes where a mark carries none', () => {
		const set = mentionDecorations(marksOf('Alice left.'));
		let attributes: unknown = 'unread';
		set.between(0, 5, (from, to, value) => {
			attributes = (value.spec as { attributes?: unknown }).attributes;
		});
		expect(attributes).toBeUndefined();
	});
});
