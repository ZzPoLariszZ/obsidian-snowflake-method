import type { EditorState, Extension } from '@codemirror/state';
import {
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from '@codemirror/view';

import { isNestedEditor } from './nested-editor';
import { refreshParagraphLines } from './paragraph-lines';

/**
 * Which lines make up the paragraph the caret is in, and the mark they wear.
 *
 * The rule is kept free of the editor, so it can be exercised without one.
 * The mark is what focus mode's styling makes visible, in the stream's own
 * editors and in Obsidian's: the page that holds the editor fades every
 * line but the marked ones while the mode is on, and nothing else reads it.
 */

/** The lines of a document, however they are stored. One-based. */
export interface LineSource {
	lines: number;
	lineText(line: number): string;
}

/**
 * The paragraph around one line: the run of non-blank lines it sits in, as
 * first and last line numbers — or null when the line itself is blank, because
 * a caret between paragraphs is in neither of them.
 */
export function paragraphAround(
	text: LineSource,
	line: number,
): { first: number; last: number } | null {
	const blank = (at: number): boolean => text.lineText(at).trim().length === 0;
	if (line < 1 || line > text.lines || blank(line)) return null;
	let first = line;
	while (first > 1 && !blank(first - 1)) first -= 1;
	let last = line;
	while (last < text.lines && !blank(last + 1)) last += 1;
	return { first, last };
}

/** Worn by every line of the paragraph the caret is in. */
export const CARET_PARAGRAPH_CLASS = 'snowflake-method-caret-paragraph';

const CARET_PARAGRAPH = Decoration.line({ class: CARET_PARAGRAPH_CLASS });

/** The lines of the paragraph around the main caret, marked: none from a blank line. */
export function caretParagraphDecorations(state: EditorState): DecorationSet {
	const doc = state.doc;
	const bounds = paragraphAround(
		{ lines: doc.lines, lineText: (line) => doc.line(line).text },
		doc.lineAt(state.selection.main.head).number,
	);
	if (bounds === null) return Decoration.none;
	const lines = [];
	for (let line = bounds.first; line <= bounds.last; line += 1) {
		lines.push(CARET_PARAGRAPH.range(doc.line(line).from));
	}
	return Decoration.set(lines);
}

/**
 * Marks the lines of the paragraph the caret is in, always: the stream's own
 * editor. The styling that fades everything else is applied by the view, in
 * focus mode only, so keeping the mark current is the whole of this plugin's
 * job — a toggle is a class flip, never an editor reconfiguration.
 */
export const caretParagraph: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = caretParagraphDecorations(view.state);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.selectionSet) {
				this.decorations = caretParagraphDecorations(update.state);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

/**
 * The same mark in an editor of Obsidian's own, worn only while the note in
 * it is one focus mode reaches. Asked of the editor rather than told, so the
 * answer follows the file the editor shows, which changes under one editor
 * as the author opens note after note in the same tab: asked when the text
 * changes, and again when the refresh effect arrives. Whether the mode is
 * on is the page's class to say, as in the stream, so turning it on or off
 * asks nothing of the editor. An editor the app nests in the note's -- a
 * table's cell -- wears no mark, and is settled once it is found in the
 * document, as the line marks settle it (see `paragraphLinesWhen`).
 */
export function caretParagraphWhen(
	reaches: (view: EditorView) => boolean,
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private reached: boolean;
			/** Known once the editor stands in the document; a nested one never wears the mark. */
			private nested: boolean | null;

			constructor(view: EditorView) {
				this.nested = view.dom.isConnected ? isNestedEditor(view) : null;
				this.reached = this.nested !== true && reaches(view);
				this.decorations = this.reached
					? caretParagraphDecorations(view.state)
					: Decoration.none;
			}

			update(update: ViewUpdate): void {
				if (this.nested === null && update.view.dom.isConnected) {
					this.nested = isNestedEditor(update.view);
				}
				const asked = update.transactions.some((transaction) =>
					transaction.effects.some((effect) => effect.is(refreshParagraphLines)),
				);
				const was = this.reached;
				if (this.nested === true) this.reached = false;
				else if (asked || update.docChanged) this.reached = reaches(update.view);
				if (!this.reached) {
					if (was) this.decorations = Decoration.none;
					return;
				}
				if (!was || update.docChanged || update.selectionSet) {
					this.decorations = caretParagraphDecorations(update.state);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
