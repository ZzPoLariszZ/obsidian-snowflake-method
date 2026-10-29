// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import { Platform } from 'obsidian';

import { pressYieldsToSelection } from '../../src/ui/selection-press';

/** A right-click's event as a script makes it: untrusted, as Obsidian's long press is. */
const press = (init: MouseEventInit = {}): MouseEvent =>
	new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, ...init });

/** The same event as the browser would send it for a real button. */
function trusted(event: MouseEvent, pointerType?: string): MouseEvent {
	Object.defineProperty(event, 'isTrusted', { value: true });
	if (pointerType !== undefined) {
		Object.defineProperty(event, 'pointerType', { value: pointerType });
	}
	return event;
}

/**
 * A finger held on a mobile device's words is the system's own selection
 * gesture, and the plugin's menus keep out of it: every press there that is
 * not a right button's yields, wherever it lands, and a desktop yields nothing.
 */
describe('a long press against the selection', () => {
	afterEach(() => {
		Platform.isMobile = false;
	});

	it('yields nothing on a desktop', () => {
		expect(pressYieldsToSelection(press())).toBe(false);
		expect(pressYieldsToSelection(press({ button: 2 }))).toBe(false);
	});

	it("yields to Obsidian's long press on a mobile device, wherever it lands", () => {
		Platform.isMobile = true;
		expect(pressYieldsToSelection(press())).toBe(true);
		expect(pressYieldsToSelection(press({ clientX: 400, clientY: 900 }))).toBe(true);
		// A synthesized right button is still a script's, not a mouse's.
		expect(pressYieldsToSelection(press({ button: 2 }))).toBe(true);
	});

	it("keeps the menu for a mouse's right button on a tablet, not for a browser's long press", () => {
		Platform.isMobile = true;
		expect(pressYieldsToSelection(trusted(press({ button: 2 })))).toBe(false);
		expect(pressYieldsToSelection(trusted(press({ button: 2 }), 'mouse'))).toBe(false);
		expect(pressYieldsToSelection(trusted(press({ button: 2 }), 'touch'))).toBe(true);
		expect(pressYieldsToSelection(trusted(press({ button: 0 })))).toBe(true);
	});
});
