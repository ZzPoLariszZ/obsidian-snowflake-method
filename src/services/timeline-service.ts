import {
	addTimelineRow,
	addTimelineTime,
	bindTimeline,
	createTimeline,
	createTimelineView,
	deleteTimeline,
	deleteTimelineRow,
	deleteTimelineView,
	editTimelineRow,
	findTimeline,
	findTimelineView,
	isTimelineBindingKind,
	moveTimelineInView,
	moveTimelineRow,
	pinTimeline,
	placeTimelineScene,
	pruneMissingFromTimelines,
	removeTimelineScene,
	removeTimelineTime,
	renameTimeline,
	renameTimelineView,
	setLastTimelineView,
	setViewCardStyle,
	setViewPresentation,
	setViewSubDescriptions,
	setViewTimeOrder,
	setViewTimelines,
	setViewTimesReversed,
	type EntityRef,
	type ScenePresentation,
	type TimelineCardStyle,
	type TimelineDocument,
} from "../domain";
import type { VaultRepository } from "../repository";
import { TimelineStore } from "./timeline-store";
import type { ProjectRef } from "./types";

/** What a write came to: the document now says what was asked, or why not. */
export type TimelineWrite = "written" | "absent" | "refused";
/** What a deletion came to. */
export type TimelineDeletion = "deleted" | "absent" | "refused";

/** The prefixes the ids minted here wear, one per kind of thing. */
export type TimelineIdPrefix = "timeline" | "timeline-view" | "timeline-row";

/**
 * The timelines of one project, as the workspace asks about them: a
 * document to read and mutations that land in the file at once -- a
 * timeline is something the author laid out, so nothing here waits on a
 * quiet timer. Each mutation is a pure change from `domain/timeline.ts`
 * worked out against the file as it is when the write runs, not as the
 * workspace last painted it; a change that would change nothing writes
 * nothing, and answers as written all the same, since the file says what
 * was asked.
 */
export class TimelineService {
	private readonly store: TimelineStore;
	private readonly now: () => number;
	private readonly mintId: (prefix: TimelineIdPrefix) => string;

	constructor(
		repository: VaultRepository,
		deps: {
			now: () => number;
			mintId: (prefix: TimelineIdPrefix) => string;
			onCorrupt?: (path: string) => void;
			onForeign?: (path: string, version: number) => void;
		},
	) {
		this.now = deps.now;
		this.mintId = deps.mintId;
		this.store = new TimelineStore({
			repository,
			now: deps.now,
			...(deps.onCorrupt === undefined ? {} : { onCorrupt: deps.onCorrupt }),
			...(deps.onForeign === undefined ? {} : { onForeign: deps.onForeign }),
		});
	}

	timelinePath(project: ProjectRef): string {
		return this.store.timelinePath(project);
	}

	read(project: ProjectRef): Promise<TimelineDocument> {
		return this.store.readDocument(project);
	}

	/** A new timeline with no times yet; its id, or null where the store or the binding refused. */
	async createTimeline(
		project: ProjectRef,
		draft: { name: string; binding: EntityRef | null },
	): Promise<string | null> {
		if (draft.binding !== null && !isTimelineBindingKind(draft.binding.kind)) return null;
		const id = this.mintId("timeline");
		const now = this.now();
		const wrote = await this.store.updateDocument(project, (held) =>
			createTimeline(held, {
				id,
				name: draft.name,
				binding: draft.binding,
				times: [],
				createdAt: now,
				updatedAt: now,
			}),
		);
		return wrote ? id : null;
	}

	renameTimeline(project: ProjectRef, id: string, name: string): Promise<TimelineWrite> {
		return this.revise(
			project,
			(held) => findTimeline(held, id) !== undefined,
			(held) => renameTimeline(held, id, name, this.now()),
		);
	}

	/** Points a timeline at an entity, or at none; a scene or a time is refused before the store is asked. */
	bindTimeline(
		project: ProjectRef,
		id: string,
		binding: EntityRef | null,
	): Promise<TimelineWrite> {
		if (binding !== null && !isTimelineBindingKind(binding.kind)) {
			return Promise.resolve("refused");
		}
		return this.revise(
			project,
			(held) => findTimeline(held, id) !== undefined,
			(held) => bindTimeline(held, id, binding, this.now()),
		);
	}

	async deleteTimeline(project: ProjectRef, id: string): Promise<TimelineDeletion> {
		const wrote = await this.revise(
			project,
			(held) => findTimeline(held, id) !== undefined,
			(held) => deleteTimeline(held, id),
		);
		return wrote === "written" ? "deleted" : wrote;
	}

	/** Pins one timeline, or none; absent when the id names no timeline. */
	pinTimeline(project: ProjectRef, id: string | null): Promise<TimelineWrite> {
		return this.revise(
			project,
			(held) => id === null || findTimeline(held, id) !== undefined,
			(held) => pinTimeline(held, id),
		);
	}

	/** A new view over the timelines named, in that order; its id, or null where the store refused. */
	async createView(
		project: ProjectRef,
		draft: { name: string; timelines: readonly string[] },
	): Promise<string | null> {
		const id = this.mintId("timeline-view");
		const now = this.now();
		const wrote = await this.store.updateDocument(project, (held) =>
			createTimelineView(held, {
				id,
				name: draft.name,
				timelines: draft.timelines,
				timeOrder: [],
				presentation: null,
				cardStyle: null,
				showSubDescriptions: true,
				timesReversed: false,
				createdAt: now,
				updatedAt: now,
			}),
		);
		return wrote ? id : null;
	}

	renameView(project: ProjectRef, id: string, name: string): Promise<TimelineWrite> {
		return this.reviseView(project, id, (held) => renameTimelineView(held, id, name, this.now()));
	}

	async deleteView(project: ProjectRef, id: string): Promise<TimelineDeletion> {
		const wrote = await this.reviseView(project, id, (held) => deleteTimelineView(held, id));
		return wrote === "written" ? "deleted" : wrote;
	}

	/** Remembers the view opened last, or none; absent when the id names no view. */
	setLastView(project: ProjectRef, id: string | null): Promise<TimelineWrite> {
		return this.revise(
			project,
			(held) => id === null || findTimelineView(held, id) !== undefined,
			(held) => setLastTimelineView(held, id),
		);
	}

	setViewTimelines(
		project: ProjectRef,
		viewId: string,
		timelineIds: readonly string[],
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			setViewTimelines(held, viewId, timelineIds, this.now()),
		);
	}

	moveTimelineInView(
		project: ProjectRef,
		viewId: string,
		timelineId: string,
		beforeTimelineId: string | null,
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			moveTimelineInView(held, viewId, timelineId, beforeTimelineId, this.now()),
		);
	}

	setTimeOrder(
		project: ProjectRef,
		viewId: string,
		timeIds: readonly string[],
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			setViewTimeOrder(held, viewId, timeIds, this.now()),
		);
	}

	setViewPresentation(
		project: ProjectRef,
		viewId: string,
		presentation: ScenePresentation | null,
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			setViewPresentation(held, viewId, presentation, this.now()),
		);
	}

	setViewCardStyle(
		project: ProjectRef,
		viewId: string,
		cardStyle: TimelineCardStyle | null,
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			setViewCardStyle(held, viewId, cardStyle, this.now()),
		);
	}

	setViewSubDescriptions(
		project: ProjectRef,
		viewId: string,
		shown: boolean,
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			setViewSubDescriptions(held, viewId, shown, this.now()),
		);
	}

	setViewTimesReversed(
		project: ProjectRef,
		viewId: string,
		reversed: boolean,
	): Promise<TimelineWrite> {
		return this.reviseView(project, viewId, (held) =>
			setViewTimesReversed(held, viewId, reversed, this.now()),
		);
	}

	addTime(project: ProjectRef, timelineId: string, timeId: string): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			addTimelineTime(held, timelineId, timeId, this.now()),
		);
	}

	removeTime(project: ProjectRef, timelineId: string, timeId: string): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			removeTimelineTime(held, timelineId, timeId, this.now()),
		);
	}

	/**
	 * A new row under a time of the timeline, the time joining on the way
	 * when it was absent; the row's id, or null where the timeline is not
	 * there or the store refused.
	 */
	async addRow(
		project: ProjectRef,
		timelineId: string,
		timeId: string,
		text: string,
		beforeRowId: string | null,
		scenes: readonly string[] = [],
	): Promise<string | null> {
		const id = this.mintId("timeline-row");
		const wrote = await this.reviseTimeline(project, timelineId, (held) =>
			addTimelineRow(held, timelineId, timeId, { id, text, scenes }, beforeRowId, this.now()),
		);
		return wrote === "written" ? id : null;
	}

	editRow(
		project: ProjectRef,
		timelineId: string,
		rowId: string,
		text: string,
	): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			editTimelineRow(held, timelineId, rowId, text, this.now()),
		);
	}

	moveRow(
		project: ProjectRef,
		timelineId: string,
		rowId: string,
		toTimeId: string,
		beforeRowId: string | null,
	): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			moveTimelineRow(held, timelineId, rowId, toTimeId, beforeRowId, this.now()),
		);
	}

	deleteRow(project: ProjectRef, timelineId: string, rowId: string): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			deleteTimelineRow(held, timelineId, rowId, this.now()),
		);
	}

	placeScene(
		project: ProjectRef,
		timelineId: string,
		sceneId: string,
		rowId: string,
		beforeSceneId: string | null,
	): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			placeTimelineScene(held, timelineId, sceneId, rowId, beforeSceneId, this.now()),
		);
	}

	removeScene(project: ProjectRef, timelineId: string, sceneId: string): Promise<TimelineWrite> {
		return this.reviseTimeline(project, timelineId, (held) =>
			removeTimelineScene(held, timelineId, sceneId, this.now()),
		);
	}

	/** Takes out what points at scenes or times the project no longer has; never absent. */
	pruneMissing(
		project: ProjectRef,
		known: { sceneIds?: ReadonlySet<string>; timeIds?: ReadonlySet<string> },
	): Promise<TimelineWrite> {
		return this.revise(
			project,
			() => true,
			(held) => pruneMissingFromTimelines(held, known, this.now()),
		);
	}

	/** Lets a project's memo go, for a root renamed or deleted. */
	evict(rootPath: string): void {
		this.store.evict(rootPath);
	}

	private reviseTimeline(
		project: ProjectRef,
		timelineId: string,
		change: (held: TimelineDocument) => TimelineDocument | null,
	): Promise<TimelineWrite> {
		return this.revise(project, (held) => findTimeline(held, timelineId) !== undefined, change);
	}

	private reviseView(
		project: ProjectRef,
		viewId: string,
		change: (held: TimelineDocument) => TimelineDocument | null,
	): Promise<TimelineWrite> {
		return this.revise(project, (held) => findTimelineView(held, viewId) !== undefined, change);
	}

	/**
	 * One change worked out against the file as it is: refused where the
	 * store would not take a write, absent where what it names is not
	 * there, written otherwise -- also where nothing needed changing, since
	 * the file then already says what was asked.
	 */
	private async revise(
		project: ProjectRef,
		found: (held: TimelineDocument) => boolean,
		change: (held: TimelineDocument) => TimelineDocument | null,
	): Promise<TimelineWrite> {
		let asked = false;
		let present = false;
		await this.store.updateDocument(project, (held) => {
			asked = true;
			if (!found(held)) return null;
			present = true;
			return change(held);
		});
		if (!asked) return "refused";
		return present ? "written" : "absent";
	}
}
