import { describe, expect, it } from 'vitest';

import {
	RANK_GAP,
	findSequenceIssues,
	hasSequenceIssues,
	moveSegment,
	nextSegment,
	previousSegment,
	readStoredSequence,
	repairSequences,
	resolveSegments,
	segmentAt,
	sequenceAtEnd,
	sequenceBetween,
	sortSegments,
	windowAround,
	type ManuscriptSegment,
	type StoredSegment,
} from '../../src/domain';

function segment(title: string, sequence: number): ManuscriptSegment {
	return {
		path: `Novel/50_Manuscript/${title}.md`,
		projectId: 'project-1',
		title,
		sequence,
		hasStoredSequence: true,
	};
}

function stored(
	path: string,
	storedSequence: unknown,
	projectId = 'project-1',
): StoredSegment {
	return {
		path,
		projectId,
		title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/u, ''),
		storedSequence,
	};
}

const titles = (segments: readonly ManuscriptSegment[]): string[] =>
	segments.map(({ title }) => title);

describe('manuscript order', () => {
	it('reads only safe integers as a position', () => {
		expect(readStoredSequence(2048)).toBe(2048);
		expect(readStoredSequence(0)).toBe(0);
		expect(readStoredSequence('2048')).toBeNull();
		expect(readStoredSequence(2048.5)).toBeNull();
		expect(readStoredSequence(undefined)).toBeNull();
	});

	it('orders segments by sequence, not by path', () => {
		const ordered = sortSegments([
			segment('Zulu', 1024),
			segment('Alpha', 3072),
			segment('Mike', 2048),
		]);
		expect(titles(ordered)).toEqual(['Zulu', 'Mike', 'Alpha']);
	});

	it('places notes storing no sequence at the end, in path order', () => {
		const resolved = resolveSegments([
			stored('Novel/50_Manuscript/Two.md', 2048),
			stored('Novel/50_Manuscript/Loose B.md', undefined),
			stored('Novel/50_Manuscript/One.md', 1024),
			stored('Novel/50_Manuscript/Loose A.md', 'chapter one'),
		]);

		expect(titles(resolved)).toEqual(['One', 'Two', 'Loose A', 'Loose B']);
		expect(resolved.map(({ hasStoredSequence }) => hasStoredSequence)).toEqual([
			true,
			true,
			false,
			false,
		]);
		// The fallbacks continue past the last real position rather than colliding.
		expect(resolved[2]?.sequence).toBe(3072);
		expect(resolved[3]?.sequence).toBe(4096);
	});

	it('starts the fallback at the first interval when nothing is sequenced', () => {
		const resolved = resolveSegments([
			stored('Novel/50_Manuscript/Only.md', null),
		]);
		expect(resolved[0]?.sequence).toBe(RANK_GAP);
		expect(resolved[0]?.hasStoredSequence).toBe(false);
	});

	it('allocates positions between neighbours and at the end', () => {
		const segments = [segment('One', 1024), segment('Two', 2048)];
		expect(sequenceBetween(1024, 2048)).toBe(1536);
		expect(sequenceAtEnd(segments)).toBe(3072);
		expect(sequenceAtEnd([])).toBe(RANK_GAP);
	});

	it('signals when no integer position remains between neighbours', () => {
		expect(sequenceBetween(1, 2)).toBeNull();
	});

	it('renumbers onto regular intervals without reordering', () => {
		const repaired = repairSequences([
			segment('Two', 7),
			segment('One', 3),
			segment('Three', 9),
		]);
		expect(titles(repaired)).toEqual(['One', 'Two', 'Three']);
		expect(repaired.map(({ sequence }) => sequence)).toEqual([1024, 2048, 3072]);
	});

	it('moves a segment and normalizes only when the gap is exhausted', () => {
		const roomy = moveSegment(
			[segment('A', 1024), segment('B', 2048), segment('C', 3072)],
			'Novel/50_Manuscript/C.md',
			1,
		);
		expect(titles(roomy)).toEqual(['A', 'C', 'B']);
		expect(roomy.map(({ sequence }) => sequence)).toEqual([1024, 1536, 2048]);

		const tight = moveSegment(
			[segment('A', 1), segment('B', 2), segment('C', 3)],
			'Novel/50_Manuscript/C.md',
			1,
		);
		expect(titles(tight)).toEqual(['A', 'C', 'B']);
		expect(tight.map(({ sequence }) => sequence)).toEqual([1024, 2048, 3072]);
	});

	it('walks to the neighbours of a segment', () => {
		const segments = [segment('A', 1024), segment('B', 2048), segment('C', 3072)];
		const b = 'Novel/50_Manuscript/B.md';
		expect(segmentAt(segments, b)?.title).toBe('B');
		expect(previousSegment(segments, b)?.title).toBe('A');
		expect(nextSegment(segments, b)?.title).toBe('C');
		expect(previousSegment(segments, 'Novel/50_Manuscript/A.md')).toBeNull();
		expect(nextSegment(segments, 'Novel/50_Manuscript/C.md')).toBeNull();
		expect(segmentAt(segments, 'Novel/50_Manuscript/Missing.md')).toBeNull();
	});
});

describe('manuscript window', () => {
	const segments = Array.from({ length: 11 }, (_, index) =>
		segment(`Chapter ${index + 1}`, (index + 1) * RANK_GAP),
	);

	it('takes the requested slice around the active segment', () => {
		const window = windowAround(
			segments,
			'Novel/50_Manuscript/Chapter 6.md',
			2,
			2,
		);
		expect(titles(window.segments)).toEqual([
			'Chapter 4',
			'Chapter 5',
			'Chapter 6',
			'Chapter 7',
			'Chapter 8',
		]);
		expect(window.atStart).toBe(false);
		expect(window.atEnd).toBe(false);
	});

	it('reports the ends of the manuscript, not the ends of the slice', () => {
		const opening = windowAround(
			segments,
			'Novel/50_Manuscript/Chapter 1.md',
			5,
			5,
		);
		expect(opening.atStart).toBe(true);
		expect(opening.atEnd).toBe(false);

		const closing = windowAround(
			segments,
			'Novel/50_Manuscript/Chapter 11.md',
			5,
			5,
		);
		expect(closing.atStart).toBe(false);
		expect(closing.atEnd).toBe(true);

		// A window wide enough to hold everything sits at both ends at once.
		const whole = windowAround(
			segments,
			'Novel/50_Manuscript/Chapter 6.md',
			20,
			20,
		);
		expect(whole.segments).toHaveLength(11);
		expect(whole.atStart).toBe(true);
		expect(whole.atEnd).toBe(true);
	});

	it('anchors on the first segment when the active one is gone', () => {
		const window = windowAround(segments, 'Novel/50_Manuscript/Gone.md', 1, 1);
		expect(titles(window.segments)).toEqual(['Chapter 1', 'Chapter 2']);
		expect(window.atStart).toBe(true);
	});

	it('is empty, and at both ends, for a manuscript with nothing in it', () => {
		expect(windowAround([], 'anything', 5, 5)).toEqual({
			segments: [],
			atStart: true,
			atEnd: true,
		});
	});
});

describe('manuscript sequence issues', () => {
	it('separates a missing position from an unusable one', () => {
		const issues = findSequenceIssues([
			stored('Novel/50_Manuscript/Absent.md', undefined),
			stored('Novel/50_Manuscript/Blank.md', ''),
			stored('Novel/50_Manuscript/Text.md', 'first'),
			stored('Novel/50_Manuscript/Fraction.md', 12.5),
			stored('Novel/50_Manuscript/Good.md', 1024),
		]);

		expect(issues.missing).toEqual([
			'Novel/50_Manuscript/Absent.md',
			'Novel/50_Manuscript/Blank.md',
		]);
		expect(issues.invalid).toEqual([
			'Novel/50_Manuscript/Fraction.md',
			'Novel/50_Manuscript/Text.md',
		]);
		expect(issues.duplicate).toEqual([]);
		expect(hasSequenceIssues(issues)).toBe(true);
	});

	it('names every note sharing a position', () => {
		const issues = findSequenceIssues([
			stored('Novel/50_Manuscript/A.md', 2048),
			stored('Novel/50_Manuscript/B.md', 2048),
			stored('Novel/50_Manuscript/C.md', 3072),
		]);
		expect(issues.duplicate).toEqual([
			'Novel/50_Manuscript/A.md',
			'Novel/50_Manuscript/B.md',
		]);
	});

	it('finds nothing wrong with a well-ordered manuscript', () => {
		const issues = findSequenceIssues([
			stored('Novel/50_Manuscript/A.md', 1024),
			stored('Novel/50_Manuscript/B.md', 2048),
		]);
		expect(hasSequenceIssues(issues)).toBe(false);
	});
});
