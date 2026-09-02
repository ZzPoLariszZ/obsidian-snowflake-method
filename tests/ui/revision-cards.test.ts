import { describe, expect, it } from 'vitest';

import { captureRevision } from '../../src/domain';
import { cardPrint, draftKeyOf, stackCards } from '../../src/ui/revision-cards';

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

const BODY = 'The grey heron stood in the shallows, watching the water.';

describe('telling one draft from another', () => {
	it('the same offsets over other words are another proposal', () => {
		// The note was rewritten under the open form: a form kept on the
		// offsets alone would show the earlier words as the original while
		// the record saved from it names the later ones.
		const draft = {
			path: '50/one.md',
			kind: 'replace' as const,
			from: 4,
			to: 9,
			originalText: 'alpha',
			before: '',
			after: '',
			top: null,
		};
		expect(draftKeyOf(draft)).toBe(draftKeyOf({ ...draft, top: 12 }));
		expect(draftKeyOf(draft)).not.toBe(
			draftKeyOf({ ...draft, originalText: 'bravo' }),
		);
		expect(draftKeyOf(draft)).not.toBe(draftKeyOf({ ...draft, to: 10 }));
	});
});

describe('what a card is drawn from', () => {
	const revision = captureRevision('50/one.md', BODY, 'replace', 4, 14, 'x', 'why', 'rev-1', 7);

	it('is the same print while nothing it shows has changed', () => {
		expect(cardPrint(revision, false, [true, false])).toBe(
			cardPrint({ ...revision, from: 40, to: 50 }, false, [true, false]),
		);
	});

	it('changes with the words, the answers offered, and the arrows', () => {
		const print = cardPrint(revision, false, [true, false]);
		expect(cardPrint({ ...revision, proposed: 'y' }, false, [true, false])).not.toBe(print);
		expect(cardPrint({ ...revision, comment: '' }, false, [true, false])).not.toBe(print);
		expect(cardPrint(revision, true, [true, false])).not.toBe(print);
		expect(cardPrint(revision, false, [true, true])).not.toBe(print);
	});
});
