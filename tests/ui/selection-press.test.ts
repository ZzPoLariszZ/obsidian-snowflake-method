// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Platform } from 'obsidian';

import { SELECTION_SETTLE_MS, noteSelectionMoved, pressYieldsToSelection } from '../../src/ui/selection-press';
import { installObsidianDom } from '../helpers/obsidian-dom';

const box = (left: number, top: number, width: number, height: number): DOMRect =>
	({ left, top, right: left + width, bottom: top + height }) as DOMRect;

function words(): HTMLElement {
	return document.body.createEl('p', { text: 'The clockmaker met the baker by the tower.' });
}

/** Selects a node's words, with the boxes a browser would lay them in. */
function select(node: Node, boxes: DOMRect[] = []): Range {
	const range = document.createRange();
	range.selectNodeContents(node);
	Object.defineProperty(range, 'getClientRects', { value: () => boxes });
	const selection = document.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	return range;
}

const press = (init: MouseEventInit = {}): MouseEvent =>
	new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, ...init });

/**
 * A finger held on a phone's words is the system's own selection gesture,
 * and the plugin's menus keep out of it: a press while the selection still
 * moves, or on the selected words, yields; a right button, a desktop, and a
 * press beside a settled selection keep the menu.
 */
describe('a long press against the selection', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	// The moment the selection moved is kept per document, and the cases
	// share this one, so each case's clock starts long after the last.
	afterEach(() => {
		Platform.isMobile = false;
		document.getSelection()?.removeAllRanges();
		document.body.replaceChildren();
	});

	it('yields nothing on a desktop, nor to a right button on a phone', () => {
		select(words(), [box(0, 0, 100, 100)]);
		noteSelectionMoved(document, 1000);
		expect(pressYieldsToSelection(press(), document, 1100)).toBe(false);
		Platform.isMobile = true;
		expect(pressYieldsToSelection(press({ button: 2 }), document, 1100)).toBe(false);
	});

	it('yields while the selection is still moving, then not', () => {
		Platform.isMobile = true;
		select(words());
		noteSelectionMoved(document, 10_000);
		expect(pressYieldsToSelection(press(), document, 10_000 + SELECTION_SETTLE_MS - 1)).toBe(true);
		expect(pressYieldsToSelection(press(), document, 10_000 + SELECTION_SETTLE_MS)).toBe(false);
	});

	it('does not take a caret moving for the selection moving', () => {
		Platform.isMobile = true;
		const caret = document.createRange();
		caret.setStart(words().firstChild as Node, 3);
		caret.collapse(true);
		const selection = document.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(caret);
		noteSelectionMoved(document, 20_000);
		expect(pressYieldsToSelection(press(), document, 20_100)).toBe(false);
	});

	it('yields to a press on the selected words, and not beside them', () => {
		Platform.isMobile = true;
		select(words(), [box(10, 10, 80, 20), box(10, 40, 30, 20)]);
		expect(pressYieldsToSelection(press({ clientX: 20, clientY: 50 }), document, 30_000)).toBe(true);
		// Within reach of a box's edge, as a finger is never exact.
		expect(pressYieldsToSelection(press({ clientX: 93, clientY: 20 }), document, 30_000)).toBe(true);
		expect(pressYieldsToSelection(press({ clientX: 60, clientY: 50 }), document, 30_000)).toBe(false);
	});
});
