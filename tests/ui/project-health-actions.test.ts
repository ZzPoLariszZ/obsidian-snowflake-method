import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return { ...runtime, Plugin: class {}, ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {}, SuggestModal: class extends runtime.Modal {} };
});

import SnowflakeMethodPlugin from '../../src/main';
import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { ProjectSnapshot } from '../../src/services';
import type { ProjectDashboardModel } from '../../src/ui/view-model';

describe('project health indicator matches blocking member damage', () => {
	it.each(['character', 'scene', 'location'] as const)('ignores informational records but includes %s marker damage', (kind) => {
		const project = { artifacts: {}, characters: [], scenes: [], worldbuildingKinds: [{ id: 'location' }], worldbuilding: { location: [] } };
		const issues = [{ code: 'unrecognized-record' }];
		const member = { sectionHealth: { issues } };
		const snapshot = {
			...project,
			...(kind === 'character' ? { characters: [member] }
				: kind === 'scene' ? { scenes: [member] } : { worldbuilding: { location: [member] } }),
		} as unknown as ProjectSnapshot;
		const plugin = Object.create(SnowflakeMethodPlugin.prototype) as {
			projectHasMarkerIssues(project: ProjectSnapshot): boolean;
		};
		expect(plugin.projectHasMarkerIssues(snapshot)).toBe(false);
		issues.push({ code: 'missing-start' });
		expect(plugin.projectHasMarkerIssues(snapshot)).toBe(true);
	});
});

describe.each(['character', 'scene', 'location'] as const)('health-report editor eligibility: %s', (kind) => {
	it.each(['blocking', 'member-readonly', 'project-readonly', 'repairable-advisory'] as const)(
		'handles %s consistently in the report and the editor entry point', async (state) => {
			const issue = {
				path: 'Novel/Member.md', sectionId: 'member-fields', sectionLabel: 'Fields',
				kind: 'section', code: 'missing-start', blocking: state === 'blocking', repairable: true,
				canOpen: true, action: 'repair', message: 'Repair this member', names: [], repairField: null,
			};
			const member = { id: 'member', kind, path: issue.path, readOnly: state === 'member-readonly', healthIssues: [issue] };
			const model = { path: 'Novel/Project.md', locale: 'en', readOnly: state === 'project-readonly',
				structureIssues: [], steps: [], characters: kind === 'character' ? [member] : [],
				scenes: kind === 'scene' ? [member] : [], worldbuildingKinds: [{ id: 'location' }],
				worldbuilding: { location: kind === 'location' ? [member] : [] },
			} as unknown as ProjectDashboardModel;
			const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
			Object.assign(plugin, { settings: { recentProjectPath: model.path },
				loadDashboardModel: async () => model,
				translateForProject: (_locale: string, key: string) => key,
				t: (key: string) => key,
			});
			const report = await plugin.checkCurrentProject();
			const editable = state === 'repairable-advisory';
			expect(report.entries).toHaveLength(1);
			expect(report.entries[0]).toMatchObject({ memberId: member.id, canEdit: editable });
			const editor = vi.fn(async () => null);
			const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
			Object.assign(view, { renderedModel: model,
				openCharacterEditor: editor, openSceneEditor: editor, openEntityEditor: editor,
			});
			await view.editMemberById(member.id);
			expect(editor).toHaveBeenCalledTimes(editable ? 1 : 0);
		},
	);
});
