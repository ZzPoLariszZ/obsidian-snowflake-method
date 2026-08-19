import {
	SessionTracker,
	addDays,
	calendarDay,
	daysBetween,
	emptyBands,
	emptyModes,
	endOfMonth,
	finalizeSnapshot,
	isDocumentType,
	parseMonthFile,
	parseSessionSnapshot,
	sessionBands,
	sessionFilePath,
	sessionGoalMet,
	monthsBetween,
	sessionsFolder,
	sessionYearFolder,
	shouldDiscard,
	sessionDurations,
	sessionNets,
	startOfMonth,
	toSessionIntervals,
	SESSION_FILE_SUFFIX,
	WRITING_SESSION_SCHEMA_VERSION,
	type BandSpan,
	type BandTotals,
	type ModeTotals,
	type PomodoroPhase,
	type SessionDurations,
	type SessionStartMode,
	type SessionStopReason,
	type TrackerEffect,
	type WritingMode,
	type WritingSessionGoal,
	type WritingSessionMonthFile,
	type WritingSessionRecord,
	type WritingSessionScope,
	type WritingSessionSnapshot,
	type WritingSessionTiming,
	type WritingSessionType,
	type WritingSurfaceActivity,
} from "../domain";
import { isPathAtOrBelow } from "../project-root";
import {
	documentTypeOf,
	parseMarkdownFrontmatter,
	type VaultRepository,
} from "../repository";
import type { ManuscriptService } from "./manuscript-service";
import { getProjectPathLayout, type ProjectRef } from "./types";
import type { NoteCountOptions, WritingCountService } from "./writing-count";

/**
 * Where a running session survives a crash: a per-device store, in practice
 * Obsidian's localStorage. Deliberately not the plugin's data.json, which may
 * sync between devices and would carry one machine's live session to another,
 * where it would be "recovered" while still running here.
 */
export interface WritingSessionRecoveryStore {
	load(): unknown;
	save(snapshot: WritingSessionSnapshot | null): void;
}

/** Everything a start decides; timing and options arrive resolved. */
export interface StartWritingSessionOptions {
	scope: WritingSessionScope;
	type: WritingSessionType;
	writingMode: WritingMode;
	startMode: SessionStartMode;
	goal: WritingSessionGoal | null;
	timing: WritingSessionTiming;
	countOptions: NoteCountOptions;
}

export type WritingSessionEvent =
	| { kind: "changed" }
	| { kind: "started" }
	| {
			kind: "stopped";
			record: WritingSessionRecord | null;
			reason: SessionStopReason;
	  }
	| { kind: "goal-reached" }
	| { kind: "break-started"; cycle: number }
	| { kind: "work-started"; cycle: number }
	| { kind: "corrupt-file-preserved"; path: string }
	| { kind: "recovered"; record: WritingSessionRecord | null };

/** The running session as a display reads it, all numbers as of `now`. */
export interface LiveWritingSession {
	uuid: string;
	project: ProjectRef;
	scope: WritingSessionScope;
	type: WritingSessionType;
	startMode: SessionStartMode;
	writingMode: WritingMode;
	goal: WritingSessionGoal | null;
	timing: WritingSessionTiming;
	/** `starting` while the scope count and baselines seed. */
	state: "starting" | "focus" | "idle" | "paused";
	pomodoro: { phase: PomodoroPhase; cycle: number } | null;
	startedAt: number | null;
	durations: SessionDurations;
	remainingMs: number | null;
	startWordCount: number | null;
	added: number;
	deleted: number;
	trackedNet: number;
	goalMet: boolean;
	files: number;
}

export interface TodayWritingSummary {
	/** Finished sessions started today, the live one included when it was. */
	sessions: number;
	focusMs: number;
	idleMs: number;
	totalMs: number;
	/** The two halves the net is made of, kept apart as well as summed. */
	added: number;
	deleted: number;
	trackedNet: number;
}

/** One calendar day's totals, for a reading that spans more than today. */
export interface WritingDayTotals extends TodayWritingSummary {
	/** The day itself, `YYYY-MM-DD` in the reading device's own zone. */
	day: string;
}

/**
 * A project's sittings read across a day and across the work: which hours
 * they happened in, and which stage of the writing they were spent on.
 */
export interface WritingSpread {
	/** One entry per `DAY_BANDS`, in that order. */
	bands: BandTotals[];
	/** One entry per `WRITING_MODES`, in that order. */
	modes: ModeTotals[];
}

export interface WritingSessionTimers {
	set(handler: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

export interface WritingSessionServiceDeps {
	repository: VaultRepository;
	manuscript: ManuscriptService;
	writingCount: WritingCountService;
	recovery: WritingSessionRecoveryStore;
	deviceId: () => string;
	/**
	 * The clock every timer runs on. Required, because the right clock is the
	 * caller's to know: the plugin hands in the main window's, and the tests
	 * hand in one they can hold still.
	 */
	timers: WritingSessionTimers;
	now?: () => number;
	timezone?: () => string;
	uuid?: () => string;
}

interface FileTally {
	added: number;
	deleted: number;
}

/** Hands back the note's current text, or null to fall back to the disk. */
export type NoteTextProvider = () => string | null;

interface LiveState {
	uuid: string;
	project: ProjectRef;
	sessionsDir: string;
	scope: WritingSessionScope;
	type: WritingSessionType;
	startMode: SessionStartMode;
	writingMode: WritingMode;
	goal: WritingSessionGoal | null;
	timing: WritingSessionTiming;
	options: NoteCountOptions;
	timezone: string;
	tracker: SessionTracker | null;
	startedAtMs: number | null;
	startWordCount: number | null;
	baseline: Map<string, number>;
	/** The latest text source per changed note, disk read when undefined. */
	pending: Map<string, NoteTextProvider | undefined>;
	dirtyWhilePaused: Map<string, NoteTextProvider | undefined>;
	perFile: Map<string, FileTally>;
	added: number;
	deleted: number;
	goalNotified: boolean;
	stopping: boolean;
}

const DEBOUNCE_MS = 700;
const SNAPSHOT_EVERY_MS = 20_000;
/**
 * How long the baseline seed may hold the thread before it must breathe.
 * Counting resolves through microtasks, so without this the event loop gets
 * no turn at all and the whole app freezes for the length of a cold seed.
 */
const SEED_BREATH_MS = 12;

/**
 * Runs writing sessions: the timer, the observed word deltas, the monthly
 * files and the crash recovery. Activity arrives as writing surfaces, which
 * answer separately for time and for words: any surface of the project holds
 * the clock in Focus, and only a word-trackable one inside the word scope
 * moves the counts.
 *
 * Lifecycle -- start, stop, replace, recover -- serializes through one
 * mutation queue, so a replacing session becomes active only after its
 * predecessor's record is safely written and an editor transaction at the
 * boundary can never be attributed to the wrong session. Events arriving
 * while no session is active are dropped, not queued.
 */
export class WritingSessionService {
	private readonly now: () => number;
	private readonly timezone: () => string;
	private readonly uuid: () => string;
	private readonly timers: WritingSessionTimers;
	private liveState: LiveState | null = null;
	private mutations: Promise<unknown> = Promise.resolve();
	private readonly listeners = new Set<(event: WritingSessionEvent) => void>();
	private tickHandle: unknown = null;
	private debounceHandle: unknown = null;
	private draining = false;
	private lastSnapshotAt = 0;
	private unloading = false;

	constructor(private readonly deps: WritingSessionServiceDeps) {
		this.now = deps.now ?? (() => Date.now());
		this.timezone =
			deps.timezone ??
			(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
		this.uuid = deps.uuid ?? (() => crypto.randomUUID());
		this.timers = deps.timers;
	}

	/**
	 * The day this device is on. Every reading of a stretch of days is anchored
	 * to it, so a display that has to name the day it is showing asks the same
	 * clock and the same zone the readings were built from.
	 */
	today(): string {
		return calendarDay(this.now(), this.timezone());
	}

	subscribe(listener: (event: WritingSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	isRunning(): boolean {
		return this.liveState !== null;
	}

	/** The running session for display, or null. Numbers are as of now. */
	live(): LiveWritingSession | null {
		const live = this.liveState;
		if (live === null) return null;
		const t = this.now();
		if (live.tracker !== null) this.applyEffects(live, live.tracker.tick(t));
		const durations = live.tracker?.durations(t) ?? {
			focusMs: 0,
			idleMs: 0,
			pausedMs: 0,
			totalMs: 0,
		};
		return {
			uuid: live.uuid,
			project: live.project,
			scope: live.scope,
			type: live.type,
			startMode: live.startMode,
			writingMode: live.writingMode,
			goal: live.goal,
			timing: live.timing,
			state: live.tracker === null ? "starting" : live.tracker.currentPhase(),
			pomodoro: live.tracker?.currentPomodoro() ?? null,
			startedAt: live.startedAtMs,
			durations,
			remainingMs: live.tracker?.remainingMs(t) ?? null,
			startWordCount: live.startWordCount,
			added: live.added,
			deleted: live.deleted,
			trackedNet: live.added - live.deleted,
			goalMet: sessionGoalMet(
				live.goal,
				live.added - live.deleted,
				durations.focusMs,
			),
			files: live.perFile.size,
		};
	}

	/**
	 * Starts a session for one project, replacing any session already running.
	 * The session shows as `starting` until the scope count and the per-note
	 * baselines are seeded; the clock stamps when they are, so a cold seed on
	 * a large project costs patience, never accuracy.
	 */
	start(project: ProjectRef, options: StartWritingSessionOptions): Promise<void> {
		return this.enqueue(async () => {
			if (this.liveState !== null) {
				await this.finishLive("replaced-by-new-session", null);
			}
			const layout = getProjectPathLayout(project.locale);
			const live: LiveState = {
				uuid: this.uuid(),
				project,
				sessionsDir: layout.directories.writingSessions,
				scope: options.scope,
				type: options.type,
				startMode: options.startMode,
				writingMode: options.writingMode,
				goal: options.goal,
				timing: options.timing,
				options: options.countOptions,
				timezone: this.timezone(),
				tracker: null,
				startedAtMs: null,
				startWordCount: null,
				baseline: new Map(),
				pending: new Map(),
				dirtyWhilePaused: new Map(),
				perFile: new Map(),
				added: 0,
				deleted: 0,
				goalNotified: false,
				stopping: false,
			};
			this.liveState = live;
			this.emit({ kind: "started" });
			await this.seedBaselines(live);
			if (this.liveState !== live) return;
			const startedAt = this.now();
			live.tracker = new SessionTracker(
				{
					type: live.type,
					idleThresholdMs: live.timing.idleThresholdSeconds * 1000,
					targetDurationMs: seconds(live.timing.targetDurationSeconds),
					workDurationMs: seconds(live.timing.workDurationSeconds),
					breakDurationMs: seconds(live.timing.breakDurationSeconds),
					autoRepeat: live.timing.autoRepeat,
				},
				startedAt,
			);
			live.startedAtMs = startedAt;
			this.snapshot(live);
			this.armTicker();
			this.armDebounce();
			this.emit({ kind: "changed" });
		});
	}

	/** Starts an auto session only where there is none to disturb. */
	startAuto(
		project: ProjectRef,
		options: Omit<StartWritingSessionOptions, "startMode">,
	): Promise<void> {
		if (this.liveState !== null) return Promise.resolve();
		return this.start(project, { ...options, startMode: "auto" });
	}

	stop(reason: SessionStopReason = "manual"): Promise<void> {
		return this.enqueue(() => this.finishLive(reason, null));
	}

	/** Stops the auto-started session a focus-mode exit owns, and no other. */
	stopIfAuto(reason: SessionStopReason): Promise<void> {
		if (this.liveState?.startMode !== "auto") return Promise.resolve();
		return this.stop(reason);
	}

	pause(): void {
		const live = this.liveState;
		if (live?.tracker == null) return;
		this.applyEffects(live, live.tracker.pause(this.now()));
		this.snapshot(live);
		this.emit({ kind: "changed" });
	}

	resume(): void {
		const live = this.liveState;
		if (live?.tracker == null) return;
		this.applyEffects(live, live.tracker.resume(this.now()));
		// What changed while frozen re-baselines without being credited:
		// a pause is a pause, whatever was typed through it.
		for (const [path, content] of live.dirtyWhilePaused) {
			void this.rebaseline(live, path, resolveText(content));
		}
		live.dirtyWhilePaused.clear();
		this.snapshot(live);
		this.emit({ kind: "changed" });
	}

	setWritingMode(mode: WritingMode): void {
		const live = this.liveState;
		if (live === null) return;
		live.writingMode = mode;
		this.snapshot(live);
		this.emit({ kind: "changed" });
	}

	/**
	 * Meaningful editing on a writing surface: an editor transaction, or a
	 * keystroke in one of this plugin's own writing fields.
	 *
	 * Time only, and time for the whole project, so a strict session survives
	 * a detour through a character's notes. What was written is not a
	 * question a surface can answer: text in a form has not reached the
	 * project, and a form the author cancels never will. Words arrive through
	 * `noteChanged`, when they are persisted.
	 */
	surfaceActivity(surface: WritingSurfaceActivity): void {
		const live = this.liveState;
		if (live?.tracker == null) return;
		if (surface.path === null || !this.inActivityScope(live, surface.path)) {
			return;
		}
		this.applyEffects(live, live.tracker.activity(this.now()));
	}

	/**
	 * The content of `path` changed; `content` hands back the editor's own
	 * text when there is one, resolved lazily at the debounce so a burst of
	 * keystrokes never materializes the note once per key. Without it the
	 * disk is read, which covers external and plugin writes.
	 */
	noteChanged(path: string, content?: NoteTextProvider): void {
		const live = this.liveState;
		if (live === null || !this.inWordScope(live, path)) return;
		if (live.tracker?.currentPhase() === "paused") {
			live.dirtyWhilePaused.set(path, content);
			return;
		}
		live.pending.set(path, content);
		this.armDebounce();
	}

	/**
	 * A note was created. In scope it baselines at nothing and is read like
	 * any other change, so the words it was born with are credited: a note
	 * written in one `create` fires nothing afterwards, and waiting for a
	 * `modify` would lose everything a form put into a new member.
	 */
	noteCreated(path: string): void {
		const live = this.liveState;
		if (live === null || !this.inWordScope(live, path)) return;
		if (!live.baseline.has(path)) live.baseline.set(path, 0);
		this.noteChanged(path);
	}

	/**
	 * A note, or a folder of them, went away. The project really did lose
	 * those words, so the last count seen for each is credited to deleted.
	 * The per-file history stays: what happened in the note happened, and the
	 * record should say how it ended.
	 */
	noteDeleted(path: string, { children = false } = {}): void {
		const live = this.liveState;
		if (live === null) return;
		const prefix = `${path}/`;
		const gone = [...live.baseline.keys()].filter(
			(key) => key === path || (children && key.startsWith(prefix)),
		);
		for (const key of gone) this.creditRemoval(live, key);
		for (const map of [
			live.baseline,
			live.pending,
			live.dirtyWhilePaused,
		] as const) {
			map.delete(path);
			if (!children) continue;
			for (const key of [...map.keys()]) {
				if (key.startsWith(prefix)) map.delete(key);
			}
		}
		if (gone.length > 0) {
			this.maybeSnapshot(live);
			this.emit({ kind: "changed" });
		}
	}

	/**
	 * A rename, of a note or of a whole folder. A rename inside the scope
	 * moves what is known about the note and credits nothing, but crossing
	 * the scope's edge is a real change to what the scope holds: leaving it
	 * reads as the words going, arriving as the words coming.
	 */
	notePathRenamed(oldPath: string, newPath: string): void {
		const live = this.liveState;
		if (live === null) return;
		const prefix = `${oldPath}/`;
		const keys = new Set<string>();
		for (const map of [
			live.baseline,
			live.pending,
			live.dirtyWhilePaused,
			live.perFile,
		] as const) {
			for (const key of map.keys()) {
				if (key === oldPath || key.startsWith(prefix)) keys.add(key);
			}
		}
		let moved = false;
		for (const key of keys) {
			const destination =
				key === oldPath ? newPath : `${newPath}${key.slice(oldPath.length)}`;
			const stillIn = this.inWordScope(live, destination);
			// History follows the note wherever it goes, so the record always
			// keys on where the note is now.
			moveKey(live.perFile, key, destination, true);
			if (!stillIn) {
				moved = this.creditRemoval(live, key, destination) || moved;
			}
			moveKey(live.baseline, key, destination, stillIn);
			moveKey(live.pending, key, destination, stillIn);
			moveKey(live.dirtyWhilePaused, key, destination, stillIn);
		}
		// Nothing was known about a note that lived outside the scope, so
		// there is nothing to move -- it arrives the way a note born here
		// does, at its full count.
		for (const path of this.arrivalsUnder(newPath)) {
			if (!live.baseline.has(path)) this.noteCreated(path);
		}
		if (moved) {
			this.maybeSnapshot(live);
			this.emit({ kind: "changed" });
		}
	}

	/** Every Markdown note a rename may have carried into the vault at `path`. */
	private arrivalsUnder(path: string): string[] {
		if (this.deps.repository.getFile(path) !== null) return [path];
		return this.deps.repository
			.listFilesBelow(path)
			.filter((file) => file.extension === "md")
			.map((file) => file.path);
	}

	/**
	 * The words a note took with it when it left the scope, credited to
	 * deleted under the key the record keeps it by. A paused session credits
	 * nothing, as it credits nothing else.
	 */
	private creditRemoval(
		live: LiveState,
		key: string,
		tallyKey = key,
	): boolean {
		const base = live.baseline.get(key);
		if (base === undefined || base <= 0) return false;
		if (live.tracker?.currentPhase() === "paused") return false;
		live.deleted += base;
		const tally = live.perFile.get(tallyKey) ?? { added: 0, deleted: 0 };
		tally.deleted += base;
		live.perFile.set(tallyKey, tally);
		return true;
	}

	/**
	 * Finalizes an orphaned snapshot from a crash or shutdown into its
	 * monthly file. Never resumes: the record ends at the moment the snapshot
	 * captured, and the end count derives from what the session saw.
	 */
	recoverAtStartup(): Promise<WritingSessionRecord | null> {
		return this.enqueue(async () => {
			const snapshot = parseSessionSnapshot(this.deps.recovery.load());
			this.deps.recovery.save(null);
			if (snapshot === null) return null;
			const record = finalizeSnapshot(snapshot);
			if (shouldDiscard(record)) return null;
			await this.appendRecord(
				snapshot.projectRoot,
				snapshot.sessionsDir,
				Date.parse(snapshot.startedAt),
				snapshot.timezone,
				record,
			);
			this.emit({ kind: "recovered", record });
			return record;
		});
	}

	/**
	 * The plugin is unloading. Synchronous on purpose: the snapshot write is
	 * the one thing that must land before the process may go away, and the
	 * per-device store can take it without an await.
	 */
	markShutdown(): void {
		this.unloading = true;
		this.clearTimers();
		const live = this.liveState;
		if (live?.tracker == null) return;
		live.tracker.tick(this.now());
		this.deps.recovery.save(this.buildSnapshot(live, true));
	}

	/** Today's sessions across every device's file, the live one included. */
	async todaySummary(project: ProjectRef): Promise<WritingDayTotals> {
		const [today] = await this.dailyTotals(project, 1);
		return today ?? emptyDay(calendarDay(this.now(), this.timezone()));
	}

	/**
	 * The last `days` calendar days of this project's writing, oldest first
	 * and ending today.
	 */
	async dailyTotals(
		project: ProjectRef,
		days: number,
	): Promise<WritingDayTotals[]> {
		const today = calendarDay(this.now(), this.timezone());
		const span = Math.max(1, Math.trunc(days));
		return this.totalsBetween(project, addDays(today, 1 - span), today);
	}

	/**
	 * Every day of the month `anchor` falls in, the days still to come
	 * included and empty: a calendar is a shape before it is a reading, and
	 * one that stopped at today would change shape every morning.
	 */
	async monthTotals(
		project: ProjectRef,
		anchor: string,
	): Promise<WritingDayTotals[]> {
		return this.totalsBetween(
			project,
			startOfMonth(anchor),
			endOfMonth(anchor),
		);
	}

	/**
	 * `from` through `through` inclusive, oldest first, with a day that holds
	 * no sessions still present at zero -- a reading of a stretch of time has
	 * to show the days nothing was written as much as the days something was.
	 *
	 * Every device's file for every month the stretch touches is read and its
	 * sessions merged by uuid, so two machines writing the same month agree,
	 * and the live session is counted in the moment it starts rather than when
	 * it ends. A session belongs to the day it began on, in this device's
	 * zone: one carried past midnight stays whole in the day that began it,
	 * and one recorded in another zone is read in this one.
	 */
	async totalsBetween(
		project: ProjectRef,
		from: string,
		through: string,
	): Promise<WritingDayTotals[]> {
		const zone = this.timezone();
		const byDay = new Map<string, WritingDayTotals>();
		const span = daysBetween(from, through);
		for (let at = 0; at <= span; at += 1) {
			const day = addDays(from, at);
			byDay.set(day, emptyDay(day));
		}
		for (const session of (
			await this.gatherSessions(project, from, through)
		).values()) {
			const bucket = byDay.get(calendarDay(Date.parse(session.startedAt), zone));
			if (bucket === undefined) continue;
			const durations = sessionDurations(session);
			bucket.sessions += 1;
			bucket.focusMs += durations.focusMs;
			bucket.idleMs += durations.idleMs;
			bucket.totalMs += durations.totalMs;
			bucket.added += session.addedWordCount;
			bucket.deleted += session.deletedWordCount;
			bucket.trackedNet += sessionNets(session).trackedNet;
		}
		const live = this.live();
		const bucket =
			live === null || live.startedAt === null
				? undefined
				: byDay.get(calendarDay(live.startedAt, zone));
		if (live !== null && bucket !== undefined && this.liveState?.project.id === project.id) {
			bucket.sessions += 1;
			bucket.focusMs += live.durations.focusMs;
			bucket.idleMs += live.durations.idleMs;
			bucket.totalMs += live.durations.totalMs;
			bucket.added += live.added;
			bucket.deleted += live.deleted;
			bucket.trackedNet += live.trackedNet;
		}
		return [...byDay.values()];
	}

	/**
	 * How a project's sittings were spread over the hours of a day, and over
	 * the stages of the writing. One walk answers both, because both are the
	 * same sessions asked a different question -- and over `all`, that walk is
	 * every month the project has ever recorded.
	 */
	async spread(project: ProjectRef, span: BandSpan): Promise<WritingSpread> {
		const zone = this.timezone();
		const today = calendarDay(this.now(), zone);
		const only =
			span === "all" ? null : span === "yesterday" ? addDays(today, -1) : today;
		const sessions =
			only === null
				? await this.everySession(project)
				: await this.gatherSessions(project, only, only);
		const running = this.liveRecord(project);
		if (running !== null) sessions.set(running.uuid, running);
		const bands = emptyBands();
		const modes = emptyModes();
		const byMode = new Map(modes.map((entry) => [entry.mode, entry]));
		for (const session of sessions.values()) {
			// A month file holds the whole month, so a single day still has to
			// be picked out of it.
			if (only !== null && calendarDay(Date.parse(session.startedAt), zone) !== only) {
				continue;
			}
			const durations = sessionDurations(session);
			const mode = byMode.get(session.writingMode);
			if (mode !== undefined) {
				mode.sessions += 1;
				mode.focusMs += durations.focusMs;
				mode.totalMs += durations.totalMs;
				mode.trackedNet += sessionNets(session).trackedNet;
			}
			for (const [at, part] of sessionBands(session, zone).entries()) {
				const band = bands[at];
				if (band === undefined) continue;
				band.focusMs += part.focusMs;
				band.totalMs += part.totalMs;
				band.added += part.added;
				band.deleted += part.deleted;
				band.trackedNet += part.trackedNet;
			}
		}
		return { bands, modes };
	}

	/**
	 * The running session as the record it would be if it stopped now, so a
	 * reading can count it beside the finished ones. The stop reason such a
	 * record carries is the one recovery would have given it; nothing reads it
	 * here, and nothing stores it.
	 */
	private liveRecord(project: ProjectRef): WritingSessionRecord | null {
		const live = this.liveState;
		if (live?.tracker == null || live.project.id !== project.id) return null;
		return finalizeSnapshot(this.buildSnapshot(live, false));
	}

	/**
	 * Every session this project has ever filed, whichever month or year or
	 * device it came from, merged by uuid.
	 */
	private async everySession(
		project: ProjectRef,
	): Promise<Map<string, WritingSessionRecord>> {
		const layout = getProjectPathLayout(project.locale);
		const folder = sessionsFolder(
			project.rootPath,
			layout.directories.writingSessions,
		);
		const byUuid = new Map<string, WritingSessionRecord>();
		for (const file of this.deps.repository.listFilesBelow(folder)) {
			if (!file.name.endsWith(SESSION_FILE_SUFFIX)) continue;
			const parsed = parseMonthJson(
				await this.deps.repository.readPlainFile(file.path),
			);
			if (parsed === null) continue;
			for (const session of parsed.sessions) byUuid.set(session.uuid, session);
		}
		return byUuid;
	}

	/**
	 * Every stored session filed in the months `from` to `through`, merged by
	 * uuid across the devices that recorded them. A month file is named for
	 * the month its sessions began in, so the months a stretch of days touches
	 * are the only files worth opening.
	 */
	private async gatherSessions(
		project: ProjectRef,
		from: string,
		through: string,
	): Promise<Map<string, WritingSessionRecord>> {
		const layout = getProjectPathLayout(project.locale);
		const byUuid = new Map<string, WritingSessionRecord>();
		for (const { year, months } of monthsBetween(from, through)) {
			const folder = sessionYearFolder(
				project.rootPath,
				layout.directories.writingSessions,
				year,
			);
			const prefixes = months.map((month) => `${year}_${month}_`);
			for (const file of this.deps.repository.listDirectFiles(folder)) {
				if (!file.name.endsWith(SESSION_FILE_SUFFIX)) continue;
				if (!prefixes.some((prefix) => file.name.startsWith(prefix))) continue;
				const parsed = parseMonthJson(
					await this.deps.repository.readPlainFile(file.path),
				);
				if (parsed === null) continue;
				for (const session of parsed.sessions) byUuid.set(session.uuid, session);
			}
		}
		return byUuid;
	}

	/**
	 * Activity is project-wide whatever the session's scope: consulting a
	 * character, planning a scene and writing the chapter are one stretch of
	 * work, and a strict session means only that the manuscript's words are
	 * the ones being counted.
	 */
	private inActivityScope(live: LiveState, path: string): boolean {
		return isPathAtOrBelow(path, live.project.rootPath);
	}

	/** Words follow the session's counting scope, and only notes hold words. */
	private inWordScope(live: LiveState, path: string): boolean {
		if (!path.endsWith(".md")) return false;
		return live.scope === "manuscript"
			? this.deps.manuscript.isInManuscriptFolder(live.project, path)
			: isPathAtOrBelow(path, live.project.rootPath);
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.mutations.catch(() => undefined).then(work);
		this.mutations = run.catch(() => undefined);
		return run;
	}

	/** Seeds the per-note baselines and the start count, yielding as it goes. */
	private async seedBaselines(live: LiveState): Promise<void> {
		const paths = await this.deps.writingCount.scopePaths(
			live.project,
			live.scope,
		);
		let sum = 0;
		let lastBreath = this.now();
		for (const path of paths) {
			if (this.liveState !== live || this.unloading) return;
			const count = await this.deps.writingCount.countNote(path, live.options);
			// An unreadable note is absent from the scope count; baselining it
			// at nothing keeps the two views of the scope in agreement.
			const total = count?.total ?? 0;
			live.baseline.set(path, total);
			sum += total;
			// Paced by time, not by count: a warm memo crosses thousands of
			// notes per breath, a cold one a handful, and the app stays alive
			// under either.
			if (this.now() - lastBreath >= SEED_BREATH_MS) {
				await this.breathe();
				lastBreath = this.now();
			}
		}
		live.startWordCount = sum;
	}

	/** A macrotask's worth of air, so a cold seed never freezes the app. */
	private breathe(): Promise<void> {
		return new Promise((resolve) => {
			this.timers.set(() => {
				resolve();
			}, 0);
		});
	}

	private armTicker(): void {
		if (this.unloading || this.tickHandle !== null) return;
		this.tickHandle = this.timers.set(() => {
			this.tickHandle = null;
			const live = this.liveState;
			if (live?.tracker != null && !live.stopping) {
				this.applyEffects(live, live.tracker.tick(this.now()));
				this.maybeSnapshot(live);
				this.emit({ kind: "changed" });
			}
			if (this.liveState !== null && !this.unloading) this.armTicker();
		}, 1000);
	}

	private armDebounce(): void {
		if (this.unloading || this.debounceHandle !== null) return;
		this.debounceHandle = this.timers.set(() => {
			this.debounceHandle = null;
			void this.drain();
		}, DEBOUNCE_MS);
	}

	/** Applies every pending count delta. Reentry-safe; ordering per path. */
	private async drain(): Promise<void> {
		if (this.draining) {
			this.armDebounce();
			return;
		}
		this.draining = true;
		try {
			const live = this.liveState;
			if (live === null || live.tracker === null || live.stopping) return;
			while (live.pending.size > 0) {
				const entries = [...live.pending];
				live.pending.clear();
				for (const [path, content] of entries) {
					if (this.liveState !== live) return;
					const total = await this.currentTotal(
						live,
						path,
						resolveText(content),
					);
					if (total === null) continue;
					this.applyDelta(live, path, total);
				}
			}
			this.maybeGoal(live);
			this.maybeSnapshot(live);
			this.emit({ kind: "changed" });
		} finally {
			this.draining = false;
		}
	}

	private async currentTotal(
		live: LiveState,
		path: string,
		content: string | undefined,
	): Promise<number | null> {
		if (content !== undefined) {
			const parsed = parseMarkdownFrontmatter(content);
			const declared = documentTypeOf(parsed.frontmatter);
			return this.deps.writingCount.countBody(
				parsed.body,
				isDocumentType(declared) ? declared : null,
				live.options,
			).total;
		}
		const count = await this.deps.writingCount.countNote(path, live.options);
		return count?.total ?? null;
	}

	/** Sets a note's baseline to what it now holds, crediting nothing. */
	private async rebaseline(
		live: LiveState,
		path: string,
		content: string | undefined,
	): Promise<void> {
		const total = await this.currentTotal(live, path, content);
		if (this.liveState !== live || total === null) return;
		live.baseline.set(path, total);
	}

	private maybeGoal(live: LiveState): void {
		if (live.goalNotified || live.tracker === null) return;
		const met = sessionGoalMet(
			live.goal,
			live.added - live.deleted,
			live.tracker.durations(this.now()).focusMs,
		);
		if (!met) return;
		live.goalNotified = true;
		this.emit({ kind: "goal-reached" });
	}

	private applyEffects(live: LiveState, effects: TrackerEffect[]): void {
		for (const effect of effects) {
			if (effect.kind === "completion-due") {
				if (!live.stopping) {
					live.stopping = true;
					void this.enqueue(() =>
						this.finishLive("countdown-completed", effect.at),
					);
				}
			} else if (effect.kind === "break-started") {
				this.snapshot(live);
				this.emit({ kind: "break-started", cycle: effect.cycle });
			} else if (effect.kind === "work-started") {
				this.snapshot(live);
				this.emit({ kind: "work-started", cycle: effect.cycle });
			} else {
				this.snapshot(live);
			}
		}
		if (effects.length > 0) this.maybeGoal(live);
	}

	private async finishLive(
		reason: SessionStopReason,
		endAt: number | null,
	): Promise<void> {
		const live = this.liveState;
		if (live === null) return;
		live.stopping = true;
		if (live.tracker === null) {
			// Still seeding: there is no time and there are no deltas, so
			// there is nothing to keep.
			this.liveState = null;
			this.deps.recovery.save(null);
			this.clearTimers();
			this.emit({ kind: "stopped", record: null, reason });
			return;
		}
		// Deltas still on the debounce belong to this session.
		this.draining = false;
		await this.drainInto(live);
		const stopped = live.tracker.stop(endAt ?? this.now());
		const end = await this.deps.writingCount.countProject(
			live.project,
			live.scope,
			live.options,
		);
		const record: WritingSessionRecord = {
			uuid: live.uuid,
			schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
			startedAt: new Date(live.startedAtMs ?? stopped.endedAt).toISOString(),
			endedAt: new Date(stopped.endedAt).toISOString(),
			timezone: live.timezone,
			countingScope: live.scope,
			sessionType: live.type,
			startMode: live.startMode,
			writingMode: live.writingMode,
			stopReason: reason,
			activeIntervals: toSessionIntervals(stopped.active),
			idleIntervals: toSessionIntervals(stopped.idle),
			pausedIntervals: toSessionIntervals(stopped.paused),
			startWordCount: live.startWordCount ?? 0,
			endWordCount: end.total,
			addedWordCount: live.added,
			deletedWordCount: live.deleted,
			netWordCount: live.added - live.deleted,
			files: [...live.perFile.entries()].map(([path, tally]) => ({
				path,
				added: tally.added,
				deleted: tally.deleted,
				net: tally.added - tally.deleted,
			})),
			goal: live.goal,
			timing: live.timing,
		};
		this.liveState = null;
		this.deps.recovery.save(null);
		this.clearTimers();
		if (shouldDiscard(record)) {
			this.emit({ kind: "stopped", record: null, reason });
			return;
		}
		await this.appendRecord(
			live.project.rootPath,
			live.sessionsDir,
			live.startedAtMs ?? stopped.endedAt,
			live.timezone,
			record,
		);
		this.emit({ kind: "stopped", record, reason });
	}

	/** The stop-time flush: pending deltas applied without the debounce. */
	private async drainInto(live: LiveState): Promise<void> {
		for (const [path, content] of [...live.pending]) {
			live.pending.delete(path);
			const total = await this.currentTotal(live, path, resolveText(content));
			if (total === null) continue;
			this.applyDelta(live, path, total);
		}
	}

	/**
	 * Credits one note's movement against its baseline. A note without a
	 * baseline was neither seeded nor created here -- it arrived from outside
	 * the scope -- so it baselines quietly instead of being credited whole.
	 */
	private applyDelta(live: LiveState, path: string, total: number): void {
		const base = live.baseline.get(path);
		if (base === undefined || base === total) {
			live.baseline.set(path, total);
			return;
		}
		const delta = total - base;
		const tally = live.perFile.get(path) ?? { added: 0, deleted: 0 };
		if (delta > 0) {
			live.added += delta;
			tally.added += delta;
		} else {
			live.deleted += -delta;
			tally.deleted += -delta;
		}
		live.perFile.set(path, tally);
		live.baseline.set(path, total);
	}

	private async appendRecord(
		rootPath: string,
		sessionsDir: string,
		startedAtMs: number,
		timezone: string,
		record: WritingSessionRecord,
	): Promise<void> {
		const path = sessionFilePath(
			rootPath,
			sessionsDir,
			startedAtMs,
			timezone,
			this.deps.deviceId(),
		);
		if (this.deps.repository.getFile(path) === null) {
			await this.deps.repository.createPlainFile(
				path,
				serializeMonthFile({
					schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
					sessions: [record],
				}),
			);
			return;
		}
		let corrupt = false;
		await this.deps.repository.updatePlainFile(path, (current) => {
			const parsed = parseMonthJson(current);
			if (parsed === null) {
				corrupt = true;
				return current;
			}
			parsed.sessions.push(record);
			return serializeMonthFile(parsed);
		});
		if (!corrupt) return;
		// Never destroy what will not parse: set it aside whole and start a
		// healthy file where the next session can land again.
		const aside = path.replace(
			/\.json$/u,
			`.corrupted-${String(this.now())}.json`,
		);
		await this.deps.repository.renameFile(path, aside);
		await this.deps.repository.createPlainFile(
			path,
			serializeMonthFile({
				schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
				sessions: [record],
			}),
		);
		this.emit({ kind: "corrupt-file-preserved", path: aside });
	}

	private maybeSnapshot(live: LiveState): void {
		if (this.now() - this.lastSnapshotAt < SNAPSHOT_EVERY_MS) return;
		this.snapshot(live);
	}

	private snapshot(live: LiveState): void {
		if (live.tracker === null || this.unloading) return;
		this.lastSnapshotAt = this.now();
		this.deps.recovery.save(this.buildSnapshot(live, false));
	}

	private buildSnapshot(
		live: LiveState,
		markedShutdown: boolean,
	): WritingSessionSnapshot {
		const tracker = live.tracker as SessionTracker;
		const capturedAt = this.now();
		// Tick to the capture moment first, so the serialized intervals hold
		// any idle split the grace implies up to exactly here.
		this.applyEffects(live, tracker.tick(capturedAt));
		const serialized = tracker.serialize();
		return {
			uuid: live.uuid,
			schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
			projectRoot: live.project.rootPath,
			projectPath: live.project.projectFile,
			sessionsDir: live.sessionsDir,
			startedAt: new Date(live.startedAtMs ?? capturedAt).toISOString(),
			timezone: live.timezone,
			countingScope: live.scope,
			sessionType: live.type,
			startMode: live.startMode,
			writingMode: live.writingMode,
			goal: live.goal,
			timing: live.timing,
			startWordCount: live.startWordCount ?? 0,
			activeIntervals: serialized.activeIntervals,
			idleIntervals: serialized.idleIntervals,
			pausedIntervals: serialized.pausedIntervals,
			openPhase: serialized.openPhase,
			openStartedAt: serialized.openStartedAt,
			capturedAt: new Date(capturedAt).toISOString(),
			lastActivityAt: serialized.lastActivityAt,
			addedWordCount: live.added,
			deletedWordCount: live.deleted,
			files: [...live.perFile.entries()].map(([path, tally]) => ({
				path,
				added: tally.added,
				deleted: tally.deleted,
				net: tally.added - tally.deleted,
			})),
			...(markedShutdown ? { markedShutdown: true } : {}),
		};
	}

	private clearTimers(): void {
		if (this.tickHandle !== null) {
			this.timers.clear(this.tickHandle);
			this.tickHandle = null;
		}
		if (this.debounceHandle !== null) {
			this.timers.clear(this.debounceHandle);
			this.debounceHandle = null;
		}
	}

	private emit(event: WritingSessionEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A listener's failure is its own; the session carries on.
			}
		}
	}
}

/** A day with nothing written on it, which is most days of most years. */
function emptyDay(day: string): WritingDayTotals {
	return {
		day,
		sessions: 0,
		focusMs: 0,
		idleMs: 0,
		totalMs: 0,
		added: 0,
		deleted: 0,
		trackedNet: 0,
	};
}

function seconds(value: number | undefined): number | undefined {
	return value === undefined ? undefined : value * 1000;
}

function moveKey<T>(
	map: Map<string, T>,
	from: string,
	to: string,
	keep: boolean,
): void {
	if (!map.has(from)) return;
	const value = map.get(from) as T;
	map.delete(from);
	if (keep) map.set(to, value);
}

function resolveText(
	provider: NoteTextProvider | undefined,
): string | undefined {
	if (provider === undefined) return undefined;
	try {
		return provider() ?? undefined;
	} catch {
		// An editor gone by drain time answers with the disk instead.
		return undefined;
	}
}

function serializeMonthFile(file: WritingSessionMonthFile): string {
	return `${JSON.stringify(file, null, "\t")}\n`;
}

function parseMonthJson(content: string | null): WritingSessionMonthFile | null {
	if (content === null) return null;
	try {
		return parseMonthFile(JSON.parse(content));
	} catch {
		return null;
	}
}
