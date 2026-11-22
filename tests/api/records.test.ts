import { beforeAll, describe, expect, it } from 'vitest';

import { captureRevision } from '../../src/domain';
import { CHAPTER_ONE, CHAPTER_TWO, RECORDS_MADE, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];
const ids = (value: unknown): unknown[] => items(value).map((item) => item['id']);
const byId = (value: unknown, id: string): Body => {
	const found = items(value).find((item) => item['id'] === id);
	if (found === undefined) throw new Error(`The list has ${id}.`);
	return found;
};

let golden: Golden;
beforeAll(async () => {
	golden = await createGolden();
});

const pid = (): string => golden.project.id;
const FOLDER = 'Snowflake Projects/North Wind/50_Manuscript';
const FIRST = { path: `${FOLDER}/Chapter 1.md`, relativePath: '50_Manuscript/Chapter 1.md', title: 'Chapter 1' };
const SECOND = { path: `${FOLDER}/Chapter 2.md`, relativePath: '50_Manuscript/Chapter 2.md', title: 'Chapter 2' };
const CUT = { path: `${FOLDER}/Cut chapter.md`, relativePath: null, title: 'Cut chapter' };

describe('the tasks, listed', () => {
	it('come column by column, each column from its top, without the ones set aside', async () => {
		const reply = await golden.call('listTasks', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		// The file keeps them as they were made: outline, letter, map, guild, bell.
		expect(items(reply.body).map((task) => [task['status'], task['id']])).toEqual([
			['todo', 'task-outline'],
			['todo', 'task-bell'],
			['in-progress', 'task-map'],
			['done', 'task-letter'],
		]);
		expect(bodyOf(reply.body)).toMatchObject({ total: 4, offset: 0, limit: 100, nextOffset: null });
	});

	it('say what each is about by the note it leads to now, and keep the name of one that is gone', async () => {
		const reply = await golden.call('listTasks', { projectId: pid() });
		const { ada, tower } = golden.members;
		expect(byId(reply.body, 'task-outline')).toEqual({
			id: 'task-outline',
			title: 'Outline the thaw',
			description: 'Three beats at most.',
			status: 'todo',
			priority: 'high',
			dueDate: '2026-03-01',
			related: [
				{ kind: 'character', id: ada.characterId, name: 'Ada', path: ada.path, resolved: true },
				// Kept as a time called The old tower. The note says what it is now.
				{ kind: 'location', id: tower.entityId, name: 'Clocktower', path: tower.path, resolved: true },
				{ kind: 'location', id: 'entity-gone', name: 'The old mill', path: null, resolved: false },
			],
			archived: false,
			overdue: true,
			createdAt: '2026-02-03T09:30:00.000Z',
			updatedAt: '2026-02-03T09:31:00.000Z',
		});
	});

	it('are overdue by the day it is on the author’s computer, and never once done', async () => {
		const reply = await golden.call('listTasks', { projectId: pid(), state: 'all' });
		expect(items(reply.body).map((task) => [task['id'], task['overdue']])).toEqual([
			['task-outline', true],
			// Due later.
			['task-guild', false],
			// Due no day.
			['task-bell', false],
			['task-map', false],
			// Due the same day as the outline, and done.
			['task-letter', false],
		]);
		const earlier = await createGolden({ today: '2026-03-01' });
		const onTheDay = await earlier.call('getTask', { projectId: earlier.project.id, taskId: 'task-outline' });
		expect(bodyOf(onTheDay.body)['overdue']).toBe(false);
	});

	it('say no moment where the file kept none', async () => {
		const reply = await golden.call('getTask', { projectId: pid(), taskId: 'task-bell' });
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({ createdAt: null, updatedAt: null, dueDate: null, related: [] });
	});

	it('can be narrowed to a column, a priority, or what was set aside', async () => {
		const call = async (params: Body): Promise<unknown[]> => {
			const reply = await golden.call('listTasks', { projectId: pid(), ...params });
			expect(faults(reply), JSON.stringify(params)).toEqual([]);
			return ids(reply.body);
		};
		expect(await call({ status: 'done' })).toEqual(['task-letter']);
		expect(await call({ priority: 'high' })).toEqual(['task-outline']);
		expect(await call({ state: 'archived' })).toEqual(['task-guild']);
		expect(await call({ state: 'all', status: 'todo' })).toEqual(['task-outline', 'task-guild', 'task-bell']);
		expect(await call({ status: 'cancelled' })).toEqual([]);
		for (const params of [{ status: 'someday' }, { priority: 'dire' }, { state: 'trashed' }]) {
			const refused = await golden.call('listTasks', { projectId: pid(), ...params });
			expect([refused.status, bodyOf(refused.body)['code']], JSON.stringify(params)).toEqual([400, 'invalid-request']);
		}
	});

	it('come a page at a time', async () => {
		const page = await golden.call('listTasks', { projectId: pid(), limit: 2, offset: 1 });
		expect(faults(page)).toEqual([]);
		expect(bodyOf(page.body)).toMatchObject({ total: 4, offset: 1, limit: 2, nextOffset: 3 });
		expect(ids(page.body)).toEqual(['task-bell', 'task-map']);
	});
});

describe('one task', () => {
	it('is read by its id, set aside or not', async () => {
		const reply = await golden.call('getTask', { projectId: pid(), taskId: 'task-guild' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({ id: 'task-guild', title: 'Rename the guild', priority: 'urgent', archived: true });
		// A task is a line of a file the whole board shares, and has no version of its own.
		expect(reply.etag).toBeNull();
	});

	it('is not found under an id the project does not have', async () => {
		const reply = await golden.call('getTask', { projectId: pid(), taskId: 'task-nowhere' });
		expect([reply.status, bodyOf(reply.body)['code']]).toEqual([404, 'not-found']);
		expect(faults(reply)).toEqual([]);
	});
});

describe('the foreshadowing threads, listed', () => {
	it('come in the order of the author’s own table: by how each stands, then by where it first appears', async () => {
		const reply = await golden.call('listForeshadowing', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((item) => [item['status'], item['id']])).toEqual([
			['planned', 'foreshadowing-letter'],
			['active', 'foreshadowing-clock'],
			['resolved', 'foreshadowing-key'],
		]);
	});

	it('give each place a thread appears in the order it is read in, with the words and where they stand', async () => {
		const reply = await golden.call('listForeshadowing', { projectId: pid() });
		const clock = byId(reply.body, 'foreshadowing-clock');
		expect(clock).toMatchObject({
			name: 'The stopped clock',
			description: 'It is counting down.',
			related: [{ kind: 'character', id: golden.members.ada.characterId, name: 'Ada', resolved: true }],
			createdAt: '2026-02-03T09:30:00.000Z',
			updatedAt: '2026-02-03T09:30:00.000Z',
		});
		// Marked payoff first. Read plant first.
		expect(clock['occurrences']).toEqual([
			{
				id: 'occurrence-plant',
				role: 'plant',
				comment: '',
				note: FIRST,
				range: { from: 23, to: 42 },
				text: 'stopped at midnight',
				// Sixteen characters either side, or as many as there are.
				context: { before: CHAPTER_ONE.slice(7, 23), after: '.\n' },
				state: 'anchored',
			},
			{
				id: 'occurrence-payoff',
				role: 'payoff',
				comment: 'Paid off quietly.',
				note: SECOND,
				range: { from: 24, to: 40 },
				text: 'Nobody asked why',
				context: { before: CHAPTER_TWO.slice(8, 24), after: '.\n' },
				state: 'anchored',
			},
		]);
		expect(CHAPTER_ONE.slice(23, 42)).toBe('stopped at midnight');
	});

	it('say of each place whether its words still stand there, were found elsewhere, or are lost', async () => {
		const reply = await golden.call('getForeshadowing', { projectId: pid(), foreshadowingId: 'foreshadowing-key' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const told = (bodyOf(reply.body)['occurrences'] as Body[]).map((occurrence) => ({
			id: occurrence['id'],
			state: occurrence['state'],
			range: occurrence['range'],
			note: occurrence['note'],
		}));
		expect(told).toEqual([
			// The chapter no longer says it. Where it last stood is what is left.
			{ id: 'occurrence-lost', state: 'conflict', range: { from: 2, to: 15 }, note: SECOND },
			// Kept at 8. The same words stand at 4 now.
			{ id: 'occurrence-moved', state: 'moved', range: { from: 4, to: 21 }, note: SECOND },
			// The chapter is no longer one of the manuscript's, so it has no address there and comes last.
			{ id: 'occurrence-stray', state: 'conflict', range: { from: 4, to: 14 }, note: CUT },
		]);
		expect(CHAPTER_TWO.slice(4, 21)).toBe('did not come home');
	});

	it('can be narrowed to the threads that stand one way', async () => {
		const reply = await golden.call('listForeshadowing', { projectId: pid(), status: 'active' });
		expect(faults(reply)).toEqual([]);
		expect(ids(reply.body)).toEqual(['foreshadowing-clock']);
		expect(ids((await golden.call('listForeshadowing', { projectId: pid(), status: 'abandoned' })).body)).toEqual([]);
		expect((await golden.call('listForeshadowing', { projectId: pid(), status: 'forgotten' })).status).toBe(400);
	});

	it('are not found one by one under an id the project does not have', async () => {
		const reply = await golden.call('getForeshadowing', { projectId: pid(), foreshadowingId: 'occurrence-plant' });
		expect([reply.status, bodyOf(reply.body)['code']]).toEqual([404, 'not-found']);
		expect(faults(reply)).toEqual([]);
	});
});

describe('the proposed revisions, listed', () => {
	it('come in the order they are read in, whatever order they were proposed in', async () => {
		const reply = await golden.call('listRevisions', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((revision) => [revision['id'], revision['kind'], revision['state']])).toEqual([
			['revision-noon', 'replace', 'anchored'],
			// Lost, and kept where it last stood: at the head of the second chapter.
			['revision-lost', 'replace', 'conflict'],
			['revision-beat', 'insert', 'anchored'],
			['revision-neat', 'delete', 'anchored'],
			// On a chapter that has left the manuscript, and so after every chapter in it.
			['revision-stray', 'replace', 'conflict'],
		]);
	});

	it('tell a replacement, an insertion and a deletion each by what stands and what should', async () => {
		const reply = await golden.call('listRevisions', { projectId: pid() });
		expect(byId(reply.body, 'revision-noon')).toEqual({
			id: 'revision-noon',
			note: FIRST,
			kind: 'replace',
			range: { from: 34, to: 42 },
			originalText: 'midnight',
			proposed: 'noon',
			comment: 'Earlier is eerier.',
			context: { before: CHAPTER_ONE.slice(18, 34), after: '.\n' },
			createdAt: '2026-02-03T09:30:02.000Z',
			state: 'anchored',
		});
		// An insertion is a point between two characters, with nothing under it.
		expect(byId(reply.body, 'revision-beat')).toMatchObject({
			note: SECOND,
			range: { from: 22, to: 22 },
			originalText: '',
			proposed: ' Not that night.',
			comment: 'A beat more.',
		});
		// A deletion proposes nothing in place of what it covers.
		expect(byId(reply.body, 'revision-neat')).toMatchObject({
			range: { from: 24, to: 41 },
			originalText: 'Nobody asked why.',
			proposed: '',
		});
		expect(byId(reply.body, 'revision-stray')).toMatchObject({ note: CUT, range: { from: 4, to: 7 }, originalText: 'key' });
	});

	it('can be narrowed to one manuscript note or one kind', async () => {
		const onSecond = await golden.call('listRevisions', { projectId: pid(), note: '50_Manuscript/Chapter 2.md' });
		expect(faults(onSecond)).toEqual([]);
		expect(ids(onSecond.body)).toEqual(['revision-lost', 'revision-beat', 'revision-neat']);
		const inserted = await golden.call('listRevisions', { projectId: pid(), kind: 'insert' });
		expect(ids(inserted.body)).toEqual(['revision-beat']);
		const none = await golden.call('listRevisions', { projectId: pid(), note: '50_Manuscript/Draft.md' });
		expect(faults(none)).toEqual([]);
		expect(bodyOf(none.body)).toMatchObject({ items: [], total: 0 });
		expect((await golden.call('listRevisions', { projectId: pid(), kind: 'rewrite' })).status).toBe(400);
	});

	it('refuse a note that is not one of this project’s manuscript, where a slip would read as nothing proposed', async () => {
		const outside = [
			'50_Manuscript/No such chapter.md',
			// A chapter that has left the manuscript, though a revision still names it.
			'50_Manuscript/Cut chapter.md',
			golden.members.ada.path.slice('Snowflake Projects/North Wind/'.length),
			'../北境之雪/50_正文/初稿.md',
			`${FOLDER}/Chapter 1.md`,
		];
		for (const note of outside) {
			const reply = await golden.call('listRevisions', { projectId: pid(), note });
			expect([reply.status, bodyOf(reply.body)['code']], note).toEqual([400, 'invalid-request']);
			expect(faults(reply), note).toEqual([]);
			expect(bodyOf(reply.body)['errors'], note).toMatchObject([{ pointer: 'params/note' }]);
		}
	});

	it('come a page at a time, in the same order', async () => {
		const page = await golden.call('listRevisions', { projectId: pid(), limit: 2, offset: 2 });
		expect(bodyOf(page.body)).toMatchObject({ total: 5, offset: 2, limit: 2, nextOffset: 4 });
		expect(ids(page.body)).toEqual(['revision-beat', 'revision-neat']);
	});
});

describe('one proposed revision', () => {
	it('is read by its id with the passage it was made over', async () => {
		const reply = await golden.call('getRevision', { projectId: pid(), revisionId: 'revision-lost' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({
			id: 'revision-lost',
			note: SECOND,
			range: { from: 0, to: 8 },
			originalText: 'Somebody',
			proposed: 'Everybody',
			state: 'conflict',
		});
	});

	it('is never held against a note that is no part of the manuscript, whatever a record names', async () => {
		// A record is a file like any other, and can be made to name any note of the vault.
		const other = await createGolden();
		const ada = other.members.ada.path;
		const body = (await other.host.projects.repository.readManaged(ada)).body;
		const from = body.indexOf('To be right.');
		expect(from).toBeGreaterThan(0);
		await other.host.projects.revisions.create(
			other.project,
			captureRevision(ada, body, 'replace', from, from + 12, 'To be loved.', '', 'revision-outside', RECORDS_MADE),
		);
		const reply = await other.call('getRevision', { projectId: other.project.id, revisionId: 'revision-outside' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		// Read, the note would answer for the passage exactly where the record says it is.
		expect(bodyOf(reply.body)).toMatchObject({
			note: { path: ada, relativePath: null, title: 'Ada' },
			range: { from, to: from + 12 },
			state: 'conflict',
		});
	});

	it('is not found under an id the project does not have', async () => {
		const reply = await golden.call('getRevision', { projectId: pid(), revisionId: 'revision-nowhere' });
		expect([reply.status, bodyOf(reply.body)['code']]).toEqual([404, 'not-found']);
		expect(faults(reply)).toEqual([]);
	});
});

describe('the sticky notes, listed', () => {
	it('come newest first, each with the start of what it says and without the ones set aside', async () => {
		const { key, blank } = golden.stickyNotes;
		const reply = await golden.call('listStickyNotes', { projectId: pid() });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body)).toEqual([
			{
				id: blank.id,
				path: blank.path,
				color: 'macaron-5',
				createdAt: '2026-01-06T08:00:00.000Z',
				archived: false,
				etag: blank.revision,
				readOnly: false,
				preview: '',
			},
			{
				id: key.id,
				path: key.path,
				color: 'macaron-1',
				createdAt: '2026-01-05T08:00:00.000Z',
				archived: false,
				etag: key.revision,
				readOnly: false,
				// What the note says, on one line and without its marks.
				preview: 'Ask Ben about the key. And the bell.',
			},
		]);
		expect(key.path.startsWith('Snowflake Projects/North Wind/')).toBe(true);
	});

	it('can be turned oldest first and widened to what was set aside', async () => {
		const { key, blank, old } = golden.stickyNotes;
		const all = await golden.call('listStickyNotes', { projectId: pid(), state: 'all', sort: 'oldest' });
		expect(faults(all)).toEqual([]);
		expect(ids(all.body)).toEqual([old.id, key.id, blank.id]);
		const aside = await golden.call('listStickyNotes', { projectId: pid(), state: 'archived' });
		expect(items(aside.body)).toMatchObject([{ id: old.id, archived: true, color: 'macaron-2', preview: 'An old idea.' }]);
		expect((await golden.call('listStickyNotes', { projectId: pid(), sort: 'brightest' })).status).toBe(400);
	});
});

describe('one sticky note', () => {
	it('is read by its id with everything it says and the version to change it by', async () => {
		const { key } = golden.stickyNotes;
		const reply = await golden.call('getStickyNote', { projectId: pid(), stickyNoteId: key.id });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const note = bodyOf(reply.body);
		expect(note).toMatchObject({ id: key.id, path: key.path, body: key.body, preview: 'Ask Ben about the key. And the bell.' });
		expect(String(note['body'])).toContain('Ask **Ben** about the *key*.');
		expect(String(note['etag'])).toMatch(/^fp1-[0-9a-f]{16}$/u);
		expect(reply.etag).toBe(note['etag']);
	});

	it('is not found under an id the project does not have, another project’s note included', async () => {
		for (const projectId of [pid(), golden.chinese.id]) {
			const reply = await golden.call('getStickyNote', {
				projectId,
				stickyNoteId: projectId === pid() ? 'sticky-note-nowhere' : golden.stickyNotes.key.id,
			});
			expect([reply.status, bodyOf(reply.body)['code']], projectId).toEqual([404, 'not-found']);
			expect(faults(reply), projectId).toEqual([]);
		}
	});
});

describe('the records, read', () => {
	const LISTS = ['listTasks', 'listForeshadowing', 'listRevisions', 'listStickyNotes'];

	it('answer with an empty list for a project that keeps none, one in the archive included', async () => {
		// The first reading of a project that was moved puts its link to the manuscript right. That is held to in the projects' own tests.
		await golden.call('getProject', { projectId: golden.archived.id });
		const before = vaultState(golden.host);
		for (const projectId of [golden.chinese.id, golden.archived.id]) {
			for (const operation of LISTS) {
				const reply = await golden.call(operation, { projectId });
				expect([reply.status, faults(reply)], `${operation} ${projectId}`).toEqual([200, []]);
				expect(bodyOf(reply.body), operation).toMatchObject({ items: [], total: 0, nextOffset: null });
			}
		}
		// No file is made to hold what a project does not have.
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('set a record file that can no longer be read aside whole, and answer as for none', async () => {
		const other = await createGolden();
		const path = 'Snowflake Projects/North Wind/70_Tool/72_Task_Management/721_Task/tasks.json';
		await other.host.projects.repository.updatePlainFile(path, () => '{ "tasks": [');
		const before = vaultState(other.host);
		const reply = await other.call('listTasks', { projectId: other.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ items: [], total: 0 });
		// The one thing a read of the records can move: nothing is lost, and the author can open what was set aside.
		const after = vaultState(other.host);
		const aside = Object.keys(after).filter((key) => !(key in before));
		expect(aside).toHaveLength(1);
		expect(aside[0]).toMatch(/\/721_Task\/tasks\.corrupted-\d+\.json$/u);
		expect(after[aside[0] ?? '']).toBe('{ "tasks": [');
		expect(path in after).toBe(false);
		expect(Object.keys(after)).toHaveLength(Object.keys(before).length);
	});

	it('leave the vault as it was', async () => {
		const before = vaultState(golden.host);
		for (const operation of LISTS) await golden.call(operation, { projectId: pid(), state: 'all' });
		await golden.call('getTask', { projectId: pid(), taskId: 'task-outline' });
		await golden.call('getForeshadowing', { projectId: pid(), foreshadowingId: 'foreshadowing-key' });
		await golden.call('getRevision', { projectId: pid(), revisionId: 'revision-noon' });
		await golden.call('getStickyNote', { projectId: pid(), stickyNoteId: golden.stickyNotes.key.id });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});
});
