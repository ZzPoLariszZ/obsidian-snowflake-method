// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentsHub } from '../../src/ui/contents-hub';
import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';
import { installObsidianDom } from '../helpers/obsidian-dom';

/** A menu's item as a test reads it back. */
interface DrawnItem {
	title: string;
	icon: string;
	warning: boolean;
	click: () => void;
}

/** Every menu shown, with what it offered and the press it answered. */
const menus = vi.hoisted(() => [] as { items: DrawnItem[]; at: unknown }[]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Item implements DrawnItem {
		title = '';
		icon = '';
		warning = false;
		click: () => void = () => undefined;
		setTitle(title: string): this {
			this.title = title;
			return this;
		}
		setIcon(icon: string): this {
			this.icon = icon;
			return this;
		}
		setWarning(warning: boolean): this {
			this.warning = warning;
			return this;
		}
		onClick(click: () => void): this {
			this.click = click;
			return this;
		}
	}
	class Menu {
		readonly items: Item[] = [];
		addItem(build: (item: Item) => void): this {
			const item = new Item();
			build(item);
			this.items.push(item);
			return this;
		}
		showAtMouseEvent(event: unknown): this {
			menus.push({ items: this.items, at: event });
			return this;
		}
	}
	return {
		...runtime,
		ItemView: class {},
		Menu,
		setIcon: (el: HTMLElement, icon: string) => {
			el.setAttribute('data-icon', icon);
		},
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

/** A box on the screen, as an element would report it. */
const box = (top: number, height: number): DOMRect =>
	({ top, bottom: top + height, left: 0, right: 800, width: 800, height }) as DOMRect;

/** A caret's reach in a note, as the editor reports it. */
interface Reach {
	from: number;
	to: number;
}

interface EditorStub {
	selection(): Reach;
	read(): string;
}

interface Entry {
	path: string;
	el: HTMLElement;
	editor: EditorStub | null;
	pending: string | null;
	text: { body: string };
}

/** The parts of the view this file reaches past its public face for. */
interface Inside {
	activePath: string | null;
	anchorPath: string | null;
	editingPath: string | null;
	place: { path: string; offset: number } | null;
	contentsBound: string | null;
	shape: string;
	model: {
		projectPath: string;
		readOnly: boolean;
		segments: { path: string; title: string }[];
	} | null;
	mounted: Map<string, Entry>;
	refreshRun: Promise<void> | null;
	refreshOnce(): Promise<void>;
	refresh(): Promise<void>;
	noteRenamed(from: string, to: string): void;
	carryRenames(): { active: string | null; place: { path: string; offset: number } | null };
	reseatActive(before: readonly { path: string }[]): boolean;
	settleCarried(carried: {
		active: string | null;
		place: { path: string; offset: number } | null;
	}): Promise<void>;
	readActiveFromPage(): boolean;
	syncContents(): void;
	goToChapter(path: string): Promise<void>;
	createSegment(placement: { atEnd: true }): Promise<void>;
	openChapterMenu(path: string, event: MouseEvent): void;
	renameChapter(path: string): Promise<void>;
	deleteChapter(path: string): Promise<void>;
}

interface Stream {
	view: Inside;
	contentEl: HTMLElement;
	streamEl: HTMLElement;
	hub: ContentsHub;
	/** What the view did and what it asked of its host, in order. */
	said: string[];
	/**
	 * What the host answers a rename and a deletion with; a test sets them.
	 * A deletion answers with the notes its renumbering renames, or with
	 * null where the author declined, and `refused` has it fail after the
	 * author agreed, with nothing renamed.
	 */
	answers: {
		renamed: { from: string; to: string } | null;
		deleted: readonly { from: string; to: string }[] | null;
		refused: string | null;
		created: string | null;
	};
	/** Puts a chapter on the page: where it stands, how tall, and its editor if it is being written in. */
	put: (number: number, top: number, height: number, editor?: EditorStub) => Entry;
	/** Every call that opened an editor, with the caret it was given. */
	opened: { path: string; caret: Reach | undefined }[];
}

const chapter = (number: number): { path: string; title: string } => ({
	path: `Novel/50_Manuscript/Chapter ${String(number)}.md`,
	title: `Chapter ${String(number)}`,
});

const PAGE = { top: 100, height: 800 };

/**
 * A stream over the view's prototype: five chapters, the page in the
 * second, and a host that records what it is asked and answers what a test
 * tells it to. The heavy machinery, the window and the editor, is stood in
 * for by recorders, since what these tests ask is which of them is called,
 * with what, and in what order.
 */
const stream = (options: { reads?: boolean } = {}): Stream => {
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	const contentEl = document.body.createDiv();
	const streamEl = contentEl.createDiv({ cls: 'snowflake-method-manuscript-stream' });
	streamEl.getBoundingClientRect = () => box(PAGE.top, PAGE.height);
	Object.defineProperty(streamEl, 'clientHeight', { value: PAGE.height });
	const hub = new ContentsHub();
	const said: string[] = [];
	const opened: Stream['opened'] = [];
	const answers: Stream['answers'] = { renamed: null, deleted: null, refused: null, created: null };
	const mounted = new Map<string, Entry>();
	const inside = view as unknown as Inside;
	Object.assign(view, {
		contentEl,
		containerEl: contentEl,
		streamEl,
		closing: false,
		contents: null,
		contentsRows: [],
		contentsShape: null,
		contentsTold: null,
		contentsBound: null,
		renamed: new Map<string, string>(),
		anchorPath: null,
		place: null,
		editingPath: null,
		activePath: chapter(2).path,
		refreshRun: null,
		refreshAgain: false,
		refreshQueuedWhileHidden: false,
		model: {
			projectPath: 'Novel/Novel.md',
			readOnly: false,
			segments: [1, 2, 3, 4, 5].map(chapter),
		},
		shape: 'five chapters',
		mounted,
		t: (key: string) => key,
		leaf: {},
		app: {
			workspace: {
				// Brought forward, the tab is in sight and has a layout again.
				revealLeaf: () => {
					said.push('reveal');
					contentEl.hidden = false;
					return Promise.resolve();
				},
			},
		},
		showError: (error: unknown) => {
			said.push(`error ${error instanceof Error ? error.message : String(error)}`);
		},
		goTo: (path: string) => {
			said.push(`goTo ${path}`);
			return Promise.resolve();
		},
		applyWindow: () => {
			said.push('window');
			return Promise.resolve();
		},
		scrollToActive: () => {
			said.push(`top ${inside.activePath ?? ''}`);
		},
		restorePlace: (place: { path: string; offset: number }) => {
			said.push(`place ${place.path} ${String(place.offset)}`);
			return Promise.resolve();
		},
		measurePlace: () => null,
		flushPendingSave: () => {
			said.push('save');
			return Promise.resolve();
		},
		deactivateSegment: () => {
			said.push(`down ${inside.editingPath ?? ''}`);
			inside.editingPath = null;
			return Promise.resolve();
		},
		activateSegment: (
			path: string,
			_clicked?: unknown,
			_arriving?: unknown,
			_crossing?: unknown,
			caret?: Reach,
		) => {
			opened.push({ path, caret });
			inside.editingPath = path;
			return Promise.resolve();
		},
		host: {
			manuscriptWindowSettings: () => ({ before: 5, after: 5 }),
			contents: hub,
			createManuscriptSegment: async (
				_project: string,
				_placement: unknown,
				onNamed?: () => Promise<void>,
			) => {
				said.push('host create');
				if (answers.created !== null) await onNamed?.();
				return answers.created;
			},
			renameManuscriptSegment: async (
				project: string,
				path: string,
				onAgreed?: () => Promise<void>,
			) => {
				said.push(`host rename ${project} ${path}`);
				await onAgreed?.();
				return answers.renamed;
			},
			deleteManuscriptSegment: async (
				project: string,
				path: string,
				onAgreed?: (renaming: readonly string[]) => Promise<void>,
			) => {
				said.push(`host delete ${project} ${path}`);
				if (answers.deleted === null) return null;
				await onAgreed?.(answers.deleted.map(({ from }) => from));
				if (answers.refused !== null) throw new Error(answers.refused);
				return answers.deleted;
			},
		},
	});
	// The reading again of the manuscript, which these tests only count,
	// but for the two that ask how readings queue behind one another.
	if (options.reads !== true) {
		inside.refresh = () => {
			said.push('refresh');
			return Promise.resolve();
		};
	}
	return {
		view: inside,
		contentEl,
		streamEl,
		hub,
		said,
		answers,
		opened,
		put: (number, top, height, editor) => {
			const el = streamEl.createDiv();
			el.getBoundingClientRect = () => box(top, height);
			Object.defineProperty(el, 'offsetTop', { value: top - PAGE.top });
			Object.defineProperty(el, 'offsetHeight', { value: height });
			const entry: Entry = {
				path: chapter(number).path,
				el,
				editor: editor ?? null,
				pending: null,
				text: { body: '' },
			};
			mounted.set(entry.path, entry);
			return entry;
		},
	};
};

describe('the stream’s chapters: followed, added, renamed and deleted', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	beforeEach(() => {
		document.body.replaceChildren();
		menus.length = 0;
	});

	it('turns the wheel to the chapter being written in while any of it is on the page', () => {
		const { view, hub, put } = stream();
		// The page's own chapter is read off a line a quarter of the way
		// down, which a short chapter at the foot of the book never reaches.
		put(2, -900, 1500);
		put(4, 700, 120);
		view.editingPath = chapter(4).path;
		view.syncContents();
		expect(hub.current()?.active).toBe(chapter(4).path);
		// And the window still answers to the line.
		expect(view.activePath).toBe(chapter(2).path);
	});

	it('goes back to the page’s chapter once the one being written in is out of sight', () => {
		const { view, hub, put } = stream();
		put(2, 0, 2000);
		// Wholly below the page, then wholly above it: neither is on it.
		const below = put(4, PAGE.top + PAGE.height, 120);
		view.editingPath = chapter(4).path;
		view.syncContents();
		expect(hub.current()?.active).toBe(chapter(2).path);
		below.el.getBoundingClientRect = () => box(PAGE.top - 120, 120);
		view.syncContents();
		expect(hub.current()?.active).toBe(chapter(2).path);
		// One pixel of it showing is the author back at it.
		below.el.getBoundingClientRect = () => box(PAGE.top - 119, 120);
		view.syncContents();
		expect(hub.current()?.active).toBe(chapter(4).path);
	});

	it('says where the wheel was sent until the page has arrived', async () => {
		const { view, hub, said, put } = stream();
		put(2, 100, 400);
		view.editingPath = chapter(2).path;
		view.syncContents();
		let onTheRoad: string | null | undefined;
		Object.assign(view, {
			goTo: (path: string) => {
				// Putting the editor away tells the wheel of the chapter left.
				view.editingPath = null;
				view.syncContents();
				onTheRoad = hub.current()?.active;
				view.activePath = path;
				said.push(`goTo ${path}`);
				return Promise.resolve();
			},
		});
		await view.goToChapter(chapter(5).path);
		expect(onTheRoad).toBe(chapter(5).path);
		expect(view.contentsBound).toBeNull();
		expect(hub.current()?.active).toBe(chapter(5).path);
		// A chapter the manuscript has lost is gone to by nobody.
		await view.goToChapter('Novel/50_Manuscript/Gone.md');
		expect(said).toEqual([`goTo ${chapter(5).path}`]);
	});

	it('brings its tab forward before going to a chapter asked for while it stood behind another', async () => {
		const { view, said, contentEl } = stream();
		// The sidebar's wheel can be pressed while the stream is out of sight,
		// where a page has no layout to move in and the press was lost.
		contentEl.hidden = true;
		await view.goToChapter(chapter(5).path);
		expect(said).toEqual(['reveal', `goTo ${chapter(5).path}`]);
		// In sight already, it is asked for nothing.
		said.length = 0;
		await view.goToChapter(chapter(3).path);
		expect(said).toEqual([`goTo ${chapter(3).path}`]);
	});

	it('reads the page’s chapter off the reading line, and says so only when it moved', () => {
		const { view, hub, streamEl, put } = stream();
		Object.defineProperty(streamEl, 'scrollTop', { value: 0, writable: true });
		put(1, PAGE.top, 150);
		put(2, PAGE.top + 150, 100);
		put(3, PAGE.top + 250, 900);
		view.activePath = chapter(1).path;
		// A quarter of the way down an 800 pixel page is the 200th: the second
		// chapter's top has passed it and the third's has not.
		expect(view.readActiveFromPage()).toBe(true);
		expect(view.activePath).toBe(chapter(2).path);
		expect(hub.current()?.active).toBe(chapter(2).path);
		expect(view.readActiveFromPage()).toBe(false);
	});

	it('gives a page whose chapter went the chapter before it, or the one after the first', () => {
		const { view } = stream();
		const before = [1, 2, 3, 4, 5].map(chapter);
		const without = (...gone: number[]): void => {
			if (view.model === null) throw new Error('no manuscript');
			view.model.segments = before.filter(
				(segment) => !gone.some((number) => chapter(number).path === segment.path),
			);
		};
		// Still in the book: nothing to do.
		view.activePath = chapter(3).path;
		expect(view.reseatActive(before)).toBe(false);
		expect(view.activePath).toBe(chapter(3).path);
		// The last chapter deleted while the page stood in it. Left pointing
		// at it, the window fell back to the head of the book.
		view.activePath = chapter(5).path;
		without(5);
		expect(view.reseatActive(before)).toBe(true);
		expect(view.activePath).toBe(chapter(4).path);
		// Its neighbour gone with it: the nearest one before that is still there.
		view.activePath = chapter(4).path;
		without(3, 4);
		expect(view.reseatActive(before)).toBe(true);
		expect(view.activePath).toBe(chapter(2).path);
		// The first chapter has none before it.
		view.activePath = chapter(1).path;
		without(1);
		expect(view.reseatActive(before)).toBe(true);
		expect(view.activePath).toBe(chapter(2).path);
		// A page that stood nowhere in the old book is left to the window.
		view.activePath = 'Novel/50_Manuscript/Elsewhere.md';
		expect(view.reseatActive(before)).toBe(false);
		view.activePath = null;
		expect(view.reseatActive(before)).toBe(false);
	});

	it('moves what stood on a renamed note onto its new name, and hands the window the rest', () => {
		const { view } = stream();
		const renamed = 'Novel/50_Manuscript/Chapter 3 - Dusk.md';
		view.anchorPath = chapter(3).path;
		view.place = { path: chapter(3).path, offset: 240 };
		view.activePath = chapter(3).path;
		Object.assign(view, { measurePlace: () => ({ path: chapter(3).path, offset: 412 }) });
		view.noteRenamed(chapter(3).path, renamed);
		const carried = view.carryRenames();
		expect(view.anchorPath).toBe(renamed);
		expect(view.place).toEqual({ path: renamed, offset: 240 });
		// The page's chapter and the reader's place wait for the window: the
		// old note is still up and the new one is not.
		expect(view.activePath).toBe(chapter(3).path);
		expect(carried).toEqual({ active: renamed, place: { path: renamed, offset: 412 } });
		// Spent: the next reading carries nothing.
		expect(view.carryRenames()).toEqual({ active: null, place: null });
	});

	it('follows a note renamed twice before the manuscript was read again', () => {
		const { view } = stream();
		view.anchorPath = chapter(1).path;
		view.noteRenamed(chapter(1).path, 'Novel/50_Manuscript/Opening.md');
		view.noteRenamed('Novel/50_Manuscript/Opening.md', 'Novel/50_Manuscript/Prologue.md');
		view.carryRenames();
		expect(view.anchorPath).toBe('Novel/50_Manuscript/Prologue.md');
	});

	it('keeps no word of a rename it stands on nothing of', () => {
		const { view } = stream();
		// A project folder moved renames every note in it, each told to every
		// stream: only the notes this one stands on or holds are kept.
		view.noteRenamed('Elsewhere/Notes/One.md', 'Elsewhere/Notes/Two.md');
		view.noteRenamed(chapter(5).path, 'Novel/50_Manuscript/Coda.md');
		view.activePath = 'Elsewhere/Notes/One.md';
		view.anchorPath = chapter(5).path;
		expect(view.carryRenames()).toEqual({ active: null, place: null });
		expect(view.anchorPath).toBe(chapter(5).path);
	});

	it('carries each note of a renumbering to the name it took, though another took the one it left', () => {
		const { view } = stream();
		// The numbers move up by one, the last note first.
		view.activePath = chapter(3).path;
		view.anchorPath = chapter(4).path;
		view.noteRenamed(chapter(4).path, chapter(5).path);
		view.noteRenamed(chapter(3).path, chapter(4).path);
		const carried = view.carryRenames();
		expect(carried.active).toBe(chapter(4).path);
		expect(view.anchorPath).toBe(chapter(5).path);
	});

	it('stands a renamed chapter’s page where it was, once the note is up under its new name', async () => {
		const { view, said, put } = stream();
		const renamed = chapter(4).path;
		put(4, 300, 200);
		view.activePath = chapter(2).path;
		await view.settleCarried({ active: renamed, place: { path: renamed, offset: 60 } });
		expect(view.activePath).toBe(renamed);
		expect(said).toEqual([`place ${renamed} 60`, 'window']);
	});

	it('reads which neighbour the page is in off the page when its chapter went for good', async () => {
		const { view, said, streamEl, put } = stream();
		Object.defineProperty(streamEl, 'scrollTop', { value: 0, writable: true });
		put(1, PAGE.top, 100);
		put(3, PAGE.top + 100, 900);
		// The window was drawn round the chapter before the one that went;
		// the one after it now stands above the reading line.
		view.activePath = chapter(1).path;
		await view.settleCarried({ active: null, place: null });
		expect(view.activePath).toBe(chapter(3).path);
		expect(said).toEqual(['window']);
	});

	it('waits out a reading already under way, and is answered by one that began after it asked', async () => {
		const { view } = stream({ reads: true });
		const runs: (() => void)[] = [];
		Object.assign(view, {
			refreshOnce: () =>
				new Promise<void>((resolve) => {
					runs.push(resolve);
				}),
		});
		const first = view.refresh();
		let answered = false;
		const second = view.refresh().then(() => {
			answered = true;
		});
		expect(runs).toHaveLength(1);
		// The reading under way ends: it read the manuscript before the
		// second asker's change, so that asker is not answered yet.
		runs[0]?.();
		await vi.waitFor(() => expect(runs).toHaveLength(2));
		expect(answered).toBe(false);
		runs[1]?.();
		await Promise.all([first, second]);
		expect(answered).toBe(true);
		expect(runs).toHaveLength(2);
		expect(view.refreshRun).toBeNull();
		// And the next one asked for starts a reading of its own.
		const third = view.refresh();
		expect(runs).toHaveLength(3);
		runs[2]?.();
		await third;
	});

	it('lets go of a reading that failed, tells the one who asked for it, and reads again when asked', async () => {
		const { view } = stream({ reads: true });
		let fail = true;
		let reads = 0;
		Object.assign(view, {
			refreshOnce: () => {
				reads += 1;
				return fail ? Promise.reject(new Error('unreadable')) : Promise.resolve();
			},
		});
		const first = view.refresh();
		// The one who came while it ran is not told twice of the same failure.
		await expect(view.refresh()).resolves.toBeUndefined();
		await expect(first).rejects.toThrow('unreadable');
		expect(view.refreshRun).toBeNull();
		fail = false;
		await view.refresh();
		expect(reads).toBeGreaterThanOrEqual(2);
	});

	it('brings a new chapter’s start to the top of the page every time, then opens it', async () => {
		const { view, said, answers, opened } = stream();
		const created = 'Novel/50_Manuscript/Chapter 6.md';
		answers.created = created;
		await view.createSegment({ atEnd: true });
		expect(view.activePath).toBe(created);
		// It used to move only where the new note was not already in sight.
		expect(said).toEqual(['host create', 'down ', 'refresh', 'window', `top ${created}`]);
		expect(opened).toEqual([{ path: created, caret: undefined }]);
	});

	it('moves nothing when the author closes the naming form', async () => {
		const { view, said, opened } = stream();
		await view.createSegment({ atEnd: true });
		expect(said).toEqual(['host create']);
		expect(opened).toEqual([]);
		expect(view.activePath).toBe(chapter(2).path);
	});

	it('offers a chapter a new name and the way out of the book, on its row’s menu', async () => {
		const { view, said, answers } = stream();
		const press = new MouseEvent('contextmenu');
		view.openChapterMenu(chapter(3).path, press);
		expect(menus).toHaveLength(1);
		expect(menus[0]?.at).toBe(press);
		expect(menus[0]?.items.map(({ title, icon, warning }) => ({ title, icon, warning }))).toEqual([
			{ title: 'contents.rename', icon: 'pencil', warning: false },
			{ title: 'actions.delete', icon: 'trash-2', warning: true },
		]);
		answers.renamed = { from: chapter(3).path, to: chapter(3).path };
		menus[0]?.items[0]?.click();
		await vi.waitFor(() =>
			expect(said).toContain(`host rename Novel/Novel.md ${chapter(3).path}`),
		);
		menus[0]?.items[1]?.click();
		await vi.waitFor(() =>
			expect(said).toContain(`host delete Novel/Novel.md ${chapter(3).path}`),
		);
	});

	it('offers nothing in a manuscript that may not be written to, or for a note it does not hold', async () => {
		const { view, said } = stream();
		view.openChapterMenu('Novel/50_Manuscript/Gone.md', new MouseEvent('contextmenu'));
		await view.renameChapter('Novel/50_Manuscript/Gone.md');
		if (view.model !== null) view.model.readOnly = true;
		view.openChapterMenu(chapter(3).path, new MouseEvent('contextmenu'));
		await view.renameChapter(chapter(3).path);
		await view.deleteChapter(chapter(3).path);
		expect(menus).toEqual([]);
		expect(said).toEqual([]);
	});

	it('renames a chapter that is only being read with nothing taken down', async () => {
		const { view, said, answers, opened } = stream();
		answers.renamed = { from: chapter(3).path, to: 'Novel/50_Manuscript/Dusk.md' };
		await view.renameChapter(chapter(3).path);
		expect(said).toEqual([`host rename Novel/Novel.md ${chapter(3).path}`, 'refresh']);
		expect(opened).toEqual([]);
	});

	it('puts the note being written in back up under its new name, the caret moved along with the heading', async () => {
		const { view, said, answers, opened, put } = stream();
		const before = '# Chapter 3\n\nThe bell rang twice.\n';
		const after = '# Chapter 3 - Dusk\n\nThe bell rang twice.\n';
		const to = 'Novel/50_Manuscript/Chapter 3 - Dusk.md';
		// The caret after "The bell": 13 characters of heading and gap, then 8.
		const caret = { from: 21, to: 25 };
		put(3, 200, 400, { selection: () => caret, read: () => before });
		view.editingPath = chapter(3).path;
		answers.renamed = { from: chapter(3).path, to };
		Object.assign(view, {
			refresh: () => {
				said.push('refresh');
				// The reading again puts the note up under its new name.
				view.mounted.delete(chapter(3).path);
				view.mounted.set(to, {
					path: to,
					el: document.body.createDiv(),
					editor: null,
					pending: null,
					text: { body: after },
				});
				return Promise.resolve();
			},
		});
		await view.renameChapter(chapter(3).path);
		// Saved first, so the form opens on the heading as the author has it,
		// and taken down only once there was a name to take it down for.
		expect(said).toEqual([
			'save',
			`host rename Novel/Novel.md ${chapter(3).path}`,
			`down ${chapter(3).path}`,
			'refresh',
		]);
		// The heading gained seven characters, and so did the caret's place.
		expect(opened).toEqual([{ path: to, caret: { from: 28, to: 32 } }]);
	});

	it('puts the note back up where the author stepped back from a refused name', async () => {
		const { view, said, answers, opened, put } = stream();
		const body = '# Chapter 3\n\nProse.\n';
		const entry = put(3, 200, 400, { selection: () => ({ from: 15, to: 15 }), read: () => body });
		entry.text.body = body;
		view.editingPath = chapter(3).path;
		// The form took the note down for a name it could not have, and was
		// then closed: nothing was renamed.
		answers.renamed = null;
		await view.renameChapter(chapter(3).path);
		expect(said).not.toContain('refresh');
		expect(opened).toEqual([{ path: chapter(3).path, caret: { from: 15, to: 15 } }]);
	});

	it('saves the words being written into a chapter before it is deleted, and reads the book again', async () => {
		const { view, said, answers, put } = stream();
		put(4, 300, 200);
		view.editingPath = chapter(4).path;
		answers.deleted = [];
		await view.deleteChapter(chapter(4).path);
		expect(said).toEqual([
			`host delete Novel/Novel.md ${chapter(4).path}`,
			`down ${chapter(4).path}`,
			'refresh',
		]);
	});

	it('leaves everything as it is when the author says no to a deletion, and another note’s editor when they say yes', async () => {
		const { view, said, answers } = stream();
		view.editingPath = chapter(2).path;
		await view.deleteChapter(chapter(4).path);
		expect(said).toEqual([`host delete Novel/Novel.md ${chapter(4).path}`]);
		answers.deleted = [];
		said.length = 0;
		await view.deleteChapter(chapter(4).path);
		expect(said).toEqual([`host delete Novel/Novel.md ${chapter(4).path}`, 'refresh']);
		expect(view.editingPath).toBe(chapter(2).path);
	});

	it('puts the editor of a later chapter away while the numbers close up, and back under the name its note took', async () => {
		const { view, said, answers, opened, put } = stream();
		const caret = { from: 20, to: 20 };
		put(5, 300, 400, {
			selection: () => caret,
			read: () => '# Chapter 5\n\nThe bell rang twice.\n',
		});
		view.editingPath = chapter(5).path;
		// The fourth chapter goes, and the fifth takes its number and its name.
		answers.deleted = [{ from: chapter(5).path, to: chapter(4).path }];
		Object.assign(view, {
			refresh: () => {
				said.push('refresh');
				view.mounted.delete(chapter(5).path);
				view.mounted.set(chapter(4).path, {
					path: chapter(4).path,
					el: document.body.createDiv(),
					editor: null,
					pending: null,
					text: { body: '# Chapter 4\n\nThe bell rang twice.\n' },
				});
				return Promise.resolve();
			},
		});
		await view.deleteChapter(chapter(4).path);
		// Left up over a file that had taken another name, the editor was
		// taken down by the reading that followed and never put back.
		expect(said).toEqual([
			`host delete Novel/Novel.md ${chapter(4).path}`,
			`down ${chapter(5).path}`,
			'refresh',
		]);
		expect(opened).toEqual([{ path: chapter(4).path, caret }]);
	});

	it('puts that editor back under the old name where the deletion was refused with nothing renamed', async () => {
		const { view, said, answers, opened, put } = stream();
		const body = '# Chapter 5\n\nThe bell rang twice.\n';
		const caret = { from: 14, to: 18 };
		const entry = put(5, 300, 400, { selection: () => caret, read: () => body });
		entry.text.body = body;
		view.editingPath = chapter(5).path;
		answers.deleted = [{ from: chapter(5).path, to: chapter(4).path }];
		answers.refused = 'that name is taken';
		await expect(view.deleteChapter(chapter(4).path)).rejects.toThrow('that name is taken');
		expect(said).toEqual([
			`host delete Novel/Novel.md ${chapter(4).path}`,
			`down ${chapter(5).path}`,
			'refresh',
		]);
		expect(opened).toEqual([{ path: chapter(5).path, caret }]);
	});

	it('owes a stream in a tab put away its reading at the next reveal', async () => {
		const { view, said, answers, contentEl } = stream();
		let owed = 0;
		Object.assign(view, {
			queueRefreshWhenShown: () => {
				owed += 1;
			},
		});
		contentEl.hidden = true;
		answers.deleted = [];
		await view.deleteChapter(chapter(4).path);
		expect(said).not.toContain('refresh');
		expect(owed).toBe(1);
	});

	it('hands the sidebar the same three ways to a chapter itself', async () => {
		const { view, hub, said, answers } = stream();
		view.syncContents();
		answers.renamed = { from: chapter(1).path, to: chapter(1).path };
		hub.current()?.rename(chapter(1).path);
		await vi.waitFor(() =>
			expect(said).toContain(`host rename Novel/Novel.md ${chapter(1).path}`),
		);
		hub.current()?.remove(chapter(5).path);
		await vi.waitFor(() =>
			expect(said).toContain(`host delete Novel/Novel.md ${chapter(5).path}`),
		);
		hub.current()?.menu(chapter(2).path, new MouseEvent('contextmenu'));
		expect(menus).toHaveLength(1);
	});
});
