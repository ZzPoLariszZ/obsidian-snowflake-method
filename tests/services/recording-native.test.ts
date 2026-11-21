import { describe, expect, it } from 'vitest';

import {
	MAC_FOLDER_TEST,
	MAC_PROCESS_LIST,
	MAC_SIGNAL,
	NATIVE_CAP_MS,
	NATIVE_RECORDER,
	type NativeLedger,
	type NativeTarget,
	type RecordingNoticeCode,
} from '../../src/domain';
import type { RecorderEnd, RecorderHooks } from '../../src/services/recording-driver';
import {
	NATIVE_GRACE_MS,
	NATIVE_SAVE_MS,
	NativeRecorder,
	type NativeStart,
} from '../../src/services/recording-native';
import { FakeClock } from '../helpers/fake-clock';
import { FakeProcessRunner, type FakeProcess } from '../helpers/fake-process';

const FOLDER = '/Users/ada/Movies';
const FILE = `${FOLDER}/2026-11-19 14.30.05.mov`;

function rig(options: { access?: 'granted' | 'denied' | 'unknown'; runner?: boolean; kept?: unknown } = {}) {
	const clock = new FakeClock();
	const runner = new FakeProcessRunner();
	const seen = {
		phases: [] as string[],
		ended: [] as RecorderEnd[],
		notices: [] as RecordingNoticeCode[],
		trashed: [] as string[],
		cancel: false,
		/** How many times the author was counted in, and what the count answers: true once it has run out. */
		held: 0,
		count: (): Promise<boolean> => Promise.resolve(true),
		trashWorks: true,
		/** The folder is there and can be written to. */
		folder: true,
		/** A recorder's file is there, with something in it, once the recorder has ended. */
		saved: true,
		/** What the device keeps of the recorder that runs, and every value it was given. */
		kept: (options.kept ?? null) as unknown,
		keeps: [] as (NativeLedger[] | null)[],
	};
	runner.played.set(MAC_FOLDER_TEST, (process) => {
		// The same small program looks at a folder, and at a recorder's file with `-s`.
		if (process.args[0] === '-s') process.end(seen.saved ? 0 : 1);
		else process.end(seen.folder ? 0 : 1);
	});
	const recorder = new NativeRecorder({
		processes: () => Promise.resolve(options.runner === false ? null : runner),
		timers: clock.timers,
		now: () => clock.now,
		screenAccess: () => options.access ?? 'granted',
		ledger: {
			load: () => seen.kept,
			save: (entries) => {
				seen.kept = entries;
				seen.keeps.push(entries);
			},
		},
		trash: (path) => {
			seen.trashed.push(path);
			return Promise.resolve(seen.trashWorks);
		},
	});
	const hooks: RecorderHooks = {
		phase: (phase) => seen.phases.push(phase),
		cancelled: () => seen.cancel,
		hold: () => {
			seen.held += 1;
			return seen.count();
		},
		bytes: () => {},
		notice: (code) => seen.notices.push(code),
		ended: (end) => seen.ended.push(end),
	};
	/** The recorder itself, among the small programs started around it. */
	const recording = (): FakeProcess => {
		const found = runner.of(NATIVE_RECORDER).pop();
		if (found === undefined) throw new Error('No recorder was started.');
		return found;
	};
	/** Starts a recording whose recorders take the interrupt as their stop, as the real one does. */
	const begin = async (patch: RequestPatch = {}): Promise<FakeProcess> => {
		const before = runner.of(NATIVE_RECORDER).length;
		const started = await clock.drive(recorder.start(request(patch), hooks));
		if (!started.ok) throw new Error(`The recording did not start: ${started.code}`);
		for (const process of runner.of(NATIVE_RECORDER).slice(before)) process.onSignal = { SIGINT: 0 };
		return recording();
	};
	return { clock, runner, recorder, hooks, seen, recording, begin };
}

interface RequestPatch {
	file?: string;
	target?: NativeTarget;
	takes?: NativeStart['takes'];
}

/** One screen's recording unless more are asked for. */
const request = (patch: RequestPatch = {}): NativeStart => ({
	folder: FOLDER,
	takes: patch.takes ?? [{ file: patch.file ?? FILE, target: patch.target ?? { kind: 'main' } }],
});

const SCREEN_1 = `${FOLDER}/2026-11-19 14.30.05 (1).mov`;
const SCREEN_2 = `${FOLDER}/2026-11-19 14.30.05 (2).mov`;
const BOTH_SCREENS: NativeStart['takes'] = [
	{ file: SCREEN_1, target: { kind: 'display', index: 1 } },
	{ file: SCREEN_2, target: { kind: 'display', index: 2 } },
];

describe('recording with the Mac’s own recorder', () => {
	it('starts the recorder by its whole path with its words as a list, no sound and no limit of its own', async () => {
		const { clock, recorder, hooks, seen, recording } = rig();
		const started = await clock.drive(recorder.start(request({ target: { kind: 'window', id: 77 } }), hooks));
		expect(started).toEqual({ ok: true, startedAt: 1_000_000, path: FILE });
		expect(seen.phases).toEqual(['starting']);
		expect(recording().command).toBe(NATIVE_RECORDER);
		expect(recording().args).toEqual(['-v', '-x', '-o', '-l', '77', FILE]);
		// Followed, not left to itself: it must not outlive a stop.
		expect(recording().options.detached).not.toBe(true);
	});

	it('counts the author in before any recorder starts, and starts none where the count is stopped', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		let finish: (ran: boolean) => void = () => {};
		seen.count = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const starting = recorder.start(request(), hooks);
		await clock.advance(5000);
		// The folder was looked at, and nothing records while the count runs.
		expect(seen.held).toBe(1);
		expect(runner.of(MAC_FOLDER_TEST)).toHaveLength(1);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		finish(true);
		const started = await clock.drive(starting);
		// The recording's clock begins where the count ended.
		expect(started).toEqual({ ok: true, startedAt: 1_005_000, path: FILE });
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(1);

		const stopped = rig();
		stopped.seen.count = () => Promise.resolve(false);
		expect(await stopped.clock.drive(stopped.recorder.start(request(), stopped.hooks))).toEqual({
			ok: false,
			code: 'cancelled',
			detail: null,
		});
		expect(stopped.runner.of(NATIVE_RECORDER)).toHaveLength(0);
		expect([stopped.seen.keeps, stopped.seen.trashed]).toEqual([[], []]);
	});

	it('looks at the folder first, and records nothing into one that is not there', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		seen.folder = false;
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({ ok: false, code: 'folder', detail: null });
		// Nobody is counted in for a recording that cannot be made.
		expect(seen.held).toBe(0);
		expect(runner.of(MAC_FOLDER_TEST).map((run) => run.args)).toEqual([['-d', FOLDER, '-a', '-w', FOLDER]]);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
		expect(seen.keeps).toEqual([]);
	});

	it('tries the recorder all the same where the folder cannot be looked at', async () => {
		const { clock, runner, recorder, hooks } = rig();
		runner.played.set(MAC_FOLDER_TEST, (process) => {
			process.fail('spawn /bin/test ENOENT');
		});
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
	});

	it('never tries the recorder where macOS has said no', async () => {
		const { clock, runner, recorder, hooks } = rig({ access: 'denied' });
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'permission',
			detail: null,
		});
		expect(runner.runs).toHaveLength(0);
	});

	it('says recording is unavailable where no program can be started', async () => {
		const { clock, recorder, hooks } = rig({ runner: false });
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'unavailable',
			detail: null,
		});
	});

	it('takes a recorder that ends within the grace of its start as a failure, with what it said', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		runner.played.set(NATIVE_RECORDER, (process) => {
			process.say('err', 'screencapture: Invalid display specified. Must be a number from 1-2\n');
			process.end(1);
		});
		expect(await clock.drive(recorder.start(request({ target: { kind: 'display', index: 3 } }), hooks))).toEqual({
			ok: false,
			code: 'recorder-failed',
			detail: 'screencapture: Invalid display specified. Must be a number from 1-2',
		});
		// Nothing is left on the device of a recorder that never recorded.
		expect(seen.kept).toBeNull();
		// It ended in failure and saved nothing: there is no file of its to throw away.
		expect(seen.trashed).toEqual([]);
		// A failed start leaves the recorder free for the next.
		runner.played.delete(NATIVE_RECORDER);
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
	});

	it('takes even a clean end within the grace as a failure, and throws away the moment it saved', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		runner.played.set(NATIVE_RECORDER, (process) => {
			process.end(0);
		});
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'recorder-failed',
			detail: null,
		});
		// A recorder that ends cleanly saves what it has: macOS 14's left a file a twentieth of a second long.
		expect(seen.trashed).toEqual([FILE]);
	});

	it('reads a recorder that could not be started as a failure', async () => {
		const { clock, runner, recorder, hooks } = rig();
		runner.played.set(NATIVE_RECORDER, (process) => {
			process.fail('spawn /usr/sbin/screencapture ENOENT');
		});
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'recorder-failed',
			detail: 'spawn /usr/sbin/screencapture ENOENT',
		});
	});

	it('believes the recording only once the grace has passed', async () => {
		const { clock, recorder, hooks } = rig();
		let settled = false;
		const starting = recorder.start(request(), hooks);
		void starting.then(() => {
			settled = true;
		});
		await clock.advance(NATIVE_GRACE_MS - 100);
		expect(settled).toBe(false);
		await clock.advance(200);
		expect(settled).toBe(true);
	});

	it('keeps the number of the recorder that runs on the device, and lets it go with the recording', async () => {
		const { clock, recorder, seen, begin } = rig();
		const process = await begin();
		expect(seen.kept).toEqual([{ pid: process.pid, file: FILE, startedAt: 1_000_000 }]);
		await clock.drive(recorder.stop());
		expect(seen.kept).toBeNull();
	});

	it('writes down that a recorder was sent its stop, for whoever finds it still saving', async () => {
		// The plugin goes this instant, and the recorder takes a while over its file.
		const gone = rig();
		const left = await gone.begin();
		left.onSignal = {};
		gone.recorder.abandon();
		expect(left.signals).toEqual(['SIGINT']);
		expect(gone.seen.kept).toEqual([{ pid: left.pid, file: FILE, startedAt: 1_000_000, stopped: true }]);

		// A quitting Obsidian that could not wait for the file leaves the same word.
		const quit = rig();
		const slow = await quit.begin();
		slow.onSignal = {};
		expect(await quit.clock.drive(quit.recorder.settle())).toEqual({ path: null, error: null });
		expect(quit.seen.kept).toEqual([{ pid: slow.pid, file: FILE, startedAt: 1_000_000, stopped: true }]);
	});

	it('stops with an interrupt and waits for the file', async () => {
		const { clock, recorder, seen, begin } = rig();
		const process = await begin();
		expect(await clock.drive(recorder.stop())).toEqual({ path: FILE, error: null });
		expect(process.signals).toEqual(['SIGINT']);
		expect(seen.ended).toEqual([]);
		expect(clock.waiting).toBe(0);
	});

	it('takes an older recorder’s answer to its stop as a stop: it ends with 2 and its file is there', async () => {
		const { clock, runner, recorder, begin } = rig();
		const process = await begin();
		// The recorder of macOS 14 ends on an interrupt with 2, its file saved all the same.
		process.onSignal = { SIGINT: 2 };
		expect(await clock.drive(recorder.stop())).toEqual({ path: FILE, error: null });
		// The file was looked at before it was believed.
		expect(runner.of(MAC_FOLDER_TEST).map((look) => look.args)).toContainEqual(['-s', FILE]);
	});

	it('takes one the interrupt itself ended the same way, where its file is there', async () => {
		const { clock, recorder, begin } = rig();
		const process = await begin();
		process.onSignal = { SIGINT: 'killed' };
		expect(await clock.drive(recorder.stop())).toEqual({ path: FILE, error: null });
	});

	it('says the recording was not kept where such a recorder left no file', async () => {
		const { clock, recorder, seen, begin } = rig();
		const process = await begin();
		process.onSignal = { SIGINT: 2 };
		seen.saved = false;
		expect(await clock.drive(recorder.stop())).toEqual({ path: null, error: 'recorder-failed' });
	});

	it('never takes 2 for a stop from a recorder that was sent none, and looks at no file for it', async () => {
		const { clock, runner, seen, begin } = rig();
		const process = await begin();
		// It went by itself with a fault: nothing was asked of it.
		process.end(2);
		await clock.settle();
		expect(seen.ended).toEqual([{ reason: 'external', path: null, error: 'recorder-failed' }]);
		expect(runner.of(MAC_FOLDER_TEST).filter((look) => look.args[0] === '-s')).toHaveLength(0);
	});

	it('gives an interrupted recorder ten minutes for its file before anything harder', async () => {
		const { clock, recorder, begin } = rig();
		const process = await begin();
		// This one hears nothing but the last signal, which saves nothing.
		process.onSignal = { SIGKILL: 'killed' };
		const stopping = recorder.stop();
		await clock.advance(NATIVE_SAVE_MS - 1000);
		expect(process.signals).toEqual(['SIGINT']);
		await clock.advance(2000);
		expect(process.signals).toEqual(['SIGINT', 'SIGTERM']);
		expect(await clock.drive(stopping)).toEqual({ path: null, error: 'recorder-failed' });
		expect(process.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
	});

	it('still takes the file of a recorder that needed most of its ten minutes', async () => {
		const { clock, recorder, begin } = rig();
		const process = await begin();
		process.onSignal = {};
		const stopping = recorder.stop();
		await clock.advance(NATIVE_SAVE_MS - 5000);
		process.end(0);
		expect(await clock.drive(stopping)).toEqual({ path: FILE, error: null });
		expect(process.signals).toEqual(['SIGINT']);
	});

	it('says the recording was not kept where the recorder could not put its file in place', async () => {
		const { clock, recorder, begin } = rig();
		const process = await begin();
		process.onSignal = {};
		const stopping = recorder.stop();
		await clock.settle();
		process.say('err', `screencapture: Failed to save to final location ${FILE}\n`);
		process.end(1);
		expect(await clock.drive(stopping)).toEqual({ path: null, error: 'folder' });
	});

	it('takes a recorder the Mac ended by itself as a recording that ended', async () => {
		const { clock, recorder, hooks, seen, begin } = rig();
		const process = await begin();
		// The screen locked, or the stop in the menu bar was pressed.
		process.end(0);
		await clock.settle();
		expect(seen.ended).toEqual([{ reason: 'external', path: FILE, error: null }]);
		expect(seen.kept).toBeNull();
		// Nothing is left to stop, and the next recording can begin.
		expect(await clock.drive(recorder.stop())).toEqual({ path: null, error: null });
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
	});

	it('says so where a recorder that ended by itself kept nothing', async () => {
		const { clock, seen, begin } = rig();
		const process = await begin();
		process.say('err', `screencapture: Failed to save to final location ${FILE}\n`);
		process.end(1);
		await clock.settle();
		expect(seen.ended).toEqual([{ reason: 'external', path: null, error: 'folder' }]);
	});

	it('ends a recording at the plugin’s own limit, with its file', async () => {
		const { clock, seen, begin } = rig();
		const process = await begin();
		await clock.advance(NATIVE_CAP_MS - 1000);
		expect(process.signals).toEqual([]);
		await clock.advance(2000);
		expect(process.signals).toEqual(['SIGINT']);
		expect(seen.ended).toEqual([{ reason: 'external', path: FILE, error: null }]);
	});

	it('will not record twice at once', async () => {
		const { clock, runner, recorder, hooks, begin } = rig();
		await begin();
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({ ok: false, code: 'busy', detail: null });
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(1);
	});

	it('stops a start the author gave up during the grace, and throws away what it wrote', async () => {
		const { clock, runner, recorder, hooks, seen, recording } = rig();
		runner.onRun = (process) => {
			if (process.command === NATIVE_RECORDER) process.onSignal = { SIGINT: 0 };
		};
		const starting = recorder.start(request(), hooks);
		await clock.advance(500);
		seen.cancel = true;
		expect(await clock.drive(starting)).toEqual({ ok: false, code: 'cancelled', detail: null });
		expect(recording().signals).toEqual(['SIGINT']);
		expect(seen.trashed).toEqual([FILE]);
		// The recorder and the look at the folder are all that was ever started.
		expect(runner.runs.map((run) => run.command)).toEqual([MAC_FOLDER_TEST, NATIVE_RECORDER]);
	});

	it('starts nothing for a start given up while the folder was looked at', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		seen.cancel = true;
		expect(await clock.drive(recorder.start(request(), hooks))).toEqual({
			ok: false,
			code: 'cancelled',
			detail: null,
		});
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(0);
	});

	it('interrupts the recorder without waiting when the plugin goes this instant, and lets it save alone', async () => {
		const { clock, recorder, seen, begin } = rig();
		const process = await begin();
		process.onSignal = {};
		recorder.abandon();
		expect(process.signals).toEqual(['SIGINT']);
		process.end(0);
		await clock.advance(20_000);
		// The gone plugin hears nothing of it, and no timer of the recorder's still turns.
		expect(seen.ended).toEqual([]);
		expect(clock.waiting).toBe(0);
		// The device still names it: the next plugin to load finds it gone and lets the note go.
		expect(seen.kept).not.toBeNull();
	});

	it('gives a quitting Obsidian three seconds, and leaves a recorder still saving to finish alone', async () => {
		const { clock, recorder, seen, begin } = rig();
		const process = await begin();
		process.onSignal = {};
		const settling = recorder.settle();
		await clock.advance(2900);
		let done = false;
		void settling.then(() => {
			done = true;
		});
		await clock.settle();
		expect(done).toBe(false);
		await clock.advance(200);
		expect(await settling).toEqual({ path: null, error: null });
		// Nothing harder than the interrupt was sent, and the device still names the recorder.
		expect(process.signals).toEqual(['SIGINT']);
		expect(seen.kept).not.toBeNull();
	});

	it('answers a quitting Obsidian with the file where the recorder was quick', async () => {
		const { clock, recorder, seen, begin } = rig();
		await begin();
		expect(await clock.drive(recorder.settle())).toEqual({ path: FILE, error: null });
		expect(seen.kept).toBeNull();
	});
});

describe('every screen at once, a recorder for each', () => {
	it('starts a recorder for each screen, and tells of their files as one recording', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		const started = await clock.drive(recorder.start(request({ takes: BOTH_SCREENS }), hooks));
		expect(started).toEqual({ ok: true, startedAt: 1_000_000, path: SCREEN_1, more: 1 });
		const recorders = runner.of(NATIVE_RECORDER);
		expect(recorders.map((process) => process.args)).toEqual([
			['-v', '-x', '-D', '1', SCREEN_1],
			['-v', '-x', '-D', '2', SCREEN_2],
		]);
		// The folder was looked at once, and the device knows of both.
		expect(runner.of(MAC_FOLDER_TEST)).toHaveLength(1);
		expect(seen.kept).toEqual([
			{ pid: recorders[0]?.pid, file: SCREEN_1, startedAt: 1_000_000 },
			{ pid: recorders[1]?.pid, file: SCREEN_2, startedAt: 1_000_000 },
		]);
	});

	it('stops them together, each with one interrupt, and names the first file and how many more', async () => {
		const { clock, runner, recorder, seen, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		expect(await clock.drive(recorder.stop())).toEqual({ path: SCREEN_1, more: 1, error: null });
		expect(runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([['SIGINT'], ['SIGINT']]);
		expect(seen.kept).toBeNull();
		expect(clock.waiting).toBe(0);
	});

	it('names every screen’s file where each recorder answered its stop the older way', async () => {
		const { clock, runner, recorder, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		for (const process of runner.of(NATIVE_RECORDER)) process.onSignal = { SIGINT: 2 };
		expect(await clock.drive(recorder.stop())).toEqual({ path: SCREEN_1, more: 1, error: null });
		expect(runner.of(MAC_FOLDER_TEST).filter((look) => look.args[0] === '-s')).toHaveLength(2);
	});

	it('keeps every file where the Mac ended one screen and the other answered its stop the older way', async () => {
		const { clock, runner, seen, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		const [first, second] = runner.of(NATIVE_RECORDER);
		if (first !== undefined) first.onSignal = { SIGINT: 2 };
		second?.end(0);
		await clock.settle();
		expect(first?.signals).toEqual(['SIGINT']);
		expect(seen.ended).toEqual([{ reason: 'external', path: SCREEN_1, more: 1, error: null }]);
	});

	it('waits for the slowest of them before it says the recording is saved', async () => {
		const { clock, runner, recorder, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		const [first, second] = runner.of(NATIVE_RECORDER);
		if (second !== undefined) second.onSignal = {};
		let done = false;
		const stopping = recorder.stop();
		void stopping.then(() => {
			done = true;
		});
		await clock.advance(30_000);
		expect([first?.ended, done]).toEqual([true, false]);
		second?.end(0);
		expect(await clock.drive(stopping)).toEqual({ path: SCREEN_1, more: 1, error: null });
	});

	it('takes one screen whose file was not kept as the recording not kept', async () => {
		const { clock, runner, recorder, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		const second = runner.of(NATIVE_RECORDER)[1];
		if (second !== undefined) second.onSignal = {};
		const stopping = recorder.stop();
		await clock.settle();
		second?.say('err', `screencapture: Failed to save to final location ${SCREEN_2}\n`);
		second?.end(1);
		expect(await clock.drive(stopping)).toEqual({ path: null, error: 'folder' });
	});

	it('ends every screen’s recorder when the Mac ends one, and tells of it once', async () => {
		const { clock, runner, seen, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		const [first, second] = runner.of(NATIVE_RECORDER);
		// The stop in the menu bar was pressed for one screen.
		second?.end(0);
		await clock.settle();
		expect(first?.signals).toEqual(['SIGINT']);
		expect(second?.signals).toEqual([]);
		expect(seen.ended).toEqual([{ reason: 'external', path: SCREEN_1, more: 1, error: null }]);
		expect(seen.kept).toBeNull();
	});

	it('answers nothing to a stop while the recorders are already ending by themselves, and names the files once', async () => {
		const { clock, runner, recorder, seen, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		const [first, second] = runner.of(NATIVE_RECORDER);
		// The Mac ended one screen's recorder. The other takes its stop and is slow to put its file in place.
		if (first !== undefined) first.onSignal = {};
		second?.end(0);
		await clock.settle();
		expect(first?.signals).toEqual(['SIGINT']);
		expect(seen.ended).toEqual([]);
		// The author presses stop in that while: there is nothing left to stop, and nothing to say yet.
		expect(await recorder.stop()).toBeNull();
		expect(await recorder.settle()).toBeNull();
		// No second interrupt, which could cost the file, and nothing told twice.
		expect(first?.signals).toEqual(['SIGINT']);
		first?.end(0);
		await clock.settle();
		expect(seen.ended).toEqual([{ reason: 'external', path: SCREEN_1, more: 1, error: null }]);
		// With nothing recording, a stop has nothing to answer for, as before.
		expect(await recorder.stop()).toEqual({ path: null, error: null });
	});

	it('takes one recorder that never recorded as no recording at all, and throws the other’s moment away', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		runner.onRun = (process) => {
			if (process.command !== NATIVE_RECORDER) return;
			if (process.args.includes('2')) {
				void Promise.resolve().then(() => {
					process.say('err', 'screencapture: Invalid display specified. Must be a number from 1-1\n');
					process.end(1);
				});
			} else process.onSignal = { SIGINT: 0 };
		};
		expect(await clock.drive(recorder.start(request({ takes: BOTH_SCREENS }), hooks))).toEqual({
			ok: false,
			code: 'recorder-failed',
			detail: 'screencapture: Invalid display specified. Must be a number from 1-1',
		});
		const first = runner.of(NATIVE_RECORDER)[0];
		expect(first?.signals).toEqual(['SIGINT']);
		expect(seen.trashed).toEqual([SCREEN_1]);
		expect(seen.kept).toBeNull();
		// Nothing is left running, and the next recording can begin.
		runner.onRun = () => {};
		expect((await clock.drive(recorder.start(request(), hooks))).ok).toBe(true);
	});

	it('never interrupts a recorder twice: the plugin’s own limit, then the end that follows', async () => {
		const { clock, runner, seen, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		await clock.advance(NATIVE_CAP_MS + 2000);
		expect(runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([['SIGINT'], ['SIGINT']]);
		expect(seen.ended).toEqual([{ reason: 'external', path: SCREEN_1, more: 1, error: null }]);
	});

	it('interrupts them all without waiting when the plugin goes this instant', async () => {
		const { clock, runner, recorder, begin } = rig();
		await begin({ takes: BOTH_SCREENS });
		for (const process of runner.of(NATIVE_RECORDER)) process.onSignal = {};
		recorder.abandon();
		expect(runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([['SIGINT'], ['SIGINT']]);
		expect(clock.waiting).toBe(0);
	});

	it('throws every screen’s moment away for a start the author gave up', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		runner.onRun = (process) => {
			if (process.command === NATIVE_RECORDER) process.onSignal = { SIGINT: 0 };
		};
		const starting = recorder.start(request({ takes: BOTH_SCREENS }), hooks);
		await clock.advance(500);
		seen.cancel = true;
		expect(await clock.drive(starting)).toEqual({ ok: false, code: 'cancelled', detail: null });
		expect(seen.trashed).toEqual([SCREEN_1, SCREEN_2]);
	});

	it('records nothing where it is given no screen at all', async () => {
		const { clock, runner, recorder, hooks } = rig();
		expect(await clock.drive(recorder.start(request({ takes: [] }), hooks))).toEqual({
			ok: false,
			code: 'unavailable',
			detail: null,
		});
		expect(runner.runs).toHaveLength(0);
	});
});

describe('Obsidian alone, a recorder for each of its windows', () => {
	const MAIN = { window: 'main' };
	const SIDE = { window: 'side' };
	const LATER = { window: 'later' };
	const WINDOW_1 = SCREEN_1;
	const WINDOW_2 = SCREEN_2;
	const WINDOW_3 = `${FOLDER}/2026-11-19 14.30.05 (3).mov`;
	const BOTH_WINDOWS: NativeStart['takes'] = [
		{ file: WINDOW_1, target: { kind: 'window', id: 77 }, window: MAIN },
		{ file: WINDOW_2, target: { kind: 'window', id: 88 }, window: SIDE },
	];
	const THIRD = { file: WINDOW_3, target: { kind: 'window', id: 99 }, window: LATER } as const;

	it('starts a recorder for each window, each by its own number', async () => {
		const { clock, runner, recorder, hooks, seen } = rig();
		const started = await clock.drive(recorder.start(request({ takes: BOTH_WINDOWS }), hooks));
		expect(started).toEqual({ ok: true, startedAt: 1_000_000, path: WINDOW_1, more: 1 });
		const recorders = runner.of(NATIVE_RECORDER);
		expect(recorders.map((process) => process.args)).toEqual([
			['-v', '-x', '-o', '-l', '77', WINDOW_1],
			['-v', '-x', '-o', '-l', '88', WINDOW_2],
		]);
		expect(seen.kept).toEqual([
			{ pid: recorders[0]?.pid, file: WINDOW_1, startedAt: 1_000_000 },
			{ pid: recorders[1]?.pid, file: WINDOW_2, startedAt: 1_000_000 },
		]);
	});

	it('ends the recorder of a window that closed, keeps its file, and goes on recording', async () => {
		const { clock, runner, recorder, seen, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		const [main, side] = runner.of(NATIVE_RECORDER);
		recorder.release(SIDE);
		await clock.settle();
		// Left alone it would film a window that is no longer there.
		expect([main?.signals, side?.signals]).toEqual([[], ['SIGINT']]);
		expect(seen.ended).toEqual([]);
		// The device knows only of the one that still runs.
		expect(seen.kept).toEqual([{ pid: main?.pid, file: WINDOW_1, startedAt: 1_000_000 }]);
		expect(await clock.drive(recorder.stop())).toEqual({ path: WINDOW_1, more: 1, error: null });
		// Never a second stop for the one already ended.
		expect(side?.signals).toEqual(['SIGINT']);
		expect(seen.kept).toBeNull();
		expect(clock.waiting).toBe(0);
	});

	it('writes down that the recorder of a window that closed was sent its stop, beside the one that records on', async () => {
		const { runner, recorder, seen, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		const [main, side] = runner.of(NATIVE_RECORDER);
		if (main === undefined || side === undefined) throw new Error('Two recorders were started.');
		// It takes a while over its file.
		side.onSignal = {};
		recorder.release(SIDE);
		expect(seen.kept).toEqual([
			{ pid: main.pid, file: WINDOW_1, startedAt: 1_000_000 },
			{ pid: side.pid, file: WINDOW_2, startedAt: 1_000_000, stopped: true },
		]);
	});

	it('lets a recorder join for a window that opens, with a file of its own', async () => {
		const { clock, runner, recorder, seen, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		await clock.advance(60_000);
		const joinedAt = clock.now;
		expect(await recorder.add(THIRD)).toBe(true);
		const [main, side, later] = runner.of(NATIVE_RECORDER);
		if (later !== undefined) later.onSignal = { SIGINT: 0 };
		expect(later?.args).toEqual(['-v', '-x', '-o', '-l', '99', WINDOW_3]);
		// It began later, and the device keeps it by its own start.
		expect(joinedAt).toBeGreaterThan(1_060_000);
		expect(seen.kept).toEqual([
			{ pid: main?.pid, file: WINDOW_1, startedAt: 1_000_000 },
			{ pid: side?.pid, file: WINDOW_2, startedAt: 1_000_000 },
			{ pid: later?.pid, file: WINDOW_3, startedAt: joinedAt },
		]);
		// The folder is not looked at again: the recording already writes there.
		expect(runner.of(MAC_FOLDER_TEST)).toHaveLength(1);
		expect(await clock.drive(recorder.stop())).toEqual({ path: WINDOW_1, more: 2, error: null });
		expect(runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([['SIGINT'], ['SIGINT'], ['SIGINT']]);
		expect(seen.ended).toEqual([]);
	});

	it('joins nothing where no recording runs, or once a stop was asked', async () => {
		const idle = rig();
		expect(await idle.recorder.add(THIRD)).toBe(false);
		expect(idle.runner.runs).toHaveLength(0);

		const { clock, runner, recorder, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		for (const process of runner.of(NATIVE_RECORDER)) process.onSignal = {};
		const stopping = recorder.stop();
		expect(await recorder.add(THIRD)).toBe(false);
		expect(runner.of(NATIVE_RECORDER)).toHaveLength(2);
		for (const process of runner.of(NATIVE_RECORDER)) process.end(0);
		await clock.drive(stopping);
		expect(await recorder.add(THIRD)).toBe(false);
	});

	it('holds every recorder’s input open: one that waits there for a key would take its end for one', async () => {
		const { runner, recorder, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		expect(await recorder.add(THIRD)).toBe(true);
		expect(runner.of(NATIVE_RECORDER).map((process) => process.options.heldInput)).toEqual([true, true, true]);
		// The small programs around them are only asked a question, and find their input closed.
		expect(runner.of(MAC_FOLDER_TEST)[0]?.options.heldInput).toBeUndefined();
	});

	it('takes a window’s recorder that fails as that window’s file lost and no more', async () => {
		const { clock, runner, recorder, seen, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		expect(await recorder.add(THIRD)).toBe(true);
		const [, side, later] = runner.of(NATIVE_RECORDER);
		// A window the system would not film: its recorder goes at once, saying nothing.
		later?.end(1);
		await clock.settle();
		expect(seen.ended).toEqual([]);
		// And one the Mac ended by itself, with its file whole.
		side?.end(0);
		await clock.settle();
		expect(seen.ended).toEqual([]);
		expect(await clock.drive(recorder.stop())).toEqual({ path: WINDOW_1, more: 1, error: null });
	});

	it('begins all the same where a second window’s recorder goes at once', async () => {
		const { clock, runner, recorder, hooks } = rig();
		runner.onRun = (process) => {
			if (process.command !== NATIVE_RECORDER) return;
			if (process.args.includes('88')) {
				void Promise.resolve().then(() => {
					process.end(1);
				});
			} else process.onSignal = { SIGINT: 0 };
		};
		expect((await clock.drive(recorder.start(request({ takes: BOTH_WINDOWS }), hooks))).ok).toBe(true);
		expect(await clock.drive(recorder.stop())).toEqual({ path: WINDOW_1, error: null });
	});

	it('ends every window’s recorder when the main window’s goes by itself, and tells of it once', async () => {
		const { clock, runner, seen, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		const [main, side] = runner.of(NATIVE_RECORDER);
		main?.end(0);
		await clock.settle();
		expect(side?.signals).toEqual(['SIGINT']);
		expect(seen.ended).toEqual([{ reason: 'external', path: WINDOW_1, more: 1, error: null }]);
		expect(seen.kept).toBeNull();
	});

	it('never lets go of the main window’s recorder, nor of a screen’s', async () => {
		const windows = rig();
		await windows.begin({ takes: BOTH_WINDOWS });
		windows.recorder.release(MAIN);
		windows.recorder.release({ window: 'unknown' });
		expect(windows.runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([[], []]);

		const screens = rig();
		await screens.begin({ takes: BOTH_SCREENS });
		screens.recorder.release(SIDE);
		expect(screens.runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([[], []]);
	});

	it('interrupts a recorder that joined along with the rest when the plugin goes this instant', async () => {
		const { runner, recorder, begin } = rig();
		await begin({ takes: BOTH_WINDOWS });
		expect(await recorder.add(THIRD)).toBe(true);
		for (const process of runner.of(NATIVE_RECORDER)) process.onSignal = {};
		recorder.abandon();
		expect(runner.of(NATIVE_RECORDER).map((process) => process.signals)).toEqual([['SIGINT'], ['SIGINT'], ['SIGINT']]);
		expect(await recorder.add(THIRD)).toBe(false);
	});
});

describe('a recorder an earlier run left going', () => {
	const KEPT: NativeLedger = { pid: 4321, file: FILE, startedAt: 900_000 };

	/** The system's list and signaller, with one recorder that is still there until it is interrupted. */
	function leftover(options: { line?: string; endsOnInterrupt?: boolean; kept?: unknown } = {}) {
		const made = rig({ kept: options.kept ?? { ...KEPT } });
		const state = { alive: true };
		made.runner.played.set(MAC_PROCESS_LIST, (process) => {
			if (!state.alive) {
				process.end(1);
				return;
			}
			process.say('out', options.line ?? `  01:40 ${NATIVE_RECORDER} -v -x ${FILE}\n`);
			process.end(0);
		});
		made.runner.played.set(MAC_SIGNAL, (process) => {
			if (options.endsOnInterrupt !== false) state.alive = false;
			process.end(0);
		});
		return { ...made, state };
	}

	it('is ended with an interrupt, and its file named', async () => {
		const { clock, runner, recorder, seen } = leftover();
		expect(await clock.drive(recorder.mend())).toEqual({ path: FILE, more: 0 });
		expect(runner.of(MAC_PROCESS_LIST)[0]?.args).toEqual(['-ww', '-o', 'etime=,command=', '-p', '4321']);
		expect(runner.of(MAC_SIGNAL).map((run) => run.args)).toEqual([['-INT', '4321']]);
		expect(seen.kept).toBeNull();
	});

	it('is told from another program that only got its number', async () => {
		const { clock, runner, recorder, seen } = leftover({ line: '01:40 /Applications/Safari.app/Contents/MacOS/Safari\n' });
		expect(await clock.drive(recorder.mend())).toBeNull();
		expect(runner.of(MAC_SIGNAL)).toHaveLength(0);
		expect(seen.kept).toBeNull();
	});

	it('is told from a recorder of the same kind writing another file, begun at another time', async () => {
		const { clock, runner, recorder } = leftover({ line: `00:05 ${NATIVE_RECORDER} -v -x /Users/ada/Movies/Other.mov\n` });
		expect(await clock.drive(recorder.mend())).toBeNull();
		expect(runner.of(MAC_SIGNAL)).toHaveLength(0);
	});

	it('is known by the time it has run where the system spells its file’s name its own way', async () => {
		// Kept a hundred seconds ago, and the list says a hundred seconds.
		const { clock, runner, recorder } = leftover({
			line: `01:40 ${NATIVE_RECORDER} -v -x /Users/ada/Movies/M-iM^RM^_ 2026-11-19 14.30.05.mov\n`,
		});
		expect(await clock.drive(recorder.mend())).toEqual({ path: FILE, more: 0 });
		expect(runner.of(MAC_SIGNAL)).toHaveLength(1);
	});

	it('is let go of where it has gone by itself', async () => {
		const { clock, runner, recorder, seen, state } = leftover();
		state.alive = false;
		expect(await clock.drive(recorder.mend())).toBeNull();
		expect(runner.of(MAC_SIGNAL)).toHaveLength(0);
		expect(seen.kept).toBeNull();
	});

	it('is looked at again later where it is still moving its file, and is never sent a second stop', async () => {
		const { clock, runner, recorder, seen, state } = leftover({ endsOnInterrupt: false });
		expect(await clock.drive(recorder.mend())).toBeNull();
		expect(runner.of(MAC_SIGNAL)).toHaveLength(1);
		// What the device keeps says the stop was sent.
		expect(seen.kept).toEqual([{ ...KEPT, stopped: true }]);
		// The next look, before the next start, waits for it and sends nothing.
		expect(await clock.drive(recorder.mend())).toBeNull();
		expect(runner.of(MAC_SIGNAL)).toHaveLength(1);
		// Once it has put its file in place under a look, the file is named.
		const looking = recorder.mend();
		await clock.advance(1200);
		state.alive = false;
		expect(await clock.drive(looking)).toEqual({ path: FILE, more: 0 });
		expect(runner.of(MAC_SIGNAL)).toHaveLength(1);
		expect(seen.kept).toBeNull();
	});

	it('is sent no stop by the next plugin to load where the one that went had sent it', async () => {
		// As a plugin that was switched off, or a quitting Obsidian, left it: interrupted and still saving.
		const { clock, runner, recorder, seen, state } = leftover({
			endsOnInterrupt: false,
			kept: [{ ...KEPT, stopped: true }],
		});
		const looking = recorder.mend();
		await clock.advance(2200);
		state.alive = false;
		expect(await clock.drive(looking)).toEqual({ path: FILE, more: 0 });
		expect(runner.of(MAC_SIGNAL)).toHaveLength(0);
		expect(seen.kept).toBeNull();
	});

	it('sends its stop only to those of several that have not had it', async () => {
		const made = rig({
			kept: [
				{ pid: 4321, file: SCREEN_1, startedAt: 900_000, stopped: true },
				{ pid: 4322, file: SCREEN_2, startedAt: 900_000 },
			],
		});
		made.runner.played.set(MAC_PROCESS_LIST, (process) => {
			const pid = process.args[process.args.length - 1] ?? '';
			process.say('out', `01:40 ${NATIVE_RECORDER} -v -x -D ${pid === '4321' ? '1' : '2'} ${pid === '4321' ? SCREEN_1 : SCREEN_2}\n`);
			process.end(0);
		});
		made.runner.played.set(MAC_SIGNAL, (process) => {
			process.end(0);
		});
		expect(await made.clock.drive(made.recorder.mend())).toBeNull();
		expect(made.runner.of(MAC_SIGNAL).map((run) => run.args)).toEqual([['-INT', '4322']]);
		// Both are written down as stopped now.
		expect(made.seen.kept).toEqual([
			{ pid: 4321, file: SCREEN_1, startedAt: 900_000, stopped: true },
			{ pid: 4322, file: SCREEN_2, startedAt: 900_000, stopped: true },
		]);
	});

	it('are all ended where a recording of every screen was left, and told of as one', async () => {
		const made = rig({
			kept: [
				{ pid: 4321, file: SCREEN_1, startedAt: 900_000 },
				{ pid: 4322, file: SCREEN_2, startedAt: 900_000 },
			],
		});
		const alive = new Set(['4321', '4322']);
		made.runner.played.set(MAC_PROCESS_LIST, (process) => {
			const pid = process.args[process.args.length - 1] ?? '';
			if (!alive.has(pid)) {
				process.end(1);
				return;
			}
			process.say('out', `01:40 ${NATIVE_RECORDER} -v -x -D ${pid === '4321' ? '1' : '2'} ${pid === '4321' ? SCREEN_1 : SCREEN_2}\n`);
			process.end(0);
		});
		made.runner.played.set(MAC_SIGNAL, (process) => {
			alive.delete(process.args[process.args.length - 1] ?? '');
			process.end(0);
		});
		expect(await made.clock.drive(made.recorder.mend())).toEqual({ path: SCREEN_1, more: 1 });
		expect(made.runner.of(MAC_SIGNAL).map((run) => run.args)).toEqual([
			['-INT', '4321'],
			['-INT', '4322'],
		]);
		expect(made.seen.kept).toBeNull();
	});

	it('are told of by the ones still there, where one of them had gone already', async () => {
		const made = rig({
			kept: [
				{ pid: 4321, file: SCREEN_1, startedAt: 900_000 },
				{ pid: 4322, file: SCREEN_2, startedAt: 900_000 },
			],
		});
		let second = true;
		made.runner.played.set(MAC_PROCESS_LIST, (process) => {
			const pid = process.args[process.args.length - 1] ?? '';
			if (pid !== '4322' || !second) {
				process.end(1);
				return;
			}
			process.say('out', `01:40 ${NATIVE_RECORDER} -v -x -D 2 ${SCREEN_2}\n`);
			process.end(0);
		});
		made.runner.played.set(MAC_SIGNAL, (process) => {
			second = false;
			process.end(0);
		});
		expect(await made.clock.drive(made.recorder.mend())).toEqual({ path: SCREEN_2, more: 0 });
		expect(made.runner.of(MAC_SIGNAL).map((run) => run.args)).toEqual([['-INT', '4322']]);
	});

	it('is none where the device keeps nothing, or keeps something that is no recorder', async () => {
		for (const kept of [null, 'recorder', { pid: 1, file: FILE, startedAt: 1 }, { pid: 77, file: '', startedAt: 1 }]) {
			const { clock, runner, recorder } = rig({ kept });
			expect(await clock.drive(recorder.mend())).toBeNull();
			expect(runner.runs).toHaveLength(0);
		}
	});

	it('is never the recorder that runs now', async () => {
		const { clock, runner, recorder, begin } = rig();
		await begin();
		expect(await clock.drive(recorder.mend())).toBeNull();
		expect(runner.of(MAC_PROCESS_LIST)).toHaveLength(0);
		expect(runner.of(MAC_SIGNAL)).toHaveLength(0);
	});
});
