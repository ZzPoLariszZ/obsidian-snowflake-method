import type { RevisionRailCallbacks, RevisionRailModel } from './revision-cards';

/**
 * One chapter's cards as a stream shows them, for the sidebar to list: the
 * model the chapter's rail was last brought level with, and the callbacks
 * its cards answer with, so a card in the sidebar accepts, rejects, edits
 * and jumps exactly as the one in the margin does.
 */
export interface MarginCardsSegment {
	path: string;
	title: string;
	model: RevisionRailModel;
	callbacks: RevisionRailCallbacks;
}

/** What one stream has to show the sidebar. */
export interface MarginCardsFeed {
	/** The chapters on the page that carry cards, in reading order. */
	segments: readonly MarginCardsSegment[];
	/** The keys of the cards whose words are on the screen right now. */
	inView: ReadonlySet<string>;
	/** Whether the stream's own margin is too narrow to show its cards. */
	tight: boolean;
	/** Brings a card's words onto the screen and flashes them. */
	locate(path: string, key: string): void;
}

/** What the hub tells a listener: the feed changed, the cards on the screen changed, a card was named, or the caret moved. */
export type MarginCardsEvent =
	| { kind: 'feed' }
	| { kind: 'viewport'; inView: ReadonlySet<string> }
	| { kind: 'spotlight'; key: string }
	| { kind: 'caret'; key: string | null };

/** How long a card's name waits for a sidebar that cannot show it yet. */
export const SPOTLIGHT_PATIENCE_MS = 3000;

/**
 * The bell between the manuscript streams and the margin card sidebar. Each
 * stream publishes what its rails hold whenever they change, and the
 * sidebar lists the feed of one of them: the stream whose leaf was last in
 * front, or failing that the one that last published. A stream closing
 * takes its feed with it. A jump that landed on a card names it here as
 * well, so the sidebar can scroll to it, and the name waits a moment for a
 * sidebar being opened for it. The card whose words hold the caret is
 * named here too, as the caret moves, so the sidebar can mark it: the way
 * back from the words to their card.
 */
export class MarginCardsHub {
	private readonly feeds = new Map<object, MarginCardsFeed>();
	private readonly order: object[] = [];
	private preferred: object | null = null;
	private readonly listeners = new Set<(event: MarginCardsEvent) => void>();
	private pending: { key: string; at: number } | null = null;
	private caretKey: string | null = null;

	constructor(private readonly now: () => number = () => Date.now()) {}

	publish(source: object, feed: MarginCardsFeed): void {
		this.feeds.set(source, feed);
		const at = this.order.indexOf(source);
		if (at >= 0) this.order.splice(at, 1);
		this.order.push(source);
		this.notify({ kind: 'feed' });
	}

	/** Names the stream whose leaf is in front; its feed is the one listed. */
	prefer(source: object): void {
		if (this.preferred === source) return;
		this.preferred = source;
		if (this.feeds.has(source)) this.notify({ kind: 'feed' });
	}

	retire(source: object): void {
		if (!this.feeds.delete(source)) return;
		const at = this.order.indexOf(source);
		if (at >= 0) this.order.splice(at, 1);
		if (this.preferred === source) this.preferred = null;
		this.notify({ kind: 'feed' });
	}

	/**
	 * Says which of a stream's cards have their words on the screen now, as
	 * its page scrolls. The feed is kept level, and a listening sidebar
	 * re-marks its cards without drawing the column again, when the stream
	 * is the one on show.
	 */
	viewport(source: object, inView: ReadonlySet<string>): void {
		const feed = this.feeds.get(source);
		if (feed === undefined) return;
		this.feeds.set(source, { ...feed, inView });
		if (this.shown() === source) this.notify({ kind: 'viewport', inView });
	}

	/** The feed on show: the preferred stream's while it has one, else the latest. */
	current(): MarginCardsFeed | null {
		const source = this.shown();
		return source === null ? null : (this.feeds.get(source) ?? null);
	}

	/** The stream on show: the preferred one while it has a feed, else the latest publisher. */
	private shown(): object | null {
		if (this.preferred !== null && this.feeds.has(this.preferred)) return this.preferred;
		return this.order[this.order.length - 1] ?? null;
	}

	/**
	 * Says a jump landed on this card. A listening sidebar scrolls to it at
	 * once; one opened within a moment finds the name still waiting.
	 */
	spotlight(key: string): void {
		this.pending = { key, at: this.now() };
		this.notify({ kind: 'spotlight', key });
	}

	/** The card a recent jump named, once: the next asker finds nothing. */
	takeSpotlight(): string | null {
		const kept = this.pending;
		this.pending = null;
		if (kept === null || this.now() - kept.at > SPOTLIGHT_PATIENCE_MS) return null;
		return kept.key;
	}

	/**
	 * Says whose words the caret is in, or that it is in no card's. Only a
	 * change is passed on, so typing inside a card's words moves nothing.
	 */
	caret(key: string | null): void {
		if (this.caretKey === key) return;
		this.caretKey = key;
		this.notify({ kind: 'caret', key });
	}

	/** The card whose words hold the caret, for a sidebar opening now. */
	caretCard(): string | null {
		return this.caretKey;
	}

	/**
	 * Hears every change of what is on show, every spotlight and every move
	 * of the caret between cards. The return takes the listener off again.
	 */
	subscribe(listener: (event: MarginCardsEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(event: MarginCardsEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}
