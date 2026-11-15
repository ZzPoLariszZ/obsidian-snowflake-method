import { describe, expect, it } from 'vitest';

import { ContentsHub, type ContentsFeed, type ContentsRow } from '../../src/ui/contents-hub';

const rows = (count: number): ContentsRow[] =>
	Array.from({ length: count }, (_, at) => ({
		path: `Novel/50_Manuscript/Chapter ${String(at + 1)}.md`,
		title: `Chapter ${String(at + 1)}`,
	}));

const feed = (
	list: readonly ContentsRow[],
	active: string | null = null,
	reach = 5,
): ContentsFeed => ({
	rows: list,
	active,
	reach,
	editable: true,
	go: () => undefined,
	menu: () => undefined,
	rename: () => undefined,
	remove: () => undefined,
});

describe('the contents hub', () => {
	it('shows the latest publisher until a leaf is preferred', () => {
		const hub = new ContentsHub();
		const first = {};
		const second = {};
		const early = feed(rows(2));
		const late = feed(rows(3));
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
		const hub = new ContentsHub();
		let heard = 0;
		hub.subscribe(() => {
			heard += 1;
		});
		const source = {};
		hub.prefer(source);
		expect(heard).toBe(0);
		hub.publish(source, feed(rows(1)));
		expect(heard).toBe(1);
		expect(hub.current()).not.toBeNull();
	});

	it('rings for a chapter, a list or a reach that moved, and for nothing else', () => {
		const hub = new ContentsHub();
		let heard = 0;
		hub.subscribe(() => {
			heard += 1;
		});
		const source = {};
		const list = rows(3);
		hub.publish(source, feed(list, list[0]?.path));
		expect(heard).toBe(1);
		// A stream publishes on every move of its window: the same chapters,
		// the same one in front and the same reach say nothing new.
		hub.publish(source, feed(list, list[0]?.path));
		expect(heard).toBe(1);
		hub.publish(source, feed(list, list[1]?.path));
		expect(heard).toBe(2);
		hub.publish(source, feed(list, list[1]?.path, 3));
		expect(heard).toBe(3);
		// The same names in a list drawn afresh are a new list.
		const fresh = rows(3);
		hub.publish(source, feed(fresh, list[1]?.path, 3));
		expect(heard).toBe(4);
		// A manuscript that may no longer be written to is news as well: its
		// rows stop offering what can be done to a chapter.
		hub.publish(source, { ...feed(fresh, list[1]?.path, 3), editable: false });
		expect(heard).toBe(5);
		hub.publish(source, { ...feed(fresh, list[1]?.path, 3), editable: false });
		expect(heard).toBe(5);
	});

	it('keeps a stream behind the one on show quiet, and hears it once it is in front', () => {
		const hub = new ContentsHub();
		const front = {};
		const behind = {};
		const shown = feed(rows(2));
		hub.publish(behind, feed(rows(4)));
		hub.publish(front, shown);
		hub.prefer(front);
		let heard = 0;
		hub.subscribe(() => {
			heard += 1;
		});
		// The stream behind turns a page: the wheel on show is the front one's.
		hub.publish(behind, feed(rows(4), 'Novel/50_Manuscript/Chapter 2.md'));
		expect(heard).toBe(0);
		expect(hub.current()).toBe(shown);
		hub.prefer(behind);
		expect(heard).toBe(1);
		expect(hub.current()?.active).toBe('Novel/50_Manuscript/Chapter 2.md');
	});

	it('goes quiet for a listener taken off, and says nothing of a stream it never held', () => {
		const hub = new ContentsHub();
		let heard = 0;
		const release = hub.subscribe(() => {
			heard += 1;
		});
		hub.retire({});
		expect(heard).toBe(0);
		release();
		hub.publish({}, feed(rows(1)));
		expect(heard).toBe(0);
	});
});
