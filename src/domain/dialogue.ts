/**
 * Dialogue: the quoted stretches of a note, read from quote pairs alone. No
 * speaker, no semantics -- a range from an opening mark to its close, and a
 * split of the writing into what stands inside quotes and what stands
 * outside.
 *
 * The scan is paragraph-bounded. Quotes pair up within one markdown
 * paragraph and never across a blank line, so an unmatched opening mark
 * damages at most its own paragraph: it closes where the paragraph does,
 * which is also how English carries one speech across paragraphs -- each
 * paragraph re-opens, only the last closes. Nested quotations collapse into
 * the outermost range, a closing mark with nothing open is prose, straight
 * quotes toggle, and the apostrophe is not a quote style here at all.
 * Multiline dialogue inside one paragraph -- soft-wrapped lines -- flows
 * through unbroken.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { analyzableParagraphs, analyzableRanges } from './analyzable-prose';
import type { CountableRange } from './markdown-scan';
import { scriptSplit, type ScriptSplit } from './text-length';
import type { DialogueOccurrence, MentionMark } from './mentions';

export interface DialogueStyle {
	open: string;
	close: string;
}

/** The four styles the settings offer, spelled as two-character tokens. */
export const DIALOGUE_STYLE_TOKENS = {
	curly: '“”',
	straight: '""',
	corner: '「」',
	white: '『』',
} as const;

/** A two-character token read as a style; open === close means a toggle. */
export function parseQuotePair(token: string): DialogueStyle | null {
	if (token.length !== 2) return null;
	return { open: token.charAt(0), close: token.charAt(1) };
}

/** One quoted stretch, quote marks included, in body offsets. */
export interface DialogueRange {
	from: number;
	to: number;
}

/**
 * Every quoted stretch in the body, in document order. Quote marks inside
 * code, comments, and everything else the analyzable projection drops are
 * not marks at all.
 */
export function dialogueRanges(
	body: string,
	styles: readonly DialogueStyle[],
	excludeRanges: readonly CountableRange[] = [],
): DialogueRange[] {
	if (styles.length === 0) return [];
	const opens = new Map(styles.map((style) => [style.open, style]));
	const ranges: DialogueRange[] = [];
	for (const paragraph of analyzableParagraphs(body, excludeRanges)) {
		const stack: DialogueStyle[] = [];
		let start = 0;
		for (const { ch, at } of paragraph) {
			const top = stack[stack.length - 1];
			// A toggle style closes itself; otherwise a close that answers the
			// open on top of the stack closes that. Everything else that looks
			// like an opening mark opens, and a stray close is prose.
			if (top !== undefined && ch === top.close) {
				stack.pop();
				if (stack.length === 0) ranges.push({ from: start, to: at + 1 });
				continue;
			}
			const style = opens.get(ch);
			if (style !== undefined) {
				if (stack.length === 0) start = at;
				stack.push(style);
			}
			// Anything else -- a stray close included -- is prose, deliberately.
		}
		if (stack.length > 0) {
			const last = paragraph[paragraph.length - 1];
			if (last !== undefined) ranges.push({ from: start, to: last.at + 1 });
		}
	}
	return ranges.sort((left, right) => left.from - right.from);
}

/**
 * The writing split at the quotes: what stands inside dialogue ranges and
 * what stands outside, both in the script split reading time uses. Counted
 * over the analyzable stretches alone, piece by piece, the marks themselves
 * counting to neither side.
 */
export function dialogueSplit(
	body: string,
	ranges: readonly DialogueRange[],
	excludeRanges: readonly CountableRange[] = [],
): { dialogue: ScriptSplit; narrative: ScriptSplit } {
	const dialogue = { cjk: 0, words: 0 };
	const narrative = { cjk: 0, words: 0 };
	const add = (into: ScriptSplit, text: string): void => {
		if (text.length === 0) return;
		const split = scriptSplit(text);
		into.cjk += split.cjk;
		into.words += split.words;
	};
	for (const range of analyzableRanges(body, excludeRanges)) {
		let at = range.from;
		for (const quoted of ranges) {
			if (quoted.to <= range.from || quoted.from >= range.to) continue;
			const from = Math.max(quoted.from, range.from);
			const to = Math.min(quoted.to, range.to);
			if (from > at) add(narrative, body.slice(at, from));
			add(dialogue, body.slice(from, to));
			at = to;
		}
		if (at < range.to) add(narrative, body.slice(at, range.to));
	}
	return { dialogue, narrative };
}

/** Ranges read back as occurrences, the quoted text sliced fresh. */
export function dialogueOccurrencesOf(
	path: string,
	body: string,
	ranges: readonly DialogueRange[],
): DialogueOccurrence[] {
	return ranges.map((range) => ({
		type: 'dialogue',
		path,
		from: range.from,
		to: range.to,
		matchedText: body.slice(range.from, range.to),
	}));
}

export const DIALOGUE_PRESENTATIONS = ['off', 'highlight', 'focus'] as const;

/**
 * How the stream shows the dialogue it found: not at all, tinted where it
 * stands, or kept at full ink while everything else steps back.
 */
export type DialoguePresentation = (typeof DIALOGUE_PRESENTATIONS)[number];

export function isDialoguePresentation(
	value: unknown,
): value is DialoguePresentation {
	return value === 'off' || value === 'highlight' || value === 'focus';
}

/**
 * The dialogue dress: one mark per range, one class, no per-range states.
 * Which of the two looks the class takes is the container's choice, so the
 * marks themselves are the same under highlight and under focus.
 */
export function planDialogueMarks(
	path: string,
	body: string,
	ranges: readonly DialogueRange[],
): MentionMark[] {
	return dialogueOccurrencesOf(path, body, ranges).map((occurrence) => ({
		from: occurrence.from,
		to: occurrence.to,
		classes: 'snowflake-method-dialogue',
		occurrence,
	}));
}
