import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Every selected stretch as one string, or null when nothing is selected. */
function selectedTextOf(state: EditorState): string | null {
	const parts = state.selection.ranges
		.filter((range) => !range.empty)
		.map((range) => state.sliceDoc(range.from, range.to));
	return parts.length === 0 ? null : parts.join('\n');
}

/**
 * Reports what is selected in whichever editor the author is in.
 *
 * Registered once, it rides inside every Markdown editor Obsidian opens, so
 * no editor needs finding and no window needs watching. Only the focused
 * editor speaks — a selection sitting in a background pane is not what the
 * author is looking at — and losing focus reports null, so a listener that
 * shows the selection can fall back the moment the author moves on. The
 * listener is called on every caret move; deduplication is its business.
 */
export function createSelectionWatchExtension(
	onSelection: (selectedText: string | null) => void,
): Extension {
	return EditorView.updateListener.of((update) => {
		if (update.focusChanged && !update.view.hasFocus) {
			onSelection(null);
			return;
		}
		if (!update.view.hasFocus) return;
		if (!update.selectionSet && !update.docChanged && !update.focusChanged) {
			return;
		}
		onSelection(selectedTextOf(update.state));
	});
}
