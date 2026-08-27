/**
 * Where a note's prose sits in its body: the stretches of original text a
 * matcher may read, each bounded exactly, so anything found inside one
 * carries offsets straight into the source.
 *
 * `countable-prose.ts` answers what the page shows and may substitute -- a
 * link its display text, an escape its character -- because a count only
 * needs the words. A matcher needs the offsets too, so nothing here is ever
 * substituted: a stretch is either the body verbatim or it is not offered at
 * all. The one asymmetry that follows: an entity spelled through `&amp;` or
 * split by a hard break is not matchable, because the page's version of it
 * is not in the source.
 *
 * Syntax splits prose into separate ranges, and a match never spans ranges:
 * `A**lice**` holds no Alice, a name interrupted by a comment holds nothing
 * either. That is the deliberate trade for exactness -- the page may show the
 * pieces joined, but the source does not, and these offsets are the source's.
 *
 * The grammar and the hand-finds for Obsidian's own syntax are shared with
 * the counting rule through `markdown-scan.ts`, so the two never disagree
 * about where a link, a fence or a comment stands. Headings are prose here,
 * always: a name in a chapter title is a mention.
 *
 * Kept free of Obsidian types and of the DOM.
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
	type WikilinkSpan,
	hiddenCommentRanges,
	maskTildeFences,
	scanParser,
	tildeFenceRanges,
	wikilinkSpans,
} from './markdown-scan';

/**
 * One stretch of matchable prose. `link` is set when the stretch is the
 * visible text of a wikilink -- the alias, or the target of a bare link --
 * and names where that link points, so a match inside it can be told from
 * the same words standing free.
 */
export interface AnalyzableRange {
	from: number;
	to: number;
	link: { target: string } | null;
}

/**
 * The body's prose as ranges over the original text, everything that is not
 * the author's matchable writing taken out: markup, code, comments, hidden
 * syntax, and every stretch of `excludeRanges` -- plugin-written sections,
 * or whatever else this analysis is told is not its business.
 */
export function analyzableRanges(
	body: string,
	excludeRanges: readonly CountableRange[] = [],
): AnalyzableRange[] {
	// A range whose ends arrive the wrong way round holds nothing -- an empty
	// managed section reports its content ending one character before it
	// starts -- and read as written it would rewind the walk at the end of
	// this function.
	const removed: CountableRange[] = excludeRanges.map(({ from, to }) => ({
		from,
		to: Math.max(from, to),
	}));

	// A link's visible text is prose with an address; everything around it is
	// syntax. An embed shows another note's content, none of it written here.
	const links = wikilinkSpans(body);
	for (const span of links) {
		if (span.embed) {
			removed.push({ from: span.from, to: span.to });
			continue;
		}
		removed.push(
			{ from: span.from, to: span.visibleFrom },
			{ from: span.visibleTo, to: span.to },
		);
	}
	const insideWikilink = (from: number, to: number): boolean =>
		links.some((span) => from >= span.from && to <= span.to);

	// The marks Obsidian draws that no grammar knows, each shielded inside a
	// wikilink the same way the counting rule shields them: what a link shows
	// is spoken for already.
	const dropOutsideWikilinks = (from: number, to: number): void => {
		if (insideWikilink(from, to)) return;
		removed.push({ from, to });
	};
	for (const match of body.matchAll(HIGHLIGHT_PATTERN)) {
		const from = match.index;
		const to = from + match[0].length;
		// Only the pairs: what they hold is prose.
		if (insideWikilink(from, to)) continue;
		removed.push({ from, to: from + 2 }, { from: to - 2, to });
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
	const codeRanges: CountableRange[] = [];
	scanParser.parse(maskTildeFences(body)).iterate({
		enter: (node) => {
			if (insideWikilink(node.from, node.to)) return false;
			if (node.name === 'Autolink') {
				autolinks += 1;
				return true;
			}
			if (CODE_NODES.has(node.name)) {
				codeRanges.push({ from: node.from, to: node.to });
				removed.push({ from: node.from, to: node.to });
				return false;
			}
			if (MARK_NODES.has(node.name) || SILENT_NODES.has(node.name)) {
				removed.push({ from: node.from, to: node.to });
				return false;
			}
			if (node.name === 'URL' && autolinks === 0) {
				removed.push({ from: node.from, to: node.to });
				return false;
			}
			// A hard break's page form is a space and an entity's is a decoded
			// character, neither of which stands in the source: not matchable.
			if (node.name === 'HardBreak' || node.name === 'Entity') {
				removed.push({ from: node.from, to: node.to });
				return false;
			}
			// The backslash is syntax; the character it protects is the body's
			// own and stays, one character wide, at its own offset.
			if (node.name === 'Escape') {
				removed.push({ from: node.from, to: node.from + 1 });
				return false;
			}
			return true;
		},
		leave: (node) => {
			if (node.name === 'Autolink') autolinks -= 1;
		},
	});

	// A tilde fence is not code to this reading, but its contents are still
	// shown as written, so a comment marker inside one opens nothing.
	const inert = [...codeRanges, ...tildeFenceRanges(body)];
	const insideCode = (at: number): boolean =>
		inert.some((range) => at >= range.from && at < range.to);
	removed.push(...hiddenCommentRanges(body, insideCode));
	for (const match of body.matchAll(BLOCK_ID_PATTERN)) {
		removed.push({ from: match.index, to: match.index + match[0].length });
	}

	// What is left between the removals is the prose. A piece is inside a
	// link's visible text entirely or not at all: the link's own syntax
	// removal ends exactly where the visible text begins and resumes exactly
	// where it ends, so no piece can straddle the edge.
	const linkAt = (from: number, to: number): AnalyzableRange['link'] => {
		const owner = links.find(
			(span: WikilinkSpan) =>
				!span.embed && from >= span.visibleFrom && to <= span.visibleTo,
		);
		return owner === undefined ? null : { target: owner.target.trim() };
	};
	const sorted = removed
		.filter((range) => range.to > range.from)
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const ranges: AnalyzableRange[] = [];
	let cursor = 0;
	const keep = (from: number, to: number): void => {
		if (to > from) ranges.push({ from, to, link: linkAt(from, to) });
	};
	for (const range of sorted) {
		if (range.from > cursor) keep(cursor, range.from);
		cursor = Math.max(cursor, range.to);
	}
	keep(cursor, body.length);
	return ranges;
}
