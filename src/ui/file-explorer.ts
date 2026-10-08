/**
 * The plugin's hand in Obsidian's own file explorer: three buttons in its
 * header, and behind them a tidy view that takes the ordering prefixes off
 * the names and leaves the plugin's own entries out, an arrange mode that
 * lets rows be dragged into the author's order, and a word count at the
 * end of every note's and folder's row.
 *
 * All of it is a veneer over the explorer's own rows. The names on disk
 * never change, and the rename box always shows them: the row's title is
 * written back to the real name the moment a rename begins, and dressed
 * again once it ends. Hidden entries are simply left out of the lists the
 * explorer asks for, so nothing is hidden by stylesheet, and the explorer's
 * own search, folds and keyboard travel see the same tree the author does.
 *
 * The explorer's internals are not public API. They are reached through
 * the shapes module and patched on their prototypes once per session; a
 * member a later Obsidian has moved takes that one feature away, and every
 * patched call falls back to Obsidian's own answer if this code throws.
 */

import {
	Menu,
	setIcon,
	setTooltip,
	TFile,
	TFolder,
	type App,
	type Component,
	type TAbstractFile,
} from 'obsidian';

import {
	applyExplorerOrder,
	deleteFromOrders,
	forgetOrder,
	moveBeside,
	moveToIndex,
	orderKeyOf,
	pruneOrders,
	recordOrder,
	renameInOrders,
	type ExplorerOrders,
} from '../domain';
import {
	builtinRuleFor,
	compileHiddenList,
	displayNameOf,
	ExplorerCountService,
	isHiddenEntry,
	type ExplorerEntry,
	type ExplorerRules,
	type ExplorerScope,
} from '../services';
import { ArrangeController, type ArrangeDeps } from './file-explorer-arrange';
import {
	firstItemOf,
	isExplorerItem,
	isExplorerView,
	ownerOf,
	type ExplorerItemShape,
	type ExplorerViewShape,
} from './file-explorer-shapes';
import { patchMethod, type MethodPatch } from './method-patch';
import type { Translate } from './modals';
import { addOrderMenuItems, listNeighbours } from './order-menu';

export const EXPLORER_VIEW_TYPE = 'file-explorer';
export const EXPLORER_MENU_SECTION = 'snowflake-method';
const BADGE_CLASS = 'snowflake-method-explorer-count';
const BUTTON_CLASS = 'snowflake-method-explorer-button';
const COUNTS_OFF_CLASS = 'snowflake-method-explorer-counts-off';
/** How long a burst of vault events settles before the badges are painted again. */
const REPAINT_DELAY_MS = 300;

/** What the explorer tools read of the settings. */
export interface ExplorerSettingsView {
	explorerScope: ExplorerScope;
	explorerTidy: boolean;
	explorerCounts: boolean;
	explorerHidePrefix: boolean;
	explorerHideFiles: boolean;
	explorerHiddenFiles: string;
	explorerHideFolders: boolean;
	explorerHiddenFolders: string;
	explorerNoteCounts: boolean;
	explorerFolderCounts: boolean;
	explorerOrders: ExplorerOrders;
}

export interface ExplorerDeps {
	app: App;
	/** Whose life the listeners share: the plugin. */
	plugin: Component;
	t: Translate;
	settings(): ExplorerSettingsView;
	saveOrders(next: ExplorerOrders): void;
	saveToggle(key: 'explorerTidy' | 'explorerCounts', value: boolean): void;
	/** The project folder holding a path, archived projects included, or null. */
	projectRootOf(path: string): string | null;
	/** One note's headline total under the counting rule in force, or null when it cannot be read. */
	countNote(path: string): Promise<number | null>;
	/** Told after a note was counted, so a note nothing else holds can let its text go. */
	noteCounted(path: string): void;
	breathe(): Promise<void>;
	/** The locale the numbers are grouped by. */
	locale(): string;
	notice(text: string): void;
}

interface Attachment {
	view: ExplorerViewShape;
	container: HTMLElement | null;
	buttons: { tidy: HTMLElement | null; arrange: HTMLElement | null; counts: HTMLElement | null };
	arrange: ArrangeController | null;
	paintFrame: number | null;
	disposers: (() => void)[];
}

type Capability = 'hiding' | 'titles';

function entryOf(file: TAbstractFile): ExplorerEntry {
	return { path: file.path, name: file.name, isFolder: file instanceof TFolder };
}

export class ExplorerEnhancer {
	readonly counts: ExplorerCountService;
	private readonly attachments = new WeakMap<ExplorerViewShape, Attachment>();
	private readonly attached = new Set<ExplorerViewShape>();
	private readonly badges = new WeakMap<ExplorerItemShape, HTMLElement>();
	private readonly patches: MethodPatch[] = [];
	private viewPatched = false;
	private itemsPatched = false;
	private readonly capabilities: Record<Capability, boolean> = { hiding: false, titles: false };
	private readonly reported = new Set<string>();
	/** One pass's answers about what is hidden; cleared whenever the vault or the rules change. */
	private readonly hiddenMemo = new Map<string, boolean>();
	private rulesMemo: { files: string; folders: string; rules: ExplorerRules } | null = null;
	private repaintTimer: number | null = null;
	private hintShown = false;
	private disposed = false;

	constructor(private readonly deps: ExplorerDeps) {
		this.counts = new ExplorerCountService({
			countNote: (path) => deps.countNote(path),
			fileAt: (path) => deps.app.vault.getAbstractFileByPath(path),
			pluginMade: (path) => this.pluginMade(path),
			counted: (path) => deps.noteCounted(path),
			breathe: () => deps.breathe(),
		});
	}

	/** Listens for explorers, present and future, and dresses the ones already open. */
	start(): void {
		const { app, plugin } = this.deps;
		plugin.registerEvent(app.workspace.on('layout-change', () => this.attachAll()));
		plugin.registerEvent(app.workspace.on('active-leaf-change', () => this.attachAll()));
		plugin.registerEvent(app.vault.on('create', (file) => this.vaultChanged('create', file)));
		plugin.registerEvent(app.vault.on('modify', (file) => this.vaultChanged('modify', file)));
		plugin.registerEvent(app.vault.on('delete', (file) => this.vaultChanged('delete', file)));
		plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => this.vaultChanged('rename', file, oldPath)),
		);
		this.pruneOrders();
		this.attachAll();
	}

	attachAll(): void {
		if (this.disposed) return;
		for (const leaf of this.deps.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
			if (leaf.isDeferred) continue;
			const view: unknown = leaf.view;
			if (!isExplorerView(view) || this.attachments.has(view)) continue;
			this.attach(view);
		}
	}

	/** Everything taken back: the patches, the buttons, the badges and the names. */
	dispose(): void {
		this.disposed = true;
		if (this.repaintTimer !== null) {
			this.deps.app.workspace.containerEl.win.clearTimeout(this.repaintTimer);
			this.repaintTimer = null;
		}
		for (const patch of this.patches.splice(0).reverse()) patch.restore();
		this.viewPatched = false;
		this.itemsPatched = false;
		this.capabilities.hiding = false;
		this.capabilities.titles = false;
		for (const view of [...this.attached]) {
			this.detach(view, { restoreTitles: true });
			this.requestSort(view);
		}
		this.counts.clear();
	}

	// -- Settings and state ---------------------------------------------------

	settingsChanged(key: string): void {
		if (key === 'writingCountMode' || key === 'writingCountHeadings') this.counts.clear();
		this.refresh();
	}

	/** The projects were scanned again: scope may have moved, and orders may name what is gone. */
	projectsChanged(): void {
		this.pruneOrders();
		this.refresh();
	}

	setTidy(value: boolean): void {
		this.deps.saveToggle('explorerTidy', value);
		this.refresh();
	}

	setCounts(value: boolean): void {
		this.deps.saveToggle('explorerCounts', value);
		this.refresh();
	}

	get arranging(): boolean {
		return this.arrangingView() !== null;
	}

	/**
	 * Turns arrange mode on in one explorer, or off everywhere, and answers
	 * the state it leaves. The first entry from a button explains the mode
	 * once; a command raises its own notice and asks for no hint.
	 */
	toggleArrange(view?: ExplorerViewShape, { hint = true } = {}): boolean {
		if (this.arranging) {
			this.exitArrange();
			return false;
		}
		const target = view ?? [...this.attached][0];
		if (target === undefined) return false;
		const attachment = this.attachments.get(target);
		if (attachment === undefined || attachment.container === null || !this.capabilities.hiding) {
			return false;
		}
		attachment.arrange = new ArrangeController(this.arrangeDeps(target, attachment.container));
		attachment.arrange.enter();
		this.paintView(attachment);
		this.schedulePaint(target);
		if (hint && !this.hintShown) {
			this.hintShown = true;
			this.deps.notice(this.deps.t('explorer.arrangeHint'));
		}
		return true;
	}

	exitArrange(): void {
		for (const view of this.attached) {
			const attachment = this.attachments.get(view);
			if (attachment === undefined || attachment.arrange === null) continue;
			attachment.arrange.exit();
			attachment.arrange = null;
			this.paintView(attachment);
			this.schedulePaint(view);
		}
	}

	/**
	 * The move items for a row's menu while arrange mode is on, or null when
	 * the entry cannot be arranged. The caller puts them in a section of its
	 * own; the same items stand behind the row's grip.
	 */
	arrangeMenu(file: TAbstractFile): ((menu: Menu, section: string) => void) | null {
		const view = this.arrangingView();
		if (view === null) return null;
		const item = view.fileItems[file.path];
		if (item === undefined) return null;
		const settings = this.deps.settings();
		if (!this.inScope(file.path, settings)) return null;
		const siblings = this.siblingsOf(view, item);
		const names = siblings.map((sibling) => sibling.file.name);
		const index = names.indexOf(file.name);
		if (index === -1) return null;
		const parentPath = file.parent?.path ?? '/';
		const { app, t } = this.deps;
		return (menu, section) => {
			addOrderMenuItems(
				menu,
				{
					app,
					t,
					section,
					run: async (action) => {
						try {
							await action();
						} catch (error: unknown) {
							this.deps.notice(error instanceof Error ? error.message : String(error));
						}
					},
					refresh: async () => {
						this.requestSort(view);
					},
				},
				{
					index,
					total: names.length,
					locked: false,
					readOnly: true,
					...listNeighbours(index, names.length),
					options: () =>
						siblings
							.filter((sibling) => sibling !== item)
							.map((sibling) => {
								const at = names.indexOf(sibling.file.name);
								return {
									id: sibling.file.name,
									index: at,
									label: `${at + 1}. ${this.labelOf(sibling, settings)}`,
								};
							}),
					move: async (toIndex) => {
						const next = moveToIndex(names, file.name, toIndex);
						if (next !== null) this.writeOrder(view, parentPath, next);
					},
					moveBeside: async (id, side) => {
						const next = moveBeside(names, file.name, id, side);
						if (next !== null) this.writeOrder(view, parentPath, next);
					},
					reveal: () => undefined,
				},
			);
			menu.addItem((entry) =>
				entry
					.setSection(section)
					.setTitle(t('explorer.resetOrder'))
					.setIcon('rotate-ccw')
					.onClick(() => {
						const current = this.deps.settings().explorerOrders;
						const next = forgetOrder(current, parentPath);
						if (next !== current) this.deps.saveOrders(next);
						this.requestSort(view);
					}),
			);
		};
	}

	/** Lets go of orders naming folders the vault no longer has, or names a folder no longer holds. */
	pruneOrders(): void {
		const settings = this.deps.settings();
		const { vault } = this.deps.app;
		const next = pruneOrders(settings.explorerOrders, {
			folderExists: (key) => key.length === 0 || vault.getFolderByPath(key) !== null,
			childExists: (parent, name) =>
				vault.getAbstractFileByPath(parent.length === 0 ? name : `${parent}/${name}`) !== null,
		});
		if (next !== settings.explorerOrders) this.deps.saveOrders(next);
	}

	/** Names, hiding, order and badges painted again from the settings as they stand. */
	refresh(): void {
		if (this.disposed) return;
		this.hiddenMemo.clear();
		this.rulesMemo = null;
		for (const view of this.attached) {
			const attachment = this.attachments.get(view);
			if (attachment === undefined) continue;
			this.paintView(attachment);
			this.requestSort(view);
			this.retitleAll(view);
			this.schedulePaint(view);
		}
	}

	// -- Attaching to a view --------------------------------------------------

	private attach(view: ExplorerViewShape): void {
		this.ensureViewPatches(view);
		this.ensureItemPatches(firstItemOf(view));
		const container =
			view.navFileContainerEl ??
			view.containerEl.querySelector<HTMLElement>('.nav-files-container');
		const attachment: Attachment = {
			view,
			container,
			buttons: { tidy: null, arrange: null, counts: null },
			arrange: null,
			paintFrame: null,
			disposers: [],
		};
		this.attachments.set(view, attachment);
		this.attached.add(view);
		if (this.capabilities.hiding || this.capabilities.titles) {
			attachment.buttons.tidy = this.makeButton(view, 'tidy', 'eye', () => {
				this.setTidy(!this.deps.settings().explorerTidy);
			});
		}
		if (this.capabilities.hiding && container !== null) {
			attachment.buttons.arrange = this.makeButton(view, 'arrange', 'move-vertical', () => {
				this.toggleArrange(view);
			});
		}
		if (this.capabilities.titles && container !== null) {
			attachment.buttons.counts = this.makeButton(view, 'counts', 'sigma', () => {
				this.setCounts(!this.deps.settings().explorerCounts);
			});
		}
		if (container !== null) {
			// Rows come and go as the tree scrolls and folds, with no sort to
			// tell of it; each of these is followed by a paint of what shows.
			const schedule = (): void => this.schedulePaint(view);
			container.addEventListener('scroll', schedule, { passive: true });
			container.addEventListener('click', schedule, true);
			container.addEventListener('keydown', schedule, true);
			attachment.disposers.push(() => {
				container.removeEventListener('scroll', schedule);
				container.removeEventListener('click', schedule, true);
				container.removeEventListener('keydown', schedule, true);
			});
		}
		view.register(() => this.detach(view));
		this.paintView(attachment);
		if (view.ready !== false) {
			this.requestSort(view);
			this.retitleAll(view);
		}
		this.schedulePaint(view);
	}

	private detach(view: ExplorerViewShape, { restoreTitles = false } = {}): void {
		const attachment = this.attachments.get(view);
		if (attachment === undefined) return;
		attachment.arrange?.exit();
		attachment.arrange = null;
		for (const button of Object.values(attachment.buttons)) button?.remove();
		for (const dispose of attachment.disposers.splice(0)) dispose();
		if (attachment.paintFrame !== null) {
			view.containerEl.win.cancelAnimationFrame(attachment.paintFrame);
			attachment.paintFrame = null;
		}
		attachment.container?.removeClass(COUNTS_OFF_CLASS);
		for (const item of Object.values(view.fileItems)) {
			const badge = this.badges.get(item);
			if (badge !== undefined) {
				badge.remove();
				this.badges.delete(item);
			}
			if (restoreTitles) item.updateTitle();
		}
		this.attachments.delete(view);
		this.attached.delete(view);
	}

	private makeButton(
		view: ExplorerViewShape,
		kind: 'tidy' | 'arrange' | 'counts',
		icon: string,
		onClick: () => void,
	): HTMLElement | null {
		const cls = `${BUTTON_CLASS}-${kind}`;
		const header = view.headerDom;
		if (header !== undefined && typeof header.addNavButton === 'function') {
			const button = header.addNavButton(icon, '', onClick, BUTTON_CLASS);
			button.addClass(cls);
			return button;
		}
		const bar = view.containerEl.querySelector<HTMLElement>('.nav-buttons-container');
		if (bar === null) return null;
		const button = bar.createDiv({ cls: `clickable-icon nav-action-button ${BUTTON_CLASS} ${cls}` });
		setIcon(button, icon);
		button.addEventListener('click', onClick);
		return button;
	}

	private paintView(attachment: Attachment): void {
		const settings = this.deps.settings();
		const { t } = this.deps;
		const tidy = settings.explorerTidy;
		this.paintButton(
			attachment.buttons.tidy,
			tidy ? 'eye' : 'eye-off',
			tidy,
			`${t(tidy ? 'explorer.tidyOn' : 'explorer.tidyOff')}\n${t(tidy ? 'explorer.tidyTurnOff' : 'explorer.tidyTurnOn')}`,
		);
		const arranging = attachment.arrange?.active === true;
		this.paintButton(
			attachment.buttons.arrange,
			'move-vertical',
			arranging,
			`${t(arranging ? 'explorer.arrangeOn' : 'explorer.arrangeOff')}\n${t(arranging ? 'explorer.arrangeTurnOff' : 'explorer.arrangeTurnOn')}`,
		);
		const counts = settings.explorerCounts;
		this.paintButton(
			attachment.buttons.counts,
			'sigma',
			counts,
			`${t(counts ? 'explorer.countsOn' : 'explorer.countsOff')}\n${t(counts ? 'explorer.countsTurnOff' : 'explorer.countsTurnOn')}`,
		);
		attachment.container?.toggleClass(COUNTS_OFF_CLASS, !counts);
	}

	private paintButton(button: HTMLElement | null, icon: string, on: boolean, label: string): void {
		if (button === null) return;
		if (button.dataset.icon !== icon) {
			button.dataset.icon = icon;
			setIcon(button, icon);
		}
		if (button.getAttribute('aria-label') !== label) {
			button.setAttribute('aria-label', label);
			setTooltip(button, label);
		}
		button.toggleClass('is-active', on);
		button.setAttribute('aria-pressed', on ? 'true' : 'false');
	}

	// -- The patches ----------------------------------------------------------

	private ensureViewPatches(view: ExplorerViewShape): void {
		if (this.viewPatched) return;
		this.viewPatched = true;
		const proto = ownerOf(Object.getPrototypeOf(view) as object | null, 'getSortedFolderItems');
		const sorted = (view: unknown, folder: unknown, result: unknown): unknown =>
			this.sortedItems(view, folder, result);
		const failed = (error: unknown): void => this.reportFailure('hiding', error);
		const patch =
			proto === null
				? null
				: patchMethod(proto, 'getSortedFolderItems', (original) =>
						function (this: unknown, ...args: unknown[]): unknown {
							const result = original.apply(this, args);
							try {
								return sorted(this, args[0], result);
							} catch (error: unknown) {
								failed(error);
								return result;
							}
						},
					);
		if (patch === null) {
			this.reportMissing('hiding');
			return;
		}
		this.patches.push(patch);
		this.capabilities.hiding = true;
	}

	private ensureItemPatches(sample: ExplorerItemShape | null): void {
		if (this.itemsPatched || sample === null) return;
		this.itemsPatched = true;
		const base = ownerOf(Object.getPrototypeOf(sample) as object | null, 'startRename');
		const decorate = (item: ExplorerItemShape): void => this.decorate(item);
		const failed = (error: unknown): void => this.reportFailure('titles', error);
		const updateTitle =
			base === null
				? null
				: patchMethod(base, 'updateTitle', (original) =>
						function (this: unknown, ...args: unknown[]): unknown {
							const result = original.apply(this, args);
							try {
								if (isExplorerItem(this)) decorate(this);
							} catch (error: unknown) {
								failed(error);
							}
							return result;
						},
					);
		// The rename box edits whatever the title row shows, so the real
		// name is written back the moment a rename begins...
		const startRename =
			base === null
				? null
				: patchMethod(base, 'startRename', (original) =>
						function (this: unknown, ...args: unknown[]): unknown {
							try {
								if (isExplorerItem(this)) this.innerEl.setText(this.getTitle());
							} catch (error: unknown) {
								failed(error);
							}
							return original.apply(this, args);
						},
					);
		// ...and the dress put on again once it ends: Obsidian writes the
		// title before it takes the box away, while the row still says it is
		// being renamed, so that write is left alone and this one follows.
		const stopRename =
			base === null
				? null
				: patchMethod(base, 'stopRename', (original) =>
						function (this: unknown, ...args: unknown[]): unknown {
							const result = original.apply(this, args);
							try {
								if (isExplorerItem(this)) this.updateTitle();
							} catch (error: unknown) {
								failed(error);
							}
							return result;
						},
					);
		if (updateTitle === null || startRename === null || stopRename === null) {
			for (const patch of [updateTitle, startRename, stopRename]) patch?.restore();
			this.reportMissing('titles');
			return;
		}
		this.patches.push(updateTitle, startRename, stopRename);
		this.capabilities.titles = true;
	}

	/** What the explorer lists for a folder: Obsidian's list, less what is hidden, in the author's order. */
	private sortedItems(view: unknown, folder: unknown, result: unknown): unknown {
		if (!isExplorerView(view) || !Array.isArray(result)) return result;
		const items = result as ExplorerItemShape[];
		if (!this.itemsPatched && items.length > 0) this.ensureItemPatches(items[0] ?? null);
		const folderPath = (folder as { path?: unknown } | null)?.path;
		if (typeof folderPath !== 'string') return result;
		const settings = this.deps.settings();
		let list = items;
		if (settings.explorerTidy) {
			const renaming = view.fileBeingRenamed ?? null;
			list = list.filter((item) => item.file === renaming || !this.isHidden(item.file, settings));
		}
		if (this.inScope(folderPath, settings)) {
			list = applyExplorerOrder(
				settings.explorerOrders[orderKeyOf(folderPath)],
				list,
				(item) => item.file.name,
			);
		}
		this.schedulePaint(view);
		return list;
	}

	/** The dress on one row: its tidy name and its badge, unless a rename has the row. */
	private decorate(item: ExplorerItemShape): void {
		if (item.selfEl.classList.contains('is-being-renamed')) return;
		const renaming = item.view?.fileBeingRenamed ?? null;
		if (renaming !== null && renaming === item.file) return;
		const settings = this.deps.settings();
		if (
			settings.explorerTidy &&
			settings.explorerHidePrefix &&
			this.inScope(item.file.path, settings)
		) {
			const shown = displayNameOf(item.getTitle(), true);
			if (item.innerEl.textContent !== shown) item.innerEl.setText(shown);
		}
		const badge = this.ensureBadge(item, settings);
		if (badge !== null) this.fillFromMemo(item, badge);
	}

	private retitleAll(view: ExplorerViewShape): void {
		if (!this.capabilities.titles) return;
		for (const item of Object.values(view.fileItems)) item.updateTitle();
	}

	private requestSort(view: ExplorerViewShape): void {
		if (view.ready === false || typeof view.requestSort !== 'function') return;
		view.requestSort();
	}

	// -- Scope, hiding and rules ----------------------------------------------

	private inScope(path: string, settings: ExplorerSettingsView): boolean {
		return settings.explorerScope === 'vault' || this.deps.projectRootOf(path) !== null;
	}

	private rules(settings: ExplorerSettingsView): ExplorerRules {
		const memo = this.rulesMemo;
		if (
			memo !== null &&
			memo.files === settings.explorerHiddenFiles &&
			memo.folders === settings.explorerHiddenFolders &&
			memo.rules.hidePrefix === settings.explorerHidePrefix &&
			memo.rules.hideFiles === settings.explorerHideFiles &&
			memo.rules.hideFolders === settings.explorerHideFolders
		) {
			return memo.rules;
		}
		const rules: ExplorerRules = {
			hidePrefix: settings.explorerHidePrefix,
			hideFiles: settings.explorerHideFiles,
			hideFolders: settings.explorerHideFolders,
			hiddenFiles: compileHiddenList(settings.explorerHiddenFiles),
			hiddenFolders: compileHiddenList(settings.explorerHiddenFolders),
		};
		this.rulesMemo = {
			files: settings.explorerHiddenFiles,
			folders: settings.explorerHiddenFolders,
			rules,
		};
		return rules;
	}

	private readonly childrenOf = (folderPath: string): ExplorerEntry[] => {
		const folder = this.deps.app.vault.getFolderByPath(folderPath);
		return folder === null ? [] : folder.children.map(entryOf);
	};

	private isHidden(file: TAbstractFile, settings: ExplorerSettingsView): boolean {
		const root = this.deps.projectRootOf(file.path);
		if (settings.explorerScope === 'projects' && root === null) return false;
		return isHiddenEntry(entryOf(file), root, this.rules(settings), this.childrenOf, this.hiddenMemo);
	}

	private pluginMade(path: string): boolean {
		const file = this.deps.app.vault.getAbstractFileByPath(path);
		if (file === null) return false;
		return builtinRuleFor(entryOf(file), this.deps.projectRootOf(path)) !== null;
	}

	private labelOf(item: ExplorerItemShape, settings: ExplorerSettingsView): string {
		const title = item.getTitle();
		return settings.explorerTidy && settings.explorerHidePrefix && this.inScope(item.file.path, settings)
			? displayNameOf(title, true)
			: title;
	}

	// -- The badges -----------------------------------------------------------

	private badgeWanted(file: TAbstractFile, settings: ExplorerSettingsView): boolean {
		if (!settings.explorerCounts || !this.capabilities.titles) return false;
		if (!this.inScope(file.path, settings)) return false;
		if (file instanceof TFolder) return settings.explorerFolderCounts;
		return (
			file instanceof TFile &&
			file.extension === 'md' &&
			settings.explorerNoteCounts &&
			!this.pluginMade(file.path)
		);
	}

	private ensureBadge(item: ExplorerItemShape, settings: ExplorerSettingsView): HTMLElement | null {
		const existing = this.badges.get(item);
		if (!this.badgeWanted(item.file, settings)) {
			if (existing !== undefined) {
				existing.remove();
				this.badges.delete(item);
			}
			return null;
		}
		if (existing !== undefined) return existing;
		const badge = item.selfEl.createDiv({ cls: BADGE_CLASS });
		this.badges.set(item, badge);
		return badge;
	}

	private fillFromMemo(item: ExplorerItemShape, badge: HTMLElement): boolean {
		const total =
			item.file instanceof TFolder
				? this.counts.folderTotal(item.file.path)
				: this.counts.noteTotal(item.file.path);
		if (total === undefined) return false;
		this.fill(badge, total);
		return true;
	}

	private fill(badge: HTMLElement, total: number | null): void {
		const text = total === null ? '' : total.toLocaleString(this.deps.locale());
		if (badge.textContent !== text) badge.setText(text);
	}

	private schedulePaint(view: ExplorerViewShape): void {
		const attachment = this.attachments.get(view);
		if (attachment === undefined || attachment.paintFrame !== null) return;
		attachment.paintFrame = view.containerEl.win.requestAnimationFrame(() => {
			attachment.paintFrame = null;
			this.paint(view);
		});
	}

	/** The rows on screen given their numbers, and the ones still owed asked for. */
	private paint(view: ExplorerViewShape): void {
		const attachment = this.attachments.get(view);
		if (attachment === undefined || attachment.container === null || this.disposed) return;
		const settings = this.deps.settings();
		if (settings.explorerCounts && this.capabilities.titles) {
			const owed: string[] = [];
			for (const row of Array.from(attachment.container.querySelectorAll<HTMLElement>('.tree-item-self'))) {
				const path = row.getAttribute('data-path');
				if (path === null) continue;
				const item = view.fileItems[path];
				if (item === undefined) continue;
				const badge = this.ensureBadge(item, settings);
				if (badge !== null && !this.fillFromMemo(item, badge)) owed.push(path);
			}
			if (owed.length > 0) this.counts.request(owed, this.onCounted);
		}
		attachment.arrange?.decorate();
	}

	private readonly onCounted = (path: string, total: number | null): void => {
		for (const view of this.attached) {
			const item = view.fileItems[path];
			if (item === undefined) continue;
			const badge = this.badges.get(item);
			if (badge !== undefined) this.fill(badge, total);
		}
	};

	// -- The vault --------------------------------------------------------------

	private vaultChanged(
		kind: 'create' | 'modify' | 'delete' | 'rename',
		file: TAbstractFile,
		oldPath?: string,
	): void {
		if (this.disposed) return;
		this.hiddenMemo.clear();
		const children = file instanceof TFolder;
		const settings = this.deps.settings();
		if (kind === 'rename' && oldPath !== undefined) {
			this.counts.invalidate(oldPath, { children });
			this.counts.invalidate(file.path, { children });
			const next = renameInOrders(settings.explorerOrders, oldPath, file.path);
			if (next !== settings.explorerOrders) this.deps.saveOrders(next);
		} else if (kind === 'delete') {
			this.counts.invalidate(file.path, { children });
			const next = deleteFromOrders(settings.explorerOrders, file.path);
			if (next !== settings.explorerOrders) this.deps.saveOrders(next);
		} else {
			this.counts.invalidate(file.path, { children });
		}
		this.scheduleRepaintAll();
	}

	private scheduleRepaintAll(): void {
		const win = this.deps.app.workspace.containerEl.win;
		if (this.repaintTimer !== null) win.clearTimeout(this.repaintTimer);
		this.repaintTimer = win.setTimeout(() => {
			this.repaintTimer = null;
			for (const view of this.attached) this.schedulePaint(view);
		}, REPAINT_DELAY_MS);
	}

	// -- Arrange mode -----------------------------------------------------------

	private arrangingView(): ExplorerViewShape | null {
		for (const view of this.attached) {
			if (this.attachments.get(view)?.arrange?.active === true) return view;
		}
		return null;
	}

	private arrangeDeps(view: ExplorerViewShape, container: HTMLElement): ArrangeDeps {
		return {
			container,
			scope: this.deps.app.scope,
			itemAt: (target) => this.itemAt(view, target),
			siblingsOf: (item) => this.siblingsOf(view, item),
			inScope: (item) => this.inScope(item.file.path, this.deps.settings()),
			rowBounds: (el) => {
				const box = el.getBoundingClientRect();
				return { top: box.top, bottom: box.bottom };
			},
			commit: (item, siblings, insertAt) => this.commitDrag(view, item, siblings, insertAt),
			openMenu: (item, event) => this.openRowMenu(item, event),
			refuse: () => this.deps.notice(this.deps.t('explorer.outsideScope')),
			gripLabel: this.deps.t('explorer.gripLabel'),
			onExit: () => this.exitArrange(),
		};
	}

	private itemAt(view: ExplorerViewShape, target: EventTarget | null): ExplorerItemShape | null {
		const node = target as { closest?: (selector: string) => Element | null } | null;
		const row = typeof node?.closest === 'function' ? node.closest('.tree-item-self') : null;
		const path = row?.getAttribute('data-path') ?? null;
		if (path === null) return null;
		return view.fileItems[path] ?? null;
	}

	private siblingsOf(view: ExplorerViewShape, item: ExplorerItemShape): ExplorerItemShape[] {
		const folder = item.file.parent ?? this.deps.app.vault.getRoot();
		if (typeof view.getSortedFolderItems !== 'function') return [item];
		return view.getSortedFolderItems(folder);
	}

	private commitDrag(
		view: ExplorerViewShape,
		item: ExplorerItemShape,
		siblings: ExplorerItemShape[],
		insertAt: number,
	): void {
		const names = siblings.map((sibling) => sibling.file.name);
		const name = item.file.name;
		const from = names.indexOf(name);
		if (from === -1) return;
		// The entry leaves its place before it lands, so a landing past it
		// is one nearer once it is gone.
		const target = insertAt > from ? insertAt - 1 : insertAt;
		const next = moveToIndex(names, name, target);
		if (next === null) return;
		this.writeOrder(view, item.file.parent?.path ?? '/', next);
	}

	private writeOrder(view: ExplorerViewShape, parentPath: string, names: readonly string[]): void {
		const current = this.deps.settings().explorerOrders;
		const next = recordOrder(current, parentPath, names);
		if (next !== current) this.deps.saveOrders(next);
		this.requestSort(view);
	}

	private openRowMenu(item: ExplorerItemShape, event: MouseEvent): void {
		const build = this.arrangeMenu(item.file);
		if (build === null) return;
		const menu = new Menu();
		menu.addItem((entry) =>
			entry.setSection(EXPLORER_MENU_SECTION).setIsLabel(true).setTitle(this.deps.t('plugin.name')),
		);
		build(menu, EXPLORER_MENU_SECTION);
		menu.showAtMouseEvent(event);
	}

	// -- Failure ----------------------------------------------------------------

	private reportMissing(capability: Capability): void {
		if (this.reported.has(`missing:${capability}`)) return;
		this.reported.add(`missing:${capability}`);
		console.error(
			`Snowflake: the file explorer's ${capability === 'hiding' ? 'sorting' : 'row titles'} are not where this Obsidian build was expected to keep them; that part of the explorer tools is off.`,
		);
	}

	private reportFailure(capability: Capability, error: unknown): void {
		if (this.reported.has(`failed:${capability}`)) return;
		this.reported.add(`failed:${capability}`);
		console.error(`Snowflake: the file explorer tools failed while dressing the ${capability === 'hiding' ? 'tree' : 'rows'}`, error);
	}
}
