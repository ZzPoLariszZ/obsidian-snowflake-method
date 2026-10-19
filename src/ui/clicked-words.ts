/**
 * The words under a click on rendered prose, and where they were: what an
 * editor taking the rendered text's place needs to put the caret back under
 * the pointer. Shared by the manuscript stream and the sticky-note cards, each
 * naming the rendered container it walks.
 */

const WHITESPACE = /\s/;

/** The vertical extent of a character's box on the page. */
export interface GlyphBand {
	top: number;
	bottom: number;
}

export interface ClickedWords {
	/** The prose the pointer was over, to be found again in the Markdown. */
	passage: string;
	/** How far into that passage the pointer itself was. */
	lead: number;
	/**
	 * Which of its two neighbours the click belongs to: -1 the character
	 * before the pointer, 1 the one after. See `clickedSide`.
	 */
	side: -1 | 1;
	/** Where on the screen it was, so it can be put back there. */
	screenY: number;
	/**
	 * The top of the row the pointer was on. A caller putting the words back
	 * by this rather than by the pointer's own height lands the editor's row
	 * where the rendered row stood, so the glyph clicked does not move at all;
	 * the pointer's height, which stands somewhere inside the glyph, would set
	 * the row half a line lower. The pointer's height when the row could not
	 * be measured.
	 */
	rowTop: number;
	/** How far through the note, for telling repeated wording apart. */
	near: number;
}

/**
 * The words under a click, and where they were.
 *
 * Taken from the rendered text rather than from coordinates, because
 * coordinates stop meaning anything the moment the editor changes the height of
 * what is on the page — whereas the words are the same words either side of the
 * swap, and finding them again is what puts them back under the pointer.
 *
 * The passage is cut from the whole note's text rather than from the one DOM
 * node the pointer was in, which ends at the nearest emphasis or link — a click
 * beside a short formatted run used to come away with too few words to search
 * for. And the click's place in the note is walked to, not searched for, so a
 * sentence the chapter repeats cannot answer for the wrong copy of itself.
 */
export function clickedWords(
	event: MouseEvent,
	containerSelector: string,
): ClickedWords | undefined {
	const target = event.target as HTMLElement | null;
	const doc = target?.ownerDocument;
	if (doc === undefined || doc === null) return undefined;
	const container = target?.closest(containerSelector);
	if (container === null || container === undefined) return undefined;
	const spot = caretAt(doc, event.clientX, event.clientY);
	if (spot === null) return undefined;
	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let before = 0;
	let met = false;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node === spot.node) {
			met = true;
			break;
		}
		before += node.textContent?.length ?? 0;
	}
	if (!met) return undefined;
	const at = before + spot.offset;
	const prose = container.textContent ?? '';
	const text = spot.node.textContent ?? '';
	const beforeBox = glyphBand(doc, spot.node, lastLetterBefore(text, spot.offset));
	const afterBox = glyphBand(doc, spot.node, firstLetterFrom(text, spot.offset));
	const side = clickedSide(
		spot.offset,
		text.length,
		text.charAt(spot.offset),
		beforeBox,
		afterBox,
		event.clientY,
	);
	// Reaching back from the click as well as forward, because clicking past the
	// end of a line puts the caret at the end of that paragraph's text and leaves
	// nothing in front of it to go looking for.
	const from = Math.max(0, at - 24);
	return {
		passage: prose.slice(from, at + 48),
		lead: at - from,
		side,
		screenY: event.clientY,
		rowTop: rowTopOf(beforeBox, afterBox, side, event.clientY) ?? event.clientY,
		near: at / Math.max(1, prose.length),
	};
}

/**
 * Which of its two neighbours a click between characters belongs to: -1 the
 * character before the pointer, 1 the one after.
 *
 * The browser answers a click with a position between two characters, and
 * the two are not always side by side on the page. Past the end of a
 * paragraph the one after is the first letter of the next paragraph, a row
 * and a gap lower; past the end of a wrapped row it is the first letter of
 * the row below; after the last letter of a word it is the space. In each of
 * these the pointer stood at the end of what came before, and that is where
 * the caret belongs. Read as the character after, a click past a paragraph's
 * last word put the caret at the start of the next paragraph, and the page
 * moved by a row and a gap to put that paragraph's first row where the
 * clicked row had been.
 *
 * The end of a text node is the end of its prose, whether a paragraph's or
 * an emphasis's. Inside one, a pointer standing nearer the row of the
 * character before than the row of the one after was at the end of a
 * wrapped row -- measured against the middle of the band between the two,
 * so a pointer in the leading just above a row still belongs to that row --
 * and a pointer with a space after it was at the end of a word.
 */
export function clickedSide(
	offset: number,
	length: number,
	after: string,
	beforeBox: GlyphBand | null,
	afterBox: GlyphBand | null,
	pointerY: number,
): -1 | 1 {
	if (offset <= 0) return 1;
	if (offset >= length) return -1;
	if (
		beforeBox !== null &&
		afterBox !== null &&
		beforeBox.bottom <= afterBox.top &&
		pointerY < (beforeBox.bottom + afterBox.top) / 2
	) {
		return -1;
	}
	return WHITESPACE.test(after) ? -1 : 1;
}

/**
 * The top of the row a click was on, from the boxes of the characters either
 * side of it: the first, in the order the click's side puts them in, that
 * spans the pointer's height, else the first there is. The character on the
 * click's side comes first because the two can stand on different rows, and
 * the caret goes to that one's row. Null when neither has a box.
 */
export function rowTopOf(
	beforeBox: GlyphBand | null,
	afterBox: GlyphBand | null,
	side: -1 | 1,
	pointerY: number,
): number | null {
	const ordered = side === -1 ? [beforeBox, afterBox] : [afterBox, beforeBox];
	const boxes = ordered.filter((box): box is GlyphBand => box !== null);
	const under = boxes.find(
		(box) => pointerY >= box.top && pointerY < box.bottom,
	);
	return (under ?? boxes[0])?.top ?? null;
}

/** The index of the last character before `offset` that is not whitespace, or -1. */
function lastLetterBefore(text: string, offset: number): number {
	for (let index = Math.min(offset, text.length) - 1; index >= 0; index -= 1) {
		if (!WHITESPACE.test(text.charAt(index))) return index;
	}
	return -1;
}

/** The index of the first character at or after `offset` that is not whitespace, or -1. */
function firstLetterFrom(text: string, offset: number): number {
	for (let index = Math.max(0, offset); index < text.length; index += 1) {
		if (!WHITESPACE.test(text.charAt(index))) return index;
	}
	return -1;
}

/**
 * The box of one character of a text node, or null where there is no such
 * character or it has no box to measure.
 */
function glyphBand(doc: Document, node: Node, index: number): GlyphBand | null {
	const length = node.textContent?.length ?? 0;
	if (index < 0 || index >= length) return null;
	const range = doc.createRange();
	range.setStart(node, index);
	range.setEnd(node, index + 1);
	const box = range.getBoundingClientRect();
	return box.height > 0 ? { top: box.top, bottom: box.bottom } : null;
}

/**
 * The character a click landed on, from whichever of the two APIs this build of
 * Obsidian has. `caretPositionFromPoint` is the standard one and the newer
 * arrival; the other is what Chromium answered with for years before it, asked
 * for by name because the Document type has since retired it. Only a text node
 * is an answer: an element hit numbers its children, not its characters.
 */
function caretAt(
	doc: Document,
	x: number,
	y: number,
): { node: Node; offset: number } | null {
	const spot =
		typeof doc.caretPositionFromPoint === 'function'
			? doc.caretPositionFromPoint(x, y)
			: null;
	if (spot !== null) {
		return spot.offsetNode.nodeType === Node.TEXT_NODE
			? { node: spot.offsetNode, offset: spot.offset }
			: null;
	}
	const legacy = (
		doc as unknown as {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		}
	).caretRangeFromPoint;
	const range = typeof legacy === 'function' ? legacy.call(doc, x, y) : null;
	if (range === null) return null;
	return range.startContainer.nodeType === Node.TEXT_NODE
		? { node: range.startContainer, offset: range.startOffset }
		: null;
}
