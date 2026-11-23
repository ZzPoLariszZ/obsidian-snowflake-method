import { describe, expect, it } from 'vitest';

import { ApiError, mapError, problemOf, readProblems } from '../../api/errors';
import { UnsafeFileNameError } from '../../src/domain';
import {
	ConcurrentChangeError,
	InvalidManagedDocumentError,
	ManagedFileNotFoundError,
	PathConflictError,
	UnsafeSectionError,
	UnsupportedSchemaError,
} from '../../src/repository/errors';
import { ArchiveFolderIsProjectError, DuplicateNameError, ProjectCreationInterruptedError } from '../../src/services';
import { problemFaults } from './helpers/shapes';
import { document, problemRegistry } from './helpers/spec';

describe('what went wrong, as the contract names it', () => {
	const problems = readProblems(document);

	it('reads every problem the contract lists', () => {
		expect([...problems.keys()].sort()).toEqual(Object.keys(problemRegistry()).sort());
	});

	it('gives each of the repository’s refusals its code by what it is', () => {
		const cases: [unknown, string][] = [
			[new ConcurrentChangeError('a.md', 'fp1-old', 'fp1-new'), 'concurrent-change'],
			[new ManagedFileNotFoundError('a.md'), 'not-found'],
			[new PathConflictError('a.md'), 'path-conflict'],
			[new UnsupportedSchemaError('a.md', 9, 3), 'read-only'],
			[new UnsafeSectionError('a.md', 'scene-events', 'the end marker is missing'), 'unsafe-section'],
			[new InvalidManagedDocumentError('Two notes share an id.', 'a.md'), 'invalid-managed-document'],
		];
		for (const [error, code] of cases) {
			const mapped = mapError(error);
			expect(mapped.code).toBe(code);
			expect(problems.has(code), code).toBe(true);
		}
	});

	it('gives each of the project service’s refusals its code, with what a caller needs to go on', () => {
		const cases: [unknown, string, Record<string, unknown>][] = [
			[new DuplicateNameError('character', 'Ada'), 'duplicate-name', { kind: 'character', name: 'Ada' }],
			[new ArchiveFolderIsProjectError('Books/Snowflake Archive'), 'archive-folder-is-project', { path: 'Books/Snowflake Archive' }],
			// The domain's own refusal of a name, raised by whichever service came to file something under it.
			[new UnsafeFileNameError('...'), 'invalid-name', { name: '...' }],
			[
				new ProjectCreationInterruptedError('Books/Novel/00_System/001_Project_Metadata.md', new Error('disk full')),
				'project-creation-interrupted',
				{ path: 'Books/Novel/00_System/001_Project_Metadata.md' },
			],
		];
		for (const [error, code, extra] of cases) {
			const mapped = mapError(error);
			expect([mapped.code, mapped.extra]).toEqual([code, extra]);
			expect(problems.has(code), code).toBe(true);
			// The words are the API's own. The service's are written for the author and may be reworded any day.
			expect(mapped.detail).not.toBe((error as Error).message);
			expect(problemFaults(problemOf(problems, mapped).body)).toEqual([]);
		}
	});

	it('hands a caller the note’s version as it now stands when its own was stale', () => {
		expect(mapError(new ConcurrentChangeError('a.md', 'fp1-old', 'fp1-new')).extra).toEqual({ currentEtag: 'fp1-new' });
	});

	it('leaves a refusal of the API’s own as it is', () => {
		const own = new ApiError('access-denied', 'No.', { needs: 'write' });
		expect(mapError(own)).toBe(own);
	});

	it('never hands on the words of a failure it does not know', () => {
		const mapped = mapError(new Error('Could not read Snowflake Projects/Secret Novel/Chapter 1.md'));
		expect(mapped.code).toBe('internal-error');
		expect(mapped.detail).toBe('The operation failed.');
		expect(JSON.stringify(problemOf(problems, mapped))).not.toContain('Secret Novel');
		expect(mapError('a string thrown').code).toBe('internal-error');
		expect(mapError(undefined).code).toBe('internal-error');
	});
});

describe('the problem document', () => {
	const problems = readProblems(document);

	it('carries the status and the title the contract gives the code', () => {
		const problem = problemOf(problems, new ApiError('concurrent-change', 'Read it again.', { currentEtag: 'fp1-new' }));
		expect(problem.status).toBe(412);
		expect(problem.body).toEqual({
			type: '/problems/concurrent-change',
			title: 'The note has changed since it was read.',
			status: 412,
			code: 'concurrent-change',
			detail: 'Read it again.',
			currentEtag: 'fp1-new',
		});
		expect(problemFaults(problem.body)).toEqual([]);
	});

	it('answers a code the contract does not list as a failure of the API’s own', () => {
		const problem = problemOf(problems, new ApiError('made-up-on-the-spot', 'Something with a title in it.', { path: 'a.md' }));
		expect(problem.status).toBe(500);
		expect(problem.body).toEqual({
			type: '/problems/internal-error',
			title: 'The operation failed.',
			status: 500,
			code: 'internal-error',
			detail: 'The operation failed.',
		});
	});

	it('is the described shape for every problem listed', () => {
		for (const code of problems.keys()) {
			const problem = problemOf(problems, new ApiError(code, 'What went wrong.'));
			expect(problemFaults(problem.body), code).toEqual([]);
			expect(problem.status, code).toBe(problems.get(code)?.status);
		}
	});
});
