/**
 * The entity layer over the generic pattern matcher: names and aliases in,
 * hits that carry their candidates out. The automaton below knows only
 * strings; everything an entity mention means -- who could be meant, how the
 * choices rank, what link would be written -- lives here.
 *
 * Two fingerprints, because two different things can change. The pattern
 * fingerprint covers the strings alone and says when the automaton must be
 * rebuilt; the metadata fingerprint covers everything else a candidate
 * carries -- names, ranks, the link each would insert -- which changes what
 * a hit resolves to and what a menu offers without changing what matches.
 * The combined fingerprint is the one key caches validate against, so a
 * rank edit invalidates stored results without costing a rebuild.
 *
 * Matching is exact-case and never normalizes the searched text: case is
 * what separates Rose the character from a rose on the page, a wanted
 * lowercase form is an alias, and normalizing the body would bend offsets.
 * The pattern side alone covers Unicode's two spellings: a label whose NFC
 * and NFD forms differ is registered in both, sharing one candidate list, so
 * a body in either form matches with its own exact offsets. A third, mixed
 * spelling in the body will not match; that is the documented limit.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import {
	buildPatternMatcher,
	type PatternEntry,
	type PatternHit,
} from './aho-corasick';
import { fingerprint } from './fingerprint';

/**
 * One name or alias a project member goes by. Structurally satisfied by the
 * wikilink autocomplete's target rows, which is the point: the roster the
 * `[[` popup offers is exactly the roster mentions are found from.
 */
export interface MentionSource {
	/** The name or alias exactly as the member stores it. */
	label: string;
	entry: 'name' | 'alias';
	/** The member's note, as a vault path with its extension. */
	memberPath: string;
	memberName: string;
	group: string;
	groupRank: number;
	rank: number;
	/** The piped link a conversion would write, prebuilt by the caller. */
	insert: string;
}

/** A source, read back out of a hit as one of the members it could mean. */
export type MentionCandidate = MentionSource;

export interface EntityMatcher {
	/** How many distinct pattern strings the roster spelled. */
	readonly patternCount: number;
	/** Over the sorted pattern strings alone: when this moves, rebuild. */
	readonly patternFingerprint: string;
	/** Over the full candidate tuples: ranks, names, inserts. */
	readonly metadataFingerprint: string;
	/** Over both: the one key memos and persisted results validate against. */
	readonly fingerprint: string;
	findAll(text: string, base: number): PatternHit<MentionCandidate>[];
}

/**
 * The strings one label is matched as: itself, and its NFC and NFD
 * spellings when they differ. Empty labels match nothing.
 */
function patternForms(label: string): string[] {
	const trimmed = label.trim();
	if (trimmed.length === 0) return [];
	return [...new Set([trimmed, trimmed.normalize('NFC'), trimmed.normalize('NFD')])];
}

/**
 * How a hit's candidates are read: names before aliases, then the caller's
 * group and rank order, and one entry per member -- a member whose name and
 * alias are the same string is still one choice.
 */
function orderCandidates(
	sources: readonly MentionSource[],
): MentionCandidate[] {
	const sorted = [...sources].sort(
		(left, right) =>
			Number(left.entry === 'alias') - Number(right.entry === 'alias') ||
			left.groupRank - right.groupRank ||
			left.rank - right.rank ||
			left.memberPath.localeCompare(right.memberPath),
	);
	const seen = new Set<string>();
	return sorted.filter((candidate) => {
		if (seen.has(candidate.memberPath)) return false;
		seen.add(candidate.memberPath);
		return true;
	});
}

export function entityMatcherFingerprints(
	sources: readonly MentionSource[],
): { pattern: string; metadata: string; combined: string } {
	const patterns = [
		...new Set(sources.flatMap((source) => patternForms(source.label))),
	].sort();
	const metadata = sources
		.map((source) => [
			source.label,
			source.entry,
			source.memberPath,
			source.memberName,
			source.group,
			source.groupRank,
			source.rank,
			source.insert,
		])
		.sort((left, right) =>
			JSON.stringify(left).localeCompare(JSON.stringify(right)),
		);
	const pattern = fingerprint(patterns);
	const combinedMetadata = fingerprint(metadata);
	return {
		pattern,
		metadata: combinedMetadata,
		combined: fingerprint([pattern, combinedMetadata]),
	};
}

export function buildEntityMatcher(
	sources: readonly MentionSource[],
): EntityMatcher {
	const prints = entityMatcherFingerprints(sources);
	const entries: PatternEntry<MentionSource>[] = [];
	for (const source of sources) {
		for (const form of patternForms(source.label)) {
			entries.push({ pattern: form, payload: source });
		}
	}
	const matcher = buildPatternMatcher(entries);
	// One pattern's payload list is one shared array, so its reading as an
	// ordered, deduped candidate list is computed once and reused for every
	// hit of that pattern.
	const readings = new WeakMap<
		readonly MentionSource[],
		readonly MentionCandidate[]
	>();
	const candidatesOf = (
		payloads: readonly MentionSource[],
	): readonly MentionCandidate[] => {
		const kept = readings.get(payloads);
		if (kept !== undefined) return kept;
		const ordered = orderCandidates(payloads);
		readings.set(payloads, ordered);
		return ordered;
	};
	return {
		patternCount: matcher.patternCount,
		patternFingerprint: prints.pattern,
		metadataFingerprint: prints.metadata,
		fingerprint: prints.combined,
		findAll: (text, base) =>
			matcher.findAll(text, base).map((hit) => ({
				...hit,
				payloads: candidatesOf(hit.payloads),
			})),
	};
}
