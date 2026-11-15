import { describe, expect, it } from 'vitest';

import { createLookTrial } from '../../src/ui/look-trial';
import type { CorkboardLook } from '../../src/ui/story-structure-state';

const kept = (): CorkboardLook => ({ mode: 'standard', cardWidth: 0, cardHeight: 320, textSize: 0 });

describe('a look tried over the one kept', () => {
	it('shows the look kept while nothing is tried', () => {
		const held = kept();
		const trial = createLookTrial(held);
		expect(trial.trying()).toBe(false);
		expect(trial.shown()).toEqual(held);
	});

	it('shows each draft over the part it is of, and keeps none of it', () => {
		const held = kept();
		const trial = createLookTrial(held);
		trial.draft({ mode: 'compact' });
		trial.draft({ cardWidth: 400, textSize: 18 });
		expect(trial.trying()).toBe(true);
		expect(trial.shown()).toEqual({ mode: 'compact', cardWidth: 400, cardHeight: 320, textSize: 18 });
		expect(held).toEqual(kept());
	});

	it('takes a size of nothing for a draft: the surface\'s own measure tried over a set one', () => {
		const trial = createLookTrial(kept());
		trial.draft({ cardHeight: 0 });
		expect(trial.trying()).toBe(true);
		expect(trial.shown().cardHeight).toBe(0);
	});

	it('takes a draft that says what is kept for no draft, and lets go of what was tried of that part', () => {
		const trial = createLookTrial(kept());
		trial.draft({ mode: 'gallery', cardWidth: 480 });
		trial.draft({ mode: 'standard' });
		expect(trial.shown()).toEqual({ mode: 'standard', cardWidth: 480, cardHeight: 320, textSize: 0 });
		expect(trial.trying()).toBe(true);
		trial.draft({ cardWidth: 0 });
		expect(trial.trying()).toBe(false);
	});

	it('lets every draft go at once, and reads what a confirmation wrote into the look kept', () => {
		const held = kept();
		const trial = createLookTrial(held);
		trial.draft({ mode: 'extended', cardWidth: 400 });
		// Confirmed: the rows write the look kept, and the trial is over.
		held.mode = 'extended';
		held.cardWidth = 400;
		trial.end();
		expect(trial.trying()).toBe(false);
		expect(trial.shown()).toEqual({ mode: 'extended', cardWidth: 400, cardHeight: 320, textSize: 0 });
		// What was confirmed is the look kept now: handed again, it is no draft.
		trial.draft({ cardWidth: 400 });
		expect(trial.trying()).toBe(false);
	});
});
