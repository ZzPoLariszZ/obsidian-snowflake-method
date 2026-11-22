import { beforeAll, describe, expect, it } from 'vitest';

import { DAY_BANDS, WRITING_MODES } from '../../src/domain';
import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

const MINUTE = 60_000;
const NOTHING = { sessions: 0, focusMs: 0, idleMs: 0, totalMs: 0, added: 0, deleted: 0, net: 0, timedNet: 0, goalNet: 0 };
/** Half an hour of drafting: 220 words added and 20 taken away in the project, 150 of them added in the manuscript. */
const NINTH = {
	day: '2026-03-09',
	sessions: 1,
	focusMs: 30 * MINUTE,
	idleMs: 0,
	totalMs: 30 * MINUTE,
	added: 220,
	deleted: 20,
	net: 200,
	timedNet: 200,
	goalNet: 150,
};
/** Twenty minutes of revising and five of nothing: 10 words added and 40 taken away, all of it in the manuscript. */
const TENTH = {
	day: '2026-03-10',
	sessions: 1,
	focusMs: 20 * MINUTE,
	idleMs: 5 * MINUTE,
	totalMs: 25 * MINUTE,
	added: 10,
	deleted: 40,
	net: -30,
	timedNet: -30,
	goalNet: -30,
};

let golden: Golden;
beforeAll(async () => {
	// The day it is there is 10 March 2026.
	golden = await createGolden();
});
const pid = (): string => golden.project.id;
const call = async (operation: string, params: Body = {}): Promise<Body> => {
	const reply = await golden.call(operation, { projectId: pid(), ...params });
	expect([reply.status, faults(reply)], operation).toEqual([200, []]);
	return bodyOf(reply.body);
};
const refused = async (operation: string, params: Body): Promise<Body> => {
	const reply = await golden.call(operation, { projectId: pid(), ...params });
	expect([reply.status, bodyOf(reply.body)['code'], faults(reply)], JSON.stringify(params)).toEqual([400, 'invalid-request', []]);
	return bodyOf(reply.body);
};

describe('the writing done day by day', () => {
	it('is given for the thirty days ending today where no stretch is asked for, every day there whether or not anything was written', async () => {
		const days = await call('listWritingDays');
		expect(days).toMatchObject({ from: '2026-02-09', through: '2026-03-10', scope: 'project', goalScope: 'manuscript' });
		expect(items(days)).toHaveLength(30);
		expect(items(days)[0]).toEqual({ day: '2026-02-09', ...NOTHING });
		expect(items(days).slice(-2)).toEqual([NINTH, TENTH]);
	});

	it('is given for the stretch that is asked for, a session belonging to the day it began on', async () => {
		const days = await call('listWritingDays', { from: '2026-03-08', through: '2026-03-09' });
		expect(days).toMatchObject({ from: '2026-03-08', through: '2026-03-09' });
		expect(items(days)).toEqual([{ day: '2026-03-08', ...NOTHING }, NINTH]);
		const one = await call('listWritingDays', { through: '2026-03-09' });
		expect([one['from'], items(one).length]).toEqual(['2026-02-08', 30]);
	});

	it('counts its words in the notes the author’s setting names, and the goal in its own', async () => {
		const other = await createGolden({ sessionScope: 'manuscript', goalScope: 'project' });
		const reply = await other.call('listWritingDays', { projectId: other.project.id, from: '2026-03-09', through: '2026-03-09' });
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({ scope: 'manuscript', goalScope: 'project' });
		expect(items(reply.body)[0]).toMatchObject({ added: 150, deleted: 0, net: 150, goalNet: 200 });
	});

	it('refuses a day no calendar has, a stretch that ends before it begins, and one longer than a year and a day', async () => {
		expect((await refused('listWritingDays', { from: '2026-02-30' }))['errors']).toMatchObject([{ pointer: 'params/from' }]);
		expect((await refused('listWritingDays', { through: '2026-13-01' }))['errors']).toMatchObject([{ pointer: 'params/through' }]);
		await refused('listWritingDays', { from: 'yesterday' });
		expect((await refused('listWritingDays', { from: '2026-03-11' }))['errors']).toMatchObject([
			{ pointer: 'params/from', detail: 'The stretch ends before it begins.' },
		]);
		await refused('listWritingDays', { from: '2025-03-09', through: '2026-03-10' });
		expect(items(await call('listWritingDays', { from: '2025-03-10', through: '2026-03-10' }))).toHaveLength(366);
	});
});

describe('how the writing is spread', () => {
	it('gives every part of the day in the plugin’s order, and every stage of the work', async () => {
		const spread = await call('getWritingSpread');
		expect(spread).toMatchObject({ span: 'all', scope: 'project' });
		const bands = spread['bands'] as Body[];
		expect(bands.map((band) => [band['fromHour'], band['toHour']])).toEqual(DAY_BANDS.map((band) => [band.from, band.to]));
		// The revision began at seven and the drafting at nine, in the zone the days are read in.
		expect(bands[0]).toEqual({ fromHour: 6, toHour: 9, focusMs: 20 * MINUTE, totalMs: 25 * MINUTE, added: 10, deleted: 40, net: -30 });
		expect(bands[1]).toEqual({ fromHour: 9, toHour: 12, focusMs: 30 * MINUTE, totalMs: 30 * MINUTE, added: 220, deleted: 20, net: 200 });
		expect(bands.slice(2).every((band) => band['totalMs'] === 0)).toBe(true);
		expect(spread['modes']).toEqual([
			{ mode: 'planning', sessions: 0, focusMs: 0, totalMs: 0, net: 0 },
			{ mode: 'draft', sessions: 1, focusMs: 30 * MINUTE, totalMs: 30 * MINUTE, net: 200 },
			{ mode: 'revision', sessions: 1, focusMs: 20 * MINUTE, totalMs: 25 * MINUTE, net: -30 },
			{ mode: 'proofreading', sessions: 0, focusMs: 0, totalMs: 0, net: 0 },
		]);
		expect((spread['modes'] as Body[]).map((mode) => mode['mode'])).toEqual([...WRITING_MODES]);
	});

	it('can be read for today alone or for yesterday alone', async () => {
		const sessionsBy = async (span: string): Promise<unknown[]> =>
			((await call('getWritingSpread', { span }))['modes'] as Body[]).map((mode) => mode['sessions']);
		expect(await sessionsBy('today')).toEqual([0, 0, 1, 0]);
		expect(await sessionsBy('yesterday')).toEqual([0, 1, 0, 0]);
		await refused('getWritingSpread', { span: 'week' });
	});
});

describe('the writing session under way', () => {
	it('is none where the author is not in one, with today so far all the same', async () => {
		const answer = await call('getWritingSession');
		expect(answer).toEqual({ session: null, today: TENTH, scope: 'project', goalScope: 'manuscript' });
	});

	it('is told as it stands this moment, and only for the project it was begun in', async () => {
		const live = await createGolden();
		await live.host.sessions.start(live.project, {
			type: 'countdown',
			writingMode: 'planning',
			startMode: 'manual',
			timing: { idleThresholdSeconds: 60, targetDurationSeconds: 1500 },
			countOptions: live.host.countOptions(),
		});
		const reply = await live.call('getWritingSession', { projectId: live.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const session = bodyOf(bodyOf(reply.body)['session']);
		expect(session).toMatchObject({
			type: 'countdown',
			startMode: 'manual',
			writingMode: 'planning',
			state: 'focus',
			startedAt: '2026-03-10T12:00:00.000Z',
			remainingMs: 1500 * 1000,
			pomodoro: null,
			added: 0,
			deleted: 0,
			net: 0,
		});
		expect(String(session['id'])).toMatch(/^session-/u);
		// Today now holds the session that has just begun beside the one from this morning.
		expect(bodyOf(bodyOf(reply.body)['today'])['sessions']).toBe(2);
		// One session runs at a time in a vault, and it is this project's.
		const elsewhere = await live.call('getWritingSession', { projectId: live.chinese.id });
		expect([elsewhere.status, faults(elsewhere)]).toEqual([200, []]);
		expect(bodyOf(elsewhere.body)['session']).toBeNull();
	});
});

describe('the history', () => {
	const entriesOn = (history: Body, day: string): Body[] =>
		bodyOf((history['days'] as Body[]).find((entry) => entry['day'] === day))['entries'] as Body[];

	it('is given for the seven days ending today where no stretch is asked for, every day there', async () => {
		const history = await call('getHistory');
		expect(history).toMatchObject({ from: '2026-03-04', through: '2026-03-10' });
		expect((history['days'] as Body[]).map((day) => [day['day'], (day['entries'] as Body[]).length])).toEqual([
			['2026-03-04', 0],
			['2026-03-05', 0],
			['2026-03-06', 0],
			['2026-03-07', 0],
			['2026-03-08', 0],
			// The two notes the first session wrote in.
			['2026-03-09', 2],
			// The note the second wrote in, and what was done to the records at noon: five tasks, three threads, five revisions.
			['2026-03-10', 14],
		]);
	});

	it('tells a note’s day by the words the session put in it, where no version of the note was kept', async () => {
		const history = await call('getHistory');
		expect(entriesOn(history, '2026-03-09')).toEqual([
			{
				kind: 'note',
				id: '2026-03-09:20_Character/Ada.md',
				day: '2026-03-09',
				at: '2026-03-09T09:00:00.000Z',
				until: '2026-03-09T09:30:00.000Z',
				action: 'edited',
				note: { path: golden.members.ada.path, relativePath: '20_Character/Ada.md', kind: 'character', exists: true },
				versions: 0,
				words: { added: 70, deleted: 20, net: 50 },
				source: 'sessions',
				sessions: 1,
			},
			{
				kind: 'note',
				id: '2026-03-09:50_Manuscript/Chapter 1.md',
				day: '2026-03-09',
				at: '2026-03-09T09:00:00.000Z',
				until: '2026-03-09T09:30:00.000Z',
				action: 'edited',
				note: { path: golden.manuscript.first, relativePath: '50_Manuscript/Chapter 1.md', kind: 'manuscript', exists: true },
				versions: 0,
				words: { added: 150, deleted: 0, net: 150 },
				source: 'sessions',
				sessions: 1,
			},
		]);
	});

	it('tells what was done to the tasks, the threads and the revisions, each by its kind', async () => {
		const today = entriesOn(await call('getHistory'), '2026-03-10');
		const count = (kind: string): number => today.filter((entry) => entry['kind'] === kind).length;
		expect([count('note'), count('task'), count('thread'), count('revision')]).toEqual([1, 5, 3, 5]);
		// Earliest first: the writing of the morning, then what was filed at noon.
		expect(today[0]).toMatchObject({ kind: 'note', at: '2026-03-10T07:00:00.000Z', words: { added: 10, deleted: 40, net: -30 } });
		// The entry about the record of one kind that carries an id.
		const about = (kind: string, id: string): Body | undefined =>
			today.find((entry) => (entry[kind] as Body | undefined)?.['id'] === id);
		expect(about('task', 'task-outline')).toMatchObject({
			kind: 'task',
			day: '2026-03-10',
			at: '2026-03-10T12:00:00.000Z',
			event: 'task-created',
			task: { id: 'task-outline', title: 'Outline the thaw' },
		});
		expect(about('thread', 'foreshadowing-clock')).toMatchObject({
			kind: 'thread',
			event: 'thread-created',
			thread: { id: 'foreshadowing-clock', name: 'The stopped clock' },
		});
		expect(about('revision', 'revision-noon')).toMatchObject({
			kind: 'revision',
			event: 'revision-proposed',
			note: { relativePath: '50_Manuscript/Chapter 1.md', kind: 'manuscript', exists: true },
		});
		// The chapter this one was proposed in has left the manuscript.
		expect(about('revision', 'revision-stray')).toMatchObject({ note: { relativePath: '50_Manuscript/Cut chapter.md', exists: false } });
	});

	it('is given for the stretch that is asked for, and refuses one longer than ninety-three days', async () => {
		const one = await call('getHistory', { from: '2026-03-09', through: '2026-03-09' });
		expect((one['days'] as Body[]).map((day) => day['day'])).toEqual(['2026-03-09']);
		expect((await call('getHistory', { from: '2025-12-08' }))['days']).toHaveLength(93);
		await refused('getHistory', { from: '2025-12-07' });
		await refused('getHistory', { from: '2026-03-10', through: '2026-03-09' });
		await refused('getHistory', { through: '2026-02-30' });
	});

	it('has nothing to tell for a project nothing was done in', async () => {
		const reply = await golden.call('getHistory', { projectId: golden.chinese.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect((bodyOf(reply.body)['days'] as Body[]).every((day) => (day['entries'] as Body[]).length === 0)).toBe(true);
	});
});

describe('the sessions and the history, read', () => {
	it('leave the vault as it was', async () => {
		const before = vaultState(golden.host);
		await call('listWritingDays', { from: '2025-06-01', through: '2026-03-10' });
		await call('getWritingSpread');
		await call('getWritingSpread', { span: 'yesterday' });
		await call('getWritingSession');
		await call('getHistory', { from: '2026-01-01' });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});
});
