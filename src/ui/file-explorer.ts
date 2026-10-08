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
import { isPathAtOrBelow, movedWithRename } from '../project-root';
import { patchMethod, type MethodPatch } from './method-patch';
import type { Translate } from './modals';
import { addOrderMenuItems, listNeighbours } from './order-menu';

export const EXPLORER_VIEW_TYPE = 'file-explorer';
export const EXPLORER_MENU_SECTION = 'snowflake-method';
const BADGE_CLASS = 'snowflake-method-explorer-count';
const BUTTON_CLASS = 'snowflake-method-explorer-button';
const COUNTS_OFF_CLASS = 'snowflake-method-explorer-counts-off';
/** On the scroller while only the current project is shown. */
const IMMERSIVE_CLASS = 'snowflake-method-explorer-immersive';
/**
 * The tidy button's icon: a wand with sparkles, for a view tidied up, the
 * user's pick from a sheet of candidates. An eye had stood here, and read
 * too much like the immersive cover, which is also about what is shown; the
 * lit state says whether it is on, as it does on the three buttons beside it.
 */
const TIDY_ICON = 'wand-sparkles';
/**
 * The immersive button's icon, after the reference's: three bars, the middle
 * one full and the outer two faint, which is what the cover draws over a
 * row. The host registers it with `addIcon` before any explorer is dressed.
 */
export const IMMERSIVE_ICON = 'snowflake-method-immersive';
export const IMMERSIVE_ICON_SVG = [
	'<path d="M22 28 H78" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="7" opacity="0.35"/>',
	'<path d="M20 50 H80" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="11"/>',
	'<path d="M22 72 H78" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="7" opacity="0.35"/>',
].join('');
/** On every row outside the current project while it alone is shown. */
const COVERED_CLASS = 'snowflake-method-explorer-covered';
/** How far a covered row stands from the project, 0.1 to 1, which the bar's strength follows. */
const FADE_PROPERTY = '--snowflake-method-explorer-fade';
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
	/** Whether only the current project is shown, with every other row covered. */
	explorerImmersive: boolean;
	/** The folders that stood open when the cover went up, to open again when it comes down. */
	explorerImmersiveFolds: readonly string[];
}

export interface ExplorerDeps {
	app: App;
	/** Whose life the listeners share: the plugin. */
	plugin: Component;
	t: Translate;
	settings(): ExplorerSettingsView;
	saveOrders(next: ExplorerOrders): void;
	saveToggle(key: 'explorerTidy' | 'explorerCounts' | 'explorerImmersive', value: boolean): void;
	saveFolds(paths: readonly string[]): void;
	/** The project the author is working in, as the sidebars read it: the one whose tab last came to the front. */
	currentProjectRoot(): string | null;
	/** The project folder holding a path, archived projects included, or null. */
	projectRootOf(path: string): string | null;
	/**
	 * The folders the plugin keeps beside the projects: the one that holds
	 * them (the Vault root as '/'), the archive and the export folder. The
	 * projects are arranged within the first; the other two are the plugin's
	 * own places and are reached through and through.
	 */
	pluginFolders(): { root: string; archive: string; exports: string };
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
	buttons: {
		tidy: HTMLElement | null;
		arrange: HTMLElement | null;
		counts: HTMLElement | null;
		immersive: HTMLElement | null;
	};
	arrange: ArrangeController | null;
	paintFrame: number | null;
	/** The rows the explorer shows, top to bottom, kept from one paint to the next until the tree changes. */
	order: string[] | null;
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
	/** The project the cover is drawn around, kept while the author looks elsewhere. */
	private immersiveRoot: string | null = null;
	/** Raised while the visible order is walked, so the walk's own sorts schedule no paint. */
	private walking = false;
	/** Raised while a folder is listed for its order, hidden entries and all, so the tidy filter stands aside. */
	private listingAll = false;
	/** The immersive flag as the cover last followed it, so a flag that arrived from outside is told apart from one already applied. */
	private appliedImmersive = false;

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
		plugin.registerEvent(
			app.workspace.on('active-leaf-change', () => {
				this.attachAll();
				this.followCurrentProject();
			}),
		);
		plugin.registerEvent(app.vault.on('create', (file) => this.vaultChanged('create', file)));
		plugin.registerEvent(app.vault.on('modify', (file) => this.vaultChanged('modify', file)));
		plugin.registerEvent(app.vault.on('delete', (file) => this.vaultChanged('delete', file)));
		plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => this.vaultChanged('rename', file, oldPath)),
		);
		this.pruneOrders();
		// A cover left up at the last close goes up again around the project
		// in front, with the folds as they were captured then, once a view is
		// attached to fold.
		const settings = this.deps.settings();
		this.appliedImmersive = settings.explorerImmersive;
		if (settings.explorerImmersive) this.immersiveRoot = this.deps.currentProjectRoot();
		this.attachAll();
	}

	attachAll(): void {
		if (this.disposed) return;
		const standing = new Set<ExplorerViewShape>();
		for (const leaf of this.deps.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)) {
			if (leaf.isDeferred) continue;
			const view: unknown = leaf.view;
			if (!isExplorerView(view)) continue;
			standing.add(view);
			if (!this.attachments.has(view)) this.attach(view);
		}
		// A view that left the workspace, closed or deferred, is let go of
		// here rather than through a hook on the view itself: the explorer
		// lives as long as the app, and a hook would hold this object with it.
		for (const view of [...this.attached]) {
			if (!standing.has(view)) this.detach(view);
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
		this.hiddenMemo.clear();
		this.rulesMemo = null;
	}

	// -- Settings and state ---------------------------------------------------

	settingsChanged(key: string): void {
		const settings = this.deps.settings();
		if (key === 'writingCountMode' || key === 'writingCountHeadings') this.counts.clear();
		// The settings page wrote the flag itself, or it arrived from outside
		// with the rest of the settings; either way the cover follows it. A
		// page cannot be blocked the way a dimmed button is, so arrange mode
		// steps aside for it instead.
		if (key === 'explorerImmersive' || settings.explorerImmersive !== this.appliedImmersive) {
			if (this.arranging && settings.explorerImmersive) this.exitArrange();
			this.applyImmersive(false);
			return;
		}
		this.refresh();
	}

	/**
	 * The projects were scanned again: scope may have moved, orders may name
	 * what is gone, and a cover waiting for its project may find it now, since
	 * the first scan reports after the explorer is dressed.
	 */
	projectsChanged(): void {
		this.pruneOrders();
		this.followCurrentProject();
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

	/**
	 * Shows only the current project, or every project again, and answers the
	 * state it leaves. Going up, the cover remembers which folders stood open
	 * and folds every folder outside the project; coming down, it opens them
	 * again. With no current project the mode is on all the same, and the
	 * cover goes up around the first project brought to the front.
	 */
	setImmersive(value: boolean): boolean {
		if (value && this.arranging) {
			this.deps.notice(this.deps.t('explorer.immersiveBlocked'));
			return this.deps.settings().explorerImmersive;
		}
		if (this.deps.settings().explorerImmersive !== value) {
			this.deps.saveToggle('explorerImmersive', value);
		}
		this.applyImmersive(true);
		return value;
	}

	/** Brings the cover in line with the flag as it stands; a press is told of a project still missing, a setting is not. */
	private applyImmersive(interactive: boolean): void {
		this.appliedImmersive = this.deps.settings().explorerImmersive;
		if (!this.deps.settings().explorerImmersive) {
			this.restoreFolds();
			this.immersiveRoot = null;
			this.refresh();
			return;
		}
		const root = this.deps.currentProjectRoot();
		if (root === null) {
			this.immersiveRoot = null;
			if (interactive) this.deps.notice(this.deps.t('explorer.immersiveNoProject'));
			this.refresh();
			return;
		}
		this.raiseCover(root);
	}

	/** The cover moves with the author: a tab of another project brought to the front draws it around that one. */
	followCurrentProject(): void {
		if (this.disposed || !this.deps.settings().explorerImmersive) return;
		const root = this.deps.currentProjectRoot();
		if (root === null || root === this.immersiveRoot) return;
		this.raiseCover(root);
	}

	/** Draws the cover around a project. The first time up, the open folders are remembered first. */
	private raiseCover(root: string): void {
		if (this.immersiveRoot === null) this.deps.saveFolds(this.expandedFolders());
		this.immersiveRoot = root;
		this.foldAround(root);
		this.refresh();
	}

	private expandedFolders(): string[] {
		const paths: string[] = [];
		for (const view of this.attached) {
			for (const item of Object.values(view.fileItems)) {
				if (item.collapsible === true && item.collapsed === false) paths.push(item.file.path);
			}
		}
		return paths;
	}

	/** Folds every open folder outside the project and off the way to it, and opens the way to it. */
	private foldAround(root: string): void {
		for (const view of this.attached) {
			for (const item of Object.values(view.fileItems)) {
				if (item.collapsible !== true || typeof item.setCollapsed !== 'function') continue;
				const path = item.file.path;
				const onTheWay = root === path || root.startsWith(`${path}/`);
				const inside = isPathAtOrBelow(path, root);
				if (onTheWay) {
					if (item.collapsed === true) item.setCollapsed(false, false);
				} else if (!inside && item.collapsed === false) {
					item.setCollapsed(true, false);
				}
			}
		}
	}

	private restoreFolds(): void {
		const folds = this.deps.settings().explorerImmersiveFolds;
		// With no explorer to open them in, the folds are kept for the next
		// one to attach; let go now, they would be lost for good.
		if (folds.length === 0 || this.attached.size === 0) return;
		for (const view of this.attached) {
			for (const path of folds) {
				const item = view.fileItems[path];
				if (item?.collapsed === true && typeof item.setCollapsed === 'function') {
					item.setCollapsed(false, false);
				}
			}
		}
		this.deps.saveFolds([]);
	}

	/** The saved folds moved by a rename or a delete, so a folder that changed its name while the cover was up still opens again. */
	private moveFolds(move: (path: string) => string | null): void {
		const folds = this.deps.settings().explorerImmersiveFolds;
		if (folds.length === 0) return;
		const next: string[] = [];
		let changed = false;
		for (const path of folds) {
			const moved = move(path);
			if (moved !== path) changed = true;
			if (moved !== null) next.push(moved);
		}
		if (changed) this.deps.saveFolds(next);
	}

	private covered(path: string, settings: ExplorerSettingsView): boolean {
		return (
			settings.explorerImmersive &&
			this.immersiveRoot !== null &&
			!isPathAtOrBelow(path, this.immersiveRoot)
		);
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
		// The two modes take turns: a press on the one that is blocked says
		// which mode is in the way rather than going quietly unanswered.
		if (this.deps.settings().explorerImmersive) {
			this.deps.notice(this.deps.t('explorer.arrangeBlocked'));
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
		// The entry itself must be one the tools reach, in a folder whose order they keep.
		if (!this.inScope(file.path, settings)) return null;
		if (!this.arrangeable(file.parent?.path ?? '/', settings)) return null;
		// The places are counted among the entries the author sees; the order
		// is written over the whole folder, hidden entries in their places.
		const siblings = this.siblingsOf(view, item, { all: true });
		const names = siblings.map((sibling) => sibling.file.name);
		const shown = siblings.filter(
			(sibling) => sibling === item || !settings.explorerTidy || !this.isHidden(sibling.file, settings),
		);
		const shownNames = shown.map((sibling) => sibling.file.name);
		const index = shownNames.indexOf(file.name);
		if (index === -1 || !names.includes(file.name)) return null;
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
					total: shownNames.length,
					locked: false,
					readOnly: true,
					...listNeighbours(index, shownNames.length),
					options: () =>
						shown
							.filter((sibling) => sibling !== item)
							.map((sibling) => {
								const at = shownNames.indexOf(sibling.file.name);
								return {
									id: sibling.file.name,
									index: at,
									label: `${at + 1}. ${this.labelOf(sibling, settings)}`,
								};
							}),
					move: async (toIndex) => {
						// A place among the shown entries: beside the one standing there.
						const target = shownNames[Math.max(0, Math.min(toIndex, shownNames.length - 1))];
						if (target === undefined || target === file.name) return;
						const next = moveBeside(names, file.name, target, toIndex < index ? 'before' : 'after');
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
			attachment.order = null;
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
			buttons: { tidy: null, arrange: null, counts: null, immersive: null },
			arrange: null,
			paintFrame: null,
			order: null,
			disposers: [],
		};
		this.attachments.set(view, attachment);
		this.attached.add(view);
		this.addButtons(view, attachment);
		if (container !== null) {
			// Rows come and go as the tree scrolls and folds, with no sort to
			// tell of it; each of these is followed by a paint of what shows.
			// A scroll leaves the order of the rows as it was; a click or a key
			// may have turned a fold, unless the key went into the rename box.
			const scrolled = (): void => this.schedulePaint(view);
			const changed = (event: Event): void => {
				const target = event.target as { closest?: (selector: string) => unknown } | null;
				const typing =
					event.type === 'keydown' &&
					typeof target?.closest === 'function' &&
					target.closest('.is-being-renamed') !== null;
				if (!typing) attachment.order = null;
				this.schedulePaint(view);
			};
			container.addEventListener('scroll', scrolled, { passive: true });
			container.addEventListener('click', changed, true);
			container.addEventListener('keydown', changed, true);
			attachment.disposers.push(() => {
				container.removeEventListener('scroll', scrolled);
				container.removeEventListener('click', changed, true);
				container.removeEventListener('keydown', changed, true);
			});
		}
		// A cover standing when the view arrives, resumed from the last close
		// or on by default, folds the view around the project as a press
		// would. The open folders are remembered first when none were, so that
		// coming down has something to open again. Folds kept from a cover
		// taken down while no explorer was open are opened now.
		const prefs = this.deps.settings();
		if (prefs.explorerImmersive && this.immersiveRoot !== null) {
			if (prefs.explorerImmersiveFolds.length === 0) this.deps.saveFolds(this.expandedFolders());
			this.foldAround(this.immersiveRoot);
		} else if (!prefs.explorerImmersive) {
			this.restoreFolds();
		}
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
		attachment.container?.removeClass(IMMERSIVE_CLASS);
		const renaming = view.fileBeingRenamed ?? null;
		for (const item of Object.values(view.fileItems)) {
			const badge = this.badges.get(item);
			if (badge !== undefined) {
				badge.remove();
				this.badges.delete(item);
			}
			item.selfEl.removeClass(COVERED_CLASS);
			// The rename box already holds the real name, and whatever was
			// typed over it, which a title write would take away.
			if (restoreTitles && !this.isRenaming(item, renaming)) item.updateTitle();
		}
		this.attachments.delete(view);
		this.attached.delete(view);
	}

	/**
	 * The buttons the capabilities allow, each made once. A view attached
	 * before its rows existed could not be probed for the row features, so
	 * the two buttons that need them are made when the rows arrive, and the
	 * four are put back in their one order whichever came late.
	 */
	private addButtons(view: ExplorerViewShape, attachment: Attachment): void {
		const { buttons, container } = attachment;
		let added = false;
		if (buttons.tidy === null && (this.capabilities.hiding || this.capabilities.titles)) {
			buttons.tidy = this.makeButton(view, 'tidy', TIDY_ICON, () => {
				this.setTidy(!this.deps.settings().explorerTidy);
			});
			added = true;
		}
		if (buttons.immersive === null && this.capabilities.titles && container !== null) {
			buttons.immersive = this.makeButton(view, 'immersive', IMMERSIVE_ICON, () => {
				this.setImmersive(!this.deps.settings().explorerImmersive);
			});
			added = true;
		}
		if (buttons.arrange === null && this.capabilities.hiding && container !== null) {
			buttons.arrange = this.makeButton(view, 'arrange', 'arrow-down-up', () => {
				this.toggleArrange(view);
			});
			added = true;
		}
		if (buttons.counts === null && this.capabilities.titles && container !== null) {
			buttons.counts = this.makeButton(view, 'counts', 'binary', () => {
				this.setCounts(!this.deps.settings().explorerCounts);
			});
			added = true;
		}
		if (!added) return;
		for (const button of [buttons.tidy, buttons.immersive, buttons.arrange, buttons.counts]) {
			button?.parentElement?.insertBefore(button, null);
		}
	}

	private makeButton(
		view: ExplorerViewShape,
		kind: 'tidy' | 'arrange' | 'counts' | 'immersive',
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
			TIDY_ICON,
			tidy,
			`${t(tidy ? 'explorer.tidyOn' : 'explorer.tidyOff')}\n${t(tidy ? 'explorer.tidyTurnOff' : 'explorer.tidyTurnOn')}`,
		);
		const arranging = this.arranging;
		this.paintButton(
			attachment.buttons.arrange,
			'arrow-down-up',
			attachment.arrange?.active === true,
			`${t(arranging ? 'explorer.arrangeOn' : 'explorer.arrangeOff')}\n${t(arranging ? 'explorer.arrangeTurnOff' : 'explorer.arrangeTurnOn')}`,
		);
		// Whichever mode is off while the other is on steps back, still clickable.
		attachment.buttons.arrange?.toggleClass('is-blocked', settings.explorerImmersive);
		attachment.buttons.immersive?.toggleClass('is-blocked', arranging);
		const counts = settings.explorerCounts;
		this.paintButton(
			attachment.buttons.counts,
			'binary',
			counts,
			`${t(counts ? 'explorer.countsOn' : 'explorer.countsOff')}\n${t(counts ? 'explorer.countsTurnOff' : 'explorer.countsTurnOn')}`,
		);
		attachment.container?.toggleClass(COUNTS_OFF_CLASS, !counts);
		const focus = settings.explorerImmersive;
		this.paintButton(
			attachment.buttons.immersive,
			IMMERSIVE_ICON,
			focus,
			`${t(focus ? 'explorer.immersiveOn' : 'explorer.immersiveOff')}\n${t(focus ? 'explorer.immersiveTurnOff' : 'explorer.immersiveTurnOn')}`,
		);
		attachment.container?.toggleClass(IMMERSIVE_CLASS, focus && this.immersiveRoot !== null);
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
		if (!this.itemsPatched && items.length > 0) {
			const titled = this.capabilities.titles;
			this.ensureItemPatches(items[0] ?? null);
			// The rows arrived after the views were dressed: the buttons that
			// need them are made once this sort is over, and the rows dressed.
			if (!titled && this.capabilities.titles) {
				view.containerEl.win.setTimeout(() => this.completeAttachments(), 0);
			}
		}
		const folderPath = (folder as { path?: unknown } | null)?.path;
		if (typeof folderPath !== 'string') return result;
		const settings = this.deps.settings();
		let list = items;
		if (settings.explorerTidy && !this.listingAll) {
			const renaming = view.fileBeingRenamed ?? null;
			list = list.filter((item) => item.file === renaming || !this.isHidden(item.file, settings));
		}
		if (this.arrangeable(folderPath, settings)) {
			list = applyExplorerOrder(
				settings.explorerOrders[orderKeyOf(folderPath)],
				list,
				(item) => item.file.name,
			);
		}
		if (!this.walking && !this.listingAll) {
			const attachment = this.attachments.get(view);
			if (attachment !== undefined) attachment.order = null;
			this.schedulePaint(view);
		}
		return list;
	}

	private completeAttachments(): void {
		if (this.disposed) return;
		for (const view of this.attached) {
			const attachment = this.attachments.get(view);
			if (attachment !== undefined) this.addButtons(view, attachment);
		}
		this.refresh();
	}

	/** Whether the row is the one open for renaming: its box holds what the author has typed, which no title write may touch. */
	private isRenaming(item: ExplorerItemShape, renaming: TAbstractFile | null): boolean {
		return (renaming !== null && renaming === item.file) || item.selfEl.classList.contains('is-being-renamed');
	}

	/** The dress on one row: its tidy name and its badge, unless a rename has the row. */
	private decorate(item: ExplorerItemShape): void {
		if (this.isRenaming(item, item.view?.fileBeingRenamed ?? null)) return;
		const settings = this.deps.settings();
		if (
			settings.explorerTidy &&
			settings.explorerHidePrefix &&
			this.inScope(item.file.path, settings)
		) {
			const shown = displayNameOf(item.getTitle(), true);
			if (item.innerEl.textContent !== shown) item.innerEl.setText(shown);
		}
		item.selfEl.toggleClass(COVERED_CLASS, this.covered(item.file.path, settings));
		const badge = this.ensureBadge(item, settings);
		if (badge !== null) this.fillFromMemo(item, badge);
	}

	private retitleAll(view: ExplorerViewShape): void {
		if (!this.capabilities.titles) return;
		const renaming = view.fileBeingRenamed ?? null;
		for (const item of Object.values(view.fileItems)) {
			if (!this.isRenaming(item, renaming)) item.updateTitle();
		}
	}

	private requestSort(view: ExplorerViewShape): void {
		if (view.ready === false || typeof view.requestSort !== 'function') return;
		view.requestSort();
	}

	// -- Scope, hiding and rules ----------------------------------------------

	private inScope(path: string, settings: ExplorerSettingsView): boolean {
		if (settings.explorerScope === 'vault') return true;
		if (this.deps.projectRootOf(path) !== null) return true;
		const folders = this.deps.pluginFolders();
		return isPathAtOrBelow(path, folders.archive) || isPathAtOrBelow(path, folders.exports);
	}

	/**
	 * Whether a folder's order is the author's to keep: a folder the tools
	 * reach, or one of the plugin's own places, the project list among them.
	 * Within the project list only the entries the tools reach can be moved;
	 * the author's own entries beside them keep their places.
	 */
	private arrangeable(folderPath: string, settings: ExplorerSettingsView): boolean {
		if (this.inScope(folderPath, settings)) return true;
		const folders = this.deps.pluginFolders();
		const key = folderPath.length === 0 ? '/' : folderPath;
		return key === folders.root || key === folders.archive || key === folders.exports;
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
		if (!this.inScope(file.path, settings)) return false;
		const root = this.deps.projectRootOf(file.path);
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
		if (settings.explorerImmersive && this.immersiveRoot !== null) this.shade(view, attachment.container, this.immersiveRoot);
		attachment.arrange?.decorate();
	}

	/**
	 * The strength of each covered row's bar: the further a row stands from
	 * the project, up or down the list as it is shown, the fainter it is
	 * drawn, so the eye finds the project and the shape of the rest.
	 */
	private shade(view: ExplorerViewShape, container: HTMLElement, root: string): void {
		const order = this.visibleOrder(view);
		const index = new Map(order.map((path, at) => [path, at] as const));
		let first = -1;
		let last = -1;
		for (const [at, path] of order.entries()) {
			if (!isPathAtOrBelow(path, root)) continue;
			if (first === -1) first = at;
			last = at;
		}
		const above = Math.max(1, first);
		const below = Math.max(1, order.length - 1 - last);
		for (const row of Array.from(container.querySelectorAll<HTMLElement>('.tree-item-self'))) {
			const path = row.getAttribute('data-path');
			if (path === null || !row.classList.contains(COVERED_CLASS)) continue;
			const at = index.get(path);
			let fade = 1;
			if (at !== undefined && first !== -1) {
				const distance = at < first ? first - at : at > last ? at - last : 0;
				const span = at < first ? above : below;
				fade = distance === 0 ? 0.1 : Math.max(1, Math.ceil((10 * distance) / span)) / 10;
			}
			row.setCssProps({ [FADE_PROPERTY]: String(fade) });
		}
	}

	/**
	 * Every row the explorer shows, top to bottom: the sorted children of
	 * each open folder. Kept on the attachment from one paint to the next,
	 * since a scroll paints without moving a row, and let go of by whatever
	 * may have moved one: a sort, a fold, a vault event, a refresh.
	 */
	private visibleOrder(view: ExplorerViewShape): string[] {
		const attachment = this.attachments.get(view);
		if (attachment?.order) return attachment.order;
		const order: string[] = [];
		if (typeof view.getSortedFolderItems !== 'function') return order;
		const sorted = view.getSortedFolderItems.bind(view);
		const walk = (folder: TFolder): void => {
			for (const item of sorted(folder)) {
				order.push(item.file.path);
				if (item.file instanceof TFolder && item.collapsed === false) walk(item.file);
			}
		};
		this.walking = true;
		try {
			walk(this.deps.app.vault.getRoot());
		} finally {
			this.walking = false;
		}
		if (attachment !== undefined) attachment.order = order;
		return order;
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
			const from = oldPath;
			this.moveFolds((path) => movedWithRename(path, from, file.path) ?? path);
		} else if (kind === 'delete') {
			this.counts.invalidate(file.path, { children });
			const next = deleteFromOrders(settings.explorerOrders, file.path);
			if (next !== settings.explorerOrders) this.deps.saveOrders(next);
			this.moveFolds((path) => (isPathAtOrBelow(path, file.path) ? null : path));
		} else {
			this.counts.invalidate(file.path, { children });
		}
		for (const view of this.attached) {
			const attachment = this.attachments.get(view);
			if (attachment !== undefined) attachment.order = null;
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
			siblingsOf: (item) => this.siblingsOf(view, item, { all: true }),
			reaches: (item) => this.inScope(item.file.path, this.deps.settings()),
			rowBounds: (el) => {
				const box = el.getBoundingClientRect();
				return { top: box.top, bottom: box.bottom };
			},
			commit: (item, siblings, insertAt) => this.commitDrag(view, item, siblings, insertAt),
			openMenu: (item, anchor) => this.openRowMenu(item, anchor),
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

	/**
	 * The folder's entries beside an item, in the order shown. Asked for all
	 * of them, the tidy view's hidden entries come too, each in its place:
	 * an order is written over the whole folder, so an entry the author does
	 * not see keeps the place it had rather than falling to the end once it
	 * is shown again.
	 */
	private siblingsOf(
		view: ExplorerViewShape,
		item: ExplorerItemShape,
		{ all = false } = {},
	): ExplorerItemShape[] {
		const folder = item.file.parent ?? this.deps.app.vault.getRoot();
		if (typeof view.getSortedFolderItems !== 'function') return [item];
		if (!all) return view.getSortedFolderItems(folder);
		this.listingAll = true;
		try {
			return view.getSortedFolderItems(folder);
		} finally {
			this.listingAll = false;
		}
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

	private openRowMenu(item: ExplorerItemShape, anchor: HTMLElement): void {
		const build = this.arrangeMenu(item.file);
		if (build === null) return;
		const menu = new Menu();
		menu.addItem((entry) =>
			entry.setSection(EXPLORER_MENU_SECTION).setIsLabel(true).setTitle(this.deps.t('plugin.name')),
		);
		build(menu, EXPLORER_MENU_SECTION);
		// Under the grip itself, whether a pointer or a key asked for it.
		const box = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: box.left, y: box.bottom });
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
