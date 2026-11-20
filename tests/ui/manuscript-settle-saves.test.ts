// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import { SnowflakeManuscriptView } from '../../src/ui/manuscript-view';

interface Entry {
	path: string;
	text: { body: string; revision: string };
	editor: object | null;
	pending: string | null;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
	let resolve = (_value: T): void => undefined;
	let reject = (_reason: unknown): void => undefined;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function microtasks(): Promise<void> {
	for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

/** A stream holding two notes, with the host's save in the test's hands. */
function stream() {
	const saves: { path: string; body: string; revision: string }[] = [];
	let answer: (path: string) => Promise<{ revision: string }> = async (path) => ({
		revision: `${path}@${String(saves.length)}`,
	});
	const host = {
		saveManuscriptSegment: vi.fn((path: string, body: string, revision: string) => {
			saves.push({ path, body, revision });
			return answer(path);
		}),
		readManuscriptSegment: vi.fn(),
		translateForProject: (_locale: unknown, key: string) => key,
	};
	const editor = { open: true };
	const one: Entry = { path: 'Novel/50_Manuscript/One.md', text: { body: 'one', revision: 'r1' }, editor, pending: null };
	const two: Entry = { path: 'Novel/50_Manuscript/Two.md', text: { body: 'two', revision: 'r2' }, editor: null, pending: null };
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	Object.assign(view, {
		host,
		mounted: new Map([[one.path, one], [two.path, two]]),
		saving: Promise.resolve(),
		flushesUnderWay: 0,
		saveTimer: null,
		saveWindow: null,
		t: (key: string) => key,
	});
	return {
		view,
		host,
		saves,
		one,
		two,
		editor,
		answerWith: (next: (path: string) => Promise<{ revision: string }>) => {
			answer = next;
		},
	};
}

/**
 * What the stream owes the vault at the two moments its quiet timer cannot
 * be trusted: the app quitting and the app going out of sight.
 */
describe('settling the stream’s saves', () => {
	it('owes nothing while every note stands as the vault holds it', () => {
		const { view, one, host } = stream();
		expect(view.settleSaves()).toBeNull();
		// Typed back to what the note holds: nothing to write either.
		one.pending = 'one';
		expect(view.settleSaves()).toBeNull();
		expect(host.saveManuscriptSegment).not.toHaveBeenCalled();
	});

	it('writes the words typed and not yet written, and leaves the editor as it stands', async () => {
		const { view, one, two, saves, editor } = stream();
		one.pending = 'one, and more';
		const settling = view.settleSaves();
		expect(settling).not.toBeNull();
		await settling;
		expect(saves).toEqual([{ path: one.path, body: 'one, and more', revision: 'r1' }]);
		expect(one.pending).toBeNull();
		expect(one.text.body).toBe('one, and more');
		// The editor was not put away: the author may still be in it.
		expect(one.editor).toBe(editor);
		expect(two.pending).toBeNull();
		// Written, so nothing is owed any more.
		expect(view.settleSaves()).toBeNull();
	});

	it('owes words taken out again while the save carrying them is still out', async () => {
		const { view, one, saves, answerWith } = stream();
		const write = deferred<{ revision: string }>();
		answerWith(() => write.promise);
		// A word typed, and the quiet timer's own flush set going.
		one.pending = 'one two';
		const timed = (view as unknown as { flushPendingSave(): Promise<void> }).flushPendingSave();
		await microtasks();
		expect(saves).toHaveLength(1);
		// The author takes the word out again while that write is out. The
		// editor now reads as the note did before the save.
		one.pending = 'one';
		const settling = view.settleSaves();
		// Not nothing: the save in flight is writing words the author removed.
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await microtasks();
		expect(over).toBe(false);
		answerWith(async (path) => ({ revision: `${path}@2` }));
		write.resolve({ revision: 'r1b' });
		await timed;
		await settling;
		// The note ends as the editor stands, written on the revision the first save left.
		expect(saves).toEqual([
			{ path: one.path, body: 'one two', revision: 'r1' },
			{ path: one.path, body: 'one', revision: 'r1b' },
		]);
		expect(one.text.body).toBe('one');
		expect(one.pending).toBeNull();
		expect(view.settleSaves()).toBeNull();
	});

	it('waits for a save already on its way without writing the same words twice', async () => {
		const { view, one, saves, answerWith } = stream();
		const write = deferred<{ revision: string }>();
		answerWith(() => write.promise);
		one.pending = 'one, typed';
		// The quiet timer's own flush, under way when the app is asked to quit.
		const timed = (view as unknown as { flushPendingSave(): Promise<void> }).flushPendingSave();
		await microtasks();
		expect(saves).toHaveLength(1);
		// Still owed: a note's typing stays pending until its write has landed.
		const settling = view.settleSaves();
		expect(settling).not.toBeNull();
		let over = false;
		void settling?.then(() => {
			over = true;
		});
		await microtasks();
		expect(over).toBe(false);
		write.resolve({ revision: 'r1b' });
		await timed;
		await settling;
		expect(over).toBe(true);
		expect(saves).toHaveLength(1);
		expect(one.pending).toBeNull();
		expect(one.text.revision).toBe('r1b');
	});

	it('carries what was typed while a save was on its way', async () => {
		const { view, one, saves, answerWith } = stream();
		const write = deferred<{ revision: string }>();
		answerWith(() => write.promise);
		one.pending = 'first';
		const timed = (view as unknown as { flushPendingSave(): Promise<void> }).flushPendingSave();
		await microtasks();
		// More typing lands while the first write is out.
		one.pending = 'first, then second';
		const settling = view.settleSaves();
		answerWith(async () => ({ revision: 'r1c' }));
		write.resolve({ revision: 'r1b' });
		await timed;
		await settling;
		expect(saves.map((save) => save.body)).toEqual(['first', 'first, then second']);
		// The second write went out against the revision the first one left.
		expect(saves[1]?.revision).toBe('r1b');
		expect(one.pending).toBeNull();
	});

	it('writes every note that holds unwritten words', async () => {
		const { view, one, two, saves } = stream();
		one.pending = 'one!';
		two.pending = 'two!';
		await view.settleSaves();
		expect(saves.map((save) => [save.path, save.body])).toEqual([
			[one.path, 'one!'],
			[two.path, 'two!'],
		]);
	});

	it('still owes words whose write failed, and never rejects for it', async () => {
		const { view, one, answerWith } = stream();
		answerWith(() => Promise.reject(new Error('the disk said no')));
		one.pending = 'one, unsaved';
		await expect(view.settleSaves()).resolves.toBeUndefined();
		// Kept, not dropped: the next settle sends them again.
		expect(one.pending).toBe('one, unsaved');
		answerWith(async () => ({ revision: 'r1z' }));
		await view.settleSaves();
		expect(one.pending).toBeNull();
		expect(one.text.body).toBe('one, unsaved');
	});
});
