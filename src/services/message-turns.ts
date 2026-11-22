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
