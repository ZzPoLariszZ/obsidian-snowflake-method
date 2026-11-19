import { intlLocaleOf, isSupportedLocale } from './index';

/**
 * How the interface writes a number in the language its words are in. Every
 * pane asks here, so a figure reads the same way wherever it stands: grouped
 * the way the language groups, with the language's own decimal sign and its
 * own percent sign. How many figures a reading keeps stays the caller's to
 * say, and is kept exactly: only the marks between and around them change.
 *
 * English and both Chinese write 4,000, 12.50 and 85%, and so do Japanese and
 * Korean. German writes 4.000, 12,50 and 85 %, French 4 000, 12,50 and 85 %.
 * Spanish writes 12,50 and 85 % too, but leaves four figures ungrouped: 4000,
 * then 40.000. The spaces are no-break ones, so a figure is never parted from
 * its sign at the end of a line.
 */
export interface NumberFormat {
	/** A count, grouped the way the language groups one. */
	grouped(value: number): string;
	/** A figure to `digits` decimals, every one of them written, never grouped. */
	fixed(value: number, digits: number): string;
	/** A figure with the decimals it has and no more, as `String` writes it, never grouped. */
	decimal(value: number): string;
	/**
	 * A share already counted in percent, to `digits` decimals and at least
	 * `wholeDigits` figures before the decimal sign, never grouped.
	 */
	percent(value: number, digits?: number, wholeDigits?: number): string;
}

const formats = new Map<string, NumberFormat>();

/**
 * The way one language writes its numbers: a supported language by the tag
 * its formatting is asked for under, any other tag as it stands. Made once a
 * tag, since a pane asks again at every paint.
 */
export function numberFormat(locale: string): NumberFormat {
	const tag = isSupportedLocale(locale) ? intlLocaleOf(locale) : locale;
	let format = formats.get(tag);
	if (format === undefined) {
		format = makeNumberFormat(tag);
		formats.set(tag, format);
	}
	return format;
}

function makeNumberFormat(tag: string): NumberFormat {
	const grouping = new Intl.NumberFormat(tag);
	const decimals = new Intl.NumberFormat(tag, {
		useGrouping: false,
		maximumFractionDigits: 20,
	});
	const shapes = new Map<string, Intl.NumberFormat>();
	const shape = (
		percent: boolean,
		digits: number,
		wholeDigits: number,
	): Intl.NumberFormat => {
		const key = `${percent ? '%' : '.'}${String(digits)}:${String(wholeDigits)}`;
		let made = shapes.get(key);
		if (made === undefined) {
			made = new Intl.NumberFormat(tag, {
				// A unit rather than the percent style, which would read the
				// value as a fraction and multiply it by a hundred first.
				...(percent ? { style: 'unit', unit: 'percent' } : {}),
				useGrouping: false,
				minimumIntegerDigits: wholeDigits,
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
			});
			shapes.set(key, made);
		}
		return made;
	};
	// Rounded the way the interface has always rounded, and handed over
	// already round. Intl rounds the shortest decimal a double prints as,
	// `toFixed` the double itself, and the two part ways on a half: 1.005 is
	// 1.00 to `toFixed`, since the double under it falls just short.
	const rounded = (value: number, digits: number): number =>
		Number(value.toFixed(digits));
	return {
		grouped: (value) => grouping.format(value),
		fixed: (value, digits) =>
			shape(false, digits, 1).format(rounded(value, digits)),
		decimal: (value) => decimals.format(value),
		percent: (value, digits = 0, wholeDigits = 1) =>
			shape(true, digits, wholeDigits).format(rounded(value, digits)),
	};
}
