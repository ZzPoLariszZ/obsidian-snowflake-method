import { describe, expect, it, vi } from 'vitest';

import {
	StickyNoteClaims,
	type StickyNoteEditOwner,
} from '../../src/ui/sticky-note-claims';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const settle = async (): Promise<void> => {
	for (let step = 0; step < 6; step += 1) await Promise.resolve();
};

const ownerOf = (
	id: string,
	log: string[],
	gate?: { promise: Promise<void> },
): StickyNoteEditOwner => ({
	id,
	release: async () => {
		log.push(`${id} releasing`);
		if (gate !== undefined) await gate.promise;
		log.push(`${id} released`);
	},
});

describe('StickyNoteClaims', () => {
	it('gives an unclaimed note to the first asker at once', async () => {
		const claims = new StickyNoteClaims();
		const log: string[] = [];

		expect(await claims.claim('n', ownerOf('A', log))).toBe(true);

		expect(claims.owner('n')).toBe('A');
		expect(log).toEqual([]);
	});

	it('hands a note over only once the holder has let go, naming the holder meanwhile', async () => {
		const claims = new StickyNoteClaims();
		const log: string[] = [];
		const gate = deferred();
		await claims.claim('n', ownerOf('A', log, gate));

		const claiming = claims.claim('n', ownerOf('B', log));
		await settle();

		expect(log).toEqual(['A releasing']);
		expect(claims.owner('n')).toBe('A');
		gate.resolve();
		expect(await claiming).toBe(true);
		expect(claims.owner('n')).toBe('B');
		expect(log).toEqual(['A releasing', 'A released']);
	});

	it('passes a note down three askers one holder at a time', async () => {
		const claims = new StickyNoteClaims();
		const log: string[] = [];
		const gateA = deferred();
		const gateB = deferred();
		await claims.claim('n', ownerOf('A', log, gateA));

		const claimB = claims.claim('n', ownerOf('B', log, gateB));
		const claimC = claims.claim('n', ownerOf('C', log));
		await settle();
		expect(claims.owner('n')).toBe('A');
		// C is not asked of B while A still holds the note.
		expect(log).toEqual(['A releasing']);

		gateA.resolve();
		await claimB;
		await settle();
		expect(claims.owner('n')).toBe('B');
		expect(log).toEqual(['A releasing', 'A released', 'B releasing']);

		gateB.resolve();
		await claimC;
		expect(claims.owner('n')).toBe('C');
		expect(log).toEqual(['A releasing', 'A released', 'B releasing', 'B released']);
	});

	it('leaves a note with the asker who already holds it', async () => {
		const claims = new StickyNoteClaims();
		const log: string[] = [];
		const owner = ownerOf('A', log);
		await claims.claim('n', owner);

		expect(await claims.claim('n', owner)).toBe(true);

		expect(log).toEqual([]);
		expect(claims.owner('n')).toBe('A');
	});

	it('lets only the holder release a note', async () => {
		const claims = new StickyNoteClaims();
		await claims.claim('n', ownerOf('A', []));

		expect(claims.release('n', 'Z')).toBe(false);
		expect(claims.owner('n')).toBe('A');
		expect(claims.release('n', 'A')).toBe(true);
		expect(claims.owner('n')).toBeNull();
		expect(claims.release('n', 'A')).toBe(false);
	});

	it('hands a note on even when the holder fails to let go cleanly', async () => {
		const claims = new StickyNoteClaims();
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await claims.claim('n', {
			id: 'A',
			release: () => Promise.reject(new Error('stuck')),
		});

		expect(await claims.claim('n', ownerOf('B', []))).toBe(true);

		expect(claims.owner('n')).toBe('B');
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});

	it('evicts the holder and lets a claim queued behind the eviction follow', async () => {
		const claims = new StickyNoteClaims();
		const log: string[] = [];
		const gate = deferred();
		await claims.claim('n', ownerOf('A', log, gate));

		const evicting = claims.evict('n');
		const claiming = claims.claim('n', ownerOf('B', log));
		await settle();
		expect(claims.owner('n')).toBe('A');

		gate.resolve();
		await evicting;
		expect(claims.owner('n')).toBeNull();
		await claiming;
		expect(claims.owner('n')).toBe('B');
		expect(log).toEqual(['A releasing', 'A released']);
		await claims.evict('unowned');
	});

	it('lets every note go at once', async () => {
		const claims = new StickyNoteClaims();
		const log: string[] = [];
		await claims.claim('one', ownerOf('A', log));
		await claims.claim('two', ownerOf('B', log));

		await claims.releaseAll();

		expect(claims.owner('one')).toBeNull();
		expect(claims.owner('two')).toBeNull();
		expect(log.sort()).toEqual(['A released', 'A releasing', 'B released', 'B releasing']);
	});
});
