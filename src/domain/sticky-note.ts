/**
 * Sticky notes: short Markdown notes kept under a project's task management,
 * for the ideas, reminders and questions that are not structured records.
 *
 * A sticky note is one Markdown file. Its frontmatter carries what the boards
 * need without reading the prose -- the note's own id, its colour, when it was
 * born and whether it has been set aside -- and the body is the note. What
 * this module knows is that frontmatter: how it is read leniently from a file
 * an author may have edited by hand, how a new note's stamp and file name are
 * written, and the sorting, searching and previewing every surface shares.
 *
 * It also shapes the per-device state a floating note keeps -- where it
 * stands, how large, locked or not, how transparent, and which face it shows
 * -- which never enters the Markdown, because a position on one screen means
 * nothing on another.
 */

import { MACARON_COLORS, isMacaronColor, type MacaronColor } from './macaron';
import { FRONTMATTER_KEYS, SCHEMA_VERSION } from './types';

export const STICKY_NOTE_DOCUMENT = 'sticky-note' as const;

/** The eight macaron colours a note can wear: the palette scenes share. */
export const STICKY_NOTE_COLORS = MACARON_COLORS;
export type StickyNoteColor = MacaronColor;
export const DEFAULT_STICKY_NOTE_COLOR: StickyNoteColor = 'macaron-3';

export const isStickyNoteColor = isMacaronColor;

/** The two faces of a note: rendered Markdown, or the Markdown itself. */
export const STICKY_NOTE_MODES = ['viewing', 'editing'] as const;
export type StickyNoteMode = (typeof STICKY_NOTE_MODES)[number];

export function isStickyNoteMode(value: unknown): value is StickyNoteMode {
	return (STICKY_NOTE_MODES as readonly unknown[]).includes(value);
}

export type StickyNoteSort = 'newest' | 'oldest';

/** What the frontmatter says about a note; the file's limbs are added by the service. */
export interface StickyNoteFields {
	id: string;
	color: StickyNoteColor;
	/** Milliseconds since the epoch: the created stamp, or the file's own birth when the stamp is missing or unreadable. */
	createdAt: number;
	archived: boolean;
}

export interface StickyNote extends StickyNoteFields {
	path: string;
	/** Everything below the frontmatter. */
	body: string;
}

function trimmedString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads a note's frontmatter the way an author's hand-edits deserve: only the
 * document type and the id decide whether this is a sticky note at all, and
 * everything else falls back to a sensible value rather than dropping the
 * note. Null means the file is not a sticky note.
 */
export function readStickyNoteFrontmatter(
	frontmatter: Readonly<Record<string, unknown>>,
	fallback: { createdAt: number },
): StickyNoteFields | null {
	if (frontmatter[FRONTMATTER_KEYS.document] !== STICKY_NOTE_DOCUMENT) {
		return null;
	}
	const id = trimmedString(frontmatter[FRONTMATTER_KEYS.stickyNoteId]);
	if (id === null) return null;
	const color = frontmatter[FRONTMATTER_KEYS.stickyNoteColor];
	const archived = frontmatter[FRONTMATTER_KEYS.archived];
	return {
		id,
		color: isStickyNoteColor(color) ? color : DEFAULT_STICKY_NOTE_COLOR,
		createdAt:
			parseStickyNoteCreated(frontmatter[FRONTMATTER_KEYS.created]) ??
			fallback.createdAt,
		archived: archived === true || archived === 'true',
	};
}

/**
 * The created stamp as an instant. A YAML reader may hand the stamp back as a
 * string, as a Date it parsed itself, or -- from an older hand -- as a number;
 * all three are the same moment. A fraction finer than milliseconds is cut
 * before parsing, because the parser reads three digits and no more.
 */
export function parseStickyNoteCreated(value: unknown): number | null {
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isFinite(time) ? time : null;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const text = trimmedString(value);
	if (text === null) return null;
	const parsed = Date.parse(text.replace(/(\.\d{3})\d+/u, '$1'));
	return Number.isFinite(parsed) ? parsed : null;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}

/** `offsetMinutes` as Date#getTimezoneOffset reports it: -60 for +01:00. */
function offsetParts(offsetMinutes: number): {
	sign: string;
	hours: string;
	minutes: string;
} {
	const absolute = Math.abs(offsetMinutes);
	return {
		sign: offsetMinutes <= 0 ? '+' : '-',
		hours: pad(Math.floor(absolute / 60), 2),
		minutes: pad(absolute % 60, 2),
	};
}

function localParts(date: Date, offsetMinutes: number): {
	date: string;
	compactDate: string;
	time: string;
	compactTime: string;
} {
	const local = new Date(date.getTime() - offsetMinutes * 60_000);
	const year = pad(local.getUTCFullYear(), 4);
	const month = pad(local.getUTCMonth() + 1, 2);
	const day = pad(local.getUTCDate(), 2);
	const hour = pad(local.getUTCHours(), 2);
	const minute = pad(local.getUTCMinutes(), 2);
	const second = pad(local.getUTCSeconds(), 2);
	const millisecond = pad(local.getUTCMilliseconds(), 3);
	return {
		date: `${year}-${month}-${day}`,
		compactDate: `${year}${month}${day}`,
		time: `${hour}:${minute}:${second}.${millisecond}`,
		compactTime: `${hour}${minute}${second}.${millisecond}`,
	};
}

/** The stamp a new note is born with: `2026-09-04T06:14:32.123+01:00`. */
export function formatStickyNoteCreated(
	date: Date,
	offsetMinutes: number,
): string {
	const local = localParts(date, offsetMinutes);
	const offset = offsetParts(offsetMinutes);
	return `${local.date}T${local.time}${offset.sign}${offset.hours}:${offset.minutes}`;
}

/**
 * The same moment as a file name, `20260904T061432.123+0100`: readable by
 * eye, sortable by name, and free of the colon no file system allows.
 */
export function stickyNoteFileStem(date: Date, offsetMinutes: number): string {
	const local = localParts(date, offsetMinutes);
	const offset = offsetParts(offsetMinutes);
	return `${local.compactDate}T${local.compactTime}${offset.sign}${offset.hours}${offset.minutes}`;
}

/**
 * The order a note's keys are written in, the schema first as every managed
 * note has it; every later patch passes the same order so a hand-edited note
 * settles once and an unchanged one is never churned.
 */
export const STICKY_NOTE_FRONTMATTER_ORDER: readonly string[] = [
	FRONTMATTER_KEYS.schema,
	FRONTMATTER_KEYS.document,
	FRONTMATTER_KEYS.projectId,
	FRONTMATTER_KEYS.stickyNoteId,
	FRONTMATTER_KEYS.stickyNoteColor,
	FRONTMATTER_KEYS.created,
	FRONTMATTER_KEYS.archived,
];

/**
 * The frontmatter a new note is written with, the schema seeded first so it
 * keeps that place when the repository stamps it on the way to the file.
 */
export function stickyNoteFrontmatter(input: {
	projectId: string;
	id: string;
	color: StickyNoteColor;
	created: string;
}): Record<string, string | number | boolean> {
	return {
		[FRONTMATTER_KEYS.schema]: SCHEMA_VERSION,
		[FRONTMATTER_KEYS.document]: STICKY_NOTE_DOCUMENT,
		[FRONTMATTER_KEYS.projectId]: input.projectId,
		[FRONTMATTER_KEYS.stickyNoteId]: input.id,
		[FRONTMATTER_KEYS.stickyNoteColor]: input.color,
		[FRONTMATTER_KEYS.created]: input.created,
		[FRONTMATTER_KEYS.archived]: false,
	};
}

export const STICKY_NOTE_PREVIEW_CHARS = 120;

/**
 * The first breath of a note as one line of plain words: the marks Markdown
 * draws with are taken off rather than shown, and the line is cut by
 * characters an eye counts, not by the code units a string does.
 */
export function stickyNotePreview(
	body: string,
	limit = STICKY_NOTE_PREVIEW_CHARS,
): string {
	const plain = body
		.replace(/<!--[\s\S]*?-->/gu, ' ')
		.replace(/^[ \t]*`{3,}.*$/gmu, ' ')
		.replace(/^[ \t]*#{1,6}[ \t]+/gmu, '')
		.replace(/^[ \t]*>[ \t]?/gmu, '')
		.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gmu, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/gu, '$2')
		.replace(/\[\[([^\]]*)\]\]/gu, '$1')
		.replace(/\*{1,3}|~~|`+/gu, '')
		.replace(/(^|\s)_{1,3}(?=\S)/gu, '$1')
		.replace(/(\S)_{1,3}(?=\s|$)/gu, '$1')
		.replace(/\s+/gu, ' ')
		.trim();
	const points = [...plain];
	if (points.length <= limit) return plain;
	return `${points.slice(0, limit).join('').trimEnd()}…`;
}

/**
 * The notes a query and a colour leave standing. Every whitespace-separated
 * term must appear somewhere in the body, case aside; no colour means every
 * colour.
 */
export function filterStickyNotes<T extends Pick<StickyNote, 'body' | 'color'>>(
	notes: readonly T[],
	query: string,
	color: StickyNoteColor | null,
): T[] {
	const terms = query
		.trim()
		.toLocaleLowerCase()
		.split(/\s+/u)
		.filter((term) => term.length > 0);
	return notes.filter((note) => {
		if (color !== null && note.color !== color) return false;
		if (terms.length === 0) return true;
		const haystack = note.body.toLocaleLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
}

/** A copy in creation order, ties broken by id so the order never wobbles. */
export function sortStickyNotes<T extends Pick<StickyNote, 'createdAt' | 'id'>>(
	notes: readonly T[],
	order: StickyNoteSort,
): T[] {
	const direction = order === 'newest' ? -1 : 1;
	return [...notes].sort((left, right) => {
		if (left.createdAt !== right.createdAt) {
			return (left.createdAt - right.createdAt) * direction;
		}
		return left.id.localeCompare(right.id, 'en');
	});
}

export function partitionStickyNotes<T extends Pick<StickyNote, 'archived'>>(
	notes: readonly T[],
): { active: T[]; archived: T[] } {
	const active: T[] = [];
	const archived: T[] = [];
	for (const note of notes) (note.archived ? archived : active).push(note);
	return { active, archived };
}

// -- Per-device presentation state -------------------------------------------

/** The localStorage key: per vault, per device, never in data.json. */
export const STICKY_NOTE_LOCAL_STATE_KEY = 'snowflake-method-sticky-notes';

/** Transparency as a percentage of the ground left showing, in tens. */
export const STICKY_NOTE_ALPHA_MIN = 30;
export const STICKY_NOTE_ALPHA_MAX = 100;
export const STICKY_NOTE_ALPHA_STEP = 10;

/** Snaps a slider's reading to the tens between the floor and full: nonsense reads as full. */
export function stepStickyNoteAlpha(raw: number): number {
	if (!Number.isFinite(raw)) return STICKY_NOTE_ALPHA_MAX;
	const stepped =
		Math.round(raw / STICKY_NOTE_ALPHA_STEP) * STICKY_NOTE_ALPHA_STEP;
	return Math.min(
		STICKY_NOTE_ALPHA_MAX,
		Math.max(STICKY_NOTE_ALPHA_MIN, stepped),
	);
}

/** Below this a stored size is nonsense; the live layer applies the real floor in rem. */
export const STICKY_NOTE_STATE_MIN_SIZE = { width: 120, height: 80 } as const;

export interface StickyNoteFloatState {
	/** Standing open in the main window, to be restored at the next start. */
	open: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
	locked: boolean;
	alpha: number;
	mode: StickyNoteMode;
}

export interface StickyNoteLocalState {
	version: 1;
	notes: Record<string, { float: StickyNoteFloatState }>;
}

export const DEFAULT_STICKY_NOTE_FLOAT_STATE: StickyNoteFloatState = {
	open: false,
	x: 24,
	y: 24,
	width: 288,
	height: 224,
	locked: false,
	alpha: STICKY_NOTE_ALPHA_MAX,
	mode: 'viewing',
};

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readFloatState(raw: unknown): StickyNoteFloatState {
	const fallback = DEFAULT_STICKY_NOTE_FLOAT_STATE;
	if (raw === null || typeof raw !== 'object') return { ...fallback };
	const value = raw as Record<string, unknown>;
	return {
		open: value.open === true,
		x: finiteOr(value.x, fallback.x),
		y: finiteOr(value.y, fallback.y),
		width: Math.max(
			STICKY_NOTE_STATE_MIN_SIZE.width,
			finiteOr(value.width, fallback.width),
		),
		height: Math.max(
			STICKY_NOTE_STATE_MIN_SIZE.height,
			finiteOr(value.height, fallback.height),
		),
		locked: value.locked === true,
		alpha: stepStickyNoteAlpha(finiteOr(value.alpha, fallback.alpha)),
		mode: isStickyNoteMode(value.mode) ? value.mode : fallback.mode,
	};
}

/** What the device remembers, made safe: junk of any shape reads as nothing remembered. */
export function readStickyNoteLocalState(raw: unknown): StickyNoteLocalState {
	const state: StickyNoteLocalState = { version: 1, notes: {} };
	if (raw === null || typeof raw !== 'object') return state;
	const notes = (raw as { notes?: unknown }).notes;
	if (notes === null || typeof notes !== 'object') return state;
	for (const [id, entry] of Object.entries(notes as Record<string, unknown>)) {
		if (id.trim().length === 0 || entry === null || typeof entry !== 'object') {
			continue;
		}
		state.notes[id] = {
			float: readFloatState((entry as { float?: unknown }).float),
		};
	}
	return state;
}

export function patchStickyNoteFloatState(
	state: StickyNoteLocalState,
	id: string,
	patch: Partial<StickyNoteFloatState>,
): StickyNoteLocalState {
	const current = state.notes[id]?.float ?? DEFAULT_STICKY_NOTE_FLOAT_STATE;
	return {
		version: 1,
		notes: { ...state.notes, [id]: { float: { ...current, ...patch } } },
	};
}

export function forgetStickyNoteState(
	state: StickyNoteLocalState,
	id: string,
): StickyNoteLocalState {
	const notes = { ...state.notes };
	delete notes[id];
	return { version: 1, notes };
}
