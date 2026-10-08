import { describe, expect, it, vi } from 'vitest';

import { createFakeEnvironment } from '../helpers/fake-vault';

const notices = vi.hoisted(() => vi.fn());

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

vi.mock('../../src/ui/modals', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/modals')>();
	return { ...actual, confirmExportReplace: vi.fn(() => Promise.resolve(true)) };
});

import { MAIN_TIMELINE_VIEW_ID } from '../../src/domain';
import SnowflakeMethodPlugin from '../../src/main';
import { SnowflakeProjectService, type ProjectSnapshot } from '../../src/services';
import { DocumentBell } from '../../src/ui/document-bell';
import { confirmExportReplace } from '../../src/ui/modals';
import { StickyNoteHub } from '../../src/ui/sticky-note-hub';

const bell = (): DocumentBell =>
	new DocumentBell({
		clock: () => ({ setTimeout: () => 0, clearTimeout: () => undefined }),
		delay: 0,
		failed: () => undefined,
		reconcile: () => undefined,
	});

async function setup() {
	notices.mockClear();
	vi.mocked(confirmExportReplace).mockClear();
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const owner = await service.createProject({ title: 'Owner', locale: 'en' });
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const openManagedFile = vi.fn(() => Promise.resolve());
	Object.assign(plugin, {
		app: { vault: env.vault, fileManager: env.fileManager, metadataCache: env.metadataCache },
		projects: service,
		settings: { recentProjectPath: owner.projectFile, recentStep: 9 },
		freeformBell: bell(),
		timelineBell: bell(),
		beatSheetBell: bell(),
		taskBell: bell(),
		stickyNoteHub: new StickyNoteHub({ load: () => null, save: () => undefined }),
		translateForProject: (_locale: string, key: string, vars?: Record<string, string | number>) =>
			`${key}${vars === undefined ? '' : JSON.stringify(vars)}`,
		openManagedFile,
	});
	const folder = (key: 'freeform' | 'timeline' | 'beatSheet'): string =>
		`${owner.rootPath}/70_Tool/73_Visualization/${{ freeform: '732_Freeform', timeline: '733_Timeline', beatSheet: '734_Beat_Sheet' }[key]}`;
	return { env, service, owner, plugin, openManagedFile, folder };
}

describe('exporting a workspace view as a canvas through its bridge', () => {
	it('writes the view beside the workspace file, says where, and opens it', async () => {
		const { env, plugin, owner, openManagedFile, folder } = await setup();
		const bridge = plugin.freeform({ projectPath: owner.projectFile });
		const id = (await bridge.createView('Overview'))!;
		await bridge.exportCanvas(id);
		const path = `${folder('freeform')}/Overview.canvas`;
		expect(env.fakeVault.contents.get(path)).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
		expect(openManagedFile).toHaveBeenCalledExactlyOnceWith(path);
		expect(notices).toHaveBeenCalledExactlyOnceWith(`messages.exported${JSON.stringify({ path })}`);
		expect(confirmExportReplace).not.toHaveBeenCalled();
	});

	it('says a canvas that says the same already is up to date, writes nothing again, and opens it all the same', async () => {
		const { env, plugin, owner, openManagedFile, folder } = await setup();
		const bridge = plugin.timeline({ projectPath: owner.projectFile });
		await bridge.exportCanvas(MAIN_TIMELINE_VIEW_ID);
		const path = `${folder('timeline')}/Main.canvas`;
		const stamp = env.fakeVault.getFileByPath(path)!.stat.mtime;
		await bridge.exportCanvas(MAIN_TIMELINE_VIEW_ID);
		expect(notices).toHaveBeenLastCalledWith(`messages.canvasUpToDate${JSON.stringify({ path })}`);
		expect(confirmExportReplace).not.toHaveBeenCalled();
		expect(openManagedFile).toHaveBeenCalledTimes(2);
		expect(openManagedFile).toHaveBeenLastCalledWith(path);
		expect(env.fakeVault.getFileByPath(path)!.stat.mtime).toBe(stamp);
	});

	it('asks before writing over a canvas that says something else, and writes nothing on a refusal', async () => {
		const { env, service, plugin, owner, folder } = await setup();
		const sheetId = (await service.beatSheet.createSheet(owner, {
			name: 'Three acts',
			source: { structure: { acts: [{ label: 'Setup', beats: [{ name: 'Opening', description: '' }] }] } },
		}))!;
		const bridge = plugin.beatSheet({ projectPath: owner.projectFile });
		const path = `${folder('beatSheet')}/Three acts.canvas`;
		const theirs = '{"nodes":[{"id":"x","type":"text","text":"Mine","x":0,"y":0,"width":10,"height":10}],"edges":[]}';
		await env.fakeVault.seedFile(path, theirs);
		vi.mocked(confirmExportReplace).mockResolvedValueOnce(false);
		await bridge.exportCanvas(sheetId);
		expect(confirmExportReplace).toHaveBeenCalledTimes(1);
		expect(vi.mocked(confirmExportReplace).mock.calls[0]![2]).toEqual([path]);
		expect(env.fakeVault.contents.get(path)).toBe(theirs);
		expect(notices).not.toHaveBeenCalled();
		await bridge.exportCanvas(sheetId);
		const written = JSON.parse(env.fakeVault.contents.get(path) ?? '{}') as { nodes: { label?: string }[] };
		expect(written.nodes[0]?.label).toBe(`beatSheet.act.titleLabelled${JSON.stringify({ number: 1, label: 'Setup' })}`);
		expect(notices).toHaveBeenLastCalledWith(`messages.exported${JSON.stringify({ path })}`);
	});

	it('finds nothing to export for a view that has gone, and refuses a project that cannot be written', async () => {
		const { env, plugin, owner, folder } = await setup();
		const bridge = plugin.freeform({ projectPath: owner.projectFile });
		await bridge.exportCanvas('freeform-view-nobody');
		expect(notices).toHaveBeenLastCalledWith('messages.exportNothing');
		const resolve = (plugin as unknown as { resolveProject(path: string | null): Promise<ProjectSnapshot | null> })
			.resolveProject.bind(plugin);
		Object.assign(plugin, {
			resolveProject: async (path: string | null) => {
				const project = await resolve(path);
				return project === null ? null : { ...project, readOnly: true };
			},
		});
		await bridge.exportCanvas('freeform-view-main');
		expect(notices).toHaveBeenLastCalledWith('errors.readOnly');
		expect(env.fakeVault.getFileByPath(`${folder('freeform')}/Main.canvas`)).toBeNull();
	});
});
