/**
 * A clock a test turns by hand, handed to a service in place of the
 * window's timers: nothing falls due until the test says how much time has
 * gone, and what falls due fires in order.
 */
export class FakeClock {
	now = 1_000_000;
	private next = 1;
	private readonly due = new Map<number, { at: number; handler: () => void }>();

	readonly timers = {
		set: (handler: () => void, ms: number): unknown => {
			const id = this.next;
			this.next += 1;
			this.due.set(id, { at: this.now + ms, handler });
			return id;
		},
		clear: (handle: unknown): void => {
			if (typeof handle === 'number') this.due.delete(handle);
		},
	};

	/** How many timers still wait. */
	get waiting(): number {
		return this.due.size;
	}

	/** Lets everything already resolved run its course: promise chains, and a digest worked off the thread. */
	async settle(): Promise<void> {
		for (let turn = 0; turn < 3; turn += 1) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});
		}
	}

	/** Turns the clock forward, firing what falls due on the way, earliest first. */
	async advance(ms: number): Promise<void> {
		const end = this.now + ms;
		for (;;) {
			await this.settle();
			let chosen: number | null = null;
			let chosenAt = Number.POSITIVE_INFINITY;
			for (const [id, entry] of this.due) {
				if (entry.at <= end && entry.at < chosenAt) {
					chosen = id;
					chosenAt = entry.at;
				}
			}
			if (chosen === null) break;
			const entry = this.due.get(chosen);
			this.due.delete(chosen);
			if (entry === undefined) continue;
			this.now = Math.max(this.now, entry.at);
			entry.handler();
		}
		this.now = end;
		await this.settle();
	}

	/** Turns the clock until a promise settles, and hands back what it settled with. */
	async drive<T>(promise: Promise<T>, stepMs = 500, turns = 600): Promise<T> {
		let state: { done: false } | { done: true; value: T } | { done: true; error: unknown } = { done: false };
		promise.then(
			(value) => {
				state = { done: true, value };
			},
			(error: unknown) => {
				state = { done: true, error };
			},
		);
		for (let turn = 0; turn < turns; turn += 1) {
			await this.settle();
			const now = state as { done: false } | { done: true; value: T } | { done: true; error: unknown };
			if (now.done) {
				if ('error' in now) throw now.error;
				return now.value;
			}
			await this.advance(stepMs);
		}
		throw new Error('The promise never settled.');
	}
}
