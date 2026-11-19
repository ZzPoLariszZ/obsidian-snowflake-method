import type { DesktopFrame, RecordingQuality, RecordingSystem } from './recording';

/**
 * OBS Studio, as far as the plugin speaks to it: the words of its WebSocket
 * server (obs-websocket 5, part of OBS since version 28), the source the
 * plugin asks it to capture with on each system, and the ledger of what the
 * plugin borrows from it for the length of one recording.
 *
 * The plugin only ever speaks to an OBS on the same computer. It never
 * streams, and it changes nothing in OBS that it does not put back.
 */

// ---- The words of the server ----

/** The kinds of message the server and a client exchange, by the number each carries. */
const OP_HELLO = 0;
const OP_IDENTIFY = 1;
const OP_IDENTIFIED = 2;
const OP_EVENT = 5;
const OP_CALL = 6;
const OP_ANSWER = 7;

/** The version of the server's words the plugin speaks. */
export const OBS_RPC_VERSION = 1;

/** The events asked for: OBS's own (it is quitting) and its outputs' (a recording began, ended). */
export const OBS_EVENT_SUBSCRIPTIONS = (1 << 0) | (1 << 6);

/** The server's answer codes the plugin tells apart from a plain refusal. */
export const OBS_NOT_READY = 207;

/** Why the server closed the conversation, where it says. */
export const OBS_CLOSE_PASSWORD = 4009;
export const OBS_CLOSE_VERSION = 4010;

export type ObsIncoming =
	| { kind: 'hello'; authentication: { challenge: string; salt: string } | null }
	| { kind: 'identified' }
	| { kind: 'event'; type: string; data: Record<string, unknown> }
	| {
			kind: 'answer';
			id: string;
			ok: boolean;
			code: number;
			comment: string | null;
			data: Record<string, unknown>;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** One message from the server, or null for anything that is not one the plugin reads. Never throws. */
export function decodeObsMessage(raw: unknown): ObsIncoming | null {
	if (typeof raw !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || typeof parsed.op !== 'number') return null;
	const data = isRecord(parsed.d) ? parsed.d : {};
	if (parsed.op === OP_HELLO) {
		const authentication = data.authentication;
		return {
			kind: 'hello',
			authentication:
				isRecord(authentication) &&
				typeof authentication.challenge === 'string' &&
				typeof authentication.salt === 'string'
					? { challenge: authentication.challenge, salt: authentication.salt }
					: null,
		};
	}
	if (parsed.op === OP_IDENTIFIED) return { kind: 'identified' };
	if (parsed.op === OP_EVENT) {
		if (typeof data.eventType !== 'string') return null;
		return {
			kind: 'event',
			type: data.eventType,
			data: isRecord(data.eventData) ? data.eventData : {},
		};
	}
	if (parsed.op === OP_ANSWER) {
		const status = data.requestStatus;
		if (typeof data.requestId !== 'string' || !isRecord(status)) return null;
		return {
			kind: 'answer',
			id: data.requestId,
			ok: status.result === true,
			code: typeof status.code === 'number' ? status.code : 0,
			comment: typeof status.comment === 'string' ? status.comment : null,
			data: isRecord(data.responseData) ? data.responseData : {},
		};
	}
	return null;
}

/** The client's answer to the server's greeting: the proof of the password where one is asked. */
export function encodeObsIdentify(authentication: string | null): string {
	return JSON.stringify({
		op: OP_IDENTIFY,
		d: {
			rpcVersion: OBS_RPC_VERSION,
			eventSubscriptions: OBS_EVENT_SUBSCRIPTIONS,
			...(authentication === null ? {} : { authentication }),
		},
	});
}

/** One thing asked of OBS, under an id its answer comes back with. */
export function encodeObsCall(id: string, type: string, data?: Record<string, unknown>): string {
	return JSON.stringify({
		op: OP_CALL,
		d: { requestType: type, requestId: id, ...(data === undefined ? {} : { requestData: data }) },
	});
}

async function sha256Base64(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	let binary = '';
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * The proof of the password the server asks for: the password is never
 * sent, only a digest of it salted by the server and bound to this one
 * conversation's challenge.
 */
export async function obsAuthentication(
	password: string,
	salt: string,
	challenge: string,
): Promise<string> {
	return sha256Base64((await sha256Base64(password + salt)) + challenge);
}

// ---- What OBS is asked to capture with ----

export interface ObsSize {
	width: number;
	height: number;
}

/**
 * The scene the plugin makes in OBS for each thing it can be asked to
 * show, and the source in it. Every screen at once takes a source for each
 * screen: those carry the source's name with the screen's number after it.
 */
export const OBS_SCENES = {
	screen: { scene: 'Snowflake Method screen', input: 'Snowflake Method screen capture' },
	all: { scene: 'Snowflake Method all screens', input: 'Snowflake Method all screens capture' },
	obsidian: { scene: 'Snowflake Method Obsidian', input: 'Snowflake Method Obsidian capture' },
} as const;

/**
 * The second name the source for Obsidian's window goes by. On a Mac a
 * source that follows the author to another window is made anew, and the
 * new one is there before the old one goes, so the two take turns at two
 * names.
 */
export const OBS_WINDOW_SPARE_INPUT = `${OBS_SCENES.obsidian.input} 2`;

/** The name of the source for one screen among several, the first being 1. */
export function obsScreenInputName(index: number): string {
	return `${OBS_SCENES.all.input} ${String(index + 1)}`;
}

/** Obsidian as Windows's capture source knows it. */
const OBSIDIAN_WINDOWS_PROGRAM = ':obsidian.exe';

/**
 * What the plugin's source is set to on a Mac to show one window: the
 * window by the number the system knows it by. The same is set again, with
 * another number, when the author moves to another of Obsidian's windows.
 */
export function obsMacWindowSettings(windowId: number): Record<string, unknown> {
	return { type: 1, window: windowId, show_cursor: true };
}

/**
 * What the system itself calls the thing to record on a Mac: a screen by
 * its identifier, Obsidian's window by its number, or every screen by its
 * identifier and its place on the desk. OBS is never asked for any of it
 * there.
 */
export type ObsMacTarget =
	| { displayUuid: string }
	| { windowId: number }
	| { displays: readonly { displayUuid: string; frame: DesktopFrame }[] };

/** How one item of a source's list is chosen: the screen Obsidian stands on, or Obsidian's own window. */
export type ObsPickRule = 'display' | 'windows-window' | 'x11-window';

export type ObsCapturePlan =
	| {
			kind: 'ready';
			/** The source's kind as this OBS names it, version and all. */
			inputKind: string;
			settings: Record<string, unknown>;
			/** The setting that must be chosen from OBS's own list, since its values cannot be made up. */
			pick: { property: string; rule: ObsPickRule } | null;
	  }
	/** This OBS has no source the plugin knows how to set up by itself. */
	| { kind: 'none' };

/**
 * A source's kind as this OBS registers it. OBS lists kinds with their
 * version on (`xshm_input_v2`), and takes only a name from that list, so
 * the newest version of the kind asked for is found there rather than
 * written from memory.
 */
export function resolveObsKind(kinds: readonly string[], base: string): string | null {
	let best: { name: string; version: number } | null = null;
	for (const name of kinds) {
		let version: number | null = null;
		if (name === base) version = 1;
		else if (name.startsWith(`${base}_v`)) {
			const parsed = Number(name.slice(base.length + 2));
			if (Number.isInteger(parsed) && parsed > 1) version = parsed;
		}
		if (version !== null && (best === null || version > best.version)) best = { name, version };
	}
	return best === null ? null : best.name;
}

/**
 * The source the plugin makes for one scope on one system, read from OBS's
 * own code. Linux under X11 registers its two capture kinds only there, so
 * their absence is how Wayland is told: its sources are chosen in a dialog
 * of the system's that nothing can answer for the author, and the plugin
 * leaves that scene to OBS. Under X11 the screen is chosen from OBS's own
 * list as it is on Windows: a source left to itself shows OBS's first
 * screen, whichever one Obsidian stands on.
 *
 * On a Mac nothing is chosen from a list of OBS's. OBS fills its list of
 * screens with values the newer systems no longer hand it, and its
 * WebSocket server falls over, and OBS with it, when it is asked to send
 * them. So the screen is named by the system's own identifier for it,
 * which OBS takes as it is, and Obsidian by its window's number. Where the
 * system gave neither, there is no source the plugin can make.
 */
export function obsCapturePlan(
	system: RecordingSystem,
	scope: 'screen' | 'obsidian',
	kinds: readonly string[],
	mac: ObsMacTarget | null,
): ObsCapturePlan {
	const ready = (
		base: string,
		settings: Record<string, unknown>,
		pick: { property: string; rule: ObsPickRule } | null,
	): ObsCapturePlan => {
		const inputKind = resolveObsKind(kinds, base);
		return inputKind === null ? { kind: 'none' } : { kind: 'ready', inputKind, settings, pick };
	};
	if (system === 'mac') {
		if (scope === 'screen') {
			return mac !== null && 'displayUuid' in mac
				? ready('screen_capture', { type: 0, display_uuid: mac.displayUuid, show_cursor: true }, null)
				: { kind: 'none' };
		}
		return mac !== null && 'windowId' in mac
			? ready('screen_capture', obsMacWindowSettings(mac.windowId), null)
			: { kind: 'none' };
	}
	if (system === 'win') {
		return scope === 'screen'
			? ready('monitor_capture', { capture_cursor: true }, { property: 'monitor_id', rule: 'display' })
			: ready(
					'window_capture',
					// Found by its program, so a note's name in the window's title never loses it.
					{ priority: 2, cursor: true },
					{ property: 'window', rule: 'windows-window' },
				);
	}
	return scope === 'screen'
		? ready('xshm_input', { show_cursor: true }, { property: 'screen', rule: 'display' })
		: ready('xcomposite_input', { show_cursor: true }, { property: 'capture_window', rule: 'x11-window' });
}

/** One screen among several: what its source is set to, and where the screen stands on the desk. */
export interface ObsScreenPiece {
	settings: Record<string, unknown>;
	frame: DesktopFrame;
}

/**
 * How every screen at once is put into one scene. On a Mac each screen is
 * named by the system, and its place comes with the name. Elsewhere OBS
 * lists its screens itself, each under a name that ends in its size and
 * its place, so the screens are read from that list once a first source
 * is there to ask.
 */
export type ObsAllScreensPlan =
	| { kind: 'pieces'; inputKind: string; pieces: ObsScreenPiece[] }
	| { kind: 'listed'; inputKind: string; settings: Record<string, unknown>; property: string }
	| { kind: 'none' };

export function obsAllScreensPlan(
	system: RecordingSystem,
	kinds: readonly string[],
	mac: ObsMacTarget | null,
): ObsAllScreensPlan {
	if (system === 'mac') {
		const inputKind = resolveObsKind(kinds, 'screen_capture');
		if (inputKind === null || mac === null || !('displays' in mac) || mac.displays.length === 0) return { kind: 'none' };
		return {
			kind: 'pieces',
			inputKind,
			pieces: mac.displays.map((display) => ({
				settings: { type: 0, display_uuid: display.displayUuid, show_cursor: true },
				frame: display.frame,
			})),
		};
	}
	const listed =
		system === 'win'
			? { base: 'monitor_capture', settings: { capture_cursor: true }, property: 'monitor_id' }
			: { base: 'xshm_input', settings: { show_cursor: true }, property: 'screen' };
	const inputKind = resolveObsKind(kinds, listed.base);
	return inputKind === null
		? { kind: 'none' }
		: { kind: 'listed', inputKind, settings: listed.settings, property: listed.property };
}

/** A screen's size and place out of the name OBS lists it under, whatever else the name says: `1920x1080 @ 0,0`. */
export function obsListedFrame(name: string): DesktopFrame | null {
	const match = /(\d+)\s*x\s*(\d+)\s*@\s*(-?\d+)\s*,\s*(-?\d+)/u.exec(name);
	if (match === null) return null;
	const [width, height, x, y] = [match[1], match[2], match[3], match[4]].map(Number);
	if (width === undefined || height === undefined || x === undefined || y === undefined) return null;
	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/**
 * Every screen OBS lists for a source's setting, with the value the
 * setting takes for it. Null where OBS lists none, or lists one whose size
 * and place its name does not give: a scene with a screen missing or put
 * in the wrong place would be a wrong record of the desk.
 */
export function obsListedScreens(
	items: readonly unknown[],
	property: string,
	settings: Record<string, unknown>,
): ObsScreenPiece[] | null {
	const pieces: ObsScreenPiece[] = [];
	for (const item of listItems(items)) {
		// OBS lists a placeholder beside the screens while none is chosen.
		if (item.value === 'DUMMY') continue;
		const frame = obsListedFrame(item.name);
		if (frame === null) return null;
		pieces.push({ settings: { ...settings, [property]: item.value }, frame });
	}
	return pieces.length === 0 ? null : pieces;
}

/**
 * Where each screen goes on OBS's canvas, or on a part of it, so that all
 * of them show at once: arranged as they stand on the desk, as large as
 * the room lets them be, and in its middle.
 */
export function obsScreenLayout(frames: readonly DesktopFrame[], canvas: ObsSize): DesktopFrame[] | null {
	if (frames.length === 0 || !(canvas.width > 0) || !(canvas.height > 0)) return null;
	const left = Math.min(...frames.map((frame) => frame.x));
	const top = Math.min(...frames.map((frame) => frame.y));
	const width = Math.max(...frames.map((frame) => frame.x + frame.width)) - left;
	const height = Math.max(...frames.map((frame) => frame.y + frame.height)) - top;
	if (!(width > 0) || !(height > 0)) return null;
	const scale = Math.min(canvas.width / width, canvas.height / height);
	const round = (value: number): number => Math.round(value * 100) / 100;
	const offsetX = (canvas.width - width * scale) / 2;
	const offsetY = (canvas.height - height * scale) / 2;
	return frames.map((frame) => ({
		x: round(offsetX + (frame.x - left) * scale),
		y: round(offsetY + (frame.y - top) * scale),
		width: round(frame.width * scale),
		height: round(frame.height * scale),
	}));
}

interface ObsListItem {
	name: string;
	value: string | number;
}

function listItems(items: readonly unknown[]): ObsListItem[] {
	const read: ObsListItem[] = [];
	for (const item of items) {
		if (!isRecord(item) || item.itemEnabled === false) continue;
		const value = item.itemValue;
		if (typeof value !== 'string' && typeof value !== 'number') continue;
		if (typeof value === 'string' && value.trim().length === 0) continue;
		read.push({ name: typeof item.itemName === 'string' ? item.itemName : '', value });
	}
	return read;
}

type ObsWindowRule = Exclude<ObsPickRule, 'display'>;

/** Under X11 a window is listed as its id, its title and its class on three lines. */
const x11Parts = (item: ObsListItem): string[] => (typeof item.value === 'string' ? item.value.split('\r\n') : []);

/** Whether a listed window is one of Obsidian's: by its program on Windows, by its class under X11. */
function isObsidianWindow(item: ObsListItem, rule: ObsWindowRule): boolean {
	if (rule === 'windows-window') {
		return typeof item.value === 'string' && item.value.toLowerCase().endsWith(OBSIDIAN_WINDOWS_PROGRAM);
	}
	const windowClass = x11Parts(item)[2] ?? '';
	return windowClass.toLowerCase() === 'obsidian' || item.name.toLowerCase().includes('obsidian');
}

/**
 * Whether a listed window carries a title. Windows lists a window as its
 * program and then its title (`[Obsidian.exe]: Title`). X11 gives the title
 * a line of its own.
 */
function carriesTitle(item: ObsListItem, rule: ObsWindowRule, title: string): boolean {
	if (title.length === 0) return false;
	return rule === 'windows-window' ? item.name.endsWith(`]: ${title}`) : x11Parts(item)[1] === title;
}

/**
 * Chooses one of the values OBS itself lists for a source's setting, or
 * null where none fits. A screen is listed with its size and where it
 * stands (`@ 0,0` is the main one), which is how the screen Obsidian is on
 * is found whatever language OBS speaks. The place is read out of the
 * name, wherever it stands in it: on Windows OBS writes "(Primary
 * Monitor)" after the main screen's, in its own language. OBS counts a
 * screen's place in pixels, so the corner asked for must be in pixels
 * too. Obsidian's window is listed by its program
 * on Windows and by its class under X11. Where Obsidian has several, the
 * one with the title asked for is chosen, and the first of them where none
 * carries it.
 */
export function pickObsListItem(
	items: readonly unknown[],
	rule: ObsPickRule,
	/** The top left corner of the screen Obsidian stands on, in pixels as OBS counts it, where known. */
	origin: { x: number; y: number } | null,
	/** The title of the window of Obsidian's that is wanted, where one is. */
	title: string | null = null,
): string | number | null {
	const listed = listItems(items);
	if (rule === 'display') {
		// OBS lists a placeholder beside the screens while none is chosen.
		const screens = listed.filter((item) => item.value !== 'DUMMY');
		const at = (x: number, y: number): ObsListItem | undefined =>
			screens.find((item) => {
				const frame = obsListedFrame(item.name);
				return frame !== null && frame.x === x && frame.y === y;
			});
		const chosen = (origin === null ? undefined : at(origin.x, origin.y)) ?? at(0, 0) ?? screens[0];
		return chosen === undefined ? null : chosen.value;
	}
	const windows = listed.filter((item) => isObsidianWindow(item, rule));
	const titled = title === null ? undefined : windows.find((item) => carriesTitle(item, rule, title));
	const chosen = titled ?? windows[0];
	return chosen === undefined ? null : chosen.value;
}

/**
 * The value OBS lists for the window of Obsidian's with one title, or null
 * where it lists none. Asked while a recording runs, to follow the author
 * to another window: a window that is not found is not followed, and the
 * recording stays on the one it shows.
 */
export function pickObsWindow(items: readonly unknown[], rule: ObsWindowRule, title: string): string | number | null {
	const chosen = listItems(items).find((item) => isObsidianWindow(item, rule) && carriesTitle(item, rule, title));
	return chosen === undefined ? null : chosen.value;
}

/**
 * The most pixels a side OBS takes for its canvas or its picture when it is
 * asked from outside. OBS itself can be set larger by hand. Read from its
 * answer to a larger number: it names this limit.
 */
export const OBS_SIDE_LIMIT = 4096;

/** The shorter side each quality holds the picture to. None for the picture as large as it is. */
const QUALITY_SIDES: Record<Exclude<RecordingQuality, 'original'>, number | null> = {
	full: null,
	'1440p': 1440,
	'1080p': 1080,
	'720p': 720,
};

/**
 * OBS writes a picture whose width counts in fours and whose height counts
 * in twos, and says the size it kept when asked. A size is asked for as OBS
 * will keep it, or what OBS says afterwards would not be what was asked,
 * and the loan could never be told from a change of the author's.
 */
const OUTPUT_WIDTH_STEP = 4;
const OUTPUT_HEIGHT_STEP = 2;
/** The fewest pixels a side OBS takes for its canvas. */
const OBS_SIDE_FLOOR = 8;

/**
 * The size OBS writes at for a quality: the canvas brought down until its
 * shorter side is the one asked, its shape kept. A canvas already that
 * small is left as it is, never blown up, and no side passes what OBS
 * takes.
 */
export function obsOutputSize(
	base: ObsSize,
	quality: Exclude<RecordingQuality, 'original'>,
): ObsSize | null {
	if (!(base.width > 0) || !(base.height > 0)) return null;
	const side = QUALITY_SIDES[quality];
	const short = Math.min(base.width, base.height);
	const long = Math.max(base.width, base.height);
	const scale = Math.min(1, OBS_SIDE_LIMIT / long, side === null ? 1 : side / short);
	// Unscaled, a side is only ever cut to its step. Scaled, it goes to the nearest.
	const kept = (value: number, step: number): number =>
		Math.max(step, (scale === 1 ? Math.floor(value / step) : Math.round((value * scale) / step)) * step);
	return { width: kept(base.width, OUTPUT_WIDTH_STEP), height: kept(base.height, OUTPUT_HEIGHT_STEP) };
}

/** One source of the plugin's scene as OBS measures it, and where its screen stands on the desk where it is one of several. */
export interface ObsMeasuredItem {
	source: ObsSize;
	frame: DesktopFrame | null;
}

/**
 * How large what the plugin's scene shows is, pixel for pixel. One source
 * alone is as large as OBS says it is. Several screens are as large as the
 * desk they stand on, counted in the pixels of the sharpest of them: a
 * desk is measured in points, and a screen may hold two pixels to a point.
 * Null where OBS gave a source no size yet.
 */
export function obsNativeSize(items: readonly ObsMeasuredItem[]): ObsSize | null {
	if (items.length === 0 || items.some((item) => !(item.source.width > 0) || !(item.source.height > 0))) return null;
	const only = items[0];
	if (items.length === 1 && only !== undefined && only.frame === null) return { ...only.source };
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	let density = 0;
	for (const item of items) {
		const frame = item.frame;
		if (frame === null || !(frame.width > 0) || !(frame.height > 0)) return null;
		left = Math.min(left, frame.x);
		top = Math.min(top, frame.y);
		right = Math.max(right, frame.x + frame.width);
		bottom = Math.max(bottom, frame.y + frame.height);
		density = Math.max(density, item.source.width / frame.width);
	}
	return { width: Math.round((right - left) * density), height: Math.round((bottom - top) * density) };
}

/**
 * The canvas a scene of the plugin's is given for a recording, so that
 * what it shows is drawn pixel for pixel and only OBS's own scaler, which
 * is made for it, ever makes the picture smaller. `area` is the part of
 * the canvas the picture takes: what is recorded as large as it is, or
 * brought down until no side passes what OBS takes. The canvas is that
 * area with each side rounded up to the step OBS writes in, so a picture
 * as large as the canvas is written with nothing scaled at all.
 */
export function obsCanvasPlan(native: ObsSize): { area: ObsSize; canvas: ObsSize } | null {
	if (!(native.width > 0) || !(native.height > 0)) return null;
	const scale = Math.min(1, OBS_SIDE_LIMIT / native.width, OBS_SIDE_LIMIT / native.height);
	const area = {
		width: Math.max(OBS_SIDE_FLOOR, Math.round(native.width * scale)),
		height: Math.max(OBS_SIDE_FLOOR, Math.round(native.height * scale)),
	};
	const up = (value: number, step: number): number => Math.min(OBS_SIDE_LIMIT, Math.ceil(value / step) * step);
	return { area, canvas: { width: up(area.width, OUTPUT_WIDTH_STEP), height: up(area.height, OUTPUT_HEIGHT_STEP) } };
}

/**
 * Where OBS keeps the folder it records into: the key depends on how its
 * output is set up, and only the one in use is borrowed, so one entry of
 * the ledger puts back exactly what was changed.
 */
export function obsFolderKey(
	outputMode: string | null,
	recordType: string | null,
): { category: string; name: string } {
	if (outputMode === 'Advanced') {
		return recordType === 'FFmpeg'
			? { category: 'AdvOut', name: 'FFFilePath' }
			: { category: 'AdvOut', name: 'RecFilePath' };
	}
	return { category: 'SimpleOutput', name: 'FilePath' };
}

// ---- The ledger of what is borrowed ----

/**
 * One thing of OBS's the plugin changed for a recording: what it was, and
 * what the plugin made it. It is given back only while it still reads as
 * the plugin left it: a value the author changed in OBS meanwhile is
 * theirs, and stays.
 */
export type ObsLoan =
	| {
			kind: 'parameter';
			/** The OBS profile the setting belongs to: it is given back only while that one is in use. */
			profile: string;
			category: string;
			name: string;
			before: string | null;
			after: string;
	  }
	| { kind: 'output-size'; profile: string; before: ObsSize; after: ObsSize }
	/** The canvas, borrowed for a scene of the plugin's own and for no other. */
	| { kind: 'canvas'; profile: string; before: ObsSize; after: ObsSize }
	| { kind: 'mute'; input: string; before: boolean; after: boolean }
	| { kind: 'scene'; before: string; after: string };

/**
 * Everything on loan, written to the device before the first change and
 * struck out entry by entry as each is given back, so a crash of either
 * program leaves a list the next conversation with OBS can finish.
 *
 * `recording` is written before OBS is asked to record, and struck out once
 * OBS is known to have stopped. A recording found running in OBS is the
 * plugin's own only while it stands: one the author began in OBS is theirs,
 * whatever else the ledger still holds.
 */
export interface ObsJournal {
	version: 1;
	loans: ObsLoan[];
	recording?: true;
}

const isSize = (value: unknown): value is ObsSize =>
	isRecord(value) && typeof value.width === 'number' && typeof value.height === 'number';

function readLoan(raw: unknown): ObsLoan | null {
	if (!isRecord(raw)) return null;
	if (
		raw.kind === 'parameter' &&
		typeof raw.profile === 'string' &&
		typeof raw.category === 'string' &&
		typeof raw.name === 'string' &&
		(raw.before === null || typeof raw.before === 'string') &&
		typeof raw.after === 'string'
	) {
		return {
			kind: 'parameter',
			profile: raw.profile,
			category: raw.category,
			name: raw.name,
			before: raw.before,
			after: raw.after,
		};
	}
	if (
		(raw.kind === 'output-size' || raw.kind === 'canvas') &&
		typeof raw.profile === 'string' &&
		isSize(raw.before) &&
		isSize(raw.after)
	) {
		return {
			kind: raw.kind,
			profile: raw.profile,
			before: { width: raw.before.width, height: raw.before.height },
			after: { width: raw.after.width, height: raw.after.height },
		};
	}
	if (
		raw.kind === 'mute' &&
		typeof raw.input === 'string' &&
		typeof raw.before === 'boolean' &&
		typeof raw.after === 'boolean'
	) {
		return { kind: 'mute', input: raw.input, before: raw.before, after: raw.after };
	}
	if (raw.kind === 'scene' && typeof raw.before === 'string' && typeof raw.after === 'string') {
		return { kind: 'scene', before: raw.before, after: raw.after };
	}
	return null;
}

/** The ledger as the device kept it, or null where there is none to read. */
export function readObsJournal(raw: unknown): ObsJournal | null {
	if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.loans)) return null;
	const loans: ObsLoan[] = [];
	for (const entry of raw.loans) {
		const loan = readLoan(entry);
		if (loan !== null) loans.push(loan);
	}
	if (raw.recording === true) return { version: 1, loans, recording: true };
	return loans.length === 0 ? null : { version: 1, loans };
}

/** What two entries of the ledger must share to be about the same thing of OBS's. */
export function obsLoanKey(loan: ObsLoan): string {
	if (loan.kind === 'parameter') return `parameter|${loan.profile}|${loan.category}|${loan.name}`;
	if (loan.kind === 'output-size' || loan.kind === 'canvas') return `${loan.kind}|${loan.profile}`;
	if (loan.kind === 'mute') return `mute|${loan.input}`;
	return loan.kind;
}

/**
 * The profile a loan belongs to, or null for one that belongs to none:
 * OBS keeps its settings by profile, its scenes and their sound elsewhere.
 */
export function obsLoanProfile(loan: ObsLoan): string | null {
	return loan.kind === 'parameter' || loan.kind === 'output-size' || loan.kind === 'canvas' ? loan.profile : null;
}

/**
 * A new loan beside what an earlier ledger still holds. Where the earlier
 * one never got its value back, what OBS reads now is the plugin's own
 * doing, and the value to return is the one written down the first time.
 */
export function carryObsLoan(loan: ObsLoan, pending: readonly ObsLoan[]): ObsLoan {
	const earlier = pending.find((entry) => obsLoanKey(entry) === obsLoanKey(loan));
	if (earlier === undefined) return loan;
	if (loan.kind === 'parameter' && earlier.kind === 'parameter') return { ...loan, before: earlier.before };
	if (loan.kind === 'output-size' && earlier.kind === 'output-size') return { ...loan, before: earlier.before };
	if (loan.kind === 'canvas' && earlier.kind === 'canvas') return { ...loan, before: earlier.before };
	if (loan.kind === 'mute' && earlier.kind === 'mute') return { ...loan, before: earlier.before };
	if (loan.kind === 'scene' && earlier.kind === 'scene') return { ...loan, before: earlier.before };
	return loan;
}

/** Whether a loan changes anything: one whose value already stood as asked borrows nothing. */
export function obsLoanIsReal(loan: ObsLoan): boolean {
	if (loan.kind === 'output-size' || loan.kind === 'canvas') {
		return loan.before.width !== loan.after.width || loan.before.height !== loan.after.height;
	}
	return loan.before !== loan.after;
}

/**
 * Whether what OBS holds now is still what the plugin left there. Only
 * then is the old value written back.
 */
export function obsLoanStands(loan: ObsLoan, current: unknown): boolean {
	if (loan.kind === 'output-size' || loan.kind === 'canvas') {
		return isSize(current) && current.width === loan.after.width && current.height === loan.after.height;
	}
	return current === loan.after;
}

// ---- Telling a blank picture ----

/** How far two shades may differ and still be the same blank. */
const BLANK_TOLERANCE = 6;

/**
 * Whether a small bitmap from OBS is one flat color: a scene with nothing
 * in it, a source that captures nothing, an OBS the system has not let
 * see the screen. A screen with anything on it never is. Null where the
 * bytes are not a bitmap this reads.
 */
export function isBlankBitmap(bytes: Uint8Array): boolean | null {
	if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const offset = view.getUint32(10, true);
	const width = view.getInt32(18, true);
	const height = Math.abs(view.getInt32(22, true));
	const bits = view.getUint16(28, true);
	if (width <= 0 || height <= 0 || (bits !== 24 && bits !== 32)) return null;
	const step = bits / 8;
	const row = Math.floor((bits * width + 31) / 32) * 4;
	if (offset + row * height > bytes.length) return null;
	const first = [bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = offset + y * row + x * step;
			for (let channel = 0; channel < 3; channel += 1) {
				const shade = bytes[at + channel] ?? 0;
				if (Math.abs(shade - (first[channel] ?? 0)) > BLANK_TOLERANCE) return false;
			}
		}
	}
	return true;
}

/** The bytes a `data:` address carries in base64, or null where it carries none. */
export function dataUrlBytes(url: string): Uint8Array | null {
	const comma = url.indexOf(',');
	if (!url.startsWith('data:') || comma === -1 || !url.slice(0, comma).endsWith(';base64')) return null;
	try {
		const binary = atob(url.slice(comma + 1));
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return bytes;
	} catch {
		return null;
	}
}

/** Where OBS Studio is had: its makers' own page. */
export const OBS_DOWNLOAD_PAGE = 'https://obsproject.com/download';
