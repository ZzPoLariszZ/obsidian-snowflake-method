/**
 * Where a passage of rendered prose sits in the Markdown behind it.
 *
 * The words on the page and the words in the file are the same words, but the
 * file holds them inside markup the page never shows: emphasis marks, heading
 * marks, link targets, the newline of a soft break. Looking the rendered words
 * up in the raw source fails the moment they cross any of it, and every
 * failure used to fall back to a guess by screen height — the guess that
 * drifted, and drifted worst at the end of long notes, where the most layout
 * sat above it.
 *
 * So the source is projected first: parsed with the same grammar the editor
 * highlights with, its syntax stripped, its whitespace dropped, and every
 * surviving character remembering where in the source it came from. Rendered
 * text given the same stripping matches it exactly — across emphasis, links,
 * wikilinks and embeds, headings, soft breaks and paragraph joins alike — and
 * the match maps back to the precise character the pointer was on.
 *
 * Whitespace is dropped rather than collapsed because the page is not even
 * consistent about it: a soft break renders as a `<br>` whose textContent is
 * nothing, so `A\nB` reads back as `AB`, and paragraphs join the same way.
 * Removing it on both sides is the one rule that survives every case, and
 * prose keeps plenty to match on without it.
 *
 * Kept free of Obsidian types and of the DOM, in the manner of
 * `manuscript-window.ts`, so all of it can be exercised without a workspace.
 */

import { parser as markdownParser } from '@lezer/markdown';

import { decodeEntity, firstAtOrAfter, wikilinkSpans } from '../domain';

export interface ProseProjection {
	/** The prose alone: syntax stripped, whitespace dropped. */
	text: string;
	/** Where projected character `i` sits in the source. */
	sourceIndexOf: number[];
	/**
	 * The syntax that closes a run of prose -- the second half of an
	 * emphasis, the target half of a link, a wikilink's closing brackets --
	 * by the source position each piece starts at. A caret meant for the
	 * end of the prose belongs after these, not between the last letter and
	 * them.
	 */
	closers: ReadonlyMap<number, Closer>;
	/**
	 * The source end of a character that stands for more source units than
	 * its own -- an entity's decoded character -- by the source position the
	 * character answers to. A caret put after such a character goes here,
	 * not one unit on.
	 */
	spans: ReadonlyMap<number, number>;
}

export interface Closer {
	/** Where this piece of syntax ends. */
	to: number;
	/**
	 * Where the construct it belongs to ends: a link's target may hold a
	 * space before its title, and the walk over the closers steps over that
	 * too, but never past here.
	 */
	reach: number;
}

const WHITESPACE = /\s/;

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

/** Constructs that put no text of their own on the page. */
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
	// A backslash before the newline, and the backslash is not whitespace.
	'HardBreak',
]);

/**
 * A stretch of source the projection does not carry verbatim: markup, which
 * contributes nothing, or an escape or entity, which contributes the character
 * it stood for — recorded with the source position that character answers to.
 * Markup remembers where the construct it belongs to ends, which is what tells
 * its closing half from its opening half once the prose has been projected.
 */
interface Elision {
	from: number;
	to: number;
	emit?: string;
	at?: number;
	reach?: number;
}

/** Regions the page shows verbatim, wikilink syntax included. */
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);

export function projectProse(source: string): ProseProjection {
	const elisions: Elision[] = [];
	const codeRanges: { from: number; to: number }[] = [];
	// Inside `<https://…>` the URL is the link's own text; everywhere else it is
	// the half of a link the page never shows.
	let autolinks = 0;
	markdownParser.parse(source).iterate({
		enter: (node) => {
			if (node.name === 'Autolink') {
				autolinks += 1;
				return true;
			}
			if (CODE.has(node.name)) {
				codeRanges.push({ from: node.from, to: node.to });
				return true;
			}
			if (MARKS.has(node.name)) {
				elisions.push({
					from: node.from,
					to: node.to,
					reach: node.node.parent?.to,
				});
				return false;
			}
			if (SILENT.has(node.name)) {
				elisions.push({ from: node.from, to: node.to });
				return false;
			}
			if (node.name === 'URL' && autolinks === 0) {
				elisions.push({
					from: node.from,
					to: node.to,
					reach: node.node.parent?.to,
				});
				return false;
			}
			if (node.name === 'Escape') {
				// `\*` on the page is `*`, standing at the character's own offset.
				elisions.push({
					from: node.from,
					to: node.to,
					emit: source.slice(node.from + 1, node.to),
					at: node.from + 1,
				});
				return false;
			}
			if (node.name === 'Entity') {
				// One it cannot name is passed through as the page passes it through:
				// as the characters it is written in.
				const written = source.slice(node.from, node.to);
				elisions.push({
					from: node.from,
					to: node.to,
					emit: decodeEntity(written) ?? written,
					at: node.from,
				});
				return false;
			}
			return true;
		},
		leave: (node) => {
			if (node.name === 'Autolink') autolinks -= 1;
		},
	});

	// Wikilinks are Obsidian's, not Markdown's: the grammar above reads
	// `[[path|alias]]` as prose with brackets while the page shows the alias
	// alone, and every passage overlapping a link used to fail its lookup for
	// it. The shown text is a literal slice of the source, so a link projects
	// as its visible half with the rest elided -- an embed shows nothing of
	// its own line at all. A link inside code stands verbatim on the page and
	// is left alone, and one swallowed whole by something already hidden (a
	// comment, say) defers to it; only the bracket noise the grammar found
	// wholly inside a surviving link is discarded.
	const links = wikilinkSpans(source).filter(
		(link) =>
			!codeRanges.some((code) => link.from < code.to && code.from < link.to) &&
			!elisions.some(
				(kept) =>
					kept.from < link.to &&
					link.from < kept.to &&
					!(kept.from >= link.from && kept.to <= link.to),
			),
	);
	if (links.length > 0) {
		const survivors = elisions.filter(
			(kept) =>
				!links.some((link) => kept.from >= link.from && kept.to <= link.to),
		);
		for (const link of links) {
			if (link.embed) {
				survivors.push({ from: link.from, to: link.to });
				continue;
			}
			survivors.push({ from: link.from, to: link.visibleFrom });
			survivors.push({ from: link.visibleTo, to: link.to, reach: link.to });
		}
		survivors.sort((left, right) => left.from - right.from);
		elisions.length = 0;
		elisions.push(...survivors);
	}

	// One pass over the source, stepping around the elisions — which arrive in
	// document order, none inside another, because a skipped subtree was never
	// descended into. Indexed by UTF-16 unit throughout, the same unit
	// `indexOf` and the editor count in, so an astral character cannot put the
	// two sides out of step.
	const text: string[] = [];
	const sourceIndexOf: number[] = [];
	const keep = (chunk: string, position: (index: number) => number): void => {
		for (let index = 0; index < chunk.length; index += 1) {
			const char = chunk.charAt(index);
			if (WHITESPACE.test(char)) continue;
			text.push(char);
			sourceIndexOf.push(position(index));
		}
	};
	let cursor = 0;
	for (const elision of elisions) {
		if (elision.from > cursor) {
			const from = cursor;
			keep(source.slice(from, elision.from), (index) => from + index);
		}
		if (elision.emit !== undefined && elision.emit !== '') {
			const at = elision.at ?? elision.from;
			keep(elision.emit, () => at);
		}
		cursor = Math.max(cursor, elision.to);
	}
	keep(source.slice(cursor), (index) => cursor + index);

	// The markup with nothing of its own construct left to show after it: the
	// closing star of an emphasis, everything from a link's `]` to its `)`.
	// Whatever opens a construct has that construct's text after it and is
	// left out, so a caret put after a word never steps into the emphasis
	// that begins at the word's next letter.
	const closers = new Map<number, Closer>();
	for (const elision of elisions) {
		if (elision.reach === undefined) continue;
		const following = sourceIndexOf[firstAtOrAfter(sourceIndexOf, elision.to)];
		if (following === undefined || following >= elision.reach) {
			closers.set(elision.from, { to: elision.to, reach: elision.reach });
		}
	}
	// A character decoded from an entity stands for the whole reference: a
	// caret put after it goes past the `;`, not one unit into the `&amp;`.
	const spans = new Map<number, number>();
	for (const elision of elisions) {
		if (elision.emit === undefined || elision.emit === '') continue;
		const at = elision.at ?? elision.from;
		if (elision.to - at > 1) spans.set(at, elision.to);
	}
	return { text: text.join(''), sourceIndexOf, closers, spans };
}

/** One projection kept, for the handful of seeks a single click asks for. */
let memo: { source: string; projection: ProseProjection } | null = null;

function projectionOf(source: string): ProseProjection {
	if (memo === null || memo.source !== source) {
		memo = { source, projection: projectProse(source) };
	}
	return memo.projection;
}

/**
 * The other direction: where in the projected prose a place in the source
 * falls.
 *
 * `findPassage` answers the click, which starts on the page and asks about the
 * file. Leaving an editor asks the reverse — the caret line, or whatever line
 * stands at the top of the page, is a place in the file, and the question is
 * where those words will be once the note is prose again. The answer is an
 * index into the same projection both halves match on, which the caller walks
 * the rendered text against.
 *
 * `sourceIndexOf` rises as the projection walks the source once and in order,
 * so the first surviving character at or after a source position is a binary
 * search. A position past the last of them answers with the last, which is the
 * end of the note and the honest place to hold.
 */
export function projectedIndexAt(source: string, at: number): number | null {
	const { sourceIndexOf } = projectionOf(source);
	if (sourceIndexOf.length === 0) return null;
	return Math.min(firstAtOrAfter(sourceIndexOf, at), sourceIndexOf.length - 1);
}

/**
 * The source position a click on rendered prose answers to, or null.
 *
 * `passage` is rendered text exactly as the DOM gave it, `lead` how far into
 * it the pointer was, and `near` roughly how far through the note — for
 * telling copies of the same wording apart, measured as a fraction because the
 * source and the page are different lengths. Only ever the whole passage: a
 * shorter prefix finds something almost anywhere in a chapter, and acting on
 * the wrong copy scrolls the page somewhere the author never was — worse than
 * the small shift of doing nothing.
 *
 * `side` says which of its two neighbours the click belongs to. The pointer
 * stood between two characters, and the two are not always side by side:
 * past the end of a paragraph, the one after is the first letter of the next
 * paragraph, a row and a gap lower. A click on the side of the character
 * before (-1) answers with the end of that character's prose -- after the
 * letter itself and after whatever syntax closes it, so a caret put past an
 * emphasised last word lands outside the emphasis. A click on the side of
 * the character after (1) answers with that character's own position.
 */
export function findPassage(
	source: string,
	passage: string,
	lead: number,
	near: number,
	side: -1 | 1 = 1,
): number | null {
	const { text, sourceIndexOf, closers, spans } = projectionOf(source);

	// The passage under the projection's own rule, and the pointer's place in
	// it counted in surviving characters.
	let sought = '';
	let soughtLead = 0;
	for (let index = 0; index < passage.length; index += 1) {
		const char = passage.charAt(index);
		if (WHITESPACE.test(char)) continue;
		if (index < lead) soughtLead += 1;
		sought += char;
	}
	if (sought.length < 12) return null;

	const target = near * text.length;
	let best = -1;
	for (let at = text.indexOf(sought); at !== -1; at = text.indexOf(sought, at + 1)) {
		if (best === -1 || Math.abs(at - target) < Math.abs(best - target)) {
			best = at;
		}
	}
	if (best === -1) return null;

	const before = sourceIndexOf[best + soughtLead - 1];
	if (side === -1 && soughtLead > 0 && before !== undefined) {
		let end = spans.get(before) ?? before + 1;
		let reach = end;
		for (;;) {
			const closer = closers.get(end);
			if (closer !== undefined) {
				end = closer.to;
				reach = Math.max(reach, closer.reach);
			} else if (end < reach && WHITESPACE.test(source.charAt(end))) {
				end += 1;
			} else {
				break;
			}
		}
		return end;
	}

	const found = sourceIndexOf[best + soughtLead];
	if (found !== undefined) return found;
	// A pointer past the last surviving character: just after it in the source.
	const last = sourceIndexOf[sourceIndexOf.length - 1];
	return last === undefined ? null : Math.min(last + 1, source.length);
}
