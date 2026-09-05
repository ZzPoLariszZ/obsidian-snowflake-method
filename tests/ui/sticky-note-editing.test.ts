import { describe, expect, it } from 'vitest';

import type { StickyNoteRecord } from '../../src/services';
import {
	StickyNoteEditSession,
	StickyNoteGone,
	StickyNoteSaveConflict,
	type StickyNoteEditIo,
} from '../../src/ui/sticky-note-editing';

const PATH = 'Novel/70_Tool/72_Task_Management/724_Sticky_Note/note.md';

const record = (body: string, revision: string): StickyNoteRecord => ({
	id: 'sticky-note-1',
	path: PATH,
	color: 'macaron-1',
	createdAt: 1,
	archived: false,
	body,
	revision,
	stamp: `${revision}:1`,
	readOnly: false,
});

interface Harness {
	session: StickyNoteEditSession;
	/**
	 * The file as the fake vault holds it; `gone` once it has been deleted,
	 * `failing` when the disk refuses for a reason of its own, and `onWrite`
	 * run as each write reaches it.
	 */
	disk: {
		record: StickyNoteRecord;
		gone: boolean;
		failing: boolean;
		onWrite: (() => void) | null;
	};
	events: string[];
	writes: string[];
	/** The path each write went to. */
	paths: string[];
	fire(): void;
	armed(): number;
}

const harness = (initial = record('Hello', 'r1')): Harness => {
	const disk: Harness['disk'] = {
		record: initial,
		gone: false,
		failing: false,
		onWrite: null,
	};
	const events: string[] = [];
	const writes: string[] = [];
	const paths: string[] = [];
	const timers = new Map<number, () => void>();
	let handles = 0;
	const io: StickyNoteEditIo = {
		write: (path, body, expectedRevision) => {
			disk.onWrite?.();
			writes.push(body);
			paths.push(path);
			if (disk.record.revision !== expectedRevision) {
				return Promise.reject(new StickyNoteSaveConflict('moved'));
			}
			if (disk.gone) return Promise.reject(new StickyNoteGone('gone'));
			if (disk.failing) return Promise.reject(new Error('failing'));
			const next = Number(disk.record.revision.slice(1)) + 1;
			disk.record = { ...disk.record, path, body, revision: `r${next}` };
			return Promise.resolve(disk.record);
		},
		read: () => Promise.resolve(disk.gone ? null : disk.record),
		timers: {
			set: (handler) => {
				handles += 1;
				timers.set(handles, handler);
				return handles;
			},
			clear: (handle) => {
				timers.delete(handle as number);
			},
		},
		onSaved: (saved) => events.push(`saved ${saved.revision}`),
		onConflict: () => events.push('conflict'),
		onGone: () => events.push('gone'),
		onError: (error) => events.push(`error ${String(error)}`),
	};
	return {
		session: new StickyNoteEditSession(initial, io, 800),
		disk,
		events,
		writes,
		paths,
		fire: () => {
			const pending = [...timers.entries()];
			timers.clear();
			for (const [, handler] of pending) handler();
		},
		armed: () => timers.size,
	};
};

const settle = async (): Promise<void> => {
	for (let step = 0; step < 8; step += 1) await Promise.resolve();
};

describe('StickyNoteEditSession', () => {
	it('arms one timer for typing and writes once when it fires', async () => {
		const h = harness();

		h.session.changed('Hello there');
		h.session.changed('Hello there,');
		expect(h.armed()).toBe(1);
		expect(h.session.pending).toBe('Hello there,');

		h.fire();
		await settle();

		expect(h.writes).toEqual(['Hello there,']);
		expect(h.events).toEqual(['saved r2']);
		expect(h.session.pending).toBeNull();
		expect(h.session.baseBody).toBe('Hello there,');
		expect(h.session.record.revision).toBe('r2');
		expect(h.armed()).toBe(0);
	});

	it('forgets a change typed back to the base', () => {
		const h = harness();

		h.session.changed('Hello!');
		h.session.changed('Hello');

		expect(h.session.pending).toBeNull();
		expect(h.armed()).toBe(0);
	});

	it('serialises flushes: two asked at once make one write', async () => {
		const h = harness();
		h.session.changed('Hello twice');

		await Promise.all([h.session.flush(), h.session.flush()]);

		expect(h.writes).toEqual(['Hello twice']);
		expect(h.events).toEqual(['saved r2']);
	});

	it('goes again quietly when only the frontmatter moved', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		// A colour picked elsewhere: same body, new revision.
		h.disk.record = { ...record('Hello', 'r9'), color: 'macaron-4' };

		await h.session.flush();

		expect(h.writes).toEqual(['Hello Alice', 'Hello Alice']);
		expect(h.events).toEqual(['saved r10']);
		expect(h.disk.record?.body).toBe('Hello Alice');
		expect(h.session.pending).toBeNull();
	});

	it('adopts the same words already written elsewhere without writing them again', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		h.disk.record = record('Hello Alice', 'r9');

		await h.session.flush();

		expect(h.writes).toEqual(['Hello Alice']);
		expect(h.events).toEqual(['saved r9']);
		expect(h.session.record.revision).toBe('r9');
		expect(h.session.pending).toBeNull();
	});

	it('keeps the author’s text over a real conflict, saying so once', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		h.disk.record = record('Hello world', 'r9');

		await h.session.flush();

		expect(h.events).toEqual(['conflict', 'saved r10']);
		expect(h.disk.record?.body).toBe('Hello Alice');
		expect(h.session.baseBody).toBe('Hello Alice');
		expect(h.session.pending).toBeNull();
	});

	it('keeps the pending text, unsaved, when the file is gone', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		// Moved, then deleted: the refused save reads back nothing.
		h.disk.record = record('Hello world', 'r9');
		h.disk.gone = true;

		await h.session.flush();

		expect(h.events).toEqual(['gone']);
		expect(h.writes).toEqual(['Hello Alice']);
		expect(h.session.pending).toBe('Hello Alice');
	});

	it('reports a failure that is not a conflict and keeps the text', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		h.disk.failing = true;

		await h.session.flush();

		expect(h.events).toEqual(['error Error: failing']);
		expect(h.session.pending).toBe('Hello Alice');
	});

	it('writes a return to the old words typed while a save was in flight', async () => {
		const h = harness();
		h.session.changed('Hello there');
		h.fire();
		// One tick on: the write has left and is on its way, and the author
		// takes the words back meanwhile.
		await Promise.resolve();
		h.session.changed('Hello');
		await settle();

		expect(h.writes).toEqual(['Hello there']);
		expect(h.disk.record.body).toBe('Hello there');
		expect(h.session.pending).toBe('Hello');
		expect(h.armed()).toBe(1);

		h.fire();
		await settle();

		expect(h.writes).toEqual(['Hello there', 'Hello']);
		expect(h.disk.record.body).toBe('Hello');
		expect(h.session.pending).toBeNull();
	});

	it('meets a file that moves twice under the closing flush there, arming nothing past it', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		// The frontmatter moves under each of the first two writes.
		let moves = 0;
		h.disk.onWrite = () => {
			if (moves >= 2) return;
			moves += 1;
			h.disk.record = { ...h.disk.record, revision: `r${String(10 + moves)}` };
		};

		await h.session.dispose();

		expect(h.disk.record.body).toBe('Hello Alice');
		expect(h.session.pending).toBeNull();
		expect(h.armed()).toBe(0);
		expect(h.events.filter((event) => event === 'conflict')).toEqual([]);
	});

	it('keeps the text untried while the file is gone, and carries it once the note is found again', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		h.disk.gone = true;
		h.fire();
		await settle();

		expect(h.events).toEqual(['gone']);
		expect(h.session.gone).toBe(true);
		expect(h.session.pending).toBe('Hello Alice');
		expect(h.armed()).toBe(0);
		// Typing on arms nothing: the file is not there to take it.
		h.session.changed('Hello Alice again');
		expect(h.armed()).toBe(0);

		// Found again under another name, and written to meanwhile: the typing
		// goes on its way, to the new name, and wins as a conflict does.
		const renamed = `${PATH.slice(0, -3)} (renamed).md`;
		h.disk.gone = false;
		h.disk.record = { ...record('Someone else', 'r2'), path: renamed };
		expect(h.session.take(h.disk.record)).toBe('kept');
		expect(h.session.gone).toBe(false);
		expect(h.session.record.path).toBe(renamed);
		expect(h.armed()).toBe(1);

		h.fire();
		await settle();

		expect(h.paths.slice(1)).toEqual([renamed, renamed]);
		expect(h.events).toEqual(['gone', 'conflict', 'saved r3']);
		expect(h.disk.record.body).toBe('Hello Alice again');
		expect(h.session.pending).toBeNull();
	});

	it('discards what is pending on request, writing nothing', async () => {
		const h = harness();
		h.session.changed('Hello Alice');
		expect(h.armed()).toBe(1);

		h.session.discard();
		await h.session.flush();

		expect(h.armed()).toBe(0);
		expect(h.writes).toEqual([]);
		expect(h.disk.record.body).toBe('Hello');
	});

	it('takes a fresh record while nothing is pending, or while only the frontmatter moved', () => {
		const h = harness();

		expect(h.session.take(record('Hello again', 'r5'))).toBe('adopted');
		expect(h.session.baseBody).toBe('Hello again');
		expect(h.session.record.revision).toBe('r5');

		h.session.changed('Hello again, typed');
		expect(h.session.take({ ...record('Hello again', 'r6'), color: 'macaron-3' })).toBe('adopted');
		expect(h.session.record.revision).toBe('r6');
		expect(h.session.pending).toBe('Hello again, typed');
		expect(h.session.baseBody).toBe('Hello again');

		expect(h.session.take(record('Something else', 'r7'))).toBe('kept');
		expect(h.session.record.revision).toBe('r6');
	});

	it('flushes on disposal and answers nothing after', async () => {
		const h = harness();
		h.session.changed('Hello at last');
		expect(h.armed()).toBe(1);

		await h.session.dispose();

		expect(h.armed()).toBe(0);
		expect(h.writes).toEqual(['Hello at last']);
		h.session.changed('Hello after');
		expect(h.session.pending).toBeNull();
		expect(h.armed()).toBe(0);
	});
});
