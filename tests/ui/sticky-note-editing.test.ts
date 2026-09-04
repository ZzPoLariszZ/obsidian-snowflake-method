import { describe, expect, it } from 'vitest';

import type { StickyNoteRecord } from '../../src/services';
import {
	StickyNoteEditSession,
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
	/** The file as the fake vault holds it; `gone` once it has been deleted. */
	disk: { record: StickyNoteRecord; gone: boolean };
	events: string[];
	writes: string[];
	fire(): void;
	armed(): number;
}

const harness = (initial = record('Hello', 'r1')): Harness => {
	const disk: Harness['disk'] = { record: initial, gone: false };
	const events: string[] = [];
	const writes: string[] = [];
	const timers = new Map<number, () => void>();
	let handles = 0;
	const io: StickyNoteEditIo = {
		write: (path, body, expectedRevision) => {
			writes.push(body);
			if (disk.record.revision !== expectedRevision) {
				return Promise.reject(new StickyNoteSaveConflict('moved'));
			}
			if (disk.gone) return Promise.reject(new Error('gone'));
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
		h.disk.gone = true;

		await h.session.flush();

		expect(h.events).toEqual(['error Error: gone']);
		expect(h.session.pending).toBe('Hello Alice');
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
