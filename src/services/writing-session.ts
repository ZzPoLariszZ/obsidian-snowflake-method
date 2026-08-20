import {
	SessionTracker,
	addDays,
	addMonths,
	calendarDay,
	daysBetween,
	emptyBands,
	emptyModes,
	endOfMonth,
	finalizeSnapshot,
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
	untimedDayId,
	untimedFilePath,
	untimedWordsFromFiles,
	parseUntimedFile,
	parseUntimedSnapshot,
	type UntimedFileTally,
	SESSION_FILE_SUFFIX,
	UNTIMED_FILE_SUFFIX,
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
	type UntimedDayRecord,
	type UntimedMonthFile,
	type UntimedStateSnapshot,
	type UntimedTrackingSnapshot,
	type WritingMode,
	type WritingSessionMonthFile,
	type WritingSessionRecord,
	type WritingSessionScope,
	type WritingSessionSnapshot,
	type WritingSessionTiming,
	type WritingSessionType,
} from "../domain";
import { isPathAtOrBelow } from "../project-root";
import {
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

/**
 * Where the accruing untimed days survive a crash: the same per-device store
 * the session snapshot lives in, under its own key, because an untimed day is
 * per-device too and a synced copy would be double-filed by another machine.
 */
export interface UntimedRecoveryStore {
	load(): unknown;
	save(snapshot: UntimedTrackingSnapshot | null): void;
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
	/**
	 * `counted` marks a change that moved word totals -- a drain landing, a
	 * deletion credited -- as opposed to the once-a-second tick of a running
	 * clock. Panels re-read the day at once on a counted change: unlike the
	 * ticks, these have no heartbeat behind them, and a throttled reader that
	 * skipped the last one would show stale numbers until the next keystroke.
	 * Required, not defaulted: every emitter must say which of the two it is,
	 * because a word-moving change that forgot the flag would be silently
	 * throttled into staleness.
	 */
	| { kind: "changed"; counted: boolean }
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
	/**
	 * The day's net from timed sessions alone, under the displayed scope.
	 * Pace reads this: it divides by focus time, which only sessions have,
	 * and untimed words over session minutes would be nobody's speed.
	 */
	timedNet: number;
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
	 * Whether a note is open in an editor right now -- a markdown leaf in any
	 * window, or the manuscript stream's editing segment. A vault write to an
	 * open note is its editor's own save echo, and only the closed ones may be
	 * re-baselined from it.
	 */
	isNoteOpen: (path: string) => boolean;
	/** Whether writing outside a session is being recorded at all. Read live. */
	trackUntimed: () => boolean;
	/**
	 * The project a path belongs to, or null for a note no project owns.
	 * Synchronous and cheap, because it is asked on every edit anywhere in the
	 * vault; the caller keeps it answerable from memory.
	 */
	projectAtPath: (path: string) => ProjectRef | null;
	/** The counting convention in force, frozen per untimed day at first use. */
	countOptions: () => NoteCountOptions;
	untimedRecovery: UntimedRecoveryStore;
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
	/**
	 * What a plugin save found in a note this session had no baseline for --
	 * the content the save replaced. Read once at the drain, so the save is
	 * credited with what it changed rather than with the whole note.
	 */
	seedTexts: Map<string, string>;
	/**
	 * Notes whose baseline must be reset from disk before any more deltas are
	 * read for them -- what changed through a pause whose text the editor
	 * could not answer for at the thaw. Processed by the drain ahead of
	 * `pending`, so a keystroke landing right after a resume is measured
	 * against the paused state rather than crediting it.
	 */
	rebase: Set<string>;
	/** What each note contributed. The scope totals are sums of these. */
	perFile: Map<string, FileTally>;
	stopping: boolean;
}

/** One note's queued untimed change: the newest text, and what came before. */
interface UntimedPending {
	/** The latest text source, disk read when undefined. */
	content?: NoteTextProvider;
	/** What a plugin save replaced, kept only until the baseline seeds. */
	seedText?: string;
}

/**
 * One project's untimed day: the words observed while no session ran for it.
 * The same shape a session keeps for its counting, with no tracker and no
 * clock -- a day of calendar is the whole of its "timing".
 */
interface UntimedState {
	projectId: string;
	rootPath: string;
	sessionsDir: string;
	/** IANA zone the day is read in, frozen at the state's creation. */
	timezone: string;
	/** The calendar day being accrued, `YYYY-MM-DD` in that zone. */
	day: string;
	/** The counting convention, frozen like a session freezes its own. */
	options: NoteCountOptions;
	/** The freshest ref seen for this project; null on a bare recovery. */
	ref: ProjectRef | null;
	/** Whether the day's own record on disk has been folded back in. */
	hydrated: boolean;
	/** Whether the day holds credits its vault file does not have yet. */
	dirty: boolean;
	baseline: Map<string, number>;
	/**
	 * Paths whose baselines a session vouched for at its stop or pause: words
	 * this device counted in, which a deletion may therefore count out even
	 * when the untimed day itself never tallied the note. A baseline seeded
	 * from an external write is deliberately not here -- those words were
	 * never counted in on this device, and crediting their deletion would
	 * subtract another device's story from this one's day.
	 */
	vouched: Set<string>;
	manuscript: Set<string>;
	outside: Set<string>;
	reclassify: Set<string>;
	pending: Map<string, UntimedPending>;
	rebase: Set<string>;
	perFile: Map<string, FileTally>;
}

/**
 * A finished untimed record whose write has not landed yet -- a rollover or a
 * toggle-off waiting on the vault. Carried in memory, covered by the recovery
 * snapshot, and retried until the upsert succeeds, so a failed write costs a
 * delay rather than a day.
 */
interface PendingUntimedFlush {
	projectId: string;
	rootPath: string;
	sessionsDir: string;
	record: UntimedDayRecord;
}

const DEBOUNCE_MS = 700;
const SNAPSHOT_EVERY_MS = 20_000;
/**
 * When an accruing untimed day reaches its vault file. The snapshot is the
 * crash net; the file is durability and sync -- another device sees today's
 * untimed words within minutes rather than after midnight, and a cleared
 * localStorage costs minutes rather than the day.
 *
 * The day is filed once its number has settled: every credit, whoever caused
 * it -- a keystroke, a form save, a deletion -- postpones the write by the
 * quiet spell, because a value written mid-churn is stale the moment it
 * lands. The ceiling is what keeps the postponing honest: a day that has
 * been dirty this long is filed as it stands, so a marathon with no quiet
 * spell in it still trails the vault by minutes and never by the day.
 */
const UNTIMED_FLUSH_QUIET_MS = 5 * 60_000;
const UNTIMED_FLUSH_MAX_MS = 15 * 60_000;
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
 * boundary can never be attributed to the wrong session. Events no session
 * answers for -- none running, another project's, or the live one paused --
 * fall to the projects' untimed days, which record words with no clock.
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
	/**
	 * The drain the debounce last fired, so a stop can wait for it: a drain
	 * runs outside the mutation queue, and a stop that raced one would write
	 * the record without the deltas the drain had already claimed.
	 */
	private drainRun: Promise<void> | null = null;
	/**
	 * Month files parsed once per on-disk state, keyed the way the count
	 * service keys its memo: a month file changes only when a session ends,
	 * and every reading walks the same files -- without this, one panel mount
	 * parses the same file four times over and every ten-second beat parses
	 * it again. The parsed records are shared between readers and never
	 * mutated; anything that rewrites a file moves its stat and misses here.
	 */
	private readonly monthMemo = new Map<
		string,
		{ stamp: string; file: WritingSessionMonthFile | null }
	>();
	/** The untimed files' own memo, stamped and shared the same way. */
	private readonly untimedMemo = new Map<
		string,
		{ stamp: string; file: UntimedMonthFile | null }
	>();
	/** One accruing untimed day per project, keyed by project id. */
	private readonly untimedStates = new Map<string, UntimedState>();
	/** Finished untimed records still waiting on the vault, by project+id. */
	private readonly unflushed = new Map<string, PendingUntimedFlush>();
	/**
	 * The one-shot behind the flush beat. Deliberately not in `clearTimers`:
	 * a session stopping clears its own clocks, and must not quietly drop the
	 * write that was going to carry another project's morning to the vault.
	 */
	private untimedFlushHandle: unknown = null;
	/** When the oldest unfiled credit landed, for the flush ceiling. */
	private untimedDirtySince: number | null = null;
	private lastSnapshotAt = 0;
	private lastUntimedSnapshotAt = 0;
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
		const totals = tallyScopes(this.fileTallies(live.perFile, live.manuscript));
		const at = (scope: WritingSessionScope): SessionWordTotals => {
			const { added, deleted } = totals[scope];
			const start = live.start?.[scope] ?? 0;
			const net = added - deleted;
			return { start, end: start + net, added, deleted, net };
		};
		return { project: at("project"), manuscript: at("manuscript") };
	}

	/** Every note a sitting moved, each under the membership it has now. */
	private fileTallies(
		perFile: ReadonlyMap<string, FileTally>,
		manuscript: ReadonlySet<string>,
	): SessionFileTally[] {
		return [...perFile.entries()].map(([path, tally]) => ({
			path,
			added: tally.added,
			deleted: tally.deleted,
			net: tally.added - tally.deleted,
			manuscript: manuscript.has(path),
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
		// A stopping session is over: its clock must not be ticked while its
		// record is read out of the tracker, and the readings pick it up again
		// from the record the moment the stop lands.
		if (live === null || live.stopping) return null;
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
				// Checked here, where the queue landed, not where the call was
				// made: an auto start decided against silence may find a
				// manual sitting underway by the time its turn comes, and a
				// sitting the author started is never the machine's to replace.
				if (options.startMode === "auto") return;
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
				seedTexts: new Map(),
				rebase: new Set(),
				perFile: new Map(),
				stopping: false,
			};
			this.liveState = live;
			// The session owns this project's words now. The untimed day keeps
			// what it already credited and forgets everything in flight: its
			// baselines describe a world the session's own seed is about to
			// re-measure, and kept, the first edit after the stop would be
			// diffed against them and credit the whole session over again.
			const dormant = this.untimedStates.get(project.id);
			if (dormant !== undefined) {
				dormant.pending.clear();
				dormant.baseline.clear();
				dormant.vouched.clear();
				dormant.rebase.clear();
				dormant.reclassify.clear();
			}
			this.emit({ kind: "started" });
			try {
				await this.seedBaselines(live);
			} catch (error) {
				// A seed that cannot finish leaves no session standing: with
				// no tracker it would read as "starting" forever, refusing
				// every start while crediting nothing. Nothing was
				// snapshotted yet, so the recovery store is not ours to touch.
				if (this.liveState === live) {
					this.liveState = null;
					this.clearTimers();
					this.rearmForUntimedBacklog();
					this.emit({ kind: "changed", counted: false });
				}
				throw error;
			}
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
			this.emit({ kind: "changed", counted: false });
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
		const live = this.liveState;
		if (live?.startMode !== "auto") return Promise.resolve();
		// The sitting it means to stop is named now and checked again where
		// the queue lands: by then that one may already be gone, and whatever
		// replaced it is not a focus-mode exit's to end.
		const id = live.id;
		return this.enqueue(async () => {
			if (this.liveState?.id !== id) return;
			await this.finishLive(reason, null);
		});
	}

	pause(): void {
		const live = this.liveState;
		if (live?.tracker == null || live.stopping) return;
		this.applyEffects(live, live.tracker.pause(this.now()));
		const credited = this.freezeSession(live);
		this.snapshot(live);
		this.emit({ kind: "changed", counted: credited });
	}

	resume(): void {
		const live = this.liveState;
		if (live?.tracker == null || live.stopping) return;
		this.applyEffects(live, live.tracker.resume(this.now()));
		const credited = this.reclaimFromUntimed(live);
		this.snapshot(live);
		this.emit({ kind: "changed", counted: credited });
	}

	setWritingMode(mode: WritingMode): void {
		const live = this.liveState;
		if (live === null || live.stopping) return;
		live.writingMode = mode;
		this.snapshot(live);
		this.emit({ kind: "changed", counted: false });
	}

	/**
	 * Meaningful editing on a writing surface: an editor transaction, a
	 * stream keystroke, or typing in one of this plugin's own fields. `path`
	 * is any path inside the project the writing belongs to -- the note an
	 * editor holds, or the project a form was opened over -- and a report
	 * that can name none belongs to no session and is dropped.
	 *
	 * Time only, and time for the whole project, so a strict session survives
	 * a detour through a character's notes. What was written is not a
	 * question a surface can answer: text in a form has not reached the
	 * project, and a form the author cancels never will. Words arrive through
	 * `noteChanged`, when they are persisted.
	 */
	surfaceActivity(path: string | null): void {
		const live = this.liveState;
		// `stopping` ends the observing, not only the clock: the record is
		// being read out of the tracker, and one more event would write a
		// second, overlapping close of the same open stretch into it.
		if (live?.tracker == null || live.stopping) return;
		if (path === null || !this.inActivityScope(live, path)) return;
		this.applyEffects(live, live.tracker.activity(this.now()));
	}

	/**
	 * An editor changed `path`; `content` hands back the editor's own text,
	 * resolved lazily at the debounce so a burst of keystrokes never
	 * materializes the note once per key. Without it the disk is read at the
	 * drain. This is a crediting feed and editors are the only callers:
	 * vault-level writes arrive as `noteWrittenExternally`, and the plugin's
	 * own saves as `notePersistedByPlugin`.
	 */
	noteChanged(path: string, content?: NoteTextProvider): void {
		const live = this.liveState;
		if (live !== null && !live.stopping && this.worthReading(live, path)) {
			if (live.tracker?.currentPhase() !== "paused") {
				live.pending.set(path, content);
				this.armDebounce();
				return;
			}
			// The clock is frozen, but typed words must land somewhere: the
			// path falls through to the untimed day below, and is remembered
			// here so the thaw can re-measure the session against whatever
			// that ledger settled through the pause.
			live.dirtyWhilePaused.set(path, content);
		}
		const state = this.untimedFor(path);
		if (state === null) return;
		const entry = state.pending.get(path) ?? {};
		entry.content = content;
		state.pending.set(path, entry);
		this.armDebounce();
	}

	/**
	 * A note was created. Bookkeeping only: the stale "outside" verdict goes,
	 * and nothing is credited, because a `create` event cannot say who made the
	 * file -- a note sync carried in arrives the same way, content and all, and
	 * counting it would credit another device's writing to this one. A note the
	 * author types into is fully credited at its first editor event through the
	 * empty baseline it starts from; one a form of this plugin created arrives
	 * through the repository's own write feed instead.
	 */
	noteCreated(path: string): void {
		const live = this.liveState;
		if (live !== null && !live.stopping && this.worthReading(live, path)) {
			live.outside.delete(path);
			if (live.tracker?.currentPhase() !== "paused") return;
		}
		this.untimedFor(path)?.outside.delete(path);
	}

	/**
	 * A vault write by somebody else's hand: sync, a script, another plugin.
	 * Never credited -- the words are not this device's writing -- but never
	 * ignored either, because a baseline left stale would hand the foreign
	 * delta to the next keystroke. The note re-baselines silently instead,
	 * except where the write is really an editor's own save echo: a note with
	 * an editor feed in flight, or open in one, is the editor's to settle, and
	 * a rebase here would swallow what was typed since the last drain.
	 */
	noteWrittenExternally(path: string): void {
		const live = this.liveState;
		if (live !== null && !live.stopping && this.worthReading(live, path)) {
			if (live.tracker?.currentPhase() !== "paused") {
				if (live.pending.has(path) || live.dirtyWhilePaused.has(path)) {
					return;
				}
				if (this.deps.isNoteOpen(path)) return;
				live.rebase.add(path);
				this.armDebounce();
				return;
			}
			// Frozen: the untimed day below is the one measuring, and the
			// session's own baseline goes stale under this write -- marked so
			// the thaw re-settles it, with any typed text already remembered
			// kept as the better answer.
			if (!live.dirtyWhilePaused.has(path)) {
				live.dirtyWhilePaused.set(path, undefined);
			}
		}
		const state = this.untimedFor(path);
		if (state === null) return;
		if (state.pending.has(path)) return;
		if (this.deps.isNoteOpen(path)) return;
		state.rebase.add(path);
		this.armDebounce();
	}

	/**
	 * This plugin saved a note -- a form submitted, a step panel's fields, a
	 * stream segment persisted -- with the content it replaced and the content
	 * it wrote both in hand. `userInput` says a person typed this, and only
	 * then is the change credited: the delta rides the ordinary drain against
	 * the note's baseline, seeded from `before` where there is none yet, so
	 * the save is credited with what it changed and nothing more. The ledgers
	 * measure whole text, rendered blocks included, which is what makes a
	 * form's field count and makes creating a note and deleting it weigh the
	 * same. A mechanical rewrite -- a reconcile, a migration, a repair --
	 * says false and is treated exactly like a stranger's write: it can
	 * re-render whatever it likes, and the note only re-baselines under it.
	 */
	notePersistedByPlugin(
		path: string,
		before: string,
		after: string,
		userInput: boolean,
	): void {
		if (!userInput) {
			this.noteWrittenExternally(path);
			return;
		}
		const live = this.liveState;
		if (live !== null && !live.stopping && this.worthReading(live, path)) {
			if (live.tracker?.currentPhase() !== "paused") {
				// A queued rebase is superseded: the save's own before-text
				// says exactly where the disk stood, so the baseline settles
				// from it and the pending delta credits only what this save
				// changed. Left queued, the drain would run the rebase first,
				// read a disk that already holds the after-text, and credit
				// the typed words as nothing.
				if (live.rebase.delete(path) && live.baseline.has(path)) {
					const opening = this.totalFromText(live.options, before);
					if (opening !== null) live.baseline.set(path, opening);
					else live.rebase.add(path);
				}
				if (!live.baseline.has(path) && !live.seedTexts.has(path)) {
					live.seedTexts.set(path, before);
				}
				live.pending.set(path, () => after);
				this.armDebounce();
				return;
			}
			// Frozen: the save's words fall to the untimed day below, and the
			// after-text is the freshest answer the thaw can re-measure by.
			live.dirtyWhilePaused.set(path, () => after);
		}
		const state = this.untimedFor(path);
		if (state === null) return;
		if (state.rebase.delete(path) && state.baseline.has(path)) {
			const opening = this.totalFromText(state.options, before);
			if (opening !== null) state.baseline.set(path, opening);
			else state.rebase.add(path);
		}
		const entry = state.pending.get(path) ?? {};
		entry.content = () => after;
		if (!state.baseline.has(path) && entry.seedText === undefined) {
			entry.seedText = before;
		}
		state.pending.set(path, entry);
		this.armDebounce();
	}

	/**
	 * This plugin removed a note whose content it held -- a manuscript merge
	 * absorbing a segment into its neighbor -- so the removal is credited
	 * from that content rather than guessed: the vault's delete event cannot
	 * say what the note contained, and a note nobody edited today has no
	 * baseline to answer with. Without this, a merge outside a session would
	 * credit the absorbed text as new words while the removal credited
	 * nothing. A live session needs no report here: its baselines were
	 * seeded at the start, and the delete event settles it. The cleared
	 * queues and baseline keep the delete event that follows from crediting
	 * the same removal twice.
	 *
	 * `manuscript` says which readings the removal belongs to, because a note
	 * on its way out cannot be asked: its scopes are read from what it
	 * declares, and by the time anything could look the file is gone. Without
	 * it the removal would be filed outside the manuscript while the writing
	 * it cancels was filed inside, and a merge would still inflate the one
	 * reading it is about.
	 */
	noteRemovedByPlugin(
		path: string,
		body: string,
		{ manuscript }: { manuscript: boolean },
	): void {
		const state = this.untimedFor(path);
		if (state === null) return;
		const total = this.totalFromText(state.options, body);
		const base = state.baseline.get(path) ?? total;
		state.baseline.delete(path);
		state.vouched.delete(path);
		state.pending.delete(path);
		state.rebase.delete(path);
		if (base === null || base <= 0) return;
		if (manuscript) state.manuscript.add(path);
		else state.manuscript.delete(path);
		this.creditTally(state.perFile, path, -base);
		this.markUntimedDirty(state);
		this.maybeSnapshotUntimed();
		this.emit({ kind: "changed", counted: true });
	}

	/**
	 * The tracking setting moved. Turning it off files every accruing day and
	 * lets the states go; what was already recorded stays part of every
	 * reading, because a switch stops the recorder, not the archive. Turning
	 * it on needs nothing here -- capture resumes on the next event, and the
	 * hydrate folds a day filed at the switch-off back in.
	 */
	untimedTrackingChanged(): Promise<void> {
		if (this.deps.trackUntimed()) return Promise.resolve();
		return this.enqueue(async () => {
			for (const state of this.untimedStates.values()) {
				const record = this.finalizeUntimed(state);
				if (record !== null) this.queueUntimedFlush(state, record);
			}
			this.untimedStates.clear();
			this.untimedDirtySince = null;
			await this.flushUnflushed();
			this.snapshotUntimed();
			this.emit({ kind: "changed", counted: true });
		});
	}

	/**
	 * A note, or a folder of them, went away. The project really did lose
	 * those words, so the last count seen for each is credited to deleted.
	 * The per-file history stays: what happened in the note happened, and the
	 * record should say how it ended.
	 */
	noteDeleted(path: string, { children = false } = {}): void {
		const live = this.liveState;
		if (live !== null && !live.stopping) {
			this.liveNoteDeleted(live, path, children);
		}
		let moved = false;
		let evicted = false;
		for (const [projectId, state] of [...this.untimedStates]) {
			// The project itself may be what went. Its day has nowhere to
			// file -- the folder that would hold the record went with it --
			// so the state and anything queued for it are let go, rather
			// than left to a flush that would resurrect the folder skeleton
			// of a deleted project.
			if (children && isPathAtOrBelow(state.rootPath, path)) {
				this.untimedStates.delete(projectId);
				for (const [key, flush] of [...this.unflushed]) {
					if (flush.projectId === projectId) this.unflushed.delete(key);
				}
				evicted = true;
				continue;
			}
			// The live session's own project settles deletions through the
			// session ledger; crediting them here too would subtract the
			// same note from both.
			if (this.sessionOwns(state.projectId)) continue;
			if (this.untimedNoteDeleted(state, path, children)) {
				this.markUntimedDirty(state);
				moved = true;
			}
		}
		if (evicted) this.snapshotUntimed();
		else if (moved) this.maybeSnapshotUntimed();
		if (moved || evicted) this.emit({ kind: "changed", counted: true });
	}

	private liveNoteDeleted(
		live: LiveState,
		path: string,
		children: boolean,
	): void {
		const prefix = `${path}/`;
		const gone = [...live.baseline.keys()].filter(
			(key) => key === path || (children && key.startsWith(prefix)),
		);
		let credited = false;
		for (const key of gone) {
			credited = this.creditRemoval(live, key) || credited;
		}
		for (const map of [
			live.baseline,
			live.pending,
			live.dirtyWhilePaused,
			live.seedTexts,
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
		live.rebase.delete(path);
		if (children) {
			for (const set of [
				live.outside,
				live.reclassify,
				live.rebase,
			] as const) {
				for (const key of [...set]) {
					if (key.startsWith(prefix)) set.delete(key);
				}
			}
		}
		if (gone.length > 0) {
			this.maybeSnapshot(live);
			this.emit({ kind: "changed", counted: credited });
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
		if (live !== null && !live.stopping) {
			this.liveRenamed(live, oldPath, newPath);
		}
		for (const state of this.untimedStates.values()) {
			this.untimedRenamed(state, oldPath, newPath);
		}
	}

	private liveRenamed(
		live: LiveState,
		oldPath: string,
		newPath: string,
	): void {
		// The project itself may be what moved. A session holds its ref for
		// its whole life, so a rename of the root -- or of a folder above it
		// -- rebinds the ref before any note is judged against it: judged
		// against the old root, every note would read as having left the
		// project, and the whole count would be credited as deleted.
		const shifted = (path: string): string =>
			path === oldPath ? newPath : `${newPath}${path.slice(oldPath.length)}`;
		if (isPathAtOrBelow(live.project.rootPath, oldPath)) {
			live.project = {
				...live.project,
				rootPath: shifted(live.project.rootPath),
				projectFile: isPathAtOrBelow(live.project.projectFile, oldPath)
					? shifted(live.project.projectFile)
					: live.project.projectFile,
			};
		} else if (live.project.projectFile === oldPath) {
			// The project note alone can move too, and the panels filter the
			// running session by it.
			live.project = { ...live.project, projectFile: newPath };
		}
		this.shiftTrackedPaths(
			oldPath,
			newPath,
			[
				live.baseline,
				live.pending,
				live.dirtyWhilePaused,
				live.seedTexts,
				live.perFile,
			],
			live,
		);
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

	/**
	 * Moves every tracked key from under `oldPath` to its new home: the maps
	 * a ledger keys by, and the membership sets beside them. One
	 * implementation for the session and the untimed day, so a rename can
	 * never be handled differently by the two. Returns how many keys moved.
	 */
	private shiftTrackedPaths(
		oldPath: string,
		newPath: string,
		maps: readonly Map<string, unknown>[],
		membership: {
			manuscript: Set<string>;
			rebase: Set<string>;
			outside: Set<string>;
			reclassify: Set<string>;
			vouched?: Set<string>;
		},
	): number {
		const shifted = (path: string): string =>
			path === oldPath ? newPath : `${newPath}${path.slice(oldPath.length)}`;
		const prefix = `${oldPath}/`;
		const carried = [
			membership.manuscript,
			membership.rebase,
			...(membership.vouched === undefined ? [] : [membership.vouched]),
		];
		const keys = new Set<string>();
		for (const map of maps) {
			for (const key of map.keys()) {
				if (key === oldPath || key.startsWith(prefix)) keys.add(key);
			}
		}
		for (const set of carried) {
			for (const key of set) {
				if (key === oldPath || key.startsWith(prefix)) keys.add(key);
			}
		}
		for (const key of keys) {
			const destination = shifted(key);
			for (const map of maps) moveKey(map, key, destination);
			for (const set of carried) {
				if (set.delete(key)) set.add(destination);
			}
			membership.outside.delete(key);
			membership.reclassify.add(destination);
		}
		return keys.size;
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
	 * Whether the live session is the one recording this project's words
	 * right now. A paused session is not: its clock is frozen and it credits
	 * nothing, so the project's words fall to the untimed day until the thaw
	 * -- typed words must land somewhere, and paused must not mean uncounted.
	 * A session still starting or already stopping owns its boundary, as it
	 * always has.
	 */
	private sessionOwns(projectId: string): boolean {
		const live = this.liveState;
		if (live === null || live.project.id !== projectId) return false;
		if (live.stopping || live.tracker === null) return true;
		return live.tracker.currentPhase() !== "paused";
	}

	/**
	 * The untimed day a path's words belong to right now, or null: tracking
	 * off, a note no project owns, or a project whose words the live session
	 * is recording. Reaching the state rolls it over first, so a day is
	 * never written across midnight.
	 */
	private untimedFor(path: string): UntimedState | null {
		if (!this.deps.trackUntimed()) return null;
		if (!path.endsWith(".md")) return null;
		const ref = this.deps.projectAtPath(path);
		if (ref === null) return null;
		if (this.sessionOwns(ref.id)) return null;
		return this.ensureUntimedState(ref);
	}

	/** The project's untimed state, made fresh where none exists yet. */
	private ensureUntimedState(ref: ProjectRef): UntimedState {
		let state = this.untimedStates.get(ref.id);
		if (state === undefined) {
			const timezone = this.timezone();
			state = {
				projectId: ref.id,
				rootPath: ref.rootPath,
				sessionsDir: getProjectPathLayout(ref.locale).directories
					.writingSessions,
				timezone,
				day: calendarDay(this.now(), timezone),
				options: this.deps.countOptions(),
				ref,
				hydrated: false,
				dirty: false,
				baseline: new Map(),
				vouched: new Set(),
				manuscript: new Set(),
				outside: new Set(),
				reclassify: new Set(),
				pending: new Map(),
				rebase: new Set(),
				perFile: new Map(),
			};
			this.untimedStates.set(ref.id, state);
		}
		state.ref = ref;
		state.rootPath = ref.rootPath;
		this.rolloverIfNeeded(state);
		return state;
	}

	/**
	 * The clock froze: the session settles what it already had in hand, and
	 * the untimed day takes the project over.
	 *
	 * Settling first is what keeps the boundary honest. A keystroke queued
	 * before the freeze is the session's word, and its text provider answers
	 * with the editor's text as it stands *now* -- so left queued, the next
	 * drain would credit the session with everything typed through the pause
	 * as well, while the untimed day credited the same words against the
	 * baseline it was lent. Settled here, each ledger holds exactly its own.
	 *
	 * The untimed day then borrows the session's baselines -- copies, because
	 * the session keeps its own to come back to -- so the first paused
	 * keystroke is measured against the session's last credit rather than a
	 * disk the autosave may not have reached. Nothing is lent when tracking
	 * is off: with no untimed day to lend to, paused words stay unrecorded,
	 * as they always were.
	 */
	private freezeSession(live: LiveState): boolean {
		const credited = this.settleSessionPending(live);
		if (!this.deps.trackUntimed()) return credited;
		const state = this.ensureUntimedState(live.project);
		this.adoptSessionMemberships(state, live);
		// Two conventions never share a baseline: measured under one rule and
		// diffed under the other, the difference would read as writing.
		if (sameCounting(state.options, live.options)) {
			state.baseline = new Map(live.baseline);
			state.vouched = new Set(live.baseline.keys());
		}
		// Whatever would not settle -- a note born in the last beat, with no
		// baseline to measure against -- goes to the day that is now keeping
		// the project's words, rather than waiting on a drain that would
		// credit it against the wrong ledger.
		for (const [path, content] of live.pending) {
			const entry = state.pending.get(path) ?? {};
			entry.content = content;
			state.pending.set(path, entry);
		}
		live.pending.clear();
		if (state.pending.size > 0) this.armDebounce();
		return credited;
	}

	/**
	 * Credits every queued session change the service can measure without
	 * touching the disk: the note's baseline is known and its text is one an
	 * editor can still answer for. Anything else stays queued for its caller
	 * to place. Used where a drain cannot be awaited -- the freeze of a pause
	 * -- so that the words already typed belong to the clock that was running
	 * when they were typed.
	 */
	private settleSessionPending(live: LiveState): boolean {
		let credited = false;
		for (const [path, content] of [...live.pending]) {
			const base = live.baseline.get(path);
			if (base === undefined) continue;
			const text = resolveText(content);
			if (text === undefined) continue;
			const total = this.totalFromText(live.options, text);
			if (total === null) continue;
			live.pending.delete(path);
			live.baseline.set(path, total);
			if (total === base) continue;
			this.creditTally(live.perFile, path, total - base);
			credited = true;
		}
		return credited;
	}

	/**
	 * Hands the session's reading of the project's notes to an untimed day:
	 * which notes hold the manuscript's writing, and which hold nobody's.
	 *
	 * Merged rather than assigned, and only for the notes the session can
	 * answer for. A deleted note keeps both its tally and the membership that
	 * tally is filed under -- the session cannot know it, having seeded from
	 * the notes that exist -- and assigning the session's sets wholesale
	 * would drop that membership and quietly move a vanished note's words out
	 * of the manuscript's reading.
	 */
	private adoptSessionMemberships(state: UntimedState, live: LiveState): void {
		for (const path of live.baseline.keys()) {
			if (live.manuscript.has(path)) state.manuscript.add(path);
			else state.manuscript.delete(path);
			state.outside.delete(path);
		}
		for (const path of live.outside) state.outside.add(path);
	}

	/**
	 * The thaw: the session takes the project back. A path touched through
	 * the pause re-baselines at the untimed ledger's last settled count, so
	 * nothing typed through it is credited twice -- anything still on that
	 * ledger's queues at this moment is the boundary's, exactly as at a
	 * session start. A path the ledger never settled falls back to the text
	 * the editor can answer for, credited nowhere.
	 */
	private reclaimFromUntimed(live: LiveState): boolean {
		const dormant = this.untimedStates.get(live.project.id);
		// Everything the untimed day can still settle is credited to it
		// before the session reads its counts back. Cleared unsettled, the
		// words typed in the last beat before the thaw would be credited by
		// neither ledger: the day drops the queue, and the session comes back
		// re-baselined at text that already holds them.
		const credited =
			dormant === undefined ? false : this.settleUntimedPending(dormant);
		const lendable =
			dormant !== undefined && sameCounting(dormant.options, live.options);
		for (const [path, content] of live.dirtyWhilePaused) {
			// Trusted only where the untimed drain really settled the path: a
			// change still on its queues never advanced the lent copy, and
			// re-baselining the session at that stale count would credit the
			// unprocessed change -- an external write among them -- to the
			// next keystroke.
			const settled =
				lendable &&
				!dormant.pending.has(path) &&
				!dormant.rebase.has(path)
					? dormant.baseline.get(path)
					: undefined;
			if (settled !== undefined) {
				live.baseline.set(path, settled);
				continue;
			}
			const text = resolveText(content);
			const total =
				text === undefined
					? null
					: this.totalFromText(live.options, text);
			if (total !== null) live.baseline.set(path, total);
			else live.rebase.add(path);
		}
		live.dirtyWhilePaused.clear();
		if (dormant !== undefined) {
			dormant.pending.clear();
			dormant.baseline.clear();
			dormant.vouched.clear();
			dormant.rebase.clear();
			dormant.reclassify.clear();
		}
		if (live.rebase.size > 0) this.armDebounce();
		if (credited) this.maybeSnapshotUntimed();
		return credited;
	}

	/**
	 * Closes the day a state was accruing once the calendar has moved on: the
	 * finished record queues for its file, and the state starts the new day
	 * with its baselines kept -- they describe the notes, not the day.
	 */
	private rolloverIfNeeded(state: UntimedState): void {
		const today = calendarDay(this.now(), state.timezone);
		if (today === state.day) return;
		const record = this.finalizeUntimed(state);
		state.day = today;
		state.perFile = new Map();
		// The queued rebases and reclassifies survive the midnight: each
		// measures and credits nothing whichever day it runs in, and one
		// cleared here would leave its baseline stale -- the foreign delta it
		// was queued to absorb would be credited to the new day's first
		// keystroke.
		//
		// A fresh day has no earlier record on disk to fold back in, and
		// nothing yet for the flush beat to carry.
		state.hydrated = true;
		state.dirty = false;
		// The counting convention re-freezes with the day, as the contract
		// says. When it really moved, the baselines go with it: they were
		// measured under the old rule, and the notes re-seed from the disk
		// under the new one, crediting nothing.
		const fresh = this.deps.countOptions();
		if (!sameCounting(fresh, state.options)) {
			state.options = fresh;
			state.baseline.clear();
			state.vouched.clear();
		}
		if (record === null) return;
		this.queueUntimedFlush(state, record);
		void this.enqueue(async () => {
			await this.flushUnflushed();
			this.snapshotUntimed();
		});
	}

	/** The day's record as it stands, or null when nothing was credited. */
	private finalizeUntimed(state: UntimedState): UntimedDayRecord | null {
		if (state.perFile.size === 0) return null;
		return this.untimedRecord(state.day, state.timezone, {
			countMode: state.options.mode,
			countHeadings: state.options.headings,
			files: this.untimedFileTallies(state),
		});
	}

	/** One day's record from its tallies, stamped as of this moment. */
	private untimedRecord(
		day: string,
		timezone: string,
		body: {
			countMode?: string;
			countHeadings?: string;
			files: UntimedFileTally[];
		},
	): UntimedDayRecord {
		return {
			id: untimedDayId(this.deps.deviceId(), day),
			day,
			timezone,
			// The reading is true of this moment; the day keeps accruing.
			updatedAt: new Date(this.now()).toISOString(),
			...(body.countMode === undefined
				? {}
				: { countMode: body.countMode }),
			...(body.countHeadings === undefined
				? {}
				: { countHeadings: body.countHeadings }),
			words: untimedWordsFromFiles(body.files),
			files: body.files,
		};
	}

	/**
	 * The day's tallies with each note's standing count riding along, so
	 * every copy of the ledger -- the vault file and the snapshot alike --
	 * carries what a deletion would credit.
	 */
	private untimedFileTallies(state: UntimedState): UntimedFileTally[] {
		return this.fileTallies(state.perFile, state.manuscript).map((tally) => {
			const standing = state.baseline.get(tally.path);
			return standing === undefined ? tally : { ...tally, standing };
		});
	}

	private async drainUntimed(state: UntimedState): Promise<void> {
		this.rolloverIfNeeded(state);
		// A session that started while this drain waited owns the project now
		// -- start() already dropped the state's pending work -- and a state
		// detached while it waited (the tracking toggled off) must not be
		// credited into: its day was already filed without these, and words
		// landed in it would reach neither the vault nor the snapshot.
		if (this.sessionOwns(state.projectId)) return;
		if (this.untimedStates.get(state.projectId) !== state) return;
		const ref = state.ref;
		if (ref === null) return;
		if (!state.hydrated) {
			try {
				await this.hydrateUntimed(state);
			} catch {
				// The flag is still false, so the next drain tries again --
				// and there will be one, because the queued work is untouched.
				this.armDebounce();
				return;
			}
			if (this.untimedStates.get(state.projectId) !== state) return;
		}
		let moved = false;
		while (
			state.reclassify.size > 0 ||
			state.rebase.size > 0 ||
			state.pending.size > 0
		) {
			for (const path of [...state.reclassify]) {
				state.reclassify.delete(path);
				moved = (await this.reclassifyUntimed(state, ref, path)) || moved;
				if (this.untimedStates.get(state.projectId) !== state) return;
			}
			for (const path of [...state.rebase]) {
				state.rebase.delete(path);
				if (!(await this.untimedMember(state, ref, path))) continue;
				const count = await this.deps.writingCount.countNoteWhole(
					path,
					state.options,
				);
				if (this.untimedStates.get(state.projectId) !== state) return;
				if (count !== null) state.baseline.set(path, count.total);
			}
			const entries = [...state.pending];
			state.pending.clear();
			for (const [path, entry] of entries) {
				if (this.sessionOwns(state.projectId)) return;
				if (this.untimedStates.get(state.projectId) !== state) return;
				moved =
					(await this.applyUntimedPending(state, ref, path, entry)) ||
					moved;
			}
		}
		if (!moved) return;
		this.markUntimedDirty(state);
		this.emit({ kind: "changed", counted: true });
	}

	/**
	 * One queued untimed change: membership, then the baseline -- from the
	 * text a plugin save replaced when one was carried, else from the disk,
	 * which the editor's autosave lag usually still has as it stood before
	 * the first keystroke -- then the delta. Never from nothing: a baseline
	 * of zero here would credit a note's whole standing text to today.
	 */
	private async applyUntimedPending(
		state: UntimedState,
		ref: ProjectRef,
		path: string,
		entry: UntimedPending,
	): Promise<boolean> {
		const hadBaseline = state.baseline.has(path);
		if (!(await this.untimedMember(state, ref, path))) return false;
		if (!hadBaseline) {
			const fromSeed =
				entry.seedText === undefined
					? null
					: this.totalFromText(state.options, entry.seedText);
			const opening =
				fromSeed ??
				(await this.deps.writingCount.countNoteWhole(
					path,
					state.options,
				))?.total ??
				0;
			state.baseline.set(path, opening);
		}
		const total = await this.currentTotal(
			state.options,
			path,
			resolveText(entry.content),
		);
		if (total === null) return false;
		// Detached while the count was awaited: credited here, the words
		// would land in a ledger nothing flushes or snapshots any more.
		if (this.untimedStates.get(state.projectId) !== state) return false;
		const base = state.baseline.get(path) ?? 0;
		state.baseline.set(path, total);
		if (base === total) return false;
		this.creditTally(state.perFile, path, total - base);
		// Counted in on this device: a later deletion may count it out, on
		// any day this baseline survives to.
		state.vouched.add(path);
		return true;
	}

	/** `member()`'s untimed twin; the baseline is the caller's to seed. */
	private async untimedMember(
		state: UntimedState,
		ref: ProjectRef,
		path: string,
	): Promise<boolean> {
		if (state.baseline.has(path)) return true;
		if (state.outside.has(path)) return false;
		const scopes = await this.deps.writingCount.scopesOf(ref, path);
		if (scopes.length === 0) {
			state.outside.add(path);
			return false;
		}
		if (scopes.includes("manuscript")) state.manuscript.add(path);
		else state.manuscript.delete(path);
		return true;
	}

	/** Where a moved note belongs now, mirrored from `reclassifyPath`. */
	private async reclassifyUntimed(
		state: UntimedState,
		ref: ProjectRef,
		path: string,
	): Promise<boolean> {
		const scopes = await this.deps.writingCount.scopesOf(ref, path);
		if (scopes.length > 0) {
			state.outside.delete(path);
			if (scopes.includes("manuscript")) state.manuscript.add(path);
			else state.manuscript.delete(path);
			return false;
		}
		// Out of the project altogether: the words went with it, credited as
		// gone only where this device counted them in -- the day's own
		// tallies, or a baseline a session vouched for.
		const base = state.baseline.get(path);
		let moved = false;
		if (
			base !== undefined &&
			base > 0 &&
			(state.perFile.has(path) || state.vouched.has(path))
		) {
			this.creditTally(state.perFile, path, -base);
			moved = true;
		}
		state.baseline.delete(path);
		state.vouched.delete(path);
		state.pending.delete(path);
		state.rebase.delete(path);
		state.outside.add(path);
		return moved;
	}

	/**
	 * The untimed half of a deletion. A note the day tallied credits its
	 * standing count -- the baseline where one survives, its own net at
	 * least -- and so does one whose baseline a session vouched for at its
	 * stop or pause: a note deleted right after a sitting still credits what
	 * it held. A note known only through an external write credits nothing,
	 * and the bookkeeping goes either way.
	 */
	private untimedNoteDeleted(
		state: UntimedState,
		path: string,
		children: boolean,
	): boolean {
		// Everything a state tracks lives under its root, so a path relating
		// to neither the root nor anything above it cannot match a key --
		// answered without walking maps a session hand-off may have grown to
		// the whole project.
		if (
			!isPathAtOrBelow(path, state.rootPath) &&
			!isPathAtOrBelow(state.rootPath, path)
		) {
			return false;
		}
		// The deletion credits into the day it happens in, never yesterday's.
		this.rolloverIfNeeded(state);
		const prefix = `${path}/`;
		const gone = [
			...new Set([...state.baseline.keys(), ...state.perFile.keys()]),
		].filter((key) => key === path || (children && key.startsWith(prefix)));
		let moved = false;
		for (const key of gone) {
			const tally = state.perFile.get(key);
			// Only words counted in on this device may be counted out: a note
			// the day tallied, or one whose baseline a session vouched for. A
			// baseline seeded from an external write stays out -- its words
			// are another device's story, told in that device's records.
			if (tally === undefined && !state.vouched.has(key)) continue;
			// The standing count is what the note took with it. A baseline
			// lost to a relaunch still owes the day at least what the day
			// itself put in -- the note held no less than its own net.
			const base =
				state.baseline.get(key) ??
				(tally === undefined
					? 0
					: Math.max(0, tally.added - tally.deleted));
			if (base > 0) {
				this.creditTally(state.perFile, key, -base);
				moved = true;
			}
		}
		for (const map of [state.baseline, state.pending] as const) {
			map.delete(path);
			if (!children) continue;
			for (const key of [...map.keys()]) {
				if (key.startsWith(prefix)) map.delete(key);
			}
		}
		for (const set of [
			state.outside,
			state.reclassify,
			state.rebase,
			state.vouched,
		] as const) {
			set.delete(path);
			if (!children) continue;
			for (const key of [...set]) {
				if (key.startsWith(prefix)) set.delete(key);
			}
		}
		return moved;
	}

	/** The untimed half of a rename, sharing the session's key shifting. */
	private untimedRenamed(
		state: UntimedState,
		oldPath: string,
		newPath: string,
	): void {
		// Tracked keys live under the root, so a rename relating to neither
		// the root nor anything above it moves nothing here.
		if (
			!isPathAtOrBelow(oldPath, state.rootPath) &&
			!isPathAtOrBelow(state.rootPath, oldPath)
		) {
			return;
		}
		this.rolloverIfNeeded(state);
		const shifted = (path: string): string =>
			path === oldPath ? newPath : `${newPath}${path.slice(oldPath.length)}`;
		if (isPathAtOrBelow(state.rootPath, oldPath)) {
			state.rootPath = shifted(state.rootPath);
			if (state.ref !== null) {
				state.ref = {
					...state.ref,
					rootPath: state.rootPath,
					projectFile: isPathAtOrBelow(state.ref.projectFile, oldPath)
						? shifted(state.ref.projectFile)
						: state.ref.projectFile,
				};
			}
		} else if (state.ref?.projectFile === oldPath) {
			state.ref = { ...state.ref, projectFile: newPath };
		}
		const moved = this.shiftTrackedPaths(
			oldPath,
			newPath,
			[state.baseline, state.pending, state.perFile],
			state,
		);
		if (moved > 0) this.armDebounce();
	}

	/**
	 * Folds the day's own record back into a state that started cold -- the
	 * setting toggled off and on again, or a plain plugin reload -- so the
	 * next upsert writes the whole day rather than clobbering its morning.
	 * One copy only: an unfiled flush is the same accruing ledger the disk
	 * copy trails, so where one waits it supersedes the file, and folding
	 * both would double their overlap. The hydrated flag commits after the
	 * work, never before it, so a read that fails is retried by the next
	 * drain instead of the day's earlier credits being replaced away.
	 */
	private async hydrateUntimed(state: UntimedState): Promise<void> {
		const id = untimedDayId(this.deps.deviceId(), state.day);
		const flushKey = untimedFlushKey(state.projectId, id);
		const unfiled = this.unflushed.get(flushKey);
		if (unfiled !== undefined) {
			this.unflushed.delete(flushKey);
			this.foldTallies(state, unfiled.record.files, unfiled.record);
			state.hydrated = true;
			return;
		}
		const path = untimedFilePath(
			state.rootPath,
			state.sessionsDir,
			state.day,
			this.deps.deviceId(),
		);
		const file = this.deps.repository.getFile(path);
		if (file !== null) {
			const parsed = await this.readUntimedFile(file);
			const kept = parsed?.days.find((day) => day.id === id);
			if (kept !== undefined) this.foldTallies(state, kept.files, kept);
		}
		state.hydrated = true;
	}

	/**
	 * Adds a stored copy's tallies into the accruing day. The standing counts
	 * ride back into the baselines only where the copy was measured under the
	 * state's own convention and the state has no fresher answer -- a count
	 * taken under another rule reads as writing the moment it is diffed.
	 */
	private foldTallies(
		state: UntimedState,
		files: readonly UntimedFileTally[],
		measuredUnder: { countMode?: string; countHeadings?: string },
	): void {
		const adoptStanding =
			measuredUnder.countMode === state.options.mode &&
			measuredUnder.countHeadings === state.options.headings;
		for (const tally of files) {
			const entry = state.perFile.get(tally.path) ?? {
				added: 0,
				deleted: 0,
			};
			entry.added += tally.added;
			entry.deleted += tally.deleted;
			state.perFile.set(tally.path, entry);
			if (tally.manuscript) state.manuscript.add(tally.path);
			if (
				adoptStanding &&
				tally.standing !== undefined &&
				!state.baseline.has(tally.path)
			) {
				state.baseline.set(tally.path, tally.standing);
			}
		}
	}

	/** One untimed file, parsed once per on-disk state, like the months. */
	private readUntimedFile(file: {
		path: string;
		stat: { mtime: number; size: number };
	}): Promise<UntimedMonthFile | null> {
		return this.readStamped(this.untimedMemo, file, parseUntimedJson);
	}

	/**
	 * One JSON file parsed once per on-disk state: the stamp is the file's
	 * stat, the memo is the caller's, and anything that rewrites a file moves
	 * its stat and misses here. One protocol for both record kinds, so a
	 * change to the stamping can never reach one memo and miss the other.
	 */
	private async readStamped<T>(
		memo: Map<string, { stamp: string; file: T | null }>,
		file: { path: string; stat: { mtime: number; size: number } },
		parse: (content: string | null) => T | null,
	): Promise<T | null> {
		const stamp = `${String(file.stat.mtime)}:${String(file.stat.size)}`;
		const kept = memo.get(file.path);
		if (kept !== undefined && kept.stamp === stamp) return kept.file;
		const parsed = parse(await this.deps.repository.readPlainFile(file.path));
		memo.set(file.path, { stamp, file: parsed });
		return parsed;
	}

	/**
	 * Every stored untimed day filed in the months `from` to `through`, merged
	 * by id across the devices that recorded them, exactly as the sessions
	 * are gathered.
	 */
	private gatherUntimedDays(
		project: ProjectRef,
		from: string,
		through: string,
	): Promise<Map<string, UntimedDayRecord>> {
		return this.gatherMonthly(project, from, through, UNTIMED_FILE_SUFFIX, async (file) => (await this.readUntimedFile(file))?.days ?? null);
	}

	/**
	 * Every record of one kind filed in the months `from` to `through`,
	 * merged by id across devices. A file is named for the month its own
	 * device was in when it wrote; this reader's months can sit a calendar
	 * day either side of that at a zone's edge, so the walk opens one month
	 * more on each side and lets the day buckets do the filtering -- two
	 * small files against a record silently missing from the day it is
	 * shown on.
	 */
	private async gatherMonthly<T extends { id: string }>(
		project: ProjectRef,
		from: string,
		through: string,
		suffix: string,
		read: (file: {
			path: string;
			name: string;
			stat: { mtime: number; size: number };
		}) => Promise<readonly T[] | null>,
	): Promise<Map<string, T>> {
		const layout = getProjectPathLayout(project.locale);
		const byId = new Map<string, T>();
		for (const { year, months } of monthsBetween(
			addMonths(from, -1),
			addMonths(through, 1),
		)) {
			const folder = sessionYearFolder(
				project.rootPath,
				layout.directories.writingSessions,
				year,
			);
			const prefixes = months.map((month) => `${year}_${month}_`);
			for (const file of this.deps.repository.listDirectFiles(folder)) {
				if (!file.name.endsWith(suffix)) continue;
				if (!prefixes.some((prefix) => file.name.startsWith(prefix))) {
					continue;
				}
				const records = await read(file);
				if (records === null) continue;
				for (const record of records) byId.set(record.id, record);
			}
		}
		return byId;
	}

	/**
	 * The accruing day as the record it would be if it filed now, so a
	 * reading counts today's untimed words the moment they land. Rolled over
	 * first, exactly as an event would roll it, so a reading taken past
	 * midnight never stretches yesterday.
	 */
	private liveUntimedRecord(project: ProjectRef): UntimedDayRecord | null {
		const state = this.untimedStates.get(project.id);
		if (state === undefined) return null;
		this.rolloverIfNeeded(state);
		return this.finalizeUntimed(state);
	}

	/**
	 * Upserts one day into its device's untimed file: the same id is replaced
	 * rather than joined, because the record always carries the whole day.
	 */
	private appendUntimedRecord(
		rootPath: string,
		sessionsDir: string,
		record: UntimedDayRecord,
	): Promise<void> {
		const path = untimedFilePath(
			rootPath,
			sessionsDir,
			record.day,
			this.deps.deviceId(),
		);
		return this.appendRecordFile(path, parseUntimedJson, serializeUntimedFile, {
			fresh: (): UntimedMonthFile => ({
				schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
				days: [record],
			}),
			merge: (parsed): UntimedMonthFile => ({
				schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
				days: [
					...parsed.days.filter((day) => day.id !== record.id),
					record,
				],
			}),
		});
	}

	/**
	 * One record into its JSON file: created when the file is absent, else
	 * parsed, merged and rewritten in one transform. A file that will not
	 * parse is never destroyed: it is set aside whole, and a healthy file
	 * starts where the next record can land again. One choreography for the
	 * session months and the untimed days, quarantine included, so the two
	 * writers cannot drift.
	 */
	private async appendRecordFile<T>(
		path: string,
		parse: (content: string | null) => T | null,
		serialize: (file: T) => string,
		build: { fresh: () => T; merge: (parsed: T) => T },
	): Promise<void> {
		if (this.deps.repository.getFile(path) === null) {
			await this.deps.repository.createPlainFile(
				path,
				serialize(build.fresh()),
			);
			return;
		}
		let corrupt = false;
		await this.deps.repository.updatePlainFile(path, (current) => {
			const parsed = parse(current);
			if (parsed === null) {
				corrupt = true;
				return current;
			}
			return serialize(build.merge(parsed));
		});
		if (!corrupt) return;
		const aside = path.replace(
			/\.json$/u,
			`.corrupted-${String(this.now())}.json`,
		);
		await this.deps.repository.renameFile(path, aside);
		await this.deps.repository.createPlainFile(path, serialize(build.fresh()));
		this.emit({ kind: "corrupt-file-preserved", path: aside });
	}

	/** Credits landed: note when the dirt began, and pace the write. */
	private markUntimedDirty(state: UntimedState): void {
		state.dirty = true;
		if (this.untimedDirtySince === null) {
			this.untimedDirtySince = this.now();
		}
		this.armUntimedFlush();
	}

	/**
	 * Every credit re-arms the quiet spell, and the ceiling caps how long the
	 * re-arming may go on: the delay is the quiet spell or what is left of
	 * the ceiling, whichever runs out first.
	 */
	private armUntimedFlush(): void {
		const since = this.untimedDirtySince ?? this.now();
		const ceiling = since + UNTIMED_FLUSH_MAX_MS - this.now();
		this.armUntimedFlushIn(
			Math.max(0, Math.min(UNTIMED_FLUSH_QUIET_MS, ceiling)),
		);
	}

	private armUntimedFlushIn(delay: number): void {
		if (this.unloading) return;
		if (this.untimedFlushHandle !== null) {
			this.timers.clear(this.untimedFlushHandle);
			this.untimedFlushHandle = null;
		}
		this.untimedFlushHandle = this.timers.set(() => {
			this.untimedFlushHandle = null;
			void this.enqueue(() => this.flushDirtyUntimed());
		}, delay);
	}

	/**
	 * Carries every dirty day to its vault file, mid-day: the same upsert the
	 * rollover uses, with the state kept accruing. A write that fails leaves
	 * its day dirty and the pacing re-armed as fresh dirt, so the vault only
	 * ever trails by minutes -- never by the day, and never in a tight loop.
	 */
	private async flushDirtyUntimed(): Promise<void> {
		let remaining = false;
		for (const state of this.untimedStates.values()) {
			if (!state.dirty) continue;
			// Cleared before the write and restored on failure, so a credit
			// landing during the write's await keeps the fresh mark it set
			// instead of being clobbered by a reset after the fact.
			state.dirty = false;
			const record = this.finalizeUntimed(state);
			if (record === null) continue;
			try {
				await this.appendUntimedRecord(
					state.rootPath,
					state.sessionsDir,
					record,
				);
			} catch {
				state.dirty = true;
				remaining = true;
			}
		}
		this.snapshotUntimed();
		if (remaining) {
			// A failed write keeps its dirt's age -- the ceiling still counts
			// from the oldest unfiled credit -- and the retry itself is paced
			// by the quiet spell rather than spun in a loop.
			this.armUntimedFlushIn(UNTIMED_FLUSH_QUIET_MS);
			return;
		}
		// Dirt that landed mid-write keeps its own age and its own armed
		// timer; only a fully clean pass closes the ceiling's clock.
		const anyDirty = [...this.untimedStates.values()].some(
			(state) => state.dirty,
		);
		if (!anyDirty) this.untimedDirtySince = null;
	}

	private queueUntimedFlush(
		target: { projectId: string; rootPath: string; sessionsDir: string },
		record: UntimedDayRecord,
	): void {
		this.unflushed.set(untimedFlushKey(target.projectId, record.id), {
			projectId: target.projectId,
			rootPath: target.rootPath,
			sessionsDir: target.sessionsDir,
			record,
		});
	}

	/**
	 * Writes every finished record still waiting. One that fails stays queued
	 * and snapshotted -- the retry costs a delay, never the day -- and the
	 * upsert-by-id makes trying again after a half-landed write harmless.
	 */
	private async flushUnflushed(): Promise<void> {
		for (const [key, flush] of [...this.unflushed]) {
			try {
				await this.appendUntimedRecord(
					flush.rootPath,
					flush.sessionsDir,
					flush.record,
				);
				this.unflushed.delete(key);
			} catch {
				// Kept for the next rollover, toggle or launch to retry.
			}
		}
	}

	/** Every accruing day and unfiled record, or null when there is nothing. */
	private buildUntimedSnapshot(): UntimedTrackingSnapshot | null {
		const states: UntimedStateSnapshot[] = [];
		for (const state of this.untimedStates.values()) {
			if (state.perFile.size === 0) continue;
			// The tallied notes' standing counts ride on the tallies, so a
			// relaunch can still credit a deletion at a note's standing
			// count. Only those: a whole project's baselines would bloat a
			// store written every twenty seconds, and every other note
			// re-seeds from the disk.
			states.push({
				projectId: state.projectId,
				projectRoot: state.rootPath,
				sessionsDir: state.sessionsDir,
				day: state.day,
				timezone: state.timezone,
				countMode: state.options.mode,
				countHeadings: state.options.headings,
				files: this.untimedFileTallies(state),
			});
		}
		for (const flush of this.unflushed.values()) {
			states.push({
				projectId: flush.projectId,
				projectRoot: flush.rootPath,
				sessionsDir: flush.sessionsDir,
				day: flush.record.day,
				timezone: flush.record.timezone,
				...(flush.record.countMode === undefined
					? {}
					: { countMode: flush.record.countMode }),
				...(flush.record.countHeadings === undefined
					? {}
					: { countHeadings: flush.record.countHeadings }),
				files: flush.record.files,
			});
		}
		if (states.length === 0) return null;
		return { schemaVersion: WRITING_SESSION_SCHEMA_VERSION, states };
	}

	private snapshotUntimed(): void {
		this.lastUntimedSnapshotAt = this.now();
		this.deps.untimedRecovery.save(this.buildUntimedSnapshot());
	}

	private maybeSnapshotUntimed(): void {
		if (this.now() - this.lastUntimedSnapshotAt < SNAPSHOT_EVERY_MS) return;
		this.snapshotUntimed();
	}

	/**
	 * Finalizes an orphaned snapshot from a crash or shutdown into its
	 * monthly file. Never resumes: the record ends at the moment the snapshot
	 * captured, and the end count derives from what the session saw.
	 */
	recoverAtStartup(): Promise<WritingSessionRecord | null> {
		return this.enqueue(async () => {
			await this.recoverUntimed();
			const snapshot = parseSessionSnapshot(this.deps.recovery.load());
			if (snapshot === null) {
				this.deps.recovery.save(null);
				return null;
			}
			const record = finalizeSnapshot(snapshot);
			if (shouldDiscard(record)) {
				this.deps.recovery.save(null);
				return null;
			}
			// The snapshot is the only copy of the session until the record is
			// safely down, so it is cleared after the write, not before: a
			// failed append then leaves it for the next launch to try again,
			// and the by-id merge makes a second try harmless.
			await this.appendRecord(
				snapshot.projectRoot,
				snapshot.sessionsDir,
				Date.parse(snapshot.startedAt),
				snapshot.timezone,
				record,
			);
			this.deps.recovery.save(null);
			this.emit({ kind: "recovered", record });
			return record;
		});
	}

	/**
	 * Puts the untimed days back the way the last run left them: a day still
	 * underway resumes accruing in memory, and a finished one is filed. The
	 * snapshot is rewritten only after the writes land -- what failed stays
	 * covered, exactly like the session's own recovery.
	 */
	private async recoverUntimed(): Promise<void> {
		const snapshot = parseUntimedSnapshot(this.deps.untimedRecovery.load());
		if (snapshot === null) {
			this.deps.untimedRecovery.save(null);
			return;
		}
		let touched = false;
		for (const entry of snapshot.states) {
			if (entry.files.length === 0) continue;
			if (calendarDay(this.now(), entry.timezone) === entry.day) {
				const kept = this.untimedStates.get(entry.projectId);
				if (kept !== undefined && kept.day === entry.day) {
					// Two snapshot entries for one accruing day -- a state and
					// an unfiled flush of it -- come home as one.
					this.foldTallies(kept, entry.files, entry);
					touched = true;
					continue;
				}
				const options = this.deps.countOptions();
				// The standing counts come home only under the convention
				// they were measured by; measured under another rule, they
				// re-seed from the disk instead of reading as writing. The
				// legacy side map is honored the same way, for the one
				// relaunch that crosses the format change.
				const matches =
					entry.countMode === options.mode &&
					entry.countHeadings === options.headings;
				const baseline = new Map<string, number>();
				if (matches) {
					for (const tally of entry.files) {
						if (tally.standing !== undefined) {
							baseline.set(tally.path, tally.standing);
						}
					}
					for (const [path, total] of Object.entries(
						entry.baselines ?? {},
					)) {
						if (!baseline.has(path)) baseline.set(path, total);
					}
				}
				const state: UntimedState = {
					projectId: entry.projectId,
					rootPath: entry.projectRoot,
					sessionsDir: entry.sessionsDir,
					timezone: entry.timezone,
					day: entry.day,
					options,
					ref: null,
					hydrated: true,
					// The resumed day lives only in the snapshot until the
					// flush beat carries it to the vault.
					dirty: true,
					baseline,
					vouched: new Set<string>(),
					manuscript: new Set(
						entry.files
							.filter((tally) => tally.manuscript)
							.map((tally) => tally.path),
					),
					outside: new Set(),
					reclassify: new Set(),
					pending: new Map(),
					rebase: new Set(),
					perFile: new Map(
						entry.files.map((tally) => [
							tally.path,
							{ added: tally.added, deleted: tally.deleted },
						]),
					),
				};
				this.untimedStates.set(entry.projectId, state);
				this.untimedDirtySince ??= this.now();
				this.armUntimedFlush();
				touched = true;
				continue;
			}
			this.queueUntimedFlush(
				{
					projectId: entry.projectId,
					rootPath: entry.projectRoot,
					sessionsDir: entry.sessionsDir,
				},
				this.untimedRecord(entry.day, entry.timezone, {
					countMode: entry.countMode,
					countHeadings: entry.countHeadings,
					files: [...entry.files],
				}),
			);
			touched = true;
		}
		await this.flushUnflushed();
		this.deps.untimedRecovery.save(this.buildUntimedSnapshot());
		// A panel painted before this recovery ran has no heartbeat to catch
		// it up -- with no session there is no ticker -- so the recovered
		// words announce themselves.
		if (touched) this.emit({ kind: "changed", counted: true });
	}

	/**
	 * The plugin is unloading. Synchronous on purpose: the snapshot write is
	 * the one thing that must land before the process may go away, and the
	 * per-device store can take it without an await.
	 */
	markShutdown(): void {
		this.unloading = true;
		this.clearTimers();
		if (this.untimedFlushHandle !== null) {
			this.timers.clear(this.untimedFlushHandle);
			this.untimedFlushHandle = null;
		}
		// The drain will never run now, so each queued untimed change whose
		// text and baseline are both in hand synchronously is settled here;
		// the rest re-seed from the disk next launch, exactly like a change
		// the editor never reported.
		this.settlePendingSync();
		// The untimed days always snapshot on the way out: their store is
		// per-device and their records upsert by a deterministic id, so a
		// late snapshot can never be recovered as a duplicate.
		this.deps.untimedRecovery.save(this.buildUntimedSnapshot());
		const live = this.liveState;
		// A session already stopping has its record in flight and its tracker
		// being read out; ticking it here would corrupt that read, and the
		// last periodic snapshot still stands in the store as the safety net.
		if (live?.tracker == null || live.stopping) return;
		live.tracker.tick(this.now());
		this.deps.recovery.save(this.buildSnapshot(live, true));
	}

	/** The shutdown settle: every credit that needs no disk, applied now. */
	private settlePendingSync(): void {
		for (const state of this.untimedStates.values()) {
			this.settleUntimedPending(state);
		}
	}

	/**
	 * Credits every queued untimed change the service can measure without
	 * touching the disk -- the note's baseline is known and its text is one
	 * an editor can still answer for -- and leaves the rest queued. The
	 * untimed twin of `settleSessionPending`, for the two moments no drain
	 * can be awaited: the plugin unloading, and a pause thawing.
	 */
	private settleUntimedPending(state: UntimedState): boolean {
		let credited = false;
		for (const [path, entry] of [...state.pending]) {
			const base = state.baseline.get(path);
			if (base === undefined) continue;
			const text = resolveText(entry.content);
			if (text === undefined) continue;
			const total = this.totalFromText(state.options, text);
			if (total === null) continue;
			state.pending.delete(path);
			state.baseline.set(path, total);
			if (total !== base) {
				this.creditTally(state.perFile, path, total - base);
				state.vouched.add(path);
				// Paces the write like any other credit; the arming is a
				// no-op once the plugin is on its way out.
				this.markUntimedDirty(state);
				credited = true;
			}
		}
		return credited;
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
		const sessions = await this.gatherSessions(project, from, through);
		// The running session is read the way spread() reads it: as the
		// record it would be if it stopped now, merged by id beside the
		// finished ones -- one loop, one shape, nothing summed twice.
		const running = this.liveRecord(project);
		if (running !== null) sessions.set(running.id, running);
		for (const session of sessions.values()) {
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
			bucket.timedNet += shown.net;
			bucket.goalNet += session.words[this.deps.goalScope()].net;
		}
		// The untimed days join the word readings and nothing else: no time,
		// no session count, no pace -- a day of them shows words over silent
		// clocks. Read regardless of the setting, because turning capture off
		// does not unwrite what was already recorded. Each record is a whole
		// calendar day already, bucketed by its own name; the accruing day and
		// any unfiled record overlay the stored copy by id, freshest last.
		// The accruing day is read first: its rollover may file yesterday
		// into the unfiled map, and the overlay below must see that record
		// on the very reading that performed the rollover.
		const accruing = this.liveUntimedRecord(project);
		const untimed = await this.gatherUntimedDays(project, from, through);
		for (const flush of this.unflushed.values()) {
			if (flush.projectId === project.id) {
				untimed.set(flush.record.id, flush.record);
			}
		}
		if (accruing !== null) untimed.set(accruing.id, accruing);
		for (const record of untimed.values()) {
			const bucket = byDay.get(record.day);
			if (bucket === undefined) continue;
			const shown = record.words[this.deps.scope()];
			bucket.added += shown.added;
			bucket.deleted += shown.deleted;
			bucket.trackedNet += shown.net;
			bucket.goalNet += record.words[this.deps.goalScope()].net;
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
		if (live?.tracker == null || live.stopping || live.project.id !== project.id) {
			return null;
		}
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
			const parsed = await this.readMonthFile(file);
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
	private gatherSessions(
		project: ProjectRef,
		from: string,
		through: string,
	): Promise<Map<string, WritingSessionRecord>> {
		return this.gatherMonthly(project, from, through, SESSION_FILE_SUFFIX, async (file) => (await this.readMonthFile(file))?.sessions ?? null);
	}

	/** One month file, parsed once per on-disk state and shared read-only. */
	private readMonthFile(file: {
		path: string;
		stat: { mtime: number; size: number };
	}): Promise<WritingSessionMonthFile | null> {
		return this.readStamped(this.monthMemo, file, parseMonthJson);
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
	private async reclassifyPath(
		live: LiveState,
		path: string,
	): Promise<boolean> {
		const scopes = await this.deps.writingCount.scopesOf(live.project, path);
		if (this.liveState !== live) return false;
		if (scopes.length > 0) {
			live.outside.delete(path);
			this.setManuscript(live, path, scopes.includes("manuscript"));
			// A note that arrived from outside has nothing to be measured
			// against, so it is read like one born here, at its full count.
			if (!live.baseline.has(path)) this.noteChanged(path);
			return false;
		}
		// Out of the project altogether: the words went with it, and the
		// tally stays behind under the name the note left by.
		const credited = this.creditRemoval(live, path);
		live.baseline.delete(path);
		live.pending.delete(path);
		live.dirtyWhilePaused.delete(path);
		live.seedTexts.delete(path);
		live.rebase.delete(path);
		live.outside.add(path);
		return credited;
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
			// Two rules, on purpose: the start snapshot keeps the note-total
			// convention the scope counts are shown in, while the baseline is
			// the ledger's whole-text reading, so a form's field weighs the
			// same written in as it does going out with a deleted note. One
			// read serves both, and a note with nothing excluded -- most of a
			// project -- is counted once, not twice.
			const both = await this.deps.writingCount.countNoteBoth(
				note.path,
				live.options,
			);
			// An unreadable note is absent from the scope count; baselining it
			// at nothing keeps the two views of the scope in agreement.
			const total = both?.display.total ?? 0;
			live.baseline.set(note.path, both?.whole.total ?? 0);
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
				this.emit({ kind: "changed", counted: false });
			}
			if (this.liveState !== null && !this.unloading) this.armTicker();
		}, 1000);
	}

	private armDebounce(): void {
		if (this.unloading || this.debounceHandle !== null) return;
		this.debounceHandle = this.timers.set(() => {
			this.debounceHandle = null;
			this.drainRun = this.drain();
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
			await this.drainSession();
			// The untimed days drain whatever the session is doing: a session
			// for one project never holds another project's words hostage.
			for (const state of [...this.untimedStates.values()]) {
				await this.drainUntimed(state);
			}
			this.maybeSnapshotUntimed();
		} finally {
			this.draining = false;
		}
	}

	private async drainSession(): Promise<void> {
		const live = this.liveState;
		if (live === null || live.tracker === null || live.stopping) return;
		// A frozen clock credits nothing. The freeze settled what it could and
		// handed the rest to the untimed day, so there is nothing here to
		// read; anything queued before it waits for the thaw, which measures
		// it against what the untimed ledger settled.
		if (live.tracker.currentPhase() === "paused") return;
		let moved = false;
		while (
			live.reclassify.size > 0 ||
			live.rebase.size > 0 ||
			live.pending.size > 0
		) {
			// Where the moved notes landed is settled first: a note that
			// arrived from outside queues itself for reading here, and one
			// that left has its words credited before anything else asks
			// what it holds.
			for (const path of [...live.reclassify]) {
				live.reclassify.delete(path);
				if (this.liveState !== live) return;
				moved = (await this.reclassifyPath(live, path)) || moved;
			}
			// Then the baselines an external write left to the disk, ahead
			// of any delta for the same notes: measured the other way round,
			// the foreign words would be credited to the next keystroke.
			for (const path of [...live.rebase]) {
				live.rebase.delete(path);
				if (this.liveState !== live) return;
				await this.rebaseline(live, path, undefined);
			}
			const entries = [...live.pending];
			live.pending.clear();
			for (const [path, content] of entries) {
				if (this.liveState !== live) return;
				moved = (await this.applyPending(live, path, content)) || moved;
			}
		}
		this.maybeSnapshot(live);
		// `counted` says whether words really moved: a drain that only
		// re-baselined a sync burst repaints on the ordinary beat instead of
		// stampeding every panel into an immediate re-read.
		this.emit({ kind: "changed", counted: moved });
	}

	/**
	 * A note's total under the ledger's rule -- the whole text, rendered
	 * blocks included, so what a form writes into one weighs the same going
	 * in as it does going out with a deleted note. The note totals shown
	 * elsewhere keep excluding those blocks; this rule is the sittings' own.
	 */
	private async currentTotal(
		options: NoteCountOptions,
		path: string,
		content: string | undefined,
	): Promise<number | null> {
		if (content !== undefined) {
			const total = this.totalFromText(options, content);
			if (total !== null) return total;
			// Mid-edit frontmatter passes through invalid states; the disk
			// answers instead, and a note unreadable there too simply waits
			// for its next valid save, baseline intact.
		}
		const count = await this.deps.writingCount.countNoteWhole(path, options);
		return count?.total ?? null;
	}

	/** A body's total under the ledger's rule, or null when it will not parse. */
	private totalFromText(
		options: NoteCountOptions,
		content: string,
	): number | null {
		try {
			const parsed = parseMarkdownFrontmatter(content);
			return this.deps.writingCount.countBodyWhole(parsed.body, options)
				.total;
		} catch {
			return null;
		}
	}

	/**
	 * Sets a note's baseline to what it now holds, crediting nothing. A path
	 * with no baseline yet is asked for membership first, exactly as the
	 * crediting drain would ask: without that, an external write to a stray
	 * note under the project folder would quietly adopt it.
	 */
	private async rebaseline(
		live: LiveState,
		path: string,
		content: string | undefined,
	): Promise<void> {
		if (!live.baseline.has(path)) {
			if (live.outside.has(path)) return;
			const scopes = await this.deps.writingCount.scopesOf(
				live.project,
				path,
			);
			if (this.liveState !== live) return;
			if (scopes.length === 0) {
				live.outside.add(path);
				return;
			}
			this.setManuscript(live, path, scopes.includes("manuscript"));
		}
		const total = await this.currentTotal(live.options, path, content);
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
				// A break beginning on its own clock is a pause nobody
				// clicked: the session settles what it holds and the untimed
				// day takes the project over the same way, so words typed
				// through the break land somewhere, once.
				if (this.freezeSession(live)) {
					// The settle moved words, and a break boundary is not an
					// event the panels re-read the day on.
					this.emit({ kind: "changed", counted: true });
				}
				this.snapshot(live);
				this.emit({ kind: "break-started", cycle: effect.cycle });
			} else if (effect.kind === "work-started") {
				// And a break ending on its own clock is a resume nobody
				// clicked: the session re-measures against what the untimed
				// ledger settled, or the first keystroke of the new period
				// would be credited with everything typed during the break.
				if (this.reclaimFromUntimed(live)) {
					this.emit({ kind: "changed", counted: true });
				}
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
			this.rearmForUntimedBacklog();
			this.emit({ kind: "stopped", record: null, reason });
			return;
		}
		// Whether the clock was frozen at the end is read before the stop
		// consumes the tracker: a session stopped from a pause hands no
		// baselines over, because the untimed day has been the one measuring
		// since the freeze and its ledger is the fresher.
		const pausedAtStop = live.tracker.currentPhase() === "paused";
		// Deltas still on the debounce belong to this session. A drain the
		// debounce already fired keeps the entries it claimed: the stop waits
		// for it to finish crediting them before reading the totals, and the
		// flush below picks up whatever never left the queue.
		await this.drainRun;
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
			files: this.fileTallies(live.perFile, live.manuscript),
			timing: live.timing,
		};
		// What the session learned about the project's notes outlives it: the
		// untimed day inherits the final baselines and memberships, so a note
		// deleted after the stop is credited at its standing count, and the
		// first edit after it is measured against the session's end rather
		// than a disk the autosave may not have reached. The state is made
		// where the project has none yet -- a session started fresh must not
		// drop the hand-off -- and a stop out of a pause hands nothing over,
		// because the untimed ledger has been the accurate one since the
		// freeze. Baselines cross only under one shared counting convention.
		if (this.deps.trackUntimed() && !pausedAtStop) {
			const dormant = this.ensureUntimedState(live.project);
			this.adoptSessionMemberships(dormant, live);
			if (sameCounting(dormant.options, live.options)) {
				dormant.baseline = live.baseline;
				dormant.vouched = new Set(live.baseline.keys());
			}
		}
		this.liveState = null;
		this.clearTimers();
		this.rearmForUntimedBacklog();
		if (shouldDiscard(record)) {
			this.deps.recovery.save(null);
			this.emit({ kind: "stopped", record: null, reason });
			return;
		}
		// The last periodic snapshot stands until the record is safely down:
		// cleared first, a crash between the two would lose the session whole,
		// where recovering that snapshot loses at most its final seconds.
		await this.appendRecord(
			live.project.rootPath,
			live.sessionsDir,
			live.startedAtMs ?? stopped.endedAt,
			live.timezone,
			record,
		);
		this.deps.recovery.save(null);
		this.emit({ kind: "stopped", record, reason });
	}

	/** The stop-time flush: pending deltas applied without the debounce. */
	private async drainInto(live: LiveState): Promise<void> {
		for (const path of [...live.reclassify]) {
			live.reclassify.delete(path);
			await this.reclassifyPath(live, path);
		}
		for (const path of [...live.rebase]) {
			live.rebase.delete(path);
			await this.rebaseline(live, path, undefined);
		}
		for (const [path, content] of [...live.pending]) {
			live.pending.delete(path);
			await this.applyPending(live, path, content);
		}
	}

	/**
	 * One pending entry, credited: membership, then the baseline -- seeded
	 * from the text a plugin save replaced, where the session had none -- then
	 * the delta. A path that turns out to be nobody's writing drops its seed
	 * with it.
	 */
	private async applyPending(
		live: LiveState,
		path: string,
		content: NoteTextProvider | undefined,
	): Promise<boolean> {
		const hadBaseline = live.baseline.has(path);
		const seed = live.seedTexts.get(path);
		live.seedTexts.delete(path);
		if (!(await this.member(live, path))) return false;
		if (!hadBaseline && seed !== undefined) {
			const opening = this.totalFromText(live.options, seed);
			if (opening !== null) live.baseline.set(path, opening);
		}
		const total = await this.currentTotal(
			live.options,
			path,
			resolveText(content),
		);
		if (total === null) return false;
		return this.applyDelta(live, path, total);
	}

	/**
	 * Credits one note's movement against its baseline, and only to the note.
	 * Which scopes that credit is read under is decided when the totals are
	 * summed, from where the note belongs then, so nothing here has to know or
	 * remember it.
	 */
	private applyDelta(live: LiveState, path: string, total: number): boolean {
		const base = live.baseline.get(path) ?? 0;
		live.baseline.set(path, total);
		if (base === total) return false;
		this.creditTally(live.perFile, path, total - base);
		return true;
	}

	/** Adds one signed movement to a note's tally, added or deleted by sign. */
	private creditTally(
		perFile: Map<string, FileTally>,
		path: string,
		delta: number,
	): void {
		const tally = perFile.get(path) ?? { added: 0, deleted: 0 };
		if (delta > 0) tally.added += delta;
		else tally.deleted += -delta;
		perFile.set(path, tally);
	}


	private appendRecord(
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
		return this.appendRecordFile(path, parseMonthJson, serializeMonthFile, {
			fresh: (): WritingSessionMonthFile => ({
				schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
				sessions: [record],
			}),
			merge: (parsed) => {
				parsed.sessions.push(record);
				return parsed;
			},
		});
	}

	private maybeSnapshot(live: LiveState): void {
		if (this.now() - this.lastSnapshotAt < SNAPSHOT_EVERY_MS) return;
		this.snapshot(live);
	}

	private snapshot(live: LiveState): void {
		// A stopping session must never be snapshotted again: its record is
		// on its way to the vault, and a late snapshot would be "recovered"
		// on the next launch as a second copy of the same session.
		if (live.tracker === null || live.stopping || this.unloading) return;
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
			files: this.fileTallies(live.perFile, live.manuscript),
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

	/**
	 * The debounce is shared, and a session clearing its own clocks must not
	 * strand another project's queued words on it: whatever untimed work
	 * still waits gets the one-shot re-armed. Called after every clearTimers
	 * a stop performs.
	 */
	private rearmForUntimedBacklog(): void {
		for (const state of this.untimedStates.values()) {
			if (
				state.pending.size > 0 ||
				state.rebase.size > 0 ||
				state.reclassify.size > 0
			) {
				this.armDebounce();
				return;
			}
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

/**
 * The milliseconds a clock face shows for a running session: elapsed for a
 * stopwatch, what is left for anything with a deadline. One rule for the
 * status bar and the timer widget, so the two can never show different
 * clocks over the same sitting.
 */
export function sessionClockMs(live: LiveWritingSession): number {
	return live.type === "stopwatch"
		? live.durations.totalMs
		: (live.remainingMs ?? 0);
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
		timedNet: 0,
		goalNet: 0,
	};
}

function seconds(value: number | undefined): number | undefined {
	return value === undefined ? undefined : value * 1000;
}

/**
 * Whether two option sets count by the same rule. Mode and headings are the
 * two knobs a count answers differently under -- the same pair the count
 * memos stamp by -- and numbers measured under different rules must never be
 * diffed against each other: the rules' disagreement would read as writing.
 */
function sameCounting(a: NoteCountOptions, b: NoteCountOptions): boolean {
	return a.mode === b.mode && a.headings === b.headings;
}

/** The one spelling of the unfiled-flush key: which project, which record. */
function untimedFlushKey(projectId: string, recordId: string): string {
	return `${projectId}:${recordId}`;
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

function serializeUntimedFile(file: UntimedMonthFile): string {
	return `${JSON.stringify(file, null, "\t")}\n`;
}

function parseUntimedJson(content: string | null): UntimedMonthFile | null {
	if (content === null) return null;
	try {
		return parseUntimedFile(JSON.parse(content));
	} catch {
		return null;
	}
}
