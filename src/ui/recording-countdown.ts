import type { Translate } from './modals';

/**
 * The count before a recording begins: three, two, one, in the middle of
 * the window, so the author knows the moment the recording starts and has
 * that long to give it up. It is shown over the window and takes nothing
 * from it but Escape: the author can still click and type under it, to
 * put the page as it should be seen first.
 */

export const RECORDING_COUNTDOWN_CLASS = 'snowflake-method-recording-countdown';
/** Where the count begins. */
export const RECORDING_COUNT_FROM = 3;
export const RECORDING_COUNT_STEP_MS = 1000;
/** How long the window is given to draw itself without the count, so the count is in no picture of the recording. */
export const RECORDING_COUNT_CLEAR_MS = 100;

export interface RecordingCountdownDeps {
	/** Where the count is shown: the body of the window in use. */
	host: HTMLElement;
	t: Translate;
	timers: { set(handler: () => void, ms: number): unknown; clear(handle: unknown): void };
	/** Takes the keyboard's Escape for the length of the count, and gives back the way to let go of it. */
	onEscape(handler: () => void): () => void;
}

/**
 * Starts the count. `done` answers true once it has run out and the window
 * has drawn itself without it, and false where the author pressed Escape
 * or the count was cancelled from outside.
 */
export function countRecordingIn(deps: RecordingCountdownDeps): { done: Promise<boolean>; cancel(): void } {
	// Read aloud as it changes: a count that is only seen would start a recording unannounced.
	const face = deps.host.createDiv({
		cls: RECORDING_COUNTDOWN_CLASS,
		attr: { role: 'status', 'aria-live': 'assertive' },
	});
	const number = face.createDiv({ cls: `${RECORDING_COUNTDOWN_CLASS}-number` });
	face.createDiv({ cls: `${RECORDING_COUNTDOWN_CLASS}-hint`, text: deps.t('recording.countdown.hint') });
	let left = RECORDING_COUNT_FROM;
	let timer: unknown = null;
	let settled = false;
	let release = (): void => {};
	let answer: (ran: boolean) => void = () => {};
	const done = new Promise<boolean>((resolve) => {
		answer = resolve;
	});
	const end = (ran: boolean): void => {
		if (settled) return;
		settled = true;
		deps.timers.clear(timer);
		release();
		face.remove();
		if (!ran) {
			answer(false);
			return;
		}
		deps.timers.set(() => {
			answer(true);
		}, RECORDING_COUNT_CLEAR_MS);
	};
	const tick = (): void => {
		left -= 1;
		if (left <= 0) {
			end(true);
			return;
		}
		number.setText(String(left));
		timer = deps.timers.set(tick, RECORDING_COUNT_STEP_MS);
	};
	release = deps.onEscape(() => {
		end(false);
	});
	number.setText(String(left));
	timer = deps.timers.set(tick, RECORDING_COUNT_STEP_MS);
	return {
		done,
		cancel: () => {
			end(false);
		},
	};
}
