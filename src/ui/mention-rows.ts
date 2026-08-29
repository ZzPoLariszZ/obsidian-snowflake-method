/**
 * The tracking pane's pure half: how its rows are chosen and ordered, kept
 * apart from the view so the ordering is pinned without a workspace.
 */

import type {
	EntityMentionAggregate,
	MentionAggregate,
	SensitiveTermAggregate,
} from '../services';

/** The name a note is filed under, which is how chapters are shown here. */
export const mentionNoteTitle = (path: string): string =>
	path.replace(/\.md$/u, '').split('/').pop() ?? path;

/**
 * The entity rows as the pane shows them: mentioned entities only, the most
 * mentioned first, narrowed by the search.
 */
export function mentionEntityRows(
	aggregate: MentionAggregate | null,
	filter: string,
): EntityMentionAggregate[] {
	if (aggregate === null) return [];
	const folded = filter.trim().toLowerCase();
	return aggregate.entities
		.filter(
			(entity) =>
				folded === '' || entity.memberName.toLowerCase().includes(folded),
		)
		.sort(
			(left, right) =>
				right.total - left.total ||
				left.memberName.localeCompare(right.memberName),
		);
}

/**
 * The sensitive terms as the pane shows them: most found first, the quiet
 * ones still listed -- a term that never appears is an answer too.
 */
export function sensitiveTermRows(
	aggregates: readonly SensitiveTermAggregate[] | null,
): SensitiveTermAggregate[] {
	if (aggregates === null) return [];
	return [...aggregates].sort(
		(left, right) =>
			right.total - left.total || left.term.localeCompare(right.term),
	);
}

/**
 * A long quoted stretch cut in the middle: the opening and the close are
 * what identify a speech, so both survive the cut.
 */
export function truncateMiddle(text: string, max: number): string {
	const flat = text.replace(/\s+/gu, ' ');
	if (flat.length <= max) return flat;
	const half = Math.max(1, Math.floor((max - 1) / 2));
	return `${flat.slice(0, half)}…${flat.slice(flat.length - half)}`;
}

/**
 * A long text cut at the end instead: for rows clamped to a single line,
 * where only the head can ever show and a middle ellipsis would promise a
 * close that the clamp hides anyway.
 */
export function truncateEnd(text: string, max: number): string {
	const flat = text.replace(/\s+/gu, ' ');
	if (flat.length <= max) return flat;
	return `${flat.slice(0, Math.max(1, max - 1))}…`;
}
