/**
 * A box for prose: an editable block that stands where a textarea stood,
 * dressed as one, so that every paragraph in it can be set in.
 *
 * A textarea takes the typography's alignment but not its first-line
 * indent: told to indent each line after a forced break, Chromium indents
 * the first line of the box and no other. A block honours the same
 * instruction, so the boxes the dashboard's steps are written in are blocks
 * that edit plain text -- what the browser calls `plaintext-only`, which
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
	placeholder: string;
	value?: string;
	disabled?: boolean;
}

export class ProseBox {
	readonly el: HTMLElement;

	constructor(parent: HTMLElement, spec: ProseBoxSpec) {
		this.el = parent.createDiv({
			cls: spec.cls === undefined ? PROSE_BOX_CLASS : `${PROSE_BOX_CLASS} ${spec.cls}`,
			attr: {
				role: 'textbox',
				'aria-multiline': 'true',
				'aria-label': spec.label,
				'data-placeholder': spec.placeholder,
				spellcheck: 'true',
			},
		});
		this.value = spec.value ?? '';
		this.disabled = spec.disabled ?? false;
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

	get disabled(): boolean {
		return this.el.getAttribute('contenteditable') === 'false';
	}

	set disabled(off: boolean) {
		this.el.setAttribute('contenteditable', off ? 'false' : 'plaintext-only');
		this.el.setAttribute('aria-disabled', off ? 'true' : 'false');
		this.el.toggleClass('is-disabled', off);
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
