import { describe, expect, it } from 'vitest';

import { refreshLoop } from '../../src/ui/refresh-loop';

/** A read the test resolves or rejects by hand. */
const pending = <T,>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the read-and-paint loop', () => {
	it('reads once at a time and replays a refresh asked for meanwhile', async () => {
		const reads: ReturnType<typeof pending<number>>[] = [];
		const painted: number[] = [];
		const loop = refreshLoop<number>({
			read: () => {
				const read = pending<number>();
				reads.push(read);
				return read.promise;
			},
			onRead: (next) => painted.push(next),
			onFail: () => painted.push(-1),
		});
		loop.refresh();
		loop.refresh();
		loop.refresh();
		expect(reads).toHaveLength(1);
		expect(loop.loading).toBe(true);
		reads[0]?.resolve(1);
		await settle();
		// One replay for however many were queued.
		expect(reads).toHaveLength(2);
		reads[1]?.resolve(2);
		await settle();
		expect(painted).toEqual([1, 2]);
		expect(loop.loading).toBe(false);
	});

	it('a refresh queued behind a failed read still runs', async () => {
		const reads: ReturnType<typeof pending<number>>[] = [];
		const painted: number[] = [];
		const loop = refreshLoop<number>({
			read: () => {
				const read = pending<number>();
				reads.push(read);
				return read.promise;
			},
			onRead: (next) => painted.push(next),
			onFail: () => painted.push(-1),
		});
		loop.refresh();
		loop.refresh();
		reads[0]?.reject(new Error('no'));
		await settle();
		expect(reads).toHaveLength(2);
		reads[1]?.resolve(5);
		await settle();
		// The failure was not painted: the replay stood in for it.
		expect(painted).toEqual([5]);
		expect(loop.failed).toBe(false);
	});

	it('a failure with nothing queued is painted, and a disposed loop paints nothing', async () => {
		const reads: ReturnType<typeof pending<number>>[] = [];
		const painted: number[] = [];
		const loop = refreshLoop<number>({
			read: () => {
				const read = pending<number>();
				reads.push(read);
				return read.promise;
			},
			onRead: (next) => painted.push(next),
			onFail: () => painted.push(-1),
		});
		loop.refresh();
		reads[0]?.reject(new Error('no'));
		await settle();
		expect(painted).toEqual([-1]);
		expect(loop.failed).toBe(true);
		loop.refresh();
		loop.dispose();
		reads[1]?.resolve(9);
		await settle();
		expect(painted).toEqual([-1]);
		expect(loop.disposed).toBe(true);
	});
});
