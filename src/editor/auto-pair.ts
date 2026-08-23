import {
	EditorSelection,
	EditorState,
	Facet,
	MapMode,
	StateEffect,
	StateField,
	type Extension,
} from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';

/**
 * Auto-pairing for the manuscript editor, in one engine.
 *
 * Stock closeBrackets could not do this job: its closing-character table is
 * ASCII, so a full-width （ would pair as a same-character quote, and its
 * overtype would turn `*|*` plus `*` into `**|` where doubling to `**|**` is
 * what writing bold needs. So brackets, quotes, full-width CJK pairs and the
 * Markdown emphasis markers all run through the planners below — pure
 * functions over a small scan of the text around the caret, so every rule is
 * testable headless — with one state field tracking which closing characters
 * this engine placed. Only those are ever skipped over or deleted in pairs;
 * a closer the author typed is never swallowed.
 */
export interface AutoPairOptions {
	/** Brackets and quotes, half and full width. */
	brackets: boolean;
	/** The Markdown emphasis markers `*` `_` `~` `=`. */
	markdown: boolean;
}

/** One closing character this engine placed, kept while it stays itself. */
export interface TrackedCloser {
	pos: number;
	close: string;
	/**
	 * True when a formatting command placed this closer rather than the author
	 * typing its opener. The two behave alike under Backspace and under a typed
	 * closer, and differ in one place only: a space at the centre of a pair the
	 * author typed is them starting a list item, while a space at the centre of
	 * a pair a command placed is them writing inside the emphasis they just
	 * asked for, which must survive.
	 */
	command?: boolean;
}

const ASCII_BRACKETS: Readonly<Record<string, string>> = {
	'(': ')',
	'[': ']',
	'{': '}',
};

const ASCII_QUOTES = new Set(["'", '"', '`']);

/**
 * The full-width pairs of CJK writing, smart quotes included. Every one is
 * asymmetric, which is exactly what the stock engine could not represent.
 */
const CJK_PAIRS: Readonly<Record<string, string>> = {
	'（': '）',
	'［': '］',
	'｛': '｝',
	'「': '」',
	'『': '』',
	'《': '》',
	'〈': '〉',
	'【': '】',
	'〔': '〕',
	'“': '”',
	'‘': '’',
};

const MARKERS = new Set(['*', '_', '~', '=']);

/**
 * Only ASCII words block pairing. CJK prose has no spaces, so a guard that
 * treated every letter as blocking would refuse to pair exactly where Asian
 * writing wants it; CJK characters therefore block nothing on either side.
 */
const BLOCKING = /[A-Za-z0-9]/u;

function blocked(char: string | undefined): boolean {
	return char !== undefined && BLOCKING.test(char);
}

function bracketCloseOf(char: string): string | null {
	const cjk = CJK_PAIRS[char];
	if (cjk !== undefined) return cjk;
	const ascii = ASCII_BRACKETS[char];
	if (ascii !== undefined) return ascii;
	return ASCII_QUOTES.has(char) ? char : null;
}

function tailRun(text: string, char: string): number {
	let count = 0;
	while (count < text.length && text[text.length - 1 - count] === char) count += 1;
	return count;
}

function headRun(text: string, char: string): number {
	let count = 0;
	while (count < text.length && text[count] === char) count += 1;
	return count;
}

/** What the planners see: the caret's close surroundings, nothing more. */
export interface PairScan {
	typed: string;
	/** Up to eight characters ending at the caret or replaced range. */
	before: string;
	/** Up to eight characters starting after it. */
	after: string;
	/** True when nothing stands selected. */
	empty: boolean;
	/** Contiguous tracked closers from the caret onward. */
	trackedAfter: number;
	/** The same run, counting only closers the author's own typing placed. */
	typedAfter: number;
	/** Whether the character just before the caret is a tracked closer. */
	prevTracked: boolean;
	options: AutoPairOptions;
}

export type PairPlan =
	| { kind: 'pass' }
	| { kind: 'wrap'; open: string; close: string }
	| { kind: 'pair'; open: string; close: string }
	| { kind: 'complete-double'; marker: string }
	| { kind: 'double'; marker: string }
	| { kind: 'skip' };

const PASS: PairPlan = { kind: 'pass' };

/**
 * What one typed character should become. The order of the cases is the
 * contract: wrapping owns selections, doubling owns the centre of a pair,
 * skipping owns a tracked closer, and only then may a fresh pair open.
 */
export function planPairInput(scan: PairScan): PairPlan {
	const char = scan.typed;
	if (char.length !== 1) return PASS;
	const bracketClose = scan.options.brackets ? bracketCloseOf(char) : null;
	const marker = scan.options.markdown && MARKERS.has(char);

	if (!scan.empty) {
		if (bracketClose !== null) {
			return { kind: 'wrap', open: char, close: bracketClose };
		}
		if (marker) {
			// Strikethrough and highlight only mean anything doubled, so one
			// press wraps with the whole `~~`; emphasis wraps single, and a
			// second press on the kept selection makes it bold.
			const mark = char === '~' || char === '=' ? char + char : char;
			return { kind: 'wrap', open: mark, close: mark };
		}
		return PASS;
	}

	const prev = scan.before.length > 0 ? scan.before[scan.before.length - 1] : undefined;
	const next = scan.after.length > 0 ? scan.after[0] : undefined;

	if (marker && (char === '*' || char === '_')) {
		// Centred in a pair this engine made, another press grows both sides:
		// `*|*` to `**|**` to `***|***`, which is the whole bold ladder. Past
		// three the run means nothing, so the press falls through to a skip.
		const runBefore = tailRun(scan.before, char);
		const runAfter = headRun(scan.after, char);
		if (
			runBefore >= 1 &&
			runBefore <= 2 &&
			runBefore === runAfter &&
			scan.trackedAfter >= runAfter
		) {
			return { kind: 'double', marker: char };
		}
	}

	// Typing the very character this engine already placed steps over it,
	// whatever class it belongs to. An author-typed closer is not tracked and
	// lands here as ordinary text.
	if (next === char && scan.trackedAfter >= 1) return { kind: 'skip' };

	if (bracketClose !== null) {
		if (CJK_PAIRS[char] !== undefined) {
			return { kind: 'pair', open: char, close: bracketClose };
		}
		if (ASCII_QUOTES.has(char)) {
			// Neither side may be a word: the apostrophe in "don't" stays one.
			return blocked(prev) || blocked(next)
				? PASS
				: { kind: 'pair', open: char, close: bracketClose };
		}
		return blocked(next) ? PASS : { kind: 'pair', open: char, close: bracketClose };
	}

	if (marker) {
		if (char === '*' || char === '_') {
			// A word boundary on both sides, and not against its own kind:
			// `snake_case`, a `*` typed before an existing word, and the
			// manual close of `**text*` all stay plain.
			if (blocked(prev) || prev === char || blocked(next) || next === char) {
				return PASS;
			}
			return { kind: 'pair', open: char, close: char };
		}
		// `~` and `=` never pair on the first keystroke — `~5 miles` and
		// `x = 1` stay prose. The second consecutive one at a word boundary
		// completes the double: `~~|~~`. Closing a hand-typed `~~text~~`
		// never triggers it, because the run's boundary is the word itself.
		if (prev === char && !scan.prevTracked && next !== char) {
			const runBefore = tailRun(scan.before, char);
			const boundary =
				scan.before.length > runBefore
					? scan.before[scan.before.length - 1 - runBefore]
					: undefined;
			if (runBefore === 1 && !blocked(boundary)) {
				return { kind: 'complete-double', marker: char };
			}
		}
		return PASS;
	}

	return PASS;
}

/**
 * Whitespace typed at the centre of an empty marker pair cancels it: `*|*`
 * plus a space is a list item being started, not emphasis, and CommonMark
 * would not honour a space-leading delimiter anyway.
 *
 * Only for a pair the author typed. A pair a formatting command placed is one
 * they asked for by name, and the first thing they type inside it may perfectly
 * well be a space -- taking the closers away there would delete the emphasis
 * they had just switched on and leave the opening marks stranded in the line.
 */
export function planPairWhitespace(scan: PairScan): { dropClosers: number } | null {
	if (!scan.options.markdown || !scan.empty) return null;
	const prev = scan.before.length > 0 ? scan.before[scan.before.length - 1] : undefined;
	if (prev === undefined || !MARKERS.has(prev)) return null;
	const runBefore = tailRun(scan.before, prev);
	const runAfter = headRun(scan.after, prev);
	if (runBefore >= 1 && runBefore === runAfter && scan.typedAfter >= runAfter) {
		return { dropClosers: runAfter };
	}
	return null;
}

/**
 * The multi-character closers a formatting command can hand this engine,
 * each with the opener whose removal pairs with it. Only the underline tag
 * today: every typed pair is single characters a side.
 */
const PAIRED_TAGS: Readonly<Record<string, string>> = {
	'</u>': '<u>',
};

/**
 * Backspace at the centre of a pair this engine made takes one character
 * from each side — a whole bracket pair in one press, a marker pair one
 * layer at a time, `**|**` to `*|*` to nothing. A tracked multi-character
 * closer sitting right after the caret, the underline tag, goes whole with
 * its opener in one press, the way one command placed them.
 */
export function planPairBackspace(
	before: string,
	after: string,
	trackedAfter: number,
	options: AutoPairOptions,
	trackedCloseAt: string | null = null,
): { remove: { before: number; after: number } } | null {
	if (trackedCloseAt !== null && trackedCloseAt.length > 1) {
		const open = PAIRED_TAGS[trackedCloseAt];
		if (
			open !== undefined &&
			before.endsWith(open) &&
			after.startsWith(trackedCloseAt)
		) {
			return { remove: { before: open.length, after: trackedCloseAt.length } };
		}
	}
	if (trackedAfter < 1) return null;
	const prev = before.length > 0 ? before[before.length - 1] : undefined;
	const next = after.length > 0 ? after[0] : undefined;
	if (prev === undefined || next === undefined) return null;
	if (options.markdown && MARKERS.has(prev) && next === prev) {
		return { remove: { before: 1, after: 1 } };
	}
	if (options.brackets && bracketCloseOf(prev) === next) {
		return { remove: { before: 1, after: 1 } };
	}
	return null;
}

const pairConfig = Facet.define<AutoPairOptions, AutoPairOptions>({
	combine: (values) => values[0] ?? { brackets: false, markdown: false },
});

/**
 * Exported for the tests, which drive the field through plain state updates;
 * the input handler is this effect's only other author.
 */
export const addTracked = StateEffect.define<readonly TrackedCloser[]>({
	map: (value, mapping) =>
		value.map((entry) => ({ ...entry, pos: mapping.mapPos(entry.pos, 1) })),
});

/**
 * The closers this engine placed, carried along as the document changes and
 * dropped the moment the character at a position is no longer the closer it
 * was — an edit that overwrote it also spent its pairing.
 */
const trackedField = StateField.define<readonly TrackedCloser[]>({
	create: () => [],
	update(value, tr) {
		let next = value;
		if (tr.docChanged) {
			const moved: TrackedCloser[] = [];
			for (const entry of next) {
				const pos = tr.changes.mapPos(entry.pos, 1, MapMode.TrackDel);
				if (pos !== null) moved.push({ pos, close: entry.close });
			}
			next = moved;
		}
		next = next.filter(
			(entry) =>
				tr.newDoc.sliceString(entry.pos, entry.pos + entry.close.length) ===
				entry.close,
		);
		for (const effect of tr.effects) {
			if (effect.is(addTracked)) next = [...next, ...effect.value];
		}
		return next;
	},
});

/** The tracked closers of a state; empty when the engine is not installed. */
export function trackedClosers(state: EditorState): readonly TrackedCloser[] {
	return state.field(trackedField, false) ?? [];
}

function contiguousTrackedFrom(
	tracked: readonly TrackedCloser[],
	pos: number,
	typedOnly = false,
): number {
	// Multi-character closers answer only Backspace: a typed `<` must never
	// step into the middle of a tracked underline tag.
	const positions = new Set(
		tracked
			.filter((entry) => entry.close.length === 1)
			.filter((entry) => !typedOnly || entry.command !== true)
			.map((entry) => entry.pos),
	);
	let count = 0;
	while (positions.has(pos + count)) count += 1;
	return count;
}

function scanAt(
	state: EditorState,
	from: number,
	to: number,
	typed: string,
	options: AutoPairOptions,
): PairScan {
	const tracked = state.field(trackedField, false) ?? [];
	return {
		typed,
		before: state.sliceDoc(Math.max(0, from - 8), from),
		after: state.sliceDoc(to, Math.min(state.doc.length, to + 8)),
		empty: from === to,
		trackedAfter: contiguousTrackedFrom(tracked, to),
		typedAfter: contiguousTrackedFrom(tracked, to, true),
		prevTracked: tracked.some((entry) => entry.pos === from - 1),
		options,
	};
}

/**
 * A multi-character closer as the engine tracks it: one entry per character,
 * so Backspace takes the pair apart a layer at a time and a typed closer steps
 * over exactly one of them.
 *
 * Exported for the formatting commands, which place their own pairs and hand
 * them here to be tracked. This convention is the engine's, and a second copy
 * of it in the toolbar's code would come apart the first time the engine
 * changed its mind about what a tracked run looks like.
 */
export function trackedRunAt(
	pos: number,
	close: string,
	options: { command?: boolean } = {},
): TrackedCloser[] {
	const entries: TrackedCloser[] = [];
	for (const [at, char] of [...close].entries()) {
		entries.push({ pos: pos + at, close: char, ...options });
	}
	return entries;
}

const inputHandler = EditorView.inputHandler.of((view, from, to, text) => {
	// Composed text is the IME's own; full-width punctuation from Chinese
	// IMEs commits directly and arrives here, which is all the pairing CJK
	// writing needs.
	if (view.composing) return false;
	if (text.length !== 1) return false;
	const options = view.state.facet(pairConfig);
	if (text === ' ' || text === '\t') {
		const cancel = planPairWhitespace(scanAt(view.state, from, to, text, options));
		if (cancel === null) return false;
		view.dispatch({
			changes: { from, to: to + cancel.dropClosers, insert: text },
			selection: EditorSelection.cursor(from + text.length),
			userEvent: 'input.type',
			scrollIntoView: true,
		});
		return true;
	}
	const plan = planPairInput(scanAt(view.state, from, to, text, options));
	switch (plan.kind) {
		case 'pass':
			return false;
		case 'wrap':
			view.dispatch({
				changes: [
					{ from, insert: plan.open },
					{ from: to, insert: plan.close },
				],
				selection: EditorSelection.range(
					from + plan.open.length,
					to + plan.open.length,
				),
				effects: addTracked.of(trackedRunAt(to + plan.open.length, plan.close)),
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			return true;
		case 'pair':
			view.dispatch({
				changes: { from, to, insert: plan.open + plan.close },
				selection: EditorSelection.cursor(from + plan.open.length),
				effects: addTracked.of(
					trackedRunAt(from + plan.open.length, plan.close),
				),
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			return true;
		case 'double':
			view.dispatch({
				changes: { from, to, insert: plan.marker + plan.marker },
				selection: EditorSelection.cursor(from + 1),
				effects: addTracked.of([{ pos: from + 1, close: plan.marker }]),
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			return true;
		case 'complete-double':
			view.dispatch({
				changes: { from, to, insert: plan.marker.repeat(3) },
				selection: EditorSelection.cursor(from + 1),
				effects: addTracked.of([
					{ pos: from + 1, close: plan.marker },
					{ pos: from + 2, close: plan.marker },
				]),
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			return true;
		case 'skip':
			view.dispatch({
				selection: EditorSelection.cursor(to + 1),
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			return true;
	}
});

/**
 * Backspace between the halves of a pair this engine made deletes both.
 * Safe to bind whether or not the engine is installed: without the field it
 * declines, and the default backward delete takes the press.
 */
export const deleteAutoPair: Command = (view) => {
	const tracked = view.state.field(trackedField, false);
	if (tracked === undefined) return false;
	const range = view.state.selection.main;
	if (!range.empty) return false;
	const pos = range.head;
	const tagged = tracked.find(
		(entry) => entry.pos === pos && entry.close.length > 1,
	);
	const plan = planPairBackspace(
		view.state.sliceDoc(Math.max(0, pos - 8), pos),
		view.state.sliceDoc(pos, Math.min(view.state.doc.length, pos + 8)),
		contiguousTrackedFrom(tracked, pos),
		view.state.facet(pairConfig),
		tagged?.close ?? null,
	);
	if (plan === null) return false;
	view.dispatch({
		changes: [
			{ from: pos - plan.remove.before, to: pos },
			{ from: pos, to: pos + plan.remove.after },
		],
		selection: EditorSelection.cursor(pos - plan.remove.before),
		userEvent: 'delete.backward',
		scrollIntoView: true,
	});
	return true;
};

/** The whole engine: configuration, tracking, and the input handler. */
export function autoPair(options: AutoPairOptions): Extension {
	return [pairConfig.of(options), trackedField, inputHandler];
}
