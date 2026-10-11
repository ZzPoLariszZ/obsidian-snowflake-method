import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';

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

/**
 * What each line of the text is, read off the text alone: the kinds the
 * layout tells apart, and the kinds Enter asks about. An opaque block and a
 * container hold every line of theirs, blank ones included; a standing
 * block is a line each; and what is left is the document's own prose, in
 * runs, and the blank lines around it.
 */
export type TextLineKind =
	| 'frontmatter'
	| 'fence'
	| 'math'
	| 'comment'
	| 'html'
	| 'list'
	| 'quote'
	| 'heading'
	| 'rule'
	| 'table'
	| 'definition'
	| 'code'
	| 'blank'
	| 'text';

/**
 * The kinds whose lines keep CodeMirror's own Enter: the blocks the grammar
 * walk in `paragraph-break.ts` leaves alone, with the front matter and a
 * math block beside them, which only the text can see.
 */
const PLAIN_ENTER_KINDS: ReadonlySet<TextLineKind> = new Set<TextLineKind>([
	'frontmatter',
	'fence',
	'math',
	'comment',
	'html',
	'list',
	'quote',
	'code',
]);

const HEADING_LINE = /^ {0,3}#{1,6}(?:\s|$)/u;
const RULE_LINE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;
const LIST_ITEM_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;

/**
 * A tag that opens an HTML block wherever it stands, a paragraph's next
 * line included: the block-level names CommonMark lists, as the stream's
 * grammar reads them.
 */
const HTML_BLOCK_TAG =
	/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|section|source|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/iu;

/**
 * Any other tag, whole and alone on its line: an HTML block too, but one
 * that cannot break into a paragraph. A line that merely opens with a tag
 * -- an underline, a span, an autolink -- is the paragraph's.
 */
const HTML_LONE_TAG =
	/^(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?:\s+[a-z:_][\w.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/iu;

/**
 * Whether a line leaves an Obsidian comment open or closed behind it: each
 * `%%` outside a code span turns the comment on or off, wherever in the line
 * it stands, as the app's editor reads it.
 */
function togglesComment(text: string): boolean {
	if (!text.includes('%%')) return false;
	return (text.replace(/`+[^`]*`+/gu, '').split('%%').length - 1) % 2 === 1;
}

/**
 * The lines read as a Markdown reader reads them, for an editor whose
 * grammar is not the stream's.
 *
 * Obsidian's own editor parses Markdown with a stream mode of its own, whose
 * tree has no `Paragraph` or `FencedCode` in it, so the walk above finds
 * nothing there and would mark every blank line a gap, a fence's included.
 * This reads the text instead: a fence, front matter, a math block, a
 * comment block and an HTML block are opaque; a list and a quote hold their
 * own lines, blank ones included, as long as they go on; a heading, a rule,
 * a table row and a definition stand alone; and what is left, in runs, is
 * the document's own paragraphs. One kind per line, the first line first.
 * Stopped early when only the lines up to one are wanted: what a line is
 * depends on the lines above it, and on nothing below but the few a blank
 * line in a list looks ahead to.
 */
export function classifyLinesByText(doc: Text, upTo = doc.lines): TextLineKind[] {
	const kinds: TextLineKind[] = [];
	const isBlank = (number: number): boolean =>
		doc.line(number).text.trim().length === 0;
	let fence: { marker: string; length: number } | null = null;
	let frontmatter = false;
	let math = false;
	let comment = false;
	/** Inside an HTML block, with what ends it: a closing, or a blank line for a tag block. */
	let html: RegExp | 'blank' | null = null;
	/**
	 * Inside a list or a quote. A blank line ends a quote; it ends a list
	 * only when no item and no indented continuation follows it.
	 */
	let container: 'list' | 'quote' | null = null;
	/** The line before was a paragraph line, which the next text line continues. */
	let paragraph = false;
	const last = Math.min(upTo, doc.lines);
	for (let number = 1; number <= last; number += 1) {
		const line = doc.line(number);
		const text = line.text;
		const trimmed = text.trim();
		if (number === 1 && /^---\s*$/u.test(text)) {
			frontmatter = true;
			kinds.push('frontmatter');
			continue;
		}
		if (frontmatter) {
			kinds.push('frontmatter');
			if (/^(---|\.\.\.)\s*$/u.test(text)) frontmatter = false;
			continue;
		}
		if (fence !== null) {
			kinds.push('fence');
			const closing = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(text);
			if (
				closing !== null &&
				closing[1]?.charAt(0) === fence.marker &&
				(closing[1]?.length ?? 0) >= fence.length
			) {
				fence = null;
			}
			continue;
		}
		if (math) {
			kinds.push('math');
			if (/\$\$\s*$/u.test(text)) math = false;
			continue;
		}
		if (comment) {
			kinds.push('comment');
			if (togglesComment(text)) comment = false;
			continue;
		}
		if (html !== null) {
			if (html === 'blank') {
				if (trimmed.length === 0) html = null;
				else {
					kinds.push('html');
					continue;
				}
			} else {
				kinds.push('html');
				if (html.test(text)) html = null;
				continue;
			}
		}
		if (trimmed.length === 0) {
			// A blank line inside a list or a quote is the container's own
			// while the container goes on past it: an item or a quote line, or
			// an indented continuation, on the next text line.
			if (container === 'list') {
				let next = number + 1;
				while (next <= doc.lines && isBlank(next)) next += 1;
				const after = next <= doc.lines ? doc.line(next).text : '';
				if (
					next <= doc.lines &&
					((LIST_ITEM_LINE.test(after) && !RULE_LINE.test(after)) ||
						/^(?: {2,}|\t)\S/u.test(after))
				) {
					kinds.push('list');
					continue;
				}
			}
			container = null;
			paragraph = false;
			kinds.push('blank');
			continue;
		}
		// A backtick fence's info string holds no backtick: a line that opens
		// with a code span and goes on is a paragraph's.
		const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(text);
		if (
			opening !== null &&
			!(opening[1]?.startsWith('`') === true && (opening[2] ?? '').includes('`'))
		) {
			fence = { marker: opening[1]?.charAt(0) ?? '`', length: opening[1]?.length ?? 3 };
			kinds.push('fence');
			paragraph = false;
			container = null;
			continue;
		}
		// A math block opens on a `$$` with no other dollar sign after it, as
		// the app's editor opens one, and `$$…$$` closing the line is a block of
		// its own; display math with words after it is a paragraph's.
		const afterMath = /^ {0,3}\$\$(.*)$/u.exec(text)?.[1];
		if (
			afterMath !== undefined &&
			(!afterMath.includes('$') || /\$\$\s*$/u.test(afterMath))
		) {
			kinds.push('math');
			if (!afterMath.includes('$')) math = true;
			paragraph = false;
			container = null;
			continue;
		}
		if (/^ {0,3}%%/u.test(text)) {
			kinds.push('comment');
			comment = togglesComment(text);
			paragraph = false;
			container = null;
			continue;
		}
		// An HTML block, by the kinds CommonMark names: a comment, a processing
		// instruction, a declaration and CDATA each end at their own closing,
		// on the same line as often as not -- a section marker is one line --
		// and a tag block runs to the next blank line: one opening with a
		// block-level tag, or a lone tag on a line that no paragraph runs into.
		const htmlOpening = /^ {0,3}<(?:(!--)|(\?)|(!\[CDATA\[)|(![A-Za-z])|[A-Za-z]|\/)/u.exec(text);
		if (
			htmlOpening !== null &&
			(htmlOpening.slice(1).some((group) => group !== undefined) ||
				HTML_BLOCK_TAG.test(trimmed) ||
				(!paragraph && HTML_LONE_TAG.test(trimmed)))
		) {
			const closing =
				htmlOpening[1] !== undefined
					? /-->/u
					: htmlOpening[2] !== undefined
						? /\?>/u
						: htmlOpening[3] !== undefined
							? /\]\]>/u
							: htmlOpening[4] !== undefined
								? />/u
								: null;
			const opensAt = htmlOpening[0].length;
			html =
				closing === null
					? 'blank'
					: closing.test(text.slice(opensAt))
						? null
						: closing;
			kinds.push('html');
			paragraph = false;
			container = null;
			continue;
		}
		// A rule before an item: `* * *` and `- - -` are a scene break, not a
		// list of nothing.
		const rule = RULE_LINE.test(text);
		if (!rule && LIST_ITEM_LINE.test(text)) {
			container = 'list';
			kinds.push('list');
			paragraph = false;
			if (togglesComment(text)) comment = true;
			continue;
		}
		if (/^ {0,3}>/u.test(text)) {
			container = 'quote';
			kinds.push('quote');
			paragraph = false;
			if (togglesComment(text)) comment = true;
			continue;
		}
		if (container !== null) {
			// Still the item's or the quote's: indented under it, or a lazy
			// continuation of the line before. A heading or a rule that is
			// neither ends it, as it ends the paragraph a lazy line continues.
			const indented = container === 'list' && /^(?: {2,}|\t)/u.test(text);
			if (indented || !(HEADING_LINE.test(text) || rule)) {
				kinds.push(container);
				if (togglesComment(text)) comment = true;
				continue;
			}
			container = null;
		}
		const standing: TextLineKind | null = HEADING_LINE.test(text)
			? 'heading'
			: rule
				? 'rule'
				: /^ {0,3}\|/u.test(text)
					? 'table'
					: /^ {0,3}\[[^\]]+\]:/u.test(text)
						? 'definition'
						: !paragraph && /^(?: {4,}|\t)/u.test(text)
							? 'code'
							: null;
		if (standing !== null) {
			kinds.push(standing);
			paragraph = false;
			if (standing !== 'code' && togglesComment(text)) comment = true;
			continue;
		}
		kinds.push('text');
		paragraph = true;
		// A comment opened partway along the line runs on below it.
		if (togglesComment(text)) comment = true;
	}
	return kinds;
}

/**
 * Whether the line at `number` keeps CodeMirror's own Enter, by the text:
 * inside a list, a quote, a code block, raw HTML, a comment, a math block or
 * the front matter. The lines above it are read to say so, and no more.
 */
export function lineKeepsPlainEnter(doc: Text, number: number): boolean {
	const kind = classifyLinesByText(doc, number)[number - 1];
	return kind !== undefined && PLAIN_ENTER_KINDS.has(kind);
}

/**
 * The same layout read off the text alone, for an editor whose grammar is
 * not the stream's: the lines as `classifyLinesByText` reads them, with the
 * document's own text in runs as its paragraphs and the blank lines between
 * blocks following the rule above exactly.
 */
export function paragraphLayoutByText(doc: Text): ParagraphLayout {
	const kinds = classifyLinesByText(doc);
	const first: number[] = [];
	const lines: number[] = [];
	const blank: number[] = [];
	let paragraph = false;
	for (let number = 1; number <= doc.lines; number += 1) {
		if (kinds[number - 1] !== 'text') {
			paragraph = false;
			continue;
		}
		const from = doc.line(number).from;
		if (!paragraph) first.push(from);
		lines.push(from);
		paragraph = true;
	}
	const blankAt = (number: number): boolean => kinds[number - 1] === 'blank';
	for (let number = 1; number <= doc.lines; number += 1) {
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
