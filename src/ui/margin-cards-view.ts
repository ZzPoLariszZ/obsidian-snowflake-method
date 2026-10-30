import { ItemView, type WorkspaceLeaf } from 'obsidian';

import { keepEscapeInView } from './escape-key';
import {
	renderMarginCardsList,
	type MarginCardsList,
	type MarginCardsListDeps,
} from './margin-cards-list';

export const MARGIN_CARDS_VIEW_TYPE = 'snowflake-method-margin-cards';

/**
 * The margin cards in a sidebar of their own: every revision and
 * foreshadowing card of the chapters a stream has on the page, listed in
 * reading order with the answers the margin offers. Where the margin is too
 * narrow to show its cards, on a phone or in a narrow split, this is where
 * they are read and answered; where it is wide, it is the same cards in a
 * column that scrolls on its own.
 */
export class SnowflakeMarginCardsView extends ItemView {
	private list: MarginCardsList | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: MarginCardsListDeps,
	) {
		super(leaf);
	}

	getViewType(): string {
		return MARGIN_CARDS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.deps.t('marginCards.viewTitle');
	}

	getIcon(): string {
		return 'messages-square';
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('snowflake-method-margin-cards-view');
		keepEscapeInView(this);
		this.mount();
		return Promise.resolve();
	}

	/** Builds the column again, for a change of language. */
	rerender(): void {
		if (this.list === null) return;
		this.list.dispose();
		this.list = null;
		this.contentEl.empty();
		this.mount();
	}

	/** A drawer opening shows the column: a card named meanwhile is scrolled to. */
	onResize(): void {
		this.list?.reveal();
	}

	private mount(): void {
		this.list = renderMarginCardsList(this.contentEl, this.deps);
	}

	onClose(): Promise<void> {
		this.list?.dispose();
		this.list = null;
		return Promise.resolve();
	}
}
