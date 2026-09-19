/**
 * The bell a project document rings for the workspaces that lay it out: who
 * listens, the ring itself, and the quiet moment a burst of vault events is
 * let settle in before one ring answers all of them. The tasks, the
 * timelines and the beat sheets each keep one, and each must answer the same
 * questions the same way, so it is stated here once, with no plugin to draw
 * on, and the tests read it without one.
 */

export interface DocumentBellDeps {
	/** The clock the quiet moment is kept on: the main window's, which outlives every pop-out. */
	clock: () => Pick<Window, 'setTimeout' | 'clearTimeout'>;
	/** How long a burst is let settle, in milliseconds. */
	delay: number;
	/** Said for a listener that threw: a listener's failure is its own, and the rest still hear. */
	failed: (error: unknown) => void;
	/** What follows a ring that was owed it: the dashboards reading their health again. */
	reconcile: () => void;
}

export class DocumentBell {
	private readonly listeners = new Set<() => void>();
	private timer: number | null = null;
	/** Whether the ring in waiting owes a reconcile; owed by any call of the burst, it is owed by the ring. */
	private owesReconcile = false;

	constructor(private readonly deps: DocumentBellDeps) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** The document changed; everyone listening reads again, now. */
	ring(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				this.deps.failed(error);
			}
		}
	}

	/**
	 * The document changed in the vault; everyone reads again once the burst
	 * has settled. Whether the dashboards reconcile their health with it is
	 * the caller's to say, and only a caller that saw the file itself come or
	 * go says yes: the verdict turns on the folder standing, which no write to
	 * a file already in it can move, while reconciling asks every dashboard
	 * shown to build its whole model again. A later call of the same burst
	 * that asks for none does not take back one already owed.
	 */
	schedule(reconcile = false): void {
		const clock = this.deps.clock();
		if (this.timer !== null) clock.clearTimeout(this.timer);
		this.owesReconcile ||= reconcile;
		this.timer = clock.setTimeout(() => {
			this.timer = null;
			const owed = this.owesReconcile;
			this.owesReconcile = false;
			this.ring();
			if (owed) this.deps.reconcile();
		}, this.deps.delay);
	}

	/** Lets the ring in waiting go, for a plugin on its way out. */
	dispose(): void {
		if (this.timer !== null) this.deps.clock().clearTimeout(this.timer);
		this.timer = null;
		this.owesReconcile = false;
	}
}
