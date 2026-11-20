import { describe, expect, it } from 'vitest';

import { sameData } from '../../src/ui/same-data';

/**
 * A dashboard asks this of a model just read against the one it has drawn.
 * A wrong yes would leave a stale frame on show, so every doubt is a no.
 */
describe('whether two values hold the same data', () => {
	it('says yes for the same primitives, and no across kinds', () => {
		expect(sameData(1, 1)).toBe(true);
		expect(sameData('a', 'a')).toBe(true);
		expect(sameData(null, null)).toBe(true);
		expect(sameData(undefined, undefined)).toBe(true);
		expect(sameData(Number.NaN, Number.NaN)).toBe(true);
		expect(sameData(1, '1')).toBe(false);
		expect(sameData(0, false)).toBe(false);
		expect(sameData(null, undefined)).toBe(false);
		expect(sameData(null, {})).toBe(false);
		expect(sameData(0, -0)).toBe(false);
	});

	it('walks arrays and plain objects, and stops at the first difference', () => {
		const model = (): unknown => ({
			path: 'Novel/Project.md',
			steps: [{ id: 1, status: 'done' }, { id: 2, status: 'in-progress' }],
			stepRevisions: { 2: 'r2', 6: 'r6' },
			scenes: [],
			note: null,
		});
		expect(sameData(model(), model())).toBe(true);
		const moved = model() as { stepRevisions: Record<number, string> };
		moved.stepRevisions[6] = 'r7';
		// A revision is drawn nowhere and decides whether a save is taken.
		expect(sameData(model(), moved)).toBe(false);
		expect(sameData([1, 2, 3], [1, 2])).toBe(false);
		expect(sameData([1, 2, 3], [1, 3, 2])).toBe(false);
		expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(sameData({ a: undefined }, { b: undefined })).toBe(false);
		expect(sameData([], {})).toBe(false);
		expect(sameData({ a: [] }, { a: {} })).toBe(false);
	});

	it('does not mind the order an object’s keys were written in', () => {
		expect(sameData({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
	});

	it('reads maps, sets and dates by what they hold', () => {
		expect(sameData(new Map([['a', { n: 1 }]]), new Map([['a', { n: 1 }]]))).toBe(true);
		expect(sameData(new Map([['a', { n: 1 }]]), new Map([['a', { n: 2 }]]))).toBe(false);
		expect(sameData(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false);
		expect(sameData(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
		expect(sameData(new Set(['a']), new Set(['b']))).toBe(false);
		expect(sameData(new Date(5), new Date(5))).toBe(true);
		expect(sameData(new Date(5), new Date(6))).toBe(false);
		expect(sameData(new Map(), new Set())).toBe(false);
	});

	it('takes a function or an instance of a class for itself alone', () => {
		class File {
			constructor(readonly path: string) {}
		}
		const file = new File('a.md');
		const run = (): void => undefined;
		expect(sameData({ file, run }, { file, run })).toBe(true);
		expect(sameData({ file }, { file: new File('a.md') })).toBe(false);
		expect(sameData({ run }, { run: (): void => undefined })).toBe(false);
	});

	it('calls a value that loops back on itself different rather than walking it for ever', () => {
		const one: { self?: unknown } = {};
		one.self = one;
		const other: { self?: unknown } = {};
		other.self = other;
		expect(sameData(one, other)).toBe(false);
		expect(sameData(one, one)).toBe(true);
	});
});
