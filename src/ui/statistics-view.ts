import { ItemView, type WorkspaceLeaf } from 'obsidian';

import { renderSessionPanel, type SessionPanelBridge } from './session-panel';

export const STATISTICS_VIEW_TYPE = 'snowflake-method-statistics';

/**
 * The writing statistics sidebar: the session panel in a leaf of its own, so
 * the live session and today's totals can stand beside whatever is being
 * written instead of underneath it.
 */
export class SnowflakeStatisticsView extends ItemView {
	private dispose: (() => void) | null = null;
	private shownFingerprint: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly bridge: SessionPanelBridge,
		/**
		 * What the mounted labels were written under -- the language and the
		 * project the sidebar speaks for. A rerender that finds it unchanged
		 * has nothing to redraw: the widgets patch their own numbers, and
		 * rebuilding them on every vault save would tear the panel down as
		 * fast as the author types.
		 */
		private readonly fingerprint: () => string,
	) {
		super(leaf);
	}

	getViewType(): string {
		return STATISTICS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.bridge.t('statistics.viewTitle');
	}

	getIcon(): string {
		return 'chart-line';
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('snowflake-method-statistics-view');
		this.mount();
		return Promise.resolve();
	}

	/**
	 * Builds the panel again. The widgets patch their own numbers as a session
	 * runs, but their labels are written once, so a change of language or of
	 * current project is a change they cannot patch their way out of.
	 */
	rerender(): void {
		if (this.dispose === null) return;
		if (this.fingerprint() === this.shownFingerprint) return;
		this.dispose();
		this.dispose = null;
		this.contentEl.empty();
		this.mount();
	}

	private mount(): void {
		this.shownFingerprint = this.fingerprint();
		// A column beside the writing shows the day it is part of. The readings
		// that span a month or a year are the pane's, where there is width to
		// draw them at.
		this.dispose = renderSessionPanel(this.contentEl, this.bridge, {
			history: false,
		});
	}

	onClose(): Promise<void> {
		this.dispose?.();
		this.dispose = null;
		return Promise.resolve();
	}
}
