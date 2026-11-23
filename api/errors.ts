import {
	ConcurrentChangeError,
	InvalidManagedDocumentError,
	LinkUpdatePromptError,
	ManagedFileNotFoundError,
	PathConflictError,
	UnsafeSectionError,
	UnsupportedSchemaError,
} from '../src/repository/errors';
import { UnsafeFileNameError } from '../src/domain';
import { ArchiveFolderIsProjectError, DuplicateNameError, ProjectCreationInterruptedError } from '../src/services';
import { isJsonObject, type JsonObject } from './json';
import type { ApiDocument } from './spec/document';

/**
 * A refusal or a failure, named by the code the contract lists it under.
 * The status and the title are the contract's to say, so nothing that
 * raises one of these repeats them: a handler names the code, says what
 * went wrong in this call, and adds what a caller needs to go on.
 */
export class ApiError extends Error {
	constructor(
		readonly code: string,
		readonly detail: string,
		readonly extra: JsonObject = {},
	) {
		super(detail);
		this.name = 'ApiError';
	}
}

/** Raises the refusal: for the places an expression is wanted. */
export const refuse = (code: string, detail: string, extra: JsonObject = {}): never => {
	throw new ApiError(code, detail, extra);
};

/**
 * The refusal of a change worked out from a version of a note that no
 * longer stands, with the version that does.
 */
export const changedSince = (currentEtag: string): ApiError =>
	new ApiError('concurrent-change', 'The note has changed since it was read. Read it again and decide again.', { currentEtag });

/**
 * The refusal of a change that would rename something while Obsidian is set
 * to ask before it updates links. Its dialog would stand open with nobody to
 * answer it, and the call would never end.
 */
export const linkUpdatesAsk = (path: string): ApiError =>
	new ApiError(
		'link-updates-ask',
		'Obsidian is set to ask before it updates links, and a rename made here has nobody to answer its dialog. Switch on "Automatically update internal links" under Files and links in Obsidian\'s settings, then ask again.',
		{ path },
	);

export interface ProblemEntry {
	readonly status: number;
	readonly title: string;
}

/** The problems the contract lists, each with its status and its title. */
export function readProblems(document: ApiDocument): Map<string, ProblemEntry> {
	const found = new Map<string, ProblemEntry>();
	const registry = document.root['x-snowflake-problems'];
	if (!isJsonObject(registry)) return found;
	for (const [code, entry] of Object.entries(registry)) {
		if (!isJsonObject(entry)) continue;
		const status = entry['status'];
		const title = entry['title'];
		if (typeof status === 'number' && typeof title === 'string') found.set(code, { status, title });
	}
	return found;
}

const INTERNAL = 'internal-error';

/**
 * The problem document for an error, with the status it travels under. A
 * code the contract does not list is a fault of the API's own, and is
 * answered as one rather than under a status made up on the spot.
 */
export function problemOf(
	problems: ReadonlyMap<string, ProblemEntry>,
	error: ApiError,
): { status: number; body: JsonObject } {
	const listed = problems.get(error.code);
	const code = listed === undefined ? INTERNAL : error.code;
	const entry = listed ?? problems.get(INTERNAL) ?? { status: 500, title: 'The operation failed.' };
	return {
		status: entry.status,
		body: {
			type: `/problems/${code}`,
			title: entry.title,
			status: entry.status,
			code,
			detail: listed === undefined ? 'The operation failed.' : error.detail,
			...(listed === undefined ? {} : error.extra),
		},
	};
}

/**
 * What went wrong, as the contract names it. The services say what they
 * refuse in classes of their own, and each is given its code here by what
 * it is, never by the words of its message: those are written for the
 * author, in the author's language, and may be reworded any day.
 *
 * Anything not known here is the API's own failure. Its message is not
 * handed on, since it may carry a path or a title, and a caller could do
 * nothing with it.
 */
export function mapError(error: unknown): ApiError {
	if (error instanceof ApiError) return error;
	if (error instanceof ConcurrentChangeError) return changedSince(error.actualRevision);
	if (error instanceof ManagedFileNotFoundError) return new ApiError('not-found', 'It is not there, or no longer there.');
	if (error instanceof LinkUpdatePromptError) return linkUpdatesAsk(error.path);
	if (error instanceof PathConflictError) {
		return new ApiError('path-conflict', 'A file or folder already stands where this would go.', { path: error.path });
	}
	if (error instanceof UnsupportedSchemaError) {
		return new ApiError('read-only', 'A newer version of the plugin wrote this, and this one may only read it.', { path: error.path });
	}
	if (error instanceof UnsafeSectionError) {
		return new ApiError('unsafe-section', 'The section markers in the note are damaged. Repair the project, then try again.', {
			path: error.path,
			section: error.sectionId,
		});
	}
	if (error instanceof DuplicateNameError) {
		return new ApiError('duplicate-name', 'Something of that kind already goes by that name. Names are told apart whatever their case.', {
			kind: error.kind,
			name: error.requestedName,
		});
	}
	if (error instanceof UnsafeFileNameError) {
		return new ApiError(
			'invalid-name',
			'A note or a folder is filed under its name, and nothing of this one is left once the dots and spaces at its ends are taken off. Send a name that holds more than dots.',
			{ name: error.requestedName },
		);
	}
	if (error instanceof ArchiveFolderIsProjectError) {
		return new ApiError('archive-folder-is-project', 'The folder archived projects go into is itself a project, so nothing can be filed in it.', {
			path: error.archiveRoot,
		});
	}
	if (error instanceof ProjectCreationInterruptedError) {
		return new ApiError('project-creation-interrupted', 'The project was begun and could not be finished. repairProject puts in what is missing.', {
			path: error.projectPath,
		});
	}
	if (error instanceof InvalidManagedDocumentError) {
		return new ApiError('invalid-managed-document', 'A note the operation needs is damaged. The health of the project says which.', {
			...(error.path === undefined ? {} : { path: error.path }),
		});
	}
	return new ApiError(INTERNAL, 'The operation failed.');
}
