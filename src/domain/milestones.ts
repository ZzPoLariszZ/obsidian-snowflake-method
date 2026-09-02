/**
 * Word milestones: where the writing count reaches each multiple of an
 * interval, said as a place in the body -- the very character the count's
 * Nth unit begins on -- so the page can draw the number beside the row that
 * holds it.
 *
 * Nothing here counts on its own. The text is the count's countable text
 * (`countablePieces`, each piece saying where in the body it stands), and the
 * units are the count's units (`writingUnitStarts`, from the scan that makes
 * the status bar's number), so a milestone can never disagree with the total
 * the reader is shown. What this adds is only the carrying of a place in the
 * text back to a place in the body.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { countablePieces, type CountableProseOptions } from './countable-prose';
import type { CountableRange } from './markdown-scan';
import type { MentionMark } from './mentions';
import { writingUnitStarts, type WritingCountOptions } from './text-length';

export const MILESTONE_MODES = ['manuscript', 'chapter'] as const;

/**
 * What the count accumulates over: the whole manuscript in reading order, so
 * a chapter's milestones carry the chapters before it, or each chapter on
 * its own, starting again from nothing at every note.
 */
export type MilestoneMode = (typeof MILESTONE_MODES)[number];

export function isMilestoneMode(value: unknown): value is MilestoneMode {
	return value === 'manuscript' || value === 'chapter';
}

/**
 * The largest interval worth storing. A million units is past any book;
 * beyond it a number is a slip of the hand, not a setting.
 */
export const MILESTONE_INTERVAL_MAX = 1_000_000;

/** A whole number of units, at least one and within reason. */
export function isMilestoneInterval(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= MILESTONE_INTERVAL_MAX
	);
}

/** The convention the milestones count by: the status bar's own options. */
export type MilestoneCountOptions = WritingCountOptions & CountableProseOptions;

/** One milestone: the count it marks, standing on the character at `at`. */
export interface MilestonePosition {
	/** Body offset of the character the count's Nth unit begins on. */
	at: number;
	/** The end of that character, two units past `at` for one past the BMP. */
	to: number;
	/** The count reached there: a multiple of the interval. */
	count: number;
}

export interface MilestonePlan {
	positions: MilestonePosition[];
	/** The body's whole writing under the convention: the count's total. */
	total: number;
}

/**
 * Every multiple of `interval` the count passes inside this body, given the
 * `before` units the manuscript holds ahead of it. A milestone stands on the
 * character where the unit that reaches the count begins; a character the
 * convention reads twice can reach two counts at once, and stands for the
 * first alone.
 */
export function milestonePositions(
	body: string,
	excluded: readonly CountableRange[],
	options: MilestoneCountOptions,
	interval: number,
	before = 0,
): MilestonePlan {
	const pieces = countablePieces(body, excluded, options);
	const text = pieces.map((piece) => piece.text).join('');
	const starts = writingUnitStarts(text, options);
	const total = starts.length;
	if (!Number.isInteger(interval) || interval < 1 || total === 0) {
		return { positions: [], total };
	}
	// Where each piece begins in the countable text, for carrying an index in
	// that text back to the body offset the piece came from.
	const textStarts: number[] = [];
	let length = 0;
	for (const piece of pieces) {
		textStarts.push(length);
		length += piece.text.length;
	}
	const bodyOffsetOf = (index: number): number | null => {
		let low = 0;
		let high = pieces.length - 1;
		let found = 0;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			if ((textStarts[mid] ?? 0) <= index) {
				found = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		const piece = pieces[found];
		if (piece === undefined || piece.from === null) return null;
		return piece.from + (index - (textStarts[found] ?? 0));
	};

	const positions: MilestonePosition[] = [];
	let lastAt = -1;
	// The first multiple past what the manuscript already holds.
	for (
		let count = Math.floor(before / interval) * interval + interval;
		count <= before + total;
		count += interval
	) {
		const start = starts[count - before - 1];
		if (start === undefined) break;
		const at = bodyOffsetOf(start);
		if (at === null || at === lastAt) continue;
		const wide = (body.codePointAt(at) ?? 0) > 0xffff;
		positions.push({ at, to: at + (wide ? 2 : 1), count });
		lastAt = at;
	}
	return { positions, total };
}

/**
 * The milestones as marks on the page: one character each, silent -- they
 * answer no menu -- and carrying the label the page draws beside the row.
 */
export function planMilestoneMarks(
	path: string,
	body: string,
	plan: MilestonePlan,
	label: (count: number) => string,
): MentionMark[] {
	return plan.positions.map(({ at, to, count }) => ({
		from: at,
		to,
		classes: 'snowflake-method-milestone',
		silent: true,
		label: label(count),
		occurrence: {
			type: 'milestone',
			path,
			from: at,
			to,
			matchedText: body.slice(at, to),
			count,
		},
	}));
}
