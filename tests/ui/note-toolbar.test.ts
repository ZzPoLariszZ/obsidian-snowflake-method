// @vitest-environment happy-dom

import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { App } from 'obsidian';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MANUSCRIPT_PRESENTATION } from '../../src/domain';
import {
	NOTE_FOCUS_CLASS,
	NOTE_TOOLBAR_CLASS,
	NoteToolbars,
	type ToolbarNote,
} from '../../src/ui/note-toolbar';
import { NEXT_FOCUS_LEVEL, type FocusLevel } from '../../src/ui/view-model';
import { installObsidianDom } from '../helpers/obsidian-dom';

interface ShownItem {
	title: string;
	checked: boolean;
	label: boolean;
	click: (() => void) | null;
}

// Every menu shown, with its items, kept where a test can read them back.
const shownMenus = vi.hoisted(() => [] as ShownItem[][]);

// The name a button is given, and the menus it opens, kept where a test can
// read them back.
vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class RecordingMenu {
		private readonly items: ShownItem[] = [];
		addItem(build: (item: unknown) => void): this {
			const entry: ShownItem = { title: '', checked: false, label: false, click: null };
			const handle = {
				setTitle: (title: string) => ((entry.title = title), handle),
				setChecked: (checked: boolean) => ((entry.checked = checked), handle),
				setIsLabel: (label: boolean) => ((entry.label = label), handle),
				setIcon: () => handle,
				setSection: () => handle,
				onClick: (click: () => void) => ((entry.click = click), handle),
			};
			build(handle);
			this.items.push(entry);
			return this;
		}
		addSeparator(): this {
			this.items.push({ title: '---', checked: false, label: false, click: null });
			return this;
		}
		showAtMouseEvent(): this {
			shownMenus.push(this.items);
			return this;
		}
	}
	return {
		...runtime,
		Menu: RecordingMenu,
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

/**
 * The stream's bar above a note of Obsidian's own, over plain elements:
 * put up for the notes the dress reaches and taken down for the rest,
 * grey while the note is read, lit while the modes are on, driving the
 * note's own editor, choosing the marks a project's note wears, fading a
 * project's note in focus mode, and exporting the note it shows.
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
		inProject: (path: string) => boolean = () => true,
	) {
		const calls: string[] = [];
		let typewriter = false;
		let focusLevel: FocusLevel = 'off';
		const record = (call: string): Promise<void> => {
			calls.push(call);
			return Promise.resolve();
		};
		const toolbars = new NoteToolbars({
			app: new App(),
			t: (path) => (key) => `${speaks(path)}${key}`,
			wears: dressed,
			notes: () => notes,
			settings: () => ({
				typewriter,
				focusLevel,
				enterParagraph: true,
				presentation: DEFAULT_MANUSCRIPT_PRESENTATION,
				recentFonts: [],
				mentions: {
					mentionHighlight: 'unlinked',
					sensitiveHighlight: false,
					dialoguePresentation: 'highlight',
					customHighlights: true,
				},
			}),
			setPresentation: () => Promise.resolve(),
			setEnterParagraph: () => Promise.resolve(),
			toggleTypewriter: () => {
				typewriter = !typewriter;
				calls.push('typewriter');
				return Promise.resolve();
			},
			toggleFocus: () => {
				focusLevel = NEXT_FOCUS_LEVEL[focusLevel];
				calls.push(`focus:${focusLevel}`);
				return Promise.resolve();
			},
			inProject,
			mentionModes: {
				setMentionHighlight: (mode) => record(`mentions:${mode}`),
				setSensitiveHighlight: (on) => record(`sensitive:${String(on)}`),
				setDialoguePresentation: (mode) => record(`dialogue:${mode}`),
				setCustomHighlights: (on) => record(`custom:${String(on)}`),
			},
			exportNote: (path) => {
				calls.push(`export:${path}`);
				return Promise.resolve();
			},
			showError: (error) => {
				calls.push(`error:${String(error)}`);
			},
		});
		return {
			toolbars,
			calls,
			setTypewriter: (on: boolean) => {
				typewriter = on;
			},
			setFocus: (level: FocusLevel) => {
				focusLevel = level;
			},
		};
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

	it('carries the stream’s buttons, with the note’s own export', () => {
		const one = note('Novel/Chapter.md');
		const { toolbars } = harness([one], () => true);
		toolbars.apply();
		const mounted = bar(one) as HTMLElement;
		// Both modes, focus after typewriter scrolling as on the stream's bar.
		const modes = mounted.querySelectorAll('.snowflake-method-mode-toggle');
		expect(modes).toHaveLength(2);
		expect(modes[1]?.classList.contains('snowflake-method-toolbar-focus')).toBe(true);
		expect(modes[1]?.previousElementSibling).toBe(modes[0]);
		expect(mounted.querySelector('.snowflake-method-toolbar-presentation')).not.toBeNull();
		// The marks, named as the stream's button is, between the dress and the export.
		const mentions = mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-mentions');
		expect(mentions?.getAttribute('data-tooltip')).toBe('manuscript.toolbar.mentions');
		expect(mentions?.getAttribute('aria-haspopup')).toBe('menu');
		expect(mentions?.previousElementSibling?.classList.contains('snowflake-method-toolbar-presentation')).toBe(true);
		// The note's own export, named as the button on a chapter's header is.
		const exporter = mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-export');
		expect(exporter?.getAttribute('data-tooltip')).toBe('manuscript.exportNote');
		expect(exporter?.previousElementSibling).toBe(mentions);
		// Undo, redo, two headings and the ladder, five marks, the dress, the
		// mentions, the export, the two modes.
		expect(mounted.querySelectorAll('button')).toHaveLength(15);
	});

	it('greys the editing buttons while the note is read, and lights the modes', () => {
		const one = note('Novel/Chapter.md');
		const { toolbars, setTypewriter } = harness([one], () => true);
		toolbars.apply();
		const mounted = bar(one) as HTMLElement;
		const buttons = Array.from(mounted.querySelectorAll('button'));
		const live = [
			'snowflake-method-toolbar-presentation',
			'snowflake-method-toolbar-mentions',
			'snowflake-method-toolbar-export',
			'snowflake-method-mode-toggle',
		];
		const editing = buttons.filter((button) => !live.some((cls) => button.classList.contains(cls)));
		expect(editing.every((button) => !button.disabled)).toBe(true);
		one.mode = 'preview';
		toolbars.apply();
		expect(editing.every((button) => button.disabled)).toBe(true);
		const dress = mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-presentation');
		expect(dress?.disabled).toBe(false);
		expect(mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-mentions')?.disabled).toBe(false);
		expect(mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-export')?.disabled).toBe(false);
		const mode = mounted.querySelector<HTMLButtonElement>('.snowflake-method-mode-toggle');
		expect(mode?.disabled).toBe(false);
		expect(mode?.classList.contains('is-active')).toBe(false);
		expect(mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-focus')?.disabled).toBe(false);
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

	it('greys the marks on a note no project holds, and offers the stream’s menu on one it does', () => {
		const chapter = note('Novel/Chapter.md');
		const loose = note('Loose/Idea.md');
		const { toolbars, calls } = harness(
			[chapter, loose],
			() => true,
			() => '',
			(path) => path.startsWith('Novel/'),
		);
		toolbars.apply();
		const button = (one: FakeNote): HTMLButtonElement =>
			(bar(one) as HTMLElement).querySelector<HTMLButtonElement>(
				'.snowflake-method-toolbar-mentions',
			) as HTMLButtonElement;
		expect(button(chapter).disabled).toBe(false);
		expect(button(loose).disabled).toBe(true);
		// A press that reaches a greyed button anyway opens nothing.
		shownMenus.length = 0;
		button(loose).dispatchEvent(new MouseEvent('click'));
		expect(shownMenus).toHaveLength(0);
		// The stream's own menu: every family under its heading, the settings'
		// choice checked, and a pick written through the host.
		button(chapter).click();
		const items = shownMenus[0] ?? [];
		expect(items.filter((item) => item.label).map((item) => item.title)).toEqual([
			'settings.mentionHighlight.entities',
			'settings.sensitiveWords.heading',
			'settings.mentionHighlight.dialogues',
			'settings.mentionHighlight.custom',
		]);
		expect(items.filter((item) => item.checked).map((item) => item.title)).toEqual([
			'settings.mentionHighlight.unlinked',
			'settings.mentionHighlight.off',
			'settings.dialoguePresentation.highlight',
			'settings.mentionHighlight.on',
		]);
		items.find((item) => item.title === 'settings.mentionHighlight.all')?.click?.();
		items.find((item) => item.title === 'settings.dialoguePresentation.focus')?.click?.();
		expect(calls).toEqual(['mentions:all', 'dialogue:focus']);
		// The note moved into a project: the same bar, its button live again.
		loose.path = 'Novel/Idea.md';
		toolbars.apply();
		expect(button(loose).disabled).toBe(false);
	});

	it('walks focus mode through the host, and fades a project’s note while it is on', () => {
		const chapter = note('Novel/Chapter.md');
		const loose = note('Loose/Idea.md');
		const { toolbars, calls, setFocus } = harness(
			[chapter, loose],
			() => true,
			() => '',
			(path) => path.startsWith('Novel/'),
		);
		toolbars.apply();
		const button = (one: FakeNote): HTMLButtonElement =>
			(bar(one) as HTMLElement).querySelector<HTMLButtonElement>(
				'.snowflake-method-toolbar-focus',
			) as HTMLButtonElement;
		const faded = (one: FakeNote): boolean => one.containerEl.classList.contains(NOTE_FOCUS_CLASS);
		// Off: unlit, nothing faded, the tooltip naming the level and the next.
		expect(button(chapter).disabled).toBe(false);
		expect(button(chapter).classList.contains('is-active')).toBe(false);
		expect(button(chapter).getAttribute('data-tooltip')).toBe(
			'manuscript.focusLevel.off\nmanuscript.focusNext.on',
		);
		expect(faded(chapter)).toBe(false);
		// A press goes through the host, one level deeper each time, while
		// the note is read as well as while it is written.
		chapter.mode = 'preview';
		toolbars.apply();
		button(chapter).click();
		button(chapter).click();
		expect(calls).toEqual(['focus:on', 'focus:deep']);
		// The settings changed: the bar lit and captioned anew, the project's
		// note faded, and a note no project holds greyed and left alone.
		toolbars.sync();
		expect(button(chapter).classList.contains('is-active')).toBe(true);
		expect(button(chapter).getAttribute('data-tooltip')).toBe(
			'manuscript.focusLevel.deep\nmanuscript.focusNext.solo',
		);
		expect(faded(chapter)).toBe(true);
		expect(button(loose).disabled).toBe(true);
		expect(faded(loose)).toBe(false);
		// A press that reaches a greyed button anyway turns nothing.
		button(loose).dispatchEvent(new MouseEvent('click'));
		expect(calls).toEqual(['focus:on', 'focus:deep']);
		// The note moved into a project, and the tab turned to one outside.
		loose.path = 'Novel/Idea.md';
		chapter.path = 'Loose/Chapter.md';
		toolbars.apply();
		expect(faded(loose)).toBe(true);
		expect(faded(chapter)).toBe(false);
		// Off again: nothing faded anywhere.
		setFocus('off');
		toolbars.sync();
		expect(faded(loose)).toBe(false);
		expect(button(loose).classList.contains('is-active')).toBe(false);
	});

	it('takes the fade off with the bar, when the dress stops reaching the note', () => {
		const one = note('Novel/Chapter.md');
		let reaches = true;
		const { toolbars, setFocus } = harness([one], () => reaches);
		setFocus('solo');
		toolbars.apply();
		expect(one.containerEl.classList.contains(NOTE_FOCUS_CLASS)).toBe(true);
		reaches = false;
		toolbars.apply();
		expect(one.containerEl.classList.contains(NOTE_FOCUS_CLASS)).toBe(false);
		reaches = true;
		toolbars.apply();
		expect(one.containerEl.classList.contains(NOTE_FOCUS_CLASS)).toBe(true);
		toolbars.destroy();
		expect(one.containerEl.classList.contains(NOTE_FOCUS_CLASS)).toBe(false);
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
