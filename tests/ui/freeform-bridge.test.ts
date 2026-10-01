import { describe, expect, it, vi } from 'vitest';

import { createFakeEnvironment } from '../helpers/fake-vault';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { SnowflakeProjectService, type ProjectSnapshot } from '../../src/services';
import { DocumentBell } from '../../src/ui/document-bell';
import { StickyNoteHub } from '../../src/ui/sticky-note-hub';

const bell = (): DocumentBell =>
	new DocumentBell({
		clock: () => ({ setTimeout: () => 0, clearTimeout: () => undefined }),
		delay: 0,
		failed: () => undefined,
		reconcile: () => undefined,
	});

async function setup() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const owner = await service.createProject({ title: 'Owner', locale: 'en' });
	const active = await service.createProject({ title: 'Active', locale: 'zh-CN' });
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const freeformBell = bell();
	const taskBell = bell();
	const stickyNoteHub = new StickyNoteHub({ load: () => null, save: () => undefined });
	Object.assign(plugin, {
		app: { vault: env.vault, fileManager: env.fileManager, metadataCache: env.metadataCache },
		projects: service,
		settings: { recentProjectPath: active.projectFile, recentStep: 9 },
		freeformBell,
		taskBell,
		stickyNoteHub,
	});
	const rung = vi.fn();
	freeformBell.subscribe(rung);
	const bridge = plugin.freeform({ projectPath: owner.projectFile });
	const files = (project: ProjectSnapshot): string[] =>
		[...env.fakeVault.contents.keys()].filter((path) => path.startsWith(`${service.freeform.folderPath(project)}/`));
	return { env, service, owner, active, plugin, bridge, rung, freeformBell, taskBell, stickyNoteHub, files };
}

const text = (id: string) => ({ id, resource: { type: 'text' as const, text: id }, x: 0, y: 0 });

describe('the freeform bridge', () => {
	it('reads and writes the project it was made for, whichever project is current', async () => {
		const { bridge, plugin, owner, active, files } = await setup();
		// A project with no view of its own reads as the fresh Main view, which no file holds yet.
		expect(await bridge.read()).toMatchObject({ projectPath: owner.projectFile, locale: 'en', held: { views: [{ id: 'freeform-view-main', name: 'Main', placements: [] }] } });
		const id = (await bridge.createView('Overview'))!;
		expect(id).toMatch(/^freeform-view-/u);
		expect(files(owner)).toHaveLength(1);
		expect(files(active)).toEqual([]);
		expect((await bridge.read())?.held.views.map((view) => view.name)).toEqual(['Overview']);
		// With no project named, the bridge follows the one that is current.
		expect((await plugin.freeform().read())?.projectPath).toBe(active.projectFile);
		expect((await bridge.read())?.limits.placements).toBeGreaterThan(0);
	});

	it('answers nothing while no project stands', async () => {
		const { plugin } = await setup();
		Object.assign(plugin, { settings: { recentProjectPath: null } });
		const bridge = plugin.freeform();
		expect(await bridge.read()).toBeNull();
		expect(await bridge.readResources({ types: new Set(['task']), filePaths: [] })).toBeNull();
		expect(await bridge.createView('Overview')).toBeNull();
		expect(await bridge.transact('freeform-view-1', [])).toEqual({ came: 'refused', inverse: [] });
	});

	it('rings its bell for a write that landed, and for nothing else', async () => {
		const { bridge, rung } = await setup();
		const id = (await bridge.createView('Overview'))!;
		expect(rung).toHaveBeenCalledTimes(1);
		const done = await bridge.transact(id, [{ do: 'add', placements: [text('p1')] }]);
		expect(done.came).toBe('written');
		expect(rung).toHaveBeenCalledTimes(2);
		// Found as asked, named nothing, and asked of a view that is not there.
		await bridge.transact(id, [{ do: 'place', places: [{ id: 'p1', x: 0, y: 0 }] }]);
		await bridge.transact(id, [{ do: 'text', id: 'gone', text: 'x' }]);
		await bridge.transact('freeform-view-gone', [{ do: 'add', placements: [text('p2')] }]);
		await bridge.renameView('freeform-view-gone', 'Nothing');
		expect(rung).toHaveBeenCalledTimes(2);
		expect(await bridge.renameView(id, 'Story')).toBe('written');
		expect(rung).toHaveBeenCalledTimes(3);
		expect(await bridge.leaveView(id, { viewport: { x: 4, y: 5, zoom: 2 } })).toBe('written');
		expect(await bridge.deleteView(id)).toBe(true);
		expect(await bridge.deleteView(id)).toBe(true);
		expect(rung).toHaveBeenCalledTimes(5);
	});

	it('hands where the leaf stands along with a change, and mints ids under their own prefixes', async () => {
		const { bridge } = await setup();
		const id = (await bridge.createView('Overview'))!;
		const placement = bridge.mintId('placement');
		expect(placement).toMatch(/^freeform-placement-/u);
		expect(bridge.mintId('frame')).toMatch(/^freeform-frame-/u);
		expect(bridge.mintId('edge')).toMatch(/^freeform-edge-/u);
		await bridge.transact(id, [{ do: 'add', placements: [text(placement)] }], { x: 7, y: 8, zoom: 0.5 });
		expect((await bridge.read())?.held.views[0]).toMatchObject({
			viewport: { x: 7, y: 8, zoom: 0.5 },
			placements: [{ id: placement }],
		});
	});

	it('refuses every write to a project that cannot be written, and still reads it', async () => {
		const { bridge, plugin, owner, rung, files } = await setup();
		const id = (await bridge.createView('Overview'))!;
		const before = files(owner).length;
		const resolve = (plugin as unknown as { resolveProject(path: string | null): Promise<ProjectSnapshot | null> })
			.resolveProject.bind(plugin);
		Object.assign(plugin, {
			resolveProject: async (path: string | null) => {
				const project = await resolve(path);
				return project === null ? null : { ...project, readOnly: true };
			},
		});
		rung.mockClear();
		expect(await bridge.createView('Another')).toBeNull();
		expect(await bridge.renameView(id, 'Story')).toBe('refused');
		expect(await bridge.leaveView(id, { viewport: { x: 1, y: 1, zoom: 1 } })).toBe('refused');
		expect(await bridge.deleteView(id)).toBe(false);
		expect(await bridge.transact(id, [{ do: 'add', placements: [text('p1')] }]))
			.toEqual({ came: 'refused', inverse: [] });
		expect(rung).not.toHaveBeenCalled();
		expect(files(owner)).toHaveLength(before);
		expect((await bridge.read())?.held.views.map((view) => view.name)).toEqual(['Overview']);
	});

	it('reads only the families asked for, and the files by the paths a view keeps', async () => {
		const { bridge, env, owner, service } = await setup();
		await env.fakeVault.seedFile(`${owner.rootPath}/80_Material/map.png`, 'png');
		const lists = {
			tasks: vi.spyOn(service.tasks, 'list'),
			notes: vi.spyOn(service.stickyNotes, 'list'),
			revisions: vi.spyOn(service.revisions, 'list'),
			threads: vi.spyOn(service.foreshadowing, 'list'),
		};
		const none = await bridge.readResources({ types: new Set(), filePaths: [] });
		expect(none).toMatchObject({
			projectPath: owner.projectFile, tasks: null, foreshadowing: null, revisions: null, stickyNotes: null, files: null,
		});
		expect(none?.failed.size).toBe(0);
		for (const list of Object.values(lists)) expect(list).not.toHaveBeenCalled();
		const some = await bridge.readResources({
			types: new Set(['task', 'file']),
			filePaths: ['80_Material/map.png', '80_Material/gone.md'],
		});
		expect(some?.tasks).toEqual([]);
		expect(some?.stickyNotes).toBeNull();
		expect([...(some?.files ?? new Map()).entries()]).toEqual([['80_Material/map.png', {
			path: `${owner.rootPath}/80_Material/map.png`,
			relativePath: '80_Material/map.png',
			name: 'map',
			extension: 'png',
			kind: 'image',
			stamp: expect.stringMatching(/^\d+:3$/u) as unknown,
		}]]);
		expect(lists.notes).not.toHaveBeenCalled();
		const all = await bridge.readResources({
			types: new Set(['task', 'foreshadowing', 'revision', 'sticky-note']),
			filePaths: [],
		});
		expect(all).toMatchObject({ tasks: [], foreshadowing: [], revisions: [], stickyNotes: [], files: null });
	});

	it('lets a family that cannot be read cost its own cards and nothing else', async () => {
		const { bridge, service } = await setup();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			vi.spyOn(service.tasks, 'list').mockRejectedValue(new Error('unreadable'));
			const read = await bridge.readResources({ types: new Set(['task', 'sticky-note']), filePaths: [] });
			expect(read?.tasks).toBeNull();
			expect(read?.stickyNotes).toEqual([]);
			expect([...(read?.failed ?? [])]).toEqual(['task']);
			expect(logged).toHaveBeenCalledOnce();
		} finally {
			logged.mockRestore();
		}
	});

	it('hears the tasks and the sticky notes for the resources, until it is told to stop', async () => {
		const { bridge, taskBell, stickyNoteHub, freeformBell } = await setup();
		const heard = vi.fn();
		const stop = bridge.subscribeResources(heard);
		taskBell.ring();
		stickyNoteHub.notify();
		expect(heard).toHaveBeenCalledTimes(2);
		// A view's own file is the other subscription's to tell of.
		freeformBell.ring();
		expect(heard).toHaveBeenCalledTimes(2);
		stop();
		taskBell.ring();
		stickyNoteHub.notify();
		expect(heard).toHaveBeenCalledTimes(2);
	});
});
