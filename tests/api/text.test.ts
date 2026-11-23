import { describe, expect, it } from 'vitest';

import { SEARCH_EXCERPT, SEARCH_HITS } from '../../api/limits';
import { CHAPTER_ONE, CHAPTER_TWO, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

const DRAFT = '50_Manuscript/Draft.md';
const FIRST = '50_Manuscript/Chapter 1.md';
const SECOND = '50_Manuscript/Chapter 2.md';

/** A vault of its own for each test, with what was asked of the editors and told of the vault's making forgotten. */
async function fresh(start: Parameters<typeof createGolden>[0] = {}): Promise<Golden> {
	const golden = await createGolden(start);
	golden.host.origins.length = 0;
	golden.host.editors.length = 0;
	golden.host.told.length = 0;
	return golden;
}
const addresses = async (golden: Golden): Promise<unknown[]> =>
	(bodyOf((await golden.call('listManuscriptNotes', { projectId: golden.project.id })).body)['items'] as Body[]).map((note) => note['relativePath']);
const read = async (golden: Golden, notePath: string): Promise<Body> =>
	bodyOf((await golden.call('getManuscriptNote', { projectId: golden.project.id, notePath })).body);
const revisionIds = async (golden: Golden): Promise<unknown[]> =>
	(bodyOf((await golden.call('listRevisions', { projectId: golden.project.id })).body)['items'] as Body[]).map((revision) => revision['id']);
/** A note stamped as another version of the plugin wrote it: a newer one where no version is named. */
const stamped = (golden: Golden, path: string, version = 99): Promise<unknown> =>
	golden.host.projects.repository.updatePlainFile(path, (text) =>
		text.replace(/(snowflake-schema"?: )\d+/u, (_all, key: string) => `${key}${String(version)}`),
	);
const madeForeign = (golden: Golden, path: string): Promise<unknown> => stamped(golden, path);

describe('words looked for in a project', () => {
	const search = async (golden: Golden, params: Body): Promise<Body> => {
		const reply = await golden.call('searchProject', { projectId: golden.project.id, ...params });
		expect([reply.status, faults(reply)], JSON.stringify(params)).toEqual([200, []]);
		return bodyOf(reply.body);
	};
	const hitsOf = (page: Body): Body[] => page['items'] as Body[];
	const found = (hit: Body): string => {
		const at = hit['at'] as { from: number; to: number };
		return String(hit['text']).slice(at.from, at.to);
	};

	it('are found in a manuscript note’s text, and told with the line they stand in', async () => {
		const golden = await fresh();
		const hits = hitsOf(await search(golden, { q: 'clock' }));
		const hit = hits[0] ?? {};
		const note = await read(golden, FIRST);
		const range = hit['range'] as { from: number; to: number };
		expect(hit).toMatchObject({
			kind: 'manuscript',
			path: golden.manuscript.first,
			relativePath: FIRST,
			title: 'Chapter 1',
			id: null,
			step: null,
			field: null,
			text: 'The clock stopped at midnight.',
			at: { from: 4, to: 9 },
		});
		// The place is one in the text the note's own reading gives.
		expect(String(note['body']).slice(range.from, range.to)).toBe('clock');
		expect(hit['line']).toBe(String(note['body']).slice(0, range.from).split('\n').length);
	});

	it('are found in what the other notes say, each field by the name its own reading gives it', async () => {
		const golden = await fresh();
		const hits = hitsOf(await search(golden, { q: 'clock' }));
		const { ada, stops, midnight } = golden.members;
		expect(hits.find((hit) => hit['field'] === '/goal')).toEqual({
			kind: 'character',
			path: ada.path,
			relativePath: '20_Character/Ada.md',
			title: 'Ada',
			id: ada.characterId,
			step: null,
			field: '/goal',
			range: { from: 12, to: 17 },
			line: 1,
			text: 'Restart the clock.',
			at: { from: 12, to: 17 },
		});
		expect(hits.find((hit) => hit['field'] === '/aliases/0')).toMatchObject({ id: ada.characterId, text: 'The clockmaker' });
		expect(hits.find((hit) => hit['kind'] === 'scene')).toMatchObject({ id: stops.sceneId, field: '/title', text: 'The clock stops' });
		expect(hits.find((hit) => hit['id'] === midnight.entityId)).toMatchObject({ kind: 'time', field: '/description', text: 'The hour the clock stopped.' });
		expect(hits.find((hit) => hit['kind'] === 'step')).toMatchObject({ step: 1, id: null, field: '/sections/one-sentence-summary', title: expect.any(String) as unknown });
		// The manuscript first, then the notes of the steps, the characters, the scenes and the worldbuilding.
		const kinds = hits.map((hit) => String(hit['kind']));
		const first = (kind: string): number => kinds.indexOf(kind);
		expect([first('manuscript'), first('step') < first('character'), first('character') < first('scene'), first('scene') < first('time')]).toEqual([0, true, true, true]);
	});

	it('are looked for where the call says, in the case it says, and as whole words when it says', async () => {
		const golden = await fresh();
		const everywhere = await search(golden, { q: 'clock' });
		const inManuscript = hitsOf(await search(golden, { q: 'clock', in: 'manuscript' }));
		const inNotes = hitsOf(await search(golden, { q: 'clock', in: 'notes' }));
		expect(inManuscript.map((hit) => hit['kind'])).toEqual(['manuscript']);
		expect(inNotes.some((hit) => hit['kind'] === 'manuscript')).toBe(false);
		expect(inManuscript.length + inNotes.length).toBe(everywhere['total']);

		const capital = hitsOf(await search(golden, { q: 'Clock', caseSensitive: true }));
		expect(capital.length).toBeGreaterThan(0);
		expect(capital.map(found).every((words) => words === 'Clock')).toBe(true);
		expect(hitsOf(everywhere).map(found).some((words) => words === 'clock')).toBe(true);

		const whole = hitsOf(await search(golden, { q: 'clock', wholeWord: true }));
		expect(whole.length).toBeGreaterThan(0);
		expect(whole.length).toBeLessThan(Number(everywhere['total']));
		// Not the clock of a clockmaker, and not the one of the Clocktower.
		expect(whole.every((hit) => !/\p{L}/u.test(String(hit['text']).charAt((hit['at'] as { to: number }).to)))).toBe(true);
	});

	it('are listed a page at a time, with a long line told by the part around them', async () => {
		const golden = await fresh();
		const all = await search(golden, { q: 'clock' });
		const page = await search(golden, { q: 'clock', offset: 1, limit: 2 });
		expect([page['total'], page['offset'], page['limit'], page['nextOffset'], page['truncated']]).toEqual([all['total'], 1, 2, 3, false]);
		expect(hitsOf(page)).toEqual(hitsOf(all).slice(1, 3));

		const standing = await golden.host.projects.manuscript.readSegment(golden.manuscript.second);
		const long = `${'so it went on '.repeat(60)}until the needle broke ${'and on it went '.repeat(60)}\n`;
		await golden.host.projects.manuscript.writeSegment(golden.manuscript.second, `One line.\n${long}`, standing.revision);
		const hit = hitsOf(await search(golden, { q: 'needle', in: 'manuscript' }))[0] ?? {};
		expect([String(hit['text']).length, found(hit), hit['line']]).toEqual([SEARCH_EXCERPT, 'needle', 2]);
		expect(long).toContain(String(hit['text']));
	});

	it('say so when there are more places than a search lists', async () => {
		const golden = await fresh();
		const standing = await golden.host.projects.manuscript.readSegment(golden.manuscript.second);
		await golden.host.projects.manuscript.writeSegment(golden.manuscript.second, `${'tick '.repeat(SEARCH_HITS + 5)}\n`, standing.revision);
		const page = await search(golden, { q: 'tick', limit: 1 });
		expect([page['total'], page['truncated']]).toEqual([SEARCH_HITS, true]);
		expect((await search(golden, { q: 'midnight' }))['truncated']).toBe(false);
	});

	it('change nothing, save nothing and close no editor', async () => {
		const golden = await fresh({ access: 'read' });
		golden.host.typed.set(golden.manuscript.first, `${CHAPTER_ONE}\nNot saved yet.\n`);
		const before = vaultState(golden.host);
		expect((await search(golden, { q: 'Not saved' }))['total']).toBe(0);
		await search(golden, { q: 'clock' });
		expect(vaultState(golden.host)).toEqual(before);
		expect([golden.host.editors, golden.host.ranAsPlugin]).toEqual([[], 0]);
		const P = { projectId: golden.project.id };
		expect(refusal(await golden.call('searchProject', P))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('searchProject', { ...P, q: '' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('searchProject', { projectId: 'project-nowhere', q: 'clock' }))).toEqual([404, 'not-found']);
	});
});

describe('words replaced across the manuscript', () => {
	const replace = async (golden: Golden, body: Body): Promise<Body> => {
		const reply = await golden.call('replaceInProject', { projectId: golden.project.id }, { body });
		expect([reply.status, faults(reply)], JSON.stringify(body)).toEqual([200, []]);
		return bodyOf(reply.body);
	};

	it('says what would be replaced, and which marks would lose their place, and writes nothing when asked only to say', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const note = await read(golden, FIRST);
		expect(await replace(golden, { query: 'midnight', replacement: 'noon', dryRun: true })).toEqual({
			dryRun: true,
			replaced: 1,
			notes: [
				{
					relativePath: FIRST,
					path: golden.manuscript.first,
					replaced: 1,
					etag: note['etag'],
					// The revision proposed over the word, and the appearance marked over the words around it.
					marksLost: { revisions: 1, occurrences: 1 },
				},
			],
			skipped: [],
		});
		expect(vaultState(golden.host)).toEqual(before);
		// The author's words were saved to look in, and no editor was closed for a call that changes nothing.
		expect(golden.host.editors.filter((line) => !line.startsWith('settle'))).toEqual([]);
	});

	it('changes each note that holds the words, against the author’s latest text, with their editor closed first', async () => {
		const golden = await fresh();
		golden.host.typed.set(golden.manuscript.first, `${CHAPTER_ONE}\nThe clock, again.\n`);
		const done = await replace(golden, { query: 'clock', replacement: 'bell' });
		const first = await read(golden, FIRST);
		expect(first['body']).toBe('# Chapter 1\n\nThe bell stopped at midnight.\n\nThe bell, again.\n');
		expect(done).toMatchObject({ dryRun: false, replaced: 2, skipped: [] });
		expect((done['notes'] as Body[]).map((note) => [note['relativePath'], note['replaced'], note['etag']])).toEqual([[FIRST, 2, first['etag']]]);
		// Saved, then closed, then written: and the one write the call made itself was not told as the author's.
		const order = golden.host.editors.map((line) => line.split(' ')[0]);
		expect([order.indexOf('settle') < order.indexOf('release'), order.lastIndexOf('release') < order.lastIndexOf('write')]).toEqual([true, true]);
		expect(golden.host.editors.filter((line) => line.startsWith('release'))).toEqual([`release ${golden.manuscript.first}`]);
		expect(golden.host.origins[golden.host.origins.length - 1]).toBe(false);
	});

	it('keeps to the notes named, takes capitals and whole words as told, and leaves a note alone where nothing would change', async () => {
		const golden = await fresh();
		expect(refusal(await golden.call('replaceInProject', { projectId: golden.project.id }, { body: { query: 'Ben', replacement: 'Benjamin', notes: ['50_Manuscript/Nowhere.md'] } }))).toEqual([
			400,
			'invalid-request',
		]);
		expect((await replace(golden, { query: 'ben', replacement: 'Benjamin', notes: [FIRST] }))['replaced']).toBe(0);
		expect((await replace(golden, { query: 'ben', replacement: 'Benjamin', caseSensitive: true }))['replaced']).toBe(0);
		expect((await replace(golden, { query: 'Be', replacement: 'Benjamin', wholeWord: true }))['replaced']).toBe(0);
		// Words put back as they were are no change.
		expect((await replace(golden, { query: 'Ben', replacement: 'Ben' }))['replaced']).toBe(0);
		expect(golden.host.origins).toEqual([]);
		expect(await replace(golden, { query: 'ben', replacement: 'Benjamin', notes: [SECOND, SECOND] })).toMatchObject({ replaced: 1, notes: [{ relativePath: SECOND }] });
		expect((await read(golden, SECOND))['body']).toBe(CHAPTER_TWO.replace('Ben', 'Benjamin'));
		// An empty replacement takes the words out.
		await replace(golden, { query: 'Benjamin ', replacement: '' });
		expect((await read(golden, SECOND))['body']).toBe(CHAPTER_TWO.replace('Ben ', ''));
	});

	it('passes over a note it may not write and one the author typed into in that moment, and goes on with the rest', async () => {
		const golden = await fresh();
		await madeForeign(golden, golden.manuscript.first);
		const standing = await golden.host.projects.manuscript.readSegment(golden.manuscript.second);
		await golden.host.projects.manuscript.writeSegment(golden.manuscript.second, `${CHAPTER_TWO}\nThe clock again.\n`, standing.revision);
		const draft = await golden.host.projects.manuscript.readSegment(golden.manuscript.draft);
		await golden.host.projects.manuscript.writeSegment(golden.manuscript.draft, 'A clock.\n', draft.revision);
		// An editor that writes its last words as it closes, as a stream's does.
		const release = golden.host.releaseNotes.bind(golden.host);
		golden.host.releaseNotes = async (paths) => {
			await release(paths);
			if (!paths.includes(golden.manuscript.second)) return;
			const now = await golden.host.projects.manuscript.readSegment(golden.manuscript.second);
			await golden.host.projects.manuscript.writeSegment(golden.manuscript.second, `${now.body}One more clock.\n`, now.revision);
		};
		const done = await replace(golden, { query: 'clock', replacement: 'bell' });
		expect(done).toMatchObject({
			replaced: 1,
			notes: [{ relativePath: DRAFT, replaced: 1 }],
			skipped: [
				{ relativePath: FIRST, reason: 'read-only' },
				{ relativePath: SECOND, reason: 'changed' },
			],
		});
		// The author's last words stand as they typed them.
		expect((await read(golden, SECOND))['body']).toBe(`${CHAPTER_TWO}\nThe clock again.\nOne more clock.\n`);
		expect((await read(golden, DRAFT))['body']).toBe('A bell.\n');
	});
});

describe('a proposed revision, accepted', () => {
	const accept = (golden: Golden, revisionId: string) => golden.call('acceptRevision', { projectId: golden.project.id, revisionId });

	it('makes the change in the note, takes the revision away and tells the screens', async () => {
		const golden = await fresh();
		const reply = await accept(golden, 'revision-noon');
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const told = bodyOf(reply.body);
		expect([told['relativePath'], told['body'], reply.etag]).toEqual([FIRST, CHAPTER_ONE.replace('midnight', 'noon'), told['etag']]);
		expect(await revisionIds(golden)).not.toContain('revision-noon');
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.first}`, `release ${golden.manuscript.first}`, `write ${golden.manuscript.first}`]);
		expect([golden.host.origins, golden.host.told]).toEqual([[false], ['margin']]);
	});

	it('puts words in and takes words out as the revision says', async () => {
		const golden = await fresh();
		const added = await accept(golden, 'revision-beat');
		expect(bodyOf(added.body)['body']).toBe('Ben did not come home. Not that night.\n\nNobody asked why.\n');
		const cut = await accept(golden, 'revision-neat');
		expect(bodyOf(cut.body)['body']).toBe('Ben did not come home. Not that night.\n\n\n');
		expect(await revisionIds(golden)).toEqual(['revision-noon', 'revision-lost', 'revision-stray']);
	});

	it('finds the passage again in the author’s latest text, wherever it has moved to', async () => {
		const golden = await fresh();
		golden.host.typed.set(golden.manuscript.first, `Before it all.\n\n${CHAPTER_ONE}\nAnd after.\n`);
		const reply = await accept(golden, 'revision-noon');
		expect(bodyOf(reply.body)['body']).toBe(`Before it all.\n\n${CHAPTER_ONE.replace('midnight', 'noon')}\nAnd after.\n`);
	});

	it('is refused where the note no longer has the words, and the note and the revision are left as they were', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const lost = await accept(golden, 'revision-lost');
		expect([refusal(lost), faults(lost), bodyOf(lost.body)['note']]).toEqual([[422, 'passage-not-found'], [], SECOND]);
		// Its note has left the manuscript.
		expect(refusal(await accept(golden, 'revision-stray'))).toEqual([422, 'passage-not-found']);
		expect(refusal(await accept(golden, 'revision-nowhere'))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
		// The author is left writing where they were.
		expect(golden.host.editors.filter((line) => !line.startsWith('settle'))).toEqual([]);
		expect(golden.host.told).toEqual([]);
	});

	it('is refused in a note a newer version of the plugin wrote', async () => {
		const golden = await fresh();
		await madeForeign(golden, golden.manuscript.first);
		expect(refusal(await accept(golden, 'revision-noon'))).toEqual([409, 'read-only']);
		expect(await revisionIds(golden)).toContain('revision-noon');
	});
});

describe('text put at the end of a manuscript note', () => {
	const append = (golden: Golden, notePath: string, text: string) =>
		golden.call('appendManuscriptNoteBody', { projectId: golden.project.id, notePath }, { body: { text } });

	it('goes after everything the note says, a blank line between, and is not told as the author’s typing', async () => {
		const golden = await fresh();
		const reply = await append(golden, SECOND, 'The thaw came.');
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const told = bodyOf(reply.body);
		expect([told['body'], reply.etag]).toEqual([`${CHAPTER_TWO}\nThe thaw came.\n`, told['etag']]);
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.second}`, `release ${golden.manuscript.second}`, `write ${golden.manuscript.second}`]);
		expect(golden.host.origins).toEqual([false]);
		// Blank lines sent at its head are not added to the one put between.
		await append(golden, SECOND, '\n\nAnd went.\n');
		expect((await read(golden, SECOND))['body']).toBe(`${CHAPTER_TWO}\nThe thaw came.\n\nAnd went.\n`);
	});

	it('goes after what the author typed and had not saved, and begins a note that says nothing', async () => {
		const golden = await fresh();
		golden.host.typed.set(golden.manuscript.second, `${CHAPTER_TWO}\nStill typing`);
		await append(golden, SECOND, 'The thaw came.');
		expect((await read(golden, SECOND))['body']).toBe(`${CHAPTER_TWO}\nStill typing\n\nThe thaw came.\n`);

		const made = await golden.call('createManuscriptNote', { projectId: golden.project.id }, { body: { title: 'Epilogue', body: '\n' } });
		const address = String(bodyOf(bodyOf(made.body)['note'])['relativePath']);
		expect(bodyOf((await append(golden, address, 'The end.')).body)['body']).toBe('The end.\n');
	});

	it('is refused for a note that is not there, an empty text and a note it may not write', async () => {
		const golden = await fresh();
		expect(refusal(await append(golden, '50_Manuscript/Nowhere.md', 'Words.'))).toEqual([404, 'not-found']);
		expect(refusal(await append(golden, SECOND, ''))).toEqual([400, 'invalid-request']);
		await madeForeign(golden, golden.manuscript.second);
		const before = vaultState(golden.host);
		expect(refusal(await append(golden, SECOND, 'Words.'))).toEqual([409, 'read-only']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a manuscript note moved in the reading order', () => {
	const move = (golden: Golden, notePath: string, body: Body) =>
		golden.call('moveManuscriptNote', { projectId: golden.project.id, notePath }, { body });

	it('goes to the start, to the end or after a note that is named, and keeps its name', async () => {
		const golden = await fresh();
		expect(await addresses(golden)).toEqual([DRAFT, FIRST, SECOND]);
		const before = await read(golden, SECOND);
		const reply = await move(golden, SECOND, { position: 'start' });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const told = bodyOf(reply.body);
		expect(told).toMatchObject({ note: { relativePath: SECOND, index: 0, next: DRAFT, body: CHAPTER_TWO }, renumbered: [], skipped: [] });
		expect(await addresses(golden)).toEqual([SECOND, DRAFT, FIRST]);
		// The order is kept in the note's own properties, so the note is another version of itself.
		expect([reply.etag === bodyOf(told['note'])['etag'], reply.etag === before['etag']]).toEqual([true, false]);
		expect(golden.host.told).toEqual(['manuscript']);
		expect(golden.host.editors.slice(0, 2)).toEqual([`settle ${golden.manuscript.second}`, `release ${golden.manuscript.second}`]);

		await move(golden, SECOND, { after: DRAFT });
		expect(await addresses(golden)).toEqual([DRAFT, SECOND, FIRST]);
		await move(golden, DRAFT, { position: 'end' });
		expect(await addresses(golden)).toEqual([SECOND, FIRST, DRAFT]);
		await move(golden, DRAFT, { after: SECOND });
		expect(await addresses(golden)).toEqual([SECOND, DRAFT, FIRST]);
	});

	it('writes nothing where the note already stands there', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const reply = await move(golden, FIRST, { after: DRAFT });
		expect([reply.status, faults(reply), bodyOf(bodyOf(reply.body)['note'])['index']]).toEqual([200, [], 1]);
		await move(golden, SECOND, { position: 'end' });
		expect(vaultState(golden.host)).toEqual(before);
		expect([golden.host.told, golden.host.editors]).toEqual([[], []]);
	});

	it('wants one place, a note that is there, and a note to stand after that is another', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		expect(refusal(await move(golden, SECOND, {}))).toEqual([400, 'invalid-request']);
		expect(refusal(await move(golden, SECOND, { after: DRAFT, position: 'end' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await move(golden, SECOND, { after: SECOND }))).toEqual([400, 'invalid-request']);
		expect(refusal(await move(golden, SECOND, { after: '50_Manuscript/Nowhere.md' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await move(golden, '50_Manuscript/Nowhere.md', { position: 'end' }))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('one thing the health check found, repaired', () => {
	const issues = async (golden: Golden): Promise<Body[]> =>
		bodyOf((await golden.call('getProjectHealth', { projectId: golden.project.id })).body)['issues'] as Body[];
	const repair = (golden: Golden, body: Body) => golden.call('repairProjectIssue', { projectId: golden.project.id }, { body });

	it('mends that one issue and says how the project stands after', async () => {
		const golden = await fresh();
		const note = golden.project.artifacts[2]?.path ?? '';
		golden.host.environment.fakeVault.delete(note);
		const found = (await issues(golden)).find((issue) => issue['path'] === note);
		expect(found).toMatchObject({ code: 'missing-artifact', repairable: true });
		const reply = await repair(golden, { code: 'missing-artifact', path: note });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect((bodyOf(reply.body)['issues'] as Body[]).some((issue) => issue['path'] === note)).toBe(false);
		expect(golden.host.environment.fakeVault.contents.has(note)).toBe(true);
	});

	it('is refused for an issue that is not there and for one the plugin cannot mend by itself', async () => {
		const golden = await fresh();
		expect(refusal(await repair(golden, { code: 'missing-artifact', path: 'North Wind/10_Summary/Nowhere.md' }))).toEqual([404, 'not-found']);
		// The character a scene is seen through is gone: nothing can say who should take their place.
		golden.host.environment.fakeVault.delete(golden.members.ada.path);
		const stuck = (await issues(golden)).find((issue) => issue['repairable'] === false);
		expect(stuck).toBeDefined();
		const before = vaultState(golden.host);
		const reply = await repair(golden, { code: stuck?.['code'], path: stuck?.['path'], ...(stuck?.['field'] === undefined ? {} : { field: stuck['field'] }) });
		expect([refusal(reply), faults(reply)]).toEqual([[409, 'not-repairable'], []]);
		expect(bodyOf(reply.body)).toMatchObject({ issue: stuck?.['code'], path: stuck?.['path'] });
		// The right path under another code names no issue.
		expect(refusal(await repair(golden, { code: 'missing-artifact', path: stuck?.['path'] }))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('mends the issue it was asked for where a note carries two under one path', async () => {
		const golden = await fresh();
		const ada = golden.members.ada.path;
		const vault = golden.host.environment.fakeVault;
		// One link to a category that stands, under a name it no longer goes by, and one to a category that is not there.
		const text = vault.contents.get(ada) ?? '';
		vault.write(
			ada,
			text
				.split('|Guild/Clockmakers]]')
				.join('|Old name]]')
				.replace(
					/("\[\[[^"]*Clockmakers\|Old name\]\]")/u,
					'$1,\n    "[[Snowflake Projects/North Wind/20_Character/21_Category/Missing/Missing/Missing|Missing/Missing]]"',
				),
		);
		const codes = async (): Promise<unknown[]> => (await issues(golden)).filter((issue) => issue['path'] === ada).map((issue) => issue['code']);
		expect((await codes()).sort()).toEqual(['stale-definition-alias', 'unresolved-definition-link']);
		const made = (): string[] => [...vault.contents.keys()].filter((path) => path.includes('/21_Category/Missing/'));

		const renamed = await repair(golden, { code: 'stale-definition-alias', path: ada });
		expect([renamed.status, faults(renamed)]).toEqual([200, []]);
		// The name was brought level, and nothing was made for the link that leads nowhere.
		expect(await codes()).toEqual(['unresolved-definition-link']);
		expect(vault.contents.get(ada)).toContain('|Guild/Clockmakers]]');
		expect(made()).toEqual([]);

		const raised = await repair(golden, { code: 'unresolved-definition-link', path: ada });
		expect([raised.status, faults(raised)]).toEqual([200, []]);
		expect(await codes()).toEqual([]);
		expect(made().length).toBeGreaterThan(0);
	});

	it('is refused a repair that renames a note while Obsidian asks before it updates links', async () => {
		const golden = await fresh({ asksAboutLinks: true });
		const ben = golden.members.ben.path;
		const moved = ben.replace('Ben.md', 'Benny.md');
		golden.host.environment.fakeVault.rename(ben, moved);
		const found = (await issues(golden)).find((issue) => issue['path'] === moved);
		expect(found).toMatchObject({ code: 'mismatched-character-title', repairable: true });
		const before = vaultState(golden.host);
		const sent = { code: found?.['code'], path: moved, ...(found?.['field'] === undefined ? {} : { field: found['field'] }) };
		expect(refusal(await repair(golden, sent))).toEqual([409, 'link-updates-ask']);
		expect(vaultState(golden.host)).toEqual(before);
		golden.host.state.asksAboutLinks = false;
		const reply = await repair(golden, sent);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect((bodyOf(reply.body)['issues'] as Body[]).some((issue) => issue['code'] === 'mismatched-character-title')).toBe(false);
	});
});

describe('a project’s notes brought up to date', () => {
	it('rewrites what an older version wrote, with the plugin’s own tidying held off, and changes none of the author’s words', async () => {
		const golden = await fresh();
		const P = { projectId: golden.project.id };
		const nothing = await golden.call('migrateProjectNotes', P);
		expect([nothing.status, faults(nothing), bodyOf(nothing.body)['migrated'], bodyOf(nothing.body)['skipped']]).toEqual([200, [], 0, 0]);
		await stamped(golden, golden.manuscript.first, 1);
		expect(bodyOf((await golden.call('getProjectHealth', P)).body)['outdatedNotes']).toBe(1);
		const reply = await golden.call('migrateProjectNotes', P);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ migrated: 1, skipped: 0, health: { outdatedNotes: 0 } });
		expect((await read(golden, FIRST))['body']).toBe(CHAPTER_ONE);
		expect(golden.host.batches).toBe(2);
		expect(golden.host.origins.filter((userInput) => userInput)).toEqual([]);
	});
});
