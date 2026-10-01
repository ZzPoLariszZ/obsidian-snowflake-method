/**
 * What a placement stands for, found at the time of painting. A view keeps
 * only the name of a resource, never the resource: the note, the record or
 * the file is read from where it lives, and a placement whose resource has
 * gone is still a placement, shown as missing under the name it last went by.
 * Pure, so every arm of it is read without a canvas.
 */

import {
	type FreeformPlacement,
	type FreeformRecordType,
	type FreeformResourceType,
	type Task,
} from '../domain';
import type { StickyNoteRecord } from '../services';
import type { ForeshadowingTableItem } from './foreshadowing-rows';
import { plainFirstLine } from './freeform-layout';
import type { RevisionRow } from './revision-panel';
import type {
	CharacterViewModel,
	ProjectDashboardModel,
	SceneViewModel,
	WorldbuildingEntityViewModel,
} from './view-model';

/** How a file is shown, read off its extension. */
export type FreeformFileKind = 'markdown' | 'image' | 'video' | 'audio' | 'pdf' | 'other';

const FILE_KINDS: Readonly<Record<string, FreeformFileKind>> = {
	md: 'markdown',
	avif: 'image',
	bmp: 'image',
	gif: 'image',
	jpeg: 'image',
	jpg: 'image',
	png: 'image',
	svg: 'image',
	webp: 'image',
	mkv: 'video',
	mov: 'video',
	mp4: 'video',
	ogv: 'video',
	webm: 'video',
	flac: 'audio',
	m4a: 'audio',
	mp3: 'audio',
	oga: 'audio',
	ogg: 'audio',
	opus: 'audio',
	wav: 'audio',
	'3gp': 'audio',
	pdf: 'pdf',
};

/** The extension a path ends in, lower case and without its dot; none for a name that has none. */
export function freeformFileExtension(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function freeformFileKind(path: string): FreeformFileKind {
	return FILE_KINDS[freeformFileExtension(path)] ?? 'other';
}

/** One file a view places, as the vault has it now. */
export interface FreeformFileReading {
	/** Where it stands in the vault. */
	path: string;
	/** Where it stands from the project's root, which is what a placement keeps. */
	relativePath: string;
	/** Its name with no folder and no extension. */
	name: string;
	extension: string;
	kind: FreeformFileKind;
	/** How the vault last saw it, so a face is dressed again only when it moved. */
	stamp: string;
}

/** The families of record and file a view may ask for, and the files it names. */
export interface FreeformResourceRequest {
	types: ReadonlySet<FreeformRecordType | 'file'>;
	filePaths: readonly string[];
}

/**
 * What was read for a view. A family is null where it was not asked for or
 * would not read, and `failed` tells the two apart: one that failed costs
 * its own cards and nothing else.
 */
export interface FreeformResources {
	projectPath: string;
	tasks: readonly Task[] | null;
	foreshadowing: readonly ForeshadowingTableItem[] | null;
	revisions: readonly RevisionRow[] | null;
	stickyNotes: readonly StickyNoteRecord[] | null;
	/** By the path a placement keeps, from the project's root. */
	files: ReadonlyMap<string, FreeformFileReading> | null;
	failed: ReadonlySet<FreeformRecordType | 'file'>;
}

/**
 * Why a resource is not there to show: it has gone, it has been set aside,
 * or it has been settled -- a revision accepted, rejected or discarded is
 * taken out of its file all the same, and no reading can say which.
 */
export type FreeformMissingReason = 'gone' | 'archived' | 'settled';

export type ResolvedNode =
	| { type: 'character'; placement: FreeformPlacement; character: CharacterViewModel }
	| { type: 'scene'; placement: FreeformPlacement; scene: SceneViewModel; index: number }
	| { type: 'worldbuilding'; placement: FreeformPlacement; entity: WorldbuildingEntityViewModel }
	| { type: 'task'; placement: FreeformPlacement; task: Task }
	| { type: 'foreshadowing'; placement: FreeformPlacement; item: ForeshadowingTableItem }
	| { type: 'revision'; placement: FreeformPlacement; row: RevisionRow }
	| { type: 'sticky-note'; placement: FreeformPlacement; note: StickyNoteRecord }
	| { type: 'file'; placement: FreeformPlacement; file: FreeformFileReading }
	| { type: 'link'; placement: FreeformPlacement; url: string; label: string; host: string }
	| { type: 'text'; placement: FreeformPlacement; text: string }
	/** Its family has not been read yet: never shown as lost while its reading is on the way. */
	| { type: 'pending'; placement: FreeformPlacement; of: FreeformRecordType | 'file' }
	| {
		type: 'missing';
		placement: FreeformPlacement;
		of: Exclude<FreeformResourceType, 'link' | 'text'>;
		/** The entity's kind as last seen, for a missing note's word; null for what is no entity. */
		kind: string | null;
		why: FreeformMissingReason;
		/** What it was last called; empty where no name was kept. */
		name: string;
	};

/** What a model and a reading hold, keyed by the ids placements name them by. */
interface ResourceIndex {
	characters: ReadonlyMap<string, CharacterViewModel>;
	scenes: ReadonlyMap<string, { scene: SceneViewModel; index: number }>;
	entities: ReadonlyMap<string, WorldbuildingEntityViewModel>;
	tasks: ReadonlyMap<string, Task> | null;
	foreshadowing: ReadonlyMap<string, ForeshadowingTableItem> | null;
	revisions: ReadonlyMap<string, RevisionRow> | null;
	stickyNotes: ReadonlyMap<string, StickyNoteRecord> | null;
}

const byId = <T extends { id: string }>(entries: readonly T[] | null): Map<string, T> | null =>
	entries === null ? null : new Map(entries.map((entry) => [entry.id, entry] as const));

/**
 * The index of a model, made once and kept while the model stands: a view
 * of five hundred nodes would else walk every list five hundred times.
 */
const modelIndexes = new WeakMap<ProjectDashboardModel, Pick<ResourceIndex, 'characters' | 'scenes' | 'entities'>>();
const readingIndexes = new WeakMap<FreeformResources, Omit<ResourceIndex, 'characters' | 'scenes' | 'entities'>>();

function indexOf(model: ProjectDashboardModel, resources: FreeformResources | null): ResourceIndex {
	let ofModel = modelIndexes.get(model);
	if (ofModel === undefined) {
		ofModel = {
			characters: new Map(model.characters.map((character) => [character.id, character] as const)),
			scenes: new Map(model.scenes.map((scene, index) => [scene.id, { scene, index }] as const)),
			entities: new Map(
				Object.values(model.worldbuilding)
					.flat()
					.map((entity) => [entity.id, entity] as const),
			),
		};
		modelIndexes.set(model, ofModel);
	}
	if (resources === null) {
		return { ...ofModel, tasks: null, foreshadowing: null, revisions: null, stickyNotes: null };
	}
	let ofReading = readingIndexes.get(resources);
	if (ofReading === undefined) {
		ofReading = {
			tasks: byId(resources.tasks),
			foreshadowing: byId(resources.foreshadowing),
			revisions: byId(resources.revisions),
			stickyNotes: byId(resources.stickyNotes),
		};
		readingIndexes.set(resources, ofReading);
	}
	return { ...ofModel, ...ofReading };
}

/** The host a link leads to, for a card that has no label to show; the address itself where it will not part. */
export function freeformLinkHost(url: string): string {
	const match = /^https?:\/\/([^/?#\s]+)/iu.exec(url);
	return match?.[1] ?? url;
}

/** A file's name with no folder and no extension, as a card calls it. */
export function freeformFileName(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * One placement found: what it stands for as the project has it now, or why
 * it has nothing to stand for. An entity answers by its id alone, as every
 * stored reference to one does, so a note renamed or moved is still itself;
 * the kind a placement kept is only what a missing one is called by.
 */
export function resolvePlacement(
	placement: FreeformPlacement,
	model: ProjectDashboardModel,
	resources: FreeformResources | null,
): ResolvedNode {
	const resource = placement.resource;
	const index = indexOf(model, resources);
	if (resource.type === 'text') return { type: 'text', placement, text: resource.text };
	if (resource.type === 'link') {
		return { type: 'link', placement, url: resource.url, label: resource.label, host: freeformLinkHost(resource.url) };
	}
	if (resource.type === 'entity') {
		const scene = index.scenes.get(resource.id);
		if (scene !== undefined) return { type: 'scene', placement, scene: scene.scene, index: scene.index };
		const character = index.characters.get(resource.id);
		if (character !== undefined) return { type: 'character', placement, character };
		const entity = index.entities.get(resource.id);
		if (entity !== undefined) return { type: 'worldbuilding', placement, entity };
		return { type: 'missing', placement, of: 'entity', kind: resource.kind, why: 'gone', name: resource.name };
	}
	if (resource.type === 'file') {
		if (resources?.files == null) return { type: 'pending', placement, of: 'file' };
		const file = resources.files.get(resource.path);
		if (file !== undefined) return { type: 'file', placement, file };
		return {
			type: 'missing',
			placement,
			of: 'file',
			kind: null,
			why: 'gone',
			name: resource.path.slice(resource.path.lastIndexOf('/') + 1),
		};
	}
	const missing = (why: FreeformMissingReason): ResolvedNode =>
		({ type: 'missing', placement, of: resource.type, kind: null, why, name: resource.name });
	switch (resource.type) {
		case 'task': {
			if (index.tasks === null) return { type: 'pending', placement, of: 'task' };
			const task = index.tasks.get(resource.id);
			if (task === undefined) return missing('gone');
			return task.archived ? missing('archived') : { type: 'task', placement, task };
		}
		case 'foreshadowing': {
			if (index.foreshadowing === null) return { type: 'pending', placement, of: 'foreshadowing' };
			const item = index.foreshadowing.get(resource.id);
			return item === undefined ? missing('gone') : { type: 'foreshadowing', placement, item };
		}
		case 'revision': {
			if (index.revisions === null) return { type: 'pending', placement, of: 'revision' };
			const row = index.revisions.get(resource.id);
			return row === undefined ? missing('settled') : { type: 'revision', placement, row };
		}
		case 'sticky-note': {
			if (index.stickyNotes === null) return { type: 'pending', placement, of: 'sticky-note' };
			const note = index.stickyNotes.get(resource.id);
			if (note === undefined) return missing('gone');
			return note.archived ? missing('archived') : { type: 'sticky-note', placement, note };
		}
	}
}

/** How many of a record's first words a placement is called by, for one that goes missing later. */
const NAME_LENGTH = 80;

/** The first line of a text that says anything, as plain words trimmed to the name's length: what the canvas calls the record. */
const firstWordsOf = (text: string): string => plainFirstLine(text, NAME_LENGTH);

/**
 * What a placement's resource is called now, for the name a view keeps of
 * it: null for what keeps no name, and for what is missing, whose last name
 * must not be written over with none. A record whose words run long is
 * called by the first line of them.
 */
export function freeformLabelOf(node: ResolvedNode): { name: string; kind?: string } | null {
	switch (node.type) {
		case 'character':
			return { name: node.character.name, kind: 'character' };
		case 'scene':
			return { name: node.scene.title, kind: 'scene' };
		case 'worldbuilding':
			return { name: node.entity.name, kind: node.entity.kind };
		case 'task':
			return { name: node.task.title };
		case 'foreshadowing':
			return { name: node.item.name };
		case 'revision':
			return { name: firstWordsOf(node.row.original.length > 0 ? node.row.original : node.row.proposed) };
		case 'sticky-note':
			return { name: firstWordsOf(node.note.body) };
		default:
			return null;
	}
}
