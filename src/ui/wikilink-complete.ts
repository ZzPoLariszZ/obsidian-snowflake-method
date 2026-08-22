import { fuzzyScore } from './fuzzy-match';
import type { WikilinkTarget } from './segment-editor-backend';

/**
 * The pure half of the wikilink popup: turning a project's members into
 * offerable entries, and ranking those entries against what the author has
 * typed. Nothing here touches the vault or the editor, so the whole
 * behaviour is pinned headless.
 */

/** The one shape all member families share, mapped by the caller. */
export interface WikilinkSourceRecord {
	/** Vault path, `.md` and all; the link builder strips what it must. */
	path: string;
	name: string;
	rank: number;
	aliases: readonly string[];
}

/** A project's members, grouped the way the rail groups them. */
export interface WikilinkProjectMembers {
	/** Every group id in rail order, `entityGroupsOf` output. */
	groups: readonly string[];
	characters: readonly WikilinkSourceRecord[];
	scenes: readonly WikilinkSourceRecord[];
	timeOf(kind: 'point' | 'period'): readonly WikilinkSourceRecord[];
	ofKind(kind: string): readonly WikilinkSourceRecord[];
}

/**
 * One entry per name and one per alias, aliases in declaration order, groups
 * in rail order. Read-only members are the caller's to include, and they
 * are: a link into a note this build cannot edit is still a link.
 */
export function collectWikilinkTargets(
	members: WikilinkProjectMembers,
	groupLabel: (group: string) => string,
	toLink: (path: string, alias: string) => string,
): WikilinkTarget[] {
	const targets: WikilinkTarget[] = [];
	for (const [groupRank, group] of members.groups.entries()) {
		const records =
			group === 'character'
				? members.characters
				: group === 'scene'
					? members.scenes
					: group === 'time-point'
						? members.timeOf('point')
						: group === 'time-period'
							? members.timeOf('period')
							: members.ofKind(group);
		const label = groupLabel(group);
		for (const record of records) {
			const shared = {
				group,
				groupLabel: label,
				groupRank,
				rank: record.rank,
				memberPath: record.path,
				memberName: record.name,
			};
			targets.push({
				...shared,
				label: record.name,
				entry: 'name',
				insert: toLink(record.path, record.name),
			});
			for (const alias of record.aliases) {
				const trimmed = alias.trim();
				if (trimmed.length === 0) continue;
				targets.push({
					...shared,
					label: trimmed,
					entry: 'alias',
					insert: toLink(record.path, trimmed),
				});
			}
		}
	}
	return targets;
}

export interface WikilinkOption {
	label: string;
	insert: string;
	/** True for alias entries, which render indented under their primary. */
	alias: boolean;
	section: { name: string; rank: number };
}

/**
 * Filter and rank. Every entry is matched against its own label alone, so a
 * query that fits only an alias surfaces just that alias row. The display
 * stays hierarchical: groups keep rail order, an entity's surviving entries
 * stay together with the primary first, and entities take their place from
 * their best-scoring entry, then snowflake rank, then name. An empty query
 * is the whole roster in group, rank, name-before-aliases order.
 */
export function wikilinkOptions(
	targets: readonly WikilinkTarget[],
	query: string,
): WikilinkOption[] {
	interface Scored {
		target: WikilinkTarget;
		score: number;
	}
	const buckets = new Map<string, Scored[]>();
	for (const target of targets) {
		const score = fuzzyScore(query, target.label);
		if (score === null) continue;
		const key = `${String(target.groupRank)}|${target.memberPath}`;
		const bucket = buckets.get(key);
		if (bucket === undefined) buckets.set(key, [{ target, score }]);
		else bucket.push({ target, score });
	}
	const ordered = [...buckets.values()].sort((left, right) => {
		const a = left[0];
		const b = right[0];
		if (a === undefined || b === undefined) return 0;
		if (a.target.groupRank !== b.target.groupRank) {
			return a.target.groupRank - b.target.groupRank;
		}
		const bestLeft = Math.max(...left.map((entry) => entry.score));
		const bestRight = Math.max(...right.map((entry) => entry.score));
		if (bestLeft !== bestRight) return bestRight - bestLeft;
		if (a.target.rank !== b.target.rank) return a.target.rank - b.target.rank;
		if (a.target.memberName < b.target.memberName) return -1;
		return a.target.memberName > b.target.memberName ? 1 : 0;
	});
	const options: WikilinkOption[] = [];
	for (const bucket of ordered) {
		// Collection order already reads name first, aliases as declared.
		for (const { target } of bucket) {
			options.push({
				label: target.label,
				insert: target.insert,
				alias: target.entry === 'alias',
				section: { name: target.groupLabel, rank: target.groupRank },
			});
		}
	}
	return options;
}

/**
 * The document range a picked entry replaces: from the `[[` through whatever
 * of the auto-paired `]]` already sits after the caret, so accepting never
 * strands closing brackets.
 */
export function wikilinkReplaceRange(
	matchFrom: number,
	cursor: number,
	textAfterCursor: string,
): { from: number; to: number } {
	let consumed = 0;
	while (consumed < 2 && textAfterCursor[consumed] === ']') consumed += 1;
	return { from: matchFrom, to: cursor + consumed };
}
