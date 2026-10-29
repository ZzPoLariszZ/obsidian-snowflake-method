import { isMobileDevice } from './device';

/**
 * A finger held on words, against the plugin's menus.
 *
 * On a phone a touch held on prose is the system's own gesture: at half a
 * second it takes the word under the finger and shows its edit menu, a hold
 * on a selection lifts the words to drag them, and the selection's handles
 * move it under a finger that never lifts. Obsidian answers the same held
 * touch with a synthetic `contextmenu` at 800 ms, so a menu the plugin
 * opens on a right-click opened over the system's gesture too: on top of
 * the edit menu, and in the middle of a drag of selected words. A press
 * that falls on the selection, or lands while the selection is still
 * moving, is left to the system. A right button keeps its menu, so does a
 * press on a place with no selection in play, and nothing changes on a
 * desktop.
 */

/** How long after the selection last moved a press is still the selection's own. */
export const SELECTION_SETTLE_MS = 1200;

/** How far outside the selection's boxes a press still falls on it. */
const SELECTION_REACH_PX = 4;

const movedAt = new WeakMap<Document, number>();

/**
 * To be told on the document's `selectionchange`: records when a stretch
 * of words was last taken or moved. A caret moving on its own, as typing
 * moves it, is no selection and is not recorded.
 */
export function noteSelectionMoved(doc: Document, now = Date.now()): void {
	const selection = doc.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return;
	movedAt.set(doc, now);
}

/** Whether a `contextmenu` belongs to the system's selection gesture rather than to a menu of the plugin's. */
export function pressYieldsToSelection(event: MouseEvent, doc: Document, now = Date.now()): boolean {
	if (!isMobileDevice() || event.button === 2) return false;
	const moved = movedAt.get(doc);
	if (moved !== undefined && now - moved < SELECTION_SETTLE_MS) return true;
	const selection = doc.getSelection();
	if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return false;
	const range = selection.getRangeAt(0);
	if (typeof range.getClientRects !== 'function') return false;
	return Array.from(range.getClientRects()).some(
		(rect) =>
			event.clientX >= rect.left - SELECTION_REACH_PX &&
			event.clientX <= rect.right + SELECTION_REACH_PX &&
			event.clientY >= rect.top - SELECTION_REACH_PX &&
			event.clientY <= rect.bottom + SELECTION_REACH_PX,
	);
}
