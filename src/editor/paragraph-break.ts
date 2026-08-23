import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
	EditorSelection,
	type EditorState,
	type TransactionSpec,
} from '@codemirror/state';

/**
 * Enter as a manuscript knows it: the blank line Markdown needs between
 * paragraphs, so that the next line is a paragraph of its own and takes the
 * page's indent and gap.
 *
 * One Enter in Markdown is a soft break inside the paragraph, which the page
 * shows as a line break without an indent, and which the editor showed as a
 * gap's worth of height until the first letter made it a full line: the line
 * the author had just opened jumped under them. Two newlines are what a
 * paragraph needs, so that is what Enter puts. Shift+Enter stays the plain
 * break, for the rare line that wants one.
 *
 * Only in prose. A list, a quote, a code block, raw HTML and a table row keep
 * CodeMirror's own Enter, which continues or breaks them as they expect. On a
 * blank line the caret goes between the two newlines rather than after them,
 * so it stands on a line of its own with a gap on either side, which the
 * layout rule in `paragraph-layout.ts` draws at full height and indented.
 * Null when Enter is not this command's to answer.
 */
const KEEPS_PLAIN_ENTER = new Set([
	'ListItem',
	'BulletList',
	'OrderedList',
	'Blockquote',
	'FencedCode',
	'CodeBlock',
	'HTMLBlock',
	'CommentBlock',
]);

/** How long to spend parsing up to the caret before deciding. */
const PARSE_MS = 20;

/** One cell of the row of dashes that turns two lines into a table. */
const DELIMITER_CELL = /^\s*:?-+:?\s*$/u;

/**
 * Whether a line is the row of dashes under a table's headings. A pipe is
 * required: a bare row of dashes underlines a heading instead, which is a
 * different thing entirely. The outer pipes are optional, as they are in the
 * tables Obsidian reads.
 */
function isDelimiterRow(text: string): boolean {
	if (!text.includes('|')) return false;
	const cells = text
		.trim()
		.replace(/^\|/u, '')
		.replace(/\|$/u, '')
		.split('|');
	return cells.every((cell) => DELIMITER_CELL.test(cell));
}

/**
 * Whether the line at `number` belongs to a table.
 *
 * The grammar here is CommonMark, which has no tables at all, so the text has
 * to say. A table is the run of lines around the caret with a row of dashes
 * somewhere below its first line: everything from the headings down is the
 * table's, and a blank line above or below ends it, which is exactly how the
 * page reads one. Rows written without their outer pipes are a table too --
 * the reason the leading-pipe test alone was not enough, since Enter would
 * cut such a table in half and orphan every row under the break.
 */
function insideTable(
	doc: EditorState['doc'],
	number: number,
): boolean {
	const blank = (at: number): boolean => doc.line(at).text.trim().length === 0;
	let start = number;
	while (start > 1 && !blank(start - 1)) start -= 1;
	let end = number;
	while (end < doc.lines && !blank(end + 1)) end += 1;
	for (let at = start + 1; at <= end; at += 1) {
		if (isDelimiterRow(doc.line(at).text)) return number >= at - 1;
	}
	return false;
}

export function paragraphBreak(state: EditorState): TransactionSpec | null {
	const range = state.selection.main;
	const line = state.doc.lineAt(range.head);
	// A row still being typed, before the dashes under it exist, is already a
	// row; a table that has its dashes is read whole, pipes on the outside or
	// not.
	if (/^\s*\|/u.test(line.text)) return null;
	if (insideTable(state.doc, line.number)) return null;
	const tree = ensureSyntaxTree(state, range.head, PARSE_MS) ?? syntaxTree(state);
	for (
		let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
			range.head,
			-1,
		);
		node !== null;
		node = node.parent
	) {
		if (KEEPS_PLAIN_ENTER.has(node.name)) return null;
	}
	const onBlank = range.empty && line.text.trim().length === 0;
	return {
		changes: { from: range.from, to: range.to, insert: '\n\n' },
		selection: EditorSelection.cursor(range.from + (onBlank ? 1 : 2)),
		scrollIntoView: true,
		userEvent: 'input',
	};
}
