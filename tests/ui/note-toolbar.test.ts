// @vitest-environment happy-dom

import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { App } from 'obsidian';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MANUSCRIPT_PRESENTATION } from '../../src/domain';
import {
	NOTE_TOOLBAR_CLASS,
	NoteToolbars,
	type ToolbarNote,
} from '../../src/ui/note-toolbar';
import { installObsidianDom } from '../helpers/obsidian-dom';

// The name a button is given, kept where a test can read it back.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

/**
 * The stream's bar above a note of Obsidian's own, over plain elements:
 * put up for the notes the dress reaches and taken down for the rest,
 * grey while the note is read, lit while typewriter scrolling is on,
 * driving the note's own editor, and exporting the note it shows.
 */
describe('NoteToolbars', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	interface FakeNote extends ToolbarNote {
		view: EditorView;
		mode: 'source' | 'preview';
		saved: number;
	}

	function note(path: string | null, doc = 'a word here'): FakeNote {
		const containerEl = document.body.createDiv({ cls: 'workspace-leaf-content' });
		containerEl.createDiv({ cls: 'view-header' });
		const contentEl = containerEl.createDiv({ cls: 'view-content' });
		const view = new EditorView({
			state: EditorState.create({
				doc,
				selection: { anchor: 2, head: 6 },
				extensions: [history()],
			}),
			parent: contentEl,
		});
		// A browser fires `selectionchange` after an update; happy-dom fires it
		// inside one, which a focused editor cannot survive. The bar's focus
		// call is the browser's business, and is stood down here.
		Object.defineProperty(view, 'focus', { value: () => undefined });
		const fake: FakeNote = {
			path,
			containerEl,
			contentEl,
			view,
			mode: 'source',
			saved: 0,
			editing: () => fake.mode === 'source',
			editor: () => (fake.mode === 'source' ? fake.view : null),
			save: () => {
				fake.saved += 1;
				return Promise.resolve();
			},
		};
		return fake;
	}

	function harness(
		notes: FakeNote[],
		dressed: (path: string) => boolean,
		speaks: (path: string | null) => string = () => '',
	) {
		const calls: string[] = [];
		let typewriter = false;
		const toolbars = new NoteToolbars({
			app: new App(),
			t: (path) => (key) => `${speaks(path)}${key}`,
			wears: dressed,
			notes: () => notes,
			settings: () => ({
				typewriter,
				enterParagraph: true,
				presentation: DEFAULT_MANUSCRIPT_PRESENTATION,
				recentFonts: [],
			}),
			setPresentation: () => Promise.resolve(),
			setEnterParagraph: () => Promise.resolve(),
			toggleTypewriter: () => {
				typewriter = !typewriter;
				calls.push('typewriter');
				return Promise.resolve();
			},
			exportNote: (path) => {
				calls.push(`export:${path}`);
				return Promise.resolve();
			},
			showError: (error) => {
				calls.push(`error:${String(error)}`);
			},
		});
		return { toolbars, calls, setTypewriter: (on: boolean) => { typewriter = on; } };
	}

	const bar = (one: ToolbarNote): HTMLElement | null =>
		one.containerEl.querySelector<HTMLElement>(`.${NOTE_TOOLBAR_CLASS}`);

	it('stands between the header and the content of the notes the dress reaches', () => {
		const dressed = note('Novel/Chapter.md');
		const loose = note('Loose/Idea.md');
		const blank = note(null);
		const { toolbars } = harness([dressed, loose, blank], (path) => path.startsWith('Novel/'));
		toolbars.apply();
		const mounted = bar(dressed);
		expect(mounted).not.toBeNull();
		expect(mounted?.previousElementSibling?.classList.contains('view-header')).toBe(true);
		expect(mounted?.nextElementSibling).toBe(dressed.contentEl);
		expect(mounted?.classList.contains('snowflake-method-manuscript-toolbar')).toBe(true);
		expect(bar(loose)).toBeNull();
		expect(bar(blank)).toBeNull();
		// Twice is once: the same bar, not a second one.
		toolbars.apply();
		expect(dressed.containerEl.querySelectorAll(`.${NOTE_TOOLBAR_CLASS}`)).toHaveLength(1);
	});

	it('leaves out what is the stream’s alone, and keeps the rest', () => {
		const one = note('Novel/Chapter.md');
		const { toolbars } = harness([one], () => true);
		toolbars.apply();
		const mounted = bar(one) as HTMLElement;
		expect(mounted.querySelector('.snowflake-method-toolbar-mentions')).toBeNull();
		expect(mounted.querySelectorAll('.snowflake-method-mode-toggle')).toHaveLength(1);
		expect(mounted.querySelector('.snowflake-method-toolbar-presentation')).not.toBeNull();
		// The note's own export, named as the button on a chapter's header is.
		const exporter = mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-export');
		expect(exporter?.getAttribute('data-tooltip')).toBe('manuscript.exportNote');
		// Undo, redo, two headings and the ladder, five marks, the dress, the
		// export, the mode.
		expect(mounted.querySelectorAll('button')).toHaveLength(13);
	});

	it('greys the editing buttons while the note is read, and lights the mode', () => {
		const one = note('Novel/Chapter.md');
		const { toolbars, setTypewriter } = harness([one], () => true);
		toolbars.apply();
		const mounted = bar(one) as HTMLElement;
		const buttons = Array.from(mounted.querySelectorAll('button'));
		const live = ['snowflake-method-toolbar-presentation', 'snowflake-method-toolbar-export', 'snowflake-method-mode-toggle'];
		const editing = buttons.filter((button) => !live.some((cls) => button.classList.contains(cls)));
		expect(editing.every((button) => !button.disabled)).toBe(true);
		one.mode = 'preview';
		toolbars.apply();
		expect(editing.every((button) => button.disabled)).toBe(true);
		const dress = mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-presentation');
		expect(dress?.disabled).toBe(false);
		expect(mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-export')?.disabled).toBe(false);
		const mode = mounted.querySelector<HTMLButtonElement>('.snowflake-method-mode-toggle');
		expect(mode?.disabled).toBe(false);
		expect(mode?.classList.contains('is-active')).toBe(false);
		setTypewriter(true);
		toolbars.sync();
		expect(mode?.classList.contains('is-active')).toBe(true);
	});

	it('drives the note’s own editor, and turns the mode through the host', () => {
		const one = note('Novel/Chapter.md');
		const { toolbars, calls } = harness([one], () => true);
		toolbars.apply();
		const mounted = bar(one) as HTMLElement;
		const buttons = Array.from(mounted.querySelectorAll('button'));
		// Undo, redo, h2, h3, ladder, bold.
		buttons[5]?.click();
		expect(one.view.state.doc.toString()).toBe('a **word** here');
		buttons[0]?.click();
		expect(one.view.state.doc.toString()).toBe('a word here');
		buttons[2]?.click();
		expect(one.view.state.doc.toString()).toBe('## a word here');
		mounted.querySelector<HTMLButtonElement>('.snowflake-method-mode-toggle')?.click();
		expect(calls).toEqual(['typewriter']);
	});

	it('exports the note the tab shows now, what was typed saved first, while read too', async () => {
		const one = note('Novel/Chapter 1.md');
		const { toolbars, calls } = harness([one], () => true);
		toolbars.apply();
		const exporter = (bar(one) as HTMLElement).querySelector<HTMLButtonElement>('.snowflake-method-toolbar-export');
		// The tab turned to another note of the same project keeps its bar.
		one.path = 'Novel/Chapter 2.md';
		one.mode = 'preview';
		toolbars.apply();
		exporter?.click();
		await vi.waitFor(() => {
			expect(calls).toEqual(['export:Novel/Chapter 2.md']);
		});
		expect(one.saved).toBe(1);
	});

	it('writes in a table cell’s own editor while the cell holds the caret', () => {
		const one = note('Novel/Chapter.md', '| Name | Role |\n| --- | --- |\n| Ann | lead |');
		// The app nests an editor in the note's for the cell being written in.
		const host = one.view.dom.createDiv();
		const cell = new EditorView({
			state: EditorState.create({ doc: 'Ann', selection: { anchor: 3 } }),
			parent: host,
		});
		Object.defineProperty(cell, 'focus', { value: () => undefined });
		const owner = one.view.dom.ownerDocument;
		Object.defineProperty(owner, 'activeElement', { configurable: true, get: () => cell.contentDOM });
		try {
			const { toolbars } = harness([one], () => true);
			toolbars.apply();
			const buttons = Array.from((bar(one) as HTMLElement).querySelectorAll('button'));
			buttons[2]?.click();
			expect(cell.state.doc.toString()).toBe('## Ann');
			expect(one.view.state.doc.toString()).toBe('| Name | Role |\n| --- | --- |\n| Ann | lead |');
		} finally {
			Reflect.deleteProperty(owner, 'activeElement');
			cell.destroy();
		}
	});

	it('draws the bar again when its note comes to speak another language, and only then', () => {
		const one = note('Novel/Chapter 1.md');
		let language = 'en:';
		const { toolbars } = harness([one], () => true, () => language);
		toolbars.apply();
		const first = bar(one);
		// Another note of the same project in the same tab keeps the bar.
		one.path = 'Novel/Chapter 2.md';
		toolbars.apply();
		expect(bar(one)).toBe(first);
		// A note of a project in another language, or the plugin's language changed.
		language = 'zh:';
		toolbars.apply();
		const second = bar(one);
		expect(second).not.toBe(first);
		expect(first?.isConnected).toBe(false);
		expect(one.containerEl.querySelectorAll(`.${NOTE_TOOLBAR_CLASS}`)).toHaveLength(1);
		toolbars.apply();
		expect(bar(one)).toBe(second);
	});

	it('takes the bar down when the dress stops reaching the note', () => {
		const one = note('Novel/Chapter.md');
		let reaches = true;
		const { toolbars } = harness([one], () => reaches);
		toolbars.apply();
		expect(bar(one)).not.toBeNull();
		reaches = false;
		toolbars.apply();
		expect(bar(one)).toBeNull();
		reaches = true;
		toolbars.apply();
		expect(bar(one)).not.toBeNull();
		toolbars.destroy();
		expect(bar(one)).toBeNull();
	});
});
