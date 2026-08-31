import { describe, expect, it } from 'vitest';

import { captureRevision } from '../../src/domain';
import {
	revisionTableRows,
	type RevisionNoteReading,
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
				[ONE, { title: 'Chapter 1', ordinal: 0, body: BODY }],
				[TWO, { title: 'Chapter 2', ordinal: 1, body: BODY }],
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

	it('re-anchors against the body it is handed', () => {
		const grown = `Early. ${BODY}`;
		const rows = revisionTableRows(
			[captureRevision(ONE, BODY, 'replace', 4, 14, 'x', '', 'rev-a', 7)],
			notes([[ONE, { title: 'Chapter 1', ordinal: 0, body: grown }]]),
		);
		expect(rows[0]).toMatchObject({ status: 'live', from: 11, to: 21 });
	});

	it('an unreadable or unknown chapter makes its revisions conflicts', () => {
		const rows = revisionTableRows(
			[
				captureRevision(ONE, BODY, 'replace', 4, 14, 'x', '', 'rev-a', 7),
				captureRevision(TWO, BODY, 'delete', 4, 14, '', '', 'rev-b', 7),
			],
			notes([[ONE, { title: 'Chapter 1', ordinal: 0, body: null }]]),
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
			notes([[ONE, { title: 'Chapter 1', ordinal: 0, body: edited }]]),
		);
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get('rev-a')?.status).toBe('conflict');
		expect(byId.get('rev-b')?.status).toBe('live');
	});
});
