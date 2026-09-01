/**
 * What a note's body says, with everything that is not writing taken out.
 *
 * A counting rule needs the words the page shows and nothing else: no
 * heading marks, no code, no comments, no half of a link the reader never
 * sees. `prose-projection.ts` answers a different question with the same
 * grammar -- where rendered words sit in the source -- and drops all
 * whitespace to do it, which is exactly what a counter cannot afford: two
 * words with their space removed are one. So this is a sibling rather than a
 * caller: the same elision idiom, tuned so that what remains still reads as
 * text.
 *
 * The grammar, and the finding of everything Obsidian added that no grammar
 * reads -- wikilinks, `%%` comments, block IDs, highlights, callout kinds,
 * footnote markers, and the tilde-fence masking -- live in
 * `markdown-scan.ts`, shared with the analysis that asks where the prose
 * sits, so the two can never disagree about where anything is. Everything
 * works in ranges over the one original body.
 *
 * Kept free of Obsidian types and of the DOM, so all of it can be exercised
 * without a workspace.
 */

import {
	BLOCK_ID_PATTERN,
	CALLOUT_KIND_PATTERN,
	CODE_NODES,
	type CountableRange,
	FOOTNOTE_MARK_PATTERN,
	HIGHLIGHT_PATTERN,
	MARK_NODES,
	SILENT_NODES,
	hiddenCommentRanges,
	maskTildeFences,
	scanParser,
	tildeFenceRanges,
	wikilinkSpans,
} from './markdown-scan';

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
	/**
	 * What stands where each of `excludeRanges` was taken out. Nothing by
	 * default, because the page closes what it hides. Counting a set of
	 * stretches on their own is the other case: named by the gaps between
	 * them, they would run together where a gap was, and one quoted line and
	 * the next are two pieces of dialogue rather than one word reaching
	 * through the narration between. Whitespace is the separator to ask for
	 * -- every convention here passes over it, so it adds nothing to a count
	 * while still closing a run.
	 */
	separator?: string;
}

/**
 * Headings by level, each name covering both spellings Markdown allows: `#`
 * before the text, and the row of `=` or `-` under it. Their marks are in
 * MARK_NODES already, so these sets matter only when the text itself is
 * dropped.
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

/**
 * The body as countable text: marker and syntax characters spliced out,
 * link display text left in their place, and every stretch of `excludeRanges`
 * removed with the rest. Whitespace survives untouched, so words keep the
 * separation the source gave them; nothing new is inserted between what
 * remains unless `options.separator` asks for it, because the page does not
 * separate them either -- a comment between two halves of a word hides, and
 * the halves close up.
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
	// Only what the CALLER excluded may carry the separator: the syntax drops
	// below take marks out of the middle of words, and a gap opened there
	// would split one word into two.
	const drops: Elision[] = excludeRanges.map(({ from, to }) => ({
		from,
		to: Math.max(from, to),
		...(options.separator === undefined ? {} : { emit: options.separator }),
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
	for (const span of wikilinkSpans(body)) {
		const range = { from: span.from, to: span.to };
		wikilinks.push(range);
		if (span.embed) {
			drops.push(range);
			continue;
		}
		emits.push({ ...range, emit: body.slice(span.visibleFrom, span.visibleTo) });
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
	for (const match of body.matchAll(HIGHLIGHT_PATTERN)) {
		const from = match.index;
		const to = from + match[0].length;
		// Only the pairs: what they hold is prose, and may hold a link of its own.
		if (insideWikilink(from, to)) continue;
		drops.push({ from, to: from + 2 }, { from: to - 2, to });
	}
	for (const match of body.matchAll(CALLOUT_KIND_PATTERN)) {
		// The group ends the match, so its start is that much back from the end.
		const kind = match[1] ?? '';
		const to = match.index + match[0].length;
		dropOutsideWikilinks(to - kind.length, to);
	}
	for (const match of body.matchAll(FOOTNOTE_MARK_PATTERN)) {
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
	scanParser.parse(maskTildeFences(body)).iterate({
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
			if (CODE_NODES.has(node.name)) {
				codeRanges.push({ from: node.from, to: node.to });
				return false;
			}
			if (MARK_NODES.has(node.name) || SILENT_NODES.has(node.name)) {
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
	// A tilde fence is not code to this counter, but its contents are still
	// shown as written, so a comment marker inside one opens nothing.
	const inert = [...codeRanges, ...tildeFenceRanges(body)];
	const insideCode = (at: number): boolean =>
		inert.some((range) => at >= range.from && at < range.to);
	hidden.push(...hiddenCommentRanges(body, insideCode));

	for (const match of body.matchAll(BLOCK_ID_PATTERN)) {
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
