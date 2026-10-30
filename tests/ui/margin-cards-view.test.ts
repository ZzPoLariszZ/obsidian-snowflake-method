// @vitest-environment happy-dom

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MarginCardsHub } from '../../src/ui/margin-cards-hub';
import { marginCardsLens } from '../../src/ui/margin-cards-list';
import { SnowflakeMarginCardsView } from '../../src/ui/margin-cards-view';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	/** A search box that is a real input, so its placeholder can be read. */
	class SearchComponent {
		readonly inputEl: HTMLInputElement;

		constructor(container: HTMLElement) {
			const box = container.createDiv({ cls: 'search-input-container' });
			this.inputEl = box.createEl('input', { attr: { type: 'search' } });
		}

		setPlaceholder(text: string): this {
			this.inputEl.placeholder = text;
			return this;
		}

		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}

		onChange(): this {
			return this;
		}
	}
	return {
		...runtime,
		ItemView: class {},
		SearchComponent,
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

/**
 * The sidebar view over its prototype, speaking for a language and a
 * project a test can move: the translator stamps every key with the
 * language it answered in, and the fingerprint is the two together, as the
 * plugin's is.
 */
const sidebar = (): {
	view: SnowflakeMarginCardsView;
	contentEl: HTMLElement;
	speak: (language: string) => void;
	open: (project: string) => void;
} => {
	let language = 'en';
	let project = 'Demo';
	const contentEl = document.body.createDiv();
	const view = Object.create(SnowflakeMarginCardsView.prototype) as SnowflakeMarginCardsView;
	Object.assign(view, {
		app: {},
		leaf: {},
		containerEl: contentEl,
		contentEl,
		registerDomEvent: () => undefined,
		deps: {
			hub: new MarginCardsHub(),
			t: (key: string) => `${language}:${key}`,
			stepAside: () => undefined,
			fingerprint: () => `${language}|${project}`,
		},
		lens: marginCardsLens(),
		popover: null,
		list: null,
	});
	return {
		view,
		contentEl,
		speak: (next) => {
			language = next;
		},
		open: (next) => {
			project = next;
		},
	};
};

const placeholder = (host: HTMLElement): string | undefined =>
	host.querySelector<HTMLInputElement>('.search-input-container input')?.placeholder;

describe('the margin card sidebar’s language', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	it('is the current project’s, as the statistics and sticky notes sidebars speak it', async () => {
		const { view, contentEl, speak } = sidebar();
		await view.onOpen();
		expect(view.getDisplayText()).toBe('en:marginCards.viewTitle');
		expect(placeholder(contentEl)).toBe('en:marginCards.searchPlaceholder');
		speak('zh-CN');
		view.rerender();
		expect(view.getDisplayText()).toBe('zh-CN:marginCards.viewTitle');
		expect(placeholder(contentEl)).toBe('zh-CN:marginCards.searchPlaceholder');
		await view.onClose();
	});

	it('redraws the column only when the language or the project has moved', async () => {
		const { view, contentEl, open } = sidebar();
		await view.onOpen();
		const column = contentEl.firstElementChild;
		expect(column).not.toBeNull();
		// The vault asks for a rerender on every save: with nothing moved, the
		// column is left as it stands.
		view.rerender();
		expect(contentEl.firstElementChild).toBe(column);
		// Another project may speak another language, so a change of project
		// is a change to redraw under.
		open('演示');
		view.rerender();
		const redrawn = contentEl.firstElementChild;
		expect(redrawn).not.toBe(column);
		view.rerender();
		expect(contentEl.firstElementChild).toBe(redrawn);
		await view.onClose();
	});
});
