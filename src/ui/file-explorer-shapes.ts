/**
 * The shapes of the core file explorer's internals that the explorer tools
 * read: the view, its rows and its header, as Obsidian 1.14 builds them.
 * None of this is in the public API. Every member is probed before it is
 * used, and a member a later Obsidian has moved takes its one feature away
 * rather than the explorer, so this is the only module that names them.
 */

import type { TAbstractFile, TFolder, View } from 'obsidian';

/** A row of the tree: a file item or a folder item. */
export interface ExplorerItemShape {
	/** The whole row with its children, `.tree-item`. */
	el: HTMLElement;
	/** The title row, `.tree-item-self`, which carries `data-path`. */
	selfEl: HTMLElement;
	/** The title text, `.tree-item-inner`, which the rename box edits in place. */
	innerEl: HTMLElement;
	file: TAbstractFile;
	view?: ExplorerViewShape;
	getTitle(): string;
	updateTitle(): void;
	startRename?(): void;
	stopRename?(): void;
	/** A folder item folds; `collapsed` says how it stands and `setCollapsed` turns it. */
	collapsible?: boolean;
	collapsed?: boolean;
	setCollapsed?(collapsed: boolean, animate?: boolean): unknown;
}

export interface ExplorerHeaderShape {
	addNavButton(
		icon: string,
		title: string,
		onClick: (event: MouseEvent) => void,
		cls?: string,
	): HTMLElement;
}

export interface ExplorerViewShape extends View {
	fileItems: Record<string, ExplorerItemShape>;
	navFileContainerEl?: HTMLElement;
	headerDom?: ExplorerHeaderShape;
	fileBeingRenamed?: TAbstractFile | null;
	/** False until the workspace layout is ready; `sort()` declines before then. */
	ready?: boolean;
	requestSort?: () => void;
	getSortedFolderItems?: (folder: TFolder) => ExplorerItemShape[];
}

export function isExplorerView(view: unknown): view is ExplorerViewShape {
	if (typeof view !== 'object' || view === null) return false;
	const candidate = view as { fileItems?: unknown; containerEl?: unknown };
	return (
		typeof candidate.fileItems === 'object' &&
		candidate.fileItems !== null &&
		typeof candidate.containerEl === 'object' &&
		candidate.containerEl !== null
	);
}

export function isExplorerItem(item: unknown): item is ExplorerItemShape {
	if (typeof item !== 'object' || item === null) return false;
	const candidate = item as Record<string, unknown>;
	return (
		typeof candidate.selfEl === 'object' &&
		candidate.selfEl !== null &&
		typeof candidate.innerEl === 'object' &&
		candidate.innerEl !== null &&
		typeof candidate.file === 'object' &&
		candidate.file !== null &&
		typeof candidate.getTitle === 'function' &&
		typeof candidate.updateTitle === 'function'
	);
}

/** The object along the prototype chain from `start` that owns a method of that name, or null. */
export function ownerOf(start: object | null, name: string): object | null {
	let current: object | null = start;
	while (current !== null && current !== Object.prototype) {
		if (
			Object.prototype.hasOwnProperty.call(current, name) &&
			typeof (current as Record<string, unknown>)[name] === 'function'
		) {
			return current;
		}
		current = Object.getPrototypeOf(current) as object | null;
	}
	return null;
}

/** Any row of the view, from which the rows' shared prototype is found. */
export function firstItemOf(view: ExplorerViewShape): ExplorerItemShape | null {
	for (const item of Object.values(view.fileItems)) {
		if (isExplorerItem(item)) return item;
	}
	return null;
}
