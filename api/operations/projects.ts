import type { ProjectRef } from '../../src/services';
import { healthOf, projectOf, projectSummary } from '../dto/project';
import { pageOf } from '../paging';
import { textParam, type OperationGroup } from './context';

/**
 * Projects, read. A project is found by its id among the projects there
 * are, and read whole through the plugin's own reading of it, which is kept
 * until one of its notes changes.
 */
export const projectOperations: OperationGroup = {
	listProjects: async (call, context) => {
		const state = textParam(call, 'state');
		const roster = await context.host.roster();
		const currentPath = context.host.currentProjectPath();
		const rows: { ref: ProjectRef; archived: boolean }[] = [];
		if (state !== 'archived') for (const ref of roster.active) rows.push({ ref, archived: false });
		if (state !== 'active') for (const ref of roster.archived) rows.push({ ref, archived: true });
		return {
			status: 200,
			body: pageOf(rows, call, (row) => projectSummary(row.ref, { archived: row.archived, currentPath })),
		};
	},

	getProject: async (call, context) => {
		const { project, archived } = await context.loadProject(textParam(call, 'projectId'));
		return {
			status: 200,
			body: projectOf(project, { archived, currentPath: context.host.currentProjectPath() }),
		};
	},

	getProjectHealth: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const outdated = await context.host.projects.countOutdatedNotes(project);
		return { status: 200, body: healthOf(project, outdated) };
	},
};
