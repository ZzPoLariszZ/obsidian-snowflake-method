import { ItemView, type WorkspaceLeaf } from 'obsidian';

import {
	renderStickyNoteBoard,
	stickyBoardMemory,
	type StickyNoteBoardHandle,
} from './sticky-note-board';
import type { StickyNoteBridge } from './sticky-note-bridge';

export const STICKY_NOTES_VIEW_TYPE = 'snowflake-method-sticky-notes';

export interface StickyNotesViewDeps {
	/** The bridge for the current project, built afresh at every mount. */
	bridge(): StickyNoteBridge;
	/**
	 * What the mounted board was built under -- the language and the
	 * project -- so a rerender that finds it unchanged redraws nothing: the
	 * board keeps itself current through the hub's own bell.
	 */
	fingerprint(): string;
	locale(): string;
}

/**
 * The sticky notes in a sidebar leaf of their own: the compact board, so a
 * reminder can stand beside whatever is being written instead of under it.
 * It follows the current project the way the statistics sidebar does.
 */
export class SnowflakeStickyNotesView extends ItemView {
	private handle: StickyNoteBoardHandle | null = null;
	private shownFingerprint: string | null = null;
	private readonly memory = stickyBoardMemory();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: StickyNotesViewDeps,
	) {
		super(leaf);
	}

	getViewType(): string {
		return STICKY_NOTES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.deps.bridge().t('stickyNotes.viewTitle');
	}

	getIcon(): string {
		return 'sticker';
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('snowflake-method-sticky-notes-view');
		this.mount();
		return Promise.resolve();
	}

	/** Builds the board again when the language or the project has moved. */
	rerender(): void {
		if (this.handle === null) return;
		if (this.deps.fingerprint() === this.shownFingerprint) return;
		this.handle.dispose();
		this.handle = null;
		this.contentEl.empty();
		this.mount();
	}

	private mount(): void {
		this.shownFingerprint = this.deps.fingerprint();
		this.handle = renderStickyNoteBoard(this.contentEl, this.deps.bridge(), {
			app: this.app,
			surface: 'sidebar',
			compact: true,
			archive: false,
			controls: 'inline',
			memory: this.memory,
			component: this,
			locale: this.deps.locale(),
		});
	}

	onClose(): Promise<void> {
		this.handle?.dispose();
		this.handle = null;
		return Promise.resolve();
	}
}
