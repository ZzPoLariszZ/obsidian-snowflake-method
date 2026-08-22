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
 * Bold and italic share one delimiter, so a toggle cannot look for its own
 * pair verbatim — `***` is bold and italic at once. What decides is the run
 * of stars on each side: italic holds when both runs are odd, bold when both
 * hold two or more. Toggling removes or adds its own width, which walks the
 * whole ladder correctly: `**|**` + italic gives `***|***`, bold on that
 * gives `*|*`, italic on that gives nothing at all.
 */
function starToggle(
	state: EditorState,
	range: SelectionRange,
	width: 1 | 2,
): { changes: ChangeSpec[]; range: SelectionRange } {
	const active = (before: number, after: number): boolean =>
		width === 1 ? before % 2 === 1 && after % 2 === 1 : before >= 2 && after >= 2;
	const mark = '*'.repeat(width);
	if (range.empty) {
		const pos = range.head;
		if (active(starsBefore(state, pos), starsAfter(state, pos))) {
			return {
				changes: [
					{ from: pos - width, to: pos },
					{ from: pos, to: pos + width },
				],
				range: EditorSelection.cursor(pos - width),
			};
		}
		return {
			changes: [{ from: pos, insert: mark + mark }],
			range: EditorSelection.cursor(pos + width),
		};
	}
	const { from, to } = range;
	if (active(starsBefore(state, from), starsAfter(state, to))) {
		return {
			changes: [
				{ from: from - width, to: from },
				{ from: to, to: to + width },
			],
			range: EditorSelection.range(from - width, to - width),
		};
	}
	const innerBefore = starsAfter(state, from);
	const innerAfter = starsBefore(state, to);
	if (innerBefore + innerAfter <= to - from && active(innerBefore, innerAfter)) {
		return {
			changes: [
				{ from, to: from + width },
				{ from: to - width, to },
			],
			range: EditorSelection.range(from, to - 2 * width),
		};
	}
	return {
		changes: [
			{ from, insert: mark },
			{ from: to, insert: mark },
		],
		range: EditorSelection.range(from + width, to + width),
	};
}

/**
 * The literal pairs — strikethrough, highlight, underline — where the marker
 * text itself can be looked for on each side of the range.
 */
function pairToggle(
	state: EditorState,
	range: SelectionRange,
	open: string,
	close: string,
): { changes: ChangeSpec[]; range: SelectionRange } {
	if (range.empty) {
		const pos = range.head;
		if (
			state.sliceDoc(pos - open.length, pos) === open &&
			state.sliceDoc(pos, pos + close.length) === close
		) {
			return {
				changes: [
					{ from: pos - open.length, to: pos },
					{ from: pos, to: pos + close.length },
				],
				range: EditorSelection.cursor(pos - open.length),
			};
		}
		return {
			changes: [{ from: pos, insert: open + close }],
			range: EditorSelection.cursor(pos + open.length),
		};
	}
	const { from, to } = range;
	if (
		state.sliceDoc(from - open.length, from) === open &&
		state.sliceDoc(to, to + close.length) === close
	) {
		return {
			changes: [
				{ from: from - open.length, to: from },
				{ from: to, to: to + close.length },
			],
			range: EditorSelection.range(from - open.length, to - open.length),
		};
	}
	const selected = state.sliceDoc(from, to);
	if (
		selected.length >= open.length + close.length &&
		selected.startsWith(open) &&
		selected.endsWith(close)
	) {
		return {
			changes: [
				{ from, to: from + open.length },
				{ from: to - close.length, to },
			],
			range: EditorSelection.range(from, to - open.length - close.length),
		};
	}
	return {
		changes: [
			{ from, insert: open },
			{ from: to, insert: close },
		],
		// The close lands after the inner text, so only the open shifts it.
		range: EditorSelection.range(from + open.length, to + open.length),
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
	if (marker === 'bold' || marker === 'italic') {
		const width = marker === 'bold' ? 2 : 1;
		return state.changeByRange((range) => starToggle(state, range, width));
	}
	const { open, close } = INLINE_PAIRS[marker];
	return state.changeByRange((range) => pairToggle(state, range, open, close));
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
