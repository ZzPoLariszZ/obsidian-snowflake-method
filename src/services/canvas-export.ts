import { normalizePath } from "obsidian";
import type { CanvasData } from "obsidian/canvas";

import {
	beatSheetCanvas,
	fileStem,
	findBeatSheet,
	findFreeformView,
	findTimelineView,
	freeformCanvas,
	freeformPlacedTypes,
	plainFirstLine,
	safeFileName,
	sameCanvasContent,
	serializeCanvas,
	timelineCanvas,
	type CanvasExportWords,
	type CanvasNoteRef,
	type FreeformCanvasRecordType,
	type FreeformCanvasResolver,
	type TimelineCanvasResolver,
} from "../domain";
import type { VaultRepository } from "../repository";
import type { BeatSheetService } from "./beat-sheet-service";
import type { ForeshadowingService } from "./foreshadowing-service";
import type { FreeformService } from "./freeform-service";
import { createOrUpdatePlainFile } from "./json-store";
import type { RevisionService } from "./revision-service";
import type { StickyNoteService } from "./sticky-note-service";
import type { TaskService } from "./task-service";
import type { TimelineService } from "./timeline-service";
import {
	entitiesOf,
	getProjectPathLayout,
	type ProjectRef,
	type ProjectSnapshot,
} from "./types";

/** One canvas an export would write: where, whether a file stands there, whether it says the same already, and the text. */
export interface CanvasExportTarget {
	path: string;
	exists: boolean;
	/** The file standing there holds these very nodes and edges, however Obsidian has laid them out since. */
	unchanged: boolean;
	content: string;
}

/** The target, or absent where the view or the sheet asked for is not there. */
export type CanvasExportPlan =
	| ({ kind: "planned" } & CanvasExportTarget)
	| { kind: "absent" };

export type CanvasExportWrite = "written" | "unchanged";

/** The workspace folder a canvas lands beside: the key of the layout's directory. */
export type CanvasExportFolder = "freeform" | "timeline" | "beatSheet";

/**
 * A workspace view written as an Obsidian canvas beside the workspace's own
 * file. Planning and writing are two steps, as the manuscript's export has
 * them, so whoever asks can see whether a file already stands at the path,
 * and whether it says the same already, before anything is written over.
 * The notes a view names are read off the project as it stands; the canvas
 * never reads back.
 */
export class CanvasExportService {
	constructor(
		private readonly repository: VaultRepository,
		private readonly deps: {
			freeform: FreeformService;
			timeline: TimelineService;
			beatSheet: BeatSheetService;
			stickyNotes: StickyNoteService;
			tasks: TaskService;
			foreshadowing: ForeshadowingService;
			revisions: RevisionService;
			/** Refuses a project this build may not write to, as every other write into a project is refused. */
			assertWritable: (project: ProjectRef) => void;
		},
	) {}

	async planFreeform(
		project: ProjectSnapshot,
		viewId: string,
		words: CanvasExportWords,
	): Promise<CanvasExportPlan> {
		this.deps.assertWritable(project);
		const held = await this.deps.freeform.read(project);
		const view = findFreeformView(held, viewId);
		if (view === undefined) return { kind: "absent" };
		const notes = noteRefs(project);
		const placed = freeformPlacedTypes(view);
		const stickies = placed.has("sticky-note") ? await this.stickyRefs(project) : new Map<string, CanvasNoteRef>();
		const records = await this.recordNames(project, placed);
		const resolve: FreeformCanvasResolver = {
			entity: (id) => notes.get(id) ?? null,
			stickyNote: (id) => stickies.get(id) ?? null,
			record: (type, id) => records[type].get(id) ?? null,
			file: (path) => normalizePath(`${rootOf(project)}${path}`),
		};
		return this.target(project, "freeform", view.name, view.id, freeformCanvas(view, resolve, words));
	}

	async planTimeline(
		project: ProjectSnapshot,
		viewId: string,
		words: CanvasExportWords,
	): Promise<CanvasExportPlan> {
		this.deps.assertWritable(project);
		const held = await this.deps.timeline.read(project);
		const view = findTimelineView(held, viewId);
		if (view === undefined) return { kind: "absent" };
		const scenes = sceneRefs(project);
		const times = entitiesOf(project, "time");
		const timeRefs = new Map(times.map((time) => [time.entityId, refOf(time)]));
		const resolve: TimelineCanvasResolver = {
			scene: (id) => scenes.get(id) ?? null,
			time: (id) => timeRefs.get(id) ?? null,
		};
		const canonical = times.map((time) => time.entityId);
		return this.target(project, "timeline", view.name, view.id, timelineCanvas(view, held, canonical, resolve, words));
	}

	async planBeatSheet(
		project: ProjectSnapshot,
		sheetId: string,
		words: CanvasExportWords,
	): Promise<CanvasExportPlan> {
		this.deps.assertWritable(project);
		const held = await this.deps.beatSheet.read(project);
		const sheet = findBeatSheet(held, sheetId);
		if (sheet === undefined) return { kind: "absent" };
		const scenes = sceneRefs(project);
		const resolve = { scene: (id: string): CanvasNoteRef | null => scenes.get(id) ?? null };
		return this.target(project, "beatSheet", sheet.name, sheet.id, beatSheetCanvas(sheet, resolve, words));
	}

	/** Writes the target over whatever stands, unless it says the same already, in which case the file is not touched. */
	async write(target: CanvasExportTarget): Promise<CanvasExportWrite> {
		if (target.unchanged) return "unchanged";
		await createOrUpdatePlainFile(this.repository, target.path, target.content);
		return "written";
	}

	/**
	 * Where a view's canvas goes: the workspace's own folder, under the view's
	 * name as a file can carry it, or under the view's id where no safe name
	 * is left of it. A `.canvas` beside the workspace's JSON is nothing the
	 * stores read, since each knows its own file by name.
	 */
	canvasPath(
		project: Pick<ProjectRef, "rootPath" | "locale">,
		folder: CanvasExportFolder,
		name: string,
		id: string,
	): string {
		const directory = getProjectPathLayout(project.locale).directories[folder];
		let stem: string;
		try {
			stem = safeFileName(name);
		} catch {
			stem = id;
		}
		return normalizePath(`${rootOf(project)}${directory}/${stem}.canvas`);
	}

	private async target(
		project: ProjectRef,
		folder: CanvasExportFolder,
		name: string,
		id: string,
		data: CanvasData,
	): Promise<CanvasExportPlan> {
		const path = this.canvasPath(project, folder, name, id);
		const existing = await this.repository.readPlainFile(path);
		return {
			kind: "planned",
			path,
			exists: existing !== null,
			unchanged: existing !== null && sameCanvasContent(existing, data),
			content: serializeCanvas(data),
		};
	}

	/**
	 * What the records a view places are called now, each family read only
	 * where the view places one of it: a task by its title, a thread by its
	 * name, a revision by the first words it was made over, or those it
	 * proposes for an insertion, and by its chapter where neither holds a
	 * plain word, as the view itself calls them.
	 */
	private async recordNames(
		project: ProjectRef,
		placed: ReadonlySet<string>,
	): Promise<Record<FreeformCanvasRecordType, Map<string, string>>> {
		const names: Record<FreeformCanvasRecordType, Map<string, string>> = {
			task: new Map(),
			foreshadowing: new Map(),
			revision: new Map(),
		};
		if (placed.has("task")) {
			for (const task of await this.deps.tasks.list(project)) names.task.set(task.id, task.title);
		}
		if (placed.has("foreshadowing")) {
			for (const thread of await this.deps.foreshadowing.list(project)) names.foreshadowing.set(thread.id, thread.name);
		}
		if (placed.has("revision")) {
			for (const revision of await this.deps.revisions.list(project)) {
				const words = revision.originalText.length > 0 ? revision.originalText : revision.proposed;
				const first = plainFirstLine(words, RECORD_NAME_LENGTH);
				// A chapter's title is its file's name, which is what the view's face falls back on.
				names.revision.set(revision.id, first.length === 0 ? fileStem(revision.path) : first);
			}
		}
		return names;
	}

	private async stickyRefs(project: ProjectRef): Promise<Map<string, CanvasNoteRef>> {
		const refs = new Map<string, CanvasNoteRef>();
		for (const note of await this.deps.stickyNotes.list(project)) {
			refs.set(note.id, { path: note.path, color: note.color });
		}
		return refs;
	}
}

/** How many of a revision's first words it is called by, as the freeform view calls it. */
const RECORD_NAME_LENGTH = 80;

function rootOf(project: Pick<ProjectRef, "rootPath">): string {
	return project.rootPath.length === 0 ? "" : `${project.rootPath}/`;
}

function refOf(note: Pick<CanvasNoteRef, "path" | "color">): CanvasNoteRef {
	return { path: note.path, color: note.color };
}

/** The scenes by the id their notes carry. */
function sceneRefs(project: Pick<ProjectSnapshot, "scenes">): Map<string, CanvasNoteRef> {
	return new Map(project.scenes.map((scene) => [scene.sceneId, refOf(scene)]));
}

/** Every note a freeform placement can name, by its id: the ids of scenes, characters and entities never meet. */
function noteRefs(project: Pick<ProjectSnapshot, "scenes" | "characters" | "worldbuilding">): Map<string, CanvasNoteRef> {
	const refs = sceneRefs(project);
	for (const character of project.characters) refs.set(character.characterId, refOf(character));
	for (const bucket of Object.values(project.worldbuilding)) {
		for (const entity of bucket) refs.set(entity.entityId, refOf(entity));
	}
	return refs;
}
