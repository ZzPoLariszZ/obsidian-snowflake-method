import type { RecordingErrorCode, RecordingNoticeCode, RecordingPhase } from '../domain';
import { intlLocaleOf, isSupportedLocale } from '../i18n';
import type { Translate } from './modals';

/**
 * What the screen recording says, worked out apart from the page that
 * draws it: sizes in the reader's own language, a file's name out of its
 * path, and the setup guide's lines cut where they name something of OBS's.
 */

/**
 * What an author is told before recording, in the order it is told: what a
 * recording is for, said in the accent, then one warning of two lines, what
 * a recording shows and what it costs.
 */
export const RECORDING_NOTES = [
	{ key: 'recording.note.purpose', tone: 'accent' },
	{ key: 'recording.note.caution', tone: 'warning' },
] as const;

/**
 * The names OBS gives its own menus and boxes, which the guide quotes as
 * OBS writes them in each language so the author finds the same words on
 * the screen.
 */
export const OBS_TERMS = [
	'tools',
	'serverSettings',
	'enableServer',
	'connectInfo',
	'serverPassword',
	'serverPort',
] as const;
export type ObsTerm = (typeof OBS_TERMS)[number];

/** The guide's steps, in order. Each may name things of OBS's between braces. */
export const OBS_GUIDE_STEPS = [
	'recording.guide.install',
	'recording.guide.server',
	'recording.guide.password',
	'recording.guide.open',
	'recording.guide.own',
] as const;

const isObsTerm = (name: string): name is ObsTerm => (OBS_TERMS as readonly string[]).includes(name);

/** One stretch of a guide line: plain words, the name of something to find, or the way to OBS's own page. */
export interface GuideRun {
	text: string;
	term: boolean;
	link: boolean;
}

/** The recorder's own name, which no language changes. */
const OBS_NAME = 'OBS Studio';

/**
 * A guide line cut at the names it quotes. The line is written with a
 * brace for each name (`open {tools}`), and each brace is filled with
 * OBS's own word for it, marked so the page can set it apart. Two braces
 * are not OBS's: `{obs}` is the recorder's name, drawn as the link to its
 * page, and `{ownScope}` is the plugin's own choice that leaves everything
 * to OBS, said as the choice is written.
 */
export function guideRuns(t: Translate, key: string): GuideRun[] {
	const runs: GuideRun[] = [];
	let rest = t(key);
	for (;;) {
		const match = /\{([a-zA-Z]+)\}/u.exec(rest);
		if (match === null) break;
		const name = match[1] ?? '';
		if (match.index > 0) runs.push({ text: rest.slice(0, match.index), term: false, link: false });
		if (name === 'obs') runs.push({ text: OBS_NAME, term: false, link: true });
		else if (name === 'ownScope') runs.push({ text: t('recording.scope.obs'), term: true, link: false });
		else if (isObsTerm(name)) runs.push({ text: t(`recording.obs.term.${name}`), term: true, link: false });
		else runs.push({ text: match[0], term: false, link: false });
		rest = rest.slice(match.index + match[0].length);
	}
	if (rest.length > 0) runs.push({ text: rest, term: false, link: false });
	return runs;
}

const sizeFormats = new Map<string, Intl.NumberFormat>();

/**
 * A file's size as the reader's language writes one: megabytes up to a
 * thousand of them, gigabytes above, the unit and the decimal sign the
 * language's own (`3.4 GB`, `3,4 Go`). A file under ten megabytes keeps one
 * decimal, so a short recording never reads as nothing at all.
 */
export function recordingSize(bytes: number, locale: string): string {
	const tag = isSupportedLocale(locale) ? intlLocaleOf(locale) : locale;
	const size = Math.max(0, bytes);
	const giga = size >= 1_000_000_000;
	const fine = giga || size < 10_000_000;
	const key = `${tag}|${giga ? 'g' : 'm'}|${fine ? '1' : '0'}`;
	let format = sizeFormats.get(key);
	if (format === undefined) {
		format = new Intl.NumberFormat(tag, {
			style: 'unit',
			unit: giga ? 'gigabyte' : 'megabyte',
			unitDisplay: 'short',
			maximumFractionDigits: fine ? 1 : 0,
		});
		sizeFormats.set(key, format);
	}
	return format.format(size / (giga ? 1_000_000_000 : 1_000_000));
}

/** A file's own name out of its whole path, whichever way the system writes one. */
export function recordingFileName(path: string): string {
	const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return cut === -1 ? path : path.slice(cut + 1);
}

export function recordingPhaseKey(phase: RecordingPhase): string {
	return `recording.phase.${phase}`;
}

export function recordingErrorKey(code: RecordingErrorCode): string {
	return `recording.error.${code}`;
}

export function recordingNoticeKey(code: RecordingNoticeCode): string {
	return `recording.notice.${code}`;
}

/** Why something failed, in words, with what the recorder itself said where it said anything. */
export function recordingErrorText(
	t: Translate,
	error: { code: RecordingErrorCode; detail: string | null },
): string {
	const words = t(recordingErrorKey(error.code));
	// Only the Mac's recorder speaks in sentences worth passing on.
	return error.code === 'recorder-failed' && error.detail !== null ? `${words} ${error.detail}` : words;
}
