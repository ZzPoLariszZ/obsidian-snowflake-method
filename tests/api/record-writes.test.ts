import { describe, expect, it } from 'vitest';

import { DEFAULT_STICKY_NOTE_COLOR, DEFAULT_TASK_PRIORITY, DEFAULT_TASK_STATUS } from '../../src/domain';
import { CHAPTER_ONE, CHAPTER_TWO, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];
/** Where a refusal says the fault is: the one place it names, or the first of the parts it lists. */
const pointerOf = (reply: { body: unknown }): unknown => {
	const body = bodyOf(reply.body);
	const errors = body['errors'] as Body[] | undefined;
	return errors === undefined ? body['pointer'] : errors[0]?.['pointer'];
};

const FIRST = '50_Manuscript/Chapter 1.md';
const SECOND = '50_Manuscript/Chapter 2.md';
const TASKS = 'Snowflake Projects/North Wind/70_Tool/72_Task_Management/721_Task/tasks.json';
const HISTORY = 'Snowflake Projects/North Wind/70_Tool/71_Data_Statistics/714_Modification_History/2026/2026_03_device-test_history_events.json';
const NOON = '2026-03-10T12:00:00.000Z';

/** A vault of its own for each test, with what was asked of the editors and told of the vault's making forgotten. */
async function fresh(start: Parameters<typeof createGolden>[0] = {}): Promise<Golden> {
	const golden = await createGolden(start);
	golden.host.origins.length = 0;
	golden.host.editors.length = 0;
	golden.host.told.length = 0;
	return golden;
}

/** One call of the first project, with the id it is known by put in. */
const ask = (golden: Golden, operationId: string, params: Body = {}, extra: { body?: unknown; ifMatch?: string | null } = {}) =>
	golden.call(operationId, { projectId: golden.project.id, ...params }, extra);

/** A call that must land, answered by what it said. */
async function landed(golden: Golden, operationId: string, params: Body, extra: { body?: unknown; ifMatch?: string | null }, status = 200): Promise<Body> {
	const reply = await ask(golden, operationId, params, extra);
	expect([reply.status, faults(reply)], `${operationId} ${JSON.stringify(reply.body)}`).toEqual([status, []]);
	return bodyOf(reply.body);
}

/** The board as a caller reads it: every task by its id, column after column. */
const board = async (golden: Golden, state = 'active'): Promise<[unknown, unknown][]> =>
	items((await ask(golden, 'listTasks', { state })).body).map((task) => [task['status'], task['id']]);

/** What the history put down about a record, with whose doing it was filed as. */
async function filed(golden: Golden, id: string): Promise<[unknown, unknown][]> {
	await golden.host.history.flushNow();
	const events = (JSON.parse(vaultState(golden.host)[HISTORY] ?? '{}') as { events?: Body[] }).events ?? [];
	return events.filter((event) => bodyOf(event['subject'])['id'] === id).map((event) => [event['event'], event['origin']]);
}

/** The latest thing the history put down about a record. */
const lastFiled = async (golden: Golden, id: string): Promise<unknown> => (await filed(golden, id)).slice(-1)[0];

describe('a task, made', () => {
	it('takes a title alone, an id and a moment of the plugin’s own, and the last place in its column', async () => {
		const golden = await fresh();
		const reply = await ask(golden, 'createTask', {}, { body: { title: '  Count the bells  ' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(reply.body).toEqual({
			id: 'task-made-1',
			title: 'Count the bells',
			description: '',
			status: DEFAULT_TASK_STATUS,
			priority: DEFAULT_TASK_PRIORITY,
			dueDate: null,
			related: [],
			archived: false,
			overdue: false,
			createdAt: NOON,
			updatedAt: NOON,
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/tasks/task-made-1`);
		expect((await board(golden)).filter(([status]) => status === 'todo')).toEqual([
			['todo', 'task-outline'],
			['todo', 'task-bell'],
			['todo', 'task-made-1'],
		]);
		// The board is told at once, and the history files it as the plugin's doing.
		expect(golden.host.told).toEqual(['tasks']);
		expect(await filed(golden, 'task-made-1')).toEqual([['task-created', 'plugin']]);
	});

	it('takes everything a task has, the notes it is about each by its id', async () => {
		const golden = await fresh();
		const made = await landed(
			golden,
			'createTask',
			{},
			{
				body: {
					title: 'Ask Ada',
					description: ' About the key. ',
					status: 'in-progress',
					priority: 'urgent',
					dueDate: '2026-03-01',
					// Named twice, kept once.
					related: [{ id: golden.members.ada.characterId }, { id: golden.members.tower.entityId }, { id: golden.members.ada.characterId }],
					archived: true,
				},
			},
			201,
		);
		expect(made).toMatchObject({ description: 'About the key.', status: 'in-progress', priority: 'urgent', dueDate: '2026-03-01', archived: true, overdue: true });
		expect((made['related'] as Body[]).map((ref) => [ref['kind'], ref['name'], ref['resolved']])).toEqual([
			['character', 'Ada', true],
			['location', golden.members.tower.name, true],
		]);
		// The file keeps each by its id, with the kind and the name it had.
		const kept = (JSON.parse(vaultState(golden.host)[TASKS] ?? '{}') as { tasks: Body[] }).tasks.find((task) => task['id'] === 'task-made-1');
		expect(kept?.['related']).toEqual([
			{ kind: 'character', id: golden.members.ada.characterId, name: 'Ada' },
			{ kind: 'location', id: golden.members.tower.entityId, name: golden.members.tower.name },
		]);
	});

	it('is refused a title another task has, a note the project does not have, and a day the calendar does not', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		// Told apart whatever their case, as the plugin's own form tells them. A task set aside still holds its title.
		const taken = await ask(golden, 'createTask', {}, { body: { title: 'draw the TOWN map' } });
		expect([refusal(taken), faults(taken)]).toEqual([[409, 'duplicate-name'], []]);
		expect(bodyOf(taken.body)).toMatchObject({ kind: 'task', name: 'draw the TOWN map' });
		expect(refusal(await ask(golden, 'createTask', {}, { body: { title: 'Rename the guild' } }))).toEqual([409, 'duplicate-name']);
		const stranger = await ask(golden, 'createTask', {}, { body: { title: 'A', related: [{ id: golden.members.ada.characterId }, { id: 'nobody' }] } });
		expect([refusal(stranger), pointerOf(stranger), faults(stranger)]).toEqual([[422, 'invalid-reference'], '/related/1', []]);
		const day = await ask(golden, 'createTask', {}, { body: { title: 'B', dueDate: '2026-02-30' } });
		expect([refusal(day), pointerOf(day)]).toEqual([[400, 'invalid-request'], '/dueDate']);
		for (const body of [{}, { title: '   ' }, { title: 'C', status: 'later' }, { title: 'C', id: 'task-mine' }]) {
			expect(refusal(await ask(golden, 'createTask', {}, { body })), JSON.stringify(body)).toEqual([400, 'invalid-request']);
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
	});
});

describe('a task, changed', () => {
	it('changes what is sent and leaves the rest as it is', async () => {
		const golden = await fresh();
		const changed = await landed(golden, 'updateTask', { taskId: 'task-outline' }, { body: { priority: 'low', dueDate: null } });
		expect(changed).toMatchObject({
			id: 'task-outline',
			title: 'Outline the thaw',
			description: 'Three beats at most.',
			status: 'todo',
			priority: 'low',
			dueDate: null,
			archived: false,
			updatedAt: NOON,
		});
		// The three notes it is about stand as they stood, the deleted one among them.
		expect((changed['related'] as Body[]).map((ref) => ref['resolved'])).toEqual([true, true, false]);
		expect(golden.host.told).toEqual(['tasks']);
	});

	it('takes a task read and sent back whole, and writes nothing where nothing was changed', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getTask', { taskId: 'task-outline' })).body);
		const before = vaultState(golden.host);
		const echoed = await landed(golden, 'updateTask', { taskId: 'task-outline' }, { body: structuredClone(read) });
		// The note it names that was deleted since is kept as the task has it, and the names the others had are not rewritten.
		expect(echoed).toEqual(read);
		expect(vaultState(golden.host)).toEqual(before);
		const renamed = await landed(golden, 'updateTask', { taskId: 'task-outline' }, { body: { ...structuredClone(read), title: 'Outline the thaw again' } });
		expect(renamed).toEqual({ ...read, title: 'Outline the thaw again', updatedAt: NOON });
	});

	it('goes to the end of the column it is given, and is set aside and brought back', async () => {
		const golden = await fresh();
		await landed(golden, 'updateTask', { taskId: 'task-outline' }, { body: { status: 'in-progress' } });
		expect((await board(golden)).filter(([status]) => status === 'in-progress')).toEqual([
			['in-progress', 'task-map'],
			['in-progress', 'task-outline'],
		]);
		const aside = await landed(golden, 'updateTask', { taskId: 'task-map' }, { body: { archived: true } });
		expect(aside).toMatchObject({ archived: true, status: 'in-progress' });
		expect((await board(golden, 'archived')).map(([, id]) => id)).toEqual(['task-guild', 'task-map']);
		expect(await landed(golden, 'updateTask', { taskId: 'task-map' }, { body: { archived: false } })).toMatchObject({ archived: false });
		// A change of column and a setting aside are put down. A task brought back is not, as in the plugin.
		expect(await filed(golden, 'task-outline')).toEqual([
			['task-created', 'user'],
			['task-status', 'plugin'],
		]);
		expect(await lastFiled(golden, 'task-map')).toEqual(['task-archived', 'plugin']);
	});

	it('keeps its own title in another case, and is refused another task’s', async () => {
		const golden = await fresh();
		expect(await landed(golden, 'updateTask', { taskId: 'task-map' }, { body: { title: 'DRAW the town map' } })).toMatchObject({ title: 'DRAW the town map' });
		const taken = await ask(golden, 'updateTask', { taskId: 'task-map' }, { body: { title: 'check the bell' } });
		expect([refusal(taken), faults(taken)]).toEqual([[409, 'duplicate-name'], []]);
		expect(refusal(await ask(golden, 'updateTask', { taskId: 'task-map' }, { body: { related: [{ id: 'nobody' }] } }))).toEqual([422, 'invalid-reference']);
		expect(refusal(await ask(golden, 'updateTask', { taskId: 'task-none' }, { body: { priority: 'low' } }))).toEqual([404, 'not-found']);
		expect(refusal(await ask(golden, 'updateTask', { taskId: 'task-map' }, { body: { description: null } }))).toEqual([400, 'invalid-request']);
	});
});

describe('a task, moved', () => {
	it('is put before another task of a column, or at the column’s end', async () => {
		const golden = await fresh();
		await landed(golden, 'moveTask', { taskId: 'task-bell' }, { body: { before: 'task-outline' } });
		expect((await board(golden)).filter(([status]) => status === 'todo')).toEqual([
			['todo', 'task-bell'],
			['todo', 'task-outline'],
		]);
		const moved = await landed(golden, 'moveTask', { taskId: 'task-letter' }, { body: { status: 'todo', before: 'task-outline' } });
		expect(moved).toMatchObject({ id: 'task-letter', status: 'todo', updatedAt: NOON });
		await landed(golden, 'moveTask', { taskId: 'task-bell' }, { body: {} });
		expect((await board(golden)).filter(([status]) => status === 'todo')).toEqual([
			['todo', 'task-letter'],
			['todo', 'task-outline'],
			['todo', 'task-bell'],
		]);
		// Standing where it is asked to stand already is nothing to write.
		const before = vaultState(golden.host);
		await landed(golden, 'moveTask', { taskId: 'task-bell' }, { body: { status: 'todo' } });
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused a neighbour that stands in no such column', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		for (const body of [
			// In another column.
			{ before: 'task-map' },
			// Itself.
			{ before: 'task-bell' },
			// Set aside.
			{ before: 'task-guild' },
			{ before: 'task-none' },
			// Of the column it stands in, and not of the one it is sent to.
			{ status: 'done', before: 'task-outline' },
		]) {
			const reply = await ask(golden, 'moveTask', { taskId: 'task-bell' }, { body });
			expect([refusal(reply), pointerOf(reply), faults(reply)], JSON.stringify(body)).toEqual([[422, 'invalid-reference'], '/before', []]);
		}
		expect(refusal(await ask(golden, 'moveTask', { taskId: 'task-none' }, { body: {} }))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a task, deleted', () => {
	it('is gone for good, and is not there to be deleted twice', async () => {
		const golden = await fresh();
		const reply = await ask(golden, 'deleteTask', { taskId: 'task-letter' });
		expect([reply.status, reply.body, faults(reply)]).toEqual([204, undefined, []]);
		expect(refusal(await ask(golden, 'getTask', { taskId: 'task-letter' }))).toEqual([404, 'not-found']);
		expect(refusal(await ask(golden, 'deleteTask', { taskId: 'task-letter' }))).toEqual([404, 'not-found']);
		expect(golden.host.told).toEqual(['tasks']);
		expect(await lastFiled(golden, 'task-letter')).toEqual(['task-deleted', 'plugin']);
	});

	it('goes with every other task that was set aside, and the answer says how many went', async () => {
		const golden = await fresh();
		await landed(golden, 'updateTask', { taskId: 'task-map' }, { body: { archived: true } });
		golden.host.told.length = 0;
		expect(await landed(golden, 'purgeArchivedTasks', {}, {})).toEqual({ removed: 2 });
		expect(await board(golden, 'all')).toEqual([
			['todo', 'task-outline'],
			['todo', 'task-bell'],
			['done', 'task-letter'],
		]);
		expect(golden.host.told).toEqual(['tasks']);
		// With nothing set aside there is nothing to write and nothing to tell.
		const before = vaultState(golden.host);
		expect(await landed(golden, 'purgeArchivedTasks', {}, {})).toEqual({ removed: 0 });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual(['tasks']);
	});
});

describe('a file of records a newer version of the plugin wrote', () => {
	it('is never written: every change to what it holds is refused, and it stays as it was', async () => {
		const golden = await fresh();
		const service = golden.host.projects;
		const bump = (text: string): string => text.replace('"schemaVersion": 1', '"schemaVersion": 99');
		for (const path of Object.keys(vaultState(golden.host)).filter((file) => /72_Task_Management\/72[123]_[A-Za-z]+\/[a-z]+\.json$/u.test(file))) {
			await service.repository.updatePlainFile(path, bump);
		}
		const before = vaultState(golden.host);
		const note = { note: SECOND, passage: { exact: 'Ben' } };
		for (const [operationId, params, body] of [
			['createTask', {}, { title: 'Count the bells' }],
			['purgeArchivedTasks', {}, undefined],
			['createForeshadowing', {}, { name: 'The frozen harbour' }],
			['createRevision', {}, { ...note, kind: 'delete' }],
		] as const) {
			const reply = await ask(golden, operationId, params, { body });
			expect([refusal(reply), faults(reply)], operationId).toEqual([[409, 'read-only'], []]);
		}
		// What it holds cannot be read either, so nothing in it is there to be changed.
		expect(refusal(await ask(golden, 'updateTask', { taskId: 'task-map' }, { body: { priority: 'low' } }))).toEqual([404, 'not-found']);
		expect(refusal(await ask(golden, 'deleteTask', { taskId: 'task-map' }))).toEqual([409, 'read-only']);
		expect(refusal(await ask(golden, 'deleteForeshadowing', { foreshadowingId: 'foreshadowing-key' }))).toEqual([409, 'read-only']);
		expect(refusal(await ask(golden, 'discardRevision', { revisionId: 'revision-neat' }))).toEqual([409, 'read-only']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
	});
});

describe('a foreshadowing thread, made', () => {
	it('takes a name alone', async () => {
		const golden = await fresh();
		const reply = await ask(golden, 'createForeshadowing', {}, { body: { name: ' The frozen harbour ' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(reply.body).toEqual({
			id: 'foreshadowing-made-1',
			name: 'The frozen harbour',
			description: '',
			status: 'planned',
			related: [],
			createdAt: NOON,
			updatedAt: NOON,
			occurrences: [],
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/foreshadowing/foreshadowing-made-1`);
		expect(golden.host.told).toEqual(['margin']);
		expect(await filed(golden, 'foreshadowing-made-1')).toEqual([['thread-created', 'plugin']]);
	});

	it('takes the places it appears, each a passage named by its words or by where it stands', async () => {
		const golden = await fresh();
		const at = CHAPTER_TWO.indexOf('Nobody');
		const made = await landed(
			golden,
			'createForeshadowing',
			{},
			{
				body: {
					name: 'The empty chair',
					description: 'Ben’s.',
					status: 'active',
					related: [{ id: golden.members.ben.characterId }],
					occurrences: [
						{ note: SECOND, passage: { from: at, to: at + 6 }, role: 'payoff', comment: ' Who is nobody? ' },
						{ note: FIRST, passage: { exact: 'The clock' } },
					],
				},
			},
			201,
		);
		expect(made).toMatchObject({ status: 'active', description: 'Ben’s.', related: [{ kind: 'character', name: 'Ben', resolved: true }] });
		// Told in reading order, which is not the order they were sent in.
		expect(made['occurrences']).toEqual([
			{
				id: 'occurrence-made-2',
				role: 'plant',
				comment: '',
				note: { path: golden.manuscript.first, relativePath: FIRST, title: 'Chapter 1' },
				range: { from: CHAPTER_ONE.indexOf('The clock'), to: CHAPTER_ONE.indexOf('The clock') + 9 },
				text: 'The clock',
				context: { before: '# Chapter 1\n\n', after: ' stopped at midn' },
				state: 'anchored',
			},
			{
				id: 'occurrence-made-1',
				role: 'payoff',
				comment: 'Who is nobody?',
				note: { path: golden.manuscript.second, relativePath: SECOND, title: 'Chapter 2' },
				range: { from: at, to: at + 6 },
				text: 'Nobody',
				context: { before: CHAPTER_TWO.slice(at - 16, at), after: ' asked why.\n' },
				state: 'anchored',
			},
		]);
		// Marking a passage reads the manuscript and never writes it, and no editor is closed for it.
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.second}, ${golden.manuscript.first}`]);
	});

	it('is refused a name another thread has, and a place that is no passage of the manuscript', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const taken = await ask(golden, 'createForeshadowing', {}, { body: { name: 'the STOPPED clock' } });
		expect([refusal(taken), faults(taken)]).toEqual([[409, 'duplicate-name'], []]);
		expect(bodyOf(taken.body)).toMatchObject({ kind: 'foreshadowing', name: 'the STOPPED clock' });
		const place = async (occurrence: Body): Promise<unknown[]> => {
			const reply = await ask(golden, 'createForeshadowing', {}, { body: { name: 'Another', occurrences: [{ note: SECOND, passage: { exact: 'Ben' } }, occurrence] } });
			return [...refusal(reply), pointerOf(reply), faults(reply)];
		};
		expect(await place({ note: SECOND, passage: { exact: 'Ada did not come home' } })).toEqual([422, 'passage-not-found', '/occurrences/1/passage', []]);
		// "o" is said many times, and nothing was sent to tell which is meant.
		expect(await place({ note: SECOND, passage: { exact: 'o' } })).toEqual([422, 'ambiguous-passage', '/occurrences/1/passage', []]);
		expect(await place({ note: SECOND, passage: { from: 0, to: 4000 } })).toEqual([422, 'passage-not-found', '/occurrences/1/passage', []]);
		// The blank line between the two paragraphs.
		const gap = CHAPTER_TWO.indexOf('\n\n');
		expect(await place({ note: SECOND, passage: { from: gap, to: gap + 2 } })).toEqual([400, 'invalid-request', '/occurrences/1/passage', []]);
		expect(await place({ note: SECOND, passage: { from: 4, to: 4 } })).toEqual([400, 'invalid-request', '/occurrences/1/passage', []]);
		expect(await place({ note: SECOND, passage: { from: 9, to: 4 } })).toEqual([400, 'invalid-request', '/occurrences/1/passage/to', []]);
		// A note of the project that is no part of its manuscript, and one that is not there.
		expect(await place({ note: '20_Character/Ada.md', passage: { exact: 'Ada' } })).toEqual([400, 'invalid-request', '/occurrences/1/note', []]);
		expect(await place({ note: '50_Manuscript/Chapter 9.md', passage: { exact: 'Ada' } })).toEqual([400, 'invalid-request', '/occurrences/1/note', []]);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told).toEqual([]);
	});
});

describe('a foreshadowing thread, changed', () => {
	it('changes its name, what it is, how it stands and the notes it is about, and leaves the places it appears', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getForeshadowing', { foreshadowingId: 'foreshadowing-clock' })).body);
		const changed = await landed(
			golden,
			'updateForeshadowing',
			{ foreshadowingId: 'foreshadowing-clock' },
			{ body: { name: 'The clock that stopped', status: 'resolved', related: [{ id: golden.members.ben.characterId }] } },
		);
		expect(changed).toMatchObject({ name: 'The clock that stopped', description: 'It is counting down.', status: 'resolved', updatedAt: NOON });
		expect((changed['related'] as Body[]).map((ref) => ref['name'])).toEqual(['Ben']);
		expect(changed['occurrences']).toEqual(read['occurrences']);
		expect(golden.host.told).toEqual(['margin']);
		expect(await lastFiled(golden, 'foreshadowing-clock')).toEqual(['thread-status', 'plugin']);
	});

	it('takes a thread read and sent back whole, and writes nothing where nothing was changed', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getForeshadowing', { foreshadowingId: 'foreshadowing-key' })).body);
		const before = vaultState(golden.host);
		expect(await landed(golden, 'updateForeshadowing', { foreshadowingId: 'foreshadowing-key' }, { body: structuredClone(read) })).toEqual(read);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused another thread’s name, and is not there to change once it is gone', async () => {
		const golden = await fresh();
		expect(refusal(await ask(golden, 'updateForeshadowing', { foreshadowingId: 'foreshadowing-key' }, { body: { name: 'The unsent LETTER' } }))).toEqual([409, 'duplicate-name']);
		expect(await landed(golden, 'updateForeshadowing', { foreshadowingId: 'foreshadowing-key' }, { body: { name: 'THE MISSING KEY' } })).toMatchObject({ name: 'THE MISSING KEY' });
		const gone = await ask(golden, 'deleteForeshadowing', { foreshadowingId: 'foreshadowing-key' });
		expect([gone.status, gone.body, faults(gone)]).toEqual([204, undefined, []]);
		expect(refusal(await ask(golden, 'updateForeshadowing', { foreshadowingId: 'foreshadowing-key' }, { body: { status: 'active' } }))).toEqual([404, 'not-found']);
		expect(refusal(await ask(golden, 'deleteForeshadowing', { foreshadowingId: 'foreshadowing-key' }))).toEqual([404, 'not-found']);
		expect(await lastFiled(golden, 'foreshadowing-key')).toEqual(['thread-deleted', 'plugin']);
		// The manuscript was never part of it.
		expect(vaultState(golden.host)[golden.manuscript.second]).toContain(CHAPTER_TWO);
	});
});

describe('a place a thread appears', () => {
	it('is marked on a passage and answered with the id it was given', async () => {
		const golden = await fresh();
		const reply = await ask(golden, 'addForeshadowingOccurrence', { foreshadowingId: 'foreshadowing-letter' }, { body: { note: SECOND, passage: { exact: 'did not come home' } } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(reply.body).toMatchObject({ id: 'occurrence-made-1', role: 'plant', comment: '', text: 'did not come home', state: 'anchored' });
		const thread = bodyOf((await ask(golden, 'getForeshadowing', { foreshadowingId: 'foreshadowing-letter' })).body);
		expect(thread).toMatchObject({ updatedAt: NOON, occurrences: [{ id: 'occurrence-made-1' }] });
		expect(golden.host.told).toEqual(['margin']);
		expect(refusal(await ask(golden, 'addForeshadowingOccurrence', { foreshadowingId: 'foreshadowing-none' }, { body: { note: SECOND, passage: { exact: 'Ben' } } }))).toEqual([404, 'not-found']);
	});

	it('is looked for in what the author has typed and not yet saved', async () => {
		const golden = await fresh();
		golden.host.typed.set(golden.manuscript.second, `${CHAPTER_TWO}\nThe letter was still in his coat.\n`);
		const marked = await landed(
			golden,
			'addForeshadowingOccurrence',
			{ foreshadowingId: 'foreshadowing-letter' },
			{ body: { note: SECOND, passage: { exact: 'letter', prefix: 'The ' }, role: 'reinforce' } },
			201,
		);
		expect(marked).toMatchObject({ role: 'reinforce', text: 'letter', state: 'anchored' });
		// The author's words were saved as theirs, and their editor was left open.
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.second}`, `write ${golden.manuscript.second}`]);
		expect(golden.host.origins).toEqual([true]);
	});

	it('is changed in what it does and what is remarked on it, and put on other words', async () => {
		const golden = await fresh();
		const address = { foreshadowingId: 'foreshadowing-clock', occurrenceId: 'occurrence-plant' };
		const remarked = await landed(golden, 'updateForeshadowingOccurrence', address, { body: { role: 'reinforce', comment: ' First sign. ' } });
		expect(remarked).toMatchObject({ id: 'occurrence-plant', role: 'reinforce', comment: 'First sign.', text: 'stopped at midnight' });
		// A passage alone is looked for in the note the appearance stands in.
		const nearer = await landed(golden, 'updateForeshadowingOccurrence', address, { body: { passage: { exact: 'The clock' } } });
		expect(nearer).toMatchObject({ role: 'reinforce', comment: 'First sign.', text: 'The clock', note: { relativePath: FIRST } });
		// With a note, in that one. An appearance read and sent back whole carries the note it was read in.
		const moved = await landed(golden, 'updateForeshadowingOccurrence', address, { body: { ...structuredClone(nearer), note: SECOND, passage: { exact: 'Nobody' } } });
		expect(moved).toMatchObject({ text: 'Nobody', note: { relativePath: SECOND }, role: 'reinforce', state: 'anchored' });
		const again = await landed(golden, 'updateForeshadowingOccurrence', address, { body: { ...structuredClone(moved), passage: { exact: 'Ben' } } });
		expect(again).toMatchObject({ text: 'Ben', note: { relativePath: SECOND } });
		// Sent back whole with nothing new, it stays where it is.
		expect(await landed(golden, 'updateForeshadowingOccurrence', address, { body: structuredClone(again) })).toEqual(again);
	});

	it('is refused words the note does not say, and is not there under an id the thread does not have', async () => {
		const golden = await fresh();
		const address = { foreshadowingId: 'foreshadowing-clock', occurrenceId: 'occurrence-plant' };
		const lost = await ask(golden, 'updateForeshadowingOccurrence', address, { body: { passage: { exact: 'struck thirteen' } } });
		expect([refusal(lost), pointerOf(lost), faults(lost)]).toEqual([[422, 'passage-not-found'], '/passage', []]);
		// An appearance in a chapter that has left the manuscript has no note to look in until one is named.
		const stray = { foreshadowingId: 'foreshadowing-key', occurrenceId: 'occurrence-stray' };
		const nowhere = await ask(golden, 'updateForeshadowingOccurrence', stray, { body: { passage: { exact: 'Ben' } } });
		expect([refusal(nowhere), pointerOf(nowhere)]).toEqual([[400, 'invalid-request'], '/note']);
		expect(await landed(golden, 'updateForeshadowingOccurrence', stray, { body: { note: SECOND, passage: { exact: 'Ben' } } })).toMatchObject({ text: 'Ben', state: 'anchored' });
		for (const params of [
			{ foreshadowingId: 'foreshadowing-clock', occurrenceId: 'occurrence-none' },
			// An appearance of another thread.
			{ foreshadowingId: 'foreshadowing-clock', occurrenceId: 'occurrence-lost' },
			{ foreshadowingId: 'foreshadowing-none', occurrenceId: 'occurrence-plant' },
		]) {
			expect(refusal(await ask(golden, 'updateForeshadowingOccurrence', params, { body: { role: 'payoff' } })), JSON.stringify(params)).toEqual([404, 'not-found']);
			expect(refusal(await ask(golden, 'deleteForeshadowingOccurrence', params)), JSON.stringify(params)).toEqual([404, 'not-found']);
		}
	});

	it('is taken off, and the thread stands without it', async () => {
		const golden = await fresh();
		const reply = await ask(golden, 'deleteForeshadowingOccurrence', { foreshadowingId: 'foreshadowing-clock', occurrenceId: 'occurrence-payoff' });
		expect([reply.status, reply.body, faults(reply)]).toEqual([204, undefined, []]);
		const thread = bodyOf((await ask(golden, 'getForeshadowing', { foreshadowingId: 'foreshadowing-clock' })).body);
		expect((thread['occurrences'] as Body[]).map((occurrence) => occurrence['id'])).toEqual(['occurrence-plant']);
		await landed(golden, 'deleteForeshadowingOccurrence', { foreshadowingId: 'foreshadowing-clock', occurrenceId: 'occurrence-plant' }, {}, 204);
		expect(bodyOf((await ask(golden, 'getForeshadowing', { foreshadowingId: 'foreshadowing-clock' })).body)).toMatchObject({ name: 'The stopped clock', occurrences: [] });
		expect(golden.host.told).toEqual(['margin', 'margin']);
	});
});

describe('a revision, proposed', () => {
	it('stands over a passage with other words for it, and leaves the manuscript as it was', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host)[golden.manuscript.second];
		const reply = await ask(golden, 'createRevision', {}, { body: { note: SECOND, kind: 'replace', passage: { exact: 'Ben' }, proposed: 'Benjamin', comment: ' Full name. ' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(reply.body).toEqual({
			id: 'revision-made-1',
			note: { path: golden.manuscript.second, relativePath: SECOND, title: 'Chapter 2' },
			kind: 'replace',
			range: { from: 0, to: 3 },
			originalText: 'Ben',
			proposed: 'Benjamin',
			comment: 'Full name.',
			context: { before: '', after: ' did not come ho' },
			createdAt: NOON,
			state: 'anchored',
		});
		expect(reply.location).toBe(`/projects/${golden.project.id}/revisions/revision-made-1`);
		expect(vaultState(golden.host)[golden.manuscript.second]).toBe(before);
		expect(golden.host.editors).toEqual([`settle ${golden.manuscript.second}`]);
		expect(golden.host.told).toEqual(['margin']);
		expect(await filed(golden, 'revision-made-1')).toEqual([['revision-proposed', 'plugin']]);
	});

	it('takes a passage out, or puts new words right after one, or at a place with nothing before it', async () => {
		const golden = await fresh();
		const cut = await landed(golden, 'createRevision', {}, { body: { note: FIRST, kind: 'delete', passage: { exact: 'The clock' }, proposed: 'not looked at' } }, 201);
		expect(cut).toMatchObject({ kind: 'delete', originalText: 'The clock', proposed: '' });
		const end = CHAPTER_ONE.indexOf('midnight.') + 9;
		const added = await landed(golden, 'createRevision', {}, { body: { note: FIRST, kind: 'insert', passage: { exact: 'midnight.' }, proposed: ' Again.' } }, 201);
		expect(added).toMatchObject({
			kind: 'insert',
			range: { from: end, to: end },
			originalText: '',
			proposed: ' Again.',
			context: { before: CHAPTER_ONE.slice(end - 16, end), after: '\n' },
		});
		const head = await landed(golden, 'createRevision', {}, { body: { note: SECOND, kind: 'insert', passage: { from: 0, to: 0 }, proposed: 'Later. ' } }, 201);
		expect(head).toMatchObject({ kind: 'insert', range: { from: 0, to: 0 }, state: 'anchored' });
	});

	it('is refused where another revision stands over part of the passage', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		// "midnight" has a replacement proposed for it already.
		const clash = await ask(golden, 'createRevision', {}, { body: { note: FIRST, kind: 'delete', passage: { exact: 'at midnight' } } });
		expect([refusal(clash), faults(clash)]).toEqual([[409, 'overlapping-revision'], []]);
		expect(bodyOf(clash.body)).toMatchObject({ revisionId: 'revision-noon' });
		// New words in the middle of it are refused too. At its end they stand beside it.
		const inside = await ask(golden, 'createRevision', {}, { body: { note: FIRST, kind: 'insert', passage: { exact: 'at mid' }, proposed: '-' } });
		expect(refusal(inside)).toEqual([409, 'overlapping-revision']);
		expect(vaultState(golden.host)).toEqual(before);
		await landed(golden, 'createRevision', {}, { body: { note: FIRST, kind: 'insert', passage: { exact: 'at midnight' }, proposed: ' exactly' } }, 201);
	});

	it('is refused without the words it proposes, or the words it stands over', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const propose = async (body: Body): Promise<unknown[]> => {
			const reply = await ask(golden, 'createRevision', {}, { body: { note: SECOND, ...body } });
			return [...refusal(reply), pointerOf(reply), faults(reply)];
		};
		expect(await propose({ kind: 'replace', passage: { exact: 'Ben' } })).toEqual([400, 'invalid-request', '/proposed', []]);
		expect(await propose({ kind: 'insert', passage: { exact: 'Ben' }, proposed: '' })).toEqual([400, 'invalid-request', '/proposed', []]);
		expect(await propose({ kind: 'replace', passage: { from: 3, to: 3 }, proposed: 'x' })).toEqual([400, 'invalid-request', '/passage', []]);
		expect(await propose({ kind: 'delete', passage: { from: 3, to: 3 } })).toEqual([400, 'invalid-request', '/passage', []]);
		expect(await propose({ kind: 'delete', passage: { exact: 'Ada' } })).toEqual([422, 'passage-not-found', '/passage', []]);
		expect(await propose({ kind: 'delete', passage: { exact: 'o' } })).toEqual([422, 'ambiguous-passage', '/passage', []]);
		expect(await propose({ kind: 'delete', passage: { from: 0, to: 4000 } })).toEqual([422, 'passage-not-found', '/passage', []]);
		expect(await propose({ kind: 'rewrite', passage: { exact: 'Ben' } })).toEqual([400, 'invalid-request', '/kind', []]);
		const elsewhere = await ask(golden, 'createRevision', {}, { body: { note: '20_Character/Ada.md', kind: 'delete', passage: { exact: 'Ada' } } });
		expect([refusal(elsewhere), pointerOf(elsewhere)]).toEqual([[400, 'invalid-request'], '/note']);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is found by the words around it where the note says them more than once', async () => {
		const golden = await fresh();
		// "o" stands in many places. The one in "home" has "h" before it and "me" after.
		const made = await landed(golden, 'createRevision', {}, { body: { note: SECOND, kind: 'replace', passage: { exact: 'o', prefix: ' h', suffix: 'me.' }, proposed: 'O' } }, 201);
		expect(made).toMatchObject({ originalText: 'o', range: { from: CHAPTER_TWO.indexOf('home') + 1, to: CHAPTER_TWO.indexOf('home') + 2 } });
	});
});

describe('a revision, changed and discarded', () => {
	it('changes what it proposes and the comment on it, and becomes a deletion where it proposes nothing', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getRevision', { revisionId: 'revision-noon' })).body);
		const changed = await landed(golden, 'updateRevision', { revisionId: 'revision-noon' }, { body: { proposed: 'dawn' } });
		expect(changed).toEqual({ ...read, proposed: 'dawn' });
		// Read and sent back whole with one thing changed.
		const emptied = await landed(golden, 'updateRevision', { revisionId: 'revision-noon' }, { body: { ...structuredClone(changed), proposed: '', comment: ' Cut it. ' } });
		expect(emptied).toEqual({ ...read, kind: 'delete', proposed: '', comment: 'Cut it.' });
		expect(await landed(golden, 'updateRevision', { revisionId: 'revision-noon' }, { body: { proposed: 'noon' } })).toMatchObject({ kind: 'replace', proposed: 'noon' });
		expect(golden.host.told).toEqual(['margin', 'margin', 'margin']);
	});

	it('writes nothing where nothing was changed, and keeps new words that propose something', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getRevision', { revisionId: 'revision-beat' })).body);
		const before = vaultState(golden.host);
		expect(await landed(golden, 'updateRevision', { revisionId: 'revision-beat' }, { body: structuredClone(read) })).toEqual(read);
		const empty = await ask(golden, 'updateRevision', { revisionId: 'revision-beat' }, { body: { proposed: '' } });
		expect([refusal(empty), pointerOf(empty), faults(empty)]).toEqual([[400, 'invalid-request'], '/proposed', []]);
		expect(vaultState(golden.host)).toEqual(before);
		expect(refusal(await ask(golden, 'updateRevision', { revisionId: 'revision-none' }, { body: { comment: 'x' } }))).toEqual([404, 'not-found']);
	});

	it('is taken away without the change being made', async () => {
		const golden = await fresh();
		const text = vaultState(golden.host)[golden.manuscript.second];
		const reply = await ask(golden, 'discardRevision', { revisionId: 'revision-neat' });
		expect([reply.status, reply.body, faults(reply)]).toEqual([204, undefined, []]);
		expect(refusal(await ask(golden, 'getRevision', { revisionId: 'revision-neat' }))).toEqual([404, 'not-found']);
		expect(refusal(await ask(golden, 'discardRevision', { revisionId: 'revision-neat' }))).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)[golden.manuscript.second]).toBe(text);
		expect(golden.host.told).toEqual(['margin']);
		expect(await lastFiled(golden, 'revision-neat')).toEqual(['revision-discarded', 'plugin']);
	});
});

describe('a sticky note, made', () => {
	it('holds the words sent with it, in the tint asked for, and is not told as the author’s typing', async () => {
		const golden = await fresh();
		const reply = await ask(golden, 'createStickyNote', {}, { body: { body: 'Ask about the **bell**.\n', color: 'macaron-6' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const made = bodyOf(reply.body);
		expect(made).toMatchObject({ body: 'Ask about the **bell**.\n', color: 'macaron-6', archived: false, readOnly: false, createdAt: NOON, preview: 'Ask about the bell.' });
		expect(reply.etag).toBe(made['etag']);
		expect(reply.location).toBe(`/projects/${golden.project.id}/sticky-notes/${String(made['id'])}`);
		expect(bodyOf((await ask(golden, 'getStickyNote', { stickyNoteId: made['id'] })).body)).toEqual(made);
		// The note that was made and the words put in it, neither of them the author's.
		expect(golden.host.origins.length).toBeGreaterThan(0);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
		expect(golden.host.told).toEqual(['stickyNotes']);
	});

	it('is made blank where nothing is sent, in the tint a note made in the plugin starts with', async () => {
		const golden = await fresh();
		const blank = await landed(golden, 'createStickyNote', {}, {}, 201);
		expect(blank).toMatchObject({ body: '', color: DEFAULT_STICKY_NOTE_COLOR, archived: false });
		const aside = await landed(golden, 'createStickyNote', {}, { body: { archived: true } }, 201);
		expect(aside).toMatchObject({ archived: true });
		expect(aside['id']).not.toBe(blank['id']);
		expect(refusal(await ask(golden, 'createStickyNote', {}, { body: { color: 'red' } }))).toEqual([400, 'invalid-request']);
	});
});

describe('a sticky note, changed', () => {
	const key = (golden: Golden): { stickyNoteId: string } => ({ stickyNoteId: golden.stickyNotes.key.id });

	it('takes new words against the version it was read at, once the author’s editor on it is closed', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getStickyNote', key(golden))).body);
		const reply = await ask(golden, 'updateStickyNote', key(golden), { body: { body: 'Ask Ada instead.\n' }, ifMatch: String(read['etag']) });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const changed = bodyOf(reply.body);
		expect(changed).toMatchObject({ id: read['id'], body: 'Ask Ada instead.\n', color: read['color'], preview: 'Ask Ada instead.' });
		expect(changed['etag']).not.toBe(read['etag']);
		expect(reply.etag).toBe(changed['etag']);
		const path = golden.stickyNotes.key.path;
		expect(golden.host.editors).toEqual([`settle ${path}`, `release ${path}`, `write ${path}`]);
		expect(golden.host.origins).toEqual([false]);
		expect(golden.host.told).toEqual(['stickyNotes']);
	});

	it('is refused against a version that no longer stands, and the note and the editor are left as they were', async () => {
		const golden = await fresh();
		const read = bodyOf((await ask(golden, 'getStickyNote', key(golden))).body);
		// The author goes on typing in the note after it was read.
		golden.host.typed.set(golden.stickyNotes.key.path, 'Ask Ben about the key. And the bell.\n');
		const reply = await ask(golden, 'updateStickyNote', key(golden), { body: { body: 'Ask Ada instead.\n' }, ifMatch: String(read['etag']) });
		expect([refusal(reply), faults(reply)]).toEqual([[412, 'concurrent-change'], []]);
		const now = bodyOf((await ask(golden, 'getStickyNote', key(golden))).body);
		expect(now['body']).toBe('Ask Ben about the key. And the bell.\n');
		expect(bodyOf(reply.body)['currentEtag']).toBe(now['etag']);
		// What the author typed was saved as theirs, and no editor was closed.
		const path = golden.stickyNotes.key.path;
		expect(golden.host.editors).toEqual([`settle ${path}`, `write ${path}`]);
		expect(golden.host.origins).toEqual([true]);
		expect(golden.host.told).toEqual([]);
		// Read again, the change is made against the author's latest words.
		golden.host.editors.length = 0;
		await landed(golden, 'updateStickyNote', key(golden), { body: { body: `${String(now['body'])}Ask Ada too.\n` }, ifMatch: String(now['etag']) });
		expect(golden.host.editors).toEqual([`settle ${path}`, `release ${path}`, `write ${path}`]);
	});

	it('is not changed without a version named, and takes whichever version stands where the caller says so', async () => {
		const golden = await fresh();
		expect(refusal(await ask(golden, 'updateStickyNote', key(golden), { body: { body: 'x' } }))).toEqual([428, 'precondition-required']);
		expect(await landed(golden, 'updateStickyNote', key(golden), { body: { body: 'x' }, ifMatch: '*' })).toMatchObject({ body: 'x' });
		expect(refusal(await ask(golden, 'updateStickyNote', { stickyNoteId: 'sticky-note-none' }, { body: { body: 'x' }, ifMatch: '*' }))).toEqual([404, 'not-found']);
	});

	it('changes its tint with the editor left open, and is set aside with the editor closed', async () => {
		const golden = await fresh();
		const path = golden.stickyNotes.key.path;
		const read = bodyOf((await ask(golden, 'getStickyNote', key(golden))).body);
		const tinted = await landed(golden, 'updateStickyNote', key(golden), { body: { color: 'macaron-4' }, ifMatch: String(read['etag']) });
		expect(tinted).toMatchObject({ color: 'macaron-4', body: read['body'], archived: false });
		expect(golden.host.editors).toEqual([`settle ${path}`]);
		golden.host.editors.length = 0;
		// Read and sent back whole with only its tint changed, it names its own text again. That is no change to the text, and the editor stays open.
		const again = await landed(golden, 'updateStickyNote', key(golden), { body: { ...structuredClone(tinted), color: 'macaron-2' }, ifMatch: String(tinted['etag']) });
		expect(again).toMatchObject({ color: 'macaron-2', body: read['body'], archived: false });
		expect(golden.host.editors).toEqual([`settle ${path}`]);
		golden.host.editors.length = 0;
		// Read and sent back whole with one thing changed. What it says is the same, so it is not written again.
		const aside = await landed(golden, 'updateStickyNote', key(golden), { body: { ...structuredClone(again), archived: true }, ifMatch: String(again['etag']) });
		expect(aside).toMatchObject({ archived: true, color: 'macaron-2', body: read['body'] });
		expect(golden.host.editors).toEqual([`settle ${path}`, `release ${path}`]);
		golden.host.editors.length = 0;
		// Set aside already and sent back so, there is nothing more to close.
		await landed(golden, 'updateStickyNote', key(golden), { body: structuredClone(aside), ifMatch: String(aside['etag']) });
		expect(golden.host.editors).toEqual([`settle ${path}`]);
		expect(items((await ask(golden, 'listStickyNotes', { state: 'archived' })).body).map((note) => note['id'])).toContain(read['id']);
		expect(await landed(golden, 'updateStickyNote', key(golden), { body: { archived: false }, ifMatch: '*' })).toMatchObject({ archived: false });
		// No body was written at any point: only the note's properties.
		expect(golden.host.origins).toEqual([]);
	});
});

describe('a sticky note, deleted', () => {
	it('goes to the trash once the author’s editor on it is closed, and its place on the screen is let go', async () => {
		const golden = await fresh();
		const { id, path } = golden.stickyNotes.key;
		const stale = await ask(golden, 'deleteStickyNote', { stickyNoteId: id }, { ifMatch: 'fp1-0000000000000000' });
		expect([refusal(stale), faults(stale)]).toEqual([[412, 'concurrent-change'], []]);
		expect(golden.host.editors).toEqual([`settle ${path}`]);
		expect(refusal(await ask(golden, 'deleteStickyNote', { stickyNoteId: id }))).toEqual([428, 'precondition-required']);
		golden.host.editors.length = 0;
		const reply = await ask(golden, 'deleteStickyNote', { stickyNoteId: id }, { ifMatch: golden.stickyNotes.key.revision });
		expect([reply.status, reply.body, faults(reply)]).toEqual([204, undefined, []]);
		expect(golden.host.editors).toEqual([`settle ${path}`, `release ${path}`]);
		expect(golden.host.told).toEqual([`deleted ${id}`, 'stickyNotes']);
		expect(vaultState(golden.host)[path]).toBeUndefined();
		expect(refusal(await ask(golden, 'getStickyNote', { stickyNoteId: id }))).toEqual([404, 'not-found']);
		expect(refusal(await ask(golden, 'deleteStickyNote', { stickyNoteId: id }, { ifMatch: '*' }))).toEqual([404, 'not-found']);
	});

	it('is neither changed nor deleted where a newer version of the plugin wrote it', async () => {
		const golden = await fresh();
		const { id, path } = golden.stickyNotes.blank;
		await golden.host.projects.repository.updatePlainFile(path, (text) => text.replace(/"snowflake-schema": \d+/u, '"snowflake-schema": 99'));
		expect(bodyOf((await ask(golden, 'getStickyNote', { stickyNoteId: id })).body)['readOnly']).toBe(true);
		const before = vaultState(golden.host);
		for (const [operationId, body] of [
			['updateStickyNote', { body: 'x' }],
			['deleteStickyNote', undefined],
		] as const) {
			const reply = await ask(golden, operationId, { stickyNoteId: id }, { body, ifMatch: '*' });
			expect([refusal(reply), faults(reply)], operationId).toEqual([[409, 'read-only'], []]);
		}
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.editors).toEqual([]);
	});
});
