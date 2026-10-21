/**
 * Importing one project's design into another, as pure functions over
 * shapes the service maps its records into. The service gathers a source
 * and a target (`ImportProjectContents`); this module catalogues what the
 * source offers (`catalogImportParts`), tells what already stands in the
 * target for each part (`inspectImport`), turns a selection into a plan of
 * creates, replaces and skips with every target id and path decided up
 * front (`planImport`), and rewrites each part into the target's own paths
 * and words as the service writes it (the `…InputOf` and `remap…`
 * functions).
 *
 * Nothing here touches a vault. Paths come from the target's layout and the
 * mapping the plan built, never from string replacement on the source's,
 * so a zh-CN book imports into an en one. Ids are always fresh: two books
 * that import the same note keep one note each, and a third importing from
 * both keeps two.
 */

import type { RecordLine, RecordTerm } from '../templates';
import type { BeatSheet, BeatSheetStructure } from './beat-sheet';
import { fingerprint } from './fingerprint';
import type { EntityRef, Foreshadowing, ForeshadowingOccurrence } from './foreshadowing';
import { DEFAULT_FREEFORM_VIEWPORT, type FreeformPlacement, type FreeformResource, type FreeformView } from './freeform';
import { galleryLinkTarget } from './gallery';
import type { MacaronColor } from './macaron';
import { fileStem, foldName, freeName, safeFileName } from './names';
import type { EditableStepId } from './plot-fields';
import { IMPORT_DESIGN_KINDS, IMPORT_PART_KINDS, type ImportPartKind } from './project-import-kinds';
import {
	provenanceFrom,
	type ImportChoices,
	type ImportClashPolicy,
	type ImportProvenanceDocument,
	type ImportProvenanceEntry,
} from './project-import-provenance';
import { RANK_GAP } from './rank';
import type { Revision } from './revisions';
import { SCENE_POV_OMNISCIENT, isScenePovMode } from './scene';
import type { SceneRow } from './scene-rows';
import type { StickyNote } from './sticky-note';
import type { Task } from './task';
import type { Timeline, TimelineTime } from './timeline';
import { CHARACTER_TYPES, type CharacterType, type ProgressStatus, type ProjectLanguage, type TimeKind } from './types';
import { parseWikiLink, wikiLinkText, type ParsedWikiLink } from './wikilink';
import {
	DEFINITION_FILE_IDS,
	type DefinitionFileId,
	type ProjectWorldbuildingKind,
	type WorldbuildingKindId,
} from './worldbuilding';

// ---- What a project looks like to an import --------------------------------

/**
 * The folders and words of one project, as the service reads them off its
 * layout. Every folder is a full vault path. The member folders, definition
 * roots, gallery folders and custom-field roots are keyed by entity kind:
 * `character`, `scene` and each worldbuilding kind id.
 */
export interface ImportProjectShape {
	readonly id: string;
	readonly title: string;
	readonly rootPath: string;
	readonly locale: ProjectLanguage;
	readonly kinds: readonly ProjectWorldbuildingKind[];
	readonly memberFolders: Readonly<Record<string, string>>;
	readonly definitionRoots: Readonly<Record<string, Readonly<Partial<Record<DefinitionFileId, string>>>>>;
	readonly galleryFolders: Readonly<Record<string, string>>;
	readonly customFieldRoots: Readonly<Record<string, string>>;
	readonly draftFolder: string;
	/** The seeded role node of each character type in the project's language. */
	readonly roles: Readonly<Record<CharacterType, string>>;
	/** The seeded starter nodes of each vocabulary in the project's language, in seat order. */
	readonly starters: Readonly<Record<DefinitionFileId, readonly string[]>>;
}

/** What every member note carries, whatever its kind; the service's records fit it as they are. */
export interface ImportMemberBase {
	readonly id: string;
	readonly path: string;
	readonly name: string;
	readonly rank: number;
	readonly progressStatus: ProgressStatus | null;
	readonly aliases: readonly string[];
	/** Category links exactly as stored. */
	readonly categories: readonly string[];
	readonly color: MacaronColor | null;
	/** Picture links exactly as stored. */
	readonly gallery: readonly string[];
	readonly galleryMain: string | null;
	readonly worldStatus: readonly RecordLine[];
	readonly relationships: readonly RecordLine[];
	readonly worldStatusUnrecognized: readonly string[];
	readonly relationshipsUnrecognized: readonly string[];
	readonly customFields: string;
}

export interface ImportCharacter extends ImportMemberBase {
	readonly type: CharacterType | null;
	readonly oneSentenceStoryline: string;
	readonly motivation: string;
	readonly goal: string;
	readonly conflict: string;
	readonly growth: string;
	readonly oneParagraphStoryline: string;
	readonly characterSynopsis: string;
	readonly characterProfile: string;
}

export interface ImportScene extends ImportMemberBase {
	/** A character note's path, a POV mode, or null for none. */
	readonly povPath: string | null;
	/** Stored links or plain words. */
	readonly times: readonly string[];
	readonly locations: readonly string[];
	/** Character note paths. */
	readonly characters: readonly string[];
	readonly conflict: string;
	/** Manuscript links exactly as stored. */
	readonly linkedManuscript: readonly string[];
	readonly events: string;
	readonly planning: string;
}

export interface ImportEntity extends ImportMemberBase {
	readonly kind: WorldbuildingKindId;
	readonly description: string;
	readonly timeKind: TimeKind | null;
	/** A stored link or plain words; empty when absent. */
	readonly timeStart: string;
	readonly timeEnd: string;
	readonly notes: string;
}

export interface ImportVocabularyNode {
	/** The entity kind whose tree the node stands in. */
	readonly kind: string;
	readonly id: DefinitionFileId;
	readonly taxonomyPath: string;
	/** The node's own note, a full vault path. */
	readonly selfPath: string;
	readonly description: string;
}

export interface ImportFieldTemplate {
	readonly kind: string;
	readonly name: string;
	readonly description: string;
	readonly path: string;
	readonly fields: readonly { readonly title: string; readonly content: string }[];
}

export interface ImportPicture {
	readonly kind: string;
	readonly path: string;
	readonly name: string;
}

export interface ImportChapter {
	readonly path: string;
	readonly title: string;
}

export interface ImportStep {
	readonly step: EditableStepId;
	readonly path: string;
	/** The note's managed sections by id, every one of the step's, empty where the note says nothing. */
	readonly sections: Readonly<Record<string, string>>;
}

export interface ImportBeatSheetTemplate {
	readonly name: string;
	readonly description: string;
	readonly structure: BeatSheetStructure;
}

/** Everything one project offers, or holds; the same shape for a source and a target. */
export interface ImportProjectContents {
	readonly project: ImportProjectShape;
	readonly characters: readonly ImportCharacter[];
	readonly scenes: readonly ImportScene[];
	readonly entities: readonly ImportEntity[];
	readonly vocabulary: readonly ImportVocabularyNode[];
	readonly templates: readonly ImportFieldTemplate[];
	readonly pictures: readonly ImportPicture[];
	/** In manuscript order. */
	readonly chapters: readonly ImportChapter[];
	readonly steps: readonly ImportStep[];
	readonly tasks: readonly Task[];
	readonly foreshadowing: readonly Foreshadowing[];
	readonly revisions: readonly Revision[];
	readonly stickyNotes: readonly StickyNote[];
	readonly freeformViews: readonly FreeformView[];
	readonly timelines: readonly Timeline[];
	readonly beatSheets: readonly BeatSheet[];
	readonly beatSheetTemplates: readonly ImportBeatSheetTemplate[];
}

// ---- Parts -----------------------------------------------------------------

/** The record behind a part, by kind. */
export type ImportRecord =
	| { readonly kind: 'step'; readonly step: ImportStep }
	| { readonly kind: 'character'; readonly member: ImportCharacter }
	| { readonly kind: 'scene'; readonly member: ImportScene }
	| { readonly kind: 'worldbuilding'; readonly member: ImportEntity }
	| { readonly kind: 'vocabulary'; readonly node: ImportVocabularyNode }
	| { readonly kind: 'custom-field-template'; readonly template: ImportFieldTemplate }
	| { readonly kind: 'picture'; readonly picture: ImportPicture }
	| { readonly kind: 'chapter'; readonly chapter: ImportChapter }
	| { readonly kind: 'task'; readonly task: Task }
	| { readonly kind: 'foreshadowing'; readonly thread: Foreshadowing }
	| { readonly kind: 'revision'; readonly revision: Revision }
	| { readonly kind: 'sticky-note'; readonly note: StickyNote }
	| { readonly kind: 'freeform-view'; readonly view: FreeformView }
	| { readonly kind: 'timeline'; readonly timeline: Timeline }
	| { readonly kind: 'beat-sheet'; readonly sheet: BeatSheet }
	| { readonly kind: 'beat-sheet-template'; readonly template: ImportBeatSheetTemplate };

/** A reference from one part to another that an import offers to follow but never forces. */
export interface ImportLink {
	readonly key: string;
	/** Which field holds it: `pov`, `cast`, `time`, `location`, `record`, `linked-manuscript`, `related`, `chapter`, `placement`, `file`, `scene`, `binding`, `time-span`. */
	readonly field: string;
}

export interface ImportPart {
	/** `${kind}:${sourceId}`, unique in a catalogue. */
	readonly key: string;
	readonly kind: ImportPartKind;
	/** A note's or record's id, a step number, `kind/vocabulary/taxonomy` for a node, `kind/name` for a field template, a vault path for a picture or a chapter, a name for a beat sheet template. */
	readonly sourceId: string;
	readonly sourcePath: string | null;
	readonly name: string;
	/** `character`, `scene` or the worldbuilding kind id the part belongs to; null for the rest. */
	readonly group: string | null;
	/** Where a dialog shows the part when it has no row of its own: `kind/vocabulary` for a node, the kind for a field template, `pictures` for a picture. */
	readonly bucket: string | null;
	readonly defaultSelected: boolean;
	/** Parts brought along whenever this one is: its nodes, its pictures, a node's parents. */
	readonly requires: readonly string[];
	readonly links: readonly ImportLink[];
	readonly record: ImportRecord;
}

const MEMBER_KINDS: ReadonlySet<ImportPartKind> = new Set<ImportPartKind>(['character', 'scene', 'worldbuilding']);
const OWN_ID_KINDS: ReadonlySet<ImportPartKind> = new Set<ImportPartKind>([
	'character',
	'scene',
	'worldbuilding',
	'task',
	'foreshadowing',
	'revision',
	'sticky-note',
	'freeform-view',
	'timeline',
	'beat-sheet',
]);

export const isImportMemberKind = (kind: ImportPartKind): boolean => MEMBER_KINDS.has(kind);
/** Whether a part of the kind is told apart by an id of its own rather than by a path. */
export const importKindHasOwnId = (kind: ImportPartKind): boolean => OWN_ID_KINDS.has(kind);

export function importPartKey(kind: ImportPartKind, sourceId: string): string {
	return `${kind}:${sourceId}`;
}

// ---- Paths and names --------------------------------------------------------

/** A note path as the mapping keys it: trimmed, with the `.md` a link never shows dropped. */
export function importPathKey(path: string): string {
	return path.trim().replace(/\.md$/u, '');
}

/** Paths compared the way a case-blind file system compares them. */
const foldPath = (path: string): string => path.normalize('NFC').toLowerCase();

const isUnder = (path: string, root: string): boolean =>
	importPathKey(path).startsWith(`${root.trim().replace(/\/+$/u, '')}/`);

/** The last segment of a taxonomy path, which names the node's own note. */
function nodeNoteNameOf(taxonomy: string): string {
	const segments = taxonomy.split('/').filter((segment) => segment.trim().length > 0);
	return segments[segments.length - 1]?.trim() ?? taxonomy.trim();
}

/** A node's own note below a root, without its extension: `<root>/<taxonomy>/<leaf>`. */
export function importNodePath(rootPath: string, taxonomy: string): string {
	return `${rootPath}/${taxonomy}/${nodeNoteNameOf(taxonomy)}`;
}

/**
 * The taxonomy path a link target names below a vocabulary root: the
 * segments between the two, with the node's own note stripped off the end
 * where it repeats the folder before it. Null when the target is not under
 * the root. Mirrors the service's reading of a stored link.
 */
export function taxonomyBelow(target: string, rootPath: string): string | null {
	const cleaned = importPathKey(target);
	const prefix = `${rootPath.trim().replace(/\/+$/u, '')}/`;
	if (!cleaned.startsWith(prefix)) return null;
	const segments = cleaned
		.slice(prefix.length)
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
	const last = segments[segments.length - 1];
	const parent = segments[segments.length - 2];
	if (last !== undefined && parent !== undefined && foldName(last) === foldName(parent)) segments.pop();
	return segments.length === 0 ? null : segments.join('/');
}

const foldTaxonomy = (taxonomy: string): string => taxonomy.split('/').map(foldName).join('/');

const nodeKey = (kind: string, id: DefinitionFileId, taxonomy: string): string =>
	`${kind}/${id}/${foldTaxonomy(taxonomy)}`;

interface LocatedNode {
	readonly kind: string;
	readonly id: DefinitionFileId;
	readonly taxonomy: string;
}

/** Which vocabulary tree of a project a note path lies in, and where in it. */
function locateNode(shape: ImportProjectShape, path: string): LocatedNode | null {
	for (const [kind, roots] of Object.entries(shape.definitionRoots)) {
		for (const id of DEFINITION_FILE_IDS) {
			const root = roots[id];
			if (root === undefined) continue;
			const taxonomy = taxonomyBelow(path, root);
			if (taxonomy !== null) return { kind, id, taxonomy };
		}
	}
	return null;
}

function roleTypeOf(
	name: string,
	roles: ReadonlyArray<Readonly<Record<CharacterType, string>>>,
): CharacterType | null {
	for (const map of roles) {
		for (const type of CHARACTER_TYPES) if (map[type] === name) return type;
	}
	return null;
}

/** Where a member note of that name would be written in the target; null while the kind has no folder there yet or the name has no safe file name. */
export function plannedMemberPath(target: ImportProjectShape, kind: string, name: string): string | null {
	const folder = target.memberFolders[kind];
	if (folder === undefined) return null;
	try {
		return `${folder}/${safeFileName(name)}.md`;
	} catch {
		return null;
	}
}

// ---- Translating words between two projects --------------------------------

export interface ImportTranslation {
	readonly source: ImportProjectShape;
	readonly target: ImportProjectShape;
	/** The target's vocabulary nodes by kind, vocabulary and folded taxonomy. */
	readonly targetNodes: ReadonlyMap<string, ImportVocabularyNode>;
}

export function importTranslation(source: ImportProjectContents, target: ImportProjectContents): ImportTranslation {
	const targetNodes = new Map<string, ImportVocabularyNode>();
	for (const node of target.vocabulary) targetNodes.set(nodeKey(node.kind, node.id, node.taxonomyPath), node);
	return { source: source.project, target: target.project, targetNodes };
}

/**
 * A taxonomy path said in the target's words. A character's role segment
 * becomes the target language's role, so the generated base keeps grouping
 * by it. A seeded starter word of a world status or a relationship becomes
 * the target's word of the same seat, where that node stands. Every other
 * word crosses verbatim: the author's own vocabulary is theirs in any
 * language.
 */
export function translateTaxonomy(
	translation: ImportTranslation,
	kind: string,
	id: DefinitionFileId,
	taxonomy: string,
): string {
	const segments = taxonomy.split('/');
	const first = segments[0];
	if (first === undefined) return taxonomy;
	if (id === 'category') {
		if (kind !== 'character') return taxonomy;
		const type = roleTypeOf(first, [translation.source.roles, translation.target.roles]);
		if (type === null) return taxonomy;
		segments[0] = translation.target.roles[type];
		return segments.join('/');
	}
	const seat = translation.source.starters[id].indexOf(first);
	if (seat === -1) return taxonomy;
	const word = translation.target.starters[id][seat];
	if (word === undefined || word === first || !translation.targetNodes.has(nodeKey(kind, id, word))) return taxonomy;
	segments[0] = word;
	return segments.join('/');
}

// ---- Projection: a part's design, free of where it is kept ----------------

/**
 * Answers the stable id of the member note a link target names, in one
 * project, and null for a target that names no member of it. A projection
 * made with it survives a rename of the linked note, which rewrites the
 * link's path and its display name alike but never the id behind them.
 */
export type ImportLinkResolver = (target: string) => string | null;

/** The resolver of one project's members, by every spelling a link takes: with or without the extension. */
export function importLinkResolver(contents: Pick<ImportProjectContents, 'characters' | 'scenes' | 'entities'>): ImportLinkResolver {
	const ids = new Map<string, string>();
	for (const member of [...contents.characters, ...contents.scenes, ...contents.entities]) {
		ids.set(importPathKey(member.path), member.id);
	}
	return (target) => ids.get(importPathKey(target)) ?? null;
}

/** A linked member by its id, else the words a link or a term reads as. */
type ProjectedWord = string | { readonly id: string };

const linkedOrWord = (target: string, word: string, resolve: ImportLinkResolver): ProjectedWord => {
	const id = resolve(target);
	return id === null ? word : { id };
};

/** What a stored link or plain words read as: the member linked, else the alias, else the note's name, else the words. */
function linkWord(raw: string, resolve: ImportLinkResolver): ProjectedWord {
	const link = parseWikiLink(raw);
	if (link === null) return raw.trim();
	return linkedOrWord(link.target, link.alias !== null && link.alias.length > 0 ? link.alias : fileStem(link.target), resolve);
}

const termWord = (term: RecordTerm, resolve: ImportLinkResolver): ProjectedWord =>
	term.kind === 'link' ? linkedOrWord(term.path, term.name, resolve) : term.text;

function lineProjection(line: RecordLine, resolve: ImportLinkResolver): unknown {
	return {
		label: line.label.display,
		value: line.value,
		clauses: line.clauses.map((clause) =>
			clause.kind === 'span'
				? { kind: 'span', start: termWord(clause.start, resolve), end: termWord(clause.end, resolve) }
				: { kind: clause.kind, term: termWord(clause.term, resolve) },
		),
	};
}

const PROSE_LINK = /\[\[([^\]|#]+)((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]/gu;

/** Prose with every link to a member naming it by id: what Obsidian rewrites on a rename is the path, and the alias stays. */
function proseProjection(text: string, resolve: ImportLinkResolver): string {
	return text.replace(PROSE_LINK, (whole: string, target: string, subpath: string, alias: string) => {
		const id = resolve(target);
		return id === null ? whole : `[[${id}${subpath}${alias}]]`;
	});
}

const refWords = (refs: readonly EntityRef[]): unknown[] => refs.map((ref) => ({ kind: ref.kind, name: ref.name }));

function memberProjection(member: ImportMemberBase, resolve: ImportLinkResolver): Record<string, unknown> {
	return {
		name: member.name,
		progressStatus: member.progressStatus,
		aliases: [...member.aliases],
		categories: member.categories.map((raw) => linkWord(raw, resolve)),
		color: member.color,
		gallery: member.gallery.map((raw) => linkWord(raw, resolve)),
		galleryMain: member.galleryMain === null ? null : linkWord(member.galleryMain, resolve),
		worldStatus: member.worldStatus.map((line) => lineProjection(line, resolve)),
		relationships: member.relationships.map((line) => lineProjection(line, resolve)),
		worldStatusUnrecognized: [...member.worldStatusUnrecognized],
		relationshipsUnrecognized: [...member.relationshipsUnrecognized],
		customFields: proseProjection(member.customFields, resolve),
	};
}

function resourceProjection(resource: FreeformResource): unknown {
	switch (resource.type) {
		case 'entity':
			return { type: 'entity', kind: resource.kind, name: resource.name };
		case 'file':
			return { type: 'file', name: fileStem(resource.path) };
		case 'link':
			return { type: 'link', url: resource.url, label: resource.label };
		case 'text':
			return { type: 'text', text: resource.text };
		default:
			return { type: resource.type, name: resource.name };
	}
}

const rowsProjection = (rows: readonly SceneRow[]): unknown[] =>
	rows.map((row) => ({ text: row.text, scenes: row.scenes.length }));

/**
 * The design a part carries, with nothing of where it is kept: linked
 * members by id, other links by name, taxonomy paths in place of node
 * links, picture names in place of gallery links. A copy projects the same
 * whatever project holds it, and a note renamed elsewhere in the project
 * leaves a part's projection alone, which the note's whole-file fingerprint
 * would not: the rename rewrites the links that name it, and the id behind
 * them stays. The resolver is the project's own, the source's for a source
 * part and the target's for a copy, so each side is measured against itself.
 */
export function projectionOf(record: ImportRecord, resolve: ImportLinkResolver): unknown {
	switch (record.kind) {
		case 'step': {
			const sections: Record<string, string> = {};
			for (const [id, value] of Object.entries(record.step.sections)) sections[id] = proseProjection(value, resolve);
			return { kind: 'step', step: record.step.step, sections };
		}
		case 'character': {
			const member = record.member;
			const prose = (text: string): string => proseProjection(text, resolve);
			return {
				kind: 'character',
				...memberProjection(member, resolve),
				type: member.type,
				oneSentenceStoryline: prose(member.oneSentenceStoryline),
				motivation: prose(member.motivation),
				goal: prose(member.goal),
				conflict: prose(member.conflict),
				growth: prose(member.growth),
				oneParagraphStoryline: prose(member.oneParagraphStoryline),
				characterSynopsis: prose(member.characterSynopsis),
				characterProfile: prose(member.characterProfile),
			};
		}
		case 'scene': {
			const member = record.member;
			const prose = (text: string): string => proseProjection(text, resolve);
			return {
				kind: 'scene',
				...memberProjection(member, resolve),
				pov:
					member.povPath === null
						? null
						: isScenePovMode(member.povPath)
							? member.povPath
							: linkedOrWord(member.povPath, fileStem(member.povPath), resolve),
				characters: member.characters.map((path) => linkedOrWord(path, fileStem(path), resolve)),
				times: member.times.map((raw) => linkWord(raw, resolve)),
				locations: member.locations.map((raw) => linkWord(raw, resolve)),
				conflict: prose(member.conflict),
				events: prose(member.events),
				planning: prose(member.planning),
				linkedManuscript: member.linkedManuscript.map((raw) => {
					const link = parseWikiLink(raw);
					return link === null
						? raw.trim()
						: { note: fileStem(link.target), subpath: link.subpath, alias: link.alias };
				}),
			};
		}
		case 'worldbuilding': {
			const member = record.member;
			const prose = (text: string): string => proseProjection(text, resolve);
			return {
				kind: 'worldbuilding',
				...memberProjection(member, resolve),
				entityKind: member.kind,
				description: prose(member.description),
				timeKind: member.timeKind,
				timeStart: linkWord(member.timeStart, resolve),
				timeEnd: linkWord(member.timeEnd, resolve),
				notes: prose(member.notes),
			};
		}
		case 'vocabulary':
			return { kind: 'vocabulary', taxonomy: record.node.taxonomyPath, description: record.node.description };
		case 'custom-field-template':
			return {
				kind: 'custom-field-template',
				name: record.template.name,
				description: record.template.description,
				fields: record.template.fields.map((field) => ({ title: field.title, content: field.content })),
			};
		case 'picture':
			return { kind: 'picture', name: record.picture.name };
		case 'chapter':
			return { kind: 'chapter', title: record.chapter.title };
		case 'task': {
			const task = record.task;
			return {
				kind: 'task',
				title: task.title,
				description: task.description,
				status: task.status,
				priority: task.priority,
				dueDate: task.dueDate,
				related: refWords(task.related),
				archived: task.archived,
			};
		}
		case 'foreshadowing': {
			const thread = record.thread;
			return {
				kind: 'foreshadowing',
				name: thread.name,
				description: thread.description,
				status: thread.status,
				related: refWords(thread.related),
				occurrences: thread.occurrences.map((occurrence) => ({
					role: occurrence.role,
					note: occurrence.note,
					chapter: fileStem(occurrence.path),
					originalText: occurrence.originalText,
				})),
			};
		}
		case 'revision': {
			const revision = record.revision;
			return {
				kind: 'revision',
				chapter: fileStem(revision.path),
				change: revision.kind,
				originalText: revision.originalText,
				proposed: revision.proposed,
				comment: revision.comment,
			};
		}
		case 'sticky-note':
			return { kind: 'sticky-note', color: record.note.color, body: record.note.body, archived: record.note.archived };
		case 'freeform-view': {
			const view = record.view;
			return {
				kind: 'freeform-view',
				name: view.name,
				placements: view.placements.map((placement) => ({
					resource: resourceProjection(placement.resource),
					x: placement.x,
					y: placement.y,
					width: placement.width,
					height: placement.height,
					displayMode: placement.displayMode,
				})),
				frames: view.frames.map((frame) => ({
					title: frame.title,
					color: frame.color,
					x: frame.x,
					y: frame.y,
					width: frame.width,
					height: frame.height,
				})),
				edges: view.edges.length,
			};
		}
		case 'timeline': {
			const timeline = record.timeline;
			return {
				kind: 'timeline',
				name: timeline.name,
				binding: timeline.binding === null ? null : { kind: timeline.binding.kind, name: timeline.binding.name },
				times: timeline.times.map((time) => ({ rows: rowsProjection(time.rows) })),
			};
		}
		case 'beat-sheet': {
			const sheet = record.sheet;
			return {
				kind: 'beat-sheet',
				name: sheet.name,
				presentation: sheet.presentation,
				showSubDescriptions: sheet.showSubDescriptions,
				reversed: sheet.reversed,
				acts: sheet.acts.map((act) => ({
					label: act.label,
					beats: act.beats.map((beat) => ({
						name: beat.name,
						description: beat.description,
						rows: rowsProjection(beat.rows),
					})),
				})),
			};
		}
		case 'beat-sheet-template':
			return {
				kind: 'beat-sheet-template',
				name: record.template.name,
				description: record.template.description,
				structure: record.template.structure,
			};
	}
}

/** The fingerprint provenance keeps of a part: of its projection, not its bytes. */
export function importHash(record: ImportRecord, resolve: ImportLinkResolver): string {
	return fingerprint(projectionOf(record, resolve));
}

// ---- Catalogue ---------------------------------------------------------------

/** A step note that says nothing: not offered by a source, and no namesake in a target. */
const stepIsEmpty = (step: ImportStep): boolean =>
	Object.values(step.sections).every((value) => value.trim().length === 0);

const firstLine = (text: string): string => {
	const line = text
		.split('\n')
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.length > 0);
	return line === undefined ? '' : line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

/** Everything a project offers, in the order a dialog lists it, each part naming what it needs and what it points at. */
export function catalogImportParts(contents: ImportProjectContents): ImportPart[] {
	const shape = contents.project;
	const parts: ImportPart[] = [];
	const keyById = new Map<string, string>();
	const keyByPath = new Map<string, string>();
	const keyByNode = new Map<string, string>();

	for (const member of contents.characters) {
		keyById.set(member.id, importPartKey('character', member.id));
		keyByPath.set(importPathKey(member.path), importPartKey('character', member.id));
	}
	for (const member of contents.scenes) {
		keyById.set(member.id, importPartKey('scene', member.id));
		keyByPath.set(importPathKey(member.path), importPartKey('scene', member.id));
	}
	for (const member of contents.entities) {
		keyById.set(member.id, importPartKey('worldbuilding', member.id));
		keyByPath.set(importPathKey(member.path), importPartKey('worldbuilding', member.id));
	}
	for (const node of contents.vocabulary) {
		keyByNode.set(
			nodeKey(node.kind, node.id, node.taxonomyPath),
			importPartKey('vocabulary', `${node.kind}/${node.id}/${node.taxonomyPath}`),
		);
	}
	for (const picture of contents.pictures) {
		keyByPath.set(importPathKey(picture.path), importPartKey('picture', picture.path));
	}
	for (const chapter of contents.chapters) {
		keyByPath.set(importPathKey(chapter.path), importPartKey('chapter', chapter.path));
	}
	for (const task of contents.tasks) keyById.set(task.id, importPartKey('task', task.id));
	for (const thread of contents.foreshadowing) keyById.set(thread.id, importPartKey('foreshadowing', thread.id));
	for (const revision of contents.revisions) keyById.set(revision.id, importPartKey('revision', revision.id));
	for (const note of contents.stickyNotes) keyById.set(note.id, importPartKey('sticky-note', note.id));

	const nodeKeyOf = (path: string): string | null => {
		const located = locateNode(shape, path);
		if (located === null) return null;
		return keyByNode.get(nodeKey(located.kind, located.id, located.taxonomy)) ?? null;
	};
	const memberRequires = (member: ImportMemberBase, kind: string): string[] => {
		const found: string[] = [];
		const add = (key: string | null): void => {
			if (key !== null && !found.includes(key)) found.push(key);
		};
		for (const raw of member.categories) {
			const link = parseWikiLink(raw);
			if (link === null) continue;
			const located = locateNode(shape, link.target);
			if (located === null) continue;
			// The role is a seeded node of every project, carried as the type.
			if (
				kind === 'character' &&
				located.id === 'category' &&
				roleTypeOf(located.taxonomy, [shape.roles]) !== null
			) {
				continue;
			}
			add(keyByNode.get(nodeKey(located.kind, located.id, located.taxonomy)) ?? null);
		}
		for (const line of member.worldStatus) add(nodeKeyOf(line.label.path));
		for (const line of member.relationships) add(nodeKeyOf(line.label.path));
		for (const raw of member.gallery) {
			const target = galleryLinkTarget(raw);
			if (target !== null) add(keyByPath.get(importPathKey(target)) ?? null);
		}
		return found;
	};
	const linksOf = (): { list: ImportLink[]; addPath: (path: string, field: string) => void; addId: (id: string, field: string) => void } => {
		const list: ImportLink[] = [];
		const push = (key: string | undefined, field: string): void => {
			if (key === undefined) return;
			if (!list.some((link) => link.key === key && link.field === field)) list.push({ key, field });
		};
		return {
			list,
			addPath: (path, field) => push(keyByPath.get(importPathKey(path)), field),
			addId: (id, field) => push(keyById.get(id), field),
		};
	};
	const addRecordLinks = (member: ImportMemberBase, links: ReturnType<typeof linksOf>): void => {
		const addTerm = (term: RecordTerm): void => {
			if (term.kind === 'link') links.addPath(term.path, 'record');
		};
		for (const line of [...member.worldStatus, ...member.relationships]) {
			for (const clause of line.clauses) {
				if (clause.kind === 'span') {
					addTerm(clause.start);
					addTerm(clause.end);
				} else {
					addTerm(clause.term);
				}
			}
		}
	};
	const addStoredTermLink = (raw: string, field: string, links: ReturnType<typeof linksOf>): void => {
		const link = parseWikiLink(raw);
		if (link !== null) links.addPath(link.target, field);
	};

	for (const step of contents.steps) {
		if (stepIsEmpty(step)) continue;
		parts.push({
			key: importPartKey('step', String(step.step)),
			kind: 'step',
			sourceId: String(step.step),
			sourcePath: step.path,
			name: String(step.step),
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: [],
			record: { kind: 'step', step },
		});
	}
	const byRank = <T extends { readonly rank: number }>(members: readonly T[]): T[] =>
		[...members].sort((left, right) => left.rank - right.rank);
	for (const member of byRank(contents.characters)) {
		const links = linksOf();
		addRecordLinks(member, links);
		parts.push({
			key: importPartKey('character', member.id),
			kind: 'character',
			sourceId: member.id,
			sourcePath: member.path,
			name: member.name,
			group: 'character',
			bucket: null,
			defaultSelected: true,
			requires: memberRequires(member, 'character'),
			links: links.list,
			record: { kind: 'character', member },
		});
	}
	for (const member of byRank(contents.scenes)) {
		const links = linksOf();
		if (member.povPath !== null && !isScenePovMode(member.povPath)) links.addPath(member.povPath, 'pov');
		for (const path of member.characters) links.addPath(path, 'cast');
		for (const raw of member.times) addStoredTermLink(raw, 'time', links);
		for (const raw of member.locations) addStoredTermLink(raw, 'location', links);
		addRecordLinks(member, links);
		for (const raw of member.linkedManuscript) addStoredTermLink(raw, 'linked-manuscript', links);
		parts.push({
			key: importPartKey('scene', member.id),
			kind: 'scene',
			sourceId: member.id,
			sourcePath: member.path,
			name: member.name,
			group: 'scene',
			bucket: null,
			defaultSelected: true,
			requires: memberRequires(member, 'scene'),
			links: links.list,
			record: { kind: 'scene', member },
		});
	}
	const kindOrder = new Map<string, number>([['character', 0], ['scene', 1]]);
	for (const kind of shape.kinds) kindOrder.set(kind.id, kindOrder.size);
	const kindRank = (kind: string): number => kindOrder.get(kind) ?? kindOrder.size;
	const entities = [...contents.entities].sort(
		(left, right) => kindRank(left.kind) - kindRank(right.kind) || left.rank - right.rank,
	);
	for (const member of entities) {
		const links = linksOf();
		addStoredTermLink(member.timeStart, 'time-span', links);
		addStoredTermLink(member.timeEnd, 'time-span', links);
		addRecordLinks(member, links);
		parts.push({
			key: importPartKey('worldbuilding', member.id),
			kind: 'worldbuilding',
			sourceId: member.id,
			sourcePath: member.path,
			name: member.name,
			group: member.kind,
			bucket: null,
			defaultSelected: true,
			requires: memberRequires(member, member.kind),
			links: links.list,
			record: { kind: 'worldbuilding', member },
		});
	}
	const vocabularyRank = (id: DefinitionFileId): number => DEFINITION_FILE_IDS.indexOf(id);
	const depthOf = (taxonomy: string): number => taxonomy.split('/').length;
	const nodes = [...contents.vocabulary].sort(
		(left, right) =>
			kindRank(left.kind) - kindRank(right.kind) ||
			vocabularyRank(left.id) - vocabularyRank(right.id) ||
			depthOf(left.taxonomyPath) - depthOf(right.taxonomyPath) ||
			left.taxonomyPath.localeCompare(right.taxonomyPath),
	);
	for (const node of nodes) {
		const key = importPartKey('vocabulary', `${node.kind}/${node.id}/${node.taxonomyPath}`);
		const segments = node.taxonomyPath.split('/');
		const parent = segments.length > 1 ? keyByNode.get(nodeKey(node.kind, node.id, segments.slice(0, -1).join('/'))) : undefined;
		parts.push({
			key,
			kind: 'vocabulary',
			sourceId: `${node.kind}/${node.id}/${node.taxonomyPath}`,
			sourcePath: node.selfPath,
			name: node.taxonomyPath,
			group: node.kind,
			bucket: `${node.kind}/${node.id}`,
			defaultSelected: true,
			requires: parent === undefined ? [] : [parent],
			links: [],
			record: { kind: 'vocabulary', node },
		});
	}
	const templates = [...contents.templates].sort(
		(left, right) => kindRank(left.kind) - kindRank(right.kind) || left.name.localeCompare(right.name),
	);
	for (const template of templates) {
		parts.push({
			key: importPartKey('custom-field-template', `${template.kind}/${template.name}`),
			kind: 'custom-field-template',
			sourceId: `${template.kind}/${template.name}`,
			sourcePath: template.path,
			name: template.name,
			group: template.kind,
			bucket: template.kind,
			defaultSelected: true,
			requires: [],
			links: [],
			record: { kind: 'custom-field-template', template },
		});
	}
	for (const picture of contents.pictures) {
		parts.push({
			key: importPartKey('picture', picture.path),
			kind: 'picture',
			sourceId: picture.path,
			sourcePath: picture.path,
			name: picture.name,
			group: picture.kind,
			bucket: 'pictures',
			defaultSelected: true,
			requires: [],
			links: [],
			record: { kind: 'picture', picture },
		});
	}
	for (const chapter of contents.chapters) {
		parts.push({
			key: importPartKey('chapter', chapter.path),
			kind: 'chapter',
			sourceId: chapter.path,
			sourcePath: chapter.path,
			name: chapter.title,
			group: null,
			bucket: null,
			defaultSelected: false,
			requires: [],
			links: [],
			record: { kind: 'chapter', chapter },
		});
	}
	for (const task of contents.tasks) {
		const links = linksOf();
		for (const ref of task.related) links.addId(ref.id, 'related');
		parts.push({
			key: importPartKey('task', task.id),
			kind: 'task',
			sourceId: task.id,
			sourcePath: null,
			name: task.title,
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: links.list,
			record: { kind: 'task', task },
		});
	}
	for (const thread of contents.foreshadowing) {
		const links = linksOf();
		for (const ref of thread.related) links.addId(ref.id, 'related');
		for (const occurrence of thread.occurrences) links.addPath(occurrence.path, 'chapter');
		parts.push({
			key: importPartKey('foreshadowing', thread.id),
			kind: 'foreshadowing',
			sourceId: thread.id,
			sourcePath: null,
			name: thread.name,
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: links.list,
			record: { kind: 'foreshadowing', thread },
		});
	}
	for (const revision of contents.revisions) {
		const links = linksOf();
		links.addPath(revision.path, 'chapter');
		parts.push({
			key: importPartKey('revision', revision.id),
			kind: 'revision',
			sourceId: revision.id,
			sourcePath: null,
			name: revision.originalText.length > 0 ? firstLine(revision.originalText) : firstLine(revision.proposed),
			group: null,
			bucket: null,
			defaultSelected: false,
			requires: [],
			links: links.list,
			record: { kind: 'revision', revision },
		});
	}
	for (const note of contents.stickyNotes) {
		parts.push({
			key: importPartKey('sticky-note', note.id),
			kind: 'sticky-note',
			sourceId: note.id,
			sourcePath: note.path,
			name: firstLine(note.body),
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: [],
			record: { kind: 'sticky-note', note },
		});
	}
	for (const view of contents.freeformViews) {
		const links = linksOf();
		for (const placement of view.placements) {
			const resource = placement.resource;
			if (resource.type === 'entity') links.addId(resource.id, 'placement');
			else if (resource.type === 'file') links.addPath(`${shape.rootPath}/${resource.path}`, 'file');
			else if (resource.type !== 'link' && resource.type !== 'text') links.addId(resource.id, 'record');
		}
		parts.push({
			key: importPartKey('freeform-view', view.id),
			kind: 'freeform-view',
			sourceId: view.id,
			sourcePath: null,
			name: view.name,
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: links.list,
			record: { kind: 'freeform-view', view },
		});
	}
	for (const timeline of contents.timelines) {
		const links = linksOf();
		if (timeline.binding !== null) links.addId(timeline.binding.id, 'binding');
		for (const time of timeline.times) {
			links.addId(time.timeId, 'time');
			for (const row of time.rows) for (const sceneId of row.scenes) links.addId(sceneId, 'scene');
		}
		parts.push({
			key: importPartKey('timeline', timeline.id),
			kind: 'timeline',
			sourceId: timeline.id,
			sourcePath: null,
			name: timeline.name,
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: links.list,
			record: { kind: 'timeline', timeline },
		});
	}
	for (const sheet of contents.beatSheets) {
		const links = linksOf();
		for (const act of sheet.acts) {
			for (const beat of act.beats) {
				for (const row of beat.rows) for (const sceneId of row.scenes) links.addId(sceneId, 'scene');
			}
		}
		parts.push({
			key: importPartKey('beat-sheet', sheet.id),
			kind: 'beat-sheet',
			sourceId: sheet.id,
			sourcePath: null,
			name: sheet.name,
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: links.list,
			record: { kind: 'beat-sheet', sheet },
		});
	}
	for (const template of contents.beatSheetTemplates) {
		parts.push({
			key: importPartKey('beat-sheet-template', template.name),
			kind: 'beat-sheet-template',
			sourceId: template.name,
			sourcePath: null,
			name: template.name,
			group: null,
			bucket: null,
			defaultSelected: true,
			requires: [],
			links: [],
			record: { kind: 'beat-sheet-template', template },
		});
	}
	return parts;
}

/** The selection with everything the selected parts require, transitively; keys the catalogue does not hold are dropped. */
export function closeSelection(parts: readonly ImportPart[], selected: Iterable<string>): Set<string> {
	const byKey = new Map(parts.map((part) => [part.key, part] as const));
	const closed = new Set<string>();
	const queue: string[] = [];
	for (const key of selected) {
		if (!byKey.has(key) || closed.has(key)) continue;
		closed.add(key);
		queue.push(key);
	}
	while (queue.length > 0) {
		const key = queue.pop();
		const part = key === undefined ? undefined : byKey.get(key);
		if (part === undefined) continue;
		for (const required of part.requires) {
			if (!byKey.has(required) || closed.has(required)) continue;
			closed.add(required);
			queue.push(required);
		}
	}
	return closed;
}

/** The parts the selected ones point at and that are not selected, one hop out, in catalogue order. */
export function linkedParts(parts: readonly ImportPart[], selected: ReadonlySet<string>): string[] {
	const byKey = new Set(parts.map((part) => part.key));
	const wanted = new Set<string>();
	for (const part of parts) {
		if (!selected.has(part.key)) continue;
		for (const link of part.links) {
			if (!selected.has(link.key) && byKey.has(link.key)) wanted.add(link.key);
		}
	}
	return parts.filter((part) => wanted.has(part.key)).map((part) => part.key);
}

// ---- Inspection: what already stands in the target ------------------------

export type ImportStanding =
	| { readonly kind: 'new' }
	| {
			/** `existing`: a namesake with no provenance from this source; the rest compare a copy's provenance. */
			readonly kind: 'existing' | 'unchanged' | 'update' | 'conflict';
			readonly targetId: string | null;
			readonly targetPath: string | null;
			readonly targetName: string;
	  };

/** A copy whose source part no longer exists. */
export interface ImportGonePart {
	readonly kind: ImportPartKind;
	readonly name: string;
	readonly targetId: string | null;
	readonly targetPath: string | null;
}

/** An entry a record should hold in place of the one it does, after the two sides were found to agree. */
export interface ImportProvenanceRefresh {
	/** Which record holds it: this project's own, or the source's, in which the entry names this project. */
	readonly record: 'own' | 'source';
	readonly entry: ImportProvenanceEntry;
}

export interface ImportInspection {
	readonly source: ImportProjectContents;
	readonly target: ImportProjectContents;
	readonly parts: readonly ImportPart[];
	readonly targetParts: readonly ImportPart[];
	/** Every file under the target root, folded for a case-blind comparison. */
	readonly takenPaths: ReadonlySet<string>;
	readonly standing: ReadonlyMap<string, ImportStanding>;
	readonly gone: readonly ImportGonePart[];
	/** This source's provenance entries by part key. */
	readonly provenance: ReadonlyMap<string, ImportProvenanceEntry>;
	/** The source's own entries that name this project as where their parts came from, by the source part's key. */
	readonly reverse: ReadonlyMap<string, ImportProvenanceEntry>;
	/** Entries the inspection found out of date: the two sides agree though a record remembers otherwise. */
	readonly refresh: readonly ImportProvenanceRefresh[];
	readonly lastChoices: ImportChoices | null;
}

export interface ImportInspectionInput {
	readonly source: ImportProjectContents;
	readonly target: ImportProjectContents;
	readonly takenPaths: Iterable<string>;
	/** The target's own record. */
	readonly provenance: ImportProvenanceDocument;
	/** The source's own record, whose entries from the target let the target take back what the source changed in its copies. */
	readonly sourceProvenance?: ImportProvenanceDocument;
}

/**
 * How a design part stands against its provenance: new without an entry or
 * once its copy is gone, unchanged while the source still projects as it did
 * at the copy, an update when the source moved and the copy did not, and a
 * conflict when both did. Two sides that project the same now are unchanged
 * whatever the entry remembers: they came to agree by hand, or by a copy the
 * record did not see, and there is nothing left to bring over. The source is
 * then read with the copy's ids (`sourceAsCopy`) where the caller has them,
 * since a projection names linked members by id.
 */
export function classifyImportStanding(
	entry: ImportProvenanceEntry | null,
	copyStands: boolean,
	hashes: {
		readonly source: () => string;
		readonly copy: () => string;
		readonly sourceAsCopy?: () => string;
	},
): 'new' | 'unchanged' | 'update' | 'conflict' {
	if (entry === null || !copyStands) return 'new';
	if (hashes.source() === entry.sourceHash) return 'unchanged';
	const copy = hashes.copy();
	if ((hashes.sourceAsCopy ?? hashes.source)() === copy) return 'unchanged';
	return copy === entry.copyHash ? 'update' : 'conflict';
}

/** The parts of one project, by the handles a record names them with. */
interface ImportPartIndex {
	readonly byKey: ReadonlyMap<string, ImportPart>;
	readonly byId: ReadonlyMap<string, ImportPart>;
	readonly byPath: ReadonlyMap<string, ImportPart>;
	readonly byName: ReadonlyMap<string, ImportPart>;
}

function indexImportParts(parts: readonly ImportPart[]): ImportPartIndex {
	const byKey = new Map<string, ImportPart>();
	const byId = new Map<string, ImportPart>();
	const byPath = new Map<string, ImportPart>();
	const byName = new Map<string, ImportPart>();
	for (const part of parts) {
		byKey.set(part.key, part);
		if (importKindHasOwnId(part.kind)) byId.set(part.sourceId, part);
		if (part.sourcePath !== null) byPath.set(importPathKey(part.sourcePath), part);
		switch (part.kind) {
			case 'character':
			case 'scene':
			case 'worldbuilding':
			case 'custom-field-template':
				byName.set(`${part.kind}:${part.group ?? ''}:${foldName(part.name)}`, part);
				break;
			case 'beat-sheet-template':
				byName.set(`${part.kind}::${foldName(part.name)}`, part);
				break;
			default:
				break;
		}
	}
	return { byKey, byId, byPath, byName };
}

/** The copy an entry made, found by its id, its path, or for a beat sheet template its name, which is all one has. */
function copyIn(index: ImportPartIndex, entry: ImportProvenanceEntry): ImportPart | null {
	const found = importKindHasOwnId(entry.kind)
		? entry.targetId === null
			? undefined
			: index.byId.get(entry.targetId)
		: entry.kind === 'beat-sheet-template'
			? index.byName.get(`${entry.kind}::${foldName(entry.targetName)}`)
			: entry.targetPath === null
				? undefined
				: index.byPath.get(importPathKey(entry.targetPath));
	return found !== undefined && found.kind === entry.kind ? found : null;
}

/** The part an entry was copied from, as the record names it: by its id, else by its key, else by its path. */
function originalIn(index: ImportPartIndex, entry: ImportProvenanceEntry): ImportPart | null {
	const found = importKindHasOwnId(entry.kind)
		? index.byId.get(entry.sourceId)
		: (index.byKey.get(importPartKey(entry.kind, entry.sourceId)) ??
			(entry.sourcePath === null ? undefined : index.byPath.get(importPathKey(entry.sourcePath))));
	return found !== undefined && found.kind === entry.kind ? found : null;
}

/** An entry read from its other end: the copy it made stands as the source part, and the part it was copied from as the copy. */
const reversedEntry = (entry: ImportProvenanceEntry): ImportProvenanceEntry => ({
	...entry,
	sourceHash: entry.copyHash,
	copyHash: entry.sourceHash,
});

/** The identity of the copy an entry describes, on the side that holds it, under the source it names. */
export function importCopyKey(entry: ImportProvenanceEntry): string {
	const copy =
		importKindHasOwnId(entry.kind) && entry.targetId !== null
			? `id:${entry.targetId}`
			: entry.kind === 'beat-sheet-template'
				? `name:${foldName(entry.targetName)}`
				: `path:${importPathKey(entry.targetPath ?? '')}`;
	return `${entry.sourceProjectId}\u0000${entry.kind}\u0000${copy}`;
}

const once = <T>(compute: () => T): (() => T) => {
	let held: { value: T } | null = null;
	return () => {
		if (held === null) held = { value: compute() };
		return held.value;
	};
};

export function inspectImport(input: ImportInspectionInput): ImportInspection {
	const { source, target } = input;
	const parts = catalogImportParts(source);
	const targetParts = catalogImportParts(target);
	const translation = importTranslation(source, target);
	const provenance = provenanceFrom(input.provenance, source.project.id);
	const resolveSource = importLinkResolver(source);
	const resolveTarget = importLinkResolver(target);
	const sourceIndex = indexImportParts(parts);
	const targetIndex = indexImportParts(targetParts);

	// The source's own record, read from this end: its entries that say one of
	// its parts was copied from this project, by that part's key. Through them
	// this project takes back what the source changed in its copies, so a book
	// that never imported can still update from the ones that imported from it.
	const reverse = new Map<string, ImportProvenanceEntry>();
	const sourceRecord = input.sourceProvenance?.entries ?? [];
	for (const entry of sourceRecord) {
		if (entry.sourceProjectId !== target.project.id) continue;
		const copy = copyIn(sourceIndex, entry);
		if (copy !== null) reverse.set(copy.key, entry);
	}
	// A source member paired with a note here by either record, so the source's
	// design can be projected with this project's ids and compared with the copy's.
	const pairIds = new Map<string, string>();
	for (const entry of provenance.values()) {
		if (isImportMemberKind(entry.kind) && entry.targetId !== null) pairIds.set(entry.sourceId, entry.targetId);
	}
	for (const entry of reverse.values()) {
		if (isImportMemberKind(entry.kind) && entry.targetId !== null) pairIds.set(entry.targetId, entry.sourceId);
	}
	const resolveSourceAsTarget: ImportLinkResolver = (link) => {
		const id = resolveSource(link);
		return id === null ? null : (pairIds.get(id) ?? id);
	};

	const namesakeOf = (part: ImportPart): ImportPart | null => {
		switch (part.record.kind) {
			case 'character':
			case 'scene':
			case 'worldbuilding':
			case 'custom-field-template':
				return targetIndex.byName.get(`${part.kind}:${part.group ?? ''}:${foldName(part.name)}`) ?? null;
			case 'beat-sheet-template':
				return targetIndex.byName.get(`${part.kind}::${foldName(part.name)}`) ?? null;
			case 'vocabulary': {
				const node = part.record.node;
				const translated = translateTaxonomy(translation, node.kind, node.id, node.taxonomyPath);
				const standing = translation.targetNodes.get(nodeKey(node.kind, node.id, translated));
				if (standing === undefined) return null;
				return targetIndex.byKey.get(importPartKey('vocabulary', `${standing.kind}/${standing.id}/${standing.taxonomyPath}`)) ?? null;
			}
			case 'step':
				return targetIndex.byKey.get(part.key) ?? null;
			default:
				return null;
		}
	};
	/** A namesake that already says what the source offers: a node with the same description, or none offered; a step with the same text. */
	const saysTheSame = (part: ImportPart, namesake: ImportPart): boolean => {
		if (part.record.kind === 'vocabulary' && namesake.record.kind === 'vocabulary') {
			const offered = part.record.node.description.trim();
			return offered.length === 0 || offered === namesake.record.node.description.trim();
		}
		if (part.record.kind === 'step' && namesake.record.kind === 'step') {
			return importHash(part.record, resolveSource) === importHash(namesake.record, resolveTarget);
		}
		return false;
	};
	const standingOf = (
		kind: 'existing' | 'unchanged' | 'update' | 'conflict',
		part: ImportPart,
	): ImportStanding => ({
		kind,
		targetId: importKindHasOwnId(part.kind) ? part.sourceId : null,
		targetPath: part.sourcePath,
		targetName: part.name,
	});

	const standing = new Map<string, ImportStanding>();
	const refresh: ImportProvenanceRefresh[] = [];
	for (const part of parts) {
		const own = provenance.get(part.key) ?? null;
		const theirs = own === null ? (reverse.get(part.key) ?? null) : null;
		// The note here the part is paired with: the copy an own entry made, or the original the source's entry was copied from.
		const copy = own !== null ? copyIn(targetIndex, own) : theirs !== null ? originalIn(targetIndex, theirs) : null;
		const recorded = own ?? (theirs === null ? null : reversedEntry(theirs));
		if (IMPORT_DESIGN_KINDS.has(part.kind)) {
			const sourceNow = once(() => importHash(part.record, resolveSource));
			const copyNow = once(() => (copy === null ? '' : importHash(copy.record, resolveTarget)));
			const classified = classifyImportStanding(recorded, copy !== null, {
				source: sourceNow,
				copy: copyNow,
				sourceAsCopy: () => importHash(part.record, resolveSourceAsTarget),
			});
			if (classified !== 'new' && copy !== null) {
				standing.set(part.key, standingOf(classified, copy));
				// Found to agree though the record remembers otherwise: the record is
				// brought up to date, on whichever side holds it.
				if (classified === 'unchanged' && recorded !== null && sourceNow() !== recorded.sourceHash) {
					if (own !== null) {
						refresh.push({ record: 'own', entry: { ...own, sourceHash: sourceNow(), copyHash: copyNow() } });
					} else if (theirs !== null) {
						refresh.push({ record: 'source', entry: { ...theirs, sourceHash: copyNow(), copyHash: sourceNow() } });
					}
				}
				continue;
			}
		} else if (copy !== null) {
			standing.set(part.key, standingOf('unchanged', copy));
			continue;
		}
		const namesake = namesakeOf(part);
		if (namesake === null) {
			standing.set(part.key, { kind: 'new' });
			continue;
		}
		standing.set(part.key, standingOf(saysTheSame(part, namesake) ? 'unchanged' : 'existing', namesake));
	}

	const partsByKey = new Set(parts.map((part) => part.key));
	const gone: ImportGonePart[] = [];
	const goneKeys = new Set<string>();
	const addGone = (found: ImportGonePart): void => {
		const key = `${found.kind}:${found.targetId ?? found.targetPath ?? found.name}`;
		if (goneKeys.has(key)) return;
		goneKeys.add(key);
		gone.push(found);
	};
	for (const [key, entry] of provenance) {
		if (partsByKey.has(key)) continue;
		const copy = copyIn(targetIndex, entry);
		if (copy === null) continue;
		addGone({ kind: entry.kind, name: copy.name, targetId: entry.targetId, targetPath: entry.targetPath });
	}
	// The source's copies of this project's parts that it no longer holds: this project keeps its notes.
	for (const entry of sourceRecord) {
		if (entry.sourceProjectId !== target.project.id || copyIn(sourceIndex, entry) !== null) continue;
		const original = originalIn(targetIndex, entry);
		if (original === null) continue;
		addGone({
			kind: entry.kind,
			name: original.name,
			targetId: importKindHasOwnId(original.kind) ? original.sourceId : null,
			targetPath: original.sourcePath,
		});
	}

	const takenPaths = new Set<string>();
	for (const path of input.takenPaths) takenPaths.add(foldPath(path));

	return {
		source,
		target,
		parts,
		targetParts,
		takenPaths,
		standing,
		gone,
		provenance,
		reverse,
		refresh,
		lastChoices: input.provenance.lastChoices[source.project.id] ?? null,
	};
}

// ---- Planning ------------------------------------------------------------------

export interface ImportSelection {
	readonly parts: ReadonlySet<string>;
	readonly clashPolicy: ImportClashPolicy;
}

export type ImportAction = 'create' | 'replace' | 'skip';
export type ImportSkipReason = 'name-taken' | 'file-name-taken' | 'unchanged' | 'no-chapter';

export interface ImportPlanEntry {
	readonly part: ImportPart;
	readonly action: ImportAction;
	readonly reason: ImportSkipReason | null;
	/** What the copy is or will be called: for a node, its taxonomy path in the target's words. */
	readonly targetName: string;
	/** Pre-minted for a note or record the plan can name; null where the writer mints it or the kind has none. */
	readonly targetId: string | null;
	/** Decided up front where the target's layout allows it; null where the writer decides (a picture, a kind not yet made). */
	readonly targetPath: string | null;
	/** The rank a created member takes, after the target's last of its kind. */
	readonly rank: number | null;
}

export interface ImportDroppedLink {
	readonly ownerKey: string;
	readonly link: ImportLink;
	/** `not-selected`: the linked part is not in the selection; `missing`: it is, but nothing of it will stand in the target. */
	readonly reason: 'not-selected' | 'missing';
}

export interface ImportKindToCreate {
	readonly id: string;
	readonly folderName: string;
	readonly icon: string | null;
	readonly description: string | null;
}

export interface ImportCount {
	readonly create: number;
	readonly replace: number;
	readonly skip: number;
}

export interface ImportPlan {
	readonly entries: readonly ImportPlanEntry[];
	/** Custom worldbuilding kinds the target lacks and the selection needs, in source order. */
	readonly kindsToCreate: readonly ImportKindToCreate[];
	readonly droppedLinks: readonly ImportDroppedLink[];
	/** Keys of linked parts outside the selection, for a dialog's "select them". */
	readonly unselectedLinks: readonly string[];
	readonly counts: Readonly<Record<ImportPartKind, ImportCount>>;
}

/**
 * Where everything of the source lands in the target. The planner fills it
 * for what it can name; the writer adds what it learns on the way (pictures
 * as they land, ids the tool stores mint). Paths are keyed by
 * `importPathKey` of the source path and hold the target's full vault path.
 */
export interface ImportMapping {
	readonly ids: Map<string, string>;
	readonly paths: Map<string, string>;
	/** Source id to the copy's name. */
	readonly names: Map<string, string>;
	readonly sourceRoot: string;
	readonly targetRoot: string;
}

export type ImportMintPrefix = 'character' | 'scene' | 'entity' | 'task' | 'foreshadowing' | 'revision';

export interface ImportPlanHooks {
	/** A fresh id for a note or record about to be made. */
	readonly mint: (prefix: ImportMintPrefix) => string;
	/** Where a manuscript note of that title would be written in the target. */
	readonly chapterPath: (title: string) => string;
}

const NEW_STANDING: ImportStanding = { kind: 'new' };

const mintPrefixOf = (kind: ImportPartKind): ImportMintPrefix | null => {
	switch (kind) {
		case 'character':
			return 'character';
		case 'scene':
			return 'scene';
		case 'worldbuilding':
			return 'entity';
		case 'task':
			return 'task';
		case 'foreshadowing':
			return 'foreshadowing';
		case 'revision':
			return 'revision';
		default:
			return null;
	}
};

function emptyCounts(): Record<ImportPartKind, ImportCount> {
	const counts = {} as Record<ImportPartKind, ImportCount>;
	for (const kind of IMPORT_PART_KINDS) counts[kind] = { create: 0, replace: 0, skip: 0 };
	return counts;
}

/**
 * Turns a selection into what the writer does, part by part, with every
 * target id, path and name decided before anything is written, so a link
 * from one new note to another is written right the first time.
 *
 * Members: a copy already here is left alone while the source is unchanged,
 * and otherwise skipped or replaced by the policy; a namesake with no
 * provenance likewise; a new one is created unless a file of that name
 * stands in the way. Nodes, templates and step texts follow the same rule.
 * Chapters, views, timelines and beat sheets take a free name instead of
 * clashing. Tool records import once and are remembered. Links to parts
 * that will not stand in the target are reported, never followed.
 */
export function planImport(
	inspection: ImportInspection,
	selection: ImportSelection,
	hooks: ImportPlanHooks,
): { plan: ImportPlan; mapping: ImportMapping } {
	const { source, target } = inspection;
	const translation = importTranslation(source, target);
	const policy = selection.clashPolicy;
	const partsByKey = new Map(inspection.parts.map((part) => [part.key, part] as const));
	const mapping: ImportMapping = {
		ids: new Map(),
		paths: new Map(),
		names: new Map(),
		sourceRoot: source.project.rootPath,
		targetRoot: target.project.rootPath,
	};
	const entries: ImportPlanEntry[] = [];
	const entryByKey = new Map<string, ImportPlanEntry>();
	const written = new Set<string>();
	const push = (entry: ImportPlanEntry): void => {
		entries.push(entry);
		entryByKey.set(entry.part.key, entry);
		if (entry.action !== 'skip') written.add(entry.part.key);
	};
	const skip = (part: ImportPart, reason: ImportSkipReason, standing?: ImportStanding): void => {
		const known = standing !== undefined && standing.kind !== 'new' ? standing : null;
		push({
			part,
			action: 'skip',
			reason,
			targetName: known?.targetName ?? part.name,
			targetId: known?.targetId ?? null,
			targetPath: known?.targetPath ?? null,
			rank: null,
		});
	};
	const create = (part: ImportPart, where: { targetName: string; targetId: string | null; targetPath: string | null; rank: number | null }): void => {
		push({ part, action: 'create', reason: null, ...where });
	};
	/** A part something of which already stands here: left, replaced or skipped by the policy. */
	const planStanding = (part: ImportPart, standing: ImportStanding): void => {
		if (standing.kind === 'new') return;
		if (standing.kind === 'unchanged') {
			skip(part, 'unchanged', standing);
		} else if (policy === 'replace') {
			push({
				part,
				action: 'replace',
				reason: null,
				targetName: standing.targetName,
				targetId: standing.targetId,
				targetPath: standing.targetPath,
				rank: null,
			});
		} else {
			skip(part, 'name-taken', standing);
		}
	};

	// What already stands for a source part answers its links, whatever this
	// run does with the part itself.
	for (const part of inspection.parts) {
		const standing = inspection.standing.get(part.key);
		if (standing === undefined || standing.kind === 'new') continue;
		if (importKindHasOwnId(part.kind) && standing.targetId !== null) {
			mapping.ids.set(part.sourceId, standing.targetId);
			mapping.names.set(part.sourceId, standing.targetName);
		}
		if (part.sourcePath !== null && standing.targetPath !== null) {
			mapping.paths.set(importPathKey(part.sourcePath), standing.targetPath);
		}
	}

	const takenPaths = new Set(inspection.takenPaths);
	const takenNames = new Map<string, Set<string>>();
	const namesIn = (kind: ImportPartKind, group: string | null): Set<string> => {
		const key = `${kind}:${group ?? ''}`;
		let names = takenNames.get(key);
		if (names === undefined) {
			names = new Set();
			takenNames.set(key, names);
		}
		return names;
	};
	const takenTitles: Record<'chapter' | 'freeform-view' | 'timeline' | 'beat-sheet', string[]> = {
		chapter: [],
		'freeform-view': [],
		timeline: [],
		'beat-sheet': [],
	};
	const lastRank = new Map<string, number>();
	for (const part of inspection.targetParts) {
		switch (part.record.kind) {
			case 'character':
			case 'scene':
			case 'worldbuilding': {
				namesIn(part.kind, part.group).add(foldName(part.name));
				const group = part.group ?? '';
				lastRank.set(group, Math.max(lastRank.get(group) ?? 0, part.record.member.rank));
				break;
			}
			case 'custom-field-template':
			case 'beat-sheet-template':
				namesIn(part.kind, part.group).add(foldName(part.name));
				break;
			case 'chapter':
			case 'freeform-view':
			case 'timeline':
			case 'beat-sheet':
				takenTitles[part.record.kind].push(part.name);
				break;
			default:
				break;
		}
	}
	const nextRank = (group: string): number => {
		const rank = (lastRank.get(group) ?? 0) + RANK_GAP;
		lastRank.set(group, rank);
		return rank;
	};
	const standingOf = (part: ImportPart): ImportStanding => inspection.standing.get(part.key) ?? NEW_STANDING;

	const explicit = new Set<string>();
	for (const key of selection.parts) if (partsByKey.has(key)) explicit.add(key);

	// Members first: what they require is brought only for the ones written.
	for (const part of inspection.parts) {
		if (!MEMBER_KINDS.has(part.kind) || !explicit.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			planStanding(part, standing);
			continue;
		}
		const names = namesIn(part.kind, part.group);
		if (names.has(foldName(part.name))) {
			skip(part, 'name-taken');
			continue;
		}
		const path = plannedMemberPath(target.project, part.group ?? '', part.name);
		if (path !== null && takenPaths.has(foldPath(path))) {
			skip(part, 'file-name-taken');
			continue;
		}
		const prefix = mintPrefixOf(part.kind);
		const id = prefix === null ? null : hooks.mint(prefix);
		create(part, { targetName: part.name, targetId: id, targetPath: path, rank: nextRank(part.group ?? '') });
		if (id !== null) {
			mapping.ids.set(part.sourceId, id);
			mapping.names.set(part.sourceId, part.name);
		}
		if (path !== null && part.sourcePath !== null) mapping.paths.set(importPathKey(part.sourcePath), path);
		names.add(foldName(part.name));
		if (path !== null) takenPaths.add(foldPath(path));
	}

	const seeds = new Set<string>();
	for (const key of explicit) {
		const part = partsByKey.get(key);
		if (part !== undefined && !MEMBER_KINDS.has(part.kind)) seeds.add(key);
	}
	for (const key of written) seeds.add(key);
	const effective = closeSelection(inspection.parts, seeds);

	for (const part of inspection.parts) {
		if (part.record.kind !== 'vocabulary' || !effective.has(part.key)) continue;
		const node = part.record.node;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			planStanding(part, standing);
			continue;
		}
		const translated = translateTaxonomy(translation, node.kind, node.id, node.taxonomyPath);
		const root = target.project.definitionRoots[node.kind]?.[node.id];
		const path = root === undefined ? null : `${importNodePath(root, translated)}.md`;
		create(part, { targetName: translated, targetId: null, targetPath: path, rank: null });
		if (path !== null) mapping.paths.set(importPathKey(node.selfPath), path);
	}

	for (const part of inspection.parts) {
		if (part.record.kind !== 'custom-field-template' || !effective.has(part.key)) continue;
		const template = part.record.template;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			planStanding(part, standing);
			continue;
		}
		const names = namesIn(part.kind, part.group);
		if (names.has(foldName(template.name))) {
			skip(part, 'name-taken');
			continue;
		}
		const root = target.project.customFieldRoots[template.kind];
		let path: string | null = null;
		if (root !== undefined) {
			try {
				path = `${root}/${safeFileName(template.name)}.md`;
			} catch {
				skip(part, 'file-name-taken');
				continue;
			}
			if (takenPaths.has(foldPath(path))) {
				skip(part, 'file-name-taken');
				continue;
			}
		}
		create(part, { targetName: template.name, targetId: null, targetPath: path, rank: null });
		names.add(foldName(template.name));
		if (path !== null) {
			takenPaths.add(foldPath(path));
			mapping.paths.set(importPathKey(template.path), path);
		}
	}

	for (const part of inspection.parts) {
		if (part.record.kind !== 'picture' || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			skip(part, 'unchanged', standing);
			continue;
		}
		create(part, { targetName: part.name, targetId: null, targetPath: null, rank: null });
	}

	const targetSteps = new Map<string, ImportStep>();
	for (const step of target.steps) targetSteps.set(String(step.step), step);
	for (const part of inspection.parts) {
		if (part.record.kind !== 'step' || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			planStanding(part, standing);
			continue;
		}
		create(part, { targetName: part.name, targetId: null, targetPath: targetSteps.get(part.sourceId)?.path ?? null, rank: null });
	}

	for (const part of inspection.parts) {
		if (part.record.kind !== 'chapter' || !effective.has(part.key)) continue;
		const chapter = part.record.chapter;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			skip(part, 'unchanged', standing);
			continue;
		}
		const title = freeName(chapter.title, takenTitles.chapter);
		let path: string;
		try {
			path = hooks.chapterPath(title);
		} catch {
			skip(part, 'file-name-taken');
			continue;
		}
		if (takenPaths.has(foldPath(path))) {
			skip(part, 'file-name-taken');
			continue;
		}
		create(part, { targetName: title, targetId: null, targetPath: path, rank: null });
		mapping.paths.set(importPathKey(chapter.path), path);
		takenTitles.chapter.push(title);
		takenPaths.add(foldPath(path));
	}

	for (const part of inspection.parts) {
		if ((part.kind !== 'task' && part.kind !== 'foreshadowing') || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			skip(part, 'unchanged', standing);
			continue;
		}
		const prefix = mintPrefixOf(part.kind);
		const id = prefix === null ? null : hooks.mint(prefix);
		create(part, { targetName: part.name, targetId: id, targetPath: null, rank: null });
		if (id !== null) {
			mapping.ids.set(part.sourceId, id);
			mapping.names.set(part.sourceId, part.name);
		}
	}

	for (const part of inspection.parts) {
		if (part.record.kind !== 'revision' || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			skip(part, 'unchanged', standing);
			continue;
		}
		if (!mapping.paths.has(importPathKey(part.record.revision.path))) {
			skip(part, 'no-chapter');
			continue;
		}
		const id = hooks.mint('revision');
		create(part, { targetName: part.name, targetId: id, targetPath: null, rank: null });
		mapping.ids.set(part.sourceId, id);
		mapping.names.set(part.sourceId, part.name);
	}

	for (const part of inspection.parts) {
		if (part.kind !== 'sticky-note' || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			skip(part, 'unchanged', standing);
			continue;
		}
		create(part, { targetName: part.name, targetId: null, targetPath: null, rank: null });
	}

	for (const part of inspection.parts) {
		const kind = part.record.kind;
		if ((kind !== 'freeform-view' && kind !== 'timeline' && kind !== 'beat-sheet') || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			skip(part, 'unchanged', standing);
			continue;
		}
		const name = freeName(part.name, takenTitles[kind]);
		create(part, { targetName: name, targetId: null, targetPath: null, rank: null });
		mapping.names.set(part.sourceId, name);
		takenTitles[kind].push(name);
	}

	for (const part of inspection.parts) {
		if (part.record.kind !== 'beat-sheet-template' || !effective.has(part.key)) continue;
		const standing = standingOf(part);
		if (standing.kind !== 'new') {
			planStanding(part, standing);
			continue;
		}
		const names = namesIn(part.kind, part.group);
		if (names.has(foldName(part.name))) {
			skip(part, 'name-taken');
			continue;
		}
		create(part, { targetName: part.name, targetId: null, targetPath: null, rank: null });
		names.add(foldName(part.name));
	}

	const targetKinds = new Set(target.project.kinds.map((kind) => kind.id));
	const kindsToCreate: ImportKindToCreate[] = [];
	for (const entry of entries) {
		if (entry.action === 'skip') continue;
		const group = entry.part.group;
		if (group === null || group === 'character' || group === 'scene' || targetKinds.has(group)) continue;
		if (kindsToCreate.some((kind) => kind.id === group)) continue;
		const kind = source.project.kinds.find((candidate) => candidate.id === group);
		if (kind === undefined) continue;
		kindsToCreate.push({ id: kind.id, folderName: kind.folderName, icon: kind.icon, description: kind.description });
	}

	const lands = (key: string): boolean => {
		const linked = partsByKey.get(key);
		if (linked === undefined) return false;
		const planned = entryByKey.get(key);
		if (planned !== undefined && planned.action !== 'skip') return true;
		if (importKindHasOwnId(linked.kind)) return mapping.ids.has(linked.sourceId);
		return linked.sourcePath !== null && mapping.paths.has(importPathKey(linked.sourcePath));
	};
	const droppedLinks: ImportDroppedLink[] = [];
	for (const entry of entries) {
		if (entry.action === 'skip') continue;
		for (const link of entry.part.links) {
			if (lands(link.key)) continue;
			droppedLinks.push({ ownerKey: entry.part.key, link, reason: effective.has(link.key) ? 'missing' : 'not-selected' });
		}
	}

	// The links the dialog offers to follow: from a part this run writes to
	// one neither ticked nor already standing here. A skipped part writes
	// nothing, so its links ask for nothing; a note already here answers.
	const chosen = closeSelection(inspection.parts, explicit);
	const wantedLinks = new Set<string>();
	for (const key of written) {
		const part = partsByKey.get(key);
		if (part === undefined) continue;
		for (const link of part.links) {
			if (!chosen.has(link.key) && partsByKey.has(link.key) && !lands(link.key)) wantedLinks.add(link.key);
		}
	}
	const unselectedLinks = inspection.parts.filter((part) => wantedLinks.has(part.key)).map((part) => part.key);

	const counts = emptyCounts();
	for (const entry of entries) {
		const count = counts[entry.part.kind];
		counts[entry.part.kind] = {
			create: count.create + (entry.action === 'create' ? 1 : 0),
			replace: count.replace + (entry.action === 'replace' ? 1 : 0),
			skip: count.skip + (entry.action === 'skip' ? 1 : 0),
		};
	}

	return {
		plan: {
			entries,
			kindsToCreate,
			droppedLinks,
			unselectedLinks,
			counts,
		},
		mapping,
	};
}

// ---- Rewriting a part into the target's paths and words --------------------

export interface ImportRewriteContext extends ImportTranslation {
	readonly mapping: ImportMapping;
}

/** The context the writer rewrites with: the target as it stands when the part is written, which may hold kinds the plan had still to make. */
export function importRewriteContext(
	source: ImportProjectContents,
	target: ImportProjectContents,
	mapping: ImportMapping,
): ImportRewriteContext {
	return { ...importTranslation(source, target), mapping };
}

/** A link the rewrite could not carry over: which field held it and what it pointed at. */
export interface ImportDrop {
	readonly field: string;
	readonly target: string;
}

export interface ImportRewrite<T> {
	readonly value: T;
	readonly dropped: readonly ImportDrop[];
}

type Drop = (field: string, target: string) => void;

const mappedPath = (context: ImportRewriteContext, path: string): string | undefined =>
	context.mapping.paths.get(importPathKey(path));

/** The same link pointed at another note, its heading and alias kept. */
function rebuildLink(link: ParsedWikiLink, path: string): string {
	const target = link.subpath.length > 0 ? `${importPathKey(path)}#${link.subpath}` : importPathKey(path);
	return wikiLinkText(target, link.alias ?? undefined);
}

function mapTerm(term: RecordTerm, context: ImportRewriteContext, drop: Drop): RecordTerm {
	if (term.kind !== 'link') return term;
	const mapped = mappedPath(context, term.path);
	if (mapped !== undefined) return { kind: 'link', path: importPathKey(mapped), name: term.name };
	if (!isUnder(term.path, context.mapping.sourceRoot)) return term;
	drop('record', term.path);
	return { kind: 'text', text: term.name };
}

/**
 * Record lines said in the target's terms: each label points at the node of
 * the same taxonomy under the target's own root, and each link term at the
 * copy of the note it named, or becomes the plain name where no copy stands.
 */
export function rewriteRecordLines(
	lines: readonly RecordLine[],
	vocabulary: 'world-status' | 'relationship',
	ownerKind: string,
	context: ImportRewriteContext,
	drop: Drop,
): RecordLine[] {
	return lines.map((line) => {
		const located = locateNode(context.source, line.label.path);
		const kind = located?.kind ?? ownerKind;
		const id = located?.id ?? vocabulary;
		const taxonomy = located?.taxonomy ?? line.label.display;
		const translated = translateTaxonomy(context, kind, id, taxonomy);
		const root = context.target.definitionRoots[kind]?.[id];
		const label = root === undefined ? line.label : { path: importNodePath(root, translated), display: translated };
		return {
			label,
			value: line.value,
			clauses: line.clauses.map((clause) =>
				clause.kind === 'span'
					? { kind: 'span' as const, start: mapTerm(clause.start, context, drop), end: mapTerm(clause.end, context, drop) }
					: { kind: clause.kind, term: mapTerm(clause.term, context, drop) },
			),
		};
	});
}

/** The category paths a member's stored links name, in the target's words, a character's role left out. */
export function rewriteCategoryPaths(member: ImportMemberBase, kind: string, context: ImportRewriteContext): string[] {
	const paths: string[] = [];
	for (const raw of member.categories) {
		const link = parseWikiLink(raw);
		if (link === null) continue;
		const located = locateNode(context.source, link.target);
		const id = located?.id ?? 'category';
		const taxonomy =
			located?.taxonomy ?? (link.alias !== null && link.alias.length > 0 ? link.alias : fileStem(link.target));
		if (
			kind === 'character' &&
			id === 'category' &&
			!taxonomy.includes('/') &&
			roleTypeOf(taxonomy, [context.source.roles, context.target.roles]) !== null
		) {
			continue;
		}
		const translated = translateTaxonomy(context, located?.kind ?? kind, id, taxonomy);
		if (!paths.includes(translated)) paths.push(translated);
	}
	return paths;
}

function rewriteGallery(
	member: ImportMemberBase,
	context: ImportRewriteContext,
	drop: Drop,
): { gallery: string[]; galleryMain: string | null } {
	const gallery: string[] = [];
	for (const raw of member.gallery) {
		const link = parseWikiLink(raw);
		if (link === null) {
			gallery.push(raw);
			continue;
		}
		const mapped = mappedPath(context, link.target);
		if (mapped === undefined) {
			drop('gallery', link.target);
			continue;
		}
		const text = rebuildLink(link, mapped);
		if (!gallery.includes(text)) gallery.push(text);
	}
	let galleryMain: string | null = null;
	if (member.galleryMain !== null) {
		const target = galleryLinkTarget(member.galleryMain);
		const mapped = target === null ? undefined : mappedPath(context, target);
		if (mapped !== undefined) {
			galleryMain = gallery.find((entry) => galleryLinkTarget(entry) === importPathKey(mapped)) ?? null;
		}
	}
	return { gallery, galleryMain };
}

/**
 * Full-path links into the source project, rewritten to the copies they
 * name, heading and alias kept. A bare `[[Alice]]` is left as it is: it
 * resolves wherever a note of that name stands, which is the target's own
 * once the copy is written.
 */
export function rewriteProseLinks(text: string, mapping: ImportMapping): string {
	if (!text.includes('[[')) return text;
	return text.replace(PROSE_LINK, (whole: string, rawTarget: string, subpath: string, alias: string) => {
		const target = rawTarget.trim();
		if (!isUnder(target, mapping.sourceRoot)) return whole;
		const mapped = mapping.paths.get(importPathKey(target));
		if (mapped === undefined) return whole;
		return `[[${importPathKey(mapped)}${subpath}${alias}]]`;
	});
}

/** A stored link or plain words, pointed at the copy or reduced to the words where no copy stands. */
function rewriteStoredTerm(raw: string, field: string, context: ImportRewriteContext, drop: Drop): string {
	const link = parseWikiLink(raw);
	if (link === null) return raw;
	const mapped = mappedPath(context, link.target);
	if (mapped !== undefined) return rebuildLink(link, mapped);
	if (!isUnder(link.target, context.mapping.sourceRoot)) return raw;
	drop(field, link.target);
	return link.alias !== null && link.alias.length > 0 ? link.alias : fileStem(link.target);
}

function collector(): { dropped: ImportDrop[]; drop: Drop } {
	const dropped: ImportDrop[] = [];
	return { dropped, drop: (field, target) => dropped.push({ field, target }) };
}

interface ImportMemberInputBase {
	aliases: string[];
	categoryPaths: string[];
	progressStatus: ProgressStatus | null;
	worldStatus: RecordLine[];
	relationships: RecordLine[];
	worldStatusUnrecognized: string[];
	relationshipsUnrecognized: string[];
	customFields: string;
	gallery: string[];
	galleryMain: string | null;
	color: MacaronColor | null;
}

function memberInputOf(member: ImportMemberBase, kind: string, context: ImportRewriteContext, drop: Drop): ImportMemberInputBase {
	const { gallery, galleryMain } = rewriteGallery(member, context, drop);
	return {
		aliases: [...member.aliases],
		categoryPaths: rewriteCategoryPaths(member, kind, context),
		progressStatus: member.progressStatus,
		worldStatus: rewriteRecordLines(member.worldStatus, 'world-status', kind, context, drop),
		relationships: rewriteRecordLines(member.relationships, 'relationship', kind, context, drop),
		worldStatusUnrecognized: [...member.worldStatusUnrecognized],
		relationshipsUnrecognized: [...member.relationshipsUnrecognized],
		customFields: rewriteProseLinks(member.customFields, context.mapping),
		gallery,
		galleryMain,
		color: member.color,
	};
}

/** What the service's `createCharacterIn` takes, as this module builds it. */
export interface ImportCharacterInput extends ImportMemberInputBase {
	name: string;
	type?: CharacterType;
	oneSentenceStoryline: string;
	motivation: string;
	goal: string;
	conflict: string;
	growth: string;
	oneParagraphStoryline: string;
	characterSynopsis: string;
	characterProfile: string;
}

export interface ImportSceneInput extends ImportMemberInputBase {
	title: string;
	povPath: string | null;
	times: string[];
	locations: string[];
	characters: string[];
	conflict: string;
	linkedManuscript: string[];
	events: string;
	planning: string;
}

export interface ImportEntityInput extends ImportMemberInputBase {
	kind: WorldbuildingKindId;
	name: string;
	description: string;
	timeKind: TimeKind | null;
	timeStart: string;
	timeEnd: string;
	notes: string;
}

export function characterInputOf(member: ImportCharacter, context: ImportRewriteContext): ImportRewrite<ImportCharacterInput> {
	const { dropped, drop } = collector();
	const prose = (text: string): string => rewriteProseLinks(text, context.mapping);
	return {
		value: {
			name: member.name,
			...(member.type === null ? {} : { type: member.type }),
			...memberInputOf(member, 'character', context, drop),
			oneSentenceStoryline: prose(member.oneSentenceStoryline),
			motivation: prose(member.motivation),
			goal: prose(member.goal),
			conflict: prose(member.conflict),
			growth: prose(member.growth),
			oneParagraphStoryline: prose(member.oneParagraphStoryline),
			characterSynopsis: prose(member.characterSynopsis),
			characterProfile: prose(member.characterProfile),
		},
		dropped,
	};
}

export function sceneInputOf(member: ImportScene, context: ImportRewriteContext): ImportRewrite<ImportSceneInput> {
	const { dropped, drop } = collector();
	const prose = (text: string): string => rewriteProseLinks(text, context.mapping);
	let povPath: string | null;
	if (member.povPath === null || isScenePovMode(member.povPath)) {
		povPath = member.povPath;
	} else {
		const mapped = mappedPath(context, member.povPath);
		if (mapped === undefined) {
			drop('pov', member.povPath);
			povPath = SCENE_POV_OMNISCIENT;
		} else {
			povPath = mapped;
		}
	}
	const characters: string[] = [];
	for (const path of member.characters) {
		const mapped = mappedPath(context, path);
		if (mapped === undefined) drop('cast', path);
		else if (!characters.includes(mapped)) characters.push(mapped);
	}
	const linkedManuscript: string[] = [];
	for (const raw of member.linkedManuscript) {
		const link = parseWikiLink(raw);
		if (link === null) {
			linkedManuscript.push(raw);
			continue;
		}
		const mapped = mappedPath(context, link.target);
		if (mapped === undefined) {
			drop('linked-manuscript', link.target);
			continue;
		}
		linkedManuscript.push(rebuildLink(link, mapped));
	}
	return {
		value: {
			title: member.name,
			povPath,
			...memberInputOf(member, 'scene', context, drop),
			times: member.times.map((raw) => rewriteStoredTerm(raw, 'time', context, drop)),
			locations: member.locations.map((raw) => rewriteStoredTerm(raw, 'location', context, drop)),
			characters,
			conflict: prose(member.conflict),
			linkedManuscript,
			events: prose(member.events),
			planning: prose(member.planning),
		},
		dropped,
	};
}

export function entityInputOf(member: ImportEntity, context: ImportRewriteContext): ImportRewrite<ImportEntityInput> {
	const { dropped, drop } = collector();
	const prose = (text: string): string => rewriteProseLinks(text, context.mapping);
	const span = (raw: string): string => (raw.trim().length === 0 ? raw : rewriteStoredTerm(raw, 'time-span', context, drop));
	return {
		value: {
			kind: member.kind,
			name: member.name,
			...memberInputOf(member, member.kind, context, drop),
			description: prose(member.description),
			timeKind: member.timeKind,
			timeStart: span(member.timeStart),
			timeEnd: span(member.timeEnd),
			notes: prose(member.notes),
		},
		dropped,
	};
}

// ---- Tool records ---------------------------------------------------------------

/** The same reference pointed at the copy, or null where no copy stands. */
export function remapEntityRef(ref: EntityRef, mapping: ImportMapping): EntityRef | null {
	const id = mapping.ids.get(ref.id);
	if (id === undefined) return null;
	return { kind: ref.kind, id, name: mapping.names.get(ref.id) ?? ref.name };
}

function remapRefs(refs: readonly EntityRef[], mapping: ImportMapping, drop: Drop): EntityRef[] {
	const kept: EntityRef[] = [];
	for (const ref of refs) {
		const next = remapEntityRef(ref, mapping);
		if (next === null) drop('related', ref.id);
		else kept.push(next);
	}
	return kept;
}

export function remapTask(task: Task, id: string, mapping: ImportMapping): ImportRewrite<Task> {
	const { dropped, drop } = collector();
	return { value: { ...task, id, related: remapRefs(task.related, mapping, drop) }, dropped };
}

/** The thread with its references remapped and its occurrences moved to the chapters' copies; an occurrence whose chapter has no copy is dropped. */
export function remapForeshadowing(thread: Foreshadowing, id: string, mapping: ImportMapping): ImportRewrite<Foreshadowing> {
	const { dropped, drop } = collector();
	const occurrences: ForeshadowingOccurrence[] = [];
	for (const occurrence of thread.occurrences) {
		const mapped = mapping.paths.get(importPathKey(occurrence.path));
		if (mapped === undefined) {
			drop('chapter', occurrence.path);
			continue;
		}
		occurrences.push({ ...occurrence, path: mapped });
	}
	return { value: { ...thread, id, related: remapRefs(thread.related, mapping, drop), occurrences }, dropped };
}

/** The revision on its chapter's copy, or null where the chapter has none. */
export function remapRevision(revision: Revision, id: string, mapping: ImportMapping): Revision | null {
	const mapped = mapping.paths.get(importPathKey(revision.path));
	return mapped === undefined ? null : { ...revision, id, path: mapped };
}

function remapRows(rows: readonly SceneRow[], mapping: ImportMapping, drop: Drop, seen: Set<string>): SceneRow[] {
	return rows.map((row) => {
		const scenes: string[] = [];
		for (const sceneId of row.scenes) {
			const mapped = mapping.ids.get(sceneId);
			if (mapped === undefined) {
				drop('scene', sceneId);
				continue;
			}
			if (seen.has(mapped)) continue;
			seen.add(mapped);
			scenes.push(mapped);
		}
		return { ...row, scenes };
	});
}

/** The timeline over the copies: a time without a copy goes with its rows, a scene without one leaves its row, a binding without one is cleared. */
export function remapTimeline(timeline: Timeline, name: string, mapping: ImportMapping): ImportRewrite<Omit<Timeline, 'id'>> {
	const { dropped, drop } = collector();
	const seen = new Set<string>();
	const times: TimelineTime[] = [];
	for (const time of timeline.times) {
		const timeId = mapping.ids.get(time.timeId);
		if (timeId === undefined) {
			drop('time', time.timeId);
			continue;
		}
		times.push({ timeId, rows: remapRows(time.rows, mapping, drop, seen) });
	}
	let binding: EntityRef | null = null;
	if (timeline.binding !== null) {
		binding = remapEntityRef(timeline.binding, mapping);
		if (binding === null) drop('binding', timeline.binding.id);
	}
	return {
		value: { name, binding, times, createdAt: timeline.createdAt, updatedAt: timeline.updatedAt },
		dropped,
	};
}

export function remapBeatSheet(sheet: BeatSheet, name: string, mapping: ImportMapping): ImportRewrite<Omit<BeatSheet, 'id'>> {
	const { dropped, drop } = collector();
	const seen = new Set<string>();
	return {
		value: {
			name,
			acts: sheet.acts.map((act) => ({
				...act,
				beats: act.beats.map((beat) => ({ ...beat, rows: remapRows(beat.rows, mapping, drop, seen) })),
			})),
			presentation: sheet.presentation,
			showSubDescriptions: sheet.showSubDescriptions,
			reversed: sheet.reversed,
			createdAt: sheet.createdAt,
			updatedAt: sheet.updatedAt,
		},
		dropped,
	};
}

/**
 * The view over the copies. An entity placement without a copy keeps its
 * stored name and reads as missing, as the reader already draws one; a
 * record placement without one goes, and its edges with it; a file
 * placement is pointed at the copy where there is one. The viewport starts
 * afresh.
 */
export function remapFreeformView(view: FreeformView, name: string, mapping: ImportMapping): ImportRewrite<Omit<FreeformView, 'id'>> {
	const { dropped, drop } = collector();
	const gone = new Set<string>();
	const placements: FreeformPlacement[] = [];
	for (const placement of view.placements) {
		const resource = placement.resource;
		switch (resource.type) {
			case 'entity': {
				const id = mapping.ids.get(resource.id);
				if (id === undefined) {
					drop('placement', resource.id);
					placements.push(placement);
				} else {
					placements.push({ ...placement, resource: { ...resource, id, name: mapping.names.get(resource.id) ?? resource.name } });
				}
				break;
			}
			case 'file': {
				const mapped = mapping.paths.get(importPathKey(`${mapping.sourceRoot}/${resource.path}`));
				if (mapped === undefined) {
					drop('file', resource.path);
					placements.push(placement);
				} else {
					const prefix = `${mapping.targetRoot}/`;
					placements.push({
						...placement,
						resource: { type: 'file', path: mapped.startsWith(prefix) ? mapped.slice(prefix.length) : mapped },
					});
				}
				break;
			}
			case 'link':
			case 'text':
				placements.push(placement);
				break;
			default: {
				const id = mapping.ids.get(resource.id);
				if (id === undefined) {
					drop('record', resource.id);
					gone.add(placement.id);
				} else {
					placements.push({ ...placement, resource: { ...resource, id } });
				}
			}
		}
	}
	return {
		value: {
			name,
			placements,
			frames: [...view.frames],
			edges: view.edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
			viewport: DEFAULT_FREEFORM_VIEWPORT,
			createdAt: view.createdAt,
			updatedAt: view.updatedAt,
			strays: { placements: [], frames: [], edges: [] },
		},
		dropped,
	};
}
