// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAP_AFTERMATH_MS, wireCaretKeepingPress } from '../../src/ui/caret-press';
import { installObsidianDom } from '../helpers/obsidian-dom';

type Point = { x: number; y: number };

function touch(type: string, points: Point[], changed: Point[] = points): Event {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		touches: { value: points.map((point) => ({ clientX: point.x, clientY: point.y })) },
		changedTouches: { value: changed.map((point) => ({ clientX: point.x, clientY: point.y })) },
	});
	return event;
}

describe('wireCaretKeepingPress', () => {
	let control: HTMLButtonElement;
	let acted: { x: number; y: number }[];

	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		vi.useFakeTimers();
		document.body.empty();
		control = document.body.createEl('button');
		acted = [];
		wireCaretKeepingPress(control, (event) => {
			acted.push({ x: event.clientX, y: event.clientY });
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('keeps the caret by refusing the press its default, and acts on the click', () => {
		const down = new MouseEvent('mousedown', { cancelable: true, bubbles: true });
		control.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		control.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 3, clientY: 4 }));
		expect(acted).toEqual([{ x: 3, y: 4 }]);
	});

	it('acts from the tap itself, prevents it, and ignores the click the browser makes of it', () => {
		control.dispatchEvent(touch('touchstart', [{ x: 10, y: 12 }]));
		const end = touch('touchend', [], [{ x: 11, y: 12 }]);
		control.dispatchEvent(end);
		expect(end.defaultPrevented).toBe(true);
		expect(acted).toEqual([{ x: 11, y: 12 }]);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 11, clientY: 12 });
		control.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(acted).toHaveLength(1);
		vi.advanceTimersByTime(TAP_AFTERMATH_MS);
		control.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
		expect(acted).toHaveLength(2);
	});

	it('lets a finger that scrolled, a second finger and a disabled control be', () => {
		control.dispatchEvent(touch('touchstart', [{ x: 10, y: 12 }]));
		control.dispatchEvent(touch('touchmove', [{ x: 10, y: 40 }]));
		const scrolled = touch('touchend', [], [{ x: 10, y: 40 }]);
		control.dispatchEvent(scrolled);
		expect(scrolled.defaultPrevented).toBe(false);
		control.dispatchEvent(touch('touchstart', [{ x: 10, y: 12 }, { x: 60, y: 12 }]));
		control.dispatchEvent(touch('touchend', [{ x: 60, y: 12 }], [{ x: 10, y: 12 }]));
		control.disabled = true;
		control.dispatchEvent(touch('touchstart', [{ x: 10, y: 12 }]));
		const refused = touch('touchend', [], [{ x: 10, y: 12 }]);
		control.dispatchEvent(refused);
		expect(refused.defaultPrevented).toBe(false);
		expect(acted).toEqual([]);
		control.disabled = false;
		// The browser's click after a scroll is no tap of ours, and acts as a click.
		control.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 7, clientY: 8 }));
		expect(acted).toEqual([{ x: 7, y: 8 }]);
	});

	it('refuses a touch pointer its default and leaves a mouse pointer alone', () => {
		const finger = new MouseEvent('pointerdown', { cancelable: true, bubbles: true });
		Object.defineProperty(finger, 'pointerType', { value: 'touch' });
		control.dispatchEvent(finger);
		expect(finger.defaultPrevented).toBe(true);
		const mouse = new MouseEvent('pointerdown', { cancelable: true, bubbles: true });
		Object.defineProperty(mouse, 'pointerType', { value: 'mouse' });
		control.dispatchEvent(mouse);
		expect(mouse.defaultPrevented).toBe(false);
	});
});
