import { describe, expect, it } from 'vitest';

import {
	applyExplorerOrder,
	deleteFromOrders,
	forgetOrder,
	moveBeside,
	moveByStep,
	moveToIndex,
	orderKeyOf,
	pruneOrders,
	recordOrder,
	renameInOrders,
	sanitizeExplorerOrders,
	type ExplorerOrders,
} from '../../src/domain';

const named = (names: readonly string[]): { name: string }[] =>
	names.map((name) => ({ name }));
const namesOf = (items: readonly { name: string }[]): string[] =>
	items.map((item) => item.name);

describe('the explorer order record', () => {
	it('keys the Vault root as the empty path and every folder by its path', () => {
		expect(orderKeyOf('/')).toBe('');
		expect(orderKeyOf('')).toBe('');
		expect(orderKeyOf('Novel/20_Character')).toBe('Novel/20_Character');
		expect(orderKeyOf('/Novel/')).toBe('Novel');
	});

	it('lists recorded names first, folders and files mixed, then the rest in the order given', () => {
		const items = named(['10_Summary', '30_Synopsis', 'Draft.md', 'Notes.md']);
		const ordered = applyExplorerOrder(['Notes.md', '30_Synopsis'], items, (item) => item.name);
		expect(namesOf(ordered)).toEqual(['Notes.md', '30_Synopsis', '10_Summary', 'Draft.md']);
	});

	it('answers the same list when there is no record, a stale one, or one that changes nothing', () => {
		const items = named(['a', 'b']);
		expect(applyExplorerOrder(undefined, items, (item) => item.name)).toBe(items);
		expect(applyExplorerOrder([], items, (item) => item.name)).toBe(items);
		expect(applyExplorerOrder(['gone'], items, (item) => item.name)).toBe(items);
		expect(applyExplorerOrder(['a', 'gone', 'b'], items, (item) => item.name)).toBe(items);
	});

	it('moves a name beside another, a step at a time, or to a place, and refuses a move that is none', () => {
		const list = ['a', 'b', 'c', 'd'];
		expect(moveBeside(list, 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
		expect(moveBeside(list, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
		expect(moveBeside(list, 'b', 'a', 'after')).toBeNull();
		expect(moveBeside(list, 'a', 'a', 'after')).toBeNull();
		expect(moveBeside(list, 'x', 'a', 'after')).toBeNull();
		expect(moveByStep(list, 'b', -1)).toEqual(['b', 'a', 'c', 'd']);
		expect(moveByStep(list, 'a', -1)).toBeNull();
		expect(moveByStep(list, 'd', 1)).toBeNull();
		expect(moveToIndex(list, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
		expect(moveToIndex(list, 'c', -5)).toEqual(['c', 'a', 'b', 'd']);
		expect(moveToIndex(list, 'c', 2)).toBeNull();
		expect(moveToIndex(list, 'x', 0)).toBeNull();
	});

	it('records a folder whole and forgets it, answering the same object when nothing changes', () => {
		const empty: ExplorerOrders = {};
		const once = recordOrder(empty, 'Novel', ['b', 'a', 'a']);
		expect(once).toEqual({ Novel: ['b', 'a'] });
		expect(recordOrder(once, 'Novel', ['b', 'a'])).toBe(once);
		expect(recordOrder(once, '/', ['x'])).toEqual({ Novel: ['b', 'a'], '': ['x'] });
		expect(recordOrder(once, 'Novel', [])).toEqual({});
		expect(forgetOrder(once, 'Elsewhere')).toBe(once);
		expect(forgetOrder(once, 'Novel')).toEqual({});
	});

	it('replaces a name renamed within its folder and leaves a move to another folder alone', () => {
		const orders: ExplorerOrders = { Novel: ['b', 'a'], 'Novel/Notes': ['n.md'] };
		expect(renameInOrders(orders, 'Novel/a', 'Novel/c')).toEqual({
			Novel: ['b', 'c'],
			'Novel/Notes': ['n.md'],
		});
		expect(renameInOrders(orders, 'Novel/a', 'Elsewhere/a')).toBe(orders);
		expect(renameInOrders(orders, 'Novel/a', 'Novel/b')).toBe(orders);
		expect(renameInOrders(orders, 'Novel/zzz', 'Novel/yyy')).toBe(orders);
	});

	it('carries every list under a renamed folder, whichever event comes first and however often', () => {
		const orders: ExplorerOrders = {
			'': ['Novel', 'Readme.md'],
			Novel: ['30_Synopsis', '10_Summary'],
			'Novel/20_Character': ['Bob.md', 'Alice.md'],
		};
		const archived: ExplorerOrders = {
			'': ['Novel', 'Readme.md'],
			'Snowflake Archive/Novel': ['30_Synopsis', '10_Summary'],
			'Snowflake Archive/Novel/20_Character': ['Bob.md', 'Alice.md'],
		};
		const folderFirst = renameInOrders(
			renameInOrders(orders, 'Novel', 'Snowflake Archive/Novel'),
			'Novel/20_Character/Alice.md',
			'Snowflake Archive/Novel/20_Character/Alice.md',
		);
		const childFirst = renameInOrders(
			renameInOrders(
				orders,
				'Novel/20_Character/Alice.md',
				'Snowflake Archive/Novel/20_Character/Alice.md',
			),
			'Novel',
			'Snowflake Archive/Novel',
		);
		expect(folderFirst).toEqual(archived);
		expect(childFirst).toEqual(archived);
		expect(renameInOrders(folderFirst, 'Novel', 'Snowflake Archive/Novel')).toBe(folderFirst);
		// Restored under a freed name, every list follows again.
		expect(renameInOrders(archived, 'Snowflake Archive/Novel', 'Novel 2')).toEqual({
			'': ['Novel', 'Readme.md'],
			'Novel 2': ['30_Synopsis', '10_Summary'],
			'Novel 2/20_Character': ['Bob.md', 'Alice.md'],
		});
	});

	it('keeps a list already standing where a renamed folder would land', () => {
		const orders: ExplorerOrders = { Old: ['a'], New: ['b'] };
		expect(renameInOrders(orders, 'Old', 'New')).toEqual({ New: ['b'] });
	});

	it('drops a deleted name from its folder and every list beneath a deleted folder', () => {
		const orders: ExplorerOrders = {
			Novel: ['Notes', 'Draft.md'],
			'Novel/Notes': ['a.md'],
			'Novel/Notes/Deep': ['b.md'],
			Other: ['x'],
		};
		expect(deleteFromOrders(orders, 'Novel/Draft.md')).toEqual({
			Novel: ['Notes'],
			'Novel/Notes': ['a.md'],
			'Novel/Notes/Deep': ['b.md'],
			Other: ['x'],
		});
		expect(deleteFromOrders(orders, 'Novel/Notes')).toEqual({
			Novel: ['Draft.md'],
			Other: ['x'],
		});
		expect(deleteFromOrders({ Novel: ['a'] }, 'Novel/a')).toEqual({});
		expect(deleteFromOrders(orders, 'Nowhere/z')).toBe(orders);
	});

	it('prunes folders the vault no longer has and names a folder no longer holds', () => {
		const orders: ExplorerOrders = {
			'': ['Novel', 'Gone.md'],
			Novel: ['a', 'b'],
			Missing: ['c'],
		};
		const vault = {
			folderExists: (key: string) => key === 'Novel',
			childExists: (parent: string, name: string) =>
				parent === '' ? name === 'Novel' : parent === 'Novel' && name === 'a',
		};
		expect(pruneOrders(orders, vault)).toEqual({ '': ['Novel'], Novel: ['a'] });
		const settled: ExplorerOrders = { '': ['Novel'], Novel: ['a'] };
		expect(pruneOrders(settled, vault)).toBe(settled);
	});

	it('takes only what a record can mean from a settings file', () => {
		expect(sanitizeExplorerOrders(undefined)).toEqual({});
		expect(sanitizeExplorerOrders([])).toEqual({});
		expect(
			sanitizeExplorerOrders({
				'/': ['a', 'a', 'b/c', '', 7, '..', 'd'],
				'Novel/': ['x'],
				'Novel': ['y'],
				'bad/../key': ['z'],
				empty: [],
				notAList: 'a',
			}),
		).toEqual({ '': ['a', 'd'], Novel: ['x'] });
	});
});
