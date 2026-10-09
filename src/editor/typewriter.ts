import { EditorState, type Extension, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Typewriter scrolling in an editor of Obsidian's own: the line being
 * written held at the middle of the page, as the stream holds its own.
 *
 * The stream scrolls its page itself, because its page is not its editors'.
 * A note's page is the editor's, so the editor can simply be asked: every
 * transaction the author made at the keyboard -- typing, deleting, moving
 * the caret -- is extended with the instruction to bring its caret to the
 * middle, and the editor honours it with the very scroll it would make to
 * show the caret at all, in the same frame as the edit. A click is left
 * alone, as the stream leaves one: the author put the caret where they can
 * see it. Whether the mode is on, and whether the note is one the dress
 * reaches, is asked at each transaction, so a flip in a popover reaches
 * the editor already open.
 */
export function typewriterWhen(isOn: (state: EditorState) => boolean): Extension {
	return EditorState.transactionExtender.of((transaction) => {
		if (!authored(transaction) || !isOn(transaction.startState)) return null;
		return {
			effects: EditorView.scrollIntoView(transaction.newSelection.main.head, {
				y: 'center',
			}),
		};
	});
}

/** A caret moved by the author's hands at the keyboard, not by a click. */
function authored(transaction: Transaction): boolean {
	if (!transaction.docChanged && transaction.selection === undefined) return false;
	if (transaction.isUserEvent('select.pointer')) return false;
	return ['input', 'delete', 'move', 'select'].some((event) =>
		transaction.isUserEvent(event),
	);
}
