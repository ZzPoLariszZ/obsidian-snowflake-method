/**
 * Automatic chapter numbers: the next number for a new manuscript note, read
 * off the title of the note before it, and the renumbering of the notes
 * after it -- up by one when a numbered note arrives, down by one when one
 * goes, so the numbers close over the gap a merge leaves.
 *
 * A title carries its number in one of a few spellings -- Chinese numerals,
 * Arabic numerals, zero-padded Arabic numerals -- and the reader chooses a
 * rule: one of three presets, or custom rules of their own, of which one
 * runs at a time. A custom rule is written either as a format -- the
 * numbered head as it is spelled, with a placeholder where the number goes,
 * from which both the reading and the first number follow, and which a
 * name matches only in that spelling -- or as a
 * regular expression, which reads numbers but cannot write the first one
 * unless the reader spells it out beside it. Reading a number never guesses
 * past the rule, and writing one back keeps the spelling the title already
 * had: `第十章` moves to `第十一章`, `第 9 章` to `第 10 章`, `Chapter 0009`
 * to `Chapter 0010`. Only a manuscript with nothing to count on from takes
 * the rule's own seed.
 *
 * Kept free of Obsidian types and of the DOM.
 */

export const CHAPTER_NUMBERING_STYLES = [
	'off',
	'chinese',
	'chinese-arabic',
	'english',
	'custom',
] as const;

export type ChapterNumberingStyle = (typeof CHAPTER_NUMBERING_STYLES)[number];

export function isChapterNumberingStyle(
	value: unknown,
): value is ChapterNumberingStyle {
	return (
		value === 'off' ||
		value === 'chinese' ||
		value === 'chinese-arabic' ||
		value === 'english' ||
		value === 'custom'
	);
}

export const CHAPTER_RULE_KINDS = ['format', 'regex'] as const;

/** The language a custom rule is written in. */
export type ChapterRuleKind = (typeof CHAPTER_RULE_KINDS)[number];

export function isChapterRuleKind(value: unknown): value is ChapterRuleKind {
	return value === 'format' || value === 'regex';
}

/** One custom rule as the settings hold it. */
export interface ChapterNumberRule {
	id: string;
	kind: ChapterRuleKind;
	/**
	 * A format rule: the numbered head as it is written, with `{n}`, `{nnnn}`
	 * or `{zh}` where the number goes. A regex rule: a regular expression a
	 * numbered name matches, its first group the number, or the first run of
	 * numerals in the match.
	 */
	text: string;
	/**
	 * A regex rule's first number, written out, for a manuscript with nothing
	 * numbered; empty for none. A format rule spells its own and ignores it.
	 */
	seed: string;
	/** Whether the rule runs: one at most does, and the settings keep it so. */
	enabled: boolean;
}

/** What the settings hold: the style, and the custom rules. */
export interface ChapterNumberingSettings {
	style: ChapterNumberingStyle;
	rules: readonly ChapterNumberRule[];
}

/** A fresh id for a rule the settings tab is about to create. */
export function newChapterRuleId(): string {
	const salt = Math.floor(Math.random() * 0x7fffffff).toString(36);
	return `numbering-${Date.now().toString(36)}-${salt}`;
}

/**
 * Stored rules read back with junk dropped: an entry missing its shape or
 * its text disappears, a duplicated id keeps its first reading, and only the
 * first rule found running stays running, since one runs at a time.
 */
export function sanitizeChapterNumberRules(value: unknown): ChapterNumberRule[] {
	if (!Array.isArray(value)) return [];
	const rules: ChapterNumberRule[] = [];
	const seen = new Set<string>();
	let running = false;
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) continue;
		const rule = entry as Record<string, unknown>;
		if (typeof rule.id !== 'string' || rule.id.length === 0) continue;
		if (seen.has(rule.id)) continue;
		if (!isChapterRuleKind(rule.kind)) continue;
		if (typeof rule.text !== 'string') continue;
		const text = rule.text.trim();
		if (text.length === 0) continue;
		seen.add(rule.id);
		const enabled: boolean = rule.enabled !== false && !running;
		running = running || enabled;
		rules.push({
			id: rule.id,
			kind: rule.kind,
			text,
			seed: typeof rule.seed === 'string' ? rule.seed.trim() : '',
			enabled,
		});
	}
	return rules;
}

/** The rule that runs, or null while none does. */
export function runningChapterRule(
	rules: readonly ChapterNumberRule[],
): ChapterNumberRule | null {
	return rules.find((rule) => rule.enabled) ?? null;
}

/** A number read out of a title, with where its numerals stand. */
export interface ChapterNumber {
	number: number;
	/** The numeral run, as offsets into the title. */
	from: number;
	to: number;
	spelling: 'arabic' | 'chinese';
}

export interface ChapterNumbering {
	readonly style: ChapterNumberingStyle;
	/** The title's number under this rule, or null when it carries none. */
	read(title: string): ChapterNumber | null;
	/** The title with its number one higher, spelled as it was; null when unnumbered. */
	increment(title: string): string | null;
	/**
	 * The title with its number one lower, spelled as it was; null when
	 * unnumbered, or numbered one, since there is nothing below one to spell.
	 */
	decrement(title: string): string | null;
	/** The numbered head of a title -- up to its unit word -- or null when unnumbered. */
	head(title: string): string | null;
	/**
	 * The first head a manuscript with nothing to count on from is given, or
	 * null for a rule that reads numbers but cannot write the first one.
	 */
	seed(): string | null;
}

/** Why a custom rule cannot be used, for the rule dialog to say. */
export type ChapterRuleProblem = 'pattern' | 'format';

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CHINESE_UNITS = ['', '十', '百', '千'];
const CHINESE_NUMERAL_CHARS = '零〇一二三四五六七八九十百千两';
const CHINESE_DIGIT_VALUES: Readonly<Record<string, number>> = {
	零: 0,
	〇: 0,
	一: 1,
	二: 2,
	两: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9,
};
const CHINESE_UNIT_VALUES: Readonly<Record<string, number>> = {
	十: 10,
	百: 100,
	千: 1000,
};

/**
 * A whole number from 1 to 9999 in Chinese numerals as chapter titles spell
 * them: 十 rather than 一十 at the head, one 零 for any run of zeros inside,
 * nothing for zeros at the end, and 二 throughout.
 */
export function toChineseNumeral(value: number): string {
	if (!Number.isInteger(value) || value < 1 || value > 9999) {
		return String(value);
	}
	const digits = String(value);
	let out = '';
	let zeroPending = false;
	for (let index = 0; index < digits.length; index += 1) {
		const digit = Number(digits.charAt(index));
		const position = digits.length - 1 - index;
		if (digit === 0) {
			zeroPending = out.length > 0;
			continue;
		}
		if (zeroPending) {
			out += CHINESE_DIGITS[0];
			zeroPending = false;
		}
		if (!(digit === 1 && position === 1 && out.length === 0)) {
			out += CHINESE_DIGITS[digit];
		}
		out += CHINESE_UNITS[position];
	}
	return out;
}

/**
 * The number a run of Chinese numerals spells, or null for a run that spells
 * none. Lenient in the ways titles are: 两 for two, 〇 for zero, a unit
 * without a digit before it worth one of itself.
 */
export function parseChineseNumeral(text: string): number | null {
	if (text.length === 0) return null;
	let total = 0;
	let digit: number | null = null;
	for (const character of text) {
		const value = CHINESE_DIGIT_VALUES[character];
		if (value !== undefined) {
			digit = value;
			continue;
		}
		const unit = CHINESE_UNIT_VALUES[character];
		if (unit === undefined) return null;
		total += (digit ?? 1) * unit;
		digit = null;
	}
	if (digit !== null) total += digit;
	return total >= 1 ? total : null;
}

const ARABIC_RUN = /\d+/u;
const CHINESE_RUN = new RegExp(`[${CHINESE_NUMERAL_CHARS}]+`, 'u');
/** The unit word a Chinese head ends on, when one follows the numerals. */
const UNIT_WORD = /^\s*[章回节卷部话集幕篇]/u;
const FORMAT_PLACEHOLDER = /\{(n+|zh)\}/gu;

/** The numeral run in `text` from `offset` on, as a number with its place. */
function readRun(text: string, offset: number): ChapterNumber | null {
	const arabic = ARABIC_RUN.exec(text);
	const chinese = CHINESE_RUN.exec(text);
	const first =
		arabic === null
			? chinese
			: chinese === null || arabic.index <= chinese.index
				? arabic
				: chinese;
	if (first === null) return null;
	const run = first[0];
	const spelling = first === arabic ? 'arabic' : 'chinese';
	const number =
		spelling === 'arabic' ? Number.parseInt(run, 10) : parseChineseNumeral(run);
	if (number === null || !Number.isSafeInteger(number) || number < 1) return null;
	return { number, from: offset + first.index, to: offset + first.index + run.length, spelling };
}

/** The number spelled as the run it replaces was: width and script kept. */
function spellLike(title: string, found: ChapterNumber, next: number): string {
	const run = title.slice(found.from, found.to);
	if (found.spelling === 'chinese') return toChineseNumeral(next);
	const padded = run.length > 1 && run.startsWith('0');
	return padded ? String(next).padStart(run.length, '0') : String(next);
}

function headOf(title: string, found: ChapterNumber): string {
	const unit = UNIT_WORD.exec(title.slice(found.to));
	return title.slice(0, found.to + (unit === null ? 0 : unit[0].length));
}

/** The custom format with its placeholders spelled for `value`. */
export function formatChapterNumber(format: string, value: number): string {
	return format.replace(FORMAT_PLACEHOLDER, (_match, token: string) =>
		token === 'zh' ? toChineseNumeral(value) : String(value).padStart(token.length, '0'),
	);
}

function buildNumbering(
	style: ChapterNumberingStyle,
	read: (title: string) => ChapterNumber | null,
	seed: string | null,
): ChapterNumbering {
	const moved = (title: string, by: number): string | null => {
		const found = read(title);
		if (found === null || found.number + by < 1) return null;
		return (
			title.slice(0, found.from) +
			spellLike(title, found, found.number + by) +
			title.slice(found.to)
		);
	};
	return {
		style,
		read,
		increment: (title) => moved(title, 1),
		decrement: (title) => moved(title, -1),
		head: (title) => {
			const found = read(title);
			return found === null ? null : headOf(title, found);
		},
		seed: () => seed,
	};
}

/** A reader for a preset: the pattern's first group is the numeral run. */
function presetReader(
	pattern: RegExp,
): (title: string) => ChapterNumber | null {
	return (title) => {
		const match = pattern.exec(title);
		if (match === null) return null;
		const group = match[1];
		if (group === undefined) return null;
		const from = match.index + match[0].indexOf(group);
		return readRun(group, from);
	};
}

/**
 * Why a rule written as `kind` cannot be used, or null when it can: a
 * regular expression that does not compile, or a format with nothing in it
 * to put a number into.
 */
export function chapterRuleProblem(
	kind: ChapterRuleKind,
	text: string,
): ChapterRuleProblem | null {
	if (kind === 'regex') {
		try {
			new RegExp(text, 'u');
			return null;
		} catch {
			return 'pattern';
		}
	}
	FORMAT_PLACEHOLDER.lastIndex = 0;
	return FORMAT_PLACEHOLDER.test(text) ? null : 'format';
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/gu;
const FORMAT_SPLIT = /(\{(?:n+|zh)\})/u;

/**
 * The pattern a format describes, matching the style as it is written: the
 * literal parts as they stand, a space where the format has one, and its
 * first placeholder the numeral run the reader takes -- `{n}` any run of
 * digits, `{nnnn}` exactly that many, so `第 {nnnn} 章` reads `第 0003 章`
 * and not `第 3 章`, which is a name in another style; `{zh}` a run of
 * Chinese numerals. Later placeholders match without being read. Anchored
 * at the head, since a format spells the head and the name follows it;
 * case-blind, as the English preset is, since case is not a style.
 */
function formatRulePattern(format: string): RegExp {
	let group = false;
	const source = format
		.split(FORMAT_SPLIT)
		.map((part) => {
			if (part.length === 0) return '';
			if (FORMAT_SPLIT.test(part)) {
				const run =
					part === '{zh}'
						? `[${CHINESE_NUMERAL_CHARS}]+`
						: part.length > 3
							? `\\d{${part.length - 2}}`
							: '\\d+';
				const open = group ? '(?:' : '(';
				group = true;
				return `${open}${run})`;
			}
			return part.replace(REGEX_SPECIALS, '\\$&').replace(/\s+/gu, '\\s+');
		})
		.join('');
	return new RegExp(`^${source}`, 'iu');
}

/**
 * One custom rule compiled, or null for none, or one that cannot be used. A
 * format rule reads through the pattern its format describes and seeds
 * with its format spelled for one. A regex rule's first capture group is
 * the number when it has one; otherwise the first run of Arabic or Chinese
 * numerals inside the match is, which is how a pattern written to describe
 * a whole title -- `^第\s*\d{4}\s*章\s+.+$` -- still says which part is
 * the number. It seeds with the first number written beside it, or not at
 * all.
 */
export function compileChapterRule(
	rule: ChapterNumberRule | null,
): ChapterNumbering | null {
	if (rule === null || chapterRuleProblem(rule.kind, rule.text) !== null) {
		return null;
	}
	if (rule.kind === 'format') {
		return buildNumbering(
			'custom',
			presetReader(formatRulePattern(rule.text)),
			formatChapterNumber(rule.text, 1),
		);
	}
	const pattern = new RegExp(rule.text, 'u');
	const read = (title: string): ChapterNumber | null => {
		const match = pattern.exec(title);
		if (match === null) return null;
		const group = match[1];
		if (group !== undefined) {
			// The group's place is its first appearance inside the match:
			// exact for a numeral run, which is what a group here holds.
			return readRun(group, match.index + match[0].indexOf(group));
		}
		return readRun(match[0], match.index);
	};
	return buildNumbering('custom', read, rule.seed.length > 0 ? rule.seed : null);
}

/**
 * The rule in force, or null while numbering is off, or custom with no rule
 * running or a running rule that cannot be used.
 */
export function compileChapterNumbering(
	settings: ChapterNumberingSettings,
): ChapterNumbering | null {
	switch (settings.style) {
		case 'off':
			return null;
		case 'chinese':
			return buildNumbering(
				'chinese',
				presetReader(new RegExp(`^第\\s*([${CHINESE_NUMERAL_CHARS}]+)\\s*章`, 'u')),
				'第一章',
			);
		case 'chinese-arabic':
			return buildNumbering(
				'chinese-arabic',
				presetReader(/^第\s*(\d+)\s*章/u),
				'第 1 章',
			);
		case 'english':
			return buildNumbering(
				'english',
				presetReader(/^chapter\s+(\d+)/iu),
				'Chapter 1',
			);
		case 'custom':
			return compileChapterRule(runningChapterRule(settings.rules));
	}
}

/** One later note whose number moves by one. */
export interface ChapterFollower {
	/** Its place in the titles handed in. */
	index: number;
	title: string;
	/** The title it will carry. */
	next: string;
}

export interface ChapterNumberProposal {
	/** The numbered head the new note is offered, or null for none. */
	head: string | null;
	/** Every numbered note after the insertion point, each moved up by one. */
	followers: ChapterFollower[];
}

export interface ChapterRemovalProposal {
	/** Every numbered note after the one going, each moved down by one. */
	followers: ChapterFollower[];
}

/**
 * What a new note placed at `insertAt` -- an index into `titles`, the notes
 * in reading order, `titles.length` for the end -- is offered. The note
 * before it is the one that says: numbered, the new note takes the next
 * number and the numbered notes after it move up by one; not numbered, the
 * new note is offered nothing -- unless nothing in the manuscript is
 * numbered under the rule at all, or there is no note before it, in which
 * case the rule's own first number is offered -- when it has one to offer.
 */
export function proposeChapterNumber(
	titles: readonly string[],
	insertAt: number,
	numbering: ChapterNumbering,
): ChapterNumberProposal {
	const at = Math.max(0, Math.min(insertAt, titles.length));
	const previous = at === 0 ? undefined : titles[at - 1];
	let head: string | null;
	if (previous === undefined) {
		head = numbering.seed();
	} else {
		const raised = numbering.increment(previous);
		if (raised !== null) head = numbering.head(raised);
		else if (titles.some((title) => numbering.read(title) !== null)) head = null;
		else head = numbering.seed();
	}
	if (head === null) return { head, followers: [] };
	const followers: ChapterFollower[] = [];
	titles.forEach((title, index) => {
		if (index < at) return;
		const next = numbering.increment(title);
		if (next !== null) followers.push({ index, title, next });
	});
	return { head, followers };
}

/**
 * What the removal of the note at `removeAt` -- an index into `titles`, the
 * notes in reading order -- asks of the notes after it: the mirror of an
 * insertion. A numbered note going leaves a gap in the count, and the
 * numbered notes after it close it by moving down by one, unnumbered notes
 * left where they are; an unnumbered note going leaves the count as it was,
 * so nothing moves. A note already numbered one has nothing below it to move
 * to and stays.
 */
export function proposeChapterRemoval(
	titles: readonly string[],
	removeAt: number,
	numbering: ChapterNumbering,
): ChapterRemovalProposal {
	const removed = titles[removeAt];
	if (removed === undefined || numbering.read(removed) === null) {
		return { followers: [] };
	}
	const followers: ChapterFollower[] = [];
	titles.forEach((title, index) => {
		if (index <= removeAt) return;
		const next = numbering.decrement(title);
		if (next !== null) followers.push({ index, title, next });
	});
	return { followers };
}
