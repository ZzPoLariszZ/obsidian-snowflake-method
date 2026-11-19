import type {
	RecordingEndReason,
	RecordingErrorCode,
	RecordingNoticeCode,
} from '../domain';

/**
 * What the recording service asks of a recorder, the Mac's own or OBS, and
 * what a recorder tells it back. The service keeps the one recording's
 * state; a recorder knows how its program is started, stopped and left.
 */

/** A clock handed in, so a test turns it by hand and nothing waits on the wall. */
export interface RecordingTimers {
	set(handler: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

/** What a recorder says while it works, unasked. */
export interface RecorderHooks {
	/** The recorder's program is being opened, or the recording is being asked for. */
	phase(phase: 'opening' | 'starting'): void;
	/** True once the author gave this start up. */
	cancelled(): boolean;
	/**
	 * Everything is ready, and nothing records yet: the author is counted
	 * in here, and may give the start up while the count runs. True where
	 * the count ran out and the recording is to begin, false where the
	 * start was given up.
	 */
	hold(): Promise<boolean>;
	/** How large the file has grown, where the recorder can say. */
	bytes(bytes: number): void;
	notice(code: RecordingNoticeCode): void;
	/** The recording ended without the plugin asking: stopped elsewhere, or lost. */
	ended(end: RecorderEnd): void;
}

export interface RecorderEnd {
	reason: RecordingEndReason;
	/** The file, where the recorder knows it. */
	path: string | null;
	/** How many more files the recording left beside that one: a file for each further screen. */
	more?: number;
	error: RecordingErrorCode | null;
}

/** A start that took, or why it did not. `cancelled` is the author's own doing and no error. */
export type RecorderStart =
	| { ok: true; startedAt: number; path: string | null; more?: number }
	| { ok: false; code: RecordingErrorCode | 'cancelled'; detail: string | null };

export interface RecorderStop {
	/** The file, where the recording was kept and the recorder knows it. */
	path: string | null;
	/** How many more files the recording left beside that one. */
	more?: number;
	/** Why the recording was not kept, where it was not. */
	error: RecordingErrorCode | null;
}

/** Resolves after a while on the clock handed in. */
export function waitOn(timers: RecordingTimers, ms: number): Promise<void> {
	return new Promise((resolve) => {
		timers.set(resolve, ms);
	});
}

/**
 * What a promise settles with, or null where it has not within a while.
 * The clock is let go of as soon as the promise settles, so a long wait
 * that was not needed leaves nothing turning.
 */
export function within<T>(timers: RecordingTimers, promise: Promise<T>, ms: number): Promise<T | null> {
	return new Promise((resolve) => {
		const timer = timers.set(() => {
			resolve(null);
		}, ms);
		void promise.then((value) => {
			timers.clear(timer);
			resolve(value);
		});
	});
}
