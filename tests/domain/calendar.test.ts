import { describe, expect, it } from 'vitest';

import {
	DAY_BANDS,
	WEEK_START_DAYS,
	addDays,
	addMonths,
	bandLabel,
	bandOfHour,
	calendarDay,
	dayOfMonth,
	dayOfWeek,
	daysBetween,
	daysInMonth,
	endOfMonth,
	isWeekStartDay,
	monthLabels,
	monthOfDay,
	monthTitle,
	monthsBetween,
	splitDayBands,
	startOfMonth,
	startOfWeek,
	weekOfYear,
	weekStartIndex,
	weekdayLabels,
	zoneOffsetMs,
} from '../../src/domain';

describe('calendar', () => {
	/**
	 * The reason the arithmetic runs in UTC. Adding a day to a local moment
	 * lands on the same hour of the next day, which on the morning a zone
	 * springs forward is still the day it started on.
	 */
	it('adds days across a daylight saving change', () => {
		// The Sunday the United States moves its clocks forward.
		expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
		expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
		expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
	});

	it('adds days across a month, a year and a leap day', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(daysBetween('2026-08-18', '2026-08-11')).toBe(-7);
	});

	/** A heatmap asks for a year of days and gets exactly that many. */
	it('reaches back a whole year in 366 days', () => {
		const first = addDays('2026-08-18', 1 - 366);
		expect(first).toBe('2025-08-18');
		expect(daysBetween(first, '2026-08-18') + 1).toBe(366);
	});

	it('names the weekday, month and day a date falls on', () => {
		// A Tuesday.
		expect(dayOfWeek('2026-08-18')).toBe(2);
		expect(monthOfDay('2026-08-18')).toBe(7);
		expect(dayOfMonth('2026-08-18')).toBe(18);
	});

	/**
	 * A month file is named for the month its sessions began in, so a reading
	 * has to name every month its days touch and no more.
	 */
	it('groups the months a stretch of days touches by year', () => {
		expect(monthsBetween('2026-08-18', '2026-08-18')).toEqual([
			{ year: '2026', months: ['08'] },
		]);
		expect(monthsBetween('2025-11-20', '2026-02-03')).toEqual([
			{ year: '2025', months: ['11', '12'] },
			{ year: '2026', months: ['01', '02'] },
		]);
		expect(monthsBetween('2025-08-18', '2026-08-18')).toHaveLength(2);
	});

	it('reads the calendar day of a moment in its own zone', () => {
		// Ten in the evening in New York is the next day in London.
		const moment = Date.parse('2026-08-18T02:30:00Z');
		expect(calendarDay(moment, 'America/New_York')).toBe('2026-08-17');
		expect(calendarDay(moment, 'Europe/London')).toBe('2026-08-18');
	});

	it('indexes the week starts the way getUTCDay counts', () => {
		expect(weekStartIndex('sunday')).toBe(0);
		expect(weekStartIndex('monday')).toBe(1);
		expect(weekStartIndex('saturday')).toBe(6);
		expect(WEEK_START_DAYS).toHaveLength(7);
		expect(isWeekStartDay('monday')).toBe(true);
		expect(isWeekStartDay('funday')).toBe(false);
	});

	/**
	 * The weekday names are indexed by `dayOfWeek`, so the list has to begin
	 * on a Sunday however the reader's own week begins.
	 */
	it('names the weekdays from Sunday and the months from January', () => {
		const days = weekdayLabels('en', 'long');
		expect(days).toHaveLength(7);
		expect(days[0]).toBe('Sunday');
		expect(days[dayOfWeek('2026-08-18')]).toBe('Tuesday');
		expect(weekdayLabels('zh-CN', 'long')[1]).toBe('星期一');
		const months = monthLabels('en');
		expect(months).toHaveLength(12);
		expect(months[monthOfDay('2026-08-18')]).toBe('Aug');
	});

	it('walks whole months, however long each of them is', () => {
		expect(startOfMonth('2026-08-18')).toBe('2026-08-01');
		expect(endOfMonth('2026-08-18')).toBe('2026-08-31');
		expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
		expect(daysInMonth('2024-02-10')).toBe(29);
		expect(addMonths('2026-08-31', 1)).toBe('2026-09-01');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
	});

	/**
	 * A month's goal is as many days as the month holds, so a short February
	 * asks for less than a long March. This is where that number comes from.
	 */
	it('counts the days a month holds', () => {
		expect(daysInMonth('2026-02-01')).toBe(28);
		expect(daysInMonth('2026-03-01')).toBe(31);
		expect(daysInMonth('2026-04-01')).toBe(30);
	});

	it('starts a week on whichever day the reader starts theirs', () => {
		// A Tuesday.
		expect(startOfWeek('2026-08-18', 'monday')).toBe('2026-08-17');
		expect(startOfWeek('2026-08-18', 'sunday')).toBe('2026-08-16');
		expect(startOfWeek('2026-08-18', 'wednesday')).toBe('2026-08-12');
		// A day that already is the start of its week stays where it is.
		expect(startOfWeek('2026-08-17', 'monday')).toBe('2026-08-17');
	});

	/**
	 * A week begun in December belongs to the year it runs into, and the count
	 * follows the reader's own first day rather than the ISO Monday.
	 */
	it('numbers the weeks from the reader own first day of the week', () => {
		expect(weekOfYear('2026-01-01', 'monday')).toBe(1);
		expect(weekOfYear('2026-01-04', 'monday')).toBe(1);
		expect(weekOfYear('2026-01-05', 'monday')).toBe(2);
		expect(weekOfYear('2026-12-31', 'monday')).toBe(53);
		// The first of January 2026 is a Thursday, so a Sunday-started week
		// opens three days earlier and the split lands elsewhere.
		expect(weekOfYear('2026-01-03', 'sunday')).toBe(1);
		expect(weekOfYear('2026-01-04', 'sunday')).toBe(2);
	});

	it('names a month the way the reader names it', () => {
		expect(monthTitle('2026-08-01', 'en')).toBe('August 2026');
		expect(monthTitle('2026-08-01', 'zh-CN')).toBe('2026年8月');
	});

	/**
	 * A session records the moments it happened at and nothing about the hours
	 * they felt like, so the offset is what turns one into the other.
	 */
	it('measures how far a zone stands from UTC', () => {
		// Summer time in New York is four hours behind, winter five.
		expect(zoneOffsetMs(Date.parse('2026-08-18T12:00:00Z'), 'America/New_York')).toBe(
			-4 * 3_600_000,
		);
		expect(zoneOffsetMs(Date.parse('2026-01-18T12:00:00Z'), 'America/New_York')).toBe(
			-5 * 3_600_000,
		);
		expect(zoneOffsetMs(Date.parse('2026-08-18T12:00:00Z'), 'UTC')).toBe(0);
		expect(zoneOffsetMs(Date.parse('2026-08-18T12:00:00Z'), 'Asia/Shanghai')).toBe(
			8 * 3_600_000,
		);
	});

	it('puts an hour in the part of the day it belongs to', () => {
		expect(DAY_BANDS).toHaveLength(7);
		expect(bandOfHour(6)).toBe(0);
		expect(bandOfHour(8.5)).toBe(0);
		expect(bandOfHour(23)).toBe(5);
		// The small hours come last, where they are met.
		expect(bandOfHour(0)).toBe(6);
		expect(bandOfHour(5.99)).toBe(6);
		expect(bandLabel(0)).toBe('06:00-09:00');
		expect(bandLabel(6)).toBe('00:00-06:00');
	});

	/** A sitting is cut at every boundary it crosses, midnight included. */
	it('splits a stretch of time across the parts of a day', () => {
		const from = Date.parse('2026-08-18T08:30:00Z');
		const spread = splitDayBands(from, from + 90 * 60_000, 'UTC');
		expect(spread[0]).toBe(30 * 60_000);
		expect(spread[1]).toBe(60 * 60_000);
		expect(spread.reduce((carried, ms) => carried + ms, 0)).toBe(90 * 60_000);
	});

	it('carries a stretch that crosses midnight into the next day', () => {
		const from = Date.parse('2026-08-18T23:00:00Z');
		const spread = splitDayBands(from, from + 2 * 3_600_000, 'UTC');
		// An hour before midnight, and an hour after it.
		expect(spread[5]).toBe(3_600_000);
		expect(spread[6]).toBe(3_600_000);
	});

	it('splits a stretch by the hours its own zone was reading', () => {
		// Half past one in the morning at UTC is half past nine the evening
		// before in New York, so three hours of it end just past midnight
		// there rather than well into the morning here.
		const from = Date.parse('2026-08-18T01:30:00Z');
		const spread = splitDayBands(from, from + 3 * 3_600_000, 'America/New_York');
		expect(spread[5]).toBe(2.5 * 3_600_000);
		expect(spread[6]).toBe(0.5 * 3_600_000);
		// Read at UTC the same three hours are the small hours throughout.
		expect(splitDayBands(from, from + 3 * 3_600_000, 'UTC')[6]).toBe(
			3 * 3_600_000,
		);
	});

	it('splits nothing where there is nothing to split', () => {
		const at = Date.parse('2026-08-18T08:30:00Z');
		expect(splitDayBands(at, at, 'UTC')).toEqual(DAY_BANDS.map(() => 0));
		expect(splitDayBands(at, at - 1000, 'UTC')).toEqual(DAY_BANDS.map(() => 0));
	});
});
