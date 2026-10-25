import { Menu, setIcon, setTooltip, type App } from 'obsidian';
import { EditorView } from '@codemirror/view';

import type { ManuscriptPresentation } from '../domain';
import { runEditorCommand, type EditorCommandId } from '../editor';
import {
	openMentionModeMenu,
	type MentionModeChoices,
	type MentionModeSetters,
} from './mention-mode-menu';
import { openPresentationPanel, type PresentationPanel } from './presentation-panel';
import { isMobileDevice } from './device';
import { nextFocusLevel, type FocusLevel } from './view-model';

/**
 * The formatting bar above a note of Obsidian's own that wears the
 * manuscript's dress: the stream's bar, with the note's own export.
 *
 * A note the typography reaches is read and written the way a chapter in
 * the stream is, and the author reaches for the same bar: undo and redo,
 * the heading levels, the inline marks, the dress popover, the marks the
 * page wears, the export, typewriter scrolling and focus mode. The export
 * is the note's own, as the button on a chapter's header in the stream is
 * the chapter's: a tab shows one note, not the whole manuscript. The marks
 * are a project's, read off its roster, and focus mode is a project's
 * writing, so the buttons for both are greyed on a note no project holds.
 * The popover leaves out the grid lines, which a note never wears. The
 * bar stands where the stream's does, between the leaf's header and its
 * content, and the buttons that edit go grey while the note is read rather
 * than written, as the stream's do while no note is being written in:
 * greyed rather than gone, because a bar that came and went would move the
 * page under the reader.
 *
 * One bar per note view, put up when the dress reaches the note it shows
 * and taken down when it stops, which the host asks at the moments a note
 * can newly be on screen. Kept free of the app's view classes, like the
 * dress itself, so the rule can be run over plain objects in a test.
 */
export const NOTE_TOOLBAR_CLASS = 'snowflake-method-note-toolbar';

/**
 * Worn by a note of a project while focus mode is on: the class under which
 * styles.css fades the page around the paragraph being written, as the
 * stream's own class does there. A class, so turning the mode moves nothing.
 */
export const NOTE_FOCUS_CLASS = 'snowflake-method-note-focus';

/** What a note's view offers the bar: where it goes, and the editor it drives. */
export interface ToolbarNote {
	/** The note's path, or null while the view shows nothing. */
	path: string | null;
	/** The leaf's content root, which the bar is put into. */
	containerEl: HTMLElement;
	/** The view's content, which the bar stands before. */
	contentEl: HTMLElement;
	/** Whether the note is open for writing rather than reading. */
	editing(): boolean;
	/** The note's editor, for the bar's commands; null while there is none. */
	editor(): EditorView | null;
	/** Writes what was typed since the app last saved the note. */
	save(): Promise<void>;
}

/** The settings the bar shows and the popover writes. */
export interface NoteToolbarSettings {
	typewriter: boolean;
	focusLevel: FocusLevel;
	enterParagraph: boolean;
	presentation: ManuscriptPresentation;
	recentFonts: readonly string[];
	/** Which marks the page wears, which the marks' menu shows checked. */
	mentions: MentionModeChoices;
}

export interface NoteToolbarDeps {
	app: App;
	/** The words for a note's bar, in the tongue of the project the note is in. */
	t(path: string | null): (key: string, vars?: Record<string, string | number>) => string;
	/** Whether a note at a path is one the dress, and so the bar, reaches. */
	wears(path: string): boolean;
	/** Every note view open anywhere, popouts included. */
	notes(): Iterable<ToolbarNote>;
	settings(): NoteToolbarSettings;
	setPresentation(patch: Partial<ManuscriptPresentation>): Promise<void>;
	setEnterParagraph(on: boolean): Promise<void>;
	toggleTypewriter(): Promise<void>;
	/** Focus mode one level deeper, and off again past the deepest. */
	toggleFocus(): Promise<void>;
	/**
	 * Whether a note at a path is in a project: the roster its marks are read
	 * off, and the writing focus mode reaches.
	 */
	inProject(path: string): boolean;
	/** Where the marks' menu writes a pick: the settings the stream reads too. */
	mentionModes: MentionModeSetters;
	/** The note at a path written out as plain text, as the export settings say. */
	exportNote(path: string): Promise<void>;
	showError(error: unknown): void;
}

interface MountedBar {
	el: HTMLElement;
	/** The buttons that edit, inert while the note is read. */
	editing: HTMLButtonElement[];
	/** The marks' button, inert on a note no project holds. */
	mentions: HTMLButtonElement;
	typewriter: HTMLButtonElement;
	/** Focus mode's button, inert on a note no project holds as the marks' is. */
	focus: HTMLButtonElement;
	/** The modes as the two buttons were last painted, so a repaint is cheap. */
	face: string | null;
	/** One of the bar's own words as it was drawn, which says what language it speaks. */
	tongue: string;
}

/** The word a bar is asked for again, to tell whether its note now speaks another language. */
const TONGUE_KEY = 'manuscript.toolbar.undo';

/**
 * The editor of a table cell that holds the caret, nested in a note's own
 * editor, or null when the caret is anywhere else. The app builds one per
 * cell in Live Preview while the cell is being written in.
 */
function cellEditorIn(outer: EditorView): EditorView | null {
	const active = outer.dom.ownerDocument.activeElement;
	if (active === null || !outer.dom.contains(active)) return null;
	const cell = active.closest<HTMLElement>('.cm-editor');
	if (cell === null || cell === outer.dom) return null;
	return EditorView.findFromDOM(cell);
}

export class NoteToolbars {
	/** The bar each note view carries, by the leaf's content root. */
	private readonly bars = new WeakMap<HTMLElement, MountedBar>();
	/** The one dress popover open, under whichever bar's button opened it. */
	private panel: { panel: PresentationPanel; anchor: HTMLElement } | null = null;

	constructor(private readonly deps: NoteToolbarDeps) {}

	/** Every open note given its bar or relieved of it, and each bar repainted. */
	apply(): void {
		for (const note of this.deps.notes()) this.applyTo(note);
		// A popover whose button has gone -- the note closed, or undressed --
		// goes with it.
		if (this.panel !== null && !this.panel.anchor.isConnected) this.closePanel();
	}

	applyTo(note: ToolbarNote): void {
		const wears = note.path !== null && this.deps.wears(note.path);
		let bar = this.bars.get(note.containerEl);
		// A bar is drawn in its note's language, so a tab turned to a note of
		// a project in another one, or the plugin's language changed, has it
		// drawn again: its words, its menu and its popover alike.
		if (bar !== undefined && (!wears || bar.tongue !== this.deps.t(note.path)(TONGUE_KEY))) {
			this.unmount(note.containerEl, bar);
			bar = undefined;
		}
		if (!wears) return;
		this.paint(bar ?? this.mount(note), note);
	}

	/** Every bar repainted for a setting that changed, and the open popover told. */
	sync(): void {
		for (const note of this.deps.notes()) {
			const bar = this.bars.get(note.containerEl);
			if (bar !== undefined) this.paint(bar, note);
		}
		this.panel?.panel.sync(this.deps.settings().presentation);
	}

	/** Every bar taken down, for the plugin going away. */
	destroy(): void {
		this.closePanel();
		for (const note of this.deps.notes()) {
			const bar = this.bars.get(note.containerEl);
			if (bar !== undefined) this.unmount(note.containerEl, bar);
		}
	}

	/** A note's bar taken down, and the fade it switched with it. */
	private unmount(root: HTMLElement, bar: MountedBar): void {
		bar.el.remove();
		this.bars.delete(root);
		root.removeClass(NOTE_FOCUS_CLASS);
	}

	private mount(note: ToolbarNote): MountedBar {
		const t = this.deps.t(note.path);
		const el = note.containerEl.createDiv({
			cls: `snowflake-method-manuscript-toolbar ${NOTE_TOOLBAR_CLASS}`,
		});
		// Between the header and the page, where the stream's bar stands.
		if (note.contentEl.parentElement === note.containerEl) {
			note.containerEl.insertBefore(el, note.contentEl);
		}
		const editing: HTMLButtonElement[] = [];
		const button = (
			icon: string,
			label: string,
			act: (event: MouseEvent) => void,
			attr: Record<string, string> = {},
		): HTMLButtonElement => {
			const control = el.createEl('button', {
				cls: 'clickable-icon snowflake-method-toolbar-button',
				attr: { type: 'button', ...attr },
			});
			setIcon(control, icon);
			if (label.length > 0) setTooltip(control, label);
			// Pressing a button must not lift the caret out of the editor:
			// the command acts on the selection the author is holding there.
			control.addEventListener('mousedown', (event) => {
				event.preventDefault();
			});
			control.addEventListener('click', act);
			return control;
		};
		const command = (id: EditorCommandId, icon: string, key: string): void => {
			editing.push(
				button(icon, t(key), () => {
					this.exec(note, id);
				}),
			);
		};
		const separator = (): void => {
			el.createDiv({ cls: 'snowflake-method-toolbar-separator' });
		};
		command('undo', 'undo-2', 'manuscript.toolbar.undo');
		command('redo', 'redo-2', 'manuscript.toolbar.redo');
		separator();
		command('heading-2', 'heading-2', 'manuscript.toolbar.heading2');
		command('heading-3', 'heading-3', 'manuscript.toolbar.heading3');
		editing.push(
			button('heading', t('manuscript.toolbar.heading'), (event) => {
				this.openHeadingMenu(note, event);
			}),
		);
		separator();
		command('bold', 'bold', 'manuscript.toolbar.bold');
		command('italic', 'italic', 'manuscript.toolbar.italic');
		command('strikethrough', 'strikethrough', 'manuscript.toolbar.strikethrough');
		command('underline', 'underline', 'manuscript.toolbar.underline');
		command('highlight', 'highlighter', 'manuscript.toolbar.highlight');
		separator();
		// The dress, live while reading too: it is how the page is read.
		const dress = button(
			'palette',
			t('manuscript.toolbar.presentation'),
			() => {
				this.togglePanel(note, dress);
			},
			{ 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
		);
		dress.addClass('snowflake-method-toolbar-presentation');
		// Which marks the page wears, live while reading for the same reason
		// as the stream's: it is how the page is read, not an edit.
		const mentions = button(
			'scan-text',
			t('manuscript.toolbar.mentions'),
			(event) => {
				this.openMentionMenu(note, event);
			},
			{ 'aria-haspopup': 'menu' },
		);
		mentions.addClass('snowflake-method-toolbar-mentions');
		// The note as plain text, live while reading for the same reason: it
		// reads the note and edits none of it.
		const exporter = button('file-down', t('manuscript.exportNote'), () => {
			void this.exportNote(note).catch((error: unknown) => {
				this.deps.showError(error);
			});
		});
		exporter.addClass('snowflake-method-toolbar-export');
		separator();
		// The writing modes are the author's rather than the note's, and
		// pressing one here turns it for the stream and every note at once.
		const typewriter = button('align-vertical-space-around', '', () => {
			void this.deps.toggleTypewriter().catch((error: unknown) => {
				this.deps.showError(error);
			});
		});
		typewriter.addClass('snowflake-method-mode-toggle');
		// Focus mode walks its levels as the stream's button does, fading the
		// note around the paragraph being written, and the app around the
		// note.
		const focus = button('focus', '', () => {
			if (note.path === null || !this.deps.inProject(note.path)) return;
			void this.deps.toggleFocus().catch((error: unknown) => {
				this.deps.showError(error);
			});
		});
		focus.addClass('snowflake-method-mode-toggle', 'snowflake-method-toolbar-focus');
		const bar: MountedBar = {
			el,
			editing,
			mentions,
			typewriter,
			focus,
			face: null,
			tongue: t(TONGUE_KEY),
		};
		this.bars.set(note.containerEl, bar);
		return bar;
	}

	/**
	 * The bar's face from the note and the settings: grey while read, the
	 * marks and focus mode grey on a note no project holds, the modes lit
	 * while on, and the note faded around its paragraph while focus mode is
	 * on and reaches it.
	 */
	private paint(bar: MountedBar, note: ToolbarNote): void {
		const reading = !note.editing();
		for (const control of bar.editing) control.disabled = reading;
		const inProject = note.path !== null && this.deps.inProject(note.path);
		bar.mentions.disabled = !inProject;
		bar.focus.disabled = !inProject;
		const { typewriter, focusLevel } = this.deps.settings();
		note.containerEl.toggleClass(NOTE_FOCUS_CLASS, inProject && focusLevel !== 'off');
		// The buttons say what the modes are, the author's across every page,
		// as the stream's do: a greyed one says the note is out of its reach.
		const face = `${String(typewriter)} ${focusLevel}`;
		if (bar.face === face) return;
		bar.face = face;
		const t = this.deps.t(note.path);
		bar.typewriter.toggleClass('is-active', typewriter);
		setTooltip(
			bar.typewriter,
			`${t(typewriter ? 'manuscript.typewriterOn' : 'manuscript.typewriterOff')}\n${t(
				typewriter ? 'manuscript.modeTurnOff' : 'manuscript.modeTurnOn',
			)}`,
		);
		bar.focus.toggleClass('is-active', focusLevel !== 'off');
		setTooltip(
			bar.focus,
			`${t(`manuscript.focusLevel.${focusLevel}`)}\n${t(
				`manuscript.focusNext.${nextFocusLevel(focusLevel, { solo: !isMobileDevice() })}`,
			)}`,
		);
	}

	/** A bar press, delivered to the note's editor as the author's own edit. */
	private exec(note: ToolbarNote, command: EditorCommandId): void {
		const outer = note.editor();
		if (outer === null) return;
		// While a table's cell is being written in, the app hands its own
		// commands to the cell's editor, which holds the caret, and so does
		// the bar: the note's editor would take the caret out of the cell and
		// write over the row the cell stands in.
		const view = cellEditorIn(outer) ?? outer;
		// The press kept the caret where it was; a bar pressed from outside
		// the editor brings the caret back to it first, so the edit lands
		// where the author can see it.
		if (!view.hasFocus) view.focus();
		runEditorCommand(view, command);
	}

	/**
	 * The note the tab shows now, written out as it stands: what was typed
	 * since the app last saved it goes to the file first, so the export is
	 * the page the author is looking at.
	 */
	private async exportNote(note: ToolbarNote): Promise<void> {
		const path = note.path;
		if (path === null) return;
		await note.save();
		await this.deps.exportNote(path);
	}

	/** The stream's menu of marks, under the button of a note in a project. */
	private openMentionMenu(note: ToolbarNote, event: MouseEvent): void {
		const path = note.path;
		if (path === null || !this.deps.inProject(path)) return;
		openMentionModeMenu({
			t: this.deps.t(path),
			choices: this.deps.settings().mentions,
			set: this.deps.mentionModes,
			showError: (error) => {
				this.deps.showError(error);
			},
			event,
		});
	}

	/**
	 * Every heading level in one menu: the four the bar has no button of its
	 * own for, alongside the two it has, so the menu reads as one ladder.
	 */
	private openHeadingMenu(note: ToolbarNote, event: MouseEvent): void {
		if (!note.editing()) return;
		const t = this.deps.t(note.path);
		const menu = new Menu();
		for (const level of [1, 2, 3, 4, 5, 6] as const) {
			menu.addItem((item) => {
				item.setTitle(t('manuscript.toolbar.headingLevel', { level }))
					.setIcon(`heading-${level}`)
					.onClick(() => {
						this.exec(note, `heading-${level}`);
					});
			});
		}
		menu.showAtMouseEvent(event);
	}

	/** The dress popover, opened under its button or closed again. */
	private togglePanel(note: ToolbarNote, anchor: HTMLElement): void {
		if (this.panel !== null) {
			const same = this.panel.anchor === anchor;
			this.closePanel();
			if (same) return;
		}
		const panel = openPresentationPanel({
			app: this.deps.app,
			anchor,
			t: this.deps.t(note.path),
			look: () => this.deps.settings().presentation,
			set: (patch) => this.deps.setPresentation(patch),
			recentFonts: () => this.deps.settings().recentFonts,
			enterParagraph: () => this.deps.settings().enterParagraph,
			setEnterParagraph: (on) => this.deps.setEnterParagraph(on),
			guides: false,
			onClose: (how) => {
				if (this.panel?.panel === panel) this.panel = null;
				// Back to the words, unless the author has clicked somewhere
				// else: they were writing before they reached for the dress.
				if (how !== 'pointer' && note.editing()) note.editor()?.focus();
			},
		});
		this.panel = { panel, anchor };
	}

	private closePanel(): void {
		const open = this.panel;
		this.panel = null;
		open?.panel.close('view');
	}
}
