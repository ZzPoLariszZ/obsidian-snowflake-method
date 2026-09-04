import { describe, expect, it, vi } from 'vitest';

import type { StickyNoteLocalState } from '../../src/domain';
import { StickyNoteHub } from '../../src/ui/sticky-note-hub';

const hubOf = (
	stored: unknown,
): { hub: StickyNoteHub; saved: StickyNoteLocalState[] } => {
	const saved: StickyNoteLocalState[] = [];
	const hub = new StickyNoteHub({
		load: () => stored,
		save: (state) => {
			saved.push(state);
		},
	});
	return { hub, saved };
};

describe('StickyNoteHub', () => {
	it('reads what the device kept, made safe', () => {
		expect(hubOf('junk').hub.floatState('a')).toBeNull();
		const { hub } = hubOf({
			version: 1,
			notes: {
				a: {
					float: { open: true, x: 5, y: 6, width: 300, height: 200, locked: false, alpha: 70, mode: 'editing' },
				},
			},
		});
		expect(hub.floatState('a')).toEqual({
			open: true,
			x: 5,
			y: 6,
			width: 300,
			height: 200,
			locked: false,
			alpha: 70,
			mode: 'editing',
		});
		expect(hub.floatState('b')).toBeNull();
	});

	it('saves every patch and forgets one note without touching another', () => {
		const { hub, saved } = hubOf(null);

		hub.patchFloatState('a', { x: 5, open: true });
		hub.patchFloatState('b', { locked: true });

		expect(saved).toHaveLength(2);
		expect(hub.floatState('a')?.x).toBe(5);
		expect(hub.floatState('a')?.open).toBe(true);
		expect(hub.floatState('b')?.locked).toBe(true);
		expect(saved[1]?.notes.a?.float.x).toBe(5);

		hub.forget('a');
		expect(saved).toHaveLength(3);
		expect(hub.floatState('a')).toBeNull();
		expect(hub.floatState('b')?.locked).toBe(true);
		hub.forget('never');
		expect(saved).toHaveLength(3);
	});

	it('rings every listener, past one that fails, until it unsubscribes', () => {
		const { hub } = hubOf(null);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const heard: string[] = [];
		const stop = hub.subscribe(() => {
			heard.push('first');
			throw new Error('first failed');
		});
		hub.subscribe(() => heard.push('second'));

		hub.notify();
		expect(heard).toEqual(['first', 'second']);
		expect(spy).toHaveBeenCalledTimes(1);

		stop();
		hub.notify();
		expect(heard).toEqual(['first', 'second', 'second']);
		spy.mockRestore();
	});
});
