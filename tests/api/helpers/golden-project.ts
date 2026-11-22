import type { DispatchReply } from '../../../api/dispatch';
import type { LocalApi } from '../../../api/index';
import type { ProjectRef, ProjectSnapshot } from '../../../src/services';
import { createFakeHost, type FakeHost } from './fake-host';
import { createTestApi } from './fake-listener';
import { problemFaults, shapeFaults } from './shapes';

/**
 * A small vault for the API to be asked about: one project with something
 * of everything in it, a second in another language, and a third in the
 * archive. Everything in it is made through the plugin's own services, so
 * what the API reads back is what the plugin itself would have written.
 */
export interface Golden {
	host: FakeHost;
	api: LocalApi;
	/** The project most tests ask about: English, the first book of a series, the author's current one. */
	project: ProjectSnapshot;
	/** A second project, in Simplified Chinese. */
	chinese: ProjectSnapshot;
	/** A third, standing in the archive. */
	archived: ProjectRef;
	/** One call through the dispatcher, as a caller with the token. */
	call(
		operationId: string,
		params?: Record<string, unknown>,
		extra?: { body?: unknown; ifMatch?: string | null },
	): Promise<DispatchReply>;
	/** The project again as it stands now. */
	reload(): Promise<ProjectSnapshot>;
}

export const STEP_ONE_TEXT = {
	genre: 'Winter mystery',
	'one-sentence-summary': 'A clockmaker finds the town’s stopped clock is counting down to a death.',
	'candidate-title-1': 'North Wind',
};

export async function createGolden(start: Partial<FakeHost['state']> = {}): Promise<Golden> {
	const host = createFakeHost(start);
	const service = host.projects;
	const { api } = createTestApi(host);

	const created = await service.createProject({ title: 'North Wind', locale: 'en', series: { name: 'Four Winds', book: 1 } });
	const stepOne = created.artifacts[1];
	if (stepOne === undefined) throw new Error('A new project has the note of step 1.');
	await service.updateSections(stepOne.path, STEP_ONE_TEXT, stepOne.revision);
	await service.updateStepStatus(created, 1, 'complete');
	await service.updateStepStatus(created, 2, 'in-progress');

	const chinese = await service.createProject({ title: '北境之雪', locale: 'zh-CN' });
	const old = await service.createProject({ title: 'Old Draft', locale: 'en' });
	const archived = await service.archiveProject(old);

	const project = await service.loadProject(created.projectFile);
	host.state.current = project.projectFile;
	return {
		host,
		api,
		project,
		chinese,
		archived,
		call: (operationId, params = {}, extra = {}) =>
			api.dispatcher.dispatch({
				operationId,
				params,
				body: extra.body,
				ifMatch: extra.ifMatch ?? null,
				authenticated: true,
			}),
		reload: () => service.loadProject(project.projectFile),
	};
}

/**
 * Where an answer falls short of what the contract promises for its
 * operation and status. Empty when it is exactly the described shape.
 */
export function faults(reply: DispatchReply): string[] {
	return reply.failed ? problemFaults(reply.body) : shapeFaults(reply.operationId, reply.status, reply.body);
}

/** Every file of the vault with its text, to tell whether anything was written. */
export function vaultState(host: FakeHost): Record<string, string> {
	return Object.fromEntries([...host.environment.fakeVault.contents.entries()].sort(([left], [right]) => (left < right ? -1 : 1)));
}
