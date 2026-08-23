import {
	autocompletion,
	closeCompletion,
	completionKeymap,
	currentCompletions,
	selectedCompletionIndex,
	setSelectedCompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from '@codemirror/autocomplete';
import {
	defaultKeymap,
	history,
	historyField,
	historyKeymap,
	insertNewline,
	redo,
	undo,
} from '@codemirror/commands';
import {
	defaultHighlightStyle,
	ensureSyntaxTree,
	syntaxHighlighting,
	syntaxTree,
} from '@codemirror/language';

import {
	INLINE_PAIRS,
	MARKDOWN_LANGUAGE,
	addTracked,
	autoPair,
	deleteAutoPair,
	paragraphBreak,
	paragraphLayout,
	selectedTextOf,
	toggleHeading,
	toggleInline,
	wikilinkAt,
	type HeadingLevel,
	type InlineMarker,
	type TrackedCloser,
} from '../editor';
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
	tooltips,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';

import { paragraphAround } from './caret-paragraph';
import { findPassage } from './prose-projection';
import { wikilinkOptions, wikilinkReplaceRange } from './wikilink-complete';

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
	/** Brackets and quotes close themselves. Read at mount, not live. */
	autoPairBrackets: boolean;
	/** Emphasis markers close themselves. Read at mount, not live. */
	autoPairMarkdown: boolean;
}

/**
 * One row the wikilink popup can offer: an entity's primary name, or one of
 * its aliases as its own selectable entry. Every entry of one entity carries
 * the same canonical path; what differs is the label shown and the alias the
 * prebuilt link inserts. Part of the editor contract so any backend can
 * offer the same popup from the same feed.
 */
export interface WikilinkTarget {
	/** EntityGroupId: character, scene, time-point, time-period, or a kind. */
	group: string;
	/** What the group is called, in the project's language. */
	groupLabel: string;
	/** The group's place in rail order, breaking cross-kind rank ties. */
	groupRank: number;
	/** The entity's snowflake rank, sparse and per kind. */
	rank: number;
	/** The name or alias this entry shows, and the link alias it writes. */
	label: string;
	entry: 'name' | 'alias';
	/** The canonical vault path all of one entity's entries share. */
	memberPath: string;
	memberName: string;
	/** The whole link, prebuilt: `[[path/from/root|label]]`. */
	insert: string;
}

/**
 * The editing commands a segment editor answers: the toolbar's buttons and the
 * keyboard's chords, one name each, whichever way they were asked for.
 */
export type SegmentEditorCommandId =
	| 'undo'
	| 'redo'
	| InlineMarker
	| `heading-${HeadingLevel}`;

export interface SegmentEditorHooks {
	onChange(path: string, body: string): void;
	onBlur(path: string): void;
	/**
	 * Whether Enter puts the paragraph break Markdown needs (and Shift+Enter
	 * the plain line break). Asked at every press rather than read at mount,
	 * so the popover over the manuscript can flip it for the editor already
	 * open. Absent, Enter is CodeMirror's own.
	 */
	enterParagraph?(): boolean;
	/** Mod+E inside the editor: the author asked to read this note. */
	onToggleReading?(path: string): void;
	/**
	 * Entities of this project the author may link to, for the `[[` popup.
	 * Fetched lazily and cached above this interface; the editor only asks.
	 */
	wikilinkTargets?(): Promise<readonly WikilinkTarget[]>;
	/**
	 * The pointer stands in a wikilink in the editor's raw text. Fired for
	 * every move within one, and again when a modifier comes down over it —
	 * the preview plugin deduplicates, and a stale one-time report is what
	 * kept previews from answering after a click. Whether and how a preview
	 * answers is the view's business, modifier keys included.
	 */
	onLinkHover?(
		path: string,
		event: MouseEvent,
		targetEl: HTMLElement,
		linktext: string,
	): void;
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

const PARAGRAPH_FIRST = Decoration.line({
	class: 'snowflake-method-paragraph-first',
});

const PARAGRAPH_LINE = Decoration.line({
	class: 'snowflake-method-paragraph-line',
});

const BLANK_LINE = Decoration.line({
	class: 'snowflake-method-blank-line',
});

/** How long one update may spend parsing ahead for the lines in view. */
const LAYOUT_PARSE_MS = 50;

/** Enter as the manuscript's paragraph break; declines outside prose. */
const breaksParagraph = (view: EditorView): boolean => {
	const spec = paragraphBreak(view.state);
	if (spec === null) return false;
	view.dispatch(spec);
	return true;
};

/**
 * The lines the page indents, aligns or spaces, found over what is on
 * screen: the first line of a paragraph carries the indent, every line of
 * one its alignment and hyphenation, and a blank line the gap.
 */
function layoutDecorations(view: EditorView): DecorationSet {
	// The grammar is parsed in the background a few thousand characters at a
	// time, and a state just made has parsed only its first three thousand;
	// the lines in view, deep in a long note, would be drawn plain and then
	// redrawn in the page's dress a moment later when the parse caught up --
	// a visible jump on every click into a note. So the parse is brought up
	// to the end of the viewport here, before the lines are decorated, which
	// costs a few milliseconds once and nothing after.
	const tree =
		ensureSyntaxTree(view.state, view.viewport.to, LAYOUT_PARSE_MS) ??
		syntaxTree(view.state);
	const first = new Set<number>();
	const lines = new Set<number>();
	const blank = new Set<number>();
	for (const range of view.visibleRanges) {
		const layout = paragraphLayout(view.state, range.from, range.to, tree);
		for (const at of layout.first) first.add(at);
		for (const at of layout.lines) lines.add(at);
		for (const at of layout.blank) blank.add(at);
	}
	return Decoration.set(
		[
			...[...first].map((at) => PARAGRAPH_FIRST.range(at)),
			...[...lines].map((at) => PARAGRAPH_LINE.range(at)),
			...[...blank].map((at) => BLANK_LINE.range(at)),
		],
		true,
	);
}

/**
 * Marks the first line of every paragraph and every blank line between
 * blocks, always. The page gives a paragraph its indent and its gap, and the
 * stylesheet gives these lines the same from the same variables — so a change
 * of typography is live without an editor reconfiguration, and the two halves
 * cannot drift apart. Rebuilt when the text or the viewport moves, and when
 * the grammar has parsed further, which a new tree identity says.
 */
const paragraphLines = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = layoutDecorations(view);
		}

		update(update: ViewUpdate): void {
			if (
				update.docChanged ||
				update.viewportChanged ||
				syntaxTree(update.startState) !== syntaxTree(update.state)
			) {
				this.decorations = layoutDecorations(update.view);
			}
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

/**
 * A row of the wikilink popup as CodeMirror holds it, with the builder's
 * mark on the one row the popup should open on.
 */
interface WikilinkCompletion extends Completion {
	preferred: boolean;
}

function isWikilinkCompletion(
	completion: Completion,
): completion is WikilinkCompletion {
	return 'preferred' in completion;
}

/**
 * Opens the popup on the row that best fits what was typed, which is not
 * always the first: an entity's name heads its block even when it was one of
 * its aliases that matched, and the author who typed the alias should be
 * able to take it with Enter. CodeMirror puts the highlight on the first row
 * of every fresh result, so each fresh result is answered with a move to the
 * preferred row -- deferred one microtask, because a listener may not
 * dispatch while the update it is told of is still in progress, and dropped
 * if the result has moved on by then. A result that only moved the highlight
 * keeps the same rows, so the author's own arrowing is never undone.
 */
const preferredRow = EditorView.updateListener.of((update) => {
	const completions = currentCompletions(update.state);
	if (
		completions.length === 0 ||
		completions === currentCompletions(update.startState)
	) {
		return;
	}
	const index = completions.findIndex(
		(completion) => isWikilinkCompletion(completion) && completion.preferred,
	);
	if (index <= 0 || selectedCompletionIndex(update.state) === index) return;
	const { view } = update;
	view.dom.win.queueMicrotask(() => {
		if (currentCompletions(view.state) !== completions) return;
		view.dispatch({ effects: setSelectedCompletion(index) });
	});
});

/**
 * Runs one editing command as the author's own edit.
 *
 * Everything but undo and redo dispatches a plain user transaction, which is
 * what keeps the pending text, the save timer, the word count and the writing
 * session all fed: the update listener treats it exactly like typing.
 */
function runEditorCommand(
	view: EditorView,
	command: SegmentEditorCommandId,
): boolean {
	if (command === 'undo') return undo(view);
	if (command === 'redo') return redo(view);
	if (
		command === 'heading-1' ||
		command === 'heading-2' ||
		command === 'heading-3' ||
		command === 'heading-4' ||
		command === 'heading-5' ||
		command === 'heading-6'
	) {
		const spec = toggleHeading(
			view.state,
			Number(command.slice('heading-'.length)) as HeadingLevel,
		);
		if (spec === null) return false;
		view.dispatch({ ...spec, userEvent: 'input.format', scrollIntoView: true });
		return true;
	}
	const spec = toggleInline(view.state, command);
	if (spec === null) return false;
	view.dispatch({ ...spec, userEvent: 'input.format', scrollIntoView: true });
	markCommandClosers(view, command);
	return true;
}

/**
 * Hands the pairing engine the pair a formatting command just placed, so it
 * behaves exactly as if the author had typed it: Backspace at its centre
 * takes both sides, and typing a closing character steps over the tracked
 * one instead of doubling it. Ranges the command did not leave flanked — an
 * unwrap, a removal — hand over nothing, and without the pairing engine the
 * effect lands on no field and means nothing.
 */
function markCommandClosers(view: EditorView, marker: InlineMarker): void {
	const { open, close } = INLINE_PAIRS[marker];
	const entries: TrackedCloser[] = [];
	for (const range of view.state.selection.ranges) {
		if (range.from < open.length) continue;
		if (view.state.sliceDoc(range.from - open.length, range.from) !== open) {
			continue;
		}
		if (view.state.sliceDoc(range.to, range.to + close.length) !== close) {
			continue;
		}
		if (marker === 'underline') {
			// One entry for the whole tag: per-character tracking would let a
			// typed `<` step into its middle.
			entries.push({ pos: range.to, close });
		} else {
			for (const [at, char] of [...close].entries()) {
				entries.push({ pos: range.to + at, close: char });
			}
		}
	}
	if (entries.length > 0) view.dispatch({ effects: addTracked.of(entries) });
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
	/** Runs one editing command as the author's own edit. False when it did nothing. */
	exec(command: SegmentEditorCommandId): boolean;
	/**
	 * Asks the editor to measure its lines again on the next frame. The page
	 * calls this when it changes the typography under the editor, because the
	 * editor notices a resize on its own only after a debounce, and the page
	 * is holding its place against heights it wants corrected now.
	 */
	remeasure(): void;
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

	/**
	 * One body-parented div per mounted editor, for CodeMirror's tooltips.
	 * The stream scrolls inside a hidden-overflow pane, so a popup parented
	 * in the editor would be clipped; fixed positioning from the document
	 * body escapes every overflow, popout windows included, and the class
	 * scopes this plugin's popup styling away from anyone else's tooltips.
	 */
	private readonly tooltipHosts = new Map<string, HTMLElement>();

	/**
	 * Undo histories parked when their editors go, keyed by path in
	 * least-recently-parked order. Toggling a note to prose and back, or the
	 * sliding window carrying it out and in, used to cost the whole history;
	 * now the serialized history waits, and a mount whose text still matches
	 * takes it back. A parked entry whose document no longer matches is
	 * stale by definition and is dropped unconsumed.
	 */
	private readonly parked = new Map<string, unknown>();

	private static readonly PARKED_LIMIT = 8;

	async mount(
		target: SegmentEditorTarget,
		container: HTMLElement,
		hooks: SegmentEditorHooks,
	): Promise<SegmentEditorHandle> {
		await this.unmount(target.path);
		let tooltipHost: HTMLElement | null = null;
		if (!target.readOnly) {
			tooltipHost = container.ownerDocument.body.createDiv({
				cls: 'snowflake-method-cm-tooltips',
			});
			this.tooltipHosts.set(target.path, tooltipHost);
			// The selection follows the pointer, as it does in Obsidian's own
			// suggestion popups: one highlighted row, whichever of keyboard
			// or mouse moved last. CodeMirror numbers every option row's id
			// after the list's, `<list>-<index>`, so the row under the
			// pointer names the option to select.
			tooltipHost.addEventListener('mousemove', (event) => {
				const row = (event.target as HTMLElement | null)?.closest(
					'li[role="option"]',
				);
				const list = row?.parentElement ?? null;
				if (!row || list === null || !row.id.startsWith(`${list.id}-`)) {
					return;
				}
				const index = Number(row.id.slice(list.id.length + 1));
				const view = this.views.get(target.path);
				if (
					view === undefined ||
					!Number.isInteger(index) ||
					selectedCompletionIndex(view.state) === index
				) {
					return;
				}
				view.dispatch({ effects: setSelectedCompletion(index) });
			});
		}
		const view = new EditorView({
			state:
				this.unparkState(target, hooks, tooltipHost) ??
				EditorState.create({
					doc: target.body,
					extensions: this.extensions(target, hooks, tooltipHost),
				}),
			parent: container,
		});
		this.views.set(target.path, view);
		return this.toHandle(target.path, view);
	}

	/**
	 * The parked state for a mount, rebuilt with this mount's own fresh
	 * extensions so no closure from the previous life survives — only the
	 * document, the selection and the undo history come back.
	 */
	private unparkState(
		target: SegmentEditorTarget,
		hooks: SegmentEditorHooks,
		tooltipHost: HTMLElement | null,
	): EditorState | null {
		const json = this.parked.get(target.path);
		this.parked.delete(target.path);
		if (json === null || typeof json !== 'object') return null;
		if ((json as { doc?: unknown }).doc !== target.body) return null;
		try {
			return EditorState.fromJSON(
				json,
				{ extensions: this.extensions(target, hooks, tooltipHost) },
				{ history: historyField },
			);
		} catch {
			return null;
		}
	}

	async unmount(path: string): Promise<void> {
		const view = this.views.get(path);
		if (view === undefined) return;
		this.views.delete(path);
		this.parked.delete(path);
		this.parked.set(path, view.state.toJSON({ history: historyField }));
		while (this.parked.size > PublicCodeMirrorBackend.PARKED_LIMIT) {
			const oldest = this.parked.keys().next().value;
			if (oldest === undefined) break;
			this.parked.delete(oldest);
		}
		view.destroy();
		this.tooltipHosts.get(path)?.remove();
		this.tooltipHosts.delete(path);
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
				// A popup anchored into text about to be rewritten would offer
				// completions for a document that no longer exists.
				closeCompletion(view);
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
			remeasure: () => {
				view.requestMeasure();
			},
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
			exec: (command: SegmentEditorCommandId) =>
				runEditorCommand(view, command),
			focus: () => {
				view.focus();
			},
			destroy: () => {
				void this.unmount(path);
			},
		};
	}

	/**
	 * The `[[` popup's source. The second bracket makes the pattern match,
	 * so the popup opens the moment `[[` stands before the caret — the
	 * auto-paired `[[|]]` included, since only what precedes the caret is
	 * read here. Ranking, grouping and the inserted text are all the pure
	 * builder's; this closure only fetches, slices the query, and applies.
	 */
	private wikilinkSource(
		hooks: SegmentEditorHooks,
	): (context: CompletionContext) => Promise<CompletionResult | null> {
		return async (context: CompletionContext) => {
			const match = context.matchBefore(/\[\[[^\][]*$/u);
			if (match === null || hooks.wikilinkTargets === undefined) return null;
			let targets: readonly WikilinkTarget[];
			try {
				targets = await hooks.wikilinkTargets();
			} catch {
				return null;
			}
			if (context.aborted || targets.length === 0) return null;
			const query = context.state.sliceDoc(match.from + 2, context.pos);
			const options = wikilinkOptions(targets, query).map(
				(option): WikilinkCompletion => ({
					label: option.label,
					preferred: option.preferred,
					type: option.alias ? 'wikilink-alias' : undefined,
					section: option.section,
					apply: (view, _completion, from, to) => {
						const range = wikilinkReplaceRange(
							from,
							to,
							view.state.sliceDoc(to, to + 2),
						);
						view.dispatch({
							changes: {
								from: range.from,
								to: range.to,
								insert: option.insert,
							},
							selection: EditorSelection.cursor(
								range.from + option.insert.length,
							),
							userEvent: 'input.complete',
							scrollIntoView: true,
						});
					},
				}),
			);
			return { from: match.from, options, filter: false };
		};
	}

	private extensions(
		target: SegmentEditorTarget,
		hooks: SegmentEditorHooks,
		tooltipHost: HTMLElement | null,
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
				const at = edge === 'start' ? 0 : view.state.doc.length;
				// A caret on another document line than the edge's cannot be
				// on its visual row, whatever the rows measure: a blank line
				// squeezed to a paragraph gap's height sits inside a text
				// row's leading without being that row.
				if (
					view.state.doc.lineAt(selection.head).number !==
					view.state.doc.lineAt(at).number
				) {
					return false;
				}
				const row = view.coordsAtPos(selection.head);
				if (row === null) return reveal(view, selection.head);
				const corner = view.coordsAtPos(at);
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
		// Vertical motion never steps over a line. CodeMirror looks for the
		// next row half a text height below the caret's, and a blank line
		// squeezed to a paragraph gap narrower than that is not there to be
		// found: the caret would go from the last row of one paragraph to
		// the first of the next, and the line between them could only be
		// reached with the mouse. When the move would skip a line, the caret
		// goes to the line it skipped instead, keeping its goal column.
		const stepsOverNoLine =
			(forward: boolean) =>
			(view: EditorView): boolean => {
				const range = view.state.selection.main;
				if (!range.empty) return false;
				const doc = view.state.doc;
				const line = doc.lineAt(range.head);
				const next = line.number + (forward ? 1 : -1);
				if (next < 1 || next > doc.lines) return false;
				const moved = view.moveVertically(range, forward);
				const landed = doc.lineAt(moved.head).number;
				if (forward ? landed <= next : landed >= next) return false;
				view.dispatch({
					selection: EditorSelection.cursor(
						doc.line(next).from,
						moved.assoc,
						moved.bidiLevel ?? undefined,
						moved.goalColumn,
					),
					scrollIntoView: true,
					userEvent: 'select',
				});
				return true;
			};
		// Enter as the paragraph break, behind the popup's own Enter (its
		// keymap comes first) and ahead of the default keymap's. The setting
		// is asked for at each press, so a flip in the popover reaches this
		// editor at once; off, both bindings decline and the default keymap
		// answers.
		const paragraphs = (): boolean => hooks.enterParagraph?.() === true;
		const enter: Extension[] = target.readOnly
			? []
			: [
					keymap.of([
						{ key: 'Enter', run: (view) => paragraphs() && breaksParagraph(view) },
						{ key: 'Shift-Enter', run: (view) => paragraphs() && insertNewline(view) },
					]),
				];
		// Pairing preferences are the target's, frozen at mount like readOnly:
		// a settings change reaches the next editor opened, not this one.
		const pairing =
			target.readOnly || (!target.autoPairBrackets && !target.autoPairMarkdown)
				? []
				: [
						autoPair({
							brackets: target.autoPairBrackets,
							markdown: target.autoPairMarkdown,
						}),
					];
		// The popup escapes to a body-parented host; without one (read-only
		// mounts) neither the completion source nor its keymap is installed.
		const completion: Extension[] =
			tooltipHost === null
				? []
				: [
						autocompletion({
							override: [this.wikilinkSource(hooks)],
							defaultKeymap: false,
							icons: false,
							optionClass: (completion) =>
								completion.type === 'wikilink-alias'
									? 'snowflake-method-completion-alias'
									: '',
						}),
						tooltips({ position: 'fixed', parent: tooltipHost }),
						preferredRow,
						// First among the keymaps: ArrowUp and ArrowDown must
						// move the popup's selection while it is open, not walk
						// out of the note. Every binding here declines while
						// the popup is closed, so the arrows keep their walk.
						keymap.of(completionKeymap),
					];
		// Reported on every move inside a link rather than once on entering:
		// a fresh report is what re-arms the preview after a click dismissed
		// it, after the modifier came down late, after a popover came and
		// went — and the preview plugin deduplicates repeats on its own. A
		// Control or Meta press re-reports from where the pointer last
		// stood, so holding still and pressing the modifier still asks.
		let lastPoint: { x: number; y: number } | null = null;
		const reportLink = (view: EditorView, event: MouseEvent): void => {
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pos === null) return;
			const line = view.state.doc.lineAt(pos);
			const span = wikilinkAt(line.text, pos - line.from);
			if (span === null) return;
			const targetEl = (event.target ??
				view.dom.ownerDocument.elementFromPoint(
					event.clientX,
					event.clientY,
				)) as HTMLElement | null;
			if (targetEl !== null) {
				hooks.onLinkHover?.(target.path, event, targetEl, span.linktext);
			}
		};
		const linkHover: Extension[] =
			target.readOnly || hooks.onLinkHover === undefined
				? []
				: [
						EditorView.domEventHandlers({
							mousemove: (event, view) => {
								lastPoint = { x: event.clientX, y: event.clientY };
								reportLink(view, event);
							},
							mouseleave: () => {
								lastPoint = null;
							},
							keydown: (event, view) => {
								if (event.key !== 'Control' && event.key !== 'Meta') {
									return;
								}
								if (lastPoint === null) return;
								// Never dispatched, so its target is null and the
								// element is looked up from the remembered point.
								reportLink(
									view,
									new MouseEvent('mousemove', {
										clientX: lastPoint.x,
										clientY: lastPoint.y,
										ctrlKey: event.ctrlKey,
										metaKey: event.metaKey,
									}),
								);
							},
						}),
					];
		const extensions: Extension[] = [
			history(),
			...pairing,
			...completion,
			...linkHover,
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
			// The formatting chords, and Mod+E handing the note back to prose.
			// Bound here rather than as commands with hotkeys because they only
			// mean anything inside this editor, and because no command of this
			// plugin ships a default binding.
			keymap.of([
				{ key: 'Mod-b', run: (view) => runEditorCommand(view, 'bold') },
				{ key: 'Mod-i', run: (view) => runEditorCommand(view, 'italic') },
				{
					key: 'Mod-e',
					run: () => {
						if (hooks.onToggleReading === undefined) return false;
						hooks.onToggleReading(target.path);
						return true;
					},
				},
				// Ahead of the default keymap's own backward delete; declines
				// on its own when the pairing engine is not installed.
				{ key: 'Backspace', run: deleteAutoPair },
			]),
			keymap.of([
				{ key: 'ArrowUp', run: climbsOut('start') },
				{ key: 'ArrowUp', run: stepsOverNoLine(false) },
				{ key: 'ArrowLeft', run: walksOut('start') },
				{ key: 'ArrowDown', run: climbsOut('end') },
				{ key: 'ArrowDown', run: stepsOverNoLine(true) },
				{ key: 'ArrowRight', run: walksOut('end') },
			]),
			...enter,
			keymap.of([...defaultKeymap, ...historyKeymap]),
			MARKDOWN_LANGUAGE,
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			EditorView.lineWrapping,
			caretParagraph,
			paragraphLines,
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
