import type { DesktopFrame } from '../domain';

/**
 * The desktop's own parts the screen recording asks: a folder chosen in the
 * system's dialog, a file shown in the file manager or moved to the Trash,
 * whether macOS lets Obsidian record the screen, and which window and
 * which screen Obsidian is. All of it is Electron's, read off the window
 * as the app's own code reads it. None of it is in the published API, so
 * every reach goes through a guard, and a part that is not there is an
 * ability the recording goes without rather than a throw. On a phone or a
 * tablet there is no Electron and no shell at all.
 *
 * Nothing here reads or writes a file: the dialog and the file manager are
 * the system's, shown to the author.
 */

export interface DesktopShell {
	/** Asks the author for a folder in the system's own dialog. Null where none was chosen. */
	pickFolder(startAt: string | null): Promise<string | null>;
	/** The system's folder for videos, where it names one. */
	videosFolder(): string | null;
	/** Whether macOS lets Obsidian record the screen. Unknown off a Mac, and where it cannot be asked. */
	screenAccess(): 'granted' | 'denied' | 'unknown';
	/** Obsidian's main window as the system names it to a recorder: `window:1234:0`. */
	windowSource(): string | null;
	/**
	 * The screen the main window stands on: where its corner is, its number
	 * among the screens, the main one being 1, and the number the system
	 * itself knows it by, where the desktop says. The corner is given twice:
	 * as the desktop counts it, and in pixels. The two differ on Windows
	 * and Linux wherever a screen is scaled, and OBS counts in pixels.
	 */
	screen(): {
		origin: { x: number; y: number };
		pixelOrigin: { x: number; y: number };
		index: number;
		id: number | null;
	} | null;
	/**
	 * Every screen there is, the main one first: its place and size on the
	 * desktop, and the number the system knows it by, where the desktop says.
	 */
	displays(): { frame: DesktopFrame; id: number | null }[];
	/** Shows a file in the system's file manager. */
	reveal(path: string): void;
	/** Opens a folder in the system's file manager. */
	openFolder(path: string): void;
	/** Moves a file to the Trash. False where it could not. */
	trash(path: string): Promise<boolean>;
	/** Opens the system's own page on what may record the screen. */
	openScreenPrivacy(): void;
}

/** macOS's page on what may record the screen, by the address the system itself gives it. */
const SCREEN_PRIVACY_PAGE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/** One part of Electron by its name, or null where this build has none. */
function part(owner: unknown, name: string): Record<string, unknown> | null {
	if (!isRecord(owner)) return null;
	const found = owner[name];
	return isRecord(found) ? found : null;
}

/** Calls one of a part's functions by its name, and answers undefined where it has none or it throws. */
function ask(owner: Record<string, unknown> | null, name: string, ...args: unknown[]): unknown {
	if (owner === null) return undefined;
	const candidate = owner[name];
	if (typeof candidate !== 'function') return undefined;
	try {
		return (candidate as (this: unknown, ...given: unknown[]) => unknown).call(owner, ...args);
	} catch {
		return undefined;
	}
}

const figure = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;

function frameOf(display: unknown): DesktopFrame | null {
	const bounds = part(display, 'bounds');
	const x = figure(bounds?.x);
	const y = figure(bounds?.y);
	const width = figure(bounds?.width);
	const height = figure(bounds?.height);
	if (x === null || y === null || width === null || height === null) return null;
	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** The desktop's shell as a window reaches it, or null where the window has no Electron. */
export function desktopShell(win: Window): DesktopShell | null {
	const remote = part(part(win, 'electron'), 'remote');
	if (remote === null) return null;
	const dialog = part(remote, 'dialog');
	const app = part(remote, 'app');
	const shell = part(remote, 'shell');
	const screen = part(remote, 'screen');
	const system = part(remote, 'systemPreferences');
	const mainWindow = (): Record<string, unknown> | null => {
		const found = ask(remote, 'getCurrentWindow');
		return isRecord(found) ? found : null;
	};
	/**
	 * Every screen there is, the main one first, the rest in the system's
	 * order. The one list both answers below are read from, so a screen's
	 * number and its place among the screens can never disagree.
	 */
	const ordered = (): { frame: DesktopFrame; id: number | null }[] => {
		const all = ask(screen, 'getAllDisplays');
		const main = frameOf(ask(screen, 'getPrimaryDisplay'));
		const found = (Array.isArray(all) ? (all as unknown[]) : []).flatMap((display) => {
			const frame = frameOf(display);
			return frame === null ? [] : [{ frame, id: isRecord(display) ? figure(display.id) : null }];
		});
		const isMain = (entry: { frame: DesktopFrame }): boolean =>
			main !== null && entry.frame.x === main.x && entry.frame.y === main.y;
		return [...found.filter(isMain), ...found.filter((entry) => !isMain(entry))];
	};
	return {
		pickFolder: async (startAt) => {
			const window = mainWindow();
			const options = {
				properties: ['openDirectory', 'createDirectory'],
				...(startAt === null ? {} : { defaultPath: startAt }),
			};
			let answered: unknown;
			try {
				answered = await (window === null
					? ask(dialog, 'showOpenDialog', options)
					: ask(dialog, 'showOpenDialog', window, options));
			} catch {
				return null;
			}
			if (!isRecord(answered) || answered.canceled === true || !Array.isArray(answered.filePaths)) return null;
			const first: unknown = (answered.filePaths as unknown[])[0];
			return typeof first === 'string' && first.length > 0 ? first : null;
		},
		videosFolder: () => {
			const found = ask(app, 'getPath', 'videos');
			return typeof found === 'string' && found.length > 0 ? found : null;
		},
		screenAccess: () => {
			const status = ask(system, 'getMediaAccessStatus', 'screen');
			if (status === 'granted') return 'granted';
			return status === 'denied' || status === 'restricted' ? 'denied' : 'unknown';
		},
		windowSource: () => {
			const source = ask(mainWindow(), 'getMediaSourceId');
			return typeof source === 'string' ? source : null;
		},
		screen: () => {
			const window = mainWindow();
			const frame = window === null ? undefined : ask(window, 'getBounds');
			const display = frame === undefined ? undefined : ask(screen, 'getDisplayMatching', frame);
			const found = frameOf(display);
			if (found === null) return null;
			const origin = { x: found.x, y: found.y };
			// The main screen is the first to a recorder, the rest follow in the system's order.
			const position = ordered().findIndex((entry) => entry.frame.x === origin.x && entry.frame.y === origin.y);
			const id = isRecord(display) ? figure(display.id) : null;
			// Electron turns a point into pixels on Windows and Linux alone. A Mac
			// has no such call, and there the plugin names a screen another way.
			const converted = ask(screen, 'dipToScreenPoint', { x: origin.x, y: origin.y });
			const px = isRecord(converted) ? figure(converted.x) : null;
			const py = isRecord(converted) ? figure(converted.y) : null;
			const pixelOrigin = px === null || py === null ? origin : { x: Math.round(px), y: Math.round(py) };
			return { origin, pixelOrigin, index: position === -1 ? 1 : position + 1, id };
		},
		displays: () => ordered(),
		reveal: (path) => {
			ask(shell, 'showItemInFolder', path);
		},
		openFolder: (path) => {
			void Promise.resolve(ask(shell, 'openPath', path)).catch(() => {});
		},
		trash: async (path) => {
			if (shell === null || typeof shell.trashItem !== 'function') return false;
			try {
				await (shell.trashItem as (this: unknown, target: string) => Promise<void>).call(shell, path);
				return true;
			} catch {
				return false;
			}
		},
		openScreenPrivacy: () => {
			void Promise.resolve(ask(shell, 'openExternal', SCREEN_PRIVACY_PAGE)).catch(() => {});
		},
	};
}
