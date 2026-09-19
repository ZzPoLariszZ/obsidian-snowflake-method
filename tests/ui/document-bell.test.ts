import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentBell } from '../../src/ui/document-bell';

function standing() {
	const failed = vi.fn();
	const reconcile = vi.fn();
	const clock = {
		setTimeout: vi.fn((handler: () => void, delay: number): unknown => setTimeout(handler, delay)),
		clearTimeout: vi.fn((id: number) => { clearTimeout(id); }),
	} as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>;
	const bell = new DocumentBell({ clock: () => clock, delay: 250, failed, reconcile });
	return { bell, failed, reconcile, clock };
}

describe('the bell a project document rings', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('rings everyone listening at once, and nobody who has stopped', () => {
		const { bell } = standing();
		const first = vi.fn();
		const second = vi.fn();
		const stop = bell.subscribe(first);
		bell.subscribe(second);
		bell.ring();
		stop();
		bell.ring();
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledTimes(2);
	});

	it('leaves a listener that threw to its own failure, and rings the rest', () => {
		const { bell, failed } = standing();
		const broken = new Error('half drawn');
		const after = vi.fn();
		bell.subscribe(() => { throw broken; });
		bell.subscribe(after);
		bell.ring();
		expect(failed).toHaveBeenCalledWith(broken);
		expect(after).toHaveBeenCalledOnce();
	});

	it('answers a burst with one ring once it has settled, on the clock it was given', () => {
		const { bell, reconcile, clock } = standing();
		const heard = vi.fn();
		bell.subscribe(heard);
		bell.schedule();
		vi.advanceTimersByTime(200);
		bell.schedule();
		vi.advanceTimersByTime(200);
		expect(heard).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(heard).toHaveBeenCalledOnce();
		expect(reconcile).not.toHaveBeenCalled();
		expect(clock.setTimeout).toHaveBeenCalledTimes(2);
		expect(clock.clearTimeout).toHaveBeenCalledOnce();
	});

	it('reconciles after the ring when any call of the burst asked for it, and owes nothing to the burst after', () => {
		const { bell, reconcile } = standing();
		const order: string[] = [];
		bell.subscribe(() => order.push('heard'));
		reconcile.mockImplementation(() => order.push('reconciled'));
		// The file went, and came back within the moment: the going is still owed its reconcile.
		bell.schedule(true);
		bell.schedule();
		vi.advanceTimersByTime(250);
		expect(order).toEqual(['heard', 'reconciled']);
		bell.schedule();
		vi.advanceTimersByTime(250);
		expect(order).toEqual(['heard', 'reconciled', 'heard']);
	});

	it('lets the ring in waiting go with the plugin, reconcile and all', () => {
		const { bell, reconcile } = standing();
		const heard = vi.fn();
		bell.subscribe(heard);
		bell.schedule(true);
		bell.dispose();
		vi.advanceTimersByTime(1000);
		expect(heard).not.toHaveBeenCalled();
		expect(reconcile).not.toHaveBeenCalled();
		// One disposed twice, or with nothing waiting, has nothing to let go.
		bell.dispose();
	});
});
