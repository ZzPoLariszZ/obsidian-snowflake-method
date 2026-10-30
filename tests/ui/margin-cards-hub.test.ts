import { describe, expect, it } from 'vitest';

import { MarginCardsHub, type MarginCardsFeed } from '../../src/ui/margin-cards-hub';

const feed = (tight = false): MarginCardsFeed => ({
	segments: [],
	inView: new Set(),
	tight,
	locate: () => undefined,
});

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
		const heard: (string | null)[] = [];
		hub.subscribe((key) => heard.push(key));
		const source = {};
		hub.prefer(source);
		expect(heard).toEqual([]);
		hub.publish(source, feed());
		expect(heard).toEqual([null]);
		expect(hub.current()).not.toBeNull();
	});

	it('rings on every change and keeps a spotlight for a moment', () => {
		let now = 1000;
		const hub = new MarginCardsHub(() => now);
		const heard: (string | null)[] = [];
		const off = hub.subscribe((key) => heard.push(key));
		const source = {};
		hub.publish(source, feed());
		hub.spotlight('rev-1');
		expect(heard).toEqual([null, 'rev-1']);
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
});
