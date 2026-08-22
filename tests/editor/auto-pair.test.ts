import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
	addTracked,
	autoPair,
	planPairBackspace,
	planPairInput,
	planPairWhitespace,
	trackedClosers,
	type AutoPairOptions,
	type PairScan,
} from '../../src/editor/auto-pair';

const ALL: AutoPairOptions = { brackets: true, markdown: true };

function scan(
	typed: string,
	before: string,
	after: string,
	extra?: Partial<PairScan>,
): PairScan {
	return {
		typed,
		before,
		after,
		empty: true,
		trackedAfter: 0,
		prevTracked: false,
		options: ALL,
		...extra,
	};
}

describe('planPairInput for brackets and quotes', () => {
	it('pairs ASCII brackets before anything but a word', () => {
		expect(planPairInput(scan('(', 'text ', ''))).toEqual({
			kind: 'pair',
			open: '(',
			close: ')',
		});
		expect(planPairInput(scan('[', '', ']'))).toEqual({
			kind: 'pair',
			open: '[',
			close: ']',
		});
		expect(planPairInput(scan('{', '', ' after'))).toEqual({
			kind: 'pair',
			open: '{',
			close: '}',
		});
		expect(planPairInput(scan('(', '', 'word'))).toEqual({ kind: 'pass' });
	});

	it('keeps apostrophes single inside words', () => {
		expect(planPairInput(scan("'", 'don', 't'))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan("'", 'say ', ''))).toEqual({
			kind: 'pair',
			open: "'",
			close: "'",
		});
		expect(planPairInput(scan('"', '中文', ''))).toEqual({
			kind: 'pair',
			open: '"',
			close: '"',
		});
	});

	it('pairs full-width CJK marks unconditionally, mid-sentence included', () => {
		expect(planPairInput(scan('「', '今天', '很好'))).toEqual({
			kind: 'pair',
			open: '「',
			close: '」',
		});
		expect(planPairInput(scan('（', '说明', '文字'))).toEqual({
			kind: 'pair',
			open: '（',
			close: '）',
		});
		expect(planPairInput(scan('“', '他说', '然后'))).toEqual({
			kind: 'pair',
			open: '“',
			close: '”',
		});
		expect(planPairInput(scan('【', '', ''))).toEqual({
			kind: 'pair',
			open: '【',
			close: '】',
		});
	});

	it('steps over a tracked closer and only a tracked one', () => {
		expect(planPairInput(scan(')', 'call(', ')', { trackedAfter: 1 }))).toEqual({
			kind: 'skip',
		});
		expect(planPairInput(scan(')', 'call(', ')'))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('」', '说「话', '」', { trackedAfter: 1 }))).toEqual({
			kind: 'skip',
		});
		expect(planPairInput(scan('”', '说“话', '”', { trackedAfter: 1 }))).toEqual({
			kind: 'skip',
		});
	});

	it('does nothing when the brackets option is off', () => {
		const options = { brackets: false, markdown: true };
		expect(planPairInput(scan('(', '', '', { options }))).toEqual({
			kind: 'pass',
		});
		expect(planPairInput(scan('「', '', '', { options }))).toEqual({
			kind: 'pass',
		});
	});
});

describe('planPairInput for Markdown markers', () => {
	it('pairs emphasis only at a word boundary on both sides', () => {
		expect(planPairInput(scan('*', ' ', ''))).toEqual({
			kind: 'pair',
			open: '*',
			close: '*',
		});
		expect(planPairInput(scan('*', '中文', '继续'))).toEqual({
			kind: 'pair',
			open: '*',
			close: '*',
		});
		expect(planPairInput(scan('*', 'word', ''))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('*', '', 'bold'))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('_', 'snake', 'case'))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('*', '**text*', ''))).toEqual({ kind: 'pass' });
	});

	it('doubles from the centre of its own pair, up the bold ladder', () => {
		expect(planPairInput(scan('*', '*', '*', { trackedAfter: 1 }))).toEqual({
			kind: 'double',
			marker: '*',
		});
		expect(planPairInput(scan('*', '**', '**', { trackedAfter: 2 }))).toEqual({
			kind: 'double',
			marker: '*',
		});
		expect(planPairInput(scan('*', '***', '***', { trackedAfter: 3 }))).toEqual({
			kind: 'skip',
		});
		expect(planPairInput(scan('*', '*', '*'))).toEqual({ kind: 'pass' });
	});

	it('completes ~~ and == on the second keystroke at a boundary', () => {
		expect(planPairInput(scan('~', ' ~', ''))).toEqual({
			kind: 'complete-double',
			marker: '~',
		});
		expect(planPairInput(scan('=', '文=', ''))).toEqual({
			kind: 'complete-double',
			marker: '=',
		});
		expect(planPairInput(scan('~', '', ''))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('~', '~5 miles~', ''))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('~', 'text~', ''))).toEqual({ kind: 'pass' });
		expect(planPairInput(scan('~', ' ~~', ''))).toEqual({ kind: 'pass' });
		expect(
			planPairInput(scan('~', ' ~', '', { prevTracked: true })),
		).toEqual({ kind: 'pass' });
		// At a line start too: the writing count reads no tilde fences.
		expect(planPairInput(scan('~', 'para\n~', ''))).toEqual({
			kind: 'complete-double',
			marker: '~',
		});
	});

	it('skips a tracked marker closer after prose', () => {
		expect(
			planPairInput(scan('*', '**bold', '**', { trackedAfter: 2 })),
		).toEqual({ kind: 'skip' });
	});

	it('does nothing when the markdown option is off', () => {
		const options = { brackets: true, markdown: false };
		expect(planPairInput(scan('*', ' ', '', { options }))).toEqual({
			kind: 'pass',
		});
		expect(planPairInput(scan('~', ' ~', '', { options }))).toEqual({
			kind: 'pass',
		});
	});
});

describe('planPairInput over a selection', () => {
	it('wraps with the typed pair', () => {
		expect(planPairInput(scan('(', '', '', { empty: false }))).toEqual({
			kind: 'wrap',
			open: '(',
			close: ')',
		});
		expect(planPairInput(scan('「', '', '', { empty: false }))).toEqual({
			kind: 'wrap',
			open: '「',
			close: '」',
		});
		expect(planPairInput(scan('*', '', '', { empty: false }))).toEqual({
			kind: 'wrap',
			open: '*',
			close: '*',
		});
	});

	it('wraps strikethrough and highlight with the whole double', () => {
		expect(planPairInput(scan('~', '', '', { empty: false }))).toEqual({
			kind: 'wrap',
			open: '~~',
			close: '~~',
		});
		expect(planPairInput(scan('=', '', '', { empty: false }))).toEqual({
			kind: 'wrap',
			open: '==',
			close: '==',
		});
	});
});

describe('planPairWhitespace', () => {
	it('cancels an empty marker pair, rescuing list items', () => {
		expect(planPairWhitespace(scan(' ', '*', '*', { trackedAfter: 1 }))).toEqual({
			dropClosers: 1,
		});
		expect(
			planPairWhitespace(scan(' ', '~~', '~~', { trackedAfter: 2 })),
		).toEqual({ dropClosers: 2 });
	});

	it('leaves brackets and untracked markers alone', () => {
		expect(planPairWhitespace(scan(' ', '(', ')', { trackedAfter: 1 }))).toBeNull();
		expect(planPairWhitespace(scan(' ', '*', '*'))).toBeNull();
		expect(planPairWhitespace(scan(' ', '*x', '*', { trackedAfter: 1 }))).toBeNull();
	});
});

describe('planPairBackspace', () => {
	it('deletes both halves of a tracked pair, one layer per press', () => {
		expect(planPairBackspace('*', '*', 1, ALL)).toEqual({
			remove: { before: 1, after: 1 },
		});
		expect(planPairBackspace('**', '**', 2, ALL)).toEqual({
			remove: { before: 1, after: 1 },
		});
		expect(planPairBackspace('call(', ')', 1, ALL)).toEqual({
			remove: { before: 1, after: 1 },
		});
		expect(planPairBackspace('说「', '」', 1, ALL)).toEqual({
			remove: { before: 1, after: 1 },
		});
	});

	it('never deletes what it did not place', () => {
		expect(planPairBackspace('(', ')', 0, ALL)).toBeNull();
		expect(planPairBackspace('x', 'y', 1, ALL)).toBeNull();
		expect(planPairBackspace('(', ')', 1, { brackets: false, markdown: true })).toBeNull();
		expect(planPairBackspace('*', '*', 1, { brackets: true, markdown: false })).toBeNull();
	});

	it('deletes a command-made underline pair whole', () => {
		expect(planPairBackspace('<u>', '</u>', 0, ALL, '</u>')).toEqual({
			remove: { before: 3, after: 4 },
		});
		expect(planPairBackspace('<u>', '</u>', 0, ALL)).toBeNull();
		expect(planPairBackspace('x', '</u>', 0, ALL, '</u>')).toBeNull();
	});
});

describe('the tracked-closer field', () => {
	function withTracked(doc: string, positions: number[]): EditorState {
		const base = EditorState.create({ doc, extensions: autoPair(ALL) });
		return base.update({
			effects: addTracked.of(
				positions.map((pos) => ({ pos, close: doc[pos] ?? '' })),
			),
		}).state;
	}

	it('carries closers through edits and drops deleted ones', () => {
		let state = withTracked('()', [1]);
		expect(trackedClosers(state).map((entry) => entry.pos)).toEqual([1]);
		state = state.update({ changes: { from: 1, insert: 'x' } }).state;
		expect(trackedClosers(state).map((entry) => entry.pos)).toEqual([2]);
		state = state.update({ changes: { from: 2, to: 3 } }).state;
		expect(trackedClosers(state)).toEqual([]);
	});

	it('drops an entry whose character was overwritten', () => {
		let state = withTracked('()', [1]);
		state = state.update({ changes: { from: 1, to: 2, insert: 'y' } }).state;
		expect(trackedClosers(state)).toEqual([]);
	});

	it('keeps a multi-character closer while its text stands', () => {
		const base = EditorState.create({ doc: '<u></u>', extensions: autoPair(ALL) });
		let state = base.update({
			effects: addTracked.of([{ pos: 3, close: '</u>' }]),
		}).state;
		expect(trackedClosers(state)).toEqual([{ pos: 3, close: '</u>' }]);
		state = state.update({ changes: { from: 0, insert: 'x' } }).state;
		expect(trackedClosers(state)).toEqual([{ pos: 4, close: '</u>' }]);
		state = state.update({ changes: { from: 5, to: 6 } }).state;
		expect(trackedClosers(state)).toEqual([]);
	});
});
