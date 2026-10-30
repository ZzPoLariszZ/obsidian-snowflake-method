import { describe, expect, it } from 'vitest';

import {
	MarginCardsHub,
	type MarginCardsEvent,
	type MarginCardsFeed,
} from '../../src/ui/margin-cards-hub';

const feed = (tight = false): MarginCardsFeed => ({
	segments: [],
	inView: new Set(),
	tight,
	locate: () => undefined,
});

/** An event as a short line, for a transcript to compare. */
const line = (event: MarginCardsEvent): string =>
	event.kind === 'feed' ? 'feed' : `${event.kind}:${event.key ?? '-'}`;

describe('the margin cards hub', () => {
	it('lists the latest publisher until a leaf is preferred', () => {
		const hub = new MarginCardsHub();
		const first = {};
		const second = {};
		const early = feed();
		const late = feed(true);
		hub.publish(first, early);
		hub.publish(second, late);
		expect(hub.current()).toBe(late);
		hub.prefer(first);
		expect(hub.current()).toBe(early);
		// A preferred stream that has closed gives way to whoever is left.
		hub.retire(first);
		expect(hub.current()).toBe(late);
		hub.retire(second);
		expect(hub.current()).toBeNull();
	});

	it('prefers a stream only once it has something to show', () => {
		const hub = new MarginCardsHub();
		const heard: string[] = [];
		hub.subscribe((event) => heard.push(line(event)));
		const source = {};
		hub.prefer(source);
		expect(heard).toEqual([]);
		hub.publish(source, feed());
		expect(heard).toEqual(['feed']);
		expect(hub.current()).not.toBeNull();
	});

	it('rings on every change and keeps a spotlight for a moment', () => {
		let now = 1000;
		const hub = new MarginCardsHub(() => now);
		const heard: string[] = [];
		const off = hub.subscribe((event) => heard.push(line(event)));
		const source = {};
		hub.publish(source, feed());
		hub.spotlight('rev-1');
		expect(heard).toEqual(['feed', 'spotlight:rev-1']);
		// Taken once: the next asker finds nothing.
		expect(hub.takeSpotlight()).toBe('rev-1');
		expect(hub.takeSpotlight()).toBeNull();
		// A name left too long is not acted on by a sidebar opened later.
		hub.spotlight('rev-2');
		now += 5000;
		expect(hub.takeSpotlight()).toBeNull();
		off();
		hub.retire(source);
		expect(heard).toHaveLength(3);
	});

	it('tells the caret’s card once per change, and answers for it later', () => {
		const hub = new MarginCardsHub();
		const heard: string[] = [];
		hub.subscribe((event) => heard.push(line(event)));
		expect(hub.caretCard()).toBeNull();
		hub.caret('rev-1');
		hub.caret('rev-1');
		expect(heard).toEqual(['caret:rev-1']);
		expect(hub.caretCard()).toBe('rev-1');
		hub.caret('fs:occ-1');
		hub.caret(null);
		hub.caret(null);
		expect(heard).toEqual(['caret:rev-1', 'caret:fs:occ-1', 'caret:-']);
		expect(hub.caretCard()).toBeNull();
	});
});
