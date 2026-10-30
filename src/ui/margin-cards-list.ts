import { SPOTLIGHT_PATIENCE_MS, type MarginCardsHub } from './margin-cards-hub';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import {
	renderRevisionRail,
	type RevisionRail,
	type RevisionRailCallbacks,
	type RevisionRailModel,
} from './revision-cards';

export interface MarginCardsListDeps {
	hub: MarginCardsHub;
	t: Translate;
	/**
	 * Called before a card's words are brought onto the screen. On mobile
	 * the sidebar is a drawer over the page, and it is put away first so the
	 * flash is seen; on the desktop there is nothing to do.
	 */
	stepAside(): void;
}

/** One chapter's block: its title and its cards, as a list-laid rail. */
interface Block {
	el: HTMLElement;
	title: HTMLElement;
	rail: RevisionRail;
	callbacks: RevisionRailCallbacks;
	model: RevisionRailModel | null;
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
 * do. The column follows the stream through the hub: a chapter that leaves
 * the page takes its cards with it, the cards whose words are on the screen
 * are marked, and a jump that landed on a card brings it into view here.
 */
export function renderMarginCardsList(
	host: HTMLElement,
	deps: MarginCardsListDeps,
): MarginCardsList {
	const root = host.createDiv({ cls: 'snowflake-method-margin-cards' });
	const { line: empty, text: emptyText } = renderEmptyLine(root, '');
	const blocks = new Map<string, Block>();
	const win = host.win;
	/** A card named while the column had no layout to scroll in. */
	let waiting: { key: string; at: number } | null = null;

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
		const el = root.createDiv({ cls: 'snowflake-method-margin-cards-chapter' });
		const heading = el.createDiv({
			cls: 'snowflake-method-margin-cards-title',
			text: title,
		});
		const rail = renderRevisionRail(el, callbacks, {
			layout: 'list',
			locate: {
				label: deps.t('marginCards.show'),
				act: (key) => {
					locate(path, key);
				},
			},
		});
		const block = { el, title: heading, rail, callbacks, model: null };
		blocks.set(path, block);
		return block;
	};

	const drop = (path: string, block: Block): void => {
		block.rail.dispose();
		block.el.remove();
		blocks.delete(path);
	};

	const paint = (): void => {
		const feed = deps.hub.current();
		const wanted = new Set<string>();
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
			if (block.model !== segment.model) {
				block.model = segment.model;
				block.rail.sync(segment.model);
			}
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
				root.insertBefore(block.el, cursor);
			}
		}
		const inView = feed?.inView ?? new Set<string>();
		for (const block of blocks.values()) {
			block.rail.each((key, card) => {
				card.toggleClass('is-in-view', inView.has(key));
			});
		}
		if (feed === null) {
			emptyText.setText(deps.t('marginCards.noStream'));
			empty.show();
		} else if (blocks.size === 0) {
			emptyText.setText(deps.t('marginCards.none'));
			empty.show();
		} else {
			empty.hide();
		}
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

	const reveal = (): void => {
		if (waiting === null || !root.isShown()) return;
		const { key, at } = waiting;
		waiting = null;
		if (Date.now() - at <= SPOTLIGHT_PATIENCE_MS) spotlight(key);
	};

	const unsubscribe = deps.hub.subscribe((key) => {
		if (key === null) paint();
		else spotlight(key);
	});
	paint();
	// A jump that opened this sidebar for its card named the card a moment
	// before the column stood.
	const named = deps.hub.takeSpotlight();
	if (named !== null) spotlight(named);

	return {
		reveal,
		dispose: () => {
			unsubscribe();
			for (const block of blocks.values()) block.rail.dispose();
			blocks.clear();
			root.remove();
		},
	};
}
