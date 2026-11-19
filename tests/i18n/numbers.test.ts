import { describe, expect, it } from 'vitest';

import {
	FIRST_LINE_INDENT_STOPS,
	LINE_HEIGHT_STOPS,
	PARAGRAPH_SPACING_STOPS,
} from '../../src/domain';
import {
	SUPPORTED_LOCALES,
	intlLocaleOf,
	t,
	type SupportedLocale,
} from '../../src/i18n';
import { numberFormat } from '../../src/i18n/numbers';

/**
 * Every no-break space as one mark. French has moved between the two kinds
 * over CLDR's releases, and either holds a figure to its neighbour; what
 * must never appear is a plain space, which a line may break at.
 */
const shown = (text: string): string => text.replace(/[\u00a0\u202f]/gu, '␣');

interface Written {
	grouped: [string, string, string, string];
	fixed: [string, string, string];
	decimal: [string, string, string];
	percent: [string, string, string, string];
}

const ENGLISH_WAY: Written = {
	grouped: ['4,000', '40,000', '1,234,567', '-4,000'],
	fixed: ['133.00', '11.58', '1.5'],
	decimal: ['1.6', '0.25', '2'],
	percent: ['85%', '07.79%', '12.5%', '100%'],
};

const COMMA_WAY = {
	fixed: ['133,00', '11,58', '1,5'],
	decimal: ['1,6', '0,25', '2'],
	percent: ['85␣%', '07,79␣%', '12,5␣%', '100␣%'],
} satisfies Omit<Written, 'grouped'>;

/** What each language writes for the same readings. */
const WRITTEN: Readonly<Record<SupportedLocale, Written>> = {
	en: ENGLISH_WAY,
	'zh-CN': ENGLISH_WAY,
	'zh-TW': ENGLISH_WAY,
	ja: ENGLISH_WAY,
	ko: ENGLISH_WAY,
	fr: { ...COMMA_WAY, grouped: ['4␣000', '40␣000', '1␣234␣567', '-4␣000'] },
	de: { ...COMMA_WAY, grouped: ['4.000', '40.000', '1.234.567', '-4.000'] },
	// Spanish leaves four figures whole and groups from five.
	es: { ...COMMA_WAY, grouped: ['4000', '40.000', '1.234.567', '-4000'] },
};

describe('number format', () => {
	it.each(SUPPORTED_LOCALES)('writes counts, decimals and shares the %s way', (locale) => {
		const numbers = numberFormat(locale);
		const written = WRITTEN[locale];
		expect([4000, 40000, 1234567, -4000].map((value) => shown(numbers.grouped(value)))).toEqual(
			written.grouped,
		);
		expect([
			shown(numbers.fixed(133, 2)),
			shown(numbers.fixed(11.58, 2)),
			shown(numbers.fixed(1.5, 1)),
		]).toEqual(written.fixed);
		expect([1.6, 0.25, 2].map((value) => shown(numbers.decimal(value)))).toEqual(
			written.decimal,
		);
		expect([
			shown(numbers.percent(85)),
			shown(numbers.percent(7.79, 2, 2)),
			shown(numbers.percent(12.5, 1)),
			shown(numbers.percent(100)),
		]).toEqual(written.percent);
	});

	it.each(SUPPORTED_LOCALES)('never puts a plain space in a %s number', (locale) => {
		const numbers = numberFormat(locale);
		for (const text of [
			numbers.grouped(1234567),
			numbers.fixed(1234.5, 2),
			numbers.decimal(1234.5),
			numbers.percent(1234.5, 1, 2),
		]) {
			expect(text, text).not.toContain(' ');
		}
	});

	/**
	 * The three languages the plugin spoke before the others came keep every
	 * figure they wrote, mark for mark: grouping by `toLocaleString('en-US')`,
	 * decimals by `toFixed`, plain figures by `String`, and a percent as the
	 * figure with the sign after it, the prose cards' padded to two places.
	 */
	it.each(['en', 'zh-CN', 'zh-TW'] as const)('keeps what %s wrote before', (locale) => {
		const numbers = numberFormat(locale);
		const values = [
			0, 1, 7, 9.39, 12.5, 33.333333, 99.995, 100, 999, 1000, 4000, 12345.678,
			1234567, 1_000_000.5, -1, -0.001, -0.5, -4000, 1.005, 2.675, 0.125, 9.995,
		];
		for (const value of values) {
			expect(numbers.grouped(value), String(value)).toBe(value.toLocaleString('en-US'));
			for (const digits of [0, 1, 2]) {
				expect(numbers.fixed(value, digits), `${String(value)} to ${String(digits)}`).toBe(
					value.toFixed(digits),
				);
			}
			expect(numbers.decimal(value), String(value)).toBe(String(value));
			expect(numbers.percent(Math.round(value)), String(value)).toBe(
				`${Math.round(value)}%`,
			);
			expect(numbers.percent(value, 1), String(value)).toBe(`${value.toFixed(1)}%`);
			if (value >= 0) {
				const text = value.toFixed(2);
				expect(numbers.percent(value, 2, 2), String(value)).toBe(
					`${text.length < 5 ? `0${text}` : text}%`,
				);
			}
		}
	});

	it('rounds a half the way toFixed does, not the way Intl would', () => {
		// 1.005 is a double just short of the half, so it rounds down.
		expect(numberFormat('de').fixed(1.005, 2)).toBe('1,00');
		expect(numberFormat('en').percent(1.005, 2)).toBe('1.00%');
		expect(numberFormat('fr').fixed(0.125, 2)).toBe('0,13');
	});

	it('writes the Typography stops the way the settings read them', () => {
		const english = numberFormat('en');
		const german = numberFormat('de');
		for (const stop of [
			...LINE_HEIGHT_STOPS,
			...PARAGRAPH_SPACING_STOPS,
			...FIRST_LINE_INDENT_STOPS,
		]) {
			expect(english.decimal(stop)).toBe(String(stop));
			expect(german.decimal(stop)).toBe(String(stop).replace('.', ','));
		}
	});

	it('takes a language or the tag it formats under alike', () => {
		for (const locale of SUPPORTED_LOCALES) {
			expect(numberFormat(locale)).toBe(numberFormat(intlLocaleOf(locale)));
		}
	});

	it('fills the goal captions the audit found in English figures', () => {
		const goal = (locale: SupportedLocale): string => {
			const numbers = numberFormat(locale);
			return shown(
				t(locale, 'sessionWidget.goal.progress', {
					net: numbers.grouped(0),
					goal: numbers.grouped(4000),
				}),
			);
		};
		expect(goal('en')).toBe('0 / 4,000');
		expect(goal('zh-CN')).toBe('0 / 4,000');
		expect(goal('de')).toBe('0 / 4.000');
		expect(goal('fr')).toBe('0 / 4␣000');
		expect(goal('es')).toBe('0 / 4000');
	});
});
