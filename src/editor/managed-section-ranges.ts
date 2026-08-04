import {
	getProtectedMarkerRanges,
	SECTION_MARKER_PREFIX,
} from '../templates/markers';

export type ManagedBoundaryKind = 'start' | 'end';

export interface ManagedBoundaryRange {
	sectionId: string;
	kind: ManagedBoundaryKind;
	/** Full marker line, excluding its line break. */
	from: number;
	to: number;
	/** The marker line plus its following line break, when present. */
	protectedTo: number;
	/** Includes the preceding line break for destructive changes only. */
	deletionFrom: number;
	/** A final marker has no following line break, so insertion at `to` is unsafe. */
	protectInsertionAtTo: boolean;
}

export interface ManagedSectionRange {
	sectionId: string;
	start: ManagedBoundaryRange;
	end: ManagedBoundaryRange;
	contentFrom: number;
	contentTo: number;
	empty: boolean;
}

export interface TextChangeRange {
	from: number;
	to: number;
	insertedText?: string;
}

export interface ProtectedChangeIntersection {
	change: TextChangeRange;
	boundary: ManagedBoundaryRange;
}

/**
 * Finds exact Snowflake boundary lines without assigning any schema meaning to
 * their section ids. The canonical registry is intentionally supplied by the
 * caller, while this scanner remains useful for damaged or future documents.
 */
export function scanManagedBoundaries(
	content: string,
	sectionIds?: readonly string[],
): ManagedBoundaryRange[] {
	const expected = sectionIds === undefined ? null : new Set(sectionIds);
	return getProtectedMarkerRanges(content)
		.filter((range) => expected === null || expected.has(range.sectionId))
		.map((range) => {
			const to = lineContentEnd(content, range.to);
			return {
				sectionId: range.sectionId,
				kind: range.boundary,
				from: range.from,
				to,
				protectedTo: range.to,
				deletionFrom: precedingLineBreakStart(content, range.from),
				protectInsertionAtTo: range.to === to,
			};
		});
}

/**
 * Returns only unambiguous one-start/one-end pairs. Invalid layouts still have
 * their individual boundary lines protected, but do not receive an editable
 * section guide that could imply the document is healthy.
 */
export function pairManagedSections(
	content: string,
	boundaries = scanManagedBoundaries(content),
): ManagedSectionRange[] {
	const bySection = new Map<string, ManagedBoundaryRange[]>();
	for (const boundary of boundaries) {
		const group = bySection.get(boundary.sectionId) ?? [];
		group.push(boundary);
		bySection.set(boundary.sectionId, group);
	}

	const sections: ManagedSectionRange[] = [];
	for (const [sectionId, group] of bySection) {
		const starts = group.filter((boundary) => boundary.kind === 'start');
		const ends = group.filter((boundary) => boundary.kind === 'end');
		const start = starts[0];
		const end = ends[0];
		if (starts.length !== 1 || ends.length !== 1 || !start || !end || end.from <= start.from) {
			continue;
		}

		const contentFrom = start.protectedTo;
		const contentTo = end.from;
		sections.push({
			sectionId,
			start,
			end,
			contentFrom,
			contentTo,
			empty: content.slice(contentFrom, contentTo).trim().length === 0,
		});
	}

	return sections.sort((left, right) => left.start.from - right.start.from);
}

export function changeIntersectsManagedBoundary(
	change: TextChangeRange,
	boundary: ManagedBoundaryRange,
): boolean {
	if (change.from === change.to) {
		return (
			change.from >= boundary.from &&
			(change.from < boundary.protectedTo ||
				(boundary.protectInsertionAtTo && change.from === boundary.to))
		);
	}

	return change.from < boundary.protectedTo && change.to > boundary.deletionFrom;
}

export function findManagedBoundaryIntersections(
	changes: readonly TextChangeRange[],
	boundaries: readonly ManagedBoundaryRange[],
): ProtectedChangeIntersection[] {
	const intersections: ProtectedChangeIntersection[] = [];
	for (const change of changes) {
		for (const boundary of boundaries) {
			if (changeIntersectsManagedBoundary(change, boundary)) {
				intersections.push({ change, boundary });
			}
		}
	}
	return intersections;
}

export function containsManagedMarkerText(text: string): boolean {
	return text.includes(`${SECTION_MARKER_PREFIX}:`);
}

function precedingLineBreakStart(content: string, lineFrom: number): number {
	if (lineFrom === 0) return 0;
	if (lineFrom >= 2 && content.slice(lineFrom - 2, lineFrom) === '\r\n') {
		return lineFrom - 2;
	}
	return lineFrom - 1;
}

function lineContentEnd(content: string, lineTo: number): number {
	if (lineTo > 0 && content[lineTo - 1] === '\n') {
		return lineTo > 1 && content[lineTo - 2] === '\r' ? lineTo - 2 : lineTo - 1;
	}
	return lineTo;
}
