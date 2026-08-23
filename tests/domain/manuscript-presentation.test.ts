import { describe, expect, it } from 'vitest';

import {
	CONTENT_WIDTH_STOPS,
	DEFAULT_MANUSCRIPT_PRESENTATION,
	FIRST_LINE_INDENT_STOPS,
	FONT_SIZE_STOPS,
	LINE_HEIGHT_STOPS,
	MANUSCRIPT_GUIDES,
	MANUSCRIPT_TEXT_ALIGNS,
	MANUSCRIPT_TINTS,
	PARAGRAPH_SPACING_STOPS,
	PRESENTATION_LIMITS,
	PRESENTATION_PROPERTIES,
	fontFamilyValue,
	isManuscriptGuide,
	isManuscriptTextAlign,
	nearestStop,
	numberIn,
	presentationShape,
	presentationStyle,
	sanitizeContentWidth,
	sanitizeFirstLineIndent,
	sanitizeFontFamily,
	sanitizeFontSize,
	sanitizeGuide,
	sanitizeHyphenation,
	sanitizeLineHeight,
	sanitizeParagraphSpacing,
	sanitizeRecentFonts,
	sanitizeTextAlign,
	sanitizeTint,
	rememberFontFamily,
	RECENT_FONT_LIMIT,
	sizeOrTheme,
	PRESENTATION_THEME_VARS,
	type ManuscriptPresentation,
} from '../../src/domain';

const look = (
	overrides: Partial<ManuscriptPresentation> = {},
): ManuscriptPresentation => ({ ...DEFAULT_MANUSCRIPT_PRESENTATION, ...overrides });

describe('the tints on offer', () => {
	it('are the four per mode the author asked for, lowercased, each named', () => {
		expect(MANUSCRIPT_TINTS.light.map((tint) => tint.hex)).toEqual([
			'#c7e0c7',
			'#e5d8be',
			'#d3deeb',
			'#f0dde1',
		]);
		expect(MANUSCRIPT_TINTS.dark.map((tint) => tint.hex)).toEqual([
			'#202e47',
			'#4f555d',
			'#60406b',
			'#2d2e61',
		]);
		for (const tint of [...MANUSCRIPT_TINTS.light, ...MANUSCRIPT_TINTS.dark]) {
			expect(sanitizeTint(tint.hex)).toBe(tint.hex);
			expect(tint.name.length).toBeGreaterThan(0);
		}
	});
});

describe('sanitizers', () => {
	it('keep a size, send zero to the theme, clamp the rest and refuse junk', () => {
		expect(sanitizeFontSize(18)).toBe(18);
		expect(sanitizeFontSize(0)).toBe(0);
		expect(sanitizeFontSize(-4)).toBe(0);
		expect(sanitizeFontSize(3)).toBe(PRESENTATION_LIMITS.fontSize.min);
		expect(sanitizeFontSize(999)).toBe(PRESENTATION_LIMITS.fontSize.max);
		expect(sanitizeFontSize('18')).toBe(0);
		expect(sanitizeFontSize(Number.NaN)).toBe(0);
		expect(sanitizeLineHeight(1.6)).toBe(1.6);
		expect(sanitizeLineHeight(0.2)).toBe(PRESENTATION_LIMITS.lineHeight.min);
		expect(sanitizeLineHeight(undefined)).toBe(0);
		expect(sanitizeContentWidth(760)).toBe(760);
		expect(sanitizeContentWidth(10)).toBe(PRESENTATION_LIMITS.contentWidth.min);
		expect(sanitizeContentWidth(null)).toBe(0);
	});

	it('hold the text to the range the author asked for', () => {
		expect(PRESENTATION_LIMITS.fontSize).toEqual({ min: 12, max: 72 });
		expect(PRESENTATION_LIMITS.lineHeight).toEqual({ min: 1.4, max: 3 });
		// A size stored under an older, wider range comes back inside this one.
		expect(sanitizeFontSize(8)).toBe(12);
		expect(sanitizeLineHeight(1.2)).toBe(1.4);
	});

	it('hold paragraph spacing to a quarter line at the least, one line by default', () => {
		expect(DEFAULT_MANUSCRIPT_PRESENTATION.paragraphSpacing).toBe(1);
		expect(sanitizeParagraphSpacing(0.5)).toBe(0.5);
		// Never below the floor: the editor must keep a usable blank line.
		expect(sanitizeParagraphSpacing(0)).toBe(0.25);
		expect(sanitizeParagraphSpacing(-1)).toBe(0.25);
		expect(sanitizeParagraphSpacing(9)).toBe(PRESENTATION_LIMITS.paragraphSpacing.max);
		expect(sanitizeParagraphSpacing('1')).toBe(1);
		expect(PARAGRAPH_SPACING_STOPS[0]).toBe(0.25);
		expect(PARAGRAPH_SPACING_STOPS).toContain(1);
	});

	it('hold the indent to a sane em range, none by default', () => {
		expect(sanitizeFirstLineIndent(2)).toBe(2);
		expect(sanitizeFirstLineIndent(-1)).toBe(0);
		expect(sanitizeFirstLineIndent(50)).toBe(PRESENTATION_LIMITS.firstLineIndent.max);
		expect(sanitizeFirstLineIndent({})).toBe(0);
	});

	it('take a six-digit hex color, lowercased, and nothing else', () => {
		expect(sanitizeTint('#C7E0C7')).toBe('#c7e0c7');
		expect(sanitizeTint(' #d3deeb ')).toBe('#d3deeb');
		expect(sanitizeTint('#fff')).toBe('');
		expect(sanitizeTint('red')).toBe('');
		expect(sanitizeTint('#c7e0c7; color: red')).toBe('');
		expect(sanitizeTint(0xc7e0c7)).toBe('');
	});

	it('know the three guides and nothing else', () => {
		expect(MANUSCRIPT_GUIDES).toEqual(['none', 'solid', 'dashed']);
		for (const guide of MANUSCRIPT_GUIDES) {
			expect(isManuscriptGuide(guide)).toBe(true);
			expect(sanitizeGuide(guide)).toBe(guide);
		}
		expect(sanitizeGuide('dotted')).toBe('none');
		expect(sanitizeGuide(undefined)).toBe('none');
	});

	it('know ragged right and justified, and a plain on or off for hyphens', () => {
		expect(MANUSCRIPT_TEXT_ALIGNS).toEqual(['start', 'justify']);
		expect(DEFAULT_MANUSCRIPT_PRESENTATION.textAlign).toBe('start');
		expect(DEFAULT_MANUSCRIPT_PRESENTATION.hyphenation).toBe(false);
		for (const align of MANUSCRIPT_TEXT_ALIGNS) {
			expect(isManuscriptTextAlign(align)).toBe(true);
			expect(sanitizeTextAlign(align)).toBe(align);
		}
		expect(sanitizeTextAlign('center')).toBe('start');
		expect(sanitizeTextAlign(undefined)).toBe('start');
		expect(sanitizeHyphenation(true)).toBe(true);
		expect(sanitizeHyphenation('yes')).toBe(false);
	});

	it('clean a font list down to what a font name can carry', () => {
		expect(sanitizeFontFamily('Georgia')).toBe('Georgia');
		expect(sanitizeFontFamily('  Iowan Old Style ,Georgia,, serif ')).toBe(
			'Iowan Old Style, Georgia, serif',
		);
		expect(sanitizeFontFamily('"PingFang SC", 思源宋体')).toBe(
			'PingFang SC, 思源宋体',
		);
		expect(sanitizeFontFamily('Georgia; color: red }')).toBe('Georgia color red');
		expect(sanitizeFontFamily('Georgia !important')).toBe('Georgia important');
		expect(sanitizeFontFamily('Times New\nRoman')).toBe('Times New Roman');
		expect(sanitizeFontFamily(',,,')).toBe('');
		expect(sanitizeFontFamily(42)).toBe('');
		expect(sanitizeFontFamily('x'.repeat(300)).length).toBeLessThanOrEqual(120);
	});

	it('quote every family for CSS and leave the generic keywords bare', () => {
		expect(fontFamilyValue('Iowan Old Style, Georgia, serif')).toBe(
			'"Iowan Old Style", "Georgia", serif',
		);
		expect(fontFamilyValue('2Pac Display, Sans-Serif')).toBe(
			'"2Pac Display", sans-serif',
		);
		expect(fontFamilyValue('   ')).toBe('');
	});

	it('expose the generic number helpers the settings lean on', () => {
		expect(numberIn(5, 1, 3, 2)).toBe(3);
		expect(numberIn('5', 1, 3, 2)).toBe(2);
		expect(sizeOrTheme(0, 8, 72, 16)).toBe(0);
		expect(sizeOrTheme(100, 8, 72, 16)).toBe(72);
		expect(sizeOrTheme(Number.POSITIVE_INFINITY, 8, 72, 16)).toBe(16);
	});
});

describe('the stops the sliders offer', () => {
	it('are real sizes end to end, the theme\u2019s own left to the button beside them', () => {
		// Nothing on a rail stands for "the theme's own" any more: a slider
		// that lands on its first stop has chosen 12 px, not left it alone.
		expect(FONT_SIZE_STOPS).not.toContain(0);
		expect(LINE_HEIGHT_STOPS).not.toContain(0);
		expect(CONTENT_WIDTH_STOPS).not.toContain(0);
		expect(FONT_SIZE_STOPS[0]).toBe(PRESENTATION_LIMITS.fontSize.min);
		expect(FONT_SIZE_STOPS[FONT_SIZE_STOPS.length - 1]).toBe(
			PRESENTATION_LIMITS.fontSize.max,
		);
		expect(LINE_HEIGHT_STOPS[0]).toBe(PRESENTATION_LIMITS.lineHeight.min);
		expect(LINE_HEIGHT_STOPS[LINE_HEIGHT_STOPS.length - 1]).toBe(
			PRESENTATION_LIMITS.lineHeight.max,
		);
		// No indent is a size of its own, so zero stays a stop there.
		expect(FIRST_LINE_INDENT_STOPS[0]).toBe(0);
		for (const stops of [FONT_SIZE_STOPS, LINE_HEIGHT_STOPS, CONTENT_WIDTH_STOPS]) {
			expect([...stops].sort((a, b) => a - b)).toEqual([...stops]);
		}
	});

	it('name the theme variable each measure falls back to', () => {
		expect(PRESENTATION_THEME_VARS).toEqual({
			fontSize: '--font-text-size',
			lineHeight: '--line-height-normal',
			contentWidth: '--file-line-width',
		});
	});
});

describe('the faces the picker remembers', () => {
	it('puts the newest first, without repeats, and keeps only a few', () => {
		expect(rememberFontFamily([], 'Georgia')).toEqual(['Georgia']);
		expect(rememberFontFamily(['Georgia'], 'Palatino')).toEqual([
			'Palatino',
			'Georgia',
		]);
		// A face set again moves to the front rather than joining twice.
		expect(rememberFontFamily(['Palatino', 'Georgia'], 'Georgia')).toEqual([
			'Georgia',
			'Palatino',
		]);
		expect(rememberFontFamily(['Georgia'], 'georgia')).toEqual(['georgia']);
		// The theme's own is not a face, and remembers nothing.
		expect(rememberFontFamily(['Georgia'], '')).toEqual(['Georgia']);
		const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
		expect(rememberFontFamily(many, 'h')).toHaveLength(RECENT_FONT_LIMIT);
		expect(rememberFontFamily(many, 'h')[0]).toBe('h');
	});

	it('takes a stored list as a list of font lists, and junk as none', () => {
		expect(sanitizeRecentFonts(['Georgia', ' Palatino ', 'Georgia'])).toEqual([
			'Georgia',
			'Palatino',
		]);
		expect(sanitizeRecentFonts(['', 42, null, 'Georgia'])).toEqual(['Georgia']);
		expect(sanitizeRecentFonts('Georgia')).toEqual([]);
		expect(sanitizeRecentFonts(undefined)).toEqual([]);
	});
});

describe('nearestStop', () => {
	it('finds the stop a stored value sits nearest, the first on a tie', () => {
		expect(nearestStop(FONT_SIZE_STOPS, 18)).toBe(FONT_SIZE_STOPS.indexOf(18));
		expect(nearestStop(FONT_SIZE_STOPS, 23)).toBe(FONT_SIZE_STOPS.indexOf(22));
		// A setting left at the theme's own has no stop; the slider asks for
		// the theme's measure instead, and 16 px is a stop of its own.
		expect(nearestStop(FONT_SIZE_STOPS, 16)).toBe(FONT_SIZE_STOPS.indexOf(16));
		expect(nearestStop(FONT_SIZE_STOPS, 500)).toBe(FONT_SIZE_STOPS.length - 1);
		expect(nearestStop(LINE_HEIGHT_STOPS, 1.55)).toBe(LINE_HEIGHT_STOPS.indexOf(1.5));
		expect(nearestStop(CONTENT_WIDTH_STOPS, 700)).toBe(CONTENT_WIDTH_STOPS.indexOf(680));
		expect(nearestStop(FIRST_LINE_INDENT_STOPS, 2)).toBe(
			FIRST_LINE_INDENT_STOPS.indexOf(2),
		);
	});
});

describe('presentationStyle', () => {
	it('leaves every property off at the defaults, spacing and indent aside', () => {
		const style = presentationStyle(look());
		expect(style.properties).toEqual({
			[PRESENTATION_PROPERTIES.font]: null,
			[PRESENTATION_PROPERTIES.fontSize]: null,
			[PRESENTATION_PROPERTIES.lineHeight]: null,
			[PRESENTATION_PROPERTIES.width]: null,
			[PRESENTATION_PROPERTIES.paragraphSpacing]: '1',
			[PRESENTATION_PROPERTIES.indent]: '0em',
			[PRESENTATION_PROPERTIES.align]: null,
			[PRESENTATION_PROPERTIES.hyphens]: null,
			[PRESENTATION_PROPERTIES.tintLight]: null,
			[PRESENTATION_PROPERTIES.tintDark]: null,
		});
		expect(style.classes).toEqual({
			'is-guide-solid': false,
			'is-guide-dashed': false,
		});
	});

	it('writes justified text and automatic hyphens only when asked for', () => {
		const style = presentationStyle(look({ textAlign: 'justify', hyphenation: true }));
		expect(style.properties[PRESENTATION_PROPERTIES.align]).toBe('justify');
		expect(style.properties[PRESENTATION_PROPERTIES.hyphens]).toBe('auto');
		expect(presentationShape(look({ textAlign: 'justify' }))).not.toBe(
			presentationShape(look()),
		);
		expect(presentationShape(look({ hyphenation: true }))).not.toBe(
			presentationShape(look()),
		);
	});

	it('writes each value the way the stylesheet reads it', () => {
		const style = presentationStyle(
			look({
				fontFamily: 'Iowan Old Style, serif',
				fontSize: 18,
				lineHeight: 1.8,
				contentWidth: 760,
				paragraphSpacing: 0.5,
				firstLineIndent: 2,
				tintLight: '#e5d8be',
				tintDark: '#202e47',
				guide: 'dashed',
			}),
		);
		expect(style.properties).toEqual({
			// The theme's text font closes the list.
			[PRESENTATION_PROPERTIES.font]:
				'"Iowan Old Style", serif, var(--font-text)',
			[PRESENTATION_PROPERTIES.fontSize]: '18px',
			[PRESENTATION_PROPERTIES.lineHeight]: '1.8',
			// The text column plus the padding the segment box carries.
			// The text column alone: the box's own padding is added by the
			// stylesheet, next to where that padding is set.
			[PRESENTATION_PROPERTIES.width]: '760px',
			[PRESENTATION_PROPERTIES.paragraphSpacing]: '0.5',
			[PRESENTATION_PROPERTIES.indent]: '2em',
			[PRESENTATION_PROPERTIES.align]: null,
			[PRESENTATION_PROPERTIES.hyphens]: null,
			[PRESENTATION_PROPERTIES.tintLight]: '#e5d8be',
			[PRESENTATION_PROPERTIES.tintDark]: '#202e47',
		});
		expect(style.classes).toEqual({
			'is-guide-solid': false,
			'is-guide-dashed': true,
		});
		expect(presentationStyle(look({ guide: 'solid' })).classes).toEqual({
			'is-guide-solid': true,
			'is-guide-dashed': false,
		});
	});

	it('drops a font list nothing usable was typed into', () => {
		expect(
			presentationStyle(look({ fontFamily: ', ;' })).properties[
				PRESENTATION_PROPERTIES.font
			],
		).toBeNull();
	});
});

describe('presentationShape', () => {
	it('tells two looks apart and one look from itself', () => {
		expect(presentationShape(look())).toBe(presentationShape(look()));
		expect(presentationShape(look({ fontSize: 18 }))).not.toBe(
			presentationShape(look()),
		);
		expect(presentationShape(look({ tintDark: '#202e47' }))).not.toBe(
			presentationShape(look({ tintLight: '#202e47' })),
		);
	});

	it('covers every field the page is dressed from', () => {
		// Read off the dress rather than a list of its own, so a field added to
		// `presentationStyle` and forgotten here cannot leave the page blind to
		// that field. Every field is walked and each must move the shape.
		const fields: [keyof ManuscriptPresentation, unknown][] = [
			['fontFamily', 'Iowan Old Style'],
			['fontSize', 18],
			['lineHeight', 1.8],
			['contentWidth', 760],
			['paragraphSpacing', 0.5],
			['firstLineIndent', 2],
			['textAlign', 'justify'],
			['hyphenation', true],
			['tintLight', '#c7e0c7'],
			['tintDark', '#202e47'],
			['guide', 'dashed'],
		];
		const base = presentationShape(look());
		for (const [field, value] of fields) {
			expect(
				presentationShape(look({ [field]: value })),
				`${field} must move the shape`,
			).not.toBe(base);
		}
		// And the walk covers the whole interface, so a twelfth field is a
		// failing test rather than a silent gap.
		expect(fields.map(([field]) => field).sort()).toEqual(
			Object.keys(look()).sort(),
		);
	});
});
