import type { KeymapEventHandler, Modal } from 'obsidian';

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
