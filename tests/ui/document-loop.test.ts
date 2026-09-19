import { describe, expect, it, vi } from 'vitest';

import { createDocumentLoop, type DocumentLoopDeps, type DocumentSource } from '../../src/ui/document-loop';

interface Reading { held: { version: number } }
interface Model { name: string }

async function settle(): Promise<void> {
	for (let at = 0; at < 40; at++) await Promise.resolve();
}

/** A read that waits to be let go, so a test can stand in the middle of one. */
function gate<T>(): { promise: Promise<T>; open: (value: T) => void; fail: (error: unknown) => void } {
	let open: (value: T) => void = () => undefined;
	let fail: (error: unknown) => void = () => undefined;
	const promise = new Promise<T>((resolve, reject) => {
		open = resolve;
		fail = reject;
	});
	return { promise, open, fail };
}

function harness(overrides: Partial<DocumentLoopDeps<Reading, Model>> = {}) {
	let file: Reading | null = { held: { version: 1 } };
	let reading: Reading | null = null;
	let failed = false;
	let model: Model | null = { name: 'first' };
	let disposed = false;
	let dragging = false;
	const listeners = new Set<() => void>();
	const unsubscribed = vi.fn();
	const source: DocumentSource<Reading> = {
		read: vi.fn(async () => file),
		subscribe: vi.fn((listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				unsubscribed();
			};
		}),
	};
	let standing = source;
	const draw = vi.fn((_model: Model | null): void => undefined);
	const notice = vi.fn();
	const readFailed = vi.fn();
	const refreshModel = vi.fn(async () => undefined);
	const loop = createDocumentLoop<Reading, Model>({
		source: () => standing,
		taken: (next, didFail) => {
			reading = next;
			failed = didFail;
		},
		readFailed,
		held: () => reading?.held ?? null,
		model: () => model,
		refreshModel,
		draw,
		dragging: () => dragging,
		disposed: () => disposed,
		notice,
		...overrides,
	});
	return {
		loop, source, draw, notice, readFailed, refreshModel, unsubscribed, listeners,
		reading: () => reading,
		failed: () => failed,
		write: (version: number) => { file = { held: { version } }; },
		lose: () => { file = null; },
		remodel: (name: string) => { model = { name }; },
		dispose: () => { disposed = true; },
		drag: (value: boolean) => { dragging = value; },
		ring: () => { for (const listener of [...listeners]) listener(); },
		stand: (next: DocumentSource<Reading>) => { standing = next; },
	};
}

describe('reading the document', () => {
	it('hands each reading over as it lands, hears the bridge it read from, and paints', async () => {
		const fixture = harness();
		await fixture.loop.reload();
		expect(fixture.reading()).toEqual({ held: { version: 1 } });
		expect(fixture.failed()).toBe(false);
		expect(fixture.source.subscribe).toHaveBeenCalledOnce();
		expect(fixture.draw).toHaveBeenCalledExactlyOnceWith({ name: 'first' });
	});

	it('joins a read in flight and answers with one more pass after it, so a change gets the document as its write left it', async () => {
		const fixture = harness();
		const first = gate<Reading | null>();
		vi.mocked(fixture.source.read).mockImplementationOnce(() => first.promise);
		const bell = fixture.loop.reload(true);
		// The write lands while the bell's read is away; the read asked for next must not be answered by it.
		fixture.write(2);
		const asked = fixture.loop.reload();
		expect(asked).toBe(bell);
		first.open({ held: { version: 1 } });
		await asked;
		expect(fixture.source.read).toHaveBeenCalledTimes(2);
		expect(fixture.reading()).toEqual({ held: { version: 2 } });
		expect(fixture.draw).toHaveBeenCalledOnce();
	});

	it('takes nothing from a read that threw, says so once, and still paints what that leaves', async () => {
		const fixture = harness();
		await fixture.loop.reload();
		const error = new Error('Vault gone');
		vi.mocked(fixture.source.read).mockRejectedValueOnce(error);
		await fixture.loop.reload();
		expect(fixture.reading()).toBeNull();
		expect(fixture.failed()).toBe(true);
		expect(fixture.readFailed).toHaveBeenCalledExactlyOnceWith(error);
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('hears a new bridge in place of the old one when a rename hands the workspace another', async () => {
		const fixture = harness();
		await fixture.loop.reload();
		const next: DocumentSource<Reading> = {
			read: vi.fn(async () => ({ held: { version: 9 } })),
			subscribe: vi.fn(() => () => undefined),
		};
		fixture.stand(next);
		await fixture.loop.reload();
		expect(fixture.unsubscribed).toHaveBeenCalledOnce();
		expect(next.subscribe).toHaveBeenCalledOnce();
		expect(fixture.reading()).toEqual({ held: { version: 9 } });
		// The same bridge standing is heard once, however often it is read.
		await fixture.loop.reload();
		expect(next.subscribe).toHaveBeenCalledOnce();
	});

	it('reads nothing once the workspace has gone, and stops hearing the bridge when released', async () => {
		const fixture = harness();
		await fixture.loop.reload();
		fixture.loop.release();
		expect(fixture.unsubscribed).toHaveBeenCalledOnce();
		expect(fixture.listeners.size).toBe(0);
		fixture.dispose();
		await fixture.loop.reload();
		expect(fixture.source.read).toHaveBeenCalledOnce();
	});
});

describe('the paint a read is owed', () => {
	it('paints for the bell only when the document or the model moved', async () => {
		const fixture = harness();
		// The store serves one document per version of the file, so an unmoved file reads as the same object.
		const same = { held: { version: 1 } };
		vi.mocked(fixture.source.read).mockImplementation(async () => same);
		await fixture.loop.reload();
		expect(fixture.draw).toHaveBeenCalledOnce();
		fixture.ring();
		await settle();
		expect(fixture.draw).toHaveBeenCalledOnce();
		// The document moved.
		vi.mocked(fixture.source.read).mockImplementation(async () => ({ held: { version: 2 } }));
		fixture.ring();
		await settle();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('lets a bell pass whose document is another object that lays out the same, where the workspace can tell, and measures the next against it', async () => {
		const alike = vi.fn((painted: unknown, held: unknown): boolean =>
			(painted as { version: number } | null)?.version === (held as { version: number } | null)?.version);
		const fixture = harness({ alike });
		await fixture.loop.reload();
		expect(fixture.draw).toHaveBeenCalledOnce();
		// The file parsed again: the same version under another identity.
		fixture.write(1);
		fixture.ring();
		await settle();
		expect(alike).toHaveBeenCalledOnce();
		expect(fixture.draw).toHaveBeenCalledOnce();
		// The object let pass is the painted one now, so the same read again asks nothing.
		fixture.ring();
		await settle();
		expect(alike).toHaveBeenCalledOnce();
		// One that lays out another way is painted, and a read the workspace asked for paints whatever is alike.
		fixture.write(2);
		fixture.ring();
		await settle();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
		fixture.write(2);
		await fixture.loop.reload();
		expect(fixture.draw).toHaveBeenCalledTimes(3);
	});

	it('asks nothing of how documents lay out after a paint that threw partway, which is owed another whatever they say', async () => {
		const alike = vi.fn(() => true);
		const fixture = harness({ alike });
		fixture.draw.mockImplementationOnce(() => { throw new Error('half made'); });
		await fixture.loop.reload().catch(() => undefined);
		fixture.write(1);
		fixture.ring();
		await settle();
		expect(alike).not.toHaveBeenCalled();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('paints for the bell when only the model is another', async () => {
		const fixture = harness();
		const same = { held: { version: 1 } };
		vi.mocked(fixture.source.read).mockImplementation(async () => same);
		await fixture.loop.reload();
		fixture.remodel('second');
		fixture.ring();
		await settle();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
		expect(fixture.draw).toHaveBeenLastCalledWith({ name: 'second' });
	});

	it('always paints for a read the workspace asked for, whatever came back', async () => {
		const fixture = harness();
		const same = { held: { version: 1 } };
		vi.mocked(fixture.source.read).mockImplementation(async () => same);
		await fixture.loop.reload();
		await fixture.loop.reload();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('keeps the paint a workspace asked for when its read joins the bell\'s', async () => {
		const fixture = harness();
		const same = { held: { version: 1 } };
		vi.mocked(fixture.source.read).mockImplementation(async () => same);
		await fixture.loop.reload();
		const first = gate<Reading | null>();
		vi.mocked(fixture.source.read).mockImplementationOnce(() => first.promise);
		fixture.ring();
		const asked = fixture.loop.reload();
		first.open(same);
		await asked;
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('owes another paint to one that threw partway, even when nothing moved since', async () => {
		const fixture = harness();
		const same = { held: { version: 1 } };
		vi.mocked(fixture.source.read).mockImplementation(async () => same);
		fixture.draw.mockImplementationOnce(() => { throw new Error('Half made'); });
		await expect(fixture.loop.reload()).rejects.toThrow('Half made');
		fixture.ring();
		await settle();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
		// Made whole, the same pair has nothing more to show.
		fixture.ring();
		await settle();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('holds a paint asked for during a drag until the drag has ended, and makes it once', async () => {
		const fixture = harness();
		await fixture.loop.reload();
		fixture.drag(true);
		fixture.loop.paint();
		fixture.loop.paint();
		expect(fixture.draw).toHaveBeenCalledOnce();
		fixture.drag(false);
		fixture.loop.paintOwed();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
		fixture.loop.paintOwed();
		expect(fixture.draw).toHaveBeenCalledTimes(2);
	});

	it('paints nothing once the workspace has gone', async () => {
		const fixture = harness();
		fixture.dispose();
		fixture.loop.paint();
		expect(fixture.draw).not.toHaveBeenCalled();
	});
});

describe('the queue of changes', () => {
	it('runs the changes one after another, each followed by a read of the document', async () => {
		const fixture = harness();
		const order: string[] = [];
		const first = gate<void>();
		const one = fixture.loop.enqueue(async () => {
			order.push('one begins');
			await first.promise;
			order.push('one ends');
		});
		const two = fixture.loop.enqueue(async () => { order.push('two'); });
		await settle();
		expect(order).toEqual(['one begins']);
		first.open();
		await Promise.all([one, two]);
		expect(order).toEqual(['one begins', 'one ends', 'two']);
		expect(fixture.source.read).toHaveBeenCalledTimes(2);
	});

	it('follows a change with what it asked for: the model, a paint alone, or nothing', async () => {
		const fixture = harness();
		await fixture.loop.enqueue(async () => undefined, 'model');
		expect(fixture.refreshModel).toHaveBeenCalledOnce();
		expect(fixture.source.read).not.toHaveBeenCalled();
		await fixture.loop.enqueue(async () => undefined, 'none');
		expect(fixture.draw).toHaveBeenCalledOnce();
		expect(fixture.source.read).not.toHaveBeenCalled();
		await fixture.loop.enqueue(async () => undefined, 'nothing');
		expect(fixture.draw).toHaveBeenCalledOnce();
		expect(fixture.refreshModel).toHaveBeenCalledOnce();
	});

	it('asks what follows once the change is done, for a form that may or may not have saved', async () => {
		const fixture = harness();
		let saved = false;
		await fixture.loop.enqueue(async () => { saved = true; }, () => (saved ? 'model' : 'none'));
		expect(fixture.refreshModel).toHaveBeenCalledOnce();
		expect(fixture.draw).not.toHaveBeenCalled();
	});

	it('says what a change threw and goes on to the next, the read after it included', async () => {
		const fixture = harness();
		const error = new Error('Refused');
		const failing = fixture.loop.enqueue(async () => { throw error; });
		const next = vi.fn(async () => undefined);
		const following = fixture.loop.enqueue(next);
		await expect(failing).resolves.toBeUndefined();
		await following;
		expect(fixture.notice).toHaveBeenCalledExactlyOnceWith(error);
		expect(next).toHaveBeenCalledOnce();
		expect(fixture.source.read).toHaveBeenCalledTimes(2);
	});

	it('guards what follows the change as the change is, so a paint that throws strands no caller', async () => {
		const fixture = harness();
		const error = new Error('Half made');
		fixture.draw.mockImplementationOnce(() => { throw error; });
		await expect(fixture.loop.enqueue(async () => undefined, 'none')).resolves.toBeUndefined();
		expect(fixture.notice).toHaveBeenCalledExactlyOnceWith(error);
	});

	it('still lands a change queued before the workspace went, with nothing after it and nothing said', async () => {
		const fixture = harness();
		const first = gate<void>();
		const one = fixture.loop.enqueue(() => first.promise);
		const landed = vi.fn(async () => { throw new Error('Too late to say'); });
		const two = fixture.loop.enqueue(landed);
		fixture.dispose();
		first.open();
		await Promise.all([one, two]);
		expect(landed).toHaveBeenCalledOnce();
		expect(fixture.notice).not.toHaveBeenCalled();
		expect(fixture.source.read).not.toHaveBeenCalled();
		expect(fixture.draw).not.toHaveBeenCalled();
	});
});
