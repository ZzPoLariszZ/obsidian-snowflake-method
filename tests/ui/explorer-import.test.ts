import { describe, expect, it } from 'vitest';

import type { App, TAbstractFile, TFile, TFolder } from 'obsidian';

import {
	explorerOrder,
	holdsImportableNote,
	planStreamImport,
	type StreamImportDeps,
} from '../../src/ui/explorer-import';
import { CorkboardDom } from '../helpers/corkboard-dom';
import { FakeApp, FakeExplorerView, FakeFiles, FakeLeaf } from '../helpers/explorer-fake';

/** A vault of the paths given, a folder for every path ending in a slash. */
function vaultOf(paths: string[]): FakeFiles {
	const files = new FakeFiles();
	for (const path of paths) {
		if (path.endsWith('/')) files.folder(path.slice(0, -1));
		else files.file(path);
	}
	return files;
}

/** The explorer's own listing, from a view over the files. */
function listedBy(files: FakeFiles): (folder: TFolder) => TAbstractFile[] {
	const dom = new CorkboardDom();
	const view = new FakeExplorerView(dom, files);
	return (folder) => view.getSortedFolderItems(folder).map((item) => item.file);
}

function depsOf(files: FakeFiles, inStream: (path: string) => boolean = () => false): StreamImportDeps {
	return { children: listedBy(files), root: () => files.root, inStream, ownNote: () => false };
}

const paths = (plan: { files: { path: string }[] }): string[] => plan.files.map((file) => file.path);
const pick = (files: FakeFiles, ...wanted: string[]): TAbstractFile[] =>
	wanted.map((path) => {
		const entry = files.get(path);
		if (entry === null) throw new Error(`no entry ${path}`);
		return entry;
	});

describe('planning an import from the explorer', () => {
	it('walks the selection in the explorer’s order, folders opened all the way down, and skips what is not a note', () => {
		const files = vaultOf([
			'Notes/c.md',
			'Inbox/b.md',
			'Inbox/pic.png',
			'Inbox/a.md',
			'Inbox/Sub/z.md',
			'Inbox/Sub/y.md',
			'Inbox/Sub/board.canvas',
			'Inbox/Empty/',
		]);
		// Picked in the opposite order, the plan still reads top to bottom.
		const plan = planStreamImport(pick(files, 'Notes/c.md', 'Inbox'), depsOf(files));
		expect(paths(plan)).toEqual(['Inbox/Sub/y.md', 'Inbox/Sub/z.md', 'Inbox/a.md', 'Inbox/b.md', 'Notes/c.md']);
		expect(plan.skipped).toBe(2);
		expect(plan.inStream).toBe(0);
	});

	it('names each note once, however often it or its folders were picked, and reads the extension in any case', () => {
		const files = vaultOf(['Inbox/a.md', 'Inbox/Sub/b.MD', 'Inbox/Sub/c.md']);
		const plan = planStreamImport(
			pick(files, 'Inbox/Sub/c.md', 'Inbox', 'Inbox/Sub', 'Inbox/a.md', 'Inbox/a.md'),
			depsOf(files),
		);
		expect(paths(plan)).toEqual(['Inbox/Sub/b.MD', 'Inbox/Sub/c.md', 'Inbox/a.md']);
		expect(plan.skipped).toBe(0);
	});

	it('leaves the notes the stream already holds, and counts them apart from the files that are no notes', () => {
		const files = vaultOf(['Novel/50_Manuscript/One.md', 'Novel/80_Material/Idea.md', 'Novel/80_Material/map.png']);
		const plan = planStreamImport(
			pick(files, 'Novel'),
			depsOf(files, (path) => path.startsWith('Novel/50_Manuscript/')),
		);
		expect(paths(plan)).toEqual(['Novel/80_Material/Idea.md']);
		expect(plan.inStream).toBe(1);
		expect(plan.skipped).toBe(1);
	});

	it('leaves the project’s own records out, counted with the files that are no notes', () => {
		const files = vaultOf(['Novel/00_System/Metadata.md', 'Novel/80_Material/Idea.md', 'Novel/80_Material/map.png']);
		const deps = { ...depsOf(files), ownNote: (file: TFile) => file.path.startsWith('Novel/00_System/') };
		const plan = planStreamImport(pick(files, 'Novel'), deps);
		expect(paths(plan)).toEqual(['Novel/80_Material/Idea.md']);
		expect(plan.skipped).toBe(2);
		expect(holdsImportableNote(pick(files, 'Novel/00_System/Metadata.md'), deps)).toBe(false);
	});

	it('skips a file no note can be named after', () => {
		const files = vaultOf(['Inbox/..md', 'Inbox/fine.md']);
		const plan = planStreamImport(pick(files, 'Inbox'), depsOf(files));
		expect(paths(plan)).toEqual(['Inbox/fine.md']);
		expect(plan.skipped).toBe(1);
	});

	it('brings the whole vault when the root itself is picked, plain text with the notes', () => {
		const files = vaultOf(['b.md', 'Inbox/a.md', 'readme.txt', 'Inbox/loud.TXT', 'pic.png']);
		const plan = planStreamImport([files.root], depsOf(files));
		expect(paths(plan)).toEqual(['Inbox/a.md', 'Inbox/loud.TXT', 'b.md', 'readme.txt']);
		expect(plan.skipped).toBe(1);
	});

	it('answers an empty plan for a selection with nothing to bring', () => {
		const files = vaultOf(['Inbox/pic.png', 'Inbox/Empty/']);
		const plan = planStreamImport(pick(files, 'Inbox'), depsOf(files));
		expect(plan).toEqual({ files: [], skipped: 1, inStream: 0 });
	});
});

describe('whether a selection holds a note to bring', () => {
	it('answers yes at the first note it could bring, without walking the rest', () => {
		const files = vaultOf(['Inbox/a.md', 'Inbox/b.md', 'Inbox/Sub/c.md', 'Other/d.md']);
		const asked: string[] = [];
		const deps = depsOf(files, (path) => {
			asked.push(path);
			return false;
		});
		expect(holdsImportableNote(pick(files, 'Inbox', 'Other'), deps)).toBe(true);
		expect(asked).toEqual(['Inbox/Sub/c.md']);
	});

	it('answers no for pictures and for notes the stream holds, however they are picked', () => {
		const files = vaultOf(['Inbox/pic.png', 'Novel/50_Manuscript/One.md']);
		const deps = depsOf(files, (path) => path.startsWith('Novel/50_Manuscript/'));
		expect(holdsImportableNote(pick(files, 'Inbox', 'Novel/50_Manuscript/One.md'), deps)).toBe(false);
		expect(holdsImportableNote([files.root], deps)).toBe(false);
	});
});

describe('the explorer’s order', () => {
	const names = (entries: TAbstractFile[]): string[] => entries.map((entry) => entry.name);

	it('reads the open explorer’s own listing', () => {
		const dom = new CorkboardDom();
		const files = vaultOf(['Inbox/Ch 10.md', 'Inbox/Ch 2.md', 'Inbox/Sub/', 'Inbox/Ch 1.md']);
		const app = new FakeApp(dom, files);
		const view = new FakeExplorerView(dom, files);
		// The view lists by its own rule; a listing the plan reads is the view's, not a sort of its own.
		view.getSortedFolderItems = (folder) =>
			[...folder.children].reverse().map((child) => view.fileItems[child.path]).filter((item) => item !== undefined);
		app.leaves.push(new FakeLeaf(view));
		const order = explorerOrder(app as unknown as App);
		expect(names(order(files.folder('Inbox')))).toEqual(['Ch 1.md', 'Sub', 'Ch 2.md', 'Ch 10.md']);
	});

	it('falls back to folders first and names in numeric order while no explorer is open or it is deferred', () => {
		const dom = new CorkboardDom();
		const files = vaultOf(['Inbox/Ch 10.md', 'Inbox/Ch 2.md', 'Inbox/Sub/', 'Inbox/Ch 1.md']);
		const closed = new FakeApp(dom, files);
		expect(names(explorerOrder(closed as unknown as App)(files.folder('Inbox')))).toEqual([
			'Sub',
			'Ch 1.md',
			'Ch 2.md',
			'Ch 10.md',
		]);
		const deferred = new FakeApp(dom, files);
		deferred.leaves.push(new FakeLeaf(null, true));
		expect(names(explorerOrder(deferred as unknown as App)(files.folder('Inbox')))).toEqual([
			'Sub',
			'Ch 1.md',
			'Ch 2.md',
			'Ch 10.md',
		]);
	});
});
