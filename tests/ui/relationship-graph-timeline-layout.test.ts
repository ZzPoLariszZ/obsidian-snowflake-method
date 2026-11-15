import { describe, expect, it } from 'vitest';

import {
	playbackFrame,
	playbackSchedule,
	playbackSpeed,
	ticksFit,
	TIMELINE_DWELL_MS,
	TIMELINE_TICK_ROOM,
	type PlaybackChange,
} from '../../src/ui/relationship-graph-timeline-layout';

const change = (entering: number, leaving = 0): PlaybackChange => ({ entering, leaving });

describe('the time-lapse\'s pace', () => {
	it('is the native graph\'s: half the square root of the lines a second, between five and a hundred', () => {
		expect(playbackSpeed(0)).toBe(5);
		expect(playbackSpeed(64)).toBe(5);
		expect(playbackSpeed(400)).toBe(10);
		expect(playbackSpeed(10_000)).toBe(50);
		expect(playbackSpeed(1_000_000)).toBe(100);
		expect(playbackSpeed(-3)).toBe(5);
	});

	it('stops on the time it starts from and on every later time that changes something, passing over the rest', () => {
		const schedule = playbackSchedule([change(2), change(0), change(1, 1), change(0), change(0, 2), change(3)], 0, { fresh: true, stagger: true });
		expect(schedule.steps.map((step) => step.index)).toEqual([0, 2, 4, 5]);
		expect(schedule.steps.map((step) => step.entering)).toEqual([2, 1, 0, 3]);
		// Six lines in all: the slowest pace, and each time held its dwell, since none brings enough to need longer.
		expect(schedule.speed).toBe(5);
		expect(schedule.steps.map((step) => step.durationMs)).toEqual([800, 800, 800, 800]);
		expect(schedule.steps.map((step) => step.startMs)).toEqual([0, 800, 1600, 2400]);
		expect(schedule.totalMs).toBe(3200);
		expect(TIMELINE_DWELL_MS).toBe(800);
	});

	it('holds a time for as long as its lines take to arrive', () => {
		const schedule = playbackSchedule([change(0), change(100), change(300)], 0, { fresh: true, stagger: true });
		// Four hundred lines at ten a second.
		expect(schedule.speed).toBe(10);
		expect(schedule.steps.map((step) => step.durationMs)).toEqual([800, 10_000, 30_000]);
		expect(schedule.totalMs).toBe(40_800);
	});

	it('carries on from a time already drawn without bringing its lines in again, and starts over from nothing when asked', () => {
		const changes = [change(4), change(0), change(2)];
		const resumed = playbackSchedule(changes, 0, { fresh: false, stagger: true });
		expect(resumed.steps.map((step) => [step.index, step.entering])).toEqual([[0, 0], [2, 2]]);
		const fresh = playbackSchedule(changes, 0, { fresh: true, stagger: true });
		expect(fresh.steps.map((step) => [step.index, step.entering])).toEqual([[0, 4], [2, 2]]);
		// From the middle, the times behind are not played.
		expect(playbackSchedule(changes, 1, { fresh: false, stagger: true }).steps.map((step) => step.index)).toEqual([1, 2]);
		// From the last, there is only the one stop; a start past the end is the last.
		expect(playbackSchedule(changes, 2, { fresh: false, stagger: true }).steps.map((step) => step.index)).toEqual([2]);
		expect(playbackSchedule(changes, 9, { fresh: false, stagger: true }).steps.map((step) => step.index)).toEqual([2]);
		expect(playbackSchedule([], 0, { fresh: true, stagger: true }).steps).toEqual([]);
	});

	it('sets each time whole, at the dwell alone, where motion is reduced', () => {
		const schedule = playbackSchedule([change(0), change(100), change(300)], 0, { fresh: true, stagger: false });
		expect(schedule.steps.map((step) => step.durationMs)).toEqual([800, 800, 800]);
		expect(playbackFrame(schedule, 900)).toEqual({ index: 1, revealed: 100, thumb: 1, done: false });
		expect(playbackFrame(schedule, 1599)).toMatchObject({ index: 1, thumb: 1 });
		expect(playbackFrame(schedule, 2400)).toEqual({ index: 2, revealed: 300, thumb: 2, done: true });
	});
});

describe('where a time-lapse stands', () => {
	// Ten lines over three stops: 5 a second, so the second time is held a second and the rest their dwell.
	const schedule = playbackSchedule([change(2), change(0), change(5), change(0), change(3)], 0, { fresh: true, stagger: true });

	it('shows a time\'s first line as it is reached and the rest one at a time, at the pace', () => {
		expect(schedule.steps.map((step) => [step.index, step.startMs, step.durationMs])).toEqual([[0, 0, 800], [2, 800, 1000], [4, 1800, 800]]);
		expect(playbackFrame(schedule, 0)).toMatchObject({ index: 0, revealed: 1 });
		expect(playbackFrame(schedule, 199)).toMatchObject({ index: 0, revealed: 1 });
		expect(playbackFrame(schedule, 200)).toMatchObject({ index: 0, revealed: 2 });
		expect(playbackFrame(schedule, 799)).toMatchObject({ index: 0, revealed: 2 });
		expect(playbackFrame(schedule, 800)).toMatchObject({ index: 2, revealed: 1 });
		expect(playbackFrame(schedule, 1400)).toMatchObject({ index: 2, revealed: 4 });
		expect(playbackFrame(schedule, 1799)).toMatchObject({ index: 2, revealed: 5 });
		expect(playbackFrame(schedule, 1800)).toMatchObject({ index: 4, revealed: 1, done: false });
	});

	it('glides the thumb from each time to the next it stops on, across the ones passed over, and rests on the last', () => {
		expect(playbackFrame(schedule, 0).thumb).toBe(0);
		expect(playbackFrame(schedule, 400).thumb).toBe(1);
		expect(playbackFrame(schedule, 600).thumb).toBe(1.5);
		expect(playbackFrame(schedule, 800).thumb).toBe(2);
		expect(playbackFrame(schedule, 1300).thumb).toBe(3);
		expect(playbackFrame(schedule, 1800).thumb).toBe(4);
		expect(playbackFrame(schedule, 2200).thumb).toBe(4);
	});

	it('is done once the last time has been held, and stays on it whatever the clock says after', () => {
		expect(playbackFrame(schedule, 2599).done).toBe(false);
		expect(playbackFrame(schedule, 2600)).toEqual({ index: 4, revealed: 3, thumb: 4, done: true });
		expect(playbackFrame(schedule, 99_999)).toEqual({ index: 4, revealed: 3, thumb: 4, done: true });
		expect(playbackFrame(schedule, -50)).toMatchObject({ index: 0, revealed: 1, thumb: 0 });
		expect(playbackFrame(playbackSchedule([], 0, { fresh: true, stagger: true }), 10)).toEqual({ index: 0, revealed: 0, thumb: 0, done: true });
	});

	it('reveals nothing at a time that only takes lines away', () => {
		const leaving = playbackSchedule([change(1), change(0, 1)], 0, { fresh: false, stagger: true });
		expect(playbackFrame(leaving, 900)).toMatchObject({ index: 1, revealed: 0 });
	});
});

describe('the points on the rail', () => {
	it('are drawn while each has its room, and left out where they would run into one bar', () => {
		expect(TIMELINE_TICK_ROOM).toBe(12);
		expect(ticksFit(7, 600)).toBe(true);
		// Sixty-one points on 720 pixels are exactly their room apart.
		expect(ticksFit(61, 720)).toBe(true);
		expect(ticksFit(62, 720)).toBe(false);
		expect(ticksFit(400, 727)).toBe(false);
		// One point, or none, is never crowded, and nothing is judged before the rail has a width.
		expect(ticksFit(1, 4)).toBe(true);
		expect(ticksFit(0, 4)).toBe(true);
		expect(ticksFit(400, 0)).toBe(true);
	});
});
