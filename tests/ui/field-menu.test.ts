// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	FieldPress,
	addClipboardEntries,
	fieldSpan,
	replaceFieldSpan,
	textFieldOf,
} from '../../src/ui/field-menu';
import { PROSE_BOX_CLASS } from '../../src/ui/prose-box';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

afterEach(() => {
	document.body.empty();
	vi.restoreAllMocks();
});

/** A text area holding words, its selection set. */
function textArea(value: string, start: number, end: number): HTMLTextAreaElement {
	const area = document.body.createEl('textarea');
	area.value = value;
	area.setSelectionRange(start, end);
	return area;
}

/** A prose box holding words, the page's selection set over a stretch of them. */
function proseBox(value: string, start: number, end: number): HTMLElement {
	const box = document.body.createDiv({ cls: PROSE_BOX_CLASS });
	box.setAttribute('contenteditable', 'plaintext-only');
	const text = document.createTextNode(value);
	box.appendChild(text);
	const range = document.createRange();
	range.setStart(text, start);
	range.setEnd(text, end);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	return box;
}

describe('textFieldOf', () => {
	it('serves text areas, text boxes and prose boxes, and leaves a search box to the app', () => {
		const area = document.body.createEl('textarea');
		const line = document.body.createEl('input');
		line.type = 'text';
		const search = document.body.createEl('input');
		search.type = 'search';
		const box = document.body.createDiv({ cls: PROSE_BOX_CLASS });
		const plain = document.body.createDiv();
		expect(textFieldOf(area)).toBe(area);
		expect(textFieldOf(line)).toBe(line);
		expect(textFieldOf(box)).toBe(box);
		expect(textFieldOf(search)).toBeNull();
		expect(textFieldOf(plain)).toBeNull();
		expect(textFieldOf(null)).toBeNull();
	});
});

describe('FieldPress', () => {
	it('answers the selection a right-click found where the press left it', () => {
		const area = textArea('the old mill road', 4, 12);
		const press = new FieldPress();
		press.press(area);
		expect(press.release(area)).toMatchObject({ kind: 'offsets', start: 4, end: 12, text: 'old mill' });
		// Read once: the next click is asked about afresh.
		expect(press.release(area)).toBeNull();
	});

	it('leaves the app its menu where the click moved the selection, or found none', () => {
		const area = textArea('the old mill road', 4, 12);
		const press = new FieldPress();
		press.press(area);
		area.setSelectionRange(13, 17);
		expect(press.release(area)).toBeNull();
		area.setSelectionRange(5, 5);
		press.press(area);
		expect(press.release(area)).toBeNull();
		const other = textArea('elsewhere', 0, 4);
		press.press(area);
		expect(press.release(other)).toBeNull();
	});

	it('tells a prose box selection the same way', () => {
		const box = proseBox('Smoke over the valley', 6, 10);
		const press = new FieldPress();
		press.press(box);
		expect(press.release(box)?.text).toBe('over');
	});
});

describe('replaceFieldSpan', () => {
	it('puts words over a text area selection and tells the box', () => {
		const area = textArea('the old mill road', 4, 12);
		const heard = vi.fn();
		area.addEventListener('input', heard);
		const span = fieldSpan(area);
		if (span === null) throw new Error('nothing selected');
		replaceFieldSpan(area, span, 'stone bridge');
		expect(area.value).toBe('the stone bridge road');
		expect(heard).toHaveBeenCalledOnce();
	});

	it('takes the words out of a prose box, and puts others in their place', () => {
		const box = proseBox('Smoke over the valley', 6, 11);
		const span = fieldSpan(box);
		if (span === null) throw new Error('nothing selected');
		replaceFieldSpan(box, span, '');
		expect(box.textContent).toBe('Smoke the valley');
		const again = proseBox('Smoke over the valley', 15, 21);
		const spanned = fieldSpan(again);
		if (spanned === null) throw new Error('nothing selected');
		replaceFieldSpan(again, spanned, 'hills');
		expect(again.textContent).toBe('Smoke over the hills');
	});
});

describe('addClipboardEntries', () => {
	/** A menu keeping each entry's words, greyness and press. */
	function fakeMenu() {
		const entries: { title: string; disabled: boolean; press: () => void }[] = [];
		const menu = {
			addItem(build: (item: unknown) => void) {
				const entry = { title: '', disabled: false, press: (): void => undefined };
				const item = {
					setSection() { return item; },
					setTitle(title: string) { entry.title = title; return item; },
					setIcon() { return item; },
					setDisabled(disabled: boolean) { entry.disabled = disabled; return item; },
					onClick(press: () => void) { entry.press = press; return item; },
				};
				build(item);
				entries.push(entry);
				return menu;
			},
		};
		return { menu, entries };
	}

	it('cuts, copies and pastes over the selection the menu opened on', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		const readText = vi.fn(() => Promise.resolve('stone bridge'));
		Object.defineProperty(window.navigator, 'clipboard', {
			configurable: true,
			value: { writeText, readText },
		});
		const area = textArea('the old mill road', 4, 12);
		const span = fieldSpan(area);
		if (span === null) throw new Error('nothing selected');
		const { menu, entries } = fakeMenu();
		addClipboardEntries(menu as never, { t: (key) => key, field: area, span, showError: vi.fn() });
		expect(entries.map((entry) => [entry.title, entry.disabled])).toEqual([
			['manuscript.menu.cut', false],
			['manuscript.copySelection', false],
			['manuscript.menu.paste', false],
		]);
		entries[1]?.press();
		expect(writeText).toHaveBeenCalledWith('old mill');
		entries[2]?.press();
		await vi.waitFor(() => expect(area.value).toBe('the stone bridge road'));
	});

	it('hands cut and paste to the window, over the selection the menu opened on, so Undo takes them back', () => {
		const writeText = vi.fn(() => Promise.resolve());
		const readText = vi.fn(() => Promise.resolve('stone bridge'));
		Object.defineProperty(window.navigator, 'clipboard', {
			configurable: true,
			value: { writeText, readText },
		});
		const area = textArea('the old mill road', 4, 12);
		const box = proseBox('Smoke over the valley', 6, 10);
		const areaSpan = fieldSpan(area);
		const boxSpan = fieldSpan(box);
		if (areaSpan === null || boxSpan === null) throw new Error('nothing selected');
		// Each command reads the selection standing when the window runs it.
		const ran: string[] = [];
		const selected = (): string =>
			document.activeElement === area
				? area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0)
				: (window.getSelection()?.toString() ?? '');
		const editing = {
			cut: vi.fn(() => ran.push(`cut ${selected()}`)),
			paste: vi.fn(() => ran.push(`paste ${selected()}`)),
		};
		Object.assign(window, { electron: { remote: { getCurrentWebContents: () => editing } } });
		try {
			const areaMenu = fakeMenu();
			addClipboardEntries(areaMenu.menu as never, { t: (key) => key, field: area, span: areaSpan, showError: vi.fn() });
			const boxMenu = fakeMenu();
			addClipboardEntries(boxMenu.menu as never, { t: (key) => key, field: box, span: boxSpan, showError: vi.fn() });
			// The selection moved on while the menu stood.
			area.setSelectionRange(0, 0);
			areaMenu.entries[0]?.press();
			window.getSelection()?.removeAllRanges();
			boxMenu.entries[2]?.press();
			expect(ran).toEqual(['cut old mill', 'paste over']);
			// The window makes the edit; nothing is written by hand behind its back.
			expect(area.value).toBe('the old mill road');
			expect(box.textContent).toBe('Smoke over the valley');
			expect(writeText).not.toHaveBeenCalled();
			expect(readText).not.toHaveBeenCalled();
		} finally {
			Reflect.deleteProperty(window, 'electron');
		}
	});

	it('only copies out of a box that cannot be typed in', () => {
		const area = textArea('the old mill road', 4, 12);
		area.readOnly = true;
		const span = fieldSpan(area);
		if (span === null) throw new Error('nothing selected');
		const { menu, entries } = fakeMenu();
		addClipboardEntries(menu as never, { t: (key) => key, field: area, span, showError: vi.fn() });
		expect(entries.map((entry) => entry.disabled)).toEqual([true, false, true]);
	});
});
