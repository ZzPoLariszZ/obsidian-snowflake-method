import {
	mergeHistory,
	type HistoryReading,
	type HistoryTallyReading,
} from "../domain";
import type { ManagedFrontmatter, VaultRepository } from "../repository";
import type { SnapshotStoreReader } from "./file-recovery";
import type { ForeshadowingServiceEvent } from "./foreshadowing-service";
import { classifyHistoryPath } from "./history-classify";
import { createHistoryFileMemos, gatherHistoryFiles } from "./history-files";
import {
	SnapshotHarvester,
	type HarvestCursorStore,
	type HarvestStatus,
	type HarvesterEvent,
} from "./history-harvester";
import {
	HistoryLedger,
	type ImportLedgerReport,
	type LedgerEvent,
	type LedgerPendingStore,
} from "./history-ledger";
import type { RevisionServiceEvent } from "./revision-service";
import type { TaskServiceEvent } from "./task-service";
import type { ProjectRef } from "./types";
import type { NoteCountOptions, WritingCountService } from "./writing-count";
import type { WritingSessionEvent, WritingSessionTimers } from "./writing-session";

/**
 * The modification history as the plugin keeps it: the harvester that
 * counts File recovery's copies, the ledger of the plugin's own changes,
 * and the reading that lays both over the writing sessions' tallies for a
 * span of days. One owner, so the plugin starts, feeds and disposes one
 * thing, and the dashboard asks one thing what happened.
 */

/** How long synced record files are left to land before the tab is told once. */
export const HISTORY_FILES_QUIET_MS = 500;

export type ModificationHistoryEvent =
	/** Something a reading would show moved: rows filed, events recorded, a session closed, files synced in. */
	| { kind: "data" }
	/** Whether the copies are being read moved: a setting, the core plugin, a pass beginning or failing. */
	| { kind: "availability" }
	| { kind: "corrupt-file-preserved"; path: string };

/** The sessions' side of the history: the words each record credited to each note, and when a record closes. */
export interface HistoryTallySource {
	fileTalliesBetween(
		project: ProjectRef,
		from: string,
		through: string,
	): Promise<readonly HistoryTallyReading[]>;
	subscribe(listener: (event: WritingSessionEvent) => void): () => void;
}

export interface ModificationHistoryDeps {
	repository: VaultRepository;
	writingCount: WritingCountService;
	tallies: HistoryTallySource;
	/** The store to count, or null while the setting, the core plugin or the device says no; asked at every pass. */
	reader: () => SnapshotStoreReader | null;
	projects: () => readonly ProjectRef[];
	projectAtPath: (path: string) => ProjectRef | null;
	frontmatterNow: (path: string) => ManagedFrontmatter | null;
	countOptions: () => NoteCountOptions;
	cursor: HarvestCursorStore;
	pending: LedgerPendingStore;
	/** A fresh event id. */
	mint: () => string;
	deviceId: () => string;
	timezone: () => string;
	timers: WritingSessionTimers;
	now?: () => number;
	batchRows?: number;
}

/** A span's reading kept until something it read moves. */
interface KeptReading {
	key: string;
	/** Whether each note the merge asked after stood then: a different answer now is a different reading. */
	standing: ReadonlyMap<string, boolean>;
	reading: HistoryReading;
}

export class ModificationHistoryService {
	readonly harvester: SnapshotHarvester;
	readonly ledger: HistoryLedger;
	private readonly listeners = new Set<(event: ModificationHistoryEvent) => void>();
	private readonly memos = createHistoryFileMemos();
	private readonly readings = new Map<string, KeptReading>();
	private readonly releases: (() => void)[] = [];
	private filesTimer: unknown = null;
	private disposed = false;

	constructor(private readonly deps: ModificationHistoryDeps) {
		this.harvester = new SnapshotHarvester({
			repository: deps.repository,
			writingCount: deps.writingCount,
			reader: deps.reader,
			projects: deps.projects,
			projectAtPath: deps.projectAtPath,
			frontmatterNow: deps.frontmatterNow,
			countOptions: deps.countOptions,
			cursor: deps.cursor,
			deviceId: deps.deviceId,
			timezone: deps.timezone,
			timers: deps.timers,
			...(deps.now === undefined ? {} : { now: deps.now }),
			...(deps.batchRows === undefined ? {} : { batchRows: deps.batchRows }),
		});
		this.ledger = new HistoryLedger({
			repository: deps.repository,
			writingCount: deps.writingCount,
			projects: deps.projects,
			projectAtPath: deps.projectAtPath,
			frontmatterNow: deps.frontmatterNow,
			countOptions: deps.countOptions,
			pending: deps.pending,
			mint: deps.mint,
			deviceId: deps.deviceId,
			timezone: deps.timezone,
			timers: deps.timers,
			...(deps.now === undefined ? {} : { now: deps.now }),
		});
		this.releases.push(
			this.harvester.subscribe((event) => {
				this.onHarvester(event);
			}),
			this.ledger.subscribe((event) => {
				this.onLedger(event);
			}),
			// A session closing files its tallies, which a reading shows at
			// once; the ticks between are the session panel's business.
			deps.tallies.subscribe((event) => {
				if (event.kind === "stopped" || event.kind === "recovered") this.emit({ kind: "data" });
			}),
		);
	}

	/** Once the layout is ready: pending events file, and the copies are read after the first pause. */
	start(): void {
		if (this.disposed) return;
		this.ledger.start();
		this.harvester.start();
	}

	subscribe(listener: (event: ModificationHistoryEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.disposed = true;
		if (this.filesTimer !== null) {
			this.deps.timers.clear(this.filesTimer);
			this.filesTimer = null;
		}
		for (const release of this.releases) release();
		this.releases.length = 0;
		this.harvester.dispose();
		this.ledger.dispose();
		this.listeners.clear();
	}

	// ---- what the plugin tells it ----

	/** The reading setting moved: the tab's notice changes, and a store newly readable is read now. */
	settingsChanged(): void {
		this.availabilityChanged();
	}

	/** The core plugin was turned on or off, or the store came and went. */
	availabilityChanged(): void {
		if (this.disposed) return;
		this.emit({ kind: "availability" });
		if (this.deps.reader() !== null) void this.harvester.harvestNow();
	}

	/** A history file landed, changed or left -- another device's through sync, or this one's -- told once the files settle. */
	filesChanged(): void {
		if (this.disposed) return;
		if (this.filesTimer !== null) this.deps.timers.clear(this.filesTimer);
		this.filesTimer = this.deps.timers.set(() => {
			this.filesTimer = null;
			this.emit({ kind: "data" });
		}, HISTORY_FILES_QUIET_MS);
	}

	noteCreated(path: string, content: string, userInput: boolean): void {
		this.ledger.noteCreated(path, content, userInput);
	}

	/**
	 * A note came into a project by any hand: made, restored from a copy,
	 * synced in. The plugin's own creations the ledger writes down; here a
	 * reading that named the note as gone is read again once things settle.
	 */
	noteAppeared(path: string): void {
		if (this.isProjectNote(path)) this.filesChanged();
	}

	notePathRenamed(oldPath: string, newPath: string): void {
		this.harvester.notePathRenamed(oldPath, newPath);
		this.ledger.noteRenamed(oldPath, newPath);
	}

	/** A path gone, with whether it was a folder and the files it took with it, where the caller still knows them. */
	noteDeleted(
		path: string,
		{ folder = false, children = [] as readonly string[] } = {},
	): void {
		this.harvester.noteDeleted(path, { children: folder });
		this.ledger.noteDeleted(path, { children });
		// A reading that named the note shows it as gone, the ledger's word
		// on it or not: a read-only project's notes have no ledger.
		if ([path, ...children].some((gone) => this.isProjectNote(gone))) this.filesChanged();
	}

	private isProjectNote(path: string): boolean {
		return path.toLowerCase().endsWith(".md") && this.deps.projectAtPath(path) !== null;
	}

	beginImport(): void {
		this.ledger.beginImport();
	}

	endImport(report: ImportLedgerReport | null): void {
		this.ledger.endImport(report);
	}

	taskEvent(project: ProjectRef, event: TaskServiceEvent): void {
		this.ledger.taskEvent(project, event);
	}

	threadEvent(project: ProjectRef, event: ForeshadowingServiceEvent): void {
		this.ledger.threadEvent(project, event);
	}

	revisionEvent(project: ProjectRef, event: RevisionServiceEvent): void {
		this.ledger.revisionEvent(project, event);
	}

	// ---- what the dashboard asks ----

	status(): HarvestStatus {
		return this.harvester.status();
	}

	/** Reads the copies now, joining a pass already under way. */
	refresh(): Promise<void> {
		return this.harvester.harvestNow();
	}

	/** Files every event still waiting on its quiet timer. */
	flushNow(): Promise<void> {
		return this.ledger.flushNow();
	}

	/**
	 * What happened in a project between two days, inclusive, in the
	 * device's zone. Kept until a file it read moves, a tally changes or a
	 * note it names comes or goes, so a panel re-reading on every bell pays
	 * for the merge only when there is something new to merge.
	 */
	async read(project: ProjectRef, from: string, through: string): Promise<HistoryReading> {
		const timeZone = this.deps.timezone();
		const files = await gatherHistoryFiles(this.deps.repository, project, from, through, this.memos);
		const tallies = await this.deps.tallies.fileTalliesBetween(project, from, through);
		const key = [
			project.rootPath,
			project.locale,
			from,
			through,
			timeZone,
			files.stamps,
			talliesFingerprint(tallies),
		].join("\n");
		const root = project.rootPath;
		const exists = (path: string): boolean =>
			this.deps.repository.getFile(`${root}/${path}`) !== null;
		const kept = this.readings.get(project.id);
		if (
			kept !== undefined &&
			kept.key === key &&
			[...kept.standing].every(([path, stood]) => exists(path) === stood)
		) {
			return kept.reading;
		}
		const standing = new Map<string, boolean>();
		const reading = mergeHistory({
			from,
			through,
			timeZone,
			snapshots: files.snapshots,
			events: files.events,
			tallies,
			exists: (path) => {
				const stood = standing.get(path) ?? exists(path);
				standing.set(path, stood);
				return stood;
			},
			classify: (path) =>
				classifyHistoryPath(project, path, [this.deps.frontmatterNow(`${root}/${path}`)]),
		});
		this.readings.set(project.id, { key, standing, reading });
		return reading;
	}

	// ---- the parts talking to each other ----

	private onHarvester(event: HarvesterEvent): void {
		switch (event.kind) {
			case "harvested":
				this.emit({ kind: "data" });
				return;
			case "status":
				this.emit({ kind: "availability" });
				return;
			case "corrupt-file-preserved":
				this.emit(event);
				return;
			case "inferred-rename":
				this.ledger.noteRenameInferred(event.project, event.from, event.to, event.ts);
				return;
		}
	}

	private onLedger(event: LedgerEvent): void {
		if (event.kind === "recorded") this.emit({ kind: "data" });
		else this.emit(event);
	}

	private emit(event: ModificationHistoryEvent): void {
		if (this.disposed) return;
		for (const listener of this.listeners) listener(event);
	}
}

/**
 * The tallies in a few bytes: every record by its id, bounds and sums, so
 * a running session's clock or a drain landing is a different reading and
 * an untouched month is the same one.
 */
function talliesFingerprint(tallies: readonly HistoryTallyReading[]): string {
	return tallies
		.map((reading) => {
			let added = 0;
			let deleted = 0;
			for (const file of reading.files) {
				added += file.added;
				deleted += file.deleted;
			}
			return [
				reading.id,
				reading.kind,
				reading.day,
				reading.startedAt ?? "",
				reading.endedAt ?? "",
				reading.focusMs,
				reading.files.length,
				added,
				deleted,
			].join(":");
		})
		.join(",");
}
