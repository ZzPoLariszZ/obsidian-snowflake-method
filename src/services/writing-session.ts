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
	monthsBetween,
	sessionsFolder,
	sessionYearFolder,
	shouldDiscard,
	sessionDurations,
	sessionNets,
	startOfMonth,
	tallyScopes,
	toSessionIntervals,
	SESSION_FILE_SUFFIX,
	WRITING_SESSION_SCHEMA_VERSION,
	WRITING_SESSION_SCOPES,
	type BandSpan,
	type BandTotals,
	type ModeTotals,
	type PomodoroPhase,
	type SessionDurations,
	type SessionStartMode,
	type SessionFileTally,
	type SessionStopReason,
	type SessionWordTotals,
	type SessionWords,
	type TrackerEffect,
	type WritingMode,
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
	type: WritingSessionType;
	writingMode: WritingMode;
	startMode: SessionStartMode;
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
	| { kind: "break-started"; cycle: number }
	| { kind: "work-started"; cycle: number }
	| { kind: "corrupt-file-preserved"; path: string }
	| { kind: "recovered"; record: WritingSessionRecord | null };

/** The running session as a display reads it, all numbers as of `now`. */
export interface LiveWritingSession {
	id: string;
	project: ProjectRef;
	type: WritingSessionType;
	startMode: SessionStartMode;
	writingMode: WritingMode;
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
	/** The net the daily goal reads, in its scope rather than the lens's. */
	goalNet: number;
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
	/** The same day read in the goal's scope, for the gauges and the marks. */
	goalNet: number;
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
	// Which notes hold whose writing is the count service's question, asked
	// through `scopeNotes` and `scopesOf`, so this never asks the manuscript
	// directly and the two can never answer differently.
	writingCount: WritingCountService;
	recovery: WritingSessionRecoveryStore;
	deviceId: () => string;
	/**
	 * Which of the two readings every word number here answers in. A session
	 * records both, so this filters nothing and decides only what is shown.
	 */
	scope: () => WritingSessionScope;
	/**
	 * Which reading the goal is judged on. Deliberately its own: switching
	 * what the charts show must not change which days met the target.
	 */
	goalScope: () => WritingSessionScope;
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
	id: string;
	project: ProjectRef;
	sessionsDir: string;
	type: WritingSessionType;
	startMode: SessionStartMode;
	writingMode: WritingMode;
	timing: WritingSessionTiming;
	options: NoteCountOptions;
	timezone: string;
	tracker: SessionTracker | null;
	startedAtMs: number | null;
	/** Each scope's total when the session began. */
	start: Record<WritingSessionScope, number> | null;
	/** The last count seen per note the project's writing lives in. */
	baseline: Map<string, number>;
	/**
	 * Which of those notes the manuscript holds right now. Membership is where
	 * a note belongs at this moment, not where it belonged when each word was
	 * typed, so moving one carries its whole tally between the readings.
	 */
	manuscript: Set<string>;
	/** Notes already judged to be nobody's writing, so they are asked once. */
	outside: Set<string>;
	/** Paths whose membership has to be asked again, from a rename. */
	reclassify: Set<string>;
	/** The latest text source per changed note, disk read when undefined. */
	pending: Map<string, NoteTextProvider | undefined>;
	dirtyWhilePaused: Map<string, NoteTextProvider | undefined>;
	/** What each note contributed. The scope totals are sums of these. */
	perFile: Map<string, FileTally>;
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

	/** What kind of thing it is, then which one: `session-<uuid>`. */
	private sessionId(): string {
		return `session-${this.uuid()}`;
	}

	/**
	 * What the session has observed, summed under each scope from the per-note
	 * tallies. Nothing accumulates a scope total, because a note's whole
	 * contribution is read under the membership that note has now: move one
	 * into the manuscript and everything it wrote moves with it, with nothing
	 * to adjust and no second copy of the number to fall out of step.
	 */
	private observed(live: LiveState): SessionWords {
		const totals = tallyScopes(this.fileTallies(live));
		const at = (scope: WritingSessionScope): SessionWordTotals => {
			const { added, deleted } = totals[scope];
			const start = live.start?.[scope] ?? 0;
			const net = added - deleted;
			return { start, end: start + net, added, deleted, net };
		};
		return { project: at("project"), manuscript: at("manuscript") };
	}

	/** Every note the session moved, each under the membership it has now. */
	private fileTallies(live: LiveState): SessionFileTally[] {
		return [...live.perFile.entries()].map(([path, tally]) => ({
			path,
			added: tally.added,
			deleted: tally.deleted,
			net: tally.added - tally.deleted,
			manuscript: live.manuscript.has(path),
		}));
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

	/**
	 * The running session for display, or null. Numbers are as of now.
	 *
	 * `projectFile` asks for one project's sitting, and answers null for
	 * anybody else's. One session runs at a time across the whole vault, so a
	 * panel that belongs to a project has to say which sittings are its own:
	 * without it, every project's timer would show the same clock over the
	 * same words under a different project's name.
	 */
	live(projectFile?: string): LiveWritingSession | null {
		const live = this.liveState;
		if (live === null) return null;
		if (projectFile !== undefined && live.project.projectFile !== projectFile) {
			return null;
		}
		const t = this.now();
		if (live.tracker !== null) this.applyEffects(live, live.tracker.tick(t));
		const durations = live.tracker?.durations(t) ?? {
			focusMs: 0,
			idleMs: 0,
			pausedMs: 0,
			totalMs: 0,
		};
		const words = this.observed(live);
		const shown = words[this.deps.scope()];
		const goalNet = words[this.deps.goalScope()].net;
		return {
			id: live.id,
			project: live.project,
			type: live.type,
			startMode: live.startMode,
			writingMode: live.writingMode,
			timing: live.timing,
			state: live.tracker === null ? "starting" : live.tracker.currentPhase(),
			pomodoro: live.tracker?.currentPomodoro() ?? null,
			startedAt: live.startedAtMs,
			durations,
			remainingMs: live.tracker?.remainingMs(t) ?? null,
			startWordCount: live.start?.[this.deps.scope()] ?? null,
			added: shown.added,
			deleted: shown.deleted,
			trackedNet: shown.net,
			goalNet,
			files: [...live.perFile.keys()].filter(
				(path) =>
					this.deps.scope() === "project" || live.manuscript.has(path),
			).length,
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
				id: this.sessionId(),
				project,
				sessionsDir: layout.directories.writingSessions,
				type: options.type,
				startMode: options.startMode,
				writingMode: options.writingMode,
				timing: options.timing,
				options: options.countOptions,
				timezone: this.timezone(),
				tracker: null,
				startedAtMs: null,
				start: null,
				baseline: new Map(),
				manuscript: new Set(),
				outside: new Set(),
				reclassify: new Set(),
				pending: new Map(),
				dirtyWhilePaused: new Map(),
				perFile: new Map(),
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
		if (live === null || !this.worthReading(live, path)) return;
		if (live.tracker?.currentPhase() === "paused") {
			live.dirtyWhilePaused.set(path, content);
			return;
		}
		live.pending.set(path, content);
		this.armDebounce();
	}

	/**
	 * A note was created. It is read like any other change, and because it has
	 * no baseline yet the whole of it is credited: a note written in one
	 * `create` fires nothing afterwards, and waiting for a `modify` would lose
	 * everything a form put into a new member. Whether it is the project's
	 * writing at all is asked at the drain, from the file, because a note born
	 * a moment ago is exactly the one the index has not seen.
	 */
	noteCreated(path: string): void {
		const live = this.liveState;
		if (live === null || !this.worthReading(live, path)) return;
		live.outside.delete(path);
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
		// A verdict is about a note, not about a path: another note may be
		// written here tomorrow and deserves to be asked afresh. Membership,
		// though, stays, because a deleted note keeps the tally it left behind
		// and the record has to file that tally somewhere.
		live.outside.delete(path);
		live.reclassify.delete(path);
		if (children) {
			for (const set of [live.outside, live.reclassify] as const) {
				for (const key of [...set]) {
					if (key.startsWith(prefix)) set.delete(key);
				}
			}
		}
		if (gone.length > 0) {
			this.maybeSnapshot(live);
			this.emit({ kind: "changed" });
		}
	}

	/**
	 * A rename, of a note or of a whole folder.
	 *
	 * Everything known about a note follows it: the tally the record keys by,
	 * the baseline it is measured against, and which scopes hold it. Where it
	 * has landed is then asked again at the drain, and that one answer settles
	 * every case -- a move inside the project changes nothing, a move into or
	 * out of the manuscript carries the note's whole tally between the two
	 * readings, and a move out of the project altogether reads as the words
	 * going. A note arriving from outside was in none of these maps and is
	 * discovered by listing where it landed.
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
		for (const key of live.manuscript) {
			if (key === oldPath || key.startsWith(prefix)) keys.add(key);
		}
		for (const key of keys) {
			const destination =
				key === oldPath ? newPath : `${newPath}${key.slice(oldPath.length)}`;
			moveKey(live.perFile, key, destination);
			moveKey(live.baseline, key, destination);
			moveKey(live.pending, key, destination);
			moveKey(live.dirtyWhilePaused, key, destination);
			if (live.manuscript.delete(key)) live.manuscript.add(destination);
			live.outside.delete(key);
			live.reclassify.add(destination);
		}
		// Only what landed inside the project is worth asking about: a note
		// moved from one corner of the vault to another was never this
		// project's and still is not.
		if (isPathAtOrBelow(newPath, live.project.rootPath)) {
			for (const path of this.arrivalsUnder(newPath)) {
				live.outside.delete(path);
				live.reclassify.add(path);
			}
		}
		if (live.reclassify.size > 0) this.armDebounce();
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
	 * The words a note took with it when it left the project, credited to
	 * deleted under the key the record keeps it by. A paused session credits
	 * nothing, as it credits nothing else.
	 */
	private creditRemoval(live: LiveState, key: string): boolean {
		const base = live.baseline.get(key);
		if (base === undefined || base <= 0) return false;
		if (live.tracker?.currentPhase() === "paused") return false;
		const tally = live.perFile.get(key) ?? { added: 0, deleted: 0 };
		tally.deleted += base;
		live.perFile.set(key, tally);
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
	 * sessions merged by id, so two machines writing the same month agree,
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
			const shown = session.words[this.deps.scope()];
			bucket.added += shown.added;
			bucket.deleted += shown.deleted;
			bucket.trackedNet += shown.net;
			bucket.goalNet += session.words[this.deps.goalScope()].net;
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
			bucket.goalNet += live.goalNet;
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
		if (running !== null) sessions.set(running.id, running);
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
				mode.trackedNet += sessionNets(session, this.deps.scope()).trackedNet;
			}
			for (const [at, part] of sessionBands(
				session,
				zone,
				this.deps.scope(),
			).entries()) {
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
	 * device it came from, merged by id.
	 */
	private async everySession(
		project: ProjectRef,
	): Promise<Map<string, WritingSessionRecord>> {
		const layout = getProjectPathLayout(project.locale);
		const folder = sessionsFolder(
			project.rootPath,
			layout.directories.writingSessions,
		);
		const byId = new Map<string, WritingSessionRecord>();
		for (const file of this.deps.repository.listFilesBelow(folder)) {
			if (!file.name.endsWith(SESSION_FILE_SUFFIX)) continue;
			const parsed = parseMonthJson(
				await this.deps.repository.readPlainFile(file.path),
			);
			if (parsed === null) continue;
			for (const session of parsed.sessions) byId.set(session.id, session);
		}
		return byId;
	}

	/**
	 * Every stored session filed in the months `from` to `through`, merged by
	 * id across the devices that recorded them. A month file is named for
	 * the month its sessions began in, so the months a stretch of days touches
	 * are the only files worth opening.
	 */
	private async gatherSessions(
		project: ProjectRef,
		from: string,
		through: string,
	): Promise<Map<string, WritingSessionRecord>> {
		const layout = getProjectPathLayout(project.locale);
		const byId = new Map<string, WritingSessionRecord>();
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
				for (const session of parsed.sessions) byId.set(session.id, session);
			}
		}
		return byId;
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

	/**
	 * Whether a change is worth opening the note for. A pre-filter and not an
	 * answer: only notes hold words and only this project's tree can hold
	 * this project's, but whether the project's writing really lives in this
	 * one is a question about what the note declares, and that is asked at the
	 * drain where the note is being read anyway.
	 */
	private worthReading(live: LiveState, path: string): boolean {
		return (
			path.endsWith(".md") && isPathAtOrBelow(path, live.project.rootPath)
		);
	}

	/**
	 * Whether the project's writing lives in this note, asked once and
	 * remembered. A note the session already has a baseline for is one; any
	 * other is put to `scopesOf`, so a stray note under the project folder is
	 * judged on its first save rather than on every one.
	 *
	 * A note that qualifies and has no baseline starts at nothing, which is
	 * what credits the whole of a note born mid-session, and the whole of one
	 * that has just declared itself part of the project.
	 */
	private async member(live: LiveState, path: string): Promise<boolean> {
		if (live.baseline.has(path)) return true;
		if (live.outside.has(path)) return false;
		const scopes = await this.deps.writingCount.scopesOf(live.project, path);
		if (scopes.length === 0) {
			live.outside.add(path);
			return false;
		}
		this.setManuscript(live, path, scopes.includes("manuscript"));
		live.baseline.set(path, 0);
		return true;
	}

	/**
	 * Where a moved note belongs now. Nothing has to be recalculated for a
	 * note that crossed into or out of the manuscript: its tally is read under
	 * its membership, so setting the membership moves the whole of it.
	 */
	private async reclassifyPath(live: LiveState, path: string): Promise<void> {
		const scopes = await this.deps.writingCount.scopesOf(live.project, path);
		if (this.liveState !== live) return;
		if (scopes.length > 0) {
			live.outside.delete(path);
			this.setManuscript(live, path, scopes.includes("manuscript"));
			// A note that arrived from outside has nothing to be measured
			// against, so it is read like one born here, at its full count.
			if (!live.baseline.has(path)) this.noteChanged(path);
			return;
		}
		// Out of the project altogether: the words went with it, and the
		// tally stays behind under the name the note left by.
		this.creditRemoval(live, path);
		live.baseline.delete(path);
		live.pending.delete(path);
		live.dirtyWhilePaused.delete(path);
		live.outside.add(path);
	}

	private setManuscript(live: LiveState, path: string, held: boolean): void {
		if (held) live.manuscript.add(path);
		else live.manuscript.delete(path);
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = this.mutations.catch(() => undefined).then(work);
		this.mutations = run.catch(() => undefined);
		return run;
	}

	/**
	 * Seeds the per-note baselines and both start counts, yielding as it goes.
	 * The whole project is walked whatever the goal is set to, because a
	 * session records both readings and only chooses between them for display.
	 */
	private async seedBaselines(live: LiveState): Promise<void> {
		const notes = await this.deps.writingCount.scopeNotes(live.project);
		const start = { project: 0, manuscript: 0 };
		let lastBreath = this.now();
		for (const note of notes) {
			if (this.liveState !== live || this.unloading) return;
			const count = await this.deps.writingCount.countNote(
				note.path,
				live.options,
			);
			// An unreadable note is absent from the scope count; baselining it
			// at nothing keeps the two views of the scope in agreement.
			const total = count?.total ?? 0;
			live.baseline.set(note.path, total);
			start.project += total;
			if (note.manuscript) {
				live.manuscript.add(note.path);
				start.manuscript += total;
			}
			// Paced by time, not by count: a warm memo crosses thousands of
			// notes per breath, a cold one a handful, and the app stays alive
			// under either.
			if (this.now() - lastBreath >= SEED_BREATH_MS) {
				await this.breathe();
				lastBreath = this.now();
			}
		}
		live.start = start;
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
			while (live.reclassify.size > 0 || live.pending.size > 0) {
				// Where the moved notes landed is settled first: a note that
				// arrived from outside queues itself for reading here, and one
				// that left has its words credited before anything else asks
				// what it holds.
				for (const path of [...live.reclassify]) {
					live.reclassify.delete(path);
					if (this.liveState !== live) return;
					await this.reclassifyPath(live, path);
				}
				const entries = [...live.pending];
				live.pending.clear();
				for (const [path, content] of entries) {
					if (this.liveState !== live) return;
					if (!(await this.member(live, path))) continue;
					const total = await this.currentTotal(
						live,
						path,
						resolveText(content),
					);
					if (total === null) continue;
					this.applyDelta(live, path, total);
				}
			}
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
		// One walk answers both scopes, so the ends of the two readings are
		// read at the same moment and by the same rule as their beginnings.
		const end = await this.deps.writingCount.countScopes(
			live.project,
			live.options,
		);
		const observed = this.observed(live);
		const words = Object.fromEntries(
			WRITING_SESSION_SCOPES.map((scope) => [
				scope,
				{ ...observed[scope], end: end[scope].total },
			]),
		) as SessionWords;
		const record: WritingSessionRecord = {
			id: live.id,
			schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
			startedAt: new Date(live.startedAtMs ?? stopped.endedAt).toISOString(),
			endedAt: new Date(stopped.endedAt).toISOString(),
			timezone: live.timezone,
			sessionType: live.type,
			startMode: live.startMode,
			writingMode: live.writingMode,
			stopReason: reason,
			activeIntervals: toSessionIntervals(stopped.active),
			idleIntervals: toSessionIntervals(stopped.idle),
			pausedIntervals: toSessionIntervals(stopped.paused),
			words,
			files: this.fileTallies(live),
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
		for (const path of [...live.reclassify]) {
			live.reclassify.delete(path);
			await this.reclassifyPath(live, path);
		}
		for (const [path, content] of [...live.pending]) {
			live.pending.delete(path);
			if (!(await this.member(live, path))) continue;
			const total = await this.currentTotal(live, path, resolveText(content));
			if (total === null) continue;
			this.applyDelta(live, path, total);
		}
	}

	/**
	 * Credits one note's movement against its baseline, and only to the note.
	 * Which scopes that credit is read under is decided when the totals are
	 * summed, from where the note belongs then, so nothing here has to know or
	 * remember it.
	 */
	private applyDelta(live: LiveState, path: string, total: number): void {
		const base = live.baseline.get(path) ?? 0;
		live.baseline.set(path, total);
		if (base === total) return;
		const delta = total - base;
		const tally = live.perFile.get(path) ?? { added: 0, deleted: 0 };
		if (delta > 0) tally.added += delta;
		else tally.deleted += -delta;
		live.perFile.set(path, tally);
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
			id: live.id,
			schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
			projectRoot: live.project.rootPath,
			projectPath: live.project.projectFile,
			sessionsDir: live.sessionsDir,
			startedAt: new Date(live.startedAtMs ?? capturedAt).toISOString(),
			timezone: live.timezone,
			sessionType: live.type,
			startMode: live.startMode,
			writingMode: live.writingMode,
			timing: live.timing,
			start: live.start ?? { project: 0, manuscript: 0 },
			activeIntervals: serialized.activeIntervals,
			idleIntervals: serialized.idleIntervals,
			pausedIntervals: serialized.pausedIntervals,
			openPhase: serialized.openPhase,
			openStartedAt: serialized.openStartedAt,
			capturedAt: new Date(capturedAt).toISOString(),
			lastActivityAt: serialized.lastActivityAt,
			files: this.fileTallies(live),
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
		goalNet: 0,
	};
}

function seconds(value: number | undefined): number | undefined {
	return value === undefined ? undefined : value * 1000;
}

function moveKey<T>(map: Map<string, T>, from: string, to: string): void {
	if (!map.has(from)) return;
	const value = map.get(from) as T;
	map.delete(from);
	map.set(to, value);
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
