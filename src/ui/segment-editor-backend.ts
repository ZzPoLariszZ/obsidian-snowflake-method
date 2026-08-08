import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
	Language,
	defaultHighlightStyle,
	defineLanguageFacet,
	languageDataProp,
	syntaxHighlighting,
} from '@codemirror/language';
import { parser as markdownParser } from '@lezer/markdown';
import { EditorState, type Extension } from '@codemirror/state';
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

export interface SegmentEditorHandle {
	readonly path: string;
	/** The text as it stands in the editor, which may be ahead of the file. */
	read(): string;
	/** Caret position within the body, for splitting the segment at it. */
	cursor(): number;
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
			cursor: () => view.state.selection.main.head,
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
				if (update.docChanged) {
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
