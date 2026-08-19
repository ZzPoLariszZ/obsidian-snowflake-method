import { describe, expect, it } from 'vitest';

import {
	HEAT_LEVELS,
	SessionTracker,
	axisScale,
	finalizeSnapshot,
	heatLevels,
	formatClock,
	parseMonthFile,
	parseSessionRecord,
	parseSessionSnapshot,
	sessionDurations,
	sessionFilePath,
	sessionMonthKey,
	sessionBands,
	sessionNets,
	shouldDiscard,
	tallyScopes,
	trendTone,
	emptyModes,
	type DayReading,
	type SessionTrackerConfig,
	type TrackerEffect,
	type WritingSessionRecord,
	type WritingSessionSnapshot,
} from '../../src/domain';

const T0 = Date.parse('2026-08-17T10:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const STOPWATCH: SessionTrackerConfig = {
	type: 'stopwatch',
	idleThresholdMs: 60 * SECOND,
};

/** The three lists as [from, to] offsets from T0 in seconds, merged sorted. */
const spans = (list: readonly { from: number; to: number }[]): number[][] =>
	list.map((span) => [(span.from - T0) / SECOND, (span.to - T0) / SECOND]);

const kinds = (effects: TrackerEffect[]): string[] =>
	effects.map((effect) => effect.kind);

describe('the session tracker', () => {
	it('keeps the grace period as focus and the rest as idle', () => {
		// The spec's own example: stop typing at T, resume at T+200s, with a
		// 60s threshold. [T, T+60) stays Focus, [T+60, T+200) is Idle.
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.activity(T0);
		tracker.activity(T0 + 200 * SECOND);
		const stopped = tracker.stop(T0 + 210 * SECOND);
		expect(spans(stopped.active)).toEqual([
			[0, 60],
			[200, 210],
		]);
		expect(spans(stopped.idle)).toEqual([[60, 200]]);
	});

	it('never opens idle when typing resumes inside the grace', () => {
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.activity(T0 + 30 * SECOND);
		const stopped = tracker.stop(T0 + 45 * SECOND);
		expect(spans(stopped.active)).toEqual([[0, 45]]);
		expect(stopped.idle).toHaveLength(0);
	});

	it('splits a long sleep retroactively at the grace boundary', () => {
		// No tick fired for two hours; the first event afterwards must place
		// the split where the grace ran out, not where it was noticed.
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.activity(T0 + 10 * SECOND);
		const effects = tracker.tick(T0 + 2 * 60 * MINUTE);
		expect(kinds(effects)).toEqual(['went-idle']);
		const stopped = tracker.stop(T0 + 2 * 60 * MINUTE);
		expect(spans(stopped.active)).toEqual([[0, 70]]);
		expect(spans(stopped.idle)).toEqual([[70, 7200]]);
	});

	it('knows nothing but silence: only the threshold opens idle', () => {
		// Leaving the editor, or the app, used to open idle at once. Now the
		// only clock is the last edit's, and a stretch shorter than the grace
		// leaves no idle behind however far the author wandered.
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.activity(T0 + 10 * SECOND);
		tracker.tick(T0 + 40 * SECOND);
		const stopped = tracker.stop(T0 + 55 * SECOND);
		expect(spans(stopped.active)).toEqual([[0, 55]]);
		expect(stopped.idle).toHaveLength(0);
	});

	it('slices pauses out and restarts the grace on resume', () => {
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.pause(T0 + 30 * SECOND);
		// Typing while paused resumes nothing.
		tracker.activity(T0 + 60 * SECOND);
		tracker.resume(T0 + 90 * SECOND);
		const stopped = tracker.stop(T0 + 120 * SECOND);
		expect(spans(stopped.active)).toEqual([
			[0, 30],
			[90, 120],
		]);
		expect(spans(stopped.paused)).toEqual([[30, 90]]);
		expect(stopped.idle).toHaveLength(0);
	});

	it('completes a countdown at the exact deadline, idle or not', () => {
		const tracker = new SessionTracker(
			{ type: 'countdown', idleThresholdMs: 60 * SECOND, targetDurationMs: 10 * MINUTE },
			T0,
		);
		const effects = tracker.tick(T0 + 3 * 60 * MINUTE);
		expect(kinds(effects)).toEqual(['went-idle', 'completion-due']);
		const due = effects.find((effect) => effect.kind === 'completion-due');
		expect(due?.at).toBe(T0 + 10 * MINUTE);
		const stopped = tracker.stop(due?.at ?? 0);
		expect(stopped.endedAt).toBe(T0 + 10 * MINUTE);
		expect(spans(stopped.active)).toEqual([[0, 60]]);
		expect(spans(stopped.idle)).toEqual([[60, 600]]);
	});

	it('freezes the countdown while paused and resumes where it left off', () => {
		const tracker = new SessionTracker(
			{ type: 'countdown', idleThresholdMs: 60 * SECOND, targetDurationMs: 10 * MINUTE },
			T0,
		);
		tracker.pause(T0 + 5 * MINUTE);
		expect(kinds(tracker.tick(T0 + 3 * 60 * MINUTE))).toEqual([]);
		tracker.resume(T0 + 3 * 60 * MINUTE);
		const effects = tracker.tick(T0 + 3 * 60 * MINUTE + 5 * MINUTE);
		const due = effects.find((effect) => effect.kind === 'completion-due');
		expect(due?.at).toBe(T0 + 3 * 60 * MINUTE + 5 * MINUTE);
	});

	it('rolls a repeating pomodoro through its periods, even from one late tick', () => {
		const tracker = new SessionTracker(
			{
				type: 'pomodoro',
				idleThresholdMs: 60 * MINUTE,
				workDurationMs: 2 * MINUTE,
				breakDurationMs: 1 * MINUTE,
				autoRepeat: true,
			},
			T0,
		);
		const effects = tracker.tick(T0 + 7 * MINUTE);
		expect(
			effects.map((effect) =>
				'cycle' in effect ? `${effect.kind}:${effect.cycle}` : effect.kind,
			),
		).toEqual([
			'break-started:1',
			'work-started:2',
			'break-started:2',
			'work-started:3',
		]);
		expect(tracker.currentPomodoro()).toEqual({ phase: 'work', cycle: 3 });
		const stopped = tracker.stop(T0 + 7 * MINUTE);
		// Breaks are paused time: outside Total, spec-literally "pause".
		expect(spans(stopped.paused)).toEqual([
			[120, 180],
			[300, 360],
		]);
	});

	it('ends a non-repeating pomodoro when its break runs out', () => {
		const tracker = new SessionTracker(
			{
				type: 'pomodoro',
				idleThresholdMs: 60 * MINUTE,
				workDurationMs: 2 * MINUTE,
				breakDurationMs: 1 * MINUTE,
				autoRepeat: false,
			},
			T0,
		);
		const effects = tracker.tick(T0 + 10 * MINUTE);
		expect(kinds(effects)).toEqual(['break-started', 'completion-due']);
		const due = effects.find((effect) => effect.kind === 'completion-due');
		expect(due?.at).toBe(T0 + 3 * MINUTE);
		const stopped = tracker.stop(due?.at ?? 0);
		expect(spans(stopped.active)).toEqual([[0, 120]]);
		expect(spans(stopped.paused)).toEqual([[120, 180]]);
	});

	it('lets no one resume a break by hand', () => {
		const tracker = new SessionTracker(
			{
				type: 'pomodoro',
				idleThresholdMs: 60 * MINUTE,
				workDurationMs: 1 * MINUTE,
				breakDurationMs: 5 * MINUTE,
				autoRepeat: true,
			},
			T0,
		);
		tracker.tick(T0 + 90 * SECOND);
		expect(tracker.currentPhase()).toBe('paused');
		tracker.resume(T0 + 100 * SECOND);
		expect(tracker.currentPhase()).toBe('paused');
	});

	it('covers the whole session with disjoint, ordered intervals', () => {
		const tracker = new SessionTracker(
			{
				type: 'pomodoro',
				idleThresholdMs: 60 * SECOND,
				workDurationMs: 3 * MINUTE,
				breakDurationMs: 1 * MINUTE,
				autoRepeat: true,
			},
			T0,
		);
		tracker.activity(T0 + 20 * SECOND);
		tracker.activity(T0 + 2 * MINUTE);
		tracker.pause(T0 + 150 * SECOND);
		tracker.resume(T0 + 200 * SECOND);
		const stopped = tracker.stop(T0 + 11 * MINUTE);
		const all = [...stopped.active, ...stopped.idle, ...stopped.paused].sort(
			(a, b) => a.from - b.from,
		);
		expect(all[0]?.from).toBe(T0);
		expect(all[all.length - 1]?.to).toBe(stopped.endedAt);
		for (let i = 1; i < all.length; i += 1) {
			expect(all[i]?.from).toBe(all[i - 1]?.to);
		}
	});

	it('reports the durations of the open stretch too', () => {
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.tick(T0 + 90 * SECOND);
		const at = tracker.durations(T0 + 90 * SECOND);
		expect(at.focusMs).toBe(60 * SECOND);
		expect(at.idleMs).toBe(30 * SECOND);
		expect(at.totalMs).toBe(90 * SECOND);
	});

	it('serializes the open stretch after being ticked to the capture moment', () => {
		const tracker = new SessionTracker(STOPWATCH, T0);
		tracker.tick(T0 + 2 * MINUTE);
		const serialized = tracker.serialize();
		expect(serialized.openPhase).toBe('idle');
		expect(serialized.openStartedAt).toBe(
			new Date(T0 + 60 * SECOND).toISOString(),
		);
		expect(serialized.lastActivityAt).toBe(new Date(T0).toISOString());
	});
});

const record = (
	overrides: Partial<WritingSessionRecord> = {},
): WritingSessionRecord => ({
	id: 'session-a',
	schemaVersion: 1,
	startedAt: new Date(T0).toISOString(),
	endedAt: new Date(T0 + 10 * MINUTE).toISOString(),
	timezone: 'UTC',
	sessionType: 'stopwatch',
	startMode: 'manual',
	writingMode: 'draft',
	stopReason: 'manual',
	activeIntervals: [
		{
			startedAt: new Date(T0).toISOString(),
			endedAt: new Date(T0 + 8 * MINUTE).toISOString(),
		},
	],
	idleIntervals: [
		{
			startedAt: new Date(T0 + 8 * MINUTE).toISOString(),
			endedAt: new Date(T0 + 10 * MINUTE).toISOString(),
		},
	],
	pausedIntervals: [],
	words: {
		project: { start: 1000, end: 1700, added: 520, deleted: 20, net: 500 },
		manuscript: { start: 600, end: 900, added: 320, deleted: 20, net: 300 },
	},
	files: [
		{
			path: 'Novel/50_Manuscript/One.md',
			added: 320,
			deleted: 20,
			net: 300,
			manuscript: true,
		},
		{
			path: 'Novel/20_Character/Ana.md',
			added: 200,
			deleted: 0,
			net: 200,
			manuscript: false,
		},
	],
	timing: { idleThresholdSeconds: 60 },
	...overrides,
});

describe('session arithmetic', () => {
	it('tells tracked net, scope net change, and the gap apart', () => {
		const nets = sessionNets(record(), 'project');
		expect(nets.trackedNet).toBe(500);
		expect(nets.scopeNetChange).toBe(700);
		expect(nets.otherChanges).toBe(200);
	});

	/**
	 * The same sitting, asked the other question. A session records both, so
	 * which one is read is the reader's to choose and never the record's.
	 */
	it('answers for whichever scope it is asked about', () => {
		const nets = sessionNets(record(), 'manuscript');
		expect(nets.trackedNet).toBe(300);
		expect(nets.scopeNetChange).toBe(300);
		expect(nets.otherChanges).toBe(0);
	});

	/**
	 * A note's whole contribution is read under the membership it has now, so
	 * the scope totals are a sum over the files and never a second copy of the
	 * number that could drift from them.
	 */
	it('sums each scope from the per-note tallies', () => {
		const totals = tallyScopes(record().files);
		expect(totals.project).toEqual({ added: 520, deleted: 20 });
		expect(totals.manuscript).toEqual({ added: 320, deleted: 20 });
	});

	it('moves a note\u2019s whole tally when its membership moves', () => {
		const files = record().files.map((file) => ({ ...file, manuscript: true }));
		expect(tallyScopes(files).manuscript).toEqual({ added: 520, deleted: 20 });
	});

	it('discards only a short session with nothing written', () => {
		const short = (added: number, deleted: number, seconds: number) =>
			shouldDiscard(
				record({
					activeIntervals: [
						{
							startedAt: new Date(T0).toISOString(),
							endedAt: new Date(T0 + seconds * SECOND).toISOString(),
						},
					],
					idleIntervals: [],
					words: {
						project: { start: 0, end: 0, added, deleted, net: added - deleted },
						manuscript: { start: 0, end: 0, added: 0, deleted: 0, net: 0 },
					},
				}),
			);
		expect(short(0, 0, 14.9)).toBe(true);
		expect(short(1, 0, 14.9)).toBe(false);
		expect(short(0, 1, 14.9)).toBe(false);
		expect(short(0, 0, 15)).toBe(false);
	});

	it('sums durations from the stored intervals', () => {
		const durations = sessionDurations(record());
		expect(durations.focusMs).toBe(8 * MINUTE);
		expect(durations.idleMs).toBe(2 * MINUTE);
		expect(durations.totalMs).toBe(10 * MINUTE);
	});

	/**
	 * The hour shows once there is one to show, and every part is two digits
	 * wide, so a column of readings stays a column.
	 */
	it('formats a clock the way a timer reads, padded throughout', () => {
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(61 * SECOND)).toBe('01:01');
		expect(formatClock(2723 * SECOND)).toBe('45:23');
		expect(formatClock(3661 * SECOND)).toBe('01:01:01');
		expect(formatClock(360_000 * SECOND)).toBe('100:00:00');
	});
});

describe('the monthly file a session lands in', () => {
	it('files by the start moment in the session zone', () => {
		const lateAugustUtc = Date.parse('2026-08-31T23:30:00.000Z');
		expect(sessionMonthKey(lateAugustUtc, 'Pacific/Auckland')).toEqual({
			year: '2026',
			month: '09',
		});
		expect(sessionMonthKey(lateAugustUtc, 'America/Los_Angeles')).toEqual({
			year: '2026',
			month: '08',
		});
	});

	it('falls back to the machine zone for a zone it does not know', () => {
		const key = sessionMonthKey(T0, 'Not/AZone');
		expect(key.year).toMatch(/^\d{4}$/);
		expect(key.month).toMatch(/^\d{2}$/);
	});

	it('names the file with year, month and device', () => {
		expect(
			sessionFilePath(
				'Snowflake Projects/Novel',
				'70_Tool/71_Statistics/711_Writing_Session',
				T0,
				'UTC',
				'device-1',
			),
		).toBe(
			'Snowflake Projects/Novel/70_Tool/71_Statistics/711_Writing_Session/2026/2026_08_device-1_writing_session.json',
		);
	});
});

describe('reading stored sessions back', () => {
	it('round-trips a record through JSON', () => {
		const stored = record();
		expect(parseSessionRecord(JSON.parse(JSON.stringify(stored)))).toEqual(
			stored,
		);
	});

	/**
	 * A stored net is derived from its own halves rather than trusted: a
	 * number kept twice is a number that can disagree with itself, and a
	 * hand-merged file must not make one reading of a session disagree with
	 * another about what its halves add up to.
	 */
	it('derives every net from added and deleted', () => {
		const drifted = JSON.parse(JSON.stringify(record())) as {
			words: { project: { net: number } };
			files: { net: number }[];
		};
		drifted.words.project.net = 999_999;
		if (drifted.files[0]) drifted.files[0].net = -999_999;
		const parsed = parseSessionRecord(drifted);
		expect(parsed?.words.project.net).toBe(500);
		expect(parsed?.files[0]?.net).toBe(
			(parsed?.files[0]?.added ?? 0) - (parsed?.files[0]?.deleted ?? 0),
		);
	});

	it('rejects a shape it does not recognize, whole', () => {
		expect(parseSessionRecord(record({ schemaVersion: 2 as never }))).toBeNull();
		expect(
			parseSessionRecord(record({ stopReason: 'rage-quit' as never })),
		).toBeNull();
		expect(
			parseSessionRecord(
				record({ words: { project: { added: '520' } } as never }),
			),
		).toBeNull();
		// Both readings or none: a record that names only one is a record
		// half of whose questions cannot be answered.
		expect(
			parseSessionRecord(record({ words: { project: record().words.project } as never })),
		).toBeNull();
		expect(
			parseSessionRecord(
				record({ files: [{ path: 'One.md', added: 1, deleted: 0, net: 1 }] as never }),
			),
		).toBeNull();
		expect(
			parseSessionRecord(
				record({ activeIntervals: [{ startedAt: 'now' } as never] }),
			),
		).toBeNull();
	});

	it('round-trips a month file and rejects one bad session in it', () => {
		const file = { schemaVersion: 1, sessions: [record()] };
		expect(parseMonthFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
		expect(
			parseMonthFile({ schemaVersion: 1, sessions: [record(), { id: 'x' }] }),
		).toBeNull();
	});
});

const snapshot = (
	overrides: Partial<WritingSessionSnapshot> = {},
): WritingSessionSnapshot => ({
	id: 'session-live',
	schemaVersion: 1,
	projectRoot: 'Snowflake Projects/Novel',
	projectPath: 'Snowflake Projects/Novel/001_Project_Metadata.md',
	sessionsDir: '70_Tool/71_Data_Statistics/711_Writing_Session',
	startedAt: new Date(T0).toISOString(),
	timezone: 'UTC',
	sessionType: 'stopwatch',
	startMode: 'auto',
	writingMode: 'draft',
	timing: { idleThresholdSeconds: 60 },
	start: { project: 2000, manuscript: 800 },
	activeIntervals: [
		{
			startedAt: new Date(T0).toISOString(),
			endedAt: new Date(T0 + 5 * MINUTE).toISOString(),
		},
	],
	idleIntervals: [],
	pausedIntervals: [],
	openPhase: 'idle',
	openStartedAt: new Date(T0 + 5 * MINUTE).toISOString(),
	capturedAt: new Date(T0 + 6 * MINUTE).toISOString(),
	lastActivityAt: new Date(T0 + 4 * MINUTE).toISOString(),
	files: [
		{
			path: 'Novel/50_Manuscript/One.md',
			added: 90,
			deleted: 20,
			net: 70,
			manuscript: true,
		},
		{
			path: 'Novel/20_Character/Ana.md',
			added: 30,
			deleted: 0,
			net: 30,
			manuscript: false,
		},
	],
	...overrides,
});

describe('recovering an orphaned session', () => {
	it('round-trips a snapshot through JSON and rejects garbage', () => {
		const stored = snapshot();
		expect(parseSessionSnapshot(JSON.parse(JSON.stringify(stored)))).toEqual(
			stored,
		);
		expect(parseSessionSnapshot(null)).toBeNull();
		expect(parseSessionSnapshot({ id: 'x' })).toBeNull();
		expect(
			parseSessionSnapshot(snapshot({ capturedAt: 'yesterday-ish' })),
		).toBeNull();
	});

	it('finalizes at the captured moment, keeping the idle already seen', () => {
		const finalized = finalizeSnapshot(snapshot());
		expect(finalized.stopReason).toBe('recovered');
		expect(finalized.endedAt).toBe(new Date(T0 + 6 * MINUTE).toISOString());
		// The open idle stretch closes at capturedAt, not at the last edit.
		expect(finalized.idleIntervals).toEqual([
			{
				startedAt: new Date(T0 + 5 * MINUTE).toISOString(),
				endedAt: new Date(T0 + 6 * MINUTE).toISOString(),
			},
		]);
		// Neither scope was recounted: each end derives from its own start
		// and the net its own files add up to.
		expect(finalized.words.project).toEqual({
			start: 2000,
			end: 2100,
			added: 120,
			deleted: 20,
			net: 100,
		});
		expect(finalized.words.manuscript).toEqual({
			start: 800,
			end: 870,
			added: 90,
			deleted: 20,
			net: 70,
		});
	});

	it('reads a marked shutdown as one', () => {
		expect(finalizeSnapshot(snapshot({ markedShutdown: true })).stopReason).toBe(
			'app-shutdown',
		);
	});

	/**
	 * A bar standing on the axis says by its colour what a bar hanging below
	 * the axis would have said by its place, so the rule is the only thing
	 * telling a loss from a gain.
	 */
	it('colours a trend bar by which way its day went', () => {
		expect(trendTone('added', 400)).toBe('gain');
		expect(trendTone('added', 0)).toBe('gain');
		expect(trendTone('net', 400)).toBe('gain');
		expect(trendTone('net', -400)).toBe('loss');
		// Deleted words are a loss however many of them there were.
		expect(trendTone('deleted', 400)).toBe('loss');
		expect(trendTone('deleted', 0)).toBe('loss');
	});

	/** A day of the grid, built from the one number a test cares about. */
	const reading = (
		trackedNet: number,
		focusMs = Math.abs(trackedNet) * 1000,
	): DayReading => ({
		trackedNet,
		added: Math.max(0, trackedNet),
		deleted: Math.max(0, -trackedNet),
		focusMs,
		goalNet: trackedNet,
	});

	/**
	 * The four readings share one measure, so the grid has to answer for all of
	 * it -- and deleted words are a day going backwards however they are
	 * counted, which is why they shade as a loss from a positive number.
	 */
	it('shades added words as a gain and deleted words as a loss', () => {
		const days = [reading(300), reading(-300), reading(0, 0)];
		const sign = (levels: number[]): number[] => levels.map(Math.sign);
		// The strength is the project's own business; the direction is not.
		expect(sign(heatLevels(days, 'added', 0))).toEqual([1, 0, 0]);
		expect(sign(heatLevels(days, 'deleted', 0))).toEqual([0, -1, 0]);
		expect(sign(heatLevels(days, 'net', 0))).toEqual([1, -1, 0]);
		expect(sign(heatLevels(days, 'time', 0))).toEqual([1, 1, 0]);
	});

	/**
	 * A day is shaded against the project's own days rather than a fixed
	 * number, so what is asserted is the shape of the answer and not the cuts
	 * themselves: every strength is used, a bigger day is never fainter than a
	 * smaller one, and a day that lost words is the same strength as the day
	 * that gained as many, only signed.
	 */
	it('bands a project by its own days and signs the losses', () => {
		const counts = [100, 200, 300, 400, 500, 600, 700, 800];
		const days = [...counts, 0, -500].map((net) => reading(net));

		const levels = heatLevels(days, 'net', 0);
		const written = levels.slice(0, counts.length);
		expect(new Set(written)).toEqual(new Set([1, 2, 3, 4]));
		expect([...written].sort((a, b) => a - b)).toEqual(written);
		expect(levels[counts.length]).toBe(0);
		// The day that lost five hundred, against the day that gained them.
		expect(levels[counts.length + 1]).toBe(-(written[4] as number));
		// Focus reads the same days through their time, which here runs with
		// their words, so it lands on the same bands.
		expect(heatLevels(days, 'time', 0).map(Math.abs)).toEqual(
			levels.map(Math.abs),
		);
	});

	it('shades a day of nothing at all at nothing at all', () => {
		const quiet = [0, 0, 0].map(() => reading(0, 0));
		expect(heatLevels(quiet, 'net', 0)).toEqual([0, 0, 0]);
		expect(heatLevels([], 'net', 500)).toEqual([]);
	});

	/**
	 * A goal is met or it is not: a day at nine tenths of one is a day the
	 * goal was not met, and half-shading it would say otherwise.
	 */
	it('reads a daily goal as met or unmet and nothing between', () => {
		const days = [499, 500, 501, 5000, -600].map((net) => reading(net, 0));

		expect(heatLevels(days, 'goal', 500)).toEqual([
			0,
			HEAT_LEVELS,
			HEAT_LEVELS,
			HEAT_LEVELS,
			0,
		]);
		// With no goal set there is nothing for a day to have met.
		expect(heatLevels(days, 'goal', 0)).toEqual([0, 0, 0, 0, 0]);
	});

	/**
	 * The goal is judged on its own scope, not on the one the grid happens to
	 * be showing. Switching what the charts read must not change which days
	 * met the target, so the two numbers travel side by side.
	 */
	it('judges the goal on its own net, whatever the grid is showing', () => {
		const days: DayReading[] = [
			{ trackedNet: 900, added: 900, deleted: 0, focusMs: 0, goalNet: 100 },
			{ trackedNet: 100, added: 100, deleted: 0, focusMs: 0, goalNet: 900 },
		];
		expect(heatLevels(days, 'goal', 500)).toEqual([0, HEAT_LEVELS]);
	});

	/**
	 * The tallest day is deliberately not the ceiling. A scale that ends
	 * exactly at the record says the record twice -- once on the axis and once
	 * in the readings underneath -- and gives the other days nothing round to
	 * be measured against.
	 */
	it('rules a word chart at round numbers above its tallest day', () => {
		expect(axisScale(1912, 'net')).toEqual({ top: 2000, step: 500 });
		expect(axisScale(2000, 'added')).toEqual({ top: 2000, step: 500 });
		expect(axisScale(699, 'deleted')).toEqual({ top: 800, step: 200 });
		expect(axisScale(7, 'net')).toEqual({ top: 8, step: 2 });
		// A stretch with nothing written in it still has an axis.
		expect(axisScale(0, 'net')).toEqual({ top: 1, step: 1 });
	});

	it('rules a time chart at the divisions of an hour', () => {
		const minute = 60_000;
		const hour = 3_600_000;
		expect(axisScale(3 * hour, 'time')).toEqual({ top: 3 * hour, step: hour });
		expect(axisScale(50 * minute, 'time')).toEqual({
			top: 60 * minute,
			step: 15 * minute,
		});
		expect(axisScale(20 * minute, 'time')).toEqual({
			top: 20 * minute,
			step: 5 * minute,
		});
		expect(axisScale(8 * hour, 'time')).toEqual({
			top: 8 * hour,
			step: 2 * hour,
		});
		// A day only holds twenty-four hours, so the step past that is a
		// fallback rather than a reading -- but it still has to be round.
		expect(axisScale(100 * hour, 'time')).toEqual({
			top: 144 * hour,
			step: 48 * hour,
		});
	});

	/** Every ceiling reaches its own tallest day, whatever the numbers are. */
	it('never rules a chart below the day it has to hold', () => {
		for (const max of [1, 9, 10, 11, 99, 251, 999, 1001, 123_456]) {
			const scale = axisScale(max, 'net');
			expect(scale.top, `${max}`).toBeGreaterThanOrEqual(max);
			expect(Math.round(scale.top / scale.step)).toBeLessThanOrEqual(5);
		}
	});
});

describe('a session across the parts of a day', () => {
	const sitting = (
		from: string,
		to: string,
		words = 0,
	): Pick<
		WritingSessionRecord,
		'activeIntervals' | 'idleIntervals' | 'words'
	> => ({
		activeIntervals: [{ startedAt: from, endedAt: to }],
		idleIntervals: [],
		words: {
			project: { start: 0, end: words, added: words, deleted: 0, net: words },
			manuscript: { start: 0, end: 0, added: 0, deleted: 0, net: 0 },
		},
	});

	it('cuts a sitting at every boundary it crosses', () => {
		const bands = sessionBands(
			sitting('2026-08-18T08:00:00Z', '2026-08-18T13:00:00Z'),
			'UTC',
			'project',
		);
		expect(bands[0]?.focusMs).toBe(3_600_000);
		expect(bands[1]?.focusMs).toBe(3 * 3_600_000);
		expect(bands[2]?.focusMs).toBe(3_600_000);
		expect(bands[0]?.totalMs).toBe(3_600_000);
	});

	/**
	 * A session records what it observed being written, never the minute each
	 * word arrived, so the words follow the hours the session was writing in.
	 */
	it('spreads the words over the hours in the proportion of the focus', () => {
		const bands = sessionBands(
			sitting('2026-08-18T08:00:00Z', '2026-08-18T10:00:00Z', 300),
			'UTC',
			'project',
		);
		// An hour before nine and an hour after it: half the words each.
		expect(bands[0]?.added).toBe(150);
		expect(bands[1]?.added).toBe(150);
		expect(bands[0]?.trackedNet).toBe(150);
		const total = bands.reduce((carried, band) => carried + band.added, 0);
		expect(total).toBe(300);
	});

	it('falls back to the sitting itself where none of it was focus', () => {
		const bands = sessionBands(
			{
				activeIntervals: [],
				idleIntervals: [
					{ startedAt: '2026-08-18T13:00:00Z', endedAt: '2026-08-18T14:00:00Z' },
				],
				words: {
					project: { start: 0, end: 30, added: 40, deleted: 10, net: 30 },
					manuscript: { start: 0, end: 0, added: 0, deleted: 0, net: 0 },
				},
			},
			'UTC',
			'project',
		);
		expect(bands[2]?.added).toBe(40);
		expect(bands[2]?.deleted).toBe(10);
		expect(bands[2]?.trackedNet).toBe(30);
		expect(bands[2]?.focusMs).toBe(0);
		expect(bands[2]?.totalMs).toBe(3_600_000);
	});

	it('leaves a session of no length with nothing in any part', () => {
		const bands = sessionBands(
			sitting('2026-08-18T08:00:00Z', '2026-08-18T08:00:00Z', 90),
			'UTC',
			'project',
		);
		expect(bands.every((band) => band.added === 0 && band.totalMs === 0)).toBe(
			true,
		);
	});

	it('reads a session in the zone the reader is in', () => {
		// Two in the afternoon at UTC is ten in the morning in New York.
		const bands = sessionBands(
			sitting('2026-08-18T14:00:00Z', '2026-08-18T15:00:00Z'),
			'America/New_York',
			'project',
		);
		expect(bands[1]?.focusMs).toBe(3_600_000);
		expect(bands[2]?.focusMs).toBe(0);
	});

	it('starts every writing mode at nothing, in the order they come', () => {
		const modes = emptyModes();
		expect(modes.map((mode) => mode.mode)).toEqual([
			'planning',
			'draft',
			'revision',
			'proofreading',
		]);
		expect(modes.every((mode) => mode.focusMs === 0)).toBe(true);
	});
});
