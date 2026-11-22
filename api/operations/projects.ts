import type { ProjectLanguage } from '../../src/domain';
import type { ProjectRef, ProjectSeries } from '../../src/services';
import { healthOf, projectOf, projectSummary } from '../dto/project';
import { ApiError } from '../errors';
import { pageOf } from '../paging';
import { bodyOf, textParam, type ApiContext, type OperationGroup } from './context';

/** A series as a caller sends it: its name with the spaces at its ends taken off, or none. */
function seriesOf(sent: unknown): ProjectSeries | null {
	if (typeof sent !== 'object' || sent === null) return null;
	const { name, book } = sent as { name: string; book: number | null };
	return { name: name.trim(), book };
}

/** A project as it stands now, told in full. */
async function told(context: ApiContext, projectId: string): Promise<ReturnType<typeof projectOf>> {
	const { project, archived } = await context.loadProject(projectId);
	return projectOf(project, { archived, currentPath: context.host.currentProjectPath() });
}

/**
 * Projects, read and changed. A project is found by its id among the
 * projects there are, and read whole through the plugin's own reading of
 * it, which is kept until one of its notes changes. What changes a
 * project's place among the others goes through the plugin's own project
 * manager, so its screens are told as they are when the author does it.
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

	getProject: async (call, context) => ({ status: 200, body: await told(context, textParam(call, 'projectId')) }),

	getProjectHealth: async (call, context) => {
		const { project } = await context.loadProject(textParam(call, 'projectId'));
		const outdated = await context.host.projects.countOutdatedNotes(project);
		return { status: 200, body: healthOf(project, outdated) };
	},

	createProject: async (call, context) => {
		const body = bodyOf(call);
		const project = await context.host.createProject({
			title: String(body['title']).trim(),
			locale: body['language'] as ProjectLanguage,
			series: seriesOf(body['series']),
		});
		return {
			status: 201,
			body: projectOf(project, { archived: false, currentPath: context.host.currentProjectPath() }),
			location: `/projects/${encodeURIComponent(project.id)}`,
		};
	},

	updateProject: async (call, context) => {
		const projectId = textParam(call, 'projectId');
		const body = bodyOf(call);
		let project = await context.writableProject(projectId);
		const title = typeof body['title'] === 'string' ? body['title'].trim() : null;
		// The folder moves with the title, so the series is written into the note where it then stands.
		if (title !== null && title !== project.title) project = await context.host.renameProject(project, title);
		if ('series' in body) await context.host.setProjectSeries(project, seriesOf(body['series']));
		return { status: 200, body: await told(context, projectId) };
	},

	archiveProject: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const archived = await context.host.archiveProject(project);
		return { status: 200, body: projectSummary(archived, { archived: true, currentPath: context.host.currentProjectPath() }) };
	},

	restoreProject: async (call, context) => {
		const found = await context.findProject(textParam(call, 'projectId'));
		if (!found.archived) {
			throw new ApiError('not-archived', 'The project does not stand in the archive, so there is nothing to restore.');
		}
		const restored = await context.host.restoreProject(found.ref);
		return {
			status: 200,
			body: {
				project: projectOf(restored.project, { archived: false, currentPath: context.host.currentProjectPath() }),
				renamedFrom: restored.renamedFrom,
			},
		};
	},

	repairProject: async (call, context) => {
		const project = await context.writableProject(textParam(call, 'projectId'));
		const result = await context.host.projects.repairProject(project.projectFile);
		const conflicts = new Set(result.conflicts.map((conflict) => conflict.path));
		for (const section of result.sectionResults) if (section.status === 'conflict') conflicts.add(section.path);
		return {
			status: 200,
			body: {
				created: [...result.created],
				repaired: [...result.repaired],
				unchanged: [...result.unchanged],
				conflicts: [...conflicts],
				health: healthOf(result.project, await context.host.projects.countOutdatedNotes(result.project)),
			},
		};
	},
};
