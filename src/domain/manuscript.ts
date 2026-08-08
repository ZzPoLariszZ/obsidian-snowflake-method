import {
	RANK_GAP,
	moveRanked,
	rankBetween,
	repairRanks,
	sortByRank,
	type Ranked,
} from './rank';

/**
 * A manuscript segment is one note of a project's manuscript: a chapter, a
 * scene, an interlude, or whatever unit the author writes in. Its position is
 * the only thing the plugin stores about it, because everything else in the
 * note is the author's prose.
 *
 * The path is the identity. Nothing links to a segment the way a scene links to
 * a character, so a segment needs no stable id of its own -- and a prose file
 * should carry as little of the plugin's bookkeeping as it can.
 */
export interface ManuscriptSegment {
	path: string;
	projectId: string;
	/** The note's file name. The heading inside it belongs to the author. */
	title: string;
	sequence: number;
	/** False when `sequence` is the fallback because the note stores none. */
	hasStoredSequence: boolean;
}

/** A discovered note, before the manuscript decides where it sits. */
export interface StoredSegment {
	path: string;
	projectId: string;
	title: string;
	/** The frontmatter value as written, so an unusable one can be named. */
	storedSequence: unknown;
}

export interface ManuscriptWindow<T = ManuscriptSegment> {
	segments: T[];
	/** True when the first loaded segment is the manuscript's first. */
	atStart: boolean;
	/** True when the last loaded segment is the manuscript's last. */
	atEnd: boolean;
}

export interface SequenceIssues {
	/** Notes storing no sequence at all. */
	missing: string[];
	/** Notes storing something that is not a safe integer. */
	invalid: string[];
	/** Notes sharing a position with another note. */
	duplicate: string[];
}

/** The stored value as a position, or null when the note does not carry one. */
export function readStoredSequence(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value)
		? value
		: null;
}

/**
 * Puts discovered notes in reading order.
 *
 * A note carrying no usable sequence goes to the end rather than to the front,
 * in path order: a file that appeared in the manuscript folder without one was
 * put there by hand, and the end is the only place that is certainly not in the
 * middle of somebody's chapter. The health check then offers it a real position.
 */
export function resolveSegments(
	stored: readonly StoredSegment[],
): ManuscriptSegment[] {
	const sequenced: ManuscriptSegment[] = [];
	const unsequenced: StoredSegment[] = [];
	for (const entry of stored) {
		const sequence = readStoredSequence(entry.storedSequence);
		if (sequence === null) {
			unsequenced.push(entry);
			continue;
		}
		sequenced.push({
			path: entry.path,
			projectId: entry.projectId,
			title: entry.title,
			sequence,
			hasStoredSequence: true,
		});
	}

	const ordered = sortSegments(sequenced);
	let next = sequenceAtEnd(ordered);
	for (const entry of [...unsequenced].sort((left, right) =>
		left.path.localeCompare(right.path, 'en', { numeric: true }),
	)) {
		ordered.push({
			path: entry.path,
			projectId: entry.projectId,
			title: entry.title,
			sequence: next,
			hasStoredSequence: false,
		});
		next = Number.isSafeInteger(next + RANK_GAP) ? next + RANK_GAP : next;
	}
	return ordered;
}

export function sortSegments(
	segments: readonly ManuscriptSegment[],
): ManuscriptSegment[] {
	return unwrap(sortByRank(wrap(segments)));
}

/** A position between two neighbours, or null when the manuscript needs repair. */
export function sequenceBetween(
	before?: number | null,
	after?: number | null,
): number | null {
	return rankBetween(before, after);
}

/** The position a segment appended to the manuscript takes. */
export function sequenceAtEnd(
	segments: readonly ManuscriptSegment[],
): number {
	const last = segments[segments.length - 1];
	return sequenceBetween(last?.sequence, null) ?? RANK_GAP;
}

/** Regular intervals in the manuscript's current order. Positions only. */
export function repairSequences(
	segments: readonly ManuscriptSegment[],
): ManuscriptSegment[] {
	return unwrap(repairRanks(wrap(segments)));
}

export function moveSegment(
	segments: readonly ManuscriptSegment[],
	path: string,
	toIndex: number,
): ManuscriptSegment[] {
	return unwrap(moveRanked(wrap(segments), path, toIndex));
}

/**
 * Walking and slicing need nothing of a segment but where its note is, so they
 * take anything that says: the view holds its own shape for a segment and this
 * is what lets it use the same rules rather than a copy of them.
 */
export interface Located {
	path: string;
}

export function segmentAt<T extends Located>(
	segments: readonly T[],
	path: string,
): T | null {
	return segments.find((segment) => segment.path === path) ?? null;
}

export function previousSegment<T extends Located>(
	segments: readonly T[],
	path: string,
): T | null {
	const index = segments.findIndex((segment) => segment.path === path);
	return index > 0 ? (segments[index - 1] ?? null) : null;
}

export function nextSegment<T extends Located>(
	segments: readonly T[],
	path: string,
): T | null {
	const index = segments.findIndex((segment) => segment.path === path);
	return index === -1 ? null : (segments[index + 1] ?? null);
}

/**
 * The slice of the manuscript to hold in memory around the active segment.
 *
 * `atStart` and `atEnd` describe the manuscript, not the slice, which is the
 * whole point of computing them here: a window that happens to end where it was
 * told to stop must not be mistaken for the end of the book, or the author is
 * offered a new chapter in the middle of the one they are reading.
 */
export function windowAround<T extends Located>(
	segments: readonly T[],
	activePath: string,
	before: number,
	after: number,
): ManuscriptWindow<T> {
	if (segments.length === 0) {
		return { segments: [], atStart: true, atEnd: true };
	}
	const active = segments.findIndex((segment) => segment.path === activePath);
	const anchor = active === -1 ? 0 : active;
	const first = Math.max(0, anchor - Math.max(0, before));
	const last = Math.min(segments.length - 1, anchor + Math.max(0, after));
	return {
		segments: segments.slice(first, last + 1),
		atStart: first === 0,
		atEnd: last === segments.length - 1,
	};
}

/**
 * Everything wrong with the positions this manuscript stores. Reported apart
 * from one another because each is mended differently, and because a note
 * carrying nothing is a different thing to say than a note carrying nonsense.
 */
export function findSequenceIssues(
	stored: readonly StoredSegment[],
): SequenceIssues {
	const issues: SequenceIssues = { missing: [], invalid: [], duplicate: [] };
	// A manuscript of one note has no order to get wrong, so it is never asked
	// to store one. That is what lets every project written before manuscripts
	// existed -- each of them a single draft -- carry on without being told
	// something is broken, and lets an author who wants one file keep one file.
	if (stored.length < 2) return issues;
	const bySequence = new Map<number, string[]>();
	for (const entry of stored) {
		const sequence = readStoredSequence(entry.storedSequence);
		if (sequence === null) {
			if (
				entry.storedSequence === undefined ||
				entry.storedSequence === null ||
				entry.storedSequence === ''
			) {
				issues.missing.push(entry.path);
			} else {
				issues.invalid.push(entry.path);
			}
			continue;
		}
		bySequence.set(sequence, [...(bySequence.get(sequence) ?? []), entry.path]);
	}
	for (const paths of bySequence.values()) {
		if (paths.length > 1) issues.duplicate.push(...paths);
	}
	issues.missing.sort();
	issues.invalid.sort();
	issues.duplicate.sort();
	return issues;
}

export function hasSequenceIssues(issues: SequenceIssues): boolean {
	return (
		issues.missing.length > 0 ||
		issues.invalid.length > 0 ||
		issues.duplicate.length > 0
	);
}

/**
 * The shared ordering module speaks of ranks and ids; a manuscript speaks of
 * sequences and paths. The two words mean the same thing, so the translation
 * lives here rather than in either vocabulary.
 */
interface WrappedSegment extends Ranked {
	segment: ManuscriptSegment;
}

function wrap(segments: readonly ManuscriptSegment[]): WrappedSegment[] {
	return segments.map((segment) => ({
		id: segment.path,
		rank: segment.sequence,
		segment,
	}));
}

function unwrap(wrapped: readonly WrappedSegment[]): ManuscriptSegment[] {
	return wrapped.map(({ rank, segment }) =>
		segment.sequence === rank ? segment : { ...segment, sequence: rank },
	);
}
