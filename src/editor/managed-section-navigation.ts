import {
	findManagedMarkerIssues,
	getProtectedMarkerRanges,
	inspectMarkedSection,
	sectionMarkers,
} from '../templates';

export interface ManagedHighlightRange {
	highlightFrom: number;
	highlightTo: number;
}

export interface ManagedSectionNavigationTarget {
	sectionId: string;
	cursorOffset: number;
	highlightFrom: number;
	highlightTo: number;
}

export interface ManagedMarkerIssueNavigationTarget {
	sectionId: string;
	cursorOffset: number;
	highlightRanges: ManagedHighlightRange[];
}

export function resolveManagedSectionNavigationTarget(
	content: string,
	sectionId: string,
): ManagedSectionNavigationTarget | null {
	const blockingIssue = findManagedMarkerIssues(content, [sectionId]).find(
		(issue) =>
			issue.code !== 'unknown-section' &&
			(issue.sectionId === sectionId || issue.relatedSectionId === sectionId),
	);
	if (blockingIssue !== undefined) return null;

	const health = inspectMarkedSection(content, sectionId);
	if (health.status !== 'present') return null;

	const sectionContent = content.slice(health.contentStart, health.contentEnd);
	const contentWithoutTrailingWhitespace = sectionContent.replace(/\s+$/u, '');
	const cursorOffset =
		contentWithoutTrailingWhitespace.length === 0
			? health.contentStart
			: health.contentStart + contentWithoutTrailingWhitespace.length;
	const markers = sectionMarkers(sectionId);

	return {
		sectionId,
		cursorOffset,
		highlightFrom: health.start,
		highlightTo: health.end + markers.end.length,
	};
}

export function resolveManagedSectionNavigationTargets(
	content: string,
	sectionIds: readonly string[],
): ManagedSectionNavigationTarget[] | null {
	const targets: ManagedSectionNavigationTarget[] = [];
	for (const sectionId of [...new Set(sectionIds)]) {
		const target = resolveManagedSectionNavigationTarget(content, sectionId);
		if (target === null) return null;
		targets.push(target);
	}
	return targets.length > 0 ? targets : null;
}

/**
 * Locates marker lines that can be reviewed without guessing where missing
 * structure should be recreated. If both markers are absent, there is no safe
 * anchor and this intentionally returns null.
 */
export function resolveManagedMarkerIssueNavigationTarget(
	content: string,
	sectionId: string,
): ManagedMarkerIssueNavigationTarget | null {
	const issues = findManagedMarkerIssues(content, [sectionId]).filter(
		(issue) =>
			issue.code !== 'unknown-section' &&
			(issue.sectionId === sectionId || issue.relatedSectionId === sectionId),
	);
	if (issues.length === 0) return null;

	const affectedSectionIds = new Set<string>([sectionId]);
	for (const issue of issues) {
		if (issue.sectionId !== null) affectedSectionIds.add(issue.sectionId);
		if (issue.relatedSectionId !== undefined) {
			affectedSectionIds.add(issue.relatedSectionId);
		}
	}

	const candidates: Array<ManagedHighlightRange & { cursorOffset: number }> = [];
	for (const marker of getProtectedMarkerRanges(content)) {
		if (!affectedSectionIds.has(marker.sectionId)) continue;
		candidates.push({
			highlightFrom: marker.from,
			highlightTo: marker.to,
			cursorOffset: marker.markerFrom,
		});
	}
	const uniqueCandidates = [
		...new Map(
			candidates.map((candidate) => [
				`${candidate.highlightFrom}:${candidate.highlightTo}`,
				candidate,
			]),
		).values(),
	].sort((left, right) => left.highlightFrom - right.highlightFrom);
	const first = uniqueCandidates[0];
	if (first === undefined) return null;

	return {
		sectionId,
		cursorOffset: first.cursorOffset,
		highlightRanges: uniqueCandidates.map(
			({ highlightFrom, highlightTo }) => ({ highlightFrom, highlightTo }),
		),
	};
}

export function managedSectionHighlightLineStarts(
	content: string,
	target: ManagedHighlightRange,
): number[] {
	const starts: number[] = [];
	let position = lineStartAt(content, target.highlightFrom);
	while (position < target.highlightTo) {
		starts.push(position);
		const nextBreak = content.indexOf('\n', position);
		if (nextBreak < 0 || nextBreak + 1 <= position) break;
		position = nextBreak + 1;
	}
	return starts;
}

function lineStartAt(content: string, offset: number): number {
	const previousBreak = content.lastIndexOf('\n', Math.max(0, offset - 1));
	return previousBreak < 0 ? 0 : previousBreak + 1;
}
