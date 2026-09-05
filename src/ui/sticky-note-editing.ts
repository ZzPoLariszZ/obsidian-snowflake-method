/**
 * One sticky note under an editor: the text as it stands in the file, the
 * text the author has typed since, and the quiet timer that carries the one
 * to the other. The stream's segment editor keeps the same bargain
 * (`manuscript-view.ts`): a save waits for a pause in the typing, flushes
 * are never in flight two at once, and a save the file refuses -- because
 * the file moved under it -- is sorted out by reading the file back rather
 * than by guessing.
 *
 * What moved is what decides. The frontmatter alone (a colour picked on
 * another surface, a note set aside) leaves the body as the editor last saw
 * it, and the save simply goes again under the fresh revision. A body equal
 * to what was about to be written is the same words already landed. Only a
 * third body is a real conflict, and there the stream's rule holds: the
 * author's text is kept and written over the change, with one notice --
 * unsaved text is the one thing an app closing loses.
 *
 * DOM-free, timers handed in, so the whole dance is tested without a window.
 */

import type { StickyNoteRecord } from '../services';

export const STICKY_NOTE_SAVE_DELAY_MS = 800;

/** The file's revision no longer matched the one the save carried. */
export class StickyNoteSaveConflict extends Error {
	override readonly name = 'StickyNoteSaveConflict';
}

/** The file is not there to write: deleted, or renamed and not yet found again. */
export class StickyNoteGone extends Error {
	override readonly name = 'StickyNoteGone';
}

export interface StickyNoteEditTimers {
	set(handler: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
}

export interface StickyNoteEditIo {
	/**
	 * Writes the body under the revision, or throws `StickyNoteSaveConflict`
	 * when the revision moved and `StickyNoteGone` when the file is not there.
	 */
	write(
		path: string,
		body: string,
		expectedRevision: string,
	): Promise<StickyNoteRecord>;
	/** The note as the file now says it; null when the file is gone. */
	read(path: string): Promise<StickyNoteRecord | null>;
	/** The surface's own window's timers, so a popout closing takes them along. */
	timers: StickyNoteEditTimers;
	onSaved(record: StickyNoteRecord): void;
	/** A real body conflict: the author's text was kept and written over it. */
	onConflict(): void;
	/**
	 * The file went away under the editor. The pending text is kept, unsaved
	 * and untried, until the note is found again under another name.
	 */
	onGone(): void;
	onError(error: unknown): void;
}

export class StickyNoteEditSession {
	private held: StickyNoteRecord;

	private pendingBody: string | null = null;

	private timer: unknown = null;

	/** The body a write is carrying to the file right now. */
	private writing: string | null = null;

	private saving: Promise<void> = Promise.resolve();

	/** The file was not there the last time a write reached for it. */
	private goneFlag = false;

	/** Set while the closing flush runs: no timer is armed past it. */
	private disposing = false;

	/** A conflict met during the closing flush asks it to go once more. */
	private retryWanted = false;

	private disposed = false;

	constructor(
		record: StickyNoteRecord,
		private readonly io: StickyNoteEditIo,
		private readonly delayMs = STICKY_NOTE_SAVE_DELAY_MS,
	) {
		this.held = record;
	}

	/** The revision and fields last agreed with the file. */
	get record(): StickyNoteRecord {
		return this.held;
	}

	/** The body the editor last agreed with the file on: the held record's own. */
	get baseBody(): string {
		return this.held.body;
	}

	/** Typed text the file does not hold yet; null when they agree. */
	get pending(): string | null {
		return this.pendingBody;
	}

	/** Whether the file went away under the editor and has not been found again. */
	get gone(): boolean {
		return this.goneFlag;
	}

	/**
	 * The editor's text changed under typing. Equal to the base, nothing
	 * waits -- unless a write is in flight, since the base is about to move
	 * to what that write carries, and a return to the old words is then a
	 * change the file has yet to hear of.
	 */
	changed(body: string): void {
		if (this.disposed) return;
		this.clearTimer();
		if (body === this.held.body && this.writing === null) {
			this.pendingBody = null;
			return;
		}
		this.pendingBody = body;
		if (this.goneFlag) return;
		this.arm();
	}

	/**
	 * Carries the pending text to the file now. Serialised: a timer, a blur,
	 * a hand-over and a disposal can all ask, and the later ones find nothing
	 * left to write. Never rejects; trouble is reported through the io.
	 */
	flush(): Promise<void> {
		this.saving = this.saving.then(() => this.flushNow());
		return this.saving;
	}

	/**
	 * The file changed under the editor. Taken when the editor holds nothing
	 * unsaved, and also when only the frontmatter moved -- the body equal to
	 * the base means the typing can go on under the fresh revision. Kept
	 * otherwise, for the next flush to sort out against the file.
	 */
	take(record: StickyNoteRecord): 'adopted' | 'kept' {
		if (this.pendingBody === null) {
			this.held = record;
			this.found();
			return 'adopted';
		}
		if (record.body === this.held.body) {
			this.held = record;
			this.found();
			return 'adopted';
		}
		// The typing goes on over a body the file no longer holds, and the
		// next flush sorts that out against the file -- under the file's
		// name as it is now, or the write would reach for a path that is gone.
		if (record.path !== this.held.path) {
			this.held = { ...this.held, path: record.path };
			this.found();
		}
		return 'kept';
	}

	/**
	 * Clears the timer and flushes what is pending. A file that keeps moving
	 * under the closing flush is met a bounded number of times, here, rather
	 * than by a timer that would fire after the editor has gone; then nothing
	 * more is answered.
	 */
	async dispose(): Promise<void> {
		this.clearTimer();
		this.disposing = true;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			this.retryWanted = false;
			await this.flush();
			if (!this.retryWanted) break;
		}
		this.disposed = true;
	}

	/** Lets the pending text go unwritten: the file is not there to take it. */
	discard(): void {
		this.clearTimer();
		this.disposed = true;
	}

	/** The file is there again under the name just taken: what waits goes on its way. */
	private found(): void {
		if (!this.goneFlag) return;
		this.goneFlag = false;
		if (this.pendingBody !== null) this.arm();
	}

	private arm(): void {
		if (this.disposed || this.disposing) return;
		this.clearTimer();
		this.timer = this.io.timers.set(() => {
			this.timer = null;
			void this.flush();
		}, this.delayMs);
	}

	private clearTimer(): void {
		if (this.timer === null) return;
		this.io.timers.clear(this.timer);
		this.timer = null;
	}

	private adopt(written: StickyNoteRecord, body: string): void {
		this.held = written;
		if (this.pendingBody === body) this.pendingBody = null;
	}

	private async flushNow(): Promise<void> {
		if (this.disposed || this.goneFlag) return;
		const body = this.pendingBody;
		if (body === null) return;
		this.clearTimer();
		try {
			const written = await this.write(this.held.path, body, this.held.revision);
			this.adopt(written, body);
			this.io.onSaved(written);
		} catch (error) {
			if (error instanceof StickyNoteGone) {
				this.lost();
				return;
			}
			if (!(error instanceof StickyNoteSaveConflict)) {
				this.io.onError(error);
				return;
			}
			await this.resolveConflict(body);
		}
	}

	/** One write, marked as in flight for as long as it is. */
	private async write(
		path: string,
		body: string,
		revision: string,
	): Promise<StickyNoteRecord> {
		this.writing = body;
		try {
			return await this.io.write(path, body, revision);
		} finally {
			this.writing = null;
		}
	}

	private lost(): void {
		this.goneFlag = true;
		this.io.onGone();
	}

	private async resolveConflict(body: string): Promise<void> {
		let fresh: StickyNoteRecord | null;
		try {
			fresh = await this.io.read(this.held.path);
		} catch (error) {
			this.io.onError(error);
			return;
		}
		if (fresh === null) {
			this.lost();
			return;
		}
		if (fresh.body === body) {
			// The same words landed from elsewhere: nothing left to write.
			this.adopt(fresh, body);
			this.io.onSaved(fresh);
			return;
		}
		const frontmatterOnly = fresh.body === this.held.body;
		this.held = fresh;
		if (!frontmatterOnly) this.io.onConflict();
		try {
			const written = await this.write(fresh.path, body, fresh.revision);
			this.adopt(written, body);
			this.io.onSaved(written);
		} catch (error) {
			if (error instanceof StickyNoteGone) {
				this.lost();
				return;
			}
			if (error instanceof StickyNoteSaveConflict) {
				// Moved again while this was being sorted out: the next pause
				// tries again, or the closing flush itself where one is running.
				if (this.pendingBody === null || this.disposed) return;
				if (this.disposing) this.retryWanted = true;
				else this.arm();
				return;
			}
			this.io.onError(error);
		}
	}
}
