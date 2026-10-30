// @vitest-environment happy-dom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { captureRevision } from '../../src/domain';
import { MarginCardsHub, type MarginCardsFeed, type MarginCardsSegment } from '../../src/ui/margin-cards-hub';
import { renderMarginCardsList } from '../../src/ui/margin-cards-list';
import type { RevisionRailCallbacks } from '../../src/ui/revision-cards';
import { installObsidianDom } from '../helpers/obsidian-dom';

const BODY = 'The grey heron stood in the shallows, watching the water.';

const callbacks = (): RevisionRailCallbacks => ({
	t: (key: string) => key,
	onAccept: () => undefined,
	onRetire: () => undefined,
	onEditSave: () => Promise.resolve(true),
	onDraftSave: () => Promise.resolve(true),
	onDraftCancel: () => undefined,
	hasNeighbour: () => false,
	onJump: () => undefined,
	foreshadowing: {
		onEditSave: () => Promise.resolve(true),
		onDelete: () => undefined,
		onOpen: () => undefined,
		hasNeighbour: () => false,
		onJump: () => undefined,
	},
});

const revision = captureRevision('50/one.md', BODY, 'replace', 4, 14, 'x', 'why', 'rev-1', 7);

const segment = (shared: RevisionRailCallbacks, title = 'One'): MarginCardsSegment => ({
	path: '50/one.md',
	title,
	model: {
		entries: [{ revision, top: 10 }],
		conflicts: [],
		draft: null,
		readOnly: false,
		foreshadowing: { entries: [], unresolved: [] },
	},
	callbacks: shared,
});

describe('the margin card sidebar', () => {
	const scrolled: Element[] = [];

	beforeAll(() => {
		installObsidianDom(window);
		vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element): void {
			scrolled.push(this);
		});
	});

	afterEach(() => {
		scrolled.length = 0;
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	it('lists the feed’s chapters and their cards, and says when there is nothing', () => {
		const hub = new MarginCardsHub();
		const host = document.body.createDiv();
		const asides: number[] = [];
		const located: string[] = [];
		const { dispose } = renderMarginCardsList(host, {
			hub,
			t: (key: string) => key,
			stepAside: () => asides.push(1),
		});
		const empty = host.querySelector<HTMLElement>('.snowflake-method-character-empty');
		expect(empty?.hidden).toBe(false);
		expect(empty?.textContent).toContain('marginCards.noStream');
		const source = {};
		const shared = callbacks();
		const feed: MarginCardsFeed = {
			segments: [segment(shared)],
			inView: new Set(['rev-1']),
			tight: true,
			locate: (path, key) => located.push(`${path}:${key}`),
		};
		hub.publish(source, feed);
		expect(empty?.hidden).toBe(true);
		expect(host.querySelector('.snowflake-method-margin-cards-title')?.textContent).toBe('One');
		const card = host.querySelector<HTMLElement>('.snowflake-method-rail-card');
		expect(card?.getAttribute('data-snowflake-method-card')).toBe('rev-1');
		expect(card?.classList.contains('is-in-view')).toBe(true);
		// The way to the words steps aside first, then asks the stream.
		card?.querySelector<HTMLButtonElement>('.snowflake-method-rail-locate')?.click();
		expect(asides).toEqual([1]);
		expect(located).toEqual(['50/one.md:rev-1']);
		// Scrolled off, the stripe rests; renamed, the heading follows.
		hub.publish(source, { ...feed, inView: new Set(), segments: [segment(shared, 'Uno')] });
		expect(card?.classList.contains('is-in-view')).toBe(false);
		expect(host.querySelector('.snowflake-method-margin-cards-title')?.textContent).toBe('Uno');
		expect(host.querySelector('.snowflake-method-rail-card')).toBe(card);
		// A chapter that left the page takes its cards with it.
		hub.publish(source, { ...feed, segments: [] });
		expect(host.querySelector('.snowflake-method-rail-card')).toBeNull();
		expect(empty?.hidden).toBe(false);
		expect(empty?.textContent).toContain('marginCards.none');
		hub.retire(source);
		expect(empty?.textContent).toContain('marginCards.noStream');
		dispose();
		expect(host.querySelector('.snowflake-method-margin-cards')).toBeNull();
	});

	it('scrolls to the card a jump named, even one named just before it opened', () => {
		const hub = new MarginCardsHub();
		const source = {};
		hub.publish(source, {
			segments: [segment(callbacks())],
			inView: new Set(),
			tight: true,
			locate: () => undefined,
		});
		hub.spotlight('rev-1');
		const host = document.body.createDiv();
		const { dispose, reveal } = renderMarginCardsList(host, {
			hub,
			t: (key: string) => key,
			stepAside: () => undefined,
		});
		const card = host.querySelector<HTMLElement>('.snowflake-method-rail-card');
		expect(scrolled).toEqual([card]);
		expect(card?.classList.contains('is-jumped')).toBe(true);
		hub.spotlight('rev-1');
		expect(scrolled).toHaveLength(2);
		// A card the column does not hold is no error.
		hub.spotlight('rev-9');
		expect(scrolled).toHaveLength(2);
		// In a drawer put away the column has no layout to scroll in: the
		// name waits for the drawer to open, and a reveal with nothing
		// waiting scrolls nothing.
		reveal();
		expect(scrolled).toHaveLength(2);
		const root = host.querySelector<HTMLElement>('.snowflake-method-margin-cards') as HTMLElement;
		root.hidden = true;
		hub.spotlight('rev-1');
		expect(scrolled).toHaveLength(2);
		reveal();
		expect(scrolled).toHaveLength(2);
		root.hidden = false;
		reveal();
		expect(scrolled).toHaveLength(3);
		reveal();
		expect(scrolled).toHaveLength(3);
		dispose();
	});
});
