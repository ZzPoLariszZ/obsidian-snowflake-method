import { describe, expect, it } from 'vitest';

import { stackCards } from '../../src/ui/revision-cards';

describe('stacking the rail', () => {
	it('gives each card its asked-for top until one would overlap', () => {
		const placed = stackCards(
			[
				{ key: 'a', top: 10, height: 40 },
				{ key: 'b', top: 200, height: 40 },
				{ key: 'c', top: 210, height: 40 },
			],
			8,
		);
		expect(placed.get('a')).toBe(10);
		expect(placed.get('b')).toBe(200);
		// c asked for 210 but b reaches 240, so c lands at 248.
		expect(placed.get('c')).toBe(248);
	});

	it('a card with no anchor follows the one before it', () => {
		const placed = stackCards(
			[
				{ key: 'conflict', top: null, height: 30 },
				{ key: 'a', top: 5, height: 40 },
			],
			8,
		);
		expect(placed.get('conflict')).toBe(0);
		// a asked for 5 but the conflict card reaches 38.
		expect(placed.get('a')).toBe(38);
	});

	it('an empty rail places nothing', () => {
		expect(stackCards([]).size).toBe(0);
	});
});
