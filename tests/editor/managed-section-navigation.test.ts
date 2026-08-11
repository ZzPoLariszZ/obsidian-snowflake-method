import { describe, expect, it } from 'vitest';

import {
	managedSectionHighlightsForStep,
	primaryManagedSectionForStep,
} from '../../src/domain';
import {
	managedSectionHighlightLineStarts,
	resolveManagedMarkerIssueNavigationTarget,
	resolveManagedSectionNavigationTarget,
	resolveManagedSectionNavigationTargets,
} from '../../src/editor/managed-section-navigation';
import { renderMarkedSection, sectionMarkers } from '../../src/templates/markers';

describe('managed section navigation', () => {
	it('maps each managed writing step to its primary safe section', () => {
		expect(
			([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((step) =>
				primaryManagedSectionForStep(step),
			),
		).toEqual([
			'one-sentence-summary',
			'one-paragraph-summary',
			'one-paragraph-storyline',
			'plot-synopsis',
			'character-synopsis',
			'long-synopsis',
			'character-profile',
			'scene-events',
			'scene-planning',
			null,
		]);
	});

	it('highlights the fields block beside the prose on the steps that fill it', () => {
		expect(primaryManagedSectionForStep(8)).toBe('scene-events');
		expect(managedSectionHighlightsForStep(8)).toEqual([
			'scene-fields',
			'scene-events',
		]);
		expect(managedSectionHighlightsForStep(3)).toEqual([
			'character-fields',
			'one-paragraph-storyline',
		]);
		expect(managedSectionHighlightsForStep(9)).toEqual(['scene-planning']);
		expect(managedSectionHighlightsForStep(5)).toEqual(['character-synopsis']);
	});

	it('places an empty section cursor at its first safe content offset', () => {
		const content = `# Heading\n\n${renderMarkedSection('one-sentence-summary')}`;
		const target = resolveManagedSectionNavigationTarget(
			content,
			'one-sentence-summary',
		);

		expect(target).not.toBeNull();
		expect(
			content
				.slice(target!.cursorOffset)
				.startsWith('\n<!-- snowflake:section:one-sentence-summary:end -->'),
		).toBe(true);
	});

	it('places a filled section cursor after its final non-whitespace character', () => {
		const content = renderMarkedSection(
			'character-profile',
			'First paragraph.\n\nSecond paragraph.   ',
		);
		const target = resolveManagedSectionNavigationTarget(
			content,
			'character-profile',
		);

		expect(target).not.toBeNull();
		expect(
			content.slice(0, target!.cursorOffset).endsWith('Second paragraph.'),
		).toBe(true);
		expect(content[target!.cursorOffset]).toBe(' ');
	});

	it('handles CRLF content and preserves Unicode text offsets', () => {
		const markers = sectionMarkers('scene-planning');
		const content = `${markers.start}\r\n中文内容。\r\n${markers.end}`;
		const target = resolveManagedSectionNavigationTarget(content, 'scene-planning');

		expect(target).not.toBeNull();
		expect(content.slice(0, target!.cursorOffset).endsWith('中文内容。')).toBe(
			true,
		);
		expect(content.slice(target!.highlightFrom, target!.highlightTo)).toBe(content);
	});

	it('covers both boundary lines and every content line without adjacent sections', () => {
		const first = renderMarkedSection('scene-conflict', 'Line one\nLine two');
		const second = renderMarkedSection('scene-events', 'Outside');
		const content = `${first}\n${second}`;
		const target = resolveManagedSectionNavigationTarget(content, 'scene-conflict');

		expect(target).not.toBeNull();
		expect(managedSectionHighlightLineStarts(content, target!)).toHaveLength(4);
		expect(content.slice(target!.highlightFrom, target!.highlightTo)).toBe(first);
	});

	it('resolves both scene sections for one coordinated highlight', () => {
		const conflict = renderMarkedSection('scene-conflict', 'The door is locked.');
		const events = renderMarkedSection('scene-events', 'The alarm sounds.');
		const content = `${conflict}\n\n${events}`;
		const targets = resolveManagedSectionNavigationTargets(content, [
			'scene-conflict',
			'scene-events',
		]);

		expect(targets?.map((target) => target.sectionId)).toEqual([
			'scene-conflict',
			'scene-events',
		]);
		expect(content.slice(0, targets?.[0]?.cursorOffset)).toContain(
			'The door is locked.',
		);
	});

	it('does not partially highlight a scene when either target is damaged', () => {
		const content = renderMarkedSection('scene-conflict', 'Conflict');
		expect(
			resolveManagedSectionNavigationTargets(content, [
				'scene-conflict',
				'scene-events',
			]),
		).toBeNull();
	});

	it('rejects missing, duplicated, reversed, noncanonical, and overlapping markers', () => {
		const markers = sectionMarkers('plot-synopsis');
		const other = sectionMarkers('long-synopsis');
		const invalid = [
			'No markers',
			`${markers.start}\n${markers.start}\n${markers.end}`,
			`${markers.end}\n${markers.start}`,
			'<!-- snowflake : section : plot-synopsis : start -->\nText',
			`${markers.start}\n${other.start}\n${markers.end}\n${other.end}`,
		];

		for (const content of invalid) {
			expect(
				resolveManagedSectionNavigationTarget(content, 'plot-synopsis'),
			).toBeNull();
		}
	});

	it('locates the remaining end marker when the start marker is missing', () => {
		const markers = sectionMarkers('plot-synopsis');
		const content = `# Plot\n\n${markers.end}\n`;
		const target = resolveManagedMarkerIssueNavigationTarget(
			content,
			'plot-synopsis',
		);

		expect(target?.cursorOffset).toBe(content.indexOf(markers.end));
		expect(target?.highlightRanges).toHaveLength(1);
		expect(
			content.slice(
				target!.highlightRanges[0]!.highlightFrom,
				target!.highlightRanges[0]!.highlightTo,
			),
		).toBe(`${markers.end}\n`);
	});

	it('locates the remaining start marker when the end marker is missing', () => {
		const markers = sectionMarkers('long-synopsis');
		const content = `${markers.start}\nUnbounded content`;
		const target = resolveManagedMarkerIssueNavigationTarget(
			content,
			'long-synopsis',
		);

		expect(target?.cursorOffset).toBe(0);
		expect(target?.highlightRanges).toHaveLength(1);
		expect(target?.highlightRanges[0]?.highlightTo).toBe(
			markers.start.length + 1,
		);
	});

	it('highlights every identifiable marker for duplicate and reversed damage', () => {
		const markers = sectionMarkers('character-profile');
		const duplicate = `${markers.start}\n${markers.start}\n${markers.end}`;
		const reversed = `${markers.end}\nText\n${markers.start}`;

		expect(
			resolveManagedMarkerIssueNavigationTarget(
				duplicate,
				'character-profile',
			)?.highlightRanges,
		).toHaveLength(3);
		expect(
			resolveManagedMarkerIssueNavigationTarget(
				reversed,
				'character-profile',
			)?.highlightRanges,
		).toHaveLength(2);
	});

	it('uses only canonical anchors for noncanonical and overlapping markers', () => {
		const plot = sectionMarkers('plot-synopsis');
		const long = sectionMarkers('long-synopsis');
		const noncanonical = `<!-- snowflake : section : plot-synopsis : start -->\n${plot.end}`;
		const overlap = `${plot.start}\n${long.start}\n${plot.end}\n${long.end}`;

		expect(
			resolveManagedMarkerIssueNavigationTarget(
				noncanonical,
				'plot-synopsis',
			)?.highlightRanges,
		).toHaveLength(1);
		expect(
			resolveManagedMarkerIssueNavigationTarget(
				overlap,
				'plot-synopsis',
			)?.highlightRanges,
		).toHaveLength(4);
	});

	it('does not guess a location when both markers are missing', () => {
		expect(
			resolveManagedMarkerIssueNavigationTarget(
				'# Plot\n\nExisting prose',
				'plot-synopsis',
			),
		).toBeNull();
	});
});
