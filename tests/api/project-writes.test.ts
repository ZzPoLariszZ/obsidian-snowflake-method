import { describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

/** A vault of its own for each test, with what the repository was told of the vault's making forgotten. */
async function fresh(): Promise<Golden> {
	const golden = await createGolden({ access: 'write' });
	golden.host.origins.length = 0;
	return golden;
}
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];

describe('a project, made', () => {
	it('is made with its folders and its steps, answered in full with where it now stands, and not made the current one', async () => {
		const golden = await fresh();
		const reply = await golden.call('createProject', {}, { body: { title: '  South Wind ', language: 'en', series: { name: 'Four Winds', book: 2 } } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		const project = bodyOf(reply.body);
		expect(project).toMatchObject({
			title: 'South Wind',
			language: 'en',
			series: { name: 'Four Winds', book: 2 },
			archived: false,
			current: false,
			path: 'Snowflake Projects/South Wind',
		});
		expect(reply.location).toBe(`/projects/${String(project['id'])}`);
		// It is among the projects, and can be read at once by the id it was given.
		const listed = await golden.call('listProjects');
		expect(items(listed.body).map((entry) => entry['title'])).toContain('South Wind');
		const read = await golden.call('getProject', { projectId: project['id'] });
		expect([read.status, bodyOf(read.body)['title']]).toEqual([200, 'South Wind']);
		// The author is still working in the project they were working in.
		expect(golden.host.currentProjectPath()).toBe(golden.project.projectFile);
		// Nothing of it is the author's typing, and all of it ran as the plugin's own work.
		expect(golden.host.origins.length).toBeGreaterThan(0);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
		expect(golden.host.ranAsPlugin).toBe(1);
	});

	it('is made in the language asked for, which names its folders', async () => {
		const golden = await fresh();
		const reply = await golden.call('createProject', {}, { body: { title: '南風', language: 'ja' } });
		expect([reply.status, faults(reply)]).toEqual([201, []]);
		expect(bodyOf(reply.body)).toMatchObject({ title: '南風', language: 'ja', series: null });
		const folders = bodyOf(bodyOf(reply.body)['folders']);
		expect(String(folders['draft'])).toMatch(/^Snowflake Projects\/南風\/50_/u);
		expect(String(folders['draft'])).not.toContain('Manuscript');
	});

	it('is refused under a title another project goes by, whatever its case, and nothing is made', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const reply = await golden.call('createProject', {}, { body: { title: 'north wind', language: 'en' } });
		expect(refusal(reply)).toEqual([409, 'duplicate-name']);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({ kind: 'project', name: 'north wind' });
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused with no title, a title of spaces, a language the plugin does not write in, or a property it does not know', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		for (const body of [
			{ language: 'en' },
			{ title: '   ', language: 'en' },
			{ title: 'East Wind', language: 'tlh' },
			{ title: 'East Wind', language: 'en', rootPath: 'Elsewhere' },
			{ title: 'East Wind', language: 'en', series: { name: 'Four Winds', book: 0 } },
		]) {
			const reply = await golden.call('createProject', {}, { body });
			expect(refusal(reply), JSON.stringify(body)).toEqual([400, 'invalid-request']);
		}
		expect((await golden.call('createProject')).status).toBe(400);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a project, changed', () => {
	it('is renamed, its folder moving with its title and its id staying', async () => {
		const golden = await fresh();
		const reply = await golden.call('updateProject', { projectId: golden.project.id }, { body: { title: 'North Wind Rising' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			id: golden.project.id,
			title: 'North Wind Rising',
			path: 'Snowflake Projects/North Wind Rising',
			// What was not sent is as it was.
			series: { name: 'Four Winds', book: 1 },
			current: true,
		});
		const state = vaultState(golden.host);
		expect(Object.keys(state).some((path) => path.startsWith('Snowflake Projects/North Wind/'))).toBe(false);
		expect(Object.keys(state).some((path) => path.startsWith('Snowflake Projects/North Wind Rising/20_Character/Ada.md'))).toBe(true);
		expect(golden.host.origins.every((userInput) => !userInput)).toBe(true);
	});

	it('is put in a series, moved to another, and taken out with null', async () => {
		const golden = await fresh();
		const projectId = golden.chinese.id;
		const put = await golden.call('updateProject', { projectId }, { body: { series: { name: '北境', book: null } } });
		expect([put.status, faults(put)]).toEqual([200, []]);
		expect(bodyOf(put.body)['series']).toEqual({ name: '北境', book: null });
		const moved = await golden.call('updateProject', { projectId }, { body: { series: { name: '南境', book: 3 } } });
		expect(bodyOf(moved.body)['series']).toEqual({ name: '南境', book: 3 });
		const out = await golden.call('updateProject', { projectId }, { body: { series: null } });
		expect([out.status, bodyOf(out.body)['series']]).toEqual([200, null]);
	});

	it('takes a project read and sent back whole, and looks only at what can be changed', async () => {
		const golden = await fresh();
		const read = bodyOf((await golden.call('getProject', { projectId: golden.project.id })).body);
		const reply = await golden.call('updateProject', { projectId: golden.project.id }, { body: { ...read, title: 'Northerly', id: 'project-other' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ id: golden.project.id, title: 'Northerly' });
	});

	it('is left as it was by a change that changes nothing', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const reply = await golden.call('updateProject', { projectId: golden.project.id }, { body: { title: 'North Wind' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const empty = await golden.call('updateProject', { projectId: golden.project.id }, { body: {} });
		expect(empty.status).toBe(200);
		expect(vaultState(golden.host)).toEqual(before);
	});

	it('is refused a title another project goes by, a property it does not know, and an id no project carries', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const taken = await golden.call('updateProject', { projectId: golden.project.id }, { body: { title: '北境之雪' } });
		expect(refusal(taken)).toEqual([409, 'duplicate-name']);
		const unknown = await golden.call('updateProject', { projectId: golden.project.id }, { body: { tint: 'macaron-1' } });
		expect(refusal(unknown)).toEqual([400, 'invalid-request']);
		const nowhere = await golden.call('updateProject', { projectId: 'project-nowhere' }, { body: { title: 'Anything' } });
		expect(refusal(nowhere)).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a project, archived and restored', () => {
	it('is moved into the archive, where it is still read and no longer listed among the others', async () => {
		const golden = await fresh();
		const reply = await golden.call('archiveProject', { projectId: golden.chinese.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({
			id: golden.chinese.id,
			title: '北境之雪',
			archived: true,
			path: 'Snowflake Projects/Snowflake Archive/北境之雪',
		});
		expect(items((await golden.call('listProjects')).body).map((entry) => entry['title'])).toEqual(['North Wind']);
		const read = await golden.call('getProject', { projectId: golden.chinese.id });
		expect([read.status, bodyOf(read.body)['archived']]).toEqual([200, true]);
		// Archived twice it is refused: it can be read and restored there, and nothing else.
		expect(refusal(await golden.call('archiveProject', { projectId: golden.chinese.id }))).toEqual([409, 'project-archived']);
	});

	it('is brought back beside the others under its own title where that is still free', async () => {
		const golden = await fresh();
		const reply = await golden.call('restoreProject', { projectId: golden.archived.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)['renamedFrom']).toBeNull();
		expect(bodyOf(bodyOf(reply.body)['project'])).toMatchObject({
			id: golden.archived.id,
			title: 'Old Draft',
			archived: false,
			path: 'Snowflake Projects/Old Draft',
		});
		expect(items((await golden.call('listProjects')).body).map((entry) => entry['title'])).toContain('Old Draft');
		// It is no longer in the archive, so there is nothing more to restore.
		expect(refusal(await golden.call('restoreProject', { projectId: golden.archived.id }))).toEqual([409, 'not-archived']);
	});

	it('comes back under the first free title where another project took its own while it was away', async () => {
		const golden = await fresh();
		await golden.call('createProject', {}, { body: { title: 'Old Draft', language: 'en' } });
		const reply = await golden.call('restoreProject', { projectId: golden.archived.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)['renamedFrom']).toBe('Old Draft');
		expect(bodyOf(bodyOf(reply.body)['project'])).toMatchObject({ title: 'Old Draft 2', path: 'Snowflake Projects/Old Draft 2' });
	});

	it('is not restored from where it is not, and not found under an id no project carries', async () => {
		const golden = await fresh();
		expect(refusal(await golden.call('restoreProject', { projectId: golden.project.id }))).toEqual([409, 'not-archived']);
		expect(refusal(await golden.call('restoreProject', { projectId: 'project-nowhere' }))).toEqual([404, 'not-found']);
		expect(refusal(await golden.call('archiveProject', { projectId: 'project-nowhere' }))).toEqual([404, 'not-found']);
	});
});

describe('a project, repaired', () => {
	it('has what it is missing put back, and says what was made and how it stands after', async () => {
		const golden = await fresh();
		const stepTwo = golden.project.artifacts[2];
		if (stepTwo === undefined) throw new Error('The project has the note of step 2.');
		await golden.host.projects.repository.trashFile(stepTwo.path);
		const broken = await golden.call('getProjectHealth', { projectId: golden.project.id });
		expect(bodyOf(broken.body)['status']).toBe('blocking');

		const reply = await golden.call('repairProject', { projectId: golden.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const repair = bodyOf(reply.body);
		expect(repair['created']).toEqual([stepTwo.path]);
		expect(repair['conflicts']).toEqual([]);
		expect(bodyOf(repair['health'])).toMatchObject({ status: 'ok', issues: [] });
		// What the author wrote is as it was.
		const text = await golden.call('getStepText', { projectId: golden.project.id, step: 1 });
		expect(bodyOf(bodyOf(text.body)['sections'])['genre']).toBe('Winter mystery');
	});

	it('finds nothing to do in a project that is whole', async () => {
		const golden = await fresh();
		// The first pass brings the scenes' own overviews level with their properties, which the plugin does within a second of any change.
		const first = await golden.call('repairProject', { projectId: golden.project.id });
		expect([first.status, faults(first)]).toEqual([200, []]);
		expect(bodyOf(first.body)).toMatchObject({ created: [], conflicts: [] });
		const before = vaultState(golden.host);
		const reply = await golden.call('repairProject', { projectId: golden.project.id });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(reply.body)).toMatchObject({ created: [], repaired: [], conflicts: [] });
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a step’s status, set', () => {
	const statuses = (reply: { body: unknown }): unknown[] => items(reply.body).map((step) => step['status']);

	it('is set where the steps it rests on are complete, and all ten are answered', async () => {
		const golden = await fresh();
		// Step 1 is complete and step 2 in progress.
		const reply = await golden.call('setStepStatus', { projectId: golden.project.id, step: 2 }, { body: { status: 'complete' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(statuses(reply).slice(0, 3)).toEqual(['complete', 'complete', 'not-started']);
		expect(items(reply.body)).toHaveLength(10);
	});

	it('is refused where the steps it rests on are not complete, with which they are', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		// Step 4 rests on step 2, which is still in progress.
		const reply = await golden.call('setStepStatus', { projectId: golden.project.id, step: 4 }, { body: { status: 'complete' } });
		expect(refusal(reply)).toEqual([409, 'step-prerequisites-incomplete']);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)['steps']).toEqual([2]);
		expect(vaultState(golden.host)).toEqual(before);
		// It can be begun all the same, and a step that rests on none can be completed.
		const begun = await golden.call('setStepStatus', { projectId: golden.project.id, step: 4 }, { body: { status: 'in-progress' } });
		expect([begun.status, statuses(begun)[3]]).toEqual([200, 'in-progress']);
		const third = await golden.call('setStepStatus', { projectId: golden.project.id, step: 3 }, { body: { status: 'complete' } });
		expect([third.status, statuses(third)[2]]).toEqual([200, 'complete']);
	});

	it('takes the steps that rest on a step back with it', async () => {
		const golden = await fresh();
		await golden.call('setStepStatus', { projectId: golden.project.id, step: 2 }, { body: { status: 'complete' } });
		const reply = await golden.call('setStepStatus', { projectId: golden.project.id, step: 1 }, { body: { status: 'in-progress' } });
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		// Step 2 was complete on a step 1 that no longer is.
		expect(statuses(reply).slice(0, 2)).toEqual(['in-progress', 'not-started']);
	});

	it('is refused a status that step cannot have, and a word that is no status', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const call = (step: number, status: string) => golden.call('setStepStatus', { projectId: golden.project.id, step }, { body: { status } });
		expect(refusal(await call(5, 'skipped'))).toEqual([422, 'invalid-step-status']);
		expect(refusal(await call(10, 'in-progress'))).toEqual([422, 'invalid-step-status']);
		expect(refusal(await call(2, 'finished'))).toEqual([400, 'invalid-request']);
		expect(refusal(await call(11, 'complete'))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a step’s text, written', () => {
	const read = async (golden: Golden, step = 1): Promise<Body> => bodyOf((await golden.call('getStepText', { projectId: golden.project.id, step })).body);

	it('is written section by section against the version it was read at, the rest left as it was', async () => {
		const golden = await fresh();
		const before = await read(golden);
		const reply = await golden.call(
			'updateStepText',
			{ projectId: golden.project.id, step: 1 },
			{ body: { sections: { genre: 'Cold-weather mystery' } }, ifMatch: String(before['etag']) },
		);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		const after = bodyOf(reply.body);
		expect(bodyOf(after['sections'])).toMatchObject({
			genre: 'Cold-weather mystery',
			'one-sentence-summary': bodyOf(before['sections'])['one-sentence-summary'],
			'candidate-title-1': 'North Wind',
		});
		expect(after['etag']).not.toBe(before['etag']);
		expect(reply.etag).toBe(after['etag']);
		expect(await read(golden)).toEqual(after);
		// A tool's words, not the author's.
		expect(golden.host.origins).toEqual([false]);
	});

	it('is refused without a version, and against a version the note has left behind, with the one it stands at', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const text = await read(golden);
		const params = { projectId: golden.project.id, step: 1 };
		const body = { sections: { genre: 'Thriller' } };
		const blind = await golden.call('updateStepText', params, { body });
		expect(refusal(blind)).toEqual([428, 'precondition-required']);
		const stale = await golden.call('updateStepText', params, { body, ifMatch: 'fp1-0000000000000000' });
		expect(refusal(stale)).toEqual([412, 'concurrent-change']);
		expect(faults(stale)).toEqual([]);
		expect(bodyOf(stale.body)['currentEtag']).toBe(text['etag']);
		expect(vaultState(golden.host)).toEqual(before);
		// Whichever version stands, where the caller says it does not mind.
		const any = await golden.call('updateStepText', params, { body, ifMatch: '*' });
		expect([any.status, bodyOf(bodyOf(any.body)['sections'])['genre']]).toEqual([200, 'Thriller']);
	});

	it('takes a step’s text read and sent back whole', async () => {
		const golden = await fresh();
		const text = await read(golden, 2);
		const sections = { ...bodyOf(text['sections']), 'one-paragraph-summary': 'A week of nights in the tower.' };
		const reply = await golden.call(
			'updateStepText',
			{ projectId: golden.project.id, step: 2 },
			{ body: { ...text, sections }, ifMatch: String(text['etag']) },
		);
		expect([reply.status, faults(reply)]).toEqual([200, []]);
		expect(bodyOf(bodyOf(reply.body)['sections'])['one-paragraph-summary']).toBe('A week of nights in the tower.');
	});

	it('is refused a section the step does not have, and a step that has no note of its own', async () => {
		const golden = await fresh();
		const before = vaultState(golden.host);
		const text = await read(golden);
		const stranger = await golden.call(
			'updateStepText',
			{ projectId: golden.project.id, step: 1 },
			{ body: { sections: { genre: 'Thriller', 'plot-synopsis': 'Not here.' } }, ifMatch: String(text['etag']) },
		);
		expect(refusal(stranger)).toEqual([400, 'invalid-request']);
		expect(bodyOf(stranger.body)['errors']).toMatchObject([{ pointer: '/sections/plot-synopsis' }]);
		const noNote = await golden.call('updateStepText', { projectId: golden.project.id, step: 3 }, { body: { sections: {} }, ifMatch: '*' });
		expect(refusal(noNote)).toEqual([404, 'not-found']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});
