import { ApiError } from './errors';

/**
 * The calls taken one at a time, in the order they came.
 *
 * A caller that reads while another writes would otherwise see half of it:
 * a note split is one note made and another cut, and a list read between
 * the two has the same words twice. Two notes made in the same moment would
 * be given the same place in their list. The services were written for one
 * author at one keyboard, and here they are still given one thing to do at
 * a time.
 *
 * It waits on nothing but the call before. There is no clock in it: a
 * hidden window's timers crawl, and a call that waited on one would crawl
 * with them.
 */
export class OperationQueue {
	private tail: Promise<void> = Promise.resolve();
	private standing = 0;

	constructor(private readonly depth: number) {}

	/** How many calls stand here, the one being answered among them. */
	get size(): number {
		return this.standing;
	}

	/**
	 * Runs the work when every call before it is done, whether those ended
	 * well or not. A caller that finds the line too long is told so at once
	 * rather than left to wait behind it.
	 */
	run<T>(work: () => Promise<T>): Promise<T> {
		if (this.standing >= this.depth) {
			return Promise.reject(new ApiError('busy', 'Too many calls are waiting. Ask again in a moment.'));
		}
		this.standing += 1;
		const answer = this.tail.then(work);
		const leave = (): void => {
			this.standing -= 1;
		};
		this.tail = answer.then(leave, leave);
		return answer;
	}
}
