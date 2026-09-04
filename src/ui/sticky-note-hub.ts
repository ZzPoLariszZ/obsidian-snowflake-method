/**
 * What every sticky-note surface shares and none of them owns: who is editing
 * which note, what this device remembers about each floating panel, and the
 * one bell rung when the notes changed. The plugin holds the single instance
 * and every board, sidebar and floating layer is handed it; a surface never
 * talks to another surface, only to this.
 *
 * The remembered state is per device on purpose (`app.saveLocalStorage`):
 * where a panel stood on this screen means nothing on another, and the
 * Markdown must carry nothing but the note.
 */

import {
	forgetStickyNoteState,
	patchStickyNoteFloatState,
	readStickyNoteLocalState,
	type StickyNoteFloatState,
	type StickyNoteLocalState,
} from '../domain';
import { StickyNoteClaims } from './sticky-note-claims';

export interface StickyNoteHubDeps {
	/** What the device has kept, in whatever shape; read once, made safe. */
	load(): unknown;
	save(state: StickyNoteLocalState): void;
}

export class StickyNoteHub {
	readonly claims = new StickyNoteClaims();

	private state: StickyNoteLocalState;

	private readonly listeners = new Set<() => void>();

	constructor(private readonly deps: StickyNoteHubDeps) {
		this.state = readStickyNoteLocalState(deps.load());
	}

	/** What this device remembers of a note's floating panel, if anything. */
	floatState(id: string): StickyNoteFloatState | null {
		return this.state.notes[id]?.float ?? null;
	}

	patchFloatState(id: string, patch: Partial<StickyNoteFloatState>): void {
		this.state = patchStickyNoteFloatState(this.state, id, patch);
		this.deps.save(this.state);
	}

	/** Drops a note's state once the note itself is gone for good. */
	forget(id: string): void {
		if (!(id in this.state.notes)) return;
		this.state = forgetStickyNoteState(this.state, id);
		this.deps.save(this.state);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** The notes changed somewhere; every surface reads again. A listener's failure is its own. */
	notify(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.error('Snowflake: a sticky note surface failed to refresh', error);
			}
		}
	}
}
