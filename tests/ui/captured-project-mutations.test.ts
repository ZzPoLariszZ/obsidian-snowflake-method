import { TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeEnvironment } from '../helpers/fake-vault';

const openedForms = vi.hoisted(() => [] as unknown[]);

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		Modal: class extends runtime.Modal {
			modalEl = { addClass: (): void => undefined, dataset: {} as DOMStringMap };
			contentEl = { empty: (): void => undefined };
			setTitle(): void {}
			override open(): void { openedForms.push(this); }
			override close(): void { (this as unknown as { onClose(): void }).onClose(); }
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
import type { DefinitionNodeInfo } from '../../src/services';
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

	it('keeps entity updates and character/entity deletions in the captured project', async () => {
		const fixture = await setup();
		const { plugin, service, owner, env } = fixture;
		const before = fixture.activeContents();
		const entity = await plugin.createEntity(entityRequest('Tavern'), owner.projectFile);
		const character = await plugin.createCharacter(characterRequest(), owner.projectFile);
		const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		Object.assign(view, { app: plugin.app, host: plugin, t: (key: string) => key,
			memberFormContext: async () => ({}), refresh: async () => undefined });
		const record = (await service.loadProject(owner)).worldbuilding.location![0]!;
		const model = { ...await service.loadProject(owner), path: owner.projectFile } as unknown as ProjectDashboardModel;
		await (view as unknown as { openEntityEditor(model: ProjectDashboardModel, entity: unknown): Promise<unknown> })
			.openEntityEditor(model, { ...record, id: record.entityId });
		await (openedForms[0] as { submitHandler(request: EntityFormRequest): Promise<void> }).submitHandler({
			...entityRequest('Tavern'), description: 'Owner description', expectedRevision: record.revision,
		});
		const updated = (await service.loadProject(owner)).worldbuilding.location![0]!;
		expect(updated.description).toBe('Owner description');
		Object.setPrototypeOf(env.fakeVault.getFileByPath(entity.path), TFile.prototype);
		await plugin.deleteEntity(entity.id, updated.revision, owner.projectFile);
		const loadedCharacter = (await service.loadProject(owner)).characters[0]!;
		Object.setPrototypeOf(env.fakeVault.getFileByPath(character.path), TFile.prototype);
		await plugin.deleteCharacter(character.id, loadedCharacter.revision, owner.projectFile);
		expect((await service.loadProject(owner)).worldbuilding.location).toHaveLength(0);
		expect((await service.loadProject(owner)).characters).toHaveLength(0);
		fixture.assertOwnership(before);
	});

	it.each(['add', 'edit', 'create-template', 'edit-template'] as const)(
		'keeps %s prompt results in their owner while another project is selected', async (action) => {
			const fixture = await setup();
			const { plugin, service, owner } = fixture;
			const before = fixture.activeContents();
			const template = await service.saveCustomFieldTemplate(owner, 'character', {
				name: 'Original', description: '', fields: [{ title: 'Owner field', content: 'Keep me' }],
			});
			if (!template.ok) throw new Error('Failed to seed owner template');
			const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
			Object.assign(view, { app: plugin.app, host: plugin, t: (key: string) => key,
				definitionCollapse: new Set(), definitionSelection: new Map(),
				definitionKindLabel: () => 'Character', refresh: async () => undefined });
			const controls = view as unknown as {
				addDefinitionEntry(id: 'category', kind: 'character', prefill: string, path: string): Promise<void>;
				openDefinitionEditor(id: 'category', kind: 'character', node: DefinitionNodeInfo, path: string): Promise<void>;
				openCreateTemplate(model: ProjectDashboardModel, kind: 'character'): Promise<void>;
				openEditTemplate(model: ProjectDashboardModel, kind: 'character', template: unknown): Promise<void>;
			};
			const model = { path: owner.projectFile, customFieldTemplates: {} } as ProjectDashboardModel;
			const node = (await service.listDefinitionForest(owner, 'category')).character!.nodes.find((entry) => entry.taxonomyPath === 'Major')!;
			const opening = action === 'add' ? controls.addDefinitionEntry('category', 'character', '', owner.projectFile)
				: action === 'edit' ? controls.openDefinitionEditor('category', 'character', node, owner.projectFile)
					: action === 'create-template' ? controls.openCreateTemplate(model, 'character')
						: controls.openEditTemplate(model, 'character', { name: 'Original', description: '', path: template.path });
			await vi.waitFor(() => expect(openedForms).toHaveLength(1));
			const modal = openedForms[0] as { close(): void };
			if (action === 'add' || action === 'edit') {
				Object.assign(modal, { decided: true, pathEl: { value: 'Leads' }, nameEl: { value: 'Leads' }, descriptionEl: { value: 'Owner description' } });
			} else {
				Object.assign(modal, { answered: { name: 'Leads', description: 'Owner description', fields: [{ title: 'Owner field', content: 'Keep me' }] } });
			}
			modal.close();
			await opening;
			if (action === 'add' || action === 'edit') {
				const tree = await service.listDefinitionForest(owner, 'category');
				expect(tree.character!.nodes.find((entry) => entry.taxonomyPath === 'Leads')?.description).toBe('Owner description');
			} else {
				expect(await plugin.customFieldTemplateFields('character', 'Leads', owner.projectFile)).toEqual([{ title: 'Owner field', content: 'Keep me' }]);
			}
			fixture.assertOwnership(before);
		},
	);

	it('scopes definition and template confirmation deletes to the originating dashboard', async () => {
		const fixture = await setup();
		const { owner, plugin, service } = fixture;
		const before = fixture.activeContents();
		const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		const refresh = vi.fn(async () => undefined);
		Object.assign(view, { app: plugin.app, host: plugin, t: (key: string) => key,
			definitionSelection: new Map(), refresh });
		const tree = await service.listDefinitionForest(owner, 'category');
		const node = tree.character!.nodes.find((entry) => entry.taxonomyPath === 'Major')!;
		const controls = view as unknown as {
			confirmDefinitionDeletion(model: ProjectDashboardModel, id: 'category', kind: 'character', node: DefinitionNodeInfo): void;
			confirmTemplateDeletion(kind: 'character', template: unknown, path: string): Promise<void>;
		};
		controls.confirmDefinitionDeletion({ path: owner.projectFile, definitions: { category: tree } } as ProjectDashboardModel, 'category', 'character', node);
		Object.assign(openedForms[0]!, { confirmed: true });
		(openedForms[0] as { close(): void }).close();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
		expect(await service.listDefinitionPaths(owner, 'character', 'category')).not.toContain('Major');
		const template = await service.saveCustomFieldTemplate(owner, 'character', { name: 'Original', description: '', fields: [] });
		if (!template.ok) throw new Error('Failed to seed owner template');
		const deleting = controls.confirmTemplateDeletion('character', { path: template.path, name: 'Original', description: '' }, owner.projectFile);
		Object.assign(openedForms[1]!, { confirmed: true });
		(openedForms[1] as { close(): void }).close();
		await deleting;
		expect(fixture.env.fakeVault.getFileByPath(template.path)).toBeNull();
		fixture.assertOwnership(before);
	});
});

describe('create forms opened for another surface', () => {
	it('open on the owner and land the new note after the asked index', async () => {
		const fixture = await setup();
		const { plugin, service, owner } = fixture;
		await plugin.createCharacter(characterRequest({ name: 'First' }), owner.projectFile);
		await plugin.createCharacter(characterRequest({ name: 'Last' }), owner.projectFile);
		await plugin.createEntity(entityRequest('Harbour'), owner.projectFile);
		await plugin.createEntity(entityRequest('Market'), owner.projectFile);
		const before = fixture.activeContents();
		const modelOf = async (): Promise<ProjectDashboardModel> =>
			({ ...await service.loadProject(owner), path: owner.projectFile }) as unknown as ProjectDashboardModel;
		const view = Object.create(SnowflakeDashboardView.prototype) as SnowflakeDashboardView;
		Object.assign(view, {
			app: plugin.app, t: (key: string) => key, projectPath: owner.projectFile,
			host: Object.assign(Object.create(plugin) as object, { loadDashboardModel: modelOf }),
			memberFormContext: async () => ({}), refresh: vi.fn(async () => undefined), queueRefreshWhenShown: vi.fn(),
		});
		const saved = vi.fn();
		const characterOpening = view.openCreateCharacterForm(0, saved);
		await vi.waitFor(() => expect(openedForms).toHaveLength(1));
		const characterForm = openedForms[0] as { submitHandler(request: CreateCharacterRequest): Promise<void>; close(): void };
		await characterForm.submitHandler(characterRequest({ name: 'Inserted' }));
		characterForm.close();
		const characters = (await service.loadProject(owner)).characters;
		expect(characters.map((character) => character.name)).toEqual(['First', 'Inserted', 'Last']);
		expect(await characterOpening).toBe(characters[1]!.characterId);
		expect(saved).toHaveBeenCalledOnce();

		const entityOpening = view.openEntityForm({ mode: 'create', kind: 'location', afterIndex: 0 }, saved);
		await vi.waitFor(() => expect(openedForms).toHaveLength(2));
		const entityForm = openedForms[1] as { submitHandler(request: EntityFormRequest): Promise<unknown>; close(): void };
		await entityForm.submitHandler(entityRequest('Inn'));
		entityForm.close();
		const places = (await service.loadProject(owner)).worldbuilding.location!;
		expect(places.map((entity) => entity.name)).toEqual(['Harbour', 'Inn', 'Market']);
		expect(await entityOpening).toBe(places[1]!.entityId);
		expect(saved).toHaveBeenCalledTimes(2);
		fixture.assertOwnership(before);
	});
});

describe('gallery saves through the host', () => {
	const picture = (name: string, byte: number) => ({
		kind: 'data' as const, name, read: () => Promise.resolve(new Uint8Array([byte]).buffer),
	});

	it('lands a form\'s pictures around the note write, tidies what it took off, and takes a refused write back', async () => {
		const fixture = await setup();
		const { plugin, service, owner, env } = fixture;
		const folder = `${owner.rootPath}/20_Character/25_Gallery`;
		const face = `[[${folder}/face.png]]`;
		const back = `[[${folder}/back.png]]`;
		const created = await plugin.createCharacter(characterRequest({
			name: 'Pictured',
			gallery: { entries: [picture('face.png', 1), picture('back.png', 2)], removed: [], mainIndex: 1 },
		}), owner.projectFile);
		const reload = async () => (await service.loadProject(owner)).characters.find((candidate) => candidate.characterId === created.id)!;
		let character = await reload();
		expect(character.gallery).toEqual([face, back]);
		expect(character.galleryMain).toBe(back);
		expect(env.fakeVault.binaryContents.has(`${folder}/back.png`)).toBe(true);

		await plugin.updateCharacter(created.id, characterRequest({
			name: 'Pictured', expectedRevision: character.revision,
			gallery: { entries: [{ kind: 'kept', link: face }], removed: [back], mainIndex: null },
		}), owner.projectFile);
		character = await reload();
		expect(character.gallery).toEqual([face]);
		expect(character.galleryMain).toBeNull();
		expect(env.fakeFileManager.trashCalls).toEqual([`${folder}/back.png`]);

		env.fakeFileManager.failNextFrontmatterPath = character.path;
		await expect(plugin.updateCharacter(created.id, characterRequest({
			name: 'Pictured', expectedRevision: character.revision,
			gallery: { entries: [{ kind: 'kept', link: face }, picture('extra.png', 3)], removed: [], mainIndex: 1 },
		}), owner.projectFile)).rejects.toThrow();
		expect(env.fakeVault.getFileByPath(`${folder}/extra.png`)).toBeNull();
		expect(env.fakeFileManager.trashCalls).toEqual([`${folder}/back.png`, `${folder}/extra.png`]);
		character = await reload();
		expect(character.gallery).toEqual([face]);

		// Obsidian's own deletion prompt offers the note's unused attachments itself, so the host leaves the picture to its answer.
		Object.setPrototypeOf(env.fakeVault.getFileByPath(character.path), TFile.prototype);
		await plugin.deleteCharacter(created.id, character.revision, owner.projectFile);
		expect(env.fakeFileManager.trashCalls).toEqual([`${folder}/back.png`, `${folder}/extra.png`, character.path]);
		expect(env.fakeVault.getFileByPath(`${folder}/face.png`)).not.toBeNull();
	});

	it('sends a picture a card takes off to the trash, as the form\'s save does, and moves the main without touching a file', async () => {
		const fixture = await setup();
		const { plugin, service, owner, env } = fixture;
		const folder = `${owner.rootPath}/20_Character/25_Gallery`;
		const face = `[[${folder}/face.png]]`;
		const back = `[[${folder}/back.png]]`;
		const created = await plugin.createCharacter(characterRequest({
			name: 'Pictured',
			gallery: { entries: [picture('face.png', 1), picture('back.png', 2)], removed: [], mainIndex: 0 },
		}), owner.projectFile);
		const reload = async () => (await service.loadProject(owner)).characters.find((candidate) => candidate.characterId === created.id)!;
		let character = await reload();
		await plugin.patchCharacter(created.id, { expectedRevision: character.revision, galleryMain: back }, owner.projectFile);
		character = await reload();
		expect(character.galleryMain).toBe(back);
		expect(env.fakeFileManager.trashCalls).toEqual([]);
		await plugin.patchCharacter(created.id, { expectedRevision: character.revision, gallery: [face], galleryMain: null }, owner.projectFile);
		character = await reload();
		expect(character.gallery).toEqual([face]);
		expect(character.galleryMain).toBeNull();
		expect(env.fakeFileManager.trashCalls).toEqual([`${folder}/back.png`]);
		expect(env.fakeVault.getFileByPath(`${folder}/face.png`)).not.toBeNull();

		// A picture another note of the kind shares, linked where it stands, is kept when a card takes it off.
		await plugin.createCharacter(characterRequest({
			name: 'Twin',
			gallery: { entries: [{ kind: 'vault', path: `${folder}/face.png` }], removed: [], mainIndex: null },
		}), owner.projectFile);
		character = await reload();
		await plugin.patchCharacter(created.id, { expectedRevision: character.revision, gallery: [], galleryMain: null }, owner.projectFile);
		character = await reload();
		expect(character.gallery).toEqual([]);
		expect(env.fakeFileManager.trashCalls).toEqual([`${folder}/back.png`]);
		expect(env.fakeVault.getFileByPath(`${folder}/face.png`)).not.toBeNull();
	});

	it('tidies a deleted note\'s orphaned pictures after the plugin\'s own confirmation, where other notes name it', async () => {
		const fixture = await setup();
		const { plugin, service, owner, env } = fixture;
		const folder = `${owner.rootPath}/20_Character/25_Gallery`;
		const created = await plugin.createCharacter(characterRequest({
			name: 'Pictured',
			gallery: { entries: [picture('face.png', 1)], removed: [], mainIndex: 0 },
		}), owner.projectFile);
		const character = (await service.loadProject(owner)).characters.find((candidate) => candidate.characterId === created.id)!;
		// A scene naming the character sends the deletion through the plugin's own confirmation rather than Obsidian's prompt.
		await service.createScene(owner, { title: 'With the character', characters: [character.path] });
		Object.setPrototypeOf(env.fakeVault.getFileByPath(character.path), TFile.prototype);
		const deleting = plugin.deleteCharacter(created.id, character.revision, owner.projectFile);
		await vi.waitFor(() => expect(openedForms).toHaveLength(1));
		const confirmation = openedForms[0] as { confirmed: boolean; close(): void };
		confirmation.confirmed = true;
		confirmation.close();
		await deleting;
		expect(fixture.promptForDeletion).not.toHaveBeenCalled();
		expect(env.fakeFileManager.trashCalls).toEqual([character.path, `${folder}/face.png`]);
	});
});
