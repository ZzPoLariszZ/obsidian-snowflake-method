// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { t as translate } from '../../src/i18n';
import {
	RECORDING_COUNTDOWN_CLASS,
	RECORDING_COUNT_CLEAR_MS,
	RECORDING_COUNT_FROM,
	RECORDING_COUNT_STEP_MS,
	countRecordingIn,
} from '../../src/ui/recording-countdown';
import { FakeClock } from '../helpers/fake-clock';
import { installObsidianDom } from '../helpers/obsidian-dom';

describe('the count before a recording begins', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	function rig(locale: 'en' | 'zh-CN' = 'en') {
		const clock = new FakeClock();
		const keys = { taken: 0, released: 0, press: (): void => {} };
		const answers: boolean[] = [];
		const count = countRecordingIn({
			host: document.body,
			t: (key, vars) => translate(locale, key, vars),
			timers: clock.timers,
			onEscape: (handler) => {
				keys.taken += 1;
				keys.press = handler;
				return () => {
					keys.released += 1;
				};
			},
		});
		void count.done.then((ran) => answers.push(ran));
		const face = (): HTMLElement | null => document.body.querySelector<HTMLElement>(`.${RECORDING_COUNTDOWN_CLASS}`);
		const figure = (): string | null => face()?.querySelector(`.${RECORDING_COUNTDOWN_CLASS}-number`)?.textContent ?? null;
		return { clock, keys, answers, count, face, figure };
	}

	it('counts three, two, one in the window, a second each, and says how to give it up', async () => {
		const { clock, keys, answers, face, figure } = rig();
		expect(RECORDING_COUNT_FROM).toBe(3);
		expect(figure()).toBe('3');
		expect(face()?.querySelector(`.${RECORDING_COUNTDOWN_CLASS}-hint`)?.textContent).toBe('Press Esc to cancel');
		// Read aloud as it changes, and Escape is its own while it runs.
		expect([face()?.getAttribute('role'), face()?.getAttribute('aria-live')]).toEqual(['status', 'assertive']);
		expect([keys.taken, keys.released]).toEqual([1, 0]);
		await clock.advance(RECORDING_COUNT_STEP_MS - 1);
		expect(figure()).toBe('3');
		await clock.advance(1);
		expect(figure()).toBe('2');
		await clock.advance(RECORDING_COUNT_STEP_MS);
		expect(figure()).toBe('1');
		expect(answers).toEqual([]);
		await clock.advance(RECORDING_COUNT_STEP_MS);
		// Run out: the count is gone from the window and Escape is the app's again.
		expect(face()).toBeNull();
		expect([keys.taken, keys.released]).toEqual([1, 1]);
	});

	it('answers only once the window has had a moment to draw itself without the count', async () => {
		const { clock, answers, face } = rig();
		await clock.advance(RECORDING_COUNT_FROM * RECORDING_COUNT_STEP_MS);
		expect(face()).toBeNull();
		// Not yet: a recording begun now could take the count into its first picture.
		expect(answers).toEqual([]);
		await clock.advance(RECORDING_COUNT_CLEAR_MS);
		expect(answers).toEqual([true]);
		expect(clock.waiting).toBe(0);
	});

	it('is given up with Escape at any figure, at once', async () => {
		const { clock, keys, answers, face } = rig();
		await clock.advance(RECORDING_COUNT_STEP_MS + 400);
		keys.press();
		await clock.settle();
		expect(answers).toEqual([false]);
		expect(face()).toBeNull();
		expect(keys.released).toBe(1);
		// Nothing is left turning, and nothing more is answered.
		expect(clock.waiting).toBe(0);
		await clock.advance(10_000);
		expect(answers).toEqual([false]);
	});

	it('ends at once when the start is given up elsewhere, and hears nothing after it has ended', async () => {
		const { clock, keys, answers, count, face } = rig();
		await clock.advance(300);
		count.cancel();
		await clock.settle();
		expect(answers).toEqual([false]);
		expect(face()).toBeNull();
		// A second word, or a late Escape, changes nothing.
		count.cancel();
		keys.press();
		await clock.advance(10_000);
		expect(answers).toEqual([false]);
		expect(keys.released).toBe(1);

		const ran = rig();
		await ran.clock.advance(RECORDING_COUNT_FROM * RECORDING_COUNT_STEP_MS + RECORDING_COUNT_CLEAR_MS);
		ran.keys.press();
		ran.count.cancel();
		await ran.clock.settle();
		expect(ran.answers).toEqual([true]);
	});

	it('takes no click from the page under it, and speaks the language it is given', () => {
		const { face } = rig('zh-CN');
		expect(face()?.querySelector(`.${RECORDING_COUNTDOWN_CLASS}-hint`)?.textContent).toBe('按 Esc 取消');
		expect(face()?.querySelector('button, input, a')).toBeNull();
	});
});
