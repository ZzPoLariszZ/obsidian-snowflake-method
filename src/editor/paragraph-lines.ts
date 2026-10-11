import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateEffect, type EditorState, type Extension } from '@codemirror/state';
import {
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from '@codemirror/view';

import { isNestedEditor } from './nested-editor';
import { paragraphLayout, paragraphLayoutByText } from './paragraph-layout';

/**
 * The line classes the page's typography is hung on, in the stream's own
 * editor and in a note of Obsidian's dressed the same way: the first line of
 * a paragraph carries the indent, every line of one its alignment and
 * hyphenation, and a blank line the gap. The stylesheet reads them from the
 * same variables the rendered half reads, so a change of typography is live
 * without an editor reconfiguration, and the two halves cannot drift apart.
 */
export const PARAGRAPH_LINE_CLASSES = {
	first: 'snowflake-method-paragraph-first',
	line: 'snowflake-method-paragraph-line',
	blank: 'snowflake-method-blank-line',
} as const;

const PARAGRAPH_FIRST = Decoration.line({ class: PARAGRAPH_LINE_CLASSES.first });
const PARAGRAPH_LINE = Decoration.line({ class: PARAGRAPH_LINE_CLASSES.line });
const BLANK_LINE = Decoration.line({ class: PARAGRAPH_LINE_CLASSES.blank });

/**
 * A paragraph's line that begins with a space, in Obsidian's own editor,
 * which hangs such a line's wrapped rows under its first word with a style
 * of its own on the line. The indent's box stands before that word, so the
 * rows hung a whole indent in and the paragraph read as a block set apart,
 * where the stream's editor and both reading halves run them flush under
 * the indent. The rows are put back flush by a style of the plugin's on the
 * same line: a line's decorations join their styles in turn, the app's
 * first, and the later declaration is the one that holds. That holds for a
 * line as the editor draws it; what the app writes onto a line afterwards is
 * answered by `flushHungRows`.
 */
const FLUSH_LINE = Decoration.line({
	attributes: { style: 'text-indent: 0; padding-inline-start: 0' },
});

/**
 * A line that begins with the whitespace Obsidian hangs a line's rows under:
 * any space at all, the ideographic one a Chinese paragraph may open with
 * included, as the app's own test reads it.
 */
const HUNG_LEAD = /^\s/u;

/** A length the style leaves at nothing: unset, or zero. */
const isNothing = (value: string): boolean =>
	value === '' || Number.parseFloat(value) === 0;

/**
 * The rows of a hung paragraph line put back flush wherever the app wrote
 * the hang onto the line itself. Obsidian draws a hung line with an
 * estimate, then measures it -- when it is drawn, and again whenever its
 * text changes -- and writes the measured hang straight onto the line, past
 * the decorations, so it stood until the editor next wrote the line's own
 * style back: a frame or more, which read as the paragraph jumping in and
 * back. Answered as the style changes, in the same turn, before anything is
 * painted. A line's own style, so the editor writes it again whole the next
 * time it draws the line, and the decoration above stands then.
 */
function flushHungRows(records: readonly MutationRecord[]): void {
	for (const record of records) {
		const line = record.target as HTMLElement;
		if (line.classList?.contains(PARAGRAPH_LINE_CLASSES.line) !== true) continue;
		const { style } = line;
		if (isNothing(style.textIndent) && isNothing(style.paddingInlineStart)) continue;
		// Taken off the line rather than written over: what is left is the
		// page's own flush row, the same nothing the decoration writes.
		style.removeProperty('text-indent');
		style.removeProperty('padding-inline-start');
	}
}

/** How long one update may spend parsing ahead for the lines in view. */
const LAYOUT_PARSE_MS = 50;

/**
 * The lines the page indents, aligns or spaces, found over the whole note.
 *
 * The grammar is parsed in the background a few thousand characters at a
 * time, and a state just made has parsed only its first three thousand, so
 * the parse is brought up to the whole note here before the lines are
 * decorated. Measured on a fifteen thousand character chapter: one and a
 * half milliseconds, once.
 *
 * The whole note, not the lines in view. Decorating the viewport meant
 * decorating wherever the viewport happened to be at the moment the editor
 * was built -- which is not where the reader is. Mounting empties the note's
 * body first, so the page around it collapses and settles again over the
 * frames that follow, and the caret is sought after that; the lines the
 * reader actually ends up looking at were therefore drawn once undecorated,
 * ragged and unindented, and dressed a frame or two later when the viewport
 * caught up. Recorded on a click into the middle of a chapter: plain at 99ms,
 * justified and indented at 154ms. Laying out the whole note costs a tenth of
 * a millisecond on that same chapter and nothing on scrolling, since the
 * answer no longer depends on where the page is. CodeMirror draws only the
 * lines in view whatever the set holds.
 */
export function layoutDecorations(state: EditorState): DecorationSet {
	const { doc } = state;
	const tree =
		ensureSyntaxTree(state, doc.length, LAYOUT_PARSE_MS) ?? syntaxTree(state);
	return decorationsFor(paragraphLayout(state, 0, doc.length, tree));
}

/**
 * The same marks from the text alone, for Obsidian's own editor, with the
 * paragraph lines that begin with a space kept flush (see `FLUSH_LINE`).
 */
export function layoutDecorationsByText(state: EditorState): DecorationSet {
	const layout = paragraphLayoutByText(state.doc);
	const flush = layout.lines.filter((at) => HUNG_LEAD.test(state.doc.lineAt(at).text));
	return decorationsFor(layout, flush);
}

function decorationsFor(
	layout: {
		first: number[];
		lines: number[];
		blank: number[];
	},
	flush: readonly number[] = [],
): DecorationSet {
	return Decoration.set(
		[
			...layout.first.map((at) => PARAGRAPH_FIRST.range(at)),
			...layout.lines.map((at) => PARAGRAPH_LINE.range(at)),
			...flush.map((at) => FLUSH_LINE.range(at)),
			...layout.blank.map((at) => BLANK_LINE.range(at)),
		],
		true,
	);
}

/** Whether the lines need marking again: the text changed, or the grammar parsed further. */
function layoutMoved(update: ViewUpdate): boolean {
	return (
		update.docChanged ||
		syntaxTree(update.startState) !== syntaxTree(update.state)
	);
}

/**
 * Marks the first line of every paragraph and every blank line between
 * blocks, always: the stream's own editor, where every note is the
 * manuscript's. Rebuilt when the text changes and when the grammar has
 * parsed further, which a new tree identity says; not when the page scrolls,
 * because the whole note is marked at once and scrolling reveals lines that
 * are already dressed.
 */
export const paragraphLines: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = layoutDecorations(view.state);
		}

		update(update: ViewUpdate): void {
			if (layoutMoved(update)) {
				this.decorations = layoutDecorations(update.state);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

/**
 * Asks every editor carrying `paragraphLinesWhen` or `caretParagraphWhen` to
 * decide afresh whether its note is one they reach: dispatched after the
 * scope or the roster of projects changes, which the editor cannot see for
 * itself.
 */
export const refreshParagraphLines = StateEffect.define<null>();

/**
 * The same marks for an editor of Obsidian's own, worn only while the note
 * in it is one the typography reaches. Asked of the state rather than told,
 * so the answer follows the file the editor shows -- which changes under one
 * editor as the author opens note after note in the same tab -- and is asked
 * again when the text changes and when the refresh effect arrives. A note
 * outside the scope carries no marks at all, and costs no scan. The lines
 * are read off the text, because that editor's grammar is not the stream's
 * (see `paragraphLayoutByText`), and read again only when the text changes:
 * what that editor parses in the background says nothing about them. An
 * editor the app nests in the note's -- a table's cell -- wears no marks
 * whatever the note wears: a cell has no paragraphs to indent. Whether an
 * editor is nested is a question for the document, and a cell's editor is
 * built before its cell is put there, so the question waits for the first
 * update that finds the editor in the document and is settled once.
 */
export function paragraphLinesWhen(
	isDressed: (view: EditorView) => boolean,
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private dressed: boolean;
			/** Known once the editor stands in the document; a nested one never dresses. */
			private nested: boolean | null;
			/** The watch on the lines' own style, kept while the note is dressed (see `flushHungRows`). */
			private guard: MutationObserver | null = null;

			constructor(private readonly view: EditorView) {
				this.nested = view.dom.isConnected ? isNestedEditor(view) : null;
				this.dressed = this.nested !== true && isDressed(view);
				this.decorations = this.dressed
					? layoutDecorationsByText(view.state)
					: Decoration.none;
				this.watch();
			}

			update(update: ViewUpdate): void {
				if (this.nested === null && update.view.dom.isConnected) {
					this.nested = isNestedEditor(update.view);
				}
				if (this.nested === true) {
					if (this.dressed) {
						this.dressed = false;
						this.decorations = Decoration.none;
						this.watch();
					}
					return;
				}
				const asked = update.transactions.some((transaction) =>
					transaction.effects.some((effect) => effect.is(refreshParagraphLines)),
				);
				const was = this.dressed;
				if (asked || update.docChanged) {
					this.dressed = isDressed(update.view);
				}
				if (this.dressed !== was) this.watch();
				if (!this.dressed) {
					if (was) this.decorations = Decoration.none;
					return;
				}
				if (!was || update.docChanged) {
					this.decorations = layoutDecorationsByText(update.state);
				}
			}

			destroy(): void {
				this.guard?.disconnect();
				this.guard = null;
			}

			/** The watch kept exactly while the note is dressed. */
			private watch(): void {
				if (this.dressed && this.guard === null) {
					// The editor's own window's observer, so a popout watches its own lines.
					const Observer = this.view.dom.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
					this.guard = new Observer(flushHungRows);
					this.guard.observe(this.view.contentDOM, {
						attributes: true,
						attributeFilter: ['style'],
						subtree: true,
					});
				} else if (!this.dressed && this.guard !== null) {
					this.guard.disconnect();
					this.guard = null;
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
