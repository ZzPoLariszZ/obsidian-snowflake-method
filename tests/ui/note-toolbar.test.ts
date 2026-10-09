// @vitest-environment happy-dom

import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { App } from 'obsidian';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_MANUSCRIPT_PRESENTATION } from '../../src/domain';
import {
	NOTE_TOOLBAR_CLASS,
	NoteToolbars,
	type ToolbarNote,
} from '../../src/ui/note-toolbar';
import { installObsidianDom } from '../helpers/obsidian-dom';

/**
 * The stream's bar above a note of Obsidian's own, over plain elements:
 * put up for the notes the dress reaches and taken down for the rest,
 * grey while the note is read, lit while typewriter scrolling is on, and
 * driving the note's own editor.
 */
describe('NoteToolbars', () => {
	beforeAll(() => {
		installObsidianDom(window);
	});

	interface FakeNote extends ToolbarNote {
		view: EditorView;
		mode: 'source' | 'preview';
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
			editing: () => fake.mode === 'source',
			editor: () => (fake.mode === 'source' ? fake.view : null),
		};
		return fake;
	}

	function harness(notes: FakeNote[], dressed: (path: string) => boolean) {
		const calls: string[] = [];
		let typewriter = false;
		const toolbars = new NoteToolbars({
			app: new App(),
			t: () => (key) => key,
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
		expect(mounted.querySelector('.snowflake-method-toolbar-export')).toBeNull();
		expect(mounted.querySelector('.snowflake-method-toolbar-mentions')).toBeNull();
		expect(mounted.querySelectorAll('.snowflake-method-mode-toggle')).toHaveLength(1);
		expect(mounted.querySelector('.snowflake-method-toolbar-presentation')).not.toBeNull();
		// Undo, redo, two headings and the ladder, five marks, the dress, the mode.
		expect(mounted.querySelectorAll('button')).toHaveLength(12);
	});

	it('greys the editing buttons while the note is read, and lights the mode', () => {
		const one = note('Novel/Chapter.md');
		const { toolbars, setTypewriter } = harness([one], () => true);
		toolbars.apply();
		const mounted = bar(one) as HTMLElement;
		const buttons = Array.from(mounted.querySelectorAll('button'));
		const editing = buttons.filter((button) => !button.classList.contains('snowflake-method-toolbar-presentation') && !button.classList.contains('snowflake-method-mode-toggle'));
		expect(editing.every((button) => !button.disabled)).toBe(true);
		one.mode = 'preview';
		toolbars.apply();
		expect(editing.every((button) => button.disabled)).toBe(true);
		const dress = mounted.querySelector<HTMLButtonElement>('.snowflake-method-toolbar-presentation');
		expect(dress?.disabled).toBe(false);
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
