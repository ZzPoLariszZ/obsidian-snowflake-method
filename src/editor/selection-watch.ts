import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';

/** Where in a note the author is, and what they have taken hold of there. */
export interface EditorFocusReport {
	/** The note the editor holds, so a report is never read against another. */
	path: string | null;
	selectedText: string | null;
	/** The caret, as an offset into the whole document, frontmatter included. */
	caret: number;
}

/**
 * Every selected stretch as one string, or null when nothing is selected.
 * Exported for the one other editor this plugin builds itself, so the two
 * report a selection by the same rule.
 */
export function selectedTextOf(state: EditorState): string | null {
	const parts = state.selection.ranges
		.filter((range) => !range.empty)
		.map((range) => state.sliceDoc(range.from, range.to));
	return parts.length === 0 ? null : parts.join('\n');
}

/**
 * Reports where the author is in whichever editor they are in.
 *
 * Registered once, it rides inside every Markdown editor Obsidian opens, so
 * no editor needs finding and no window needs watching. Only the focused
 * editor speaks — a caret sitting in a background pane is not what the author
 * is looking at — and losing focus reports null, so a listener that shows the
 * selection can fall back the moment the author moves on. The listener is
 * called on every caret move; deduplication is its business.
 */
export function createSelectionWatchExtension(
	onFocus: (report: EditorFocusReport | null) => void,
): Extension {
	return EditorView.updateListener.of((update) => {
		if (update.focusChanged && !update.view.hasFocus) {
			onFocus(null);
			return;
		}
		if (!update.view.hasFocus) return;
		if (!update.selectionSet && !update.docChanged && !update.focusChanged) {
			return;
		}
		onFocus({
			path: update.state.field(editorInfoField, false)?.file?.path ?? null,
			selectedText: selectedTextOf(update.state),
			caret: update.state.selection.main.head,
		});
	});
}
