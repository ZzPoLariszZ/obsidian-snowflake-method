/**
 * Sentence counting, without language judgment. A run of terminators is one
 * boundary, the quotation mark after a full stop belongs to the sentence it
 * closes, and a paragraph that trails off without a terminator is still a
 * sentence.
 *
 * The full stop gets one refinement and no more: `.` does not terminate
 * when a letter or digit follows it directly, which keeps 3.14, U.S.A. and
 * file.txt whole. The abbreviation before a space -- "Mr. Smith" -- does
 * split; telling it from a sentence end takes a dictionary this counting
 * deliberately does not carry.
 *
 * Average length is not computed here: it is the script split over the
 * count, and both halves are already measured elsewhere.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import {
	analyzableParagraphs,
	type AnalyzableChar,
} from './analyzable-prose';
import type { CountableRange } from './markdown-scan';

const TERMINATOR = /[。．！？!?…⋯.]/u;
const CLOSER = /[”』」’")]/u;
const WORD = /[\p{L}\p{N}]/u;

/** Whether the character at `at` ends a sentence, the `.` rule applied. */
function terminates(paragraph: readonly AnalyzableChar[], at: number): boolean {
	const entry = paragraph[at];
	if (entry === undefined || !TERMINATOR.test(entry.ch)) return false;
	if (entry.ch !== '.') return true;
	const next = paragraph[at + 1]?.ch ?? '';
	return next === '' || !WORD.test(next);
}

/** How many sentences one note's prose holds. */
export function countSentences(
	body: string,
	excludeRanges: readonly CountableRange[] = [],
): number {
	let total = 0;
	for (const paragraph of analyzableParagraphs(body, excludeRanges)) {
		let content = false;
		let at = 0;
		while (at < paragraph.length) {
			if (terminates(paragraph, at)) {
				while (terminates(paragraph, at)) at += 1;
				while (
					at < paragraph.length &&
					CLOSER.test((paragraph[at] as AnalyzableChar).ch)
				) {
					at += 1;
				}
				if (content) total += 1;
				content = false;
				continue;
			}
			if (!/\s/u.test((paragraph[at] as AnalyzableChar).ch)) content = true;
			at += 1;
		}
		if (content) total += 1;
	}
	return total;
}
