/**
 * What the relationship graph's timeline strip computes, apart from the
 * drawing: whether the axis's points have room on the rail, and the pace a
 * time-lapse runs at. Pure, so the strip can ask on every frame.
 *
 * The time-lapse is Obsidian's own graph's, laid along the axis. The native
 * one reveals its links one at a time off the clock, at half the square
 * root of their number a second, never fewer than five nor more than a
 * hundred; here the lines each time brings are revealed at that pace, a
 * time that changes something is held long enough to be read, and a time
 * that changes nothing is passed over, so the clock is spent where the
 * picture moves.
 */

/** How long a time that changes something is held, in ms, however few lines it brings. */
export const TIMELINE_DWELL_MS = 800;

/** The least room a point is given on the rail, in px: closer than this the points run into one bar. */
export const TIMELINE_TICK_ROOM = 12;

/** The native time-lapse's pace for a number of lines, in lines a second. */
export function playbackSpeed(lines: number): number {
	return Math.min(100, Math.max(5, 0.5 * Math.sqrt(Math.max(0, lines))));
}

/** What one time changes, as the pace counts it. */
export interface PlaybackChange {
	readonly entering: number;
	readonly leaving: number;
}

/** One time the time-lapse stops on: when it is reached, how long it is held, and how many lines come in over that. */
export interface PlaybackStep {
	readonly index: number;
	readonly startMs: number;
	readonly durationMs: number;
	readonly entering: number;
}

export interface PlaybackSchedule {
	readonly steps: readonly PlaybackStep[];
	readonly totalMs: number;
	/** Lines a second. */
	readonly speed: number;
	/** Whether the lines of a time come one at a time and the thumb glides; off, each time is set whole. */
	readonly stagger: boolean;
}

export interface PlaybackOptions {
	/**
	 * Whether the time play starts on is shown from nothing, its own lines
	 * coming in like any other's: a time-lapse begun over. Otherwise it
	 * stands as it is drawn and play carries on from it.
	 */
	readonly fresh: boolean;
	/** Off under reduced motion: no line-by-line reveal and no glide. */
	readonly stagger: boolean;
}

/**
 * The time-lapse from a point of the axis to its end: the time it starts
 * on, then every later time at which a line comes or goes.
 */
export function playbackSchedule(
	changes: readonly PlaybackChange[],
	from: number,
	options: PlaybackOptions,
): PlaybackSchedule {
	const first = Math.max(0, Math.min(from, changes.length - 1));
	const stops: { index: number; entering: number }[] = [];
	changes.forEach((change, index) => {
		if (index < first) return;
		if (index === first) {
			stops.push({ index, entering: options.fresh ? change.entering : 0 });
			return;
		}
		if (change.entering + change.leaving > 0) stops.push({ index, entering: change.entering });
	});
	const speed = playbackSpeed(stops.reduce((sum, stop) => sum + stop.entering, 0));
	let startMs = 0;
	const steps = stops.map((stop): PlaybackStep => {
		const reveal = options.stagger ? (stop.entering / speed) * 1000 : 0;
		const step = { index: stop.index, startMs, durationMs: Math.max(TIMELINE_DWELL_MS, reveal), entering: stop.entering };
		startMs += step.durationMs;
		return step;
	});
	return { steps, totalMs: startMs, speed, stagger: options.stagger };
}

/** Where a time-lapse stands a while after it began. */
export interface PlaybackFrame {
	/** The time the picture is of. */
	readonly index: number;
	/** How many of that time's entering lines are shown. */
	readonly revealed: number;
	/** Where the thumb stands along the axis: on a time, or on its way to the next the time-lapse stops on. */
	readonly thumb: number;
	readonly done: boolean;
}

export function playbackFrame(schedule: PlaybackSchedule, elapsedMs: number): PlaybackFrame {
	const { steps } = schedule;
	const last = steps[steps.length - 1];
	if (last === undefined) return { index: 0, revealed: 0, thumb: 0, done: true };
	const elapsed = Math.max(0, elapsedMs);
	let at = 0;
	while (at < steps.length - 1 && (steps[at + 1]?.startMs ?? Number.POSITIVE_INFINITY) <= elapsed) at += 1;
	const step = steps[at] ?? last;
	const done = elapsed >= schedule.totalMs;
	if (!schedule.stagger) return { index: step.index, revealed: step.entering, thumb: step.index, done };
	const within = Math.min(step.durationMs, elapsed - step.startMs);
	// The first line stands as the time is reached, as the native time-lapse's does.
	const revealed = step.entering === 0 ? 0 : Math.min(step.entering, Math.floor((within / 1000) * schedule.speed) + 1);
	const next = steps[at + 1];
	const thumb =
		next === undefined || step.durationMs <= 0
			? step.index
			: step.index + (next.index - step.index) * (within / step.durationMs);
	return { index: step.index, revealed, thumb, done };
}

/**
 * Whether the axis's points can be told apart at the rail's width. A project
 * with hundreds of times has them a pixel or two apart, where the points
 * would only thicken the track from end to end; they are drawn while each
 * has its room, and always before the rail has a width to judge by.
 */
export function ticksFit(count: number, railWidth: number, room = TIMELINE_TICK_ROOM): boolean {
	if (count < 2 || !(railWidth > 0)) return true;
	return railWidth / (count - 1) >= room;
}
