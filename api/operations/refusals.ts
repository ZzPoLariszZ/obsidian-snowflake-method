import { foldName, isNameTaken } from '../../src/domain';
import { ApiError } from '../errors';

/**
 * The refusals a change to a record or to a board is turned away with, said
 * once. The contract's shapes hold a call to what can be said in a shape.
 * What depends on the project as it stands is held here.
 */

export type Sent = Readonly<Record<string, unknown>>;

export const isSent = (value: unknown): value is Sent => typeof value === 'object' && value !== null && !Array.isArray(value);
export const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A part of a call the contract's shapes cannot hold to account, refused as one they can. */
export const misfit = (pointer: string, detail: string): ApiError =>
	new ApiError('invalid-request', 'The call does not match what the operation takes.', { errors: [{ pointer, detail }] });

/**
 * A file of records a newer version of the plugin wrote. Such a file is
 * read as holding nothing and is never written: writing this version's
 * shape over it would drop whatever the newer one keeps there.
 */
export const foreign = (what: string): ApiError =>
	new ApiError('read-only', `A newer version of the plugin wrote the project's ${what}, and this one may not change them.`);

export const taken = (kind: string, name: string): ApiError =>
	new ApiError('duplicate-name', 'Another one already goes by that name. Names are told apart whatever their case.', { kind, name });

/** Whether a name is free for a thing that has `own` already, or none yet. Keeping a name is not taking one. */
export function free(others: readonly string[], name: string, own: string | null): boolean {
	if (own !== null && foldName(name) === foldName(own)) return true;
	return !isNameTaken(others, name);
}
