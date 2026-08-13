import { describe, expect, it } from 'vitest';

import { GENERATED_SECTION_IDS } from '../../src/domain';
import {
	changeIntersectsManagedBoundary,
	changeIntersectsReadOnlyContent,
	containsManagedMarkerText,
	findManagedBoundaryIntersections,
	pairManagedSections,
	scanManagedBoundaries,
} from '../../src/editor/managed-section-ranges';
import { MEMBER_FIELDS_SECTION_BY_DOCUMENT } from '../../src/services/mirror-sync';
import { renderMarkedSection, sectionMarkers } from '../../src/templates/markers';

describe('managed section editor ranges', () => {
	it('finds exact marker lines and pairs a complete section', () => {
		const source = `Before\n${renderMarkedSection('plot-synopsis', 'Editable text')}\nAfter`;
		const boundaries = scanManagedBoundaries(source);
		const sections = pairManagedSections(source, boundaries);

		expect(boundaries.map(({ sectionId, kind }) => ({ sectionId, kind }))).toEqual([
			{ sectionId: 'plot-synopsis', kind: 'start' },
			{ sectionId: 'plot-synopsis', kind: 'end' },
		]);
		expect(sections).toHaveLength(1);
		expect(source.slice(sections[0]!.contentFrom, sections[0]!.contentTo).trim()).toBe(
			'Editable text',
		);
		expect(sections[0]!.empty).toBe(false);
	});

	it('handles CRLF boundaries and empty content without consuming marker carriage returns', () => {
		const markers = sectionMarkers('scene-planning');
		const source = `Before\r\n${markers.start}\r\n\r\n${markers.end}`;
		const boundaries = scanManagedBoundaries(source);
		const sections = pairManagedSections(source, boundaries);

		expect(boundaries).toHaveLength(2);
		expect(source.slice(boundaries[0]!.from, boundaries[0]!.to)).toBe(markers.start);
		expect(boundaries[0]!.protectedTo - boundaries[0]!.to).toBe(2);
		expect(sections).toHaveLength(1);
		expect(sections[0]!.empty).toBe(true);
	});

	it('does not present duplicated or reversed layouts as editable section guides', () => {
		const markers = sectionMarkers('one-sentence-summary');
		const duplicated = `${markers.start}\n${markers.start}\n${markers.end}`;
		const reversed = `${markers.end}\n${markers.start}`;

		expect(pairManagedSections(duplicated)).toEqual([]);
		expect(pairManagedSections(reversed)).toEqual([]);
		expect(scanManagedBoundaries(duplicated)).toHaveLength(3);
	});

	it('allows typing in an empty managed body while protecting both boundary lines', () => {
		const source = renderMarkedSection('description');
		const boundaries = scanManagedBoundaries(source);
		const section = pairManagedSections(source, boundaries)[0]!;

		expect(section.empty).toBe(true);
		expect(
			boundaries.some((boundary) =>
				changeIntersectsManagedBoundary(
					{ from: section.contentFrom, to: section.contentFrom },
					boundary,
				),
			),
		).toBe(false);
		expect(
			changeIntersectsManagedBoundary(
				{ from: section.start.from, to: section.start.from },
				section.start,
			),
		).toBe(true);
		expect(
			changeIntersectsManagedBoundary(
				{ from: section.end.to, to: section.end.to },
				section.end,
			),
		).toBe(true);
	});

	it('blocks deletion of a boundary and either adjacent line break', () => {
		const source = `Heading\n${renderMarkedSection('description')}\nOutside`;
		const [start, end] = scanManagedBoundaries(source);
		expect(start).toBeDefined();
		expect(end).toBeDefined();

		expect(
			changeIntersectsManagedBoundary(
				{ from: start!.deletionFrom, to: start!.from },
				start!,
			),
		).toBe(true);
		expect(
			changeIntersectsManagedBoundary(
				{ from: start!.to, to: start!.protectedTo },
				start!,
			),
		).toBe(true);
		expect(
			changeIntersectsManagedBoundary(
				{ from: end!.protectedTo, to: end!.protectedTo + 1 },
				end!,
			),
		).toBe(false);
	});

	it('rejects an entire multi-change transaction when any change crosses a boundary', () => {
		const source = `Outside\n${renderMarkedSection('character-profile', 'Inside')}\nTail`;
		const boundaries = scanManagedBoundaries(source);
		const changes = [
			{ from: 0, to: 0, insertedText: 'Safe ' },
			{
				from: boundaries[0]!.deletionFrom,
				to: boundaries[0]!.protectedTo,
				insertedText: '',
			},
		];

		const intersections = findManagedBoundaryIntersections(changes, boundaries);
		expect(intersections).not.toHaveLength(0);
		expect(intersections.some(({ boundary }) => boundary.kind === 'start')).toBe(true);
	});

	it('detects pasted marker syntax even when it is outside an existing boundary', () => {
		expect(
			containsManagedMarkerText(
				'<!-- snowflake:section:one-paragraph-summary:start -->',
			),
		).toBe(true);
		expect(containsManagedMarkerText('ordinary Markdown')).toBe(false);
	});

	it('filters editor boundaries to the current document contract', () => {
		const source = [
			'<!-- snowflake:section:audiene-reason-1:start -->',
			'<!-- snowflake:section:audience-reason-1:end -->',
		].join('\n');

		expect(
			scanManagedBoundaries(source, ['audience-reason-1']).map(
				({ sectionId, kind }) => ({ sectionId, kind }),
			),
		).toEqual([{ sectionId: 'audience-reason-1', kind: 'end' }]);
	});
});

describe('read-only generated section ranges', () => {
	const content = `# Ada\n\n${renderMarkedSection(
		'character-fields',
		'> [!info] Character overview\n> **Type**: Major character',
	)}\n\nProse after the block.\n`;
	const section = pairManagedSections(content).find(
		(candidate) => candidate.sectionId === 'character-fields',
	)!;

	it('registers the same generated ids the reconcile maintains', () => {
		// A definition node's block is generated and reconciled too, from
		// where its folder sits rather than from a member's properties, so it
		// keeps its own pass and joins the member sections here.
		expect([...GENERATED_SECTION_IDS].sort()).toEqual(
			[
				...Object.values(MEMBER_FIELDS_SECTION_BY_DOCUMENT),
				'definition-fields',
			].sort(),
		);
	});

	it('blocks typing anywhere inside the block content', () => {
		const inside = content.indexOf('**Type**');
		expect(
			changeIntersectsReadOnlyContent(
				{ from: inside, to: inside, insertedText: 'x' },
				section,
			),
		).toBe(true);
		expect(
			changeIntersectsReadOnlyContent(
				{ from: section.contentFrom, to: section.contentFrom, insertedText: 'x' },
				section,
			),
		).toBe(true);
		expect(
			changeIntersectsReadOnlyContent(
				{ from: section.contentTo, to: section.contentTo, insertedText: 'x' },
				section,
			),
		).toBe(true);
	});

	it('blocks deletions and replacements overlapping the content', () => {
		const inside = content.indexOf('**Type**');
		expect(
			changeIntersectsReadOnlyContent({ from: inside, to: inside + 4 }, section),
		).toBe(true);
		expect(
			changeIntersectsReadOnlyContent(
				{ from: 0, to: content.length },
				section,
			),
		).toBe(true);
	});

	it('leaves the prose around the block editable', () => {
		const before = content.indexOf('# Ada');
		const after = content.indexOf('Prose after');
		expect(
			changeIntersectsReadOnlyContent(
				{ from: before, to: before, insertedText: 'x' },
				section,
			),
		).toBe(false);
		expect(
			changeIntersectsReadOnlyContent(
				{ from: after, to: after + 5, insertedText: 'y' },
				section,
			),
		).toBe(false);
	});

	it('protects the empty point of a section with nothing in it', () => {
		const empty = renderMarkedSection('scene-fields', '');
		const emptySection = pairManagedSections(empty).find(
			(candidate) => candidate.sectionId === 'scene-fields',
		)!;
		expect(
			changeIntersectsReadOnlyContent(
				{
					from: emptySection.contentFrom,
					to: emptySection.contentFrom,
					insertedText: 'x',
				},
				emptySection,
			),
		).toBe(true);
	});
});
