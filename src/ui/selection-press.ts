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
 * the edit menu, and in the middle of a drag of selected words. On a
 * mobile device every press that is not a right button's is therefore left
 * to the system, whether it falls on the words, beside them or on a
 * header, and the toolbar's button is the menu's one door. A right button,
 * a mouse's on a tablet, keeps its menu, and nothing changes on a desktop.
 */

/**
 * Whether a `contextmenu` on a mobile device is a finger's press rather
 * than a right button's. Obsidian's long press is a synthesized event, so
 * it is not trusted and carries button 0; the browser's own long press, on
 * Android, is trusted but names a touch as its pointer.
 */
export function pressYieldsToSelection(event: MouseEvent): boolean {
	if (!isMobileDevice()) return false;
	if (!event.isTrusted || event.button !== 2) return true;
	return 'pointerType' in event && event.pointerType === 'touch';
}
