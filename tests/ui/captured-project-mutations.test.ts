import { TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeEnvironment } from '../helpers/fake-vault';

const openedForms = vi.hoisted(() => [] as unknown[]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Modal: class extends runtime.Modal {
			modalEl = { addClass: (): void => undefined };
			setTitle(): void {}
			override open(): void { openedForms.push(this); }
		},
		Plugin: class {},
		ItemView: class {},
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
	};
});

import SnowflakeMethodPlugin from '../../src/main';
import { ManagedFileNotFoundError } from '../../src/repository';
import { SnowflakeProjectService } from '../../src/services';
import { SnowflakeDashboardView } from '../../src/ui/dashboard-view';
import type { CreateCharacterRequest, CreateSceneRequest, EntityFormRequest } from '../../src/ui/modals';
import type { ProjectDashboardModel } from '../../src/ui/view-model';

const sceneRequest = (title: string, fields: Partial<CreateSceneRequest> = {}): CreateSceneRequest => ({
	title, aliases: [], categoryPaths: [], progressStatus: 'not-started', times: [], locations: [],
	characterPaths: [], conflict: '', worldStatus: [], relationships: [], povPath: '', events: '',
	customFields: '', color: null, linkedManuscript: [], ...fields,
});

const characterRequest = (fields: Partial<CreateCharacterRequest> = {}): CreateCharacterRequest => ({
	name: 'Hero', aliases: [], categoryPaths: [], progressStatus: 'not-started',
	oneSentenceStoryline: '', oneParagraphStoryline: '', motivation: '', goal: '', conflict: '', growth: '',
	worldStatus: [], relationships: [], customFields: '', ...fields,
});

const entityRequest = (name: string): EntityFormRequest => ({
	kind: 'location', name, aliases: [], categoryPaths: [], progressStatus: 'not-started',
	description: '', timeKind: null, timeStart: '', timeEnd: '',
	worldStatus: [], relationships: [], customFields: '',
});

beforeEach(() => { openedForms.length = 0; });

async function setup() {
	const env = createFakeEnvironment();
	const service = new SnowflakeProjectService(env.vault, env.fileManager, env.metadataCache);
	const owner = await service.createProject({ title: 'Owner', locale: 'en' });
	const active = await service.createProject({ title: 'Active', locale: 'zh-CN' });
	const activeScene = await service.createScene(active, { title: 'Keep this scene', conflict: 'Unchanged' });
	const plugin = Object.create(SnowflakeMethodPlugin.prototype) as SnowflakeMethodPlugin;
	const requireCurrentProject = vi.fn(() => { throw new Error('Captured action used the current project'); });
	const saveSettings = vi.fn(async () => undefined);
	// Obsidian's unreferenced-member confirmation also performs the deletion.
	// Only that UI boundary is replaced; the host still resolves, checks the
	// revision, inspects usage, and chooses the actual file itself.
	const promptForDeletion = vi.fn(async (file: TFile) => {
		await env.fakeFileManager.trashFile(file);
		return true;
	});
	Object.assign(env.fakeFileManager, { promptForDeletion });
	Object.assign(plugin, {
		app: { vault: env.vault, fileManager: env.fileManager, metadataCache: env.metadataCache },
		projects: service,
		settings: { recentProjectPath: active.projectFile, recentStep: 9 },
		currentProjectLocale: active.locale,
		t: (key: string) => key,
		requireCurrentProject, saveSettings,
	});
	const activeContents = () => [...env.fakeVault.contents].filter(([path]) => path.startsWith(`${active.rootPath}/`));
	const assertOwnership = (before: ReturnType<typeof activeContents>) => {
		expect(requireCurrentProject).not.toHaveBeenCalled();
		expect(saveSettings).not.toHaveBeenCalled();
		expect(plugin.settings.recentProjectPath).toBe(active.projectFile);
		expect(plugin.settings.recentStep).toBe(9);
		expect(plugin).toMatchObject({ currentProjectLocale: active.locale });
		expect(activeContents()).toEqual(before);
	};
	return { env, service, owner, active, activeScene, plugin, promptForDeletion, activeContents, assertOwnership };
}

describe('captured project mutation ownership', () => {
	it.each(['character', 'location'] as const)(
		'inserts a %s at the requested position in the form owner while another project stays selected',
		async (kind) => {
			const fixture = await setup();
			const { plugin, service, owner } = fixture;
			const create = async (name: string, projectPath: string): Promise<unknown> => kind === 'character'
				? plugin.createCharacter(characterRequest({ name }), projectPath)
				: plugin.createEntity(entityRequest(name), projectPath);
			await create('First', owner.projectFile);
			await create('Last', owner.projectFile);
			await create('Keep this member', fixture.active.projectFile);
			const before = fixture.activeContents();
			const model = {
				...await service.loadProject(owner), path: owner.projectFile,
			} as unknown as ProjectDashboardModel;
			const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
			const refresh = vi.fn(async () => undefined);
			Object.assign(view, {
				app: plugin.app, host: plugin, t: (key: string) => key,
				memberFormContext: async () => ({}), refresh,
				revealCharacter: vi.fn(), revealEntity: vi.fn(),
			});
			const insert = view as unknown as {
				insertCharacterAfter(model: ProjectDashboardModel, index: number): void;
				insertEntityAfter(model: ProjectDashboardModel, kind: 'location', index: number): void;
			};
			if (kind === 'character') insert.insertCharacterAfter(model, 0);
			else insert.insertEntityAfter(model, kind, 0);
			await vi.waitFor(() => expect(openedForms).toHaveLength(1));
			// Submit the real form's callback without drawing Obsidian's modal UI.
			const form = openedForms[0] as {
				submitHandler(request: CreateCharacterRequest | EntityFormRequest): Promise<void>;
			};
			await form.submitHandler(kind === 'character'
				? characterRequest({ name: 'Inserted' }) : entityRequest('Inserted'));
			const project = await service.loadProject(owner);
			const members = kind === 'character' ? project.characters : project.worldbuilding.location;
			expect(members?.map((member) => member.name)).toEqual(['First', 'Inserted', 'Last']);
			expect(refresh).toHaveBeenCalledOnce();
			fixture.assertOwnership(before);
		},
	);

	it('creates, updates and reorders scenes in the form owner while another project stays selected', async () => {
		const fixture = await setup();
		const before = fixture.activeContents();
		const { plugin, service, owner } = fixture;
		const created = await plugin.createScene(sceneRequest('Opening'), owner.projectFile);
		await plugin.createScene(sceneRequest('Later'), owner.projectFile);
		const initial = (await service.loadProject(owner)).scenes.find((scene) => scene.id === created.id)!;
		await plugin.updateScene(created.id, sceneRequest('Opening', {
			expectedRevision: initial.revision, conflict: 'The gate is locked.',
		}), owner.projectFile);
		const beforeMove = (await service.loadProject(owner)).scenes.find((scene) => scene.id === created.id)!;
		const onRankWritten = vi.fn();
		await plugin.reorderScene(created.id, 1, owner.projectFile, onRankWritten);
		const scenes = (await service.loadProject(owner)).scenes;
		expect(created.path.startsWith(`${owner.rootPath}/`)).toBe(true);
		expect(scenes.map((scene) => scene.title)).toEqual(['Later', 'Opening']);
		expect(scenes[1]?.conflict).toBe('The gate is locked.');
		expect(onRankWritten).toHaveBeenCalledExactlyOnceWith({
			id: created.id, before: beforeMove.revision, after: scenes[1]?.revision,
		});
		fixture.assertOwnership(before);
	});

	it('resolves and confirms deletion against the captured owner rather than the selected project', async () => {
		const fixture = await setup();
		const before = fixture.activeContents();
		const created = await fixture.service.createScene(fixture.owner, { title: 'Remove from owner' });
		const file = fixture.env.fakeVault.getFileByPath(created.path)!;
		// Structural fake-vault files need the platform class identity for the
		// host's instanceof guard; all their data and vault behavior stay real.
		Object.setPrototypeOf(file, TFile.prototype);
		await fixture.plugin.deleteScene(created.sceneId, created.revision, fixture.owner.projectFile);
		expect(fixture.promptForDeletion).toHaveBeenCalledExactlyOnceWith(file);
		expect(fixture.env.fakeVault.getFileByPath(created.path)).toBeNull();
		expect(fixture.env.fakeVault.getFileByPath(fixture.activeScene.path)).not.toBeNull();
		expect((await fixture.service.loadProject(fixture.owner)).scenes).toHaveLength(0);
		fixture.assertOwnership(before);
	});

	it('keeps nested character and worldbuilding creation and character edits inside the form owner', async () => {
		const fixture = await setup();
		const before = fixture.activeContents();
		const { plugin, service, owner } = fixture;
		const character = await plugin.createCharacter(characterRequest(), owner.projectFile);
		const loaded = (await service.loadProject(owner)).characters.find((entry) => entry.id === character.id)!;
		await plugin.updateCharacter(character.id, characterRequest({
			expectedRevision: loaded.revision, motivation: 'Protect the city.',
		}), owner.projectFile);
		const request: EntityFormRequest = {
			kind: 'location', name: 'Tavern', aliases: [], categoryPaths: [], progressStatus: 'not-started',
			description: 'A meeting place.', timeKind: null, timeStart: '', timeEnd: '',
			worldStatus: [], relationships: [], customFields: '',
		};
		const entity = await plugin.createEntity(request, owner.projectFile);
		const project = await service.loadProject(owner);
		expect(character.path.startsWith(`${owner.rootPath}/`)).toBe(true);
		expect(entity.path.startsWith(`${owner.rootPath}/`)).toBe(true);
		expect(project.characters[0]?.motivation).toBe('Protect the city.');
		expect(project.worldbuilding.location?.map((entry) => entry.name)).toEqual(['Tavern']);
		fixture.assertOwnership(before);
	});

	it('reads and writes nested definitions and template selections using the captured project', async () => {
		const fixture = await setup();
		const { plugin, service, owner, active } = fixture;
		const foreignTemplate = await service.saveCustomFieldTemplate(active, 'scene', {
			name: 'Scene plan', description: '', fields: [{ title: 'Foreign field', content: '' }],
		});
		if (!foreignTemplate.ok) throw new Error('Could not seed the selected project template');
		await service.setKindTemplate(active, 'scene', foreignTemplate.path);
		const before = fixture.activeContents();
		expect(await plugin.addDefinitionPath('scene', 'category', 'Owner arc/Opening', '', owner.projectFile))
			.toEqual({ ok: true });
		expect(await plugin.listDefinitionPaths('scene', 'category', owner.projectFile)).toContain('Owner arc/Opening');
		expect(await service.listDefinitionPaths(active, 'scene', 'category')).not.toContain('Owner arc/Opening');
		for (const path of Object.values(await plugin.definitionFilePaths('scene', owner.projectFile))) {
			expect(path.startsWith(`${owner.rootPath}/`)).toBe(true);
		}
		const fields = [{ title: 'Owner field', content: 'The obstacle.' }];
		const saved = await plugin.saveCustomFieldTemplate('scene', {
			name: 'Scene plan', description: '', fields,
		}, { overwrite: true }, owner.projectFile);
		if (!saved.ok) throw new Error('Could not save the owned template');
		expect(saved.path.startsWith(`${owner.rootPath}/`)).toBe(true);
		await plugin.setKindTemplate('scene', saved.path, owner.projectFile);
		expect(await plugin.kindTemplatePath('scene', owner.projectFile)).toBe(saved.path.replace(/\.md$/u, ''));
		expect(await plugin.kindTemplateFields('scene', owner.projectFile)).toEqual(fields);
		fixture.assertOwnership(before);
	});

	it('rejects a missing captured project without falling back to the selected project', async () => {
		const fixture = await setup();
		const before = fixture.activeContents();
		await expect(fixture.plugin.createScene(sceneRequest('Should not be created'), 'Missing/Project.md'))
			.rejects.toBeInstanceOf(ManagedFileNotFoundError);
		fixture.assertOwnership(before);
	});
});
