import { Setting } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { addStopSlider } from '../../src/ui/presentation-controls';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

/** The fake's controls, as a test moves them. */
interface Moved {
	disabled: boolean;
	getValue(): unknown;
	change(value: number): void;
	click(): void;
}

function rail(value: number, rest?: () => number) {
	const dom = new CorkboardDom();
	const host = dom.container.createDiv();
	const name = dom.container.createDiv();
	const onPick = vi.fn();
	const setting = new Setting(host as unknown as HTMLElement);
	const handle = addStopSlider(setting, {
		stops: [208, 256, 320],
		value,
		resetValue: 0,
		resetLabel: 'Reset to default',
		label: 'Card width',
		valueHost: name as unknown as HTMLElement,
		format: (stop) => (stop === 0 ? 'Automatic' : `${String(stop)} px`),
		onPick,
		...(rest === undefined ? {} : { rest }),
	});
	// The button that puts the measure back is added before the rail, which it stands on the left of.
	const [reset, slider] = setting.components as unknown as Moved[];
	if (reset === undefined || slider === undefined) throw new Error('the row has no rail');
	const words = (): string | null => {
		const written: CorkboardElement | null = name.querySelector('.snowflake-method-answer');
		return written === null ? null : written.textContent;
	};
	return { handle, onPick, reset, slider, words, row: host, name };
}

describe('a slider over a list of stops', () => {
	it('waits at the stop nearest what the surface already draws while the measure is its own', () => {
		const view = rail(0, () => 300);
		expect(view.slider.getValue()).toBe(2);
		expect(view.words()).toBe('Automatic');
		expect(view.reset.disabled).toBe(true);
		// With nothing to say where the surface stands, the handle waits at the first stop.
		expect(rail(0).slider.getValue()).toBe(0);
		expect(rail(0, () => Number.NaN).slider.getValue()).toBe(0);
		// The value is written where the row asked, not beside the rail.
		expect(view.row.querySelector('.snowflake-method-presentation-value')).toBeNull();
	});

	it('answers each stop the handle reaches, in words, and offers the way back', () => {
		const view = rail(256);
		expect(view.slider.getValue()).toBe(1);
		expect(view.words()).toBe('256 px');
		expect(view.reset.disabled).toBe(false);
		view.slider.change(2);
		expect(view.onPick).toHaveBeenLastCalledWith(320);
		expect(view.words()).toBe('320 px');
		view.slider.change(0);
		expect(view.onPick).toHaveBeenLastCalledWith(208);
		expect(view.onPick).toHaveBeenCalledTimes(2);
	});

	it("puts the surface's own measure back from the button, the handle going to where the surface stands", () => {
		const view = rail(208, () => 250);
		view.reset.click();
		expect(view.onPick).toHaveBeenCalledExactlyOnceWith(0);
		expect(view.words()).toBe('Automatic');
		expect(view.slider.getValue()).toBe(1);
		expect(view.reset.disabled).toBe(true);
		// Nothing to put back twice.
		view.reset.click();
		expect(view.onPick).toHaveBeenCalledOnce();
	});

	it('keeps room for its longest answer, whichever answer is on show', () => {
		const view = rail(256);
		const box = view.name.querySelector('.snowflake-method-presentation-value');
		expect(box?.classList.contains('snowflake-method-answer-box')).toBe(true);
		// Every answer the rail can give, the theme's own first, stands unseen in the box.
		const rooms = view.name.querySelectorAll('.snowflake-method-answer-room');
		expect(rooms.map((room) => room.textContent)).toEqual(['Automatic', '208 px', '256 px', '320 px']);
		expect(rooms.every((room) => room.getAttribute('aria-hidden') === 'true')).toBe(true);
		// The answer on show is written beside them, never over them.
		view.slider.change(2);
		expect(view.words()).toBe('320 px');
		expect(view.name.querySelectorAll('.snowflake-method-answer-room')).toHaveLength(4);
	});

	it('shows a measure that changed elsewhere without taking it for a pick', () => {
		const view = rail(208);
		view.handle.sync(320);
		expect(view.slider.getValue()).toBe(2);
		expect(view.words()).toBe('320 px');
		expect(view.onPick).not.toHaveBeenCalled();
		// A measure between two stops reads as the nearer one.
		view.handle.sync(300);
		expect(view.words()).toBe('320 px');
	});
});
