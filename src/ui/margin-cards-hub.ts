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

/** How long a spotlight waits for a sidebar that is still opening. */
/** How long a card's name waits for a sidebar that cannot show it yet. */
export const SPOTLIGHT_PATIENCE_MS = 3000;

/**
 * The bell between the manuscript streams and the margin card sidebar. Each
 * stream publishes what its rails hold whenever they change, and the
 * sidebar lists the feed of one of them: the stream whose leaf was last in
 * front, or failing that the one that last published. A stream closing
 * takes its feed with it. A jump that landed on a card names it here as
 * well, so the sidebar can scroll to it, and the name waits a moment for a
 * sidebar being opened for it.
 */
export class MarginCardsHub {
	private readonly feeds = new Map<object, MarginCardsFeed>();
	private readonly order: object[] = [];
	private preferred: object | null = null;
	private readonly listeners = new Set<(spotlight: string | null) => void>();
	private pending: { key: string; at: number } | null = null;

	constructor(private readonly now: () => number = () => Date.now()) {}

	publish(source: object, feed: MarginCardsFeed): void {
		this.feeds.set(source, feed);
		const at = this.order.indexOf(source);
		if (at >= 0) this.order.splice(at, 1);
		this.order.push(source);
		this.notify(null);
	}

	/** Names the stream whose leaf is in front; its feed is the one listed. */
	prefer(source: object): void {
		if (this.preferred === source) return;
		this.preferred = source;
		if (this.feeds.has(source)) this.notify(null);
	}

	retire(source: object): void {
		if (!this.feeds.delete(source)) return;
		const at = this.order.indexOf(source);
		if (at >= 0) this.order.splice(at, 1);
		if (this.preferred === source) this.preferred = null;
		this.notify(null);
	}

	/** The feed on show: the preferred stream's while it has one, else the latest. */
	current(): MarginCardsFeed | null {
		if (this.preferred !== null) {
			const feed = this.feeds.get(this.preferred);
			if (feed !== undefined) return feed;
		}
		const latest = this.order[this.order.length - 1];
		return latest === undefined ? null : (this.feeds.get(latest) ?? null);
	}

	/**
	 * Says a jump landed on this card. A listening sidebar scrolls to it at
	 * once; one opened within a moment finds the name still waiting.
	 */
	spotlight(key: string): void {
		this.pending = { key, at: this.now() };
		this.notify(key);
	}

	/** The card a recent jump named, once: the next asker finds nothing. */
	takeSpotlight(): string | null {
		const kept = this.pending;
		this.pending = null;
		if (kept === null || this.now() - kept.at > SPOTLIGHT_PATIENCE_MS) return null;
		return kept.key;
	}

	/**
	 * Hears every change of what is on show, with null, and every spotlight,
	 * with the card's key. The return takes the listener off again.
	 */
	subscribe(listener: (spotlight: string | null) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(spotlight: string | null): void {
		for (const listener of [...this.listeners]) listener(spotlight);
	}
}
