import { describe, expect, it } from 'vitest';

import {
	MACARON_COLORS,
	STICKY_NOTE_COLORS,
	isMacaronColor,
	isStickyNoteColor,
} from '../../src/domain';

describe('the macaron palette', () => {
	it('lists the eight macarons in order', () => {
		expect([...MACARON_COLORS]).toEqual([
			'macaron-1',
			'macaron-2',
			'macaron-3',
			'macaron-4',
			'macaron-5',
			'macaron-6',
			'macaron-7',
			'macaron-8',
		]);
	});

	it('recognises a macaron name and nothing else', () => {
		expect(isMacaronColor('macaron-1')).toBe(true);
		expect(isMacaronColor('macaron-8')).toBe(true);
		expect(isMacaronColor('macaron-9')).toBe(false);
		expect(isMacaronColor('Macaron-1')).toBe(false);
		expect(isMacaronColor('')).toBe(false);
		expect(isMacaronColor(null)).toBe(false);
		expect(isMacaronColor(3)).toBe(false);
	});

	it('keeps the sticky-note vocabulary the same list', () => {
		expect(STICKY_NOTE_COLORS).toBe(MACARON_COLORS);
		expect(isStickyNoteColor).toBe(isMacaronColor);
	});
});
