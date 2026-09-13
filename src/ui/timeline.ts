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

import { Keymap, Menu, Notice, getIcon, setIcon, setTooltip } from 'obsidian';

import {
	derivedPresentation,
	findTimelineView,
	resolveEntityRefs,
	type EntityRef,
	type EntityRosterEntry,
	type ScenePresentation,
	type Timeline,
	type TimelineDocument,
	type TimelineRow,
	type TimelineTime,
	type TimelineView,
} from '../domain';
import { entityGroupLabel } from './entity-form';
import { promptForEntityReference, type EntityReferenceSource } from './modals';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';
import type { CorkboardControls, CorkboardHandle } from './corkboard-bridge';
import { paintCount, renderEmptyLine } from './pane-parts';
import {
	SCENE_CARD_PART_CLASSES,
	SCENE_CARD_SELECTOR,
	controlWithin,
	pressWithin,
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
	type TimelineBridge,
	type TimelineHandle,
	type TimelineReading,
} from './timeline-bridge';
import {
	AddTimelineModal,
	TimelineDraftModal,
	TimelineViewFormModal,
	confirmTimelineAction,
	renameTimelineForm,
	type RecoveredTimelineDraft,
} from './timeline-forms';
import {
	assignedSceneIds,
	cellDragState,
	clampStackPosition,
	laneCell,
	laneOrder,
	joinKey,
	keyPrefix,
	layoutKind,
	placementIndexAt,
	reorderIds,
	resolveActiveTimeline,
	rowAcceptsScene,
	splitKey,
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

/** What follows a queued change: a read of the document, a read of the model, or a paint alone. */
/**
 * What a change asks for once it is done: the document read again, the model
 * read again, a paint alone, or nothing at all, for a change that moves only
 * what the tab remembers and has already been shown.
 */
type After = 'document' | 'model' | 'none' | 'nothing';

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

/** A row's scenes as a stack: one card in front, the rest counted behind it, and the controls that walk them. */
interface StackEntry {
	el: HTMLElement;
	/** Where the one card in front stands; the rear layers are drawn behind it. */
	face: HTMLElement;
	controls: HTMLElement;
	previous: HTMLButtonElement;
	next: HTMLButtonElement;
	reset: HTMLButtonElement;
	position: HTMLElement;
}

/** One sub-description on one lane at one time: its words and the scenes on it. */
interface SubrowEntry {
	rowId: string;
	el: HTMLElement;
	handle: HTMLButtonElement;
	label: HTMLButtonElement;
	input: HTMLTextAreaElement;
	more: HTMLButtonElement;
	/** True while the words are being edited in place; a paint leaves the input alone. */
	editing: boolean;
	/** The words the edit began from, to revert to on Escape. */
	original: string;
	/** The words the input held as the edit opened: kept, on their way, or the file's own. */
	opened: string;
	/** Whether the input opened on the file's own words, which are nobody's to write again. */
	openedFromFile: boolean;
	/** The generation of the write the opened words were on their way in, when they were; null otherwise. */
	openedGeneration: number | null;
	scenes: HTMLElement;
	/** Stand-ins for scenes the project no longer has, by scene id. */
	missing: Map<string, HTMLElement>;
	/** The stack the scenes stand in while the view shows them stacked; null while they lie flat. */
	stack: StackEntry | null;
}

/** A row typed and not yet read back: shown at once, taken down once the document holds it. */
interface PendingRow {
	el: HTMLElement;
}

/** The empty row at a cell's foot, where the next sub-description is typed. */
interface TrailingRow {
	el: HTMLElement;
	input: HTMLTextAreaElement;
}

/** One lane's cell in a time row: the axis, and the rows when the lane holds the time. */
interface CellEntry {
	timelineId: string;
	el: HTMLElement;
	axis: HTMLElement;
	present: boolean;
	rows: HTMLElement | null;
	trailing: TrailingRow | null;
	pending: PendingRow[];
	add: HTMLButtonElement | null;
	/** The plus on the rule above the cell, which puts a time on this lane before the row. */
	seamAdd: HTMLButtonElement;
	subrows: Map<string, SubrowEntry>;
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

const cardKey = (rowId: string, sceneId: string): string => joinKey(rowId, sceneId);
const sceneOfKey = (key: string): string => splitKey(key)[1] ?? '';
const rowOfKey = (key: string): string => splitKey(key)[0] ?? '';

/** Grows the words' box to what it holds, so a long sub-description is edited whole, as it is shown. */
const fitWords = (area: HTMLTextAreaElement): void => {
	area.setCssStyles({ height: '' });
	const inner = area.scrollHeight;
	if (!Number.isFinite(inner) || inner <= 0) return;
	const frame = area.offsetHeight - area.clientHeight;
	area.setCssStyles({ height: `${inner + (Number.isFinite(frame) && frame > 0 ? frame : 0)}px` });
};

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
		// last, which nothing on screen is drawn from, so no paint follows it.
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
	// the view's, so they are written to the document. Each press takes what
	// the document holds as its write lands, never what it held when the
	// press came: two presses in a breath answer each other, rather than
	// writing one value twice and leaving the view where the first put it.
	const wordsButton = iconButton('snowflake-method-timeline-words', 'eye', t('timeline.view.subDescriptionsHide'));
	wordsButton.setAttribute('aria-pressed', 'true');
	wordsButton.addEventListener('click', () => {
		if (readOnly || currentView() === null) return;
		void enqueue(async () => {
			const now = currentView();
			if (now === null) return;
			await controls.bridge().setViewSubDescriptions(now.id, !now.showSubDescriptions);
		});
	});
	const presentationButton = iconButton('snowflake-method-timeline-presentation', 'gallery-horizontal', t('timeline.presentation.toStack'));
	presentationButton.addEventListener('click', () => {
		choosePresentation();
	});
	const choosePresentation = (): void => {
		if (readOnly || currentView() === null) return;
		void enqueue(async () => {
			const now = currentView();
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
		if (readOnly || currentView() === null) return;
		void enqueue(async () => {
			const now = currentView();
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
	/** The document and the model the last paint was made from. */
	let paintedHeld: TimelineDocument | null = null;
	let paintedModel: ProjectDashboardModel | null = null;
	/** Whether the paint after the read in flight was asked for by the workspace itself. */
	let paintDemanded = false;
	/** The symbols the two switches wear now, so a paint redraws neither for nothing. */
	let presentationIcon = 'gallery-horizontal';
	let wordsIcon = 'eye';
	let orderIcon = 'arrow-down-narrow-wide';
	let readOnly = true;
	let roster: EntityRosterEntry[] = [];
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
	let boundBridge: TimelineBridge | null = null;
	let unsubscribe: (() => void) | null = null;
	/** The read in flight, which a second request joins rather than starting another. */
	let reloadRun: Promise<void> | null = null;
	let reloadPending = false;
	let queue: Promise<void> = Promise.resolve();
	let disposed = false;
	let poolHandle: CorkboardHandle | null = null;
	/** The times' ids in the order the rows stand, from the last paint. */
	let rowOrder: string[] = [];
	/** The drag in flight, while one is; every paint asked meanwhile waits. */
	let drag: TimelineDrag | null = null;
	let paintOwed = false;
	/** Where a drop would land, as the class on the element that wears the line. */
	let mark: { el: HTMLElement; cls: string } | null = null;
	/** What the last dragover worked out, which the drop then uses: the time or the row a drop lands before. */
	let timeLanding: { timeId: string | null } | null = null;
	let rowLanding: { cell: CellEntry; rowId: string | null } | null = null;
	/** Where a scene would land: a row and the scene it goes before, or the trailing row for a row of its own. */
	let sceneLanding: { cell: CellEntry; rowId: string | null; beforeSceneId: string | null } | null = null;
	/** Measured once per drag, dropped on scroll, resize, paint and drag end. */
	let rects: {
		rows: DOMRect[] | null;
		subrows: Map<HTMLElement, { rowId: string; middle: number }[]>;
		cards: Map<HTMLElement, { sceneId: string; el: HTMLElement; rect: DOMRect }[]>;
	} = { rows: null, subrows: new Map(), cards: new Map() };
	const invalidateRects = (): void => {
		rects = { rows: null, subrows: new Map(), cards: new Map() };
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
		charactersByPath: () => charactersByPath,
		scenesById: () => scenesById,
		manuscriptPositions: () => manuscriptPositions,
		resolveManuscriptPath,
		// A card drags from the active lane alone; in a single lane that is every card.
		dragAllowed: (card) => !readOnly && laneOfRow(rowOfKey(card.key))?.id === activeId,
		menu: (card, event) => {
			openCardMenu(card, event);
		},
		extend: (card) => card,
	});

	// -- Reading and writing -------------------------------------------------

	/** Hears the bridge standing now; a project rename hands the workspace a new one. */
	const bind = (bridge: TimelineBridge): void => {
		if (bridge === boundBridge) return;
		unsubscribe?.();
		boundBridge = bridge;
		unsubscribe = bridge.subscribe(() => {
			void reload(true);
		});
	};

	/** Reads the document again and paints; a read asked mid-read is made once this one lands. */
	/**
	 * Reads the document again and paints. A request made while a read is in
	 * flight joins it and is answered by one more pass after it, so a change
	 * that awaits its read gets the document as it stands after the write,
	 * even when the plugin's bell had already set a read going.
	 */
	const reload = (maySkipPaint = false): Promise<void> => {
		if (disposed) return Promise.resolve();
		// A read the workspace asked for paints whatever comes back: what moved
		// may be the workspace's own, a draft kept or a label dressed again from
		// the file, which neither the document nor the model knows anything of.
		// Only the bell, which rings for every write including this workspace's,
		// may go quiet when the read brings back what is already shown.
		if (!maySkipPaint) paintDemanded = true;
		if (reloadRun !== null) {
			reloadPending = true;
			return reloadRun;
		}
		reloadRun = (async () => {
			try {
				do {
					reloadPending = false;
					const bridge = controls.bridge();
					bind(bridge);
					try {
						reading = await bridge.read();
						loadFailed = false;
					} catch (error) {
						reading = null;
						loadFailed = true;
						console.error('Snowflake: the timeline could not be read', error);
					}
					if (disposed) return;
				} while (reloadPending);
			} finally {
				reloadRun = null;
			}
			// A bell bringing back the very document and model the last paint was
			// made from has nothing to show. It rings a quarter second after
			// every write the workspace makes itself, so without this the whole
			// workspace, the pool with it, is painted twice for one change.
			const moved = (reading?.held ?? null) !== paintedHeld || controls.model() !== paintedModel;
			if (paintDemanded || moved) {
				paintDemanded = false;
				paintAll();
			}
		})();
		return reloadRun;
	};

	/**
	 * Every change the workspace makes, one after another, each followed by
	 * what it asked for: a read of the document, a read of the model, or a
	 * paint alone -- asked as a value, or as a question answered once the
	 * change is done, for a form that may or may not have saved. A change
	 * queued before the workspace went still lands.
	 */
	const enqueue = (action: () => Promise<void>, after: After | (() => After) = 'document'): Promise<void> => {
		const run = queue.then(async () => {
			try {
				await action();
			} catch (error) {
				if (!disposed) notice(error);
			}
			if (disposed) return;
			// What follows the change is guarded as the change is. A paint that
			// throws would else reject this promise, and the callers waiting on
			// it would never do their own tidying: an optimistic row would stand
			// for good, and words on their way would be counted as sent and
			// never written again.
			try {
				const then = typeof after === 'function' ? after() : after;
				if (then === 'document') await reload();
				else if (then === 'model') await controls.refresh();
				else if (then === 'none') paintAll();
			} catch (error) {
				if (!disposed) notice(error);
			}
		});
		queue = run.catch(() => undefined);
		return run;
	};

	const currentView = (): TimelineView | null => {
		if (reading === null || viewId === null) return null;
		return findTimelineView(reading.held, viewId) ?? null;
	};

	const laneOfRow = (rowId: string): Timeline | null =>
		lanes.find((lane) => lane.times.some((time) => time.rows.some((row) => row.id === rowId))) ?? null;

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
	 * heads and the rows of times under them.
	 */
	const paintAll = (): void => {
		if (disposed) return;
		if (drag !== null) {
			paintOwed = true;
			return;
		}
		invalidateRects();
		paintFolds();
		const nextModel = controls.model();
		if (nextModel !== model) {
			// Every one of these is the model's own and says the same thing for
			// as long as the model does, so they are made again only when it is
			// another model. A paint over the model that stands would else build
			// some thousands of entries afresh to say what they already said.
			manuscriptPositions = new Map(nextModel?.manuscriptPaths.map((path, index) => [path, index]));
			roster = nextModel === null ? [] : rosterOf(nextModel);
			scenesById = new Map(nextModel?.scenes.map((scene) => [scene.id, scene]) ?? []);
			sceneIndex = new Map(nextModel?.scenes.map((scene, index) => [scene.id, index]) ?? []);
			charactersByPath = new Map(nextModel?.characters.map((character) => [character.path, character]) ?? []);
		}
		model = nextModel;
		// What this paint is made from, marked before any of it is drawn: the
		// empty states leave by their own way out, and a read that comes back
		// with this same pair must find it marked whichever way the paint went.
		paintedHeld = reading?.held ?? null;
		paintedModel = nextModel;
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
			attr: { 'aria-label': t('timeline.timeline.pinned') },
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
		const binding = lane.binding === null ? null : (resolveEntityRefs([lane.binding], roster)[0] ?? null);
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
			drag = { kind: 'time', timeId: entry.timeId };
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
		sweepParked();
		sweepCards();
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
		sweepParked();
		sweepCards();
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
		const cell: CellEntry = { timelineId, el, axis, seamAdd, present: false, rows: null, trailing: null, pending: [], add: null, subrows: new Map() };
		// A row lands in a cell of its own lane, before the sub-row under the
		// pointer or at the foot; another lane's cell says no, as a cursor.
		// The mark moves from dragover alone: Chromium fires dragleave at
		// every child boundary, and a mark cleared there flickers.
		el.addEventListener('dragover', (event) => {
			if (drag?.kind === 'scene') {
				sceneDragOver(cell, event);
				return;
			}
			if (drag?.kind !== 'row' || event.dataTransfer?.types.includes(TIMELINE_ROW_DRAG_TYPE) !== true) return;
			event.preventDefault();
			if (drag.timelineId !== cell.timelineId) {
				// Refused here, so the line drawn on the lane the pointer came from
				// goes with it: a mark left standing shows a landing while the
				// cursor says there is none.
				event.dataTransfer.dropEffect = 'none';
				clearMark();
				rowLanding = null;
				return;
			}
			event.dataTransfer.dropEffect = 'move';
			const landing = subrowLanding(cell, drag.rowId, event.clientY);
			rowLanding = { cell, rowId: landing?.rowId ?? null };
			if (landing === null) setMark(cell.el, 'is-drop-target');
			else setMark(landing.el, 'is-drop-before');
		});
		el.addEventListener('drop', (event) => {
			if (drag?.kind === 'scene') {
				sceneDrop(cell, row.timeId, event);
				return;
			}
			const dragged = event.dataTransfer?.getData(TIMELINE_ROW_DRAG_TYPE) ?? '';
			if (drag?.kind !== 'row' || drag.rowId !== dragged || drag.timelineId !== cell.timelineId) return;
			event.preventDefault();
			// The landing the last dragover worked out, for the drop it was shown for.
			const beforeRowId = rowLanding?.cell === cell
				? rowLanding.rowId
				: (subrowLanding(cell, drag.rowId, event.clientY)?.rowId ?? null);
			clearMark();
			const { timelineId, rowId } = drag;
			void enqueue(async () => {
				await controls.bridge().moveRow(timelineId, rowId, row.timeId, beforeRowId);
			});
		});
		return cell;
	};

	/**
	 * Where a dragged row would land in a cell: the sub-row whose middle is
	 * below the pointer, the trailing row for the foot, or nothing where the
	 * cell has no rows to land among.
	 */
	const subrowLanding = (
		cell: CellEntry,
		draggedRowId: string,
		clientY: number,
	): { el: HTMLElement; rowId: string | null } | null => {
		const rows = cell.rows;
		if (rows === null) return null;
		let measured = rects.subrows.get(rows);
		if (measured === undefined) {
			measured = [...cell.subrows.values()]
				.filter((entry) => entry.rowId !== draggedRowId && entry.el.isConnected)
				.map((entry) => {
					const box = entry.el.getBoundingClientRect();
					return { rowId: entry.rowId, middle: box.top + box.height / 2 };
				})
				.sort((a, b) => a.middle - b.middle);
			rects.subrows.set(rows, measured);
		}
		const at = dropIndexAt(measured.map((entry) => entry.middle), clientY);
		const landing = measured[at];
		if (landing !== undefined) {
			const entry = cell.subrows.get(landing.rowId);
			if (entry !== undefined) return { el: entry.el, rowId: landing.rowId };
		}
		return cell.trailing === null ? null : { el: cell.trailing.el, rowId: null };
	};

	/** Takes a cell's inner parts down: the rows and their cards, or the plus. */
	const clearCell = (cell: CellEntry): void => {
		for (const rowId of [...cell.subrows.keys()]) unmountSubrow(cell, rowId);
		for (const pending of cell.pending) pending.el.remove();
		cell.pending = [];
		cell.trailing?.el.remove();
		cell.trailing = null;
		cell.rows?.remove();
		cell.rows = null;
		cell.add?.remove();
		cell.add = null;
	};

	const unmountCell = (row: RowEntry, timelineId: string): void => {
		const cell = row.cells.get(timelineId);
		if (cell === undefined) return;
		clearCell(cell);
		cell.el.remove();
		row.cells.delete(timelineId);
	};

	const dressCell = (row: RowEntry, cell: CellEntry, lane: Timeline): void => {
		const time = laneCell(lane, row.timeId);
		const present = time !== null;
		if (present !== cell.present || (present ? cell.rows === null : cell.add === null)) {
			clearCell(cell);
			cell.present = present;
			if (present) {
				cell.rows = cell.el.createDiv({ cls: 'snowflake-method-timeline-rows' });
				cell.trailing = buildTrailing(cell, row.timeId);
			} else {
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
		if (cell.trailing !== null) {
			cell.trailing.el.toggleClass('is-hidden', readOnly);
			cell.trailing.input.disabled = readOnly;
			// The foot invites the first sub-description, then more of them; under
			// rows it keeps out of the way until the row is hovered or a drag wants it.
			const more = time !== null && time.rows.length + cell.pending.length > 0;
			cell.trailing.el.toggleClass('is-more', more);
			cell.trailing.input.setAttribute('placeholder', t(more ? 'timeline.subrow.placeholderMore' : 'timeline.subrow.placeholder'));
		}
		if (cell.add !== null) {
			const label = t('timeline.cell.addTime', { timeline: lane.name });
			cell.add.setAttribute('aria-label', label);
			setTooltip(cell.add, label);
			cell.add.disabled = readOnly;
		}
		if (time !== null) paintSubrows(cell, time, lane);
	};

	// -- The sub-rows of a cell ----------------------------------------------

	const buildSubrow = (cell: CellEntry, rowId: string): SubrowEntry => {
		const rows = cell.rows;
		if (rows === null) throw new Error('A sub-row needs the rows of a present cell.');
		const el = rows.createDiv({
			cls: 'snowflake-method-timeline-subrow',
			attr: { 'data-row-id': rowId },
		});
		// New rows stand before the trailing one, which keeps the foot of the cell.
		rows.insertBefore(el, cell.trailing?.el ?? null);
		// The handle leads the words' box, which holds at the frozen edge with
		// the axis while the lane scrolls under, so the row keeps its name in view.
		const text = el.createDiv({ cls: 'snowflake-method-timeline-subrow-text' });
		const handle = text.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-subrow-handle',
			attr: { type: 'button', 'aria-label': t('timeline.subrow.drag'), draggable: 'true' },
		});
		setIcon(handle, 'grip-vertical');
		setTooltip(handle, t('timeline.subrow.drag'));
		const label = text.createEl('button', {
			cls: 'snowflake-method-timeline-subrow-label',
			attr: { type: 'button' },
		});
		const input = text.createEl('textarea', {
			cls: 'snowflake-method-timeline-subrow-input is-hidden',
			attr: { rows: '1', 'aria-label': t('timeline.subrow.label') },
		});
		const more = text.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-subrow-more',
			attr: { type: 'button', 'aria-label': t('table.actions'), 'aria-haspopup': 'menu' },
		});
		setIcon(more, 'ellipsis');
		setTooltip(more, t('table.actions'));
		const scenes = el.createDiv({
			cls: 'snowflake-method-timeline-scenes',
			attr: { role: 'list' },
		});
		const entry: SubrowEntry = { rowId, el, handle, label, input, more, editing: false, original: '', opened: '', openedFromFile: true, openedGeneration: null, scenes, missing: new Map(), stack: null };
		handle.addEventListener('dragstart', (event) => {
			const time = timeOfRow(cell, entry.rowId);
			if (readOnly || event.dataTransfer === null || time === null) {
				event.preventDefault();
				return;
			}
			drag = { kind: 'row', timelineId: cell.timelineId, timeId: time.timeId, rowId: entry.rowId };
			invalidateRects();
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(TIMELINE_ROW_DRAG_TYPE, entry.rowId);
			if (typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(entry.el, 8, 8);
			root.addClass('is-row-drag');
			entry.el.addClass('is-dragging');
			paintDragPhase();
		});
		handle.addEventListener('dragend', () => {
			entry.el.removeClass('is-dragging');
			endDrag();
		});
		label.addEventListener('click', () => {
			beginRowEdit(cell, entry);
		});
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			// Enter breaks a paragraph; the words are written on Mod+Enter, as a card's conflict is.
			if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
				event.preventDefault();
				commitRowEdit(cell, entry, true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				// Escape lets the words go, kept ones from a write that failed as well.
				rowDrafts.delete(entry.rowId);
				endRowEdit(entry, true);
			}
		});
		input.addEventListener('input', () => {
			fitWords(input);
		});
		input.addEventListener('blur', () => {
			commitRowEdit(cell, entry, false);
		});
		more.addEventListener('click', (event) => {
			event.stopPropagation();
			openSubrowMenu(cell, entry, event);
		});
		el.addEventListener('contextmenu', (event) => {
			if (controlWithinRow(event.target, entry)) return;
			event.preventDefault();
			openSubrowMenu(cell, entry, event);
		});
		return entry;
	};

	/** Whether a right click landed on a card or a control of the row, which answer for themselves. */
	const controlWithinRow = (target: EventTarget | null, entry: SubrowEntry): boolean => {
		if (target === null || !(target as Node).instanceOf(Element)) return false;
		const el = target as Element;
		return el.closest(SCENE_CARD_SELECTOR) !== null || (el !== entry.el && el !== entry.label && el.closest('button, input') !== null);
	};

	/** The empty row at the foot of a cell: typing there and pressing Enter makes a row and keeps the focus for the next. */
	/**
	 * The words at each cell's foot that are not yet a row, by lane and
	 * time. The input shows them; this keeps them, through any rebuild of
	 * the cell, until they are written or cleared. Showing them again does
	 * not spend them.
	 */
	const footWords = new Map<string, string>();
	const footKey = (timelineId: string, timeId: string): string => joinKey(timelineId, timeId);
	/**
	 * The feet an input method is composing in, and the words held back from
	 * them while it is. Writing a value into an input mid-composition takes the
	 * text the method is still working on out from under it, and what was typed
	 * so far is left behind as bare letters.
	 */
	const composingFeet = new WeakSet<HTMLTextAreaElement>();
	const withheldFeet = new WeakMap<HTMLTextAreaElement, string>();

	const keepFoot = (key: string, value: string): void => {
		if (value.length === 0) footWords.delete(key);
		else footWords.set(key, value);
	};

	/**
	 * Words given back to a cell's foot, ahead of whatever was typed there
	 * since: on the input when the cell is shown, and in the keeping either way.
	 */
	const giveBack = (timelineId: string, timeId: string, words: string): void => {
		const key = footKey(timelineId, timeId);
		const foot = timeRows.get(timeId)?.cells.get(timelineId)?.trailing?.input;
		const shown = foot !== undefined && foot.isConnected ? foot : null;
		// A lane the document no longer holds has no foot for the words to come
		// back to, at this paint or any after it. Put by under its key they
		// would be out of sight until the workspace closed, so they are shown
		// for keeping at once, as an edit of a row that has gone is.
		if (shown === null && reading?.held.timelines.some((lane) => lane.id === timelineId) !== true) {
			footWords.delete(key);
			recoverWords(placeName(timelineId, timeId), words);
			return;
		}
		// A foot being composed in is left as it stands: the words wait aside
		// and go in when the composition ends, ahead of whatever it left there.
		if (shown !== null && composingFeet.has(shown)) {
			const already = withheldFeet.get(shown);
			withheldFeet.set(shown, already === undefined ? words : `${already}\n${words}`);
			return;
		}
		const since = shown?.value ?? footWords.get(key) ?? '';
		const value = since.trim().length === 0 ? words : `${words}\n${since}`;
		keepFoot(key, value);
		if (shown === null) return;
		shown.value = value;
		fitWords(shown);
	};

	const buildTrailing = (cell: CellEntry, timeId: string): TrailingRow => {
		const rows = cell.rows;
		if (rows === null) throw new Error('A trailing row needs the rows of a present cell.');
		const el = rows.createDiv({ cls: 'snowflake-method-timeline-subrow is-trailing' });
		const text = el.createDiv({ cls: 'snowflake-method-timeline-subrow-text' });
		text.createSpan({ cls: 'snowflake-method-timeline-subrow-handle-space' });
		const input = text.createEl('textarea', {
			cls: 'snowflake-method-timeline-subrow-input',
			attr: {
				rows: '1',
				'aria-label': t('timeline.subrow.label'),
				placeholder: t('timeline.subrow.placeholder'),
			},
		});
		el.createDiv({ cls: 'snowflake-method-timeline-scenes is-trailing', attr: { role: 'presentation' } });
		const key = footKey(cell.timelineId, timeId);
		const held = footWords.get(key);
		if (held !== undefined) {
			input.value = held;
			fitWords(input);
		}
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
				event.preventDefault();
				commitTrailing(cell, timeId, input);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				input.value = '';
				keepFoot(key, '');
				fitWords(input);
				input.blur();
			}
		});
		input.addEventListener('input', () => {
			keepFoot(key, input.value);
			fitWords(input);
		});
		input.addEventListener('compositionstart', () => {
			composingFeet.add(input);
		});
		input.addEventListener('compositionend', () => {
			composingFeet.delete(input);
			const kept = withheldFeet.get(input);
			withheldFeet.delete(input);
			if (kept === undefined) return;
			input.value = input.value.trim().length === 0 ? kept : `${kept}\n${input.value}`;
			keepFoot(key, input.value);
			fitWords(input);
		});
		input.addEventListener('blur', () => {
			commitTrailing(cell, timeId, input);
		});
		return { el, input };
	};

	/**
	 * The words typed at the foot of a cell become a row: shown at once as a
	 * pending row, written through the queue, and taken down once the
	 * document has been read back with the row in it. The input is emptied
	 * and keeps the focus, which is the next row already begun. A write
	 * refused or failed gives the words back to the cell's foot, ahead of
	 * whatever was typed there since, where they are kept until written.
	 */
	const commitTrailing = (cell: CellEntry, timeId: string, input: HTMLTextAreaElement): void => {
		const words = input.value.trim();
		if (words.length === 0 || readOnly) return;
		input.value = '';
		keepFoot(footKey(cell.timelineId, timeId), '');
		fitWords(input);
		const rows = cell.rows;
		if (rows === null) return;
		const el = rows.createDiv({ cls: 'snowflake-method-timeline-subrow is-pending' });
		rows.insertBefore(el, cell.trailing?.el ?? null);
		const text = el.createDiv({ cls: 'snowflake-method-timeline-subrow-text' });
		text.createSpan({ cls: 'snowflake-method-timeline-subrow-handle-space' });
		text.createEl('button', {
			cls: 'snowflake-method-timeline-subrow-label',
			text: words,
			attr: { type: 'button', disabled: 'true' },
		});
		el.createDiv({ cls: 'snowflake-method-timeline-scenes', attr: { role: 'presentation' } });
		const pending: PendingRow = { el };
		cell.pending.push(pending);
		const timelineId = cell.timelineId;
		let written = false;
		void enqueue(async () => {
			const id = await controls.bridge().addRow(timelineId, timeId, words, null);
			if (id === null) throw new Error(t('timeline.subrow.refused'));
			written = true;
		}).then(() => {
			pending.el.remove();
			cell.pending = cell.pending.filter((candidate) => candidate !== pending);
			if (written) return;
			if (disposed) {
				recoverWords(placeName(timelineId, timeId), words);
				return;
			}
			giveBack(timelineId, timeId, words);
		});
	};

	/**
	 * The words of an edit whose write did not land, by row: the editor
	 * opens on them next, for another try, until they are written or let
	 * go with Escape. The label keeps showing what the document holds.
	 * Each edit of a row is a generation; a write that fails keeps its
	 * words only while no later edit of the row has followed it.
	 */
	const rowDrafts = new Map<string, { timelineId: string; words: string }>();
	const rowEdits = new Map<string, number>();
	/** The words last sent to be written for a row, until that write has settled: what an edit opened meanwhile starts from. */
	const rowPending = new Map<string, { generation: number; words: string }>();
	/** The latest generation of each row's writes known to have landed: words from one at or before it are the file's. */
	const rowWritten = new Map<string, number>();

	/**
	 * Words whose write failed after the workspace had gone have no field
	 * left to go back to: they go to a dialog that outlives it, gathered
	 * over a tick so failures landing together open one.
	 */
	let recoveryDrafts: RecoveredTimelineDraft[] = [];
	const recoverWords = (place: string, words: string): void => {
		if (recoveryDrafts.length === 0) {
			void Promise.resolve().then(() => {
				const drafts = recoveryDrafts;
				recoveryDrafts = [];
				new TimelineDraftModal(app, t, drafts).open();
			});
		}
		recoveryDrafts.push({ place, words });
	};
	/** Where words were meant to stand, as a writer would name it: the lane and the time. */
	const placeName = (timelineId: string, timeId: string | null): string => {
		const lane = reading?.held.timelines.find((candidate) => candidate.id === timelineId)?.name ?? timelineId;
		const time = model === null || timeId === null
			? null
			: kindEntities(model, 'time').find((candidate) => candidate.id === timeId)?.name ?? null;
		return time === null ? lane : `${lane} · ${time}`;
	};
	const placeOfRow = (timelineId: string, rowId: string): string => {
		const lane = reading?.held.timelines.find((candidate) => candidate.id === timelineId);
		const time = lane?.times.find((candidate) => candidate.rows.some((row) => row.id === rowId));
		return placeName(timelineId, time?.timeId ?? null);
	};

	const beginRowEdit = (cell: CellEntry, entry: SubrowEntry): void => {
		if (readOnly || entry.editing) return;
		const row = rowOfEntry(cell, entry);
		entry.editing = true;
		// What the row says as far as this workspace has asked: words on their
		// way to the file count, so a second edit is measured against them.
		const pending = rowPending.get(entry.rowId);
		const kept = rowDrafts.get(entry.rowId)?.words;
		entry.original = pending?.words ?? row?.text ?? '';
		entry.opened = kept ?? entry.original;
		entry.openedFromFile = kept === undefined && pending === undefined;
		entry.openedGeneration = kept === undefined && pending !== undefined ? pending.generation : null;
		entry.el.addClass('is-editing');
		entry.label.addClass('is-hidden');
		entry.input.removeClass('is-hidden');
		entry.input.value = entry.opened;
		fitWords(entry.input);
		entry.input.focus();
		entry.input.select();
	};

	const endRowEdit = (entry: SubrowEntry, refocus: boolean): void => {
		entry.editing = false;
		entry.el.removeClass('is-editing');
		entry.input.addClass('is-hidden');
		entry.label.removeClass('is-hidden');
		if (refocus) entry.label.focus({ preventScroll: true });
	};

	/**
	 * A row's words written through the queue. A write refused or failed
	 * keeps them for the row's next edit, once the read that follows has put
	 * the document's own words back on the label. A row that has gone has
	 * no next edit: its words go to the dialog at once.
	 */
	const writeRowWords = (timelineId: string, rowId: string, words: string): void => {
		// Kept or sent, these words are the row's latest edit: an earlier
		// write of the row that fails after this keeps nothing over them.
		const generation = (rowEdits.get(rowId) ?? 0) + 1;
		rowEdits.set(rowId, generation);
		if (readOnly) {
			// Nothing is asked of a project that cannot be written: the words
			// wait for the row's next edit, once it can be, or go to the
			// dialog when the workspace has gone.
			if (disposed) recoverWords(placeOfRow(timelineId, rowId), words);
			else rowDrafts.set(rowId, { timelineId, words });
			return;
		}
		rowPending.set(rowId, { generation, words });
		let outcome: 'written' | 'gone' | 'failed' = 'failed';
		void enqueue(async () => {
			const result = await controls.bridge().editRow(timelineId, rowId, words);
			if (result === 'absent') {
				outcome = 'gone';
				throw new Error(t('timeline.subrow.editGone'));
			}
			if (result !== 'written') throw new Error(t('timeline.subrow.editRefused'));
			outcome = 'written';
		}).then(() => {
			if (rowPending.get(rowId)?.generation === generation) rowPending.delete(rowId);
			if (outcome === 'written') rowWritten.set(rowId, Math.max(rowWritten.get(rowId) ?? 0, generation));
			if (rowEdits.get(rowId) !== generation || outcome === 'written') return;
			if (disposed || outcome === 'gone') {
				recoverWords(placeOfRow(timelineId, rowId), words);
				return;
			}
			rowDrafts.set(rowId, { timelineId, words });
		});
	};

	/**
	 * The words typed for an existing row, written only when they are the
	 * writer's own and not yet the file's. An editor opened on the file's
	 * words, or on words whose write has landed since, and left as it was
	 * has nothing to write, whatever the file has come to say meanwhile;
	 * one opened on kept words, or on words sent and then refused, has,
	 * even left as it was. Words already on their way, or already in the
	 * file, are not sent again.
	 */
	const commitRowEdit = (cell: CellEntry, entry: SubrowEntry, refocus: boolean): void => {
		if (!entry.editing) return;
		const words = entry.input.value;
		endRowEdit(entry, refocus);
		rowDrafts.delete(entry.rowId);
		// The label wears what the file has come to say while the edit was open, when nothing is written.
		const current = rowOfEntry(cell, entry)?.text ?? '';
		const openedLanded = entry.openedFromFile ||
			(entry.openedGeneration !== null && (rowWritten.get(entry.rowId) ?? 0) >= entry.openedGeneration);
		if (words === entry.opened && openedLanded) {
			dressLabel(entry, current);
			return;
		}
		const settled = rowPending.get(entry.rowId)?.words ?? current;
		if (words === settled) {
			dressLabel(entry, settled);
			return;
		}
		// The label wears the new words at once; the read that follows agrees.
		dressLabel(entry, readOnly ? current : words);
		writeRowWords(cell.timelineId, entry.rowId, words);
	};

	/** The time a row stands under on its lane, as the lane is now. */
	const timeOfRow = (cell: CellEntry, rowId: string): TimelineTime | null => {
		const lane = lanes.find((candidate) => candidate.id === cell.timelineId);
		return lane?.times.find((time) => time.rows.some((row) => row.id === rowId)) ?? null;
	};

	/** The stored row an entry stands for, from the lane as it is now. */
	const rowOfEntry = (cell: CellEntry, entry: SubrowEntry): TimelineRow | null => {
		const lane = lanes.find((candidate) => candidate.id === cell.timelineId);
		for (const time of lane?.times ?? []) {
			const row = time.rows.find((candidate) => candidate.id === entry.rowId);
			if (row !== undefined) return row;
		}
		return null;
	};

	const openSubrowMenu = (cell: CellEntry, entry: SubrowEntry, event: MouseEvent): void => {
		const lane = lanes.find((candidate) => candidate.id === cell.timelineId);
		const time = lane?.times.find((candidate) => candidate.rows.some((row) => row.id === entry.rowId));
		if (lane === undefined || time === undefined) return;
		const at = time.rows.findIndex((row) => row.id === entry.rowId);
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(readOnly || at <= 0)
				.onClick(() => {
					moveRowBy(lane, time, at, -1);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(readOnly || at === -1 || at >= time.rows.length - 1)
				.onClick(() => {
					moveRowBy(lane, time, at, 1);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.subrow.remove'))
				.setIcon('x')
				.setWarning(true)
				.setDisabled(readOnly)
				.onClick(() => {
					void removeRow(lane, time, entry.rowId);
				});
		});
		menu.showAtMouseEvent(event);
	};

	/** A row one step up or down among its time's rows, before the neighbour that then follows it. */
	const moveRowBy = (lane: Timeline, time: TimelineTime, at: number, step: -1 | 1): void => {
		const row = time.rows[at];
		if (row === undefined) return;
		const beforeId = step === -1 ? (time.rows[at - 1]?.id ?? null) : (time.rows[at + 2]?.id ?? null);
		void enqueue(async () => {
			await controls.bridge().moveRow(lane.id, row.id, time.timeId, beforeId);
		});
	};

	const removeRow = async (lane: Timeline, time: TimelineTime, rowId: string): Promise<void> => {
		const row = time.rows.find((candidate) => candidate.id === rowId);
		if (row === undefined) return;
		if (row.scenes.length > 0) {
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('timeline.subrow.removeTitle'),
				lines: [t('timeline.subrow.removeDescription', { count: row.scenes.length })],
				label: t('common.remove'),
			});
			if (!confirmed || disposed) return;
		}
		await enqueue(async () => {
			await controls.bridge().deleteRow(lane.id, rowId);
		});
	};

	/**
	 * The keys of a row's cards standing inside an element. A card is keyed
	 * by its row and scene alone, wherever the row is; one standing elsewhere
	 * is another paint's to take over, and is left to it.
	 */
	const cardsWithin = (rowId: string, el: HTMLElement): string[] =>
		[...deck.cards].filter(([key, card]) => key.startsWith(keyPrefix(rowId)) && el.contains(card.el)).map(([key]) => key);

	/**
	 * Sub-rows a cell has taken down in this paint, by lane and row. A row
	 * moved to another time on its lane is wanted there in the same paint,
	 * and takes its sub-row over as it stands: its cards, an open edit and
	 * the caret in it. What no cell takes is swept once the rows are painted.
	 */
	const parkedSubrows = new Map<string, { cell: CellEntry; entry: SubrowEntry }>();
	const parkKey = (timelineId: string, rowId: string): string => joinKey(timelineId, rowId);

	const unmountSubrow = (cell: CellEntry, rowId: string): void => {
		const entry = cell.subrows.get(rowId);
		if (entry === undefined) return;
		entry.el.remove();
		cell.subrows.delete(rowId);
		parkedSubrows.set(parkKey(cell.timelineId, rowId), { cell, entry });
	};

	/**
	 * The sub-row another cell of the lane holds for this row, or has just
	 * taken down, moved into this cell: the one it left is painted either
	 * before this one, and parked the sub-row, or after, and still holds it.
	 */
	const adoptSubrow = (cell: CellEntry, rowId: string): SubrowEntry | null => {
		const rows = cell.rows;
		if (rows === null) return null;
		const key = parkKey(cell.timelineId, rowId);
		let entry = parkedSubrows.get(key)?.entry ?? null;
		if (entry !== null) {
			parkedSubrows.delete(key);
		} else {
			for (const timeRow of timeRows.values()) {
				const holder = timeRow.cells.get(cell.timelineId);
				const held = holder?.subrows.get(rowId);
				if (holder === undefined || holder === cell || held === undefined) continue;
				holder.subrows.delete(rowId);
				entry = held;
				break;
			}
		}
		if (entry === null) return null;
		rows.insertBefore(entry.el, cell.trailing?.el ?? null);
		return entry;
	};

	/** The sub-rows no cell took over: an open edit on one is written, as a leave would write it. */
	const sweepParked = (): void => {
		for (const { cell, entry } of [...parkedSubrows.values()]) {
			if (entry.editing) commitRowEdit(cell, entry, false);
		}
		parkedSubrows.clear();
	};

	/**
	 * A card comes down with its draft saved first, as at disposal, so words
	 * typed on it are not lost with its placement: whether the placement
	 * went, the row came down, or the row's cards are dealt again.
	 */
	/**
	 * A placement's card off its lane, its open words settled by the deck that
	 * holds them. The going is the deck's to order, the same one it gives its
	 * cards when a board closes, rather than a second telling of it here.
	 */
	const takeDown = (key: string): void => {
		deck.retire(key);
	};

	/** The cards no sub-row holds after a paint. */
	const sweepCards = (): void => {
		for (const [key, card] of [...deck.cards]) {
			if (!table.contains(card.el)) takeDown(key);
		}
	};

	/** The label's words: the text given, or a stand-in for none. */
	const dressLabel = (entry: SubrowEntry, text: string): void => {
		const words = text.trim();
		const shown = words.length > 0 ? text : t('timeline.subrow.empty');
		if (entry.label.textContent !== shown) entry.label.setText(shown);
		entry.label.toggleClass('is-empty', words.length === 0);
	};

	const dressSubrow = (cell: CellEntry, entry: SubrowEntry, row: TimelineRow, lane: Timeline): void => {
		// An edit in flight keeps its input and its words; the paint dresses around it.
		if (!entry.editing) dressLabel(entry, row.text);
		entry.label.disabled = readOnly;
		entry.input.readOnly = readOnly;
		entry.more.disabled = readOnly;
		entry.handle.setAttribute('draggable', readOnly ? 'false' : 'true');
		entry.handle.disabled = readOnly;
		paintPlacements(cell, entry, row, lane);
	};

	const paintSubrows = (cell: CellEntry, time: TimelineTime, lane: Timeline): void => {
		const rows = cell.rows;
		if (rows === null) return;
		const wanted = time.rows.map((row) => row.id);
		const plan = planCardRepaint([...cell.subrows.keys()], wanted, []);
		for (const rowId of plan.remove) unmountSubrow(cell, rowId);
		for (const row of time.rows) {
			let entry = cell.subrows.get(row.id);
			if (entry === undefined) {
				entry = adoptSubrow(cell, row.id) ?? buildSubrow(cell, row.id);
				cell.subrows.set(row.id, entry);
			}
			dressSubrow(cell, entry, row, lane);
		}
		const present = Array.from(rows.children).map(
			(child) => child.getAttribute('data-row-id') ?? '',
		);
		for (const move of planCardMoves(present, wanted)) {
			const el = cell.subrows.get(move.id)?.el;
			if (el === undefined) continue;
			rows.insertBefore(el, cell.subrows.get(move.before)?.el ?? null);
		}
	};

	// -- The scenes placed on a sub-row --------------------------------------

	const buildMissing = (entry: SubrowEntry, lane: Timeline, sceneId: string, parent: HTMLElement = entry.scenes): HTMLElement => {
		const el = parent.createDiv({
			cls: 'snowflake-method-timeline-scene-missing',
			attr: { 'data-key': cardKey(entry.rowId, sceneId), role: 'listitem' },
		});
		el.createSpan({ text: t('timeline.scene.missing') });
		const remove = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-scene-missing-remove',
			attr: { type: 'button', 'aria-label': t('timeline.scene.remove') },
		});
		setIcon(remove, 'x');
		setTooltip(remove, t('timeline.scene.remove'));
		remove.addEventListener('click', () => {
			void enqueue(async () => {
				await controls.bridge().removeScene(lane.id, sceneId);
			});
		});
		dressMissing(el);
		return el;
	};

	/**
	 * A stand-in is built once and stands through the paints that follow, so its
	 * control is dressed as the rest of a row's are: on a project that cannot be
	 * written the way out is closed, rather than asking for a write the project
	 * will refuse without a word.
	 */
	const dressMissing = (el: HTMLElement): void => {
		const remove = el.querySelector<HTMLButtonElement>('.snowflake-method-timeline-scene-missing-remove');
		if (remove !== null) remove.disabled = readOnly;
	};

	/** The element standing for a key on a sub-row: a card of the deck, or a missing stand-in. */
	const placementEl = (entry: SubrowEntry, key: string): HTMLElement | undefined =>
		deck.cards.get(key)?.el ?? entry.missing.get(sceneOfKey(key));

	const paintPlacements = (cell: CellEntry, entry: SubrowEntry, row: TimelineRow, lane: Timeline): void => {
		if (presentation === 'stack') {
			paintStack(cell, entry, row, lane);
			return;
		}
		if (entry.stack !== null) takeDownStack(entry, row.id);
		const keys = row.scenes.map((sceneId) => cardKey(row.id, sceneId));
		const standing = [...deck.cards.keys()].filter((key) => key.startsWith(keyPrefix(row.id)));
		const wantedCards = row.scenes
			.filter((sceneId) => scenesById.has(sceneId))
			.map((sceneId) => cardKey(row.id, sceneId));
		const plan = planCardRepaint(standing, wantedCards, []);
		for (const key of plan.remove) takeDown(key);
		for (const [sceneId, el] of entry.missing) {
			if (!row.scenes.includes(sceneId) || scenesById.has(sceneId)) {
				el.remove();
				entry.missing.delete(sceneId);
			}
		}
		row.scenes.forEach((sceneId, at) => {
			const key = cardKey(row.id, sceneId);
			const scene = scenesById.get(sceneId);
			if (scene === undefined) {
				const standing = entry.missing.get(sceneId);
				if (standing === undefined) entry.missing.set(sceneId, buildMissing(entry, lane, sceneId));
				else dressMissing(standing);
				return;
			}
			const index = sceneIndex.get(sceneId) ?? 0;
			let card = deck.cards.get(key);
			if (card === undefined) {
				card = deck.mount(entry.scenes, key, scene, index);
				wireCardDrag(card, row.id);
			} else if (!entry.scenes.contains(card.el)) {
				// The row came from another time: its card comes over as it stands, editor and all.
				entry.scenes.insertBefore(card.el, null);
			}
			deck.dress(card, scene, index, { position: at + 1, size: row.scenes.length });
		});
		const present = Array.from(entry.scenes.children).map(
			(child) => child.getAttribute('data-key') ?? '',
		);
		for (const move of planCardMoves(present, keys)) {
			const el = placementEl(entry, move.id);
			if (el === undefined) continue;
			entry.scenes.insertBefore(el, placementEl(entry, move.before) ?? null);
		}
	};

	// -- The scenes of a sub-row as a stack ------------------------------------

	const buildStack = (cell: CellEntry, entry: SubrowEntry): StackEntry => {
		const el = entry.scenes.createDiv({
			cls: 'snowflake-method-timeline-stack',
			attr: { 'data-total': '0' },
		});
		const face = el.createDiv({ cls: 'snowflake-method-timeline-stack-face' });
		const stackControls = el.createDiv({ cls: 'snowflake-method-timeline-stack-controls' });
		// The walk stands centred under the card in front; the way back to the first stands aside.
		const walkGroup = stackControls.createDiv({ cls: 'snowflake-method-timeline-stack-walk' });
		const button = (parent: HTMLElement, cls: string, icon: string, label: string): HTMLButtonElement => {
			const control = parent.createEl('button', {
				cls: `clickable-icon ${cls}`,
				attr: { type: 'button', 'aria-label': label },
			});
			setIcon(control, icon);
			setTooltip(control, label);
			return control;
		};
		const previous = button(walkGroup, 'snowflake-method-timeline-stack-previous', 'chevron-left', t('timeline.stack.previous'));
		const position = walkGroup.createSpan({
			cls: 'snowflake-method-timeline-stack-position',
			attr: { 'aria-live': 'polite' },
		});
		const next = button(walkGroup, 'snowflake-method-timeline-stack-next', 'chevron-right', t('timeline.stack.next'));
		const reset = button(stackControls, 'snowflake-method-timeline-stack-reset', 'rotate-ccw', t('timeline.stack.reset'));
		// Walking the stack is looking, not writing: the place is the session's,
		// and past either end the walk comes round.
		const walk = (step: (at: number, total: number) => number): void => {
			const row = rowOfEntry(cell, entry);
			const lane = laneOfRow(entry.rowId);
			const view = currentView();
			if (row === null || lane === null || view === null) return;
			const key = stackKey(view.id, lane.id, row.id);
			const at = clampStackPosition(memory.stackPositions.get(key), row.scenes.length);
			memory.stackPositions.set(key, clampStackPosition(step(at, row.scenes.length), row.scenes.length));
			paintStack(cell, entry, row, lane);
		};
		previous.addEventListener('click', () => {
			walk((at, total) => (at + total - 1) % total);
		});
		next.addEventListener('click', () => {
			walk((at, total) => (at + 1) % total);
		});
		reset.addEventListener('click', () => {
			walk(() => 0);
		});
		return { el, face, controls: stackControls, previous, next, reset, position };
	};

	/** The stack comes down and the row lies flat again: its one card and any stand-in go with it. */
	const takeDownStack = (entry: SubrowEntry, rowId: string): void => {
		for (const key of cardsWithin(rowId, entry.el)) takeDown(key);
		for (const el of entry.missing.values()) el.remove();
		entry.missing.clear();
		entry.stack?.el.remove();
		entry.stack = null;
	};

	/**
	 * One card of the row in front, at the place the session remembers,
	 * kept within the cards the row has; the rest are the count behind it.
	 * Only the card in front is mounted, so only it can be dragged.
	 */
	const paintStack = (cell: CellEntry, entry: SubrowEntry, row: TimelineRow, lane: Timeline): void => {
		let stack = entry.stack;
		if (stack === null) {
			// The cards dealt flat come down; the stack deals one of them again.
			for (const key of cardsWithin(row.id, entry.el)) takeDown(key);
			for (const el of entry.missing.values()) el.remove();
			entry.missing.clear();
			stack = buildStack(cell, entry);
			entry.stack = stack;
		}
		const view = currentView();
		const total = row.scenes.length;
		const key = view === null ? null : stackKey(view.id, lane.id, row.id);
		const remembered = key === null ? undefined : memory.stackPositions.get(key);
		const at = clampStackPosition(remembered, total);
		if (key !== null && remembered !== at) memory.stackPositions.set(key, at);
		const shownId = row.scenes[at];
		const wantedKey = shownId === undefined ? null : cardKey(row.id, shownId);
		for (const standing of [...deck.cards.keys()]) {
			if (standing.startsWith(keyPrefix(row.id)) && standing !== wantedKey) takeDown(standing);
		}
		for (const [sceneId, el] of entry.missing) {
			if (sceneId !== shownId || scenesById.has(sceneId)) {
				el.remove();
				entry.missing.delete(sceneId);
			}
		}
		if (shownId !== undefined && wantedKey !== null) {
			const scene = scenesById.get(shownId);
			if (scene === undefined) {
				const standing = entry.missing.get(shownId);
				if (standing === undefined) entry.missing.set(shownId, buildMissing(entry, lane, shownId, stack.face));
				else dressMissing(standing);
			} else {
				const index = sceneIndex.get(shownId) ?? 0;
				let card = deck.cards.get(wantedKey);
				if (card === undefined) {
					card = deck.mount(stack.face, wantedKey, scene, index);
					wireCardDrag(card, row.id);
				} else if (!stack.face.contains(card.el)) {
					// The row came from another time: its card in front comes over as it stands.
					stack.face.insertBefore(card.el, null);
				}
				deck.dress(card, scene, index, { position: at + 1, size: total });
			}
		}
		stack.el.dataset.total = String(total);
		// A stack of one has nowhere to walk; its controls fall silent but keep their room, so the rows stand level across the lanes.
		stack.controls.toggleClass('is-alone', total <= 1);
		// The walk comes round at either end; only the way back to the first is closed while standing there.
		stack.reset.disabled = at === 0;
		const shown = t('timeline.stack.position', { position: total === 0 ? 0 : at + 1, total });
		if (stack.position.textContent !== shown) stack.position.setText(shown);
	};

	// -- Dragging the times and the rows ---------------------------------------

	const setMark = (el: HTMLElement, cls: string): void => {
		if (mark?.el === el && mark.cls === cls) return;
		clearMark();
		mark = { el, cls };
		el.addClass(cls);
	};

	const clearMark = (): void => {
		if (mark === null) return;
		mark.el.removeClass(mark.cls);
		mark = null;
	};

	/** The lanes told apart while a row or a scene is dragged: the one dragged over, and the ones locked out. */
	const paintDragPhase = (): void => {
		for (const entry of timeRows.values()) {
			for (const cell of entry.cells.values()) {
				const state = cellDragState(drag, cell.timelineId);
				cell.el.toggleClass('is-drag-lane', state === 'lane');
				cell.el.toggleClass('is-locked-out', state === 'locked');
			}
		}
		for (const entry of laneHeads.values()) {
			const state = cellDragState(drag, entry.id);
			entry.el.toggleClass('is-drag-lane', state === 'lane');
			entry.el.toggleClass('is-locked-out', state === 'locked');
		}
	};

	/** Fires on the source however the drag ends: dropped, dropped nowhere, or cancelled. */
	const endDrag = (): void => {
		clearMark();
		drag = null;
		timeLanding = null;
		rowLanding = null;
		sceneLanding = null;
		invalidateRects();
		root.removeClass('is-time-drag');
		root.removeClass('is-row-drag');
		root.removeClass('is-scene-drag');
		paintDragPhase();
		if (paintOwed) {
			paintOwed = false;
			paintAll();
		}
	};

	/** The time's id before which a time drag would land, null for the foot. */
	const timeLandingAt = (clientY: number): { el: HTMLElement; timeId: string | null } => {
		if (rects.rows === null) {
			rects.rows = rowOrder.map((timeId) => timeRows.get(timeId)?.el.getBoundingClientRect() ?? new DOMRect());
		}
		const candidates = rowOrder
			.map((timeId, index) => ({ timeId, box: rects.rows?.[index] }))
			.filter((entry) => entry.timeId !== (drag?.kind === 'time' ? drag.timeId : ''));
		const at = dropIndexAt(candidates.map((entry) => (entry.box?.top ?? 0) + (entry.box?.height ?? 0) / 2), clientY);
		const landing = candidates[at];
		const el = landing === undefined ? tail : (timeRows.get(landing.timeId)?.el ?? tail);
		return { el, timeId: landing?.timeId ?? null };
	};

	table.addEventListener('dragover', (event) => {
		if (drag?.kind !== 'time' || event.dataTransfer?.types.includes(TIMELINE_TIME_DRAG_TYPE) !== true) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const landing = timeLandingAt(event.clientY);
		timeLanding = { timeId: landing.timeId };
		setMark(landing.el, 'is-drop-before');
	});
	table.addEventListener('drop', (event) => {
		const dragged = event.dataTransfer?.getData(TIMELINE_TIME_DRAG_TYPE) ?? '';
		if (drag?.kind !== 'time' || drag.timeId !== dragged) return;
		event.preventDefault();
		const beforeTimeId = timeLanding === null ? timeLandingAt(event.clientY).timeId : timeLanding.timeId;
		clearMark();
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

	/** A scene begins to move: the active lane is locked for the drag, and every other lane stands back. */
	const beginSceneDrag = (sceneId: string, source: { timelineId: string; rowId: string } | { pool: true }): void => {
		if (readOnly || activeId === null) return;
		drag = { kind: 'scene', sceneId, lockedTimelineId: activeId, source };
		invalidateRects();
		root.addClass('is-scene-drag');
		paintDragPhase();
	};

	/** A lane's card leaves under the workspace's own type, to another row, another time or the pool. */
	const wireCardDrag = (card: SceneCard, rowId: string): void => {
		card.el.addEventListener('dragstart', (event) => {
			const lane = laneOfRow(rowId);
			if (
				readOnly || lane === null || lane.id !== activeId ||
				event.dataTransfer === null || pressWithin(event.target)
			) {
				event.preventDefault();
				return;
			}
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(TIMELINE_SCENE_DRAG_TYPE, card.id);
			card.el.addClass('is-dragging');
			beginSceneDrag(card.id, { timelineId: lane.id, rowId });
		});
		card.el.addEventListener('dragend', () => {
			card.el.removeClass('is-dragging');
			endDrag();
		});
	};

	/** The sub-row under the pointer, from the event's own target: a stored row, the trailing one, or none. */
	const subrowUnder = (
		cell: CellEntry,
		target: EventTarget | null,
	): { kind: 'row'; entry: SubrowEntry } | { kind: 'trailing' } | null => {
		if (target === null || !(target as Node).instanceOf(Element)) return null;
		const el = (target as Element).closest('.snowflake-method-timeline-subrow');
		if (el === null) return null;
		if (el === cell.trailing?.el) return { kind: 'trailing' };
		const rowId = el.getAttribute('data-row-id');
		const entry = rowId === null ? undefined : cell.subrows.get(rowId);
		return entry === undefined ? null : { kind: 'row', entry };
	};

	/** The cards a scene may land among on a row: every placement but the one being moved, measured once per drag. */
	const cardRects = (entry: SubrowEntry, sceneId: string): { sceneId: string; el: HTMLElement; rect: DOMRect }[] => {
		let measured = rects.cards.get(entry.scenes);
		if (measured === undefined) {
			measured = Array.from(entry.scenes.children)
				.map((child) => ({ key: child.getAttribute('data-key') ?? '', el: child as HTMLElement }))
				.filter((child) => child.key.length > 0 && sceneOfKey(child.key) !== sceneId)
				.map((child) => ({ sceneId: sceneOfKey(child.key), el: child.el, rect: child.el.getBoundingClientRect() }));
			rects.cards.set(entry.scenes, measured);
		}
		return measured;
	};

	const sceneDragOver = (cell: CellEntry, event: DragEvent): void => {
		if (drag?.kind !== 'scene' || event.dataTransfer?.types.includes(TIMELINE_SCENE_DRAG_TYPE) !== true) return;
		event.preventDefault();
		if (drag.lockedTimelineId !== cell.timelineId || !cell.present) {
			// As the refusals below do: the mark goes with the refusal, so no
			// line stands on a lane that will not take the scene.
			event.dataTransfer.dropEffect = 'none';
			clearMark();
			sceneLanding = null;
			return;
		}
		const under = subrowUnder(cell, event.target);
		if (under === null) {
			event.dataTransfer.dropEffect = 'none';
			clearMark();
			sceneLanding = null;
			return;
		}
		event.dataTransfer.dropEffect = 'move';
		if (under.kind === 'trailing') {
			const box = cell.trailing?.el.querySelector<HTMLElement>('.snowflake-method-timeline-scenes');
			if (box !== null && box !== undefined) setMark(box, 'is-drop-target');
			sceneLanding = { cell, rowId: null, beforeSceneId: null };
			return;
		}
		// A stack takes the scene at its back, and none from its own front.
		if (presentation === 'stack') {
			if (!rowAcceptsScene(drag, under.entry.rowId, presentation)) {
				event.dataTransfer.dropEffect = 'none';
				clearMark();
				sceneLanding = null;
				return;
			}
			setMark(under.entry.scenes, 'is-drop-target');
			sceneLanding = { cell, rowId: under.entry.rowId, beforeSceneId: null };
			return;
		}
		const candidates = cardRects(under.entry, drag.sceneId);
		const at = placementIndexAt(
			candidates.map((candidate) => candidate.rect),
			{ x: event.clientX, y: event.clientY },
			laneAxis,
		);
		const before = candidates[at];
		const last = candidates[candidates.length - 1];
		if (before !== undefined) setMark(before.el, 'is-drop-before');
		else if (last !== undefined) setMark(last.el, 'is-drop-after');
		else setMark(under.entry.scenes, 'is-drop-target');
		sceneLanding = { cell, rowId: under.entry.rowId, beforeSceneId: before?.sceneId ?? null };
	};

	const sceneDrop = (cell: CellEntry, timeId: string, event: DragEvent): void => {
		const dragged = event.dataTransfer?.getData(TIMELINE_SCENE_DRAG_TYPE) ?? '';
		if (drag?.kind !== 'scene' || drag.sceneId !== dragged || drag.lockedTimelineId !== cell.timelineId) return;
		event.preventDefault();
		const landing = sceneLanding?.cell === cell ? sceneLanding : null;
		clearMark();
		if (landing === null) return;
		const timelineId = drag.lockedTimelineId;
		const sceneId = drag.sceneId;
		void enqueue(async () => {
			const bridge = controls.bridge();
			if (landing.rowId === null) await bridge.addRow(timelineId, timeId, '', null, [sceneId]);
			else await bridge.placeScene(timelineId, sceneId, landing.rowId, landing.beforeSceneId);
		});
	};

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
		if (held === undefined) return;
		renameTimelineForm(
			app,
			t,
			lane.name,
			held.timelines.filter((candidate) => candidate.id !== lane.id).map((candidate) => candidate.name),
			async (name) => {
				await enqueue(async () => {
					await controls.bridge().renameTimeline(lane.id, name);
				});
			},
		).open();
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
		const rows = lane.times.reduce((count, time) => count + time.rows.length, 0);
		if (lane.times.length > 0 || rows > 0) {
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('timeline.timeline.deleteTitle', { name: lane.name }),
				lines: [t('timeline.timeline.deleteDescription', { times: lane.times.length, rows })],
				label: t('actions.delete'),
			});
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
			});
			if (!confirmed || disposed) return;
		}
		await enqueue(async () => {
			await controls.bridge().removeTime(lane.id, entry.timeId);
		});
	};

	// -- The cards' menu -----------------------------------------------------

	const openCardMenu = (card: SceneCard, event: MouseEvent): void => {
		const path = controls.projectPath();
		const lane = laneOfRow(card.key.slice(0, card.key.indexOf('|')));
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.edit'))
				.setIcon('pencil')
				.setDisabled(!deck.editable(card) || path === null)
				.onClick(() => {
					if (path === null) return;
					deck.openForm((onSaved) => host.openSceneForm({ mode: 'edit', id: card.id }, path, onSaved));
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('common.open'))
				.setIcon('file-text')
				.onClick(() => {
					void host.openManagedFile(card.scene.path).catch(notice);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.scene.remove'))
				.setIcon('x')
				.setDisabled(readOnly || lane === null)
				.onClick(() => {
					if (lane === null) return;
					void enqueue(async () => {
						await controls.bridge().removeScene(lane.id, card.id);
					});
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(readOnly || card.scene.readOnly || path === null)
				.onClick(() => {
					if (path === null) return;
					void deck.enqueue(() => host.deleteScene(card.id, card.scene.revision, path), { persist: true });
				});
		});
		menu.showAtMouseEvent(event);
	};

	// -- The views' and timelines' forms -------------------------------------

	/** The Add timeline form; resolves with the id made once the form is gone, or null. */
	const addTimeline = (offerView: boolean): Promise<string | null> =>
		new Promise((resolve) => {
			const held = reading?.held;
			if (held === undefined || readOnly) {
				resolve(null);
				return;
			}
			let made: string | null = null;
			const modal = new AddTimelineModal(
				app,
				t,
				{
					takenNames: held.timelines.map((timeline) => timeline.name),
					roster: () => roster,
					offerView: offerView && currentView() !== null,
				},
				async (draft) => {
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
			);
			const closed = modal.onClose.bind(modal);
			modal.onClose = (): void => {
				closed();
				resolve(made);
			};
			modal.open();
		});

	const openAddView = (): void => {
		const held = reading?.held;
		if (held === undefined || readOnly) return;
		new TimelineViewFormModal(
			app,
			t,
			{
				mode: 'add',
				takenNames: held.views.map((view) => view.name),
				initial: {
					name: '',
					timelines: held.timelines.length === 1 ? [held.timelines[0]!.id] : [],
				},
				timelines: () => reading?.held.timelines ?? [],
				addTimeline: () => addTimeline(false),
			},
			async (draft) => {
				await enqueue(async () => {
					const bridge = controls.bridge();
					const id = await bridge.createView(draft.name, draft.timelines);
					if (id === null) return;
					viewId = id;
					await bridge.setLastView(id);
				});
			},
		).open();
	};

	const openEditView = (): void => {
		const held = reading?.held;
		const view = currentView();
		if (held === undefined || view === null || readOnly) return;
		new TimelineViewFormModal(
			app,
			t,
			{
				mode: 'edit',
				takenNames: held.views.filter((candidate) => candidate.id !== view.id).map((candidate) => candidate.name),
				initial: { name: view.name, timelines: [...view.timelines] },
				// The lanes as the document last said them. A read that found
				// nothing is not a project without lanes: answered so, the form
				// would drop every line it shows and a save would write the view
				// empty, taking lanes away that were never touched.
				timelines: () => reading?.held.timelines ?? held.timelines,
				addTimeline: () => addTimeline(false),
				deleteView: async () => {
					const confirmed = await confirmTimelineAction(app, t, {
						title: t('timeline.view.deleteTitle', { name: view.name }),
						lines: [t('timeline.view.deleteDescription')],
						label: t('actions.delete'),
					});
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
				await enqueue(async () => {
					const bridge = controls.bridge();
					// Against the view as it stands now, so a name already so is not written again.
					const standing = (reading === null ? undefined : findTimelineView(reading.held, view.id)) ?? view;
					if (draft.name !== standing.name) await bridge.renameView(view.id, draft.name);
					await bridge.setViewTimelines(view.id, draft.timelines);
				});
			},
		).open();
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
		columns: 1,
		// One column has no insertion buttons to leave room for between cards.
		gap: 0.75,
		emptyText: t('timeline.pool.empty'),
		// A pool card leaves under the workspace's type and locks the active
		// lane; a lane's card dropped back on the pool gives up its place.
		modeShared: true,
		dragOut: {
			type: TIMELINE_SCENE_DRAG_TYPE,
			onStart: (sceneId) => {
				beginSceneDrag(sceneId, { pool: true });
			},
			onEnd: endDrag,
		},
		dropIn: {
			accepts: (types) =>
				types.includes(TIMELINE_SCENE_DRAG_TYPE) && drag?.kind === 'scene' && !('pool' in drag.source),
			onDrop: () => {
				if (drag?.kind !== 'scene' || 'pool' in drag.source) return;
				const { lockedTimelineId, sceneId } = drag;
				void enqueue(async () => {
					await controls.bridge().removeScene(lockedTimelineId, sceneId);
				});
			},
		},
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
			unsubscribe?.();
			unsubscribe = null;
			stopMigration?.();
			unbindWindow(eventWindow);
			poolHandle?.dispose();
			poolHandle = null;
			// Words still being written go the way a leave sends them, without
			// waiting on a blur the host may not send: an open edit of a row,
			// the words kept from a row's write that failed, tried once more,
			// and whatever stands at a cell's foot, shown or kept.
			for (const timeRow of timeRows.values()) {
				for (const cell of timeRow.cells.values()) {
					for (const entry of cell.subrows.values()) {
						if (entry.editing) commitRowEdit(cell, entry, false);
					}
				}
			}
			for (const [rowId, draft] of [...rowDrafts]) {
				rowDrafts.delete(rowId);
				writeRowWords(draft.timelineId, rowId, draft.words);
			}
			for (const [key, words] of [...footWords]) {
				footWords.delete(key);
				const [timelineId, timeId] = splitKey(key) as [string, string];
				const trimmed = words.trim();
				if (trimmed.length === 0) continue;
				if (readOnly) {
					recoverWords(placeName(timelineId, timeId), trimmed);
					continue;
				}
				let written = false;
				void enqueue(async () => {
					const id = await controls.bridge().addRow(timelineId, timeId, trimmed, null);
					if (id === null) throw new Error(t('timeline.subrow.refused'));
					written = true;
				}).then(() => {
					if (!written) recoverWords(placeName(timelineId, timeId), trimmed);
				});
			}
			deck.dispose();
			sizeObserver?.disconnect();
			viewField?.destroy();
			root.remove();
		},
	};
	return handle;
};
