// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import { Scope } from '../helpers/obsidian-runtime';
import { installObsidianDom } from '../helpers/obsidian-dom';
import { StreamSearchBar, chordLabel } from '../../src/ui/stream-search-bar';

installObsidianDom(window);

/** The bar in a page of its own, with every hook it calls recorded. */
function openBar() {
	const parent = document.body.createDiv();
	const hooks = {
		t: (key: string) => key,
		onQuery: vi.fn(),
		onStep: vi.fn(),
		onReplace: vi.fn(),
		onReplaceAll: vi.fn(),
		onClose: vi.fn(),
		escapeOutside: vi.fn(() => false),
	};
	const bar = new StreamSearchBar(parent, new Scope() as never, hooks);
	const find = bar.containerEl.querySelector<HTMLInputElement>('.document-search-input input');
	const replace = bar.containerEl.querySelector<HTMLInputElement>('.document-replace-input');
	if (find === null || replace === null) throw new Error('the bar has no boxes');
	/** Fires the bar's own handler for a chord, as the keymap would. */
	const press = (modifiers: string[], key: string, init: KeyboardEventInit = {}): unknown => {
		const handler = (bar.scope as unknown as Scope).keys.find(
			(candidate) =>
				candidate.key === key &&
				JSON.stringify(candidate.modifiers) === JSON.stringify(modifiers),
		);
		if (handler === undefined) throw new Error(`no handler for ${modifiers.join('+')}+${key}`);
		return handler.func(new KeyboardEvent('keydown', { key, ...init }), {});
	};
	return { parent, bar, hooks, find, replace, press };
}

describe('StreamSearchBar', () => {
	it("is built in the app's own bar markup, its options inside the find box", () => {
		const { bar } = openBar();
		const root = bar.containerEl;
		expect(root.classList.contains('document-search-container')).toBe(true);
		expect(root.querySelector('.document-search > .search-input-container.document-search-input')).not.toBeNull();
		expect(root.querySelector('.document-search-input > .document-search-count')).not.toBeNull();
		expect(root.querySelectorAll('.document-search-input .snowflake-method-search-option')).toHaveLength(3);
		expect(root.querySelectorAll('.document-search-buttons > .document-search-button')).toHaveLength(2);
		// The close sits with the arrows, the three side by side.
		expect(root.querySelector('.document-search-buttons > .document-search-close-button')).not.toBeNull();
		expect(root.querySelector('.document-replace > .search-input-container > .document-replace-input')).not.toBeNull();
		expect(root.querySelectorAll('.document-replace-buttons > .document-search-button')).toHaveLength(2);
		expect(root.classList.contains('mod-replace-mode')).toBe(false);
	});

	it('opens on the words handed in, selected, with the replace row when asked', () => {
		const { bar, find } = openBar();
		bar.open(true, 'Jon');
		expect(find.value).toBe('Jon');
		expect(document.activeElement).toBe(find);
		expect(find.selectionStart).toBe(0);
		expect(find.selectionEnd).toBe(3);
		expect(bar.containerEl.classList.contains('mod-replace-mode')).toBe(true);
		// Brought back without saying, the row stays; asked for find alone, it folds.
		bar.open(null, null);
		expect(bar.containerEl.classList.contains('mod-replace-mode')).toBe(true);
		bar.open(false, null);
		expect(bar.containerEl.classList.contains('mod-replace-mode')).toBe(false);
	});

	it('escapes the words handed in while the query is an expression', () => {
		const { bar, find } = openBar();
		bar.containerEl
			.querySelectorAll<HTMLElement>('.snowflake-method-search-option')[2]
			?.click();
		bar.open(false, 'a.b (c)');
		expect(find.value).toBe('a\\.b \\(c\\)');
		expect(bar.searchOptions().regex).toBe(true);
	});

	it('walks with Enter and Shift+Enter in the find box, and hands Enter on elsewhere', () => {
		const { bar, hooks, press } = openBar();
		bar.open(false, 'ash');
		expect(press([], 'Enter')).toBe(false);
		expect(press(['Shift'], 'Enter')).toBe(false);
		expect(hooks.onStep.mock.calls).toEqual([[1], [-1]]);
		document.body.focus();
		(document.activeElement as HTMLElement | null)?.blur();
		expect(press([], 'Enter')).toBe(true);
		expect(hooks.onStep).toHaveBeenCalledTimes(2);
	});

	it("leaves a key to the input method that is spelling with it", () => {
		const { bar, hooks, press } = openBar();
		bar.open(false, 'ash');
		expect(press([], 'Enter', { isComposing: true })).toBe(true);
		expect(press([], 'Escape', { isComposing: true })).toBe(true);
		expect(hooks.onStep).not.toHaveBeenCalled();
		expect(hooks.onClose).not.toHaveBeenCalled();
	});

	it('replaces with Enter in the replace box once it holds words, and walks on while empty', () => {
		const { bar, hooks, replace, press } = openBar();
		bar.open(true, 'ash');
		replace.focus();
		press([], 'Enter');
		expect(hooks.onReplace).not.toHaveBeenCalled();
		expect(hooks.onStep).toHaveBeenCalledWith(1);
		replace.value = 'oak';
		press([], 'Enter');
		expect(hooks.onReplace).toHaveBeenCalledTimes(1);
		press(['Mod', 'Alt'], 'Enter');
		expect(hooks.onReplaceAll).toHaveBeenCalledTimes(1);
	});

	it('replaces nothing from the keys while the manuscript is read-only', () => {
		const { bar, hooks, replace, press } = openBar();
		bar.open(true, 'ash');
		bar.setReplaceAllowed(false);
		expect(bar.containerEl.classList.contains('mod-replace-mode')).toBe(false);
		replace.value = 'oak';
		press(['Mod', 'Alt'], 'Enter');
		expect(hooks.onReplaceAll).not.toHaveBeenCalled();
	});

	it('crosses between the two boxes with Tab while both stand', () => {
		const { bar, find, replace, press } = openBar();
		bar.open(false, 'ash');
		expect(press([], 'Tab')).toBe(true);
		bar.setReplaceMode(true);
		expect(press([], 'Tab')).toBe(false);
		expect(document.activeElement).toBe(replace);
		press(['Shift'], 'Tab');
		expect(document.activeElement).toBe(find);
	});

	it('closes with Escape from inside, and from the page only when the page says so', () => {
		const { bar, hooks, press } = openBar();
		bar.open(false, 'ash');
		expect(press([], 'Escape')).toBe(false);
		expect(hooks.onClose).toHaveBeenCalledTimes(1);
		(document.activeElement as HTMLElement | null)?.blur();
		expect(press([], 'Escape')).toBe(true);
		hooks.escapeOutside.mockReturnValue(true);
		expect(press([], 'Escape')).toBe(false);
		expect(hooks.onClose).toHaveBeenCalledTimes(2);
	});

	it('turns an option with its chord or its button, and searches again at once', () => {
		const { bar, hooks, press } = openBar();
		bar.open(false, 'ash');
		// Registered by the key's name, which a Mac's Option leaves alone.
		press(['Alt'], 'C');
		expect(bar.searchOptions()).toEqual({ caseSensitive: true, wholeWord: false, regex: false });
		const word = bar.containerEl.querySelectorAll<HTMLElement>('.snowflake-method-search-option')[1];
		word?.click();
		expect(bar.searchOptions().wholeWord).toBe(true);
		expect(word?.classList.contains('is-active')).toBe(true);
		expect(word?.getAttribute('aria-pressed')).toBe('true');
		expect(hooks.onQuery).toHaveBeenCalledTimes(2);
	});

	it('searches once typing in the find box pauses, and not while a word is being spelled', () => {
		vi.useFakeTimers();
		try {
			const { bar, hooks, find } = openBar();
			bar.open(false, null);
			find.value = 'li';
			find.dispatchEvent(new InputEvent('input', { isComposing: true }));
			vi.advanceTimersByTime(500);
			expect(hooks.onQuery).not.toHaveBeenCalled();
			find.value = '林';
			find.dispatchEvent(new Event('compositionend'));
			vi.advanceTimersByTime(500);
			expect(hooks.onQuery).toHaveBeenCalledTimes(1);
			expect(bar.query()).toBe('林');
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows the count as the app does, tinted when nothing matches', () => {
		const { bar } = openBar();
		const count = bar.containerEl.querySelector<HTMLElement>('.document-search-count');
		const box = bar.containerEl.querySelector('.document-search-input');
		bar.showCount({ kind: 'count', index: 3, total: 12, limited: false });
		expect(count?.textContent).toBe('3 / 12');
		expect(box?.classList.contains('mod-no-match')).toBe(false);
		bar.showCount({ kind: 'count', index: 0, total: 0, limited: false });
		expect(box?.classList.contains('mod-no-match')).toBe(true);
		bar.showCount({ kind: 'count', index: 1, total: 50000, limited: true });
		expect(count?.textContent).toBe('1 / 50000+');
		bar.showCount({ kind: 'error', message: 'Unterminated group' });
		expect(count?.textContent).toBe('manuscript.search.invalid');
		expect(box?.classList.contains('mod-no-match')).toBe(true);
		bar.showCount({ kind: 'none' });
		expect(count?.isShown()).toBe(false);
	});
});

describe('chordLabel', () => {
	it('writes a chord as the app writes it on each platform', () => {
		expect(chordLabel(['Shift'], 'F3', true)).toBe('⇧ F3');
		expect(chordLabel(['Mod', 'Alt'], 'Enter', true)).toBe('⌘ ⌥ Enter');
		expect(chordLabel(['Mod', 'Alt'], 'Enter', false)).toBe('Ctrl + Alt + Enter');
		expect(chordLabel([], 'F3', false)).toBe('F3');
	});
});
