import { afterEach, describe, expect, it } from 'vitest';

import { createMessageTurns, type MessageTurns } from '../../src/services';

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
