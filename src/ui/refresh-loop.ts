/**
 * The read-and-paint loop every panel that reads a bridge runs: one read at
 * a time, a refresh asked for during a read replayed once it lands -- after a
 * failure too, since a queued refresh still deserves its turn -- and nothing
 * painted into a panel that has been disposed. Three panels each carried a
 * copy of this, and a rule about concurrency is the kind a copy gets subtly
 * wrong.
 */

export interface RefreshLoop {
	/** Reads again, or queues one read behind the read under way. */
	refresh(): void;
	/** Stops every later paint; a read still under way lands nowhere. */
	dispose(): void;
	/** A read is under way. */
	readonly loading: boolean;
	/** The last read failed, and nothing has landed since. */
	readonly failed: boolean;
	readonly disposed: boolean;
}

export function refreshLoop<T>(options: {
	read(): Promise<T>;
	/** Before a read begins -- a panel with nothing standing says so. */
	onStart?(): void;
	onRead(next: T): void;
	/** After a read failed and no refresh was queued behind it. */
	onFail(): void;
}): RefreshLoop {
	let disposed = false;
	let loading = false;
	let failed = false;
	let refreshAgain = false;
	const refresh = (): void => {
		if (disposed) return;
		if (loading) {
			refreshAgain = true;
			return;
		}
		loading = true;
		options.onStart?.();
		void options
			.read()
			.then((next) => {
				loading = false;
				failed = false;
				if (disposed) return;
				options.onRead(next);
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
				}
			})
			.catch(() => {
				loading = false;
				failed = true;
				if (disposed) return;
				if (refreshAgain) {
					refreshAgain = false;
					refresh();
					return;
				}
				options.onFail();
			});
	};
	return {
		refresh,
		dispose: () => {
			disposed = true;
		},
		get loading() {
			return loading;
		},
		get failed() {
			return failed;
		},
		get disposed() {
			return disposed;
		},
	};
}
