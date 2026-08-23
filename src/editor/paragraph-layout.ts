import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/**
 * Which lines open a paragraph and which are the blank lines between blocks,
 * by the Markdown grammar, within a range of the document.
 *
 * The stream's page gives each paragraph its first-line indent and the gap
 * below it. The editor shows the same text one line at a time and has to find
 * the same places: the first line of every top-level paragraph is where the
 * indent goes, and the blank line between blocks is the gap. Paragraphs
 * inside lists and quotes are left alone, as the page leaves them, and a blank
 * line inside a code block is code rather than a gap.
 *
 * Blank lines come in runs, and not every line of a run is the gap. The first
 * blank line after text is: it closes the paragraph above, and the page draws
 * one gap however many follow. A blank line after that is a line of its own,
 * full height and indented, where a paragraph is about to be written -- the
 * line Enter opens when it puts the paragraph break (`paragraph-break.ts`),
 * and which must not change height under the first letter typed on it. In a
 * run of three or more, the last blank line is the gap before whatever
 * follows, so the text below does not move either. The page collapses such
 * runs to one gap; the difference is the height of the lines the author left
 * empty, and is theirs.
 *
 * Kept free of the editor view, in the manner of `caret-paragraph.ts`, so the
 * rule can be exercised on a state alone. `segment-editor-backend.ts` turns
 * the answer into line decorations, and styles.css into space.
 */
export interface ParagraphLayout {
	/**
	 * Start offsets of the lines that open a top-level paragraph, and of the
	 * blank lines of their own where one is about to be opened.
	 */
	first: number[];
	/** Start offsets of every line of a top-level paragraph, first lines included. */
	lines: number[];
	/** Start offsets of the blank lines that are the gap between blocks. */
	blank: number[];
}

/** Blocks whose blank lines are their own business. */
const OPAQUE_BLOCKS = new Set([
	'FencedCode',
	'CodeBlock',
	'HTMLBlock',
	'CommentBlock',
]);

/**
 * Blocks that hold other blocks. Their own blank lines are not the
 * manuscript's gap -- the page spaces a list's items by the theme's list
 * spacing, not by the paragraph gap -- and the walk goes down through them,
 * because a code fence written inside a list item is still code.
 */
const CONTAINER_BLOCKS = new Set([
	'BulletList',
	'OrderedList',
	'ListItem',
	'Blockquote',
]);

export function paragraphLayout(
	state: EditorState,
	from: number,
	to: number,
	// The grammar's tree to read: the state's own by default, which reaches
	// only as far as the parser has got. A caller that needs the answer for
	// text the parser has not reached -- the editor, on mount, for the lines
	// in view deep in a long note -- hands in one parsed that far.
	tree: ReturnType<typeof syntaxTree> = syntaxTree(state),
): ParagraphLayout {
	const doc = state.doc;
	const first: number[] = [];
	const lines: number[] = [];
	const opaque: { from: number; to: number }[] = [];
	tree.iterate({
		from,
		to,
		enter: (node) => {
			if (node.name === 'Document') return true;
			if (OPAQUE_BLOCKS.has(node.name)) {
				// At whatever depth it was written: a fence inside a list item
				// is as much code as one standing on its own, and squeezing a
				// blank line in the middle of it would be nonsense.
				opaque.push({ from: node.from, to: node.to });
				return false;
			}
			if (CONTAINER_BLOCKS.has(node.name)) {
				opaque.push({ from: node.from, to: node.to });
				return true;
			}
			if (node.name === 'Paragraph') {
				// Only the document's own: a paragraph inside a list or a quote
				// is the list's or the quote's, as it is on the page. Asked of
				// the parent rather than of a depth count, so the answer does
				// not depend on how the walk arrived.
				if (node.node.parent?.name === 'Document') {
					const opening = doc.lineAt(node.from);
					first.push(opening.from);
					const last = doc.lineAt(node.to).number;
					for (let number = opening.number; number <= last; number += 1) {
						lines.push(doc.line(number).from);
					}
				}
			}
			return false;
		},
	});
	const blankAt = (number: number): boolean => {
		const line = doc.line(number);
		return (
			line.text.trim().length === 0 &&
			!opaque.some((block) => line.from >= block.from && line.from < block.to)
		);
	};
	const blank: number[] = [];
	const last = doc.lineAt(Math.min(to, doc.length)).number;
	for (let number = doc.lineAt(from).number; number <= last; number += 1) {
		if (!blankAt(number)) continue;
		let start = number;
		while (start > 1 && blankAt(start - 1)) start -= 1;
		let end = number;
		while (end < doc.lines && blankAt(end + 1)) end += 1;
		const gap = number === start || (end - start >= 2 && number === end);
		(gap ? blank : first).push(doc.line(number).from);
	}
	first.sort((a, b) => a - b);
	return { first, lines, blank };
}
