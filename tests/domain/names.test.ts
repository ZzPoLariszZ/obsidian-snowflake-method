import { describe, expect, it } from 'vitest';

import { foldName, isNameTaken } from '../../src/domain/names';

describe('folding a name for comparison', () => {
	it('ignores surrounding space and casing', () => {
		expect(foldName('  Ada Lovelace ')).toBe('ada lovelace');
	});

	it('collapses a run of whitespace, as the file name would', () => {
		expect(foldName('Ada  \t Lovelace')).toBe('ada lovelace');
	});

	it('composes accents, so how they were typed makes no difference', () => {
		const combining = 'Zo\u0065\u0308'; // e, then a combining diaeresis
		const precomposed = 'Zo\u00EB'; // the single letter e-diaeresis
		expect(combining).not.toBe(precomposed);
		expect(foldName(combining)).toBe(foldName(precomposed));
	});

	it('keeps names that genuinely differ apart', () => {
		expect(foldName('Ada')).not.toBe(foldName('Adam'));
	});
});

describe('whether a name is already taken', () => {
	const taken = ['Ada Lovelace', 'Grace Hopper'];

	it('recognises the same name typed exactly', () => {
		expect(isNameTaken(taken, 'Grace Hopper')).toBe(true);
	});

	it('recognises it whatever the casing or spacing', () => {
		expect(isNameTaken(taken, '  ada   LOVELACE ')).toBe(true);
	});

	it('leaves a name nobody has', () => {
		expect(isNameTaken(taken, 'Alan Turing')).toBe(false);
	});

	it('does not treat a name containing another as taken', () => {
		expect(isNameTaken(taken, 'Ada')).toBe(false);
		expect(isNameTaken(['Ada'], 'Ada Lovelace')).toBe(false);
	});

	// The required check has something more useful to say about an empty field,
	// so this one stands aside for it -- including when a stray blank name is on
	// the list, which is not a name anyone is claiming.
	it('never calls an empty name taken', () => {
		expect(isNameTaken(taken, '')).toBe(false);
		expect(isNameTaken([''], '   ')).toBe(false);
	});

	it('finds nothing taken in an empty project', () => {
		expect(isNameTaken([], 'Ada Lovelace')).toBe(false);
	});
});
