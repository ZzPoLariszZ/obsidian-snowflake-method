import { beforeAll, describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

let golden: Golden;
beforeAll(async () => {
	golden = await createGolden();
});

const pid = (): string => golden.project.id;
const FOLDER = 'Snowflake Projects/North Wind/50_Manuscript';

describe('the manuscript', () => {
	it('says how many notes it has, how much is written in them, and by which convention that was counted', async () => {
		const reply = await golden.call('getManuscript', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const manuscript = bodyOf(reply.body);
		expect(manuscript).toMatchObject({
			path: FOLDER,
			notes: 3,
			unreadable: 0,
			firstNotePath: golden.manuscript.draft,
			counting: { mode: 'ms-word', headings: 'count' },
		});
		// "Chapter 1", "The clock stopped at midnight.", "Ben did not come home.", "Nobody asked why.", and what a new project's first note says.
		expect(bodyOf(manuscript['count'])['words']).toBeGreaterThanOrEqual(15);
	});

	it('is counted by the convention the author chose', async () => {
		const other = await createGolden({ counting: { mode: 'jinjiang', headings: 'skip-all' } });
		const words = bodyOf(bodyOf((await golden.call('getManuscript', { projectId: pid() })).body)['count'])['total'] as number;
		const reply = await other.call('getManuscript', { projectId: other.project.id });
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)['counting']).toEqual({ mode: 'jinjiang', headings: 'skip-all' });
		// Every character that is not a space, against every word.
		expect(bodyOf(bodyOf(reply.body)['count'])['total']).toBeGreaterThan(words);
	});
});

describe('the manuscript’s notes, listed', () => {
	it('come in reading order, each by where it stands inside the project, and without their text', async () => {
		const reply = await golden.call('listManuscriptNotes', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((note) => [note['index'], note['title'], note['relativePath']])).toEqual([
			[0, 'Draft', '50_Manuscript/Draft.md'],
			[1, 'Chapter 1', '50_Manuscript/Chapter 1.md'],
			[2, 'Chapter 2', '50_Manuscript/Chapter 2.md'],
		]);
		expect(items(reply.body)[1]).toEqual({
			relativePath: '50_Manuscript/Chapter 1.md',
			path: `${FOLDER}/Chapter 1.md`,
			title: 'Chapter 1',
			index: 1,
			readOnly: false,
		});
	});

	it('say how much is written in each where that is asked for', async () => {
		const reply = await golden.call('listManuscriptNotes', { projectId: pid(), include: 'counts' });
		expect(faults(reply)).toEqual([]);
		const totals = items(reply.body).map((note) => note['total']);
		// "Chapter 1" and five words, then eight words.
		expect(totals.slice(1)).toEqual([7, 8]);
		expect((await golden.call('listManuscriptNotes', { projectId: pid(), include: 'words' })).status).toBe(400);
	});

	it('come a page at a time and can be narrowed by title, each note keeping its place in the whole', async () => {
		const page = await golden.call('listManuscriptNotes', { projectId: pid(), limit: 2, offset: 1 });
		expect(bodyOf(page.body)).toMatchObject({ total: 3, offset: 1, limit: 2, nextOffset: null });
		expect(items(page.body).map((note) => note['title'])).toEqual(['Chapter 1', 'Chapter 2']);
		const narrowed = await golden.call('listManuscriptNotes', { projectId: pid(), q: 'chapter 2' });
		expect(items(narrowed.body)).toMatchObject([{ title: 'Chapter 2', index: 2 }]);
	});
});

describe('one manuscript note', () => {
	it('is read with its whole text, its version, its size and the notes on either side of it', async () => {
		const reply = await golden.call('getManuscriptNote', { projectId: pid(), notePath: '50_Manuscript/Chapter 1.md' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const note = bodyOf(reply.body);
		expect(note).toMatchObject({
			relativePath: '50_Manuscript/Chapter 1.md',
			path: golden.manuscript.first,
			title: 'Chapter 1',
			index: 1,
			readOnly: false,
			body: '# Chapter 1\n\nThe clock stopped at midnight.\n',
			heading: 'Chapter 1',
			headingMatchesTitle: true,
			counting: { mode: 'ms-word', headings: 'count' },
			previous: '50_Manuscript/Draft.md',
			next: '50_Manuscript/Chapter 2.md',
		});
		expect(bodyOf(note['count'])).toMatchObject({ total: 7, words: 7 });
		expect(String(note['etag'])).toMatch(/^fp1-[0-9a-f]{16}$/u);
		expect(reply.etag).toBe(note['etag']);
	});

	it('says it has no heading where it has none, and no note after it where it is the last', async () => {
		const reply = await golden.call('getManuscriptNote', { projectId: pid(), notePath: '50_Manuscript/Chapter 2.md' });
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({ heading: null, headingMatchesTitle: false, next: null, previous: '50_Manuscript/Chapter 1.md' });
	});

	it('is found only where it is a note of this project’s manuscript, however its address is spelled', async () => {
		const outside = [
			// A note of the project that is no part of its manuscript.
			golden.members.ada.path.slice('Snowflake Projects/North Wind/'.length),
			// The project's own properties.
			golden.project.projectFile.slice('Snowflake Projects/North Wind/'.length),
			// A way back out of the manuscript's folder.
			'50_Manuscript/../20_Character/Ada.md',
			// Another project's manuscript.
			'../北境之雪/50_正文/初稿.md',
			// A path from the top of the vault.
			'/Snowflake Projects/North Wind/50_Manuscript/Chapter 1.md',
			'50_Manuscript/No such chapter.md',
			'50_Manuscript',
		];
		for (const notePath of outside) {
			const reply = await golden.call('getManuscriptNote', { projectId: pid(), notePath });
			expect([reply.status, bodyOf(reply.body)['code']], notePath).toEqual([404, 'not-found']);
			expect(faults(reply), notePath).toEqual([]);
		}
	});

	it('is read under its own project’s names in another language', async () => {
		const list = await golden.call('listManuscriptNotes', { projectId: golden.chinese.id });
		expect(items(list.body).map((note) => note['relativePath'])).toEqual(['50_正文/初稿.md']);
		const note = await golden.call('getManuscriptNote', { projectId: golden.chinese.id, notePath: '50_正文/初稿.md' });
		expect(note.status).toBe(200);
		expect(faults(note)).toEqual([]);
	});
});

describe('the manuscript, read', () => {
	it('leaves the vault as it was', async () => {
		const before = vaultState(golden.host);
		await golden.call('getManuscript', { projectId: pid() });
		await golden.call('listManuscriptNotes', { projectId: pid(), include: 'counts' });
		await golden.call('getManuscriptNote', { projectId: pid(), notePath: '50_Manuscript/Chapter 1.md' });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});
});
