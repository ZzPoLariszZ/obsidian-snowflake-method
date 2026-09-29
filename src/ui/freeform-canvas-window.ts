/**
 * The window a canvas stands in, heard by the canvas itself. The engine
 * listens for its keys on the window the plugin was loaded in and measures
 * with that window's tools, which is the wrong window for a canvas moved to
 * one of its own: there the key that draws a box would never be heard, and a
 * canvas resized might never be told. So the engine's own listening is turned
 * off, and what it needed to hear is heard here, on the window the canvas's
 * element stands in, and again on the next when the view is moved.
 *
 * No part of this is the engine's or the app's: it asks the element for its
 * document and the document for its window, so the tests read it on any
 * surface that answers those two questions.
 */

import type { CanvasSize } from './freeform-canvas-port';

export interface CanvasWindowDeps {
	host: HTMLElement;
	/** The key that draws a box went down or came up while the pointer stood over the canvas. */
	boxing: (on: boolean) => void;
	/** The canvas is another size. */
	resized: (size: CanvasSize) => void;
	/** The canvas stands in another window, after everything here was bound to it. */
	migrated: () => void;
}

export interface CanvasWindow {
	/** The canvas's size as last measured; nothing each way for one that is not shown. */
	size: () => CanvasSize;
	measure: () => CanvasSize;
	release: () => void;
}

type MigratingElement = HTMLElement & {
	onWindowMigrated?: (listener: (win: Window) => unknown) => () => void;
};

/** A window with the tools a canvas measures by, which every window has and the types name on none. */
type MeasuringWindow = Window & {
	ResizeObserver?: new (callback: () => void) => { observe(target: Element): void; disconnect(): void };
};

export function bindCanvasWindow(deps: CanvasWindowDeps): CanvasWindow {
	const { host } = deps;
	let over = false;
	let held = false;
	let size: CanvasSize = { width: 0, height: 0 };
	let observer: { observe(target: Element): void; disconnect(): void } | null = null;
	let bound: MeasuringWindow | null = null;

	const say = (on: boolean): void => {
		if (on === held) return;
		held = on;
		deps.boxing(on);
	};

	const measure = (): CanvasSize => {
		const next = { width: host.clientWidth, height: host.clientHeight };
		if (next.width !== size.width || next.height !== size.height) {
			size = next;
			deps.resized(size);
		}
		return size;
	};

	const onKey = (event: KeyboardEvent): void => {
		if (event.key !== 'Shift') return;
		say(over && event.type === 'keydown');
	};
	const onBlur = (): void => {
		say(false);
	};
	const onEnter = (event: PointerEvent): void => {
		over = true;
		say(event.shiftKey);
	};
	// The key may go down or come up while another window holds the keys: what
	// the pointer says as it moves is the word that is never stale.
	const onMove = (event: PointerEvent): void => {
		over = true;
		say(event.shiftKey);
	};
	const onLeave = (): void => {
		over = false;
		say(false);
	};

	const bind = (): void => {
		const win = host.ownerDocument.defaultView as MeasuringWindow | null;
		bound = win;
		if (win === null) return;
		win.addEventListener('keydown', onKey, true);
		win.addEventListener('keyup', onKey, true);
		win.addEventListener('blur', onBlur);
		if (win.ResizeObserver !== undefined) {
			observer = new win.ResizeObserver(() => {
				measure();
			});
			observer.observe(host);
		}
	};
	const unbind = (): void => {
		observer?.disconnect();
		observer = null;
		if (bound === null) return;
		bound.removeEventListener('keydown', onKey, true);
		bound.removeEventListener('keyup', onKey, true);
		bound.removeEventListener('blur', onBlur);
		bound = null;
	};

	host.addEventListener('pointerenter', onEnter);
	host.addEventListener('pointermove', onMove);
	host.addEventListener('pointerleave', onLeave);
	bind();
	measure();
	const stopMigration = (host as MigratingElement).onWindowMigrated?.(() => {
		unbind();
		over = false;
		say(false);
		bind();
		measure();
		deps.migrated();
	});

	return {
		size: () => size,
		measure,
		release: () => {
			stopMigration?.();
			unbind();
			host.removeEventListener('pointerenter', onEnter);
			host.removeEventListener('pointermove', onMove);
			host.removeEventListener('pointerleave', onLeave);
		},
	};
}
