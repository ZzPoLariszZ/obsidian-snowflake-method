import { SCENE_POV_MULTIPLE, SCENE_POV_OMNISCIENT, foldName, type DefinitionFileId, type TimeKind } from '../../src/domain';
import {
	checkDefinitionPath,
	definitionRootPath,
	nodeSelfPath,
	toWikiLink,
	type CharacterInput,
	type DefinitionForest,
	type EntityInput,
	type ProjectSnapshot,
	type SceneInput,
} from '../../src/services';
import { duplicateFieldTitle, serializeCustomFields, type CustomField, type RecordClause, type RecordLine, type RecordTerm } from '../../src/templates';
import { ApiError } from '../errors';
import type { MemberEntry, MemberIndex } from './member';

/**
 * What a caller sends to make or change a character, a scene or a
 * worldbuilding note, turned into what the plugin's services take.
 *
 * A caller names another note by its id and a vocabulary word by its path
 * in the tree. The notes keep links instead, which this builds, having
 * first found that each id is a note of the kind the place is for and each
 * word is one the vocabulary has. Nothing is written until all of it holds,
 * so a slip leaves the vault as it was.
 */

type Sent = Readonly<Record<string, unknown>>;
const isSent = (value: unknown): value is Sent => typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The three vocabularies of a kind, each with the words it has. */
export type Forests = Readonly<Record<DefinitionFileId, DefinitionForest>>;

export class MemberDraft {
	constructor(
		private readonly project: ProjectSnapshot,
		private readonly index: MemberIndex,
		private readonly forests: Forests,
		private readonly kind: string,
		private readonly addMissing: boolean,
	) {}

	/** The note an id names, where it is of a kind the place takes. */
	private member(sent: unknown, pointer: string, kinds: readonly string[] | null): MemberEntry {
		const id = isSent(sent) ? text(sent['id']) : '';
		const found = this.index.byId(id);
		if (found === null || (kinds !== null && !kinds.includes(found.kind))) {
			throw new ApiError(
				'invalid-reference',
				found === null
					? 'The project has no note with that id. listMembers gives the ids there are.'
					: `That is a note of the kind ${found.kind}, and this place takes ${kinds?.join(' or ') ?? 'another'}.`,
				{ pointer, id },
			);
		}
		return found;
	}

	/** A note or plain words, as a field stores either: a link, or the words. */
	stored(sent: unknown, pointer: string, kinds: readonly string[] | null): string {
		if (isSent(sent) && typeof sent['text'] === 'string') return sent['text'].trim();
		const member = this.member(sent, pointer, kinds);
		return toWikiLink(member.path, member.name);
	}

	/** The same as a record line keeps it. */
	private term(sent: unknown, pointer: string): RecordTerm {
		if (isSent(sent) && typeof sent['text'] === 'string') return { kind: 'text', text: sent['text'].trim() };
		const member = this.member(sent, pointer, null);
		return { kind: 'link', path: member.path.replace(/\.md$/u, ''), name: member.name };
	}

	/** The paths of the notes a list names, each of the kind the list is for. */
	paths(sent: unknown, pointer: string, kinds: readonly string[]): string[] {
		return listOf(sent).map((entry, at) => this.member(entry, `${pointer}/${String(at)}`, kinds).path);
	}

	/**
	 * A word of one of the kind's vocabularies, spelled as the vocabulary
	 * spells it. A word it lacks is refused, unless the caller asked for
	 * such words to be added, and then only one a vocabulary could hold.
	 */
	private word(vocabulary: DefinitionFileId, sent: string, pointer: string): string {
		const asked = sent.trim();
		const node = this.forests[vocabulary][this.kind]?.nodes.find((entry) => foldName(entry.taxonomyPath) === foldName(asked));
		if (node !== undefined) return node.taxonomyPath;
		if (!this.addMissing) {
			throw new ApiError(
				'unknown-vocabulary-node',
				`The ${vocabulary} vocabulary of ${this.kind} has no word "${asked}". getVocabularyTree gives the words there are. Send createMissingVocabulary to add it.`,
				{ pointer, vocabulary, path: asked },
			);
		}
		const check = checkDefinitionPath(asked);
		if (!check.ok) {
			throw new ApiError(
				check.code,
				check.code === 'too-deep' ? 'A vocabulary has seven levels at most.' : 'A part of the path is not a name a vocabulary word can have.',
				{ pointer, vocabulary, path: asked, segment: check.segment },
			);
		}
		// The service adds what a note names and the vocabulary lacks, as it writes the note.
		return check.segments.join('/');
	}

	categories(sent: unknown): string[] {
		return listOf(sent).map((entry, at) => this.word('category', text(entry), `/categories/${String(at)}`));
	}

	/**
	 * One clause of a record line. A note keeps a clause as a word in front
	 * of a link, and reads one back only there: `at` in front of a place and
	 * `when` in front of a time. So a clause names a note, and of the kind
	 * its word is for. The older span is taken as it was read.
	 */
	private clause(sent: unknown, pointer: string): RecordClause {
		const clause = isSent(sent) ? sent : {};
		if (clause['kind'] === 'span') {
			return { kind: 'span', start: this.term(clause['start'], `${pointer}/start`), end: this.term(clause['end'], `${pointer}/end`) };
		}
		const kind = clause['kind'] as Exclude<RecordClause['kind'], 'span'>;
		const member = this.member(clause['term'], `${pointer}/term`, kind === 'at' ? ['location'] : kind === 'when' ? ['time'] : null);
		return { kind, term: { kind: 'link', path: member.path.replace(/\.md$/u, ''), name: member.name } };
	}

	/** Record lines as a note keeps them, each under a word of the vocabulary the section is for. */
	records(sent: unknown, vocabulary: 'world-status' | 'relationship', pointer: string): RecordLine[] {
		const root = definitionRootPath(this.project, this.kind, vocabulary);
		return listOf(sent).map((entry, at) => {
			const line = isSent(entry) ? entry : {};
			const here = `${pointer}/${String(at)}`;
			const label = this.word(vocabulary, text(line['label']), `${here}/label`);
			return {
				label: { path: nodeSelfPath(root, label), display: label },
				value: text(line['text']),
				clauses: listOf(line['clauses']).map((clause, index) => this.clause(clause, `${here}/clauses/${String(index)}`)),
			};
		});
	}

	/** The custom fields as the block a note keeps, each untouched field's own text kept as the author left it. */
	customFields(sent: unknown, standing: string): string {
		const fields = listOf(sent).map((entry): CustomField => {
			const field = isSent(entry) ? entry : {};
			return { title: text(field['title']), content: text(field['content']) };
		});
		const twice = duplicateFieldTitle(fields.map((field) => field.title));
		if (twice !== null) {
			throw new ApiError('duplicate-field-title', `Two of the fields are titled "${twice}". Titles are told apart whatever their case.`, {
				title: twice,
			});
		}
		return serializeCustomFields(standing, fields);
	}

	/** What every kind of note can be sent, where it was sent. */
	shared(body: Sent, standing: { customFields: string }): Pick<
		CharacterInput,
		'aliases' | 'categoryPaths' | 'progressStatus' | 'color' | 'worldStatus' | 'relationships' | 'customFields'
	> {
		return {
			...('aliases' in body ? { aliases: listOf(body['aliases']).map(text) } : {}),
			...('categories' in body ? { categoryPaths: this.categories(body['categories']) } : {}),
			...('progressStatus' in body ? { progressStatus: body['progressStatus'] as CharacterInput['progressStatus'] } : {}),
			...('color' in body ? { color: body['color'] as CharacterInput['color'] } : {}),
			...('worldStatus' in body ? { worldStatus: this.records(body['worldStatus'], 'world-status', '/worldStatus') } : {}),
			...('relationships' in body ? { relationships: this.records(body['relationships'], 'relationship', '/relationships') } : {}),
			...('customFields' in body ? { customFields: this.customFields(body['customFields'], standing.customFields) } : {}),
		};
	}
}

/** The plain text properties of a body, where each was sent. */
function texts<K extends string>(body: Sent, names: readonly K[]): Partial<Record<K, string>> {
	const told: Partial<Record<K, string>> = {};
	for (const name of names) if (typeof body[name] === 'string') told[name] = body[name];
	return told;
}

const CHARACTER_TEXTS = [
	'oneSentenceStoryline',
	'motivation',
	'goal',
	'conflict',
	'growth',
	'oneParagraphStoryline',
	'characterSynopsis',
	'characterProfile',
] as const;

export function characterChanges(draft: MemberDraft, body: Sent, standing: { customFields: string }): Omit<CharacterInput, 'name'> & { name?: string } {
	return {
		...(typeof body['name'] === 'string' ? { name: body['name'].trim() } : {}),
		...(typeof body['role'] === 'string' ? { type: body['role'] as NonNullable<CharacterInput['type']> } : {}),
		...draft.shared(body, standing),
		...texts(body, CHARACTER_TEXTS),
	};
}

/** Whose eyes a scene is seen through, as its note keeps it. */
function povOf(draft: MemberDraft, sent: unknown): string | null {
	if (!isSent(sent)) return null;
	if (sent['mode'] === 'omniscient') return SCENE_POV_OMNISCIENT;
	if (sent['mode'] === 'multiple') return SCENE_POV_MULTIPLE;
	return draft.paths([sent['character']], '/pov/character', ['character'])[0] ?? null;
}

export function sceneChanges(
	draft: MemberDraft,
	body: Sent,
	standing: { customFields: string },
	manuscriptLink: (sent: unknown, pointer: string) => string,
): Omit<SceneInput, 'title'> & { title?: string } {
	return {
		...(typeof body['title'] === 'string' ? { title: body['title'].trim() } : {}),
		...draft.shared(body, standing),
		...('pov' in body ? { povPath: povOf(draft, body['pov']) } : {}),
		...('characters' in body ? { characters: draft.paths(body['characters'], '/characters', ['character']) } : {}),
		...('times' in body
			? { times: listOf(body['times']).map((entry, at) => draft.stored(entry, `/times/${String(at)}`, ['time'])) }
			: {}),
		...('locations' in body
			? { locations: listOf(body['locations']).map((entry, at) => draft.stored(entry, `/locations/${String(at)}`, ['location'])) }
			: {}),
		...texts(body, ['conflict', 'events', 'planning'] as const),
		...('linkedManuscript' in body
			? { linkedManuscript: listOf(body['linkedManuscript']).map((entry, at) => manuscriptLink(entry, `/linkedManuscript/${String(at)}`)) }
			: {}),
	};
}

/**
 * When a time is, as its note keeps it. A period keeps both its ends or
 * neither. What was not sent is left as the note has it, so a caller can
 * change one end against the other as it stands.
 */
function timeOf(
	draft: MemberDraft,
	sent: unknown,
	standing: { timeKind: TimeKind | null; timeStart: string; timeEnd: string },
): Pick<EntityInput, 'timeKind' | 'timeStart' | 'timeEnd'> {
	if (!isSent(sent)) return {};
	const end = (name: 'start' | 'end', kept: string): string =>
		name in sent ? (sent[name] === null ? '' : draft.stored(sent[name], `/time/${name}`, ['time'])) : kept;
	const next = {
		timeKind: 'kind' in sent ? (sent['kind'] as TimeKind | null) : standing.timeKind,
		timeStart: end('start', standing.timeStart),
		timeEnd: end('end', standing.timeEnd),
	};
	if (next.timeKind === 'period' && (next.timeStart.length > 0) !== (next.timeEnd.length > 0)) {
		throw new ApiError('invalid-time-span', 'A period needs both its start and its end, or neither.', { pointer: '/time' });
	}
	return next;
}

export function entityChanges(
	draft: MemberDraft,
	body: Sent,
	standing: { customFields: string; timeKind: TimeKind | null; timeStart: string; timeEnd: string },
	keepsTime: boolean,
): Omit<EntityInput, 'name' | 'kind'> & { name?: string } {
	return {
		...(typeof body['name'] === 'string' ? { name: body['name'].trim() } : {}),
		...draft.shared(body, standing),
		...texts(body, ['description', 'notes'] as const),
		...(keepsTime && 'time' in body ? timeOf(draft, body['time'], standing) : {}),
	};
}
