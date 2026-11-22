import { beforeAll, describe, expect, it } from 'vitest';

import { STEP_NAMES } from '../../api/dto/project';
import { STEP_IDS } from '../../src/domain';
import { renderMarkedSection } from '../../src/templates';
import { STEP_ONE_TEXT, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;

describe('a project’s ten steps', () => {
	let golden: Golden;
	beforeAll(async () => {
		golden = await createGolden();
	});

	it('are listed in order, each by a name that is the same in every language', async () => {
		const reply = await golden.call('listSteps', { projectId: golden.project.id });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const steps = bodyOf(reply.body)['items'] as Body[];
		expect(steps.map((step) => [step['id'], step['name']])).toEqual(STEP_IDS.map((id) => [id, STEP_NAMES[id]]));
		const chinese = await golden.call('listSteps', { projectId: golden.chinese.id });
		expect((bodyOf(chinese.body)['items'] as Body[]).map((step) => step['name'])).toEqual(steps.map((step) => step['name']));
	});

	it('each say where they stand, what they wait on and what they may be set to', async () => {
		const first = await golden.call('getStep', { projectId: golden.project.id, step: '1' });
		expect(faults(first)).toEqual([]);
		expect(first.body).toEqual({
			id: 1,
			name: 'one-sentence-summary',
			status: 'complete',
			optional: false,
			dependencies: [],
			needsReview: false,
			textEditable: true,
			path: golden.project.artifacts[1]?.path,
			allowedStatuses: ['not-started', 'in-progress', 'in-revision', 'complete'],
		});
		const ninth = bodyOf((await golden.call('getStep', { projectId: golden.project.id, step: 9 })).body);
		expect(ninth).toMatchObject({ optional: true, textEditable: false, path: null, dependencies: [8] });
		// Only the optional step can be skipped.
		expect(ninth['allowedStatuses']).toEqual(['not-started', 'in-progress', 'in-revision', 'complete', 'skipped']);
		const tenth = bodyOf((await golden.call('getStep', { projectId: golden.project.id, step: 10 })).body);
		// The manuscript is written or it is not: there is nothing between.
		expect(tenth).toMatchObject({ name: 'manuscript', allowedStatuses: ['not-started', 'complete'], path: golden.project.links.draft });
	});

	it('say when a step they build on has changed since the author last looked', async () => {
		const fresh = await createGolden();
		const stepOne = fresh.project.artifacts[1];
		if (stepOne === undefined) throw new Error('The project has the note of step 1.');
		// The second step is finished against the first as it stands, and then the first is rewritten.
		await fresh.host.projects.updateStepStatus(fresh.project, 2, 'complete');
		await fresh.host.projects.updateSections(stepOne.path, { 'one-sentence-summary': 'Another story altogether.' }, stepOne.revision);
		const steps = bodyOf((await fresh.call('listSteps', { projectId: fresh.project.id })).body)['items'] as Body[];
		// The second builds on the first. The first itself needs no look, and
		// neither does a step that was never finished.
		expect(steps.filter((step) => step['needsReview'] === true).map((step) => step['id'])).toEqual([2]);
		// The status stands as the author set it: reading takes no step back into revision.
		expect(steps[1]?.['status']).toBe('complete');
	});

	it('are refused for a number that is no step', async () => {
		for (const step of ['0', '11', 'two', '1.5']) {
			const reply = await golden.call('getStep', { projectId: golden.project.id, step });
			expect(reply.status, step).toBe(400);
			expect(bodyOf(reply.body)['code'], step).toBe('invalid-request');
		}
	});
});

describe('what a step says', () => {
	let golden: Golden;
	beforeAll(async () => {
		golden = await createGolden();
	});

	it('is read section by section, with the version of its note', async () => {
		const reply = await golden.call('getStepText', { projectId: golden.project.id, step: '1' });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		const text = bodyOf(reply.body);
		expect(text).toMatchObject({ step: 1, path: golden.project.artifacts[1]?.path, readOnly: false, damaged: false });
		const sections = bodyOf(text['sections']);
		expect(Object.keys(sections)).toEqual([
			'genre',
			'audience-reason-1',
			'one-sentence-summary',
			'candidate-title-1',
			'candidate-title-2',
			'candidate-title-3',
			'candidate-title-4',
			'candidate-title-5',
			'candidate-title-6',
		]);
		expect(sections['one-sentence-summary']).toBe(STEP_ONE_TEXT['one-sentence-summary']);
		expect(sections['genre']).toBe('Winter mystery');
		expect(sections['candidate-title-2']).toBe('');
		// The same version in the answer and beside it, for the door to send as a header.
		expect(text['etag']).toBe(golden.project.artifacts[1]?.revision);
		expect(reply.etag).toBe(text['etag']);
	});

	it('has the sections of its own step', async () => {
		const sectionsOf = async (step: number): Promise<string[]> =>
			Object.keys(bodyOf(bodyOf((await golden.call('getStepText', { projectId: golden.project.id, step })).body)['sections']));
		expect(await sectionsOf(2)).toEqual(['one-paragraph-summary', 'description']);
		expect(await sectionsOf(4)).toEqual(['plot-synopsis']);
		expect(await sectionsOf(6)).toEqual(['long-synopsis']);
	});

	it('is not there for a step written in other notes, and the answer says where to look', async () => {
		for (const step of [3, 5, 7, 8, 9, 10]) {
			const reply = await golden.call('getStepText', { projectId: golden.project.id, step });
			expect(reply.status, String(step)).toBe(404);
			expect(faults(reply), String(step)).toEqual([]);
			expect(String(bodyOf(reply.body)['detail']), String(step)).toContain('not written in a note of its own');
		}
	});

	it('says the note is damaged where a section’s markers are gone, and reads that section as empty', async () => {
		const broken = await createGolden();
		const stepOne = broken.project.artifacts[1];
		if (stepOne === undefined) throw new Error('The project has the note of step 1.');
		const vault = broken.host.environment.fakeVault;
		const whole = vault.contents.get(stepOne.path) ?? '';
		const section = renderMarkedSection('genre', 'Winter mystery');
		expect(whole).toContain(section);
		vault.write(stepOne.path, whole.replace(section, 'Winter mystery'));
		const reply = await broken.call('getStepText', { projectId: broken.project.id, step: 1 });
		expect(reply.status).toBe(200);
		expect(faults(reply)).toEqual([]);
		expect(bodyOf(reply.body)['damaged']).toBe(true);
		expect(bodyOf(bodyOf(reply.body)['sections'])['genre']).toBe('');
		expect(bodyOf(bodyOf(reply.body)['sections'])['one-sentence-summary']).toBe(STEP_ONE_TEXT['one-sentence-summary']);
	});

	it('is not found where the step’s note is gone, and the answer says what puts it back', async () => {
		const missing = await createGolden();
		const stepFour = missing.project.artifacts[4];
		if (stepFour === undefined) throw new Error('The project has the note of step 4.');
		await missing.host.projects.repository.trashFile(stepFour.path);
		const reply = await missing.call('getStepText', { projectId: missing.project.id, step: 4 });
		expect(reply.status).toBe(404);
		expect(String(bodyOf(reply.body)['detail'])).toContain('repairProject');
	});

	it('is read without a word being written', async () => {
		const before = vaultState(golden.host);
		await golden.call('listSteps', { projectId: golden.project.id });
		await golden.call('getStep', { projectId: golden.project.id, step: 2 });
		await golden.call('getStepText', { projectId: golden.project.id, step: 2 });
		expect(vaultState(golden.host)).toEqual(before);
	});
});
