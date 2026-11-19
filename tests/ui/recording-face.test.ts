// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { IDLE_RECORDING_STATE, type RecordingState } from '../../src/domain';
import { t as translate } from '../../src/i18n';
import {
	RECORDING_FACE_CLASS,
	mountRecordingFace,
	placeRibbonButtonUnder,
	recordingRibbonFace,
} from '../../src/ui/recording-face';
import { installObsidianDom } from '../helpers/obsidian-dom';

describe('the recording’s mark in the status bar', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		vi.useRealTimers();
		document.body.replaceChildren();
	});

	function mount() {
		const listeners = new Set<() => void>();
		const held: { state: RecordingState; opened: number } = { state: { ...IDLE_RECORDING_STATE }, opened: 0 };
		const item = document.body.createDiv();
		const release = mountRecordingFace(item, {
			t: (key, vars) => translate('en', key, vars),
			state: () => held.state,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			openMenu: () => {
				held.opened += 1;
			},
		});
		const tell = (): void => {
			for (const listener of [...listeners]) listener();
		};
		return { item, held, tell, release, listeners };
	}

	it('is out of sight while nothing records', () => {
		const { item } = mount();
		expect(item.classList.contains(RECORDING_FACE_CLASS)).toBe(true);
		expect(item.hidden).toBe(true);
	});

	it('shows the dot and the running clock while a recording runs', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 19, 15, 0, 0));
		const { item, held, tell } = mount();
		held.state = { ...held.state, phase: 'recording', tool: 'native', startedAt: Date.now() - 3_725_000 };
		tell();
		expect(item.hidden).toBe(false);
		expect(item.classList.contains('is-recording')).toBe(true);
		expect(item.querySelector('.snowflake-method-recording-dot')).not.toBeNull();
		expect(item.textContent).toBe('01:02:05');
		vi.advanceTimersByTime(1000);
		expect(item.textContent).toBe('01:02:06');
	});

	it('says what is happening while a recording is being started or brought to its end', () => {
		const { item, held, tell } = mount();
		held.state = { ...held.state, phase: 'opening', tool: 'obs' };
		tell();
		expect([item.hidden, item.textContent, item.classList.contains('is-recording')]).toEqual([
			false, 'Opening OBS Studio…', false,
		]);
		held.state = { ...held.state, phase: 'stopping' };
		tell();
		expect(item.textContent).toBe('Stopping…');
	});

	it('goes out of sight again when the recording ends, and stops its clock', () => {
		vi.useFakeTimers();
		const { item, held, tell } = mount();
		held.state = { ...held.state, phase: 'recording', tool: 'native', startedAt: Date.now() };
		tell();
		expect(vi.getTimerCount()).toBe(1);
		held.state = { ...IDLE_RECORDING_STATE };
		tell();
		expect(item.hidden).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('opens its menu on a press, until it is let go', () => {
		vi.useFakeTimers();
		const { item, held, tell, release, listeners } = mount();
		held.state = { ...held.state, phase: 'recording', tool: 'native', startedAt: Date.now() };
		tell();
		item.click();
		expect(held.opened).toBe(1);
		release();
		item.click();
		expect(held.opened).toBe(1);
		expect(listeners.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		// Let go twice is let go once.
		release();
	});
});

describe('the recording’s button in the ribbon', () => {
	it('offers the start while nothing records', () => {
		expect(recordingRibbonFace('idle')).toEqual({
			icon: 'video',
			key: 'commands.startScreenRecording',
			recording: false,
			busy: false,
		});
	});

	it('offers the stop from the first moment of a start, and wears the recording only once it runs', () => {
		// A start still under way can be given up, so a press already means stop.
		for (const phase of ['opening', 'starting'] as const) {
			expect(recordingRibbonFace(phase), phase).toEqual({
				icon: 'circle-stop',
				key: 'commands.stopScreenRecording',
				recording: false,
				busy: true,
			});
		}
		expect(recordingRibbonFace('recording')).toEqual({
			icon: 'circle-stop',
			key: 'commands.stopScreenRecording',
			recording: true,
			busy: false,
		});
		expect(recordingRibbonFace('stopping')).toMatchObject({ recording: false, busy: true });
	});

	it('says what a press will do in words the tables have, in every state', () => {
		for (const phase of ['idle', 'opening', 'starting', 'recording', 'stopping'] as const) {
			const key = recordingRibbonFace(phase).key;
			expect(translate('en', key), phase).not.toBe(key);
		}
		expect(translate('en', recordingRibbonFace('idle').key)).toBe('Start screen recording');
		expect(translate('en', recordingRibbonFace('recording').key)).toBe('Stop screen recording');
	});
});

describe('the place of the recording’s button in the ribbon', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	/** A ribbon as the app keeps one: its buttons in order, some of them of plugins now off, and a call that draws and saves. */
	function ribbonOf(names: string[]) {
		const buttons = new Map<string, HTMLElement>(names.map((name) => [name, document.body.createDiv()]));
		const saved: boolean[] = [];
		const ribbon = {
			items: names.map((name) => ({ id: name, buttonEl: buttons.get(name) })),
			onChange(save: boolean) {
				saved.push(save);
			},
		};
		const button = (name: string): HTMLElement => buttons.get(name) as HTMLElement;
		return { ribbon, button, saved, order: () => ribbon.items.map((item) => item.id) };
	}

	it('moves the button from the top, where a saved order sets a new one, to right under the sticky note’s', () => {
		const { ribbon, button, saved, order } = ribbonOf(['record', 'switcher', 'graph', 'dashboard', 'sticky']);
		expect(placeRibbonButtonUnder(ribbon, button('record'), button('sticky'))).toBe(true);
		expect(order()).toEqual(['switcher', 'graph', 'dashboard', 'sticky', 'record']);
		// Drawn once, and kept with the layout.
		expect(saved).toEqual([true]);
	});

	it('moves it up as well as down, wherever the sticky note’s button was dragged', () => {
		const { ribbon, button, order } = ribbonOf(['switcher', 'sticky', 'graph', 'record']);
		expect(placeRibbonButtonUnder(ribbon, button('record'), button('sticky'))).toBe(true);
		expect(order()).toEqual(['switcher', 'sticky', 'record', 'graph']);
	});

	it('leaves a button already in its place alone, and saves nothing', () => {
		const { ribbon, button, saved, order } = ribbonOf(['dashboard', 'sticky', 'record']);
		expect(placeRibbonButtonUnder(ribbon, button('record'), button('sticky'))).toBe(true);
		expect(order()).toEqual(['dashboard', 'sticky', 'record']);
		expect(saved).toEqual([]);
	});

	it('moves nothing where a button is not the ribbon’s, or the ribbon is not what it knows', () => {
		const { ribbon, button, saved, order } = ribbonOf(['record', 'sticky']);
		const stranger = document.body.createDiv();
		expect(placeRibbonButtonUnder(ribbon, stranger, button('sticky'))).toBe(false);
		expect(placeRibbonButtonUnder(ribbon, button('record'), stranger)).toBe(false);
		expect(placeRibbonButtonUnder(ribbon, button('record'), button('record'))).toBe(false);
		expect([order(), saved]).toEqual([['record', 'sticky'], []]);
		// The list is the app's own and may change shape: then nothing is touched.
		const odd: unknown[] = [null, undefined, 'ribbon', {}, { items: [] }, { items: 'none', onChange: () => {} }, { items: [null], onChange: () => {} }];
		for (const [at, shape] of odd.entries()) {
			expect(placeRibbonButtonUnder(shape, button('record'), button('sticky')), `shape ${at}`).toBe(false);
		}
	});
});
