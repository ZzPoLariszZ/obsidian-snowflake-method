import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
	analyzeMentions,
	buildEntityMatcher,
	milestonePositions,
	planMentionMarks,
	planMilestoneMarks,
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

	/**
	 * A mark of no width is a position rather than a stretch of text, and a
	 * mark decoration may not be empty -- CodeMirror refuses one. It becomes a
	 * widget standing in the position, which is how an insertion bar is drawn
	 * where a caret was rather than on some character beside it.
	 */
	it('turns a mark of no width into a widget in that position', () => {
		const body = 'Alice left.';
		const pointMark: MentionMark = {
			from: 6,
			to: 6,
			classes: 'snowflake-method-revision is-insertion is-point',
			occurrence: {
				type: 'revision',
				path: 'note.md',
				from: 6,
				to: 6,
				matchedText: '',
				revisionId: 'rev-1',
			},
		};
		const set = mentionDecorations([...marksOf(body), pointMark]);
		const found: { from: number; to: number; widget: unknown; mark: unknown }[] =
			[];
		set.between(0, body.length, (from, to, value) => {
			const spec = value.spec as {
				widget?: { toDOM?: unknown };
				mentionMark?: unknown;
			};
			if (spec.widget === undefined) return;
			found.push({ from, to, widget: spec.widget, mark: spec.mentionMark });
		});
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ from: 6, to: 6 });
		// No mark in the spec: nothing is under it, and a zero-length span
		// would otherwise win every hit test at its own offset.
		expect(found[0]?.mark).toBeUndefined();
		const widget = found[0]?.widget as {
			toDOM(view: unknown): { tagName: string; className: string };
			eq(other: unknown): boolean;
		};
		// Built by the view's OWN window, so a stream in a popout window gets
		// an element that window can hold. There is no DOM in this runtime,
		// so the window stands in for one and reports what it was asked to
		// build.
		let asked: { cls?: string } | null = null;
		const created = widget.toDOM({
			dom: {
				win: {
					createSpan: (options: { cls?: string }) => {
						asked = options;
						return { tagName: 'SPAN', className: options.cls ?? '' };
					},
				},
			},
		});
		expect(asked).toEqual({
			cls: 'snowflake-method-revision is-insertion is-point',
		});
		expect(created.className).toBe(
			'snowflake-method-revision is-insertion is-point',
		);
		// Two points of the same kind compare equal, so a redraw that changes
		// nothing replaces no DOM.
		const twin = mentionDecorations([pointMark]);
		let other: unknown = null;
		twin.between(6, 6, (from, to, value) => {
			other = (value.spec as { widget?: unknown }).widget;
		});
		expect(widget.eq(other)).toBe(true);
	});
});

describe('marks that answer no menu', () => {
	it('a silent mark is drawn without a mentionMark, so the hit test passes over it', () => {
		const quiet: MentionMark = {
			from: 0,
			to: 5,
			classes: 'snowflake-method-revision is-replace',
			silent: true,
			occurrence: {
				type: 'entity',
				path: '50/one.md',
				from: 0,
				to: 5,
				matchedText: 'Alice',
				resolution: 'unique',
				resolvedMemberPath: null,
				candidates: [],
			},
		};
		const loud: MentionMark = { ...quiet, silent: undefined, from: 6, to: 10 };
		const set = mentionDecorations([quiet, loud]);
		const carried: boolean[] = [];
		set.between(0, 10, (_from, _to, value) => {
			carried.push((value.spec as { mentionMark?: unknown }).mentionMark !== undefined);
		});
		expect(carried).toEqual([false, true]);
	});
});

describe('milestone labels in the editor', () => {
	it('carries a mark label as a data attribute, and answers no menu', () => {
		const body = 'one two three four';
		const marks = planMilestoneMarks(
			'note.md',
			body,
			milestonePositions(body, [], { mode: 'ms-word', headings: 'count' }, 2),
			(count) => `${count} words`,
		);
		const set = mentionDecorations(marks);
		const attributes: unknown[] = [];
		const menus: boolean[] = [];
		set.between(0, body.length, (from, to, value) => {
			const spec = value.spec as { attributes?: unknown; mentionMark?: unknown };
			attributes.push(spec.attributes);
			menus.push(spec.mentionMark !== undefined);
		});
		expect(attributes).toEqual([
			{ 'data-snowflake-method-label': '2 words' },
			{ 'data-snowflake-method-label': '4 words' },
		]);
		expect(menus).toEqual([false, false]);
	});
});
