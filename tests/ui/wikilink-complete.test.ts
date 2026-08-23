import { describe, expect, it } from 'vitest';
import {
	collectWikilinkTargets,
	wikilinkOptions,
	wikilinkReplaceRange,
	type WikilinkProjectMembers,
	type WikilinkSourceRecord,
} from '../../src/ui/wikilink-complete';

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
		const options = wikilinkOptions(targets, '');
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
		const options = wikilinkOptions(targets, 'bob');
		expect(options.map((option) => option.label)).toEqual(['张三', 'Bob']);
		expect(options.map((option) => option.alias)).toEqual([false, true]);
		expect(options[1]?.insert).toBe('[[Demo/20_Character/Zhang|Bob]]');
	});

	it('opens on the alias that was typed when the name did not match', () => {
		const options = wikilinkOptions(targets, 'bob');
		expect(options.map((option) => option.preferred)).toEqual([false, true]);
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
		const options = wikilinkOptions(shared, 'jj');
		expect(options.map((option) => option.label)).toEqual([
			'Character 001',
			'jjb',
			'001',
			'Character 002',
			'jjb',
			'002',
		]);
		expect(options.map((option) => option.preferred)).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
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
		expect(wikilinkOptions(many, 'bob').map((option) => option.label)).toEqual([
			'Robert',
			'Bob',
			'Bobby',
			'Rob',
			'The Stag',
		]);
	});

	it('keeps an entity`s entries together, primary first', () => {
		const options = wikilinkOptions(targets, 'ali');
		expect(options.map((option) => option.label)).toEqual([
			'Alice',
			'Ali',
			'爱丽丝',
			'Alight',
		]);
		expect(options.map((option) => option.section.rank)).toEqual([0, 0, 0, 1]);
	});

	it('opens on the name whenever the typed text begins it', () => {
		expect(
			wikilinkOptions(targets, 'ali').map((option) => option.preferred),
		).toEqual([true, false, false, false]);
		expect(
			wikilinkOptions(targets, '').map((option) => option.preferred),
		).toEqual([true, false, false, false, false, false]);
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
		expect(
			wikilinkOptions(numbered, '001').map((option) => [
				option.label,
				option.preferred,
			]),
		).toEqual([
			['Character 001', false],
			['001', true],
			['No. 001', false],
		]);
		// Nothing typed from the start: the name keeps the opening row.
		expect(
			wikilinkOptions(numbered, '01').map((option) => [
				option.label,
				option.preferred,
			]),
		).toEqual([
			['Character 001', true],
			['001', false],
			['No. 001', false],
		]);
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
		expect(wikilinkOptions(tied, '').map((option) => option.label)).toEqual([
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
