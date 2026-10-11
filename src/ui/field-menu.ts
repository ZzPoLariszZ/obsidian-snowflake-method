/**
 * The right-click menu over words selected in a box of the dashboard or of
 * one of the plugin's dialogs: the box's own cut, copy and paste first, then
 * the plugin's entries for the words, as the manuscript's menu offers them.
 *
 * A text box's usual menu is the app's own, drawn by Electron, and a plugin
 * cannot add to it. So this menu stands in for it only where words were
 * selected before the right-click and the click landed on them, leaving the
 * selection where the press found it. A right-click anywhere else, or in a
 * box holding no selection, keeps the app's menu with its spelling
 * suggestions.
 */

import type { Menu } from 'obsidian';

import { PROSE_BOX_CLASS } from './prose-box';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A box the menu serves: a text area, a one-line text box, or a prose box. */
export type TextField = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

/** Where a box's selection stands: offsets in a text box, a range in a prose box. */
export type FieldSpan =
	| { kind: 'offsets'; start: number; end: number; text: string }
	| { kind: 'range'; range: Range; text: string };

/** A text area or a one-line text box, told apart from a prose box. */
function isTextBox(field: TextField): field is HTMLInputElement | HTMLTextAreaElement {
	return field.instanceOf(HTMLTextAreaElement) || field.instanceOf(HTMLInputElement);
}

/**
 * The box an event landed in, if it is one the menu serves: a text area, a
 * one-line text box, or a prose box. A search box is for finding, not for
 * words to keep, so it is left to the app. Asked through the app's
 * `instanceOf`, which answers for a node of any window: a popout's elements
 * belong to that window's own globals.
 */
export function textFieldOf(target: EventTarget | null): TextField | null {
	if (target === null || typeof (target as Partial<Node>).instanceOf !== 'function') return null;
	const node = target as Node;
	if (node.instanceOf(HTMLTextAreaElement)) return node;
	if (node.instanceOf(HTMLInputElement)) return node.type === 'text' ? node : null;
	return node.instanceOf(HTMLElement) && node.hasClass(PROSE_BOX_CLASS) ? node : null;
}

/** Whether a box can be typed in, so cutting and pasting can change it. */
export function fieldEditable(field: TextField): boolean {
	return isTextBox(field) ? !field.readOnly && !field.disabled : field.isContentEditable;
}

/** The selection a box holds now, or null where it holds none. */
export function fieldSpan(field: TextField): FieldSpan | null {
	if (isTextBox(field)) {
		const { selectionStart: start, selectionEnd: end } = field;
		if (start === null || end === null || end <= start) return null;
		return { kind: 'offsets', start, end, text: field.value.slice(start, end) };
	}
	const selection = field.win.getSelection();
	if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!field.contains(range.startContainer) || !field.contains(range.endContainer)) return null;
	const text = selection.toString();
	return text.length === 0 ? null : { kind: 'range', range: range.cloneRange(), text };
}

/** Whether two readings of a box's selection hold the same stretch. */
function sameSpan(left: FieldSpan, right: FieldSpan): boolean {
	if (left.kind === 'offsets' && right.kind === 'offsets') {
		return left.start === right.start && left.end === right.end;
	}
	if (left.kind === 'range' && right.kind === 'range') {
		return (
			left.range.compareBoundaryPoints(left.range.START_TO_START, right.range) === 0 &&
			left.range.compareBoundaryPoints(left.range.END_TO_END, right.range) === 0
		);
	}
	return false;
}

/**
 * Tells a selection made before a right-click from one the click made. The
 * press is read before the browser moves the caret or takes a word, and the
 * menu stands in only where the click finds the selection the press left.
 */
export class FieldPress {
	private pressed: { field: TextField; span: FieldSpan } | null = null;

	/** A right button went down, over this box or over none. */
	press(field: TextField | null): void {
		const span = field === null ? null : fieldSpan(field);
		this.pressed = field === null || span === null ? null : { field, span };
	}

	/** The selection the right-click landed on, or null where the app's own menu should open. */
	release(field: TextField | null): FieldSpan | null {
		const pressed = this.pressed;
		this.pressed = null;
		if (field === null || pressed === null || pressed.field !== field) return null;
		const now = fieldSpan(field);
		return now !== null && sameSpan(pressed.span, now) ? now : null;
	}
}

/**
 * Puts words where a box's selection stood, as typing them would, and tells
 * the box, which saves on what it hears.
 */
export function replaceFieldSpan(field: TextField, span: FieldSpan, words: string): void {
	if (span.kind === 'offsets') {
		if (!isTextBox(field)) return;
		field.focus();
		field.setRangeText(words, span.start, span.end, 'end');
	} else {
		const range = span.range;
		range.deleteContents();
		if (words.length > 0) {
			const node = field.doc.createTextNode(words);
			range.insertNode(node);
			range.setStartAfter(node);
		}
		range.collapse(true);
		const selection = field.win.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		field.normalize();
	}
	field.dispatchEvent(
		new InputEvent('input', {
			bubbles: true,
			inputType: words.length > 0 ? 'insertFromPaste' : 'deleteByCut',
		}),
	);
}

export interface ClipboardEntryOptions {
	t: Translate;
	field: TextField;
	/** The selection the menu opened on. */
	span: FieldSpan;
	showError: (error: unknown) => void;
}

/** Cut, copy and paste over the selection the menu opened on, as a box's own menu has them. */
export function addClipboardEntries(menu: Menu, options: ClipboardEntryOptions): void {
	const { t, field, span, showError } = options;
	const clipboard = field.win.navigator.clipboard;
	const editable = fieldEditable(field);
	const section = 'clipboard';
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.menu.cut'))
			.setIcon('scissors')
			.setDisabled(!editable)
			.onClick(() => {
				void clipboard
					.writeText(span.text)
					.then(() => {
						replaceFieldSpan(field, span, '');
					})
					.catch(showError);
			}),
	);
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.copySelection'))
			.setIcon('copy')
			.onClick(() => {
				void clipboard.writeText(span.text).catch(showError);
			}),
	);
	menu.addItem((item) =>
		item
			.setSection(section)
			.setTitle(t('manuscript.menu.paste'))
			.setIcon('clipboard-paste')
			.setDisabled(!editable)
			.onClick(() => {
				void clipboard
					.readText()
					.then((words) => {
						replaceFieldSpan(field, span, words);
					})
					.catch(showError);
			}),
	);
}
