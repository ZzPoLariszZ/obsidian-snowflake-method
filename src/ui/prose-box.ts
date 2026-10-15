/**
 * A box for prose: an editable block that stands where a textarea stood,
 * dressed as one, so that every paragraph in it can be set in.
 *
 * A textarea takes the typography's alignment but not its first-line
 * indent: told to indent each line after a forced break, Chromium indents
 * the first line of the box and no other. A block honours the same
 * instruction, so the boxes the dashboard's steps are written in, and the
 * bodies of the cards the boards deal, are blocks that edit plain text -- what the browser calls `plaintext-only`, which
 * keeps Enter a newline character, paste the words alone, and the box's
 * content a run of text nodes. The value is read off those nodes rather
 * than the rendered text, so a test without a layout engine reads the same
 * thing the app does, and a break the browser put in as an element still
 * counts as one.
 */
export const PROSE_BOX_CLASS = 'snowflake-method-prose-box';

export interface ProseBoxSpec {
	/** Classes beside the box's own, for the rules that size one box or another. */
	cls?: string;
	/** The box's accessible name. */
	label: string;
	/** The prompt an empty box shows; none where it is empty, for a box that invites no writing. */
	placeholder: string;
	value?: string;
	disabled?: boolean;
	/** Held to reading: the words stand to be read and copied, and take no typing. */
	readOnly?: boolean;
}

/**
 * Each node of a prose box with its copies in the other boxes showing the
 * same words, one family per node, by box. A copy is made once and kept, so
 * the one put back is always the one the box's own edits were made in. The
 * family holds its boxes weakly: a box closed goes, copies and all, with
 * nothing here keeping it.
 */
const TWINS = new WeakMap<Node, WeakMap<HTMLElement, Node>>();

/** Enters a node in a family, as the one standing for its box. */
function enterTwin(family: WeakMap<HTMLElement, Node>, box: HTMLElement, node: Node): void {
	family.set(box, node);
	TWINS.set(node, family);
}

/**
 * The copy in one box of a node of another: the one kept, or the node
 * standing in its place taken over, or a new one. A node new to the words
 * -- in a box drawn since the others were copied -- joins the family of the
 * node standing in its place instead of putting that node out, so the
 * edits remembered in it still find it.
 */
function twinIn(box: HTMLElement, node: Node, from: HTMLElement, at: number): Node {
	const family = TWINS.get(node);
	const kept = family?.get(box);
	if (kept !== undefined) return kept;
	const here = box.childNodes[at];
	if (here !== undefined && here.nodeName === node.nodeName) {
		const hers = TWINS.get(here);
		if (hers === undefined) {
			const joined = family ?? new WeakMap<HTMLElement, Node>();
			if (family === undefined) enterTwin(joined, from, node);
			enterTwin(joined, box, here);
			return here;
		}
		if (family === undefined && !hers.has(from)) {
			enterTwin(hers, from, node);
			return here;
		}
	}
	const own = family ?? new WeakMap<HTMLElement, Node>();
	if (family === undefined) enterTwin(own, from, node);
	// A new break is made in the box itself, at its end, and moved into its place by the caller.
	const twin =
		node.nodeType === Node.TEXT_NODE ? box.doc.createTextNode(node.nodeValue ?? '') : box.createEl('br');
	enterTwin(own, box, twin);
	return twin;
}

export class ProseBox {
	readonly el: HTMLElement;

	constructor(parent: HTMLElement, spec: ProseBoxSpec) {
		const attr: Record<string, string> = {
			role: 'textbox',
			'aria-multiline': 'true',
			'aria-label': spec.label,
			spellcheck: 'true',
		};
		if (spec.placeholder !== '') attr['data-placeholder'] = spec.placeholder;
		this.el = parent.createDiv({
			cls: spec.cls === undefined ? PROSE_BOX_CLASS : `${PROSE_BOX_CLASS} ${spec.cls}`,
			attr,
		});
		this.value = spec.value ?? '';
		this.disabled = spec.disabled ?? false;
		this.readOnly = spec.readOnly ?? false;
		// Deleting the last character leaves a lone line break behind, and
		// the placeholder shows only over a box that holds nothing at all.
		this.el.addEventListener('input', () => {
			if (this.el.childNodes.length === 1 && this.el.firstChild?.nodeName === 'BR') {
				this.el.textContent = '';
			}
		});
	}

	get value(): string {
		return proseBoxText(this.el);
	}

	set value(next: string) {
		this.el.textContent = next;
	}

	/**
	 * Takes the words of another box showing the same draft -- another
	 * dashboard's -- node for node. The browser keeps one undo history for
	 * the whole window and remembers each edit by the nodes it was made in,
	 * putting back the very nodes an edit took out when it is undone. So each
	 * node of the other box has one copy here, made once and kept, and when
	 * the other's Undo puts a node back, its copy comes back here too: undone
	 * in the order they were made, wherever they were made, every edit finds
	 * the nodes it remembers. Anything but text and breaks, which a
	 * plain-text box does not hold, has its words set whole.
	 */
	follow(other: ProseBox): void {
		const box = this.el;
		const from = other.el;
		const nodes = Array.from(from.childNodes);
		if (nodes.some((node) => node.nodeType !== Node.TEXT_NODE && node.nodeName !== 'BR')) {
			this.value = other.value;
			return;
		}
		nodes.forEach((node, at) => {
			const twin = twinIn(box, node, from, at);
			if (box.childNodes[at] !== twin) box.insertBefore(twin, box.childNodes[at] ?? null);
			if (twin.nodeValue !== node.nodeValue) twin.nodeValue = node.nodeValue;
		});
		while (box.childNodes.length > nodes.length) box.lastChild?.remove();
	}

	get disabled(): boolean {
		return this.el.getAttribute('aria-disabled') === 'true';
	}

	set disabled(off: boolean) {
		this.el.setAttribute('aria-disabled', off ? 'true' : 'false');
		this.el.toggleClass('is-disabled', off);
		this.settleEditing();
	}

	/**
	 * Whether the box is held to reading. Its words stand, to be read and
	 * copied, and take no typing; unlike a disabled box it keeps its full look,
	 * since nothing is wrong with it, it is only not the reader's to write.
	 */
	get readOnly(): boolean {
		return this.el.getAttribute('aria-readonly') === 'true';
	}

	set readOnly(on: boolean) {
		this.el.setAttribute('aria-readonly', on ? 'true' : 'false');
		this.el.toggleClass('is-read-only', on);
		this.settleEditing();
	}

	/** Tells the browser whether the box takes typing: only when it is neither disabled nor held to reading. */
	private settleEditing(): void {
		this.el.setAttribute('contenteditable', this.disabled || this.readOnly ? 'false' : 'plaintext-only');
	}

	focus(): void {
		this.el.focus();
	}
}

/** Whether something is a prose box, for the code that counts what is typed. */
export function isProseBox(target: EventTarget | null): target is HTMLElement {
	return (
		target instanceof Node &&
		target.instanceOf(HTMLElement) &&
		target.hasClass(PROSE_BOX_CLASS)
	);
}

/**
 * The text a prose box holds: its text nodes in order, a newline for a
 * break element, and one before any block the browser nested.
 */
export function proseBoxText(box: HTMLElement): string {
	let out = '';
	box.childNodes.forEach((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			out += node.nodeValue ?? '';
		} else if (node.nodeName === 'BR') {
			out += '\n';
		} else if (node.instanceOf(HTMLElement)) {
			if (out.length > 0 && !out.endsWith('\n')) out += '\n';
			out += proseBoxText(node);
		}
	});
	return out;
}

/**
 * Where the caret stands in a prose box, as the number of characters before
 * it, or null when the selection is somewhere else. A box drawn again from
 * its value takes the caret back at the same count.
 */
export function proseBoxCaret(box: HTMLElement): number | null {
	const selection = selectionOf(box);
	if (selection === null || selection.rangeCount === 0) return null;
	const { focusNode, focusOffset } = selection;
	if (focusNode === null || !box.contains(focusNode)) return null;
	const range = box.doc.createRange();
	range.selectNodeContents(box);
	range.setEnd(focusNode, focusOffset);
	return range.toString().length;
}

/** The selection of the window a box stands in, where that window has one. */
function selectionOf(box: HTMLElement): Selection | null {
	const win = box.win as Window | undefined;
	return typeof win?.getSelection === 'function' ? win.getSelection() : null;
}

/** Puts the caret in a box drawn from its value, at a count `proseBoxCaret` read. */
export function placeProseBoxCaret(box: HTMLElement, offset: number): void {
	const selection = selectionOf(box);
	if (selection === null) return;
	const range = box.doc.createRange();
	const text = box.firstChild;
	if (text !== null && text.nodeType === Node.TEXT_NODE) {
		range.setStart(text, Math.min(offset, text.nodeValue?.length ?? 0));
	} else {
		range.setStart(box, 0);
	}
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

/**
 * The words selected inside a prose box, or null when the selection is
 * collapsed or reaches outside it.
 */
export function proseBoxSelection(box: HTMLElement): string | null {
	const selection = box.win.getSelection();
	if (selection === null || selection.isCollapsed) return null;
	const { anchorNode, focusNode } = selection;
	if (anchorNode === null || focusNode === null) return null;
	if (!box.contains(anchorNode) || !box.contains(focusNode)) return null;
	const words = selection.toString();
	return words.length > 0 ? words : null;
}
