/**
 * The writes on their way that nobody is waiting for, and the hold a quit
 * keeps on the app until they have landed.
 *
 * A board sends a change to the vault and goes on: the row is drawn already,
 * and the write lands a moment later behind a queue. That is right while
 * the app stays, and it is how a change was lost when the app left: Obsidian
 * gives a closing window three seconds, measured on 1.15, and then takes it
 * away whatever is still being written. So each such write is noted here
 * from the moment it is queued until it lands, and a quit can wait for
 * exactly those and nothing else.
 */

const underway = new Set<Promise<unknown>>();

/**
 * Notes a write on its way until it lands or fails, and hands the same
 * promise back, so the call sits around a write without changing what its
 * caller is given.
 */
export function writeUnderWay<T>(run: Promise<T>): Promise<T> {
	underway.add(run);
	const landed = (): void => {
		underway.delete(run);
	};
	run.then(landed, landed);
	return run;
}

/**
 * Every noted write that has not landed, as one promise that never rejects.
 * Null where there is none, so that a caller with nothing to wait for can
 * tell, without a turn of the event loop to find out.
 */
export function writesUnderWay(): Promise<void> | null {
	if (underway.size === 0) return null;
	return Promise.allSettled([...underway]).then(() => undefined);
}

/** What the app hands a `quit` listener: the one method used here. */
export interface QuitTasks {
	add(callback: () => Promise<unknown>): void;
}

/** A clock a wait can be put on: a window's, or a test's. */
export interface QuitTimers {
	setTimeout(handler: () => void, ms: number): unknown;
}

/**
 * How long a quit is held at most. The app destroys the window three
 * seconds after it was asked to close, with no word to the page, so a hold
 * that ends a little sooner lets the window close in the ordinary way.
 */
export const QUIT_HOLD_MS = 2500;

/**
 * Holds the app's quit for `work`, and for nothing where there is none.
 *
 * Both halves matter. The app shows its saving screen whenever a listener
 * adds a task at all, so a quit with nothing to save must add none. And it
 * closes the window the moment the tasks settle, from inside the same turn
 * of the event loop if they settled there, where the window ignores the
 * request: it then sits on the saving screen until the three-second
 * fallback destroys it. Measured on 1.15, a task that settles at once holds
 * the quit for 3.0 s, and one that settles a timer's turn later for 0.2 s.
 * So the task added here settles on a timer, never in the turn it was
 * added in, and no later than the hold allows.
 */
export function holdQuit(
	tasks: QuitTasks,
	work: Promise<unknown> | null,
	timers: QuitTimers,
): void {
	if (work === null) return;
	tasks.add(
		() =>
			new Promise<void>((resolve) => {
				let over = false;
				const end = (): void => {
					if (over) return;
					over = true;
					resolve();
				};
				const landed = (): void => {
					timers.setTimeout(end, 0);
				};
				work.then(landed, landed);
				timers.setTimeout(end, QUIT_HOLD_MS);
			}),
	);
}
