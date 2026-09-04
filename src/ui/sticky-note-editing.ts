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

export interface StickyNoteEditTimers {
	set(handler: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
}

export interface StickyNoteEditIo {
	/** Writes the body under the revision, or throws `StickyNoteSaveConflict`. */
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
	/** The file went away under the editor; the pending text is kept, unsaved. */
	onGone(): void;
	onError(error: unknown): void;
}

export class StickyNoteEditSession {
	private held: StickyNoteRecord;

	/** The body the editor last agreed with the file on. */
	private base: string;

	private pendingBody: string | null = null;

	private timer: unknown = null;

	private saving: Promise<void> = Promise.resolve();

	private disposed = false;

	constructor(
		record: StickyNoteRecord,
		private readonly io: StickyNoteEditIo,
		private readonly delayMs = STICKY_NOTE_SAVE_DELAY_MS,
	) {
		this.held = record;
		this.base = record.body;
	}

	/** The revision and fields last agreed with the file. */
	get record(): StickyNoteRecord {
		return this.held;
	}

	get baseBody(): string {
		return this.base;
	}

	/** Typed text the file does not hold yet; null when they agree. */
	get pending(): string | null {
		return this.pendingBody;
	}

	/** The editor's text changed under typing. Equal to the base, nothing waits. */
	changed(body: string): void {
		if (this.disposed) return;
		this.clearTimer();
		if (body === this.base) {
			this.pendingBody = null;
			return;
		}
		this.pendingBody = body;
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
			this.base = record.body;
			return 'adopted';
		}
		if (record.body === this.base) {
			this.held = record;
			return 'adopted';
		}
		return 'kept';
	}

	/** Clears the timer, flushes what is pending, and answers nothing more. */
	async dispose(): Promise<void> {
		this.clearTimer();
		await this.flush();
		this.disposed = true;
	}

	private arm(): void {
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
		this.base = body;
		if (this.pendingBody === body) this.pendingBody = null;
	}

	private async flushNow(): Promise<void> {
		const body = this.pendingBody;
		if (body === null) return;
		this.clearTimer();
		try {
			const written = await this.io.write(this.held.path, body, this.held.revision);
			this.adopt(written, body);
			this.io.onSaved(written);
		} catch (error) {
			if (!(error instanceof StickyNoteSaveConflict)) {
				this.io.onError(error);
				return;
			}
			await this.resolveConflict(body);
		}
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
			this.io.onGone();
			return;
		}
		if (fresh.body === body) {
			// The same words landed from elsewhere: nothing left to write.
			this.adopt(fresh, body);
			this.io.onSaved(fresh);
			return;
		}
		const frontmatterOnly = fresh.body === this.base;
		this.held = fresh;
		if (!frontmatterOnly) {
			this.base = fresh.body;
			this.io.onConflict();
		}
		try {
			const written = await this.io.write(fresh.path, body, fresh.revision);
			this.adopt(written, body);
			this.io.onSaved(written);
		} catch (error) {
			if (error instanceof StickyNoteSaveConflict) {
				// Moved again while this was being sorted out: the next pause tries again.
				if (this.pendingBody !== null && !this.disposed) this.arm();
				return;
			}
			this.io.onError(error);
		}
	}
}
