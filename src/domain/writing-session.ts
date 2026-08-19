/**
 * Writing sessions: the time half of the statistics the writing count opened.
 *
 * A session splits its span into three kinds of time. Focus is the stretch
 * around actual editing -- engagement in the writing workflow, which is not
 * the same as continuous typing; Idle is the stretch inside a session where
 * nothing was written for longer than the grace period; Paused is time the
 * author (or a pomodoro break) switched off, and it is the one kind Total
 * does not include. Leaving the editor, or the app, is not one of them: only
 * silence turns Focus into Idle. Everything here is derived from timestamps,
 * never from how many timer ticks happened to fire, so a laptop closed for
 * two hours classifies the same as two hours watched second by second.
 *
 * The numbers a session keeps are stable, useful approximations of writing
 * behaviour, not a keystroke-level audit trail.
 */

import { DAY_BANDS, splitDayBands } from './calendar';

export const WRITING_SESSION_SCHEMA_VERSION = 1;

export const WRITING_SESSION_TYPES = [
	'stopwatch',
	'countdown',
	'pomodoro',
] as const;
export type WritingSessionType = (typeof WRITING_SESSION_TYPES)[number];

export const WRITING_SESSION_SCOPES = ['project', 'manuscript'] as const;
export type WritingSessionScope = (typeof WRITING_SESSION_SCOPES)[number];

export const WRITING_MODES = [
	'planning',
	'draft',
	'revision',
	'proofreading',
] as const;
export type WritingMode = (typeof WRITING_MODES)[number];

export const SESSION_STOP_REASONS = [
	'manual',
	'countdown-completed',
	'focus-mode-ended',
	'replaced-by-new-session',
	'app-shutdown',
	'recovered',
] as const;
export type SessionStopReason = (typeof SESSION_STOP_REASONS)[number];

export type SessionStartMode = 'manual' | 'auto';

/** One closed stretch of session time, UTC ISO at rest. */
export interface SessionInterval {
	startedAt: string;
	endedAt: string;
}

/** What one note contributed to a session's observed writing. */
export interface SessionFileTally {
	path: string;
	added: number;
	deleted: number;
	net: number;
}

/** Every configured condition must be met for the goal to complete. */
export interface WritingSessionGoal {
	netWordTarget?: number;
	focusTimeTargetSeconds?: number;
}

/**
 * The clocks a session was started with, frozen for its whole life so a
 * settings change mid-session cannot make the recorded intervals disagree
 * with the rules that produced them. Pomodoro periods are work and break --
 * never "focus", which in a session always means engaged writing time.
 */
export interface WritingSessionTiming {
	idleThresholdSeconds: number;
	targetDurationSeconds?: number;
	workDurationSeconds?: number;
	breakDurationSeconds?: number;
	autoRepeat?: boolean;
}

export interface WritingSessionRecord {
	uuid: string;
	schemaVersion: typeof WRITING_SESSION_SCHEMA_VERSION;
	startedAt: string;
	endedAt: string;
	/** IANA zone of the device that ran the session. */
	timezone: string;
	countingScope: WritingSessionScope;
	sessionType: WritingSessionType;
	startMode: SessionStartMode;
	writingMode: WritingMode;
	stopReason: SessionStopReason;
	activeIntervals: SessionInterval[];
	idleIntervals: SessionInterval[];
	pausedIntervals: SessionInterval[];
	/** Scope totals at the ends: snapshots, not sums of the deltas below. */
	startWordCount: number;
	endWordCount: number;
	addedWordCount: number;
	deletedWordCount: number;
	netWordCount: number;
	files: SessionFileTally[];
	goal: WritingSessionGoal | null;
	timing: WritingSessionTiming;
}

/** One device's sessions for one month, as stored in the vault. */
export interface WritingSessionMonthFile {
	schemaVersion: typeof WRITING_SESSION_SCHEMA_VERSION;
	sessions: WritingSessionRecord[];
}

/**
 * A running session as persisted for crash recovery. Recovery only ever
 * finalizes -- it never resumes -- so the snapshot carries the closed
 * intervals and the open one, not the tracker's clocks and not the per-note
 * baseline map, which on a large project would be thousands of entries
 * rewritten every few seconds.
 *
 * `capturedAt` is the moment the snapshot describes; the tracker is ticked to
 * it before serializing, so the intervals already contain any idle split the
 * grace period implies. `lastActivityAt` rides along for display and honesty,
 * but finalization closes at `capturedAt`, keeping whatever grace or idle
 * time the snapshot already represents.
 */
export interface WritingSessionSnapshot {
	uuid: string;
	schemaVersion: typeof WRITING_SESSION_SCHEMA_VERSION;
	projectRoot: string;
	projectPath: string;
	/**
	 * The localized sessions directory captured at start, so recovery can
	 * write the monthly file without reloading a project that may no longer
	 * load.
	 */
	sessionsDir: string;
	startedAt: string;
	timezone: string;
	countingScope: WritingSessionScope;
	sessionType: WritingSessionType;
	startMode: SessionStartMode;
	writingMode: WritingMode;
	goal: WritingSessionGoal | null;
	timing: WritingSessionTiming;
	startWordCount: number;
	activeIntervals: SessionInterval[];
	idleIntervals: SessionInterval[];
	pausedIntervals: SessionInterval[];
	openPhase: SessionPhase;
	openStartedAt: string;
	capturedAt: string;
	lastActivityAt: string;
	addedWordCount: number;
	deletedWordCount: number;
	files: SessionFileTally[];
	markedShutdown?: boolean;
}

export type SessionPhase = 'focus' | 'idle' | 'paused';
export type PomodoroPhase = 'work' | 'break';

export interface SessionTrackerConfig {
	type: WritingSessionType;
	idleThresholdMs: number;
	targetDurationMs?: number;
	workDurationMs?: number;
	breakDurationMs?: number;
	autoRepeat?: boolean;
}

interface MsInterval {
	from: number;
	to: number;
}

/**
 * What an event made the clock do beyond bookkeeping, for the service to
 * repaint or announce. A completion is reported, never executed: the tracker
 * names the exact deadline and the service stops the session at it, so the
 * stop lands at the moment the target was crossed even when the tick that
 * noticed arrived hours later.
 */
export type TrackerEffect =
	| { kind: 'went-idle'; at: number }
	| { kind: 'went-focus'; at: number }
	| { kind: 'break-started'; at: number; cycle: number }
	| { kind: 'work-started'; at: number; cycle: number }
	| { kind: 'completion-due'; at: number };

interface Boundary {
	at: number;
	kind: 'idle' | 'complete' | 'break' | 'work';
}

export interface SessionDurations {
	focusMs: number;
	idleMs: number;
	pausedMs: number;
	/** Focus and idle together; paused time is outside the session's Total. */
	totalMs: number;
}

export interface SessionTrackerSerialized {
	activeIntervals: SessionInterval[];
	idleIntervals: SessionInterval[];
	pausedIntervals: SessionInterval[];
	openPhase: SessionPhase;
	openStartedAt: string;
	lastActivityAt: string;
}

/**
 * The clock of one running session. Every public event first lays down each
 * boundary the elapsed time crossed -- the idle split after the grace period,
 * a countdown or pomodoro deadline -- in the order it crossed them, at the
 * timestamps it crossed them, and only then applies itself. Reads are honest
 * only after `tick(now)`; the service ticks every second and before every
 * read, so the caveat never shows.
 */
export class SessionTracker {
	readonly startedAt: number;
	private phase: SessionPhase = 'focus';
	private segmentStart: number;
	private lastActivityAt: number;
	private readonly active: MsInterval[] = [];
	private readonly idle: MsInterval[] = [];
	private readonly paused: MsInterval[] = [];
	/** Total (focus + idle) banked at every interval close: the countdown clock. */
	private bankedRunMs = 0;
	/** The same, but reset each pomodoro phase: the work-period clock. */
	private workBankedMs = 0;
	private pomodoroPhase: PomodoroPhase | null;
	private cycle = 1;
	private completionAt: number | null = null;

	constructor(
		private readonly config: SessionTrackerConfig,
		startedAt: number,
	) {
		this.startedAt = startedAt;
		this.segmentStart = startedAt;
		this.lastActivityAt = startedAt;
		this.pomodoroPhase = config.type === 'pomodoro' ? 'work' : null;
	}

	currentPhase(): SessionPhase {
		return this.phase;
	}

	currentPomodoro(): { phase: PomodoroPhase; cycle: number } | null {
		return this.pomodoroPhase === null
			? null
			: { phase: this.pomodoroPhase, cycle: this.cycle };
	}

	completionDue(): number | null {
		return this.completionAt;
	}

	/**
	 * Meaningful editing happened. The only event that renews the grace
	 * period, and the only one that brings Idle back to Focus: leaving the
	 * editor, or the app, says nothing about whether an author is writing,
	 * and silence is what the threshold is for.
	 */
	activity(t: number): TrackerEffect[] {
		const effects: TrackerEffect[] = [];
		const at = this.clamp(t);
		this.advance(at, effects);
		if (this.completionAt !== null) return effects;
		if (this.phase === 'idle') {
			this.closeOpen(at);
			this.phase = 'focus';
			this.segmentStart = at;
			effects.push({ kind: 'went-focus', at });
		}
		// A paused session stays frozen: typing does not resume it, and only
		// focus keeps a grace period worth renewing.
		if (this.phase === 'focus') this.lastActivityAt = at;
		return effects;
	}

	pause(t: number): TrackerEffect[] {
		const effects: TrackerEffect[] = [];
		const at = this.clamp(t);
		this.advance(at, effects);
		if (this.completionAt !== null || this.phase === 'paused') return effects;
		this.closeOpen(at);
		this.phase = 'paused';
		this.segmentStart = at;
		return effects;
	}

	resume(t: number): TrackerEffect[] {
		const effects: TrackerEffect[] = [];
		const at = this.clamp(t);
		this.advance(at, effects);
		if (this.completionAt !== null || this.phase !== 'paused') return effects;
		// A break is not the author's pause to lift: it ends on its own clock.
		if (this.pomodoroPhase === 'break') return effects;
		this.closeOpen(at);
		this.phase = 'focus';
		this.segmentStart = at;
		this.lastActivityAt = at;
		effects.push({ kind: 'went-focus', at });
		return effects;
	}

	tick(t: number): TrackerEffect[] {
		const effects: TrackerEffect[] = [];
		this.advance(this.clamp(t), effects);
		return effects;
	}

	/**
	 * Closes the open stretch and hands back the three lists. The caller
	 * passes the moment the session actually ended -- for a completion, the
	 * deadline the tracker reported, not the time the report was read.
	 */
	stop(t: number): {
		active: readonly MsInterval[];
		idle: readonly MsInterval[];
		paused: readonly MsInterval[];
		endedAt: number;
	} {
		const effects: TrackerEffect[] = [];
		const at = this.clamp(t);
		this.advance(at, effects);
		const endedAt =
			this.completionAt === null ? at : Math.min(at, this.completionAt);
		this.closeOpen(endedAt);
		return {
			active: this.active,
			idle: this.idle,
			paused: this.paused,
			endedAt,
		};
	}

	/** Focus, idle, paused and total up to `t`, the open stretch included. */
	durations(t: number): SessionDurations {
		const at = Math.max(this.clamp(t), this.segmentStart);
		const open = at - this.segmentStart;
		const focusMs =
			sumMs(this.active) + (this.phase === 'focus' ? open : 0);
		const idleMs = sumMs(this.idle) + (this.phase === 'idle' ? open : 0);
		const pausedMs =
			sumMs(this.paused) + (this.phase === 'paused' ? open : 0);
		return { focusMs, idleMs, pausedMs, totalMs: focusMs + idleMs };
	}

	/** What is left on the countdown or the current pomodoro period at `t`. */
	remainingMs(t: number): number | null {
		const at = Math.max(this.clamp(t), this.segmentStart);
		const open = this.phase === 'paused' ? 0 : at - this.segmentStart;
		if (this.config.type === 'countdown') {
			const target = this.config.targetDurationMs ?? Infinity;
			return Math.max(0, target - this.bankedRunMs - open);
		}
		if (this.config.type !== 'pomodoro') return null;
		if (this.pomodoroPhase === 'break') {
			const length = this.config.breakDurationMs ?? Infinity;
			return Math.max(0, length - (at - this.segmentStart));
		}
		const length = this.config.workDurationMs ?? Infinity;
		return Math.max(0, length - this.workBankedMs - open);
	}

	serialize(): SessionTrackerSerialized {
		return {
			activeIntervals: toSessionIntervals(this.active),
			idleIntervals: toSessionIntervals(this.idle),
			pausedIntervals: toSessionIntervals(this.paused),
			openPhase: this.phase,
			openStartedAt: new Date(this.segmentStart).toISOString(),
			lastActivityAt: new Date(this.lastActivityAt).toISOString(),
		};
	}

	/** Events cannot land before the stretch they land in began. */
	private clamp(t: number): number {
		return Math.max(t, this.segmentStart);
	}

	private advance(t: number, effects: TrackerEffect[]): void {
		while (this.completionAt === null) {
			const boundary = this.nextBoundary();
			if (boundary === null || boundary.at > t) return;
			this.cross(boundary, effects);
		}
	}

	/**
	 * The earliest moment at which the current stretch changes by itself.
	 * Deadlines outrank the idle split on a tie: at the very moment a target
	 * is crossed there is nothing left for an idle boundary to divide.
	 */
	private nextBoundary(): Boundary | null {
		const candidates: Boundary[] = [];
		const open = this.phase === 'paused' ? null : this.segmentStart;
		if (this.config.type === 'countdown' && open !== null) {
			const target = this.config.targetDurationMs;
			if (target !== undefined) {
				candidates.push({
					at: open + Math.max(0, target - this.bankedRunMs),
					kind: 'complete',
				});
			}
		}
		if (this.pomodoroPhase === 'work' && open !== null) {
			const length = this.config.workDurationMs;
			if (length !== undefined) {
				candidates.push({
					at: open + Math.max(0, length - this.workBankedMs),
					kind: 'break',
				});
			}
		}
		if (this.pomodoroPhase === 'break') {
			const length = this.config.breakDurationMs;
			if (length !== undefined) {
				candidates.push({
					at: this.segmentStart + length,
					kind: this.config.autoRepeat === true ? 'work' : 'complete',
				});
			}
		}
		if (this.phase === 'focus') {
			candidates.push({
				at: this.lastActivityAt + this.config.idleThresholdMs,
				kind: 'idle',
			});
		}
		let earliest: Boundary | null = null;
		for (const candidate of candidates) {
			if (earliest === null || candidate.at < earliest.at) {
				earliest = candidate;
			}
		}
		return earliest;
	}

	private cross(boundary: Boundary, effects: TrackerEffect[]): void {
		const at = boundary.at;
		if (boundary.kind === 'complete') {
			this.completionAt = at;
			effects.push({ kind: 'completion-due', at });
			return;
		}
		if (boundary.kind === 'idle') {
			// The grace period itself stays Focus: the split lands where the
			// grace ran out, not where it was noticed.
			this.closeOpen(at);
			this.phase = 'idle';
			this.segmentStart = at;
			effects.push({ kind: 'went-idle', at });
			return;
		}
		if (boundary.kind === 'break') {
			this.closeOpen(at);
			this.phase = 'paused';
			this.segmentStart = at;
			this.pomodoroPhase = 'break';
			this.workBankedMs = 0;
			effects.push({ kind: 'break-started', at, cycle: this.cycle });
			return;
		}
		this.closeOpen(at);
		this.phase = 'focus';
		this.segmentStart = at;
		this.lastActivityAt = at;
		this.pomodoroPhase = 'work';
		this.cycle += 1;
		effects.push({ kind: 'work-started', at, cycle: this.cycle });
	}

	private closeOpen(at: number): void {
		const from = this.segmentStart;
		const to = Math.max(at, from);
		if (this.phase !== 'paused') {
			this.bankedRunMs += to - from;
			if (this.pomodoroPhase === 'work') this.workBankedMs += to - from;
		}
		if (to === from) return;
		const list =
			this.phase === 'focus'
				? this.active
				: this.phase === 'idle'
					? this.idle
					: this.paused;
		list.push({ from, to });
	}
}

function sumMs(list: readonly MsInterval[]): number {
	let total = 0;
	for (const span of list) total += span.to - span.from;
	return total;
}

/** Millisecond spans as the ISO intervals a record stores. */
export function toSessionIntervals(
	list: readonly { from: number; to: number }[],
): SessionInterval[] {
	return list.map((span) => ({
		startedAt: new Date(span.from).toISOString(),
		endedAt: new Date(span.to).toISOString(),
	}));
}

export function sumIntervalsMs(list: readonly SessionInterval[]): number {
	let total = 0;
	for (const span of list) {
		total += Date.parse(span.endedAt) - Date.parse(span.startedAt);
	}
	return total;
}

export function sessionDurations(
	record: Pick<
		WritingSessionRecord,
		'activeIntervals' | 'idleIntervals' | 'pausedIntervals'
	>,
): SessionDurations {
	const focusMs = sumIntervalsMs(record.activeIntervals);
	const idleMs = sumIntervalsMs(record.idleIntervals);
	const pausedMs = sumIntervalsMs(record.pausedIntervals);
	return { focusMs, idleMs, pausedMs, totalMs: focusMs + idleMs };
}

/**
 * The two nets a session reports and the gap between them. Tracked net is
 * what the session watched being written and is what goals and paces read;
 * the scope's net change is the difference between its end and start
 * snapshots. They are not required to agree: words typed while paused,
 * external edits, sync and plugin writes all land in the scope without ever
 * being tracked, and the gap is shown as other changes rather than
 * reconciled away.
 */
export function sessionNets(
	record: Pick<
		WritingSessionRecord,
		'addedWordCount' | 'deletedWordCount' | 'startWordCount' | 'endWordCount'
	>,
): { trackedNet: number; scopeNetChange: number; otherChanges: number } {
	const trackedNet = record.addedWordCount - record.deletedWordCount;
	const scopeNetChange = record.endWordCount - record.startWordCount;
	return {
		trackedNet,
		scopeNetChange,
		otherChanges: scopeNetChange - trackedNet,
	};
}

/** All configured goal conditions met; an empty goal is never "reached". */
export function sessionGoalMet(
	goal: WritingSessionGoal | null,
	trackedNet: number,
	focusMs: number,
): boolean {
	if (goal === null) return false;
	const conditions: boolean[] = [];
	if (goal.netWordTarget !== undefined) {
		conditions.push(trackedNet >= goal.netWordTarget);
	}
	if (goal.focusTimeTargetSeconds !== undefined) {
		conditions.push(focusMs >= goal.focusTimeTargetSeconds * 1000);
	}
	return conditions.length > 0 && conditions.every((met) => met);
}

const DISCARD_BELOW_MS = 15_000;

/**
 * A session too short to have been one: under fifteen seconds of Total with
 * nothing written or unwritten is a misclick, not a record.
 */
export function shouldDiscard(
	record: Pick<
		WritingSessionRecord,
		| 'activeIntervals'
		| 'idleIntervals'
		| 'pausedIntervals'
		| 'addedWordCount'
		| 'deletedWordCount'
	>,
): boolean {
	return (
		sessionDurations(record).totalMs < DISCARD_BELOW_MS &&
		record.addedWordCount === 0 &&
		record.deletedWordCount === 0
	);
}

/**
 * The year and zero-padded month of a moment in the given zone, which decides
 * the monthly file a session belongs to. A session is filed by where it
 * started: one crossing midnight into a new month stays whole in the month
 * that began it.
 */
export function sessionMonthKey(
	startedAtMs: number,
	timeZone: string,
): { year: string; month: string } {
	const date = new Date(startedAtMs);
	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
		}).formatToParts(date);
	} catch {
		// An unknown zone name falls back to wherever this machine is.
		parts = new Intl.DateTimeFormat('en-CA', {
			year: 'numeric',
			month: '2-digit',
		}).formatToParts(date);
	}
	const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
	const month = parts.find((part) => part.type === 'month')?.value ?? '00';
	return { year, month };
}

/** The stretches of days a recent-trend reading offers, shortest first. */
export const TREND_RANGES = [7, 15, 30, 90, 180] as const;

/**
 * What a reading of the writing measures. One vocabulary for all four of them
 * -- the recent trend, the annual contribution, the calendar and the parts of
 * the day -- because they are four views of one question, and a reader who has
 * just asked one of them about deleted words has asked all of them. The three
 * word measures differ only in which number a day contributes; time is its own
 * shape, a sitting split into the writing and the rest of it.
 */
export const READING_MEASURES = ['net', 'added', 'deleted', 'time'] as const;
export type ReadingMeasure = (typeof READING_MEASURES)[number];

/**
 * What a heatmap shades each day by: any reading measure, or whether the day
 * met its goal -- which is the one reading none of the others offers, and so
 * the one that does not travel with them.
 */
export const HEATMAP_MEASURES = [...READING_MEASURES, 'goal'] as const;
export type HeatmapMeasure = (typeof HEATMAP_MEASURES)[number];

/**
 * The days a heatmap covers: a leap year's worth, so the same day last year
 * is always on it whichever year this is.
 */
export const HEATMAP_DAYS = 366;

/**
 * The steps a clock reading is worth ruling at: the divisions of an hour a
 * reader already thinks in, rather than whatever a quarter of the tallest day
 * happens to come to.
 */
const TIME_STEPS_MS = [
	60_000,
	2 * 60_000,
	5 * 60_000,
	10 * 60_000,
	15 * 60_000,
	30 * 60_000,
	3_600_000,
	2 * 3_600_000,
	3 * 3_600_000,
	6 * 3_600_000,
	12 * 3_600_000,
	24 * 3_600_000,
];

/** About this many bands between the axis and the top of a chart. */
const AXIS_DIVISIONS = 4;

/**
 * The ceiling a chart is drawn to and the step between its rules. The tallest
 * day is deliberately not the ceiling: a scale that ends exactly at the record
 * says the record twice, once here and once in the readings underneath, and
 * says nothing a reader can measure the other days against. So the scale is
 * ruled at round numbers and the record simply falls somewhere inside it.
 */
export function axisScale(
	max: number,
	measure: ReadingMeasure,
): { top: number; step: number } {
	const rough = Math.max(0, max) / AXIS_DIVISIONS;
	const step = measure === 'time' ? clockStep(rough) : countStep(rough);
	return { top: Math.max(step, Math.ceil(max / step) * step), step };
}

function clockStep(rough: number): number {
	const step = TIME_STEPS_MS.find((one) => one >= rough);
	// Past a day a step is whole days, which is as round as time gets.
	return step ?? Math.ceil(rough / (24 * 3_600_000)) * 24 * 3_600_000;
}

function countStep(rough: number): number {
	if (rough <= 1) return 1;
	const power = 10 ** Math.floor(Math.log10(rough));
	for (const factor of [1, 2, 2.5, 5]) {
		const step = power * factor;
		if (step >= rough) return Math.round(step);
	}
	return power * 10;
}

/** How many strengths a shaded day is drawn in, above nothing at all. */
export const HEAT_LEVELS = 4;

/** As much of a day as a reading needs: what it wrote, and for how long. */
export interface DayReading {
	trackedNet: number;
	added: number;
	deleted: number;
	focusMs: number;
}

/**
 * Which way a trend's bar went, which is what colours it. Deleted words are a
 * loss whichever day they fall on, a net below nothing is one too, and
 * everything else is a gain -- so every bar can stand on the axis and say by
 * its colour what standing below it would have said by its place.
 */
export function trendTone(
	measure: ReadingMeasure,
	value: number,
): 'gain' | 'loss' {
	return measure === 'deleted' || value < 0 ? 'loss' : 'gain';
}

/**
 * How darkly each day is shaded, signed where the measure can be: a positive
 * level is a gain, a negative one a loss, and zero is a day with nothing on
 * it. A goal answers in two states only -- it was met or it was not, and
 * shading a day at nine tenths of it would say the goal was nearly a thing
 * that happened.
 *
 * The bands for the other two come from the project's own days rather than
 * from a number chosen here, so a writer of two hundred words a day and one
 * of two thousand both see their good days stand out from their quiet ones.
 */
export function heatLevels(
	days: readonly DayReading[],
	measure: HeatmapMeasure,
	goal: number,
): number[] {
	if (measure === 'goal') {
		return days.map((day) =>
			goal > 0 && day.trackedNet >= goal ? HEAT_LEVELS : 0,
		);
	}
	// Deleted words are counted negative here rather than positive: the day
	// went backwards, and the grid says so in the colour a loss is drawn in.
	const value = (day: DayReading): number =>
		measure === 'time'
			? day.focusMs
			: measure === 'added'
				? day.added
				: measure === 'deleted'
					? -day.deleted
					: day.trackedNet;
	const bands = quartiles(days.map((day) => Math.abs(value(day))));
	return days.map((day) => {
		const size = Math.abs(value(day));
		if (size === 0) return 0;
		const level =
			size <= bands[0] ? 1 : size <= bands[1] ? 2 : size <= bands[2] ? 3 : 4;
		return value(day) < 0 ? -level : level;
	});
}

/** The three cuts that split a project's writing days into four bands. */
function quartiles(values: number[]): [number, number, number] {
	const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
	if (sorted.length === 0) return [0, 0, 0];
	const at = (share: number): number =>
		sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
	return [at(0.25), at(0.5), at(0.75)];
}

/** Which sittings a time-of-day reading is drawn from. */
export const BAND_SPANS = ['today', 'yesterday', 'all'] as const;
export type BandSpan = (typeof BAND_SPANS)[number];

/** What a project's sessions put into one part of a day. */
export interface BandTotals {
	focusMs: number;
	totalMs: number;
	added: number;
	deleted: number;
	trackedNet: number;
}

/** A day's parts with nothing in any of them. */
export function emptyBands(): BandTotals[] {
	return DAY_BANDS.map(() => ({
		focusMs: 0,
		totalMs: 0,
		added: 0,
		deleted: 0,
		trackedNet: 0,
	}));
}

/**
 * How one session's sitting and its writing fall across the parts of a day.
 *
 * The time is exact: every interval is cut at each boundary it crosses, so a
 * sitting from half past eight to ten is counted half an hour into the early
 * band and an hour into the next. The words are not, and cannot be -- a
 * session records what it observed being written, never the minute each word
 * arrived -- so they are spread over the session's own hours in the
 * proportion it was writing in them: by focus where there was any, and by the
 * sitting itself where the whole of it was idle. It is an apportionment, not
 * a timestamp, and the fractions it leaves are what a percentage is made of.
 */
export function sessionBands(
	record: Pick<
		WritingSessionRecord,
		'activeIntervals' | 'idleIntervals' | 'addedWordCount' | 'deletedWordCount'
	>,
	timeZone: string,
): BandTotals[] {
	const bands = emptyBands();
	const add = (list: readonly SessionInterval[], focus: boolean): void => {
		for (const span of list) {
			const spread = splitDayBands(
				Date.parse(span.startedAt),
				Date.parse(span.endedAt),
				timeZone,
			);
			for (const [at, ms] of spread.entries()) {
				const band = bands[at];
				if (band === undefined) continue;
				if (focus) band.focusMs += ms;
				band.totalMs += ms;
			}
		}
	};
	add(record.activeIntervals, true);
	add(record.idleIntervals, false);
	const focusMs = bands.reduce((carried, band) => carried + band.focusMs, 0);
	const totalMs = bands.reduce((carried, band) => carried + band.totalMs, 0);
	for (const band of bands) {
		const share =
			focusMs > 0
				? band.focusMs / focusMs
				: totalMs > 0
					? band.totalMs / totalMs
					: 0;
		band.added = record.addedWordCount * share;
		band.deleted = record.deletedWordCount * share;
		band.trackedNet = band.added - band.deleted;
	}
	return bands;
}

/** What one writing mode came to over the sessions that were in it. */
export interface ModeTotals {
	mode: WritingMode;
	sessions: number;
	focusMs: number;
	totalMs: number;
	trackedNet: number;
}

/** Every mode at nothing, in the order the stages of a manuscript come. */
export function emptyModes(): ModeTotals[] {
	return WRITING_MODES.map((mode) => ({
		mode,
		sessions: 0,
		focusMs: 0,
		totalMs: 0,
		trackedNet: 0,
	}));
}

export const SESSION_FILE_SUFFIX = '_writing_session.json';

/**
 * Where one device files one session:
 * `<root>/<sessions dir>/<year>/<year>_<month>_<device>_writing_session.json`.
 * The device id keeps two installations from ever appending to the same
 * file, so sync never has to merge; a reader gathers a month by prefix and
 * suffix and merges sessions by uuid.
 */
export function sessionFilePath(
	projectRoot: string,
	sessionsDir: string,
	startedAtMs: number,
	timeZone: string,
	deviceId: string,
): string {
	const { year, month } = sessionMonthKey(startedAtMs, timeZone);
	const base = sessionsFolder(projectRoot, sessionsDir);
	return `${base}/${year}/${year}_${month}_${deviceId}${SESSION_FILE_SUFFIX}`;
}

/** The year folder the month key files under, for gathering a whole month. */
export function sessionYearFolder(
	projectRoot: string,
	sessionsDir: string,
	year: string,
): string {
	return `${sessionsFolder(projectRoot, sessionsDir)}/${year}`;
}

/** The folder every year of a project's sessions is filed under. */
export function sessionsFolder(
	projectRoot: string,
	sessionsDir: string,
): string {
	return projectRoot.length === 0 ? sessionsDir : `${projectRoot}/${sessionsDir}`;
}

/**
 * MM:SS under an hour and HH:MM:SS from there on, every part two digits wide.
 * The hour appears only once there is one to report -- a length that has not
 * reached an hour says so by having no hour on it -- and the padding is what
 * keeps a column of readings a column rather than a ragged edge.
 */
export function formatClock(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const two = (value: number): string => String(value).padStart(2, '0');
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60) % 60;
	const hours = Math.floor(totalSeconds / 3600);
	return hours > 0
		? `${two(hours)}:${two(minutes)}:${two(seconds)}`
		: `${two(minutes)}:${two(seconds)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function parseIntervals(value: unknown): SessionInterval[] | null {
	if (!Array.isArray(value)) return null;
	const intervals: SessionInterval[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return null;
		if (!isIsoDate(entry.startedAt) || !isIsoDate(entry.endedAt)) return null;
		intervals.push({ startedAt: entry.startedAt, endedAt: entry.endedAt });
	}
	return intervals;
}

function parseFiles(value: unknown): SessionFileTally[] | null {
	if (!Array.isArray(value)) return null;
	const files: SessionFileTally[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return null;
		if (typeof entry.path !== 'string') return null;
		if (
			!isFiniteNumber(entry.added) ||
			!isFiniteNumber(entry.deleted) ||
			!isFiniteNumber(entry.net)
		) {
			return null;
		}
		files.push({
			path: entry.path,
			added: entry.added,
			deleted: entry.deleted,
			net: entry.net,
		});
	}
	return files;
}

function parseGoal(value: unknown): WritingSessionGoal | null | undefined {
	if (value === null || value === undefined) return null;
	if (!isRecord(value)) return undefined;
	const goal: WritingSessionGoal = {};
	if (value.netWordTarget !== undefined) {
		if (!isFiniteNumber(value.netWordTarget)) return undefined;
		goal.netWordTarget = value.netWordTarget;
	}
	if (value.focusTimeTargetSeconds !== undefined) {
		if (!isFiniteNumber(value.focusTimeTargetSeconds)) return undefined;
		goal.focusTimeTargetSeconds = value.focusTimeTargetSeconds;
	}
	return goal;
}

function parseTiming(value: unknown): WritingSessionTiming | null {
	if (!isRecord(value) || !isFiniteNumber(value.idleThresholdSeconds)) {
		return null;
	}
	const timing: WritingSessionTiming = {
		idleThresholdSeconds: value.idleThresholdSeconds,
	};
	for (const key of [
		'targetDurationSeconds',
		'workDurationSeconds',
		'breakDurationSeconds',
	] as const) {
		const entry = value[key];
		if (entry === undefined) continue;
		if (!isFiniteNumber(entry)) return null;
		timing[key] = entry;
	}
	if (value.autoRepeat !== undefined) {
		if (typeof value.autoRepeat !== 'boolean') return null;
		timing.autoRepeat = value.autoRepeat;
	}
	return timing;
}

/**
 * Reads a stored session back, strictly: a shape this build does not
 * recognize is rejected whole rather than coerced, so a corrupted or
 * newer-schema file is preserved aside instead of being rewritten wrong.
 */
export function parseSessionRecord(value: unknown): WritingSessionRecord | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== WRITING_SESSION_SCHEMA_VERSION) return null;
	if (typeof value.uuid !== 'string' || value.uuid.length === 0) return null;
	if (!isIsoDate(value.startedAt) || !isIsoDate(value.endedAt)) return null;
	if (typeof value.timezone !== 'string') return null;
	if (!isOneOf(WRITING_SESSION_SCOPES, value.countingScope)) return null;
	if (!isOneOf(WRITING_SESSION_TYPES, value.sessionType)) return null;
	if (value.startMode !== 'manual' && value.startMode !== 'auto') return null;
	if (!isOneOf(WRITING_MODES, value.writingMode)) return null;
	if (!isOneOf(SESSION_STOP_REASONS, value.stopReason)) return null;
	const activeIntervals = parseIntervals(value.activeIntervals);
	const idleIntervals = parseIntervals(value.idleIntervals);
	const pausedIntervals = parseIntervals(value.pausedIntervals);
	if (activeIntervals === null || idleIntervals === null || pausedIntervals === null) {
		return null;
	}
	for (const key of [
		'startWordCount',
		'endWordCount',
		'addedWordCount',
		'deletedWordCount',
		'netWordCount',
	] as const) {
		if (!isFiniteNumber(value[key])) return null;
	}
	const files = parseFiles(value.files);
	if (files === null) return null;
	const goal = parseGoal(value.goal);
	if (goal === undefined) return null;
	const timing = parseTiming(value.timing);
	if (timing === null) return null;
	return {
		uuid: value.uuid,
		schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
		startedAt: value.startedAt,
		endedAt: value.endedAt,
		timezone: value.timezone,
		countingScope: value.countingScope,
		sessionType: value.sessionType,
		startMode: value.startMode,
		writingMode: value.writingMode,
		stopReason: value.stopReason,
		activeIntervals,
		idleIntervals,
		pausedIntervals,
		startWordCount: value.startWordCount as number,
		endWordCount: value.endWordCount as number,
		addedWordCount: value.addedWordCount as number,
		deletedWordCount: value.deletedWordCount as number,
		netWordCount: value.netWordCount as number,
		files,
		goal,
		timing,
	};
}

export function parseMonthFile(value: unknown): WritingSessionMonthFile | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== WRITING_SESSION_SCHEMA_VERSION) return null;
	if (!Array.isArray(value.sessions)) return null;
	const sessions: WritingSessionRecord[] = [];
	for (const entry of value.sessions) {
		const session = parseSessionRecord(entry);
		if (session === null) return null;
		sessions.push(session);
	}
	return { schemaVersion: WRITING_SESSION_SCHEMA_VERSION, sessions };
}

export function parseSessionSnapshot(
	value: unknown,
): WritingSessionSnapshot | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== WRITING_SESSION_SCHEMA_VERSION) return null;
	if (typeof value.uuid !== 'string' || value.uuid.length === 0) return null;
	if (typeof value.projectRoot !== 'string') return null;
	if (typeof value.projectPath !== 'string') return null;
	if (typeof value.sessionsDir !== 'string' || value.sessionsDir.length === 0) {
		return null;
	}
	if (!isIsoDate(value.startedAt)) return null;
	if (typeof value.timezone !== 'string') return null;
	if (!isOneOf(WRITING_SESSION_SCOPES, value.countingScope)) return null;
	if (!isOneOf(WRITING_SESSION_TYPES, value.sessionType)) return null;
	if (value.startMode !== 'manual' && value.startMode !== 'auto') return null;
	if (!isOneOf(WRITING_MODES, value.writingMode)) return null;
	const goal = parseGoal(value.goal);
	if (goal === undefined) return null;
	const timing = parseTiming(value.timing);
	if (timing === null) return null;
	if (!isFiniteNumber(value.startWordCount)) return null;
	const activeIntervals = parseIntervals(value.activeIntervals);
	const idleIntervals = parseIntervals(value.idleIntervals);
	const pausedIntervals = parseIntervals(value.pausedIntervals);
	if (activeIntervals === null || idleIntervals === null || pausedIntervals === null) {
		return null;
	}
	if (
		value.openPhase !== 'focus' &&
		value.openPhase !== 'idle' &&
		value.openPhase !== 'paused'
	) {
		return null;
	}
	if (!isIsoDate(value.openStartedAt)) return null;
	if (!isIsoDate(value.capturedAt)) return null;
	if (!isIsoDate(value.lastActivityAt)) return null;
	if (
		!isFiniteNumber(value.addedWordCount) ||
		!isFiniteNumber(value.deletedWordCount)
	) {
		return null;
	}
	const files = parseFiles(value.files);
	if (files === null) return null;
	if (
		value.markedShutdown !== undefined &&
		typeof value.markedShutdown !== 'boolean'
	) {
		return null;
	}
	return {
		uuid: value.uuid,
		schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
		projectRoot: value.projectRoot,
		projectPath: value.projectPath,
		sessionsDir: value.sessionsDir,
		startedAt: value.startedAt,
		timezone: value.timezone,
		countingScope: value.countingScope,
		sessionType: value.sessionType,
		startMode: value.startMode,
		writingMode: value.writingMode,
		goal,
		timing,
		startWordCount: value.startWordCount,
		activeIntervals,
		idleIntervals,
		pausedIntervals,
		openPhase: value.openPhase,
		openStartedAt: value.openStartedAt,
		capturedAt: value.capturedAt,
		lastActivityAt: value.lastActivityAt,
		addedWordCount: value.addedWordCount,
		deletedWordCount: value.deletedWordCount,
		files,
		...(value.markedShutdown === true ? { markedShutdown: true } : {}),
	};
}

/**
 * Turns an orphaned snapshot into the finished session it describes. The
 * open stretch closes at `capturedAt` -- the moment the snapshot truly
 * represents -- and the end count is derived from the start and the tracked
 * net, because counting the vault at recovery time would measure a later
 * moment than the session lived through.
 */
export function finalizeSnapshot(
	snapshot: WritingSessionSnapshot,
): WritingSessionRecord {
	const activeIntervals = [...snapshot.activeIntervals];
	const idleIntervals = [...snapshot.idleIntervals];
	const pausedIntervals = [...snapshot.pausedIntervals];
	const openFrom = Date.parse(snapshot.openStartedAt);
	const capturedAt = Date.parse(snapshot.capturedAt);
	if (capturedAt > openFrom) {
		const closed = {
			startedAt: snapshot.openStartedAt,
			endedAt: snapshot.capturedAt,
		};
		if (snapshot.openPhase === 'focus') activeIntervals.push(closed);
		else if (snapshot.openPhase === 'idle') idleIntervals.push(closed);
		else pausedIntervals.push(closed);
	}
	const net = snapshot.addedWordCount - snapshot.deletedWordCount;
	return {
		uuid: snapshot.uuid,
		schemaVersion: WRITING_SESSION_SCHEMA_VERSION,
		startedAt: snapshot.startedAt,
		endedAt: snapshot.capturedAt,
		timezone: snapshot.timezone,
		countingScope: snapshot.countingScope,
		sessionType: snapshot.sessionType,
		startMode: snapshot.startMode,
		writingMode: snapshot.writingMode,
		stopReason: snapshot.markedShutdown === true ? 'app-shutdown' : 'recovered',
		activeIntervals,
		idleIntervals,
		pausedIntervals,
		startWordCount: snapshot.startWordCount,
		endWordCount: snapshot.startWordCount + net,
		addedWordCount: snapshot.addedWordCount,
		deletedWordCount: snapshot.deletedWordCount,
		netWordCount: net,
		files: [...snapshot.files],
		goal: snapshot.goal,
		timing: snapshot.timing,
	};
}
