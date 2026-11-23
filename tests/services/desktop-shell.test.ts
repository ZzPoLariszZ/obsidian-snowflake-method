import { describe, expect, it } from 'vitest';

import { desktopShell, type DesktopShell } from '../../src/services/desktop-shell';

/**
 * The desktop's screens as Electron hands them over: each with a number and
 * its place, one of them the primary, and one the window stands on.
 */
interface Display {
	id: number;
	bounds: { x: number; y: number; width: number; height: number };
}

const MAIN: Display = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } };
const LEFT: Display = { id: 2, bounds: { x: -1440, y: -690, width: 1440, height: 2560 } };
const RIGHT: Display = { id: 7, bounds: { x: 2560, y: 0, width: 1920, height: 1080 } };

function shellOf(options: {
	all: Display[];
	primary: Display | undefined;
	on: Display | undefined;
	pixels?: (point: { x: number; y: number }) => { x: number; y: number };
}): DesktopShell {
	const win = {
		electron: {
			remote: {
				getCurrentWindow: () => ({ getBounds: () => ({ x: 10, y: 10, width: 800, height: 600 }) }),
				screen: {
					getAllDisplays: () => options.all,
					getPrimaryDisplay: () => options.primary,
					getDisplayMatching: () => options.on,
					...(options.pixels === undefined ? {} : { dipToScreenPoint: options.pixels }),
				},
			},
		},
	} as unknown as Window;
	const shell = desktopShell(win);
	if (shell === null) throw new Error('A window with Electron has a shell.');
	return shell;
}

describe('the desktop’s screens', () => {
	it('lists every screen with the main one first, whatever order the desktop has them in', () => {
		const shell = shellOf({ all: [LEFT, MAIN, RIGHT], primary: MAIN, on: MAIN });
		expect(shell.displays()).toEqual([
			{ frame: MAIN.bounds, id: 1 },
			{ frame: LEFT.bounds, id: 2 },
			{ frame: RIGHT.bounds, id: 7 },
		]);
	});

	it('numbers the screen the window is on by its place in that same list', () => {
		for (const [on, index] of [
			[MAIN, 1],
			[LEFT, 2],
			[RIGHT, 3],
		] as const) {
			const shell = shellOf({ all: [LEFT, MAIN, RIGHT], primary: MAIN, on });
			const screen = shell.screen();
			expect(screen).toEqual({
				origin: { x: on.bounds.x, y: on.bounds.y },
				pixelOrigin: { x: on.bounds.x, y: on.bounds.y },
				index,
				id: on.id,
			});
			// The number and the list never disagree: the screen is the one the list has in that place.
			expect(shell.displays()[index - 1]?.id).toBe(on.id);
		}
	});

	it('counts from the first screen where the desktop names no main one', () => {
		const shell = shellOf({ all: [LEFT, MAIN], primary: undefined, on: MAIN });
		expect(shell.displays().map((display) => display.id)).toEqual([2, 1]);
		expect(shell.screen()?.index).toBe(2);
		expect(shellOf({ all: [LEFT, MAIN], primary: undefined, on: LEFT }).screen()?.index).toBe(1);
	});

	it('gives the screen’s corner in pixels where the desktop can turn points into them', () => {
		const scaled = shellOf({ all: [MAIN, RIGHT], primary: MAIN, on: RIGHT, pixels: (point) => ({ x: point.x * 1.5, y: point.y * 1.5 }) });
		expect(scaled.screen()).toMatchObject({ origin: { x: 2560, y: 0 }, pixelOrigin: { x: 3840, y: 0 }, index: 2 });
	});

	it('names no screen where the desktop cannot say which one the window is on, or gives it no size', () => {
		expect(shellOf({ all: [MAIN], primary: MAIN, on: undefined }).screen()).toBeNull();
		const flat = { id: 9, bounds: { x: 0, y: 0, width: 0, height: 0 } };
		expect(shellOf({ all: [MAIN, flat], primary: MAIN, on: flat }).screen()).toBeNull();
		// A screen with no size is no screen to record either.
		expect(shellOf({ all: [MAIN, flat], primary: MAIN, on: MAIN }).displays()).toEqual([{ frame: MAIN.bounds, id: 1 }]);
	});
});

describe('Obsidian’s own command line switch', () => {
	/** A window whose app answers the switch as given, and keeps what it was asked. */
	const windowOf = (answer: unknown, asked: unknown[][] = []): Window =>
		({
			electron: {
				remote: {},
				ipcRenderer: {
					sendSync: (...sent: unknown[]) => {
						asked.push(sent);
						if (answer instanceof Error) throw answer;
						return answer;
					},
				},
			},
		}) as unknown as Window;

	it('is read as the app’s own settings page reads it, with nothing sent to set', () => {
		const asked: unknown[][] = [];
		expect(desktopShell(windowOf(true, asked))?.commandLine()).toBe(true);
		expect(desktopShell(windowOf(false, asked))?.commandLine()).toBe(false);
		// Null is what the app takes for a question. True or false would set the switch.
		expect(asked).toEqual([
			['cli', null],
			['cli', null],
		]);
	});

	it('is not known where the app gives no answer to go by', () => {
		expect(desktopShell(windowOf(undefined))?.commandLine()).toBeNull();
		expect(desktopShell(windowOf('yes'))?.commandLine()).toBeNull();
		expect(desktopShell(windowOf(new Error('no such channel')))?.commandLine()).toBeNull();
		// A build with no way to ask at all.
		expect(desktopShell({ electron: { remote: {} } } as unknown as Window)?.commandLine()).toBeNull();
	});
});
