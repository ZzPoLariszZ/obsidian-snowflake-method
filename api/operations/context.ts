import type { ProjectRef, ProjectSnapshot, WriteOrigin } from '../../src/services';
import { MemberIndex } from '../dto/member';
import { ApiError } from '../errors';
import type { ApiHost } from '../host';
import type { JsonObject, JsonValue } from '../json';
import type { ApiDocument } from '../spec/document';
import type { OperationSpec } from '../spec/operations';
import { publishedDocument } from '../spec/published';

/**
 * One call as a handler is given it: already found, allowed and held
 * against the contract, whichever door it came through.
 */
export interface OperationCall {
	readonly operation: OperationSpec;
	/** The address's and the query's values, typed as the contract types them. */
	readonly params: Readonly<Record<string, unknown>>;
	/** The body as the contract describes it, or undefined where there is none. */
	readonly body: unknown;
	/** The version the caller means to change: an etag, `*` for whichever stands, or null where none was sent. */
	readonly ifMatch: string | null;
	/** Whether the caller proved itself. Only the operations answered without a token ever see false. */
	readonly authenticated: boolean;
}

/** What a handler answers. The doors turn it into a reply of their own kind. */
export interface OperationResult {
	readonly status: 200 | 201 | 204;
	readonly body?: JsonValue;
	/** The version of the note the answer describes, for the caller's next change. */
	readonly etag?: string;
	/** Where the thing made or moved now stands, as an address under the base path. */
	readonly location?: string;
}

export type OperationHandler = (call: OperationCall, context: ApiContext) => OperationResult | Promise<OperationResult>;

/** The handlers of one group, each under the name the contract gives its operation. */
export type OperationGroup = Readonly<Record<string, OperationHandler>>;

/**
 * Whose words a write through the API carries: never the author's typing.
 * Handed to every service call that asks, so nothing a caller writes is
 * counted towards the author's day or filed as theirs in the history.
 */
export const NOT_THE_AUTHOR: WriteOrigin = { userInput: false };

/** A project found by its id, with where it stands. */
export interface FoundProject {
	readonly ref: ProjectRef;
	/** It stands in the archive folder: it can be read, and restored, and nothing else. */
	readonly archived: boolean;
}

/** A project read whole. */
export interface LoadedProject {
	readonly project: ProjectSnapshot;
	readonly archived: boolean;
}

/** What every handler works with: the plugin, and the contract it answers to. */
export class ApiContext {
	constructor(
		readonly host: ApiHost,
		readonly document: ApiDocument,
		readonly operations: readonly OperationSpec[],
	) {}

	/** The contract as a caller is shown it, with the port the author chose. */
	published(): JsonObject {
		return publishedDocument(this.document, this.operations, this.host.port());
	}

	/**
	 * The project of that id. The services know a project by where it
	 * stands, which a rename changes, so the id a caller holds is looked up
	 * among the projects there are each time it is used.
	 *
	 * An id is meant to be one project's alone, and nothing in a vault makes
	 * it so: a project folder copied by hand carries the id of the one it was
	 * copied from. Which of the two a caller means cannot be guessed, so
	 * neither is answered for until the author has seen to it.
	 */
	async findProject(projectId: string): Promise<FoundProject> {
		const roster = await this.host.roster();
		const found: FoundProject[] = [
			...roster.active.filter((ref) => ref.id === projectId).map((ref) => ({ ref, archived: false })),
			...roster.archived.filter((ref) => ref.id === projectId).map((ref) => ({ ref, archived: true })),
		];
		const first = found[0];
		if (first === undefined) {
			throw new ApiError('not-found', 'There is no project with that id. listProjects gives the ids there are.');
		}
		if (found.length > 1) {
			throw new ApiError(
				'ambiguous-project',
				'More than one project folder carries that id, most likely a copy made by hand. Which is meant cannot be told.',
				{ paths: found.map((entry) => entry.ref.rootPath) },
			);
		}
		return first;
	}

	/** The project of that id, read whole. The reading is kept by the plugin until a note of the project changes. */
	async loadProject(projectId: string): Promise<LoadedProject> {
		const found = await this.findProject(projectId);
		return { project: await this.host.projects.loadProject(found.ref), archived: found.archived };
	}

	/**
	 * The project of that id, for a caller that means to change it. A
	 * project in the archive can be read and restored and nothing else, and
	 * one a newer version of the plugin wrote can only be read.
	 */
	async writableProject(projectId: string): Promise<ProjectSnapshot> {
		const { project, archived } = await this.loadProject(projectId);
		if (archived) {
			throw new ApiError('project-archived', 'The project stands in the archive. restoreProject brings it back, and then it can be changed.');
		}
		if (project.readOnly) {
			throw new ApiError('read-only', 'A newer version of the plugin wrote this project, and this one may only read it.', {
				path: project.projectFile,
			});
		}
		return project;
	}

	/**
	 * Every member of a project, to be found by where its note stands. A
	 * link is looked for inside the project first: Obsidian shortens a link
	 * to a bare name where that was enough when it wrote it, and a second
	 * project with a note of the same name would otherwise be answered for.
	 */
	members(project: ProjectSnapshot): MemberIndex {
		const repository = this.host.projects.repository;
		return new MemberIndex(
			project,
			(link, sourcePath) =>
				(repository.resolveLinkWithin(link, sourcePath, project.rootPath) ?? repository.resolveLink(link, sourcePath))?.path ??
				null,
		);
	}
}

/**
 * A parameter the contract types as text. The call was held against the
 * contract before any handler saw it, so finding something else here means
 * the handler asked for a name its operation does not declare: a fault of
 * the API's own, and answered as one.
 */
export function textParam(call: OperationCall, name: string): string {
	const value = call.params[name];
	if (typeof value !== 'string') throw new ApiError('internal-error', 'The operation failed.');
	return value;
}

/** The same for one that may be left out. */
export function optionalTextParam(call: OperationCall, name: string): string | null {
	const value = call.params[name];
	return typeof value === 'string' ? value : null;
}

/**
 * The version a change is made against, as the services take it. A caller
 * may send `*` for whichever version stands, and is then given the one
 * that does.
 */
export function revisionOf(call: OperationCall, standing: string): string {
	return call.ifMatch === null || call.ifMatch === '*' ? standing : call.ifMatch;
}

/** The body of a call as an object. The contract held it to its shape before a handler saw it. */
export function bodyOf(call: OperationCall): Readonly<Record<string, unknown>> {
	const body = call.body;
	if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError('internal-error', 'The operation failed.');
	return body as Readonly<Record<string, unknown>>;
}

export function numberParam(call: OperationCall, name: string): number {
	const value = call.params[name];
	if (typeof value !== 'number') throw new ApiError('internal-error', 'The operation failed.');
	return value;
}

export function flagParam(call: OperationCall, name: string): boolean {
	return call.params[name] === true;
}

/** A list parameter's words, or none where it was left out. */
export function listParam(call: OperationCall, name: string): string[] {
	const value = call.params[name];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
