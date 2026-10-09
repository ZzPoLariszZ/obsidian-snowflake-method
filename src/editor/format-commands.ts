import { redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

import { addTracked, trackedRunAt, type TrackedCloser } from './auto-pair';
import {
	INLINE_PAIRS,
	toggleHeading,
	toggleInline,
	type HeadingLevel,
	type InlineMarker,
} from './inline-format';

/**
 * The editing commands a formatting bar offers and the keyboard's chords
 * name: undo and redo, the inline marks and the heading levels, one name
 * each, whichever way they were asked for. Run the same way on the stream's
 * own editor and on an editor of Obsidian's showing a note the typography
 * dresses, so the bar above either does exactly the same thing.
 */
export type EditorCommandId =
	| 'undo'
	| 'redo'
	| InlineMarker
	| `heading-${HeadingLevel}`;

/**
 * Runs one editing command as the author's own edit.
 *
 * Everything but undo and redo dispatches a plain user transaction, which is
 * what keeps the pending text, the save timer, the word count and the writing
 * session all fed: the update listener treats it exactly like typing.
 */
export function runEditorCommand(
	view: EditorView,
	command: EditorCommandId,
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
			entries.push({ pos: range.to, close, command: true });
		} else {
			entries.push(...trackedRunAt(range.to, close, { command: true }));
		}
	}
	if (entries.length > 0) view.dispatch({ effects: addTracked.of(entries) });
}
