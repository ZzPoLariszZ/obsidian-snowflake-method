import {
	EVENT_FILE_SUFFIX,
	emptyHistoryEventMonthFile,
	historyFilePath,
	parseHistoryEventMonthFile,
	parseHistoryEventRecord,
	serializeHistoryEventMonthFile,
	withHistoryEvents,
	type Foreshadowing,
	type HistoryEventMonthFile,
	type HistoryEventRecord,
	type HistorySubject,
	type Revision,
	type Task,
} from "../domain";
import { isPathAtOrBelow, movedWithRename } from "../project-root";
import type { ManagedFrontmatter, VaultRepository } from "../repository";
import type { ForeshadowingServiceEvent } from "./foreshadowing-service";
import { classifyHistoryPath, splitNoteText } from "./history-classify";
import { appendJsonRecordFile, parseJsonObject } from "./json-store";
import type { RevisionServiceEvent } from "./revision-service";
import type { TaskServiceEvent } from "./task-service";
import { getProjectPathLayout, type ProjectRef } from "./types";
import type { NoteCountOptions, WritingCountService } from "./writing-count";
import type { WritingSessionTimers } from "./writing-session";

/**
 * The ledger: the plugin's own record of what it changed, which no copy
 * of a note can tell. A version File recovery kept says a note's text
 * moved; only the plugin knows that it made the note, that a rename was a
 * rename and not a deletion and a creation, that a task crossed a column
 * or a revision was taken into the text. Each is written down as it
 * happens, by the device that did it, into the project's own monthly
 * file, so another device's sync never sounds it twice.
 *
 * Events wait a moment before they are filed, so a burst -- a
 * renumbering, an import, a folder moved -- lands in one write. What
 * waits is kept beside the plugin's other per-device state, so a crash
 * loses nothing: the next session files it, and an event's id keeps one
 * filed twice from standing twice.
 */

export const LEDGER_FLUSH_QUIET_MS = 1_500;
export const LEDGER_FLUSH_MAX_MS = 10_000;
export const LEDGER_PENDING_SCHEMA_VERSION = 1;
/**
 * How long a change seen once is the same change seen again: a folder's
 * move or deletion is told once for the folder and once for every note in
 * it, in either order, and the ledger writes each note down once. Another
 * device's telling of the same change is the merge's to let go.
 */
const ECHO_MS = 2_000;

/** One event and the file it goes in. */
export interface PendingHistoryEvent {
	path: string;
	record: HistoryEventRecord;
}

export interface PendingHistoryFile {
	schemaVersion: typeof LEDGER_PENDING_SCHEMA_VERSION;
	events: PendingHistoryEvent[];
}

export interface LedgerPendingStore {
	load(): unknown;
	save(pending: PendingHistoryFile | null): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** What a previous session left unfiled, or null for anything this build cannot read. */
export function parsePendingHistoryFile(value: unknown): PendingHistoryFile | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== LEDGER_PENDING_SCHEMA_VERSION) return null;
	if (!Array.isArray(value.events)) return null;
	const events: PendingHistoryEvent[] = [];
	for (const entry of value.events as unknown[]) {
		if (!isRecord(entry) || typeof entry.path !== "string" || entry.path.length === 0) {
			return null;
		}
		const record = parseHistoryEventRecord(entry.record);
		if (record === null) return null;
		events.push({ path: entry.path, record });
	}
	return { schemaVersion: LEDGER_PENDING_SCHEMA_VERSION, events };
}

/**
 * What the ledger reads of an import's report: where the copies came
 * from, which project they landed in, and which notes the run made or
 * wrote over.
 */
export interface ImportLedgerReport {
	readonly source: { readonly id: string; readonly title: string };
	readonly target: { readonly projectFile: string };
	readonly created: readonly { readonly targetPath: string | null }[];
	readonly replaced: readonly { readonly targetPath: string | null }[];
}

export type LedgerEvent =
	/** Events landed in the vault. */
	| { kind: "recorded"; events: number }
	| { kind: "corrupt-file-preserved"; path: string };

export interface HistoryLedgerDeps {
	repository: VaultRepository;
	writingCount: WritingCountService;
	/** Every project known, for telling a project moved or gone from a note. */
	projects: () => readonly ProjectRef[];
	/** The project a vault path belongs to, or null; synchronous, as the sessions ask it. */
	projectAtPath: (path: string) => ProjectRef | null;
	/** What a note's frontmatter says now, for a note the ledger did not write itself. */
	frontmatterNow: (path: string) => ManagedFrontmatter | null;
	/** The counting convention in force, for the words a created note begins with. */
	countOptions: () => NoteCountOptions;
	pending: LedgerPendingStore;
	/** A fresh event id. */
	mint: () => string;
	deviceId: () => string;
	timezone: () => string;
	timers: WritingSessionTimers;
	now?: () => number;
}

/** Everything of a record but its id, which the ledger mints. */
type EventDraft = Omit<HistoryEventRecord, "id">;

const parseEventJson = (content: string | null): HistoryEventMonthFile | null =>
	parseHistoryEventMonthFile(parseJsonObject(content));

export class HistoryLedger {
	/** Events waiting for the flush, in the order they happened. */
	private queue: PendingHistoryEvent[] = [];
	/** Events of the import under way, held until it ends and says where it came from. */
	private held: PendingHistoryEvent[] | null = null;
	/** Events the flush under way is filing: still the store's, and still followed, until it ends. */
	private writing: PendingHistoryEvent[] = [];
	private readonly recentEchoes = new Map<string, number>();
	private quietTick: unknown = null;
	private ceilingTick: unknown = null;
	private flushing: Promise<void> | null = null;
	private disposed = false;
	private readonly listeners = new Set<(event: LedgerEvent) => void>();
	private readonly now: () => number;

	constructor(private readonly deps: HistoryLedgerDeps) {
		this.now = deps.now ?? (() => Date.now());
		// What a previous session left unfiled is the queue's from the first
		// moment, so an event recorded before `start` saves over nothing.
		this.queue.push(...(parsePendingHistoryFile(deps.pending.load())?.events ?? []));
	}

	/** Arms the flush of what a previous session left unfiled. */
	start(): void {
		this.arm();
	}

	subscribe(listener: (event: LedgerEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Stops the timers; what waits stays in the store for the next session. */
	dispose(): void {
		this.disposed = true;
		this.clearTicks();
		this.listeners.clear();
	}

	/** Files everything waiting now, after a flush in flight where there is one. */
	flushNow(): Promise<void> {
		if (this.flushing !== null) return this.flushing.then(() => this.flushNow());
		if (this.queue.length === 0) return Promise.resolve();
		return this.flush();
	}

	// ---- notes ----

	/** A managed note the plugin made, as the repository reports it, with the note as it stands. */
	noteCreated(path: string, content: string, userInput: boolean): void {
		const located = this.locate(path);
		if (located === null) return;
		const { frontmatter, body } = splitNoteText(content);
		const ref = classifyHistoryPath(located.project, located.rel, [frontmatter]);
		if (ref === null) return;
		const words = this.deps.writingCount.countBodyWhole(body, this.deps.countOptions()).total;
		this.record(located.project, {
			ts: this.now(),
			event: "created",
			origin: userInput ? "user" : "plugin",
			subject: { type: "note", ...ref },
			words,
		});
	}

	/**
	 * A path moved in the vault, a note's or a folder's. A project or a
	 * folder above one moving is no change to the book, and only what
	 * waits to be filed follows; a note moved within its project is
	 * renamed; one moved out of it is gone from it; one moved in is the
	 * harvester's to meet.
	 */
	noteRenamed(oldPath: string, newPath: string): void {
		for (const project of this.deps.projects()) {
			if (movedWithRename(project.rootPath, oldPath, newPath) === null) continue;
			this.followRoot(oldPath, newPath);
			return;
		}
		const folder = this.deps.repository.getFile(newPath) === null;
		const moved = folder
			? this.deps.repository.listFilesBelow(newPath).map((file) => ({
					from: `${oldPath}${file.path.slice(newPath.length)}`,
					to: file.path,
				}))
			: [{ from: oldPath, to: newPath }];
		const ts = this.now();
		for (const { from, to } of moved) {
			if (!to.toLowerCase().endsWith(".md")) continue;
			if (this.echoed(`renamed\n${from}\n${to}`, ts)) continue;
			this.noteMoved(from, to, ts);
		}
	}

	/** A rename the harvester read from the copies: the same text under a new name, the old gone. */
	noteRenameInferred(project: ProjectRef, from: string, to: string, ts: number): void {
		const ref = classifyHistoryPath(project, to, [
			this.deps.frontmatterNow(`${project.rootPath}/${to}`),
		]);
		if (ref === null) return;
		this.record(project, {
			ts,
			event: "renamed",
			origin: "inferred",
			subject: { type: "note", ...ref },
			from,
		});
	}

	/**
	 * A path gone from the vault, with the notes a folder took with it. A
	 * project gone takes its ledger with it: what waited for it is let
	 * go, since filing it would raise the folder from the dead.
	 */
	noteDeleted(path: string, { children = [] as readonly string[] } = {}): void {
		const roots = this.deps
			.projects()
			.filter((project) => isPathAtOrBelow(project.rootPath, path))
			.map((project) => project.rootPath);
		if (roots.length > 0) {
			this.dropUnder(roots);
			return;
		}
		const ts = this.now();
		for (const gone of [path, ...children]) {
			if (!gone.toLowerCase().endsWith(".md")) continue;
			if (this.echoed(`deleted\n${gone}`, ts)) continue;
			const located = this.locate(gone);
			if (located === null) continue;
			const ref = classifyHistoryPath(located.project, located.rel, [
				this.deps.frontmatterNow(gone),
			]);
			if (ref === null) continue;
			this.record(located.project, {
				ts,
				event: "deleted",
				origin: "user",
				subject: { type: "note", ...ref },
			});
		}
	}

	// ---- imports ----

	/** From here until `endImport`, what happens is the import's doing. */
	beginImport(): void {
		this.held ??= [];
	}

	/**
	 * The import ended: what it did is stamped with where it came from and
	 * filed, and the notes it wrote over, which no creation reported, are
	 * recorded as imported. Without a report the run failed partway, and
	 * what it did stands as the import's all the same.
	 */
	endImport(report: ImportLedgerReport | null): void {
		const held = this.held ?? [];
		this.held = null;
		const from =
			report === null ? null : { projectId: report.source.id, title: report.source.title };
		for (const entry of held) {
			if (from !== null) entry.record.importedFrom = from;
		}
		this.queue.push(...held);
		const target = report === null ? null : this.deps.projectAtPath(report.target.projectFile);
		if (report !== null && target !== null && from !== null) {
			const made = new Set(
				held
					.filter((entry) => entry.record.event === "created")
					.map((entry) => entry.record.subject)
					.filter((subject) => subject.type === "note")
					.map((subject) => subject.path),
			);
			const ts = this.now();
			for (const item of report.created) {
				this.noteImported(target, item.targetPath, "created", ts, from, made);
			}
			for (const item of report.replaced) {
				this.noteImported(target, item.targetPath, "imported", ts, from, made);
			}
		}
		this.savePending();
		this.arm();
	}

	private noteImported(
		target: ProjectRef,
		targetPath: string | null,
		event: "created" | "imported",
		ts: number,
		from: { projectId: string; title: string },
		made: ReadonlySet<string>,
	): void {
		if (targetPath === null || !targetPath.toLowerCase().endsWith(".md")) return;
		const located = this.locate(targetPath);
		if (located === null || located.project.id !== target.id) return;
		if (made.has(located.rel)) return;
		const ref = classifyHistoryPath(located.project, located.rel, [
			this.deps.frontmatterNow(targetPath),
		]);
		if (ref === null) return;
		this.record(located.project, {
			ts,
			event,
			origin: "import",
			subject: { type: "note", ...ref },
			importedFrom: from,
		});
	}

	// ---- tasks, threads and revisions ----

	taskEvent(project: ProjectRef, event: TaskServiceEvent): void {
		const ts = this.now();
		const subject = (task: Task): HistorySubject => ({
			type: "task",
			id: task.id,
			title: task.title,
		});
		switch (event.kind) {
			case "created":
				for (const task of event.tasks) {
					this.record(project, { ts, event: "task-created", origin: "user", subject: subject(task) });
				}
				return;
			case "status":
				this.record(project, {
					ts,
					event: "task-status",
					origin: "user",
					subject: subject(event.task),
					status: event.task.status,
				});
				return;
			case "archived":
				this.record(project, { ts, event: "task-archived", origin: "user", subject: subject(event.task) });
				return;
			case "deleted":
				for (const task of event.tasks) {
					this.record(project, { ts, event: "task-deleted", origin: "user", subject: subject(task) });
				}
				return;
		}
	}

	threadEvent(project: ProjectRef, event: ForeshadowingServiceEvent): void {
		const ts = this.now();
		const subject = (item: Foreshadowing): HistorySubject => ({
			type: "thread",
			id: item.id,
			name: item.name,
		});
		switch (event.kind) {
			case "created":
				for (const item of event.items) {
					this.record(project, { ts, event: "thread-created", origin: "user", subject: subject(item) });
				}
				return;
			case "status":
				this.record(project, {
					ts,
					event: "thread-status",
					origin: "user",
					subject: subject(event.item),
					status: event.item.status,
				});
				return;
			case "deleted":
				this.record(project, { ts, event: "thread-deleted", origin: "user", subject: subject(event.item) });
				return;
		}
	}

	revisionEvent(project: ProjectRef, event: RevisionServiceEvent): void {
		const ts = this.now();
		if (event.kind === "created") {
			for (const revision of event.revisions) {
				this.record(project, {
					ts,
					event: "revision-proposed",
					origin: "user",
					subject: this.revisionSubject(project, revision),
				});
			}
			return;
		}
		this.record(project, {
			ts,
			event: event.outcome === "accepted" ? "revision-accepted" : "revision-discarded",
			origin: "user",
			subject: this.revisionSubject(project, event.revision),
		});
	}

	/** The revision by its id, standing in its note as the history names one. */
	private revisionSubject(project: ProjectRef, revision: Revision): HistorySubject {
		const rel =
			revision.path !== project.rootPath && isPathAtOrBelow(revision.path, project.rootPath)
				? revision.path.slice(project.rootPath.length + 1)
				: revision.path;
		const note = classifyHistoryPath(project, rel, [this.deps.frontmatterNow(revision.path)]) ?? {
			path: rel,
			kind: "other",
		};
		return { type: "revision", id: revision.id, note };
	}

	// ---- the record ----

	/** The writable project a vault path lies in, and the path under its root. */
	private locate(path: string): { project: ProjectRef; rel: string } | null {
		const project = this.deps.projectAtPath(path);
		if (project === null || project.readOnly) return null;
		if (path === project.rootPath || !isPathAtOrBelow(path, project.rootPath)) return null;
		return { project, rel: path.slice(project.rootPath.length + 1) };
	}

	/** A note moved from one vault path to another, the project or a folder above it standing still. */
	private noteMoved(from: string, to: string, ts: number): void {
		const before = this.locate(from);
		if (before === null) return;
		const frontmatter = this.deps.frontmatterNow(to);
		const refBefore = classifyHistoryPath(before.project, before.rel, [frontmatter]);
		if (refBefore === null) return;
		const after = this.locate(to);
		const refAfter =
			after !== null && after.project.id === before.project.id
				? classifyHistoryPath(after.project, after.rel, [frontmatter])
				: null;
		if (refAfter !== null) {
			this.record(before.project, {
				ts,
				event: "renamed",
				origin: "user",
				subject: { type: "note", ...refAfter },
				from: before.rel,
			});
			return;
		}
		this.record(before.project, {
			ts,
			event: "deleted",
			origin: "user",
			subject: { type: "note", ...refBefore },
		});
	}

	/** True for a change already written down within the echo window; the first sighting is remembered. */
	private echoed(key: string, now: number): boolean {
		for (const [seenKey, seen] of this.recentEchoes) {
			if (now - seen > ECHO_MS) this.recentEchoes.delete(seenKey);
		}
		if (this.recentEchoes.has(key)) return true;
		this.recentEchoes.set(key, now);
		return false;
	}

	/** A project or a folder above one moved: what waits for it goes where it went. */
	private followRoot(oldPath: string, newPath: string): void {
		let moved = false;
		for (const entry of [...this.writing, ...this.queue, ...(this.held ?? [])]) {
			const destination = movedWithRename(entry.path, oldPath, newPath);
			if (destination === null) continue;
			entry.path = destination;
			moved = true;
		}
		if (moved) this.savePending();
	}

	/** A project gone: what waited for it is let go. */
	private dropUnder(roots: readonly string[]): void {
		const stays = (entry: PendingHistoryEvent): boolean =>
			!roots.some((root) => isPathAtOrBelow(entry.path, root));
		const count = (): number => this.writing.length + this.queue.length + (this.held?.length ?? 0);
		const before = count();
		this.writing = this.writing.filter(stays);
		this.queue = this.queue.filter(stays);
		if (this.held !== null) this.held = this.held.filter(stays);
		if (count() !== before) this.savePending();
	}

	private record(project: ProjectRef, draft: EventDraft): void {
		if (this.disposed || project.readOnly) return;
		const record: HistoryEventRecord = { id: this.deps.mint(), ...draft };
		// Whatever happens while an import runs is the import's doing, save
		// what the harvester read off the copies, which is nobody's.
		if (this.held !== null && record.origin !== "inferred") record.origin = "import";
		const path = historyFilePath(
			project.rootPath,
			getProjectPathLayout(project.locale).directories.modificationHistory,
			record.ts,
			this.deps.timezone(),
			this.deps.deviceId(),
			EVENT_FILE_SUFFIX,
		);
		const entry: PendingHistoryEvent = { path, record };
		if (this.held !== null) {
			this.held.push(entry);
		} else {
			this.queue.push(entry);
			this.arm();
		}
		this.savePending();
	}

	// ---- the flush ----

	/** Arms the quiet flush afresh, and the ceiling once, so a burst lands in one write and never waits past it. */
	private arm(): void {
		if (this.disposed || this.queue.length === 0) return;
		if (this.quietTick !== null) this.deps.timers.clear(this.quietTick);
		this.quietTick = this.deps.timers.set(() => {
			this.quietTick = null;
			void this.flush();
		}, LEDGER_FLUSH_QUIET_MS);
		if (this.ceilingTick === null) {
			this.ceilingTick = this.deps.timers.set(() => {
				this.ceilingTick = null;
				void this.flush();
			}, LEDGER_FLUSH_MAX_MS);
		}
	}

	private clearTicks(): void {
		if (this.quietTick !== null) this.deps.timers.clear(this.quietTick);
		if (this.ceilingTick !== null) this.deps.timers.clear(this.ceilingTick);
		this.quietTick = null;
		this.ceilingTick = null;
	}

	private flush(): Promise<void> {
		if (this.flushing !== null) return this.flushing;
		this.clearTicks();
		const run = this.write().finally(() => {
			this.flushing = null;
		});
		this.flushing = run;
		return run;
	}

	/**
	 * Files every queued event, a month file at a time, each file's batch
	 * gathered by the path its events have when its turn comes: a project
	 * renamed while an earlier file is being written moves what still
	 * waits, and a project deleted lets it go. A file that fails keeps its
	 * events for the next flush.
	 */
	private async write(): Promise<void> {
		this.writing = this.queue;
		this.queue = [];
		const done = new Set<PendingHistoryEvent>();
		const failed = new Set<PendingHistoryEvent>();
		let landed = 0;
		for (;;) {
			const next = this.writing.find((entry) => !done.has(entry));
			if (next === undefined) break;
			const { path } = next;
			const batch = this.writing.filter((entry) => !done.has(entry) && entry.path === path);
			for (const entry of batch) done.add(entry);
			const records = batch.map((entry) => entry.record);
			try {
				const { aside } = await appendJsonRecordFile(
					this.deps.repository,
					this.now,
					path,
					parseEventJson,
					serializeHistoryEventMonthFile,
					{
						fresh: () => withHistoryEvents(emptyHistoryEventMonthFile(), records),
						merge: (parsed) => withHistoryEvents(parsed, records),
					},
				);
				landed += records.length;
				if (aside !== null) this.emit({ kind: "corrupt-file-preserved", path: aside });
			} catch {
				for (const entry of batch) failed.add(entry);
			}
		}
		// What failed goes back as it stands now: under the path a rename
		// gave it meanwhile, and not at all where its project went.
		const kept = this.writing.filter((entry) => failed.has(entry));
		this.writing = [];
		if (kept.length > 0) this.queue.unshift(...kept);
		this.savePending();
		if (landed > 0) this.emit({ kind: "recorded", events: landed });
		if (this.queue.length > 0) this.arm();
	}

	private savePending(): void {
		const events = [...this.writing, ...this.queue, ...(this.held ?? [])];
		this.deps.pending.save(
			events.length === 0 ? null : { schemaVersion: LEDGER_PENDING_SCHEMA_VERSION, events },
		);
	}

	private emit(event: LedgerEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}
