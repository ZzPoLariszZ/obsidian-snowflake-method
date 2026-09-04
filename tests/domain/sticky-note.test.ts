import { describe, expect, it } from 'vitest';

import {
	DEFAULT_STICKY_NOTE_COLOR,
	SCHEMA_VERSION,
	DEFAULT_STICKY_NOTE_FLOAT_STATE,
	FRONTMATTER_KEYS,
	STICKY_NOTE_COLORS,
	STICKY_NOTE_FRONTMATTER_ORDER,
	filterStickyNotes,
	forgetStickyNoteState,
	formatStickyNoteCreated,
	isStickyNoteColor,
	parseStickyNoteCreated,
	partitionStickyNotes,
	patchStickyNoteFloatState,
	readStickyNoteFrontmatter,
	readStickyNoteLocalState,
	sortStickyNotes,
	stepStickyNoteAlpha,
	stickyNoteFileStem,
	stickyNoteFrontmatter,
	stickyNotePreview,
	type StickyNote,
} from '../../src/domain';

const INSTANT = Date.UTC(2026, 8, 4, 5, 14, 32, 123);

const note = (
	id: string,
	overrides: Partial<StickyNote> = {},
): StickyNote => ({
	id,
	path: `Novel/70_Tool/72_Task_Management/724_Sticky_Note/${id}.md`,
	color: 'macaron-1',
	createdAt: INSTANT,
	archived: false,
	body: '',
	...overrides,
});

describe('sticky note stamps', () => {
	it('writes the created stamp and the file stem in the device offset', () => {
		const date = new Date(INSTANT);
		expect(formatStickyNoteCreated(date, -60)).toBe('2026-09-04T06:14:32.123+01:00');
		expect(stickyNoteFileStem(date, -60)).toBe('20260904T061432.123+0100');
		expect(formatStickyNoteCreated(date, 0)).toBe('2026-09-04T05:14:32.123+00:00');
		expect(stickyNoteFileStem(date, 0)).toBe('20260904T051432.123+0000');
		expect(formatStickyNoteCreated(date, 300)).toBe('2026-09-04T00:14:32.123-05:00');
		expect(stickyNoteFileStem(date, 300)).toBe('20260904T001432.123-0500');
		expect(formatStickyNoteCreated(date, -330)).toBe('2026-09-04T10:44:32.123+05:30');
		expect(stickyNoteFileStem(date, -330)).toBe('20260904T104432.123+0530');
	});

	it('reads a stamp back as the instant it names, whatever shape the reader gave it', () => {
		expect(parseStickyNoteCreated('2026-09-04T06:14:32.123+01:00')).toBe(INSTANT);
		// A finer fraction than the parser reads is cut, not refused.
		expect(parseStickyNoteCreated('2026-09-04T06:14:32.123456+01:00')).toBe(INSTANT);
		expect(parseStickyNoteCreated(new Date(INSTANT))).toBe(INSTANT);
		expect(parseStickyNoteCreated(INSTANT)).toBe(INSTANT);
		for (const junk of ['', '   ', 'yesterday', Number.NaN, null, undefined, {}, new Date('nope')]) {
			expect(parseStickyNoteCreated(junk)).toBeNull();
		}
	});
});

describe('sticky note frontmatter', () => {
	const full = {
		[FRONTMATTER_KEYS.document]: 'sticky-note',
		[FRONTMATTER_KEYS.stickyNoteId]: 'sticky-note-1',
		[FRONTMATTER_KEYS.stickyNoteColor]: 'macaron-5',
		[FRONTMATTER_KEYS.created]: '2026-09-04T06:14:32.123+01:00',
		[FRONTMATTER_KEYS.archived]: true,
	};

	it('reads a note with every field', () => {
		expect(readStickyNoteFrontmatter(full, { createdAt: 1 })).toEqual({
			id: 'sticky-note-1',
			color: 'macaron-5',
			createdAt: INSTANT,
			archived: true,
		});
	});

	it('defaults the colour, the flag and the birth rather than dropping the note', () => {
		const read = readStickyNoteFrontmatter(
			{
				[FRONTMATTER_KEYS.document]: 'sticky-note',
				[FRONTMATTER_KEYS.stickyNoteId]: '  sticky-note-2  ',
				[FRONTMATTER_KEYS.stickyNoteColor]: 'macaron-9',
				[FRONTMATTER_KEYS.archived]: 'true',
			},
			{ createdAt: 4242 },
		);
		expect(read).toEqual({
			id: 'sticky-note-2',
			color: DEFAULT_STICKY_NOTE_COLOR,
			createdAt: 4242,
			archived: true,
		});
		expect(
			readStickyNoteFrontmatter(
				{ ...full, [FRONTMATTER_KEYS.archived]: 'yes' },
				{ createdAt: 1 },
			)?.archived,
		).toBe(false);
	});

	it('drops a note of another type or without an id', () => {
		expect(
			readStickyNoteFrontmatter(
				{ ...full, [FRONTMATTER_KEYS.document]: 'character' },
				{ createdAt: 1 },
			),
		).toBeNull();
		expect(
			readStickyNoteFrontmatter(
				{ ...full, [FRONTMATTER_KEYS.stickyNoteId]: '   ' },
				{ createdAt: 1 },
			),
		).toBeNull();
		expect(
			readStickyNoteFrontmatter(
				{ ...full, [FRONTMATTER_KEYS.stickyNoteId]: 7 },
				{ createdAt: 1 },
			),
		).toBeNull();
	});

	it('writes the keys a new note carries, in the order the file keeps them', () => {
		const written = stickyNoteFrontmatter({
			projectId: 'project-1',
			id: 'sticky-note-3',
			color: 'macaron-2',
			created: '2026-09-04T06:14:32.123+01:00',
		});
		expect(Object.keys(written)).toEqual([...STICKY_NOTE_FRONTMATTER_ORDER]);
		expect(written[FRONTMATTER_KEYS.schema]).toBe(SCHEMA_VERSION);
		expect(written[FRONTMATTER_KEYS.archived]).toBe(false);
		expect(STICKY_NOTE_FRONTMATTER_ORDER[0]).toBe(FRONTMATTER_KEYS.schema);
		expect(STICKY_NOTE_COLORS.every(isStickyNoteColor)).toBe(true);
		expect(isStickyNoteColor('macaron-0')).toBe(false);
	});
});

describe('sticky note preview', () => {
	it('takes the marks off and reads as one line', () => {
		const body = [
			'# Heading',
			'',
			'> A *quoted* **thought** with `code` and ~~struck~~ words,',
			'- a [[Some/Note|linked]] item and a [site](https://example.org),',
			'1. [ ] an image ![alt text](pic.png) too',
			'',
			'<!-- hidden -->',
			'_emphasised_ but snake_case kept',
		].join('\n');
		expect(stickyNotePreview(body, 400)).toBe(
			'Heading A quoted thought with code and struck words, a linked item and a site, an image alt text too emphasised but snake_case kept',
		);
	});

	it('cuts by the characters an eye counts and marks the cut', () => {
		const cjk = '雪'.repeat(130);
		const preview = stickyNotePreview(cjk);
		expect([...preview]).toHaveLength(121);
		expect(preview.endsWith('…')).toBe(true);
		expect(stickyNotePreview('short note')).toBe('short note');
		expect(stickyNotePreview('  \n\t ')).toBe('');
		expect(stickyNotePreview('abc def', 3)).toBe('abc…');
	});
});

describe('sticky note listing', () => {
	const notes = [
		note('a', { body: 'Remember the Heron by the water', createdAt: 3 }),
		note('b', { body: 'buy water colours', color: 'macaron-4', createdAt: 1 }),
		note('c', { body: 'Water. Heron. Again.', color: 'macaron-4', createdAt: 3 }),
		note('d', { body: 'nothing here', archived: true, createdAt: 2 }),
	];

	it('keeps the notes every term is found in, case aside, in any colour or one', () => {
		expect(filterStickyNotes(notes, 'water', null).map((n) => n.id)).toEqual(['a', 'b', 'c']);
		expect(filterStickyNotes(notes, '  HERON   water ', null).map((n) => n.id)).toEqual(['a', 'c']);
		expect(filterStickyNotes(notes, 'water', 'macaron-4').map((n) => n.id)).toEqual(['b', 'c']);
		expect(filterStickyNotes(notes, '', 'macaron-1').map((n) => n.id)).toEqual(['a', 'd']);
		expect(filterStickyNotes(notes, 'colours heron', null)).toEqual([]);
	});

	it('sorts by birth either way, ties by id, and leaves the input alone', () => {
		const before = [...notes];
		expect(sortStickyNotes(notes, 'newest').map((n) => n.id)).toEqual(['a', 'c', 'd', 'b']);
		expect(sortStickyNotes(notes, 'oldest').map((n) => n.id)).toEqual(['b', 'd', 'a', 'c']);
		expect(notes).toEqual(before);
	});

	it('splits the set-aside notes from the active ones', () => {
		const { active, archived } = partitionStickyNotes(notes);
		expect(active.map((n) => n.id)).toEqual(['a', 'b', 'c']);
		expect(archived.map((n) => n.id)).toEqual(['d']);
	});
});

describe('sticky note device state', () => {
	it('reads junk of any shape as nothing remembered', () => {
		for (const junk of [undefined, null, 'state', 7, [], { notes: null }, { notes: 'x' }]) {
			expect(readStickyNoteLocalState(junk)).toEqual({ version: 1, notes: {} });
		}
		expect(readStickyNoteLocalState({ notes: { '': { float: {} }, a: 'nope' } })).toEqual({
			version: 1,
			notes: {},
		});
	});

	it('makes a remembered note safe: numbers finite, sizes floored, alpha stepped, the face known', () => {
		const state = readStickyNoteLocalState({
			notes: {
				a: {
					float: {
						open: 'yes',
						x: Number.NaN,
						y: 40,
						width: 10,
						height: Number.POSITIVE_INFINITY,
						locked: 1,
						alpha: 55,
						mode: 'reading',
					},
				},
			},
		});
		expect(state.notes.a?.float).toEqual({
			...DEFAULT_STICKY_NOTE_FLOAT_STATE,
			y: 40,
			width: 120,
			alpha: 60,
		});
		expect(readStickyNoteLocalState({ notes: { b: {} } }).notes.b?.float).toEqual(
			DEFAULT_STICKY_NOTE_FLOAT_STATE,
		);
	});

	it('round-trips a good state, patches one note and forgets one note', () => {
		const good = readStickyNoteLocalState({
			version: 1,
			notes: {
				a: { float: { open: true, x: 10, y: 20, width: 300, height: 200, locked: true, alpha: 70, mode: 'editing' } },
				b: { float: { open: false, x: 1, y: 2, width: 200, height: 150, locked: false, alpha: 100, mode: 'viewing' } },
			},
		});
		expect(readStickyNoteLocalState(good)).toEqual(good);
		const patched = patchStickyNoteFloatState(good, 'a', { x: 99, locked: false });
		expect(patched.notes.a?.float).toEqual({ ...good.notes.a?.float, x: 99, locked: false });
		expect(patched.notes.b).toEqual(good.notes.b);
		expect(good.notes.a?.float.x).toBe(10);
		expect(patchStickyNoteFloatState(good, 'c', { open: true }).notes.c?.float).toEqual({
			...DEFAULT_STICKY_NOTE_FLOAT_STATE,
			open: true,
		});
		const forgotten = forgetStickyNoteState(patched, 'a');
		expect(Object.keys(forgotten.notes)).toEqual(['b']);
		expect(patched.notes.a).toBeDefined();
	});

	it('steps transparency to the tens between the floor and full', () => {
		expect(stepStickyNoteAlpha(Number.NaN)).toBe(100);
		expect(stepStickyNoteAlpha(0)).toBe(30);
		expect(stepStickyNoteAlpha(55)).toBe(60);
		expect(stepStickyNoteAlpha(64)).toBe(60);
		expect(stepStickyNoteAlpha(100)).toBe(100);
		expect(stepStickyNoteAlpha(150)).toBe(100);
	});
});
