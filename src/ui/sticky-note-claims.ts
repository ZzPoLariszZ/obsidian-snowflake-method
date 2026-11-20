/**
 * Who is editing which sticky note. The same note stands on three surfaces
 * at once -- the dashboard, the sidebar, a floating panel -- and only one of
 * them may hold an editor for it at a time, or two authors' worth of typing
 * would race into one file. A surface claims a note before it mounts an
 * editor; the surface holding it is asked to flush and step down first; and
 * the claims of one note run strictly one after another, so a third surface
 * asking mid-transfer waits its turn rather than slipping in beside the
 * second. Nothing here knows what a surface is: an owner is an id and a way
 * to ask it to let go.
 */

export interface StickyNoteEditOwner {
	id: string;
	/**
	 * Flushes what the owner holds and drops it to Viewing. Called by the
	 * registry on the owner's behalf when the note passes to someone else;
	 * an owner leaving of its own accord calls `release` instead.
	 */
	release(): Promise<void>;
	/**
	 * Writes what the owner holds and leaves it editing: null where it holds
	 * nothing the file lacks. Asked when the app quits or goes out of sight,
	 * where the editor's own quiet timer may never fire.
	 */
	settle?(): Promise<void> | null;
}

export class StickyNoteClaims {
	private readonly owners = new Map<string, StickyNoteEditOwner>();

	/** One settled chain per note, so transitions never overlap. */
	private readonly queues = new Map<string, Promise<void>>();

	/**
	 * Makes `owner` the note's editor, once whoever held it has let go. The
	 * old owner is written out only after its release has resolved, so
	 * `owner()` names the surface that actually holds an editor at every
	 * moment of the hand-over. A claim by the standing owner is a no-op.
	 */
	claim(noteId: string, owner: StickyNoteEditOwner): Promise<boolean> {
		return this.serialize(noteId, async () => {
			const previous = this.owners.get(noteId);
			if (previous?.id === owner.id) return true;
			if (previous !== undefined) await this.letGo(previous);
			this.owners.set(noteId, owner);
			return true;
		});
	}

	/** Takes the note away from whoever holds it, once they have let go. */
	evict(noteId: string): Promise<void> {
		return this.serialize(noteId, async () => {
			const owner = this.owners.get(noteId);
			if (owner === undefined) return;
			await this.letGo(owner);
			if (this.owners.get(noteId) === owner) this.owners.delete(noteId);
		});
	}

	/**
	 * An owner leaving of its own accord. False when the caller no longer
	 * holds the note -- it was handed on already -- and nothing changes.
	 */
	release(noteId: string, ownerId: string): boolean {
		if (this.owners.get(noteId)?.id !== ownerId) return false;
		this.owners.delete(noteId);
		return true;
	}

	/** The surface holding an editor for the note right now, if any. */
	owner(noteId: string): string | null {
		return this.owners.get(noteId)?.id ?? null;
	}

	/**
	 * Every owner's unwritten text sent to its file, the editors left open.
	 * Null where no owner holds any, so a quit with nothing to write waits
	 * for nothing.
	 */
	settleAll(): Promise<void> | null {
		const writes: Promise<void>[] = [];
		for (const owner of this.owners.values()) {
			const write = owner.settle?.() ?? null;
			if (write !== null) writes.push(write);
		}
		if (writes.length === 0) return null;
		return Promise.allSettled(writes).then(() => undefined);
	}

	/** Every note let go of, each owner flushing; the plugin's last word. */
	async releaseAll(): Promise<void> {
		await Promise.all(
			[...this.owners.keys()].map((noteId) => this.evict(noteId)),
		);
	}

	private async letGo(owner: StickyNoteEditOwner): Promise<void> {
		try {
			await owner.release();
		} catch (error) {
			// The owner has already shown its own error; the hand-over goes on.
			console.error('Snowflake: a sticky note editor failed to let go', error);
		}
	}

	private serialize<T>(noteId: string, step: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(noteId) ?? Promise.resolve();
		const run = previous.then(step);
		const settled = run.then(
			() => undefined,
			() => undefined,
		);
		this.queues.set(noteId, settled);
		void settled.then(() => {
			if (this.queues.get(noteId) === settled) this.queues.delete(noteId);
		});
		return run;
	}
}
