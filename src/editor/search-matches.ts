/**
 * The stream's find bar in the note being written: every match tinted and
 * the current one ringed, as marks that change nothing about how a line
 * measures.
 *
 * The matches are found above the editor, across the whole manuscript, and
 * each editor is handed its own note's share. Between one answer and the next
 * they ride the typing, mapped through every change, so a match does not slide
 * off its words while the next search is on its way.
 *
 * Laid inside every other mark: CodeMirror nests a higher-precedence mark
 * within a lower one, and a match's tint drawn over a mention's colour is the
 * one the reader is looking for.
 */

import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export const SEARCH_MATCH_CLASS = 'snowflake-method-search-match';

/** Worn beside the match class by the one match the bar stands on. */
export const SEARCH_CURRENT_CLASS = 'is-current';

export interface SearchMatches {
	ranges: readonly { from: number; to: number }[];
	/** The index of the current match among `ranges`, or null for none here. */
	current: number | null;
}

/** Hands an editor its matches; an empty list takes them all off. */
export const setSearchMatches = StateEffect.define<SearchMatches>();

const MATCH = Decoration.mark({ class: SEARCH_MATCH_CLASS });
const CURRENT = Decoration.mark({
	class: `${SEARCH_MATCH_CLASS} ${SEARCH_CURRENT_CLASS}`,
});

/** The matches as marks, any that no longer fit the document left out. */
export function searchMatchDecorations(
	matches: SearchMatches,
	length: number,
): DecorationSet {
	const marks = [];
	for (const [index, range] of matches.ranges.entries()) {
		const from = Math.max(0, range.from);
		const to = Math.min(length, range.to);
		if (to <= from) continue;
		marks.push((index === matches.current ? CURRENT : MATCH).range(from, to));
	}
	return Decoration.set(marks, true);
}

const searchMatchField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(marks, transaction) {
		let next = marks.map(transaction.changes);
		for (const effect of transaction.effects) {
			if (effect.is(setSearchMatches)) {
				next = searchMatchDecorations(effect.value, transaction.newDoc.length);
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

export const searchMatches: Extension = Prec.high(searchMatchField);
