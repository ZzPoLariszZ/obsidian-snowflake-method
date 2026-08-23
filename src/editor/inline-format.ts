import {
	EditorSelection,
	EditorState,
	type ChangeSpec,
	type SelectionRange,
	type TransactionSpec,
} from '@codemirror/state';

/**
 * Inline Markdown formatting as pure decisions over an editor state.
 *
 * The manuscript stream's editor is a bare CodeMirror instance, so nothing of
 * Obsidian's own formatting commands reaches it. These functions carry the
 * whole of what a toggle means — wrap a selection, unwrap one already wrapped,
 * open an empty pair at the caret, close one opened and left empty — and
 * return a plain transaction spec for the caller to dispatch as the author's
 * own edit. Kept free of the view so every rule here is testable headless.
 */
export type InlineMarker =
	| 'bold'
	| 'italic'
	| 'strikethrough'
	| 'highlight'
	| 'underline';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The pair each marker writes. Underline is the one asymmetric pair: Markdown
 * has no underline of its own, and Obsidian renders the HTML tag. Exported so
 * the dispatching side can tell the pairing engine what a command has placed.
 */
export const INLINE_PAIRS: Record<InlineMarker, { open: string; close: string }> = {
	bold: { open: '**', close: '**' },
	italic: { open: '*', close: '*' },
	strikethrough: { open: '~~', close: '~~' },
	highlight: { open: '==', close: '==' },
	underline: { open: '<u>', close: '</u>' },
};

/** How many `*` stand in a row ending just before `pos`. */
function starsBefore(state: EditorState, pos: number): number {
	let count = 0;
	while (pos - count > 0 && state.sliceDoc(pos - count - 1, pos - count) === '*') {
		count += 1;
	}
	return count;
}

/** How many `*` stand in a row starting at `pos`. */
function starsAfter(state: EditorState, pos: number): number {
	let count = 0;
	const end = state.doc.length;
	while (pos + count < end && state.sliceDoc(pos + count, pos + count + 1) === '*') {
		count += 1;
	}
	return count;
}

/**
 * How a marker pair is recognised around or inside a range.
 *
 * The two families differ only here. A literal pair -- strikethrough,
 * highlight, underline -- can be looked for verbatim. Bold and italic share
 * one delimiter and cannot: `***` is both at once, so what decides is the run
 * of stars on each side.
 */
interface PairShape {
	open: string;
	close: string;
	/** The pair stands immediately outside the range. */
	outside: (from: number, to: number) => boolean;
	/** The pair stands immediately inside the range. */
	inside: (from: number, to: number) => boolean;
}

/**
 * Bold and italic share one delimiter, so a toggle cannot look for its own
 * pair verbatim -- `***` is bold and italic at once. What decides is the run
 * of stars on each side: italic holds when both runs are odd, bold when both
 * hold two or more. Toggling removes or adds its own width, which walks the
 * whole ladder correctly: `**|**` + italic gives `***|***`, bold on that
 * gives `*|*`, italic on that gives nothing at all.
 */
function starShape(state: EditorState, width: 1 | 2): PairShape {
	const mark = '*'.repeat(width);
	const active = (before: number, after: number): boolean =>
		width === 1 ? before % 2 === 1 && after % 2 === 1 : before >= 2 && after >= 2;
	return {
		open: mark,
		close: mark,
		outside: (from, to) => active(starsBefore(state, from), starsAfter(state, to)),
		inside: (from, to) => {
			const before = starsAfter(state, from);
			const after = starsBefore(state, to);
			return before + after <= to - from && active(before, after);
		},
	};
}

/**
 * The literal pairs -- strikethrough, highlight, underline -- where the marker
 * text itself can be looked for on each side of the range.
 */
function literalShape(state: EditorState, open: string, close: string): PairShape {
	return {
		open,
		close,
		outside: (from, to) =>
			state.sliceDoc(from - open.length, from) === open &&
			state.sliceDoc(to, to + close.length) === close,
		inside: (from, to) => {
			const selected = state.sliceDoc(from, to);
			return (
				selected.length >= open.length + close.length &&
				selected.startsWith(open) &&
				selected.endsWith(close)
			);
		},
	};
}

/**
 * One toggle, whatever the pair is made of.
 *
 * The same five answers in the same order for every marker: an empty caret
 * already wrapped comes unwrapped, an empty caret bare gets the pair with the
 * caret between; a range wrapped outside is stripped outside, one wrapped
 * inside is stripped inside, and anything else is wrapped. Only the
 * recognising differs, which is what `PairShape` carries -- written twice, the
 * selection arithmetic below had to be got right twice and could be got wrong
 * in only one.
 */
function toggleAround(
	range: SelectionRange,
	shape: PairShape,
): { changes: ChangeSpec[]; range: SelectionRange } {
	const openWidth = shape.open.length;
	const closeWidth = shape.close.length;
	if (range.empty) {
		const pos = range.head;
		if (shape.outside(pos, pos)) {
			return {
				changes: [
					{ from: pos - openWidth, to: pos },
					{ from: pos, to: pos + closeWidth },
				],
				range: EditorSelection.cursor(pos - openWidth),
			};
		}
		return {
			changes: [{ from: pos, insert: shape.open + shape.close }],
			range: EditorSelection.cursor(pos + openWidth),
		};
	}
	const { from, to } = range;
	if (shape.outside(from, to)) {
		return {
			changes: [
				{ from: from - openWidth, to: from },
				{ from: to, to: to + closeWidth },
			],
			range: EditorSelection.range(from - openWidth, to - openWidth),
		};
	}
	if (shape.inside(from, to)) {
		return {
			changes: [
				{ from, to: from + openWidth },
				{ from: to - closeWidth, to },
			],
			range: EditorSelection.range(from, to - openWidth - closeWidth),
		};
	}
	return {
		changes: [
			{ from, insert: shape.open },
			{ from: to, insert: shape.close },
		],
		// The close lands after the inner text, so only the open shifts it.
		range: EditorSelection.range(from + openWidth, to + openWidth),
	};
}

/**
 * One formatting toggle over every selection range, or null when the state is
 * read-only. The spec is the change alone: the caller owns the dispatch and
 * says whose edit it was.
 */
export function toggleInline(
	state: EditorState,
	marker: InlineMarker,
): TransactionSpec | null {
	if (state.readOnly) return null;
	const shape =
		marker === 'bold' || marker === 'italic'
			? starShape(state, marker === 'bold' ? 2 : 1)
			: literalShape(state, INLINE_PAIRS[marker].open, INLINE_PAIRS[marker].close);
	return state.changeByRange((range) => toggleAround(range, shape));
}

const HEADING_PREFIX = /^(#{1,6})[ \t]+/u;

/**
 * Sets or clears a heading level on every line the selection touches.
 *
 * Blank lines are passed over so a selection across paragraphs marks the
 * prose and not the gaps — unless the selection touches nothing else: a
 * caret resting on an empty line is an author starting a heading, and gets
 * the prefix to type after. When every touched line already carries exactly
 * the asked-for level the toggle takes it away; otherwise every line is set
 * to it, whatever it carried before. Null when nothing would change hands.
 */
export function toggleHeading(
	state: EditorState,
	level: HeadingLevel,
): TransactionSpec | null {
	if (state.readOnly) return null;
	const lines = new Map<number, { from: number; text: string }>();
	const gather = (blank: boolean): void => {
		for (const range of state.selection.ranges) {
			const first = state.doc.lineAt(range.from).number;
			const last = state.doc.lineAt(range.to).number;
			for (let number = first; number <= last; number += 1) {
				const line = state.doc.line(number);
				if (!blank && line.text.trim().length === 0) continue;
				lines.set(number, { from: line.from, text: line.text });
			}
		}
	};
	gather(false);
	if (lines.size === 0) gather(true);
	const parsed = [...lines.values()].map((line) => {
		const match = HEADING_PREFIX.exec(line.text);
		return {
			from: line.from,
			prefixLength: match === null ? 0 : match[0].length,
			level: match === null ? 0 : match[1]?.length ?? 0,
		};
	});
	const clearing = parsed.every((line) => line.level === level);
	const prefix = clearing ? '' : '#'.repeat(level) + ' ';
	const specs: ChangeSpec[] = parsed.map((line) => ({
		from: line.from,
		to: line.from + line.prefixLength,
		insert: prefix,
	}));
	const changes = state.changes(specs);
	if (changes.empty) return null;
	// Mapped past the insertions, so a caret resting at a line start — the
	// empty line an author is starting a heading on — lands after the new
	// prefix, ready to type the heading itself.
	return { changes, selection: state.selection.map(changes, 1) };
}
