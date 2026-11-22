import { describe, expect, it } from 'vitest';

import { CHAPTER_ONE, CHAPTER_TWO, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

const DRAFT = '50_Manuscript/Draft.md';
const FIRST = '50_Manuscript/Chapter 1.md';
const SECOND = '50_Manuscript/Chapter 2.md';
const THIRD = '50_Manuscript/Chapter 3.md';

/** A vault of its own for each test, with what was asked of the editors and told of the vault's making forgotten. */
async function fresh(start: Parameters<typeof createGolden>[0] = {}): Promise<Golden> {
	const golden = await createGolden(start);
	golden.host.origins.length = 0;
	golden.host.editors.length = 0;
	return golden;
}
const addresses = async (golden: Golden): Promise<unknown[]> =>
	(bodyOf((await golden.call('listManuscriptNotes', { projectId: golden.project.id })).body)['items'] as Body[]).map((note) => note['relativePath']);
const read = async (golden: Golden, notePath: string): Promise<Body> =>
	bodyOf((await golden.call('getManuscriptNote', { projectId: golden.project.id, notePath })).body);
const noteOf = (reply: { body: unknown }): Body => bodyOf(bodyOf(reply.body)['note']);

describe('the numbering around a note, planned', () => {
	const plan = async (golden: Golden, params: Body): Promise<Body> => {
		const reply = await golden.call('planManuscriptNumbering', { projectId: golden.project.id, ...params });
		expect([reply.status, faults(reply)], JSON.stringify(params)).toEqual([200, []]);
		return bodyOf(reply.body);
	};

	it('says the name a new note is offered and the notes that would move up by one', async () => {
		const golden = await fresh();
		expect(await plan(golden, { after: FIRST })).toEqual({ rule: true, head: 'Chapter 2', renames: [{ from: SECOND, to: THIRD }] });
		expect(await plan(golden, { position: 'end' })).toEqual({ rule: true, head: 'Chapter 3', renames: [] });
		expect(await plan(golden, { position: 'start' })).toEqual({
			rule: true,
			head: 'Chapter 1',
			renames: [
				{ from: FIRST, to: SECOND },
				{ from: SECOND, to: THIRD },
			],
		});
		// After a note that is not numbered, while others are, nothing is offered.
		expect(await plan(golden, { after: DRAFT })).toEqual({ rule: true, head: null, renames: [] });
	});

	it('says the notes that would move down by one after a note that goes', async () => {
		const golden = await fresh();
		expect(await plan(golden, { remove: FIRST })).toEqual({ rule: true, head: null, renames: [{ from: SECOND, to: FIRST }] });
		expect(await plan(golden, { remove: DRAFT })).toEqual({ rule: true, head: null, renames: [] });
	});

	it('offers and renames nothing where the author has no rule switched on', async () => {
		const golden = await fresh({ numbering: { style: 'off', rules: [] } });
		expect(await plan(golden, { after: FIRST })).toEqual({ rule: false, head: null, renames: [] });
		expect(await plan(golden, { remove: FIRST })).toEqual({ rule: false, head: null, renames: [] });
	});

	it('wants exactly one place, and a note that is there, and changes nothing', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const P = { projectId: golden.project.id };
		expect(refusal(await golden.call('planManuscriptNumbering', P))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('planManuscriptNumbering', { ...P, after: FIRST, position: 'end' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('planManuscriptNumbering', { ...P, remove: '50_Manuscript/Nowhere.md' }))).toEqual([400, 'invalid-request']);
		await plan(golden, { position: 'start' });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.editors).toEqual([]);
	});
});

describe('a manuscript note, made', () => {
	it('goes to the end under the name the rule offers where nothing is said, with the plugin’s own first line', async () => {
		const golden = await fresh();
		const reply = await golden.call('createManuscriptNote', { projectId: golden.project.id }, { body: {} });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(noteOf(reply)).toMatchObject({ relativePath: THIRD, title: 'Chapter 3', index: 3, heading: 'Chapter 3', previous: SECOND, next: null });
		expect(bodyOf(reply.body)).toMatchObject({ renumbered: [], skipped: [] });
		expect(reply.location).toBe(`/projects/${golden.project.id}/manuscript/notes/50_Manuscript%2FChapter%203.md`);
		expect(reply.etag).toBe(noteOf(reply)['etag']);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('goes after the note named with the words sent, the numbered notes after it moving up by one', async () => {
		const golden = await fresh();
		const reply = await golden.call('createManuscriptNote', { projectId: golden.project.id }, { body: { after: FIRST, body: 'Between the two.\n' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(noteOf(reply)).toMatchObject({ relativePath: SECOND, title: 'Chapter 2', index: 2, body: 'Between the two.\n', previous: FIRST, next: THIRD });
		expect(bodyOf(reply.body)['renumbered']).toEqual([{ from: SECOND, to: THIRD }]);
		expect(await addresses(golden)).toEqual([DRAFT, FIRST, SECOND, THIRD]);
		// What was the second chapter is the third now, with every word it had.
		expect((await read(golden, THIRD))['body']).toBe(CHAPTER_TWO);
	});

	it('leaves the other names alone where it is told to, and takes a name of its own', async () => {
		const golden = await fresh();
		const reply = await golden.call(
			'createManuscriptNote',
			{ projectId: golden.project.id },
			{ body: { title: ' Interlude ', position: 'start', renumber: false } },
		);
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(noteOf(reply)).toMatchObject({ title: 'Interlude', index: 0 });
		expect(bodyOf(reply.body)['renumbered']).toEqual([]);
		expect(await addresses(golden)).toEqual(['50_Manuscript/Interlude.md', DRAFT, FIRST, SECOND]);
	});

	it('is refused with no title where the rule offers none, and after a note that is not there', async () => {
		const golden = await fresh({ numbering: { style: 'off', rules: [] } });
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const untitled = await golden.call('createManuscriptNote', P, { body: {} });
		expect(refusal(untitled)).toEqual([400, 'invalid-request']);
		expect(bodyOf(untitled.body)['errors']).toMatchObject([{ pointer: '/title' }]);
		const nowhere = await golden.call('createManuscriptNote', P, { body: { title: 'New', after: '20_Character/Ada.md' } });
		expect(bodyOf(nowhere.body)['errors']).toMatchObject([{ pointer: '/after' }]);
		expect(vaultState(golden.host)).toEqual(before);
		expect((await golden.call('createManuscriptNote', P, { body: { title: 'New' } })).status).toBe(201);
	});
});

describe('a manuscript note’s text, written', () => {
	it('is replaced against the version it was read at, the editor on it closed before the write', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, notePath: FIRST };
		const before = await read(golden, FIRST);
		const reply = await golden.call('writeManuscriptNoteBody', params, { body: { body: '# Chapter 1\n\nThe clock stopped at noon.\n' }, ifMatch: String(before['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const after = bodyOf(reply.body);
		expect(after).toMatchObject({ relativePath: FIRST, body: '# Chapter 1\n\nThe clock stopped at noon.\n', index: 1 });
		expect(after['etag']).not.toBe(before['etag']);
		expect(reply.etag).toBe(after['etag']);
		// What the author had typed is saved first, the editor is closed, and only then is the note written.
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.first}`, `release ${golden.manuscript.first}`, `write ${golden.manuscript.first}`]);
		expect(golden.host.origins).toEqual([false]);
	});

	it('is refused without a version, and against one the note has left behind, the author left writing where they were', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, notePath: FIRST };
		const standing = await read(golden, FIRST);
		const before = vaultState(golden.host);
		expect(refusal(await golden.call('writeManuscriptNoteBody', params, { body: { body: 'New.' } }))).toEqual([428, 'precondition-required']);
		expect(golden.host.editors).toEqual([]);
		const stale = await golden.call('writeManuscriptNoteBody', params, { body: { body: 'New.' }, ifMatch: 'fp1-0000000000000000' });
		expect(refusal(stale)).toEqual([412, 'concurrent-change']);
		expect(bodyOf(stale.body)['currentEtag']).toBe(standing['etag']);
		expect(vaultState(golden.host)).toEqual(before);
		// Asked to save, and never asked to close.
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.first}`]);
	});

	it('is refused where the author typed in the note and had not saved, their words saved and nothing made over them', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, notePath: FIRST };
		const seen = await read(golden, FIRST);
		// The author goes on typing in the stream after the caller read the note.
		golden.host.typed.set(golden.manuscript.first, `${CHAPTER_ONE}\nAnd then it started again.\n`);
		const reply = await golden.call('writeManuscriptNoteBody', params, { body: { body: 'A change worked out from the older text.\n' }, ifMatch: String(seen['etag']) });
		expect(refusal(reply)).toEqual([412, 'concurrent-change']);
		const now = await read(golden, FIRST);
		expect(now['body']).toBe(`${CHAPTER_ONE}\nAnd then it started again.\n`);
		expect(bodyOf(reply.body)['currentEtag']).toBe(now['etag']);
		// The author's own save, told as theirs, and no editor closed under them.
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.first}`, `write ${golden.manuscript.first}`]);
		expect(golden.host.origins).toEqual([true]);

		// Read again and sent against the text as it now stands, the change lands.
		const again = await golden.call('writeManuscriptNoteBody', params, { body: { body: `${String(now['body'])}\nAt noon.\n` }, ifMatch: String(now['etag']) });
		expect([again.status, faults(again)]).toEqual([200, []]);
		expect(bodyOf(again.body)['body']).toBe(`${CHAPTER_ONE}\nAnd then it started again.\n\nAt noon.\n`);
	});

	it('takes any version where the caller says so, still after the author’s own words are saved', async () => {
		const golden = await fresh();
		golden.host.typed.set(golden.manuscript.second, 'Typed and not yet saved.\n');
		const reply = await golden.call('writeManuscriptNoteBody', { projectId: golden.project.id, notePath: SECOND }, { body: { body: 'Whatever stands, this replaces it.\n' }, ifMatch: '*' });
		expect([reply.status, bodyOf(reply.body)['body']]).toEqual([200, 'Whatever stands, this replaces it.\n']);
		expect(golden.host.editors).toEqual([
			`settle ${golden.manuscript.second}`,
			`write ${golden.manuscript.second}`,
			`release ${golden.manuscript.second}`,
			`write ${golden.manuscript.second}`,
		]);
		expect(golden.host.origins).toEqual([true, false]);
	});

	it('takes a note read and sent back whole, and is not found for a note that is no part of the manuscript', async () => {
		const golden = await fresh();
		const note = await read(golden, SECOND);
		const reply = await golden.call(
			'writeManuscriptNoteBody',
			{ projectId: golden.project.id, notePath: SECOND },
			{ body: { ...structuredClone(note), body: 'Ben came home.\n' }, ifMatch: String(note['etag']) },
		);
		expect([reply.status, faults(reply), bodyOf(reply.body)['body']]).toEqual([200, [], 'Ben came home.\n']);
		const outside = await golden.call('writeManuscriptNoteBody', { projectId: golden.project.id, notePath: '20_Character/Ada.md' }, { body: { body: 'x' }, ifMatch: '*' });
		expect(refusal(outside)).toEqual([404, 'not-found']);
	});
});

describe('a manuscript note, renamed', () => {
	it('takes a new title and a new address, its heading following where it said the old title', async () => {
		const golden = await fresh();
		const reply = await golden.call('renameManuscriptNote', { projectId: golden.project.id, notePath: FIRST }, { body: { title: 'Opening' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(noteOf(reply)).toMatchObject({
			relativePath: '50_Manuscript/Opening.md',
			title: 'Opening',
			index: 1,
			heading: 'Opening',
			headingMatchesTitle: true,
			body: '# Opening\n\nThe clock stopped at midnight.\n',
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/manuscript/notes/50_Manuscript%2FOpening.md`);
		expect(await addresses(golden)).toEqual([DRAFT, '50_Manuscript/Opening.md', SECOND]);
		expect(golden.host.editors.slice(0, 2)).toEqual([`settle ${golden.manuscript.first}`, `release ${golden.manuscript.first}`]);
		expect(golden.host.origins).toEqual([false]);
	});

	it('keeps its heading where it is told to, and is refused a title another note has', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const kept = await golden.call('renameManuscriptNote', { ...P, notePath: FIRST }, { body: { title: 'Opening', heading: false } });
		expect(noteOf(kept)).toMatchObject({ title: 'Opening', heading: 'Chapter 1', headingMatchesTitle: false });
		const before = vaultState(golden.host);
		const taken = await golden.call('renameManuscriptNote', { ...P, notePath: SECOND }, { body: { title: 'Opening' } });
		expect(refusal(taken)).toEqual([409, 'path-conflict']);
		expect(faults(taken)).toEqual([]);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a manuscript note, split', () => {
	it('is cut where the words named begin, the rest going into a new note right after it', async () => {
		const golden = await fresh();
		const note = await read(golden, SECOND);
		const reply = await golden.call(
			'splitManuscriptNote',
			{ projectId: golden.project.id, notePath: SECOND },
			{ body: { at: { exact: 'Nobody asked why.' } }, ifMatch: String(note['etag']) },
		);
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(noteOf(reply)).toMatchObject({ relativePath: THIRD, title: 'Chapter 3', index: 3, body: 'Nobody asked why.\n', previous: SECOND });
		const head = await read(golden, SECOND);
		expect(head['body']).toBe('Ben did not come home.\n');
		expect(bodyOf(reply.body)['source']).toEqual({ relativePath: SECOND, etag: head['etag'] });
		expect(reply.location).toBe(`/projects/${golden.project.id}/manuscript/notes/50_Manuscript%2FChapter%203.md`);
		expect(golden.host.origins.length).toBeGreaterThan(0);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('is cut at a place in its text, under a name of its own, the numbered notes after it moving up', async () => {
		const golden = await fresh();
		const reply = await golden.call(
			'splitManuscriptNote',
			{ projectId: golden.project.id, notePath: FIRST },
			{ body: { at: { offset: CHAPTER_ONE.indexOf('The clock') } }, ifMatch: '*' },
		);
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(noteOf(reply)).toMatchObject({ relativePath: SECOND, title: 'Chapter 2', body: 'The clock stopped at midnight.\n' });
		expect(bodyOf(reply.body)['renumbered']).toEqual([{ from: SECOND, to: THIRD }]);
		expect((await read(golden, FIRST))['body']).toBe('# Chapter 1\n');
		expect((await read(golden, THIRD))['body']).toBe(CHAPTER_TWO);
	});

	it('is refused words the note does not say, and words it says more than once until a few around them are given', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, notePath: SECOND };
		const written = await golden.call('writeManuscriptNoteBody', params, { body: { body: 'He waited. Then he left.\n\nShe waited. Then she left.\n' }, ifMatch: '*' });
		const etag = String(bodyOf(written.body)['etag']);
		const before = vaultState(golden.host);
		const absent = await golden.call('splitManuscriptNote', params, { body: { at: { exact: 'Nobody asked why.' } }, ifMatch: etag });
		expect(refusal(absent)).toEqual([422, 'passage-not-found']);
		const twice = await golden.call('splitManuscriptNote', params, { body: { at: { exact: 'waited. Then' } }, ifMatch: etag });
		expect(refusal(twice)).toEqual([422, 'ambiguous-passage']);
		expect(faults(twice)).toEqual([]);
		expect(vaultState(golden.host)).toEqual(before);
		const told = await golden.call('splitManuscriptNote', params, { body: { at: { exact: 'waited. Then', prefix: 'She ' }, title: 'After' }, ifMatch: etag });
		expect([told.status, noteOf(told)['body']]).toEqual([201, 'waited. Then she left.\n']);
	});

	it('is refused without a version, and where the author typed in the note since it was read', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, notePath: SECOND };
		const seen = await read(golden, SECOND);
		expect(refusal(await golden.call('splitManuscriptNote', params, { body: { at: { offset: 3 } } }))).toEqual([428, 'precondition-required']);
		golden.host.typed.set(golden.manuscript.second, `${CHAPTER_TWO}\nBut somebody knew.\n`);
		const reply = await golden.call('splitManuscriptNote', params, { body: { at: { exact: 'Nobody asked why.' } }, ifMatch: String(seen['etag']) });
		expect(refusal(reply)).toEqual([412, 'concurrent-change']);
		expect(await addresses(golden)).toEqual([DRAFT, FIRST, SECOND]);
		expect((await read(golden, SECOND))['body']).toBe(`${CHAPTER_TWO}\nBut somebody knew.\n`);
	});
});

describe('a manuscript note, merged with the one after it', () => {
	it('takes the later note’s words after its own, and the later note goes to the trash', async () => {
		const golden = await fresh();
		const reply = await golden.call('mergeManuscriptNoteWithNext', { projectId: golden.project.id, notePath: FIRST });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(noteOf(reply)).toMatchObject({ relativePath: FIRST, title: 'Chapter 1', body: `${CHAPTER_ONE}\n${CHAPTER_TWO}`, next: null });
		expect(bodyOf(reply.body)).toMatchObject({ removed: SECOND, renumbered: [] });
		expect(await addresses(golden)).toEqual([DRAFT, FIRST]);
		expect(golden.host.environment.fakeFileManager.trashCalls).toEqual([golden.manuscript.second]);
		// Both notes are saved and closed before either is touched.
		expect(golden.host.editors.slice(0, 2)).toEqual([
			`settle ${golden.manuscript.first}, ${golden.manuscript.second}`,
			`release ${golden.manuscript.first}, ${golden.manuscript.second}`,
		]);
	});

	it('is told as the author’s words moved, so the note that takes them gains what the note that goes loses', async () => {
		const golden = await fresh();
		await golden.call('mergeManuscriptNoteWithNext', { projectId: golden.project.id, notePath: FIRST });
		expect(golden.host.origins).toEqual([true]);
	});

	it('takes the words the author had typed in either note and not saved', async () => {
		const golden = await fresh();
		golden.host.typed.set(golden.manuscript.second, `${CHAPTER_TWO}\nBut somebody knew.\n`);
		const reply = await golden.call('mergeManuscriptNoteWithNext', { projectId: golden.project.id, notePath: FIRST });
		expect(noteOf(reply)['body']).toBe(`${CHAPTER_ONE}\n${CHAPTER_TWO}\nBut somebody knew.\n`);
	});

	it('closes the count over the note that goes, unless told to leave the names alone', async () => {
		const golden = await fresh();
		const reply = await golden.call('mergeManuscriptNoteWithNext', { projectId: golden.project.id, notePath: DRAFT });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		// The first chapter went into the note before it, and the second is the first now.
		expect(bodyOf(reply.body)).toMatchObject({ removed: FIRST, renumbered: [{ from: SECOND, to: FIRST }] });
		expect(await addresses(golden)).toEqual([DRAFT, FIRST]);

		const other = await fresh();
		const kept = await other.call('mergeManuscriptNoteWithNext', { projectId: other.project.id, notePath: DRAFT }, { body: { renumber: false } });
		expect(bodyOf(kept.body)['renumbered']).toEqual([]);
		expect(await addresses(other)).toEqual([DRAFT, SECOND]);
	});

	it('is refused for the last note, which has none after it', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const reply = await golden.call('mergeManuscriptNoteWithNext', { projectId: golden.project.id, notePath: SECOND });
		expect(refusal(reply)).toEqual([409, 'nothing-to-merge']);
		expect(faults(reply)).toEqual([]);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a manuscript note, deleted', () => {
	it('goes to the trash against the version it was read at, the numbered notes after it moving down', async () => {
		const golden = await fresh();
		const note = await read(golden, FIRST);
		const reply = await golden.call('deleteManuscriptNote', { projectId: golden.project.id, notePath: FIRST }, { ifMatch: String(note['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(reply.body).toEqual({ removed: FIRST, neighbour: DRAFT, renumbered: [{ from: SECOND, to: FIRST }], skipped: [] });
		expect(golden.host.environment.fakeFileManager.trashCalls).toEqual([golden.manuscript.first]);
		expect(await addresses(golden)).toEqual([DRAFT, FIRST]);
		expect((await read(golden, FIRST))['body']).toBe(CHAPTER_TWO);
	});

	it('leaves the other names alone where it is told to', async () => {
		const golden = await fresh();
		const reply = await golden.call('deleteManuscriptNote', { projectId: golden.project.id, notePath: FIRST, renumber: false }, { ifMatch: '*' });
		expect(bodyOf(reply.body)).toMatchObject({ removed: FIRST, renumbered: [] });
		expect(await addresses(golden)).toEqual([DRAFT, SECOND]);
	});

	it('is refused without a version, and where the author typed in the note since it was read, which is then not deleted', async () => {
		const golden = await fresh();
		const params = { projectId: golden.project.id, notePath: SECOND };
		const seen = await read(golden, SECOND);
		expect(refusal(await golden.call('deleteManuscriptNote', params))).toEqual([428, 'precondition-required']);
		golden.host.typed.set(golden.manuscript.second, `${CHAPTER_TWO}\nBut somebody knew.\n`);
		const reply = await golden.call('deleteManuscriptNote', params, { ifMatch: String(seen['etag']) });
		expect(refusal(reply)).toEqual([412, 'concurrent-change']);
		expect(golden.host.environment.fakeFileManager.trashCalls).toEqual([]);
		expect((await read(golden, SECOND))['body']).toBe(`${CHAPTER_TWO}\nBut somebody knew.\n`);
	});
});
