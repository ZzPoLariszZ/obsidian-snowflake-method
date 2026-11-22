import { afterEach, describe, expect, it } from 'vitest';

import { createMessageTurns, pauseWhileSeen, type MessageTurns } from '../../src/services';

describe('turns taken by a message', () => {
	let turns: MessageTurns | null = null;
	afterEach(() => {
		turns?.close();
		turns = null;
	});

	const taken = (from: MessageTurns): Promise<void> =>
		new Promise((resolve) => {
			from.take(resolve);
		});

	it('run each handler on a later turn, in the order they were asked for', async () => {
		turns = createMessageTurns();
		const ran: string[] = [];
		turns.take(() => ran.push('first'));
		turns.take(() => ran.push('second'));
		// Nothing runs in the turn that asked.
		expect(ran).toEqual([]);
		await taken(turns);
		expect(ran).toEqual(['first', 'second']);
	});

	it('wait on no clock', async () => {
		turns = createMessageTurns();
		const started = Date.now();
		for (let turn = 0; turn < 200; turn += 1) await taken(turns);
		// Two hundred turns on a clock of no delay take most of a second where a window is out of sight.
		expect(Date.now() - started).toBeLessThan(500);
	});

	it('drop what was waiting once they are closed', async () => {
		turns = createMessageTurns();
		const ran: string[] = [];
		turns.take(() => ran.push('never'));
		turns.close();
		const other = createMessageTurns();
		await taken(other);
		await taken(other);
		other.close();
		expect(ran).toEqual([]);
	});
});

describe('a wait kept only while the window can be seen', () => {
	const refuse = (what: string) => (): never => {
		throw new Error(what);
	};

	it('is kept on the window’s clock in sight, for as long as was asked', async () => {
		const asked: number[] = [];
		const waits = pauseWhileSeen({
			hidden: () => false,
			set: (handler, ms) => {
				asked.push(ms);
				handler();
			},
			turn: refuse('No turn is taken in place of the clock while the window can be seen.'),
		});
		await waits(400);
		expect(asked).toEqual([400]);
	});

	it('is given up out of sight, where the clock is handed out late', async () => {
		let turns = 0;
		const waits = pauseWhileSeen({
			hidden: () => true,
			set: refuse('The clock is not asked while the window is out of sight.'),
			turn: (handler) => {
				turns += 1;
				handler();
			},
		});
		await waits(400);
		expect(turns).toBe(1);
	});

	it('looks at where the window stands at each wait, and settles on a real turn', async () => {
		const turns = createMessageTurns();
		let hidden = true;
		const asked: number[] = [];
		const waits = pauseWhileSeen({
			hidden: () => hidden,
			set: (handler, ms) => {
				asked.push(ms);
				handler();
			},
			turn: (handler) => {
				turns.take(handler);
			},
		});
		const started = Date.now();
		await waits(60_000);
		expect([asked, Date.now() - started < 500]).toEqual([[], true]);
		hidden = false;
		await waits(400);
		expect(asked).toEqual([400]);
		turns.close();
	});
});
