/**
 * What a note's body says, with everything that is not writing taken out.
 *
 * A counting rule needs the words the page shows and nothing else: no
 * heading marks, no code, no comments, no half of a link the reader never
 * sees. `prose-projection.ts` answers a different question with the same
 * grammar -- where rendered words sit in the source -- and drops all
 * whitespace to do it, which is exactly what a counter cannot afford: two
 * words with their space removed are one. So this is a sibling rather than a
 * caller: the same parser, the same elision idiom, tuned so that what
 * remains still reads as text.
 *
 * The grammar is CommonMark plus the three GitHub extensions Obsidian
 * renders -- tables, task lists, strikethrough -- and knows nothing of what
 * Obsidian added on its own, so wikilinks, `%%` comments, block IDs,
 * highlights, callout kinds and footnote markers are found by hand first.
 * Everything works in ranges over the one original body, so the two passes
 * cannot disagree about where anything is.
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
const markdownParser = commonMarkParser.configure([
	Table,
	TaskList,
	Strikethrough,
]);

/** A stretch of the body that is not the author's writing. */
export interface CountableRange {
	from: number;
	to: number;
}

export const WRITING_COUNT_HEADINGS = [
	'count',
	'skip-first-h1',
	'skip-h1',
	'skip-all',
] as const;

/**
 * What a heading line is worth to the count. `count` reads it as the writing
 * it is, which is what every counting tool does with a line of text.
 * `skip-first-h1` passes over the note's title alone -- the first level-1
 * heading the page shows -- and leaves every heading after it, including a
 * later H1 the author wrote themselves. `skip-h1` passes over every level-1
 * heading. `skip-all` passes over every level, leaving only what is written
 * under them.
 */
export type WritingCountHeadings = (typeof WRITING_COUNT_HEADINGS)[number];

export function isWritingCountHeadings(
	value: unknown,
): value is WritingCountHeadings {
	return (
		value === 'count' ||
		value === 'skip-first-h1' ||
		value === 'skip-h1' ||
		value === 'skip-all'
	);
}

export interface CountableProseOptions {
	headings: WritingCountHeadings;
}

/**
 * Syntax drawn around the prose rather than read as part of it. The last
 * three come with the GitHub extensions: `TableDelimiter` is every `|` and
 * the whole `| --- |` row under a header, `TaskMarker` the `[ ]` a checkbox
 * is drawn from, `StrikethroughMark` the `~~` pairs around text that is still
 * on the page and still counts.
 */
const MARKS = new Set([
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
const SILENT = new Set([
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

/** Code is written, but it is not writing. Dropped whole, fences and all. */
const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode']);

/**
 * Headings by level, each name covering both spellings Markdown allows: `#`
 * before the text, and the row of `=` or `-` under it. Their marks are in
 * MARKS already, so these sets matter only when the text itself is dropped.
 */
const HEADING_1 = new Set(['ATXHeading1', 'SetextHeading1']);
const HEADINGS = new Set([
	'ATXHeading1',
	'ATXHeading2',
	'ATXHeading3',
	'ATXHeading4',
	'ATXHeading5',
	'ATXHeading6',
	'SetextHeading1',
	'SetextHeading2',
]);

/**
 * A stretch of source the countable text does not carry verbatim: markup,
 * which contributes nothing, or a construct that contributes something
 * shorter than itself -- a link its display text, an escape its character.
 */
interface Elision {
	from: number;
	to: number;
	emit?: string;
}

/** Obsidian's own syntax, which no Markdown grammar reads as anything. */
const WIKILINK = /(!?)\[\[([^\]\n]*?)(?:\|([^\]\n]*))?\]\]/gu;
const BLOCK_ID = /(?:^|[ \t])\^[A-Za-z0-9-]+$/gmu;
/**
 * A highlight shows what is between its `==` pairs and nothing of the pairs
 * themselves. Held to one line and to a non-space at either end, as emphasis
 * is, so a lone `==` in prose highlights nothing and an arithmetic line is
 * left alone.
 */
const HIGHLIGHT = /==(?![\s=])[^\n]*?(?<![\s=])==/gu;
/**
 * A callout's `[!type]`, with the fold marker that may follow it. It names
 * the box rather than saying anything inside it, and the title written after
 * it on the same line is writing like any other.
 */
const CALLOUT_KIND = /^[ \t]*(?:>[ \t]*)+(\[![^\]\n]*\][+-]?)/gmu;
/**
 * A footnote's marker: the reference, which the page replaces with a number
 * the author never typed, and the label that opens its definition. What the
 * definition then says is writing and stays.
 */
const FOOTNOTE_MARK = /^[ \t]*\[\^[^\]\s]+\]:|\[\^[^\]\s]+\]/gmu;

/**
 * The body as countable text: marker and syntax characters spliced out,
 * link display text left in their place, and every stretch of `excludeRanges`
 * removed with the rest. Whitespace survives untouched, so words keep the
 * separation the source gave them; nothing new is inserted between what
 * remains, because the page does not separate them either -- a comment
 * between two halves of a word hides, and the halves close up.
 *
 * Headings are writing unless `options` says otherwise, and a heading passed
 * over takes everything on its line with it, links and emphasis included.
 *
 * `excludeRanges` say what is not part of *this* count -- a plugin-written
 * section, or everything outside the piece being counted. They are not the
 * same as text the page does not show, which is why the note's title is
 * looked for without them: counting one section of a note must not promote
 * that section's own heading to a title the note already has.
 */
export function countableProse(
	body: string,
	excludeRanges: readonly CountableRange[] = [],
	options: CountableProseOptions = { headings: 'count' },
): string {
	// A range whose ends arrive the wrong way round holds nothing -- an empty
	// managed section reports its content ending one character before it starts
	// -- and read as written it would rewind the splice at the end of this
	// function and emit its stretch twice instead of removing it.
	const drops: Elision[] = excludeRanges.map(({ from, to }) => ({
		from,
		to: Math.max(from, to),
	}));
	const emits: Elision[] = [];
	const skippedHeadings =
		options.headings === 'skip-all'
			? HEADINGS
			: options.headings === 'skip-h1' || options.headings === 'skip-first-h1'
				? HEADING_1
				: null;
	const titleOnly = options.headings === 'skip-first-h1';

	// An embed shows another note's content, none of which is this note's
	// writing; a link shows its display text, or its target's name when it
	// has none. Found before the parse runs, because the grammar reads the
	// inner `[…]` as a reference link of its own, and those link marks must
	// not count as findings of their own inside a range that is already
	// spoken for.
	const wikilinks: CountableRange[] = [];
	for (const match of body.matchAll(WIKILINK)) {
		const range = { from: match.index, to: match.index + match[0].length };
		wikilinks.push(range);
		if (match[1] === '!') {
			drops.push(range);
			continue;
		}
		emits.push({ ...range, emit: match[3] ?? match[2] ?? '' });
	}
	const insideWikilink = (from: number, to: number): boolean =>
		wikilinks.some((range) => from >= range.from && to <= range.to);

	// The marks Obsidian draws that no grammar knows. Each drops the syntax and
	// leaves what the page shows in its place. A wikilink is spoken for already
	// and its emitted display text must not be cut from underneath, so anything
	// found inside one is left where it is.
	const dropOutsideWikilinks = (from: number, to: number): void => {
		if (insideWikilink(from, to)) return;
		drops.push({ from, to });
	};
	for (const match of body.matchAll(HIGHLIGHT)) {
		const from = match.index;
		const to = from + match[0].length;
		// Only the pairs: what they hold is prose, and may hold a link of its own.
		if (insideWikilink(from, to)) continue;
		drops.push({ from, to: from + 2 }, { from: to - 2, to });
	}
	for (const match of body.matchAll(CALLOUT_KIND)) {
		// The group ends the match, so its start is that much back from the end.
		const kind = match[1] ?? '';
		const to = match.index + match[0].length;
		dropOutsideWikilinks(to - kind.length, to);
	}
	for (const match of body.matchAll(FOOTNOTE_MARK)) {
		dropOutsideWikilinks(match.index, match.index + match[0].length);
	}

	// Inside `<https://…>` the URL is the link's own text; everywhere else it
	// is the half of a link the page never shows.
	let autolinks = 0;
	// Where code sits, and where the headings are. Both are wanted after the
	// walk rather than during it: `%%` inside code opens no comment, and which
	// heading is the note's title cannot be told until the comments are known.
	const codeRanges: CountableRange[] = [];
	const headings: CountableRange[] = [];
	markdownParser.parse(body).iterate({
		enter: (node) => {
			if (insideWikilink(node.from, node.to)) return false;
			if (skippedHeadings !== null && skippedHeadings.has(node.name)) {
				headings.push({ from: node.from, to: node.to });
				// Kept open: a heading that turns out to stay still needs its
				// own `#` marks dropped from underneath it.
			}
			if (node.name === 'Autolink') {
				autolinks += 1;
				return true;
			}
			if (CODE.has(node.name)) {
				codeRanges.push({ from: node.from, to: node.to });
				return false;
			}
			if (MARKS.has(node.name) || SILENT.has(node.name)) {
				drops.push({ from: node.from, to: node.to });
				return false;
			}
			if (node.name === 'URL' && autolinks === 0) {
				drops.push({ from: node.from, to: node.to });
				return false;
			}
			// The backslash is syntax; the newline it precedes still breaks the
			// line on the page, so a space stands in for the pair.
			if (node.name === 'HardBreak') {
				emits.push({ from: node.from, to: node.to, emit: ' ' });
				return false;
			}
			if (node.name === 'Escape') {
				// `\*` on the page is `*`.
				emits.push({
					from: node.from,
					to: node.to,
					emit: body.slice(node.from + 1, node.to),
				});
				return false;
			}
			// An entity is its author's spelling of one mark or one space.
			// Decoding it buys one punctuation character at most; read as raw
			// text, `&amp;` would put a word on the page that is not there. A
			// space is the one stand-in that can never be counted and never
			// fuses its neighbours.
			if (node.name === 'Entity') {
				emits.push({ from: node.from, to: node.to, emit: ' ' });
				return false;
			}
			return true;
		},
		leave: (node) => {
			if (node.name === 'Autolink') autolinks -= 1;
		},
	});

	// Everything the page itself does not show for a reason other than markup:
	// code, comments, block IDs. A heading inside any of it was never going to
	// be read, so it cannot be the note's title -- whereas a heading's own `#`
	// marks are in `drops` and overlap every heading, which is why that list
	// cannot stand in for this one. What the caller excluded is deliberately
	// not here: those stretches are off this count, not off the page.
	const hidden: CountableRange[] = [...codeRanges];
	const insideCode = (at: number): boolean =>
		codeRanges.some((range) => at >= range.from && at < range.to);
	// Obsidian comments hide everything to the closing `%%`, and an unclosed
	// one hides everything to the end of the note, which is how the page
	// renders it. A `%%` inside code opens nothing: code is shown as written,
	// so a comment marker quoted in a fence or a span must not swallow the
	// chapter under it.
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
			hidden.push({ from: open, to: body.length });
			break;
		}
		hidden.push({ from: open, to: close + 2 });
		at = close + 2;
	}

	for (const match of body.matchAll(BLOCK_ID)) {
		hidden.push({ from: match.index, to: match.index + match[0].length });
	}

	const isHidden = (range: CountableRange): boolean =>
		hidden.some((other) => range.from < other.to && range.to > other.from);
	// A title is spent once, on the first level-1 heading the page shows.
	// `headings` is in document order, so the first that is not hidden is the
	// one at the top of the note -- and it stays that one however little of the
	// note this count covers, so a section holding an author's own H1 counts it
	// exactly as the note's own total does.
	let titleSkipped = false;
	for (const heading of headings) {
		if (titleOnly && (titleSkipped || isHidden(heading))) continue;
		titleSkipped = true;
		drops.push(heading);
	}
	drops.push(...hidden);

	// An emit inside a dropped stretch -- a wikilink in a code fence, in a
	// comment, in an excluded section -- is already not on the page; its
	// display text must not escape the removal.
	const surviving = emits.filter(
		(emit) => !drops.some((drop) => emit.from < drop.to && emit.to > drop.from),
	);

	const elisions = [...drops, ...surviving].sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
	const kept: string[] = [];
	let cursor = 0;
	for (const elision of elisions) {
		if (elision.from > cursor) kept.push(body.slice(cursor, elision.from));
		if (elision.emit !== undefined && elision.to > cursor) {
			kept.push(elision.emit);
		}
		cursor = Math.max(cursor, elision.to);
	}
	kept.push(body.slice(cursor));
	return kept.join('');
}
