/**
 * A long press as a right-click, for the surfaces the app's own long press
 * never reaches.
 *
 * Obsidian answers a touch held for 800 ms with a synthetic `contextmenu`,
 * from a window listener on `touchstart`. The freeform canvas and the
 * relationship graph are built on d3's drag and zoom, which stop `touchstart`
 * at the surface, so nothing of the kind ever fires there: every menu those
 * two open by a right-click was out of a finger's reach. This does the same
 * from the surface itself, over pointer events, and yields to the app's own
 * where both could fire, so no press opens two menus.
 */

/** How long a finger stays down for a press: the app's own measure. */
export const LONG_PRESS_MS = 800;
/** How far a finger may drift and still be pressing rather than dragging. */
export const LONG_PRESS_SLOP_PX = 6;
/** How long after a press the finger's lift is still the press's own, not a tap. */
export const LONG_PRESS_AFTERMATH_MS = 700;

export interface LongPressOptions {
	ms?: number;
	slop?: number;
	/** What the press does; a `contextmenu` on the element under the finger when left out. */
	fire?: (point: { x: number; y: number }, target: Element) => void;
}

interface Press {
	id: number;
	x: number;
	y: number;
	target: Element;
	timer: number;
}

/**
 * Wires the press onto a host and returns its release. The press fires
 * where the finger is, on the element under it then, so a face that
 * appeared under the finger meanwhile is the one answering. The lift after
 * it is the press's own: its `touchend` is cancelled, so the browser makes
 * no mouse events of it (a menu's scrim under the finger would take the
 * click as a dismissal), and any tap it makes regardless is swallowed.
 */
export function wireLongPress(host: HTMLElement, options: LongPressOptions = {}): () => void {
	const doc = host.ownerDocument;
	const win = doc.defaultView;
	if (win === null) return () => undefined;
	const ms = options.ms ?? LONG_PRESS_MS;
	const slop = options.slop ?? LONG_PRESS_SLOP_PX;
	let press: Press | null = null;
	let firedAt: number | null = null;
	let own: Event | null = null;
	const cancel = (): void => {
		if (press === null) return;
		win.clearTimeout(press.timer);
		press = null;
	};
	const fire = (): void => {
		const current = press;
		press = null;
		if (current === null) return;
		firedAt = Date.now();
		const target = doc.elementFromPoint(current.x, current.y) ?? current.target;
		if (options.fire !== undefined) {
			options.fire({ x: current.x, y: current.y }, target);
			return;
		}
		const event = new win.MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: current.x,
			clientY: current.y,
			button: 0,
			view: win,
		});
		own = event;
		target.dispatchEvent(event);
		own = null;
	};
	const within = (): boolean => firedAt !== null && Date.now() - firedAt < LONG_PRESS_AFTERMATH_MS;
	const onDown = (event: PointerEvent): void => {
		if (event.pointerType === 'mouse') return;
		// A second finger is a pinch, not a press.
		if (press !== null) {
			cancel();
			return;
		}
		const target = event.target as Element | null;
		if (target === null || typeof target.closest !== 'function') return;
		press = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			target,
			timer: win.setTimeout(fire, ms),
		};
	};
	const onMove = (event: PointerEvent): void => {
		if (press === null || event.pointerId !== press.id) return;
		if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > slop) cancel();
	};
	const onUp = (event: PointerEvent): void => {
		if (press !== null && event.pointerId === press.id) cancel();
	};
	const onContextMenu = (event: MouseEvent): void => {
		if (event === own) return;
		// The platform, or the app, got there first: theirs is the menu.
		if (press !== null) {
			cancel();
			return;
		}
		// The app's own long press a moment behind this one: one menu is enough.
		if (within() && !event.isTrusted) {
			event.stopImmediatePropagation();
			event.preventDefault();
		}
	};
	const onTap = (event: MouseEvent): void => {
		if (!within()) return;
		event.stopImmediatePropagation();
		event.preventDefault();
	};
	const onLift = (event: TouchEvent): void => {
		if (within() && event.cancelable) event.preventDefault();
	};
	host.addEventListener('pointerdown', onDown, true);
	host.addEventListener('pointermove', onMove, true);
	host.addEventListener('pointerup', onUp, true);
	host.addEventListener('pointercancel', onUp, true);
	host.addEventListener('contextmenu', onContextMenu, true);
	host.addEventListener('click', onTap, true);
	host.addEventListener('dblclick', onTap, true);
	host.addEventListener('touchend', onLift, { capture: true, passive: false });
	return () => {
		cancel();
		host.removeEventListener('pointerdown', onDown, true);
		host.removeEventListener('pointermove', onMove, true);
		host.removeEventListener('pointerup', onUp, true);
		host.removeEventListener('pointercancel', onUp, true);
		host.removeEventListener('contextmenu', onContextMenu, true);
		host.removeEventListener('click', onTap, true);
		host.removeEventListener('dblclick', onTap, true);
		host.removeEventListener('touchend', onLift, true);
	};
}
