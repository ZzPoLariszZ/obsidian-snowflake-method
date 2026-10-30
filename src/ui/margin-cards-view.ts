import { ItemView, type WorkspaceLeaf } from 'obsidian';

import { keepEscapeInView } from './escape-key';
import { FilterPanel } from './filter-panel';
import {
	marginCardsLens,
	renderMarginCardsList,
	type MarginCardsList,
	type MarginCardsListDeps,
} from './margin-cards-list';

export const MARGIN_CARDS_VIEW_TYPE = 'snowflake-method-margin-cards';

export interface MarginCardsViewDeps extends Omit<MarginCardsListDeps, 'popover'> {
	/**
	 * What the mounted column was written under -- the language and the
	 * project the sidebar speaks for -- so a rerender that finds it
	 * unchanged redraws nothing: the column keeps itself current through
	 * the hub's own bell, and a rebuild on every save would close the
	 * funnel as fast as the author types.
	 */
	fingerprint(): string;
}

/**
 * The margin cards in a sidebar of their own: every revision and
 * foreshadowing card of the chapters a stream has on the page, listed in
 * reading order with the answers the margin offers. Where the margin is too
 * narrow to show its cards, on a phone or in a narrow split, this is where
 * they are read and answered; where it is wide, it is the same cards in a
 * column that scrolls on its own. It speaks the current project's language,
 * labels included, as the statistics and sticky notes sidebars do.
 */
export class SnowflakeMarginCardsView extends ItemView {
	private list: MarginCardsList | null = null;
	/** The funnel popover the column asks its questions in, one for the view. */
	private popover: FilterPanel | null = null;
	private shownFingerprint: string | null = null;
	/** The search and the funnel, kept through a rebuild for a change of language. */
	private readonly lens = marginCardsLens();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: MarginCardsViewDeps,
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
		this.popover = new FilterPanel(this.app, this.deps.t);
		this.mount();
		return Promise.resolve();
	}

	/** Builds the column again when the language or the project has moved. */
	rerender(): void {
		if (this.list === null) return;
		if (this.deps.fingerprint() === this.shownFingerprint) return;
		this.popover?.close();
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
		this.shownFingerprint = this.deps.fingerprint();
		const popover = this.popover ?? new FilterPanel(this.app, this.deps.t);
		this.popover = popover;
		this.list = renderMarginCardsList(
			this.contentEl,
			{ ...this.deps, popover: popover.lend() },
			this.lens,
		);
	}

	onClose(): Promise<void> {
		this.popover?.close();
		this.popover = null;
		this.list?.dispose();
		this.list = null;
		return Promise.resolve();
	}
}
