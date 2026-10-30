import { SearchComponent, setIcon, setTooltip } from 'obsidian';

import type { Revision } from '../domain';
import type { FilterRow, LentFilterPopover } from './filter-rows';
import type { ForeshadowingCardEntry } from './foreshadowing-cards';
import { SPOTLIGHT_PATIENCE_MS, type MarginCardsHub } from './margin-cards-hub';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import {
	renderRevisionRail,
	type RevisionRail,
	type RevisionRailCallbacks,
	type RevisionRailModel,
} from './revision-cards';
import { foreshadowingFilterRows, revisionFilterRows } from './tracking-filter-rows';

export interface MarginCardsListDeps {
	hub: MarginCardsHub;
	t: Translate;
	/**
	 * Called before a card's words are brought onto the screen. On mobile
	 * the sidebar is a drawer over the page, and it is put away first so the
	 * flash is seen; on the desktop there is nothing to do.
	 */
	stepAside(): void;
	/** The funnel popover, lent by the view that holds the column. */
	popover: LentFilterPopover;
}

export const MARGIN_CARD_KINDS = ['all', 'revisions', 'foreshadowing'] as const;
export type MarginCardsKind = (typeof MARGIN_CARD_KINDS)[number];

/**
 * What the band narrows the column to: words to match, a kind of card and,
 * under a kind, the answers to that kind's own questions, the ones its
 * dashboard table asks. The answers under the other kind are at rest.
 */
export interface MarginCardsLens {
	query: string;
	kind: MarginCardsKind;
	/** The revision table's: a kind of revision, and 'conflict' for only those. */
	revision: { kind: string; standing: string };
	/** The foreshadowing table's: the thread's status, the occurrence's role, and 'unresolved' for only those. */
	foreshadowing: { status: string; role: string; standing: string };
}

export const marginCardsLens = (): MarginCardsLens => ({
	query: '',
	kind: 'all',
	revision: { kind: '', standing: '' },
	foreshadowing: { status: '', role: '', standing: '' },
});

const isKind = (value: string): value is MarginCardsKind =>
	(MARGIN_CARD_KINDS as readonly string[]).includes(value);

const matches = (fields: readonly string[], query: string): boolean =>
	query === '' || fields.some((field) => field.toLowerCase().includes(query));

/**
 * One chapter's cards through the lens: the kinds asked for, answering the
 * kind's own questions, holding the words searched for anywhere a card
 * prints them. The draft never lists.
 */
export function throughLens(model: RevisionRailModel, lens: MarginCardsLens): RevisionRailModel {
	const query = lens.query.trim().toLowerCase();
	const revisions = lens.kind !== 'foreshadowing';
	const threads = lens.kind !== 'revisions';
	const revisionFits = (revision: Revision, conflict: boolean): boolean =>
		revisions &&
		(lens.revision.kind === '' || revision.kind === lens.revision.kind) &&
		(lens.revision.standing === '' || conflict) &&
		matches([revision.originalText, revision.proposed, revision.comment], query);
	const threadFits = (entry: ForeshadowingCardEntry, unresolved: boolean): boolean =>
		threads &&
		(lens.foreshadowing.status === '' || entry.item.status === lens.foreshadowing.status) &&
		(lens.foreshadowing.role === '' || entry.occurrence.role === lens.foreshadowing.role) &&
		(lens.foreshadowing.standing === '' || unresolved) &&
		matches(
			[
				entry.item.name,
				entry.item.description,
				entry.occurrence.originalText,
				entry.occurrence.note,
			],
			query,
		);
	return {
		...model,
		entries: model.entries.filter((entry) => revisionFits(entry.revision, false)),
		conflicts: model.conflicts.filter((revision) => revisionFits(revision, true)),
		foreshadowing: {
			entries: model.foreshadowing.entries.filter((entry) => threadFits(entry, false)),
			unresolved: model.foreshadowing.unresolved.filter((entry) => threadFits(entry, true)),
		},
	};
}

const cardsIn = (model: RevisionRailModel): number =>
	model.entries.length +
	model.conflicts.length +
	model.foreshadowing.entries.length +
	model.foreshadowing.unresolved.length;

/** One chapter's block: its title and its cards, as a list-laid rail. */
interface Block {
	el: HTMLElement;
	title: HTMLElement;
	rail: RevisionRail;
	callbacks: RevisionRailCallbacks;
	model: RevisionRailModel | null;
	narrowed: RevisionRailModel | null;
	/** The lens the rail was last synced through. */
	stamp: number;
}

/** How long a card the sidebar scrolled to stays lit. */
const JUMPED_MS = 900;

export interface MarginCardsList {
	/**
	 * Called when the column is shown or resized: a card named while the
	 * column stood in a drawer put away, with no layout to scroll in, is
	 * scrolled to now.
	 */
	reveal: () => void;
	dispose: () => void;
}

/**
 * The margin cards as a column: every chapter the stream has on the page
 * with cards, headed by its title, the cards in reading order and drawn by
 * the rail itself, so they accept, reject, edit and jump as the margin's
 * do. A band over the column searches the cards and narrows them to a
 * kind and, under it, by the kind's own questions. The column follows the stream through the hub: a chapter that
 * leaves the page takes its cards with it, the cards whose words are on the
 * screen are marked, the card whose words hold the caret is marked and
 * kept in view, and a jump that landed on a card brings it into view here.
 */
export function renderMarginCardsList(
	host: HTMLElement,
	deps: MarginCardsListDeps,
	lens: MarginCardsLens = marginCardsLens(),
): MarginCardsList {
	const root = host.createDiv({ cls: 'snowflake-method-margin-cards' });
	const win = host.win;
	const blocks = new Map<string, Block>();
	/** A card named while the column had no layout to scroll in. */
	let waiting: { key: string; at: number } | null = null;
	/** Whether the column had a layout at the last look, so a reveal can tell a drawer opening. */
	let shown = root.isShown();
	/** Bumped when the lens changes, so every block syncs through it once more. */
	let stamp = 0;

	// The band over the column: the search, the funnel with the kind, and
	// how many of the cards the two leave.
	const band = root.createDiv({
		cls: 'snowflake-method-sticky-controls snowflake-method-margin-cards-controls',
	});
	const search = new SearchComponent(band);
	search.setPlaceholder(deps.t('marginCards.searchPlaceholder'));
	search.setValue(lens.query);
	search.onChange((next) => {
		lens.query = next;
		stamp += 1;
		paint();
	});
	const filterButton = band.createEl('button', {
		cls: 'clickable-icon snowflake-method-filter-button snowflake-method-margin-cards-filter',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
			'aria-label': deps.t('table.filter'),
		},
	});
	setIcon(filterButton, 'funnel');
	setTooltip(filterButton, deps.t('table.filter'));
	const markFilterButton = (): void => {
		filterButton.toggleClass('is-active', lens.kind !== 'all');
	};
	markFilterButton();
	// The funnel's questions in the dashboard's own popover: the kind, and
	// under a kind the questions that kind's table asks, drawn once the kind
	// is picked. The answers under a kind not picked are applied as at rest.
	const filterRows = (): FilterRow[] => [
		{
			label: deps.t('marginCards.kind'),
			placeholder: deps.t('marginCards.kindAll'),
			empty: 'all',
			options: () => [
				{ value: 'revisions', label: deps.t('marginCards.kindRevisions') },
				{ value: 'foreshadowing', label: deps.t('marginCards.kindForeshadowing') },
			],
			value: lens.kind,
			apply: (value) => {
				lens.kind = isKind(value) ? value : 'all';
			},
			under: {
				revisions: revisionFilterRows(deps.t, lens.revision),
				foreshadowing: foreshadowingFilterRows(deps.t, lens.foreshadowing),
			},
		},
	];
	filterButton.addEventListener('click', () => {
		if (deps.popover.filterOpen()) {
			deps.popover.closeFilter();
			return;
		}
		deps.popover.openFilter(filterButton, filterRows(), () => {
			markFilterButton();
			stamp += 1;
			paint();
		});
	});
	const stateText = band.createSpan({ cls: 'snowflake-method-prose-state' });

	// The cards scroll in a column of their own under the band, as the
	// sticky board's do, so the search and the funnel stay put however far
	// the column runs.
	const scroll = root.createDiv({
		cls: 'snowflake-method-sticky-scroll snowflake-method-margin-cards-scroll',
	});
	const { line: empty, text: emptyText } = renderEmptyLine(scroll, '');

	const locate = (path: string, key: string): void => {
		const feed = deps.hub.current();
		if (feed === null) return;
		deps.stepAside();
		feed.locate(path, key);
	};

	const build = (
		path: string,
		title: string,
		callbacks: RevisionRailCallbacks,
	): Block => {
		const el = scroll.createDiv({ cls: 'snowflake-method-margin-cards-chapter' });
		const heading = el.createDiv({
			cls: 'snowflake-method-margin-cards-title',
			text: title,
		});
		const rail = renderRevisionRail(el, callbacks, {
			layout: 'list',
			caretMark: deps.t('marginCards.atCaret'),
			locate: {
				label: deps.t('marginCards.show'),
				act: (key) => {
					locate(path, key);
				},
			},
		});
		const block: Block = {
			el,
			title: heading,
			rail,
			callbacks,
			model: null,
			narrowed: null,
			stamp: -1,
		};
		blocks.set(path, block);
		return block;
	};

	const drop = (path: string, block: Block): void => {
		block.rail.dispose();
		block.el.remove();
		blocks.delete(path);
	};

	const cardFor = (key: string): HTMLElement | null => {
		let found: HTMLElement | null = null;
		for (const block of blocks.values()) {
			block.rail.each((candidate, card) => {
				if (candidate === key) found = card;
			});
		}
		return found;
	};

	const markCards = (inView: ReadonlySet<string>): void => {
		const caret = deps.hub.caretCard();
		for (const block of blocks.values()) {
			block.rail.each((key, card) => {
				card.toggleClass('is-in-view', inView.has(key));
				card.toggleClass('is-caret', key === caret);
			});
		}
	};

	const paint = (): void => {
		const feed = deps.hub.current();
		const wanted = new Set<string>();
		let total = 0;
		let left = 0;
		for (const segment of feed?.segments ?? []) {
			wanted.add(segment.path);
			let block = blocks.get(segment.path);
			// A chapter mounted afresh answers with callbacks of its own; a
			// block kept from its earlier stay would answer to a rail since
			// taken down.
			if (block !== undefined && block.callbacks !== segment.callbacks) {
				drop(segment.path, block);
				block = undefined;
			}
			block ??= build(segment.path, segment.title, segment.callbacks);
			block.title.setText(segment.title);
			total += cardsIn(segment.model);
			if (block.model !== segment.model || block.stamp !== stamp) {
				block.model = segment.model;
				block.stamp = stamp;
				block.narrowed = throughLens(segment.model, lens);
				block.rail.sync(block.narrowed);
			}
			const count = block.narrowed === null ? 0 : cardsIn(block.narrowed);
			left += count;
			// A chapter the lens leaves no card in stands down, unless a form
			// is open in one of its cards.
			if (count > 0 || block.rail.editing()) block.el.show();
			else block.el.hide();
		}
		for (const [path, block] of [...blocks]) {
			if (wanted.has(path)) continue;
			// A chapter that left the page takes its cards with it, unless a
			// form is open in one: the words being typed are the author's,
			// and the block stays until the form closes.
			if (block.rail.editing()) continue;
			drop(path, block);
		}
		// Reading order, moved into only where it changed, and not at all
		// while a form is open: a text box moved in the DOM loses its focus.
		if (![...blocks.values()].some((block) => block.rail.editing())) {
			let cursor: Element | null = empty.nextElementSibling;
			for (const segment of feed?.segments ?? []) {
				const block = blocks.get(segment.path);
				if (block === undefined) continue;
				if (block.el === cursor) {
					cursor = cursor.nextElementSibling;
					continue;
				}
				scroll.insertBefore(block.el, cursor);
			}
		}
		markCards(feed?.inView ?? new Set<string>());
		if (total > 0) band.show();
		else band.hide();
		stateText.setText(
			left === total ? '' : deps.t('table.filteredCount', { shown: left, total }),
		);
		if (feed === null) {
			emptyText.setText(deps.t('marginCards.noStream'));
			empty.show();
		} else if (total === 0) {
			emptyText.setText(deps.t('marginCards.none'));
			empty.show();
		} else if (left === 0) {
			emptyText.setText(deps.t('marginCards.noMatch'));
			empty.show();
		} else {
			empty.hide();
		}
	};

	/**
	 * Brings the card a jump landed on into view here, lit for a beat. In a
	 * drawer put away the column has no layout to scroll in, so the name is
	 * kept for the moment the drawer opens, as long as a jump's name keeps.
	 */
	const spotlight = (key: string): void => {
		const card = cardFor(key);
		if (card === null) return;
		if (!root.isShown()) {
			waiting = { key, at: Date.now() };
			return;
		}
		waiting = null;
		card.scrollIntoView({ block: 'center' });
		card.addClass('is-jumped');
		win.setTimeout(() => {
			card.removeClass('is-jumped');
		}, JUMPED_MS);
	};

	/**
	 * The caret moved into a card's words, or out of every card's: the card
	 * is marked, and brought into view if it was out of it, without the
	 * centring a jump gets, so the column follows the writing quietly.
	 */
	const follow = (key: string | null): void => {
		for (const block of blocks.values()) {
			block.rail.each((candidate, card) => {
				card.toggleClass('is-caret', candidate === key);
			});
		}
		if (key === null || !root.isShown()) return;
		cardFor(key)?.scrollIntoView({ block: 'nearest' });
	};

	const reveal = (): void => {
		if (!root.isShown()) {
			shown = false;
			return;
		}
		const wasShown = shown;
		shown = true;
		if (waiting !== null) {
			const { key, at } = waiting;
			waiting = null;
			if (Date.now() - at <= SPOTLIGHT_PATIENCE_MS) spotlight(key);
			return;
		}
		// A drawer opening on a column with the caret's card in it brings
		// that card into view, as the caret's move would have.
		if (wasShown) return;
		const caret = deps.hub.caretCard();
		if (caret !== null) cardFor(caret)?.scrollIntoView({ block: 'nearest' });
	};

	const unsubscribe = deps.hub.subscribe((event) => {
		if (event.kind === 'feed') paint();
		else if (event.kind === 'viewport') markCards(event.inView);
		else if (event.kind === 'spotlight') spotlight(event.key);
		else follow(event.key);
	});
	paint();
	// A jump that opened this sidebar for its card named the card a moment
	// before the column stood.
	const named = deps.hub.takeSpotlight();
	if (named !== null) spotlight(named);

	return {
		reveal,
		dispose: () => {
			deps.popover.closeFilter();
			unsubscribe();
			for (const block of blocks.values()) block.rail.dispose();
			blocks.clear();
			root.remove();
		},
	};
}
