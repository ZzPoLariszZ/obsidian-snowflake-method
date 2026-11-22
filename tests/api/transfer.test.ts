import { describe, expect, it } from 'vitest';

import { seedBoards } from './helpers/golden-boards';
import { CHAPTER_ONE, createGolden, faults, vaultState, type Golden } from './helpers/golden-project';

type Body = Record<string, unknown>;
const bodyOf = (value: unknown): Body => value as Body;
const refusal = (reply: { status: number; body: unknown }): unknown[] => [reply.status, bodyOf(reply.body)['code']];
const pointerOf = (reply: { body: unknown }): unknown => bodyOf(reply.body)['pointer'];

const FIRST = '50_Manuscript/Chapter 1.md';
const EXPORTS = 'Snowflake Projects/Snowflake Export';

/** A call that must land, with its answer held to the contract. */
async function ok(golden: Golden, operation: string, params: Body, body?: unknown, status = 200): Promise<Body> {
	const reply = await golden.call(operation, params, body === undefined ? {} : { body });
	expect([reply.status, faults(reply)], `${operation} ${JSON.stringify(reply.body)}`).toEqual([status, []]);
	return bodyOf(reply.body);
}

/** A second book of the series, with nothing in it yet, for the first to be brought into. */
async function sequel(golden: Golden): Promise<Body> {
	return ok(golden, 'createProject', {}, { title: 'East Wind', language: 'en' }, 201);
}

describe('what another project could bring in', () => {
	it('is told part by part, with how each stands here already, and nothing of either project is written', async () => {
		const golden = await createGolden({ access: 'read' });
		golden.host.state.access = 'write';
		const into = await sequel(golden);
		golden.host.state.access = 'read';
		const before = vaultState(golden.host);
		const asPlugin = golden.host.ranAsPlugin;
		const told = await ok(golden, 'inspectImport', { projectId: into['id'] }, { sourceProjectId: golden.project.id });
		expect(told['source']).toMatchObject({ id: golden.project.id, title: 'North Wind', archived: false });
		const parts = told['parts'] as Body[];
		const ada = parts.find((part) => part['kind'] === 'character' && part['name'] === 'Ada') ?? {};
		expect(ada).toMatchObject({ group: 'character', selectedByDefault: true, state: 'new', target: null });
		expect(String(ada['key']).startsWith('character:')).toBe(true);
		// What she is sorted under comes with her, and what she points at is offered.
		expect((ada['requires'] as string[]).some((key) => key.startsWith('vocabulary:'))).toBe(true);
		// The manuscript is there to bring, and is not ticked from the start.
		const chapter = parts.find((part) => part['kind'] === 'chapter' && part['name'] === 'Chapter 1') ?? {};
		expect(chapter).toMatchObject({ selectedByDefault: false, state: 'new' });
		expect(new Set(parts.map((part) => part['kind']))).toEqual(
			// The view every project starts with is among them, though no file holds it yet.
			new Set(['step', 'character', 'scene', 'worldbuilding', 'vocabulary', 'custom-field-template', 'chapter', 'task', 'foreshadowing', 'revision', 'sticky-note', 'freeform-view']),
		);
		expect(told['gone']).toEqual([]);
		expect(vaultState(golden.host)).toEqual(before);
		// A reading, though it is asked for with a body: it ran as no work of the plugin's.
		expect(golden.host.ranAsPlugin).toBe(asPlugin);
	});

	it('is refused between a project and itself, from a project that is not there, and into one in the archive', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		const self = await golden.call('inspectImport', P, { body: { sourceProjectId: golden.project.id } });
		expect([refusal(self), bodyOf(self.body)['reason'], faults(self)]).toEqual([[409, 'import-refused'], 'same-project', []]);
		const nowhere = await golden.call('inspectImport', P, { body: { sourceProjectId: 'project-nowhere' } });
		expect([refusal(nowhere), pointerOf(nowhere)]).toEqual([[422, 'invalid-reference'], '/sourceProjectId']);
		expect(refusal(await golden.call('inspectImport', { projectId: golden.archived.id }, { body: { sourceProjectId: golden.project.id } }))).toEqual([409, 'project-archived']);
		// A project in the archive can still be brought from.
		await ok(golden, 'inspectImport', P, { sourceProjectId: golden.archived.id });
	});
});

describe('things copied in from another project', () => {
	it('brings the parts named with what they cannot stand without, and files them as imported', async () => {
		const golden = await createGolden();
		const into = await sequel(golden);
		const P = { projectId: into['id'] };
		const parts = (await ok(golden, 'inspectImport', P, { sourceProjectId: golden.project.id }))['parts'] as Body[];
		const keyOf = (kind: string, name: string): string => String(parts.find((part) => part['kind'] === kind && part['name'] === name)?.['key']);
		golden.host.origins.length = 0;
		const batches = golden.host.batches;
		const report = await ok(golden, 'runImport', P, { sourceProjectId: golden.project.id, parts: [keyOf('character', 'Ada'), keyOf('task', 'Draw the town map')] });
		expect(report['source']).toEqual({ id: golden.project.id, title: 'North Wind' });
		const created = report['created'] as Body[];
		expect(created.filter((item) => item['kind'] === 'character' || item['kind'] === 'task').map((item) => [item['kind'], item['name']])).toEqual([
			['character', 'Ada'],
			['task', 'Draw the town map'],
		]);
		// Her category came with her, though the call did not name it.
		expect(created.some((item) => item['kind'] === 'vocabulary')).toBe(true);
		expect([report['failed'], report['replaced']]).toEqual([[], []]);
		// Ben was not brought, so what she says of him could not be kept as a link.
		expect((report['droppedLinks'] as Body[]).length).toBeGreaterThanOrEqual(0);
		const cast = (await ok(golden, 'listCharacters', P))['items'] as Body[];
		expect(cast.map((character) => character['name'])).toEqual(['Ada']);
		const ada = created.find((item) => item['kind'] === 'character') ?? {};
		expect(ada['path']).toBe(cast[0]?.['path']);
		// The first book is as it was, and nothing was told as the author's typing.
		expect(((await ok(golden, 'listCharacters', { projectId: golden.project.id }))['items'] as Body[]).length).toBe(2);
		expect(golden.host.origins.filter((userInput) => userInput)).toEqual([]);
		expect(golden.host.batches).toBe(batches + 1);

		// Brought again, what stands as its source has it is left.
		const again = await ok(golden, 'runImport', P, { sourceProjectId: golden.project.id, parts: [keyOf('character', 'Ada')] });
		expect([(again['created'] as Body[]).length, (again['skipped'] as Body[]).some((item) => item['name'] === 'Ada' && item['reason'] === 'unchanged')]).toEqual([0, true]);
	});

	it('is refused a part the other project does not have, and a project to bring from that is this one', async () => {
		const golden = await createGolden();
		const into = await sequel(golden);
		const before = vaultState(golden.host);
		const lost = await golden.call('runImport', { projectId: into['id'] }, { body: { sourceProjectId: golden.project.id, parts: ['character:nobody'] } });
		expect([refusal(lost), pointerOf(lost), faults(lost)]).toEqual([[422, 'invalid-reference'], '/parts/0', []]);
		const self = await golden.call('runImport', { projectId: golden.project.id }, { body: { sourceProjectId: golden.project.id, parts: ['step:1'] } });
		expect([refusal(self), bodyOf(self.body)['reason']]).toEqual([[409, 'import-refused'], 'same-project']);
		expect(refusal(await golden.call('runImport', { projectId: into['id'] }, { body: { sourceProjectId: golden.project.id, parts: [] } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('the manuscript written out to a file', () => {
	const text = (golden: Golden, path: string): string => golden.host.environment.fakeVault.contents.get(path) ?? '';

	it('goes into the author’s export folder as the author has exports laid out, and writes over nothing unasked', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		golden.host.typed.set(golden.manuscript.first, `${CHAPTER_ONE}\nNot saved yet.\n`);
		const done = await ok(golden, 'exportManuscript', P, {});
		expect(done).toEqual({ written: [`${EXPORTS}/North Wind.txt`], unchanged: [] });
		const whole = text(golden, `${EXPORTS}/North Wind.txt`);
		// Plain words, every note of the manuscript, the author's last words among them.
		expect([whole.includes('The clock stopped at midnight.'), whole.includes('Not saved yet.'), whole.includes('Nobody asked why.'), whole.includes('#')]).toEqual([true, true, true, false]);

		const standing = await golden.call('exportManuscript', P, { body: {} });
		expect([refusal(standing), faults(standing), bodyOf(standing.body)['paths']]).toEqual([[409, 'path-conflict'], [], [`${EXPORTS}/North Wind.txt`]]);
		expect(await ok(golden, 'exportManuscript', P, { overwrite: true })).toEqual({ written: [`${EXPORTS}/North Wind.txt`], unchanged: [] });
		// The manuscript itself is as it was.
		expect(golden.host.editors.filter((line) => line.startsWith('release'))).toEqual([]);
	});

	it('writes one note, or a file a note, in a folder below the export folder', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		expect(await ok(golden, 'exportManuscript', P, { note: FIRST, format: 'md', folder: 'drafts/first' })).toEqual({
			written: [`${EXPORTS}/drafts/first/North Wind/Chapter 1.md`],
			unchanged: [],
		});
		const each = await ok(golden, 'exportManuscript', P, { layout: 'folder', folder: 'drafts' });
		const written = each['written'] as string[];
		expect(written.every((path) => path.startsWith(`${EXPORTS}/drafts/North Wind/`) && path.endsWith('.txt'))).toBe(true);
		expect(written.some((path) => path.endsWith('Chapter 1.txt'))).toBe(true);
		expect(text(golden, written.find((path) => path.endsWith('Chapter 2.txt')) ?? '')).toContain('Nobody asked why.');
	});

	it('is refused a folder outside the export folder, a note that is not there, and an export folder that lies inside the project', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		const before = vaultState(golden.host);
		for (const folder of ['../elsewhere', '/Notes', 'a/../../b']) {
			expect(refusal(await golden.call('exportManuscript', P, { body: { folder } })), folder).toEqual([400, 'invalid-request']);
		}
		expect(refusal(await golden.call('exportManuscript', P, { body: { note: '50_Manuscript/Nowhere.md' } }))).toEqual([400, 'invalid-request']);
		expect(refusal(await golden.call('exportManuscript', P, { body: { format: 'docx' } }))).toEqual([400, 'invalid-request']);
		golden.host.state.exporting = { ...golden.host.state.exporting, folder: `${golden.project.rootPath}/80_Material` };
		expect(refusal(await golden.call('exportManuscript', P, { body: {} }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
	});
});

describe('a board written out as a canvas', () => {
	it('is written beside the board’s own file, left alone where it says the same, and written over only when asked', async () => {
		const golden = await createGolden();
		const boards = await seedBoards(golden);
		const P = { projectId: golden.project.id };
		const made = await ok(golden, 'exportCanvas', P, { board: 'freeform', id: boards.canvas });
		const path = (made['written'] as string[])[0] ?? '';
		expect([path.startsWith(`${golden.project.rootPath}/`), path.endsWith('/Board.canvas'), made['unchanged']]).toEqual([true, true, []]);
		const canvas = JSON.parse(golden.host.environment.fakeVault.contents.get(path) ?? '{}') as { nodes: unknown[]; edges: unknown[] };
		expect([canvas.nodes.length, canvas.edges.length]).toEqual([3, 1]);

		expect(await ok(golden, 'exportCanvas', P, { board: 'freeform', id: boards.canvas })).toEqual({ written: [], unchanged: [path] });
		await ok(golden, 'applyFreeformSteps', { ...P, freeformViewId: boards.canvas }, { steps: [{ do: 'text', id: 'card-text', text: 'Changed.' }] });
		const standing = await golden.call('exportCanvas', P, { body: { board: 'freeform', id: boards.canvas } });
		expect([refusal(standing), bodyOf(standing.body)['path'], faults(standing)]).toEqual([[409, 'path-conflict'], path, []]);
		expect(await ok(golden, 'exportCanvas', P, { board: 'freeform', id: boards.canvas, overwrite: true })).toEqual({ written: [path], unchanged: [] });

		const timeline = await ok(golden, 'exportCanvas', P, { board: 'timeline', id: boards.view });
		const sheet = await ok(golden, 'exportCanvas', P, { board: 'beat-sheet', id: boards.sheet });
		expect([(timeline['written'] as string[])[0]?.endsWith('/Side by side.canvas'), (sheet['written'] as string[])[0]?.endsWith('/Winter.canvas')]).toEqual([true, true]);
		const lost = await golden.call('exportCanvas', P, { body: { board: 'beat-sheet', id: boards.view } });
		expect([refusal(lost), pointerOf(lost)]).toEqual([[422, 'invalid-reference'], '/id']);
	});
});

describe('the pictures a note keeps', () => {
	const picture = async (golden: Golden, path: string): Promise<void> => {
		await golden.host.environment.fakeVault.ensureFolders(path.slice(0, path.lastIndexOf('/')));
		await golden.host.environment.fakeVault.createBinary(path, new Uint8Array([1, 2, 3, 4]).buffer);
	};
	const picturesOf = (gallery: Body): Body[] => gallery['pictures'] as Body[];

	it('are copied into the gallery of the note’s kind from where they stand in the vault', async () => {
		const golden = await createGolden();
		const { ada, ben } = golden.members;
		const P = { projectId: golden.project.id };
		await picture(golden, 'Pictures/ada.png');
		await picture(golden, 'Pictures/tower.webp');
		golden.host.origins.length = 0;
		const told = await ok(golden, 'addGalleryPictures', { ...P, memberId: ada.characterId }, { paths: ['Pictures/ada.png', 'Pictures/tower.webp'], main: 'Pictures/tower.webp' });
		const folder = `${golden.project.rootPath}/20_Character/25_Gallery`;
		expect(told['member']).toMatchObject({ kind: 'character', id: ada.characterId, name: 'Ada' });
		expect(picturesOf(told).map((entry) => [entry['path'], entry['main']])).toEqual([
			[`${folder}/ada.png`, false],
			[`${folder}/tower.webp`, true],
		]);
		expect(told['untrashed']).toEqual([]);
		// Copied: the picture still stands where it was put.
		expect(golden.host.environment.fakeVault.getFileByPath('Pictures/ada.png')).not.toBeNull();
		expect(golden.host.origins.filter((userInput) => userInput)).toEqual([]);
		// The note's own reading says the same.
		const read = await ok(golden, 'getCharacter', { ...P, characterId: ada.characterId });
		expect((read['gallery'] as unknown[]).length).toBe(2);

		// A picture that already stands in the gallery folder is linked where it is, for a second note to share.
		const shared = await ok(golden, 'addGalleryPictures', { ...P, memberId: ben.characterId }, { paths: [`${folder}/ada.png`] });
		expect(picturesOf(shared).map((entry) => entry['path'])).toEqual([`${folder}/ada.png`]);
	});

	it('are taken off one at a time, the file going to the trash where no other note shows it', async () => {
		const golden = await createGolden();
		const { ada, ben } = golden.members;
		const P = { projectId: golden.project.id };
		await picture(golden, 'Pictures/ada.png');
		await picture(golden, 'Pictures/tower.webp');
		const folder = `${golden.project.rootPath}/20_Character/25_Gallery`;
		await ok(golden, 'addGalleryPictures', { ...P, memberId: ada.characterId }, { paths: ['Pictures/ada.png', 'Pictures/tower.webp'], main: 'Pictures/ada.png' });
		await ok(golden, 'addGalleryPictures', { ...P, memberId: ben.characterId }, { paths: [`${folder}/tower.webp`] });
		const trashed = golden.host.environment.fakeFileManager.trashCalls;
		trashed.length = 0;

		const first = await ok(golden, 'removeGalleryPicture', { ...P, memberId: ada.characterId, picturePath: `${folder}/ada.png` });
		expect(picturesOf(first).map((entry) => [entry['path'], entry['main']])).toEqual([[`${folder}/tower.webp`, false]]);
		expect(trashed).toEqual([`${folder}/ada.png`]);
		// Ben still shows the other, so its file stands.
		await ok(golden, 'removeGalleryPicture', { ...P, memberId: ada.characterId, picturePath: `${folder}/tower.webp` });
		expect(trashed).toEqual([`${folder}/ada.png`]);
		expect(refusal(await golden.call('removeGalleryPicture', { ...P, memberId: ada.characterId, picturePath: `${folder}/tower.webp` }))).toEqual([404, 'not-found']);
	});

	it('are refused where the file is no picture, is not there, or the note is not', async () => {
		const golden = await createGolden();
		const P = { projectId: golden.project.id };
		const at = { ...P, memberId: golden.members.ada.characterId };
		await picture(golden, 'Pictures/ada.png');
		const before = vaultState(golden.host);
		const note = await golden.call('addGalleryPictures', at, { body: { paths: [golden.members.ben.path] } });
		expect([refusal(note), JSON.stringify(note.body).includes('/paths/0')]).toEqual([[400, 'invalid-request'], true]);
		const missing = await golden.call('addGalleryPictures', at, { body: { paths: ['Pictures/ada.png', 'Pictures/nowhere.png'] } });
		expect([refusal(missing), pointerOf(missing)]).toEqual([[422, 'invalid-reference'], '/paths/1']);
		expect(pointerOf(await golden.call('addGalleryPictures', at, { body: { paths: ['Pictures/ada.png'], main: 'Pictures/other.png' } }))).toBe('/main');
		expect(refusal(await golden.call('addGalleryPictures', { ...P, memberId: 'character-gone' }, { body: { paths: ['Pictures/ada.png'] } }))).toEqual([404, 'not-found']);
		expect(refusal(await golden.call('addGalleryPictures', at, { body: { paths: [] } }))).toEqual([400, 'invalid-request']);
		expect(vaultState(golden.host)).toEqual(before);
		expect(golden.host.environment.fakeVault.createBinaryCalls.length).toBe(1);
	});
});
