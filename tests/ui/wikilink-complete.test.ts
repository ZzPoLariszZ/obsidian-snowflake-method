import { describe, expect, it } from 'vitest';
import {
	collectWikilinkTargets,
	wikilinkOptions,
	wikilinkReplaceRange,
	type WikilinkOption,
	type WikilinkProjectMembers,
	type WikilinkSourceRecord,
} from '../../src/ui/wikilink-complete';
import type { WikilinkTarget } from '../../src/ui/segment-editor-backend';

/** The shape `toWikiLink` writes, close enough for these assertions. */
function fakeLink(path: string, alias: string): string {
	return `[[${path.replace(/\.md$/u, '')}|${alias}]]`;
}

function labelOf(group: string): string {
	return `label:${group}`;
}

function membersWith(overrides: {
	characters?: WikilinkSourceRecord[];
	scenes?: WikilinkSourceRecord[];
	locations?: WikilinkSourceRecord[];
}): WikilinkProjectMembers {
	return {
		groups: ['character', 'scene', 'time-point', 'time-period', 'location'],
		characters: overrides.characters ?? [],
		scenes: overrides.scenes ?? [],
		timeOf: () => [],
		ofKind: (kind) => (kind === 'location' ? (overrides.locations ?? []) : []),
	};
}

const alice: WikilinkSourceRecord = {
	path: 'Demo/20_Character/Alice.md',
	name: 'Alice',
	rank: 1024,
	aliases: ['Ali', '爱丽丝', '  '],
};

describe('collectWikilinkTargets', () => {
	it('emits the name and each alias as entries sharing the canonical path', () => {
		const targets = collectWikilinkTargets(
			membersWith({ characters: [alice] }),
			labelOf,
			fakeLink,
		);
		expect(targets.map((target) => target.label)).toEqual([
			'Alice',
			'Ali',
			'爱丽丝',
		]);
		expect(targets.map((target) => target.entry)).toEqual([
			'name',
			'alias',
			'alias',
		]);
		expect(new Set(targets.map((target) => target.memberPath)).size).toBe(1);
		expect(targets[0]?.insert).toBe('[[Demo/20_Character/Alice|Alice]]');
		expect(targets[1]?.insert).toBe('[[Demo/20_Character/Alice|Ali]]');
		expect(targets[0]?.groupLabel).toBe('label:character');
		expect(targets[0]?.groupRank).toBe(0);
	});

	it('walks the groups in rail order', () => {
		const targets = collectWikilinkTargets(
			membersWith({
				characters: [alice],
				scenes: [
					{ path: 'Demo/40_Scene/One.md', name: 'One', rank: 1024, aliases: [] },
				],
				locations: [
					{ path: 'Demo/60/62/Home.md', name: 'Home', rank: 1024, aliases: [] },
				],
			}),
			labelOf,
			fakeLink,
		);
		expect(targets.map((target) => target.group)).toEqual([
			'character',
			'character',
			'character',
			'scene',
			'location',
		]);
		expect(targets[targets.length - 1]?.groupRank).toBe(4);
	});
});

describe('wikilinkOptions', () => {
	/** The rows alone, for the many assertions that only care about those. */
	const rowsOf = (
		list: readonly WikilinkTarget[],
		query: string,
	): WikilinkOption[] => wikilinkOptions(list, query).options;

	const targets = collectWikilinkTargets(
		membersWith({
			characters: [
				alice,
				{
					path: 'Demo/20_Character/Zhang.md',
					name: '张三',
					rank: 2048,
					aliases: ['Bob'],
				},
			],
			scenes: [
				{
					path: 'Demo/40_Scene/Arrival.md',
					name: 'Alight',
					rank: 1024,
					aliases: [],
				},
			],
		}),
		labelOf,
		fakeLink,
	);

	it('returns the whole roster in group, rank, name-first order when empty', () => {
		const options = rowsOf(targets, '');
		expect(options.map((option) => option.label)).toEqual([
			'Alice',
			'Ali',
			'爱丽丝',
			'张三',
			'Bob',
			'Alight',
		]);
		expect(options.map((option) => option.alias)).toEqual([
			false,
			true,
			true,
			false,
			true,
			false,
		]);
		expect(options[0]?.section).toEqual({ name: 'label:character', rank: 0 });
		expect(options[options.length - 1]?.section).toEqual({
			name: 'label:scene',
			rank: 1,
		});
	});

	it('offers a member whole when only an alias matches, the name on top', () => {
		const options = rowsOf(targets, 'bob');
		expect(options.map((option) => option.label)).toEqual(['张三', 'Bob']);
		expect(options.map((option) => option.alias)).toEqual([false, true]);
		expect(options[1]?.insert).toBe('[[Demo/20_Character/Zhang|Bob]]');
	});

	it('opens on the alias that was typed when the name did not match', () => {
		const offer = wikilinkOptions(targets, 'bob');
		expect(offer.options[offer.preferred]?.label).toBe('Bob');
	});

	it('tells two members who share an alias apart by their names', () => {
		const shared = collectWikilinkTargets(
			membersWith({
				characters: [
					{ path: 'a.md', name: 'Character 001', rank: 1024, aliases: ['001', 'jjb'] },
					{ path: 'b.md', name: 'Character 002', rank: 2048, aliases: ['002', 'jjb'] },
				],
			}),
			labelOf,
			fakeLink,
		);
		const options = rowsOf(shared, 'jj');
		expect(options.map((option) => option.label)).toEqual([
			'Character 001',
			'jjb',
			'001',
			'Character 002',
			'jjb',
			'002',
		]);
		const offer = wikilinkOptions(shared, 'jj');
		expect(offer.preferred).toBe(1);
		expect(offer.options[offer.preferred]?.label).toBe('jjb');
	});

	it('moves the matched aliases to the head, typed-from-the-start first', () => {
		const many = collectWikilinkTargets(
			membersWith({
				characters: [
					{
						path: 'a.md',
						name: 'Robert',
						rank: 1024,
						aliases: ['Bobby', 'Rob', 'Bob', 'The Stag'],
					},
				],
			}),
			labelOf,
			fakeLink,
		);
		expect(rowsOf(many, 'bob').map((option) => option.label)).toEqual([
			'Robert',
			'Bob',
			'Bobby',
			'Rob',
			'The Stag',
		]);
	});

	it('keeps an entity`s entries together, primary first', () => {
		const options = rowsOf(targets, 'ali');
		expect(options.map((option) => option.label)).toEqual([
			'Alice',
			'Ali',
			'爱丽丝',
			'Alight',
		]);
		expect(options.map((option) => option.section.rank)).toEqual([0, 0, 0, 1]);
	});

	it('opens on the name whenever the typed text begins it', () => {
		expect(wikilinkOptions(targets, 'ali').preferred).toBe(0);
		expect(wikilinkOptions(targets, '').preferred).toBe(0);
	});

	it('points at nothing in particular when the list is empty', () => {
		const offer = wikilinkOptions(targets, 'nothing here');
		expect(offer.options).toEqual([]);
		expect(offer.preferred).toBe(0);
	});

	it('opens on an alias typed from its start when the name merely contains it', () => {
		const numbered = collectWikilinkTargets(
			membersWith({
				characters: [
					{
						path: 'a.md',
						name: 'Character 001',
						rank: 1024,
						aliases: ['No. 001', '001'],
					},
				],
			}),
			labelOf,
			fakeLink,
		);
		const typed = wikilinkOptions(numbered, '001');
		expect(typed.options.map((option) => option.label)).toEqual([
			'Character 001',
			'001',
			'No. 001',
		]);
		expect(typed.options[typed.preferred]?.label).toBe('001');
		// Nothing typed from the start: the name keeps the opening row.
		expect(wikilinkOptions(numbered, '01').preferred).toBe(0);
	});

	it('orders entities by rank when their scores tie', () => {
		const tied = collectWikilinkTargets(
			membersWith({
				characters: [
					{ path: 'a.md', name: 'Late', rank: 2048, aliases: [] },
					{ path: 'b.md', name: 'Early', rank: 1024, aliases: [] },
				],
			}),
			labelOf,
			fakeLink,
		);
		expect(rowsOf(tied, '').map((option) => option.label)).toEqual([
			'Early',
			'Late',
		]);
	});
});

describe('wikilinkReplaceRange', () => {
	it('consumes whatever of the auto-paired brackets follows the caret', () => {
		expect(wikilinkReplaceRange(3, 5, ']]rest')).toEqual({ from: 3, to: 7 });
		expect(wikilinkReplaceRange(3, 5, ']rest')).toEqual({ from: 3, to: 6 });
		expect(wikilinkReplaceRange(3, 5, 'rest')).toEqual({ from: 3, to: 5 });
		expect(wikilinkReplaceRange(3, 5, ']]]')).toEqual({ from: 3, to: 7 });
		expect(wikilinkReplaceRange(3, 5, '')).toEqual({ from: 3, to: 5 });
	});
});
