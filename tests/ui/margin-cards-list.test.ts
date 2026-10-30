// @vitest-environment happy-dom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { captureRevision } from '../../src/domain';
import {
	MarginCardsHub,
	type MarginCardsFeed,
	type MarginCardsSegment,
} from '../../src/ui/margin-cards-hub';
import { marginCardsLens, renderMarginCardsList, throughLens } from '../../src/ui/margin-cards-list';
import type { RevisionRailCallbacks, RevisionRailModel } from '../../src/ui/revision-cards';
import { installObsidianDom } from '../helpers/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	/** A search box that is a real input, so a test can type into it. */
	class SearchComponent {
		readonly inputEl: HTMLInputElement;

		constructor(container: HTMLElement) {
			const box = container.createDiv({ cls: 'search-input-container' });
			this.inputEl = box.createEl('input', { attr: { type: 'search' } });
		}

		setPlaceholder(text: string): this {
			this.inputEl.placeholder = text;
			return this;
		}

		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}

		onChange(handler: (value: string) => void): this {
			this.inputEl.addEventListener('input', () => {
				handler(this.inputEl.value);
			});
			return this;
		}
	}
	return {
		...runtime,
		SearchComponent,
		setTooltip: (el: HTMLElement, text: string) => {
			el.setAttribute('data-tooltip', text);
		},
	};
});

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

const thread = {
	id: 'fs-1',
	name: 'The watch',
	description: 'A pocket watch that stops',
	status: 'active' as const,
	related: [],
	createdAt: 1,
	updatedAt: 1,
	occurrences: [],
};
const occurrence = {
	id: 'occ-1',
	role: 'plant' as const,
	note: 'first seen',
	path: '50/one.md',
	from: 30,
	to: 38,
	originalText: 'watching',
	before: 'shallows, ',
	after: ' the wat',
};

const model = (): RevisionRailModel => ({
	entries: [{ revision, top: 10 }],
	conflicts: [],
	draft: null,
	readOnly: false,
	foreshadowing: {
		entries: [{ item: thread, occurrence, top: 40 }],
		unresolved: [],
	},
});

const segment = (shared: RevisionRailCallbacks, title = 'One'): MarginCardsSegment => ({
	path: '50/one.md',
	title,
	model: model(),
	callbacks: shared,
});

const keysIn = (host: HTMLElement): (string | null)[] =>
	[...host.querySelectorAll('.snowflake-method-rail-card')].map((card) =>
		card.getAttribute('data-snowflake-method-card'),
	);

const type = (host: HTMLElement, text: string): void => {
	const input = host.querySelector<HTMLInputElement>('.search-input-container input');
	if (input === null) throw new Error('no search box');
	input.value = text;
	input.dispatchEvent(new Event('input'));
};

describe('the lens', () => {
	it('keeps the kinds asked for that print the words searched for', () => {
		const all = throughLens(model(), marginCardsLens());
		expect(keysOf(all)).toEqual(['rev-1', 'occ-1']);
		expect(keysOf(throughLens(model(), { query: 'WHY', kind: 'all' }))).toEqual(['rev-1']);
		expect(keysOf(throughLens(model(), { query: 'pocket', kind: 'all' }))).toEqual(['occ-1']);
		expect(keysOf(throughLens(model(), { query: 'first seen', kind: 'all' }))).toEqual(['occ-1']);
		expect(keysOf(throughLens(model(), { query: '', kind: 'revisions' }))).toEqual(['rev-1']);
		expect(keysOf(throughLens(model(), { query: 'watch', kind: 'revisions' }))).toEqual([]);
		expect(keysOf(throughLens(model(), { query: '', kind: 'foreshadowing' }))).toEqual(['occ-1']);
	});
});

const keysOf = (narrowed: RevisionRailModel): string[] => [
	...narrowed.entries.map((entry) => entry.revision.id),
	...narrowed.conflicts.map((entry) => entry.id),
	...narrowed.foreshadowing.entries.map((entry) => entry.occurrence.id),
	...narrowed.foreshadowing.unresolved.map((entry) => entry.occurrence.id),
];

describe('the margin card sidebar', () => {
	const scrolled: { el: Element; block: string }[] = [];

	beforeAll(() => {
		installObsidianDom(window);
		if (!('activeDocument' in window)) {
			Object.defineProperty(window, 'activeDocument', { value: document, configurable: true });
		}
		vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
			this: Element,
			options?: boolean | ScrollIntoViewOptions,
		): void {
			scrolled.push({
				el: this,
				block: typeof options === 'object' ? String(options.block) : 'start',
			});
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
		const band = host.querySelector<HTMLElement>('.snowflake-method-margin-cards-controls');
		expect(empty?.hidden).toBe(false);
		expect(empty?.textContent).toContain('marginCards.noStream');
		expect(band?.hidden).toBe(true);
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
		expect(band?.hidden).toBe(false);
		// The band stands over the column; the chapters scroll under it.
		const scroll = host.querySelector('.snowflake-method-margin-cards-scroll');
		expect(scroll?.contains(band)).toBe(false);
		expect(scroll?.querySelector('.snowflake-method-margin-cards-chapter')).not.toBeNull();
		expect(host.querySelector('.snowflake-method-margin-cards-title')?.textContent).toBe('One');
		expect(keysIn(host)).toEqual(['rev-1', 'fs:occ-1']);
		const card = host.querySelector<HTMLElement>('.snowflake-method-rail-card');
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
		expect(band?.hidden).toBe(true);
		hub.retire(source);
		expect(empty?.textContent).toContain('marginCards.noStream');
		dispose();
		expect(host.querySelector('.snowflake-method-margin-cards')).toBeNull();
	});

	it('narrows the column by the words typed and the kind picked', () => {
		const hub = new MarginCardsHub();
		const host = document.body.createDiv();
		const lens = marginCardsLens();
		const { dispose } = renderMarginCardsList(
			host,
			{ hub, t: (key: string) => key, stepAside: () => undefined },
			lens,
		);
		const source = {};
		hub.publish(source, {
			segments: [segment(callbacks())],
			inView: new Set(),
			tight: false,
			locate: () => undefined,
		});
		const empty = host.querySelector<HTMLElement>('.snowflake-method-character-empty');
		const state = host.querySelector<HTMLElement>('.snowflake-method-prose-state');
		const chapter = host.querySelector<HTMLElement>('.snowflake-method-margin-cards-chapter');
		expect(state?.textContent).toBe('');
		type(host, 'why');
		expect(lens.query).toBe('why');
		expect(keysIn(host)).toEqual(['rev-1']);
		expect(state?.textContent).toBe('table.filteredCount');
		expect(chapter?.hidden).toBe(false);
		// Words no card prints: the chapter stands down and the column says so.
		type(host, 'zebra');
		expect(keysIn(host)).toEqual([]);
		expect(chapter?.hidden).toBe(true);
		expect(empty?.hidden).toBe(false);
		expect(empty?.textContent).toContain('marginCards.noMatch');
		type(host, '');
		expect(keysIn(host)).toEqual(['rev-1', 'fs:occ-1']);
		expect(empty?.hidden).toBe(true);
		// The funnel: a kind, a draft until confirmed, and reset lets go.
		const filter = host.querySelector<HTMLButtonElement>('.snowflake-method-margin-cards-filter');
		expect(filter?.getAttribute('data-tooltip')).toBe('table.filter');
		filter?.click();
		const panel = document.body.querySelector<HTMLElement>('.snowflake-method-margin-cards-filter-panel');
		expect(filter?.getAttribute('aria-expanded')).toBe('true');
		const pick = panel?.querySelector<HTMLSelectElement>('select.dropdown');
		expect([...(pick?.options ?? [])].map((option) => option.value)).toEqual([
			'all',
			'revisions',
			'foreshadowing',
		]);
		if (pick) pick.value = 'foreshadowing';
		panel?.querySelector<HTMLButtonElement>('.mod-cta')?.click();
		expect(lens.kind).toBe('foreshadowing');
		expect(filter?.classList.contains('is-active')).toBe(true);
		expect(filter?.getAttribute('aria-expanded')).toBe('false');
		expect(document.body.querySelector('.snowflake-method-margin-cards-filter-panel')).toBeNull();
		expect(keysIn(host)).toEqual(['fs:occ-1']);
		filter?.click();
		const again = document.body.querySelector<HTMLElement>('.snowflake-method-margin-cards-filter-panel');
		again?.querySelector<HTMLButtonElement>('.snowflake-method-filter-reset')?.click();
		again?.querySelector<HTMLButtonElement>('.mod-cta')?.click();
		expect(lens.kind).toBe('all');
		expect(filter?.classList.contains('is-active')).toBe(false);
		expect(keysIn(host)).toEqual(['rev-1', 'fs:occ-1']);
		dispose();
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
		expect(scrolled).toEqual([{ el: card, block: 'center' }]);
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

	it('marks the card whose words hold the caret and keeps it in view', () => {
		const hub = new MarginCardsHub();
		const source = {};
		hub.publish(source, {
			segments: [segment(callbacks())],
			inView: new Set(),
			tight: false,
			locate: () => undefined,
		});
		hub.caret('fs:occ-1');
		const host = document.body.createDiv();
		const { dispose, reveal } = renderMarginCardsList(host, {
			hub,
			t: (key: string) => key,
			stepAside: () => undefined,
		});
		const cards = [...host.querySelectorAll<HTMLElement>('.snowflake-method-rail-card')];
		// Opened with the caret already in a card's words, the column marks it.
		expect(cards.map((card) => card.classList.contains('is-caret'))).toEqual([false, true]);
		hub.caret('rev-1');
		expect(cards.map((card) => card.classList.contains('is-caret'))).toEqual([true, false]);
		expect(scrolled).toEqual([{ el: cards[0], block: 'nearest' }]);
		// Out of every card's words: no mark, and nothing scrolled.
		hub.caret(null);
		expect(cards.some((card) => card.classList.contains('is-caret'))).toBe(false);
		expect(scrolled).toHaveLength(1);
		// A drawer put away does not scroll, and opening it brings the
		// caret's card into view once.
		const root = host.querySelector<HTMLElement>('.snowflake-method-margin-cards') as HTMLElement;
		root.hidden = true;
		reveal();
		hub.caret('fs:occ-1');
		expect(scrolled).toHaveLength(1);
		root.hidden = false;
		reveal();
		expect(scrolled).toEqual([
			{ el: cards[0], block: 'nearest' },
			{ el: cards[1], block: 'nearest' },
		]);
		reveal();
		expect(scrolled).toHaveLength(2);
		dispose();
	});
});
