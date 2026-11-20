import { describe, expect, it } from 'vitest';

import {
	QUIT_HOLD_MS,
	holdQuit,
	writeUnderWay,
	writesUnderWay,
	type QuitTasks,
} from '../../src/ui/pending-writes';

/** A promise with its ends in the test's hands. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
	let resolve = (_value: T): void => undefined;
	let reject = (_reason: unknown): void => undefined;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Lets every promise reaction already queued run, without letting a timer fire. */
async function microtasks(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/** A clock whose timers fire only when the test says so. */
function manualTimers() {
	const waiting: { handler: () => void; ms: number }[] = [];
	return {
		waiting,
		setTimeout(handler: () => void, ms: number): number {
			waiting.push({ handler, ms });
			return waiting.length;
		},
		/** Fires every timer set for at most `ms`, in the order they were set. */
		fire(ms: number): void {
			for (const timer of waiting.splice(0).filter((entry) => {
				if (entry.ms <= ms) return true;
				waiting.push(entry);
				return false;
			})) {
				timer.handler();
			}
		},
	};
}

/** The app's task list as its quit hook reads it. */
function quitTasks() {
	const promises: Promise<unknown>[] = [];
	const tasks: QuitTasks = {
		add: (callback) => {
			promises.push(callback());
		},
	};
	return { tasks, promises };
}

describe('the writes on their way', () => {
	it('names none while none is noted, and waits for each until it lands or fails', async () => {
		expect(writesUnderWay()).toBeNull();
		const landing = deferred();
		const failing = deferred();
		const noted = writeUnderWay(landing.promise);
		expect(noted).toBe(landing.promise);
		const refused = writeUnderWay(failing.promise);
		refused.catch(() => undefined);
		const all = writesUnderWay();
		expect(all).not.toBeNull();
		let over = false;
		void all?.then(() => {
			over = true;
		});
		landing.resolve();
		await microtasks();
		expect(over).toBe(false);
		// A failed write is over too, and the wait for it never rejects.
		failing.reject(new Error('refused'));
		await all;
		expect(over).toBe(true);
		expect(writesUnderWay()).toBeNull();
	});
});

describe('holding the app’s quit', () => {
	it('adds no task where there is nothing to wait for', () => {
		const { tasks, promises } = quitTasks();
		holdQuit(tasks, null, manualTimers());
		// A task of any kind is what brings the saving screen up.
		expect(promises).toHaveLength(0);
	});

	it('settles on a timer after the work, never in the turn it was added in', async () => {
		const { tasks, promises } = quitTasks();
		const timers = manualTimers();
		// Work that is done already is the case that held every quit three seconds.
		holdQuit(tasks, Promise.resolve(), timers);
		expect(promises).toHaveLength(1);
		let settled = false;
		void promises[0]?.then(() => {
			settled = true;
		});
		await microtasks();
		expect(settled).toBe(false);
		expect(timers.waiting.some((timer) => timer.ms === 0)).toBe(true);
		timers.fire(0);
		await microtasks();
		expect(settled).toBe(true);
	});

	it('waits for work still under way, then one timer more', async () => {
		const { tasks, promises } = quitTasks();
		const timers = manualTimers();
		const work = deferred();
		holdQuit(tasks, work.promise, timers);
		let settled = false;
		void promises[0]?.then(() => {
			settled = true;
		});
		timers.fire(0);
		await microtasks();
		expect(settled).toBe(false);
		work.resolve();
		await microtasks();
		expect(settled).toBe(false);
		timers.fire(0);
		await microtasks();
		expect(settled).toBe(true);
	});

	it('is held for work that fails exactly as for work that lands', async () => {
		const { tasks, promises } = quitTasks();
		const timers = manualTimers();
		holdQuit(tasks, Promise.reject(new Error('no')), timers);
		await microtasks();
		timers.fire(0);
		await expect(promises[0]).resolves.toBeUndefined();
	});

	it('lets the quit go when the hold runs out, whatever the work is doing', async () => {
		const { tasks, promises } = quitTasks();
		const timers = manualTimers();
		const stuck = deferred();
		holdQuit(tasks, stuck.promise, timers);
		let settled = false;
		void promises[0]?.then(() => {
			settled = true;
		});
		timers.fire(QUIT_HOLD_MS - 1);
		await microtasks();
		expect(settled).toBe(false);
		timers.fire(QUIT_HOLD_MS);
		await microtasks();
		expect(settled).toBe(true);
		// The hold ends before the app's own three seconds do.
		expect(QUIT_HOLD_MS).toBeLessThan(3000);
		// Work landing afterwards changes nothing.
		stuck.resolve();
		await microtasks();
		timers.fire(0);
		await expect(promises[0]).resolves.toBeUndefined();
	});
});
