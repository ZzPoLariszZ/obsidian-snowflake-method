import { describe, expect, it } from 'vitest';

import {
	buildSensitiveMatcher,
	parseSensitiveWords,
	planSensitiveMarks,
	sensitiveFingerprint,
	sensitiveOccurrencesOf,
} from '../../src/domain';

describe('reading the list', () => {
	it('takes one term per line, trimmed, empties dropped', () => {
		expect(parseSensitiveWords('damn\n  blast  \n\n\r\n乌鸦\n')).toEqual([
			'damn',
			'blast',
			'乌鸦',
		]);
	});

	it('keeps the first spelling of a duplicate', () => {
		expect(parseSensitiveWords('damn\ndamn\nDamn')).toEqual(['damn', 'Damn']);
	});

	it('fingerprints the terms, order set aside', () => {
		expect(sensitiveFingerprint(['a', 'b'])).toBe(
			sensitiveFingerprint(['b', 'a']),
		);
		expect(sensitiveFingerprint(['a'])).not.toBe(sensitiveFingerprint(['b']));
	});
});

describe('matching terms', () => {
	it('finds the case variants of a Latin term as the term itself', () => {
		const matcher = buildSensitiveMatcher(['damn']);
		const body = 'Damn the fog. He said damn, then DAMN.';
		const hits = matcher.collect(body);
		expect(hits).toHaveLength(3);
		expect(hits.every((hit) => hit.term === 'damn')).toBe(true);
		expect(hits.map((hit) => body.slice(hit.from, hit.to))).toEqual([
			'Damn',
			'damn',
			'DAMN',
		]);
	});

	it('respects word boundaries the way entities do', () => {
		const matcher = buildSensitiveMatcher(['ass']);
		expect(matcher.collect('The brass passes.')).toEqual([]);
		expect(matcher.collect('An ass stood there.')).toHaveLength(1);
	});

	it('matches CJK exactly, inside a longer run included', () => {
		const matcher = buildSensitiveMatcher(['乌鸦']);
		const hits = matcher.collect('一只乌鸦落在乌鸦巢边。');
		expect(hits).toHaveLength(2);
	});

	it('reads one spot as one finding when two spellings are listed', () => {
		const matcher = buildSensitiveMatcher(['damn', 'DAMN']);
		const hits = matcher.collect('damn it');
		expect(hits).toHaveLength(1);
		expect(hits[0]?.term).toBe('damn');
	});

	it('never reaches into code', () => {
		const matcher = buildSensitiveMatcher(['damn']);
		expect(matcher.collect('`damn` in code, damn outside.')).toHaveLength(1);
	});
});

describe('occurrences and their dress', () => {
	it('carries the matched text and keeps the listed term', () => {
		const body = 'Damn the fog.';
		const matcher = buildSensitiveMatcher(['damn']);
		const occurrences = sensitiveOccurrencesOf(
			'note.md',
			matcher.collect(body),
		);
		expect(occurrences).toEqual([
			{
				type: 'sensitive',
				path: 'note.md',
				from: 0,
				to: 4,
				matchedText: 'Damn',
				term: 'damn',
			},
		]);
		expect(planSensitiveMarks(occurrences)).toEqual([
			{
				from: 0,
				to: 4,
				classes: 'snowflake-method-sensitive',
				title: 'damn',
				occurrence: occurrences[0],
			},
		]);
	});
});
