import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/errors';
import { OperationQueue } from '../../api/queue';

/** A piece of work that ends when the test says so. */
function held<T>(value: T): { work: () => Promise<T>; end: () => void; fail: (error: unknown) => void } {
	let end: () => void = () => {};
	let fail: (error: unknown) => void = () => {};
	const done = new Promise<T>((resolve, reject) => {
		end = () => {
			resolve(value);
		};
		fail = reject;
	});
	return { work: () => done, end, fail };
}

const turn = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

describe('the calls taken one at a time', () => {
	it('starts the next only when the one before has ended', async () => {
		const queue = new OperationQueue(8);
		const order: string[] = [];
		const first = held('first');
		const second = held('second');
		const one = queue.run(() => {
			order.push('first started');
			return first.work();
		});
		const two = queue.run(() => {
			order.push('second started');
			return second.work();
		});
		await turn();
		expect(order).toEqual(['first started']);
		expect(queue.size).toBe(2);
		first.end();
		expect(await one).toBe('first');
		await turn();
		expect(order).toEqual(['first started', 'second started']);
		second.end();
		expect(await two).toBe('second');
		await turn();
		expect(queue.size).toBe(0);
	});

	it('goes on after one that failed, and hands the failure to its own caller only', async () => {
		const queue = new OperationQueue(8);
		const broken = queue.run(() => Promise.reject(new Error('broken')));
		const after = queue.run(() => Promise.resolve('after'));
		await expect(broken).rejects.toThrow('broken');
		expect(await after).toBe('after');
		await turn();
		expect(queue.size).toBe(0);
	});

	it('goes on after one that threw before it began to wait', async () => {
		const queue = new OperationQueue(8);
		const broken = queue.run(() => {
			throw new Error('thrown');
		});
		const after = queue.run(() => Promise.resolve('after'));
		await expect(broken).rejects.toThrow('thrown');
		expect(await after).toBe('after');
	});

	it('tells a caller at once when the line is too long, and takes it again once there is room', async () => {
		const queue = new OperationQueue(2);
		const first = held(1);
		const second = held(2);
		const one = queue.run(first.work);
		const two = queue.run(second.work);
		const refused = queue.run(() => Promise.resolve(3));
		await expect(refused).rejects.toBeInstanceOf(ApiError);
		await expect(refused).rejects.toMatchObject({ code: 'busy' });
		first.end();
		second.end();
		await Promise.all([one, two]);
		await turn();
		expect(await queue.run(() => Promise.resolve(4))).toBe(4);
	});
});
