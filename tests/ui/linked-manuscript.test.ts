import { describe, expect, it } from 'vitest';

import {
	linkedManuscriptPreview,
	orderLinkedManuscript,
	orderManuscriptReferences,
} from '../../src/ui/linked-manuscript';

// Stream order is chosen by the author and need not match the titles or paths.
const manuscript = [
	'Novel/Manuscript/Zebra.md',
	'Novel/Manuscript/First light.md',
	'Novel/Manuscript/Arrival.md',
];

const resolveTarget = (target: string): string | null => {
	const decoded = decodeURIComponent(target).replace(/\.md$/u, '');
	return manuscript.find((path) => path.replace(/\.md$/u, '').endsWith(decoded)) ?? null;
};

describe('linked manuscript display order', () => {
	it('follows manuscript order while preserving the stored array', () => {
		const stored = [
			'[[Novel/Manuscript/Arrival]]',
			'[[Novel/Manuscript/Zebra]]',
			'[[Novel/Manuscript/First light]]',
		];
		expect(orderLinkedManuscript(stored, manuscript, resolveTarget)).toEqual([
			stored[1], stored[2], stored[0],
		]);
		expect(stored[0]).toBe('[[Novel/Manuscript/Arrival]]');
	});

	it('puts a removed and re-added note back into its manuscript position', () => {
		const arrival = '[[Novel/Manuscript/Arrival]]';
		const zebra = '[[Novel/Manuscript/Zebra]]';
		const light = '[[Novel/Manuscript/First light]]';
		const afterRemoval = [zebra, light, arrival].filter((link) => link !== zebra);
		expect(orderLinkedManuscript([...afterRemoval, zebra], manuscript, resolveTarget)).toEqual([
			zebra, light, arrival,
		]);
	});

	it('resolves aliases, headings, shortened paths and encoded spaces without rewriting links', () => {
		const stored = [
			'[[Arrival#At the gate|The ending]]',
			'[[First%20light#^opening|Sunrise]]',
			'[[Zebra|Prologue]]',
		];
		expect(orderLinkedManuscript(stored, manuscript, resolveTarget)).toEqual([
			stored[2], stored[1], stored[0],
		]);
	});

	it('keeps missing, non-manuscript and invalid links at the end in their existing order', () => {
		const stored = [
			'[[Missing]]',
			'[[Arrival]]',
			'[[Character]]',
			'Unlinked text',
			'[[Zebra]]',
		];
		expect(orderLinkedManuscript(stored, manuscript, (target) =>
			target === 'Character' ? 'Novel/Characters/Character.md' : resolveTarget(target),
		)).toEqual([
			stored[4], stored[1], stored[0], stored[2], stored[3],
		]);
	});

	it('keeps links to different parts of the same note in their existing order', () => {
		const stored = ['[[Arrival]]', '[[Zebra#Middle]]', '[[Zebra#Beginning]]'];
		expect(orderLinkedManuscript(stored, manuscript, resolveTarget)).toEqual([
			stored[1], stored[2], stored[0],
		]);
	});
});

describe('linked manuscript card preview', () => {
	const positions = new Map(manuscript.map((path, index) => [path, index]));
	const references = [
		{ raw: '[[Arrival#At the gate|The ending]]', target: 'Arrival', label: 'The ending' },
		{ raw: '[[Zebra|Prologue]]', target: 'Zebra', label: 'Prologue' },
		{ raw: '[[First%20light#^opening|Sunrise]]', target: 'First%20light', label: 'Sunrise' },
	];

	it('shows the first and last manuscript in reading order while retaining their exact link data', () => {
		const ordered = orderManuscriptReferences(references, positions, (link) => resolveTarget(link.target));
		const preview = linkedManuscriptPreview(ordered);
		expect(preview.shown).toEqual([references[1], references[0]]);
		expect(preview.shown[0]).toBe(references[1]);
		expect(preview.shown[1]).toBe(references[0]);
		expect(preview.remaining).toBe(1);
		expect(references.map((link) => link.label)).toEqual(['The ending', 'Prologue', 'Sunrise']);
	});

	it('counts every omitted middle link and keeps missing links available at the end', () => {
		const missing = { raw: '[[Missing]]', target: 'Missing', label: 'Missing' };
		const ordered = orderManuscriptReferences([missing, ...references], positions, (link) => resolveTarget(link.target));
		expect(linkedManuscriptPreview(ordered)).toEqual({
			shown: [references[1], missing],
			remaining: 2,
		});
	});

	it.each([0, 1, 2])('shows all %i links without a repeated endpoint or overflow count', (count) => {
		const links = references.slice(0, count);
		expect(linkedManuscriptPreview(links)).toEqual({ shown: links, remaining: 0 });
	});
});
