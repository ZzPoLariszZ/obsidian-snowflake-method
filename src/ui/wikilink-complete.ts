import { fuzzyMatch, type FuzzyMatch } from './fuzzy-match';
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

/** The rows to offer, and which of them the popup should open on. */
export interface WikilinkOffer {
	options: WikilinkOption[];
	/**
	 * Where the highlight starts: the name of the best-placed entity, unless
	 * what was typed fits one of its aliases better -- the alias when the name
	 * did not match at all, or when the typed text begins the alias and does
	 * not begin the name. Zero for an empty list, which has nothing to point at.
	 */
	preferred: number;
}

/**
 * Filter and rank. Every entry is matched against its own label alone, and
 * an entity whose name or any alias matches is offered whole: its name first,
 * then every alias, the ones that matched moved to the head of the aliases
 * (typed from the start before merely containing, closer before looser,
 * declaration order last), so the name an author knows an alias by always
 * stands above it, and two members who share an alias are told apart.
 * Groups keep rail order, and entities take their place from their
 * best-scoring entry, then snowflake rank, then name. An empty query is the
 * whole roster in group, rank, name-before-aliases order. Exactly one row is
 * marked preferred: see `WikilinkOption.preferred`.
 */
export function wikilinkOptions(
	targets: readonly WikilinkTarget[],
	query: string,
): WikilinkOffer {
	/** One entry of one entity, with how it answered the query. */
	interface Scored {
		target: WikilinkTarget;
		/** Null when this entry does not match the query at all. */
		match: FuzzyMatch | null;
	}
	/** One entity's entries, with the sort keys worked out once. */
	interface Bucket {
		entries: Scored[];
		groupRank: number;
		rank: number;
		name: string;
		best: number;
	}
	const buckets = new Map<string, Bucket>();
	for (const target of targets) {
		const match = fuzzyMatch(query, target.label);
		const key = `${String(target.groupRank)}|${target.memberPath}`;
		const bucket = buckets.get(key);
		if (bucket === undefined) {
			buckets.set(key, {
				entries: [{ target, match }],
				groupRank: target.groupRank,
				rank: target.rank,
				name: target.memberName,
				best: match?.score ?? -Infinity,
			});
		} else {
			bucket.entries.push({ target, match });
			bucket.best = Math.max(bucket.best, match?.score ?? -Infinity);
		}
	}
	// Sorted on keys already in hand: an entity's best score used to be worked
	// out afresh inside the comparator, once for each side of every comparison.
	const ordered = [...buckets.values()]
		.filter((bucket) => bucket.best > -Infinity)
		.sort((left, right) => {
			if (left.groupRank !== right.groupRank) {
				return left.groupRank - right.groupRank;
			}
			if (left.best !== right.best) return right.best - left.best;
			if (left.rank !== right.rank) return left.rank - right.rank;
			if (left.name < right.name) return -1;
			return left.name > right.name ? 1 : 0;
		});
	const options: WikilinkOption[] = [];
	let preferred = 0;
	for (const [place, bucket] of ordered.entries()) {
		const name =
			bucket.entries.find((entry) => entry.target.entry === 'name') ?? null;
		// Aliases stay in declaration order except that the matched ones come
		// first, themselves ordered by how well they fit.
		const aliases = bucket.entries
			.filter((entry) => entry.target.entry === 'alias')
			.sort((left, right) => {
				if ((left.match === null) !== (right.match === null)) {
					return left.match === null ? 1 : -1;
				}
				if (left.match === null || right.match === null) return 0;
				if (left.match.fromStart !== right.match.fromStart) {
					return left.match.fromStart ? -1 : 1;
				}
				return right.match.score - left.match.score;
			});
		const bestAlias = aliases.find((entry) => entry.match !== null) ?? null;
		const nameWins =
			name?.match != null &&
			(name.match.fromStart ||
				bestAlias?.match == null ||
				!bestAlias.match.fromStart);
		const opensOn = nameWins ? name : (bestAlias ?? name);
		for (const entry of [...(name === null ? [] : [name]), ...aliases]) {
			if (place === 0 && entry === opensOn) preferred = options.length;
			const { target } = entry;
			options.push({
				label: target.label,
				insert: target.insert,
				alias: target.entry === 'alias',
				section: { name: target.groupLabel, rank: target.groupRank },
			});
		}
	}
	return { options, preferred };
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
