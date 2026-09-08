/**
 * The macaron palette: eight pastel hues named by number, worn by sticky notes
 * and scenes alike. The names are the whole vocabulary here. The hues live in
 * the stylesheet, keyed by `data-color`, so every surface that wears one is
 * painted from the same eight rules.
 */

export const MACARON_COLORS = [
	'macaron-1',
	'macaron-2',
	'macaron-3',
	'macaron-4',
	'macaron-5',
	'macaron-6',
	'macaron-7',
	'macaron-8',
] as const;
export type MacaronColor = (typeof MACARON_COLORS)[number];

export function isMacaronColor(value: unknown): value is MacaronColor {
	return (MACARON_COLORS as readonly unknown[]).includes(value);
}
