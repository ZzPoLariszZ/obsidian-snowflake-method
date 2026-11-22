import type { MemberEntry, MemberIndex } from '../dto/member';
import { ApiError } from '../errors';
import { foreign, isSent, misfit, textOf, type Sent } from './refusals';

/**
 * What a change to a board is held to before the board's own service is
 * asked. A board's file takes whatever it is handed: an id of a scene that
 * was never there, a row put before a row of another time. The author's own
 * screens cannot hand it such a thing, since they only offer what is there.
 * A caller can, so what it names is looked up here first.
 */

/** Something a call names that the project or the board does not have, with where in the call it was named. */
export const noSuch = (pointer: string, detail: string): ApiError => new ApiError('invalid-reference', detail, { pointer });

/** What a board's file answered a change with, held to the one answer that lets a handler go on. */
export function landed(outcome: 'written' | 'deleted' | 'absent' | 'refused', missing: ApiError, file: string): void {
	if (outcome === 'refused') throw foreign(file);
	if (outcome === 'absent') throw missing;
}

/** The id a new thing was given. None means the file would not take the write, which is a newer version's file. */
export function made(id: string | null, file: string): string {
	if (id === null) throw foreign(file);
	return id;
}

/** The id a reference to a note carries, as a caller sends one. */
export const idOf = (sent: unknown): string => (isSent(sent) ? textOf(sent['id']) : textOf(sent));

/** The scene or the time note of an id, which must be one the project has. */
export function memberOfKind(index: MemberIndex, id: string, kind: 'scene' | 'time', pointer: string): MemberEntry {
	const member = index.byId(id);
	if (member === null || member.kind !== kind) {
		throw noSuch(
			pointer,
			kind === 'scene'
				? 'The project has no scene with that id. listScenes gives the ids there are.'
				: 'The project has no time note with that id. listEntities with kind=time gives the ids there are.',
		);
	}
	return member;
}

/** The scenes a new row carries, each once, in the order sent. */
export function scenesOf(index: MemberIndex, sent: unknown, pointer: string): string[] {
	const ids: string[] = [];
	(Array.isArray(sent) ? sent : []).forEach((entry: unknown, at) => {
		const id = memberOfKind(index, idOf(entry), 'scene', `${pointer}/${String(at)}`).id;
		if (!ids.includes(id)) ids.push(id);
	});
	return ids;
}

/**
 * The thing another is put before, or null for the end. The boards read an
 * anchor that is not there as the end, which is right for a screen painted a
 * moment ago and wrong for a caller that named the wrong thing.
 */
export function anchorOf(body: Sent, among: readonly string[], what: string, self: string | null = null): string | null {
	const before = body['before'];
	if (before === undefined || before === null) return null;
	const id = textOf(before);
	if (id === self) throw misfit('/before', 'A thing is not put before itself.');
	if (!among.includes(id)) throw noSuch('/before', `There is no ${what} with that id where this would go.`);
	return id;
}

/** A row's words as the author's own forms keep them, and the refusal of a row that neither says nor carries anything. */
export function rowText(body: Sent, scenes: readonly string[]): string {
	const text = textOf(body['text']).trim();
	if (text.length === 0 && scenes.length === 0) {
		throw misfit('/text', 'A row says something or carries a scene. One that does neither is nothing to add.');
	}
	return text;
}
