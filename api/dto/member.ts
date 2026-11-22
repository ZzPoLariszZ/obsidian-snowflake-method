import {
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	WORLDBUILDING_KIND_DEFINITIONS,
	fileStem,
	foldName,
	isWorldbuildingKind,
	kindIdFromFolderName,
	parseWikiLink,
	type EntityRef,
} from '../../src/domain';
import {
	definitionRootPath,
	entitiesOf,
	entityKindFolder,
	taxonomyPathFromValue,
	type CharacterRecord,
	type ProjectSnapshot,
	type SceneRecord,
	type WorldbuildingRecord,
} from '../../src/services';
import {
	parseCustomFields,
	parseTerm,
	type ManagedSectionsInspection,
	type RecordClause,
	type RecordLine,
	type RecordTerm,
} from '../../src/templates';
import type { JsonObject, JsonValue } from '../json';

/**
 * The characters, scenes and worldbuilding notes of a project as the API
 * tells them.
 *
 * What a note points at is told as the thing pointed at. A note stores a
 * link, and a link is a path that stops being one the day anything is
 * renamed: Obsidian rewrites it, and may shorten it to a bare name. So no
 * stored link is handed out as an address. Each is looked up where it leads
 * now, and told as the member it leads to, by its id.
 *
 * What a note says about the world, and about others, is kept in the note
 * as sentences in the project's language. They are told here by their
 * parts, which read the same in every language.
 */

/** One member of a project, as far as another note needs to know it. */
export interface MemberEntry {
	readonly kind: string;
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly aliases: readonly string[];
}

/** Where a link stored in one note leads now, as a path in the vault, or null where it leads nowhere. */
export type LinkResolver = (link: string, sourcePath: string) => string | null;

/** The kinds a project keeps notes of, in the author's order: characters, scenes, then each kind of worldbuilding. */
export function kindIdsOf(project: ProjectSnapshot): string[] {
	return ['character', 'scene', ...project.worldbuildingKinds.map((kind) => kind.id)];
}

/**
 * Every member of one project, to be found by where its note stands or by
 * its id. Made once for an answer and thrown away with it.
 */
export class MemberIndex {
	readonly entries: MemberEntry[] = [];
	private readonly byPath = new Map<string, MemberEntry>();
	private readonly byId = new Map<string, MemberEntry>();

	constructor(
		readonly project: ProjectSnapshot,
		private readonly resolve: LinkResolver,
	) {
		const add = (entry: MemberEntry): void => {
			this.entries.push(entry);
			this.byPath.set(entry.path, entry);
			// A note copied by hand carries the id of the one it was copied from. The first is the one answered for.
			if (!this.byId.has(entry.id)) this.byId.set(entry.id, entry);
		};
		for (const character of project.characters) {
			add({ kind: 'character', id: character.characterId, name: character.name, path: character.path, aliases: character.aliases });
		}
		for (const scene of project.scenes) {
			add({ kind: 'scene', id: scene.sceneId, name: scene.title, path: scene.path, aliases: scene.aliases });
		}
		for (const kind of project.worldbuildingKinds) {
			for (const entity of entitiesOf(project, kind.id)) {
				add({ kind: entity.kind, id: entity.entityId, name: entity.name, path: entity.path, aliases: entity.aliases });
			}
		}
	}

	private refOf(member: MemberEntry): JsonObject {
		return { kind: member.kind, id: member.id, name: member.name, path: member.path, resolved: true };
	}

	/** A note the services already found, by where it stands. */
	refAt(path: string): JsonObject {
		const member = this.byPath.get(path);
		if (member !== undefined) return this.refOf(member);
		// The note is gone. Its name is all that is left to tell.
		return { kind: null, id: null, name: fileStem(path), path: null, resolved: false };
	}

	/**
	 * A note another record names by its id, as a task and a foreshadowing
	 * thread do. An id outlives a rename, and a move from one kind to
	 * another, so what the member says of itself now is what is told. Once
	 * the note is gone, what the record last knew of it is all there is.
	 */
	refOfStored(stored: EntityRef): JsonObject {
		const member = this.byId.get(stored.id);
		if (member !== undefined) return this.refOf(member);
		return { kind: stored.kind, id: stored.id, name: stored.name, path: null, resolved: false };
	}

	/** What a clause or a field names: a member, a link that leads to none, or plain words. */
	termOf(term: RecordTerm, sourcePath: string): JsonObject {
		if (term.kind === 'text') return { text: term.text };
		const path = this.resolve(term.path, sourcePath);
		const member = path === null ? undefined : this.byPath.get(path);
		if (member !== undefined) return this.refOf(member);
		return { kind: null, id: null, name: term.name, path, resolved: false };
	}

	/** The same for a value a note stores as a link or as plain words. Null for nothing at all. */
	storedTermOf(stored: string, sourcePath: string): JsonObject | null {
		return stored.trim().length === 0 ? null : this.termOf(parseTerm(stored), sourcePath);
	}

	/** Where a link leads now. */
	pathOf(link: string, sourcePath: string): string | null {
		return this.resolve(link, sourcePath);
	}
}

/** Whether a note's section markers are damaged in a way that keeps it from being written. */
const isDamaged = (health: ManagedSectionsInspection): boolean =>
	health.issues.some((issue) => issue.code !== 'unknown-section' && issue.code !== 'unrecognized-record');

function clauseOf(index: MemberIndex, clause: RecordClause, sourcePath: string): JsonObject {
	if (clause.kind === 'span') {
		return { kind: 'span', start: index.termOf(clause.start, sourcePath), end: index.termOf(clause.end, sourcePath) };
	}
	return { kind: clause.kind, term: index.termOf(clause.term, sourcePath) };
}

function recordLineOf(index: MemberIndex, line: RecordLine, sourcePath: string): JsonObject {
	return {
		label: line.label.display,
		labelPath: index.pathOf(line.label.path, sourcePath),
		text: line.value,
		clauses: line.clauses.map((clause) => clauseOf(index, clause, sourcePath)),
	};
}

type AnyMember = CharacterRecord | SceneRecord | WorldbuildingRecord;

/** The words of the category vocabulary a note is sorted under, each by its path in the kind's tree. */
function categoriesOf(project: ProjectSnapshot, kind: string, member: AnyMember): string[] {
	const root = definitionRootPath(project, kind, 'category');
	return member.categories.map((stored) => taxonomyPathFromValue(stored, root) ?? stored);
}

/** What every member tells in short and in full alike. */
function standingOf(member: AnyMember, id: string, index: number): JsonObject {
	return {
		id,
		path: member.path,
		etag: member.revision,
		index,
		readOnly: member.readOnly,
		damaged: isDamaged(member.sectionHealth),
		needsMigration: member.unmigrated,
		progressStatus: member.progressStatus,
		aliases: [...member.aliases],
		color: member.color,
	};
}

/** What every member tells only in full. */
function recordsOf(index: MemberIndex, member: AnyMember): JsonObject {
	return {
		worldStatus: member.worldStatus.map((line) => recordLineOf(index, line, member.path)),
		relationships: member.relationships.map((line) => recordLineOf(index, line, member.path)),
		unrecognizedWorldStatus: [...member.worldStatusUnrecognized],
		unrecognizedRelationships: [...member.relationshipsUnrecognized],
		customFields: parseCustomFields(member.customFields).fields.map((field) => ({ title: field.title, content: field.content })),
		gallery: [...member.gallery],
		galleryMain: member.galleryMain,
	};
}

export function characterOf(index: MemberIndex, character: CharacterRecord, place: number, full: boolean): JsonObject {
	const told: JsonObject = {
		kind: 'character',
		name: character.name,
		...standingOf(character, character.characterId, place),
		role: character.type,
		categories: categoriesOf(index.project, 'character', character),
		oneSentenceStoryline: character.oneSentenceStoryline,
	};
	if (!full) return told;
	return {
		...told,
		motivation: character.motivation,
		goal: character.goal,
		conflict: character.conflict,
		growth: character.growth,
		oneParagraphStoryline: character.oneParagraphStoryline,
		characterSynopsis: character.characterSynopsis,
		characterProfile: character.characterProfile,
		...recordsOf(index, character),
	};
}

function povOf(index: MemberIndex, scene: SceneRecord): JsonValue {
	if (scene.povPath === null) return null;
	if (scene.povPath === SCENE_POV_OMNISCIENT) return { mode: 'omniscient' };
	if (scene.povPath === SCENE_POV_MULTIPLE) return { mode: 'multiple' };
	return { mode: 'character', character: index.refAt(scene.povPath) };
}

export function sceneOf(index: MemberIndex, scene: SceneRecord, place: number, full: boolean): JsonObject {
	const told: JsonObject = {
		kind: 'scene',
		title: scene.title,
		...standingOf(scene, scene.sceneId, place),
		categories: categoriesOf(index.project, 'scene', scene),
		pov: povOf(index, scene),
		conflict: scene.conflict,
	};
	if (!full) return told;
	return {
		...told,
		characters: scene.characters.map((path) => index.refAt(path)),
		times: scene.times.flatMap((stored) => index.storedTermOf(stored, scene.path) ?? []),
		locations: scene.locations.flatMap((stored) => index.storedTermOf(stored, scene.path) ?? []),
		events: scene.events,
		planning: scene.planning,
		linkedManuscript: scene.linkedManuscript.map((stored) => ({
			link: stored,
			path: index.pathOf(parseWikiLink(stored)?.target ?? stored, scene.path),
		})),
		...recordsOf(index, scene),
	};
}

/** Whether notes of a kind say when they are. */
export const hasTimeFields = (kind: string): boolean =>
	isWorldbuildingKind(kind) && WORLDBUILDING_KIND_DEFINITIONS[kind].timeFields;

export function entityOf(index: MemberIndex, entity: WorldbuildingRecord, place: number, full: boolean): JsonObject {
	const told: JsonObject = {
		kind: entity.kind,
		name: entity.name,
		...standingOf(entity, entity.entityId, place),
		categories: categoriesOf(index.project, entity.kind, entity),
		description: entity.description,
		time: hasTimeFields(entity.kind)
			? {
					kind: entity.timeKind,
					start: index.storedTermOf(entity.timeStart, entity.path),
					end: index.storedTermOf(entity.timeEnd, entity.path),
				}
			: null,
	};
	if (!full) return told;
	return { ...told, notes: entity.notes, ...recordsOf(index, entity) };
}

export function memberOf(member: MemberEntry): JsonObject {
	return { kind: member.kind, id: member.id, name: member.name, path: member.path, aliases: [...member.aliases] };
}

/** Whether any of a note's names holds the words asked for, whatever their case or spacing. */
export function namesHold(names: readonly string[], asked: string | null): boolean {
	if (asked === null) return true;
	const wanted = foldName(asked);
	return wanted.length === 0 || names.some((name) => foldName(name).includes(wanted));
}

/** One kind of a project: where its notes stand, what it is called and how many it holds. */
export function kindOf(project: ProjectSnapshot, id: string, defaultFieldTemplate: string | null): JsonObject | null {
	const registered = project.worldbuildingKinds.find((kind) => kind.id === id);
	if (id !== 'character' && id !== 'scene' && registered === undefined) return null;
	const folder = entityKindFolder(project, id);
	const count =
		id === 'character' ? project.characters.length : id === 'scene' ? project.scenes.length : entitiesOf(project, id).length;
	return {
		id,
		group: registered === undefined ? id : 'worldbuilding',
		builtIn: registered === undefined || !registered.custom,
		name: kindIdFromFolderName(folder.slice(folder.lastIndexOf('/') + 1)),
		path: `${project.rootPath}/${folder}`,
		icon: registered?.icon ?? null,
		description: registered?.description ?? null,
		hasTimeFields: hasTimeFields(id),
		defaultFieldTemplate,
		count,
	};
}
