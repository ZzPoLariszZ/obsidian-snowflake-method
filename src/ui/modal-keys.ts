import type { KeymapEventHandler, Modal, Scope } from 'obsidian';

/**
 * The dialogs that remember which Mod+Enter handler they carry, so a form
 * wired twice hands the chord a fresh closure instead of a second one.
 */
const modEnterHandlers = new WeakMap<Modal, KeymapEventHandler>();

/**
 * Mod+Enter -- Cmd+Enter on a Mac, Ctrl+Enter elsewhere -- submits a dialog
 * from wherever the caret stands. It is the chord the plugin's own inline
 * editors save on, and the one most apps send on; Enter alone keeps its
 * meanings, and Shift+Enter stays the line break every text area answers.
 * The chord rides the dialog's own scope, which stands ahead of the app's
 * while the dialog is open, so it answers with nothing focused at all, and
 * a picker opened over the dialog brings a scope of its own that takes the
 * chord with it. Wiring the same dialog again replaces the handler.
 */
export function submitOnModEnter(modal: Modal, submit: () => void): void {
	const standing = modEnterHandlers.get(modal);
	if (standing !== undefined) modal.scope.unregister(standing);
	const handler = modal.scope.register(['Mod'], 'Enter', (event) => {
		// A chord struck while an input method is composing belongs to the
		// composition, and one struck by a held key was not struck again.
		if (event.isComposing || event.repeat) return;
		submit();
		return false;
	});
	modEnterHandlers.set(modal, handler);
}

/**
 * The same chord in a view's boxes -- the dashboard's step panels -- presses
 * the Save that goes with the box the caret stands in, so a step is saved
 * from the keyboard as a dialog is submitted. Obsidian's keymap reads
 * Mod+Enter at the window, ahead of any listener in the leaf, and spends it
 * on a hotkey of its own (the link under the cursor opens in a new tab), so
 * the chord rides the view's scope, which the keymap asks first while the
 * leaf is active. A chord struck outside the bound boxes goes on to the
 * app's hotkeys as before. A Save that is disabled, by a save in flight or
 * a read-only project, takes nothing, and the chord is spent either way, so
 * the box does not break a line on it. Boxes are bound as their panels are
 * drawn and forgotten with their elements.
 */
export function saveOnModEnter(scope: Scope): (box: HTMLElement, save: HTMLButtonElement) => void {
	const saves = new WeakMap<EventTarget, HTMLButtonElement>();
	scope.register(['Mod'], 'Enter', (event) => {
		// A chord struck while an input method is composing belongs to the
		// composition, and one struck by a held key was not struck again.
		if (event.isComposing || event.repeat) return;
		const save = event.target === null ? undefined : saves.get(event.target);
		if (save === undefined) return;
		event.preventDefault();
		if (!save.disabled) save.click();
		return false;
	});
	return (box, save) => {
		saves.set(box, save);
	};
}
