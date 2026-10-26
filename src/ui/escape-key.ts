import type { ItemView, Modal } from 'obsidian';

/**
 * Obsidian reads an Escape that reached the window unanswered as the author
 * asking for the note back: when the active view is not a note's, the
 * workspace activates the note leaf used last and hands it the keys. That is
 * the sidebar's idiom, Escape from the file explorer or the search back to
 * the editor, and this plugin's views stand in the main area, where an Escape
 * struck in a synopsis box or the stream threw the author into the note
 * beside it. An input method made it worse: on a Mac the key that takes
 * unwanted syllables back reaches the page as an Escape with `isComposing`
 * set, so cancelling a Chinese composition in the dashboard landed the caret
 * in the neighbouring note.
 *
 * The view keeps such an Escape. Stopped at the view's root, the key never
 * reaches the window's listener, while whatever stands inside the view has
 * answered it first, and the browser's own answer, a search field clearing
 * itself, is not prevented. A view docked at a side keeps the sidebar's idiom
 * for a plain Escape and holds only the composing one.
 */
export function keepEscapeInView(view: ItemView): void {
	view.registerDomEvent(view.containerEl, 'keydown', (event) => {
		if (event.key !== 'Escape') return;
		if (!event.isComposing && standsInDock(view)) return;
		event.stopPropagation();
	});
}

/** Whether the view's leaf stands in one of the side docks rather than the main area or a window of its own. */
function standsInDock(view: ItemView): boolean {
	const root = view.leaf.getRoot();
	const { leftSplit, rightSplit } = view.app.workspace;
	return root === leftSplit || root === rightSplit;
}

/**
 * Escape as Obsidian's dialogs answer it, with one exception: an Escape
 * struck while an input method is composing is the composition's, and the
 * dialog stays. Obsidian binds Modal's `onEscapeKey` to the dialog's scope in
 * its constructor, and that handler looks only at `defaultPrevented`, so the
 * plugin's dialogs override the method with this. `false` has the keymap
 * stop the key where it is, so nothing under the dialog reads it either.
 */
export function answerEscapeKey(modal: Modal, event: KeyboardEvent): false | undefined {
	if (event.isComposing) return false;
	if (event.defaultPrevented) return undefined;
	event.preventDefault();
	modal.close();
	return undefined;
}
