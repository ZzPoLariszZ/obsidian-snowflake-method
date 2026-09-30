import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import { bindCanvasWindow } from '../../src/ui/freeform-canvas-window';

/** Calls a window's own listeners with the properties a key or a blur carries. */
function tell(dom: CorkboardDom, type: string, properties: Record<string, unknown> = {}): void {
	for (const { listener } of dom.windowListeners.get(type) ?? []) {
		(listener as (event: Record<string, unknown>) => void)({ type, ...properties });
	}
}

/** Calls an element's own listeners with the properties a pointer carries. */
function point(element: CorkboardElement, type: string, properties: Record<string, unknown> = {}): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

const heard = (dom: CorkboardDom): Record<string, number> =>
	Object.fromEntries([...dom.windowListeners].map(([type, listeners]) => [type, listeners.length]));

function bound() {
	const dom = new CorkboardDom();
	const host = dom.container.createDiv();
	const boxing = vi.fn();
	const resized = vi.fn();
	const migrated = vi.fn();
	const clipboard = vi.fn();
	const surroundings = bindCanvasWindow({ host: host as unknown as HTMLElement, boxing, resized, clipboard, migrated });
	return { dom, host, boxing, resized, clipboard, migrated, surroundings };
}

describe('the window a canvas stands in', () => {
	it('measures the canvas as it is bound, and says its size again only when it is another', () => {
		const { dom, resized, surroundings } = bound();
		expect(resized).toHaveBeenCalledTimes(1);
		expect(resized).toHaveBeenLastCalledWith({ width: 1_000, height: 600 });
		expect(surroundings.size()).toEqual({ width: 1_000, height: 600 });
		dom.resize(1_000, 600);
		expect(resized).toHaveBeenCalledTimes(1);
		dom.resize(800, 500);
		expect(resized).toHaveBeenCalledTimes(2);
		expect(resized).toHaveBeenLastCalledWith({ width: 800, height: 500 });
		expect(surroundings.size()).toEqual({ width: 800, height: 500 });
	});

	it('measures when it is asked to, for a window that tells it nothing', () => {
		const { dom, resized, surroundings } = bound();
		dom.width = 640;
		dom.height = 480;
		expect(surroundings.size()).toEqual({ width: 1_000, height: 600 });
		expect(surroundings.measure()).toEqual({ width: 640, height: 480 });
		expect(resized).toHaveBeenLastCalledWith({ width: 640, height: 480 });
	});

	it('says nothing each way for a canvas that is not shown', () => {
		const dom = new CorkboardDom();
		dom.width = 0;
		dom.height = 0;
		const host = dom.container.createDiv();
		const resized = vi.fn();
		const surroundings = bindCanvasWindow({
			host: host as unknown as HTMLElement, boxing: vi.fn(), resized, clipboard: vi.fn(), migrated: vi.fn(),
		});
		expect(surroundings.size()).toEqual({ width: 0, height: 0 });
		// Nothing each way is what it started from, so there is nothing to say.
		expect(resized).not.toHaveBeenCalled();
		dom.resize(900, 700);
		expect(resized).toHaveBeenCalledWith({ width: 900, height: 700 });
	});

	it('hears the key that draws a box only while the pointer stands over the canvas', () => {
		const { dom, host, boxing } = bound();
		tell(dom, 'keydown', { key: 'Shift' });
		expect(boxing).not.toHaveBeenCalled();
		point(host, 'pointerenter', { shiftKey: false });
		tell(dom, 'keydown', { key: 'Shift' });
		expect(boxing).toHaveBeenLastCalledWith(true);
		// Held, the key repeats; the canvas is told once.
		tell(dom, 'keydown', { key: 'Shift' });
		expect(boxing).toHaveBeenCalledTimes(1);
		tell(dom, 'keyup', { key: 'Shift' });
		expect(boxing).toHaveBeenLastCalledWith(false);
		expect(boxing).toHaveBeenCalledTimes(2);
	});

	it('takes no other key for the one that draws a box', () => {
		const { dom, host, boxing } = bound();
		point(host, 'pointerenter', { shiftKey: false });
		for (const key of ['Control', 'Meta', 'Alt', 'a', ' ']) tell(dom, 'keydown', { key });
		expect(boxing).not.toHaveBeenCalled();
	});

	it('reads the key off the pointer as it comes and as it moves, so a key pressed elsewhere is never stale', () => {
		const { host, boxing } = bound();
		point(host, 'pointerenter', { shiftKey: true });
		expect(boxing).toHaveBeenLastCalledWith(true);
		// Let go while another window held the keys: the next move says so.
		point(host, 'pointermove', { shiftKey: false });
		expect(boxing).toHaveBeenLastCalledWith(false);
		point(host, 'pointermove', { shiftKey: true });
		expect(boxing).toHaveBeenLastCalledWith(true);
		expect(boxing).toHaveBeenCalledTimes(3);
	});

	it('lets the key go as the pointer leaves, and as the window loses the keys', () => {
		const { dom, host, boxing } = bound();
		point(host, 'pointerenter', { shiftKey: true });
		point(host, 'pointerleave');
		expect(boxing).toHaveBeenLastCalledWith(false);
		// Pressed once the pointer has left, it is not the canvas's.
		tell(dom, 'keydown', { key: 'Shift' });
		expect(boxing).toHaveBeenCalledTimes(2);
		point(host, 'pointerenter', { shiftKey: true });
		tell(dom, 'blur');
		expect(boxing).toHaveBeenLastCalledWith(false);
		expect(boxing).toHaveBeenCalledTimes(4);
	});

	it('hears the keys ahead of whatever stands in the window, and the blur as it comes', () => {
		const { dom } = bound();
		expect(dom.windowListeners.get('keydown')?.map((entry) => entry.capture)).toEqual([true]);
		expect(dom.windowListeners.get('keyup')?.map((entry) => entry.capture)).toEqual([true]);
		expect(dom.windowListeners.get('blur')?.map((entry) => entry.capture)).toEqual([false]);
	});

	it('hands a copy, a cut and a paste asked for in the window to the canvas, as they come', () => {
		const { dom, clipboard } = bound();
		for (const kind of ['copy', 'cut', 'paste']) {
			expect(dom.windowListeners.get(kind)?.map((entry) => entry.capture)).toEqual([false]);
			tell(dom, kind, { clipboardData: kind });
			expect(clipboard).toHaveBeenLastCalledWith(expect.objectContaining({ type: kind, clipboardData: kind }));
		}
		expect(clipboard).toHaveBeenCalledTimes(3);
	});

	it('follows the canvas to the window it is moved to, and lets the one it left go', () => {
		const { dom, host, boxing, resized, migrated } = bound();
		point(host, 'pointerenter', { shiftKey: true });
		expect(boxing).toHaveBeenLastCalledWith(true);
		const destination = new CorkboardDom();
		destination.width = 720;
		destination.height = 540;
		const before = dom.observers.length;
		host.migrateTo(destination);
		// Nothing is heard in the window it left.
		expect(heard(dom)).toEqual({ keydown: 0, keyup: 0, blur: 0, copy: 0, cut: 0, paste: 0 });
		expect(dom.observers.slice(0, before).every((observer) => observer.disconnected)).toBe(true);
		expect(heard(destination)).toEqual({ keydown: 1, keyup: 1, blur: 1, copy: 1, cut: 1, paste: 1 });
		// A key held as the canvas moved is let go: the window that would say it came up is behind.
		expect(boxing).toHaveBeenLastCalledWith(false);
		expect(resized).toHaveBeenLastCalledWith({ width: 720, height: 540 });
		expect(migrated).toHaveBeenCalledOnce();
		// The canvas is told of the move once everything is bound to the window it moved to.
		tell(dom, 'keydown', { key: 'Shift' });
		expect(boxing).toHaveBeenCalledTimes(2);
		point(host, 'pointerenter', { shiftKey: false });
		tell(destination, 'keydown', { key: 'Shift' });
		expect(boxing).toHaveBeenLastCalledWith(true);
		destination.resize(300, 200);
		expect(resized).toHaveBeenLastCalledWith({ width: 300, height: 200 });
	});

	it('lets everything go when it is released', () => {
		const { dom, host, boxing, resized, migrated, surroundings } = bound();
		surroundings.release();
		expect(heard(dom)).toEqual({ keydown: 0, keyup: 0, blur: 0, copy: 0, cut: 0, paste: 0 });
		expect(dom.observers.every((observer) => observer.disconnected)).toBe(true);
		expect(host.windowMigrationListeners.size).toBe(0);
		dom.resize(10, 10);
		host.migrateTo(new CorkboardDom());
		expect(resized).toHaveBeenCalledTimes(1);
		expect(migrated).not.toHaveBeenCalled();
		expect(boxing).not.toHaveBeenCalled();
	});

	it('stands on a surface that has no window and none of the app’s own helpers', () => {
		const listeners: string[] = [];
		const host = {
			clientWidth: 320,
			clientHeight: 240,
			ownerDocument: { defaultView: null },
			addEventListener: (type: string) => { listeners.push(type); },
			removeEventListener: (type: string) => { listeners.splice(listeners.indexOf(type), 1); },
		};
		const resized = vi.fn();
		const surroundings = bindCanvasWindow({
			host: host as unknown as HTMLElement, boxing: vi.fn(), resized, clipboard: vi.fn(), migrated: vi.fn(),
		});
		expect(resized).toHaveBeenCalledWith({ width: 320, height: 240 });
		expect(listeners.sort()).toEqual(['pointerenter', 'pointerleave', 'pointermove']);
		surroundings.release();
		expect(listeners).toEqual([]);
	});
});
