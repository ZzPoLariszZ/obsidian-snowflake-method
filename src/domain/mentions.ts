/**
 * Entity mentions in one note's body: where a registered name or alias
 * stands, what it could mean, and what it definitely means.
 *
 * The pipeline is split exactly where a cache would cut it. The first half,
 * `collectMentionHits`, is derived from the body and the matcher alone --
 * boundary-checked raw hits, every candidate still attached, no later choice
 * baked in -- so it can be stored against the note's stamp and the matcher's
 * fingerprint. The second half, `resolveMentions`, applies the reader's
 * current candidate ignores, settles overlaps and resolves each survivor,
 * and is cheap enough to run on every read; an ignore therefore never
 * invalidates anything stored. Candidate ignores must run before overlap
 * resolution: removing a candidate can remove a hit, and with it the reason
 * a shorter overlapping hit lost.
 *
 * Boundaries: a Latin name never matches inside another word, told by
 * word characters on both sides of the seam. CJK gets no segmentation --
 * 林 matches inside 森林 -- a deliberate trade, because drawing word edges
 * in CJK needs a dictionary this plugin does not carry; the mitigation is
 * registering the longer form, which longest-match already prefers.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { analyzableRanges } from './analyzable-prose';
import type { CountableRange } from './markdown-scan';
import type { EntityMatcher, MentionCandidate } from './entity-matcher';

export const MENTION_HIGHLIGHT_MODES = [
	'off',
	'first',
	'unlinked',
	'all',
] as const;

/**
 * What the stream highlights: nothing, the first mention of each entity in
 * a note, the mentions not yet written as links, or every mention.
 */
export type MentionHighlightMode = (typeof MENTION_HIGHLIGHT_MODES)[number];

export function isMentionHighlightMode(
	value: unknown,
): value is MentionHighlightMode {
	return (
		value === 'off' ||
		value === 'first' ||
		value === 'unlinked' ||
		value === 'all'
	);
}

/**
 * What one occurrence settles to. `unique`: plain text with exactly one
 * candidate left. `wikilink`: the visible text of a link that points at a
 * candidate. `ambiguous`: plain text more than one member could mean.
 * `foreign-link`: text inside a link that points somewhere else entirely --
 * never highlighted, never counted, because the author already said whom
 * they meant.
 */
export type MentionResolution =
	| 'unique'
	| 'wikilink'
	| 'ambiguous'
	| 'foreign-link';

export interface EntityOccurrence {
	/** The discriminator later analysis kinds join. */
	type: 'entity';
	/** The note the occurrence stands in. */
	path: string;
	/** Body-relative offsets: `body.slice(from, to)` is the matched text. */
	from: number;
	to: number;
	matchedText: string;
	resolution: MentionResolution;
	/**
	 * The one member this occurrence definitely mentions, set for `unique`
	 * and `wikilink` alone. Only occurrences carrying it feed an entity's
	 * statistics.
	 */
	resolvedMemberPath: string | null;
	/** Whom the text could mean, candidate ignores already applied. */
	candidates: MentionCandidate[];
}

/** One registered sensitive term found on the page. */
export interface SensitiveOccurrence {
	type: 'sensitive';
	path: string;
	/** Body-relative offsets: `body.slice(from, to)` is the matched text. */
	from: number;
	to: number;
	matchedText: string;
	/** The term as the list registers it, a case variant folded back. */
	term: string;
}

/** One stretch of quoted dialogue, quote marks included. */
export interface DialogueOccurrence {
	type: 'dialogue';
	path: string;
	from: number;
	to: number;
	/** The quoted stretch itself; a view truncates it for display. */
	matchedText: string;
}

/**
 * One custom highlight rule's match. Transient by design: these dress the
 * segments the stream has loaded and are discarded with them -- never
 * counted, never stored.
 */
export interface HighlightOccurrence {
	type: 'highlight';
	path: string;
	from: number;
	to: number;
	matchedText: string;
	ruleId: string;
}

/** Everything an analysis can pin to a spot in a note. */
export type Occurrence =
	| EntityOccurrence
	| SensitiveOccurrence
	| DialogueOccurrence
	| HighlightOccurrence;

/**
 * A boundary-checked raw hit: the persistable half of the pipeline,
 * pre-overlap and pre-ignore, so no later choice is baked into a cache.
 */
export interface MentionHit {
	from: number;
	to: number;
	matchedText: string;
	/** The link whose visible text the hit stands in, when it does. */
	link: { target: string } | null;
	candidates: MentionCandidate[];
}

/**
 * What the reader asked not to be told again. The first two shapes are
 * candidate-level -- this member no longer matches this text, in one note or
 * anywhere -- and act before overlaps are settled, so removing one candidate
 * can resolve what remains. The third is occurrence-level: silence exactly
 * this spot, whatever it resolves to, named by its position among the note's
 * same-text occurrences. That ordinal is honest about its limit: writing an
 * earlier occurrence of the same text slides it, one note and one string at
 * a time, and the rule stays visible in the store it lives in.
 */
export type MentionIgnore =
	| { scope: 'note'; notePath: string; memberPath: string; matchedText: string }
	| { scope: 'manuscript'; memberPath: string; matchedText: string }
	| {
			scope: 'occurrence';
			notePath: string;
			matchedText: string;
			ordinal: number;
	  };

export function isMentionIgnore(value: unknown): value is MentionIgnore {
	if (typeof value !== 'object' || value === null) return false;
	const rule = value as Record<string, unknown>;
	const text = (key: string): boolean =>
		typeof rule[key] === 'string' && rule[key].length > 0;
	if (rule.scope === 'note') {
		return text('notePath') && text('memberPath') && text('matchedText');
	}
	if (rule.scope === 'manuscript') {
		return text('memberPath') && text('matchedText');
	}
	if (rule.scope === 'occurrence') {
		return (
			text('notePath') &&
			text('matchedText') &&
			typeof rule.ordinal === 'number' &&
			Number.isInteger(rule.ordinal) &&
			rule.ordinal >= 0
		);
	}
	return false;
}

export function splitMentionIgnores(ignores: readonly MentionIgnore[]): {
	candidate: MentionIgnore[];
	occurrence: MentionIgnore[];
} {
	return {
		candidate: ignores.filter((rule) => rule.scope !== 'occurrence'),
		occurrence: ignores.filter((rule) => rule.scope === 'occurrence'),
	};
}

/** Word characters for boundary purposes: letters, digits, marks and the
 *  underscore -- except the CJK scripts, which draw no word edges. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;
const CJK_CHARACTER =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const isWordCharacter = (character: string): boolean =>
	WORD_CHARACTER.test(character) && !CJK_CHARACTER.test(character);

/** The code point ending at `at`, read no further back than `floor`. */
function pointBefore(body: string, at: number, floor: number): string {
	if (at <= floor) return '';
	const unit = body.charCodeAt(at - 1);
	const paired =
		unit >= 0xdc00 && unit <= 0xdfff && at - 2 >= floor ? at - 2 : at - 1;
	return body.slice(paired, at);
}

/** The code point starting at `at`, read no further than `ceiling`. */
function pointAfter(body: string, at: number, ceiling: number): string {
	if (at >= ceiling) return '';
	const unit = body.charCodeAt(at);
	const paired =
		unit >= 0xd800 && unit <= 0xdbff && at + 2 <= ceiling ? at + 2 : at + 1;
	return body.slice(at, paired);
}

/**
 * Whether a hit stands on its own words: false only when a word character
 * inside the hit's edge is glued to a word character beside it. Neighbors
 * are read within the hit's own analyzable range -- a range edge is itself a
 * boundary, because syntax stood there.
 */
export function hasWordBoundary(
	body: string,
	from: number,
	to: number,
	range: CountableRange,
): boolean {
	const first = pointAfter(body, from, to);
	const last = pointBefore(body, to, from);
	const before = pointBefore(body, from, range.from);
	const after = pointAfter(body, to, range.to);
	if (isWordCharacter(first) && before !== '' && isWordCharacter(before)) {
		return false;
	}
	if (isWordCharacter(last) && after !== '' && isWordCharacter(after)) {
		return false;
	}
	return true;
}

/**
 * Every boundary-checked hit in one body, in document order. Matching runs
 * per analyzable range over the original text, so offsets are exact and a
 * name interrupted by syntax is simply not found.
 */
export function collectMentionHits(
	body: string,
	excludeRanges: readonly CountableRange[],
	matcher: EntityMatcher,
): MentionHit[] {
	const hits: MentionHit[] = [];
	for (const range of analyzableRanges(body, excludeRanges)) {
		for (const hit of matcher.findAll(
			body.slice(range.from, range.to),
			range.from,
		)) {
			if (!hasWordBoundary(body, hit.from, hit.to, range)) continue;
			hits.push({
				from: hit.from,
				to: hit.to,
				matchedText: body.slice(hit.from, hit.to),
				link: range.link,
				candidates: [...hit.payloads],
			});
		}
	}
	return hits;
}

/** The last path segment, extension set aside: how a bare link names a note. */
function stemOf(path: string): string {
	const trimmed = path.replace(/\.md$/u, '');
	const cut = trimmed.lastIndexOf('/');
	return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/**
 * Whether a link's target means this member. An exact path match does; so
 * does a bare name equal to the member's own, which is how Obsidian's
 * shortest links are written. A target that names some other path is not
 * softened into a match by sharing a stem: it points where it points.
 */
function targetMeans(target: string, memberPath: string): boolean {
	const linked = target.replace(/\.md$/u, '');
	const member = memberPath.replace(/\.md$/u, '');
	if (linked === member) return true;
	return !linked.includes('/') && linked === stemOf(member);
}

/**
 * The read-time half: candidate ignores, then overlaps, then resolution.
 * Linear in the hits, so running it on every read costs nothing worth
 * caching.
 */
export function resolveMentions(
	path: string,
	hits: readonly MentionHit[],
	candidateIgnores: readonly MentionIgnore[],
): EntityOccurrence[] {
	// Candidate ignores first: a hit that loses its only candidate is not a
	// mention at all, and a shorter hit it overlapped may now win instead.
	const silenced = (
		candidate: MentionCandidate,
		matchedText: string,
	): boolean =>
		candidateIgnores.some(
			(rule) =>
				rule.scope !== 'occurrence' &&
				rule.memberPath === candidate.memberPath &&
				rule.matchedText === matchedText &&
				(rule.scope === 'manuscript' || rule.notePath === path),
		);
	const alive = hits
		.map((hit) => ({
			...hit,
			candidates: hit.candidates.filter(
				(candidate) => !silenced(candidate, hit.matchedText),
			),
		}))
		.filter((hit) => hit.candidates.length > 0)
		.sort((left, right) => left.from - right.from || right.to - left.to);

	// Overlaps: within each cluster of mutually overlapping hits, the longest
	// wins, a name beats an alias, then the roster's own order decides.
	const overlaps = (left: MentionHit, right: MentionHit): boolean =>
		left.from < right.to && right.from < left.to;
	const better = (left: MentionHit, right: MentionHit): number =>
		right.to - right.from - (left.to - left.from) ||
		Number(!right.candidates.some((c) => c.entry === 'name')) -
			Number(!left.candidates.some((c) => c.entry === 'name')) ||
		Math.min(...left.candidates.map((c) => c.groupRank)) -
			Math.min(...right.candidates.map((c) => c.groupRank)) ||
		Math.min(...left.candidates.map((c) => c.rank)) -
			Math.min(...right.candidates.map((c) => c.rank)) ||
		left.from - right.from;
	const winners: MentionHit[] = [];
	for (let at = 0; at < alive.length; ) {
		// One cluster: hits chained together by overlap.
		let end = at + 1;
		let reach = (alive[at] as MentionHit).to;
		while (end < alive.length && (alive[end] as MentionHit).from < reach) {
			reach = Math.max(reach, (alive[end] as MentionHit).to);
			end += 1;
		}
		let pool = alive.slice(at, end);
		while (pool.length > 0) {
			const pick = [...pool].sort(better)[0] as MentionHit;
			winners.push(pick);
			pool = pool.filter((hit) => !overlaps(hit, pick));
		}
		at = end;
	}
	winners.sort((left, right) => left.from - right.from);

	return winners.map((hit) => {
		if (hit.link !== null) {
			const target = hit.link.target;
			const meant = hit.candidates.find((candidate) =>
				targetMeans(target, candidate.memberPath),
			);
			if (meant === undefined) {
				return occurrence(path, hit, 'foreign-link', null, hit.candidates);
			}
			return occurrence(path, hit, 'wikilink', meant.memberPath, [meant]);
		}
		const members = new Set(
			hit.candidates.map((candidate) => candidate.memberPath),
		);
		if (members.size === 1) {
			const member = hit.candidates[0] as MentionCandidate;
			return occurrence(path, hit, 'unique', member.memberPath, hit.candidates);
		}
		return occurrence(path, hit, 'ambiguous', null, hit.candidates);
	});
}

function occurrence(
	path: string,
	hit: MentionHit,
	resolution: MentionResolution,
	resolvedMemberPath: string | null,
	candidates: MentionCandidate[],
): EntityOccurrence {
	return {
		type: 'entity',
		path,
		from: hit.from,
		to: hit.to,
		matchedText: hit.matchedText,
		resolution,
		resolvedMemberPath,
		candidates,
	};
}

/** Both halves in one call, for the live paths that hold the body anyway. */
export function analyzeMentions(
	path: string,
	body: string,
	excludeRanges: readonly CountableRange[],
	matcher: EntityMatcher,
	candidateIgnores: readonly MentionIgnore[],
): EntityOccurrence[] {
	return resolveMentions(
		path,
		collectMentionHits(body, excludeRanges, matcher),
		candidateIgnores,
	);
}

/**
 * A note's occurrences with the occurrence-level ignores taken out. Ordinals
 * are counted over the full list handed in, in document order, so the rule a
 * menu wrote against the third "Alice" still means the third one whatever
 * mode the stream is showing.
 */
export function applyOccurrenceIgnores(
	occurrences: readonly EntityOccurrence[],
	occurrenceIgnores: readonly MentionIgnore[],
): EntityOccurrence[] {
	const counters = new Map<string, number>();
	return occurrences.filter((entry) => {
		const ordinal = counters.get(entry.matchedText) ?? 0;
		counters.set(entry.matchedText, ordinal + 1);
		return !occurrenceIgnores.some(
			(rule) =>
				rule.scope === 'occurrence' &&
				rule.notePath === entry.path &&
				rule.matchedText === entry.matchedText &&
				rule.ordinal === ordinal,
		);
	});
}

/**
 * The rule one menu action writes for one occurrence. Candidate scopes name
 * a member: the resolved one by default, or the one candidate the reader
 * picked off an ambiguous mention.
 */
export function mentionIgnoreOf(
	target: EntityOccurrence,
	noteOccurrences: readonly EntityOccurrence[],
	scope: MentionIgnore['scope'],
	memberPath?: string,
): MentionIgnore {
	if (scope === 'occurrence') {
		const ordinal = noteOccurrences.filter(
			(entry) =>
				entry.matchedText === target.matchedText && entry.from < target.from,
		).length;
		return {
			scope,
			notePath: target.path,
			matchedText: target.matchedText,
			ordinal,
		};
	}
	const member =
		memberPath ??
		target.resolvedMemberPath ??
		target.candidates[0]?.memberPath ??
		'';
	if (scope === 'note') {
		return {
			scope,
			notePath: target.path,
			memberPath: member,
			matchedText: target.matchedText,
		};
	}
	return { scope, memberPath: member, matchedText: target.matchedText };
}

/** One highlightable stretch, its dress spelled as classes. */
export interface MentionMark {
	from: number;
	to: number;
	classes: string;
	/** A hover title, carried onto the mark's element when set. */
	title?: string;
	/**
	 * One inline custom property, e.g. `--snowflake-method-highlight-color:
	 * #aabbcc`. The value is built from a sanitized hex color upstream; no
	 * user CSS passes through here.
	 */
	styleVar?: string;
	occurrence: Occurrence;
}

/** A mark the entity planner made: its occurrence is an entity mention. */
export interface EntityMentionMark extends MentionMark {
	occurrence: EntityOccurrence;
}

/**
 * What one note highlights under a mode: the one planner both halves of the
 * stream consume, so they can never disagree. Foreign links never show; the
 * first mention of an entity is the first that survived the ignores, so
 * silencing a first promotes the next.
 */
export function planMentionMarks(
	occurrences: readonly EntityOccurrence[],
	occurrenceIgnores: readonly MentionIgnore[],
	mode: MentionHighlightMode,
): EntityMentionMark[] {
	if (mode === 'off') return [];
	const visible = applyOccurrenceIgnores(
		occurrences,
		occurrenceIgnores,
	).filter((entry) => entry.resolution !== 'foreign-link');
	const firsts = new Set<EntityOccurrence>();
	const seen = new Set<string>();
	for (const entry of visible) {
		if (entry.resolvedMemberPath === null) continue;
		if (seen.has(entry.resolvedMemberPath)) continue;
		seen.add(entry.resolvedMemberPath);
		firsts.add(entry);
	}
	const chosen = visible.filter((entry) =>
		mode === 'all'
			? true
			: mode === 'unlinked'
				? entry.resolution === 'unique' || entry.resolution === 'ambiguous'
				: firsts.has(entry),
	);
	return chosen.map((entry) => ({
		from: entry.from,
		to: entry.to,
		classes: [
			'snowflake-method-mention',
			entry.resolution === 'wikilink' ? 'is-linked' : 'is-unlinked',
			...(entry.resolution === 'ambiguous' ? ['is-ambiguous'] : []),
			...(firsts.has(entry) ? ['is-first'] : []),
		].join(' '),
		occurrence: entry,
	}));
}

/** One projection kept: a pane expansion asks for a run of context lines
 *  over the same few bodies, chapter by chapter. */
let contextMemo: {
	body: string;
	text: string;
	sourceIndexOf: number[];
} | null = null;

function contextProjection(body: string): {
	text: string;
	sourceIndexOf: number[];
} {
	if (contextMemo === null || contextMemo.body !== body) {
		const chars: string[] = [];
		const sourceIndexOf: number[] = [];
		for (const range of analyzableRanges(body)) {
			for (let at = range.from; at < range.to; at += 1) {
				chars.push(body.charAt(at));
				sourceIndexOf.push(at);
			}
		}
		contextMemo = { body, text: chars.join(''), sourceIndexOf };
	}
	return contextMemo;
}

/**
 * The prose around one occurrence, for a tracking row: read off the
 * analyzable projection rather than the source, so a link contributes its
 * visible text alone and a context window can never land inside a target
 * and hand back half its path. Whitespace survives, unlike the matching
 * walk's, because a context line is read, not matched. Held to the
 * occurrence's own line, a partial word at a clipped edge dropped when a
 * whole one is left, and an ellipsis standing where text was cut.
 */
export function occurrenceContext(
	body: string,
	from: number,
	to: number,
	radius = 28,
): { before: string; match: string; after: string } {
	const { text, sourceIndexOf } = contextProjection(body);
	const indexAt = (at: number): number => {
		let low = 0;
		let high = sourceIndexOf.length;
		while (low < high) {
			const mid = Math.floor((low + high) / 2);
			if ((sourceIndexOf[mid] ?? 0) < at) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	const shownFrom = indexAt(from);
	const shownTo = Math.max(indexAt(to), shownFrom);
	let start = shownFrom;
	while (start > 0 && shownFrom - start < radius && text[start - 1] !== '\n') {
		start -= 1;
	}
	let before = text.slice(start, shownFrom);
	if (start > 0 && text.charAt(start - 1) !== '\n') {
		const whole = before.replace(/^\S+\s+/u, '');
		before = `…${whole.length > 0 ? whole : before}`;
	}
	let end = shownTo;
	while (end < text.length && end - shownTo < radius && text[end] !== '\n') {
		end += 1;
	}
	let after = text.slice(shownTo, end);
	if (end < text.length && text.charAt(end) !== '\n') {
		const whole = after.replace(/\s+\S+$/u, '');
		after = `${whole.length > 0 ? whole : after}…`;
	}
	const match = text.slice(shownFrom, shownTo);
	return {
		before,
		match: match.length > 0 ? match : body.slice(from, to),
		after,
	};
}
