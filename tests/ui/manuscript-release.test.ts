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
	el: { removeClass(name: string): void };
}

async function microtasks(): Promise<void> {
	for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
}

/** A stream holding two notes, the first being written in, with the drawing of prose in the test's hands. */
function stream() {
	const saves: { path: string; body: string; revision: string }[] = [];
	const unmounted: string[] = [];
	/** What happened, in order: the save, the editor going, the prose drawn. */
	const order: string[] = [];
	let drawn = (): void => undefined;
	const drawing = new Promise<void>((resolve) => {
		drawn = resolve;
	});
	const host = {
		saveManuscriptSegment: vi.fn(async (path: string, body: string, revision: string) => {
			saves.push({ path, body, revision });
			order.push('saved');
			return { revision: `${revision}+` };
		}),
		readManuscriptSegment: vi.fn(),
		manuscriptWritingChanged: vi.fn(),
		translateForProject: (_locale: unknown, key: string) => key,
	};
	const element = { removeClass: (): void => undefined };
	const one: Entry = { path: 'Novel/50_Manuscript/One.md', text: { body: 'one', revision: 'r1' }, editor: { open: true }, pending: null, el: element };
	const two: Entry = { path: 'Novel/50_Manuscript/Two.md', text: { body: 'two', revision: 'r2' }, editor: null, pending: null, el: element };
	const view = Object.create(SnowflakeManuscriptView.prototype) as SnowflakeManuscriptView;
	Object.assign(view, {
		host,
		mounted: new Map([[one.path, one], [two.path, two]]),
		saving: Promise.resolve(),
		flushesUnderWay: 0,
		saveTimer: null,
		saveWindow: null,
		editingPath: one.path,
		editingSelection: 'chosen',
		wikilinkTargets: null,
		streamEl: null,
		contentsMargin: null,
		backend: {
			unmount: (path: string): Promise<void> => {
				unmounted.push(path);
				order.push('editor gone');
				return Promise.resolve();
			},
		},
		t: (key: string) => key,
		// The parts of leaving a note that only dress the page.
		dropCaretCard: (): void => undefined,
		refreshWriteToggles: (): void => undefined,
		refreshToolbar: (): void => undefined,
		syncContents: (): void => undefined,
		holdProse: (): null => null,
		holdPosition: (): (() => void) => () => undefined,
		quietly: <T>(work: () => Promise<T> | T): Promise<T> => Promise.resolve(work()),
		renderSegmentBody: async (): Promise<void> => {
			await drawing;
			order.push('prose drawn');
		},
		showError: (error: unknown): void => {
			throw error;
		},
	});
	return { view, host, saves, unmounted, order, one, two, drawn: () => drawn() };
}

/**
 * Giving a note up to a writer outside the stream: a caller of the local
 * API, about to change the note the author has open for writing.
 */
describe('releasing a note from the stream', () => {
	it('saves what was typed and takes the editor down before it answers, without waiting for the page', async () => {
		const { view, saves, unmounted, order, one, drawn } = stream();
		one.pending = 'one, and more';
		const released = await view.releaseSegment(one.path);
		expect(released).toBe('released');
		// The author's words are in the file, on the revision the stream held.
		expect(saves).toEqual([{ path: one.path, body: 'one, and more', revision: 'r1' }]);
		expect(one.pending).toBeNull();
		// Nothing is being written in, and the editor is gone: no key pressed now can land on the other writer's text.
		expect(view.isEditing()).toBe(false);
		expect(unmounted).toEqual([one.path]);
		expect(one.editor).toBeNull();
		// The prose is still being drawn, and nobody waited for it.
		expect(order).toEqual(['saved', 'editor gone']);
		drawn();
		await microtasks();
		expect(order).toEqual(['saved', 'editor gone', 'prose drawn']);
	});

	it('leaves alone a note that is not the one being written in', async () => {
		const { view, saves, unmounted, one, two } = stream();
		one.pending = 'still typing';
		expect(await view.releaseSegment(two.path)).toBe('absent');
		expect(await view.releaseSegment('Novel/50_Manuscript/Elsewhere.md')).toBe('absent');
		expect(view.isEditing()).toBe(true);
		expect(saves).toEqual([]);
		expect(unmounted).toEqual([]);
		expect(one.pending).toBe('still typing');
	});

	it('has nothing to release once the author has left the note', async () => {
		const { view, one, unmounted, drawn } = stream();
		drawn();
		await view.stopEditing();
		expect(unmounted).toEqual([one.path]);
		expect(await view.releaseSegment(one.path)).toBe('absent');
		expect(unmounted).toEqual([one.path]);
	});

	it('keeps the note and its editor where what was typed would not go to the file', async () => {
		const { view, host, unmounted, one } = stream();
		const shown: string[] = [];
		Object.assign(view, {
			showError: (error: unknown): void => {
				shown.push(error instanceof Error ? error.message : String(error));
			},
		});
		host.saveManuscriptSegment.mockRejectedValue(new Error('disk full'));
		one.pending = 'one, and more';
		expect(await view.releaseSegment(one.path)).toBe('unsaved');
		await microtasks();
		// The author is told once, and goes on writing where they were: the words are still theirs to save.
		expect(shown).toEqual(['disk full']);
		expect(view.isEditing()).toBe(true);
		expect(unmounted).toEqual([]);
		expect(one.editor).not.toBeNull();
		expect(one.pending).toBe('one, and more');
		expect(one.text).toEqual({ body: 'one', revision: 'r1' });
		// Once the file takes them, the note is given up as any other.
		host.saveManuscriptSegment.mockImplementation((_path: string, _body: string, revision: string) => Promise.resolve({ revision: `${revision}+` }));
		expect(await view.releaseSegment(one.path)).toBe('released');
		expect(one.pending).toBeNull();
		expect(unmounted).toEqual([one.path]);
	});

	it('carries words typed while the save was on its way before it gives the note up', async () => {
		const { view, host, saves, one } = stream();
		one.pending = 'one, and more';
		host.saveManuscriptSegment.mockImplementationOnce((path: string, body: string, revision: string) => {
			saves.push({ path, body, revision });
			// A key pressed while the file was being written.
			one.pending = 'one, and more still';
			return Promise.resolve({ revision: `${revision}+` });
		});
		expect(await view.releaseSegment(one.path)).toBe('released');
		expect(saves.map((save) => save.body)).toEqual(['one, and more', 'one, and more still']);
		expect(one.pending).toBeNull();
	});

	it('is the author’s own way out of a note up to the redraw, which that way waits for', async () => {
		const { view, order, drawn } = stream();
		let stopped = false;
		const stopping = view.stopEditing().then(() => {
			stopped = true;
		});
		await microtasks();
		// Leaving by hand holds the reader's place across the swap, and so waits for the prose.
		expect(order).toEqual(['editor gone']);
		expect(stopped).toBe(false);
		drawn();
		await stopping;
		expect(order).toEqual(['editor gone', 'prose drawn']);
	});
});
