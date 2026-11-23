import {
	applyReplacements,
	compileTextSearch,
	fileStem,
	findTextMatches,
	occurrenceSpot,
	passagesLostTo,
	replacementsIn,
	type RevisionSpot,
	type TextRange,
	type TextSearch,
} from '../../src/domain';
import { ConcurrentChangeError } from '../../src/repository/errors';
import { entitiesOf, type CharacterRecord, type ProjectSnapshot, type SceneRecord, type WorldbuildingRecord } from '../../src/services';
import { parseCustomFields } from '../../src/templates';
import { relativePathOf } from '../dto/manuscript';
import { isEditableStep, stepTextOf } from '../dto/project';
import { ApiError, EditorUnsavedError } from '../errors';
import { isJsonObject, type JsonObject } from '../json';
import { SEARCH_EXCERPT, SEARCH_HITS } from '../limits';
import { pageOf } from '../paging';
import { NOT_THE_AUTHOR, bodyOf, flagParam, textParam, type ApiContext, type OperationGroup } from './context';
import { noteAt } from './manuscript-writes';

/**
 * A text of the project that words are looked for in: a manuscript note's
 * whole text, or one thing a note says of itself. A manuscript note has no
 * field. A character, a scene or a worldbuilding note is searched field by
 * field, each named as the note's own reading names it, so what is found
 * can be changed through the operation that changes that field.
 */
interface Source {
	readonly kind: string;
	readonly path: string;
	readonly title: string;
	readonly id: string | null;
	readonly step: number | null;
	readonly field: string | null;
	readonly text: string;
}

interface Hit {
	readonly source: Source;
	readonly range: TextRange;
}

type AnyMember = CharacterRecord | SceneRecord | WorldbuildingRecord;

/** The words a caller asks for, made into a search. They are words, never an expression. */
function searchOf(query: string, caseSensitive: boolean, wholeWord: boolean, pointer: string): TextSearch {
	const made = compileTextSearch(query, { caseSensitive, wholeWord, regex: false });
	if (made === null || !made.ok) {
		throw new ApiError('invalid-request', 'The call does not match what the operation takes.', {
			errors: [{ pointer, detail: 'There is nothing in that to look for.' }],
		});
	}
	return made.search;
}

/** What every member says in its record lines and in the fields the author added. */
function sharedFields(member: AnyMember): [string, string][] {
	return [
		...member.aliases.map((alias, at): [string, string] => [`/aliases/${String(at)}`, alias]),
		...member.worldStatus.map((line, at): [string, string] => [`/worldStatus/${String(at)}/text`, line.value]),
		...member.relationships.map((line, at): [string, string] => [`/relationships/${String(at)}/text`, line.value]),
		...parseCustomFields(member.customFields).fields.flatMap((field, at): [string, string][] => [
			[`/customFields/${String(at)}/title`, field.title],
			[`/customFields/${String(at)}/content`, field.content],
		]),
	];
}

/** Every text of the notes beside the manuscript: the notes of the steps, then the characters, the scenes and the worldbuilding. */
function noteSources(project: ProjectSnapshot): Source[] {
	const sources: Source[] = [];
	const add = (kind: string, path: string, title: string, id: string | null, step: number | null, fields: readonly [string, string][]): void => {
		for (const [field, text] of fields) {
			if (text.length > 0) sources.push({ kind, path, title, id, step, field, text });
		}
	};
	for (let step = 1; step <= 10; step += 1) {
		if (!isEditableStep(step)) continue;
		const told = stepTextOf(project, step);
		if (told === null) continue;
		const sections = told['sections'];
		const path = typeof told['path'] === 'string' ? told['path'] : '';
		add(
			'step',
			path,
			fileStem(path),
			null,
			step,
			Object.entries(isJsonObject(sections) ? sections : {}).map(([id, text]): [string, string] => [`/sections/${id}`, typeof text === 'string' ? text : '']),
		);
	}
	for (const character of project.characters) {
		add('character', character.path, character.name, character.characterId, null, [
			['/name', character.name],
			['/oneSentenceStoryline', character.oneSentenceStoryline],
			['/motivation', character.motivation],
			['/goal', character.goal],
			['/conflict', character.conflict],
			['/growth', character.growth],
			['/oneParagraphStoryline', character.oneParagraphStoryline],
			['/characterSynopsis', character.characterSynopsis],
			['/characterProfile', character.characterProfile],
			...sharedFields(character),
		]);
	}
	for (const scene of project.scenes) {
		add('scene', scene.path, scene.title, scene.sceneId, null, [
			['/title', scene.title],
			['/conflict', scene.conflict],
			['/events', scene.events],
			['/planning', scene.planning],
			...sharedFields(scene),
		]);
	}
	for (const kind of project.worldbuildingKinds) {
		for (const entity of entitiesOf(project, kind.id)) {
			add(entity.kind, entity.path, entity.name, entity.entityId, null, [
				['/name', entity.name],
				['/description', entity.description],
				['/notes', entity.notes],
				...sharedFields(entity),
			]);
		}
	}
	return sources;
}

/** Where each line of a text begins. */
function lineStarts(text: string): number[] {
	const starts = [0];
	for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
	return starts;
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * The line some words stand in, with where in it they stand. A line of
 * prose is a paragraph and may run long, so one that does is told by the
 * part around the words.
 */
function excerptOf(text: string, starts: readonly number[], range: TextRange): { line: number; text: string; at: { from: number; to: number } } {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if ((starts[middle] ?? 0) <= range.from) low = middle;
		else high = middle - 1;
	}
	const lineStart = starts[low] ?? 0;
	const next = starts[low + 1];
	const lineEnd = next === undefined ? text.length : next - 1;
	let from = lineStart;
	let to = lineEnd;
	if (to - from > SEARCH_EXCERPT) {
		const lead = Math.floor((SEARCH_EXCERPT - Math.min(range.to - range.from, SEARCH_EXCERPT)) / 2);
		from = Math.max(lineStart, range.from - lead);
		to = Math.min(lineEnd, from + SEARCH_EXCERPT);
		from = Math.max(lineStart, to - SEARCH_EXCERPT);
		// A character written as two units is never cut in half.
		if (from > lineStart && isLowSurrogate(text.charCodeAt(from))) from += 1;
		if (to < lineEnd && isHighSurrogate(text.charCodeAt(to - 1))) to -= 1;
	}
	return {
		line: low + 1,
		text: text.slice(from, to),
		at: { from: Math.max(range.from, from) - from, to: Math.max(Math.min(range.to, to), from) - from },
	};
}

/** A place a revision or a thread's appearance keeps in a note: words a replacement can take out from under it. */
type Mark = RevisionSpot & { path: string; family: 'revision' | 'foreshadowing' };

async function marksOf(context: ApiContext, project: ProjectSnapshot): Promise<Mark[]> {
	const revisions = await context.host.projects.revisions.list(project);
	const threads = await context.host.projects.foreshadowing.list(project);
	return [
		...revisions.map((revision): Mark => ({ ...revision, family: 'revision' })),
		...threads.flatMap((item) =>
			item.occurrences.map((occurrence): Mark => ({ ...occurrenceSpot(occurrence), path: occurrence.path, family: 'foreshadowing' })),
		),
	];
}

/**
 * Words found in a project, and words put in their place across its
 * manuscript. Both go through the plugin's own find bar's engine, so a
 * whole word and a letter's case mean here what they mean there. The words
 * are looked for in the text as it is written, Markdown and all.
 */
export const searchOperations: OperationGroup = {
	searchProject: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const search = searchOf(textParam(call, 'q'), flagParam(call, 'caseSensitive'), flagParam(call, 'wholeWord'), 'params/q');
		const where = textParam(call, 'in');
		const hits: Hit[] = [];
		const texts = new Map<Source, number[]>();
		let truncated = false;
		const look = (source: Source): void => {
			if (hits.length >= SEARCH_HITS) {
				// One more place anywhere says the list was cut short.
				truncated ||= findTextMatches(source.text, search, 1).length > 0;
				return;
			}
			const found = findTextMatches(source.text, search, SEARCH_HITS - hits.length + 1);
			if (hits.length + found.length > SEARCH_HITS) truncated = true;
			for (const range of found.slice(0, SEARCH_HITS - hits.length)) hits.push({ source, range });
		};
		if (where !== 'notes') {
			const manuscript = context.host.projects.manuscript;
			for (const segment of await manuscript.listSegmentsFromFiles(project)) {
				if (truncated) break;
				const content = await manuscript.readSegment(segment.path);
				look({ kind: 'manuscript', path: segment.path, title: segment.title, id: null, step: null, field: null, text: content.body });
			}
		}
		if (where !== 'manuscript') {
			for (const source of noteSources(project)) {
				if (truncated) break;
				look(source);
			}
		}
		return {
			status: 200,
			body: {
				...pageOf(hits, call, ({ source, range }) => {
					let starts = texts.get(source);
					if (starts === undefined) {
						starts = lineStarts(source.text);
						texts.set(source, starts);
					}
					return {
						kind: source.kind,
						path: source.path,
						relativePath: relativePathOf(project, source.path),
						title: source.title,
						id: source.id,
						step: source.step,
						field: source.field,
						range: { from: range.from, to: range.to },
						...excerptOf(source.text, starts, range),
					};
				}),
				truncated,
			},
		};
	},

	replaceInProject: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const body = bodyOf(call);
		const search = searchOf(String(body['query']), body['caseSensitive'] === true, body['wholeWord'] === true, '/query');
		const template = String(body['replacement']);
		const dryRun = body['dryRun'] === true;
		const manuscript = context.host.projects.manuscript;
		const segments = await manuscript.listSegmentsFromFiles(project);
		const named = Array.isArray(body['notes'])
			? new Set(body['notes'].map((relativePath: unknown, at) => noteAt(project, segments, String(relativePath), `/notes/${String(at)}`).path))
			: null;
		// In reading order, each note once, however the call named them.
		const wanted = segments.filter((segment) => named === null || named.has(segment.path));
		// What the author typed and had not saved is saved first, so the words are looked for in what the author sees.
		if (wanted.length > 0) await context.host.settleNotes(wanted.map((segment) => segment.path));
		const marks = await marksOf(context, project);
		const notes: JsonObject[] = [];
		const skipped: JsonObject[] = [];
		let replaced = 0;
		for (const segment of wanted) {
			const standing = await manuscript.readSegment(segment.path);
			// Words put back as they were are no change, and no reason to write a note.
			const changes = replacementsIn(standing.body, search, template).filter(
				(change) => change.insert !== standing.body.slice(change.from, change.to),
			);
			if (changes.length === 0) continue;
			const relativePath = relativePathOf(project, segment.path);
			if (standing.readOnly) {
				skipped.push({ relativePath, reason: 'read-only' });
				continue;
			}
			const lost = passagesLostTo(
				standing.body,
				marks.filter((mark) => mark.path === segment.path),
				changes,
			);
			let etag = standing.revision;
			if (!dryRun) {
				try {
					// The author's editor on the note is closed only now that the note is sure to be written.
					await context.host.releaseNotes([segment.path]);
					await manuscript.writeSegment(segment.path, applyReplacements(standing.body, changes), standing.revision, NOT_THE_AUTHOR);
				} catch (error) {
					// The author typed into the note in the moment between, or their editor could not save what
					// it held and was left open. Their words stand, and the rest go on.
					if (!(error instanceof ConcurrentChangeError) && !(error instanceof EditorUnsavedError)) throw error;
					skipped.push({ relativePath, reason: 'changed' });
					continue;
				}
				etag = (await manuscript.readSegment(segment.path)).revision;
			}
			replaced += changes.length;
			notes.push({
				relativePath,
				path: segment.path,
				replaced: changes.length,
				etag,
				marksLost: {
					revisions: lost.filter((mark) => mark.family === 'revision').length,
					occurrences: lost.filter((mark) => mark.family === 'foreshadowing').length,
				},
			});
		}
		return { status: 200, body: { dryRun, replaced, notes, skipped } };
	},
};
