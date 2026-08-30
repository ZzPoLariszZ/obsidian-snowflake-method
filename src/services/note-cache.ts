import type { ProjectRef } from "./types";

/** Time-paced yielding, the seed walk's rule: a warm pass crosses thousands
 *  of notes per breath, a cold one a handful, and the app stays alive. */
export const BREATH_MS = 12;
/** How long a recompute may sit in memory before its file hears of it. */
export const FLUSH_QUIET_MS = 5_000;

export interface NoteCacheTimers {
	set: (handler: () => void, ms: number) => unknown;
	clear: (handle: unknown) => void;
}

/** What every per-note cache state carries, whatever its records hold. */
export interface NoteCacheState<TNote> {
	project: ProjectRef;
	/**
	 * Resolves when this device's persisted file has been folded in. A
	 * second caller arriving mid-load awaits it, so no walk ever runs
	 * against a state the file has not reached.
	 */
	hydrated: Promise<void>;
	dirty: boolean;
	notes: Map<string, TNote>;
}

/**
 * The breathing walk's shared machinery: per-project states, one quiet-flush
 * timer over a queue, `forget` wired where the vault's deletes and renames
 * are told, and unload's `dispose`. Two caches keep this rhythm -- the
 * mention index and the manuscript analysis -- and they keep it here rather
 * than in step by hand, so a pacing or flush fix lands once. The subclass
 * owns what a note record holds, how it is computed, and which file
 * `persist` writes.
 */
export abstract class QuietFlushingNoteCache<
	TNote,
	TState extends NoteCacheState<TNote>,
> {
	protected readonly states = new Map<string, TState>();
	private readonly flushQueue = new Set<string>();
	private flushHandle: unknown = null;

	constructor(protected readonly timers: NoteCacheTimers | null) {}

	/** Writes one project's state to its own file. */
	protected abstract persist(state: TState): Promise<void>;

	/**
	 * Told whenever this machinery drops one note record from a state, so a
	 * subclass keeping derived memos over the records can let them go.
	 */
	protected noteForgotten(_state: TState): void {
		// Nothing by default.
	}

	/** The mirror of every other per-note cache's `forget`. */
	forget(path: string, { children = false } = {}): void {
		for (const [rootPath, state] of this.states) {
			if (
				children &&
				(rootPath === path || rootPath.startsWith(`${path}/`))
			) {
				// The project itself is gone or moving: the state goes whole,
				// and any pending flush dies with it -- a write now would
				// rebuild the dead root's folders around a fresh cache file.
				this.states.delete(rootPath);
				this.flushQueue.delete(rootPath);
				this.clearFlushTimerIfIdle();
				continue;
			}
			if (state.notes.delete(path)) {
				this.noteForgotten(state);
				this.markDirty(state);
			}
			if (!children) continue;
			const prefix = `${path}/`;
			for (const key of state.notes.keys()) {
				if (!key.startsWith(prefix)) continue;
				state.notes.delete(key);
				this.noteForgotten(state);
				this.markDirty(state);
			}
		}
	}

	/**
	 * Unload's hand: stops the quiet-flush timer so nothing writes into the
	 * vault after the plugin is gone. Dirty records are simply dropped -- a
	 * cache recomputes -- because a late write racing the next plugin
	 * version over one file is worse than a cold start.
	 */
	dispose(): void {
		if (this.flushHandle !== null && this.timers !== null) {
			this.timers.clear(this.flushHandle);
		}
		this.flushHandle = null;
		this.flushQueue.clear();
	}

	/** Writes what this project's state holds, when anything changed. */
	async flush(project: ProjectRef): Promise<void> {
		const state = this.states.get(project.rootPath);
		if (state === undefined || !state.dirty) {
			// A queued entry whose state is gone or already clean would
			// otherwise sit in the queue forever.
			this.flushQueue.delete(project.rootPath);
			this.clearFlushTimerIfIdle();
			return;
		}
		// Cleared before the write, so a change landing mid-write re-marks
		// and the next pass carries it.
		state.dirty = false;
		this.flushQueue.delete(project.rootPath);
		this.clearFlushTimerIfIdle();
		try {
			await this.persist(state);
		} catch (error) {
			// A failed write owes a retry: dirty again, the quiet timer
			// re-armed, and the computed records never silently lost.
			this.markDirty(state);
			throw error;
		}
	}

	protected markDirty(state: TState): void {
		state.dirty = true;
		this.flushQueue.add(state.project.rootPath);
		if (this.timers === null || this.flushHandle !== null) return;
		this.flushHandle = this.timers.set(() => {
			this.flushHandle = null;
			for (const rootPath of [...this.flushQueue]) {
				const queued = this.states.get(rootPath);
				if (queued === undefined) {
					this.flushQueue.delete(rootPath);
					continue;
				}
				// A failed write re-marked itself dirty, so the next quiet
				// pass retries; the rejection ends here rather than escaping
				// a timer nobody awaits.
				void this.flush(queued.project).catch(() => undefined);
			}
		}, FLUSH_QUIET_MS);
	}

	/** A macrotask's worth of air, so a cold walk never freezes the app. */
	protected breathe(): Promise<void> {
		const timers = this.timers;
		if (timers === null) return Promise.resolve();
		return new Promise((resolve) => {
			timers.set(() => {
				resolve();
			}, 0);
		});
	}

	private clearFlushTimerIfIdle(): void {
		if (
			this.flushQueue.size === 0 &&
			this.flushHandle !== null &&
			this.timers !== null
		) {
			this.timers.clear(this.flushHandle);
			this.flushHandle = null;
		}
	}
}
