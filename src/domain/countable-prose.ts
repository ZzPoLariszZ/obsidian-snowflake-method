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
 * The parser knows CommonMark and nothing Obsidian added to it, so wikilinks,
 * `%%` comments, and block IDs are found by hand first. Everything works in
 * ranges over the one original body, so the two passes cannot disagree about
 * where anything is.
 *
 * Kept free of Obsidian types and of the DOM, so all of it can be exercised
 * without a workspace.
 */

import { parser as markdownParser } from '@lezer/markdown';

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
 * heading the count would have read -- and leaves every heading after it,
 * including a later H1 the author wrote themselves. `skip-h1` passes over
 * every level-1 heading. `skip-all` passes over every level, leaving only
 * what is written under them.
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

/** Syntax drawn around the prose rather than read as part of it. */
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

/** Obsidian's own syntax, which the CommonMark grammar reads as plain text. */
const WIKILINK = /(!?)\[\[([^\]\n]*?)(?:\|([^\]\n]*))?\]\]/gu;
const BLOCK_ID = /(?:^|[ \t])\^[A-Za-z0-9-]+$/gmu;

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
 */
export function countableProse(
	body: string,
	excludeRanges: readonly CountableRange[] = [],
	options: CountableProseOptions = { headings: 'count' },
): string {
	const drops: Elision[] = excludeRanges.map(({ from, to }) => ({ from, to }));
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

	// Obsidian comments hide everything to the closing `%%`, and an unclosed
	// one hides everything to the end of the note, which is how the page
	// renders it.
	let at = 0;
	for (;;) {
		const open = body.indexOf('%%', at);
		if (open === -1) break;
		const close = body.indexOf('%%', open + 2);
		if (close === -1) {
			drops.push({ from: open, to: body.length });
			break;
		}
		drops.push({ from: open, to: close + 2 });
		at = close + 2;
	}

	for (const match of body.matchAll(BLOCK_ID)) {
		drops.push({ from: match.index, to: match.index + match[0].length });
	}

	// Everything hidden before a word of CommonMark was read: excluded
	// sections, embeds, comments, block IDs. A title looked for below is the
	// first one the count would have read, so a heading in here is not it.
	const hiddenAlready = [...drops];
	const isHidden = (from: number, to: number): boolean =>
		hiddenAlready.some((range) => from < range.to && to > range.from);

	// Inside `<https://…>` the URL is the link's own text; everywhere else it
	// is the half of a link the page never shows.
	let autolinks = 0;
	let titleSkipped = false;
	markdownParser.parse(body).iterate({
		enter: (node) => {
			if (insideWikilink(node.from, node.to)) return false;
			if (skippedHeadings !== null && skippedHeadings.has(node.name)) {
				// A title is spent once. The iterate runs in document order, so
				// the first level-1 heading that is not hidden already is the
				// one at the top of the note.
				const skipThis =
					!titleOnly || (!titleSkipped && !isHidden(node.from, node.to));
				if (skipThis) {
					titleSkipped = true;
					drops.push({ from: node.from, to: node.to });
					return false;
				}
			}
			if (node.name === 'Autolink') {
				autolinks += 1;
				return true;
			}
			if (
				MARKS.has(node.name) ||
				SILENT.has(node.name) ||
				CODE.has(node.name)
			) {
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
