// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {},
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

interface Mounted {
	bar: HTMLElement;
	/** Every opening of the find bar, as asked: with the replace row or without. */
	searches: boolean[];
	/** Every opening of the margin card sidebar. */
	opened: number[];
	/** Every card the sidebar was asked to light. */
	lit: string[];
	view: { editingPath: string | null; refreshToolbar(): void };
}

/**
 * The stream's bar on its own, over the view's prototype. The device says
 * whether the writing faces ride the bar, and the find bar is recorded
 * rather than built.
 */
const mount = (faces: boolean): Mounted => {
	const searches: boolean[] = [];
	const opened: number[] = [];
	const lit: string[] = [];
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	const contentEl = document.body.createDiv();
	Object.assign(view, {
		contentEl,
		toolbarButtons: [],
		editingPath: null,
		caretCard: null,
		releaseWritingFaces: null,
		modeToggles: {},
		t: (key: string) => key,
		host: {
			mountWritingFaces: (bar: HTMLElement) => {
				if (!faces) return null;
				bar.createDiv({ cls: 'snowflake-method-toolbar-faces' });
				return () => {};
			},
			manuscriptWindowSettings: () => ({ typewriter: false, focusLevel: 'off' }),
			openMarginCards: () => {
				opened.push(1);
				return Promise.resolve();
			},
			marginCards: {
				spotlight: (key: string) => {
					lit.push(key);
				},
			},
		},
		openSearch: (replace: boolean) => {
			searches.push(replace);
			return true;
		},
	});
	(view as unknown as { renderToolbar(): void }).renderToolbar();
	const bar = contentEl.querySelector<HTMLElement>('.snowflake-method-manuscript-toolbar');
	if (bar === null) throw new Error('the bar was not built');
	return { bar, searches, opened, lit, view: view as unknown as Mounted['view'] };
};

const has = (el: Element | null | undefined, name: string): boolean =>
	el?.classList.contains(name) === true;

describe('the stream toolbar', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('stands the find button right after the selection button, among the marks on the desktop', () => {
		const { bar } = mount(false);
		const find = bar.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-find');
		expect(find?.getAttribute('data-tooltip')).toBe('manuscript.toolbar.search');
		expect(has(find?.previousElementSibling, 'snowflake-method-toolbar-selection')).toBe(true);
		expect(has(find?.nextElementSibling, 'snowflake-method-toolbar-separator')).toBe(true);
		expect(has(find?.previousElementSibling?.previousElementSibling, 'snowflake-method-toolbar-button')).toBe(true);
		expect(bar.querySelector('.snowflake-method-toolbar-faces')).toBeNull();
	});

	it('keeps the pair at the head of the bar beside the writing faces on mobile', () => {
		const { bar } = mount(true);
		const [faces, selection, find, rule] = [...bar.children];
		expect(has(faces, 'snowflake-method-toolbar-faces')).toBe(true);
		expect(has(selection, 'snowflake-method-toolbar-selection')).toBe(true);
		expect(has(find, 'snowflake-method-toolbar-find')).toBe(true);
		expect(has(rule, 'snowflake-method-toolbar-separator')).toBe(true);
		expect(bar.querySelectorAll('.snowflake-method-toolbar-find')).toHaveLength(1);
	});

	it('opens the find bar as Mod+F does, live while the stream is only read', () => {
		const { bar, searches, view } = mount(false);
		const find = bar.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-find');
		const selection = bar.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-selection');
		expect(selection?.disabled).toBe(true);
		expect(find?.disabled).toBe(false);
		find?.click();
		expect(searches).toEqual([false]);
		view.editingPath = 'Novel/50_Manuscript/Chapter 1.md';
		view.refreshToolbar();
		expect(selection?.disabled).toBe(false);
		expect(find?.disabled).toBe(false);
	});

	it('opens the margin card sidebar from the button after the mentions door, live while reading', async () => {
		const { bar, opened, lit, view } = mount(false);
		const cards = bar.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-cards');
		expect(cards?.getAttribute('data-tooltip')).toBe('manuscript.toolbar.marginCards');
		expect(has(cards?.previousElementSibling, 'snowflake-method-toolbar-mentions')).toBe(true);
		expect(cards?.disabled).toBe(false);
		// The count waits, hidden, for the stream to say what the page holds,
		// and stands beside the icon, not over it.
		const count = cards?.querySelector('.snowflake-method-toolbar-count');
		expect(count?.classList.contains('is-empty')).toBe(true);
		expect(count?.parentElement).toBe(cards);
		cards?.click();
		await vi.waitFor(() => expect(opened).toEqual([1]));
		expect(lit).toEqual([]);
		// With the caret in a card's words, the sidebar opens on that card.
		(view as unknown as { caretCard: string | null }).caretCard = 'rev-1';
		cards?.click();
		await vi.waitFor(() => expect(lit).toEqual(['rev-1']));
		expect(opened).toEqual([1, 1]);
	});
});
