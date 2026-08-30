/**
 * Sensitive words: one list of literal terms the reader wants warned about,
 * matched the way entities are and counted the way entities are. The list
 * lives in settings; the hits are worth persisting, because finding every
 * spot is the point of the feature.
 *
 * Latin terms match their case variants -- damn, Damn, DAMN are one term --
 * because a sentence opens with a capital whether the writer meant emphasis
 * or not. The variants are generated, not listed, and every hit folds back
 * to the term as the list spells it. CJK has no case and is untouched, and
 * the word-boundary rules are the entity matcher's own, the CJK limitation
 * included.
 *
 * Kept free of Obsidian types and of the DOM.
 */

import { analyzableRanges } from './analyzable-prose';
import {
	buildPatternMatcher,
	type PatternEntry,
} from './aho-corasick';
import { patternForms } from './entity-matcher';
import { fingerprint } from './fingerprint';
import type { CountableRange } from './markdown-scan';
import {
	hasWordBoundary,
	type MentionMark,
	type SensitiveOccurrence,
} from './mentions';

/**
 * The list as the textarea holds it, read back as terms: one per line,
 * trimmed, empties dropped, the first spelling of a duplicate kept.
 */
export function parseSensitiveWords(text: string): string[] {
	const terms: string[] = [];
	const seen = new Set<string>();
	for (const line of text.split(/\r?\n/u)) {
		const term = line.trim();
		if (term.length === 0 || seen.has(term)) continue;
		seen.add(term);
		terms.push(term);
	}
	return terms;
}

/**
 * Order included deliberately: when two listings collide as case variants,
 * the earlier one names their shared hits, so a reorder changes what a
 * stored hit means and must move the print with it.
 */
export function sensitiveFingerprint(terms: readonly string[]): string {
	return fingerprint([...terms]);
}

/** The case spellings one term is found as, itself always first. */
function caseVariants(term: string): string[] {
	const lower = term.toLowerCase();
	const capital = lower.charAt(0).toUpperCase() + lower.slice(1);
	return [...new Set([term, lower, capital, term.toUpperCase()])];
}

/** One term found at one spot: the persistable half. */
export interface SensitiveHit {
	/** The term as the list spells it, whatever variant matched. */
	term: string;
	/** The text as the page spells it, kept so a warm entry needs no read. */
	matchedText: string;
	from: number;
	to: number;
}

export interface SensitiveMatcher {
	readonly fingerprint: string;
	/** How many distinct terms the list spelled. */
	readonly termCount: number;
	collect(
		body: string,
		excludeRanges?: readonly CountableRange[],
	): SensitiveHit[];
}

export function buildSensitiveMatcher(
	terms: readonly string[],
): SensitiveMatcher {
	const entries: PatternEntry<string>[] = [];
	for (const term of terms) {
		for (const variant of caseVariants(term)) {
			for (const form of patternForms(variant)) {
				entries.push({ pattern: form, payload: term });
			}
		}
	}
	const matcher = buildPatternMatcher(entries);
	const collect = (
		body: string,
		excludeRanges: readonly CountableRange[] = [],
	): SensitiveHit[] => {
		const hits: SensitiveHit[] = [];
		for (const range of analyzableRanges(body, excludeRanges)) {
			for (const hit of matcher.findAll(
				body.slice(range.from, range.to),
				range.from,
			)) {
				if (!hasWordBoundary(body, hit.from, hit.to, range)) continue;
				// Two listed spellings of one word land on the same span; the
				// spot is one finding, and the first listing names it.
				const term = hit.payloads[0];
				if (term === undefined) continue;
				hits.push({
					term,
					matchedText: body.slice(hit.from, hit.to),
					from: hit.from,
					to: hit.to,
				});
			}
		}
		return hits;
	};
	return {
		fingerprint: sensitiveFingerprint(terms),
		termCount: terms.length,
		collect,
	};
}

/** Hits read back as occurrences: everything they need, they carry. */
export function sensitiveOccurrencesOf(
	path: string,
	hits: readonly SensitiveHit[],
): SensitiveOccurrence[] {
	return hits.map((hit) => ({
		type: 'sensitive',
		path,
		from: hit.from,
		to: hit.to,
		matchedText: hit.matchedText,
		term: hit.term,
	}));
}

/**
 * The warning dress: one fixed presentation, the listed term as the hover
 * title so a case variant still names its rule.
 */
export function planSensitiveMarks(
	occurrences: readonly SensitiveOccurrence[],
): MentionMark[] {
	return occurrences.map((occurrence) => ({
		from: occurrence.from,
		to: occurrence.to,
		classes: 'snowflake-method-sensitive',
		title: occurrence.term,
		occurrence,
	}));
}
