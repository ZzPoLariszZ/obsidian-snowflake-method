import { describe, expect, it } from 'vitest';

import { captureRevision, orderRevisions } from '../../src/domain';
import {
	filterRevisionRows,
	revisionTableRows,
	type RevisionNoteReading,
	type RevisionRow,
} from '../../src/ui/revision-panel';

const ONE = '50_Manuscript/Chapter 1.md';
const TWO = '50_Manuscript/Chapter 2.md';
const BODY = 'The grey heron stood in the shallows, watching the water.';

const notes = (
	entries: [string, RevisionNoteReading][],
): Map<string, RevisionNoteReading> => new Map(entries);

describe('shaping the revision table', () => {
	it('orders rows by manuscript order, then by position in the chapter', () => {
		const rows = revisionTableRows(
			[
				captureRevision(TWO, BODY, 'replace', 4, 14, 'x', '', 'rev-b', 7),
				captureRevision(ONE, BODY, 'replace', 21, 24, 'x', '', 'rev-c', 7),
				captureRevision(ONE, BODY, 'replace', 4, 14, 'x', '', 'rev-a', 7),
			],
			notes([
				[ONE, { title: 'Chapter 1', body: BODY }],
				[TWO, { title: 'Chapter 2', body: BODY }],
			]),
		);
		expect(rows.map((row) => row.id)).toEqual(['rev-a', 'rev-c', 'rev-b']);
		expect(rows[0]).toMatchObject({
			title: 'Chapter 1',
			status: 'live',
			from: 4,
			to: 14,
			original: 'grey heron',
		});
	});

	it('orders by the rule the cards step through, ties broken alike', () => {
		// Two points at one spot: the table and the chevrons have to break the
		// tie the same way, or the list reads one order and walks another.
		const given = [
			captureRevision(ONE, BODY, 'insert', 14, 14, 'x', '', 'rev-z', 7),
			captureRevision(ONE, BODY, 'insert', 14, 14, 'y', '', 'rev-a', 7),
		];
		const rows = revisionTableRows(
			given,
			notes([[ONE, { title: 'Chapter 1', body: BODY }]]),
		);
		expect(rows.map((row) => row.id)).toEqual(['rev-a', 'rev-z']);
		expect(rows.map((row) => row.id)).toEqual(
			orderRevisions(given, [ONE]).map((revision) => revision.id),
		);
	});

	it('re-anchors against the body it is handed', () => {
		const grown = `Early. ${BODY}`;
		const rows = revisionTableRows(
			[captureRevision(ONE, BODY, 'replace', 4, 14, 'x', '', 'rev-a', 7)],
			notes([[ONE, { title: 'Chapter 1', body: grown }]]),
		);
		expect(rows[0]).toMatchObject({ status: 'live', from: 11, to: 21 });
	});

	it('an unreadable or unknown chapter makes its revisions conflicts', () => {
		const rows = revisionTableRows(
			[
				captureRevision(ONE, BODY, 'replace', 4, 14, 'x', '', 'rev-a', 7),
				captureRevision(TWO, BODY, 'delete', 4, 14, '', '', 'rev-b', 7),
			],
			notes([[ONE, { title: 'Chapter 1', body: null }]]),
		);
		expect(rows.map((row) => row.status)).toEqual(['conflict', 'conflict']);
		// The stored offsets stand in for a spot that cannot be derived.
		expect(rows[0]).toMatchObject({ from: 4, to: 14, title: 'Chapter 1' });
		// A chapter the manuscript never listed still names itself.
		expect(rows[1]?.title).toBe('Chapter 2.md');
	});

	it('an edited-inside range shows as a conflict beside its live peers', () => {
		const edited = BODY.replace('grey heron', 'grey-heron');
		const rows = revisionTableRows(
			[
				captureRevision(ONE, BODY, 'replace', 4, 14, 'x', '', 'rev-a', 7),
				// Far enough along that its sixteen-character context clears
				// the edit, and the same-length replacement leaves it anchored.
				captureRevision(ONE, BODY, 'insert', 37, 37, 'x', '', 'rev-b', 7),
			],
			notes([[ONE, { title: 'Chapter 1', body: edited }]]),
		);
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get('rev-a')?.status).toBe('conflict');
		expect(byId.get('rev-b')?.status).toBe('live');
	});
});

describe('searching the revision table', () => {
	const row = (over: Partial<RevisionRow>): RevisionRow => ({
		id: 'rev',
		path: ONE,
		title: 'Chapter 1',
		kind: 'replace',
		original: 'grey heron',
		proposed: 'grey egret',
		comment: '',
		status: 'live',
		from: 4,
		to: 14,
		...over,
	});
	const kindOf = (kind: RevisionRow['kind']): string =>
		({ replace: 'Replace', insert: 'Insert', delete: 'Delete' })[kind];

	it('keeps every row while nothing is typed', () => {
		const rows = [row({ id: 'a' }), row({ id: 'b' })];
		expect(filterRevisionRows(rows, '   ', kindOf).map((hit) => hit.id)).toEqual([
			'a',
			'b',
		]);
	});

	it('matches any of the words a row shows, whatever the case', () => {
		const rows = [
			row({ id: 'a', original: 'grey heron' }),
			row({ id: 'b', original: 'the water', proposed: 'the shallows' }),
			row({ id: 'c', original: 'dusk', comment: 'Ask about the HERON' }),
			row({ id: 'd', original: 'dawn', title: 'Heron Chapter' }),
		];
		expect(filterRevisionRows(rows, 'heron', kindOf).map((hit) => hit.id)).toEqual(
			['a', 'c', 'd'],
		);
		expect(
			filterRevisionRows(rows, 'shallows', kindOf).map((hit) => hit.id),
		).toEqual(['b']);
	});

	it('matches the kind as the reader is shown it, not as it is stored', () => {
		const rows = [
			row({ id: 'a', kind: 'insert' }),
			row({ id: 'b', kind: 'delete' }),
		];
		expect(filterRevisionRows(rows, 'Insert', kindOf).map((hit) => hit.id)).toEqual(
			['a'],
		);
		// A kind named in another language finds nothing here, which is the
		// point: the table is searched in the words it is drawn in.
		expect(filterRevisionRows(rows, '插入', kindOf)).toEqual([]);
	});

	it('leaves the rows it was handed alone', () => {
		const rows = [row({ id: 'a' }), row({ id: 'b', original: 'dusk' })];
		filterRevisionRows(rows, 'dusk', kindOf);
		expect(rows.map((hit) => hit.id)).toEqual(['a', 'b']);
	});
});
