/**
 * A press that becomes a drag opens no menu.
 *
 * On a phone or a tablet a finger held on a card or a handle is answered
 * twice. The browser lifts the element into a drag, as it does for anything
 * `draggable`, and the long press opens the element's right-click menu: on
 * Android by the browser's own `contextmenu`, which comes with the drag, and
 * elsewhere by the app's synthetic one. A mouse never meets both, since its
 * right button starts no drag. A board watches its drags from its root with
 * this. A hold that stays still keeps its menu, as the finger that lifts
 * without moving meant it. The menu is closed as the finger sets off with
 * the card, as the system closes its own, and once a drag has moved no menu
 * opens until it ends.
 */
import { LONG_PRESS_SLOP_PX } from './long-press';

/** What the watch asks of a menu, the app's `Menu` as it stands: to close, and to say when it closed on its own. */
export interface WatchedMenu {
	hide: () => unknown;
	onHide: (callback: () => void) => void;
}

export interface DragPressWatch {
	/** A menu the board opened, by a right-click, a long press or a button; a drag that sets off closes it. */
	opened: (menu: WatchedMenu) => void;
	release: () => void;
}

/** A drag in flight: where it began, once an event has carried a point, and whether the finger has set off. */
interface Flight {
	origin: { x: number; y: number } | null;
	moved: boolean;
}

/** Where a drag event says the pointer is; null where the platform gave it no point. */
function pointOf(event: MouseEvent): { x: number; y: number } | null {
	return event.clientX === 0 && event.clientY === 0 ? null : { x: event.clientX, y: event.clientY };
}

/**
 * Wires the watch onto a board's root and returns it. The start is heard
 * where it bubbles, so a `dragstart` the board declined, its default
 * prevented, counts for nothing. Movement is read from the `drag` events
 * the source keeps firing and from the `dragover` of whatever stands under
 * the pointer, since a card may leave the root while the finger is still on
 * it. The end is `dragend` or `drop`, and failing both the next press: a
 * source that left the tree before its drag ended never brings its
 * `dragend` here.
 */
export function watchDragPress(root: HTMLElement): DragPressWatch {
	let flight: Flight | null = null;
	let menu: WatchedMenu | null = null;
	const onStart = (event: DragEvent): void => {
		flight = event.defaultPrevented ? null : { origin: pointOf(event), moved: false };
	};
	const onMove = (event: DragEvent): void => {
		if (flight === null || flight.moved) return;
		const point = pointOf(event);
		if (point === null) return;
		if (flight.origin === null) {
			flight.origin = point;
			return;
		}
		if (Math.hypot(point.x - flight.origin.x, point.y - flight.origin.y) <= LONG_PRESS_SLOP_PX) return;
		flight.moved = true;
		const open = menu;
		menu = null;
		open?.hide();
	};
	const onEnd = (): void => {
		flight = null;
	};
	const onContextMenu = (event: MouseEvent): void => {
		if (flight === null || !flight.moved) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	root.addEventListener('dragstart', onStart);
	root.addEventListener('drag', onMove, true);
	root.addEventListener('dragover', onMove, true);
	root.addEventListener('drop', onEnd, true);
	root.addEventListener('dragend', onEnd, true);
	root.addEventListener('pointerdown', onEnd, true);
	root.addEventListener('contextmenu', onContextMenu, true);
	return {
		opened: (next) => {
			menu = next;
			next.onHide(() => {
				if (menu === next) menu = null;
			});
		},
		release: () => {
			flight = null;
			menu = null;
			root.removeEventListener('dragstart', onStart);
			root.removeEventListener('drag', onMove, true);
			root.removeEventListener('dragover', onMove, true);
			root.removeEventListener('drop', onEnd, true);
			root.removeEventListener('dragend', onEnd, true);
			root.removeEventListener('pointerdown', onEnd, true);
			root.removeEventListener('contextmenu', onContextMenu, true);
		},
	};
}
