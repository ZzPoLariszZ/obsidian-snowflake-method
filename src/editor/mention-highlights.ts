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

import { Facet, StateEffect, type Extension } from '@codemirror/state';
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
 * so, and this is the one thing here that needs them.
 */
interface BuilderWindow extends Window {
	createFragment(): DocumentFragment;
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
		// Built in the editor's OWN window, so a stream in a popout gets an
		// element that window can hold, and through a fragment because that is
		// where Obsidian's builder can put one and still hand it back loose for
		// CodeMirror to place.
		const win = view.dom.win as BuilderWindow;
		return win.createFragment().createSpan({ cls: this.classes });
	}
}

export interface MentionHighlightConfig {
	/**
	 * The marks one body wears right now: mode chosen, ignores applied,
	 * synchronous. Empty while the roster is still warming, or when the
	 * mode is off.
	 */
	marks(body: string): readonly MentionMark[];
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
 * standing in it. It carries no `mentionMark`: nothing is under it to be
 * right-clicked, and a zero-length span would otherwise win every hit test at
 * its own offset by being the shortest thing there.
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
			const attributes = {
				...(mark.title === undefined ? {} : { title: mark.title }),
				...(mark.styleVar === undefined ? {} : { style: mark.styleVar }),
			};
			return Decoration.mark({
				class: mark.classes,
				mentionMark: mark,
				...(Object.keys(attributes).length === 0 ? {} : { attributes }),
			}).range(mark.from, mark.to);
		}),
		true,
	);
}

function planDecorations(
	config: MentionHighlightConfig | null,
	body: string,
): DecorationSet {
	return mentionDecorations(config?.marks(body) ?? []);
}

const mentionPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		private timer: number | null = null;

		constructor(private readonly view: EditorView) {
			this.decorations = planDecorations(
				view.state.facet(mentionConfig),
				view.state.doc.toString(),
			);
		}

		update(update: ViewUpdate): void {
			const refreshed = update.transactions.some((transaction) =>
				transaction.effects.some((effect) => effect.is(refreshMentions)),
			);
			if (refreshed) {
				this.decorations = planDecorations(
					update.state.facet(mentionConfig),
					update.state.doc.toString(),
				);
				return;
			}
			if (!update.docChanged) return;
			this.decorations = this.decorations.map(update.changes);
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
	const plugin = view.plugin(mentionPlugin);
	if (plugin === null) return null;
	const at = view.posAtCoords({ x, y });
	if (at === null) return null;
	// Marks may nest -- a mention inside a quoted stretch -- and the pointer
	// means the innermost thing under it, so the shortest span answers.
	let found: MentionMark | null = null;
	let foundLength = Number.POSITIVE_INFINITY;
	plugin.decorations.between(at, at, (from, to, value) => {
		const mark = (value.spec as { mentionMark?: MentionMark }).mentionMark;
		if (mark === undefined || to - from >= foundLength) return;
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
