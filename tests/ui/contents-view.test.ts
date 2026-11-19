// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentsHub, type ContentsRow } from '../../src/ui/contents-hub';
import { CONTENTS_VIEW_TYPE, SnowflakeContentsView } from '../../src/ui/contents-view';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {
			app = {};
			scope: unknown = null;
		},
	};
});

/** A feed's answers to what is asked of a chapter itself, for the tests that ask nothing. */
const quiet = {
	editable: true,
	menu: (): void => undefined,
	rename: (): void => undefined,
	remove: (): void => undefined,
};

const chapters = (count: number): ContentsRow[] =>
	Array.from({ length: count }, (_, at) => ({
		path: `Novel/50_Manuscript/Chapter ${String(at + 1)}.md`,
		title: `Chapter ${String(at + 1)}`,
	}));

/**
 * The sidebar view over its prototype, speaking for a language and a
 * project a test can move, as the margin cards sidebar's test builds its
 * own: the translator stamps every key with the language it answered in.
 */
const sidebar = (): {
	view: SnowflakeContentsView;
	contentEl: HTMLElement;
	hub: ContentsHub;
	/** What happened, in order: the drawer put away, a chapter gone to. */
	said: string[];
	speak: (language: string) => void;
	open: (project: string) => void;
} => {
	let language = 'en';
	let project = 'Demo';
	const said: string[] = [];
	const hub = new ContentsHub();
	const contentEl = document.body.createDiv();
	const view = Object.create(SnowflakeContentsView.prototype) as SnowflakeContentsView;
	Object.assign(view, {
		app: {},
		leaf: {},
		containerEl: contentEl,
		contentEl,
		registerDomEvent: () => undefined,
		deps: {
			hub,
			t: (key: string) => `${language}:${key}`,
			still: () => false,
			stepAside: () => {
				said.push('aside');
			},
			fingerprint: () => `${language}|${project}`,
		},
		wheel: null,
		release: null,
		shownFingerprint: null,
	});
	return {
		view,
		contentEl,
		hub,
		said,
		speak: (next) => {
			language = next;
		},
		open: (next) => {
			project = next;
		},
	};
};

const wheelOf = (contentEl: HTMLElement): HTMLElement | null =>
	contentEl.querySelector<HTMLElement>('.snowflake-method-contents-wheel');

/** What a screen reader calls the wheel: the words its landmark is named by. */
const nameOf = (wheel: HTMLElement | null): string | null =>
	document.getElementById(wheel?.getAttribute('aria-labelledby') ?? '')?.textContent ?? null;

const emptyLine = (contentEl: HTMLElement): HTMLElement | null =>
	contentEl.querySelector<HTMLElement>('.snowflake-method-character-empty');

describe('the contents sidebar', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		document.body.replaceChildren();
	});

	it('is a view of its own with the contents’ symbol and name', () => {
		const { view } = sidebar();
		expect(view.getViewType()).toBe(CONTENTS_VIEW_TYPE);
		expect(CONTENTS_VIEW_TYPE).toBe('snowflake-method-contents');
		expect(view.getIcon()).toBe('table-of-contents');
		expect(view.getDisplayText()).toBe('en:contents.viewTitle');
	});

	it('says there is no stream to list, then turns to the one that publishes', async () => {
		const { view, contentEl, hub } = sidebar();
		await view.onOpen();
		expect(contentEl.classList.contains('snowflake-method-contents-view')).toBe(true);
		expect(emptyLine(contentEl)?.textContent).toBe('en:contents.noStream');
		expect(emptyLine(contentEl)?.hidden).toBe(false);
		expect(wheelOf(contentEl)?.hidden).toBe(true);
		const rows = chapters(4);
		const stream = {};
		hub.publish(stream, { rows, active: rows[1]?.path ?? null, reach: 3, go: () => undefined, ...quiet });
		expect(emptyLine(contentEl)?.hidden).toBe(true);
		const wheel = wheelOf(contentEl);
		expect(wheel?.hidden).toBe(false);
		expect(wheel?.style.getPropertyValue('--snowflake-method-contents-rows')).toBe('7');
		const names = [...(wheel?.querySelectorAll('.snowflake-method-contents-item') ?? [])];
		expect(names.map((name) => name.textContent)).toEqual([
			'Chapter 1',
			'Chapter 2',
			'Chapter 3',
			'Chapter 4',
		]);
		expect(names[1]?.getAttribute('aria-current')).toBe('true');
		// The page reads on: the mark moves, and the same wheel stands.
		hub.publish(stream, { rows, active: rows[2]?.path ?? null, reach: 3, go: () => undefined, ...quiet });
		expect(wheelOf(contentEl)).toBe(wheel);
		expect(names[2]?.getAttribute('aria-current')).toBe('true');
		expect(names[1]?.hasAttribute('aria-current')).toBe(false);
	});

	it('says a manuscript with no note in it has none, in the stream’s own words', async () => {
		const { view, contentEl, hub } = sidebar();
		await view.onOpen();
		const stream = {};
		hub.publish(stream, { rows: [], active: null, reach: 5, go: () => undefined, ...quiet });
		expect(emptyLine(contentEl)?.textContent).toBe('en:manuscript.empty');
		expect(wheelOf(contentEl)?.hidden).toBe(true);
		// The stream closes: back to having none to list.
		hub.retire(stream);
		expect(emptyLine(contentEl)?.textContent).toBe('en:contents.noStream');
	});

	it('brings a pressed chapter up in the stream on show, the drawer put away first', async () => {
		const { view, contentEl, hub, said } = sidebar();
		await view.onOpen();
		const rows = chapters(6);
		hub.publish({}, {
			rows,
			active: rows[0]?.path ?? null,
			reach: 5,
			go: (path) => {
				said.push(path);
			},
			...quiet,
		});
		const names = contentEl.querySelectorAll<HTMLElement>('.snowflake-method-contents-item');
		names[4]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(said).toEqual(['aside', 'Novel/50_Manuscript/Chapter 5.md']);
	});

	it('hands what is asked of a chapter itself on to the stream on show', async () => {
		const { view, contentEl, hub, said } = sidebar();
		await view.onOpen();
		const rows = chapters(4);
		hub.publish({}, {
			rows,
			active: rows[0]?.path ?? null,
			reach: 5,
			editable: true,
			go: () => undefined,
			menu: (path) => {
				said.push(`menu ${path}`);
			},
			rename: (path) => {
				said.push(`rename ${path}`);
			},
			remove: (path) => {
				said.push(`remove ${path}`);
			},
		});
		const names = contentEl.querySelectorAll<HTMLElement>('.snowflake-method-contents-item');
		names[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		names[2]?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
		);
		// The drawer stays: a menu or a question opens over it.
		expect(said).toEqual([
			'menu Novel/50_Manuscript/Chapter 2.md',
			'remove Novel/50_Manuscript/Chapter 3.md',
		]);
	});

	it('offers nothing on the rows of a manuscript that may not be written to', async () => {
		const { view, contentEl, hub, said } = sidebar();
		await view.onOpen();
		const rows = chapters(3);
		hub.publish({}, {
			rows,
			active: rows[0]?.path ?? null,
			reach: 5,
			go: () => undefined,
			...quiet,
			editable: false,
			menu: (path) => {
				said.push(`menu ${path}`);
			},
		});
		const names = contentEl.querySelectorAll<HTMLElement>('.snowflake-method-contents-item');
		const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		names[1]?.dispatchEvent(press);
		expect(press.defaultPrevented).toBe(false);
		expect(said).toEqual([]);
	});

	it('answers F2 from its own scope, for the row that holds the keys and no other', async () => {
		const hub = new ContentsHub();
		const contentEl = document.body.createDiv();
		const view = new SnowflakeContentsView({} as never, {
			hub,
			t: (key: string) => key,
			still: () => false,
			stepAside: () => undefined,
			fingerprint: () => 'en|Demo',
		});
		Object.assign(view, {
			leaf: {},
			containerEl: contentEl,
			contentEl,
			registerDomEvent: () => undefined,
		});
		await view.onOpen();
		const renamed: string[] = [];
		const rows = chapters(4);
		hub.publish({}, {
			rows,
			active: rows[0]?.path ?? null,
			reach: 5,
			go: () => undefined,
			...quiet,
			rename: (path) => {
				renamed.push(path);
			},
		});
		// The app binds F2 to its own rename and reads it at the window: the
		// view's scope is where the key can be answered at all.
		const scope = view.scope as unknown as {
			keys: { key: string | null; func: (event: KeyboardEvent, context: never) => unknown }[];
		};
		const f2 = scope.keys.find((bound) => bound.key === 'F2');
		const press = (): unknown => f2?.func(new KeyboardEvent('keydown', { key: 'F2' }), {} as never);
		// No row holds the keys: the key is the app's.
		expect(press()).toBe(true);
		expect(renamed).toEqual([]);
		contentEl.querySelectorAll<HTMLElement>('.snowflake-method-contents-item')[2]?.focus();
		expect(press()).toBe(false);
		expect(renamed).toEqual(['Novel/50_Manuscript/Chapter 3.md']);
	});

	it('speaks the project’s language: built again when it moves, and left standing when it does not', async () => {
		const { view, contentEl, hub, speak, open } = sidebar();
		await view.onOpen();
		const rows = chapters(2);
		hub.publish({}, { rows, active: null, reach: 5, go: () => undefined, ...quiet });
		const first = wheelOf(contentEl);
		expect(nameOf(first)).toBe('en:contents.viewTitle');
		// A save asks every sidebar to draw again: nothing moved, nothing is built.
		view.rerender();
		expect(wheelOf(contentEl)).toBe(first);
		speak('zh');
		view.rerender();
		const second = wheelOf(contentEl);
		expect(second).not.toBe(first);
		expect(nameOf(second)).toBe('zh:contents.viewTitle');
		expect(contentEl.querySelectorAll('.snowflake-method-contents-wheel')).toHaveLength(1);
		expect(contentEl.querySelectorAll('.snowflake-method-contents-item')).toHaveLength(2);
		// Another project in the same language is another column too.
		open('Clocktower Snow');
		view.rerender();
		expect(wheelOf(contentEl)).not.toBe(second);
	});

	it('stops listening once closed', async () => {
		const { view, contentEl, hub } = sidebar();
		await view.onOpen();
		await view.onClose();
		expect(contentEl.childElementCount).toBe(0);
		hub.publish({}, { rows: chapters(3), active: null, reach: 5, go: () => undefined, ...quiet });
		expect(contentEl.childElementCount).toBe(0);
	});
});

/**
 * The sidebar in a leaf as the app builds one: the bar over the view with
 * its title, the content below it, and a tab the app writes the title into
 * when the leaf is told to update its header.
 */
const inLeaf = (): {
	view: SnowflakeContentsView;
	title: HTMLElement;
	tab: { title: string; updates: number };
	speak: (language: string) => void;
} => {
	let language = 'en';
	const containerEl = document.body.createDiv({ cls: 'workspace-leaf-content' });
	const title = containerEl
		.createDiv({ cls: 'view-header' })
		.createDiv({ cls: 'view-header-title', text: 'en:contents.viewTitle' });
	const contentEl = containerEl.createDiv({ cls: 'view-content' });
	const view = Object.create(SnowflakeContentsView.prototype) as SnowflakeContentsView;
	const tab = { title: 'en:contents.viewTitle', updates: 0 };
	Object.assign(view, {
		app: {},
		leaf: {
			updateHeader: () => {
				tab.updates += 1;
				tab.title = view.getDisplayText();
			},
		},
		containerEl,
		contentEl,
		registerDomEvent: () => undefined,
		deps: {
			hub: new ContentsHub(),
			t: (key: string) => `${language}:${key}`,
			still: () => false,
			stepAside: () => undefined,
			fingerprint: () => `${language}|Demo`,
		},
		wheel: null,
		release: null,
		shownFingerprint: null,
	});
	return {
		view,
		title,
		tab,
		speak: (next) => {
			language = next;
		},
	};
};

describe('the contents sidebar’s title through a change of language', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		document.body.replaceChildren();
	});

	it('is said again in the tab and in the bar over the view', async () => {
		const { view, title, tab, speak } = inLeaf();
		await view.onOpen();
		speak('zh-TW');
		view.rerender();
		expect(tab.updates).toBe(1);
		expect(tab.title).toBe('zh-TW:contents.viewTitle');
		expect(title.textContent).toBe('zh-TW:contents.viewTitle');
	});

	it('is left alone by a rerender that finds nothing moved', async () => {
		const { view, title, tab } = inLeaf();
		await view.onOpen();
		view.rerender();
		expect(tab.updates).toBe(0);
		expect(title.textContent).toBe('en:contents.viewTitle');
	});
});

