/**
 * The window a canvas stands in, heard by the canvas itself. The engine
 * listens for its keys on the window the plugin was loaded in and measures
 * with that window's tools, which is the wrong window for a canvas moved to
 * one of its own: there the key that lets a drag move the plane would never
 * be heard, and a canvas resized might never be told. So the engine's own
 * listening is turned off, and what it needed to hear is heard here, on the
 * window the canvas's element stands in, and again on the next when the view
 * is moved.
 *
 * No part of this is the engine's or the app's: it asks the element for its
 * document and the document for its window, so the tests read it on any
 * surface that answers those two questions.
 */

import { CANVAS_FIELD_SELECTOR, type CanvasSize } from './freeform-canvas-port';

export interface CanvasWindowDeps {
	host: HTMLElement;
	/** Space went down while the pointer stood over the canvas, or the middle button went down on it, so a drag on the ground moves the plane; or both came up. */
	panning: (on: boolean) => void;
	/** The canvas is another size. */
	resized: (size: CanvasSize) => void;
	/**
	 * A copy, a cut or a paste was asked for in the canvas's window. Heard on
	 * the window and not on the canvas, since the browser fires it at the
	 * words chosen or at the body, and a canvas with a node chosen has neither.
	 */
	clipboard: (event: ClipboardEvent) => void;
	/** A node is being moved or sized, as the engine last said. */
	dragging: () => boolean;
	/**
	 * The pointer moved with no button down while a node was being moved or
	 * sized: the release was taken by something else, a native menu opened
	 * under the drag or the system, and the engine never heard it.
	 */
	dropped: (event: PointerEvent) => void;
	/** The canvas stands in another window, after everything here was bound to it. */
	migrated: () => void;
}

export interface CanvasWindow {
	/** The canvas's size as last measured; nothing each way for one that is not shown. */
	size: () => CanvasSize;
	measure: () => CanvasSize;
	release: () => void;
}

const CLIPBOARD_EVENTS = ['copy', 'cut', 'paste'] as const;

/**
 * Where Space is a letter or a press of its own: a field's, a button's, a
 * link's, and whatever a face says the keys are not to be read over.
 */
const SPOKEN_FOR = `${CANVAS_FIELD_SELECTOR}, button, a, .nokey`;

const isPanKey = (event: KeyboardEvent): boolean => event.key === ' ' || event.code === 'Space';

/** Whether the key fell on something that has a use for it of its own. */
function spokenFor(target: EventTarget | null | undefined): boolean {
	if (target === null || target === undefined) return false;
	const element = target as Partial<Element>;
	return typeof element.closest === 'function' && element.closest(SPOKEN_FOR) !== null;
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
	/** Space is held over the canvas; the middle button is down on it. Either moves the plane under a drag. */
	let spaced = false;
	let middled = false;
	let held = false;
	let size: CanvasSize = { width: 0, height: 0 };
	let observer: { observe(target: Element): void; disconnect(): void } | null = null;
	let bound: MeasuringWindow | null = null;

	const tell = (): void => {
		const on = spaced || middled;
		if (on === held) return;
		held = on;
		deps.panning(on);
	};
	const say = (on: boolean): void => {
		spaced = on;
		tell();
	};
	// The middle button is heard as it goes down, ahead of the engine, which
	// is told the plane moves before it hears the press; a finger has no
	// middle button. Let go wherever it comes up, or where the press is lost.
	const onPress = (event: PointerEvent): void => {
		if (event.button !== 1 || event.pointerType === 'touch') return;
		middled = true;
		tell();
	};
	const onRelease = (event: PointerEvent): void => {
		if (!middled || (event.type === 'pointerup' && event.button !== 1)) return;
		middled = false;
		tell();
	};
	// A drag goes on only while the button is down. A move without it, while
	// the engine still has a node in hand, is a release it was never told of.
	const onDrift = (event: PointerEvent): void => {
		if ((event.buttons & 1) !== 0 || !deps.dragging()) return;
		deps.dropped(event);
	};

	const measure = (): CanvasSize => {
		const next = { width: host.clientWidth, height: host.clientHeight };
		if (next.width !== size.width || next.height !== size.height) {
			size = next;
			deps.resized(size);
		}
		return size;
	};

	// Taken only while the pointer stands over the canvas and the key fell on
	// nothing that speaks for it; let go wherever it comes up. Held, it says
	// nothing else, so the ground is not scrolled under it.
	const onKey = (event: KeyboardEvent): void => {
		if (!isPanKey(event)) return;
		if (event.type !== 'keydown') {
			say(false);
			return;
		}
		if (!over || spokenFor(event.target)) return;
		event.preventDefault();
		say(true);
	};
	const onBlur = (): void => {
		middled = false;
		say(false);
	};
	const onEnter = (): void => {
		over = true;
	};
	// A canvas the pointer already stood over when it was bound hears no enter: the first move says so.
	const onMove = (): void => {
		over = true;
	};
	const onLeave = (): void => {
		over = false;
		say(false);
	};
	const onClipboard = (event: ClipboardEvent): void => {
		deps.clipboard(event);
	};

	const bind = (): void => {
		const win = host.ownerDocument.defaultView as MeasuringWindow | null;
		bound = win;
		if (win === null) return;
		win.addEventListener('keydown', onKey, true);
		win.addEventListener('keyup', onKey, true);
		win.addEventListener('pointerup', onRelease, true);
		win.addEventListener('pointercancel', onRelease, true);
		win.addEventListener('pointermove', onDrift, true);
		win.addEventListener('blur', onBlur);
		for (const kind of CLIPBOARD_EVENTS) win.addEventListener(kind, onClipboard);
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
		bound.removeEventListener('pointerup', onRelease, true);
		bound.removeEventListener('pointercancel', onRelease, true);
		bound.removeEventListener('pointermove', onDrift, true);
		bound.removeEventListener('blur', onBlur);
		for (const kind of CLIPBOARD_EVENTS) bound.removeEventListener(kind, onClipboard);
		bound = null;
	};

	host.addEventListener('pointerenter', onEnter);
	host.addEventListener('pointermove', onMove);
	host.addEventListener('pointerleave', onLeave);
	host.addEventListener('pointerdown', onPress, true);
	bind();
	measure();
	const stopMigration = (host as MigratingElement).onWindowMigrated?.(() => {
		unbind();
		over = false;
		middled = false;
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
			host.removeEventListener('pointerdown', onPress, true);
		},
	};
}
