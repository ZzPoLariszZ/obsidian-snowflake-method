import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
	Language,
	defaultHighlightStyle,
	defineLanguageFacet,
	languageDataProp,
	syntaxHighlighting,
} from '@codemirror/language';
import { parser as markdownParser } from '@lezer/markdown';

import { selectedTextOf } from '../editor';
import {
	Annotation,
	EditorSelection,
	EditorState,
	type Extension,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	keymap,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';

import { paragraphAround } from './caret-paragraph';
import { findPassage } from './prose-projection';

/**
 * What the manuscript stream needs from an editor, and all it is allowed to
 * know about one.
 *
 * Obsidian publishes no API for putting several files under one editable
 * surface. The reading half of the stream is public API throughout; the writing
 * half is not, so it is kept behind this interface — the sequence, the sliding
 * window, the boundaries and the segment operations all sit above it and none
 * of them can tell which editor is mounted. Replacing the editor should mean
 * writing one more implementation of this file and nothing else.
 */
export interface SegmentEditorBackend {
	readonly id: string;
	mount(
		target: SegmentEditorTarget,
		container: HTMLElement,
		hooks: SegmentEditorHooks,
	): Promise<SegmentEditorHandle>;
	unmount(path: string): Promise<void>;
	focus(path: string): void;
	/** The mounted editor for a segment, if this backend has one. */
	handle(path: string): SegmentEditorHandle | null;
}

export interface SegmentEditorTarget {
	path: string;
	/** Everything below the frontmatter. The frontmatter is never shown. */
	body: string;
	readOnly: boolean;
}

export interface SegmentEditorHooks {
	onChange(path: string, body: string): void;
	onBlur(path: string): void;
	/**
	 * The author moved the caret: typed, pressed Enter, walked with the arrows.
	 * Not fired for the machinery's own dispatches, and not for a pointer
	 * click — that is the one move the view already answers, by putting the
	 * clicked words back under the pointer.
	 */
	onCaretMove?(path: string): void;
	/**
	 * An arrow pressed against the edge of the note: the caret was already at
	 * the very start or end, and had nowhere left to go inside this editor.
	 * The manuscript continues in the next note, and walking into it is the
	 * view's to arrange.
	 */
	onCaretLeave?(path: string, edge: 'start' | 'end'): void;
	/**
	 * The editor asking for the caret to be brought into view, with where the
	 * caret line sits on the screen — measured when the line is laid out, the
	 * editor's estimate when it is not yet. Handed over rather than acted on:
	 * the editor is one block in a page it does not own, and scrolling that
	 * page by its own reckoning threw the reader wherever the reckoning was
	 * stale.
	 */
	onCaretShow?(path: string, top: number, bottom: number): void;
	/**
	 * The selection changed: grew, moved, or emptied. `selectedText` is what
	 * stands selected — every range of it, pointer-drawn or not — or null
	 * when nothing is. For whoever is counting.
	 */
	onSelectionChange?(path: string, selectedText: string | null): void;
}

/** Marks a change the editor was handed rather than one the author typed. */
const FROM_ELSEWHERE = Annotation.define<boolean>();

/**
 * Markdown highlighting from the grammar itself rather than through
 * `@codemirror/lang-markdown`.
 *
 * That package reaches for the HTML, CSS and JavaScript grammars so it can
 * highlight inside fenced code blocks, and none of them can be shaken back out
 * again: together they are 176 KB of the plugin's download, to colour code a
 * novel does not contain. The grammar on its own is 35 KB and knows headings,
 * emphasis, links, quotes and lists, which is what a manuscript is written in.
 */
const MARKDOWN_DATA = defineLanguageFacet({
	commentTokens: { block: { open: '<!--', close: '-->' } },
});

const MARKDOWN = new Language(
	MARKDOWN_DATA,
	markdownParser.configure({
		props: [
			languageDataProp.add((type) =>
				type.isTop ? MARKDOWN_DATA : undefined,
			),
		],
	}),
	[],
	'markdown',
);

const CARET_PARAGRAPH = Decoration.line({
	class: 'snowflake-method-caret-paragraph',
});

function lightParagraph(state: EditorState): DecorationSet {
	const doc = state.doc;
	const bounds = paragraphAround(
		{ lines: doc.lines, lineText: (line) => doc.line(line).text },
		doc.lineAt(state.selection.main.head).number,
	);
	if (bounds === null) return Decoration.none;
	const lines = [];
	for (let line = bounds.first; line <= bounds.last; line += 1) {
		lines.push(CARET_PARAGRAPH.range(doc.line(line).from));
	}
	return Decoration.set(lines);
}

/**
 * Marks the lines of the paragraph the caret is in, always. The styling that
 * fades everything else is applied by the view, in focus mode only, so keeping
 * the mark current is the whole of this plugin's job — a toggle is a class
 * flip, never an editor reconfiguration.
 */
const caretParagraph = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = lightParagraph(view.state);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.selectionSet) {
				this.decorations = lightParagraph(update.state);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export interface SegmentEditorHandle {
	readonly path: string;
	/** The text as it stands in the editor, which may be ahead of the file. */
	read(): string;
	/**
	 * Puts text that arrived from elsewhere into the editor.
	 *
	 * Not reported back as a change, because it is not one the author made and
	 * writing it straight back out would be this editor answering itself.
	 */
	write(body: string): void;
	/** Caret position within the body, for splitting the segment at it. */
	cursor(): number;
	/**
	 * Where the caret line sits on the screen, or null while the editor has
	 * not laid that line out. The view scrolls by this to hold the line
	 * steady, and to settle a landing once the layout firms up.
	 */
	caretBand(): { top: number; bottom: number } | null;
	/**
	 * Puts the caret at one end of the note, as the author's own arrival — an
	 * arrow key carried them in from the neighbouring note, so the modes that
	 * follow the author follow this too.
	 */
	enter(edge: 'start' | 'end'): void;
	/**
	 * Puts the caret in a passage of text, and says how far up or down the page
	 * that passage sits from where the caller wanted it.
	 *
	 * A rendered note and an editor showing the same note are not the same
	 * height, so the words an author clicked are somewhere else by the time they
	 * can type in them. Rather than chase two layouts into agreement, the caller
	 * says which words those were, how far into them the pointer was, where on
	 * the screen they were, and roughly how far through the note — and scrolls by
	 * what comes back. Null when the passage cannot be found.
	 */
	seek(
		passage: string,
		lead: number,
		screenY: number,
		near: number,
	): number | null;
	focus(): void;
	destroy(): void;
}

/**
 * The stable backend: one CodeMirror 6 editor, mounted on whichever segment the
 * author is writing in, while every other segment in the window stays rendered.
 *
 * Obsidian is itself built on CodeMirror 6 and provides the packages this
 * imports at run time, so nothing here reaches past a supported API. It is not
 * Obsidian's own editor and does not pretend to be: no live preview, and none
 * of the community extensions an author has added to it. What it does cover is
 * what writing prose needs — text, Markdown highlighting, a caret, a selection,
 * undo, and wrapping.
 */
export class PublicCodeMirrorBackend implements SegmentEditorBackend {
	readonly id = 'codemirror';

	private readonly views = new Map<string, EditorView>();

	async mount(
		target: SegmentEditorTarget,
		container: HTMLElement,
		hooks: SegmentEditorHooks,
	): Promise<SegmentEditorHandle> {
		await this.unmount(target.path);
		const view = new EditorView({
			state: EditorState.create({
				doc: target.body,
				extensions: this.extensions(target, hooks),
			}),
			parent: container,
		});
		this.views.set(target.path, view);
		return this.toHandle(target.path, view);
	}

	async unmount(path: string): Promise<void> {
		const view = this.views.get(path);
		if (view === undefined) return;
		this.views.delete(path);
		view.destroy();
		return Promise.resolve();
	}

	focus(path: string): void {
		this.views.get(path)?.focus();
	}

	handle(path: string): SegmentEditorHandle | null {
		const view = this.views.get(path);
		return view === undefined ? null : this.toHandle(path, view);
	}

	private toHandle(path: string, view: EditorView): SegmentEditorHandle {
		return {
			path,
			read: () => view.state.doc.toString(),
			write: (body: string) => {
				if (body === view.state.doc.toString()) return;
				// The caret keeps its offset where the new text is long enough to
				// hold it. Mapping it through a whole-document replacement would be
				// guesswork; landing somewhere sensible is not.
				const head = Math.min(view.state.selection.main.head, body.length);
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: body },
					selection: EditorSelection.cursor(head),
					annotations: FROM_ELSEWHERE.of(true),
				});
			},
			cursor: () => view.state.selection.main.head,
			caretBand: () => {
				const coords = view.coordsAtPos(view.state.selection.main.head);
				return coords === null
					? null
					: { top: coords.top, bottom: coords.bottom };
			},
			enter: (edge: 'start' | 'end') => {
				view.dispatch({
					selection: EditorSelection.cursor(
						edge === 'start' ? 0 : view.state.doc.length,
					),
					userEvent: 'select',
				});
			},
			seek: (
				passage: string,
				lead: number,
				screenY: number,
				near: number,
			) => {
				const source = view.state.doc.toString();
				const found = findPassage(source, passage, lead, near);
				// Wherever the caret ends up it must be somewhere the reader can see,
				// because focusing an editor scrolls the caret into view — and a caret
				// left at the first character drags the page to the top of the note,
				// which is a bigger move than any this was meant to avoid. Failing the
				// words, the height the click came in at is the next best guess.
				const position =
					found === null
						? view.posAtCoords({
								x: view.dom.getBoundingClientRect().left + 8,
								y: screenY,
							})
						: found;
				if (position === null) return null;
				// Asked twice, because the first answer comes from an editor that has
				// not measured itself yet. The second time the caret is already there
				// and only the measurement is wanted. Annotated as the machinery's
				// own move: seeking is the view placing the caret, not the author
				// moving it, and typewriter scrolling must not answer it.
				if (view.state.selection.main.head !== position) {
					view.dispatch({
						selection: EditorSelection.cursor(position),
						annotations: FROM_ELSEWHERE.of(true),
					});
				}
				if (found === null) return null;
				const coords = view.coordsAtPos(position);
				return coords === null ? null : coords.top - screenY;
			},
			focus: () => {
				view.focus();
			},
			destroy: () => {
				void this.unmount(path);
			},
		};
	}

	private extensions(
		target: SegmentEditorTarget,
		hooks: SegmentEditorHooks,
	): Extension[] {
		// An arrow the editor can do nothing with has one thing left to mean:
		// the author is walking on, and the manuscript continues in the next
		// note. Left and right are simple — the character edges of the note.
		// Up and down go by rows: on the visual row holding the note's first
		// or last character, one press walks on, which keeps a wrapped
		// paragraph walkable line by visual line. Rows are compared by their
		// measured places, and only rendered rows have one — long notes are
		// laid out a windowful at a time, so a caret the page has scrolled
		// away from decides nothing: the press is spent bringing it back,
		// and the next press finds it measurable. Ahead of the default
		// keymap, which would swallow the press doing nothing.
		const reveal = (view: EditorView, head: number): boolean => {
			view.dispatch({ effects: EditorView.scrollIntoView(head) });
			return true;
		};
		const walksOut =
			(edge: 'start' | 'end') =>
			(view: EditorView): boolean => {
				const selection = view.state.selection.main;
				if (!selection.empty) return false;
				const at = edge === 'start' ? 0 : view.state.doc.length;
				if (selection.head !== at) return false;
				if (view.coordsAtPos(selection.head) === null) {
					return reveal(view, selection.head);
				}
				hooks.onCaretLeave?.(target.path, edge);
				return true;
			};
		const climbsOut =
			(edge: 'start' | 'end') =>
			(view: EditorView): boolean => {
				const selection = view.state.selection.main;
				if (!selection.empty) return false;
				const row = view.coordsAtPos(selection.head);
				if (row === null) return reveal(view, selection.head);
				const corner = view.coordsAtPos(
					edge === 'start' ? 0 : view.state.doc.length,
				);
				// An edge the editor has not laid out is nowhere near the
				// caret's rendered row.
				if (corner === null) return false;
				// The same row when their heights overlap — surer than
				// comparing tops, which inline formatting can nudge apart.
				if (row.top >= corner.bottom || row.bottom <= corner.top) {
					return false;
				}
				hooks.onCaretLeave?.(target.path, edge);
				return true;
			};
		const extensions: Extension[] = [
			history(),
			// Every cursor command asks for the caret to be scrolled into view,
			// and CodeMirror would answer by scrolling the page this editor sits
			// in. The page is windowed: notes mount and unmount as it moves, so
			// the editor's reckoning of where to scroll goes stale mid-scroll,
			// and an arrow key could throw the reader across several notes. The
			// view owns the page, so the view is given the caret and the choice.
			EditorView.scrollHandler.of((view, range) => {
				if (hooks.onCaretShow === undefined) return false;
				const coords = view.coordsAtPos(range.head);
				if (coords !== null) {
					hooks.onCaretShow(target.path, coords.top, coords.bottom);
					return true;
				}
				// A caret with no layout yet still has an address: estimated
				// line heights say roughly where its line sits. Rough is
				// enough — the view lands nearby and settles on measured
				// ground over the frames that follow. Refusing here would
				// hand the scroll back to the editor's own answer, which is
				// the several-notes throw this handler exists to prevent.
				const line = view.lineBlockAt(range.head);
				const top = view.documentTop + line.top;
				hooks.onCaretShow(target.path, top, top + line.height);
				return true;
			}),
			keymap.of([
				{ key: 'ArrowUp', run: climbsOut('start') },
				{ key: 'ArrowLeft', run: walksOut('start') },
				{ key: 'ArrowDown', run: climbsOut('end') },
				{ key: 'ArrowRight', run: walksOut('end') },
			]),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			MARKDOWN,
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			EditorView.lineWrapping,
			caretParagraph,
			EditorView.updateListener.of((update) => {
				const handed = update.transactions.some(
					(transaction) => transaction.annotation(FROM_ELSEWHERE) === true,
				);
				if (update.docChanged && !handed) {
					hooks.onChange(target.path, update.state.doc.toString());
				}
				if (update.focusChanged && !update.view.hasFocus) {
					hooks.onBlur(target.path);
				}
				// A pointer selection is the click the view already answers with
				// `putBack`; everything else that moved the caret is the author.
				const pointed = update.transactions.some((transaction) =>
					transaction.isUserEvent('select.pointer'),
				);
				if ((update.docChanged || update.selectionSet) && !handed && !pointed) {
					hooks.onCaretMove?.(target.path);
				}
				// Unlike the caret, a selection counts however it was drawn:
				// with the keyboard, with the pointer, or by an edit that
				// moved its ends.
				if (update.docChanged || update.selectionSet) {
					hooks.onSelectionChange?.(
						target.path,
						selectedTextOf(update.state),
					);
				}
			}),
		];
		if (target.readOnly) {
			extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
		}
		return extensions;
	}
}
