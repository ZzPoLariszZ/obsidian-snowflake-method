/**
 * The words under a click on rendered prose, and where they were: what an
 * editor taking the rendered text's place needs to put the caret back under
 * the pointer. Shared by the manuscript stream and the sticky-note cards, each
 * naming the rendered container it walks.
 */

export interface ClickedWords {
	/** The prose the pointer was over, to be found again in the Markdown. */
	passage: string;
	/** How far into that passage the pointer itself was. */
	lead: number;
	/** Where on the screen it was, so it can be put back there. */
	screenY: number;
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
	// Reaching back from the click as well as forward, because clicking past the
	// end of a line puts the caret at the end of that paragraph's text and leaves
	// nothing in front of it to go looking for.
	const from = Math.max(0, at - 24);
	return {
		passage: prose.slice(from, at + 48),
		lead: at - from,
		screenY: event.clientY,
		near: at / Math.max(1, prose.length),
	};
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
