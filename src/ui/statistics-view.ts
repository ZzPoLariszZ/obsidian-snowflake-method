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

	constructor(
		leaf: WorkspaceLeaf,
		private readonly bridge: SessionPanelBridge,
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
		this.dispose = renderSessionPanel(this.contentEl, this.bridge);
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.dispose?.();
		this.dispose = null;
		return Promise.resolve();
	}
}
