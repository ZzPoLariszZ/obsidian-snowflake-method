/**
 * Screen recording, as far as it can be said without a screen: what the
 * author may choose, what a recording is called, where it may be put, and
 * what the system's own recorder is asked. A recording of the writing is the
 * author's evidence that the words are theirs, so nothing here reads the
 * recording or the manuscript: the plugin starts a recorder, stops it, and
 * says where the file went.
 *
 * Two recorders: the Mac's own `screencapture`, and OBS Studio on the three
 * desktop systems. The choices are kept on the device, never in the settings
 * that travel with a vault, since a folder on one computer and the recorder
 * installed there mean nothing on another.
 */

export const RECORDING_SYSTEMS = ['mac', 'win', 'linux'] as const;
export type RecordingSystem = (typeof RECORDING_SYSTEMS)[number];

export const RECORDING_TOOLS = ['native', 'obs'] as const;
export type RecordingTool = (typeof RECORDING_TOOLS)[number];

/**
 * What a recording shows: the screen Obsidian's window is on, every screen
 * there is, Obsidian alone, or whatever OBS's own scene shows.
 */
export const RECORDING_SCOPES = ['screen', 'all', 'obsidian', 'obs'] as const;
export type RecordingScope = (typeof RECORDING_SCOPES)[number];

/**
 * Where recordings are kept: in a folder of the vault's, or in one outside
 * it. In the vault is where they start, beside the projects they are the
 * proof of. A vault that syncs carries them, which the settings say where
 * the place is chosen.
 */
export const RECORDING_LOCATIONS = ['outside', 'vault'] as const;
export type RecordingLocation = (typeof RECORDING_LOCATIONS)[number];

/** A screen's or a window's place on the desktop, as the system counts it: from the main screen's top left corner. */
export interface DesktopFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * One of Obsidian's own windows, as a recording is told of it: the main
 * one, or one a tab was moved out into. The key is the window itself, the
 * same for as long as it is open and never another's. The number is what a
 * Mac knows the window by, and the title is how OBS lists it elsewhere.
 */
export interface DesktopWindow {
	key: object;
	id: number | null;
	title: string;
}

/**
 * How large the picture OBS writes is. The first leaves OBS's own size
 * alone. The second is the size of what is recorded, pixel for pixel. The
 * others hold the picture's shorter side to 1440, 1080 or 720, and never
 * make a smaller picture larger.
 */
export const RECORDING_QUALITIES = ['original', 'full', '1440p', '1080p', '720p'] as const;
export type RecordingQuality = (typeof RECORDING_QUALITIES)[number];

export const RECORDING_PHASES = ['idle', 'opening', 'starting', 'recording', 'stopping'] as const;
export type RecordingPhase = (typeof RECORDING_PHASES)[number];

/** Why a start came to nothing, or a recording ended badly: each has its own words. */
export const RECORDING_ERROR_CODES = [
	/** Not a desktop, or the desktop's own parts could not be reached. */
	'unavailable',
	/** macOS has not let Obsidian record the screen. */
	'permission',
	/** No folder to record into, or the one chosen cannot be used. */
	'folder',
	/** The folder is a project's own, or inside one. */
	'folder-in-project',
	/** Another screen recording is already running on this Mac. */
	'busy',
	/** The Mac's recorder ended as soon as it began. */
	'recorder-failed',
	/** The Mac's recorder of this system films the whole screen, whichever window it is pointed at. */
	'window-unsupported',
	/** OBS did not answer: closed, or its WebSocket server is off. */
	'obs-closed',
	/** OBS wants a password and has none it accepts. */
	'obs-password',
	/** OBS is too old to be asked what the plugin asks. */
	'obs-old',
	/** OBS is already recording something of its own. */
	'obs-recording',
	/** OBS is streaming, or another output of its runs: a scene of the plugin's would take that picture over. */
	'obs-live',
	/** The plugin's capture source could not be made in OBS. */
	'obs-scene',
	/** OBS's own scene holds nothing to record. */
	'obs-empty',
	/** OBS's picture is blank: it would record nothing. */
	'obs-blank',
	/** OBS refused what it was asked, or never began. */
	'obs-refused',
	/** OBS went away while it was recording. */
	'obs-lost',
] as const;
export type RecordingErrorCode = (typeof RECORDING_ERROR_CODES)[number];

/** Why a recording ended: the author stopped it, something else did, or it could not be followed to its end. */
export type RecordingEndReason = 'stopped' | 'external' | 'lost';

/** Things worth a word that end nothing. */
export const RECORDING_NOTICE_CODES = [
	/** OBS kept its own output size: another output of its was running. */
	'quality-kept',
	/** Something borrowed from OBS could not be given back yet. */
	'return-pending',
] as const;
export type RecordingNoticeCode = (typeof RECORDING_NOTICE_CODES)[number];

export interface RecordingPreferences {
	tool: RecordingTool;
	location: RecordingLocation;
	/** The vault folder recordings go under, as the vault names it. Empty for the one beside the projects. */
	vaultFolder: string;
	/** An absolute folder outside the vault, or empty while none was chosen and the system's video folder stands in. */
	folder: string;
	scope: RecordingScope;
	quality: RecordingQuality;
	obsPort: number;
	/** The name of the secret that holds OBS's password, never the password. Empty for none. */
	obsSecret: string;
	/** OBS has answered on this device: only then is it opened when a start finds it closed. */
	obsReached: boolean;
	/** The notes about a recording are shown, to be agreed to, before each start. The author may say not to be asked again. */
	confirm: boolean;
}

export const DEFAULT_OBS_PORT = 4455;

/** The recorders a system has: the Mac its own and OBS, the others OBS alone. */
export function recordingTools(system: RecordingSystem): readonly RecordingTool[] {
	return system === 'mac' ? RECORDING_TOOLS : ['obs'];
}

/** What a recorder can be pointed at: only OBS has a scene of its own to be left alone. */
export function recordingScopes(tool: RecordingTool): readonly RecordingScope[] {
	return tool === 'obs' ? RECORDING_SCOPES : ['screen', 'all', 'obsidian'];
}

export function defaultRecordingPreferences(system: RecordingSystem): RecordingPreferences {
	return {
		tool: recordingTools(system)[0] ?? 'obs',
		// What a device starts on: recordings in the vault, of Obsidian alone, written at 1080 lines.
		location: 'vault',
		vaultFolder: '',
		folder: '',
		scope: 'obsidian',
		quality: '1080p',
		obsPort: DEFAULT_OBS_PORT,
		obsSecret: '',
		obsReached: false,
		confirm: true,
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null =>
	typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/** A secret's name as Obsidian accepts one: lowercase letters, digits and dashes. */
const SECRET_NAME = /^[a-z0-9][a-z0-9-]*$/u;

/**
 * A vault folder as the vault names one: forward slashes, none at either
 * end, and no step that climbs out of the vault. Anything else is no
 * folder, and reads as none chosen.
 */
export function recordingVaultFolder(raw: string): string {
	const steps = raw
		.normalize('NFC')
		.replace(/\\/gu, '/')
		.split('/')
		.map((step) => step.trim())
		.filter((step) => step.length > 0);
	return steps.some((step) => step === '.' || step === '..') ? '' : steps.join('/');
}

/**
 * The choices as the device kept them, read back whole: anything missing or
 * out of range takes its default, a recorder the system has not falls to
 * the one it has, and a scope the recorder cannot show falls to the one a
 * device starts on.
 */
export function sanitizeRecordingPreferences(
	raw: unknown,
	system: RecordingSystem,
): RecordingPreferences {
	const defaults = defaultRecordingPreferences(system);
	if (!isRecord(raw)) return defaults;
	const tool = oneOf(recordingTools(system), raw.tool) ?? defaults.tool;
	const scope = oneOf(recordingScopes(tool), raw.scope) ?? defaults.scope;
	const port = raw.obsPort;
	return {
		tool,
		location: oneOf(RECORDING_LOCATIONS, raw.location) ?? defaults.location,
		vaultFolder: typeof raw.vaultFolder === 'string' ? recordingVaultFolder(raw.vaultFolder) : defaults.vaultFolder,
		folder: typeof raw.folder === 'string' ? raw.folder.trim() : defaults.folder,
		scope,
		quality: oneOf(RECORDING_QUALITIES, raw.quality) ?? defaults.quality,
		obsPort:
			typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
				? port
				: defaults.obsPort,
		obsSecret:
			typeof raw.obsSecret === 'string' && SECRET_NAME.test(raw.obsSecret)
				? raw.obsSecret
				: defaults.obsSecret,
		obsReached: raw.obsReached === true,
		// Asked unless the author said not to be: what an earlier build kept of a first agreement says nothing of that.
		confirm: raw.confirm !== false,
	};
}

// ---- What a recording is called ----

const two = (value: number): string => String(value).padStart(2, '0');

/**
 * A recording's name without its ending: the moment it began, on the
 * device's own clock, with no mark a path refuses (`2026-11-19 14.30.05`).
 * A recording is the device's and no project's, so no project lends it a
 * name: the moment is all that tells one recording from the next.
 */
export function recordingStamp(at: Date): string {
	return (
		`${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
		`${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`
	);
}

/**
 * The files of one recording by their names. The Mac's recorder takes one
 * screen or one window at a time, so each has a recorder and a file of its
 * own: the same name, with its number after it. One alone needs no number.
 */
export function recordingFileNames(stem: string, screens: number): string[] {
	if (screens <= 1) return [`${stem}.mov`];
	return Array.from({ length: screens }, (_unused, index) => `${stem} (${String(index + 1)}).mov`);
}

/**
 * The name of a file that joins a recording after its start: a window of
 * Obsidian's opened while its windows were being recorded. It takes the
 * next number, whether or not the first file carries one.
 */
export function recordingLaterFileName(stem: string, number: number): string {
	return `${stem} (${String(number)}).mov`;
}

/**
 * The same name as OBS is asked to write it: OBS fills the moment in from
 * its own clock, each figure where its percent sign stands.
 */
export const OBS_FILE_NAME_FORMAT = '%CCYY-%MM-%DD %hh.%mm.%ss';

// ---- Where a recording goes ----

/**
 * Where a folder named by its whole path stands. Outside the vault it is
 * used as it is and the plugin reads nothing there. Inside the vault it is
 * reached through Obsidian's own vault, which can make the folder and count
 * what it holds.
 */
export type RecordingPlace =
	| { kind: 'unset' }
	| { kind: 'outside'; absolute: string }
	| {
			kind: 'vault';
			absolute: string;
			/** The folder as the vault names it: forward slashes, empty for the vault's own root. */
			vaultPath: string;
	  };

function strippedPath(path: string, system: RecordingSystem): string {
	let text = path.normalize('NFC');
	if (system === 'win') text = text.replace(/\\/gu, '/');
	while (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1);
	return text;
}

/** A path as two of them are compared: Linux tells letter case apart, a Mac and Windows as a rule do not. */
function foldedPath(path: string, system: RecordingSystem): string {
	return system === 'linux' ? path : path.toLowerCase();
}

export function recordingPlace(
	folder: string,
	vaultBase: string | null,
	system: RecordingSystem,
): RecordingPlace {
	const picked = folder.trim();
	if (picked.length === 0) return { kind: 'unset' };
	if (vaultBase === null || vaultBase.trim().length === 0) {
		return { kind: 'outside', absolute: picked };
	}
	const base = strippedPath(vaultBase.trim(), system);
	const path = strippedPath(picked, system);
	const foldedBase = foldedPath(base, system);
	const foldedPicked = foldedPath(path, system);
	if (foldedPicked === foldedBase) return { kind: 'vault', absolute: picked, vaultPath: '' };
	// A folder beside the vault whose name only begins as the vault's does is
	// not inside it: the next mark after the vault's path must be a slash.
	if (foldedPicked.startsWith(`${foldedBase}/`) && path.length > base.length) {
		return { kind: 'vault', absolute: picked, vaultPath: path.slice(base.length + 1) };
	}
	return { kind: 'outside', absolute: picked };
}

/** One name under an absolute folder, joined the way the system writes a path. */
export function systemChild(folder: string, name: string, system: RecordingSystem): string {
	const mark = system === 'win' ? '\\' : '/';
	return folder.endsWith('/') || folder.endsWith('\\') ? `${folder}${name}` : `${folder}${mark}${name}`;
}

/**
 * Whether a folder in the vault is a project's own or lies inside one. A
 * recording grows for hours, and every write under a project's root is a
 * change the plugin answers; a project's folders are also laid out by the
 * plugin, and a recording is no part of that layout.
 */
export function insideProjectRoot(vaultPath: string, projectRoots: readonly string[]): boolean {
	return projectRoots.some(
		(root) => root.length === 0 || vaultPath === root || vaultPath.startsWith(`${root}/`),
	);
}

// ---- The Mac's own recorder ----

export const NATIVE_RECORDER = '/usr/sbin/screencapture';
/** The Mac's way of opening an application by its identity, wherever it was put. */
export const MAC_OPENER = '/usr/bin/open';
/**
 * The system's own small tools the recorder is looked after with: whether
 * a folder is there, whether a program still runs, and a signal to one.
 */
export const MAC_FOLDER_TEST = '/bin/test';
export const MAC_PROCESS_LIST = '/bin/ps';
export const MAC_SIGNAL = '/bin/kill';
/** The Mac's own runner of scripts, asked one thing only: what the system calls a screen. */
export const MAC_SCRIPT_RUNNER = '/usr/bin/osascript';
/** The Mac's own teller of its system's version. */
export const MAC_VERSION_TOOL = '/usr/bin/sw_vers';

export function macVersionArguments(): string[] {
	return ['-productVersion'];
}

/** The system's first number out of what the teller prints: 14 out of `14.7`. Null where it printed no version. */
export function readMacVersion(text: string): number | null {
	const match = /^\s*(\d{1,3})(?:\.\d+)*\s*$/u.exec(text);
	return match === null ? null : Number(match[1]);
}

/**
 * The first macOS whose recorder films one window alone: the one that
 * brought recording a single window to the Mac. It was measured to on 26.5
 * and 27.2. The recorder of macOS 15 and before takes a window's number
 * and films the whole screen all the same, as it did on 14.7 and on 15.7,
 * so Obsidian alone is refused there: nothing is ever filmed beyond what
 * was chosen. A system that will not say its version is refused too.
 */
export const NATIVE_WINDOW_SINCE = 26;

export function nativeFilmsWindows(version: number | null): boolean {
	return version !== null && version >= NATIVE_WINDOW_SINCE;
}

/** How long one recording may run before the plugin ends it. */
export const NATIVE_CAP_MS = 12 * 60 * 60 * 1000;

/** What the Mac's recorder is pointed at: one screen by its number, one window by its id, or the main screen. */
export type NativeTarget =
	| { kind: 'main' }
	| { kind: 'display'; index: number }
	| { kind: 'window'; id: number };

/**
 * What the recorder is started with: video, no camera sound, the target,
 * and the file last. No flag for a microphone or the system's sound is
 * ever among them, and neither is the recorder's own time limit. A
 * recorder given a limit hears no stop at all: a signal ends it with
 * nothing saved. One given none ends on an interrupt with its file whole.
 * A window is recorded without the shadow the system draws around it.
 */
export function nativeArguments(file: string, target: NativeTarget): string[] {
	const where =
		target.kind === 'display'
			? ['-D', String(target.index)]
			: target.kind === 'window'
				? ['-o', '-l', String(target.id)]
				: [];
	return ['-v', '-x', ...where, file];
}

/** The window's id out of what Electron calls a window as a capture source: `window:1234:0`. */
export function nativeWindowId(sourceId: string | null): number | null {
	if (sourceId === null) return null;
	const match = /^window:(\d+):\d+$/u.exec(sourceId);
	if (match === null) return null;
	const id = Number(match[1]);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * What is asked to learn that a folder is there and can be written to. The
 * recorder writes elsewhere while it records and moves the file at the
 * end, so a folder that is missing would cost the whole recording.
 */
export function folderTestArguments(folder: string): string[] {
	return ['-d', folder, '-a', '-w', folder];
}

/** What is asked to learn that a recorder's file is there with something in it. */
export function fileTestArguments(file: string): string[] {
	return ['-s', file];
}

/**
 * A recorder that runs, as the device keeps it: enough to find it again and
 * end it. `stopped` says it was sent its stop already and is saving its
 * file: it is waited for, and never sent a second one.
 */
export interface NativeLedger {
	pid: number;
	file: string;
	startedAt: number;
	stopped?: true;
}

function readNativeEntry(raw: unknown): NativeLedger | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const { pid, file, startedAt, stopped } = raw as Record<string, unknown>;
	if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1) return null;
	if (typeof file !== 'string' || file.length === 0) return null;
	if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
	return { pid, file, startedAt, ...(stopped === true ? { stopped: true as const } : {}) };
}

/**
 * Reads the kept recorders: one for each screen a recording takes. A
 * device that kept one alone, as an earlier build wrote it, is read as that
 * one. Anything else is none.
 */
export function readNativeLedger(raw: unknown): NativeLedger[] {
	const entries = Array.isArray(raw) ? (raw as unknown[]) : [raw];
	return entries.map(readNativeEntry).filter((entry): entry is NativeLedger => entry !== null);
}

/** What the system's list of programs is asked for: how long one program has run, and its whole line, however long. */
export function processListArguments(pid: number): string[] {
	return ['-ww', '-o', 'etime=,command=', '-p', String(pid)];
}

/** How far the time a listed program has run may be from the time the device kept, and still be the same start. */
const NATIVE_START_SLACK_MS = 15_000;

/** How long a program has run, as the system's list writes it: days, hours, minutes and seconds, the first two only where they count. */
function elapsedMs(text: string): number | null {
	const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/u.exec(text);
	if (match === null) return null;
	const part = (index: number): number => Number(match[index] ?? 0);
	return (((part(1) * 24 + part(2)) * 60 + part(3)) * 60 + part(4)) * 1000;
}

/**
 * Whether a line of that list is the recorder the device kept. A number is
 * given to another program once its first owner has gone, so a number
 * alone names nothing: the line must be the recorder making a video, and
 * either write the kept file or have run since the kept start. The list
 * spells a name outside ASCII in a way of its own, so the file's name
 * cannot be the only proof.
 */
export function isNativeRecorderLine(line: string, kept: NativeLedger, now: number): boolean {
	const match = /^\s*(\S+)\s+(.+)$/su.exec(line.trimEnd());
	if (match === null) return false;
	const ran = match[1] ?? '';
	const command = match[2] ?? '';
	if (!command.startsWith(`${NATIVE_RECORDER} -v `)) return false;
	if (command.endsWith(` ${kept.file}`)) return true;
	const elapsed = elapsedMs(ran);
	return elapsed !== null && Math.abs(now - elapsed - kept.startedAt) <= NATIVE_START_SLACK_MS;
}

/** What the system's signaller is asked for: an interrupt, which the recorder takes as its stop. */
export function interruptArguments(pid: number): string[] {
	return ['-INT', String(pid)];
}

/**
 * The two scripts the Mac's runner is ever given, word for word. The first
 * says the system's own identifier for a screen, from the screen's number.
 * Nothing of an author's is in either, and the numbers are handed over
 * beside the script, never written into it.
 */
const DISPLAY_IDENTIFIER_SCRIPT = [
	'function run(argv) {',
	'	ObjC.import("CoreGraphics");',
	'	ObjC.import("ColorSync");',
	'	const name = (number) =>',
	'		ObjC.unwrap(ObjC.castRefToObject($.CFUUIDCreateString(null, $.CGDisplayCreateUUIDFromDisplayID(Number(number)))));',
	'	return argv.map(name).join("\\n");',
	'}',
].join('\n');

/** What the Mac's runner of scripts is started with to name screens: the one script, then each screen's number. */
export function displayIdentifierArguments(displayIds: readonly number[]): string[] {
	return ['-l', 'JavaScript', '-e', DISPLAY_IDENTIFIER_SCRIPT, ...displayIds.map(String)];
}

/**
 * The screens' identifiers out of what the script printed, one on a line
 * and as many as were asked for. Null where anything else came back: half
 * an answer names no screen.
 */
export function readDisplayIdentifiers(text: string, count: number): string[] | null {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (count < 1 || lines.length !== count) return null;
	const shaped = lines.every((line) => /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/iu.test(line));
	return shaped ? lines.map((line) => line.toUpperCase()) : null;
}

/**
 * The second script: every screen's number in the order the system keeps
 * them. The Mac's recorder counts its screens off that same list, so a
 * screen's place in it is the number the recorder knows the screen by.
 * The list comes back as bytes, how many screens first.
 */
const DISPLAY_ORDER_SCRIPT = [
	'function run() {',
	'	ObjC.import("CoreGraphics");',
	'	ObjC.import("Foundation");',
	'	ObjC.bindFunction("CGGetActiveDisplayList", ["int", ["unsigned int", "void *", "void *"]]);',
	'	const room = 32;',
	'	const list = $.NSMutableData.dataWithLength(4 * room);',
	'	const count = $.NSMutableData.dataWithLength(4);',
	'	if ($.CGGetActiveDisplayList(room, list.mutableBytes, count.mutableBytes) !== 0) return "";',
	'	const written = (data) => ObjC.unwrap(data.base64EncodedStringWithOptions(0));',
	'	return written(count) + "\\n" + written(list);',
	'}',
].join('\n');

/** What the Mac's runner of scripts is started with to say the order of the screens. */
export function displayOrderArguments(): string[] {
	return ['-l', 'JavaScript', '-e', DISPLAY_ORDER_SCRIPT];
}

/** Whole numbers out of bytes written in base64, four bytes to a number, the low byte first. Null where they are not that. */
function wordsOf(text: string): number[] | null {
	let binary: string;
	try {
		binary = atob(text);
	} catch {
		return null;
	}
	if (binary.length === 0 || binary.length % 4 !== 0) return null;
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	const view = new DataView(bytes.buffer);
	return Array.from({ length: binary.length / 4 }, (_unused, index) => view.getUint32(index * 4, true));
}

/**
 * The screens' numbers in the recorder's own order, out of what the script
 * printed: how many there are, then the list. Null where anything else
 * came back, or a screen has no number.
 */
export function readDisplayOrder(text: string): number[] | null {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const [counted, listed] = lines;
	if (lines.length !== 2 || counted === undefined || listed === undefined) return null;
	const count = wordsOf(counted);
	const list = wordsOf(listed);
	const screens = count?.[0];
	if (count === null || list === null || count.length !== 1 || screens === undefined) return null;
	if (screens < 1 || screens > list.length) return null;
	const numbers = list.slice(0, screens);
	return numbers.every((number) => number > 0) ? numbers : null;
}

/** What the end of the recorder's run means. */
export type NativeExit =
	| { kind: 'ended'; reason: 'stopped' | 'external' }
	/**
	 * It ended on the stop it was sent the way an older recorder does: with
	 * 2, or with the interrupt itself. Its file is saved all the same, which
	 * is believed where the file is there.
	 */
	| { kind: 'interrupted' }
	| { kind: 'failed'; code: RecordingErrorCode; detail: string | null };

/** The last thing the recorder said, short enough to show. */
function lastLine(text: string): string | null {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const last = lines[lines.length - 1];
	return last === undefined ? null : last.slice(0, 200);
}

/**
 * Reads the recorder's exit. It saved its file only where it ended with no
 * fault of its own, and not within the grace of its start, unasked: that
 * one never recorded. Anything else is a recording that was not kept, and
 * what the recorder said on its way out names the cause where it can. One
 * that ended well was stopped by the author, or by the Mac itself: the
 * screen locked, or the stop in the menu bar was pressed.
 */
export function classifyNativeExit(run: {
	stderr: string;
	/** The code the recorder ended with, or null where a signal ended it. */
	code: number | null;
	/** The recorder could not be started at all. */
	spawnError: string | null;
	stopAsked: boolean;
	/** It ended within the grace of its start, unasked. */
	early: boolean;
	/** The signal that ended it, where one did. */
	signal?: string | null;
	/** It was sent its stop, the interrupt. */
	interrupted?: boolean;
}): NativeExit {
	if (run.spawnError !== null) {
		return { kind: 'failed', code: 'recorder-failed', detail: run.spawnError.slice(0, 200) };
	}
	if (run.code === 0 && !run.early) return { kind: 'ended', reason: run.stopAsked ? 'stopped' : 'external' };
	const said = run.stderr.toLowerCase();
	if (said.includes('already running')) return { kind: 'failed', code: 'busy', detail: null };
	if (said.includes('permission') || said.includes('not authorized') || said.includes('declined')) {
		return { kind: 'failed', code: 'permission', detail: null };
	}
	if (said.includes('failed to save') || said.includes('cannot write') || said.includes('intended destination')) {
		return { kind: 'failed', code: 'folder', detail: null };
	}
	// The recorder of macOS 14 answers its stop with a code that is not 0, and has saved its file.
	if (run.interrupted === true && !run.early && (run.code === 2 || (run.code === null && run.signal === 'SIGINT'))) {
		return { kind: 'interrupted' };
	}
	return { kind: 'failed', code: 'recorder-failed', detail: lastLine(run.stderr) };
}

// ---- Opening OBS ----

/** One way of starting OBS: a program at a fixed place, its words, and the folder it must be started in. */
export interface ObsLaunch {
	command: string;
	args: string[];
	cwd?: string;
}

const WINDOWS_OBS_FOLDER = 'C:\\Program Files\\obs-studio\\bin\\64bit';

/**
 * The ways OBS is opened on a system, the likeliest first. The Mac opens it
 * by its identity through the system's own opener, in the background, so
 * macOS holds OBS answerable for what OBS records and not Obsidian. Windows
 * starts it in its own folder, which OBS needs to find its files. Every
 * program is named by its whole path, so nothing on the search path can
 * stand in for it.
 */
export function obsLaunches(system: RecordingSystem): ObsLaunch[] {
	if (system === 'mac') {
		return [
			{
				command: MAC_OPENER,
				args: ['-g', '-b', 'com.obsproject.obs-studio', '--args', '--minimize-to-tray'],
			},
		];
	}
	if (system === 'win') {
		return [
			{
				command: `${WINDOWS_OBS_FOLDER}\\obs64.exe`,
				args: ['--minimize-to-tray'],
				cwd: WINDOWS_OBS_FOLDER,
			},
		];
	}
	return [
		{ command: '/usr/bin/obs', args: [] },
		{ command: '/usr/bin/flatpak', args: ['run', 'com.obsproject.Studio'] },
	];
}

// ---- What the ribbon, the status bar and the settings are told ----

export interface RecordingState {
	phase: RecordingPhase;
	/** The recorder of the recording that runs, or of the last one. */
	tool: RecordingTool | null;
	/** The moment the recording began, while it runs. */
	startedAt: number | null;
	/** How large the file has grown, where the recorder says: OBS does, the Mac's does not. */
	bytes: number | null;
	/** The last recording that ended while the plugin ran: its file where known, and when. */
	last: {
		path: string | null;
		endedAt: number;
		reason: RecordingEndReason;
		/** How many more files it left beside that one: a file for each further screen. */
		more?: number;
	} | null;
	/** Why the last start or the last recording failed, until the next start. */
	error: { code: RecordingErrorCode; detail: string | null } | null;
}

export const IDLE_RECORDING_STATE: RecordingState = {
	phase: 'idle',
	tool: null,
	startedAt: null,
	bytes: null,
	last: null,
	error: null,
};
