import { describe, expect, it } from 'vitest';

import { EditorUnsavedError } from '../../api/errors';
import { isJsonObject } from '../../api/json';
import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';
import { document, operations } from './helpers/spec';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

const FIRST = '50_Manuscript/Chapter 1.md';
const SECOND = '50_Manuscript/Chapter 2.md';

interface Sent {
	params?: Body;
	body?: unknown;
	ifMatch?: string;
}

/**
 * One call of every change that closes an editor of the author's before it
 * writes. Each is asked while that editor cannot save what it holds: the
 * disk is full, or the file will not open.
 */
const CLOSES_AN_EDITOR: Record<string, (golden: Golden) => Sent> = {
	// Between the two chapters, so the second is renumbered and its editor closed.
	createManuscriptNote: () => ({ body: { after: FIRST, title: 'Interlude', body: 'An interlude.\n' } }),
	writeManuscriptNoteBody: () => ({ params: { notePath: FIRST }, body: { body: 'Other words.\n' }, ifMatch: '*' }),
	renameManuscriptNote: () => ({ params: { notePath: FIRST }, body: { title: 'Opening' } }),
	splitManuscriptNote: () => ({ params: { notePath: FIRST }, body: { at: { exact: 'stopped at midnight.' }, title: 'Cut' }, ifMatch: '*' }),
	mergeManuscriptNoteWithNext: () => ({ params: { notePath: FIRST } }),
	appendManuscriptNoteBody: () => ({ params: { notePath: FIRST }, body: { text: 'And then.' } }),
	moveManuscriptNote: () => ({ params: { notePath: FIRST }, body: { position: 'end' } }),
	deleteManuscriptNote: () => ({ params: { notePath: FIRST }, ifMatch: '*' }),
	acceptRevision: () => ({ params: { revisionId: 'revision-noon' } }),
	updateStickyNote: (golden) => ({ params: { stickyNoteId: golden.stickyNotes.key.id }, body: { body: 'Other words.' }, ifMatch: '*' }),
	deleteStickyNote: (golden) => ({ params: { stickyNoteId: golden.stickyNotes.key.id }, ifMatch: '*' }),
};

const send = (golden: Golden, operationId: string, sent: Sent) =>
	golden.call(operationId, { projectId: golden.project.id, ...sent.params }, { body: sent.body, ...(sent.ifMatch === undefined ? {} : { ifMatch: sent.ifMatch }) });

/** Every editor asked to close answers that it could not save, and stays open. */
function fullDisk(golden: Golden): void {
	golden.host.releaseNotes = (paths) => {
		golden.host.editors.push(`release ${paths.join(', ')}`);
		return Promise.reject(new EditorUnsavedError(paths[0] ?? ''));
	};
}

describe('an editor that cannot save what the author typed', () => {
	it('stops the change that would have closed it, with nothing written', async () => {
		const golden = await createGolden();
		fullDisk(golden);
		const before = vaultState(golden.host);
		for (const [operationId, row] of Object.entries(CLOSES_AN_EDITOR)) {
			golden.host.editors.length = 0;
			const reply = await send(golden, operationId, row(golden));
			expect([refusal(reply), faults(reply)], operationId).toEqual([[409, 'editor-unsaved'], []]);
			// The note is named, so the author can be told which one it was.
			expect(typeof bodyOf(reply.body)['path'], operationId).toBe('string');
			// It was the closing that was refused, and nothing was written after it.
			expect(golden.host.editors[golden.host.editors.length - 1]?.startsWith('release'), operationId).toBe(true);
			expect(vaultState(golden.host), operationId).toEqual(before);
		}
	});

	it('is said by every operation it can be the answer of', () => {
		const paths = document.root['paths'];
		const lists = (operationId: string): boolean => {
			for (const item of Object.values(isJsonObject(paths) ? paths : {})) {
				for (const operation of Object.values(isJsonObject(item) ? item : {})) {
					if (!isJsonObject(operation) || operation['operationId'] !== operationId) continue;
					const errors = operation['x-snowflake-errors'];
					return Array.isArray(errors) && errors.includes('editor-unsaved');
				}
			}
			return false;
		};
		const saying = operations.filter((operation) => operation.available && lists(operation.id)).map((operation) => operation.id);
		expect(saying.sort()).toEqual(Object.keys(CLOSES_AN_EDITOR).sort());
	});

	it('is passed over by a find and replace, which goes on with the other notes', async () => {
		const golden = await createGolden();
		const release = golden.host.releaseNotes.bind(golden.host);
		golden.host.releaseNotes = (paths) => (paths.includes(golden.manuscript.first) ? Promise.reject(new EditorUnsavedError(golden.manuscript.first)) : release(paths));
		const reply = await golden.call('replaceInProject', { projectId: golden.project.id }, { body: { query: 'o', replacement: '0' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const done = bodyOf(reply.body);
		expect(done['skipped']).toEqual([{ relativePath: FIRST, reason: 'changed' }]);
		expect((done['notes'] as Body[]).map((note) => note['relativePath'])).toContain(SECOND);
		// The note whose editor was kept says what it said.
		expect((await golden.host.projects.manuscript.readSegment(golden.manuscript.first)).body).toContain('The clock stopped');
	});
});
