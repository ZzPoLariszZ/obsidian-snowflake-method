import { describe, expect, it } from 'vitest';

import {
	SessionTracker,
	finalizeSnapshot,
	formatClock,
	parseMonthFile,
	parseSessionRecord,
	parseSessionSnapshot,
	sessionDurations,
	sessionFilePath,
	sessionGoalMet,
	sessionMonthKey,
	sessionNets,
	shouldDiscard,
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
	uuid: 'a-session',
	schemaVersion: 1,
	startedAt: new Date(T0).toISOString(),
	endedAt: new Date(T0 + 10 * MINUTE).toISOString(),
	timezone: 'UTC',
	countingScope: 'project',
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
	startWordCount: 1000,
	endWordCount: 1700,
	addedWordCount: 520,
	deletedWordCount: 20,
	netWordCount: 500,
	files: [{ path: 'Novel/50_Manuscript/One.md', added: 520, deleted: 20, net: 500 }],
	goal: { netWordTarget: 400 },
	timing: { idleThresholdSeconds: 60 },
	...overrides,
});

describe('session arithmetic', () => {
	it('tells tracked net, scope net change, and the gap apart', () => {
		const nets = sessionNets(record());
		expect(nets.trackedNet).toBe(500);
		expect(nets.scopeNetChange).toBe(700);
		expect(nets.otherChanges).toBe(200);
	});

	it('completes a goal only when every configured condition holds', () => {
		expect(sessionGoalMet(null, 9999, 9999 * 1000)).toBe(false);
		expect(sessionGoalMet({}, 9999, 9999 * 1000)).toBe(false);
		expect(sessionGoalMet({ netWordTarget: 500 }, 500, 0)).toBe(true);
		expect(
			sessionGoalMet({ netWordTarget: 500, focusTimeTargetSeconds: 600 }, 500, 599 * 1000),
		).toBe(false);
		expect(
			sessionGoalMet({ netWordTarget: 500, focusTimeTargetSeconds: 600 }, 500, 600 * 1000),
		).toBe(true);
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
					addedWordCount: added,
					deletedWordCount: deleted,
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

	it('formats a clock the way a timer reads', () => {
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(61 * SECOND)).toBe('01:01');
		expect(formatClock(3661 * SECOND)).toBe('1:01:01');
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

	it('rejects a shape it does not recognize, whole', () => {
		expect(parseSessionRecord(record({ schemaVersion: 2 as never }))).toBeNull();
		expect(
			parseSessionRecord(record({ stopReason: 'rage-quit' as never })),
		).toBeNull();
		expect(
			parseSessionRecord(record({ addedWordCount: '520' as never })),
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
			parseMonthFile({ schemaVersion: 1, sessions: [record(), { uuid: 'x' }] }),
		).toBeNull();
	});
});

const snapshot = (
	overrides: Partial<WritingSessionSnapshot> = {},
): WritingSessionSnapshot => ({
	uuid: 'live-session',
	schemaVersion: 1,
	projectRoot: 'Snowflake Projects/Novel',
	projectPath: 'Snowflake Projects/Novel/001_Project_Metadata.md',
	sessionsDir: '70_Tool/71_Statistics/711_Writing_Session',
	startedAt: new Date(T0).toISOString(),
	timezone: 'UTC',
	countingScope: 'manuscript',
	sessionType: 'stopwatch',
	startMode: 'auto',
	writingMode: 'draft',
	goal: null,
	timing: { idleThresholdSeconds: 60 },
	startWordCount: 2000,
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
	addedWordCount: 120,
	deletedWordCount: 20,
	files: [{ path: 'Novel/50_Manuscript/One.md', added: 120, deleted: 20, net: 100 }],
	...overrides,
});

describe('recovering an orphaned session', () => {
	it('round-trips a snapshot through JSON and rejects garbage', () => {
		const stored = snapshot();
		expect(parseSessionSnapshot(JSON.parse(JSON.stringify(stored)))).toEqual(
			stored,
		);
		expect(parseSessionSnapshot(null)).toBeNull();
		expect(parseSessionSnapshot({ uuid: 'x' })).toBeNull();
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
		expect(finalized.netWordCount).toBe(100);
		// The scope was never recounted: the end derives from what was seen.
		expect(finalized.endWordCount).toBe(2100);
	});

	it('reads a marked shutdown as one', () => {
		expect(finalizeSnapshot(snapshot({ markedShutdown: true })).stopReason).toBe(
			'app-shutdown',
		);
	});
});
