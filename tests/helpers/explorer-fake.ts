/**
 * Enough of the core file explorer for the explorer tools to be driven in a
 * test: the rows with their three elements, the two item classes over one
 * base, a view that sorts folders first and files after by name, a header
 * that makes nav buttons, and an app whose workspace and vault can be told
 * to fire their events. Everything is built on the corkboard DOM fake.
 */

import { TFile, TFolder } from 'obsidian';

import { CorkboardDom, CorkboardElement } from './corkboard-dom';

type Listener = (...args: unknown[]) => void;

export interface FakeFileSpec {
	path: string;
	mtime?: number;
	size?: number;
}

export class FakeFiles {
	readonly byPath = new Map<string, TFile | TFolder>();
	readonly root: TFolder;

	constructor() {
		this.root = this.makeFolder('/');
	}

	private makeFolder(path: string): TFolder {
		const folder = new TFolder();
		folder.path = path;
		folder.name = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1);
		folder.children = [];
		folder.parent = null;
		folder.isRoot = () => path === '/';
		return folder;
	}

	folder(path: string): TFolder {
		const existing = this.byPath.get(path);
		if (existing instanceof TFolder) return existing;
		const folder = this.makeFolder(path);
		this.byPath.set(path, folder);
		this.place(folder);
		return folder;
	}

	file(spec: FakeFileSpec | string): TFile {
		const { path, mtime = 1, size = 1 } = typeof spec === 'string' ? { path: spec } : spec;
		const existing = this.byPath.get(path);
		if (existing instanceof TFile) return existing;
		const file = new TFile();
		this.setPath(file, path);
		file.stat = { mtime, size, ctime: mtime };
		file.parent = null;
		this.byPath.set(path, file);
		this.place(file);
		return file;
	}

	private setPath(file: TFile, path: string): void {
		file.path = path;
		file.name = path.slice(path.lastIndexOf('/') + 1);
		const dot = file.name.lastIndexOf('.');
		file.basename = dot === -1 ? file.name : file.name.slice(0, dot);
		file.extension = dot === -1 ? '' : file.name.slice(dot + 1);
	}

	private place(entry: TFile | TFolder): void {
		const slash = entry.path.lastIndexOf('/');
		const parent = slash === -1 ? this.root : this.folder(entry.path.slice(0, slash));
		entry.parent = parent;
		if (!parent.children.includes(entry)) parent.children.push(entry);
	}

	rename(entry: TFile | TFolder, newPath: string): string {
		const oldPath = entry.path;
		const parent = entry.parent;
		if (parent !== null) parent.children.splice(parent.children.indexOf(entry), 1);
		this.byPath.delete(oldPath);
		if (entry instanceof TFile) this.setPath(entry, newPath);
		else {
			entry.path = newPath;
			entry.name = newPath.slice(newPath.lastIndexOf('/') + 1);
		}
		this.byPath.set(newPath, entry);
		this.place(entry);
		return oldPath;
	}

	remove(entry: TFile | TFolder): void {
		const parent = entry.parent;
		if (parent !== null) parent.children.splice(parent.children.indexOf(entry), 1);
		this.byPath.delete(entry.path);
	}

	touch(file: TFile, mtime: number, size = file.stat.size): void {
		file.stat = { mtime, size, ctime: file.stat.ctime };
	}

	get(path: string): TFile | TFolder | null {
		if (path === '/') return this.root;
		return this.byPath.get(path) ?? null;
	}
}

/** The base row class: what `updateTitle`, `startRename` and `stopRename` do in Obsidian, stripped to their effect. */
export class FakeBaseItem {
	readonly el: CorkboardElement;
	readonly selfEl: CorkboardElement;
	readonly innerEl: CorkboardElement;
	/** What the rename box selected when it opened: the text the row held then. */
	selectedText: string | null = null;
	/** Whether the row has been drawn once: the title is written then, and never again by a redraw. */
	rendered = false;

	constructor(readonly view: FakeExplorerView, readonly file: TFile | TFolder) {
		this.el = new CorkboardElement(view.dom, 'div');
		this.el.addClass('tree-item');
		this.selfEl = this.el.createDiv({ cls: 'tree-item-self' });
		this.innerEl = this.selfEl.createDiv({ cls: 'tree-item-inner' });
	}

	getTitle(): string {
		return this.file.name;
	}

	updateTitle(): void {
		this.innerEl.setText(this.getTitle());
		this.selfEl.setAttribute('data-path', this.file.path);
	}

	startRename(): void {
		this.selfEl.addClass('is-being-renamed');
		this.selectedText = this.innerEl.textContent;
	}

	stopRename(): void {
		this.selfEl.removeClass('is-being-renamed');
	}
}

export class FakeFileItem extends FakeBaseItem {
	getTitle(): string {
		return this.file instanceof TFile ? this.file.basename : this.file.name;
	}

	updateTitle(): void {
		super.updateTitle();
	}
}

export class FakeFolderItem extends FakeBaseItem {
	vChildren: { children: FakeBaseItem[] } = { children: [] };
	readonly collapsible = true;
	collapsed = false;

	setCollapsed(collapsed: boolean): void {
		if (this.collapsed === collapsed) return;
		this.collapsed = collapsed;
		this.view.requestSort();
	}

	sort(): void {
		if (this.file instanceof TFolder) {
			this.vChildren.children = this.view.getSortedFolderItems(this.file);
		}
	}
}

export class FakeExplorerView {
	fileItems: Record<string, FakeBaseItem> = {};
	fileBeingRenamed: TFile | TFolder | null = null;
	ready = true;
	sorts = 0;
	rootChildren: FakeBaseItem[] = [];
	readonly containerEl: CorkboardElement;
	readonly navFileContainerEl: CorkboardElement;
	readonly buttonsEl: CorkboardElement;
	readonly headerDom: {
		addNavButton(icon: string, title: string, onClick: (event: MouseEvent) => void, cls?: string): CorkboardElement;
	};
	readonly registered: (() => void)[] = [];

	constructor(readonly dom: CorkboardDom, readonly files: FakeFiles) {
		this.containerEl = dom.container.createDiv({ cls: 'workspace-leaf-content' });
		const header = this.containerEl.createDiv({ cls: 'nav-header' });
		this.buttonsEl = header.createDiv({ cls: 'nav-buttons-container' });
		this.headerDom = {
			addNavButton: (icon, _title, onClick, cls) => {
				const button = this.buttonsEl.createDiv({ cls: 'clickable-icon nav-action-button' });
				if (cls !== undefined) button.addClass(cls);
				button.setAttribute('data-nav-icon', icon);
				button.addEventListener('click', (event) => onClick(event as unknown as MouseEvent));
				return button;
			},
		};
		this.navFileContainerEl = this.containerEl.createDiv({ cls: 'nav-files-container' });
		for (const entry of files.byPath.values()) this.onCreate(entry);
	}

	register(callback: () => void): void {
		this.registered.push(callback);
	}

	/** The item for a file, made the way the explorer makes one on a create. */
	onCreate(file: TFile | TFolder): FakeBaseItem {
		const existing = this.fileItems[file.path];
		if (existing !== undefined) return existing;
		const item = file instanceof TFolder ? new FakeFolderItem(this, file) : new FakeFileItem(this, file);
		this.fileItems[file.path] = item;
		return item;
	}

	onRename(file: TFile | TFolder, oldPath: string): void {
		const item = this.fileItems[oldPath];
		if (item === undefined) return;
		delete this.fileItems[oldPath];
		this.fileItems[file.path] = item;
		item.updateTitle();
		this.requestSort();
	}

	onDelete(file: TFile | TFolder): void {
		delete this.fileItems[file.path];
		this.requestSort();
	}

	requestSort(): void {
		this.sorts += 1;
		this.sort();
	}

	/** Every folder sorted, the root laid out, and the open rows rendered into the container. */
	sort(): void {
		if (!this.ready) return;
		for (const item of Object.values(this.fileItems)) {
			if (item instanceof FakeFolderItem) item.sort();
		}
		this.rootChildren = this.getSortedFolderItems(this.files.root);
		this.render();
	}

	getSortedFolderItems(folder: TFolder): FakeBaseItem[] {
		const children = [...folder.children].sort((left, right) => {
			const leftFolder = left instanceof TFolder;
			const rightFolder = right instanceof TFolder;
			if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
			return left.name.localeCompare(right.name, 'en', { numeric: true });
		});
		const items: FakeBaseItem[] = [];
		for (const child of children) {
			const item = this.fileItems[child.path];
			if (item !== undefined) items.push(item);
		}
		return items;
	}

	/** Attaches every row of every open folder to the scroller, as the virtual list shows them. */
	render(): void {
		this.navFileContainerEl.empty();
		const place = (items: FakeBaseItem[]): void => {
			for (const item of items) {
				this.navFileContainerEl.insertBefore(item.el, null);
				// As Obsidian's onRender does: the title is written on the first
				// render alone; a rename and a leave of the rename box write it again.
				if (!item.rendered) {
					item.rendered = true;
					item.updateTitle();
				}
				if (item instanceof FakeFolderItem && !item.collapsed) place(item.vChildren.children);
			}
		};
		place(this.rootChildren);
	}

	/** The rows now on screen, by path, top to bottom. */
	renderedPaths(): string[] {
		return this.navFileContainerEl.children.map((el) => el.children[0]?.getAttribute('data-path') ?? '');
	}

	startRenameFile(file: TFile | TFolder): FakeBaseItem {
		this.fileBeingRenamed = file;
		const item = this.fileItems[file.path];
		if (item === undefined) throw new Error(`no row for ${file.path}`);
		item.startRename();
		return item;
	}

	exitRename(): void {
		const file = this.fileBeingRenamed;
		if (file === null) return;
		this.fileBeingRenamed = null;
		const item = this.fileItems[file.path];
		if (item === undefined) return;
		item.updateTitle();
		item.stopRename();
	}
}

export class FakeLeaf {
	constructor(readonly view: FakeExplorerView | null, readonly isDeferred = false) {}
}

/** The app the enhancer asks after: a workspace of leaves and a vault of events. */
export class FakeApp {
	readonly listeners = new Map<string, Listener[]>();
	readonly leaves: FakeLeaf[] = [];
	/** The global keymap scope: the Escape handlers arrange mode registers. */
	readonly scope = {
		handlers: [] as unknown[],
		register(_modifiers: unknown, _key: string, handler: unknown): unknown {
			this.handlers.push(handler);
			return { handler };
		},
		unregister(registered: { handler: unknown }): void {
			this.handlers.splice(this.handlers.indexOf(registered.handler), 1);
		},
	};
	readonly workspace: {
		on(name: string, callback: Listener): { name: string; callback: Listener };
		getLeavesOfType(type: string): FakeLeaf[];
		containerEl: CorkboardElement;
		trigger(name: string, ...args: unknown[]): void;
	};
	readonly vault: {
		on(name: string, callback: Listener): { name: string; callback: Listener };
		trigger(name: string, ...args: unknown[]): void;
		getAbstractFileByPath(path: string): TFile | TFolder | null;
		getFolderByPath(path: string): TFolder | null;
		getRoot(): TFolder;
	};

	constructor(readonly dom: CorkboardDom, readonly files: FakeFiles) {
		const on = (prefix: string) => (name: string, callback: Listener) => {
			const key = `${prefix}:${name}`;
			this.listeners.set(key, [...(this.listeners.get(key) ?? []), callback]);
			return { name, callback };
		};
		const trigger = (prefix: string) => (name: string, ...args: unknown[]) => {
			for (const callback of this.listeners.get(`${prefix}:${name}`) ?? []) callback(...args);
		};
		this.workspace = {
			on: on('workspace'),
			getLeavesOfType: (type) => (type === 'file-explorer' ? this.leaves : []),
			containerEl: dom.container,
			trigger: trigger('workspace'),
		};
		this.vault = {
			on: on('vault'),
			trigger: trigger('vault'),
			getAbstractFileByPath: (path) => files.get(path),
			getFolderByPath: (path) => {
				const entry = files.get(path);
				return entry instanceof TFolder ? entry : null;
			},
			getRoot: () => files.root,
		};
	}
}

/** The plugin as a component: what the enhancer registers with it. */
export class FakePlugin {
	readonly events: unknown[] = [];
	readonly cleanups: (() => void)[] = [];
	registerEvent(ref: unknown): void {
		this.events.push(ref);
	}
	register(callback: () => void): void {
		this.cleanups.push(callback);
	}
}

/** A microtask-and-timer settle, so queued counts land. */
export async function settle(dom: CorkboardDom, rounds = 4): Promise<void> {
	for (let round = 0; round < rounds; round++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		dom.flushFrame();
	}
}
