/**
 * How a workspace keeps step with the one file its work is kept in: the
 * read of it, the queue every change goes through, and the gate a paint
 * passes. The timeline and the beat sheet both lay a project's JSON document
 * out and write it one change at a time, and both must answer the same
 * questions the same way: whose read is in flight, what follows a change,
 * and whether what stands on screen is what was last read. Stated here once,
 * with no workspace to draw on, so the tests read it without a DOM.
 *
 * What was read is the workspace's own to hold, since it reads it everywhere;
 * the loop hands each reading over as it lands and asks for the document back
 * only to tell whether it moved.
 */

/**
 * What a change asks for once it is done: the document read again, the model
 * read again, a paint alone, or nothing at all, for a change that moves only
 * what the tab remembers and has already been shown.
 */
export type After = 'document' | 'model' | 'none' | 'nothing';

/** What the loop reads from: the bridge standing now. */
export interface DocumentSource<Reading> {
	read: () => Promise<Reading | null>;
	subscribe: (listener: () => void) => () => void;
}

export interface DocumentLoopDeps<Reading, Model> {
	/** The bridge for the project standing now; asked for afresh, since a rename hands the workspace a new one. */
	source: () => DocumentSource<Reading>;
	/** A reading as it lands, or none with the word that the read failed. */
	taken: (reading: Reading | null, failed: boolean) => void;
	/** Said once for a read that threw. */
	readFailed: (error: unknown) => void;
	/** The document last taken, by identity alone: what a paint is measured against. */
	held: () => unknown;
	/**
	 * Whether two documents lay out the same, for a workspace that can tell
	 * where identity cannot. A file written is a file parsed again, so every
	 * write brings back another object whatever it changed, and a change to
	 * what no paint is made from would lay the whole workspace out again for
	 * nothing. Asked only of a bell's read, and only once identity has said
	 * the document moved.
	 */
	alike?: (painted: unknown, held: unknown) => boolean;
	/** The model the view last loaded. */
	model: () => Model | null;
	/** Re-reads the project model; resolves once the workspace has been handed it. */
	refreshModel: () => Promise<void>;
	/** The laying out itself, from the model handed to it and the document last taken. */
	draw: (model: Model | null) => void;
	/** Whether a drag is in flight, while which every paint asked for waits. */
	dragging: () => boolean;
	disposed: () => boolean;
	notice: (error: unknown) => void;
}

export interface DocumentLoop {
	/**
	 * Reads the document again and paints. A request made while a read is in
	 * flight joins it and is answered by one more pass after it, so a change
	 * that awaits its read gets the document as it stands after the write,
	 * even when the plugin's bell had already set a read going.
	 */
	reload: (maySkipPaint?: boolean) => Promise<void>;
	/**
	 * Every change the workspace makes, one after another, each followed by
	 * what it asked for: a read of the document, a read of the model, or a
	 * paint alone -- asked as a value, or as a question answered once the
	 * change is done, for a form that may or may not have saved. A change
	 * queued before the workspace went still lands.
	 */
	enqueue: (action: () => Promise<void>, after?: After | (() => After)) => Promise<void>;
	/** Lays the workspace out again, unless a drag is in flight, which owes it one. */
	paint: () => void;
	/** The paint a drag held back, made now that the drag has ended. */
	paintOwed: () => void;
	/** Stops hearing the bridge. */
	release: () => void;
}

export function createDocumentLoop<Reading, Model>(
	deps: DocumentLoopDeps<Reading, Model>,
): DocumentLoop {
	let boundSource: DocumentSource<Reading> | null = null;
	let unsubscribe: (() => void) | null = null;
	/** The read in flight, which a second request joins rather than starting another. */
	let reloadRun: Promise<void> | null = null;
	let reloadPending = false;
	let queue: Promise<void> = Promise.resolve();
	/** The document and the model the last paint was made from. */
	let paintedHeld: unknown = null;
	let paintedModel: Model | null = null;
	/**
	 * Whether that paint ran to its end. One that threw partway is owed another
	 * whatever the document and the model say, since what stands on screen is
	 * half made and the pair it was made from cannot say so.
	 */
	let paintFinished = false;
	/** Whether the paint after the read in flight was asked for by the workspace itself. */
	let paintDemanded = false;
	let owed = false;

	/** Hears the bridge standing now; a project rename hands the workspace a new one. */
	const bind = (source: DocumentSource<Reading>): void => {
		if (source === boundSource) return;
		unsubscribe?.();
		boundSource = source;
		unsubscribe = source.subscribe(() => {
			void reload(true);
		});
	};

	const paint = (): void => {
		if (deps.disposed()) return;
		if (deps.dragging()) {
			owed = true;
			return;
		}
		const nextHeld = deps.held();
		const nextModel = deps.model();
		paintFinished = false;
		deps.draw(nextModel);
		// What this paint was made from, marked once it is made. The empty
		// states leave by their own way out and are made all the same; a paint
		// that threw partway marks nothing, so the bell after it lays the
		// workspace out again rather than taking the failed paint for what
		// stands on screen.
		paintedHeld = nextHeld;
		paintedModel = nextModel;
		paintFinished = true;
	};

	const reload = (maySkipPaint = false): Promise<void> => {
		if (deps.disposed()) return Promise.resolve();
		// A read the workspace asked for paints whatever comes back: what moved
		// may be the workspace's own, a draft kept or a label dressed again from
		// the file, which neither the document nor the model knows anything of.
		// Only the bell, which rings for every write including this workspace's,
		// may go quiet when the read brings back what is already shown.
		if (!maySkipPaint) paintDemanded = true;
		if (reloadRun !== null) {
			reloadPending = true;
			return reloadRun;
		}
		// A run that ends before its first wait has been and gone by the time
		// the line that starts it is done, its own tidying with it. Kept all
		// the same, it would be the read in flight for good, and every later
		// request would join a read that is over and never read again.
		let over = false;
		const run = (async () => {
			try {
				do {
					reloadPending = false;
					try {
						// The bridge is asked for and heard inside the guard: one that
						// cannot be had is a read that failed, said as one is.
						const source = deps.source();
						bind(source);
						deps.taken(await source.read(), false);
					} catch (error) {
						deps.taken(null, true);
						deps.readFailed(error);
					}
					if (deps.disposed()) return;
				} while (reloadPending);
			} finally {
				over = true;
				reloadRun = null;
			}
			// A bell bringing back the very document and model the last paint was
			// made from has nothing to show. It rings a quarter second after
			// every write the workspace makes itself, so without this the whole
			// workspace, the pool with it, is painted twice for one change. A
			// paint that never finished is owed another all the same: the pair
			// it was made from says nothing about how far it got.
			const held = deps.held();
			let documentMoved = held !== paintedHeld;
			if (documentMoved && paintFinished && deps.alike?.(paintedHeld, held) === true) {
				// Another object that lays out as the painted one does is the
				// painted one from here on, and the next bell is measured against it.
				paintedHeld = held;
				documentMoved = false;
			}
			const moved = !paintFinished || documentMoved || deps.model() !== paintedModel;
			if (paintDemanded || moved) {
				paintDemanded = false;
				paint();
			}
		})();
		if (!over) reloadRun = run;
		return run;
	};

	const enqueue = (action: () => Promise<void>, after: After | (() => After) = 'document'): Promise<void> => {
		const run = queue.then(async () => {
			try {
				await action();
			} catch (error) {
				if (!deps.disposed()) deps.notice(error);
			}
			if (deps.disposed()) return;
			// What follows the change is guarded as the change is. A paint that
			// throws would else reject this promise, and the callers waiting on
			// it would never do their own tidying: an optimistic row would stand
			// for good, and words on their way would be counted as sent and
			// never written again.
			try {
				const then = typeof after === 'function' ? after() : after;
				if (then === 'document') await reload();
				else if (then === 'model') await deps.refreshModel();
				else if (then === 'none') paint();
			} catch (error) {
				if (!deps.disposed()) deps.notice(error);
			}
		});
		queue = run.catch(() => undefined);
		return run;
	};

	return {
		reload,
		enqueue,
		paint,
		paintOwed: () => {
			if (!owed) return;
			owed = false;
			paint();
		},
		release: () => {
			unsubscribe?.();
			unsubscribe = null;
		},
	};
}
