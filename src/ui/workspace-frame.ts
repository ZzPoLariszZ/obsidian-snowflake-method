/**
 * The frame a workspace of lanes stands in: what the timeline and the beat
 * sheet build around their tables, the same in both. The toolbar's symbols,
 * the two folds and the width that folds them by itself, the bars that stand
 * in for the scroller's own, the window the frame listens to, the focus kept
 * across a paint, the dialogs the workspace owns, the deck its cards are
 * dealt from, and the scene pool beside the lanes. What stands in a cell is
 * the lanes' cells' (`lane-cells.ts`), and the read, the queue and the
 * paint's gate are the loop's (`document-loop.ts`); this is what was left
 * around them, told twice, once the table itself is taken away.
 *
 * Each part is made on its own, from what it is handed and nothing else, so
 * the tests read each without the others. The parts that are elements, the
 * folds, the bars and the pool, are wired to one another the same way in
 * both workspaces, so `createFrame` makes them together with the boxes they
 * stand in, in the order the root, the body and the field have always held
 * their children. Whatever may change after the workspace is rendered is
 * asked for afresh through a function, never kept from the first asking:
 * the controls are read through at every call, since a project renamed or a
 * plugin unloading says another thing than it did at the render.
 */

import { getIcon, setIcon, setTooltip, type App, type Modal } from 'obsidian';

import type { CorkboardControls, CorkboardHandle, CorkboardHost, CorkboardVariant, RenderCorkboard } from './corkboard-bridge';
import type { LentFilterPopover } from './filter-rows';
import type { LaneCells } from './lane-cells';
import type { Translate } from './modals';
import { paintCount, renderEmptyLine } from './pane-parts';
import {
	SCENE_CARD_PART_CLASSES,
	SCENE_CARD_SELECTOR,
	createSceneCardDeck,
	type SceneCard,
	type SceneCardDeck,
	type SceneCardPart,
} from './scene-card';
import type { CorkboardMemory } from './story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from './view-model';

/**
 * What the frame reads and writes of what outlives a mount, which the
 * timeline's memory and the beat sheet's both hold. Which way the column
 * stands is kept under each workspace's own name for it, so that is asked of
 * the workspace.
 */
export interface FrameMemory {
	pool: CorkboardMemory;
	poolCollapsed: boolean;
	scroll: { left: number; top: number };
}

/**
 * What the frame asks of the controls a workspace was handed, which the
 * timeline's and the beat sheet's both answer. Handed over whole: the app,
 * the host, the translator and the memory are the same for as long as the
 * workspace stands, and every function is called through the controls at the
 * time of asking, never taken off them at the render.
 */
export interface FrameControls {
	app: App;
	host: CorkboardHost;
	t: Translate;
	projectPath: () => string | null;
	activateProject: () => void;
	refresh: () => Promise<void>;
	popover: LentFilterPopover;
	memory: FrameMemory;
	/** Saves the tab layout, where the pool's settings and the folds live. */
	remember: () => void;
	unloading?: () => boolean;
	corkboard: RenderCorkboard;
}

// -- The toolbar's symbols -----------------------------------------------------

/** A button of the toolbar that is a symbol alone, named for a screen reader and under the pointer. */
export function toolbarIconButton(toolbar: HTMLElement, cls: string, icon: string, label: string): HTMLButtonElement {
	const button = toolbar.createEl('button', {
		cls: `clickable-icon ${cls}`,
		attr: { type: 'button', 'aria-label': label },
	});
	setIcon(button, icon);
	setTooltip(button, label);
	return button;
}

/** The icon a symbol wears now, so a paint draws it again only when it is another. */
export interface SymbolMemo {
	icon: string;
}

/** What a symbol shows at a paint: the symbol says what stands now, its name what a press does. */
export interface SymbolFace {
	icon: string;
	label: string;
	/** Whether the switch stands on, for a symbol that is one; a symbol that is none leaves it out. */
	pressed?: boolean;
	disabled: boolean;
}

/**
 * Dresses one of the toolbar's switches. The icon and the name are written
 * only when they are others than the ones standing, so a paint that changes
 * nothing redraws no symbol and takes no tooltip from under the pointer.
 */
export function paintSymbol(button: HTMLButtonElement, memo: SymbolMemo, face: SymbolFace): void {
	if (face.icon !== memo.icon) {
		memo.icon = face.icon;
		setIcon(button, face.icon);
	}
	if (button.getAttribute('aria-label') !== face.label) {
		button.setAttribute('aria-label', face.label);
		setTooltip(button, face.label);
	}
	if (face.pressed !== undefined) button.setAttribute('aria-pressed', face.pressed ? 'true' : 'false');
	button.disabled = face.disabled;
}

// -- The folds, and the narrow rule ----------------------------------------------

/**
 * The workspace's two folds: the column that names the rows, the times or
 * the beats, folded to its names, and the pool folded away.
 */
export type Fold = 'column' | 'pool';
const FOLDS: readonly Fold[] = ['column', 'pool'];

/** What a fold's toggle is called each way, as translation keys. */
export interface FoldLabels {
	collapse: string;
	expand: string;
}

/**
 * The width, in rem, under which the workspace is narrow and folds both by
 * itself: below it the column, one whole lane and the pool no longer stand
 * side by side.
 */
export const NARROW_MAX_REM = 84;

export interface FoldsDeps {
	/** Takes the toggles' boxes as its next children, and wears the folds' classes. */
	root: HTMLElement;
	t: Translate;
	labels: Readonly<Record<Fold, FoldLabels>>;
	/** Which way the tab remembers a fold; asked at every paint, since a restored state hands the memory another word. */
	collapsed: (part: Fold) => boolean;
	/** Tells the tab's memory which way a fold stands now. */
	setCollapsed: (part: Fold, collapsed: boolean) => void;
	/** Saves the tab layout, where the folds live. */
	remember: () => void;
	/** The pool's own box, hidden while the pool is folded; asked for late, since it is built after the toggles. */
	pool: () => HTMLElement;
	invalidateRects: () => void;
	remeasurePool: () => void;
	fitScrollbars: () => void;
}

export interface Folds {
	/** Whether a part stands folded now: as the tab remembers it, or by the width alone. */
	folded: (part: Fold) => boolean;
	/** The folds as they stand, each toggle saying which way it goes next. */
	paint: () => void;
	/** Folds a part or brings it back, remembers which, and measures again for the room that moved. */
	fold: (part: Fold, collapsed: boolean) => void;
	/** Measures the workspace's own width, and folds or brings back by it when it crossed the line. */
	measureNarrow: () => void;
}

/**
 * The folds stand in the frame's corners on the strip's row, as the app's
 * sidebar toggles stand at the window's: the column's at the left, folding
 * it to its names; the pool's at the right, where the pool folds away and
 * the lanes take its room. The tab remembers which way each stands. Narrow,
 * the workspace folds both by its width alone and brings them back as it
 * widens; what the tab remembers is not touched then, and a part brought
 * back by hand meanwhile stands until the next widening.
 */
export function createFolds(deps: FoldsDeps): Folds {
	const { root, t } = deps;
	const frameWindow = root.ownerDocument.defaultView;

	const foldBox = (side: 'start' | 'end', cls: string, icon: string): HTMLButtonElement => {
		const box = root.createDiv({ cls: `snowflake-method-timeline-fold is-${side}` });
		const button = box.createEl('button', {
			cls: `clickable-icon ${cls}`,
			attr: { type: 'button' },
		});
		setIcon(button, getIcon('sidebar-toggle-button-icon') !== null ? 'sidebar-toggle-button-icon' : icon);
		return button;
	};
	// The beat sheet's column folds as the timeline's time column does, under the same classes.
	const toggles: Record<Fold, HTMLButtonElement> = {
		column: foldBox('start', 'snowflake-method-timeline-time-toggle', 'panel-left'),
		pool: foldBox('end', 'snowflake-method-timeline-pool-toggle', 'panel-right'),
	};

	/** Whether the workspace is too narrow for both parts to stand, measured from its own width. */
	let narrow = false;
	/** The parts brought back by hand while narrow, which stand until the workspace is wide again. */
	const openedNarrow = new Set<Fold>();

	const folded = (part: Fold): boolean => deps.collapsed(part) || (narrow && !openedNarrow.has(part));

	const paint = (): void => {
		for (const part of FOLDS) {
			const collapsed = folded(part);
			const toggle = toggles[part];
			const label = t(collapsed ? deps.labels[part].expand : deps.labels[part].collapse);
			if (toggle.getAttribute('aria-label') !== label) {
				toggle.setAttribute('aria-label', label);
				setTooltip(toggle, label);
			}
			toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		}
		root.toggleClass('is-time-collapsed', folded('column'));
		root.toggleClass('is-pool-collapsed', folded('pool'));
		deps.pool().toggleClass('is-hidden', folded('pool'));
	};

	const fold = (part: Fold, collapsed: boolean): void => {
		if (folded(part) === collapsed) return;
		deps.setCollapsed(part, collapsed);
		if (collapsed) openedNarrow.delete(part);
		else if (narrow) openedNarrow.add(part);
		paint();
		deps.remember();
		deps.invalidateRects();
		if (part === 'pool') deps.remeasurePool();
		else deps.fitScrollbars();
	};

	const measureNarrow = (): void => {
		const width = root.clientWidth;
		if (!(width > 0)) return;
		const rem = Number.parseFloat(frameWindow?.getComputedStyle(root.doc.documentElement).fontSize ?? '');
		const next = width < NARROW_MAX_REM * (Number.isFinite(rem) && rem > 0 ? rem : 16);
		if (next === narrow) return;
		narrow = next;
		if (!narrow) openedNarrow.clear();
		paint();
		deps.invalidateRects();
		deps.remeasurePool();
	};

	for (const part of FOLDS) {
		toggles[part].addEventListener('click', () => {
			fold(part, !folded(part));
		});
	}

	return { folded, paint, fold, measureNarrow };
}

/**
 * Hears the frame's boxes change size, for the narrow rule and the bars to
 * be measured again. Hands back the way to stop hearing them.
 */
export function watchFrameSize(root: HTMLElement, boxes: readonly HTMLElement[], resized: () => void): () => void {
	const frameWindow = root.ownerDocument.defaultView;
	const observer = frameWindow === null ? null : new frameWindow.ResizeObserver(resized);
	for (const box of boxes) observer?.observe(box);
	return () => {
		observer?.disconnect();
	};
}

// -- The stand-in scrollbars -----------------------------------------------------

/**
 * The least room, in px, the bar across must have past the columns that keep
 * their place to be shown at all: a thumb's worth, and a little to spare.
 */
export const SCROLL_ROOM_MIN = 48;

export interface StandInScrollbarsDeps {
	/** What the scroller stands in; the bars are made in it, after the scroller. */
	field: HTMLElement;
	scroller: HTMLElement;
	/** Where the scroller stands, said as it moves, for the tab to keep. */
	scrolled: (at: { left: number; top: number }) => void;
}

export interface StandInScrollbars {
	/**
	 * Sizes the bars to the scroller's overflow. The one across starts `start`
	 * px in, past the columns that keep their place, and never runs under
	 * them; a field that leaves it too little room past them to take hold of
	 * goes without it, and the wheel still scrolls. The one down starts under
	 * a head `headHeight` px tall, which the scroller must be taller than, or
	 * at the field's top when the table has no head row.
	 */
	fit: (start: number, headHeight?: number) => void;
}

/**
 * The scroller's own bars are hidden; two stand in for them, one across
 * under the lanes alone and one down beside the rows alone, so neither runs
 * along a head or a column that keeps its place. Each holds a spacer as long
 * as the scroller's overflow past the part it skips, and the three are kept
 * in step both ways.
 */
export function createStandInScrollbars(deps: StandInScrollbarsDeps): StandInScrollbars {
	const { field, scroller } = deps;
	const bars = {
		across: field.createDiv({ cls: 'snowflake-method-timeline-scrollbar is-across is-hidden', attr: { 'aria-hidden': 'true' } }),
		down: field.createDiv({ cls: 'snowflake-method-timeline-scrollbar is-down is-hidden', attr: { 'aria-hidden': 'true' } }),
	};
	const barSpace = {
		across: bars.across.createDiv({ cls: 'snowflake-method-timeline-scrollbar-space' }),
		down: bars.down.createDiv({ cls: 'snowflake-method-timeline-scrollbar-space' }),
	};
	scroller.addEventListener('scroll', () => {
		if (bars.across.scrollLeft !== scroller.scrollLeft) bars.across.scrollLeft = scroller.scrollLeft;
		if (bars.down.scrollTop !== scroller.scrollTop) bars.down.scrollTop = scroller.scrollTop;
		// The tab keeps where the lanes stand, so a turn to another workspace
		// and back finds them where they were left.
		deps.scrolled({ left: scroller.scrollLeft, top: scroller.scrollTop });
	});
	bars.across.addEventListener('scroll', () => {
		if (scroller.scrollLeft !== bars.across.scrollLeft) scroller.scrollLeft = bars.across.scrollLeft;
	});
	bars.down.addEventListener('scroll', () => {
		if (scroller.scrollTop !== bars.down.scrollTop) scroller.scrollTop = bars.down.scrollTop;
	});
	// A wheel over a bar moves the whole scroller, both ways, as over the lanes.
	const wheelThrough = (event: WheelEvent): void => {
		event.preventDefault();
		scroller.scrollBy({ left: event.deltaX, top: event.deltaY });
	};
	bars.across.addEventListener('wheel', wheelThrough, { passive: false });
	bars.down.addEventListener('wheel', wheelThrough, { passive: false });

	const fit = (start: number, headHeight?: number): void => {
		const across = scroller.scrollWidth - scroller.clientWidth;
		const down = scroller.scrollHeight - scroller.clientHeight;
		const wide = Number.isFinite(across) && across > 0 && scroller.clientWidth - start >= SCROLL_ROOM_MIN;
		const tall = Number.isFinite(down) && down > 0 && (headHeight === undefined || scroller.clientHeight > headHeight);
		bars.across.toggleClass('is-hidden', !wide);
		bars.down.toggleClass('is-hidden', !tall);
		// Shown together, each stops short of the other at the corner; a bar's
		// spacer then reaches the scroller's overflow past the bar's own length.
		bars.across.toggleClass('is-short', wide && tall);
		bars.down.toggleClass('is-short', wide && tall);
		if (wide) {
			bars.across.setCssStyles({ insetInlineStart: `${start}px` });
			barSpace.across.setCssStyles({ width: `${across + bars.across.clientWidth}px` });
			bars.across.scrollLeft = scroller.scrollLeft;
		}
		if (tall) {
			bars.down.setCssStyles({ insetBlockStart: `${headHeight ?? 0}px` });
			barSpace.down.setCssStyles({ height: `${down + bars.down.clientHeight}px` });
			bars.down.scrollTop = scroller.scrollTop;
		}
	};

	return { fit };
}

// -- The window the frame listens to ---------------------------------------------

export interface FrameWindowDeps {
	root: HTMLElement;
	deck: Pick<SceneCardDeck<SceneCard>, 'releasePress' | 'closeColorPanel'>;
	invalidateRects: () => void;
}

/**
 * Binds the frame to the window it stands in, and to the next when the view
 * is moved to another. What was measured is dropped as the window scrolls or
 * is resized. The deck holds a card still while one of its controls is
 * pressed; the release lands anywhere, so the window hears it, as under the
 * corkboard. Hands back the way to let the window go: the migration first,
 * then the window standing.
 */
export function bindFrameWindow(deps: FrameWindowDeps): () => void {
	const { root, deck, invalidateRects } = deps;
	let eventWindow = root.win;
	const bindWindow = (win: Window): void => {
		win.addEventListener('scroll', invalidateRects, true);
		win.addEventListener('resize', invalidateRects);
		win.addEventListener('mouseup', deck.releasePress, true);
	};
	const unbindWindow = (win: Window): void => {
		win.removeEventListener('scroll', invalidateRects, true);
		win.removeEventListener('resize', invalidateRects);
		win.removeEventListener('mouseup', deck.releasePress, true);
	};
	bindWindow(eventWindow);
	const stopMigration = root.onWindowMigrated?.((win) => {
		unbindWindow(eventWindow);
		eventWindow = win;
		bindWindow(eventWindow);
		// A colour panel hangs in the body of the window it was opened in, with
		// the presses that dismiss it bound there too. It goes before the card
		// leaves that window, as the corkboard's does, or it is left behind
		// over whatever the old window shows next.
		deck.closeColorPanel();
		deck.releasePress();
		invalidateRects();
	});
	return () => {
		stopMigration?.();
		unbindWindow(eventWindow);
	};
}

// -- Focus custody ---------------------------------------------------------------

/** Where the focus stood before a paint: on a card's part, or on any other control. */
export type FocusHold =
	| { kind: 'card'; key: string; part: SceneCardPart }
	| { kind: 'element'; el: Element };

export interface FocusCustody {
	/** Where the focus stands now, when it stands within the workspace. */
	hold: () => FocusHold | null;
	/** Gives the focus back where it stood, to the same part of the same card, or to the scroller. */
	giveBack: (hold: FocusHold | null) => void;
	/** Saves the conflict box holding the focus, when one of the deck's cards has it; true when a box was saved. */
	saveConflict: () => boolean;
}

/**
 * A paint may remake the very control the author stands on. Where the focus
 * stood is noted before the paint and given back after it, never scrolling:
 * the author did not ask to go anywhere.
 */
export function createFocusCustody(
	root: HTMLElement,
	scroller: HTMLElement,
	deck: Pick<SceneCardDeck<SceneCard>, 'cards' | 'partOf' | 'commitConflict'>,
): FocusCustody {
	const hold = (): FocusHold | null => {
		const active = root.doc.activeElement;
		if (active === null || !root.contains(active)) return null;
		const card = active.closest(SCENE_CARD_SELECTOR);
		if (card === null) return { kind: 'element', el: active };
		const part = SCENE_CARD_PART_CLASSES.find(([, cls]) => active.classList.contains(cls))?.[0] ?? 'card';
		return { kind: 'card', key: card.getAttribute('data-key') ?? '', part };
	};

	const giveBack = (held: FocusHold | null): void => {
		if (held === null) return;
		const doc = root.doc;
		const active = doc.activeElement;
		if (active !== null && active !== doc.body && root.contains(active)) return;
		let target: Element | null = null;
		if (held.kind === 'card') {
			const card = deck.cards.get(held.key);
			if (card?.el.isConnected === true) target = deck.partOf(card, held.part);
		} else if (root.contains(held.el)) {
			target = held.el;
		}
		((target ?? scroller) as HTMLElement).focus({ preventScroll: true });
	};

	const saveConflict = (): boolean => {
		const active = root.doc.activeElement;
		for (const card of deck.cards.values()) {
			if (card.conflict !== active) continue;
			deck.commitConflict(card);
			return true;
		}
		return false;
	};

	return { hold, giveBack, saveConflict };
}

// -- The dialogs the workspace owns ----------------------------------------------

export interface ModalKeeper {
	/** Takes a dialog into the workspace's keeping until it closes, and hands it back to be opened. */
	keep: <T extends Modal>(modal: T) => T;
	/** Closes every dialog still standing, as the workspace goes; `failed` is what is logged for one that would not close. */
	closeAll: (failed: string) => void;
}

/**
 * Forms and pickers belong to the workspace that opened them, and go when it
 * goes; recovered words deliberately outlive it, and are never kept here.
 */
export function createModalKeeper(): ModalKeeper {
	const standing = new Set<Modal>();
	const keep = <T extends Modal>(modal: T): T => {
		standing.add(modal);
		const closed = modal.onClose.bind(modal);
		modal.onClose = (): void => {
			standing.delete(modal);
			closed();
		};
		return modal;
	};
	const closeAll = (failed: string): void => {
		// Each dialog is closed on its own: one that throws on the way out
		// would otherwise take the words settled after it with it, and those
		// are the author's, with no second chance once the workspace has gone.
		for (const modal of [...standing]) {
			try {
				modal.close();
			} catch (error) {
				console.error(failed, error);
			}
		}
		standing.clear();
	};
	return { keep, closeAll };
}

// -- The deck the lanes' cards are dealt from ------------------------------------

export interface LaneDeckDeps {
	controls: FrameControls;
	notice: (error: unknown) => void;
	/** The model the workspace last painted from. */
	model: () => ProjectDashboardModel | null;
	readOnly: () => boolean;
	/** The cells, asked for late since they are made after the deck: they say whether a card may drag, and open its menu. */
	cells: () => Pick<LaneCells, 'dragAllowed' | 'openCardMenu'>;
}

export interface LaneDeck {
	deck: SceneCardDeck<SceneCard>;
	/**
	 * What the cards read off the model, keyed afresh. Every part of it is the
	 * model's own and says the same thing for as long as the model does, so it
	 * is asked for only when the model is another: a paint over the model that
	 * stands would else build some thousands of entries to say what they
	 * already said.
	 */
	index: (model: ProjectDashboardModel | null) => void;
	/** The head of a full paint: a refresh can follow metadata resolution even with the same model, so links resolve afresh. */
	beginPaint: () => void;
	scenesById: () => ReadonlyMap<string, SceneViewModel>;
	/** Each scene's place in the narrative order, which its card's circle shows. */
	sceneIndex: () => ReadonlyMap<string, number>;
}

/**
 * The cards in the lanes are the corkboard's, dealt from the same kind of
 * deck. It is told what the pool's is: a draft refused as the plugin goes has
 * no dialog left to open that the plugin could own.
 */
export function createLaneDeck(deps: LaneDeckDeps): LaneDeck {
	const { controls } = deps;
	const { app, host, t } = controls;
	let scenesById = new Map<string, SceneViewModel>();
	let sceneIndex = new Map<string, number>();
	let charactersByPath = new Map<string, ProjectDashboardModel['characters'][number]>();
	let manuscriptPositions = new Map<string, number>();
	let resolvedManuscriptPaths = new Map<string, Map<string, string | null>>();

	/** One resolution per target/source during a full paint. */
	const resolveManuscriptPath = (target: string, sourcePath: string): string | null => {
		let paths = resolvedManuscriptPaths.get(sourcePath);
		if (paths === undefined) {
			paths = new Map();
			resolvedManuscriptPaths.set(sourcePath, paths);
		}
		if (!paths.has(target)) paths.set(target, app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null);
		return paths.get(target) ?? null;
	};

	const deck: SceneCardDeck<SceneCard> = createSceneCardDeck<SceneCard>({
		app,
		host,
		t,
		notice: deps.notice,
		refresh: () => controls.refresh(),
		model: deps.model,
		projectPath: () => controls.projectPath(),
		readOnly: deps.readOnly,
		unloading: () => controls.unloading?.() === true,
		charactersByPath: () => charactersByPath,
		scenesById: () => scenesById,
		manuscriptPositions: () => manuscriptPositions,
		resolveManuscriptPath,
		dragAllowed: (card) => deps.cells().dragAllowed(card),
		menu: (card, event) => {
			deps.cells().openCardMenu(card, event);
		},
		extend: (card) => card,
	});

	return {
		deck,
		index: (model) => {
			manuscriptPositions = new Map(model?.manuscriptPaths.map((path, index) => [path, index]));
			scenesById = new Map(model?.scenes.map((scene) => [scene.id, scene]) ?? []);
			sceneIndex = new Map(model?.scenes.map((scene, index) => [scene.id, index]) ?? []);
			charactersByPath = new Map(model?.characters.map((character) => [character.path, character]) ?? []);
		},
		beginPaint: () => {
			resolvedManuscriptPaths = new Map();
			deck.beginPaint();
		},
		scenesById: () => scenesById,
		sceneIndex: () => sceneIndex,
	};
}

// -- The scene pool --------------------------------------------------------------

export interface ScenePoolDeps {
	controls: FrameControls;
	/** Wears the card style the pool's display control chose. */
	root: HTMLElement;
	/** Where the pool stands, after the field. */
	body: HTMLElement;
	/** The model the workspace last painted from. */
	model: () => ProjectDashboardModel | null;
	invalidateRects: () => void;
}

export interface ScenePool {
	el: HTMLElement;
	/**
	 * Deals the pool, once the cells stand to say how its cards leave for them
	 * and come back: the workspace's own line for a pool with nothing to
	 * offer, and what the cells hand over.
	 */
	mount: (variant: Pick<CorkboardVariant, 'emptyText' | 'menuItems' | 'dragOut' | 'dropIn'>) => void;
	/** The workspace's cards wear the style the pool's display control chose; the CSS reads it off the root. */
	paintCardMode: () => void;
	/** The pool follows what is on show: the scenes placed there leave it, and the count says what is left. */
	paint: (assigned: Set<string>) => void;
	reveal: (id: string) => void;
	remeasure: () => void;
	saveFocusedConflict: () => boolean;
	dispose: () => void;
}

/**
 * The pool is the corkboard in one column, showing what the lane or the
 * sheet on show has not placed; its search, funnel, grouping and order are
 * its own, and the card style it chooses dresses the workspace's cards as
 * well. Its head stands level with the lane heads: the name, and how many
 * scenes it holds.
 */
export function createScenePool(deps: ScenePoolDeps): ScenePool {
	const { controls, root } = deps;
	const { app, host, t, memory } = controls;
	const el = deps.body.createEl('aside', {
		cls: 'snowflake-method-timeline-pool',
		attr: { 'aria-label': t('timeline.pool') },
	});
	const head = el.createDiv({ cls: 'snowflake-method-timeline-pool-head' });
	head.createSpan({
		cls: 'snowflake-method-timeline-pool-name',
		text: t('timeline.pool'),
		attr: { role: 'heading', 'aria-level': '3' },
	});
	const count = head.createSpan({
		cls: 'snowflake-method-step-indicator snowflake-method-timeline-pool-count',
	});
	const poolHost = el.createDiv({ cls: 'snowflake-method-corkboard-host' });
	/** The scenes what is on show has placed, which the pool leaves out. */
	let assigned = new Set<string>();
	let handle: CorkboardHandle | null = null;

	const paintCardMode = (): void => {
		if (root.dataset.mode === memory.pool.mode) return;
		root.dataset.mode = memory.pool.mode;
		deps.invalidateRects();
	};

	const mount = (variant: Pick<CorkboardVariant, 'emptyText' | 'menuItems' | 'dragOut' | 'dropIn'>): void => {
		const poolControls: CorkboardControls = {
			app,
			host,
			t,
			model: deps.model,
			activateProject: () => {
				controls.activateProject();
			},
			refresh: () => controls.refresh(),
			unloading: () => controls.unloading?.() === true,
			popover: controls.popover,
			memory: memory.pool,
			remember: () => {
				controls.remember();
				paintCardMode();
			},
		};
		handle = controls.corkboard(poolHost, poolControls, {
			include: (scene) => !assigned.has(scene.id),
			addButton: 'icon',
			// The pool is one card wide, which leaves the band no room for the words
			// in its search field beside the five controls that follow them.
			searchLabel: 'quiet',
			columns: 1,
			// One column has no insertion buttons to leave room for between cards.
			gap: 0.75,
			modeShared: true,
			...variant,
		});
	};

	return {
		el,
		mount,
		paintCardMode,
		paint: (next) => {
			assigned = next;
			const model = deps.model();
			paintCount(count, model === null ? 0 : model.scenes.filter((scene) => !assigned.has(scene.id)).length);
			handle?.refresh();
		},
		reveal: (id) => {
			handle?.reveal(id);
		},
		remeasure: () => {
			handle?.remeasure();
		},
		saveFocusedConflict: () => handle?.saveFocusedConflict() ?? false,
		dispose: () => {
			handle?.dispose();
			handle = null;
		},
	};
}

// -- The frame, made together ----------------------------------------------------

export interface FrameDeps {
	controls: FrameControls;
	/** Takes the folds' toggles, the empty line and the body as its next children; the toolbar is made before them. */
	root: HTMLElement;
	foldLabels: Readonly<Record<Fold, FoldLabels>>;
	/** Which way the tab remembers the column, kept under the workspace's own name for it. */
	columnCollapsed: () => boolean;
	setColumnCollapsed: (collapsed: boolean) => void;
	/** The model the workspace last painted from. */
	model: () => ProjectDashboardModel | null;
	/** Drops what the workspace and its cells measured for a drag. */
	invalidateRects: () => void;
	/**
	 * The workspace's own measure of where the bars start, which is its table's
	 * to say: it is handed the fit, and calls it with what it measured.
	 */
	placeScrollbars: (fit: StandInScrollbars['fit']) => void;
}

export interface Frame {
	scroller: HTMLElement;
	/** The table the workspace lays its rows in, empty as it is handed over. */
	table: HTMLElement;
	folds: Folds;
	pool: ScenePool;
	/** A word in the body's place, with nothing to press: the ways in stand in the toolbar. Null brings the body back. */
	showEmpty: (text: string | null) => void;
	fitScrollbars: () => void;
	/**
	 * Gives back the scroll the tab remembers, once the table is long enough
	 * to take it. Only once: a later paint must not pull the author away from
	 * wherever they have scrolled since.
	 */
	giveScrollBack: () => void;
	/** Shows a scene's card in the pool, which can only be done in a pool that stands. */
	reveal: (id: string) => void;
	remeasure: () => void;
	stopWatchingSize: () => void;
}

/**
 * Everything of the frame that is an element, made in the order the
 * workspaces always made it: the folds' toggles in the root's corners, the
 * line said in the body's place, then the body, holding the field, with the
 * scroller, the table and the stand-in bars, and the pool beside it. The
 * workspace makes its toolbar before this and fills the table after it.
 */
export function createFrame(deps: FrameDeps): Frame {
	const { controls, root } = deps;
	const { t, memory } = controls;

	const folds = createFolds({
		root,
		t,
		labels: deps.foldLabels,
		collapsed: (part) => (part === 'column' ? deps.columnCollapsed() : memory.poolCollapsed),
		setCollapsed: (part, collapsed) => {
			if (part === 'column') deps.setColumnCollapsed(collapsed);
			else memory.poolCollapsed = collapsed;
		},
		remember: () => {
			controls.remember();
		},
		pool: () => pool.el,
		invalidateRects: deps.invalidateRects,
		remeasurePool: () => {
			pool.remeasure();
		},
		fitScrollbars: () => {
			fitScrollbars();
		},
	});

	const empty = renderEmptyLine(root, '');
	const body = root.createDiv({ cls: 'snowflake-method-timeline-body is-hidden' });
	const field = body.createDiv({ cls: 'snowflake-method-timeline-field' });
	const scroller = field.createDiv({
		cls: 'snowflake-method-timeline-scroll',
		attr: { tabindex: '-1' },
	});
	const table = scroller.createDiv({ cls: 'snowflake-method-timeline-table' });

	const scrollbars = createStandInScrollbars({
		field,
		scroller,
		scrolled: (at) => {
			memory.scroll = at;
		},
	});
	const fitScrollbars = (): void => {
		deps.placeScrollbars(scrollbars.fit);
	};

	const pool = createScenePool({ controls, root, body, model: deps.model, invalidateRects: deps.invalidateRects });

	const stopWatchingSize = watchFrameSize(root, [root, scroller, table], () => {
		folds.measureNarrow();
		fitScrollbars();
	});

	/** Whether the scroll the tab remembers has been given back, which is done once. */
	let scrollGivenBack = false;

	return {
		scroller,
		table,
		folds,
		pool,
		showEmpty: (text) => {
			empty.line.toggleClass('is-hidden', text === null);
			body.toggleClass('is-hidden', text !== null);
			root.toggleClass('is-empty', text !== null);
			if (text !== null) empty.text.setText(text);
		},
		fitScrollbars,
		giveScrollBack: () => {
			if (scrollGivenBack) return;
			scrollGivenBack = true;
			if (memory.scroll.left !== 0) scroller.scrollLeft = memory.scroll.left;
			if (memory.scroll.top !== 0) scroller.scrollTop = memory.scroll.top;
		},
		reveal: (id) => {
			folds.fold('pool', false);
			pool.reveal(id);
		},
		remeasure: () => {
			deps.invalidateRects();
			fitScrollbars();
			pool.remeasure();
		},
		stopWatchingSize,
	};
}
