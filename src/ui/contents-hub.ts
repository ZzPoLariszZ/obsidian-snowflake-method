/** One chapter as the wheel lists it: the note, and the name it goes by. */
export interface ContentsRow {
	path: string;
	title: string;
}

/** What one stream has to show the contents sidebar. */
export interface ContentsFeed {
	/**
	 * Every chapter of the manuscript, in reading order. The same array for
	 * as long as the manuscript keeps its shape, so a wheel that holds it
	 * can tell a new list from the old one by looking at nothing else.
	 */
	rows: readonly ContentsRow[];
	/** The chapter the page stands in, or null before it stands anywhere. */
	active: string | null;
	/** How many chapters the wheel shows on either side of that one. */
	reach: number;
	/** Whether the chapters may be renamed and deleted: not in a manuscript that may not be written to. */
	editable: boolean;
	/** Brings a chapter's start to the top of the page. */
	go(path: string): void;
	/** Opens what can be done to a chapter itself, where a right-click or a long press asked. */
	menu(path: string, event: MouseEvent): void;
	/** Asks the author for a chapter's new name. */
	rename(path: string): void;
	/** Asks the author whether a chapter is to be deleted. */
	remove(path: string): void;
}

/**
 * The bell between the manuscript streams and the contents sidebar, after
 * the margin cards' own. Each stream publishes its chapters and the one its
 * page stands in whenever either moves, and the sidebar turns its wheel to
 * the feed of one of them: the stream whose leaf was last in front, or
 * failing that the one that last published. A stream closing takes its
 * feed with it.
 */
export class ContentsHub {
	private readonly feeds = new Map<object, ContentsFeed>();
	private readonly order: object[] = [];
	private preferred: object | null = null;
	private readonly listeners = new Set<() => void>();

	publish(source: object, feed: ContentsFeed): void {
		const before = this.current();
		this.feeds.set(source, feed);
		const at = this.order.indexOf(source);
		if (at >= 0) this.order.splice(at, 1);
		this.order.push(source);
		// A stream publishes on every move of its window, most of which
		// change nothing the wheel on show reads.
		const after = this.current();
		if (
			before !== null &&
			after !== null &&
			before.rows === after.rows &&
			before.active === after.active &&
			before.reach === after.reach &&
			before.editable === after.editable
		) {
			return;
		}
		this.notify();
	}

	/** Names the stream whose leaf is in front; its feed is the one shown. */
	prefer(source: object): void {
		if (this.preferred === source) return;
		this.preferred = source;
		if (this.feeds.has(source)) this.notify();
	}

	retire(source: object): void {
		if (!this.feeds.delete(source)) return;
		const at = this.order.indexOf(source);
		if (at >= 0) this.order.splice(at, 1);
		if (this.preferred === source) this.preferred = null;
		this.notify();
	}

	/** The feed on show: the preferred stream's while it has one, else the latest. */
	current(): ContentsFeed | null {
		const source = this.shown();
		return source === null ? null : (this.feeds.get(source) ?? null);
	}

	private shown(): object | null {
		if (this.preferred !== null && this.feeds.has(this.preferred)) return this.preferred;
		return this.order[this.order.length - 1] ?? null;
	}

	/** Hears every change of what is on show. The return takes the listener off again. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notify(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
