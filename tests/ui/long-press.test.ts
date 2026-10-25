// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_AFTERMATH_MS, LONG_PRESS_MS, wireLongPress } from '../../src/ui/long-press';
import { installObsidianDom } from '../helpers/obsidian-dom';

function pointer(type: string, at: { x: number; y: number; id?: number; kind?: string }): MouseEvent {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0 });
	Object.defineProperties(event, {
		pointerId: { value: at.id ?? 1 },
		pointerType: { value: at.kind ?? 'touch' },
	});
	return event;
}

describe('wireLongPress', () => {
	let host: HTMLElement;
	let under: Element | null;
	let seen: string[];
	let release: () => void;

	beforeAll(() => {
		installObsidianDom(window);
		Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => under });
	});

	beforeEach(() => {
		vi.useFakeTimers();
		document.body.empty();
		host = document.body.createDiv();
		under = null;
		seen = [];
		host.addEventListener('contextmenu', (event) => {
			seen.push(`menu:${String(event.clientX)},${String(event.clientY)}:${String(event.button)}:${(event.target as Element).tagName}`);
		});
		host.addEventListener('click', () => {
			seen.push('click');
		});
		release = wireLongPress(host);
	});

	afterEach(() => {
		release();
		vi.useRealTimers();
	});

	it('turns a finger held still into a right-click where it is, and swallows the lift', () => {
		const child = host.createSpan();
		under = child;
		host.dispatchEvent(pointer('pointerdown', { x: 40, y: 50 }));
		vi.advanceTimersByTime(LONG_PRESS_MS - 1);
		expect(seen).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(seen).toEqual(['menu:40,50:0:SPAN']);
		host.dispatchEvent(pointer('pointerup', { x: 40, y: 50 }));
		const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
		child.dispatchEvent(tap);
		expect(tap.defaultPrevented).toBe(true);
		expect(seen).toEqual(['menu:40,50:0:SPAN']);
		vi.advanceTimersByTime(LONG_PRESS_AFTERMATH_MS);
		child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(seen).toEqual(['menu:40,50:0:SPAN', 'click']);
	});

	it('cancels the lift that ends a press, so the browser makes no click of it, and no other lift', () => {
		const lift = (): Event => new Event('touchend', { bubbles: true, cancelable: true });
		const idle = lift();
		host.dispatchEvent(idle);
		expect(idle.defaultPrevented).toBe(false);
		host.dispatchEvent(pointer('pointerdown', { x: 40, y: 50 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		const pressed = lift();
		host.dispatchEvent(pressed);
		expect(pressed.defaultPrevented).toBe(true);
		vi.advanceTimersByTime(LONG_PRESS_AFTERMATH_MS);
		const later = lift();
		host.dispatchEvent(later);
		expect(later.defaultPrevented).toBe(false);
	});

	it('is no press once the finger drifts, lifts, is a mouse, or is joined by another', () => {
		host.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
		host.dispatchEvent(pointer('pointermove', { x: 10, y: 20 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		host.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
		host.dispatchEvent(pointer('pointermove', { x: 13, y: 12 }));
		host.dispatchEvent(pointer('pointerup', { x: 13, y: 12 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		host.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, kind: 'mouse' }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		host.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, id: 1 }));
		host.dispatchEvent(pointer('pointerdown', { x: 90, y: 10, id: 2 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(seen).toEqual([]);
		host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(seen).toEqual(['click']);
	});

	it('yields to a right-click that arrives first, and stops the app’s late twin', () => {
		host.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
		vi.advanceTimersByTime(LONG_PRESS_MS / 2);
		host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(seen).toEqual(['menu:10,10:0:DIV']);
		host.dispatchEvent(pointer('pointerup', { x: 10, y: 10 }));
		host.dispatchEvent(pointer('pointerdown', { x: 30, y: 30 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(seen).toEqual(['menu:10,10:0:DIV', 'menu:30,30:0:DIV']);
		// The app's own long press, a moment behind ours: not a second menu.
		host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30, button: 0 }));
		expect(seen).toEqual(['menu:10,10:0:DIV', 'menu:30,30:0:DIV']);
	});

	it('hands a custom fire the point, and does nothing once released', () => {
		release();
		const points: string[] = [];
		release = wireLongPress(host, {
			ms: 300,
			fire: (point, target) => {
				points.push(`${String(point.x)},${String(point.y)}:${target.tagName}`);
			},
		});
		host.dispatchEvent(pointer('pointerdown', { x: 5, y: 6 }));
		vi.advanceTimersByTime(300);
		expect(points).toEqual(['5,6:DIV']);
		expect(seen).toEqual([]);
		release();
		host.dispatchEvent(pointer('pointerdown', { x: 5, y: 6 }));
		vi.advanceTimersByTime(LONG_PRESS_MS);
		expect(points).toEqual(['5,6:DIV']);
	});
});
