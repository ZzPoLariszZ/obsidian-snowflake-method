/**
 * Revisions: proposed changes to manuscript text that live OUTSIDE the notes.
 *
 * A revision remembers where it was made -- body offsets, the text that stood
 * there, and a few characters of context to either side -- and everything
 * else about its standing is derived, never stored. Each reading of a note
 * re-anchors every revision against the body as it stands: text still at its
 * offsets is anchored, text found whole somewhere else has moved, and text
 * that cannot be found in one certain place is in conflict. No status field
 * exists to fall out of date, and an edit undone un-conflicts a revision by
 * itself, because nothing was written down about the trouble.
 */

import type { MentionMark, RevisionOccurrence } from './mentions';

export const REVISION_KINDS = ['replace', 'insert', 'delete'] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

/** How much body to keep on each side of a revision as its context. */
export const REVISION_CONTEXT_CHARS = 16;

export interface Revision {
	id: string;
	/** The note the revision stands in. */
	path: string;
	kind: RevisionKind;
	/** Body offsets as last persisted; `from === to` for an insertion. */
	from: number;
	to: number;
	/** The text the revision was made over; empty for an insertion. Immutable. */
	originalText: string;
	/** Up to REVISION_CONTEXT_CHARS of body on each side, for re-anchoring. */
	before: string;
	after: string;
	/** What should stand instead; empty for a deletion. */
	proposed: string;
	comment: string;
	createdAt: number;
}

/** One stored entry examined limb by limb, the store's lenient filter. */
export function isRevision(value: unknown): value is Revision {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	if (
		typeof entry.id !== 'string' ||
		entry.id.length === 0 ||
		typeof entry.path !== 'string' ||
		entry.path.length === 0 ||
		!(REVISION_KINDS as readonly unknown[]).includes(entry.kind) ||
		typeof entry.from !== 'number' ||
		typeof entry.to !== 'number' ||
		!Number.isInteger(entry.from) ||
		!Number.isInteger(entry.to) ||
		entry.from < 0 ||
		entry.to < entry.from ||
		typeof entry.originalText !== 'string' ||
		typeof entry.before !== 'string' ||
		typeof entry.after !== 'string' ||
		typeof entry.proposed !== 'string' ||
		typeof entry.comment !== 'string' ||
		typeof entry.createdAt !== 'number'
	) {
		return false;
	}
	// The kinds keep their shapes: an insertion is a point with nothing under
	// it, and a range kind covers exactly the text it remembers.
	if (entry.kind === 'insert') {
		return entry.from === entry.to && entry.originalText === '';
	}
	return (
		entry.to > entry.from && entry.originalText.length === entry.to - entry.from
	);
}

/**
 * A new revision captured off the body it was made in: the covered text and
 * its context are read here, so every caller stores the same truth.
 */
export function captureRevision(
	path: string,
	body: string,
	kind: RevisionKind,
	from: number,
	to: number,
	proposed: string,
	comment: string,
	id: string,
	createdAt: number,
): Revision {
	return {
		id,
		path,
		kind,
		from,
		to: kind === 'insert' ? from : to,
		originalText: kind === 'insert' ? '' : body.slice(from, to),
		before: body.slice(Math.max(0, from - REVISION_CONTEXT_CHARS), from),
		after: body.slice(
			kind === 'insert' ? from : to,
			(kind === 'insert' ? from : to) + REVISION_CONTEXT_CHARS,
		),
		proposed: kind === 'delete' ? '' : proposed,
		comment,
		createdAt,
	};
}

export type RevisionAnchor =
	| { state: 'anchored' | 'moved'; from: number; to: number }
	| { state: 'conflict' };

/** How many stored context characters agree with the body around a spot. */
function contextScore(
	body: string,
	at: number,
	end: number,
	before: string,
	after: string,
): number {
	let score = 0;
	for (
		let step = 1;
		step <= before.length &&
		body.charAt(at - step) === before.charAt(before.length - step);
		step += 1
	) {
		score += 1;
	}
	for (
		let step = 0;
		step < after.length && body.charAt(end + step) === after.charAt(step);
		step += 1
	) {
		score += 1;
	}
	return score;
}

/** Every index at which `text` stands in `body`, in order. */
function occurrencesOf(body: string, text: string): number[] {
	const spots: number[] = [];
	for (
		let at = body.indexOf(text);
		at !== -1;
		at = body.indexOf(text, at + 1)
	) {
		spots.push(at);
	}
	return spots;
}

/**
 * One passage found in one certain place, or nowhere: exact text first, and
 * where the text stands more than once, the surrounding context decides --
 * a clear winner is the spot, a tie is nobody's. Serves both re-anchoring
 * and the rendered half's selection, which knows its words and their
 * neighbours but not their offsets.
 */
export function resolvePassage(
	body: string,
	text: string,
	before: string,
	after: string,
): { from: number; to: number } | null {
	if (text.length === 0) return null;
	const spots = occurrencesOf(body, text);
	if (spots.length === 0) return null;
	if (spots.length === 1) {
		const at = spots[0] ?? 0;
		return { from: at, to: at + text.length };
	}
	let best = -1;
	let bestScore = -1;
	let tied = false;
	for (const at of spots) {
		const score = contextScore(body, at, at + text.length, before, after);
		if (score > bestScore) {
			best = at;
			bestScore = score;
			tied = false;
		} else if (score === bestScore) {
			tied = true;
		}
	}
	if (tied || best < 0) return null;
	return { from: best, to: best + text.length };
}

/**
 * Where one revision stands against the body as it is now. Text still at its
 * stored offsets is anchored; found whole in one other place, moved; found
 * nowhere, or in more places than the context can tell apart, conflict. An
 * insertion anchors by its junction -- the stored before and after meeting at
 * the point -- and anything typed at the point itself breaks the junction,
 * which is the honest answer: the spot the author meant is gone.
 */
export function anchorRevision(body: string, rev: Revision): RevisionAnchor {
	if (rev.kind === 'insert') {
		const junction = rev.before + rev.after;
		if (junction.length === 0) {
			// Captured in an empty note: the point exists only while the note
			// stays empty, because nothing marks it once there are words --
			// and this must be asked first, or the checks below pass on
			// nothing at all.
			return body.length === 0
				? { state: 'anchored', from: 0, to: 0 }
				: { state: 'conflict' };
		}
		const holds =
			body.slice(Math.max(0, rev.from - rev.before.length), rev.from) ===
				rev.before && body.slice(rev.from, rev.from + rev.after.length) === rev.after;
		if (holds) return { state: 'anchored', from: rev.from, to: rev.from };
		const spots = occurrencesOf(body, junction);
		if (spots.length !== 1) return { state: 'conflict' };
		const point = (spots[0] ?? 0) + rev.before.length;
		return { state: 'moved', from: point, to: point };
	}
	if (body.slice(rev.from, rev.to) === rev.originalText) {
		return { state: 'anchored', from: rev.from, to: rev.to };
	}
	const found = resolvePassage(body, rev.originalText, rev.before, rev.after);
	if (found === null) return { state: 'conflict' };
	return { state: 'moved', from: found.from, to: found.to };
}

/** The live revision another would overlap on this note, if any. */
export function overlapsLive(
	body: string,
	revisions: readonly Revision[],
	path: string,
	from: number,
	to: number,
): Revision | null {
	for (const rev of revisions) {
		if (rev.path !== path) continue;
		const anchor = anchorRevision(body, rev);
		if (anchor.state === 'conflict') continue;
		// A point sits inside a range when strictly between its ends; two
		// ranges overlap when neither ends before the other begins. A point
		// at a range's edge, or two ranges meeting end to start, coexist.
		if (anchor.from === anchor.to) {
			if (from < anchor.from && anchor.from < to) return rev;
			continue;
		}
		if (from === to) {
			if (anchor.from < from && from < anchor.to) return rev;
			continue;
		}
		if (from < anchor.to && anchor.from < to) return rev;
	}
	return null;
}

const WHITESPACE = /\s/;

/**
 * The single character an insertion marker rides: the first visible one at or
 * after the point, else the last one before it -- marked `after` so the bar
 * draws on its far side. The rendered wrap cannot hold a zero-length span,
 * and a whitespace character has no visible presence to carry a mark, so the
 * marker borrows a neighbour and draws its bar at the edge facing the point.
 */
function insertionCarrier(
	body: string,
	point: number,
): { from: number; to: number; side: 'before' | 'after' } | null {
	for (let at = point; at < body.length; at += 1) {
		if (!WHITESPACE.test(body.charAt(at))) {
			return { from: at, to: at + 1, side: 'before' };
		}
	}
	for (let at = point - 1; at >= 0; at -= 1) {
		if (!WHITESPACE.test(body.charAt(at))) {
			return { from: at, to: at + 1, side: 'after' };
		}
	}
	return null;
}

export interface RevisionPlan {
	/** Marks for the revisions that anchor, in document order. */
	plan: MentionMark[];
	/** Where each planned revision stands NOW, by id, for cards and accepts. */
	anchors: Map<string, { from: number; to: number }>;
	/** The revisions the body no longer answers for. */
	conflicts: Revision[];
}

/**
 * One note's revision dress: a mark per anchored revision -- struck and
 * tinted over a range, a bar beside a point -- and the conflicts set apart
 * for the cards to say so. A separate layer from the indexed mention marks,
 * like the dialogue dress and for the same reason: a revision overlaps
 * whatever stands inside it.
 */
export function planRevisionMarks(
	path: string,
	body: string,
	revisions: readonly Revision[],
): RevisionPlan {
	const plan: MentionMark[] = [];
	const anchors = new Map<string, { from: number; to: number }>();
	const conflicts: Revision[] = [];
	for (const rev of revisions) {
		if (rev.path !== path) continue;
		const anchor = anchorRevision(body, rev);
		if (anchor.state === 'conflict') {
			conflicts.push(rev);
			continue;
		}
		anchors.set(rev.id, { from: anchor.from, to: anchor.to });
		const occurrence: RevisionOccurrence = {
			type: 'revision',
			path,
			from: anchor.from,
			to: anchor.to,
			matchedText: body.slice(anchor.from, anchor.to),
			revisionId: rev.id,
		};
		if (rev.kind === 'insert') {
			const carrier = insertionCarrier(body, anchor.from);
			// A note of nothing but whitespace has no character to mark; the
			// card still stands, so nothing of the revision is lost.
			if (carrier === null) continue;
			plan.push({
				from: carrier.from,
				to: carrier.to,
				classes:
					carrier.side === 'after'
						? 'snowflake-method-revision is-insertion is-insertion-after'
						: 'snowflake-method-revision is-insertion',
				occurrence,
			});
			continue;
		}
		plan.push({
			from: anchor.from,
			to: anchor.to,
			classes:
				rev.kind === 'delete'
					? 'snowflake-method-revision is-delete'
					: 'snowflake-method-revision is-replace',
			occurrence,
		});
	}
	plan.sort((left, right) => left.from - right.from || left.to - right.to);
	return { plan, anchors, conflicts };
}

/**
 * The offsets and contexts brought level with a saved body: moved revisions
 * take their found offsets, anchored ones refresh the context around them,
 * and conflicts are left exactly as stored -- an undo may yet bring their
 * text back, and rewriting them would erase the place it will come back to.
 */
export function refreshAnchors(
	body: string,
	revisions: readonly Revision[],
): { next: Revision[]; changed: boolean } {
	let changed = false;
	const next = revisions.map((rev) => {
		const anchor = anchorRevision(body, rev);
		if (anchor.state === 'conflict') return rev;
		const before = body.slice(
			Math.max(0, anchor.from - REVISION_CONTEXT_CHARS),
			anchor.from,
		);
		const after = body.slice(anchor.to, anchor.to + REVISION_CONTEXT_CHARS);
		if (
			rev.from === anchor.from &&
			rev.to === anchor.to &&
			rev.before === before &&
			rev.after === after
		) {
			return rev;
		}
		changed = true;
		return { ...rev, from: anchor.from, to: anchor.to, before, after };
	});
	return { next, changed };
}
