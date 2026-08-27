/**
 * The low-level reading every markdown-aware scan shares: the grammar the
 * page is read with, and the constructs Obsidian added that no grammar knows,
 * found by hand over the one original body. `countable-prose.ts` answers what
 * the page shows, for counting; `analyzable-prose.ts` answers where the prose
 * sits, for matching. Each keeps its own policy, but they must never disagree
 * about where a link, a fence or a comment stands -- so the finding lives
 * here, once.
 *
 * Kept free of Obsidian types and of the DOM, so all of it can be exercised
 * without a workspace.
 */

import {
	Strikethrough,
	Table,
	TaskList,
	parser as commonMarkParser,
} from '@lezer/markdown';

/**
 * The grammar the page is read with. Obsidian renders these three GitHub
 * extensions, and a parser without them hands their syntax through as writing:
 * a three-row table would count its own pipes and dashes as a dozen words the
 * reader never sees.
 */
export const scanParser = commonMarkParser.configure([
	Table,
	TaskList,
	Strikethrough,
]);

/** A stretch of the body, in offsets over the one original text. */
export interface CountableRange {
	from: number;
	to: number;
}

/**
 * Syntax drawn around the prose rather than read as part of it. The last
 * three come with the GitHub extensions: `TableDelimiter` is every `|` and
 * the whole `| --- |` row under a header, `TaskMarker` the `[ ]` a checkbox
 * is drawn from, `StrikethroughMark` the `~~` pairs around text that is still
 * on the page.
 */
export const MARK_NODES: ReadonlySet<string> = new Set([
	'HeaderMark',
	'QuoteMark',
	'ListMark',
	'LinkMark',
	'EmphasisMark',
	'CodeMark',
	'CodeInfo',
	'LinkTitle',
	'LinkLabel',
	'TableDelimiter',
	'TaskMarker',
	'StrikethroughMark',
]);

/** Constructs that put no writing of their own on the page. */
export const SILENT_NODES: ReadonlySet<string> = new Set([
	'HorizontalRule',
	'HTMLBlock',
	'CommentBlock',
	'ProcessingInstructionBlock',
	'LinkReference',
	'Image',
	'HTMLTag',
	'Comment',
	'ProcessingInstruction',
]);

/** Code is written, but it is not writing. Fences and all. */
export const CODE_NODES: ReadonlySet<string> = new Set([
	'FencedCode',
	'CodeBlock',
	'InlineCode',
]);

/** Obsidian's own syntax, which no Markdown grammar reads as anything. */
export const WIKILINK_PATTERN = /(!?)\[\[([^\]\n]*?)(?:\|([^\]\n]*))?\]\]/gu;
export const BLOCK_ID_PATTERN = /(?:^|[ \t])\^[A-Za-z0-9-]+$/gmu;
/**
 * A highlight shows what is between its `==` pairs and nothing of the pairs
 * themselves. Held to one line and to a non-space at either end, as emphasis
 * is, so a lone `==` in prose highlights nothing and an arithmetic line is
 * left alone.
 */
/* Written without a lookbehind, which the plugin guidelines set aside for
   mobile: the closing rule -- no space or equals against the final marks --
   is said by the last character class instead. */
export const HIGHLIGHT_PATTERN = /==(?![\s=])(?:[^\n]*?[^\s=\n])?==/gu;
/**
 * A callout's `[!type]`, with the fold marker that may follow it. It names
 * the box rather than saying anything inside it, and the title written after
 * it on the same line is writing like any other.
 */
export const CALLOUT_KIND_PATTERN = /^[ \t]*(?:>[ \t]*)+(\[![^\]\n]*\][+-]?)/gmu;
/**
 * A footnote's marker: the reference, which the page replaces with a number
 * the author never typed, and the label that opens its definition. What the
 * definition then says is writing and stays.
 */
export const FOOTNOTE_MARK_PATTERN = /^[ \t]*\[\^[^\]\s]+\]:|\[\^[^\]\s]+\]/gmu;

/**
 * One wikilink as it stands in the body. `visibleFrom`/`visibleTo` bound the
 * text the page shows for it -- the alias when one is written, the target
 * otherwise -- as offsets into the same body, because the shown text is a
 * literal slice of the source. An embed shows another note's content, none of
 * it written here, so its visible span is empty at the link's start.
 */
export interface WikilinkSpan {
	from: number;
	to: number;
	embed: boolean;
	target: string;
	visibleFrom: number;
	visibleTo: number;
}

export function wikilinkSpans(body: string): WikilinkSpan[] {
	const spans: WikilinkSpan[] = [];
	for (const match of body.matchAll(WIKILINK_PATTERN)) {
		const embed = match[1] === '!';
		const target = match[2] ?? '';
		const alias = match[3];
		const from = match.index;
		const shownFrom =
			from + 2 + (embed ? 1 : 0) + (alias === undefined ? 0 : target.length + 1);
		spans.push({
			from,
			to: from + match[0].length,
			embed,
			target,
			visibleFrom: embed ? from : shownFrom,
			visibleTo: embed ? from : shownFrom + (alias ?? target).length,
		});
	}
	return spans;
}

/**
 * Three or more tildes, which CommonMark reads as a code fence when they
 * open a line -- and an unclosed fence swallows the rest of the note. This
 * layer serves writers' tools: the tildes a writer types are strikethrough
 * markers, and the `~~~~` an empty strikethrough leaves on a line, or a
 * deleted placeholder leaves behind, must never take a chapter off a scan.
 * So the parser is shown the body with every such run masked by a
 * same-length run of plain punctuation -- same length, so every range it
 * reports still indexes the original body -- and tilde fences do not exist
 * for it. Backtick fences keep meaning code. Nothing else changes hands: a
 * run of three or more tildes is never a strikethrough delimiter, so the
 * page shows it as the literal marks it is.
 */
const TILDE_RUN = /~{3,}/gu;

export function maskTildeFences(body: string): string {
	return body.replace(TILDE_RUN, (run) => ','.repeat(run.length));
}

/**
 * Where a pair of tilde fences stands, as the page reads them.
 *
 * A scan built on `maskTildeFences` does not read a tilde fence as code, but
 * Obsidian does, and the one place that difference can be felt is the comment
 * marker: `%%` inside a fence opens nothing on the page, and if a scan let it
 * open a comment there, an author writing *about* Obsidian's own syntax would
 * silently lose every word below it. So a matched pair is found here by the
 * text alone, for the callers that need those markers left inert.
 */
const TILDE_FENCE_OPEN = /^ {0,3}(~{3,})[^\n]*$/u;
const TILDE_FENCE_CLOSE = /^ {0,3}(~{3,})\s*$/u;

export function tildeFenceRanges(body: string): CountableRange[] {
	const ranges: CountableRange[] = [];
	let at = 0;
	let open: { from: number; width: number } | null = null;
	for (const line of body.split('\n')) {
		const end = at + line.length;
		if (open === null) {
			const found = TILDE_FENCE_OPEN.exec(line);
			if (found?.[1] !== undefined) open = { from: at, width: found[1].length };
		} else {
			const found = TILDE_FENCE_CLOSE.exec(line);
			if (found?.[1] !== undefined && found[1].length >= open.width) {
				ranges.push({ from: open.from, to: end });
				open = null;
			}
		}
		at = end + 1;
	}
	return ranges;
}

/**
 * Where Obsidian comments hide the body: each `%%` pair, and an unclosed
 * `%%` to the end of the note, which is how the page renders it. A `%%`
 * inside code opens nothing -- code is shown as written, so a comment marker
 * quoted in a fence or a span must not swallow the chapter under it -- and
 * `insideCode` is the caller's word on where that is.
 */
export function hiddenCommentRanges(
	body: string,
	insideCode: (at: number) => boolean,
): CountableRange[] {
	const ranges: CountableRange[] = [];
	const nextMarker = (from: number): number => {
		for (let at = from; at <= body.length; ) {
			const found = body.indexOf('%%', at);
			if (found === -1) return -1;
			if (!insideCode(found)) return found;
			at = found + 2;
		}
		return -1;
	};
	for (let at = 0; ; ) {
		const open = nextMarker(at);
		if (open === -1) break;
		const close = nextMarker(open + 2);
		if (close === -1) {
			ranges.push({ from: open, to: body.length });
			break;
		}
		ranges.push({ from: open, to: close + 2 });
		at = close + 2;
	}
	return ranges;
}
