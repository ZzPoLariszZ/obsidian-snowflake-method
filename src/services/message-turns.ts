/**
 * Turns of the event loop that are taken at once, whether or not the window
 * can be seen.
 *
 * A walk over a manuscript gives way between stretches of work, so the app
 * stays alive under it. It gives way on a clock of no delay, and a window
 * out of sight is given its clock late: a little late at first, and a
 * second and then a minute apart the longer it stays hidden. A walk begun
 * there would take minutes over what takes a moment, and one is begun there
 * whenever the local API is asked for statistics while Obsidian sits behind
 * another app. A message a window posts to itself is never held back.
 */
export interface MessageTurns {
	/** Runs the handler on a later turn, after everything already waiting for one. */
	take(handler: () => void): void;
	/** Lets the channel go. Whatever was still waiting is dropped. */
	close(): void;
}

export function createMessageTurns(): MessageTurns {
	const waiting: (() => void)[] = [];
	const channel = new MessageChannel();
	// One message for each handler, so one that throws does not take the turns of those behind it.
	channel.port1.onmessage = (): void => {
		waiting.shift()?.();
	};
	return {
		take: (handler) => {
			waiting.push(handler);
			channel.port2.postMessage(null);
		},
		close: () => {
			waiting.length = 0;
			channel.port1.close();
			channel.port2.close();
		},
	};
}

/** What a wait is made of: the window's clock, and a turn that needs none. */
export interface SeenPauseDeps {
	/** Whether the window is out of sight at this moment. */
	hidden: () => boolean;
	/** The window's own clock. */
	set: (handler: () => void, ms: number) => unknown;
	/** A turn taken at once, whether or not the window can be seen. */
	turn: (handler: () => void) => void;
}

/**
 * A wait that is kept only while the window can be seen.
 *
 * The local API makes a caller that sent a wrong token wait a moment for
 * its answer, so that guessing is slow. The wait is on the window's clock,
 * and a window out of sight is handed its clock late: by a second at
 * first, and by a minute once it has been hidden a while. A caller that
 * only held an old token would wait that long to be told so, and one more
 * than a handful of them would get no answer at all. So out of sight the
 * wait is given up, and the answer goes on the next turn. Nothing is lost
 * by it that matters: what keeps a guesser out is the length of the token,
 * and no wait adds to that.
 */
export function pauseWhileSeen(deps: SeenPauseDeps): (ms: number) => Promise<void> {
	return (ms) =>
		new Promise((resolve) => {
			if (deps.hidden()) deps.turn(resolve);
			else deps.set(resolve, ms);
		});
}
