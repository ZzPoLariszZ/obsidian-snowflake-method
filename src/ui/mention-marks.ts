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
	analyzableRanges,
	type CountableRange,
	type MentionMark,
} from '../domain';

const WHITESPACE = /\s/;

/** What the DOM shows that the source never wrote: passed over uncounted. */
const UNCOUNTED =
	'pre, code, .internal-embed, .callout-title, sup.footnote-ref';

/**
 * One mark as the rendered page counts it: indices into the visible,
 * whitespace-free character sequence both sides walk.
 */
export interface RenderedMentionSpan {
	from: number;
	to: number;
	/** Position in the marks array handed in, for the click handler. */
	index: number;
	/** The mark's text with whitespace dropped: what a wrap must gather. */
	text: string;
	mark: MentionMark;
}

/**
 * Marks mapped onto the visible sequence. A mark whose stretch holds no
 * visible character is dropped rather than guessed at.
 */
export function projectMentionMarks(
	body: string,
	marks: readonly MentionMark[],
	excludeRanges: readonly CountableRange[] = [],
): RenderedMentionSpan[] {
	const sourceIndexOf: number[] = [];
	for (const range of analyzableRanges(body, excludeRanges)) {
		for (let at = range.from; at < range.to; at += 1) {
			if (WHITESPACE.test(body.charAt(at))) continue;
			sourceIndexOf.push(at);
		}
	}
	// The first visible character at or after a source position.
	const indexAt = (at: number): number => {
		let low = 0;
		let high = sourceIndexOf.length;
		while (low < high) {
			const mid = Math.floor((low + high) / 2);
			if ((sourceIndexOf[mid] ?? 0) < at) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	const spans: RenderedMentionSpan[] = [];
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
	span: RenderedMentionSpan;
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
	applyMarkSpans(rendered, spans, true);
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
	applyMarkSpans(rendered, spans, false);
}

function applyMarkSpans(
	rendered: HTMLElement,
	spans: readonly RenderedMentionSpan[],
	indexed: boolean,
): void {
	if (spans.length === 0) return;
	const doc = rendered.ownerDocument;
	const walker = doc.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
	const segments: CoveredSegment[] = [];
	const gathered = new Map<RenderedMentionSpan, string>();
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
						...(indexed
							? {
									'data-snowflake-method-mention': String(
										segment.span.index,
									),
								}
							: {}),
						...(mark.title === undefined ? {} : { title: mark.title }),
						...(mark.styleVar === undefined
							? {}
							: { style: mark.styleVar }),
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
	'is-linked',
	'is-unlinked',
	'is-first',
	'is-ambiguous',
	'is-deco-background',
	'is-deco-color',
	'is-deco-underline',
	'is-deco-wavy',
	'is-deco-bold',
];

const MARK_SPANS =
	'span.snowflake-method-mention, span.snowflake-method-sensitive, span.snowflake-method-highlight, span.snowflake-method-dialogue';
const MARK_ANCHORS =
	'a.snowflake-method-mention, a.snowflake-method-sensitive, a.snowflake-method-highlight, a.snowflake-method-dialogue';

/** Takes a segment's dress back off, wraps unwrapped and anchors undressed. */
export function clearMentionMarks(rendered: HTMLElement): void {
	for (const wrap of Array.from(rendered.querySelectorAll(MARK_SPANS))) {
		wrap.replaceWith(...Array.from(wrap.childNodes));
	}
	for (const anchor of Array.from(rendered.querySelectorAll(MARK_ANCHORS))) {
		anchor.removeClasses(MENTION_CLASSES);
		anchor.removeAttribute('data-snowflake-method-mention');
	}
	rendered.normalize();
}
