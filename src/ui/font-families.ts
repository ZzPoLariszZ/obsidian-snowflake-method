/**
 * The font families this machine has, for the manuscript's font picker.
 *
 * Asked of the browser once and kept, because the answer does not change while
 * Obsidian is open: a browser takes its list of installed fonts once per
 * process, so a face installed since it started will not join the list however
 * often it is asked -- that is what the typed row is for. The browser answers
 * only for a window the author has just acted in and only while it is visible,
 * so an ask that is refused is not remembered as an answer: a field opened
 * with nothing in hand asks again, and a
 * machine that will not answer at all -- a phone, a build without the local
 * font access API, a refused permission -- leaves the list empty, where the
 * picker still offers the theme's own font, whatever the setting is holding,
 * and the row that takes a name as typed.
 */

import { fontFamilyValue } from '../domain';

interface LocalFont {
	family: string;
}

type FontQuery = () => Promise<LocalFont[]>;

let families: readonly string[] = [];
/** The ask in flight, so two fields opening at once ask the machine once. */
let asking: Promise<readonly string[]> | null = null;

/** The families in hand, in the order the picker offers them. */
export function localFontFamilies(): readonly string[] {
	return families;
}

/**
 * Asks the machine what it has. The answer lands in `localFontFamilies`, which
 * the picker reads each time its list is opened, so a field built before the
 * answer arrives shows the fonts the next time it is opened.
 */
export async function loadLocalFontFamilies(win: Window): Promise<readonly string[]> {
	if (families.length > 0) return families;
	asking ??= askMachine(win);
	return asking;
}

async function askMachine(win: Window): Promise<readonly string[]> {
	const query = (win as Window & { queryLocalFonts?: FontQuery }).queryLocalFonts;
	try {
		if (typeof query !== 'function') return families;
		const fonts = await query.call(win);
		families = [...new Set(fonts.map((font) => font.family))].sort((left, right) =>
			left.localeCompare(right),
		);
	} catch {
		// The window had not been touched, or the machine would rather not say.
		// Either way the next field to open asks again.
	} finally {
		asking = null;
	}
	return families;
}

/** The text measured to tell one face from another: Latin and CJK alike. */
const SAMPLE = 'Handgloves 0123 汉字漢字';

/** The families every machine has, to measure a candidate against. */
const BASELINES = ['monospace', 'serif', 'sans-serif'];

/** What has already been measured; a machine's fonts do not change under it. */
const rendered = new Map<string, boolean>();

/**
 * Whether this machine can actually set text in a family.
 *
 * Measured rather than asked: `document.fonts.check` answers yes for a name
 * it has never heard of, since something always renders in its place. The
 * sample is set in the family with each generic family behind it and compared
 * with the same sample in that generic alone -- a face the machine does not
 * have changes none of the three.
 *
 * This is the second question, after `localFontFamilies`: the browser's list
 * of installed fonts is taken once per session and misses a face installed
 * since, which still sets perfectly well when it is named.
 */
export function fontFamilyRenders(win: Window, family: string): boolean {
	const name = family.trim();
	if (name.length === 0) return false;
	const known = rendered.get(name);
	if (known !== undefined) return known;
	const quoted = fontFamilyValue(name);
	if (quoted.length === 0) return false;
	const probe = win.document.body.createSpan({
		cls: 'snowflake-method-font-probe',
		text: SAMPLE,
	});
	const measure = (list: string): number => {
		probe.style.setProperty('font-family', list);
		return probe.offsetWidth;
	};
	const answer = BASELINES.filter((base) => base !== name.toLowerCase()).some(
		(base) => measure(base) !== measure(`${quoted}, ${base}`),
	);
	probe.remove();
	rendered.set(name, answer);
	return answer;
}
