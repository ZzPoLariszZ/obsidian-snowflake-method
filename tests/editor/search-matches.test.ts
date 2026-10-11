// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
	SEARCH_CURRENT_CLASS,
	SEARCH_MATCH_CLASS,
	searchMatchDecorations,
	searchMatches,
	setSearchMatches,
} from '../../src/editor';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(window);

/** Every mark the set holds, as the stretch it covers and the classes it wears. */
function marksOf(view: EditorView): { text: string; cls: string }[] {
	return Array.from(view.contentDOM.querySelectorAll<HTMLElement>(`.${SEARCH_MATCH_CLASS}`)).map(
		(el) => ({ text: el.textContent ?? '', cls: el.className }),
	);
}

function editor(doc: string): EditorView {
	return new EditorView({
		state: EditorState.create({ doc, extensions: [searchMatches] }),
		parent: document.body.createDiv(),
	});
}

describe('searchMatchDecorations', () => {
	it('marks each match and rings the current one, leaving out what no longer fits', () => {
		const set = searchMatchDecorations(
			{
				ranges: [
					{ from: 0, to: 3 },
					{ from: 4, to: 7 },
					{ from: 20, to: 30 },
				],
				current: 1,
			},
			10,
		);
		const seen: { from: number; to: number; cls: unknown }[] = [];
		set.between(0, 10, (from, to, value) => {
			seen.push({ from, to, cls: (value.spec as { class?: string }).class });
		});
		expect(seen).toEqual([
			{ from: 0, to: 3, cls: SEARCH_MATCH_CLASS },
			{ from: 4, to: 7, cls: `${SEARCH_MATCH_CLASS} ${SEARCH_CURRENT_CLASS}` },
		]);
	});
});

describe('searchMatches', () => {
	it('draws the matches it is handed, and takes them off with none', () => {
		const view = editor('ash and ash');
		view.dispatch({
			effects: setSearchMatches.of({
				ranges: [
					{ from: 0, to: 3 },
					{ from: 8, to: 11 },
				],
				current: 0,
			}),
		});
		expect(marksOf(view)).toEqual([
			{ text: 'ash', cls: `${SEARCH_MATCH_CLASS} ${SEARCH_CURRENT_CLASS}` },
			{ text: 'ash', cls: SEARCH_MATCH_CLASS },
		]);
		view.dispatch({ effects: setSearchMatches.of({ ranges: [], current: null }) });
		expect(marksOf(view)).toEqual([]);
		view.destroy();
	});

	it('keeps a match on its words while typing moves them, until the next answer', () => {
		const view = editor('ash and ash');
		view.dispatch({
			effects: setSearchMatches.of({ ranges: [{ from: 8, to: 11 }], current: 0 }),
		});
		view.dispatch({ changes: { from: 0, insert: 'Grey ' } });
		expect(marksOf(view)).toEqual([
			{ text: 'ash', cls: `${SEARCH_MATCH_CLASS} ${SEARCH_CURRENT_CLASS}` },
		]);
		view.destroy();
	});
});
