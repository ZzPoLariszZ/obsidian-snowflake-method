import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyReplacements, passageContext, type TextRange } from '../../src/domain';
import {
	STREAM_SEARCH_LIMIT,
	StreamSearch,
	type MarkedPassage,
	type MarksLost,
	type ReplacePlanEntry,
	type StreamSearchCount,
	type StreamSearchHost,
} from '../../src/ui/stream-search';

const plain = { caseSensitive: false, wholeWord: false, regex: false };

/**
 * A manuscript as the search sees one: notes in reading order, some held on
 * the page and the rest in the Vault, with everything the search asks of the
 * page recorded.
 */
function manuscript(
	notes: Record<string, string>,
	options: {
		held?: readonly string[];
		readOnly?: readonly string[];
		marked?: readonly MarkedPassage[];
	} = {},
) {
	const texts = new Map(Object.entries(notes));
	const stamps = new Map([...texts.keys()].map((path) => [path, 1]));
	const held = new Set(options.held ?? []);
	const readOnly = new Set(options.readOnly ?? []);
	const record = {
		reads: [] as string[],
		paints: [] as { path: string; current: number | null }[],
		marks: [] as [string, number | null][],
		reveals: [] as { path: string; range: TextRange }[],
		counts: [] as StreamSearchCount[],
		asked: [] as (readonly ReplacePlanEntry[])[],
		askedMarked: [] as { path: string; lost: MarksLost }[],
		summaries: [] as { matches: number; notes: number }[],
		refused: [] as string[],
	};
	const state = {
		origin: null as { path: string; at: number } | null,
		shown: true,
		confirm: true,
	};
	let search: StreamSearch | null = null;
	// The timers the search keeps, on the clock the test controls.
	const win = {
		setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
		clearTimeout: (id: number) => {
			clearTimeout(id);
		},
	} as unknown as Window;
	const host: StreamSearchHost = {
		win,
		notes: () => [...texts.keys()],
		heldText: (path) => (held.has(path) ? (texts.get(path) ?? null) : null),
		stamp: (path) => {
			const stamp = stamps.get(path);
			return stamp === undefined ? null : String(stamp);
		},
		read: (path) => {
			record.reads.push(path);
			const body = texts.get(path);
			const stamp = stamps.get(path);
			return Promise.resolve(
				body === undefined || stamp === undefined ? null : { body, stamp: String(stamp) },
			);
		},
		paint: (path) => {
			record.paints.push({ path, current: search?.matchesFor(path)?.current ?? null });
		},
		markCurrent: (path, index) => {
			record.marks.push([path, index]);
		},
		isShown: () => state.shown,
		reveal: (path, range) => {
			record.reveals.push({ path, range });
			return Promise.resolve();
		},
		origin: () => state.origin,
		showCount: (count) => {
			record.counts.push(count);
		},
		writable: (path) => !readOnly.has(path),
		rewrite: (path, plan) => {
			const text = texts.get(path);
			if (text === undefined) return Promise.resolve(null);
			const changes = plan(text);
			if (changes.length === 0) return Promise.resolve(null);
			const next = applyReplacements(text, changes);
			texts.set(path, next);
			stamps.set(path, (stamps.get(path) ?? 0) + 1);
			return Promise.resolve({ text: next, count: changes.length });
		},
		markedPassages: () => Promise.resolve(options.marked ?? []),
		confirmReplaceMarked: (path, lost) => {
			record.askedMarked.push({ path, lost });
			return Promise.resolve(state.confirm);
		},
		confirmReplaceAll: (plan) => {
			record.asked.push(plan);
			return Promise.resolve(state.confirm);
		},
		replacedAll: ({ matches, notes: count }) => {
			record.summaries.push({ matches, notes: count });
		},
		refusedReadOnly: (path) => {
			record.refused.push(path);
		},
	};
	search = new StreamSearch(host);
	/** Writes a note as the Vault or the author would, moving its stamp. */
	const write = (path: string, text: string): void => {
		texts.set(path, text);
		stamps.set(path, (stamps.get(path) ?? 0) + 1);
	};
	const lastCount = (): StreamSearchCount | undefined => record.counts[record.counts.length - 1];
	return { search, record, state, texts, write, lastCount };
}

const book = {
	'one.md': 'Ash fell. The ash tree stood.',
	'two.md': 'No match here.',
	'three.md': 'An ash cart, an ash pile.',
};

/** Words of a book a revision or a foreshadowing occurrence marks, as stored. */
function marked(
	family: MarkedPassage['family'],
	path: keyof typeof book,
	words: string,
): MarkedPassage {
	const body = book[path];
	const from = body.indexOf(words);
	return {
		path,
		family,
		kind: 'replace',
		from,
		to: from + words.length,
		originalText: words,
		...passageContext(body, from, from + words.length),
	};
}

const nothingLost = { revisions: 0, occurrences: 0 };

describe('StreamSearch', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('searches every note, reading the ones off the page once', async () => {
		const { search, record, lastCount } = manuscript(book, { held: ['one.md'] });
		await search.setQuery('ash', plain);
		expect(lastCount()).toEqual({ kind: 'count', index: 1, total: 4, limited: false });
		expect(record.reads.sort()).toEqual(['three.md', 'two.md']);
		expect(record.counts).toContainEqual({ kind: 'busy' });
		await search.setQuery('cart', plain);
		// Nothing moved on disk, so nothing was read again.
		expect(record.reads).toHaveLength(2);
		expect(lastCount()).toEqual({ kind: 'count', index: 1, total: 1, limited: false });
	});

	it('lands on the first match at or after the reader, and moves the page only for a hidden one', async () => {
		const { search, record, state } = manuscript(book);
		state.origin = { path: 'one.md', at: 5 };
		await search.setQuery('ash', plain);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 14, to: 17 });
		expect(record.reveals).toEqual([]);
		state.shown = false;
		state.origin = { path: 'two.md', at: 0 };
		await search.setQuery('ash', plain);
		expect(search.currentMatch()).toEqual({ path: 'three.md', from: 3, to: 6 });
		expect(record.reveals).toEqual([{ path: 'three.md', range: { from: 3, to: 6 } }]);
	});

	it('walks the matches in reading order, round past either end', async () => {
		const { search, lastCount } = manuscript(book);
		await search.setQuery('ash', plain);
		const index = (): number | undefined => {
			const count = lastCount();
			return count?.kind === 'count' ? count.index : undefined;
		};
		expect(index()).toBe(1);
		await search.step(1);
		await search.step(1);
		expect(index()).toBe(3);
		await search.step(1);
		await search.step(1);
		expect(index()).toBe(1);
		await search.step(-1);
		expect(index()).toBe(4);
		expect(search.currentMatch()).toEqual({ path: 'three.md', from: 16, to: 19 });
	});

	it('replaces the match it stands on and goes on past the words put in', async () => {
		const { search, texts, lastCount } = manuscript(book, { held: ['one.md'] });
		await search.setQuery('ash', plain);
		// Words holding the query are not found again inside themselves.
		await search.replaceCurrent('Ashwood');
		expect(texts.get('one.md')).toBe('Ashwood fell. The ash tree stood.');
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 18, to: 21 });
		expect(lastCount()).toEqual({ kind: 'count', index: 2, total: 4, limited: false });
		await search.replaceCurrent('oak');
		expect(texts.get('one.md')).toBe('Ashwood fell. The oak tree stood.');
		expect(search.currentMatch()).toEqual({ path: 'three.md', from: 3, to: 6 });
	});

	it('goes on past a match that already reads as its replacement, writing nothing', async () => {
		const { search, texts } = manuscript(book);
		await search.setQuery('ash', plain);
		// The second match, "ash", is already what "ash" would put there.
		await search.step(1);
		await search.replaceCurrent('ash');
		expect(texts.get('one.md')).toBe(book['one.md']);
		expect(search.currentMatch()).toEqual({ path: 'three.md', from: 3, to: 6 });
	});

	it('counts and asks about only the matches a replacement changes', async () => {
		const { search, texts, record } = manuscript(book);
		await search.setQuery('ash', plain);
		await search.replaceAll('ash');
		expect(record.asked).toEqual([[{ path: 'one.md', count: 1, lost: nothingLost }]]);
		expect(texts.get('one.md')).toBe('ash fell. The ash tree stood.');
		expect(record.summaries).toEqual([{ matches: 1, notes: 1 }]);
		// Nothing left to change, nothing asked.
		await search.replaceAll('ash');
		expect(record.asked).toHaveLength(1);
	});

	it('expands a regular expression for the match it replaces', async () => {
		const { search, texts } = manuscript({ 'one.md': 'Smith, Jane and Doe, John' });
		await search.setQuery('(\\w+), (\\w+)', { ...plain, regex: true });
		await search.replaceCurrent('$2 $1');
		expect(texts.get('one.md')).toBe('Jane Smith and Doe, John');
	});

	it('leaves a read-only note as it is, says so, and goes on', async () => {
		const { search, texts, record } = manuscript(book, { readOnly: ['one.md'] });
		await search.setQuery('ash', plain);
		await search.replaceCurrent('oak');
		expect(texts.get('one.md')).toBe(book['one.md']);
		expect(record.refused).toEqual(['one.md']);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 14, to: 17 });
	});

	it('asks before replacing them all, and leaves everything on a no', async () => {
		const { search, texts, record, state } = manuscript(book, { readOnly: ['three.md'] });
		await search.setQuery('ash', plain);
		state.confirm = false;
		await search.replaceAll('oak');
		expect(record.asked).toEqual([[{ path: 'one.md', count: 2, lost: nothingLost }]]);
		expect(texts.get('one.md')).toBe(book['one.md']);
		state.confirm = true;
		await search.replaceAll('oak');
		expect(texts.get('one.md')).toBe('oak fell. The oak tree stood.');
		expect(texts.get('three.md')).toBe(book['three.md']);
		expect(record.summaries).toEqual([{ matches: 2, notes: 1 }]);
	});

	it('asks before a replacement breaks marked words, and leaves the match where it is on a no', async () => {
		const { search, texts, record, state } = manuscript(book, {
			held: ['one.md'],
			marked: [marked('revision', 'one.md', 'ash tree'), marked('foreshadowing', 'one.md', 'Ash fell')],
		});
		await search.setQuery('ash', plain);
		state.confirm = false;
		await search.replaceCurrent('oak');
		expect(record.askedMarked).toEqual([
			{ path: 'one.md', lost: { revisions: 0, occurrences: 1 } },
		]);
		expect(texts.get('one.md')).toBe(book['one.md']);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 0, to: 3 });
		state.confirm = true;
		await search.replaceCurrent('oak');
		expect(texts.get('one.md')).toBe('oak fell. The ash tree stood.');
		await search.replaceCurrent('oak');
		expect(record.askedMarked[2]).toEqual({
			path: 'one.md',
			lost: { revisions: 1, occurrences: 0 },
		});
		// Words outside every mark are replaced without asking.
		expect(search.currentMatch()?.path).toBe('three.md');
		await search.replaceCurrent('oak');
		expect(record.askedMarked).toHaveLength(3);
		expect(texts.get('three.md')).toBe('An oak cart, an ash pile.');
	});

	it('counts the marks replacing them all would break, note by note', async () => {
		const { search, record, state } = manuscript(book, {
			marked: [
				marked('revision', 'one.md', 'ash tree'),
				marked('foreshadowing', 'three.md', 'cart'),
				marked('foreshadowing', 'three.md', 'an ash pile'),
			],
		});
		await search.setQuery('ash', plain);
		state.confirm = false;
		await search.replaceAll('oak');
		expect(record.asked).toEqual([
			[
				{ path: 'one.md', count: 2, lost: { revisions: 1, occurrences: 0 } },
				{ path: 'three.md', count: 2, lost: { revisions: 0, occurrences: 1 } },
			],
		]);
	});

	it('keeps to its match through typing ahead of it, and draws its ring after', async () => {
		const { search, write, record } = manuscript(book, { held: ['one.md'] });
		await search.setQuery('tree', plain);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 18, to: 22 });
		write('one.md', 'Soft ash fell. The ash tree stood.');
		search.noteEdited('one.md');
		vi.advanceTimersByTime(500);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 23, to: 27 });
		expect(record.paints[record.paints.length - 1]).toEqual({ path: 'one.md', current: 0 });
	});

	it('keeps to its match through words taken out ahead of it, and replaces that one', async () => {
		const { search, write, texts } = manuscript({ 'one.md': 'ash tree ash bush ash leaf' }, { held: ['one.md'] });
		await search.setQuery('ash', plain);
		await search.step(1);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 9, to: 12 });
		// "tree " deleted: the editor says where every position went.
		write('one.md', 'ash ash bush ash leaf');
		search.noteEdited('one.md', (pos) => (pos <= 4 ? pos : pos >= 9 ? pos - 5 : 4));
		vi.advanceTimersByTime(500);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 4, to: 7 });
		await search.replaceCurrent('oak');
		expect(texts.get('one.md')).toBe('ash oak bush ash leaf');
	});

	it('settles its match before drawing a note a refresh found changed', async () => {
		const { search, write, record } = manuscript(book);
		await search.setQuery('ash', plain);
		await search.step(1);
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 14, to: 17 });
		write('one.md', 'Then ash fell. The ash tree stood.');
		await search.reconcile();
		expect(search.currentMatch()).toEqual({ path: 'one.md', from: 19, to: 22 });
		expect(record.paints[record.paints.length - 1]).toEqual({ path: 'one.md', current: 1 });
	});

	it('reads again only the note whose stamp moved', async () => {
		const { search, write, record, lastCount } = manuscript(book);
		await search.setQuery('ash', plain);
		record.reads.length = 0;
		write('two.md', 'Now an ash here too.');
		await search.reconcile();
		expect(record.reads).toEqual(['two.md']);
		expect(lastCount()).toEqual({ kind: 'count', index: 1, total: 5, limited: false });
	});

	it('says why an expression will not read, and draws nothing', async () => {
		const { search, lastCount } = manuscript(book);
		await search.setQuery('(ash', { ...plain, regex: true });
		const count = lastCount();
		expect(count?.kind).toBe('error');
		expect(search.isActive()).toBe(false);
		expect(search.matchesFor('one.md')).toBeNull();
	});

	it('takes every match off when the bar closes', async () => {
		const { search, record } = manuscript(book);
		await search.setQuery('ash', plain);
		record.paints.length = 0;
		search.close();
		expect(record.paints.map((paint) => paint.path).sort()).toEqual([
			'one.md',
			'three.md',
			'two.md',
		]);
		expect(record.paints.every((paint) => paint.current === null)).toBe(true);
		expect(search.matchesFor('one.md')).toBeNull();
		expect(search.currentMatch()).toBeNull();
	});

	it('stops counting at the limit and says there are more', async () => {
		const many = 'a '.repeat(STREAM_SEARCH_LIMIT + 10);
		const { search, lastCount } = manuscript({ 'one.md': many, 'two.md': 'a' });
		await search.setQuery('a', plain);
		expect(lastCount()).toEqual({
			kind: 'count',
			index: 1,
			total: STREAM_SEARCH_LIMIT,
			limited: true,
		});
	});
});
