/**
 * What a right-click in the file explorer offers to bring into the current
 * project's manuscript stream: the Markdown notes among the entries under
 * the pointer, in the order the explorer shows them, folders opened all the
 * way down. Nothing here writes. The manuscript service appends what this
 * gathers, and the confirmation says what the selection held besides.
 */

import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';

import { safeFileName } from '../domain';

import { isExplorerView } from './file-explorer-shapes';

/** The notes an import would append, and what the selection held besides. */
export interface StreamImportPlan {
	/** The notes to copy, in the explorer's order. */
	files: TFile[];
	/** Files that are not Markdown notes, or that no note can be named after. */
	skipped: number;
	/** Notes already in the stream, which an import would only double. */
	inStream: number;
}

export interface StreamImportDeps {
	/** A folder's entries as the explorer lists them. */
	children(folder: TFolder): TAbstractFile[];
	/** The Vault's root, where a walk over the selection begins. */
	root(): TFolder;
	/** Whether a note already stands in the stream. */
	inStream(path: string): boolean;
}

/** Obsidian reads one extension as a note, whatever its case on disk. */
function isMarkdown(file: TFile): boolean {
	return file.extension.toLowerCase() === 'md';
}

/** Whether a note can be named after the file: a name of dots alone cannot. */
function nameable(file: TFile): boolean {
	try {
		safeFileName(file.basename);
		return true;
	} catch {
		return false;
	}
}

function parentPaths(path: string): string[] {
	const parents: string[] = [];
	let at = path.lastIndexOf('/');
	while (at > 0) {
		parents.push(path.slice(0, at));
		at = path.lastIndexOf('/', at - 1);
	}
	return parents;
}

/**
 * The plan for a selection: every entry once, however many times it was
 * picked or however many of its parents were, each note in the place the
 * explorer shows it. A folder brings everything below it; a note picked
 * inside a picked folder comes with the folder and not again on its own.
 */
export function planStreamImport(
	selection: readonly TAbstractFile[],
	deps: StreamImportDeps,
): StreamImportPlan {
	const plan: StreamImportPlan = { files: [], skipped: 0, inStream: 0 };
	const judge = (file: TFile): void => {
		if (!isMarkdown(file) || !nameable(file)) plan.skipped += 1;
		else if (deps.inStream(file.path)) plan.inStream += 1;
		else plan.files.push(file);
	};
	const takeAll = (folder: TFolder): void => {
		for (const child of deps.children(folder)) {
			if (child instanceof TFolder) takeAll(child);
			else if (child instanceof TFile) judge(child);
		}
	};
	const root = deps.root();
	if (selection.some((entry) => entry === root || entry.path === root.path)) {
		takeAll(root);
		return plan;
	}
	const picked = new Set(selection.map((entry) => entry.path));
	const above = new Set(selection.flatMap((entry) => parentPaths(entry.path)));
	const walk = (folder: TFolder): void => {
		for (const child of deps.children(folder)) {
			if (picked.has(child.path)) {
				if (child instanceof TFolder) takeAll(child);
				else if (child instanceof TFile) judge(child);
			} else if (child instanceof TFolder && above.has(child.path)) {
				walk(child);
			}
		}
	};
	walk(root);
	return plan;
}

/** Obsidian's own order when nothing says otherwise: folders first, then names. */
function byDefaultOrder(left: TAbstractFile, right: TAbstractFile): number {
	const leftFolder = left instanceof TFolder;
	const rightFolder = right instanceof TFolder;
	if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
	return left.name.localeCompare(right.name, undefined, { numeric: true });
}

/**
 * A folder's entries as the explorer lists them: the sort the author chose
 * there, and the order the explorer tools arranged, read from the open
 * explorer's own listing. With no explorer to ask, Obsidian's default.
 */
export function explorerOrder(app: App): (folder: TFolder) => TAbstractFile[] {
	const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view;
	if (isExplorerView(view) && typeof view.getSortedFolderItems === 'function') {
		const sorted = view.getSortedFolderItems.bind(view);
		return (folder) => sorted(folder).map((item) => item.file);
	}
	return (folder) => [...folder.children].sort(byDefaultOrder);
}
