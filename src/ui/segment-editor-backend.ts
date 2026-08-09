import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
	Language,
	defaultHighlightStyle,
	defineLanguageFacet,
	languageDataProp,
	syntaxHighlighting,
} from '@codemirror/language';
import { parser as markdownParser } from '@lezer/markdown';
import {
	Annotation,
	EditorSelection,
	EditorState,
	type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

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

/**
 * Where a passage of rendered text sits in the Markdown behind it, or null.
 *
 * Prose reaches the page as itself, so the words are the same on both sides and
 * looking them up is enough. What differs is the markup around them: a passage
 * that ran into an emphasis or a link is not there to be found, and is given up
 * on rather than approximated, because doing nothing beats moving the page to
 * the wrong place. `near` is roughly how far through the note the passage was,
 * for telling copies of the same wording apart.
 */
export function findPassage(
	source: string,
	passage: string,
	near: number,
): number | null {
	if (passage.trim().length < 12) return null;
	// The nearest match, and only ever the whole passage. A shorter prefix finds
	// something almost anywhere in a chapter, and acting on the wrong copy
	// scrolls the page somewhere the author never was — worse than the small
	// shift of doing nothing. Prose that ran into an emphasis or a link will not
	// be found, and is left alone.
	let best: number | null = null;
	for (let at = source.indexOf(passage); at !== -1; ) {
		if (best === null || Math.abs(at - near) < Math.abs(best - near)) best = at;
		at = source.indexOf(passage, at + 1);
	}
	return best;
}

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
			seek: (
				passage: string,
				lead: number,
				screenY: number,
				near: number,
			) => {
				const source = view.state.doc.toString();
				const found = findPassage(source, passage, near * source.length);
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
						: Math.min(found + lead, source.length);
				if (position === null) return null;
				// Asked twice, because the first answer comes from an editor that has
				// not measured itself yet. The second time the caret is already there
				// and only the measurement is wanted.
				if (view.state.selection.main.head !== position) {
					view.dispatch({ selection: EditorSelection.cursor(position) });
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
		const extensions: Extension[] = [
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			MARKDOWN,
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			EditorView.lineWrapping,
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
			}),
		];
		if (target.readOnly) {
			extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
		}
		return extensions;
	}
}
