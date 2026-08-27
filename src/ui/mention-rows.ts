/**
 * The tracking pane's pure half: how its rows are chosen and ordered, kept
 * apart from the view so the ordering is pinned without a workspace.
 */

import type { EntityMentionAggregate, MentionAggregate } from '../services';

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
