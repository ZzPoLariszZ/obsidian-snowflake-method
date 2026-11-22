import { describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];
const pointerOf = (reply: { body: unknown }): unknown => bodyOf(reply.body)['pointer'];

const SECOND = '50_Manuscript/Chapter 2.md';

/** A call that must land, with its answer held to the contract. */
async function ok(golden: Golden, operation: string, params: Body = {}, body?: unknown, status = 200): Promise<Body> {
	const reply = await golden.call(operation, params, body === undefined ? {} : { body });
	expect([reply.status, faults(reply)], `${operation} ${JSON.stringify(reply.body)}`).toEqual([status, []]);
	return bodyOf(reply.body);
}

describe('the author’s settings', () => {
	it('are told as far as they change what the API answers, to a caller that may only read', async () => {
		const golden = await createGolden({ access: 'read', sensitiveWords: ['suddenly'] });
		const before = vaultState(golden.host);
		expect(await ok(golden, 'getSettings')).toEqual({
			counting: { mode: 'ms-word', headings: 'count' },
			chapterNumbering: { style: 'english' },
			dailyGoals: { project: 6000, manuscript: 4000, scope: 'manuscript' },
			sessionScope: 'project',
			session: { type: 'pomodoro', writingMode: 'draft', countdownMinutes: 45, pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5, pomodoroAutoRepeat: true },
			dialogueMarks: [
				{ open: '“', close: '”' },
				{ open: '"', close: '"' },
			],
			sensitiveWords: ['suddenly'],
			export: { folder: 'Snowflake Projects/Snowflake Export', format: 'txt', layout: 'single', separator: 'blank', indent: true, paragraphSpacing: false },
		});
		expect(vaultState(golden.host)).toEqual(before);
		expect(refusal(await golden.call('updateSettings', {}, { body: { sessionScope: 'manuscript' } }))).toEqual([403, 'access-denied']);
	});

	it('are changed a few at a time, and what a count is made by follows at once', async () => {
		const golden = await createGolden();
		golden.host.told.length = 0;
		const changed = await ok(golden, 'updateSettings', {}, {
			counting: { mode: 'qidian' },
			dailyGoals: { manuscript: 1500, scope: 'project' },
			sessionScope: 'manuscript',
			sensitiveWords: [' very ', 'very', '', 'all of a sudden'],
		});
		expect(changed).toMatchObject({
			counting: { mode: 'qidian', headings: 'count' },
			dailyGoals: { project: 6000, manuscript: 1500, scope: 'project' },
			sessionScope: 'manuscript',
			sensitiveWords: ['very', 'all of a sudden'],
		});
		expect(golden.host.told).toEqual(['settings']);
		expect(bodyOf((await ok(golden, 'getManuscript', { projectId: golden.project.id }))['counting'])['mode']).toBe('qidian');
		expect((await ok(golden, 'getWritingSession', { projectId: golden.project.id }))['goalScope']).toBe('project');
		// Read and sent back whole, they are left as they stand and nothing is told.
		await ok(golden, 'updateSettings', {}, changed);
		expect(golden.host.told).toEqual(['settings']);
	});

	it('are held to what the plugin’s own settings page holds them to', async () => {
		const golden = await createGolden();
		const sent = (body: Body) => golden.call('updateSettings', {}, { body });
		expect(refusal(await sent({ counting: { mode: 'by-ear' } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ dailyGoals: { project: -1 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ dailyGoals: { manuscript: 1_000_001 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ sensitiveWords: ['one\ntwo'] }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ sensitiveWords: ['x'.repeat(20_001)] }))).toEqual([400, 'invalid-request']);
		// What is the author's alone to set is not among what a caller may send.
		expect(refusal(await sent({ access: 'delete' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await sent({ port: 8080 }))).toEqual([400, 'invalid-request']);
		expect(golden.host.told.filter((what) => what === 'settings')).toEqual([]);
	});
});

describe('the author’s timer', () => {
	it('is started on a project as the call says, or as the author has it set, and stopped again', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		expect((await ok(golden, 'getWritingSession', P))['session']).toBeNull();
		const started = await ok(golden, 'startWritingSession', P, { type: 'stopwatch', writingMode: 'revision' }, 201);
		expect(started['session']).toMatchObject({ type: 'stopwatch', writingMode: 'revision', startMode: 'manual' });
		expect((await ok(golden, 'getWritingSession', P))['session']).toMatchObject({ id: bodyOf(started['session'])['id'] });

		// Only one runs at a time, on one project.
		const second = await golden.call('startWritingSession', P, { body: {} });
		expect([refusal(second), faults(second)]).toEqual([[409, 'session-running'], []]);
		expect(refusal(await golden.call('startWritingSession', { projectId: golden.chinese.id }, { body: {} }))).toEqual([409, 'session-running']);
		// Stopping on another project leaves this one's running.
		expect((await ok(golden, 'stopWritingSession', { projectId: golden.chinese.id }))['session']).toBeNull();
		expect((await ok(golden, 'getWritingSession', P))['session']).not.toBeNull();

		expect((await ok(golden, 'stopWritingSession', P))['session']).toBeNull();
		// With none under way there is nothing to stop, and that is no failure.
		expect((await ok(golden, 'stopWritingSession', P))['session']).toBeNull();
	});

	it('takes a length for a countdown and for nothing else, and the author’s own type where none is sent', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		expect(refusal(await golden.call('startWritingSession', P, { body: { type: 'stopwatch', minutes: 10 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('startWritingSession', P, { body: { type: 'countdown', minutes: 2 } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('startWritingSession', P, { body: { minutes: 10 } }))).toEqual([400, 'invalid-request']);
		const counting = await ok(golden, 'startWritingSession', P, { type: 'countdown', minutes: 10 }, 201);
		expect(counting['session']).toMatchObject({ type: 'countdown', writingMode: 'draft' });
		await ok(golden, 'stopWritingSession', P);
		expect((await ok(golden, 'startWritingSession', P, {}, 201))['session']).toMatchObject({ type: 'pomodoro' });
	});
});

describe('the mentions the author set aside', () => {
	const mentioned = async (golden: Golden, notePath: string): Promise<number> =>
		((await ok(golden, 'listNoteMentions', { projectId: golden.project.id, notePath }))['items'] as Body[]).length;

	it('are rules for the whole manuscript, for one note or for one place, each told by an id worked out from what it says', async () => {
		const golden = await createGolden();
		const { ada, ben } = golden.members;
		const P = { projectId: golden.project.id };
		expect(await ok(golden, 'listMentionIgnores', P)).toEqual({ items: [] });
		golden.host.told.length = 0;

		const whole = await ok(golden, 'addMentionIgnore', P, { scope: 'manuscript', words: 'Ada', member: { id: ada.characterId } }, 201);
		expect(whole['items']).toEqual([
			{
				id: whole['id'],
				scope: 'manuscript',
				words: 'Ada',
				member: { kind: 'character', id: ada.characterId, name: 'Ada', path: ada.path, resolved: true },
				note: null,
				ordinal: null,
			},
		]);
		expect(String(whole['id'])).toMatch(/^mention-ignore-[0-9a-f]{16}$/u);
		// A rule that already stands is what was asked for.
		const again = await ok(golden, 'addMentionIgnore', P, { scope: 'manuscript', words: 'Ada', member: { id: ada.characterId } }, 201);
		expect([again['id'], (again['items'] as Body[]).length]).toEqual([whole['id'], 1]);

		const before = await mentioned(golden, SECOND);
		expect(before).toBeGreaterThan(0);
		const inNote = await ok(golden, 'addMentionIgnore', P, { scope: 'note', words: 'Ben', member: { id: ben.characterId }, note: SECOND }, 201);
		expect((inNote['items'] as Body[])[1]).toMatchObject({
			scope: 'note',
			words: 'Ben',
			member: { id: ben.characterId },
			note: { relativePath: SECOND, path: golden.manuscript.second, title: 'Chapter 2' },
			ordinal: null,
		});
		// The manuscript's own reading follows the rule at once.
		expect(await mentioned(golden, SECOND)).toBe(before - 1);
		const place = await ok(golden, 'addMentionIgnore', P, { scope: 'occurrence', words: 'Ben', note: SECOND, ordinal: 0 }, 201);
		expect((place['items'] as Body[])[2]).toMatchObject({ scope: 'occurrence', words: 'Ben', member: null, note: { relativePath: SECOND }, ordinal: 0 });
		expect(golden.host.told).toEqual(['mentions', 'mentions', 'mentions', 'mentions']);

		const gone = await golden.call('removeMentionIgnore', { ...P, ignoreId: String(inNote['id']) });
		expect([gone.status, gone.body]).toEqual([204, undefined]);
		expect(refusal(await golden.call('removeMentionIgnore', { ...P, ignoreId: String(inNote['id']) }))).toEqual([404, 'not-found']);
		expect(((await ok(golden, 'listMentionIgnores', P))['items'] as Body[]).map((rule) => rule['id'])).toEqual([whole['id'], place['id']]);
		// The rule about that one place still holds, and with it gone the words are a mention again.
		expect(await mentioned(golden, SECOND)).toBe(before - 1);
		expect((await golden.call('removeMentionIgnore', { ...P, ignoreId: String(place['id']) })).status).toBe(204);
		expect(await mentioned(golden, SECOND)).toBe(before);
	});

	it('say which note and which words, and name only what the project has', async () => {
		const golden = await createGolden();
		const { ada } = golden.members;
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		const add = (body: Body) => golden.call('addMentionIgnore', P, { body });
		expect(JSON.stringify((await add({ scope: 'manuscript', words: 'Ada' })).body)).toContain('/member');
		const nobody = await add({ scope: 'manuscript', words: 'Ada', member: { id: 'character-gone' } });
		expect([refusal(nobody), pointerOf(nobody)]).toEqual([[422, 'invalid-reference'], '/member']);
		expect(JSON.stringify((await add({ scope: 'note', words: 'Ada', member: { id: ada.characterId } })).body)).toContain('/note');
		expect(refusal(await add({ scope: 'note', words: 'Ada', member: { id: ada.characterId }, note: '50_Manuscript/Nowhere.md' }))).toEqual([400, 'invalid-request']);
		expect(JSON.stringify((await add({ scope: 'occurrence', words: 'Ada', note: SECOND })).body)).toContain('/ordinal');
		expect(refusal(await add({ scope: 'everywhere', words: 'Ada' }))).toEqual([400, 'invalid-request']);
		expect(refusal(await add({ scope: 'manuscript', words: '', member: { id: ada.characterId } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.told.filter((what) => what === 'mentions')).toEqual([]);
	});
});
