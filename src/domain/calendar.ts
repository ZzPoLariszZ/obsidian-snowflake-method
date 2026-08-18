/**
 * The calendar the writing statistics are read on. A session is filed by the
 * day it began, so everything a trend or a heatmap says is said about whole
 * days -- and a day here is a `YYYY-MM-DD` string rather than a moment, which
 * is what keeps a year of them free of hours, zones and the drift both bring.
 *
 * The arithmetic runs in UTC on purpose. Adding a day to a local `Date` lands
 * on the same hour of the next day, which on the two days a year a zone shifts
 * is not the next day at all; adding 24 hours to a UTC midnight always is.
 */

export const WEEK_START_DAYS = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
] as const;

/** Which day a week is drawn from, which is a reader's habit, not a fact. */
export type WeekStartDay = (typeof WEEK_START_DAYS)[number];

export function isWeekStartDay(value: unknown): value is WeekStartDay {
	return (WEEK_START_DAYS as readonly unknown[]).includes(value);
}

/** A week start as a weekday number, Sunday 0, the way `getUTCDay` counts. */
export function weekStartIndex(day: WeekStartDay): number {
	return WEEK_START_DAYS.indexOf(day);
}

const DAY_MS = 86_400_000;

/**
 * The ways a day can be written down. Which one reads as a date and which as
 * a puzzle depends on where the reader learned to read them, so it is theirs
 * to choose rather than this plugin's to decide.
 */
export const DATE_FORMATS = [
	'YYYY/MM/DD',
	'YYYY-MM-DD',
	'DD/MM/YYYY',
	'MM/DD',
	'DD/MM',
] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

export function isDateFormat(value: unknown): value is DateFormat {
	return (DATE_FORMATS as readonly unknown[]).includes(value);
}

/** A day written the chosen way. The format names its own parts. */
export function formatDay(day: string, format: DateFormat): string {
	const [year, month, date] = [day.slice(0, 4), day.slice(5, 7), day.slice(8, 10)];
	return format
		.replace('YYYY', year)
		.replace('MM', month)
		.replace('DD', date);
}

/**
 * The calendar day a moment falls on in a zone. This is the one place a
 * moment becomes a day, and every reading of a stored session goes through
 * it, so a device's own zone decides its days throughout.
 */
export function calendarDay(ms: number, timeZone: string): string {
	const date = new Date(ms);
	const options: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	};
	try {
		return new Intl.DateTimeFormat('en-CA', { timeZone, ...options }).format(
			date,
		);
	} catch {
		// An unknown zone name falls back to wherever this machine is.
		return new Intl.DateTimeFormat('en-CA', options).format(date);
	}
}

/** The moment a day begins, read as UTC, which is where the arithmetic runs. */
function dayMs(day: string): number {
	const [year, month, date] = day.split('-').map(Number);
	return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function fromMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** The day `count` days after `day`; a negative count reaches backwards. */
export function addDays(day: string, count: number): string {
	return fromMs(dayMs(day) + count * DAY_MS);
}

/** How many days lie from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** The weekday a day falls on, Sunday 0. */
export function dayOfWeek(day: string): number {
	return new Date(dayMs(day)).getUTCDay();
}

/** The month a day falls in, January 0. */
export function monthOfDay(day: string): number {
	return new Date(dayMs(day)).getUTCMonth();
}

/** The day of the month, from 1. */
export function dayOfMonth(day: string): number {
	return new Date(dayMs(day)).getUTCDate();
}

/**
 * The year and month a day belongs to, zero padded -- which is how a session
 * file names the month it holds.
 */
export function monthKeyOfDay(day: string): { year: string; month: string } {
	return { year: day.slice(0, 4), month: day.slice(5, 7) };
}

/**
 * Every month from `from` to `through`, oldest first and grouped by year, so
 * a reader can list one year folder once and take every month it needs from
 * it.
 */
export function monthsBetween(
	from: string,
	through: string,
): { year: string; months: string[] }[] {
	const years: { year: string; months: string[] }[] = [];
	let cursor = `${from.slice(0, 7)}-01`;
	const last = `${through.slice(0, 7)}-01`;
	while (daysBetween(cursor, last) >= 0) {
		const { year, month } = monthKeyOfDay(cursor);
		const group = years[years.length - 1];
		if (group?.year === year) group.months.push(month);
		else years.push({ year, months: [month] });
		// The first of next month, reached from the first of this one.
		const at = new Date(dayMs(cursor));
		cursor = fromMs(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
	}
	return years;
}

/**
 * The seven weekday names a locale uses, Sunday first, so a caller can index
 * them with `dayOfWeek`. Taken from the platform rather than from this
 * plugin's own copy: a weekday is calendar data, the same for every reader of
 * a language, and no translation of it belongs in a locale file.
 */
export function weekdayLabels(
	locale: string,
	width: 'long' | 'short',
): string[] {
	// A week that begins on a Sunday, so index and weekday agree.
	return labels(locale, { weekday: width }, (at) => Date.UTC(2023, 0, 1 + at), 7);
}

/** The twelve month names a locale uses, January first. */
export function monthLabels(locale: string): string[] {
	return labels(locale, { month: 'short' }, (at) => Date.UTC(2023, at, 15), 12);
}

function labels(
	locale: string,
	options: Intl.DateTimeFormatOptions,
	at: (index: number) => number,
	count: number,
): string[] {
	const format = new Intl.DateTimeFormat(locale, {
		...options,
		timeZone: 'UTC',
	});
	return Array.from({ length: count }, (_unused, index) =>
		format.format(new Date(at(index))),
	);
}
