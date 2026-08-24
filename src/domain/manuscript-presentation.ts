/**
 * How the manuscript stream is dressed: the typography both halves of the page
 * share, the ground the page stands on in each of Obsidian's two modes, and
 * the guide lines drawn under the text.
 *
 * Kept free of the DOM so the contract between the settings and the
 * stylesheet can be read here and pinned by tests. Every value becomes a
 * custom property on the stream's root, which styles.css reads with the
 * theme's own variable as its fallback -- so a value left at the theme's
 * renders exactly as the theme would, and the rendered half and the editing
 * half read the same numbers from the same place.
 */

import { foldName } from './names';

export type ManuscriptGuide = 'none' | 'solid' | 'dashed';

export const MANUSCRIPT_GUIDES: readonly ManuscriptGuide[] = [
	'none',
	'solid',
	'dashed',
];

export function isManuscriptGuide(value: unknown): value is ManuscriptGuide {
	return (MANUSCRIPT_GUIDES as readonly unknown[]).includes(value);
}

/** How paragraphs sit in the column: the theme's ragged right, or justified. */
export type ManuscriptTextAlign = 'start' | 'justify';

export const MANUSCRIPT_TEXT_ALIGNS: readonly ManuscriptTextAlign[] = [
	'start',
	'justify',
];

export function isManuscriptTextAlign(value: unknown): value is ManuscriptTextAlign {
	return (MANUSCRIPT_TEXT_ALIGNS as readonly unknown[]).includes(value);
}

export interface ManuscriptPresentation {
	/** A font list as the author typed it; empty for the theme's text font. */
	fontFamily: string;
	/** Pixels; 0 for the theme's text size. */
	fontSize: number;
	/** Unitless; 0 for the theme's line height. */
	lineHeight: number;
	/** Pixels of text column; 0 for the width Obsidian gives a note. */
	contentWidth: number;
	/** The gap between paragraphs, in lines of the line height. */
	paragraphSpacing: number;
	/** How far the first line of a paragraph is set in, in em. */
	firstLineIndent: number;
	textAlign: ManuscriptTextAlign;
	/** Long words broken at line ends with a hyphen, from the browser's dictionary. */
	hyphenation: boolean;
	/** The page's color in light mode: '' for the theme's, else #rrggbb. */
	tintLight: string;
	/** The page's color in dark mode: '' for the theme's, else #rrggbb. */
	tintDark: string;
	guide: ManuscriptGuide;
}

export const DEFAULT_MANUSCRIPT_PRESENTATION: Readonly<ManuscriptPresentation> = {
	fontFamily: '',
	fontSize: 0,
	lineHeight: 0,
	contentWidth: 0,
	// One blank line, which is what the editor has always shown between
	// paragraphs; the page is brought to match it rather than the other way
	// round, because the editor is where the author feels a jump.
	paragraphSpacing: 1,
	firstLineIndent: 0,
	textAlign: 'justify',
	hyphenation: false,
	tintLight: '',
	tintDark: '',
	guide: 'none',
};

export interface ManuscriptTint {
	hex: string;
	/** The name the settings page calls it by, as an i18n key suffix. */
	name: string;
}

/** The tints offered for each mode, besides the theme's own and any color. */
export const MANUSCRIPT_TINTS: {
	readonly light: readonly ManuscriptTint[];
	readonly dark: readonly ManuscriptTint[];
} = {
	light: [
		{ hex: '#c7e0c7', name: 'sage' },
		{ hex: '#e5d8be', name: 'parchment' },
		{ hex: '#d3deeb', name: 'mist' },
		{ hex: '#f0dde1', name: 'blush' },
	],
	dark: [
		{ hex: '#202e47', name: 'midnight' },
		{ hex: '#4f555d', name: 'slate' },
		{ hex: '#60406b', name: 'plum' },
		{ hex: '#2d2e61', name: 'indigo' },
	],
};

/**
 * What each number may be. Out-of-range values clamp rather than fall back,
 * so a value that worked yesterday never silently becomes the default.
 */
export const PRESENTATION_LIMITS = {
	fontSize: { min: 12, max: 72 },
	lineHeight: { min: 1.4, max: 3 },
	contentWidth: { min: 320, max: 2000 },
	// Never below a quarter of a line: the editing surface must keep a blank
	// editor line the caret can stand on, and the page keeps the same gap.
	paragraphSpacing: { min: 0.25, max: 3 },
	firstLineIndent: { min: 0, max: 6 },
} as const;

/**
 * The stops the sliders offer, every one of them a size the page can take.
 * The theme's own is not among them: it is what the button beside the slider
 * puts back, so the rail is a range of real values from end to end.
 */
export const FONT_SIZE_STOPS: readonly number[] = [
	12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48,
	56, 64, 72,
];
export const LINE_HEIGHT_STOPS: readonly number[] = [
	1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3,
];
export const CONTENT_WIDTH_STOPS: readonly number[] = [
	480, 520, 560, 600, 640, 680, 720, 760, 800, 880, 960, 1040, 1120, 1200,
];

/**
 * The theme's own variable behind each measure that may be left at it -- the
 * same fallback styles.css reads. A slider whose setting is the theme's has
 * no stop of its own to stand on, so it starts its handle at the stop nearest
 * what the theme is already doing.
 */
export const PRESENTATION_THEME_VARS = {
	fontSize: '--font-text-size',
	lineHeight: '--line-height-normal',
	contentWidth: '--file-line-width',
} as const;
export const PARAGRAPH_SPACING_STOPS: readonly number[] = [
	0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
];
export const FIRST_LINE_INDENT_STOPS: readonly number[] = [
	0, 0.5, 1, 1.5, 2, 2.5, 3, 4,
];

/** The slider index whose stop is nearest the value; the first on a tie. */
export function nearestStop(stops: readonly number[], value: number): number {
	let best = 0;
	let distance = Number.POSITIVE_INFINITY;
	stops.forEach((stop, index) => {
		const apart = Math.abs(stop - value);
		if (apart < distance) {
			distance = apart;
			best = index;
		}
	});
	return best;
}

/** A finite number held inside the limit; anything else is the fallback. */
export function numberIn(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

/**
 * A size that may also be the theme's: zero (or less) means the theme's, any
 * other number is held inside the limit, and what is not a number at all is
 * the fallback.
 */
export function sizeOrTheme(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	// Zero and below is the theme's own, which is outside the range rather than
	// at the bottom of it; everything else is held to the range in one place.
	if (value <= 0) return 0;
	return numberIn(value, min, max, fallback);
}

export function sanitizeFontSize(value: unknown): number {
	const { min, max } = PRESENTATION_LIMITS.fontSize;
	return sizeOrTheme(value, min, max, DEFAULT_MANUSCRIPT_PRESENTATION.fontSize);
}

export function sanitizeLineHeight(value: unknown): number {
	const { min, max } = PRESENTATION_LIMITS.lineHeight;
	return sizeOrTheme(value, min, max, DEFAULT_MANUSCRIPT_PRESENTATION.lineHeight);
}

export function sanitizeContentWidth(value: unknown): number {
	const { min, max } = PRESENTATION_LIMITS.contentWidth;
	return sizeOrTheme(
		value,
		min,
		max,
		DEFAULT_MANUSCRIPT_PRESENTATION.contentWidth,
	);
}

export function sanitizeParagraphSpacing(value: unknown): number {
	const { min, max } = PRESENTATION_LIMITS.paragraphSpacing;
	return numberIn(
		value,
		min,
		max,
		DEFAULT_MANUSCRIPT_PRESENTATION.paragraphSpacing,
	);
}

export function sanitizeFirstLineIndent(value: unknown): number {
	const { min, max } = PRESENTATION_LIMITS.firstLineIndent;
	return numberIn(
		value,
		min,
		max,
		DEFAULT_MANUSCRIPT_PRESENTATION.firstLineIndent,
	);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

/** A six-digit hex color, lowercased; anything else is the theme's own. */
export function sanitizeTint(value: unknown): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : '';
}

export function sanitizeGuide(value: unknown): ManuscriptGuide {
	return isManuscriptGuide(value) ? value : DEFAULT_MANUSCRIPT_PRESENTATION.guide;
}

export function sanitizeTextAlign(value: unknown): ManuscriptTextAlign {
	return isManuscriptTextAlign(value)
		? value
		: DEFAULT_MANUSCRIPT_PRESENTATION.textAlign;
}

export function sanitizeHyphenation(value: unknown): boolean {
	return typeof value === 'boolean'
		? value
		: DEFAULT_MANUSCRIPT_PRESENTATION.hyphenation;
}

/** How long a font list may be as typed. */
const FONT_FAMILY_LENGTH = 120;

/**
 * A font list as the author typed it, with only what a font name can carry:
 * letters, digits, spaces, commas, hyphens, underscores and full stops. Quotes
 * are dropped rather than kept, because the style is what quotes each name
 * (see `fontFamilyValue`), and the characters that end or break a
 * declaration never get as far as the page.
 */
export function sanitizeFontFamily(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value
		.replace(/\s+/gu, ' ')
		.replace(/[^\p{L}\p{M}\p{N} ,\-_.]/gu, '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(', ')
		.slice(0, FONT_FAMILY_LENGTH)
		.trim();
}

/** How many faces the picker keeps at the top of its list. */
export const RECENT_FONT_LIMIT = 6;

/**
 * The faces most recently set, newest first, for the top of the font list.
 * A face already in the list moves to the front rather than joining twice,
 * and the theme's own is not a face and is never remembered.
 */
export function rememberFontFamily(
	recent: readonly string[],
	family: string,
	limit: number = RECENT_FONT_LIMIT,
): string[] {
	const chosen = sanitizeFontFamily(family);
	const chosenKey = foldName(chosen);
	const kept = sanitizeRecentFonts(recent).filter(
		(name) => foldName(name) !== chosenKey,
	);
	if (chosen.length === 0) return kept.slice(0, limit);
	return [chosen, ...kept].slice(0, limit);
}

/** A stored list of faces: each as a font list is written, without repeats. */
export function sanitizeRecentFonts(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const entry of value) {
		const name = sanitizeFontFamily(entry);
		// The domain's own comparison form, which composes as well as folds:
		// a face named with combining accents is one face, not two rows of the
		// same six that look identical.
		const key = foldName(name);
		if (name.length === 0 || seen.has(key)) continue;
		seen.add(key);
		kept.push(name);
	}
	return kept.slice(0, RECENT_FONT_LIMIT);
}

/** The generic family keywords, which mean nothing in quotes. */
const GENERIC_FAMILIES = new Set([
	'serif',
	'sans-serif',
	'monospace',
	'cursive',
	'fantasy',
	'system-ui',
	'ui-serif',
	'ui-sans-serif',
	'ui-monospace',
	'ui-rounded',
	'emoji',
	'math',
	'fangsong',
]);

/**
 * The font list as CSS reads it: every name quoted, so a name with a space
 * or a leading digit is still one name, and the generic keywords left bare.
 * Empty when nothing usable was typed.
 */
export function fontFamilyValue(fontFamily: string): string {
	return sanitizeFontFamily(fontFamily)
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) =>
			GENERIC_FAMILIES.has(part.toLowerCase()) ? part.toLowerCase() : `"${part}"`,
		)
		.join(', ');
}

/** The custom properties styles.css reads, by name. */
export const PRESENTATION_PROPERTIES = {
	font: '--snowflake-method-manuscript-font',
	fontSize: '--snowflake-method-manuscript-font-size',
	lineHeight: '--snowflake-method-manuscript-line-height',
	width: '--snowflake-method-manuscript-width',
	paragraphSpacing: '--snowflake-method-manuscript-paragraph-spacing',
	indent: '--snowflake-method-manuscript-indent',
	align: '--snowflake-method-manuscript-align',
	hyphens: '--snowflake-method-manuscript-hyphens',
	tintLight: '--snowflake-method-manuscript-tint-light',
	tintDark: '--snowflake-method-manuscript-tint-dark',
} as const;

export interface PresentationStyle {
	/** Custom property values for the stream's root; null takes one off. */
	properties: Record<string, string | null>;
	/** Modifier classes on the stream's root, on or off. */
	classes: Record<string, boolean>;
}

/**
 * The whole contract between a presentation and the stylesheet. A property
 * left null is removed from the root, and the stylesheet then reads the
 * theme's own variable in its place.
 */
export function presentationStyle(look: ManuscriptPresentation): PresentationStyle {
	const family = fontFamilyValue(look.fontFamily);
	return {
		properties: {
			// The theme's text font closes the list, so a face this machine
			// does not have falls back to the theme's rather than the browser's.
			[PRESENTATION_PROPERTIES.font]:
				family.length > 0 ? `${family}, var(--font-text)` : null,
			[PRESENTATION_PROPERTIES.fontSize]:
				look.fontSize > 0 ? `${String(look.fontSize)}px` : null,
			[PRESENTATION_PROPERTIES.lineHeight]:
				look.lineHeight > 0 ? String(look.lineHeight) : null,
			// The setting is the width of the text column; the segment's box
			// carries a column of padding on each side inside its max-width.
			[PRESENTATION_PROPERTIES.width]:
				look.contentWidth > 0 ? `${String(look.contentWidth)}px` : null,
			[PRESENTATION_PROPERTIES.paragraphSpacing]: String(look.paragraphSpacing),
			[PRESENTATION_PROPERTIES.indent]: `${String(look.firstLineIndent)}em`,
			// The stylesheet falls back to the theme's ragged right and to manual
			// hyphens, so both are only ever written when they say something.
			[PRESENTATION_PROPERTIES.align]:
				look.textAlign === 'justify' ? 'justify' : null,
			[PRESENTATION_PROPERTIES.hyphens]: look.hyphenation ? 'auto' : null,
			[PRESENTATION_PROPERTIES.tintLight]:
				look.tintLight.length > 0 ? look.tintLight : null,
			[PRESENTATION_PROPERTIES.tintDark]:
				look.tintDark.length > 0 ? look.tintDark : null,
		},
		classes: {
			'is-guide-solid': look.guide === 'solid',
			'is-guide-dashed': look.guide === 'dashed',
		},
	};
}

/** One string per distinct look, so a view can tell a change from a repeat. */
export function presentationShape(look: ManuscriptPresentation): string {
	// Read off what the page is actually given rather than from a second list of
	// the fields. The list had to be kept in step with the interface by hand, and
	// nothing would have said if it were not: a field added to the dress but
	// forgotten here would leave the page never noticing that field change. This
	// cannot fall behind, and it is the sharper question besides -- two looks that
	// produce the same properties and classes are the same look, whatever numbers
	// they were written with.
	const style = presentationStyle(look);
	return [
		...Object.entries(style.properties).map(
			([name, value]) => `${name}:${value ?? ''}`,
		),
		...Object.entries(style.classes).map(
			([name, on]) => `${name}:${on ? '1' : '0'}`,
		),
	].join('|');
}
