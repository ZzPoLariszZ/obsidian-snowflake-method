import { describe, expect, it } from 'vitest';
import { inColumnMove } from '../../src/ui/task-board';

describe('inColumnMove', () => {
	const order = ['a', 'b', 'c', 'd'];

	it('names the card a move up lands before, and nothing at the top', () => {
		expect(inColumnMove(order, 'b', 'up')).toBe('a');
		expect(inColumnMove(order, 'd', 'up')).toBe('c');
		expect(inColumnMove(order, 'a', 'up')).toBeUndefined();
	});

	it('names the card a move down lands before, the foot as null, and nothing at the bottom', () => {
		expect(inColumnMove(order, 'a', 'down')).toBe('c');
		expect(inColumnMove(order, 'c', 'down')).toBeNull();
		expect(inColumnMove(order, 'd', 'down')).toBeUndefined();
	});

	it('has nowhere to go for a card not in the column', () => {
		expect(inColumnMove(order, 'x', 'up')).toBeUndefined();
		expect(inColumnMove([], 'a', 'down')).toBeUndefined();
	});
});
