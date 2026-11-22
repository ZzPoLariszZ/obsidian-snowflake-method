import { beforeEach, describe, expect, it } from 'vitest';

import { SnowflakeProjectService, type ProjectSnapshot } from '../../src/services';
import { createFakeEnvironment } from '../helpers/fake-vault';

/**
 * Whose words a write carries. Every write the plugin's own screens make is
 * the author's typing. A caller that is not a person says so, and each write
 * it sets off must say so too, down to the heading a rename rewrites: one
 * that forgot would credit a tool's words to the author's day.
 */
describe('the origin of a write', () => {
	let service: SnowflakeProjectService;
	let project: ProjectSnapshot;
	/** What the repository told its listeners of each body written and each note made. */
	let told: boolean[];
	const tool = { userInput: false } as const;

	beforeEach(async () => {
		const environment = createFakeEnvironment();
		service = new SnowflakeProjectService(environment.vault, environment.fileManager, environment.metadataCache);
		project = await service.createProject({ title: 'Novel', locale: 'en' });
		told = [];
		service.repository.onBodyWrite = (_path, _before, _after, userInput) => {
			told.push(userInput);
		};
		service.repository.onManagedFileCreated = (_path, _content, userInput) => {
			told.push(userInput);
		};
	});

	const chapter = async (title: string, body: string): Promise<string> => {
		const [path] = await service.manuscript.appendSegments(project, [{ title, body }], { userInput: true });
		if (path === undefined) throw new Error('The manuscript took the chapter.');
		told = [];
		return path;
	};

	it('is the author’s where a write says nothing', async () => {
		const path = await chapter('One', '# One\n\nFirst words.\n');
		const read = await service.manuscript.readSegment(path);
		await service.manuscript.writeSegment(path, '# One\n\nOther words.\n', read.revision);
		await service.manuscript.createSegmentAt(project, { atEnd: true }, 'Two');
		await service.manuscript.renameSegment(project, path, 'First', { heading: true });
		expect(told.length).toBeGreaterThanOrEqual(3);
		expect(told.every((userInput) => userInput)).toBe(true);
	});

	it('is a tool’s for a body written, a note made, and a note made with words of its own', async () => {
		const path = await chapter('One', 'First words.\n');
		const read = await service.manuscript.readSegment(path);
		await service.manuscript.writeSegment(path, 'Other words.\n', read.revision, tool);
		await service.manuscript.createSegmentAt(project, { atEnd: true }, 'Two', [], tool);
		await service.manuscript.createSegmentAt(project, { after: path }, 'One and a half', [], { ...tool, body: 'Brought words.\n' });
		await service.manuscript.createSegmentAt(project, { atStart: true }, 'Zero', [], tool);
		// One body written and three notes made, each told at least once.
		expect(told.length).toBeGreaterThanOrEqual(4);
		expect(told.every((userInput) => !userInput)).toBe(true);
	});

	it('is a tool’s for both halves of a split and for the join of a merge', async () => {
		const path = await chapter('One', 'First half.\n\nSecond half.\n');
		const { path: second } = await service.manuscript.splitSegmentAt(project, path, 'First half.\n\n'.length, 'Two', [], tool);
		// The note that takes the tail is made, and then the tail and the head are each written.
		expect(told.length).toBeGreaterThanOrEqual(3);
		expect(told.every((userInput) => !userInput)).toBe(true);
		expect((await service.manuscript.readSegment(second)).body).toBe('Second half.\n');
		told = [];
		await service.manuscript.mergeWithNext(project, path, [], tool);
		expect(told).toEqual([false]);
		told = [];
		await service.mergeManuscriptSegments(project, (await service.manuscript.listSegmentsFromFiles(project))[0]?.path ?? '', [], tool);
		expect(told).toEqual([false]);
	});

	it('is a tool’s for the heading a rename rewrites, one note or a batch', async () => {
		const path = await chapter('One', '# One\n\nWords.\n');
		const { to } = await service.manuscript.renameSegment(project, path, 'First', { heading: true, ...tool });
		expect(told).toEqual([false]);
		told = [];
		const outcome = await service.manuscript.renameSegments(project, [{ path: to, title: 'Chapter 1' }], tool);
		expect(outcome.renamed).toHaveLength(1);
		expect(told).toEqual([false]);
		told = [];
		await service.renameManuscriptSegment(project, outcome.renamed[0]?.to ?? '', 'Opening', { heading: true, ...tool });
		expect(told).toEqual([false]);
	});

	it('is a tool’s for the headings a deletion’s renumbering rewrites', async () => {
		const first = await chapter('Chapter 1', '# Chapter 1\n\nOne.\n');
		const second = await chapter('Chapter 2', '# Chapter 2\n\nTwo.\n');
		await service.deleteManuscriptSegment(project, first, [{ path: second, title: 'Chapter 1' }], tool);
		expect(told).toEqual([false]);
	});

	it('is a tool’s for what a sticky note is made to say', async () => {
		const note = await service.stickyNotes.create(project);
		told = [];
		await service.stickyNotes.writeBody(note.path, 'A tool wrote this.', note.revision, tool);
		const again = await service.stickyNotes.read(note.path);
		await service.stickyNotes.writeBody(note.path, 'The author wrote this.', again?.revision ?? '');
		expect(told).toEqual([false, true]);
	});

	it('is a tool’s for a word added to a vocabulary and for what a word is said to mean', async () => {
		told = [];
		const added = await service.addDefinitionPath(project, 'character', 'category', 'Guild/Clockmakers', 'Keepers of the clock.', tool);
		expect(added.ok).toBe(true);
		// The two notes the path needed, the parent and the word itself.
		expect(told.length).toBeGreaterThanOrEqual(2);
		expect(told.every((userInput) => !userInput)).toBe(true);
		told = [];
		await service.updateDefinitionDescription(project, 'character', 'category', 'Guild/Clockmakers', 'Keepers of the town clock.', tool);
		expect(told).toEqual([false]);
		told = [];
		await service.updateDefinitionDescription(project, 'character', 'category', 'Guild/Clockmakers', 'The author says otherwise.');
		expect(told).toEqual([true]);
	});

	it('is a tool’s for a step’s text, a project made and a project renamed', async () => {
		const stepOne = project.artifacts[1];
		if (stepOne === undefined) throw new Error('A new project has the note of step 1.');
		await service.updateSections(stepOne.path, { genre: 'Mystery' }, stepOne.revision, tool);
		expect(told).toEqual([false]);
		told = [];
		const reloaded = await service.loadProject(project.projectFile);
		const again = reloaded.artifacts[1];
		await service.updateSections(again?.path ?? '', { genre: 'Winter mystery' }, again?.revision ?? '');
		expect(told).toEqual([true]);
		told = [];
		await service.renameProject(project, 'Novel, renamed', tool);
		expect(told).toEqual([false]);
		told = [];
		await service.createProject({ title: 'Made by a tool', locale: 'en', ...tool });
		// The note of the project itself. The notes a new project is filled with are the plugin's own and never the author's.
		expect(told[0]).toBe(false);
		expect(told.every((userInput) => !userInput)).toBe(true);
	});
});
