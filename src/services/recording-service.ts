import {
	IDLE_RECORDING_STATE,
	MAC_SCRIPT_RUNNER,
	displayIdentifierArguments,
	obsLaunches,
	readDisplayIdentifiers,
	recordingFileNames,
	recordingLaterFileName,
	recordingStamp,
	systemChild,
	type DesktopWindow,
	type NativeLedger,
	type NativeTarget,
	type ObsJournal,
	type ObsMacTarget,
	type RecordingScope,
	type RecordingEndReason,
	type RecordingErrorCode,
	type RecordingNoticeCode,
	type RecordingPreferences,
	type RecordingState,
	type RecordingSystem,
} from '../domain';
import type { DesktopShell } from './desktop-shell';
import type { ProcessRunner } from './desktop-process';
import { ObsSocket, type SocketLike } from './obs-socket';
import {
	within,
	type RecorderEnd,
	type RecorderHooks,
	type RecorderStart,
	type RecordingTimers,
} from './recording-driver';
import { NativeRecorder, type NativeTake } from './recording-native';
import { ObsRecorder, type ObsProbe } from './recording-obs';
import {
	recordingFigures,
	recordingStorage,
	resolveRecordingFolder,
	type RecordingPlaceDeps,
	type RecordingStorage,
} from './recording-place';

/**
 * The one screen recording a device makes at a time. It keeps the
 * recording's state for the ribbon and the status bar, picks the recorder the
 * author chose, finds the folder, and follows the recording to its end,
 * however it ends: stopped here, stopped in the recorder, or lost.
 *
 * It belongs to the device and to no project, and a recording's file is
 * named by the moment it began. Nothing is written to a project, to the
 * vault's settings, or to the modification history.
 *
 * Obsidian may have more windows than its main one: a tab moved out into a
 * window of its own. A recording of Obsidian alone takes them in. The Mac's
 * recorder films one window, so each window gets a recorder and a file, and
 * OBS, which makes one video, is pointed at the window in use. The plugin
 * tells the service when a window opens, closes or comes forward.
 */

export interface RecordingServiceDeps {
	/** The desktop system, or null on a phone or a tablet, where nothing records. */
	system(): RecordingSystem | null;
	/** The choices as the device keeps them. */
	preferences(): RecordingPreferences;
	savePreferences(next: RecordingPreferences): void;
	/** OBS's password out of Obsidian's own secrets, by the name the choices keep. */
	secret(name: string): string | null;
	place: RecordingPlaceDeps;
	/** The desktop's runner of programs, or null where there is none. */
	processes(): Promise<ProcessRunner | null>;
	/** The desktop's own parts, or null where the window has none. */
	shell(): DesktopShell | null;
	/** Obsidian's own windows: the main one first, then each a tab was moved out into, and the one in use. */
	windows(): { all: DesktopWindow[]; active: DesktopWindow | null };
	/** A socket to an address on this computer. */
	openSocket(url: string): SocketLike;
	/** The place on the device of the ledger of what is borrowed from OBS. */
	journal: { load(): unknown; save(journal: ObsJournal | null): void };
	/** The place on the device of the Mac's recorders that run. */
	nativeLedger: { load(): unknown; save(entries: NativeLedger[] | null): void };
	timers: RecordingTimers;
	now(): number;
	/** A fresh id for one thing asked of OBS. */
	mint(): string;
	/**
	 * Counts the author in, where they can see it, once a recording is
	 * ready to begin. `done` answers true when the count ran out and false
	 * when the author stopped it there. `cancel` ends the count at once,
	 * for a start given up elsewhere meanwhile.
	 */
	countIn(): RecordingCount;
}

/** One count before a recording begins. */
export interface RecordingCount {
	done: Promise<boolean>;
	cancel(): void;
}

export type RecordingEvent =
	/** The state moved: the ribbon and the status bar repaint. */
	| { kind: 'changed' }
	| { kind: 'started' }
	| { kind: 'ended'; path: string | null; reason: RecordingEndReason; more?: number }
	| { kind: 'failed'; code: RecordingErrorCode; detail: string | null }
	| { kind: 'notice'; code: RecordingNoticeCode };

/** How long an application being opened is given to say it cannot be. */
const LAUNCH_WATCH_MS = 500;
/** How long a quitting Obsidian waits for a start that was given up, or a look at OBS, to end and give back. */
const SETTLE_WAIT_MS = 3000;
/** A window just opened may not have its number yet: it is asked for again this often, this many times. */
const WINDOW_RETRY_MS = 400;
const WINDOW_TRIES = 3;

/** A recording of Obsidian's windows by the Mac's recorder: where a window's file goes, how many there are, and which windows have one. */
interface WindowedRecording {
	folder: string;
	stem: string;
	system: RecordingSystem;
	files: number;
	keys: Set<object>;
}

export class ScreenRecordingService {
	private current: RecordingState = { ...IDLE_RECORDING_STATE };
	private readonly listeners = new Set<(event: RecordingEvent) => void>();
	private readonly native: NativeRecorder;
	private readonly obs: ObsRecorder;
	private run = 0;
	private givenUp = false;
	private disposed = false;
	private mending: Promise<void> | null = null;
	/** The count that runs before a recording begins, while it runs. */
	private count: RecordingCount | null = null;
	/** The start under way and the look at OBS under way, while there is one: a quitting Obsidian waits for them a short while. */
	private beginning: Promise<void> | null = null;
	private looking: Promise<void> | null = null;
	/** The recording of Obsidian's windows that runs, while one does. */
	private windowed: WindowedRecording | null = null;

	constructor(private readonly deps: RecordingServiceDeps) {
		this.native = new NativeRecorder({
			processes: () => deps.processes(),
			timers: deps.timers,
			now: () => deps.now(),
			screenAccess: () => deps.shell()?.screenAccess() ?? 'unknown',
			ledger: deps.nativeLedger,
			trash: (path) => deps.shell()?.trash(path) ?? Promise.resolve(false),
		});
		this.obs = new ObsRecorder({
			socket: () => new ObsSocket({ open: (url) => deps.openSocket(url), timers: deps.timers, mint: () => deps.mint() }),
			system: () => deps.system() ?? 'mac',
			journal: deps.journal,
			timers: deps.timers,
			now: () => deps.now(),
			openObs: () => this.openObs(),
			// In pixels: OBS lists each screen by its place in pixels.
			screenOrigin: () => deps.shell()?.screen()?.pixelOrigin ?? null,
			macTarget: (scope) => this.macTarget(scope),
			obsidianWindow: () => {
				const { all, active } = deps.windows();
				return active ?? all[0] ?? null;
			},
		});
	}

	state(): RecordingState {
		return this.current;
	}

	subscribe(listener: (event: RecordingEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Where a recording would go, as the settings say it. */
	storage(): RecordingStorage {
		return recordingStorage(this.deps.preferences(), this.deps.place);
	}

	/** How many recordings the vault's folder holds, where recordings are kept in the vault. */
	async figures(): Promise<{ files: number; bytes: number } | null> {
		try {
			return await recordingFigures(this.deps.preferences(), this.deps.place);
		} catch {
			return null;
		}
	}

	/**
	 * Ends a recording an earlier run of the plugin left going on a Mac:
	 * Obsidian died, or its window was reloaded, with the recorder running.
	 * Asked for as the plugin loads, and before every start. Never rejects.
	 */
	mend(): Promise<void> {
		this.mending ??= this.mendNow().finally(() => {
			this.mending = null;
		});
		return this.mending;
	}

	private async mendNow(): Promise<void> {
		if (this.disposed || this.current.phase !== 'idle' || this.deps.system() !== 'mac') return;
		let saved: { path: string; more: number } | null;
		try {
			saved = await this.native.mend();
		} catch {
			return;
		}
		if (saved === null || this.disposed) return;
		const more = saved.more > 0 ? { more: saved.more } : {};
		this.move({ last: { path: saved.path, endedAt: this.deps.now(), reason: 'external', ...more } });
		this.emit({ kind: 'ended', path: saved.path, reason: 'external', ...more });
	}

	/**
	 * Starts a recording, its file named by the moment. Answers null once
	 * it runs, the reason where it does not, and `cancelled` where the
	 * author gave the start up. Never rejects.
	 */
	async start(): Promise<RecordingErrorCode | 'cancelled' | null> {
		if (this.disposed) return 'unavailable';
		if (this.current.phase !== 'idle') return null;
		await this.mend();
		if (this.disposed) return 'unavailable';
		if (this.current.phase !== 'idle') return null;
		const system = this.deps.system();
		const preferences = this.deps.preferences();
		this.run += 1;
		const run = this.run;
		this.givenUp = false;
		this.move({ phase: 'starting', tool: preferences.tool, startedAt: null, bytes: null, error: null });
		const attempt = this.attempt(system, preferences, run);
		// Kept while it runs, so a quitting Obsidian can wait for it to end.
		const ended = attempt.then(() => {});
		this.beginning = ended;
		const outcome = await attempt;
		if (this.beginning === ended) this.beginning = null;
		if (run !== this.run) return 'cancelled';
		if (!outcome.ok) {
			if (outcome.code === 'cancelled') {
				this.move({ phase: 'idle', startedAt: null, bytes: null });
				return 'cancelled';
			}
			this.move({
				phase: 'idle',
				startedAt: null,
				bytes: null,
				error: { code: outcome.code, detail: outcome.detail },
			});
			this.emit({ kind: 'failed', code: outcome.code, detail: outcome.detail });
			return outcome.code;
		}
		this.move({ phase: 'recording', startedAt: outcome.startedAt, bytes: null });
		if (this.givenUp) {
			// Given up after the recorder's last look for it: the recording
			// that began all the same is stopped at once.
			await this.stop();
			return 'cancelled';
		}
		this.emit({ kind: 'started' });
		return null;
	}

	/**
	 * Stops the recording and waits for the file. A start still under way is
	 * given up instead: it ends at its next step and leaves nothing behind.
	 */
	async stop(): Promise<void> {
		const phase = this.current.phase;
		if (phase === 'opening' || phase === 'starting') {
			this.giveUp();
			return;
		}
		if (phase !== 'recording') return;
		const run = this.run;
		this.move({ phase: 'stopping' });
		const stopped = this.current.tool === 'obs' ? await this.obs.stop() : await this.native.stop();
		// Already ending by itself: that end is on its way, and is the one that names the file.
		if (run !== this.run || stopped === null) return;
		this.finish({ reason: 'stopped', ...stopped });
	}

	/**
	 * Looks at OBS without recording, for the settings' test: whether it
	 * answers and what it would record. An OBS that is closed is opened for
	 * the look as it is for a recording, once OBS has answered on this
	 * device, and `onOpening` is told so the settings can say what the wait
	 * is for.
	 */
	async testObs(onOpening: () => void = () => {}): Promise<ObsProbe> {
		if (this.disposed || this.current.phase !== 'idle') return { ok: false, code: 'unavailable' };
		const preferences = this.deps.preferences();
		const look = this.obs.probe(
			{
				port: preferences.obsPort,
				password: this.password(preferences),
				scope: preferences.scope,
				mayOpen: preferences.obsReached,
			},
			onOpening,
		);
		// Kept while it runs: the plugin's scene may be on air in OBS for its moment.
		const ended = look.then(() => {});
		this.looking = ended;
		const probe = await look;
		if (this.looking === ended) this.looking = null;
		if (probe.ok || probe.code !== 'obs-closed') this.reached();
		return probe;
	}

	/**
	 * A window of Obsidian's opened: a tab was moved out of the main one.
	 * Under a recording of Obsidian's windows by the Mac's recorder it gets a
	 * recorder and a file of its own. OBS needs no word: the window comes
	 * forward as it opens, and that is heard.
	 */
	windowOpened(window: DesktopWindow): void {
		const windowed = this.windowed;
		if (windowed === null || this.current.phase !== 'recording') return;
		this.join(windowed, window, 0);
	}

	/**
	 * Gives one of Obsidian's windows a recorder and a file of its own,
	 * once. A window just opened may not have its number yet, so it is
	 * looked at again a few times before it is left out.
	 */
	private join(windowed: WindowedRecording, window: DesktopWindow, tries: number): void {
		if (this.windowed !== windowed || windowed.keys.has(window.key)) return;
		const id = window.id;
		if (id === null) {
			if (tries >= WINDOW_TRIES) return;
			this.deps.timers.set(() => {
				const again = this.deps.windows().all.find((entry) => entry.key === window.key);
				// Gone again meanwhile: there is nothing to record.
				if (again !== undefined) this.join(windowed, again, tries + 1);
			}, WINDOW_RETRY_MS);
			return;
		}
		windowed.keys.add(window.key);
		windowed.files += 1;
		const name = recordingLaterFileName(windowed.stem, windowed.files);
		void this.native.add({
			file: systemChild(windowed.folder, name, windowed.system),
			target: { kind: 'window', id },
			window: window.key,
		});
	}

	/**
	 * A window of Obsidian's closed. The Mac's recorder for it is ended, with
	 * its file kept. OBS, where it showed that window, is pointed at the one
	 * in use instead, or at the main one.
	 */
	windowClosed(key: object): void {
		if (this.current.phase !== 'recording') return;
		if (this.current.tool !== 'obs') {
			this.native.release(key);
			return;
		}
		const { all, active } = this.deps.windows();
		const next = active !== null && active.key !== key ? active : all.find((window) => window.key !== key);
		if (next !== undefined) this.obs.follow(next);
	}

	/** The author moved to another of Obsidian's windows: OBS, which shows one window, follows. */
	windowFocused(window: DesktopWindow): void {
		if (this.current.phase === 'recording' && this.current.tool === 'obs') this.obs.follow(window);
	}

	/**
	 * Obsidian is quitting: the recording is stopped as far as a short wait
	 * allows. A start still under way is given up and waited for likewise,
	 * and so is a look at OBS: each has borrowed from OBS by then, and
	 * gives it back as it ends. An Obsidian that went at once would leave
	 * OBS with the plugin's scene on air and its sound muted.
	 */
	async settle(): Promise<void> {
		if (this.current.phase === 'opening' || this.current.phase === 'starting') {
			this.giveUp();
			if (this.beginning !== null) await within(this.deps.timers, this.beginning, SETTLE_WAIT_MS);
			return;
		}
		if (this.current.phase !== 'recording') {
			if (this.looking !== null) await within(this.deps.timers, this.looking, SETTLE_WAIT_MS);
			return;
		}
		const run = this.run;
		this.move({ phase: 'stopping' });
		const stopped = this.current.tool === 'obs' ? await this.obs.settle() : await this.native.settle();
		if (run !== this.run || stopped === null) return;
		this.finish({ reason: 'stopped', ...stopped });
	}

	/** The plugin is going away this instant: the recorders are told to stop, and nothing is waited for. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.run += 1;
		this.giveUp();
		this.native.abandon();
		this.obs.abandon();
		this.windowed = null;
		this.current = { ...IDLE_RECORDING_STATE };
		this.listeners.clear();
	}

	// ---- A start ----

	/** One start, however it ends: a fault on the way is a start that came to nothing, with what was said. */
	private async attempt(
		system: RecordingSystem | null,
		preferences: RecordingPreferences,
		run: number,
	): Promise<RecorderStart> {
		if (system === null) return { ok: false, code: 'unavailable', detail: null };
		try {
			return await this.begin(system, preferences, run);
		} catch (error) {
			return {
				ok: false,
				code: 'unavailable',
				detail: error instanceof Error ? error.message.slice(0, 200) : null,
			};
		}
	}

	private async begin(
		system: RecordingSystem,
		preferences: RecordingPreferences,
		run: number,
	): Promise<RecorderStart> {
		const place = await resolveRecordingFolder(preferences, this.deps.place);
		if (!place.ok) return { ok: false, code: place.code, detail: null };
		if (this.gone(run)) return { ok: false, code: 'cancelled', detail: null };
		const hooks = this.hooks(run);
		if (preferences.tool === 'native') {
			if (system !== 'mac') return { ok: false, code: 'unavailable', detail: null };
			const targets = this.nativeTargets(preferences.scope);
			if (targets === null) return { ok: false, code: 'unavailable', detail: null };
			const stem = recordingStamp(new Date(this.deps.now()));
			const names = recordingFileNames(stem, targets.length);
			const takes = targets.flatMap((target, index): NativeTake[] => {
				const name = names[index];
				return name === undefined ? [] : [{ ...target, file: systemChild(place.folder, name, system) }];
			});
			const started = await this.native.start({ folder: place.folder, takes }, hooks);
			// A window that opens from here on joins the recording under the next number.
			if (started.ok && preferences.scope === 'obsidian' && !this.gone(run)) {
				const windowed: WindowedRecording = {
					folder: place.folder,
					stem,
					system,
					files: takes.length,
					keys: new Set(takes.flatMap((take) => (take.window === undefined ? [] : [take.window]))),
				};
				this.windowed = windowed;
				// The recorders were chosen before the author was counted in. A
				// window that opened since then was in nobody's list, and joins now.
				for (const window of this.deps.windows().all) this.join(windowed, window, 0);
			}
			return started;
		}
		const outcome = await this.obs.start(
			{
				port: preferences.obsPort,
				password: this.password(preferences),
				folder: place.folder,
				scope: preferences.scope,
				quality: preferences.quality,
				mayOpen: preferences.obsReached,
			},
			hooks,
		);
		// Whatever OBS said, it said something: the server is on, and OBS may be opened next time.
		if (outcome.ok || (outcome.code !== 'obs-closed' && outcome.code !== 'cancelled')) this.reached();
		return outcome;
	}

	/**
	 * What the Mac's recorders are pointed at: each of Obsidian's windows,
	 * the screen its main window is on, or every screen. Each window and each
	 * screen takes a recorder of its own. The recorder counts the screens
	 * itself, the main one first. Null where the main window cannot be named:
	 * a recording of Obsidian with that one missing would be none.
	 */
	private nativeTargets(scope: RecordingScope): { target: NativeTarget; window?: object }[] | null {
		const shell = this.deps.shell();
		if (scope === 'obsidian') {
			const windows = this.deps.windows().all;
			if (windows[0] === undefined || windows[0].id === null) return null;
			return windows.flatMap((window) =>
				window.id === null ? [] : [{ target: { kind: 'window', id: window.id }, window: window.key }],
			);
		}
		if (scope === 'all') {
			const screens = shell?.displays().length ?? 0;
			if (screens > 1) {
				return Array.from({ length: screens }, (_unused, index) => ({ target: { kind: 'display', index: index + 1 } }));
			}
			return [{ target: { kind: 'main' } }];
		}
		const screen = shell?.screen() ?? null;
		return [
			{ target: screen === null || screen.index === 1 ? { kind: 'main' } : { kind: 'display', index: screen.index } },
		];
	}

	private hooks(run: number): RecorderHooks {
		return {
			phase: (phase) => {
				if (run === this.run && (this.current.phase === 'starting' || this.current.phase === 'opening')) {
					this.move({ phase });
				}
			},
			cancelled: () => this.gone(run),
			hold: () => this.hold(run),
			bytes: (bytes) => {
				if (run === this.run && this.current.phase === 'recording') this.move({ bytes });
			},
			notice: (code) => {
				if (run === this.run) this.emit({ kind: 'notice', code });
			},
			ended: (end) => {
				if (run === this.run && this.current.phase !== 'idle') this.finish(end);
			},
		};
	}

	private gone(run: number): boolean {
		return run !== this.run || this.givenUp;
	}

	/** A start under way is given up: it ends at its next step, and a count that runs ends now. */
	private giveUp(): void {
		this.givenUp = true;
		this.count?.cancel();
	}

	/**
	 * The count before a recording begins. The recorder asks for it once
	 * everything is ready, so the moment the count runs out is the moment
	 * the recording starts. False where the author stopped the count, or
	 * gave the start up some other way while it ran.
	 */
	private async hold(run: number): Promise<boolean> {
		if (this.gone(run)) return false;
		const count = this.deps.countIn();
		this.count = count;
		let ran = false;
		try {
			ran = await count.done;
		} catch {
			ran = false;
		}
		if (this.count === count) this.count = null;
		return ran && !this.gone(run);
	}

	private finish(end: RecorderEnd): void {
		this.windowed = null;
		const more = end.more !== undefined && end.more > 0 && end.path !== null ? { more: end.more } : {};
		this.move({
			phase: 'idle',
			startedAt: null,
			bytes: null,
			last: { path: end.path, endedAt: this.deps.now(), reason: end.reason, ...more },
			error: end.error === null ? null : { code: end.error, detail: null },
		});
		if (end.error !== null) this.emit({ kind: 'failed', code: end.error, detail: null });
		this.emit({ kind: 'ended', path: end.path, reason: end.reason, ...more });
	}

	/**
	 * The screens OBS on a Mac is pointed at, asked of the system and never
	 * of OBS: the screen Obsidian's main window is on, or every screen, each
	 * by the system's own identifier for it.
	 */
	private async macTarget(scope: 'screen' | 'all'): Promise<ObsMacTarget | null> {
		const shell = this.deps.shell();
		if (scope === 'all') {
			const displays = shell?.displays() ?? [];
			const numbers = displays.flatMap((display) => (display.id === null ? [] : [display.id]));
			// A screen the system gives no number for cannot be named: the scene would be a screen short.
			if (displays.length === 0 || numbers.length !== displays.length) return null;
			const named = await this.displayIdentifiers(numbers);
			if (named === null) return null;
			return {
				displays: displays.flatMap((display, index) => {
					const displayUuid = named[index];
					return displayUuid === undefined ? [] : [{ displayUuid, frame: display.frame }];
				}),
			};
		}
		const display = shell?.screen()?.id ?? null;
		const named = display === null ? null : await this.displayIdentifiers([display]);
		const displayUuid = named?.[0];
		return displayUuid === undefined ? null : { displayUuid };
	}

	/** What the system calls screens, by their numbers, in the order asked. Null where it would not say for every one. */
	private async displayIdentifiers(numbers: readonly number[]): Promise<string[] | null> {
		const runner = await this.deps.processes();
		if (runner === null) return null;
		const asked = runner.run(MAC_SCRIPT_RUNNER, displayIdentifierArguments(numbers));
		let said = '';
		asked.onText('out', (text) => {
			said += text;
		});
		const exit = await asked.closed;
		return exit.error === null && exit.code === 0 ? readDisplayIdentifiers(said, numbers.length) : null;
	}

	private password(preferences: RecordingPreferences): string | null {
		return preferences.obsSecret.length === 0 ? null : this.deps.secret(preferences.obsSecret);
	}

	private reached(): void {
		const preferences = this.deps.preferences();
		if (!preferences.obsReached) this.deps.savePreferences({ ...preferences, obsReached: true });
	}

	/**
	 * Opens OBS the way the system opens it, trying each way in turn. On a
	 * Mac the system's opener says at once whether there is an OBS to open.
	 * Elsewhere OBS is started and left to itself: only a start that cannot
	 * even be made is told apart.
	 */
	private async openObs(): Promise<boolean> {
		const system = this.deps.system();
		const runner = await this.deps.processes();
		if (system === null || runner === null) return false;
		for (const launch of obsLaunches(system)) {
			const program = runner.run(launch.command, launch.args, {
				...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
				detached: system !== 'mac',
			});
			if (system === 'mac') {
				const exit = await program.closed;
				if (exit.error === null && exit.code === 0) return true;
				continue;
			}
			const early = await within(this.deps.timers, program.closed, LAUNCH_WATCH_MS);
			if (early === null || early.error === null) return true;
		}
		return false;
	}

	// ---- Telling ----

	private move(patch: Partial<RecordingState>): void {
		this.current = { ...this.current, ...patch };
		this.emit({ kind: 'changed' });
	}

	private emit(event: RecordingEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				// One listener's fault is not the recording's, nor the next listener's.
				console.error(error);
			}
		}
	}
}
