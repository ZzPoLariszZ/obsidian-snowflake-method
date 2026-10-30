/**
 * Entity-mention marks in the segment editor: metrics-neutral
 * `Decoration.mark` ranges carrying their occurrence, so the stream can
 * dress mentions and answer a right-click without ever changing how a line
 * measures. (`climbsOut` decides rows by coordinates; a mark that padded or
 * resized text would bend it.)
 *
 * Two tiers keep typing free of analysis. Every document change maps the
 * standing decorations through itself -- synchronous, exact and cheap -- and
 * arms a trailing timer; only when the typing pauses does the timer dispatch
 * the refresh effect, and the plugin rebuilds from the configured planner.
 * While an IME composition is open the timer re-arms instead: mapping never
 * replaces decorations around the composition range, and replacing them is
 * what aborts a composition mid-word.
 */

import {
	Facet,
	StateEffect,
	type EditorState,
	type Extension,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';

import type { MentionMark } from '../domain';

/**
 * Obsidian puts its element builders on every window it opens, which is how a
 * popout builds elements of its own; the published Window type does not say
 * so, and this is the one thing here that needs them. The builder on a node
 * would append to that node, and the document's own `createElement` is not
 * this plugin's idiom, so the window's builder it is.
 */
interface BuilderWindow extends Window {
	createSpan(options: { cls: string }): HTMLSpanElement;
}

/**
 * A mark with nothing under it: a revision's insertion point, which is a
 * position rather than a stretch of text. An empty inline span standing in the
 * position, so the bar its class draws is at the place itself rather than on
 * the edge of some character beside it -- and so a point in a run of spaces, at
 * the end of a line, on a blank line, or in an empty note is shown exactly
 * where it is. Empty and inline: it adds no width, no break opportunity and no
 * height, and the line measures as it did without it.
 */
class PointMarkWidget extends WidgetType {
	constructor(private readonly classes: string) {
		super();
	}

	eq(other: PointMarkWidget): boolean {
		return other.classes === this.classes;
	}

	toDOM(view: EditorView): HTMLElement {
		// Built by the editor's OWN window, so a stream in a popout gets an
		// element that window can hold, and built loose, for CodeMirror to
		// place.
		return (view.dom.win as BuilderWindow).createSpan({ cls: this.classes });
	}
}

export interface MentionHighlightConfig {
	/**
	 * The marks one body wears right now: mode chosen, ignores applied,
	 * synchronous. Empty while the roster is still warming, or when the
	 * mode is off. The editor is handed along for a planner that serves
	 * more than one, as a note's does, which asks it which note it shows.
	 */
	marks(body: string, view: EditorView): readonly MentionMark[];
	/**
	 * Whether an editor wears marks at all, asked before its text is read: a
	 * planner serving every editor in the vault, as a note's does, passes over
	 * the ones it never marks without copying their text or re-planning them
	 * at every pause. Left out, every editor does.
	 */
	reaches?(view: EditorView): boolean;
}

/** How long typing may pause before the marks are re-planned. */
const MENTION_ANALYSIS_DELAY_MS = 200;

const mentionConfig = Facet.define<
	MentionHighlightConfig,
	MentionHighlightConfig | null
>({
	combine: (values) => values[0] ?? null,
});

const refreshMentions = StateEffect.define<null>();

/** Asks the editor to re-plan its mention marks from the current body. */
export function refreshMentionHighlights(view: EditorView): void {
	view.dispatch({ effects: refreshMentions.of(null) });
}

/**
 * Marks as a decoration set, each carrying its mark in the spec so a hit
 * test can hand back the occurrence. Exported for the headless tests that
 * pin the round-trip and the mapping this plugin leans on.
 *
 * A mark of no width is a position rather than a stretch, and becomes a widget
 * standing in it. It carries no `mentionMark`, and neither does a mark that
 * says it is silent: nothing under either answers a right-click, and a mark
 * left in the hit test with nothing to offer would win it -- a zero-length
 * span by being the shortest thing at its offset, a revision by being
 * narrower than the mention it stands inside as often as not -- and hide the
 * mention underneath. Decided here, once, as the marks are built, rather than
 * in the hit test by what kind of mark it turned out to be.
 */
export function mentionDecorations(
	marks: readonly MentionMark[],
): DecorationSet {
	return Decoration.set(
		marks.map((mark) => {
			if (mark.to <= mark.from) {
				return Decoration.widget({
					widget: new PointMarkWidget(mark.classes),
				}).range(mark.from);
			}
			// The name on hover is the app's own tooltip, which the Hide tooltips
			// setting reaches, where a native title is the browser's.
			const attributes = {
				...(mark.title === undefined ? {} : { 'aria-label': mark.title }),
				...(mark.styleVar === undefined ? {} : { style: mark.styleVar }),
				...(mark.label === undefined
					? {}
					: { 'data-snowflake-method-label': mark.label }),
			};
			return Decoration.mark({
				class: mark.classes,
				...(mark.silent === true ? {} : { mentionMark: mark }),
				...(Object.keys(attributes).length === 0 ? {} : { attributes }),
			}).range(mark.from, mark.to);
		}),
		true,
	);
}

function planDecorations(view: EditorView, state: EditorState): DecorationSet {
	const config = state.facet(mentionConfig);
	if (config === null || config.reaches?.(view) === false) return Decoration.none;
	return mentionDecorations(config.marks(state.doc.toString(), view));
}

const mentionPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		private timer: number | null = null;

		constructor(private readonly view: EditorView) {
			this.decorations = planDecorations(view, view.state);
		}

		update(update: ViewUpdate): void {
			const refreshed = update.transactions.some((transaction) =>
				transaction.effects.some((effect) => effect.is(refreshMentions)),
			);
			if (refreshed) {
				this.decorations = planDecorations(update.view, update.state);
				return;
			}
			if (!update.docChanged) return;
			this.decorations = this.decorations.map(update.changes);
			// An editor the planner never marks needs no re-plan after typing;
			// the refresh effect asks again once it is reached.
			if (update.state.facet(mentionConfig)?.reaches?.(update.view) === false) return;
			this.arm();
		}

		destroy(): void {
			this.disarm();
		}

		private arm(): void {
			this.disarm();
			const win = this.view.dom.ownerDocument.defaultView;
			if (win === null) return;
			this.timer = win.setTimeout(() => {
				this.timer = null;
				// Replacing marks around an open composition aborts it; the
				// mapped set is exact enough until the composition closes.
				if (this.view.composing) {
					this.arm();
					return;
				}
				refreshMentionHighlights(this.view);
			}, MENTION_ANALYSIS_DELAY_MS);
		}

		private disarm(): void {
			if (this.timer === null) return;
			const win = this.view.dom.ownerDocument.defaultView;
			win?.clearTimeout(this.timer);
			this.timer = null;
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export function mentionHighlights(config: MentionHighlightConfig): Extension {
	return [mentionConfig.of(config), mentionPlugin];
}

/**
 * The mention under a point, re-anchored to where its decoration stands
 * now: between refreshes the set is mapped rather than re-planned, so the
 * decoration's own offsets are the current ones and the occurrence is
 * brought along to them. Whoever acts on it re-verifies the text first.
 */
export function mentionMarkAt(
	view: EditorView,
	x: number,
	y: number,
): MentionMark | null {
	const at = view.posAtCoords({ x, y });
	return at === null ? null : mentionMarkAtPos(view, at);
}

/**
 * The mention whose marked stretch holds a position, re-anchored the same
 * way: the caret's own place, for a menu opened with no pointer to answer.
 */
export function mentionMarkAtPos(view: EditorView, at: number): MentionMark | null {
	const plugin = view.plugin(mentionPlugin);
	if (plugin === null) return null;
	// Marks may nest -- a mention inside a quoted stretch -- and the pointer
	// means the innermost thing under it, so the shortest span answers. The
	// dress-only layers were built without a `mentionMark` and are not here
	// to be found: `mentionDecorations` says why.
	let found: MentionMark | null = null;
	let foundLength = Number.POSITIVE_INFINITY;
	plugin.decorations.between(at, at, (from, to, value) => {
		const mark = (value.spec as { mentionMark?: MentionMark }).mentionMark;
		if (mark === undefined) return;
		if (to - from >= foundLength) return;
		foundLength = to - from;
		found = {
			...mark,
			from,
			to,
			occurrence: { ...mark.occurrence, from, to },
		};
	});
	return found;
}
