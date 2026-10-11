/**
 * Mention marks on the rendered half of the stream: body offsets carried
 * into the DOM the page actually shows.
 *
 * The two sides meet on one sequence: the analyzable prose's visible
 * characters, whitespace dropped. The source side builds it from
 * `analyzableRanges` -- the same reading that found the mentions, so a
 * link's alias, a heading's text and everything else land exactly where
 * matching put them. The DOM side counts the rendered text nodes by the
 * same rule, passing over what the page shows that the source never wrote:
 * code as written, embedded notes, generated callout titles, footnote
 * numbers.
 *
 * Where the page still shows something this model did not expect -- another
 * plugin's post-processor, an entity the source spelled as `&amp;` -- the
 * two counts drift, and a drifted wrap would highlight the wrong words. So
 * nothing is wrapped on faith: every span gathers the characters it would
 * cover, and only a gather that reads back exactly as the mention's own
 * text is applied. A mismatch skips that one mention and touches nothing.
 */

import {
	type CountableRange,
	type MentionMark,
	firstAtOrAfter,
	visibleOffsets,
} from '../domain';

const WHITESPACE = /\s/;

/** What the DOM shows that the source never wrote: passed over uncounted. */
const UNCOUNTED =
	'pre, code, .internal-embed, .callout-title, sup.footnote-ref';

/**
 * What the wrap needs of a mark: its stretch, the classes it wears, and
 * whatever it carries onto its element. A mention mark is one, and so is a
 * find bar's match, which belongs to no family the menus answer for.
 */
export interface DressMark {
	from: number;
	to: number;
	classes: string;
	title?: string;
	styleVar?: string;
	label?: string;
}

/**
 * One mark as the rendered page counts it: indices into the visible,
 * whitespace-free character sequence both sides walk.
 */
export interface RenderedMentionSpan<M extends DressMark = MentionMark> {
	from: number;
	to: number;
	/** Position in the marks array handed in, for the click handler. */
	index: number;
	/** The mark's text with whitespace dropped: what a wrap must gather. */
	text: string;
	mark: M;
}

/**
 * Marks mapped onto the visible sequence. A mark whose stretch holds no
 * visible character is dropped rather than guessed at.
 */
export function projectMentionMarks<M extends DressMark = MentionMark>(
	body: string,
	marks: readonly M[],
	excludeRanges: readonly CountableRange[] = [],
): RenderedMentionSpan<M>[] {
	// The same sequence the domain picks an insertion's carrier out of, so a
	// character chosen there is one this can always draw.
	const sourceIndexOf = visibleOffsets(body, excludeRanges);
	// The first visible character at or after a source position.
	const indexAt = (at: number): number => firstAtOrAfter(sourceIndexOf, at);
	const spans: RenderedMentionSpan<M>[] = [];
	marks.forEach((mark, index) => {
		const from = indexAt(mark.from);
		const to = indexAt(mark.to);
		if (to <= from) return;
		const first = sourceIndexOf[from];
		if (first === undefined || first >= mark.to) return;
		// What a correct wrap must gather: the stretch's own visible
		// characters, read off the projection rather than the raw slice, so a
		// mark that spans syntax -- a quoted stretch holding emphasis -- still
		// verifies against what the page really shows.
		let text = '';
		for (let at = from; at < to; at += 1) {
			text += body.charAt(sourceIndexOf[at] ?? 0);
		}
		spans.push({ from, to, index, text, mark });
	});
	return spans;
}

interface CoveredSegment {
	node: Text;
	start: number;
	end: number;
	span: RenderedMentionSpan<DressMark>;
}

/**
 * Dresses one rendered segment with its spans: covered stretches of text
 * nodes wrapped in mention spans -- inside an internal link the same as
 * anywhere else, so two marks sharing one link's text each keep their own
 * index, title and color -- and every span verified against what it
 * gathered before anything is touched. Marks never overlap -- overlap
 * resolution settled that -- so each visible character answers to at most
 * one span.
 */
export function applyMentionMarks(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan[],
): void {
	applyMarkSpans(rendered, spans, 'data-snowflake-method-mention');
}

/**
 * The dialogue dress on the rendered half: the same wrap, minus the index
 * attribute -- dialogue marks answer to no click and belong to no lookup
 * array. Applied before the mention wrap, so the mention spans nest inside
 * the quoted stretch they stand in.
 */
export function applyDialogueMarks(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan[],
): void {
	applyMarkSpans(rendered, spans, null);
}

/**
 * The revision dress: its own layer with its own index attribute, applied
 * around the indexed mention wrap the way the dialogue layer is, because a
 * revision overlaps whatever stands inside it and must not steal the
 * mentions' click index.
 */
export function applyRevisionMarks(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan[],
): void {
	applyMarkSpans(rendered, spans, 'data-snowflake-method-revision');
}

/**
 * The milestone dress: one character per milestone, its label riding as an
 * attribute for the stylesheet to draw in the margin. Applied outermost --
 * before every other layer -- so the label's box is never positioned by
 * some other family's span standing around it.
 */
export function applyMilestoneMarks(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan[],
): void {
	applyMarkSpans(rendered, spans, 'data-snowflake-method-milestone');
}

/**
 * The foreshadowing dress: its own layer with its own index attribute, like
 * the revision layer -- but applied in bands, because two threads may be
 * planted in one sentence. The wrap gives each visible character to at most
 * one span, so a second span over the same words would gather nothing,
 * fail its own verification and vanish, with its card left standing in the
 * margin. Bands are applied outermost first, so a containing occurrence
 * wraps the one nested inside it exactly as the layers above wrap it.
 */
export function applyForeshadowingMarks(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan[],
): void {
	for (const band of markBands(spans)) {
		applyMarkSpans(rendered, band, 'data-snowflake-method-foreshadowing');
	}
}

/**
 * Spans split into layers, none of which overlaps within itself: the
 * interval partition, greedy first-fit over spans sorted by where they begin
 * with the longer of two at one place first -- and a span never joins a
 * band at or before the band of a span that contains it, so a container is
 * always applied before anything inside it, even where a disjoint earlier
 * span would have made room for the inner one first. Each band comes out
 * ascending, which the wrap's cursor walk requires, and every span keeps the
 * index it was given, so the cards' lookup is not disturbed. Pure, so the
 * policy is testable without a DOM.
 */
export function markBands(
	spans: readonly RenderedMentionSpan[],
): RenderedMentionSpan[][] {
	const sorted = [...spans].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	const bands: RenderedMentionSpan[][] = [];
	const bandOf = new Map<RenderedMentionSpan, number>();
	for (const span of sorted) {
		// Every container of this span sorted before it and is placed already.
		let floor = 0;
		for (const [placed, index] of bandOf) {
			if (placed.from <= span.from && placed.to >= span.to && index >= floor) {
				floor = index + 1;
			}
		}
		let at = floor;
		while (at < bands.length) {
			const band = bands[at];
			const last = band?.[band.length - 1];
			if (last === undefined || last.to <= span.from) break;
			at += 1;
		}
		const band = bands[at];
		if (band === undefined) bands.push([span]);
		else band.push(span);
		bandOf.set(span, at);
	}
	return bands;
}

function applyMarkSpans(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan<DressMark>[],
	indexAttr: string | null,
): void {
	if (spans.length === 0) return;
	const doc = rendered.ownerDocument;
	const walker = doc.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
	const segments: CoveredSegment[] = [];
	const gathered = new Map<RenderedMentionSpan<DressMark>, string>();
	let counted = 0;
	let cursor = 0;
	for (
		let node = walker.nextNode();
		node !== null;
		node = walker.nextNode()
	) {
		if ((node.parentElement?.closest(UNCOUNTED) ?? null) !== null) continue;
		const text = (node as Text).nodeValue ?? '';
		for (let at = 0; at < text.length; at += 1) {
			if (WHITESPACE.test(text.charAt(at))) continue;
			const seen = counted;
			counted += 1;
			while (cursor < spans.length && (spans[cursor]?.to ?? 0) <= seen) {
				cursor += 1;
			}
			const span = spans[cursor];
			if (span === undefined || span.from > seen) continue;
			gathered.set(span, (gathered.get(span) ?? '') + text.charAt(at));
			const last = segments[segments.length - 1];
			if (last !== undefined && last.node === node && last.span === span) {
				// Extended across interior whitespace too: the space inside a
				// two-word name has no count of its own, but the wrap should
				// hold the name together.
				last.end = at + 1;
			} else {
				segments.push({ node: node as Text, start: at, end: at + 1, span });
			}
		}
	}
	const byNode = new Map<Text, CoveredSegment[]>();
	for (const segment of segments) {
		if (gathered.get(segment.span) !== segment.span.text) continue;
		const list = byNode.get(segment.node) ?? [];
		list.push(segment);
		byNode.set(segment.node, list);
	}
	for (const [node, list] of byNode) {
		const text = node.nodeValue ?? '';
		const pieces = createFragment();
		let at = 0;
		for (const segment of [...list].sort((left, right) => left.start - right.start)) {
			if (segment.start > at) pieces.append(text.slice(at, segment.start));
			const mark = segment.span.mark;
			pieces.append(
				createSpan({
					cls: mark.classes,
					text: text.slice(segment.start, segment.end),
					attr: {
						...(indexAttr === null
							? {}
							: { [indexAttr]: String(segment.span.index) }),
						// The app's own tooltip, as in the editor half.
						...(mark.title === undefined ? {} : { 'aria-label': mark.title }),
						...(mark.styleVar === undefined
							? {}
							: { style: mark.styleVar }),
						...(mark.label === undefined
							? {}
							: { 'data-snowflake-method-label': mark.label }),
					},
				}),
			);
			at = segment.end;
		}
		if (at < text.length) pieces.append(text.slice(at));
		node.replaceWith(pieces);
	}
}

const MENTION_CLASSES = [
	'snowflake-method-mention',
	'snowflake-method-sensitive',
	'snowflake-method-highlight',
	'snowflake-method-dialogue',
	'snowflake-method-revision',
	'snowflake-method-foreshadowing',
	'snowflake-method-milestone',
	'is-linked',
	'is-unlinked',
	'is-first',
	'is-ambiguous',
	'is-deco-background',
	'is-deco-color',
	'is-deco-underline',
	'is-deco-wavy',
	'is-deco-bold',
	'is-replace',
	'is-delete',
	'is-insertion',
	'is-insertion-after',
	'is-plant',
	'is-reinforce',
	'is-payoff',
	'is-planned',
	'is-active',
	'is-resolved',
	'is-abandoned',
];

const MARK_SPANS =
	'span.snowflake-method-mention, span.snowflake-method-sensitive, span.snowflake-method-highlight, span.snowflake-method-dialogue, span.snowflake-method-revision, span.snowflake-method-foreshadowing, span.snowflake-method-milestone';
const MARK_ANCHORS =
	'a.snowflake-method-mention, a.snowflake-method-sensitive, a.snowflake-method-highlight, a.snowflake-method-dialogue, a.snowflake-method-revision, a.snowflake-method-foreshadowing, a.snowflake-method-milestone';

/** Takes a segment's dress back off, wraps unwrapped and anchors undressed. */
export function clearMentionMarks(rendered: HTMLElement): void {
	for (const wrap of Array.from(rendered.querySelectorAll(MARK_SPANS))) {
		wrap.replaceWith(...Array.from(wrap.childNodes));
	}
	for (const anchor of Array.from(rendered.querySelectorAll(MARK_ANCHORS))) {
		anchor.removeClasses(MENTION_CLASSES);
		anchor.removeAttribute('data-snowflake-method-mention');
		anchor.removeAttribute('data-snowflake-method-revision');
		anchor.removeAttribute('data-snowflake-method-foreshadowing');
		anchor.removeAttribute('data-snowflake-method-milestone');
		anchor.removeAttribute('data-snowflake-method-label');
	}
	rendered.normalize();
}

const SEARCH_ATTR = 'data-snowflake-method-search';
const SEARCH_SPANS = 'span.snowflake-method-search-match';

/**
 * The find bar's matches on the rendered half: wrapped last of all, so each
 * stands inside whatever family of marks its words already wear and its tint
 * lies over theirs. Its own index attribute, numbered by the note's matches,
 * so the current match can be moved without wrapping anything again.
 */
export function applySearchMarks(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan<DressMark>[],
): void {
	applyMarkSpans(rendered, spans, SEARCH_ATTR);
}

/** Takes the find bar's matches back off, every other family left as it stands. */
export function clearSearchMarks(rendered: HTMLElement): void {
	const wraps = Array.from(rendered.querySelectorAll(SEARCH_SPANS));
	if (wraps.length === 0) return;
	for (const wrap of wraps) wrap.replaceWith(...Array.from(wrap.childNodes));
	rendered.normalize();
}

/**
 * Moves the current match's ring to the match of that index, or takes it off
 * with null, and hands back the pieces it now stands on: a match crossing
 * emphasis or a link wraps as several.
 */
export function markCurrentSearch(
	rendered: HTMLElement,
	index: number | null,
): HTMLElement[] {
	for (const piece of Array.from(rendered.querySelectorAll(`${SEARCH_SPANS}.is-current`))) {
		piece.removeClass('is-current');
	}
	if (index === null) return [];
	const pieces = Array.from(
		rendered.querySelectorAll<HTMLElement>(`${SEARCH_SPANS}[${SEARCH_ATTR}="${String(index)}"]`),
	);
	for (const piece of pieces) piece.addClass('is-current');
	return pieces;
}

/** The pieces one match stands on, in page order; none when it showed nothing. */
export function searchMarkPieces(rendered: HTMLElement, index: number): HTMLElement[] {
	return Array.from(
		rendered.querySelectorAll<HTMLElement>(`${SEARCH_SPANS}[${SEARCH_ATTR}="${String(index)}"]`),
	);
}

/**
 * The index of the first match drawn at or below a height on the screen, or
 * null when every match drawn stands above it. Read off the pieces' own
 * boxes, so a match that wrapped onto two rows answers with its first.
 */
export function firstSearchMarkBelow(rendered: HTMLElement, top: number): number | null {
	for (const piece of Array.from(rendered.querySelectorAll<HTMLElement>(SEARCH_SPANS))) {
		if (piece.getBoundingClientRect().bottom <= top) continue;
		const index = Number(piece.getAttribute(SEARCH_ATTR));
		if (Number.isInteger(index)) return index;
	}
	return null;
}
