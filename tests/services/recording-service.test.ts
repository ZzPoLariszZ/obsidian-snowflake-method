import { describe, expect, it } from 'vitest';

import {
	MAC_FOLDER_TEST,
	MAC_OPENER,
	MAC_PROCESS_LIST,
	MAC_SCRIPT_RUNNER,
	MAC_SIGNAL,
	NATIVE_RECORDER,
	OBS_SCENES,
	defaultRecordingPreferences,
	type DesktopWindow,
	type NativeLedger,
	type ObsJournal,
	type RecordingPreferences,
	type RecordingSystem,
} from '../../src/domain';
import type { DesktopShell } from '../../src/services/desktop-shell';
import { FOLLOW_WAIT_MS, SWAP_SETTLE_MS } from '../../src/services/recording-obs';
import {
	ScreenRecordingService,
	type RecordingCount,
	type RecordingEvent,
} from '../../src/services/recording-service';
import { FakeClock } from '../helpers/fake-clock';
import { FakeObs } from '../helpers/fake-obs';
import { FakeProcessRunner, type FakeProcess } from '../helpers/fake-process';

/** Whole numbers as the Mac's script writes them out: four bytes each, the low byte first, in base64. */
function words(...numbers: number[]): string {
	const bytes = new Uint8Array(numbers.length * 4);
	const view = new DataView(bytes.buffer);
	numbers.forEach((number, index) => {
		view.setUint32(index * 4, number, true);
	});
	return btoa(String.fromCharCode(...bytes));
}

/** Obsidian's main window, and two a tab was moved out into. */
const MAIN_WINDOW: DesktopWindow = { key: { window: 'main' }, id: 4321, title: 'Draft - Vault - Obsidian' };
const SIDE_WINDOW: DesktopWindow = { key: { window: 'side' }, id: 4399, title: 'Notes - Vault - Obsidian' };
const LATER_WINDOW: DesktopWindow = { key: { window: 'later' }, id: 4500, title: 'Cast - Vault - Obsidian' };

function rig(options: { system?: RecordingSystem | null; preferences?: Partial<RecordingPreferences> } = {}) {
	const system = options.system === undefined ? 'mac' : options.system;
	const clock = new FakeClock();
	// A fixed moment on the device's own clock, so a file's name can be read back.
	clock.now = new Date(2026, 10, 19, 14, 30, 5).getTime();
	const obs = new FakeObs();
	const runner = new FakeProcessRunner();
	// The choices most of these tests are about: a folder outside the vault, the screen
	// Obsidian is on, OBS's own size. What a device starts on is tested by name below.
	const chosen: RecordingPreferences = {
		...defaultRecordingPreferences(system ?? 'mac'),
		location: 'outside',
		scope: 'screen',
		quality: 'original',
		...options.preferences,
	};
	const kept = {
		preferences: chosen,
		journal: null as ObsJournal | null,
		/** The Mac's recorder that runs, as the device keeps it. */
		native: null as NativeLedger[] | null,
		/** The folder recordings go into is there and can be written to. */
		folderThere: true,
		trashed: [] as string[],
		/** How many times the author was counted in, and the count each time: one that has run out unless a test says otherwise. */
		counts: 0,
		count: (): RecordingCount => ({ done: Promise.resolve(true), cancel: () => {} }),
		secrets: new Map<string, string>(),
		made: [] as string[],
		window: 'window:4321:0' as string | null,
		/** Obsidian's own windows, the main one first, and the one in use. */
		windows: [MAIN_WINDOW] as DesktopWindow[],
		inUse: MAIN_WINDOW as DesktopWindow | null,
		screen: { origin: { x: 0, y: 0 }, pixelOrigin: { x: 0, y: 0 }, index: 1, id: 3 } as {
			origin: { x: number; y: number };
			/** The same corner in pixels, which is what OBS counts in. */
			pixelOrigin: { x: number; y: number };
			index: number;
			id: number | null;
		} | null,
		/** Every screen there is, the main one first. */
		displays: [{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: 3 }] as {
			frame: { x: number; y: number; width: number; height: number };
			id: number | null;
		}[],
		/** What the system calls each screen, by its number, as its runner of scripts prints them. */
		screenNames: { '3': '08C01862-9690-4A1E-B653-10B1A582F805', '2': 'DCFB4942-F77D-4AFC-AAC8-471180EF3246' } as Record<
			string,
			string
		>,
		/**
		 * The screens' numbers in the order the Mac's recorder counts them, as
		 * the system's own list has them. Null where the system will not say.
		 */
		order: [3] as number[] | null,
		access: 'granted' as 'granted' | 'denied' | 'unknown',
		shell: true,
		runner: true,
	};
	// The Mac's recorder takes an interrupt as its stop and ends with its file whole.
	runner.onRun = (process) => {
		if (process.command === NATIVE_RECORDER) process.onSignal = { SIGINT: 0 };
	};
	runner.played.set(MAC_FOLDER_TEST, (process) => {
		process.end(kept.folderThere ? 0 : 1);
	});
	runner.played.set(MAC_SCRIPT_RUNNER, (process) => {
		// The script that says the recorder's order of the screens is handed no numbers.
		if ((process.args[3] ?? '').includes('CGGetActiveDisplayList')) {
			if (kept.order === null) {
				process.end(1);
				return;
			}
			process.say('out', `${words(kept.order.length)}\n${words(...kept.order, 0, 0)}\n`);
			process.end(0);
			return;
		}
		// The script's own words come first: the screens' numbers follow them.
		const named = process.args.slice(4).map((number) => kept.screenNames[number]);
		if (named.some((name) => name === undefined)) {
			process.end(1);
			return;
		}
		process.say('out', `${named.join('\n')}\n`);
		process.end(0);
	});
	const shell: DesktopShell = {
		pickFolder: () => Promise.resolve(null),
		videosFolder: () => '/Users/ada/Movies',
		screenAccess: () => kept.access,
		windowSource: () => kept.window,
		screen: () => kept.screen,
		displays: () => kept.displays,
		reveal: () => {},
		openFolder: () => {},
		trash: (path) => {
			kept.trashed.push(path);
			return Promise.resolve(true);
		},
		openScreenPrivacy: () => {},
	};
	let minted = 0;
	const service = new ScreenRecordingService({
		system: () => system,
		preferences: () => kept.preferences,
		savePreferences: (next) => {
			kept.preferences = next;
		},
		secret: (name) => kept.secrets.get(name) ?? null,
		place: {
			system: () => system ?? 'mac',
			vaultBase: () => '/Users/ada/Vault',
			videosFolder: () => '/Users/ada/Movies',
			defaultVaultFolder: () => 'Novels/Snowflake Recordings',
			projectRoots: () => ['Novels/Clocktower Snow'],
			fullPath: (path) => `/Users/ada/Vault/${path}`,
			mkdir: (path) => {
				kept.made.push(path);
				return Promise.resolve();
			},
			list: (path) => Promise.resolve(kept.made.includes(path) ? { files: [] } : null),
			size: () => Promise.resolve(null),
		},
		processes: () => Promise.resolve(kept.runner ? runner : null),
		shell: () => (kept.shell ? shell : null),
		windows: () => ({ all: kept.windows, active: kept.inUse }),
		openSocket: obs.open,
		journal: {
			load: () => kept.journal,
			save: (journal) => {
				kept.journal = journal;
			},
		},
		nativeLedger: {
			load: () => kept.native,
			save: (entry) => {
				kept.native = entry;
			},
		},
		timers: clock.timers,
		now: () => clock.now,
		mint: () => {
			minted += 1;
			return `call-${String(minted)}`;
		},
		countIn: () => {
			kept.counts += 1;
			return kept.count();
		},
	});
	const events: RecordingEvent[] = [];
	service.subscribe((event) => {
		if (event.kind !== 'changed') events.push(event);
	});
	/** The Mac's recorder itself, among the small programs started around it. */
	const recorder = (): FakeProcess => {
		const found = runner.of(NATIVE_RECORDER).pop();
		if (found === undefined) throw new Error('No recorder was started.');
		return found;
	};
	return { clock, obs, runner, kept, service, events, recorder };
}

/** A count that runs until it is cancelled, or until a test ends it. */
function heldCount(): { handle: RecordingCount; cancelled: () => number; finish: (ran: boolean) => void } {
	let cancelled = 0;
	let finish: (ran: boolean) => void = () => {};
	const done = new Promise<boolean>((resolve) => {
		finish = resolve;
	});
	return {
		handle: {
			done,
			cancel: () => {
				cancelled += 1;
				finish(false);
			},
		},
		cancelled: () => cancelled,
		finish: (ran) => {
			finish(ran);
		},
	};
}

describe('the screen recording service', () => {
	it('is idle until something is started', () => {
		const { service } = rig();
		expect(service.state()).toEqual({
			phase: 'idle',
			tool: null,
			startedAt: null,
			bytes: null,
			last: null,
			error: null,
		});
	});

	it('records on a Mac with the Mac’s recorder, into the video folder, under the moment it began', async () => {
		const { clock, runner, service, events, recorder } = rig();
		expect(await clock.drive(service.start())).toBeNull();
		// The folder was looked at before anything was recorded into it.
		expect(runner.runs.map((run) => run.command)).toEqual([MAC_FOLDER_TEST, NATIVE_RECORDER]);
		expect(runner.of(MAC_FOLDER_TEST)[0]?.args).toContain('/Users/ada/Movies');
		expect(recorder().args[recorder().args.length - 1]).toBe(
			'/Users/ada/Movies/2026-11-19 14.30.05.mov',
		);
		expect(service.state()).toMatchObject({ phase: 'recording', tool: 'native', error: null });
		expect(service.state().startedAt).toBe(new Date(2026, 10, 19, 14, 30, 5).getTime());
		expect(events).toEqual([{ kind: 'started' }]);
	});

	it('follows the recording to its end and remembers the file', async () => {
		const { clock, kept, service, events, recorder } = rig();
		await clock.drive(service.start());
		const file = '/Users/ada/Movies/2026-11-19 14.30.05.mov';
		// The device knows which recorder runs, for as long as it runs.
		expect(kept.native).toMatchObject([{ pid: recorder().pid, file }]);
		await clock.advance(60_000);
		await clock.drive(service.stop());
		expect(recorder().signals).toEqual(['SIGINT']);
		expect(kept.native).toBeNull();
		expect(service.state()).toMatchObject({
			phase: 'idle',
			startedAt: null,
			last: { path: file, reason: 'stopped' },
			error: null,
		});
		expect(events).toEqual([{ kind: 'started' }, { kind: 'ended', path: file, reason: 'stopped' }]);
	});

	it('points the Mac’s recorder at the screen Obsidian is on, or at Obsidian’s own window', async () => {
		const main = rig();
		await main.clock.drive(main.service.start());
		expect(main.recorder().args).not.toContain('-D');
		expect(main.recorder().args).not.toContain('-l');
		const side = rig();
		side.kept.screen = { origin: { x: -1440, y: -560 }, pixelOrigin: { x: -1440, y: -560 }, index: 2, id: 2 };
		await side.clock.drive(side.service.start());
		expect(side.recorder().args.slice(0, 4)).toEqual(['-v', '-x', '-D', '2']);
		const own = rig({ preferences: { scope: 'obsidian' } });
		await own.clock.drive(own.service.start());
		expect(own.recorder().args.slice(0, 5)).toEqual(['-v', '-x', '-o', '-l', '4321']);
	});

	it('will not record Obsidian alone where the window cannot be named', async () => {
		const { clock, runner, kept, service } = rig({ preferences: { scope: 'obsidian' } });
		kept.windows = [{ ...MAIN_WINDOW, id: null }, SIDE_WINDOW];
		expect(await clock.drive(service.start())).toBe('unavailable');
		expect(runner.runs).toHaveLength(0);
		expect(service.state()).toMatchObject({ phase: 'idle', error: { code: 'unavailable' } });
	});

	it('records each of Obsidian’s windows with the Mac’s recorder, a file for each, as one recording', async () => {
		const { clock, runner, kept, service, events } = rig({ preferences: { scope: 'obsidian' } });
		// A second window without a number cannot be filmed, and is left out.
		kept.windows = [MAIN_WINDOW, SIDE_WINDOW, { key: { window: 'unnamed' }, id: null, title: '' }];
		expect(await clock.drive(service.start())).toBeNull();
		const stem = '/Users/ada/Movies/2026-11-19 14.30.05';
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args)).toEqual([
			['-v', '-x', '-o', '-l', '4321', `${stem} (1).mov`],
			['-v', '-x', '-o', '-l', '4399', `${stem} (2).mov`],
		]);
		await clock.drive(service.stop());
		expect(events).toEqual([
			{ kind: 'started' },
			{ kind: 'ended', path: `${stem} (1).mov`, reason: 'stopped', more: 1 },
		]);
		expect(service.state().last).toMatchObject({ path: `${stem} (1).mov`, more: 1 });
	});

	it('takes in a window that opens under such a recording, and lets go of one that closes', async () => {
		const { clock, runner, kept, service, events } = rig({ preferences: { scope: 'obsidian' } });
		await clock.drive(service.start());
		const stem = '/Users/ada/Movies/2026-11-19 14.30.05';
		// One window at the start is one file with no number. The next takes the number after it.
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args[process.args.length - 1])).toEqual([`${stem}.mov`]);
		service.windowOpened(SIDE_WINDOW);
		await clock.settle();
		service.windowOpened(LATER_WINDOW);
		await clock.settle();
		const [main, side, later] = runner.of(NATIVE_RECORDER);
		expect([side?.args, later?.args]).toEqual([
			['-v', '-x', '-o', '-l', '4399', `${stem} (2).mov`],
			['-v', '-x', '-o', '-l', '4500', `${stem} (3).mov`],
		]);
		expect(kept.native).toHaveLength(3);
		// The folder is not looked at again.
		expect(runner.of(MAC_FOLDER_TEST)).toHaveLength(1);
		service.windowClosed(SIDE_WINDOW.key);
		await clock.settle();
		expect([main?.signals, side?.signals, later?.signals]).toEqual([[], ['SIGINT'], []]);
		expect(service.state().phase).toBe('recording');
		expect(kept.native).toHaveLength(2);
		await clock.drive(service.stop());
		expect(events).toEqual([{ kind: 'started' }, { kind: 'ended', path: `${stem}.mov`, reason: 'stopped', more: 2 }]);
		// Once it has ended, a window that opens is nobody's to record.
		service.windowOpened(LATER_WINDOW);
		await clock.settle();
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(3);
	});

	it('starts no recorder for a new window where the recording is not of Obsidian alone, or has not begun', async () => {
		const idle = rig({ preferences: { scope: 'obsidian' } });
		idle.service.windowOpened(SIDE_WINDOW);
		idle.service.windowClosed(SIDE_WINDOW.key);
		idle.service.windowFocused(SIDE_WINDOW);
		await idle.clock.settle();
		expect(idle.runner.runs).toHaveLength(0);

		for (const scope of ['screen', 'all'] as const) {
			const { clock, runner, service } = rig({ preferences: { scope } });
			await clock.drive(service.start());
			service.windowOpened(SIDE_WINDOW);
			service.windowFocused(SIDE_WINDOW);
			service.windowClosed(SIDE_WINDOW.key);
			await clock.settle();
			expect(runner.of(NATIVE_RECORDER), scope).toHaveLength(1);
			expect(runner.of(NATIVE_RECORDER)[0]?.signals, scope).toEqual([]);
		}

		const unnamed = rig({ preferences: { scope: 'obsidian' } });
		await unnamed.clock.drive(unnamed.service.start());
		unnamed.service.windowOpened({ ...SIDE_WINDOW, id: null });
		await unnamed.clock.settle();
		expect(unnamed.runner.of(NATIVE_RECORDER)).toHaveLength(1);
	});

	it('takes in a window that opened while the author was counted in, once the recording stands', async () => {
		const { clock, runner, kept, service } = rig({ preferences: { scope: 'obsidian' } });
		const count = heldCount();
		kept.count = () => count.handle;
		const starting = service.start();
		await clock.advance(300);
		// A tab is moved out into a window of its own during the count, and the plugin says so as at any time.
		kept.windows = [MAIN_WINDOW, SIDE_WINDOW];
		service.windowOpened(SIDE_WINDOW);
		await clock.settle();
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		count.finish(true);
		expect(await clock.drive(starting)).toBeNull();
		await clock.settle();
		const stem = '/Users/ada/Movies/2026-11-19 14.30.05';
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args)).toEqual([
			['-v', '-x', '-o', '-l', '4321', `${stem}.mov`],
			['-v', '-x', '-o', '-l', '4399', `${stem} (2).mov`],
		]);
		// Told of once more by the window's own event, it gets no second recorder.
		service.windowOpened(SIDE_WINDOW);
		await clock.settle();
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(2);
		await clock.drive(service.stop());
		expect(service.state().last).toMatchObject({ path: `${stem}.mov`, more: 1 });
	});

	it('asks again for the number of a window that has none yet, and leaves out one that never gets it', async () => {
		const { clock, runner, kept, service } = rig({ preferences: { scope: 'obsidian' } });
		await clock.drive(service.start());
		const unnamed = { ...SIDE_WINDOW, id: null };
		kept.windows = [MAIN_WINDOW, unnamed];
		service.windowOpened(unnamed);
		await clock.advance(450);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(1);
		// By the second look the window has its number.
		kept.windows = [MAIN_WINDOW, SIDE_WINDOW];
		await clock.advance(450);
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args[4])).toEqual(['4321', '4399']);
		// One that never gets a number is looked at a few times and then left out.
		const never = { ...LATER_WINDOW, id: null };
		kept.windows = [MAIN_WINDOW, SIDE_WINDOW, never];
		service.windowOpened(never);
		await clock.advance(5000);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(2);
		// And one that closed again before it had a number is not looked for any longer.
		const gone = { key: { window: 'gone' }, id: null, title: 'Gone' };
		service.windowOpened(gone);
		await clock.advance(5000);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(2);
	});

	it('begins OBS on the window in use and follows the author from window to window', async () => {
		const { clock, obs, runner, kept, service } = rig({ preferences: { tool: 'obs', scope: 'obsidian' } });
		kept.windows = [MAIN_WINDOW, SIDE_WINDOW];
		kept.inUse = SIDE_WINDOW;
		expect(await clock.drive(service.start())).toBeNull();
		const shown = (): unknown[] => obs.onAir().map((source) => source.window);
		const moved = FOLLOW_WAIT_MS + SWAP_SETTLE_MS;
		expect(shown()).toEqual([4399]);
		service.windowFocused(MAIN_WINDOW);
		await clock.advance(moved);
		expect(shown()).toEqual([4321]);
		// A window that opens says nothing by itself: it comes forward, and that is heard.
		obs.desk.push(4500);
		service.windowOpened(LATER_WINDOW);
		await clock.advance(moved);
		expect(shown()).toEqual([4321]);
		service.windowFocused(LATER_WINDOW);
		await clock.advance(moved);
		expect(shown()).toEqual([4500]);
		expect([obs.heard, obs.misplaced]).toEqual([[], []]);
		// No recorder of the Mac's is started beside OBS, and OBS is asked for no list.
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
		expect(obs.recording).toBe(true);
	});

	it('hands OBS on to the window in use, or the main one, when the window it shows closes', async () => {
		const { clock, obs, kept, service } = rig({ preferences: { tool: 'obs', scope: 'obsidian' } });
		kept.windows = [MAIN_WINDOW, SIDE_WINDOW, LATER_WINDOW];
		kept.inUse = SIDE_WINDOW;
		obs.desk.push(4500);
		await clock.drive(service.start());
		const shown = (): unknown[] => obs.onAir().map((source) => source.window);
		const moved = FOLLOW_WAIT_MS + SWAP_SETTLE_MS;
		// It closed, and the author is already in another of Obsidian's windows.
		kept.windows = [MAIN_WINDOW, LATER_WINDOW];
		kept.inUse = LATER_WINDOW;
		obs.desk = [4321, 4500];
		expect(shown()).toEqual([]);
		service.windowClosed(SIDE_WINDOW.key);
		await clock.advance(moved);
		expect(shown()).toEqual([4500]);
		// It closed while Obsidian still names it as the one in use: the main window takes its place.
		kept.windows = [MAIN_WINDOW];
		obs.desk = [4321];
		service.windowClosed(LATER_WINDOW.key);
		await clock.advance(moved);
		expect(shown()).toEqual([4321]);
		// A window that closes while another is shown changes nothing.
		const asked = obs.types().length;
		kept.inUse = MAIN_WINDOW;
		service.windowClosed(SIDE_WINDOW.key);
		await clock.advance(moved);
		expect(obs.types().length).toBe(asked);
	});

	it('names why a start came to nothing, and forgets it at the next start', async () => {
		const { clock, runner, kept, service, events } = rig();
		kept.access = 'denied';
		expect(await clock.drive(service.start())).toBe('permission');
		expect(service.state()).toMatchObject({ phase: 'idle', error: { code: 'permission', detail: null } });
		expect(events).toEqual([{ kind: 'failed', code: 'permission', detail: null }]);
		kept.access = 'granted';
		expect(await clock.drive(service.start())).toBeNull();
		expect(service.state().error).toBeNull();
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(1);
	});

	it('records nothing into a folder that is not there', async () => {
		const { clock, runner, kept, service } = rig();
		kept.folderThere = false;
		expect(await clock.drive(service.start())).toBe('folder');
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		expect(service.state()).toMatchObject({ phase: 'idle', error: { code: 'folder' } });
	});

	it('says a recording was not kept where the recorder could not put its file in place', async () => {
		const { clock, service, events, recorder } = rig();
		await clock.drive(service.start());
		// The folder went while the recording ran: a drive was taken out.
		recorder().onSignal = {};
		const stopping = service.stop();
		await clock.settle();
		expect(service.state().phase).toBe('stopping');
		recorder().say('err', 'screencapture: Failed to save to final location /Users/ada/Movies/Demo.mov\n');
		recorder().end(1);
		await clock.drive(stopping);
		expect(service.state()).toMatchObject({
			phase: 'idle',
			last: { path: null, reason: 'stopped' },
			error: { code: 'folder' },
		});
		expect(events.slice(-2)).toEqual([
			{ kind: 'failed', code: 'folder', detail: null },
			{ kind: 'ended', path: null, reason: 'stopped' },
		]);
	});

	it('records nothing on a phone or a tablet', async () => {
		const { clock, runner, obs, service } = rig({ system: null });
		expect(await clock.drive(service.start())).toBe('unavailable');
		expect(runner.runs).toHaveLength(0);
		expect(obs.conversations).toBe(0);
	});

	it('makes one recording at a time', async () => {
		const { clock, runner, service } = rig();
		await clock.drive(service.start());
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(1);
		expect(service.state().phase).toBe('recording');
	});

	it('follows a recording the Mac ended by itself', async () => {
		const { clock, service, events, recorder } = rig();
		await clock.drive(service.start());
		recorder().end(0);
		await clock.settle();
		expect(service.state()).toMatchObject({ phase: 'idle', last: { reason: 'external' } });
		expect(events[events.length - 1]).toMatchObject({ kind: 'ended', reason: 'external' });
	});

	it('gives a start up when the author stops it before it runs', async () => {
		const { clock, kept, service, events } = rig();
		const starting = service.start();
		await clock.advance(300);
		expect(service.state().phase).toBe('starting');
		await service.stop();
		expect(await clock.drive(starting)).toBe('cancelled');
		expect(service.state()).toMatchObject({ phase: 'idle', error: null, last: null });
		expect(kept.trashed).toEqual(['/Users/ada/Movies/2026-11-19 14.30.05.mov']);
		expect(events).toEqual([]);
	});

	it('counts the author in before a recording begins, and begins it when the count has run out', async () => {
		const { clock, kept, service, runner, events } = rig();
		const count = heldCount();
		kept.count = () => count.handle;
		const starting = service.start();
		await clock.advance(5000);
		// Ready, and waiting: the count is the author's time to put the page as it should be seen.
		expect([kept.counts, service.state().phase]).toEqual([1, 'starting']);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		count.finish(true);
		expect(await clock.drive(starting)).toBeNull();
		expect(service.state().phase).toBe('recording');
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(1);
		expect(events).toEqual([{ kind: 'started' }]);
		expect(count.cancelled()).toBe(0);
	});

	it('ends the count at once when the start is given up, and starts nothing', async () => {
		const { clock, kept, service, runner, events } = rig();
		const count = heldCount();
		kept.count = () => count.handle;
		const starting = service.start();
		await clock.advance(300);
		expect(kept.counts).toBe(1);
		// The ribbon's button, pressed again while the count runs.
		await service.stop();
		expect(count.cancelled()).toBe(1);
		expect(await clock.drive(starting)).toBe('cancelled');
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		expect(kept.trashed).toEqual([]);
		expect(service.state()).toMatchObject({ phase: 'idle', error: null, last: null });
		expect(events).toEqual([]);
	});

	it('takes a count the author stopped, or one that broke, as their giving the start up and no failure', async () => {
		for (const done of [() => Promise.resolve(false), () => Promise.reject(new Error('The window closed.'))]) {
			const { clock, kept, service, runner, events } = rig();
			kept.count = () => ({ done: done(), cancel: () => {} });
			expect(await clock.drive(service.start())).toBe('cancelled');
			expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
			expect(service.state()).toMatchObject({ phase: 'idle', error: null });
			expect(events).toEqual([]);
			// The next start is a start like any other.
			kept.count = () => ({ done: Promise.resolve(true), cancel: () => {} });
			expect(await clock.drive(service.start())).toBeNull();
			expect(kept.counts).toBe(2);
		}
	});

	it('counts the author in for OBS too, once OBS is ready, and leaves OBS as it was where the count is stopped', async () => {
		const { clock, kept, service, obs } = rig({ preferences: { tool: 'obs', quality: 'full' } });
		const before = obs.borrowable();
		const count = heldCount();
		kept.count = () => count.handle;
		const starting = service.start();
		await clock.advance(5000);
		expect(kept.counts).toBe(1);
		// OBS holds everything the recording needs, and does not record yet.
		expect(obs.program).not.toBe('Scene');
		expect(obs.recording).toBe(false);
		await service.stop();
		expect(await clock.drive(starting)).toBe('cancelled');
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
	});

	it('ends the count where Obsidian quits, or the plugin goes this instant', async () => {
		const quitting = rig();
		const first = heldCount();
		quitting.kept.count = () => first.handle;
		const starting = quitting.service.start();
		await quitting.clock.advance(300);
		await quitting.service.settle();
		expect(first.cancelled()).toBe(1);
		expect(await quitting.clock.drive(starting)).toBe('cancelled');

		const going = rig();
		const second = heldCount();
		going.kept.count = () => second.handle;
		void going.service.start();
		await going.clock.advance(300);
		going.service.dispose();
		expect(second.cancelled()).toBe(1);
		await going.clock.advance(5000);
		expect(going.runner.of(NATIVE_RECORDER)).toHaveLength(0);
	});

	it('records through OBS where that is the recorder, with the password out of Obsidian’s secrets', async () => {
		const { clock, obs, kept, service } = rig({
			system: 'win',
			preferences: { tool: 'obs', obsSecret: 'obs-websocket', folder: 'D:\\Proof' },
		});
		obs.kinds = ['monitor_capture', 'window_capture'];
		obs.lists.monitor_id = [{ itemName: 'Monitor: 1920x1080 @ 0,0', itemEnabled: true, itemValue: 'mon-1' }];
		obs.password = 'supersecretpassword';
		kept.secrets.set('obs-websocket', 'supersecretpassword');
		expect(await clock.drive(service.start())).toBeNull();
		expect(service.state()).toMatchObject({ phase: 'recording', tool: 'obs' });
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('D:\\Proof');
		// OBS answered: next time it may be opened where it is found closed.
		expect(kept.preferences.obsReached).toBe(true);
		obs.bytes = 123_456;
		await clock.advance(5200);
		expect(service.state().bytes).toBe(123_456);
		await clock.drive(service.stop());
		expect(service.state()).toMatchObject({ phase: 'idle', bytes: null, last: { path: obs.recordPath } });
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Movies');
	});

	it('points OBS on Windows at the screen Obsidian is on by that screen’s place in pixels', async () => {
		const { clock, obs, kept, service } = rig({ system: 'win', preferences: { tool: 'obs' } });
		obs.kinds = ['monitor_capture', 'window_capture'];
		// As OBS on Windows lists two screens: the main one marked so after its place, the other at its place in pixels.
		obs.lists.monitor_id = [
			{ itemName: 'Select a display', itemEnabled: true, itemValue: 'DUMMY' },
			{ itemName: 'DELL U2720Q: 3840x2160 @ 0,0 (Primary Monitor)', itemEnabled: true, itemValue: 'mon-main' },
			{ itemName: 'LG ULTRAGEAR: 2560x1440 @ 3840,360', itemEnabled: true, itemValue: 'mon-side' },
		];
		// Obsidian stands on the second screen. The main one is scaled to 150%, so the desktop
		// counts the second screen's corner at 2560 points while it is at 3840 pixels.
		kept.screen = { origin: { x: 2560, y: 240 }, pixelOrigin: { x: 3840, y: 360 }, index: 2, id: 5 };
		expect(await clock.drive(service.start())).toBeNull();
		expect(obs.inputs[OBS_SCENES.screen.input]?.settings).toMatchObject({ monitor_id: 'mon-side' });
		await clock.drive(service.stop());
		// And on the main screen, whose name goes on after its place.
		kept.screen = { origin: { x: 0, y: 0 }, pixelOrigin: { x: 0, y: 0 }, index: 1, id: 3 };
		expect(await clock.drive(service.start())).toBeNull();
		expect(obs.inputs[OBS_SCENES.screen.input]?.settings).toMatchObject({ monitor_id: 'mon-main' });
	});

	it('never opens an OBS that has not answered on this device before', async () => {
		const { clock, obs, runner, kept, service } = rig({ preferences: { tool: 'obs' } });
		obs.closed = true;
		expect(await clock.drive(service.start())).toBe('obs-closed');
		expect(runner.runs).toHaveLength(0);
		expect(kept.preferences.obsReached).toBe(false);
	});

	it('opens an OBS that has, through the Mac’s own opener, and waits for it', async () => {
		const { clock, obs, runner, service } = rig({ preferences: { tool: 'obs', obsReached: true } });
		obs.closed = true;
		runner.played.set(MAC_OPENER, (process) => {
			process.end(0);
			obs.closed = false;
		});
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.of(MAC_OPENER)).toHaveLength(1);
		expect(runner.of(MAC_OPENER)[0]?.options.detached).toBe(false);
	});

	it('names the screen for OBS on a Mac from the system, and never from OBS', async () => {
		const { clock, obs, runner, service } = rig({ preferences: { tool: 'obs' } });
		expect(await clock.drive(service.start())).toBeNull();
		const asked = runner.of(MAC_SCRIPT_RUNNER);
		expect(asked).toHaveLength(1);
		// The screen's own number is handed over beside the script, never written into it.
		expect(asked[0]?.args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
		expect(asked[0]?.args[4]).toBe('3');
		expect(obs.inputs['Snowflake Method screen capture']?.settings).toMatchObject({
			type: 0,
			display_uuid: '08C01862-9690-4A1E-B653-10B1A582F805',
		});
		expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
		expect(obs.crashed).toBe(false);
	});

	it('records every screen with the Mac’s recorder as a file for each, and tells of them as one recording', async () => {
		const { clock, runner, kept, service, events } = rig({ preferences: { scope: 'all' } });
		kept.displays = [
			{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: 3 },
			{ frame: { x: -1440, y: -690, width: 1440, height: 2560 }, id: 2 },
		];
		expect(await clock.drive(service.start())).toBeNull();
		const first = '/Users/ada/Movies/2026-11-19 14.30.05 (1).mov';
		const second = '/Users/ada/Movies/2026-11-19 14.30.05 (2).mov';
		// The recorder counts the screens itself, the main one first.
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args)).toEqual([
			['-v', '-x', '-D', '1', first],
			['-v', '-x', '-D', '2', second],
		]);
		expect(kept.native).toHaveLength(2);
		await clock.drive(service.stop());
		expect(service.state()).toMatchObject({ phase: 'idle', last: { path: first, more: 1, reason: 'stopped' } });
		expect(events).toEqual([{ kind: 'started' }, { kind: 'ended', path: first, reason: 'stopped', more: 1 }]);
		expect(kept.native).toBeNull();
	});

	it('records one screen under one name where one screen is all there is, whatever the scope', async () => {
		const { clock, runner, service, events } = rig({ preferences: { scope: 'all' } });
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args)).toEqual([
			['-v', '-x', '/Users/ada/Movies/2026-11-19 14.30.05.mov'],
		]);
		await clock.drive(service.stop());
		expect(events[events.length - 1]).toEqual({
			kind: 'ended',
			path: '/Users/ada/Movies/2026-11-19 14.30.05.mov',
			reason: 'stopped',
		});
	});

	it('names every screen for OBS on a Mac from the system in one go, with where each stands', async () => {
		const { clock, obs, runner, kept, service } = rig({ preferences: { tool: 'obs', scope: 'all' } });
		kept.displays = [
			{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: 3 },
			{ frame: { x: -1440, y: -690, width: 1440, height: 2560 }, id: 2 },
		];
		expect(await clock.drive(service.start())).toBeNull();
		const asked = runner.of(MAC_SCRIPT_RUNNER);
		expect(asked).toHaveLength(1);
		expect(asked[0]?.args.slice(4)).toEqual(['3', '2']);
		expect(obs.inputs['Snowflake Method all screens capture 1']?.settings).toMatchObject({
			display_uuid: '08C01862-9690-4A1E-B653-10B1A582F805',
		});
		expect(obs.inputs['Snowflake Method all screens capture 2']?.settings).toMatchObject({
			display_uuid: 'DCFB4942-F77D-4AFC-AAC8-471180EF3246',
		});
		expect(obs.types()).not.toContain('GetInputPropertiesListPropertyItems');
		expect(obs.crashed).toBe(false);
	});

	it('makes no scene of every screen where the system will not name one of them', async () => {
		const unnamed = rig({ preferences: { tool: 'obs', scope: 'all' } });
		unnamed.kept.displays = [
			{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: 3 },
			{ frame: { x: 2560, y: 0, width: 1920, height: 1080 }, id: 7 },
		];
		expect(await unnamed.clock.drive(unnamed.service.start())).toBe('obs-scene');
		const numberless = rig({ preferences: { tool: 'obs', scope: 'all' } });
		numberless.kept.displays = [{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: null }];
		expect(await numberless.clock.drive(numberless.service.start())).toBe('obs-scene');
		expect(numberless.runner.of(MAC_SCRIPT_RUNNER)).toHaveLength(0);
	});

	it('points OBS on a Mac at Obsidian’s own window, with no script at all', async () => {
		const { clock, obs, runner, service } = rig({ preferences: { tool: 'obs', scope: 'obsidian' } });
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.of(MAC_SCRIPT_RUNNER)).toHaveLength(0);
		expect(obs.inputs['Snowflake Method Obsidian capture']?.settings).toMatchObject({ type: 1, window: 4321 });
		expect(obs.crashed).toBe(false);
	});

	it('leaves the scene to OBS where the system names no screen', async () => {
		for (const fault of ['silent', 'no-number', 'no-window'] as const) {
			const { clock, obs, kept, service } = rig({
				preferences: { tool: 'obs', scope: fault === 'no-window' ? 'obsidian' : 'screen' },
			});
			if (fault === 'silent') kept.screenNames = {};
			if (fault === 'no-number' && kept.screen !== null) kept.screen = { ...kept.screen, id: null };
			if (fault === 'no-window') {
				kept.windows = [{ ...MAIN_WINDOW, id: null }];
				kept.inUse = kept.windows[0] ?? null;
			}
			expect(await clock.drive(service.start()), fault).toBe('obs-scene');
			expect(obs.types(), fault).not.toContain('CreateInput');
		}
	});

	it('says OBS is closed where the Mac has no OBS to open', async () => {
		const { clock, obs, runner, service } = rig({ preferences: { tool: 'obs', obsReached: true } });
		obs.closed = true;
		runner.played.set(MAC_OPENER, (process) => {
			process.say('err', 'Unable to find application named OBS');
			process.end(1);
		});
		expect(await clock.drive(service.start())).toBe('obs-closed');
	});

	it('leaves an OBS it started on Windows to itself', async () => {
		const { clock, obs, runner, service } = rig({
			system: 'win',
			preferences: { tool: 'obs', obsReached: true, folder: 'D:\\Proof', scope: 'obs' },
		});
		obs.scenes[0]?.items.push({ id: 1, source: 'Mine' });
		obs.closed = true;
		runner.onRun = () => {
			obs.closed = false;
		};
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.last.options).toEqual({ cwd: 'C:\\Program Files\\obs-studio\\bin\\64bit', detached: true });
	});

	it('takes a launch that ends at once with a fault as no OBS opened, tries the next way, and waits for nothing', async () => {
		const { clock, obs, runner, service } = rig({
			system: 'linux',
			preferences: { tool: 'obs', obsReached: true, folder: '/home/ada/Proof', scope: 'obs' },
		});
		obs.closed = true;
		// No OBS of the system's own, and a Flatpak that has none either and says so with its code.
		runner.played.set('/usr/bin/obs', (process) => {
			process.fail('spawn /usr/bin/obs ENOENT');
		});
		runner.played.set('/usr/bin/flatpak', (process) => {
			process.end(1);
		});
		const from = clock.now;
		expect(await clock.drive(service.start())).toBe('obs-closed');
		expect(runner.runs.map((process) => process.command)).toEqual(['/usr/bin/obs', '/usr/bin/flatpak']);
		// The half minute OBS is given to come up is not waited for nothing.
		expect(clock.now - from).toBeLessThan(5000);
	});

	it('takes a launcher that ends at once with no fault as OBS on its way', async () => {
		const { clock, obs, runner, service } = rig({
			system: 'linux',
			preferences: { tool: 'obs', obsReached: true, folder: '/home/ada/Proof', scope: 'obs' },
		});
		obs.scenes[0]?.items.push({ id: 1, source: 'Mine' });
		obs.closed = true;
		runner.played.set('/usr/bin/obs', (process) => {
			obs.closed = false;
			process.end(0);
		});
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.runs.map((process) => process.command)).toEqual(['/usr/bin/obs']);
	});

	it('marks OBS as reached when it answers with anything, a refusal included', async () => {
		const { clock, obs, kept, service } = rig({ preferences: { tool: 'obs' } });
		obs.password = 'supersecretpassword';
		expect(await clock.drive(service.start())).toBe('obs-password');
		expect(kept.preferences.obsReached).toBe(true);
	});

	it('follows a recording OBS lost, with the reason', async () => {
		const { clock, obs, service, events } = rig({ preferences: { tool: 'obs' } });
		await clock.drive(service.start());
		obs.closed = true;
		obs.drop();
		await clock.advance(20_000);
		expect(service.state()).toMatchObject({
			phase: 'idle',
			last: { path: null, reason: 'lost' },
			error: { code: 'obs-lost' },
		});
		expect(events.slice(-2)).toEqual([
			{ kind: 'failed', code: 'obs-lost', detail: null },
			{ kind: 'ended', path: null, reason: 'lost' },
		]);
	});

	it('looks at OBS for the tab’s test, and only while nothing records', async () => {
		const { clock, obs, kept, service } = rig({ preferences: { tool: 'obs' } });
		expect(await clock.drive(service.testObs())).toMatchObject({ ok: true, version: '33.0.1', problem: null });
		expect(kept.preferences.obsReached).toBe(true);
		await clock.drive(service.start());
		const calls = obs.calls.length;
		expect(await clock.drive(service.testObs())).toEqual({ ok: false, code: 'unavailable' });
		expect(obs.calls).toHaveLength(calls);
	});

	it('opens a closed OBS for the settings’ test as it does for a recording, once OBS has answered on this device', async () => {
		const { clock, obs, runner, service } = rig({ preferences: { tool: 'obs', obsReached: true } });
		obs.closed = true;
		runner.played.set(MAC_OPENER, (process) => {
			process.end(0);
			obs.closed = false;
		});
		let told = 0;
		const probe = await clock.drive(
			service.testObs(() => {
				told += 1;
			}),
		);
		expect(probe).toMatchObject({ ok: true, version: '33.0.1', problem: null });
		// Opened once, and the settings were told what the wait was for.
		expect([runner.of(MAC_OPENER).length, told]).toEqual([1, 1]);
		// A look is no recording: what the ribbon shows never moved.
		expect(service.state()).toMatchObject({ phase: 'idle', error: null });
		expect(obs.recording).toBe(false);
	});

	it('opens nothing for the test before OBS has ever answered here: the first setup is done by hand', async () => {
		const { clock, obs, runner, kept, service } = rig({ preferences: { tool: 'obs' } });
		obs.closed = true;
		let told = 0;
		expect(
			await clock.drive(
				service.testObs(() => {
					told += 1;
				}),
			),
		).toEqual({ ok: false, code: 'obs-closed' });
		expect([runner.runs.length, told]).toEqual([0, 0]);
		expect(kept.preferences.obsReached).toBe(false);
	});

	it('records into the system’s video folder where recordings are kept outside the vault and no folder is chosen', async () => {
		const { clock, service, recorder } = rig();
		expect(service.storage()).toEqual({ mode: 'default', path: '/Users/ada/Movies' });
		expect(await service.figures()).toBeNull();
		await clock.drive(service.start());
		expect(recorder().args[recorder().args.length - 1]).toBe('/Users/ada/Movies/2026-11-19 14.30.05.mov');
	});

	it('records Obsidian alone into the vault’s folder on a device that has chosen nothing', async () => {
		const { clock, kept, service, recorder } = rig({ preferences: defaultRecordingPreferences('mac') });
		expect(service.storage()).toEqual({
			mode: 'vault',
			path: '/Users/ada/Vault/Novels/Snowflake Recordings',
			vaultPath: 'Novels/Snowflake Recordings',
			refused: false,
		});
		expect(await clock.drive(service.start())).toBeNull();
		// Obsidian's own window, by the number the system knows it by, into the folder beside the projects.
		expect(recorder().args).toEqual([
			'-v',
			'-x',
			'-o',
			'-l',
			'4321',
			'/Users/ada/Vault/Novels/Snowflake Recordings/2026-11-19 14.30.05.mov',
		]);
		expect(kept.made).toEqual(['Novels/Snowflake Recordings']);
	});

	it('has OBS record Obsidian alone at 1080 lines on a device that has chosen nothing else', async () => {
		const { clock, obs, service } = rig({ preferences: { ...defaultRecordingPreferences('mac'), tool: 'obs' } });
		expect(await clock.drive(service.start())).toBeNull();
		expect(obs.program).toBe(OBS_SCENES.obsidian.scene);
		expect(obs.inputs[OBS_SCENES.obsidian.input]?.settings).toMatchObject({ type: 1, window: 4321 });
		// The window is 2560 by 1440 here: drawn pixel for pixel, and written at 1080 lines.
		expect(obs.video).toEqual({ baseWidth: 2560, baseHeight: 1440, outputWidth: 1920, outputHeight: 1080 });
		expect(obs.parameters['SimpleOutput/FilePath']).toBe('/Users/ada/Vault/Novels/Snowflake Recordings');
	});

	it('keeps recordings in the vault in the one folder beside the projects, whichever project is being worked in', async () => {
		const { clock, kept, service, runner } = rig({ preferences: { location: 'vault' } });
		expect(service.storage()).toEqual({
			mode: 'vault',
			path: '/Users/ada/Vault/Novels/Snowflake Recordings',
			vaultPath: 'Novels/Snowflake Recordings',
			refused: false,
		});
		// Nothing is made until something is recorded.
		expect(kept.made).toEqual([]);
		await clock.drive(service.start());
		await clock.drive(service.stop());
		await clock.advance(1000);
		await clock.drive(service.start());
		// One folder for both, made once and then found there, and nothing of a project in either name.
		expect([...new Set(kept.made)]).toEqual(['Novels/Snowflake Recordings']);
		expect(runner.of(NATIVE_RECORDER).map((process) => process.args[process.args.length - 1])).toEqual([
			'/Users/ada/Vault/Novels/Snowflake Recordings/2026-11-19 14.30.05.mov',
			expect.stringMatching(/^\/Users\/ada\/Vault\/Novels\/Snowflake Recordings\/2026-11-19 14\.30\.\d\d\.mov$/u),
		]);
		expect(await service.figures()).toEqual({ files: 0, bytes: 0 });
	});

	it('uses the vault folder the author names, and refuses one that is a project’s own before anything is started', async () => {
		const named = rig({ preferences: { location: 'vault', vaultFolder: 'Proof' } });
		await named.clock.drive(named.service.start());
		expect(named.kept.made).toEqual(['Proof']);
		expect(named.recorder().args[named.recorder().args.length - 1]).toBe(
			'/Users/ada/Vault/Proof/2026-11-19 14.30.05.mov',
		);

		const { clock, runner, service } = rig({ preferences: { location: 'vault', vaultFolder: 'Novels/Clocktower Snow' } });
		expect(service.storage()).toMatchObject({ mode: 'vault', refused: true });
		expect(await clock.drive(service.start())).toBe('folder-in-project');
		expect(runner.runs).toHaveLength(0);
	});

	it('stops what it can in a short while when Obsidian quits', async () => {
		const { clock, service, recorder } = rig();
		await clock.drive(service.start());
		await clock.drive(service.settle());
		expect(recorder().signals).toEqual(['SIGINT']);
		expect(service.state()).toMatchObject({
			phase: 'idle',
			last: { path: '/Users/ada/Movies/2026-11-19 14.30.05.mov' },
		});
	});

	it('waits for a start given up at quitting to give OBS back what it borrowed, a short while', async () => {
		const { clock, obs, kept, service } = rig({ preferences: { tool: 'obs', quality: '1080p' } });
		const before = obs.borrowable();
		const count = heldCount();
		kept.count = () => count.handle;
		const starting = service.start();
		await clock.advance(5000);
		// Counted in: the plugin's scene is on air, OBS's microphone muted and its canvas resized.
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
		expect(obs.mutes['Mic/Aux']).toBe(true);
		// OBS is slow to answer as Obsidian quits.
		obs.holdNext('GetProfileList');
		let settled = false;
		const settling = service.settle().then(() => {
			settled = true;
		});
		await clock.settle();
		expect([count.cancelled(), settled]).toEqual([1, false]);
		obs.release();
		await clock.drive(settling);
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
		expect(kept.journal).toBeNull();
		expect(await clock.drive(starting)).toBe('cancelled');

		// An OBS that says nothing at all holds the quit up for three seconds and no longer.
		const hung = rig({ preferences: { tool: 'obs' } });
		const held = heldCount();
		hung.kept.count = () => held.handle;
		void hung.service.start();
		await hung.clock.advance(5000);
		hung.obs.silent = true;
		const from = hung.clock.now;
		await hung.clock.drive(hung.service.settle());
		expect(hung.clock.now - from).toBeLessThan(4000);
	});

	it('waits for a look at OBS under way at quitting, which has the plugin’s scene on air', async () => {
		const { clock, obs, service } = rig({ preferences: { tool: 'obs' } });
		const before = obs.borrowable();
		obs.holdNext('GetSourceScreenshot');
		const looking = service.testObs();
		await clock.advance(1000);
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
		let settled = false;
		const settling = service.settle().then(() => {
			settled = true;
		});
		await clock.settle();
		expect(settled).toBe(false);
		obs.release();
		await clock.drive(settling);
		expect(obs.borrowable()).toEqual(before);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
		expect((await clock.drive(looking)).ok).toBe(true);
		// With no look and no start under way, a quit waits for nothing.
		const from = clock.now;
		await service.settle();
		expect(clock.now).toBe(from);
	});

	it('lets an OBS start under way give everything back when the plugin goes this instant', async () => {
		const { clock, obs, kept, service } = rig({ preferences: { tool: 'obs', quality: '1080p' } });
		const before = obs.borrowable();
		const count = heldCount();
		kept.count = () => count.handle;
		void service.start();
		await clock.advance(5000);
		expect(obs.program).toBe(OBS_SCENES.screen.scene);
		service.dispose();
		expect(count.cancelled()).toBe(1);
		await clock.advance(2000);
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
		expect(obs.scenes.map((scene) => scene.name)).toEqual(['Scene']);
		expect(kept.journal).toBeNull();
	});

	it('leaves the telling to a recording that is already ending by itself when stop is pressed', async () => {
		const { clock, runner, kept, service, events } = rig({ preferences: { scope: 'all' } });
		kept.displays = [
			{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: 3 },
			{ frame: { x: -1440, y: -690, width: 1440, height: 2560 }, id: 2 },
		];
		await clock.drive(service.start());
		const [first, second] = runner.of(NATIVE_RECORDER);
		// The Mac ends one screen's recorder. The other takes its stop and is slow to put its file in place.
		if (first !== undefined) first.onSignal = {};
		second?.end(0);
		await clock.settle();
		await service.stop();
		// Nothing is said yet, and nothing is forgotten: the files are still on their way.
		expect(service.state().phase).toBe('stopping');
		expect(events.filter((event) => event.kind === 'ended')).toEqual([]);
		expect(await clock.drive(service.start())).toBeNull();
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(2);
		first?.end(0);
		await clock.settle();
		const path = '/Users/ada/Movies/2026-11-19 14.30.05 (1).mov';
		expect(service.state()).toMatchObject({ phase: 'idle', last: { path, more: 1, reason: 'external' }, error: null });
		expect(events.filter((event) => event.kind === 'ended')).toEqual([
			{ kind: 'ended', path, reason: 'external', more: 1 },
		]);
	});

	it('does not hold a quitting Obsidian up for a recorder still moving its file', async () => {
		const { clock, kept, service, recorder } = rig();
		await clock.drive(service.start());
		recorder().onSignal = {};
		const settling = service.settle();
		await clock.advance(3500);
		await settling;
		// Only the interrupt was sent: the recorder finishes its file alone.
		expect(recorder().signals).toEqual(['SIGINT']);
		expect(service.state().phase).toBe('idle');
		// The device still names it, for the next plugin to look at.
		expect(kept.native).not.toBeNull();
	});

	it('ends a recorder an earlier run left going, and names its file', async () => {
		const { clock, runner, kept, service, events } = rig();
		const file = '/Users/ada/Movies/Demo 2026-11-18 22.10.00.mov';
		kept.native = [{ pid: 4321, file, startedAt: 1 }];
		let alive = true;
		runner.played.set(MAC_PROCESS_LIST, (process) => {
			if (alive) process.say('out', `12:00 ${NATIVE_RECORDER} -v -x ${file}\n`);
			process.end(alive ? 0 : 1);
		});
		runner.played.set(MAC_SIGNAL, (process) => {
			alive = false;
			process.end(0);
		});
		await clock.drive(service.mend());
		expect(runner.of(MAC_SIGNAL).map((run) => run.args)).toEqual([['-INT', '4321']]);
		expect(kept.native).toBeNull();
		expect(service.state()).toMatchObject({ phase: 'idle', last: { path: file, reason: 'external' } });
		expect(events).toEqual([{ kind: 'ended', path: file, reason: 'external' }]);
	});

	it('looks for a recorder left going before it starts another', async () => {
		const { clock, runner, kept, service } = rig();
		const file = '/Users/ada/Movies/Demo 2026-11-18 22.10.00.mov';
		kept.native = [{ pid: 4321, file, startedAt: 1 }];
		let alive = true;
		runner.played.set(MAC_PROCESS_LIST, (process) => {
			if (alive) process.say('out', `12:00 ${NATIVE_RECORDER} -v -x ${file}\n`);
			process.end(alive ? 0 : 1);
		});
		runner.played.set(MAC_SIGNAL, (process) => {
			alive = false;
			process.end(0);
		});
		expect(await clock.drive(service.start())).toBeNull();
		const order = runner.runs.map((run) => run.command);
		expect(order.indexOf(MAC_SIGNAL)).toBeGreaterThan(-1);
		expect(order.indexOf(MAC_SIGNAL)).toBeLessThan(order.indexOf(NATIVE_RECORDER));
		expect(service.state().phase).toBe('recording');
	});

	it('starts no program to look where the device keeps no recorder, or off a Mac', async () => {
		const none = rig();
		await none.clock.drive(none.service.mend());
		expect(none.runner.runs).toHaveLength(0);
		const windows = rig({ system: 'win' });
		windows.kept.native = [{ pid: 4321, file: 'C:\\a.mov', startedAt: 1 }];
		await windows.clock.drive(windows.service.mend());
		expect(windows.runner.runs).toHaveLength(0);
	});

	it('tells both recorders to stop and tells nobody anything once the plugin goes', async () => {
		const { clock, service, events, recorder } = rig();
		await clock.drive(service.start());
		const before = events.length;
		recorder().onSignal = {};
		service.dispose();
		expect(recorder().signals).toEqual(['SIGINT']);
		recorder().end(0);
		await clock.advance(30_000);
		expect(events).toHaveLength(before);
		expect(service.state().phase).toBe('idle');
		expect(await clock.drive(service.start())).toBe('unavailable');
		expect(clock.waiting).toBe(0);
	});

	it('keeps one listener’s fault from the next', async () => {
		const { clock, service } = rig();
		const heard: string[] = [];
		service.subscribe(() => {
			throw new Error('a listener of no account');
		});
		service.subscribe((event) => heard.push(event.kind));
		const originalError = console.error;
		console.error = () => {};
		try {
			await clock.drive(service.start());
		} finally {
			console.error = originalError;
		}
		expect(heard).toContain('started');
	});
});

describe('what the second look at the recording turned up', () => {
	it('numbers a screen for the Mac’s recorder by the system’s own list, not by its place on the desktop', async () => {
		// Three screens. The desktop lists the one Obsidian is on third, the system's own list has it second.
		const { clock, kept, runner, service, recorder } = rig();
		kept.displays = [
			{ frame: { x: 0, y: 0, width: 2560, height: 1440 }, id: 3 },
			{ frame: { x: 2560, y: 0, width: 1920, height: 1080 }, id: 7 },
			{ frame: { x: -1440, y: -560, width: 1440, height: 2560 }, id: 5 },
		];
		kept.screen = { origin: { x: -1440, y: -560 }, pixelOrigin: { x: -1440, y: -560 }, index: 3, id: 5 };
		kept.order = [3, 5, 7];
		await clock.drive(service.start());
		expect(recorder().args.slice(0, 4)).toEqual(['-v', '-x', '-D', '2']);
		expect(runner.of(MAC_SCRIPT_RUNNER)).toHaveLength(1);
	});

	it('takes the screen’s place on the desktop where the system will not say, or says nothing of that screen', async () => {
		const silent = rig();
		silent.kept.screen = { origin: { x: -1440, y: -560 }, pixelOrigin: { x: -1440, y: -560 }, index: 3, id: 5 };
		silent.kept.order = null;
		await silent.clock.drive(silent.service.start());
		expect(silent.recorder().args.slice(0, 4)).toEqual(['-v', '-x', '-D', '3']);
		const unlisted = rig();
		unlisted.kept.screen = { origin: { x: -1440, y: -560 }, pixelOrigin: { x: -1440, y: -560 }, index: 2, id: 5 };
		unlisted.kept.order = [3, 9];
		await unlisted.clock.drive(unlisted.service.start());
		expect(unlisted.recorder().args.slice(0, 4)).toEqual(['-v', '-x', '-D', '2']);
		// A screen the desktop gives no number for cannot be looked up, and no script is run for it.
		const nameless = rig();
		nameless.kept.screen = { origin: { x: -1440, y: -560 }, pixelOrigin: { x: -1440, y: -560 }, index: 2, id: null };
		await nameless.clock.drive(nameless.service.start());
		expect(nameless.recorder().args.slice(0, 4)).toEqual(['-v', '-x', '-D', '2']);
		expect(nameless.runner.of(MAC_SCRIPT_RUNNER)).toHaveLength(0);
	});

	it('runs no script for the main screen, and waits for none that hangs', async () => {
		const main = rig();
		await main.clock.drive(main.service.start());
		expect(main.runner.of(MAC_SCRIPT_RUNNER)).toHaveLength(0);
		// A script that never ends is ended after five seconds, and the recording begins all the same.
		const hung = rig();
		hung.kept.screen = { origin: { x: -1440, y: -560 }, pixelOrigin: { x: -1440, y: -560 }, index: 2, id: 5 };
		hung.runner.played.delete(MAC_SCRIPT_RUNNER);
		const from = hung.clock.now;
		expect(await hung.clock.drive(hung.service.start(), 100)).toBeNull();
		expect(hung.runner.of(MAC_SCRIPT_RUNNER)[0]?.signals).toEqual(['SIGKILL']);
		expect(hung.recorder().args.slice(0, 4)).toEqual(['-v', '-x', '-D', '2']);
		expect(hung.clock.now - from).toBeLessThan(8000);
	});

	it('waits for a look at OBS under way before it starts, and starts then', async () => {
		const { clock, obs, service, events } = rig({ preferences: { tool: 'obs' } });
		obs.holdNext('GetSourceScreenshot');
		const looking = service.testObs();
		await clock.advance(1000);
		// The author presses record while the settings' test still has OBS.
		const starting = service.start();
		await clock.advance(1000);
		expect(service.state().phase).toBe('starting');
		expect(obs.types()).not.toContain('StartRecord');
		obs.release();
		expect((await clock.drive(looking)).ok).toBe(true);
		expect(await clock.drive(starting)).toBeNull();
		expect(obs.recording).toBe(true);
		expect(events.filter((event) => event.kind === 'failed')).toEqual([]);
	});

	it('says what OBS said, not that it records, where a start is pressed during a look that finds no OBS', async () => {
		const { clock, obs, kept, service, events } = rig({ preferences: { tool: 'obs' } });
		// Something takes the call and never says hello: no OBS, and a look that lasts.
		obs.greetingHeld = true;
		const looking = service.testObs();
		await clock.advance(1000);
		const starting = service.start();
		await clock.advance(1000);
		// The start waits for the look. It is not turned away as if OBS were recording.
		expect(service.state().phase).toBe('starting');
		expect(await clock.drive(looking)).toEqual({ ok: false, code: 'obs-closed' });
		expect(await clock.drive(starting)).toBe('obs-closed');
		expect(events.filter((event) => event.kind === 'failed')).toEqual([{ kind: 'failed', code: 'obs-closed', detail: null }]);
		// Nothing answered: OBS has not been reached on this device, and is not opened next time.
		expect(kept.preferences.obsReached).toBe(false);
	});

	it('gives up a start that was stopped while it waited for the look', async () => {
		const { clock, obs, service } = rig({ preferences: { tool: 'obs' } });
		const before = obs.borrowable();
		obs.holdNext('GetSourceScreenshot');
		const looking = service.testObs();
		await clock.advance(1000);
		const starting = service.start();
		await clock.advance(500);
		await service.stop();
		obs.release();
		expect(await clock.drive(starting)).toBe('cancelled');
		await clock.drive(looking);
		expect(obs.types()).not.toContain('StartRecord');
		expect(obs.borrowable()).toEqual(before);
		expect(service.state().phase).toBe('idle');
	});

	it('holds a quitting Obsidian five seconds at most for an OBS that hangs under a recording', async () => {
		const { clock, obs, kept, service } = rig({ preferences: { tool: 'obs' } });
		await clock.drive(service.start());
		obs.silent = true;
		const from = clock.now;
		await clock.drive(service.settle(), 100);
		expect(clock.now - from).toBeLessThanOrEqual(5100);
		// What OBS still holds of the plugin's stays written down, and so does whose recording it is.
		expect(kept.journal?.loans.length).toBeGreaterThan(0);
		expect(kept.journal?.recording).toEqual(expect.any(Number));
		// Where Obsidian stays after all, the recording's end is told once the recorder has given OBS up.
		expect(service.state().phase).toBe('stopping');
		await clock.advance(30_000);
		expect(service.state()).toMatchObject({ phase: 'idle', error: { code: 'obs-lost' } });
	});
});
