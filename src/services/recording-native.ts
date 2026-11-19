import {
	MAC_FOLDER_TEST,
	MAC_PROCESS_LIST,
	MAC_SIGNAL,
	NATIVE_CAP_MS,
	NATIVE_RECORDER,
	classifyNativeExit,
	folderTestArguments,
	interruptArguments,
	isNativeRecorderLine,
	nativeArguments,
	processListArguments,
	readNativeLedger,
	type NativeLedger,
	type NativeTarget,
} from '../domain';
import type { ProcessExit, ProcessRunner, RunningProcess } from './desktop-process';
import {
	waitOn,
	within,
	type RecorderHooks,
	type RecorderStart,
	type RecorderStop,
	type RecordingTimers,
} from './recording-driver';

/**
 * The Mac's own screen recorder, `screencapture`, as a recorder. It is
 * started with a file to write and records until it is interrupted. The
 * interrupt is its stop: it ends with its file whole. No other signal is,
 * each of them ends it with nothing saved, so they are kept for a recorder
 * that will not end. The Mac may end it by itself too: when the screen
 * locks, or when the stop in the menu bar is pressed.
 *
 * The recorder writes somewhere of its own while it records and moves the
 * file into place at the end. A folder that is not there is found out only
 * then, with the whole recording lost, so the folder is looked at first.
 *
 * A recorder goes on without Obsidian: one whose Obsidian died records
 * until something ends it. The device therefore keeps the number of the
 * recorder that runs, and the next plugin to load ends what was left.
 *
 * The recorder takes one screen. A rectangle laid over several screens
 * comes out with every screen but one black, so every screen at once is a
 * recorder for each screen, started and ended together as one recording,
 * and a file for each.
 *
 * It takes one window too, so Obsidian alone is a recorder for each of
 * Obsidian's windows: the main one, and each a tab was moved out into. The
 * main window's recorder is the recording. The others come and go with
 * their windows: one joins when a window opens, and is sent its stop when
 * its window closes, since a recorder goes on filming a window that is no
 * longer there. Its file is kept, and the recording goes on.
 *
 * The recorder has no word for quality and needs none: it writes only what
 * changes on the screen, so an hour of typing is a small file. What the
 * Mac's own converter makes of that file is larger at the same size and
 * hard to read at a smaller one, so the file is kept as the recorder made
 * it.
 */

export interface NativeRecorderDeps {
	/** The desktop's runner of programs, or null where there is none. */
	processes(): Promise<ProcessRunner | null>;
	timers: RecordingTimers;
	now(): number;
	/** Whether macOS lets Obsidian record the screen: a plain no is known before the recorder is tried. */
	screenAccess(): 'granted' | 'denied' | 'unknown';
	/** The place on the device of the recorders that run. */
	ledger: { load(): unknown; save(entries: NativeLedger[] | null): void };
	/** Moves a file to the Trash. False where it could not. */
	trash(path: string): Promise<boolean>;
}

/** One recorder's part of a recording: what it films and the file it writes. */
export interface NativeTake {
	file: string;
	target: NativeTarget;
	/**
	 * The window of Obsidian's it films, where its end is that window's to
	 * decide. Every such recorder but the first may end, or fail, without
	 * the recording ending with it.
	 */
	window?: object;
}

export interface NativeStart {
	/** The folder the files go into. */
	folder: string;
	/**
	 * What is recorded and where to: a recorder and a file for each screen,
	 * or for each of Obsidian's windows. The first file is the one the
	 * author is told of.
	 */
	takes: readonly NativeTake[];
}

/** A recorder that ends this soon after its start, unasked, never recorded. */
export const NATIVE_GRACE_MS = 1500;
/** How long an interrupted recorder is given to move its file into place: hours of video onto another disk take a while. */
export const NATIVE_SAVE_MS = 10 * 60 * 1000;
/** How long each harder signal is given, for a recorder that will not end. */
const STOP_SIGNAL_MS = 5000;
/** How long a quitting Obsidian waits for the file. The recorder finishes it alone after that. */
const SETTLE_MS = 3000;
/** How often, and how many times, a recorder left by an earlier run is looked at after its interrupt. */
const MEND_WAIT_MS = 500;
const MEND_TRIES = 20;

/** One screen's recorder, or one window's, within a recording. */
interface Take {
	child: RunningProcess;
	file: string;
	/** When it began: a recorder that joined later began later. */
	startedAt: number;
	/** The window of Obsidian's it films, where it films one. */
	window: object | null;
	/** Its end is its window's alone: the recording neither ends nor fails with it. */
	loose: boolean;
	/** What the recorder said on its way, the last of it. */
	said: string;
	/** How it ended, once it has. */
	exit: ProcessExit | null;
	/** It was sent its stop. A second one could cost the file, so it is sent once. */
	interrupted: boolean;
}

/** The files a recording left: the first by its path, the rest by their count. */
const kept = (takes: readonly Take[]): { path: string | null; more?: number } => ({
	path: takes[0]?.file ?? null,
	...(takes.length > 1 ? { more: takes.length - 1 } : {}),
});

export class NativeRecorder {
	private takes: Take[] = [];
	private hooks: RecorderHooks | null = null;
	private recording = false;
	private stopAsked = false;
	private cap: unknown = null;
	private disposed = false;

	constructor(private readonly deps: NativeRecorderDeps) {}

	async start(request: NativeStart, hooks: RecorderHooks): Promise<RecorderStart> {
		if (this.recording || this.takes.length > 0) return { ok: false, code: 'busy', detail: null };
		if (request.takes.length === 0) return { ok: false, code: 'unavailable', detail: null };
		if (this.deps.screenAccess() === 'denied') return { ok: false, code: 'permission', detail: null };
		const runner = await this.deps.processes();
		if (runner === null) return { ok: false, code: 'unavailable', detail: null };
		hooks.phase('starting');
		if (!(await this.folderReady(runner, request.folder))) return { ok: false, code: 'folder', detail: null };
		if (this.disposed || hooks.cancelled()) return { ok: false, code: 'cancelled', detail: null };
		// Nothing is left to check. The author is counted in, and may still give the start up.
		if (!(await hooks.hold()) || this.disposed) return { ok: false, code: 'cancelled', detail: null };
		if (this.recording || this.takes.length > 0) return { ok: false, code: 'busy', detail: null };
		const startedAt = this.deps.now();
		const takes = request.takes.map((asked, index) =>
			this.launch(runner, asked, index > 0 && asked.window !== undefined, startedAt),
		);
		this.takes = takes;
		this.hooks = hooks;
		this.stopAsked = false;
		this.keep(takes);
		// A window's recorder that goes at once costs that window's file and no more.
		const early = await within(
			this.deps.timers,
			Promise.race(takes.filter((take) => !take.loose).map((take) => take.child.closed.then(() => take))),
			NATIVE_GRACE_MS,
		);
		if (this.takes !== takes) {
			// Given up from outside during the grace: the plugin is going away.
			return { ok: false, code: 'cancelled', detail: null };
		}
		if (early !== null) {
			// A recorder gone inside the grace never recorded, and a recording
			// with a screen missing is none: the rest end with it, and what
			// they wrote in that moment is thrown away.
			await this.halt(takes.filter((take) => take !== early));
			this.clear();
			this.deps.ledger.save(null);
			const verdict = this.read(early, false, true);
			return verdict.kind === 'failed'
				? { ok: false, code: verdict.code, detail: verdict.detail }
				: { ok: false, code: 'recorder-failed', detail: null };
		}
		this.recording = true;
		if (hooks.cancelled()) {
			await this.stop();
			// What they wrote in a second or two is no recording: it goes to the Trash.
			for (const take of takes) void this.deps.trash(take.file);
			return { ok: false, code: 'cancelled', detail: null };
		}
		// The recorder has no limit of its own that it can be stopped under, so the plugin keeps one.
		this.cap = this.deps.timers.set(() => {
			if (this.takes === takes && !this.stopAsked) this.interrupt(takes);
		}, NATIVE_CAP_MS);
		for (const take of takes) this.watch(takes, take);
		return { ok: true, startedAt, ...kept(takes), path: takes[0]?.file ?? null };
	}

	/**
	 * A window of Obsidian's opened under a recording of its windows: a
	 * recorder joins for it, with a file of its own. False where no
	 * recording runs to join, or no recorder could be started.
	 */
	async add(asked: NativeTake): Promise<boolean> {
		const takes = this.takes;
		const open = (): boolean => this.takes === takes && this.recording && !this.stopAsked && !this.disposed;
		if (takes.length === 0 || !open()) return false;
		const runner = await this.deps.processes();
		if (runner === null || !open()) return false;
		const take = this.launch(runner, asked, true, this.deps.now());
		takes.push(take);
		this.keep(takes);
		this.watch(takes, take);
		return true;
	}

	/**
	 * A window of Obsidian's closed: its recorder is sent its stop and saves
	 * its file. Left alone it would film a window that is no longer there
	 * until the recording ends. The main window's recorder is never among
	 * them: that window closes with Obsidian.
	 */
	release(window: object): void {
		if (!this.recording || this.stopAsked) return;
		this.interrupt(this.takes.filter((take) => take.loose && take.window === window));
	}

	/**
	 * Stops the recorders with an interrupt and waits for their files. Only
	 * one that has not ended long after is sent harder signals, which end
	 * it with nothing saved. Null where the recording is already ending by
	 * itself: that end is on its way, and names the files itself.
	 */
	async stop(): Promise<RecorderStop | null> {
		return this.end(NATIVE_SAVE_MS, true);
	}

	/**
	 * The same for an Obsidian that is quitting and cannot wait long. A
	 * recorder still moving its file is left to finish alone: it needs no
	 * Obsidian for that.
	 */
	async settle(): Promise<RecorderStop | null> {
		return this.end(SETTLE_MS, false);
	}

	/** The plugin is going away this instant: the recorders are interrupted and not waited for. They save their files alone. */
	abandon(): void {
		this.interrupt(this.takes);
		this.clear();
		this.disposed = true;
	}

	/**
	 * Ends the recorders an earlier run of the plugin left going: Obsidian
	 * died, or its window was reloaded, with a recording under way. A number
	 * the device kept is believed only where the system still lists the
	 * recorder under it. Answers the files they then saved, the first by its
	 * path, or null where nothing was left.
	 */
	async mend(): Promise<{ path: string; more: number } | null> {
		if (this.takes.length > 0 || this.disposed) return null;
		const entries = readNativeLedger(this.deps.ledger.load());
		if (entries.length === 0) return null;
		const runner = await this.deps.processes();
		if (runner === null) return null;
		const running = async (entry: NativeLedger): Promise<boolean> => {
			const listed = runner.run(MAC_PROCESS_LIST, processListArguments(entry.pid));
			let line = '';
			listed.onText('out', (text) => {
				line += text;
			});
			const exit = await listed.closed;
			return exit.error === null && exit.code === 0 && isNativeRecorderLine(line, entry, this.deps.now());
		};
		const left: NativeLedger[] = [];
		for (const entry of entries) {
			if (await running(entry)) left.push(entry);
		}
		const first = left[0];
		if (first === undefined) {
			this.deps.ledger.save(null);
			return null;
		}
		for (const entry of left) await runner.run(MAC_SIGNAL, interruptArguments(entry.pid)).closed;
		for (let attempt = 0; attempt < MEND_TRIES; attempt += 1) {
			await waitOn(this.deps.timers, MEND_WAIT_MS);
			if (this.disposed) return null;
			let still = false;
			for (const entry of left) {
				if (await running(entry)) {
					still = true;
					break;
				}
			}
			if (!still) {
				this.deps.ledger.save(null);
				return { path: first.file, more: left.length - 1 };
			}
		}
		// Still moving a file: they are looked at again the next time.
		return null;
	}

	// ---- A start ----

	/** Starts one recorder and reads what it says and how it ends. */
	private launch(runner: ProcessRunner, asked: NativeTake, loose: boolean, startedAt: number): Take {
		const child = runner.run(NATIVE_RECORDER, nativeArguments(asked.file, asked.target));
		const take: Take = {
			child,
			file: asked.file,
			startedAt,
			window: asked.window ?? null,
			loose,
			said: '',
			exit: null,
			interrupted: false,
		};
		child.onText('err', (text) => {
			take.said = (take.said + text).slice(-4000);
		});
		// Whatever it prints is read, so a full pipe never holds it up.
		child.onText('out', () => {});
		void child.closed.then((exit) => {
			take.exit = exit;
		});
		return take;
	}

	/** Follows a recorder to its end: the recording's own end, or only that of one window's file. */
	private watch(takes: Take[], take: Take): void {
		void take.child.closed.then(() => {
			if (take.loose) this.keep(takes);
			else void this.exited(takes);
		});
	}

	/** Writes down the recorders that run, for a plugin that finds them left running. */
	private keep(takes: readonly Take[]): void {
		if (this.takes !== takes) return;
		const running = takes.flatMap((take) =>
			take.exit !== null || take.child.pid === null
				? []
				: [{ pid: take.child.pid, file: take.file, startedAt: take.startedAt }],
		);
		this.deps.ledger.save(running.length > 0 ? running : null);
	}

	/** Whether the folder is there and can be written to. Where the look itself cannot be made, the recorder is tried all the same. */
	private async folderReady(runner: ProcessRunner, folder: string): Promise<boolean> {
		const exit = await runner.run(MAC_FOLDER_TEST, folderTestArguments(folder)).closed;
		return exit.error !== null || exit.code === 0;
	}

	/** Ends recorders whose recording came to nothing before it began, and throws away what they wrote. */
	private async halt(takes: readonly Take[]): Promise<void> {
		this.interrupt(takes);
		await within(this.deps.timers, Promise.all(takes.map((take) => take.child.closed)), STOP_SIGNAL_MS);
		for (const take of takes) void this.deps.trash(take.file);
	}

	// ---- An end ----

	/** Sends each recorder that still runs its stop, once. */
	private interrupt(takes: readonly Take[]): void {
		for (const take of takes) {
			if (take.exit !== null || take.interrupted) continue;
			take.interrupted = true;
			take.child.signal('SIGINT');
		}
	}

	private read(take: Take, stopAsked: boolean, early: boolean): ReturnType<typeof classifyNativeExit> {
		return classifyNativeExit({
			stderr: take.said,
			code: take.exit?.code ?? null,
			spawnError: take.exit?.error ?? null,
			stopAsked,
			early,
		});
	}

	/**
	 * What a recording that has ended left: its files, or why it kept none.
	 * One screen lost is the recording lost. A window that came and went
	 * costs its own file at most.
	 */
	private outcome(takes: readonly Take[], stopAsked: boolean): RecorderStop {
		const saved: Take[] = [];
		for (const take of takes) {
			const verdict = this.read(take, stopAsked, false);
			if (verdict.kind === 'ended') saved.push(take);
			else if (!take.loose) return { path: null, error: verdict.code };
		}
		return { ...kept(saved), error: null };
	}

	private async end(waitMs: number, force: boolean): Promise<RecorderStop | null> {
		const takes = this.takes;
		if (takes.length === 0 || !this.recording) return { path: null, error: null };
		// Already ending: the Mac ended a recorder, and the rest are putting
		// their files in place. That end names the files once they are
		// there, and a second one would only answer before it with nothing.
		if (this.stopAsked) return null;
		this.stopAsked = true;
		this.deps.timers.clear(this.cap);
		this.interrupt(takes);
		const all = Promise.all(takes.map((take) => take.child.closed));
		let done = await within(this.deps.timers, all, waitMs);
		if (done === null && force) {
			for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
				for (const take of takes) {
					if (take.exit === null) take.child.signal(signal);
				}
				done = await within(this.deps.timers, all, STOP_SIGNAL_MS);
				if (done !== null) break;
			}
		}
		if (this.takes === takes) this.clear();
		if (done === null) {
			// Still moving a file, and nobody waits any longer. What the
			// device kept of it is settled the next time the plugin looks.
			return { path: null, error: null };
		}
		this.deps.ledger.save(null);
		return this.outcome(takes, true);
	}

	private clear(): void {
		this.deps.timers.clear(this.cap);
		this.cap = null;
		this.takes = [];
		this.hooks = null;
		this.recording = false;
		this.stopAsked = false;
	}

	/**
	 * A recorder the recording stands on went by itself: the Mac ended it,
	 * or the plugin's own limit was reached. The others end with it, so that
	 * every screen's file is of one length, and the recording is told of
	 * once.
	 */
	private async exited(takes: Take[]): Promise<void> {
		if (this.takes !== takes || this.stopAsked) return;
		this.stopAsked = true;
		this.deps.timers.clear(this.cap);
		this.interrupt(takes);
		const done = await within(
			this.deps.timers,
			Promise.all(takes.map((take) => take.child.closed)),
			NATIVE_SAVE_MS,
		);
		if (this.takes !== takes) return;
		const hooks = this.hooks;
		this.clear();
		if (done === null) {
			hooks?.ended({ reason: 'external', path: null, error: 'recorder-failed' });
			return;
		}
		this.deps.ledger.save(null);
		hooks?.ended({ reason: 'external', ...this.outcome(takes, false) });
	}
}
