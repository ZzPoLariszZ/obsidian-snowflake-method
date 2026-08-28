/**
 * Custom highlight rules: user-registered text the stream dresses and does
 * nothing else with. The boundary is deliberate -- entities are tracked,
 * words are statistically analyzed, custom patterns are highlighted -- so a
 * rule's matches are transient values computed per loaded segment and
 * discarded with it. Only the rules themselves persist, in settings.
 *
 * Regexes run unbounded on purpose: a match cap or a pattern-length cap is
 * not a safety mechanism, because a short pattern can be expensive and a
 * long one safe. The real guards are here instead -- a pattern that does not
 * compile is skipped and reported, a zero-length match emits nothing and the
 * cursor is advanced by hand -- and the scope itself, which is never wider
 * than the segments a stream has loaded. Catastrophic backtracking remains
 * native regex's own limit; if it ever matters in practice, the answer is
 * execution strategy, not caps.
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
	type HighlightOccurrence,
	type MentionMark,
} from './mentions';

export const HIGHLIGHT_RULE_KINDS = ['literal', 'regex'] as const;
export type HighlightRuleKind = (typeof HIGHLIGHT_RULE_KINDS)[number];

export const HIGHLIGHT_DECORATIONS = [
	'background',
	'color',
	'underline',
	'wavy',
	'bold',
] as const;
export type HighlightDecoration = (typeof HIGHLIGHT_DECORATIONS)[number];

export interface CustomHighlightRule {
	id: string;
	name: string;
	kind: HighlightRuleKind;
	/** Literal strings, or regex sources compiled with the `gu` flags. */
	patterns: string[];
	enabled: boolean;
	decoration: HighlightDecoration;
	/** A hex color, or null to follow the theme's accent. */
	color: string | null;
}

/** A fresh id for a rule the settings tab is about to create. */
export function newHighlightRuleId(): string {
	const salt = Math.floor(Math.random() * 0x7fffffff).toString(36);
	return `rule-${Date.now().toString(36)}-${salt}`;
}

const isHighlightRuleKind = (value: unknown): value is HighlightRuleKind =>
	value === 'literal' || value === 'regex';

const isHighlightDecoration = (value: unknown): value is HighlightDecoration =>
	(HIGHLIGHT_DECORATIONS as readonly unknown[]).includes(value);

/** The one color shape the inline style is built from. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;

/**
 * Stored rules read back with junk dropped: an entry missing its shape
 * disappears, an unknown color falls back to the accent, empty patterns are
 * dropped, and a duplicated id keeps its first reading.
 */
export function sanitizeCustomHighlightRules(
	value: unknown,
): CustomHighlightRule[] {
	if (!Array.isArray(value)) return [];
	const rules: CustomHighlightRule[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) continue;
		const rule = entry as Record<string, unknown>;
		if (typeof rule.id !== 'string' || rule.id.length === 0) continue;
		if (seen.has(rule.id)) continue;
		if (!isHighlightRuleKind(rule.kind)) continue;
		if (!Array.isArray(rule.patterns)) continue;
		const patterns = rule.patterns.filter(
			(pattern): pattern is string =>
				typeof pattern === 'string' && pattern.trim().length > 0,
		);
		seen.add(rule.id);
		rules.push({
			id: rule.id,
			name: typeof rule.name === 'string' ? rule.name : '',
			kind: rule.kind,
			patterns,
			enabled: rule.enabled !== false,
			decoration: isHighlightDecoration(rule.decoration)
				? rule.decoration
				: 'background',
			color:
				typeof rule.color === 'string' && HEX_COLOR.test(rule.color)
					? rule.color
					: null,
		});
	}
	return rules;
}

/**
 * What the memoized compilation stands for: everything the dress reads from
 * it -- the patterns and kinds that decide what matches, and the names,
 * decorations and colors the plan styles the matches with. All of it keys
 * the memo, because the compiled set carries the rules the plan reads: a
 * fingerprint blind to a recolor handed back the old look until a reload.
 * Rebuilding on a style edit costs microseconds at rule-list scale.
 */
export function highlightRulesFingerprint(
	rules: readonly CustomHighlightRule[],
): string {
	return fingerprint(
		rules
			.filter((rule) => rule.enabled)
			.map((rule) => [
				rule.id,
				rule.kind,
				rule.patterns,
				rule.name,
				rule.decoration,
				rule.color,
			]),
	);
}

/** One rule's match, the whole transient result: no text, no counting. */
export interface HighlightHit {
	ruleId: string;
	from: number;
	to: number;
}

export interface CompiledHighlightRules {
	readonly fingerprint: string;
	/** The enabled rules, in list order, broken ones included. */
	readonly rules: readonly CustomHighlightRule[];
	/** Rules with at least one pattern that does not compile. */
	readonly brokenRuleIds: ReadonlySet<string>;
	/** Usable patterns across all rules; zero means nothing to scan. */
	readonly matchableCount: number;
	collect(
		body: string,
		excludeRanges?: readonly CountableRange[],
	): HighlightHit[];
}

/**
 * All enabled rules compiled once: one automaton over every literal pattern,
 * one regex per regex pattern. Literal matches respect the same word
 * boundaries entities do, CJK limitation included; a regex draws its own
 * boundaries with `\b` when it wants them. Matches never span analyzable
 * range edges -- syntax stood there.
 */
export function compileCustomHighlightRules(
	rules: readonly CustomHighlightRule[],
): CompiledHighlightRules {
	const enabled = rules.filter((rule) => rule.enabled);
	const broken = new Set<string>();
	const entries: PatternEntry<string>[] = [];
	const expressions: { ruleId: string; pattern: RegExp }[] = [];
	let matchableCount = 0;
	for (const rule of enabled) {
		for (const pattern of rule.patterns) {
			if (rule.kind === 'literal') {
				for (const form of patternForms(pattern)) {
					entries.push({ pattern: form, payload: rule.id });
				}
				matchableCount += 1;
				continue;
			}
			try {
				expressions.push({
					ruleId: rule.id,
					pattern: new RegExp(pattern, 'gu'),
				});
				matchableCount += 1;
			} catch {
				broken.add(rule.id);
			}
		}
	}
	const matcher = buildPatternMatcher(entries);
	const collect = (
		body: string,
		excludeRanges: readonly CountableRange[] = [],
	): HighlightHit[] => {
		const hits: HighlightHit[] = [];
		for (const range of analyzableRanges(body, excludeRanges)) {
			const slice = body.slice(range.from, range.to);
			for (const hit of matcher.findAll(slice, range.from)) {
				if (!hasWordBoundary(body, hit.from, hit.to, range)) continue;
				for (const ruleId of new Set(hit.payloads)) {
					hits.push({ ruleId, from: hit.from, to: hit.to });
				}
			}
			for (const { ruleId, pattern } of expressions) {
				pattern.lastIndex = 0;
				for (
					let match = pattern.exec(slice);
					match !== null;
					match = pattern.exec(slice)
				) {
					if (match[0].length === 0) {
						// A zero-length match emits nothing; the cursor moves by
						// hand, or exec would stand still forever.
						pattern.lastIndex += 1;
						continue;
					}
					hits.push({
						ruleId,
						from: range.from + match.index,
						to: range.from + match.index + match[0].length,
					});
				}
			}
		}
		return hits.sort(
			(left, right) => left.from - right.from || right.to - left.to,
		);
	};
	return {
		fingerprint: highlightRulesFingerprint(rules),
		rules: enabled,
		brokenRuleIds: broken,
		matchableCount,
		collect,
	};
}

/**
 * Hits dressed as marks: the rule's decoration as a class, its name as the
 * hover title, its color as the one inline custom property the stylesheet
 * reads. A hit whose rule is gone dresses nothing.
 */
export function planHighlightMarks(
	path: string,
	body: string,
	hits: readonly HighlightHit[],
	rules: readonly CustomHighlightRule[],
): MentionMark[] {
	const byId = new Map(rules.map((rule) => [rule.id, rule]));
	const marks: MentionMark[] = [];
	for (const hit of hits) {
		const rule = byId.get(hit.ruleId);
		if (rule === undefined) continue;
		const occurrence: HighlightOccurrence = {
			type: 'highlight',
			path,
			from: hit.from,
			to: hit.to,
			matchedText: body.slice(hit.from, hit.to),
			ruleId: hit.ruleId,
		};
		marks.push({
			from: hit.from,
			to: hit.to,
			classes: `snowflake-method-highlight is-deco-${rule.decoration}`,
			...(rule.name.length > 0 ? { title: rule.name } : {}),
			...(rule.color !== null
				? {
						styleVar: `--snowflake-method-highlight-color: ${rule.color}`,
					}
				: {}),
			occurrence,
		});
	}
	return marks;
}

/**
 * Several planners' marks folded into the one array both halves consume:
 * sorted and strictly non-overlapping, because the rendered wrap and the
 * editor's decoration set both require it. Earlier sets win whole -- entity
 * marks over sensitive over custom -- and within a set an earlier start wins,
 * then the longer stretch, then the order the marks were planned in.
 */
export function combineMentionMarks(
	...sets: readonly (readonly MentionMark[])[]
): MentionMark[] {
	const chosen: MentionMark[] = [];
	const overlaps = (left: MentionMark, right: MentionMark): boolean =>
		left.from < right.to && right.from < left.to;
	for (const set of sets) {
		const ordered = set
			.map((mark, at) => ({ mark, at }))
			.sort(
				(left, right) =>
					left.mark.from - right.mark.from ||
					right.mark.to - left.mark.to ||
					left.at - right.at,
			);
		for (const { mark } of ordered) {
			if (chosen.some((kept) => overlaps(kept, mark))) continue;
			chosen.push(mark);
		}
	}
	return chosen.sort((left, right) => left.from - right.from);
}
