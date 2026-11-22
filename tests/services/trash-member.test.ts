import { beforeEach, describe, expect, it } from 'vitest';

import { SnowflakeProjectService, galleryFolderPath } from '../../src/services';
import { createFakeEnvironment, type FakeFileManager, type FakeVault } from '../helpers/fake-vault';

const picture = (name: string): { kind: 'data'; name: string; read: () => Promise<ArrayBuffer> } => ({
	kind: 'data',
	name,
	read: () => Promise.resolve(new TextEncoder().encode(name).buffer),
});

/**
 * A member's deletion, as the service does it for whoever asks: the note to
 * the trash, the lists that kept it tidied, and the pictures only it showed
 * gone with it.
 */
describe('trashing a member', () => {
	let fakeVault: FakeVault;
	let fakeFileManager: FakeFileManager;
	let service: SnowflakeProjectService;

	beforeEach(() => {
		const environment = createFakeEnvironment();
		fakeVault = environment.fakeVault;
		fakeFileManager = environment.fakeFileManager;
		service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
	});

	it('sends the note to the trash and takes it off the lists that kept it', async () => {
		const project = await service.createProject({ name: 'Cast' });
		const ada = await service.createCharacter(project, { name: 'Ada' });
		const ben = await service.createCharacter(project, { name: 'Ben' });
		const scene = await service.createScene(project, { title: 'Together', povPath: ada.path, characters: [ada.path, ben.path] });

		const loaded = await service.loadProject(project.projectFile);
		const answer = await service.trashMember(loaded, { path: ben.path, gallery: [] });

		expect(answer).toEqual({ trashFailed: [] });
		expect(fakeFileManager.trashCalls).toEqual([ben.path]);
		expect(fakeVault.getFileByPath(ben.path)).toBeNull();
		const after = await service.loadProject(project.projectFile);
		expect(after.characters.map((character) => character.name)).toEqual(['Ada']);
		expect(after.scenes.find((entry) => entry.sceneId === scene.sceneId)?.characters).toEqual([ada.path]);
	});

	it('leaves a field that holds one note alone, for the author to decide', async () => {
		const project = await service.createProject({ name: 'Seen through' });
		const ada = await service.createCharacter(project, { name: 'Ada' });
		const scene = await service.createScene(project, { title: 'Alone', povPath: ada.path, characters: [ada.path] });

		await service.trashMember(await service.loadProject(project.projectFile), { path: ada.path, gallery: [] });

		const after = (await service.loadProject(project.projectFile)).scenes.find((entry) => entry.sceneId === scene.sceneId);
		// The cast is a list and loses her. Whose eyes the scene is seen through is one note, and is not emptied.
		expect(after?.characters).toEqual([]);
		// What is left of the link, now that the note it led to is gone.
		expect(after?.povPath).toBe(ada.path.replace(/\.md$/u, ''));
	});

	it('takes the pictures only that note showed, and leaves one another note shows too', async () => {
		const project = await service.createProject({ name: 'Pictures' });
		const folder = galleryFolderPath(project, 'character');
		const added = await service.gallery.addPictures(project, 'character', [picture('shared.png'), picture('alone.png')]);
		const [shared, alone] = added.map((entry) => entry.link) as [string, string];
		const ada = await service.createCharacter(project, { name: 'Ada', gallery: [shared, alone] });
		await service.createCharacter(project, { name: 'Ben', gallery: [shared] });

		const loaded = await service.loadProject(project.projectFile);
		const answer = await service.trashMember(loaded, { path: ada.path, gallery: [shared, alone] });

		expect(answer).toEqual({ trashFailed: [] });
		expect(fakeFileManager.trashCalls).toEqual([ada.path, `${folder}/alone.png`]);
		expect(fakeVault.getFileByPath(`${folder}/shared.png`)).not.toBeNull();
	});
});
