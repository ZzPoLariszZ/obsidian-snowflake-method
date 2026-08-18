import { describe, expect, it } from 'vitest';

import {
	WEEK_START_DAYS,
	addDays,
	calendarDay,
	dayOfMonth,
	dayOfWeek,
	daysBetween,
	isWeekStartDay,
	monthLabels,
	monthOfDay,
	monthsBetween,
	weekStartIndex,
	weekdayLabels,
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
});
