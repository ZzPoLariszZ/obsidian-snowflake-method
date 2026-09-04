import { describe, expect, it } from 'vitest';

import { captureOccurrence, type Foreshadowing } from '../../src/domain';
import { foreshadowingCardPrint } from '../../src/ui/foreshadowing-cards';

const BODY = 'The grey heron stood in the shallows, watching the water.';

const occurrence = captureOccurrence('50/one.md', BODY, 4, 14, 'plant', 'why', 'occ-1');
const item: Foreshadowing = {
	id: 'fs-1',
	name: 'The missing key',
	description: 'A key disappears.',
	status: 'active',
	related: [],
	createdAt: 1,
	updatedAt: 1,
	occurrences: [occurrence],
};

describe('what a foreshadowing card is drawn from', () => {
	it('is the same print while only its offsets moved', () => {
		expect(foreshadowingCardPrint(item, occurrence, false, [true, false], false)).toBe(
			foreshadowingCardPrint(
				item,
				{ ...occurrence, from: 40, to: 50 },
				false,
				[true, false],
				false,
			),
		);
	});

	it('changes with the role, the note, the words, the thread, the answers offered and the arrows', () => {
		const print = foreshadowingCardPrint(item, occurrence, false, [true, false], false);
		const other = (
			nextItem: Foreshadowing = item,
			nextOccurrence = occurrence,
			readOnly = false,
			neighbours: [boolean, boolean] = [true, false],
			unresolved = false,
		): string =>
			foreshadowingCardPrint(nextItem, nextOccurrence, readOnly, neighbours, unresolved);
		expect(other(item, { ...occurrence, role: 'payoff' })).not.toBe(print);
		expect(other(item, { ...occurrence, note: '' })).not.toBe(print);
		expect(other(item, { ...occurrence, originalText: 'the heron' })).not.toBe(print);
		expect(other({ ...item, name: 'The key' })).not.toBe(print);
		expect(other({ ...item, description: '' })).not.toBe(print);
		expect(other({ ...item, status: 'resolved' })).not.toBe(print);
		expect(other(item, occurrence, true)).not.toBe(print);
		expect(other(item, occurrence, false, [true, true])).not.toBe(print);
		expect(other(item, occurrence, false, [true, false], true)).not.toBe(print);
	});

	it('tells two occurrences of one thread apart', () => {
		const second = captureOccurrence('50/one.md', BODY, 30, 38, 'plant', 'why', 'occ-2');
		expect(foreshadowingCardPrint(item, occurrence, false, [false, false], false)).not.toBe(
			foreshadowingCardPrint(item, second, false, [false, false], false),
		);
	});
});
