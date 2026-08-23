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

export function paragraphBreak(state: EditorState): TransactionSpec | null {
	const range = state.selection.main;
	const line = state.doc.lineAt(range.head);
	// The grammar here is CommonMark alone; a table is rows of paragraph to
	// it, so a row is told by its first character.
	if (/^\s*\|/u.test(line.text)) return null;
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
