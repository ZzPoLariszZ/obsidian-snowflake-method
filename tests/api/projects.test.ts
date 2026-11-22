import { beforeAll, describe, expect, it } from 'vitest';

import { createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const items = (value: unknown): Body[] => bodyOf(value)['items'] as Body[];

describe('the projects, listed', () => {
	let golden: Golden;
	beforeAll(async () => {
		golden = await createGolden();
	});

	it('are the ones the author works on, by title, each with its id and where it stands', async () => {
		const reply = await golden.call('listProjects');
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(items(reply.body).map((entry) => entry['title'])).toEqual(['North Wind', '北境之雪']);
		expect(items(reply.body)[0]).toEqual({
			id: golden.project.id,
			title: 'North Wind',
			language: 'en',
			path: 'Snowflake Projects/North Wind',
			metadataPath: golden.project.projectFile,
			series: { name: 'Four Winds', book: 1 },
			readOnly: false,
			archived: false,
			current: true,
		});
		expect(items(reply.body)[1]).toMatchObject({ language: 'zh-CN', series: null, current: false, archived: false });
		expect(bodyOf(reply.body)).toMatchObject({ total: 2, offset: 0, limit: 100, nextOffset: null });
	});

	it('leave the archive out unless it is asked for', async () => {
		const archived = await golden.call('listProjects', { state: 'archived' });
		expect(faults(archived)).toEqual([]);
		expect(items(archived.body)).toHaveLength(1);
		expect(items(archived.body)[0]).toMatchObject({ id: golden.archived.id, title: 'Old Draft', archived: true });
		const all = await golden.call('listProjects', { state: 'all' });
		expect(items(all.body).map((entry) => [entry['title'], entry['archived']])).toEqual([
			['North Wind', false],
			['北境之雪', false],
			['Old Draft', true],
		]);
	});

	it('come a page at a time where a page is asked for', async () => {
		const first = await golden.call('listProjects', { state: 'all', limit: '2' });
		expect(bodyOf(first.body)).toMatchObject({ total: 3, offset: 0, limit: 2, nextOffset: 2 });
		expect(items(first.body)).toHaveLength(2);
		const second = await golden.call('listProjects', { state: 'all', limit: '2', offset: '2' });
		expect(bodyOf(second.body)).toMatchObject({ total: 3, offset: 2, limit: 2, nextOffset: null });
		expect(items(second.body).map((entry) => entry['title'])).toEqual(['Old Draft']);
		expect(faults(second)).toEqual([]);
		const past = await golden.call('listProjects', { offset: '9' });
		expect(bodyOf(past.body)).toMatchObject({ items: [], total: 2, nextOffset: null });
	});

	it('refuse a state or a page size the contract does not know', async () => {
		expect((await golden.call('listProjects', { state: 'deleted' })).status).toBe(400);
		expect((await golden.call('listProjects', { limit: '501' })).status).toBe(400);
		expect((await golden.call('listProjects', { limit: '0' })).status).toBe(400);
	});
});

describe('one project, read', () => {
	let golden: Golden;
	beforeAll(async () => {
		golden = await createGolden();
	});

	it('tells its steps, how far it has come, what it holds and where its folders stand', async () => {
		const reply = await golden.call('getProject', { projectId: golden.project.id });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const project = bodyOf(reply.body);
		expect(project).toMatchObject({
			id: golden.project.id,
			title: 'North Wind',
			language: 'en',
			path: 'Snowflake Projects/North Wind',
			series: { name: 'Four Winds', book: 1 },
			readOnly: false,
			archived: false,
			current: true,
			schemaVersion: 3,
			progress: { completed: 1, total: 10, percent: 10 },
			counts: { characters: 2, scenes: 2, entities: 4 },
			health: { status: 'ok', blocking: 0, advisory: 0 },
		});
		expect((project['steps'] as Body[]).map((step) => step['status'])).toEqual([
			'complete',
			'in-progress',
			...Array.from({ length: 8 }, () => 'not-started'),
		]);
		expect(bodyOf(project['manuscript'])['firstNotePath']).toBe(golden.project.links.draft);
		const folders = bodyOf(project['folders']);
		expect(folders['characters']).toBe('Snowflake Projects/North Wind/20_Character');
		expect(folders['draft']).toBe('Snowflake Projects/North Wind/50_Manuscript');
		expect(Object.keys(folders)).toHaveLength(22);
	});

	it('names its folders the same way in another language, where they stand under other names', async () => {
		const reply = await golden.call('getProject', { projectId: golden.chinese.id });
		expect(faults(reply)).toEqual([]);
		const folders = bodyOf(bodyOf(reply.body)['folders']);
		expect(folders['draft']).toBe('Snowflake Projects/北境之雪/50_正文');
		expect(bodyOf(reply.body)['language']).toBe('zh-CN');
	});

	it('can be read while it stands in the archive, and says that it does', async () => {
		const reply = await golden.call('getProject', { projectId: golden.archived.id });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)).toMatchObject({ title: 'Old Draft', archived: true, current: false });
	});

	it('has its link to the manuscript put right the first time it is read after it was moved, and nothing after that', async () => {
		const moved = await createGolden();
		const before = vaultState(moved.host);
		await moved.call('getProject', { projectId: moved.archived.id });
		const after = vaultState(moved.host);
		// The one thing a read of a project can write, which the plugin writes whenever it opens a project that was moved.
		const properties = 'Snowflake Projects/Snowflake Archive/Old Draft/00_System/001_Project_Metadata.md';
		expect(Object.keys(after)).toEqual(Object.keys(before));
		expect(Object.keys(after).filter((path) => after[path] !== before[path])).toEqual([properties]);
		const was = (before[properties] ?? '').split('\n');
		const changed = (after[properties] ?? '').split('\n').filter((line, index) => line !== was[index]);
		expect(changed).toEqual(['  "snowflake-draft": "[[Snowflake Projects/Snowflake Archive/Old Draft/50_Manuscript/Draft|Draft]]",']);
		await moved.call('getProject', { projectId: moved.archived.id });
		await moved.call('listSteps', { projectId: moved.archived.id });
		expect(vaultState(moved.host)).toEqual(after);
	});

	it('is not found under an id no project carries', async () => {
		const reply = await golden.call('getProject', { projectId: 'project-nonsense' });
		expect(reply.status).toBe(404);
		expect(bodyOf(reply.body)['code']).toBe('not-found');
		expect(faults(reply)).toEqual([]);
	});

	it('is not answered for where two folders carry its id', async () => {
		const doubled = await createGolden();
		const vault = doubled.host.environment.fakeVault;
		// A project folder copied by hand: the same notes under another name.
		for (const [path, text] of [...vault.contents.entries()]) {
			if (!path.startsWith('Snowflake Projects/North Wind/')) continue;
			const copy = path.replace('Snowflake Projects/North Wind/', 'Snowflake Projects/North Wind copy/');
			await doubled.host.projects.repository.ensureFolder(copy.slice(0, copy.lastIndexOf('/')));
			await doubled.host.projects.repository.createPlainFile(copy, text);
		}
		const reply = await doubled.call('getProject', { projectId: doubled.project.id });
		expect(reply.status).toBe(409);
		expect(bodyOf(reply.body)).toMatchObject({
			code: 'ambiguous-project',
			paths: ['Snowflake Projects/North Wind', 'Snowflake Projects/North Wind copy'],
		});
		expect(faults(reply)).toEqual([]);
	});

	it('is read without a word being written', async () => {
		const before = vaultState(golden.host);
		await golden.call('listProjects', { state: 'all' });
		await golden.call('getProject', { projectId: golden.project.id });
		await golden.call('getProjectHealth', { projectId: golden.project.id });
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.ranAsPlugin).toBe(0);
	});
});

describe('a project’s health', () => {
	it('is good for a project as the plugin made it', async () => {
		const golden = await createGolden();
		const reply = await golden.call('getProjectHealth', { projectId: golden.project.id });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(reply.body).toEqual({ status: 'ok', readOnly: false, outdatedNotes: 0, issues: [] });
	});

	it('names what is missing, whether it blocks work and whether the plugin can put it back', async () => {
		const golden = await createGolden();
		const stepTwo = golden.project.artifacts[2];
		if (stepTwo === undefined) throw new Error('The project has the note of step 2.');
		await golden.host.projects.repository.trashFile(stepTwo.path);
		const reply = await golden.call('getProjectHealth', { projectId: golden.project.id });
		expect(faults(reply)).toEqual([]);
		const health = bodyOf(reply.body);
		expect(health['status']).toBe('blocking');
		const issues = health['issues'] as Body[];
		expect(issues.map((issue) => issue['code'])).toContain('missing-artifact');
		const missing = issues.find((issue) => issue['code'] === 'missing-artifact');
		expect(missing).toMatchObject({ blocking: true, repairable: true, steps: [2] });
		// And the project itself says so in short.
		const project = await golden.call('getProject', { projectId: golden.project.id });
		expect(bodyOf(bodyOf(project.body)['health'])).toMatchObject({ status: 'blocking' });
		expect(faults(project)).toEqual([]);
	});
});
