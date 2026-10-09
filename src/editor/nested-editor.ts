import type { EditorView } from '@codemirror/view';

/**
 * Whether an editor stands inside another one.
 *
 * Obsidian nests an editor in a note's own for each cell of a table in Live
 * Preview, and builds whatever a plugin registered for the note's editor
 * into those too. A cell holds a run of text with no paragraphs in it, so
 * the extensions that dress a note's prose -- the line marks, the paragraph
 * break on Enter -- leave a nested editor alone, and the app's own answer
 * stands there whole. Told by the DOM, which is the one thing the two kinds
 * of editor cannot share: a nested editor's box has an editor's box above it.
 */
export function isNestedEditor(view: EditorView): boolean {
	const above = view.dom.parentElement;
	return above !== null && above.closest('.cm-editor') !== null;
}
