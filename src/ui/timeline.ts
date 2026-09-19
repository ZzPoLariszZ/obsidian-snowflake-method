/**
 * The timeline workspace: the story laid along its times, one lane per
 * timeline, under one view of the several the author may keep. The document
 * the lanes are drawn from is the bridge's; the names on the lanes, the
 * times and the cards are the project model's; every change the workspace
 * makes goes through one queue, each followed by a read of the document
 * before the next runs. What the workspace computes is in
 * `timeline-layout.ts`; this is the drawing, and the rules of the drawing:
 *
 * - Every level is keyed and kept: a head per timeline, a row per time, a
 *   cell per lane in a row, a sub-row per sub-description, a card per scene
 *   placed. A paint dresses what stands and moves only what is out of
 *   place, so a control holding the focus is still there afterwards.
 * - The cards are the corkboard's, dealt from the same deck, standing in
 *   the flow of their row rather than on a canvas.
 */

import { Menu, Notice, getIcon, setIcon, setTooltip, type Modal } from 'obsidian';

import {
	derivedPresentation,
	entityRosterById,
	findTimelineView,
	resolveEntityRef,
	type EntityRef,
	type EntityRosterEntry,
	type ScenePresentation,
	type Timeline,
	type TimelineDocument,
	type TimelineTime,
	type TimelineView,
} from '../domain';
import { entityGroupLabel } from './entity-form';
import { promptForEntityReference, type EntityReferenceSource } from './modals';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';
import type { CorkboardControls, CorkboardHandle } from './corkboard-bridge';
import { createDocumentLoop, type DocumentLoop } from './document-loop';
import { createLaneCells, type Lane, type LaneCell, type LaneCells, type SceneScope } from './lane-cells';
import { paintCount, renderEmptyLine } from './pane-parts';
import {
	SCENE_CARD_PART_CLASSES,
	SCENE_CARD_SELECTOR,
	controlWithin,
	createSceneCardDeck,
	type SceneCard,
	type SceneCardDeck,
	type SceneCardPart,
} from './scene-card';
import { planCardMoves, planCardRepaint } from './sticky-note-layout';
import { dropIndexAt } from './task-board-rows';
import {
	TIMELINE_ROW_DRAG_TYPE,
	TIMELINE_SCENE_DRAG_TYPE,
	TIMELINE_TIME_DRAG_TYPE,
	type RenderTimeline,
	type TimelineHandle,
	type TimelineReading,
} from './timeline-bridge';
import {
	AddTimelineModal,
	TimelineTimePickModal,
	TimelineViewFormModal,
	confirmTimelineAction,
	renameTimelineForm,
} from './timeline-forms';
import {
	assignedSceneIds,
	laneCell,
	laneOrder,
	layoutKind,
	reorderIds,
	resolveActiveTimeline,
	stackKey,
	unionRows,
	type TimeRowModel,
	type TimelineDrag,
} from './timeline-layout';
import {
	kindEntities,
	type ProjectDashboardModel,
	type SceneViewModel,
	type WorldbuildingEntityViewModel,
} from './view-model';

/** A lane's header: the element and the parts a dressing rewrites. */
interface LaneHead {
	id: string;
	el: HTMLElement;
	pin: HTMLElement;
	name: HTMLButtonElement;
	entity: HTMLButtonElement;
	/** The bound note, while the project still has it; a click opens its form. */
	entityRef: EntityRef | null;
	more: HTMLButtonElement;
	timeline: Timeline;
}

/** One lane's cell in a time row: the axis, the pluses, and what stands in it. */
interface CellEntry {
	timelineId: string;
	el: HTMLElement;
	axis: HTMLElement;
	/** The plus that puts the time on the lane, while the lane lacks it. */
	add: HTMLButtonElement | null;
	/** The plus on the rule above the cell, which puts a time on this lane before the row. */
	seamAdd: HTMLButtonElement;
	body: LaneCell;
}

/** One shared time row: the time's own cell, and a cell per lane. */
interface RowEntry {
	timeId: string;
	el: HTMLElement;
	handle: HTMLButtonElement;
	label: HTMLButtonElement;
	description: HTMLButtonElement;
	more: HTMLButtonElement;
	/** The plus on the rule above the row, which puts a time in before it. */
	seamAdd: HTMLButtonElement;
	time: WorldbuildingEntityViewModel | null;
	cells: Map<string, CellEntry>;
}

/** Where the focus stood before a paint: on a card's part, or on any other control. */
type FocusHold =
	| { kind: 'card'; key: string; part: SceneCardPart }
	| { kind: 'element'; el: Element };

/** The least room, in px, the bar across must have past the frozen columns to be shown at all: a thumb's worth, and a little to spare. */
const SCROLL_ROOM_MIN = 48;

/** The workspace's two folds: the time column to its names, and the pool away. */
type Fold = 'time' | 'pool';
const FOLDS: readonly Fold[] = ['time', 'pool'];

/**
 * The width, in rem, under which the workspace is narrow and folds both by
 * itself: below it the time column, one whole lane and the pool no longer
 * stand side by side.
 */
const NARROW_MAX_REM = 84;

/**
 * All of a document that the workspace lays out, as one string: its
 * timelines, its views and the pin. Which view was opened last is read only
 * when the one picked has gone, and then the views differ too.
 */
const drawnSignatures = new WeakMap<TimelineDocument, string>();
const drawnSignature = (held: TimelineDocument): string => {
	let signature = drawnSignatures.get(held);
	if (signature === undefined) {
		signature = JSON.stringify([held.timelines, held.views, held.pinnedTimelineId]);
		drawnSignatures.set(held, signature);
	}
	return signature;
};

/** Whether two documents lay the workspace out the same, whatever else in them differs. */
function drawnAlike(painted: unknown, held: unknown): boolean {
	if (typeof painted !== 'object' || painted === null || typeof held !== 'object' || held === null) return false;
	return drawnSignature(painted as TimelineDocument) === drawnSignature(held as TimelineDocument);
}

export const renderTimeline: RenderTimeline = (container, controls) => {
	const { app, host, t, memory } = controls;
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-timeline snowflake-method-scene-cards',
	});

	const notice = (error: unknown): void => {
		new Notice(error instanceof Error ? error.message : t('errors.unknown'));
	};

	// -- The toolbar ---------------------------------------------------------

	// The toolbar rides the strip's row above the lanes, as the corkboard's
	// band does: the view where the time column stands, the tools at the
	// field's end, and the pool's own band beyond them.
	const toolbar = root.createDiv({
		cls: 'snowflake-method-timeline-toolbar',
		attr: { role: 'toolbar', 'aria-label': t('timeline.toolbar') },
	});
	// The view is typed into, searched and picked from, as a form's category
	// is. The field is built once the views are read, since one built with
	// nothing to offer stays a dead end.
	const viewHost = toolbar.createDiv({ cls: 'snowflake-method-timeline-view-select' });
	const chooseView = (chosen: string): void => {
		if (chosen.length === 0 || chosen === viewId) return;
		viewId = chosen;
		paintAll();
		// The view is shown already; this only writes down which one was opened
		// last, which nothing on screen is drawn from. No paint is asked for after
		// it, and the bell its write rings brings back a document that lays out as
		// the one shown does, which the loop is told, so none follows it either.
		void enqueue(async () => {
			await controls.bridge().setLastView(chosen);
		}, 'nothing');
	};
	const stateText = toolbar.createSpan({ cls: 'snowflake-method-prose-state' });
	const iconButton = (cls: string, icon: string, label: string): HTMLButtonElement => {
		const button = toolbar.createEl('button', {
			cls: `clickable-icon ${cls}`,
			attr: { type: 'button', 'aria-label': label },
		});
		setIcon(button, icon);
		setTooltip(button, label);
		return button;
	};
	const editViewButton = iconButton('snowflake-method-timeline-view-edit', 'pencil', t('timeline.view.edit'));
	editViewButton.addEventListener('click', () => {
		openEditView();
	});
	// The sub-descriptions and the presentation switch from one symbol each:
	// the symbol shows what stands now, the tooltip says what a press does.
	// An eye for the words shown and an eye struck out for them hidden; the
	// scenes side by side, or in layers with one in front. Both choices are
	// the view's, so they are written to the document. Each press takes the
	// value the document holds as its write lands, never the one it held when
	// the press came: two presses in a breath answer each other, rather than
	// writing one value twice and leaving the view where the first put it. The
	// view, though, is the one the press was made on: another opened while the
	// press waits its turn in the queue is not the one it was aimed at.
	const wordsButton = iconButton('snowflake-method-timeline-words', 'eye', t('timeline.view.subDescriptionsHide'));
	wordsButton.setAttribute('aria-pressed', 'true');
	wordsButton.addEventListener('click', () => {
		const aimed = currentView();
		if (readOnly || aimed === null) return;
		void enqueue(async () => {
			const now = viewAsStands(aimed.id);
			if (now === null) return;
			await controls.bridge().setViewSubDescriptions(now.id, !now.showSubDescriptions);
		});
	});
	const presentationButton = iconButton('snowflake-method-timeline-presentation', 'gallery-horizontal', t('timeline.presentation.toStack'));
	presentationButton.addEventListener('click', () => {
		choosePresentation();
	});
	const choosePresentation = (): void => {
		const aimed = currentView();
		if (readOnly || aimed === null) return;
		void enqueue(async () => {
			const now = viewAsStands(aimed.id);
			if (now === null) return;
			const value: ScenePresentation = derivedPresentation(now) === 'flat' ? 'stack' : 'flat';
			await controls.bridge().setViewPresentation(now.id, value);
		});
	};
	// The times run down the view first to last; the order symbol turns them
	// about, the latest first, and leaves what stands under each as it is.
	// The choice is the view's too, written with the rest.
	const orderButton = iconButton('snowflake-method-timeline-order', 'arrow-down-narrow-wide', t('timeline.order.reverse'));
	orderButton.setAttribute('aria-pressed', 'false');
	orderButton.addEventListener('click', () => {
		const aimed = currentView();
		if (readOnly || aimed === null) return;
		void enqueue(async () => {
			const now = viewAsStands(aimed.id);
			if (now === null) return;
			await controls.bridge().setViewTimesReversed(now.id, !now.timesReversed);
		});
	});
	const refreshButton = iconButton('snowflake-method-timeline-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().then(() => reload()).catch(notice);
	});
	const addTimelineButton = toolbar.createEl('button', {
		cls: 'mod-cta snowflake-method-timeline-add-timeline',
		text: t('timeline.addTimeline'),
		attr: { type: 'button' },
	});
	addTimelineButton.addEventListener('click', () => {
		void addTimeline(true);
	});
	const addViewButton = toolbar.createEl('button', {
		cls: 'mod-cta snowflake-method-timeline-view-add',
		text: t('timeline.view.add'),
		attr: { type: 'button' },
	});
	addViewButton.addEventListener('click', () => {
		openAddView();
	});
	// The folds stand in the frame's corners on the strip's row, as the
	// app's sidebar toggles stand at the window's: the time column's at the
	// left, folding the column to its names; the pool's at the right, where
	// the pool folds away and the lanes take its room. The tab remembers
	// which way each stands.
	const foldBox = (side: 'start' | 'end', cls: string, icon: string): HTMLButtonElement => {
		const box = root.createDiv({ cls: `snowflake-method-timeline-fold is-${side}` });
		const button = box.createEl('button', {
			cls: `clickable-icon ${cls}`,
			attr: { type: 'button' },
		});
		setIcon(button, getIcon('sidebar-toggle-button-icon') !== null ? 'sidebar-toggle-button-icon' : icon);
		return button;
	};
	const foldToggles: Record<Fold, HTMLButtonElement> = {
		time: foldBox('start', 'snowflake-method-timeline-time-toggle', 'panel-left'),
		pool: foldBox('end', 'snowflake-method-timeline-pool-toggle', 'panel-right'),
	};
	for (const part of FOLDS) {
		foldToggles[part].addEventListener('click', () => {
			fold(part, !folded(part));
		});
	}

	// -- The empty states, and the body --------------------------------------

	const empty = renderEmptyLine(root, '');
	const body = root.createDiv({ cls: 'snowflake-method-timeline-body is-hidden' });
	const field = body.createDiv({ cls: 'snowflake-method-timeline-field' });
	const scroller = field.createDiv({
		cls: 'snowflake-method-timeline-scroll',
		attr: { tabindex: '-1' },
	});
	const table = scroller.createDiv({ cls: 'snowflake-method-timeline-table' });
	const head = table.createDiv({ cls: 'snowflake-method-timeline-head' });
	const corner = head.createDiv({ cls: 'snowflake-method-timeline-corner' });
	corner.createSpan({ text: t('table.sceneTime') });
	// The plus at the corner's end puts a time on the active lane, after the rest.
	const cornerAdd = corner.createEl('button', {
		cls: 'clickable-icon snowflake-method-timeline-time-add',
		attr: { type: 'button', 'aria-label': t('timeline.timeline.addTime') },
	});
	setIcon(cornerAdd, 'plus');
	setTooltip(cornerAdd, t('timeline.timeline.addTime'));
	cornerAdd.addEventListener('click', () => {
		void addTimeHere(null);
	});
	const timesEmpty = table.createDiv({ cls: 'snowflake-method-timeline-times-empty' });
	renderEmptyLine(timesEmpty, t('timeline.empty.times'));
	/** Where a time dropped past the last row lands, and wears the line. */
	const tail = table.createDiv({ cls: 'snowflake-method-timeline-tail' });

	// The scroller's own bars are hidden; these two stand in for them, one
	// across under the lanes alone and one down beside the times alone, so
	// neither runs along the head, the time column or the pinned lane. Each
	// holds a spacer as long as the scroller's overflow past the part it skips.
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
		memory.scroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
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

	// -- The scene pool ------------------------------------------------------

	const pool = body.createEl('aside', {
		cls: 'snowflake-method-timeline-pool',
		attr: { 'aria-label': t('timeline.pool') },
	});
	// Its head stands level with the lane heads: the name, and how many scenes it holds.
	const poolHead = pool.createDiv({ cls: 'snowflake-method-timeline-pool-head' });
	poolHead.createSpan({
		cls: 'snowflake-method-timeline-pool-name',
		text: t('timeline.pool'),
		attr: { role: 'heading', 'aria-level': '3' },
	});
	const poolCount = poolHead.createSpan({
		cls: 'snowflake-method-step-indicator snowflake-method-timeline-pool-count',
	});
	const poolHost = pool.createDiv({ cls: 'snowflake-method-corkboard-host' });
	/** The scenes the active timeline has placed, which the pool leaves out. */
	let assigned = new Set<string>();

	/** Whether the workspace is too narrow for both parts to stand, measured from its own width. */
	let narrow = false;
	/** The parts brought back by hand while narrow, which stand until the workspace is wide again. */
	const openedNarrow = new Set<Fold>();

	/** Whether a part stands folded now: as the tab remembers it, or by the width alone. */
	const folded = (part: Fold): boolean =>
		(part === 'time' ? memory.timeCollapsed : memory.poolCollapsed) || (narrow && !openedNarrow.has(part));

	/**
	 * The folds as they stand: the time column to its names, the pool away
	 * with the lanes taking its room; each toggle says which way it goes next.
	 */
	const paintFolds = (): void => {
		for (const part of FOLDS) {
			const collapsed = folded(part);
			const toggle = foldToggles[part];
			const label = t(collapsed ? `timeline.${part}.expand` : `timeline.${part}.collapse`);
			if (toggle.getAttribute('aria-label') !== label) {
				toggle.setAttribute('aria-label', label);
				setTooltip(toggle, label);
			}
			toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		}
		root.toggleClass('is-time-collapsed', folded('time'));
		root.toggleClass('is-pool-collapsed', folded('pool'));
		pool.toggleClass('is-hidden', folded('pool'));
	};

	/** Folds a part or brings it back, remembers which, and measures again for the room that moved. */
	const fold = (part: Fold, collapsed: boolean): void => {
		if (folded(part) === collapsed) return;
		if (part === 'time') memory.timeCollapsed = collapsed;
		else memory.poolCollapsed = collapsed;
		if (collapsed) openedNarrow.delete(part);
		else if (narrow) openedNarrow.add(part);
		paintFolds();
		controls.remember();
		invalidateRects();
		if (part === 'pool') poolHandle?.remeasure();
		else fitScrollbars();
	};

	// -- State ---------------------------------------------------------------

	let reading: TimelineReading | null = null;
	/**
	 * The document as the last read that came back had it. A read that fails
	 * leaves nothing read, but not nothing known: a form standing open must
	 * still be able to name the project's lanes.
	 */
	let lastHeld: TimelineDocument | null = null;
	let loadFailed = false;
	let model: ProjectDashboardModel | null = null;
	let viewId: string | null = null;
	let lanes: Timeline[] = [];
	let activeId: string | null = null;
	/** How the rows deal their scenes, from the view or from how many lanes it shows. */
	let presentation: ScenePresentation = 'flat';
	// Which way a row's cards run, which is the lanes' to say: several lanes
	// narrow a row to one card and the cards stand in a column, while a lone
	// lane lets them wrap across the field.
	let laneAxis: 'across' | 'down' = 'across';
	/** Whether the scroll the tab remembers has been given back, which is done once. */
	let scrollGivenBack = false;
	/** The symbols the two switches wear now, so a paint redraws neither for nothing. */
	let presentationIcon = 'gallery-horizontal';
	let wordsIcon = 'eye';
	let orderIcon = 'arrow-down-narrow-wide';
	let readOnly = true;
	let roster: EntityRosterEntry[] = [];
	/** The same roster keyed by id: a lane's binding is read against it without keying it again. */
	let rosterById = new Map<string, EntityRosterEntry>();
	let optionsSignature = '';
	let viewField: OptionPicker | null = null;
	let scenesById = new Map<string, SceneViewModel>();
	/** Each scene's place in the narrative order, which its card's circle shows. */
	let sceneIndex = new Map<string, number>();
	let charactersByPath = new Map<string, ProjectDashboardModel['characters'][number]>();
	let manuscriptPositions = new Map<string, number>();
	let resolvedManuscriptPaths = new Map<string, Map<string, string | null>>();
	const laneHeads = new Map<string, LaneHead>();
	const timeRows = new Map<string, RowEntry>();
	let disposed = false;
	/** Forms and pickers belong to this workspace; recovered words deliberately outlive it. */
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
	let poolHandle: CorkboardHandle | null = null;
	/** The times' ids in the order the rows stand, from the last paint. */
	let rowOrder: string[] = [];
	/**
	 * The time being dragged, while one is. A row's drag and a scene's are
	 * the cells' own; while any of them is in flight every paint asked waits.
	 */
	let timeDrag: Extract<TimelineDrag, { kind: 'time' }> | null = null;
	/** What the last dragover worked out, which the drop then uses: the time a drop lands before. */
	let timeLanding: { timeId: string | null } | null = null;
	/** The rows of times, measured once per drag, dropped on scroll, resize, paint and drag end. */
	let rowRects: DOMRect[] | null = null;
	const invalidateRects = (): void => {
		rowRects = null;
		cells.invalidateRects();
	};

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
		notice,
		refresh: () => controls.refresh(),
		model: () => model,
		projectPath: () => controls.projectPath(),
		readOnly: () => readOnly,
		// The lanes' deck is told as the pool's is: a draft refused as the plugin
		// goes has no dialog left to open that the plugin could own.
		unloading: () => controls.unloading?.() === true,
		charactersByPath: () => charactersByPath,
		scenesById: () => scenesById,
		manuscriptPositions: () => manuscriptPositions,
		resolveManuscriptPath,
		dragAllowed: (card) => cells.dragAllowed(card),
		menu: (card, event) => {
			cells.openCardMenu(card, event);
		},
		extend: (card) => card,
	});

	// -- Reading and writing -------------------------------------------------

	// The read, the queue and the paint's gate are the loop's, stated once for
	// every workspace kept in a file; what was read stays here, where every
	// part of the workspace reads it.
	const loop: DocumentLoop = createDocumentLoop<TimelineReading, ProjectDashboardModel>({
		source: () => controls.bridge(),
		taken: (next, failed) => {
			reading = next;
			if (next !== null) lastHeld = next.held;
			loadFailed = failed;
		},
		readFailed: (error) => {
			console.error('Snowflake: the timeline could not be read', error);
		},
		held: () => reading?.held ?? null,
		alike: (painted, held) => drawnAlike(painted, held),
		model: () => controls.model(),
		refreshModel: () => controls.refresh(),
		draw: (nextModel) => {
			draw(nextModel);
		},
		dragging: () => timeDrag !== null || cells.dragging(),
		disposed: () => disposed,
		notice,
	});
	const { reload, enqueue } = loop;

	/** A view by id, as the document has it now: the one a press named, when its change comes to be made. */
	const viewAsStands = (id: string): TimelineView | null =>
		reading === null ? null : (findTimelineView(reading.held, id) ?? null);

	const currentView = (): TimelineView | null => (viewId === null ? null : viewAsStands(viewId));

	// -- Painting ------------------------------------------------------------

	const frameWindow = root.ownerDocument.defaultView;

	/**
	 * Where the columns that keep their place end: the time column, and the
	 * pinned lane when the view holds one. Summed from the head's own boxes
	 * and its gap, never read off an offset: a sticky element's offset counts
	 * the shift the scroll gave it, so a fit made while the lanes stood
	 * scrolled would read the pin as far right as the scroll, let it go for
	 * want of room, and start the bar past where it stands.
	 */
	const frozenWidth = (): number => {
		const pinnedId = reading?.held.pinnedTimelineId ?? null;
		const last = (pinnedId === null ? undefined : laneHeads.get(pinnedId))?.el ?? corner;
		const gap = Number.parseFloat(frameWindow?.getComputedStyle(head).columnGap ?? '');
		let end = 0;
		for (const child of Array.from(head.children)) {
			if (child !== corner) end += gap;
			end += (child as HTMLElement).offsetWidth;
			if (child === last) return end;
		}
		return Number.NaN;
	};

	/**
	 * Sizes the stand-in bars to the scroller's overflow: the one across starts
	 * past the frozen columns and never runs under them, the one down under
	 * the head. A pinned lane keeps its place as long as the field shows it
	 * whole; only a field too narrow for it lets it go for the while, since a
	 * lane held still past the field's edge could never be scrolled into view.
	 * A field that leaves the bar across too little room past the frozen
	 * columns to take hold of goes without it: the wheel still scrolls.
	 */
	const fitScrollbars = (): void => {
		const timeWidth = corner.offsetWidth;
		const pinnedEnd = frozenWidth();
		const loose = Number.isFinite(pinnedEnd) && pinnedEnd > timeWidth && scroller.clientWidth < pinnedEnd;
		root.toggleClass('is-pin-loose', loose);
		const start = loose || !Number.isFinite(pinnedEnd) ? timeWidth : pinnedEnd;
		const headHeight = head.offsetHeight;
		const across = scroller.scrollWidth - scroller.clientWidth;
		const down = scroller.scrollHeight - scroller.clientHeight;
		const wide = Number.isFinite(across) && across > 0 && scroller.clientWidth - start >= SCROLL_ROOM_MIN;
		const tall = Number.isFinite(down) && down > 0 && scroller.clientHeight > headHeight;
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
			bars.down.setCssStyles({ insetBlockStart: `${headHeight}px` });
			barSpace.down.setCssStyles({ height: `${down + bars.down.clientHeight}px` });
			bars.down.scrollTop = scroller.scrollTop;
		}
	};
	/**
	 * Narrow, the workspace folds both parts by its width alone, and brings
	 * them back as it widens; what the tab remembers is not touched, and a
	 * part brought back by hand meanwhile stands until the next widening.
	 */
	const measureNarrow = (): void => {
		const width = root.clientWidth;
		if (!(width > 0)) return;
		const rem = Number.parseFloat(frameWindow?.getComputedStyle(root.doc.documentElement).fontSize ?? '');
		const next = width < NARROW_MAX_REM * (Number.isFinite(rem) && rem > 0 ? rem : 16);
		if (next === narrow) return;
		narrow = next;
		if (!narrow) openedNarrow.clear();
		paintFolds();
		invalidateRects();
		poolHandle?.remeasure();
	};
	const sizeObserver = frameWindow === null ? null : new frameWindow.ResizeObserver(() => {
		measureNarrow();
		fitScrollbars();
	});
	sizeObserver?.observe(root);
	sizeObserver?.observe(scroller);
	sizeObserver?.observe(table);

	/** The lanes' cards wear the style the pool's display control chose; the CSS reads it off the root. */
	const paintCardMode = (): void => {
		if (root.dataset.mode === memory.pool.mode) return;
		root.dataset.mode = memory.pool.mode;
		invalidateRects();
	};

	/** A word in the body's place, with nothing to press: the ways in stand in the toolbar. */
	const showEmpty = (text: string | null): void => {
		empty.line.toggleClass('is-hidden', text === null);
		body.toggleClass('is-hidden', text !== null);
		root.toggleClass('is-empty', text !== null);
		if (text !== null) empty.text.setText(text);
	};

	/** The view field, remade only when the views moved; otherwise told the view held now. */
	const paintOptions = (views: readonly TimelineView[]): void => {
		const signature = views.map((view) => `${view.id} ${view.name}`).join('|');
		if (viewField === null || signature !== optionsSignature) {
			optionsSignature = signature;
			viewField?.destroy();
			viewHost.empty();
			viewField = buildOptionField(app, viewHost, {
				options: () => views.map((view) => ({ value: view.id, label: view.name })),
				label: t('timeline.view'),
				placeholder: t('timeline.view.placeholder'),
				emptyPlaceholder: t('timeline.view.placeholder'),
				value: () => viewId ?? '',
				choose: chooseView,
			});
			return;
		}
		viewField.refresh();
	};

	/** Who a binding may point at now, from the model: the cast and every kind but time. */
	const rosterOf = (current: ProjectDashboardModel): EntityRosterEntry[] => [
		...current.characters.map((character) => ({
			kind: 'character',
			id: character.id,
			name: character.name,
			path: character.path,
			group: 'character',
		})),
		...current.worldbuildingKinds
			.filter((kind) => kind.id !== 'time')
			.flatMap((kind) =>
				kindEntities(current, kind.id).map((entity) => ({
					kind: kind.id,
					id: entity.id,
					name: entity.name,
					path: entity.path,
					group: kind.id,
				})),
			),
	];

	/**
	 * Lays the workspace out again from the document and the model: the
	 * view, its lanes and which of them is active, the chrome, then the
	 * heads and the rows of times under them. A paint asked for while a drag
	 * is in flight waits for its end.
	 */
	const paintAll = (): void => {
		loop.paint();
	};

	/** The laying out itself, from the model handed to it and the document last read. */
	const draw = (nextModel: ProjectDashboardModel | null): void => {
		invalidateRects();
		paintFolds();
		if (nextModel !== model) {
			// Every one of these is the model's own and says the same thing for
			// as long as the model does, so they are made again only when it is
			// another model. A paint over the model that stands would else build
			// some thousands of entries afresh to say what they already said.
			manuscriptPositions = new Map(nextModel?.manuscriptPaths.map((path, index) => [path, index]));
			roster = nextModel === null ? [] : rosterOf(nextModel);
			rosterById = entityRosterById(roster);
			scenesById = new Map(nextModel?.scenes.map((scene) => [scene.id, scene]) ?? []);
			sceneIndex = new Map(nextModel?.scenes.map((scene, index) => [scene.id, index]) ?? []);
			charactersByPath = new Map(nextModel?.characters.map((character) => [character.path, character]) ?? []);
		}
		model = nextModel;
		// The model's word alone: it is renewed with every project refresh,
		// while what the document read reported is as old as that read, and
		// a project written again would stay shut here until the next one.
		readOnly = model?.readOnly ?? true;
		root.toggleClass('is-read-only', readOnly);
		// A refresh can follow metadata resolution even with the same model object.
		resolvedManuscriptPaths = new Map();
		deck.beginPaint();
		addTimelineButton.disabled = readOnly || reading === null;
		addViewButton.disabled = readOnly || reading === null;
		if (reading === null) {
			editViewButton.disabled = true;
			paintPresentation(null);
			paintWords(null);
			paintOrder(null);
			paintOptions([]);
			showEmpty(t(loadFailed ? 'timeline.loadFailed' : 'timeline.loading'));
			return;
		}
		const held = reading.held;
		cells.recoverHomelessFeet();
		if (viewId === null || findTimelineView(held, viewId) === undefined) {
			viewId =
				held.lastViewId !== null && findTimelineView(held, held.lastViewId) !== undefined
					? held.lastViewId
					: (held.views[0]?.id ?? null);
		}
		paintOptions(held.views);
		const view = currentView();
		editViewButton.disabled = readOnly || view === null;
		paintPresentation(view);
		paintWords(view);
		paintOrder(view);
		if (view === null) {
			lanes = [];
			clearRows();
			showEmpty(t('timeline.empty.views'));
			return;
		}
		lanes = laneOrder(view, held);
		if (lanes.length === 0) {
			clearRows();
			showEmpty(t('timeline.empty.timelines'));
			return;
		}
		showEmpty(null);
		activeId = resolveActiveTimeline(lanes, held.pinnedTimelineId, memory.activeTimeline.get(view.id));
		cornerAdd.disabled = readOnly || activeId === null;
		const kind = layoutKind(lanes);
		root.dataset.layout = kind;
		laneAxis = kind === 'multi' ? 'down' : 'across';
		paintCardMode();
		root.setCssProps({ '--snowflake-method-timeline-lanes': String(lanes.length) });
		const hold = holdFocus();
		paintHeads(held);
		paintRows(view);
		paintPool();
		// The scroll the tab remembers, given back once the lanes are long
		// enough to take it. Only once: a later paint must not pull the author
		// away from wherever they have scrolled since.
		if (!scrollGivenBack) {
			scrollGivenBack = true;
			if (memory.scroll.left !== 0) scroller.scrollLeft = memory.scroll.left;
			if (memory.scroll.top !== 0) scroller.scrollTop = memory.scroll.top;
		}
		giveFocusBack(hold);
		deck.prune();
		stateText.setText('');
		fitScrollbars();
	};

	/** The symbol shows how the view deals its scenes; a press deals them the other way. */
	const paintPresentation = (view: TimelineView | null): void => {
		presentation = view === null ? 'flat' : derivedPresentation(view);
		root.dataset.presentation = presentation;
		const stacked = presentation === 'stack';
		const icon = stacked ? 'layers-3' : 'gallery-horizontal';
		if (icon !== presentationIcon) {
			presentationIcon = icon;
			setIcon(presentationButton, icon);
		}
		const label = t(stacked ? 'timeline.presentation.toFlat' : 'timeline.presentation.toStack');
		if (presentationButton.getAttribute('aria-label') !== label) {
			presentationButton.setAttribute('aria-label', label);
			setTooltip(presentationButton, label);
		}
		presentationButton.disabled = readOnly || view === null;
	};

	/** The symbol shows whether the lanes show their rows' words; a press shows or hides them. */
	const paintWords = (view: TimelineView | null): void => {
		const shown = view === null || view.showSubDescriptions;
		// A view that keeps its sub-descriptions away shows the scenes alone.
		root.toggleClass('is-words-hidden', !shown);
		const icon = shown ? 'eye' : 'eye-off';
		if (icon !== wordsIcon) {
			wordsIcon = icon;
			setIcon(wordsButton, icon);
		}
		const label = t(shown ? 'timeline.view.subDescriptionsHide' : 'timeline.view.subDescriptions');
		if (wordsButton.getAttribute('aria-label') !== label) {
			wordsButton.setAttribute('aria-label', label);
			setTooltip(wordsButton, label);
		}
		wordsButton.setAttribute('aria-pressed', shown ? 'true' : 'false');
		wordsButton.disabled = readOnly || view === null;
	};

	const paintOrder = (view: TimelineView | null): void => {
		const reversed = view !== null && view.timesReversed;
		const icon = reversed ? 'arrow-up-narrow-wide' : 'arrow-down-narrow-wide';
		if (icon !== orderIcon) {
			orderIcon = icon;
			setIcon(orderButton, icon);
		}
		const label = t(reversed ? 'timeline.order.restore' : 'timeline.order.reverse');
		if (orderButton.getAttribute('aria-label') !== label) {
			orderButton.setAttribute('aria-label', label);
			setTooltip(orderButton, label);
		}
		orderButton.setAttribute('aria-pressed', reversed ? 'true' : 'false');
		orderButton.disabled = readOnly || view === null;
	};

	/** The order as the view keeps it: the rows run the other way when the view shows the latest first. */
	const storedOrder = (view: TimelineView, displayed: readonly string[]): string[] =>
		view.timesReversed ? [...displayed].reverse() : [...displayed];

	/** The pool follows the active lane: what that lane has placed leaves it, and the count says what is left. */
	const paintPool = (): void => {
		const active = lanes.find((lane) => lane.id === activeId);
		assigned = active === undefined ? new Set() : assignedSceneIds(active);
		paintCount(poolCount, model === null ? 0 : model.scenes.filter((scene) => !assigned.has(scene.id)).length);
		poolHandle?.refresh();
	};

	const buildHead = (lane: Timeline): LaneHead => {
		const el = head.createDiv({
			cls: 'snowflake-method-timeline-lane-head',
			attr: { 'data-timeline-id': lane.id },
		});
		// The pin, the name and the bound note ride in one box that holds at
		// the frozen edge while the lane scrolls under, as its axis does; the
		// box moves within the lead, which ends where the menu begins.
		const lead = el.createDiv({ cls: 'snowflake-method-timeline-lane-lead' });
		const title = lead.createDiv({ cls: 'snowflake-method-timeline-lane-title' });
		const pin = title.createSpan({
			cls: 'snowflake-method-timeline-lane-pin is-hidden',
			attr: { role: 'img', 'aria-label': t('timeline.timeline.pinned') },
		});
		setIcon(pin, 'pin');
		setTooltip(pin, t('timeline.timeline.pinned'));
		const name = title.createEl('button', {
			cls: 'snowflake-method-timeline-lane-name',
			attr: { type: 'button', 'aria-pressed': 'false' },
		});
		const entity = title.createEl('button', {
			cls: 'snowflake-method-timeline-lane-entity is-hidden',
			attr: { type: 'button' },
		});
		const more = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-lane-more',
			attr: { type: 'button', 'aria-label': t('table.actions'), 'aria-haspopup': 'menu' },
		});
		setIcon(more, 'ellipsis');
		setTooltip(more, t('table.actions'));
		const entry: LaneHead = { id: lane.id, el, pin, name, entity, entityRef: null, more, timeline: lane };
		name.addEventListener('click', () => {
			activate(entry.id);
		});
		// The whole head is the lane's name to a click; its own controls answer for themselves.
		el.addEventListener('click', (event) => {
			if (controlWithin(event.target)) return;
			activate(entry.id);
		});
		entity.addEventListener('click', (event) => {
			event.stopPropagation();
			const ref = entry.entityRef;
			if (ref === null) return;
			const path = controls.projectPath() ?? undefined;
			const opened = ref.kind === 'character'
				? host.openCharacterForm(ref.id, path)
				: host.openEntityForm({ mode: 'edit', id: ref.id }, path);
			void opened.catch(notice);
		});
		more.addEventListener('click', (event) => {
			event.stopPropagation();
			openLaneMenu(entry, event);
		});
		el.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			openLaneMenu(entry, event);
		});
		return entry;
	};

	const dressHead = (entry: LaneHead, lane: Timeline, held: TimelineDocument): void => {
		entry.timeline = lane;
		if (entry.name.textContent !== lane.name) entry.name.setText(lane.name);
		const active = lane.id === activeId;
		entry.el.toggleClass('is-active', active);
		entry.name.setAttribute('aria-pressed', active ? 'true' : 'false');
		setTooltip(entry.name, t('timeline.timeline.activate', { name: lane.name }));
		const pinned = held.pinnedTimelineId === lane.id;
		entry.el.toggleClass('is-pinned', pinned);
		entry.pin.toggleClass('is-hidden', !pinned);
		const binding = lane.binding === null ? null : resolveEntityRef(lane.binding, rosterById);
		entry.entity.toggleClass('is-hidden', binding === null);
		if (binding === null) {
			entry.entityRef = null;
			return;
		}
		if (entry.entity.textContent !== binding.name) entry.entity.setText(binding.name);
		entry.entity.toggleClass('is-missing', binding.missing);
		setTooltip(
			entry.entity,
			binding.missing ? t('table.referenceMissing', { name: binding.name }) : binding.name,
		);
		entry.entityRef = binding.missing ? null : lane.binding;
	};

	/** Brings the heads level with the lanes: one per timeline, in the view's order, kept where they stand. */
	const paintHeads = (held: TimelineDocument): void => {
		const wanted = lanes.map((lane) => lane.id);
		const plan = planCardRepaint([...laneHeads.keys()], wanted, []);
		for (const id of plan.remove) {
			laneHeads.get(id)?.el.remove();
			laneHeads.delete(id);
		}
		for (const lane of lanes) {
			let entry = laneHeads.get(lane.id);
			if (entry === undefined) {
				entry = buildHead(lane);
				laneHeads.set(lane.id, entry);
			}
			dressHead(entry, lane, held);
		}
		const present = Array.from(head.children).map(
			(child) => child.getAttribute('data-timeline-id') ?? '',
		);
		for (const move of planCardMoves(present, wanted)) {
			const el = laneHeads.get(move.id)?.el;
			if (el === undefined) continue;
			head.insertBefore(el, laneHeads.get(move.before)?.el ?? null);
		}
	};

	// -- The rows of times ---------------------------------------------------

	const buildRow = (timeId: string): RowEntry => {
		const el = table.createDiv({
			cls: 'snowflake-method-timeline-row',
			attr: { 'data-time-id': timeId },
		});
		const time = el.createDiv({ cls: 'snowflake-method-timeline-time' });
		const handle = time.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-time-handle',
			attr: { type: 'button', 'aria-label': t('timeline.time.drag'), draggable: 'true' },
		});
		setIcon(handle, 'grip-vertical');
		setTooltip(handle, t('timeline.time.drag'));
		const text = time.createDiv({ cls: 'snowflake-method-timeline-time-text' });
		const label = text.createEl('button', {
			cls: 'snowflake-method-timeline-time-label',
			attr: { type: 'button' },
		});
		const description = text.createEl('button', {
			cls: 'snowflake-method-timeline-time-description',
			attr: { type: 'button' },
		});
		const more = time.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-time-more',
			attr: { type: 'button', 'aria-label': t('table.actions'), 'aria-haspopup': 'menu' },
		});
		setIcon(more, 'ellipsis');
		setTooltip(more, t('table.actions'));
		// The rule between this time and the one above carries a plus; the stylesheet shows it from the second row on.
		const seam = time.createDiv({ cls: 'snowflake-method-timeline-seam' });
		const seamAdd = seam.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-seam-add',
			attr: { type: 'button' },
		});
		setIcon(seamAdd, 'plus');
		const entry: RowEntry = { timeId, el, handle, label, description, more, seamAdd, time: null, cells: new Map() };
		seamAdd.addEventListener('click', (event) => {
			event.stopPropagation();
			void addTimeHere(entry.timeId);
		});
		handle.addEventListener('dragstart', (event) => {
			if (readOnly || event.dataTransfer === null) {
				event.preventDefault();
				return;
			}
			timeDrag = { kind: 'time', timeId: entry.timeId };
			invalidateRects();
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(TIMELINE_TIME_DRAG_TYPE, entry.timeId);
			if (typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(entry.el, 8, 8);
			root.addClass('is-time-drag');
			entry.el.addClass('is-dragging');
		});
		handle.addEventListener('dragend', () => {
			entry.el.removeClass('is-dragging');
			endDrag();
		});
		label.addEventListener('click', () => {
			const path = entry.time?.path;
			if (path !== undefined) void host.openManagedFile(path).catch(notice);
		});
		description.addEventListener('click', () => {
			editTime(entry);
		});
		more.addEventListener('click', (event) => {
			event.stopPropagation();
			openTimeMenu(entry, event);
		});
		time.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			openTimeMenu(entry, event);
		});
		return entry;
	};

	const dressRow = (entry: RowEntry, row: TimeRowModel): void => {
		entry.time = row.time;
		const missing = row.time === null;
		entry.el.toggleClass('is-missing', missing);
		const name = row.time?.name ?? t('timeline.time.missing');
		if (entry.label.textContent !== name) entry.label.setText(name);
		entry.label.disabled = missing;
		const insert = t('timeline.time.insert', { name });
		if (entry.seamAdd.getAttribute('aria-label') !== insert) {
			entry.seamAdd.setAttribute('aria-label', insert);
			setTooltip(entry.seamAdd, insert);
		}
		entry.seamAdd.disabled = readOnly || activeId === null;
		entry.handle.setAttribute('draggable', readOnly ? 'false' : 'true');
		entry.handle.disabled = readOnly;
		const description = row.time?.description.trim() ?? '';
		const shown = description.length > 0 ? description : t('timeline.time.noDescription');
		if (entry.description.textContent !== shown) entry.description.setText(shown);
		entry.description.toggleClass('is-empty', description.length === 0);
		entry.description.toggleClass('is-hidden', missing);
		entry.description.disabled = readOnly || missing;
		setTooltip(entry.description, t('timeline.time.editDescription'));
		const wanted = lanes.map((lane) => lane.id);
		const plan = planCardRepaint([...entry.cells.keys()], wanted, []);
		for (const id of plan.remove) unmountCell(entry, id);
		for (const lane of lanes) {
			let cell = entry.cells.get(lane.id);
			if (cell === undefined) {
				cell = buildCell(entry, lane.id);
				entry.cells.set(lane.id, cell);
			}
			dressCell(entry, cell, lane);
		}
		const present = Array.from(entry.el.children).map(
			(child) => child.getAttribute('data-timeline-id') ?? '',
		);
		for (const move of planCardMoves(present, wanted)) {
			const el = entry.cells.get(move.id)?.el;
			if (el === undefined) continue;
			entry.el.insertBefore(el, entry.cells.get(move.before)?.el ?? null);
		}
	};

	const unmountRow = (timeId: string): void => {
		const entry = timeRows.get(timeId);
		if (entry === undefined) return;
		for (const id of [...entry.cells.keys()]) unmountCell(entry, id);
		entry.el.remove();
		timeRows.delete(timeId);
	};

	const clearRows = (): void => {
		for (const timeId of [...timeRows.keys()]) unmountRow(timeId);
		timesEmpty.toggleClass('is-hidden', true);
		cells.sweep();
	};

	/** Brings the rows level with the times the view shows, in its order, kept where they stand. */
	const paintRows = (view: TimelineView): void => {
		const times = model === null ? [] : kindEntities(model, 'time');
		// The view's order, turned about when the view shows the latest time first.
		const rows = view.timesReversed ? unionRows(view, lanes, times).reverse() : unionRows(view, lanes, times);
		timesEmpty.toggleClass('is-hidden', rows.length > 0);
		const wanted = rows.map((row) => row.timeId);
		rowOrder = wanted;
		const plan = planCardRepaint([...timeRows.keys()], wanted, []);
		for (const timeId of plan.remove) unmountRow(timeId);
		for (const row of rows) {
			let entry = timeRows.get(row.timeId);
			if (entry === undefined) {
				entry = buildRow(row.timeId);
				timeRows.set(row.timeId, entry);
				table.insertBefore(entry.el, timesEmpty);
			}
			dressRow(entry, row);
		}
		const present = Array.from(table.children).map(
			(child) => child.getAttribute('data-time-id') ?? '',
		);
		for (const move of planCardMoves(present, wanted)) {
			const el = timeRows.get(move.id)?.el;
			if (el === undefined) continue;
			table.insertBefore(el, timeRows.get(move.before)?.el ?? timesEmpty);
		}
		cells.sweep();
	};

	// -- The cells of a row --------------------------------------------------

	const buildCell = (row: RowEntry, timelineId: string): CellEntry => {
		const el = row.el.createDiv({
			cls: 'snowflake-method-timeline-cell',
			attr: { 'data-timeline-id': timelineId, 'data-time-id': row.timeId },
		});
		const axis = el.createDiv({
			cls: 'snowflake-method-timeline-axis',
			attr: { 'aria-hidden': 'true' },
		});
		// The rule above the cell carries a plus of its own, for a time on this lane before the row.
		const seam = el.createDiv({ cls: 'snowflake-method-timeline-seam' });
		const seamAdd = seam.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-seam-add',
			attr: { type: 'button' },
		});
		setIcon(seamAdd, 'plus');
		seamAdd.addEventListener('click', (event) => {
			event.stopPropagation();
			void addTimeHere(row.timeId, timelineId);
		});
		// A click anywhere on the lane makes it the active one, as a click on
		// its head does: on a card, a row's words or the empty ground alike.
		// A lane already active is left as it stands.
		el.addEventListener('click', () => {
			activate(timelineId);
		});
		return { timelineId, el, axis, seamAdd, add: null, body: cells.mountCell(el, timelineId, row.timeId) };
	};

	const unmountCell = (row: RowEntry, timelineId: string): void => {
		const cell = row.cells.get(timelineId);
		if (cell === undefined) return;
		cells.unmountCell(cell.body);
		cell.add?.remove();
		cell.add = null;
		cell.el.remove();
		row.cells.delete(timelineId);
	};

	const dressCell = (row: RowEntry, cell: CellEntry, lane: Timeline): void => {
		const time = laneCell(lane, row.timeId);
		const present = time !== null;
		if (!present) {
			// What stood in the cell comes down before the plus takes its place.
			cells.dressCell(cell.body, null, lane);
			if (cell.add === null) {
				const add = cell.el.createEl('button', {
					cls: 'clickable-icon snowflake-method-timeline-cell-add',
					attr: { type: 'button' },
				});
				setIcon(add, 'plus');
				add.addEventListener('click', () => {
					void enqueue(async () => {
						await controls.bridge().addTime(cell.timelineId, row.timeId);
					});
				});
				cell.add = add;
			}
		} else if (cell.add !== null) {
			cell.add.remove();
			cell.add = null;
		}
		cell.el.toggleClass('is-present', present);
		cell.el.toggleClass('is-absent', !present);
		cell.el.toggleClass('is-active-lane', lane.id === activeId);
		cell.el.toggleClass('is-pinned', lane.id === (reading?.held.pinnedTimelineId ?? null));
		const insert = t('timeline.time.insertOn', { timeline: lane.name, name: row.time?.name ?? t('timeline.time.missing') });
		if (cell.seamAdd.getAttribute('aria-label') !== insert) {
			cell.seamAdd.setAttribute('aria-label', insert);
			setTooltip(cell.seamAdd, insert);
		}
		cell.seamAdd.disabled = readOnly;
		if (cell.add !== null) {
			const label = t('timeline.cell.addTime', { timeline: lane.name });
			cell.add.setAttribute('aria-label', label);
			setTooltip(cell.add, label);
			cell.add.disabled = readOnly;
		}
		if (time !== null) cells.dressCell(cell.body, time, lane);
	};

	// -- What the lanes' cells ask of the workspace ----------------------------

	/** Where words were meant to stand, as a writer would name it: the lane and the time. */
	const placeName = (timelineId: string, timeId: string | null): string => {
		const lane = reading?.held.timelines.find((candidate) => candidate.id === timelineId)?.name ?? timelineId;
		const time = model === null || timeId === null
			? null
			: kindEntities(model, 'time').find((candidate) => candidate.id === timeId)?.name ?? null;
		return time === null ? lane : `${lane} · ${time}`;
	};

	/** Other times held by this lane, in the order the view displays them. */
	const otherRowTimes = (lane: Lane, fromTimeId: string): PickerOption[] => {
		if (model === null) return [];
		const names = new Map(kindEntities(model, 'time').map((entity) => [entity.id, entity.name]));
		const held = new Set(lane.times.map((time) => time.timeId));
		return rowOrder
			.filter((timeId) => timeId !== fromTimeId && held.has(timeId))
			.map((timeId) => ({ value: timeId, label: names.get(timeId) ?? t('timeline.time.missing') }));
	};

	const moveRowToTime = (lane: Lane, time: TimelineTime, rowId: string): void => {
		const path = controls.projectPath();
		const openedView = viewId;
		const elsewhere = otherRowTimes(lane, time.timeId);
		if (disposed || readOnly || path === null || elsewhere.length === 0) return;
		const currentContext = (): boolean => {
			const current = controls.model();
			return !disposed && !readOnly && current !== null && !current.readOnly
				&& current.path === path && controls.projectPath() === path && viewId === openedView
				&& currentView()?.timelines.includes(lane.id) === true;
		};
		keep(new TimelineTimePickModal(app, t('timeline.subrow.moveToTimePlaceholder'), elsewhere, (picked) => {
			if (!currentContext() || !elsewhere.some((option) => option.value === picked.value)) return;
			void enqueue(async () => {
				if (!currentContext()) return;
				const bridge = controls.bridge();
				const latest = await bridge.read();
				if (!currentContext() || latest?.projectPath !== path) return;
				if (!latest.held.views.some((view) => view.id === openedView && view.timelines.includes(lane.id))) return;
				const currentLane = latest.held.timelines.find((candidate) => candidate.id === lane.id);
				const source = currentLane?.times.find((candidate) => candidate.timeId === time.timeId);
				if (!source?.rows.some((row) => row.id === rowId)
					|| !currentLane?.times.some((candidate) => candidate.timeId === picked.value)) return;
				await bridge.moveRow(lane.id, rowId, picked.value, null);
			});
		})).open();
	};

	// -- Dragging the times ----------------------------------------------------

	/** Fires on the source however the drag ends: dropped, dropped nowhere, or cancelled. */
	const endDrag = (): void => {
		cells.dragEnded();
		timeDrag = null;
		timeLanding = null;
		rowRects = null;
		root.removeClass('is-time-drag');
		cells.paintDragPhase();
		loop.paintOwed();
	};

	/** The time's id before which a time drag would land, null for the foot. */
	const timeLandingAt = (clientY: number): { el: HTMLElement; timeId: string | null } => {
		if (rowRects === null) {
			rowRects = rowOrder.map((timeId) => timeRows.get(timeId)?.el.getBoundingClientRect() ?? new DOMRect());
		}
		const candidates = rowOrder
			.map((timeId, index) => ({ timeId, box: rowRects?.[index] }))
			.filter((entry) => entry.timeId !== (timeDrag?.timeId ?? ''));
		const at = dropIndexAt(candidates.map((entry) => (entry.box?.top ?? 0) + (entry.box?.height ?? 0) / 2), clientY);
		const landing = candidates[at];
		const el = landing === undefined ? tail : (timeRows.get(landing.timeId)?.el ?? tail);
		return { el, timeId: landing?.timeId ?? null };
	};

	table.addEventListener('dragover', (event) => {
		if (timeDrag === null || event.dataTransfer?.types.includes(TIMELINE_TIME_DRAG_TYPE) !== true) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const landing = timeLandingAt(event.clientY);
		timeLanding = { timeId: landing.timeId };
		cells.setMark(landing.el, 'is-drop-before');
	});
	table.addEventListener('drop', (event) => {
		const dragged = event.dataTransfer?.getData(TIMELINE_TIME_DRAG_TYPE) ?? '';
		if (timeDrag === null || timeDrag.timeId !== dragged) return;
		event.preventDefault();
		const beforeTimeId = timeLanding === null ? timeLandingAt(event.clientY).timeId : timeLanding.timeId;
		cells.clearMark();
		moveTime(dragged, beforeTimeId);
	});

	/** The view's time order with one time moved before another, or to the foot; nothing written for no move. */
	const moveTime = (timeId: string, beforeTimeId: string | null): void => {
		const view = currentView();
		const next = reorderIds(rowOrder, timeId, beforeTimeId);
		if (view === null || next === null) return;
		void enqueue(async () => {
			await controls.bridge().setTimeOrder(view.id, storedOrder(view, next));
		});
	};

	// -- Dragging the scenes ---------------------------------------------------

	let eventWindow = root.win;
	// The deck holds a card still while one of its controls is pressed; the
	// release lands anywhere, so the window hears it, as under the corkboard.
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

	// -- Focus custody -------------------------------------------------------

	const holdFocus = (): FocusHold | null => {
		const active = root.doc.activeElement;
		if (active === null || !root.contains(active)) return null;
		const card = active.closest(SCENE_CARD_SELECTOR);
		if (card === null) return { kind: 'element', el: active };
		const part = SCENE_CARD_PART_CLASSES.find(([, cls]) => active.classList.contains(cls))?.[0] ?? 'card';
		return { kind: 'card', key: card.getAttribute('data-key') ?? '', part };
	};

	/** Gives the focus back where it stood, to the same part of the same card, or to the scroller. */
	const giveFocusBack = (hold: FocusHold | null): void => {
		if (hold === null) return;
		const doc = root.doc;
		const active = doc.activeElement;
		if (active !== null && active !== doc.body && root.contains(active)) return;
		let target: Element | null = null;
		if (hold.kind === 'card') {
			const card = deck.cards.get(hold.key);
			if (card?.el.isConnected === true) target = deck.partOf(card, hold.part);
		} else if (root.contains(hold.el)) {
			target = hold.el;
		}
		((target ?? scroller) as HTMLElement).focus({ preventScroll: true });
	};

	// -- The lanes' actions --------------------------------------------------

	const activate = (id: string): void => {
		const view = currentView();
		if (view === null || id === activeId) return;
		memory.activeTimeline.set(view.id, id);
		paintAll();
	};

	/** What a binding may point at: the cast and every kind but time, by id. */
	const bindingSource = (current: ProjectDashboardModel): EntityReferenceSource => {
		const groups = [
			'character',
			...current.worldbuildingKinds.filter((kind) => kind.id !== 'time').map((kind) => kind.id),
		];
		return {
			groups: () => groups.map((id) => ({ id, label: entityGroupLabel(t, id) })),
			entitiesIn: (group) =>
				group === 'character'
					? current.characters.map((character) => ({ value: character.id, label: character.name }))
					: kindEntities(current, group).map((entity) => ({ value: entity.id, label: entity.name })),
		};
	};

	const pickBinding = async (): Promise<EntityRef | null> => {
		const current = model;
		if (current === null) return null;
		const picked = await promptForEntityReference(app, t, bindingSource(current));
		if (picked === null) return null;
		return { kind: picked.group, id: picked.option.value, name: picked.option.label };
	};

	/**
	 * What a lane may take a time from: the project's time notes the lane
	 * does not hold yet, a point or a period, and one made on the spot from
	 * the name typed, through the form or straight to the note as the
	 * author's setting says.
	 */
	const timeSource = (current: ProjectDashboardModel, lane: Timeline): EntityReferenceSource => {
		const held = new Set(lane.times.map((time) => time.timeId));
		const ofKind = (kind: 'point' | 'period'): PickerOption[] =>
			kindEntities(current, 'time')
				.filter((entity) =>
					!held.has(entity.id) &&
					(kind === 'point' ? entity.timeKind === 'point' || entity.timeKind === null : entity.timeKind === 'period'))
				.map((entity) => ({ value: entity.id, label: entity.name }));
		return {
			groups: () => ['time-point', 'time-period'].map((id) => ({ id, label: entityGroupLabel(t, id) })),
			entitiesIn: (group) => (group === 'time-period' ? ofKind('period') : ofKind('point')),
			createIn: (group, name) => createTime(group === 'time-period' ? 'period' : 'point', name),
		};
	};

	const createTime = async (timeKind: 'point' | 'period', rawName: string): Promise<PickerOption | null> => {
		const name = rawName.trim();
		const path = controls.projectPath();
		if (name.length === 0 || path === null) return null;
		try {
			let id: string | null;
			if (host.opensFormWhenCreatingFromField()) {
				id = await host.openEntityForm(
					{ mode: 'create', kind: 'time', preset: { name, timeKind, lockTimeKind: true } },
					path,
				);
			} else {
				id = (await host.createEntity({
					kind: 'time',
					name,
					aliases: [],
					categoryPaths: [],
					progressStatus: 'not-started',
					description: '',
					timeKind,
					timeStart: '',
					timeEnd: '',
					worldStatus: [],
					relationships: [],
					customFields: '',
				}, path)).id;
			}
			if (id === null) return null;
			// The lane names the time by its id; the model must hold it first.
			await controls.refresh();
			return { value: id, label: name };
		} catch (error) {
			notice(error);
			return null;
		}
	};

	const addTimeTo = async (lane: Timeline): Promise<void> => {
		const current = model;
		if (current === null || readOnly) return;
		const picked = await promptForEntityReference(app, t, timeSource(current, lane));
		if (picked === null || disposed) return;
		await enqueue(async () => {
			await controls.bridge().addTime(lane.id, picked.option.value);
		});
	};

	/**
	 * Puts a time on a lane: the active one from the corner's plus, after the
	 * rest, or from the time column's seam; a lane's own from the seam in its
	 * cell. A seam's time goes before the row under it, and the view's order
	 * is written with it in that place.
	 */
	const addTimeHere = async (
		beforeTimeId: string | null,
		timelineId: string | null = null,
		/** Whether the foot is the place asked for, rather than a place among the rest by rank. */
		atFoot = false,
	): Promise<void> => {
		const current = model;
		const view = currentView();
		const lane = lanes.find((candidate) => candidate.id === (timelineId ?? activeId));
		if (current === null || readOnly || view === null || lane === undefined) return;
		const picked = await promptForEntityReference(app, t, timeSource(current, lane));
		if (picked === null || disposed) return;
		const timeId = picked.option.value;
		await enqueue(async () => {
			await controls.bridge().addTime(lane.id, timeId);
			if (beforeTimeId === timeId) return;
			// The view as it stands now, not as it stood before the picker: the
			// rows are read from the paint the write lands on, so an order
			// turned about while the picker was open would else be written back
			// the way it was read, putting every other time out of its place.
			const now = currentView();
			if (now === null) return;
			// Added from the frame's corner to a view that runs first to last,
			// the time takes its place among the rest by rank and the order is
			// left alone. Put in after the last row, or added to a view turned
			// about, the foot is the place meant, and is written.
			if (beforeTimeId === null && !atFoot && !now.timesReversed) return;
			const order = rowOrder.filter((id) => id !== timeId);
			const at = beforeTimeId === null ? -1 : order.indexOf(beforeTimeId);
			await controls.bridge().setTimeOrder(
				now.id,
				storedOrder(now, at === -1 ? [...order, timeId] : [...order.slice(0, at), timeId, ...order.slice(at)]),
			);
		});
	};

	const openLaneMenu = (entry: LaneHead, event: MouseEvent): void => {
		const held = reading?.held;
		const view = currentView();
		if (held === undefined || view === null) return;
		const lane = entry.timeline;
		const pinned = held.pinnedTimelineId === lane.id;
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.rename'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					renameLane(lane);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t(lane.binding === null ? 'timeline.timeline.bind' : 'timeline.timeline.unbind'))
				.setIcon(lane.binding === null ? 'link' : 'unlink')
				.setDisabled(readOnly)
				.onClick(() => {
					void bindLane(lane);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t(pinned ? 'timeline.timeline.unpin' : 'timeline.timeline.pin'))
				.setIcon('pin')
				.setDisabled(readOnly)
				.onClick(() => {
					void enqueue(async () => {
						await controls.bridge().pinTimeline(pinned ? null : lane.id);
					});
				});
		});
		menu.addSeparator();
		// The moves and the insertions, then the removals, in the order a card's menu keeps.
		// The pinned lane stands first whatever the view's order says; the others move among themselves.
		const others = view.timelines.filter((id) => id !== held.pinnedTimelineId);
		const at = pinned ? -1 : others.indexOf(lane.id);
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.moveLeft'))
				.setIcon('arrow-left')
				.setDisabled(readOnly || at <= 0)
				.onClick(() => {
					void enqueue(async () => {
						await controls.bridge().moveTimelineInView(view.id, lane.id, others[at - 1] ?? null);
					});
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.moveRight'))
				.setIcon('arrow-right')
				.setDisabled(readOnly || at === -1 || at >= others.length - 1)
				.onClick(() => {
					void enqueue(async () => {
						await controls.bridge().moveTimelineInView(view.id, lane.id, others[at + 2] ?? null);
					});
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.insertAfter'))
				.setIcon('list-plus')
				.setDisabled(readOnly)
				.onClick(() => {
					void insertLaneAfter(lane);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.addTime'))
				.setIcon('calendar-plus')
				.setDisabled(readOnly)
				.onClick(() => {
					void addTimeTo(lane);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.removeFromView'))
				.setIcon('eye-off')
				.setDisabled(readOnly)
				.onClick(() => {
					void enqueue(async () => {
						await controls.bridge().setViewTimelines(
							view.id,
							view.timelines.filter((id) => id !== lane.id),
						);
					});
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(readOnly)
				.onClick(() => {
					void deleteLane(lane);
				});
		});
		menu.showAtMouseEvent(event);
	};

	/** Adds a timeline through the form and stands it after this lane, when the form put it in the view. */
	const insertLaneAfter = async (lane: Timeline): Promise<void> => {
		const view = currentView();
		if (view === null) return;
		const others = view.timelines.filter((id) => id !== (reading?.held.pinnedTimelineId ?? null));
		const next = others[others.indexOf(lane.id) + 1] ?? null;
		const id = await addTimeline(true);
		if (id === null || disposed) return;
		await enqueue(async () => {
			const now = currentView();
			if (now === null || !now.timelines.includes(id)) return;
			await controls.bridge().moveTimelineInView(now.id, id, next);
		});
	};

	const renameLane = (lane: Timeline): void => {
		const held = reading?.held;
		if (held === undefined || disposed) return;
		keep(renameTimelineForm(
			app,
			t,
			lane.name,
			held.timelines.filter((candidate) => candidate.id !== lane.id).map((candidate) => candidate.name),
			async (name) => {
				if (disposed) return;
				await enqueue(async () => {
					await controls.bridge().renameTimeline(lane.id, name);
				});
			},
		)).open();
	};

	const bindLane = async (lane: Timeline): Promise<void> => {
		if (lane.binding !== null) {
			await enqueue(async () => {
				await controls.bridge().bindTimeline(lane.id, null);
			});
			return;
		}
		const picked = await pickBinding();
		if (picked === null || disposed) return;
		await enqueue(async () => {
			await controls.bridge().bindTimeline(lane.id, picked);
		});
	};

	const deleteLane = async (lane: Timeline): Promise<void> => {
		if (disposed) return;
		const rows = lane.times.reduce((count, time) => count + time.rows.length, 0);
		if (lane.times.length > 0 || rows > 0) {
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('timeline.timeline.deleteTitle', { name: lane.name }),
				lines: [t('timeline.timeline.deleteDescription', { times: lane.times.length, rows })],
				label: t('actions.delete'),
			}, keep);
			if (!confirmed || disposed) return;
		}
		await enqueue(async () => {
			await controls.bridge().deleteTimeline(lane.id);
		});
	};

	// -- The times' actions --------------------------------------------------

	/** The time note's form, opened on its description; the model reads again only if it saved. */
	const editTime = (entry: RowEntry): void => {
		const time = entry.time;
		const path = controls.projectPath();
		if (time === null || path === null || readOnly) return;
		let saved = false;
		void enqueue(async () => {
			await host.openEntityForm({ mode: 'edit', id: time.id, section: 'description' }, path, () => {
				saved = true;
			});
		}, () => (saved ? 'model' : 'none'));
	};

	const openTimeMenu = (entry: RowEntry, event: MouseEvent): void => {
		const lane = lanes.find((candidate) => candidate.id === activeId) ?? null;
		const time = entry.time;
		const menu = new Menu();
		if (time !== null) {
			menu.addItem((item) => {
				item
					.setTitle(t('actions.edit'))
					.setIcon('pencil')
					.setDisabled(readOnly)
					.onClick(() => {
						editTime(entry);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle(t('common.open'))
					.setIcon('file-text')
					.onClick(() => {
						void host.openManagedFile(time.path).catch(notice);
					});
			});
			menu.addSeparator();
		}
		const at = rowOrder.indexOf(entry.timeId);
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(readOnly || at <= 0)
				.onClick(() => {
					moveTime(entry.timeId, rowOrder[at - 1] ?? null);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(readOnly || at === -1 || at >= rowOrder.length - 1)
				.onClick(() => {
					moveTime(entry.timeId, rowOrder[at + 2] ?? null);
				});
		});
		// A time put in after this one, on the active lane: before the row below, or at the foot.
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.time.insertAfter'))
				.setIcon('calendar-plus')
				.setDisabled(readOnly || lane === null)
				.onClick(() => {
					void addTimeHere(rowOrder[at + 1] ?? null, null, true);
				});
		});
		menu.addSeparator();
		const held = lane !== null && laneCell(lane, entry.timeId) !== null;
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.time.remove', { timeline: lane?.name ?? '' }))
				.setIcon('x')
				.setWarning(true)
				.setDisabled(readOnly || !held)
				.onClick(() => {
					if (lane !== null) void removeTimeFrom(lane, entry);
				});
		});
		menu.showAtMouseEvent(event);
	};

	const removeTimeFrom = async (lane: Timeline, entry: RowEntry): Promise<void> => {
		if (disposed) return;
		const cell = laneCell(lane, entry.timeId);
		if (cell === null) return;
		if (cell.rows.length > 0) {
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('timeline.time.removeTitle', {
					name: entry.time?.name ?? t('timeline.time.missing'),
					timeline: lane.name,
				}),
				lines: [t('timeline.time.removeDescription', { rows: cell.rows.length })],
				label: t('common.remove'),
			}, keep);
			if (!confirmed || disposed) return;
		}
		await enqueue(async () => {
			await controls.bridge().removeTime(lane.id, entry.timeId);
		});
	};

	// -- The cards' menu -----------------------------------------------------

	interface SceneMenuContext {
		path: string;
		viewId: string;
		timelineId: string;
		sceneId: string;
		/** Null when the scene came from the pool. */
		rowId: string | null;
	}
	/** A menu keeps the project, view, lane and source it opened on through its picker and queue. */
	const sceneMenuLane = (context: SceneMenuContext, read = reading): Timeline | null => {
		const current = controls.model();
		if (
			disposed || current === null || current.readOnly || readOnly ||
			controls.projectPath() !== context.path || current.path !== context.path ||
			read?.projectPath !== context.path || viewId !== context.viewId || activeId !== context.timelineId ||
			!findTimelineView(read.held, context.viewId)?.timelines.includes(context.timelineId) ||
			!current.scenes.some((scene) => scene.id === context.sceneId)
		) return null;
		const lane = read.held.timelines.find((candidate) => candidate.id === context.timelineId);
		if (lane === undefined) return null;
		const source = lane.times.flatMap((time) => time.rows).find((row) => row.scenes.includes(context.sceneId));
		return (source?.id ?? null) === context.rowId ? lane : null;
	};

	const sceneMenuContext = (sceneId: string, rowId: string | null): SceneMenuContext | null => {
		const path = controls.projectPath();
		if (path === null || viewId === null || activeId === null) return null;
		const context = { path, viewId, timelineId: activeId, sceneId, rowId };
		return sceneMenuLane(context) === null ? null : context;
	};

	/** What a card's menu opened on, handed to the cells: they place and move by it, and it answers for the view. */
	const sceneScope = (sceneId: string, rowId: string | null): SceneScope<TimelineReading> | null => {
		const context = sceneMenuContext(sceneId, rowId);
		if (context === null) return null;
		return {
			laneId: context.timelineId,
			sceneId,
			rowId,
			lane: (read) => sceneMenuLane(context, read),
		};
	};

	// -- The lanes' cells ----------------------------------------------------------

	const cells: LaneCells = createLaneCells<TimelineReading>({
		app,
		t,
		host,
		notice,
		keep,
		enqueue,
		bridge: () => controls.bridge(),
		unloading: () => controls.unloading?.() === true,
		disposed: () => disposed,
		readOnly: () => readOnly,
		projectPath: () => controls.projectPath(),
		root,
		ground: table,
		deck,
		lanes: () => lanes,
		documentLanes: () => reading?.held.timelines ?? null,
		// A time gone from its lane comes back with the row written under it, so
		// words are homeless only once the lane itself has left the document.
		cellStands: (timelineId) => reading?.held.timelines.some((lane) => lane.id === timelineId) === true,
		activeId: () => activeId,
		presentation: () => presentation,
		laneAxis: () => laneAxis,
		scenesById: () => scenesById,
		sceneIndex: () => sceneIndex,
		stackKey: (timelineId, rowId) => {
			const view = currentView();
			return view === null ? null : stackKey(view.id, timelineId, rowId);
		},
		stackPositions: () => memory.stackPositions,
		placeName,
		sceneScope,
		subrowMenuItems: (menu, lane, time, rowId) => {
			menu.addItem((item) => {
				item
					.setTitle(t('timeline.subrow.moveToTime'))
					.setIcon('corner-down-right')
					.setDisabled(readOnly || otherRowTimes(lane, time.timeId).length === 0)
					.onClick(() => { moveRowToTime(lane, time, rowId); });
			});
		},
		words: { editGone: 'timeline.subrow.editGone', addGone: 'timeline.subrow.addGone', sceneRemove: 'timeline.scene.remove' },
		dragTypes: { row: TIMELINE_ROW_DRAG_TYPE, scene: TIMELINE_SCENE_DRAG_TYPE },
		// The lanes' heads wear the phase as their cells do.
		dragPhase: (stateOf) => {
			for (const entry of laneHeads.values()) {
				const state = stateOf(entry.id);
				entry.el.toggleClass('is-drag-lane', state === 'lane');
				entry.el.toggleClass('is-locked-out', state === 'locked');
			}
		},
		endDrag: () => {
			endDrag();
		},
	});

	// -- The views' and timelines' forms -------------------------------------

	/** The Add timeline form; resolves with the id made once the form is gone, or null. */
	const addTimeline = (offerView: boolean): Promise<string | null> =>
		new Promise((resolve) => {
			const held = reading?.held;
			if (held === undefined || readOnly || disposed) {
				resolve(null);
				return;
			}
			let made: string | null = null;
			const modal = keep(new AddTimelineModal(
				app,
				t,
				{
					takenNames: held.timelines.map((timeline) => timeline.name),
					roster: () => roster,
					offerView: offerView && currentView() !== null,
				},
				async (draft) => {
					if (disposed) return;
					await enqueue(async () => {
						const bridge = controls.bridge();
						const id = await bridge.createTimeline(draft.name, draft.binding);
						made = id;
						const view = currentView();
						if (id !== null && draft.addToView && view !== null) {
							await bridge.setViewTimelines(view.id, [...view.timelines, id]);
							if (view.timelines.length === 0) memory.activeTimeline.set(view.id, id);
						}
					});
				},
			));
			const closed = modal.onClose.bind(modal);
			modal.onClose = (): void => {
				closed();
				resolve(made);
			};
			modal.open();
		});

	const openAddView = (): void => {
		const held = reading?.held;
		if (held === undefined || readOnly || disposed) return;
		keep(new TimelineViewFormModal(
			app,
			t,
			{
				mode: 'add',
				takenNames: held.views.map((view) => view.name),
				initial: {
					name: '',
					timelines: held.timelines.length === 1 ? [held.timelines[0]!.id] : [],
				},
				// The lanes as the last read that came back had them. A read
				// that found nothing is not a project without lanes: answered
				// so, the form would save the new view with none of them.
				timelines: () => reading?.held.timelines ?? lastHeld?.timelines ?? [],
				addTimeline: () => addTimeline(false),
			},
			async (draft) => {
				if (disposed) return;
				await enqueue(async () => {
					const bridge = controls.bridge();
					const id = await bridge.createView(draft.name, draft.timelines);
					if (id === null) return;
					viewId = id;
					await bridge.setLastView(id);
				});
			},
		)).open();
	};

	const openEditView = (): void => {
		const held = reading?.held;
		const view = currentView();
		if (held === undefined || view === null || readOnly || disposed) return;
		keep(new TimelineViewFormModal(
			app,
			t,
			{
				mode: 'edit',
				takenNames: held.views.filter((candidate) => candidate.id !== view.id).map((candidate) => candidate.name),
				initial: { name: view.name, timelines: [...view.timelines] },
				// The lanes as the last read that came back had them, which is
				// not always what this form opened on: a lane added while it
				// stands open is one of the project's. A read that found
				// nothing is not a project without lanes either: answered so,
				// the form would drop every line it shows and a save would
				// write the view empty, taking lanes away that were never
				// touched.
				timelines: () => reading?.held.timelines ?? lastHeld?.timelines ?? held.timelines,
				addTimeline: () => addTimeline(false),
				deleteView: async () => {
					if (disposed) return false;
					const confirmed = await confirmTimelineAction(app, t, {
						title: t('timeline.view.deleteTitle', { name: view.name }),
						lines: [t('timeline.view.deleteDescription')],
						label: t('actions.delete'),
					}, keep);
					if (!confirmed || disposed) return false;
					// The form closes on this answer, so it is the file's answer
					// and not the asking: a view the project would not let go
					// stands, and its form stands open with it, saying so.
					let gone = false;
					await enqueue(async () => {
						gone = await controls.bridge().deleteView(view.id);
					});
					if (!gone && !disposed) new Notice(t('timeline.view.deleteRefused'));
					return gone;
				},
			},
			async (draft) => {
				if (disposed) return;
				await enqueue(async () => {
					const bridge = controls.bridge();
					// Against the view as it stands now, so a name already so is not written again.
					const standing = (reading === null ? undefined : findTimelineView(reading.held, view.id)) ?? view;
					if (draft.name !== standing.name) await bridge.renameView(view.id, draft.name);
					await bridge.setViewTimelines(view.id, draft.timelines);
				});
			},
		)).open();
	};

	// The pool is the corkboard in one column, showing what the active lane
	// has not placed; its search, funnel, grouping and order are its own,
	// and the card style it chooses dresses the lanes' cards as well.
	const poolControls: CorkboardControls = {
		app,
		host,
		t,
		model: () => model,
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
	poolHandle = controls.corkboard(poolHost, poolControls, {
		include: (scene) => !assigned.has(scene.id),
		addButton: 'icon',
		// The pool is one card wide, which leaves the band no room for the words
		// in its search field beside the five controls that follow them.
		searchLabel: 'quiet',
		columns: 1,
		// One column has no insertion buttons to leave room for between cards.
		gap: 0.75,
		emptyText: t('timeline.pool.empty'),
		modeShared: true,
		// Its cards leave for the cells and come back to it, and its menu places a scene as a lane's does.
		...cells.poolVariant(),
	});

	paintAll();
	void reload();

	const handle: TimelineHandle = {
		refresh: () => {
			// Nothing read means the project was not there to be read when the
			// last read went out, as it is not for as long as a rename is in
			// flight. The model landing is the word that it may be there now, so
			// the document is asked for again rather than painted as it was.
			if (reading === null) void reload();
			else paintAll();
		},
		reveal: (id) => {
			// A card can only be shown in a pool that stands.
			fold('pool', false);
			poolHandle?.reveal(id);
		},
		remeasure: () => {
			invalidateRects();
			fitScrollbars();
			poolHandle?.remeasure();
		},
		saveFocusedConflict: () => {
			const active = root.doc.activeElement;
			for (const card of deck.cards.values()) {
				if (card.conflict !== active) continue;
				deck.commitConflict(card);
				return true;
			}
			return poolHandle?.saveFocusedConflict() ?? false;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			loop.release();
			stopMigration?.();
			unbindWindow(eventWindow);
			poolHandle?.dispose();
			poolHandle = null;
			// Closing resolves addTimeline and declines standing confirmations.
			// The recovery dialog opens separately after this disposal returns.
			// Each is closed on its own: a dialog that throws on the way out
			// would otherwise take the words below with it, and those are the
			// author's, with no second chance once the workspace has gone.
			for (const modal of [...standing]) {
				try {
					modal.close();
				} catch (error) {
					console.error('Snowflake: a timeline dialog could not be closed', error);
				}
			}
			standing.clear();
			// Words still being written go the way a leave sends them.
			cells.settle();
			deck.dispose();
			sizeObserver?.disconnect();
			viewField?.destroy();
			root.remove();
		},
	};
	return handle;
};
