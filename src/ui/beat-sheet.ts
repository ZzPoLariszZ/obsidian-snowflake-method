/**
 * The beat sheet workspace: a story's scenes laid out under acts and beats,
 * one sheet at a time of the several a project may keep. It stands where a
 * timeline with one lane stands and looks as one does, wearing the
 * timeline's own classes: each beat is a row with its node on the axis, its
 * name and main description beside it, and a cell of sub-descriptions with
 * the scenes placed on them; an act is a header across the table over its
 * beats. The document is the bridge's and the scenes' names the project
 * model's, but an act and a beat are not notes, so their words are edited in
 * the workspace's own forms.
 *
 * What stands in a cell is not told again here: the rows, the foot, the
 * cards, their drags, their menus and every rule of keeping typed words are
 * the lanes' cells' (`lane-cells.ts`), and the read, the queue and the
 * paint's gate are the loop's (`document-loop.ts`), both shared with the
 * timeline. This is the sheet's own drawing: the toolbar, the acts, the beat
 * column, and the moves of acts and beats.
 */

import { Menu, Notice, getIcon, setIcon, setTooltip, type Modal } from 'obsidian';

import {
	BUILT_IN_BEAT_SHEET_TEMPLATE_IDS,
	beatScenePlacements,
	beatSheetActStep,
	beatSheetTemplateNamesake,
	beatStep,
	builtInBeatSheetTemplates,
	derivedBeatSheetPresentation,
	findBeat,
	findBeatSheet,
	findBeatSheetAct,
	findBeatSheetTemplate,
	moveBeatSheetAct,
	shownBeatSheetId,
	type Beat,
	type BeatSheet,
	type BeatSheetDocument,
	type ScenePresentation,
} from '../domain';
import type { BeatSheetWrite } from '../services';
import {
	BEAT_SHEET_ACT_DRAG_TYPE,
	BEAT_SHEET_BEAT_DRAG_TYPE,
	BEAT_SHEET_ROW_DRAG_TYPE,
	BEAT_SHEET_SCENE_DRAG_TYPE,
	type BeatSheetHandle,
	type BeatSheetReading,
	type RenderBeatSheet,
} from './beat-sheet-bridge';
import {
	ActFormModal,
	AddBeatSheetModal,
	BeatFormModal,
	EditBeatSheetModal,
	type AddBeatSheetFormHandle,
} from './beat-sheet-forms';
import {
	actLandingAt,
	actTitle,
	assignedSceneIds,
	beatLandingAt,
	beatMoveIsNoop,
	beatPlaceName,
	beatStackKey,
	sheetAsLane,
	shownActs,
	shownBeats,
	storedAnchor,
	storedDirection,
	tableKey,
	tableOrder,
	type BeatLandingCandidate,
	type BeatSheetDrag,
	type TableEntry,
} from './beat-sheet-layout';
import type { CorkboardControls, CorkboardHandle } from './corkboard-bridge';
import { createDocumentLoop, type DocumentLoop } from './document-loop';
import { createLaneCells, type Lane, type LaneCell, type LaneCells, type SceneScope } from './lane-cells';
import { promptForCustomFieldTemplate } from './modals';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';
import { paintCount, renderEmptyLine } from './pane-parts';
import {
	SCENE_CARD_PART_CLASSES,
	SCENE_CARD_SELECTOR,
	createSceneCardDeck,
	type SceneCard,
	type SceneCardDeck,
	type SceneCardPart,
} from './scene-card';
import { planCardMoves, planCardRepaint } from './sticky-note-layout';
import { TimelineTimePickModal, confirmTimelineAction } from './timeline-forms';
import type { ProjectDashboardModel, SceneViewModel } from './view-model';

/** An act's header across the table: its handle, what it is called, and its two controls. */
interface ActEntry {
	actId: string;
	el: HTMLElement;
	handle: HTMLButtonElement;
	title: HTMLButtonElement;
	add: HTMLButtonElement;
	more: HTMLButtonElement;
}

/** The line under an act's beats: it says the act holds none, and takes a beat dropped at the act's end. */
interface FootEntry {
	actId: string;
	el: HTMLElement;
	line: HTMLElement;
}

/** One beat's row: its own cell in the beat column, and the one lane's cell beside it. */
interface BeatEntry {
	beatId: string;
	el: HTMLElement;
	handle: HTMLButtonElement;
	label: HTMLButtonElement;
	description: HTMLButtonElement;
	more: HTMLButtonElement;
	/** The plus on the rule above the row, which puts a beat in before it. */
	seamAdd: HTMLButtonElement;
	cell: HTMLElement;
	body: LaneCell;
}

/** Where the focus stood before a paint: on a card's part, or on any other control. */
type FocusHold =
	| { kind: 'card'; key: string; part: SceneCardPart }
	| { kind: 'element'; el: Element };

/** The least room, in px, the bar across must have past the beat column to be shown at all. */
const SCROLL_ROOM_MIN = 48;

/** The workspace's two folds: the beat column to its names, and the pool away. */
type Fold = 'beats' | 'pool';
const FOLDS: readonly Fold[] = ['beats', 'pool'];
const FOLD_LABELS: Readonly<Record<Fold, { collapse: string; expand: string }>> = {
	beats: { collapse: 'beatSheet.beat.collapse', expand: 'beatSheet.beat.expand' },
	pool: { collapse: 'timeline.pool.collapse', expand: 'timeline.pool.expand' },
};

/** The width, in rem, under which the workspace is narrow and folds both by itself, as the timeline does. */
const NARROW_MAX_REM = 84;

/** How many documents back a place that has gone is still looked for by name. */
const EARLIER_HELD_MAX = 4;

/**
 * All of a document that the workspace lays out, as one string: its sheets.
 * Which sheet was opened last is read only when the one picked has gone, and
 * then the sheets differ too; the templates are read by the forms as they open.
 */
const drawnSignatures = new WeakMap<BeatSheetDocument, string>();
const drawnSignature = (held: BeatSheetDocument): string => {
	let signature = drawnSignatures.get(held);
	if (signature === undefined) {
		signature = JSON.stringify(held.sheets);
		drawnSignatures.set(held, signature);
	}
	return signature;
};

/** Whether two documents lay the workspace out the same, whatever else in them differs. */
function drawnAlike(painted: unknown, held: unknown): boolean {
	if (typeof painted !== 'object' || painted === null || typeof held !== 'object' || held === null) return false;
	return drawnSignature(painted as BeatSheetDocument) === drawnSignature(held as BeatSheetDocument);
}

export const renderBeatSheet: RenderBeatSheet = (container, controls) => {
	const { app, host, t, memory } = controls;
	// The timeline's own class dresses the workspace, one lane wide: a sheet
	// looks as a view of one timeline does, and no rule of that look is told twice.
	const root = container.createDiv({
		cls: 'snowflake-method-prose-panel snowflake-method-timeline snowflake-method-beat-sheet snowflake-method-scene-cards',
	});
	root.dataset.layout = 'single';

	const notice = (error: unknown): void => {
		new Notice(error instanceof Error ? error.message : t('errors.unknown'));
	};

	// -- The toolbar ---------------------------------------------------------

	const toolbar = root.createDiv({
		cls: 'snowflake-method-timeline-toolbar',
		attr: { role: 'toolbar', 'aria-label': t('beatSheet.toolbar') },
	});
	// The sheet is typed into, searched and picked from, as the timeline's view is.
	const sheetHost = toolbar.createDiv({ cls: 'snowflake-method-timeline-view-select snowflake-method-beat-sheet-select' });
	const chooseSheet = (chosen: string): void => {
		if (chosen.length === 0 || chosen === sheetId) return;
		sheetId = chosen;
		paintAll();
		// The sheet is shown already; this only writes down which one was opened
		// last, which nothing on screen is drawn from. No paint is asked for after
		// it, and the bell its write rings brings back sheets that lay out as the
		// ones shown do, which the loop is told, so none follows it either.
		void enqueue(async () => {
			await controls.bridge().setLastSheet(chosen);
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
	// A sheet's acts and beats kept as one of the project's templates, the way
	// an entity's custom fields are kept as one from its form.
	const exportButton = iconButton('snowflake-method-beat-sheet-export', 'file-output', t('modal.customFieldTemplate.exportTitle'));
	exportButton.addEventListener('click', () => {
		openExport();
	});
	// The pencil wears no class of the timeline's: there the pencil is the first symbol and carries the margin
	// that sends the symbols to the toolbar's end, which here is the export's to carry.
	const editSheetButton = iconButton('snowflake-method-beat-sheet-edit', 'pencil', t('beatSheet.sheet.edit'));
	editSheetButton.addEventListener('click', () => {
		openEditSheet();
	});
	// The three switches are the sheet's own choices, written to the document.
	// Each press takes the value the document holds as its write lands, never
	// the one it held when the press came, and is answered for the sheet it
	// was made on: another opened while the press waits its turn in the queue
	// is not the one it was aimed at.
	const wordsButton = iconButton('snowflake-method-timeline-words', 'eye', t('timeline.view.subDescriptionsHide'));
	wordsButton.setAttribute('aria-pressed', 'true');
	wordsButton.addEventListener('click', () => {
		const aimed = currentSheet();
		if (readOnly || aimed === null) return;
		void enqueue(async () => {
			const now = sheetAsStands(aimed.id);
			if (now === null) return;
			await controls.bridge().setSubDescriptions(now.id, !now.showSubDescriptions);
		});
	});
	const presentationButton = iconButton('snowflake-method-timeline-presentation', 'gallery-horizontal', t('timeline.presentation.toStack'));
	presentationButton.addEventListener('click', () => {
		const aimed = currentSheet();
		if (readOnly || aimed === null) return;
		void enqueue(async () => {
			const now = sheetAsStands(aimed.id);
			if (now === null) return;
			const value: ScenePresentation = derivedBeatSheetPresentation(now) === 'flat' ? 'stack' : 'flat';
			await controls.bridge().setPresentation(now.id, value);
		});
	});
	// The sheet runs down the page from its first act to its last; the order
	// symbol turns it about, the last act first and each act's last beat
	// first, as the timeline's turns its times. Only the showing turns: the
	// story's order is kept, an act keeps its number, and what stands under a
	// beat is shown as it is kept.
	const orderButton = iconButton('snowflake-method-timeline-order', 'arrow-down-narrow-wide', t('beatSheet.order.reverse'));
	orderButton.setAttribute('aria-pressed', 'false');
	orderButton.addEventListener('click', () => {
		const aimed = currentSheet();
		if (readOnly || aimed === null) return;
		void enqueue(async () => {
			const now = sheetAsStands(aimed.id);
			if (now === null) return;
			await controls.bridge().setReversed(now.id, !now.reversed);
		});
	});
	const refreshButton = iconButton('snowflake-method-timeline-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().then(() => reload()).catch(notice);
	});
	const addActButton = toolbar.createEl('button', {
		cls: 'mod-cta snowflake-method-timeline-add-timeline snowflake-method-beat-sheet-add-act',
		text: t('beatSheet.act.add'),
		attr: { type: 'button' },
	});
	addActButton.addEventListener('click', () => {
		// At the foot of the screen, as the timeline adds a time: the story's end, or its beginning on a sheet shown from its end.
		addAct(null);
	});
	const addSheetButton = toolbar.createEl('button', {
		cls: 'mod-cta snowflake-method-timeline-view-add snowflake-method-beat-sheet-add',
		text: t('beatSheet.sheet.add'),
		attr: { type: 'button' },
	});
	addSheetButton.addEventListener('click', () => {
		openAddSheet();
	});
	// The folds stand in the frame's corners on the strip's row, as the
	// timeline's do: the beat column's at the left, the pool's at the right.
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
		beats: foldBox('start', 'snowflake-method-timeline-time-toggle', 'panel-left'),
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
	// No head row stands over the table: the sheet is named in the toolbar's
	// field, and each act's header is a head of its own.
	const table = scroller.createDiv({ cls: 'snowflake-method-timeline-table' });
	const actsEmpty = table.createDiv({ cls: 'snowflake-method-timeline-times-empty' });
	renderEmptyLine(actsEmpty, t('beatSheet.empty.acts'));
	/** Where an act dropped past the last lands, and wears the line. */
	const tail = table.createDiv({ cls: 'snowflake-method-timeline-tail' });

	// The scroller's own bars are hidden; these two stand in for them, as the
	// timeline's do, the one across starting past the beat column.
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
		// The tab keeps where the sheet stands, so a turn to another workspace
		// and back finds it where it was left.
		memory.scroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
	});
	bars.across.addEventListener('scroll', () => {
		if (scroller.scrollLeft !== bars.across.scrollLeft) scroller.scrollLeft = bars.across.scrollLeft;
	});
	bars.down.addEventListener('scroll', () => {
		if (scroller.scrollTop !== bars.down.scrollTop) scroller.scrollTop = bars.down.scrollTop;
	});
	// A wheel over a bar moves the whole scroller, both ways, as over the sheet.
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
	/** The scenes the sheet on show has placed, which the pool leaves out. */
	let assigned = new Set<string>();

	/** Whether the workspace is too narrow for both parts to stand, measured from its own width. */
	let narrow = false;
	/** The parts brought back by hand while narrow, which stand until the workspace is wide again. */
	const openedNarrow = new Set<Fold>();

	/** Whether a part stands folded now: as the tab remembers it, or by the width alone. */
	const folded = (part: Fold): boolean =>
		(part === 'beats' ? memory.beatsCollapsed : memory.poolCollapsed) || (narrow && !openedNarrow.has(part));

	const paintFolds = (): void => {
		for (const part of FOLDS) {
			const collapsed = folded(part);
			const toggle = foldToggles[part];
			const label = t(collapsed ? FOLD_LABELS[part].expand : FOLD_LABELS[part].collapse);
			if (toggle.getAttribute('aria-label') !== label) {
				toggle.setAttribute('aria-label', label);
				setTooltip(toggle, label);
			}
			toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		}
		// The beat column folds as the timeline's time column does, by the same class.
		root.toggleClass('is-time-collapsed', folded('beats'));
		root.toggleClass('is-pool-collapsed', folded('pool'));
		pool.toggleClass('is-hidden', folded('pool'));
	};

	/** Folds a part or brings it back, remembers which, and measures again for the room that moved. */
	const fold = (part: Fold, collapsed: boolean): void => {
		if (folded(part) === collapsed) return;
		if (part === 'beats') memory.beatsCollapsed = collapsed;
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

	let reading: BeatSheetReading | null = null;
	/** The document as the last read that came back had it, for a form standing open when a read fails. */
	let lastHeld: BeatSheetDocument | null = null;
	/**
	 * The documents read before that one, newest first and a few deep. A beat
	 * is named nowhere but in the document, and words are handed back for
	 * keeping only once their beat has gone from it: the document that last
	 * held the beat is the one that can still say what it was called.
	 */
	const earlierHeld: BeatSheetDocument[] = [];
	let loadFailed = false;
	let model: ProjectDashboardModel | null = null;
	let sheetId: string | null = null;
	/**
	 * A sheet this workspace has just made, until a read brings back the
	 * document that holds it. A paint that comes in between is made from the
	 * document as it was, and must not take the new sheet's absence there for a
	 * pick that has gone, or the sheet made would never be the one shown.
	 */
	let awaitedSheetId: string | null = null;
	/** The sheet as one lane, as last painted: what the cells answer from, whatever has been read since. */
	let paintedLanes: readonly Lane[] = [];
	/** The sheet the table was last painted from, by id: another sheet's rows are never dressed as this one's. */
	let paintedSheetId: string | null = null;
	let presentation: ScenePresentation = 'flat';
	/** Whether the scroll the tab remembers has been given back, which is done once. */
	let scrollGivenBack = false;
	let presentationIcon = 'gallery-horizontal';
	let wordsIcon = 'eye';
	let orderIcon = 'arrow-down-narrow-wide';
	let readOnly = true;
	let optionsSignature = '';
	let sheetField: OptionPicker | null = null;
	let scenesById = new Map<string, SceneViewModel>();
	/** Each scene's place in the narrative order, which its card's circle shows. */
	let sceneIndex = new Map<string, number>();
	let charactersByPath = new Map<string, ProjectDashboardModel['characters'][number]>();
	let manuscriptPositions = new Map<string, number>();
	let resolvedManuscriptPaths = new Map<string, Map<string, string | null>>();
	const actEntries = new Map<string, ActEntry>();
	const footEntries = new Map<string, FootEntry>();
	const beatEntries = new Map<string, BeatEntry>();
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
	/** The act or the beat being dragged, while one is; a row's drag and a scene's are the cells' own. */
	let tableDrag: BeatSheetDrag | null = null;
	/** What the last dragover worked out, which the drop then uses. */
	let beatLanding: { actId: string; beforeBeatId: string | null } | null = null;
	let actLanding: { beforeActId: string | null } | null = null;
	/** The table's entries, measured once per drag, dropped on scroll, resize, paint and drag end. */
	let tableRects: Map<string, DOMRect> | null = null;
	const invalidateRects = (): void => {
		tableRects = null;
		cells.invalidateRects();
	};

	/** The sheet seen as a lane, made once per sheet as the document hands it over: the cells ask for it at every turn. */
	let laneMemo: { sheet: BeatSheet; lane: Lane } | null = null;
	const laneOf = (sheet: BeatSheet): Lane => {
		if (laneMemo?.sheet !== sheet) laneMemo = { sheet, lane: sheetAsLane(sheet) };
		return laneMemo.lane;
	};
	let documentLanesMemo: { held: BeatSheetDocument; lanes: Lane[] } | null = null;

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

	const loop: DocumentLoop = createDocumentLoop<BeatSheetReading, ProjectDashboardModel>({
		source: () => controls.bridge(),
		taken: (next, failed) => {
			reading = next;
			if (next !== null) {
				if (lastHeld !== null && lastHeld !== next.held) {
					earlierHeld.unshift(lastHeld);
					earlierHeld.length = Math.min(earlierHeld.length, EARLIER_HELD_MAX);
				}
				lastHeld = next.held;
				if (awaitedSheetId !== null && findBeatSheet(next.held, awaitedSheetId) !== undefined) {
					sheetId = awaitedSheetId;
					awaitedSheetId = null;
				}
			}
			loadFailed = failed;
		},
		readFailed: (error) => {
			console.error('Snowflake: the beat sheets could not be read', error);
		},
		held: () => reading?.held ?? null,
		alike: (painted, held) => drawnAlike(painted, held),
		model: () => controls.model(),
		refreshModel: () => controls.refresh(),
		draw: (nextModel) => {
			draw(nextModel);
		},
		dragging: () => tableDrag !== null || cells.dragging(),
		disposed: () => disposed,
		notice,
	});
	const { reload, enqueue } = loop;

	/** A sheet by id, as the document has it now: the one a press named, when its change comes to be made. */
	const sheetAsStands = (id: string): BeatSheet | null =>
		reading === null ? null : (findBeatSheet(reading.held, id) ?? null);

	const currentSheet = (): BeatSheet | null => (sheetId === null ? null : sheetAsStands(sheetId));

	/**
	 * Whether what a menu or a form opened on still stands when its change
	 * comes to be made: the same project, the same sheet on show, and a
	 * project that can still be written.
	 */
	const stillOn = (path: string, openedSheet: string): boolean => {
		const current = controls.model();
		return !disposed && !readOnly && current !== null && !current.readOnly
			&& current.path === path && controls.projectPath() === path && sheetId === openedSheet;
	};

	// -- Painting ------------------------------------------------------------

	const frameWindow = root.ownerDocument.defaultView;

	/** Where the beat column ends, from its own box; nothing here holds its place, so nothing is summed. */
	const beatColumnWidth = (): number => {
		const first = beatEntries.values().next().value;
		const width = first?.el.querySelector<HTMLElement>('.snowflake-method-timeline-time')?.offsetWidth ?? 0;
		return Number.isFinite(width) ? width : 0;
	};

	const fitScrollbars = (): void => {
		const start = beatColumnWidth();
		const across = scroller.scrollWidth - scroller.clientWidth;
		const down = scroller.scrollHeight - scroller.clientHeight;
		const wide = Number.isFinite(across) && across > 0 && scroller.clientWidth - start >= SCROLL_ROOM_MIN;
		const tall = Number.isFinite(down) && down > 0;
		bars.across.toggleClass('is-hidden', !wide);
		bars.down.toggleClass('is-hidden', !tall);
		bars.across.toggleClass('is-short', wide && tall);
		bars.down.toggleClass('is-short', wide && tall);
		if (wide) {
			bars.across.setCssStyles({ insetInlineStart: `${start}px` });
			barSpace.across.setCssStyles({ width: `${across + bars.across.clientWidth}px` });
			bars.across.scrollLeft = scroller.scrollLeft;
		}
		if (tall) {
			bars.down.setCssStyles({ insetBlockStart: '0px' });
			barSpace.down.setCssStyles({ height: `${down + bars.down.clientHeight}px` });
			bars.down.scrollTop = scroller.scrollTop;
		}
	};

	/** Narrow, the workspace folds both parts by its width alone, and brings them back as it widens. */
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

	/** The sheet's cards wear the style the pool's display control chose; the CSS reads it off the root. */
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

	/** The sheet field, remade only when the sheets moved; otherwise told the sheet held now. */
	const paintOptions = (sheets: readonly BeatSheet[]): void => {
		const signature = sheets.map((sheet) => `${sheet.id} ${sheet.name}`).join('|');
		if (sheetField === null || signature !== optionsSignature) {
			optionsSignature = signature;
			sheetField?.destroy();
			sheetHost.empty();
			sheetField = buildOptionField(app, sheetHost, {
				options: () => sheets.map((sheet) => ({ value: sheet.id, label: sheet.name })),
				label: t('beatSheet.sheet'),
				placeholder: t('beatSheet.sheet.placeholder'),
				emptyPlaceholder: t('beatSheet.sheet.placeholder'),
				value: () => sheetId ?? '',
				choose: chooseSheet,
			});
			return;
		}
		sheetField.refresh();
	};

	const paintAll = (): void => {
		loop.paint();
	};

	/** The laying out itself, from the model handed to it and the document last read. */
	const draw = (nextModel: ProjectDashboardModel | null): void => {
		invalidateRects();
		paintFolds();
		if (nextModel !== model) {
			// The model's own, made again only when it is another model.
			manuscriptPositions = new Map(nextModel?.manuscriptPaths.map((path, index) => [path, index]));
			scenesById = new Map(nextModel?.scenes.map((scene) => [scene.id, scene]) ?? []);
			sceneIndex = new Map(nextModel?.scenes.map((scene, index) => [scene.id, index]) ?? []);
			charactersByPath = new Map(nextModel?.characters.map((character) => [character.path, character]) ?? []);
		}
		model = nextModel;
		// The model's word alone, renewed with every project refresh.
		readOnly = model?.readOnly ?? true;
		root.toggleClass('is-read-only', readOnly);
		resolvedManuscriptPaths = new Map();
		deck.beginPaint();
		addSheetButton.disabled = readOnly || reading === null;
		if (reading === null) {
			editSheetButton.disabled = true;
			exportButton.disabled = true;
			addActButton.disabled = true;
			paintPresentation(null);
			paintWords(null);
			paintOrder(null);
			paintOptions([]);
			showEmpty(t(loadFailed ? 'beatSheet.loadFailed' : 'beatSheet.loading'));
			return;
		}
		const held = reading.held;
		cells.recoverHomelessFeet();
		sheetId = shownBeatSheetId(held, sheetId);
		paintOptions(held.sheets);
		const sheet = currentSheet();
		editSheetButton.disabled = readOnly || sheet === null;
		exportButton.disabled = readOnly || sheet === null;
		addActButton.disabled = readOnly || sheet === null;
		paintPresentation(sheet);
		paintWords(sheet);
		paintOrder(sheet);
		if (sheet === null) {
			paintedLanes = [];
			clearTable();
			showEmpty(t('beatSheet.empty.sheets'));
			return;
		}
		paintedLanes = [laneOf(sheet)];
		showEmpty(null);
		paintCardMode();
		const hold = holdFocus();
		paintTable(sheet);
		paintPool(sheet);
		// The scroll the tab remembers, given back once the sheet is long enough
		// to take it. Only once: a later paint must not pull the author away.
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

	/** The symbol shows how the sheet deals its scenes; a press deals them the other way. */
	const paintPresentation = (sheet: BeatSheet | null): void => {
		presentation = sheet === null ? 'flat' : derivedBeatSheetPresentation(sheet);
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
		presentationButton.disabled = readOnly || sheet === null;
	};

	/** The symbol shows whether the beats show their rows' words; a press shows or hides them. */
	const paintWords = (sheet: BeatSheet | null): void => {
		const shown = sheet === null || sheet.showSubDescriptions;
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
		wordsButton.disabled = readOnly || sheet === null;
	};

	/** The symbol shows which way the sheet runs; a press turns it about. */
	const paintOrder = (sheet: BeatSheet | null): void => {
		const reversed = sheet !== null && sheet.reversed;
		const icon = reversed ? 'arrow-up-narrow-wide' : 'arrow-down-narrow-wide';
		if (icon !== orderIcon) {
			orderIcon = icon;
			setIcon(orderButton, icon);
		}
		const label = t(reversed ? 'beatSheet.order.restore' : 'beatSheet.order.reverse');
		if (orderButton.getAttribute('aria-label') !== label) {
			orderButton.setAttribute('aria-label', label);
			setTooltip(orderButton, label);
		}
		orderButton.setAttribute('aria-pressed', reversed ? 'true' : 'false');
		orderButton.disabled = readOnly || sheet === null;
	};

	/** The pool follows the sheet on show: what it has placed leaves the pool, and the count says what is left. */
	const paintPool = (sheet: BeatSheet): void => {
		assigned = assignedSceneIds(sheet);
		paintCount(poolCount, model === null ? 0 : model.scenes.filter((scene) => !assigned.has(scene.id)).length);
		poolHandle?.refresh();
	};

	// -- The acts ------------------------------------------------------------

	const buildAct = (key: string, actId: string): ActEntry => {
		const el = table.createDiv({
			cls: 'snowflake-method-beat-sheet-act',
			attr: { 'data-entry-key': key, 'data-act-id': actId },
		});
		table.insertBefore(el, actsEmpty);
		const handle = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-beat-sheet-act-handle',
			attr: { type: 'button', 'aria-label': t('beatSheet.act.drag'), draggable: 'true' },
		});
		setIcon(handle, 'grip-vertical');
		setTooltip(handle, t('beatSheet.act.drag'));
		// An act is headed as a group of scenes is on the corkboard: what it is
		// called, then a rule to the table's end. The words are a button, since
		// they are the way to the act's form.
		const label = el.createSpan({
			cls: 'snowflake-method-corkboard-group-label',
			attr: { role: 'heading', 'aria-level': '3' },
		});
		const title = label.createEl('button', {
			cls: 'snowflake-method-timeline-lane-name snowflake-method-beat-sheet-act-title',
			attr: { type: 'button' },
		});
		el.createSpan({ cls: 'snowflake-method-corkboard-group-rule' });
		const add = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-beat-sheet-act-add',
			attr: { type: 'button' },
		});
		setIcon(add, 'plus');
		const more = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-beat-sheet-act-more',
			attr: { type: 'button', 'aria-label': t('table.actions'), 'aria-haspopup': 'menu' },
		});
		setIcon(more, 'ellipsis');
		setTooltip(more, t('table.actions'));
		const entry: ActEntry = { actId, el, handle, title, add, more };
		handle.addEventListener('dragstart', (event) => {
			if (readOnly || event.dataTransfer === null) {
				event.preventDefault();
				return;
			}
			tableDrag = { kind: 'act', actId: entry.actId };
			invalidateRects();
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(BEAT_SHEET_ACT_DRAG_TYPE, entry.actId);
			if (typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(entry.el, 8, 8);
			root.addClass('is-act-drag');
			entry.el.addClass('is-dragging');
		});
		handle.addEventListener('dragend', () => {
			entry.el.removeClass('is-dragging');
			endDrag();
		});
		title.addEventListener('click', () => {
			editAct(entry.actId);
		});
		add.addEventListener('click', (event) => {
			event.stopPropagation();
			addBeatAtFoot(entry.actId);
		});
		more.addEventListener('click', (event) => {
			event.stopPropagation();
			openActMenu(entry.actId, event);
		});
		el.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			openActMenu(entry.actId, event);
		});
		return entry;
	};

	const dressAct = (entry: ActEntry, item: Extract<TableEntry, { kind: 'act' }>): void => {
		const words = actTitle(t, item.number, item.act.label);
		// Words wider than the table are trimmed to it, so the whole of them wait
		// under the pointer, as a group's do on the corkboard. They are what the
		// button is called, and a tooltip of any other words would take their place.
		if (entry.title.textContent !== words) {
			entry.title.setText(words);
			setTooltip(entry.title, words);
		}
		entry.title.disabled = readOnly;
		entry.el.toggleClass('is-empty', item.act.beats.length === 0);
		const label = t('beatSheet.act.addBeat', { act: words });
		if (entry.add.getAttribute('aria-label') !== label) {
			entry.add.setAttribute('aria-label', label);
			setTooltip(entry.add, label);
		}
		entry.add.disabled = readOnly;
		entry.handle.setAttribute('draggable', readOnly ? 'false' : 'true');
		entry.handle.disabled = readOnly;
	};

	const buildFoot = (key: string, actId: string): FootEntry => {
		const el = table.createDiv({
			cls: 'snowflake-method-beat-sheet-act-foot',
			attr: { 'data-entry-key': key, 'data-act-id': actId },
		});
		table.insertBefore(el, actsEmpty);
		const { line } = renderEmptyLine(el, t('beatSheet.empty.beats'));
		return { actId, el, line };
	};

	// -- The beats -----------------------------------------------------------

	const buildBeat = (key: string, sheet: BeatSheet, beatId: string): BeatEntry => {
		const el = table.createDiv({
			cls: 'snowflake-method-timeline-row snowflake-method-beat-sheet-beat',
			attr: { 'data-entry-key': key, 'data-beat-id': beatId },
		});
		table.insertBefore(el, actsEmpty);
		const time = el.createDiv({ cls: 'snowflake-method-timeline-time' });
		const handle = time.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-time-handle',
			attr: { type: 'button', 'aria-label': t('beatSheet.beat.drag'), draggable: 'true' },
		});
		setIcon(handle, 'grip-vertical');
		setTooltip(handle, t('beatSheet.beat.drag'));
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
		// The rule between this beat and the one above carries a plus; the stylesheet shows it from an act's second beat on.
		const seam = time.createDiv({ cls: 'snowflake-method-timeline-seam' });
		const seamAdd = seam.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-seam-add',
			attr: { type: 'button' },
		});
		setIcon(seamAdd, 'plus');
		// The one lane's cell: the axis with the beat's node on it, its piece of
		// the rule above, and what the lanes' cells keep in it. A sheet is one
		// lane, so every cell is the active lane's and none is ever absent.
		const cell = el.createDiv({
			cls: 'snowflake-method-timeline-cell is-present is-active-lane',
			attr: { 'data-beat-id': beatId },
		});
		cell.createDiv({ cls: 'snowflake-method-timeline-axis', attr: { 'aria-hidden': 'true' } });
		cell.createDiv({ cls: 'snowflake-method-timeline-seam' });
		const entry: BeatEntry = {
			beatId, el, handle, label, description, more, seamAdd, cell,
			body: cells.mountCell(cell, sheet.id, beatId),
		};
		seamAdd.addEventListener('click', (event) => {
			event.stopPropagation();
			const current = currentSheet();
			const place = current === null ? null : findBeat(current, entry.beatId);
			// The plus stands on the rule above the row, so the new beat goes before this one as the screen has them.
			if (place !== null) addBeat(place.act.id, entry.beatId);
		});
		handle.addEventListener('dragstart', (event) => {
			if (readOnly || event.dataTransfer === null) {
				event.preventDefault();
				return;
			}
			tableDrag = { kind: 'beat', beatId: entry.beatId };
			invalidateRects();
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(BEAT_SHEET_BEAT_DRAG_TYPE, entry.beatId);
			if (typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(entry.el, 8, 8);
			// The timeline's class for a time's drag dresses a beat's the same way.
			root.addClass('is-time-drag');
			entry.el.addClass('is-dragging');
		});
		handle.addEventListener('dragend', () => {
			entry.el.removeClass('is-dragging');
			endDrag();
		});
		label.addEventListener('click', () => {
			editBeat(entry.beatId);
		});
		description.addEventListener('click', () => {
			editBeat(entry.beatId, 'description');
		});
		more.addEventListener('click', (event) => {
			event.stopPropagation();
			openBeatMenu(entry.beatId, event);
		});
		time.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			openBeatMenu(entry.beatId, event);
		});
		return entry;
	};

	/** What a beat is called wherever it is named: its name, or the word for one that has none. */
	const beatName = (beat: Beat): string => (beat.name.trim().length > 0 ? beat.name : t('beatSheet.beat.unnamed'));

	const dressBeat = (entry: BeatEntry, item: Extract<TableEntry, { kind: 'beat' }>, sheet: BeatSheet): void => {
		const name = beatName(item.beat);
		// The name is the button's own words and is left to say itself, as a
		// time's is: a tooltip would take its place as what the button is called.
		if (entry.label.textContent !== name) entry.label.setText(name);
		entry.label.disabled = readOnly;
		const insert = t('beatSheet.beat.insert', { name });
		if (entry.seamAdd.getAttribute('aria-label') !== insert) {
			entry.seamAdd.setAttribute('aria-label', insert);
			setTooltip(entry.seamAdd, insert);
		}
		entry.seamAdd.disabled = readOnly;
		entry.handle.setAttribute('draggable', readOnly ? 'false' : 'true');
		entry.handle.disabled = readOnly;
		const description = item.beat.description.trim();
		const shown = description.length > 0 ? description : t('timeline.time.noDescription');
		if (entry.description.textContent !== shown) entry.description.setText(shown);
		entry.description.toggleClass('is-empty', description.length === 0);
		entry.description.disabled = readOnly;
		setTooltip(entry.description, t('timeline.time.editDescription'));
		// Each act's axis starts at its first beat's node and runs on down to
		// the foot of its last beat's cell, as a timeline's does. Which beat is
		// the first only the painter can say: nothing in the stylesheet may ask
		// what an element holds or what stands beside it.
		entry.el.toggleClass('is-act-first', item.first);
		const lane = laneOf(sheet);
		cells.dressCell(entry.body, lane.times.find((time) => time.timeId === entry.beatId) ?? null, lane);
	};

	const unmountEntry = (key: string): void => {
		const act = actEntries.get(key);
		if (act !== undefined) {
			act.el.remove();
			actEntries.delete(key);
			return;
		}
		const foot = footEntries.get(key);
		if (foot !== undefined) {
			foot.el.remove();
			footEntries.delete(key);
			return;
		}
		const beat = beatEntries.get(key);
		if (beat === undefined) return;
		cells.unmountCell(beat.body);
		beat.el.remove();
		beatEntries.delete(key);
	};

	const entryEl = (key: string): HTMLElement | undefined =>
		actEntries.get(key)?.el ?? beatEntries.get(key)?.el ?? footEntries.get(key)?.el;

	const clearTable = (): void => {
		for (const key of [...actEntries.keys(), ...beatEntries.keys(), ...footEntries.keys()]) unmountEntry(key);
		actsEmpty.toggleClass('is-hidden', true);
		paintedSheetId = null;
		cells.sweep();
	};

	/**
	 * Brings the table level with the sheet: an act's header, its beats and
	 * its foot, act after act, each kept where it stands under its own key, so
	 * a beat moved to another act keeps its row, an open editor and its cards.
	 */
	const paintTable = (sheet: BeatSheet): void => {
		// Another sheet's rows are never dressed as this one's: they come down
		// whole, an open edit on one written as a leave would write it.
		if (paintedSheetId !== null && paintedSheetId !== sheet.id) clearTable();
		paintedSheetId = sheet.id;
		const entries = tableOrder(sheet);
		actsEmpty.toggleClass('is-hidden', sheet.acts.length > 0);
		const wanted = entries.map((entry) => entry.key);
		const standingKeys = [...actEntries.keys(), ...beatEntries.keys(), ...footEntries.keys()];
		for (const key of planCardRepaint(standingKeys, wanted, []).remove) unmountEntry(key);
		for (const item of entries) {
			if (item.kind === 'act') {
				let entry = actEntries.get(item.key);
				if (entry === undefined) {
					entry = buildAct(item.key, item.act.id);
					actEntries.set(item.key, entry);
				}
				dressAct(entry, item);
			} else if (item.kind === 'beat') {
				let entry = beatEntries.get(item.key);
				if (entry === undefined) {
					entry = buildBeat(item.key, sheet, item.beat.id);
					beatEntries.set(item.key, entry);
				}
				dressBeat(entry, item, sheet);
			} else {
				let entry = footEntries.get(item.key);
				if (entry === undefined) {
					entry = buildFoot(item.key, item.act.id);
					footEntries.set(item.key, entry);
				}
				entry.line.toggleClass('is-hidden', item.act.beats.length > 0);
				entry.el.toggleClass('is-empty', item.act.beats.length === 0);
			}
		}
		const present = Array.from(table.children).map((child) => child.getAttribute('data-entry-key') ?? '');
		for (const move of planCardMoves(present, wanted)) {
			const el = entryEl(move.id);
			if (el === undefined) continue;
			table.insertBefore(el, entryEl(move.before) ?? actsEmpty);
		}
		cells.sweep();
	};

	// -- What the lanes' cells ask of the workspace ----------------------------

	/** Where words were meant to stand, as a writer would name it: the sheet, the act and the beat. */
	const placeName = (placedSheetId: string, beatId: string | null): string => {
		const documents = [...(reading === null ? [] : [reading.held]), ...earlierHeld];
		const sheetNow = documents.map((held) => findBeatSheet(held, placedSheetId)).find((found) => found !== undefined);
		if (sheetNow === undefined) return placedSheetId;
		if (beatId === null) return sheetNow.name;
		for (const held of documents) {
			const sheet = findBeatSheet(held, placedSheetId);
			const place = sheet === undefined ? null : beatPlaceName(t, sheet, beatId);
			if (place !== null) return `${sheetNow.name} · ${place}`;
		}
		return sheetNow.name;
	};

	/** The sheet's other beats, in the order it shows them, for a row sent to one of them. */
	const otherBeats = (sheet: BeatSheet, fromBeatId: string): PickerOption[] =>
		shownActs(sheet).flatMap((act) => shownBeats(sheet, act))
			.filter((beat) => beat.id !== fromBeatId)
			.map((beat) => ({ value: beat.id, label: beatPlaceName(t, sheet, beat.id) ?? beat.name }));

	/**
	 * A place among an act's beats named as the screen has it, "before this
	 * beat, or at the act's foot", said as the document keeps it. `moving` is
	 * the beat being moved, which is no anchor for itself.
	 */
	const beatAnchor = (sheet: BeatSheet, actId: string, beforeOnScreen: string | null, moving: string | null = null): string | null => {
		const act = findBeatSheetAct(sheet, actId);
		if (act === undefined) return null;
		const shown = shownBeats(sheet, act).map((beat) => beat.id).filter((id) => id !== moving);
		return storedAnchor(shown, beforeOnScreen, sheet.reversed);
	};

	/** The same for a place among the acts. */
	const actAnchor = (sheet: BeatSheet, beforeOnScreen: string | null, moving: string | null = null): string | null =>
		storedAnchor(shownActs(sheet).map((act) => act.id).filter((id) => id !== moving), beforeOnScreen, sheet.reversed);

	const moveRowToBeat = (fromBeatId: string, rowId: string): void => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		const sheet = currentSheet();
		if (path === null || openedSheet === null || sheet === null || readOnly || disposed) return;
		const elsewhere = otherBeats(sheet, fromBeatId);
		if (elsewhere.length === 0) return;
		keep(new TimelineTimePickModal(app, t('beatSheet.subrow.moveToBeatPlaceholder'), elsewhere, (picked) => {
			if (!stillOn(path, openedSheet) || !elsewhere.some((option) => option.value === picked.value)) return;
			void enqueue(async () => {
				if (!stillOn(path, openedSheet)) return;
				// The file as it stands when the move comes to be made: the row and
				// the beat it goes to must both still be the sheet's.
				const bridge = controls.bridge();
				const latest = await bridge.read();
				if (!stillOn(path, openedSheet) || latest?.projectPath !== path) return;
				const now = findBeatSheet(latest.held, openedSheet);
				if (now === undefined || findBeat(now, picked.value) === null) return;
				if (findBeat(now, fromBeatId)?.beat.rows.some((row) => row.id === rowId) !== true) return;
				await bridge.moveRow(openedSheet, rowId, picked.value, null);
			});
		})).open();
	};

	/** What a card's menu opened on, handed to the cells: they place and move by it, and it answers for the sheet. */
	const sceneScope = (sceneId: string, rowId: string | null): SceneScope<BeatSheetReading> | null => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		if (path === null || openedSheet === null) return null;
		const lane = (read: BeatSheetReading | null | undefined = reading): Lane | null => {
			const current = controls.model();
			if (
				!stillOn(path, openedSheet) || read?.projectPath !== path ||
				current?.scenes.some((scene) => scene.id === sceneId) !== true
			) return null;
			const sheet = findBeatSheet(read.held, openedSheet);
			if (sheet === undefined) return null;
			const source = beatScenePlacements(sheet).get(sceneId)?.rowId ?? null;
			return source === rowId ? sheetAsLane(sheet) : null;
		};
		return lane() === null ? null : { laneId: openedSheet, sceneId, rowId, lane };
	};

	// -- Dragging the acts and the beats ---------------------------------------

	/** Fires on the source however the drag ends: dropped, dropped nowhere, or cancelled. */
	const endDrag = (): void => {
		cells.dragEnded();
		tableDrag = null;
		beatLanding = null;
		actLanding = null;
		tableRects = null;
		root.removeClass('is-time-drag');
		root.removeClass('is-act-drag');
		cells.paintDragPhase();
		loop.paintOwed();
	};

	/** Every entry's box, measured once per drag. */
	const measured = (): Map<string, DOMRect> => {
		if (tableRects === null) {
			tableRects = new Map();
			for (const key of [...actEntries.keys(), ...beatEntries.keys(), ...footEntries.keys()]) {
				const el = entryEl(key);
				if (el !== undefined) tableRects.set(key, el.getBoundingClientRect());
			}
		}
		return tableRects;
	};

	const middleOf = (key: string): number => {
		const box = measured().get(key);
		return box === undefined ? 0 : box.top + box.height / 2;
	};

	/** Where a dragged beat would land: before another beat, or on an act's foot for the act's end. */
	const beatLandingUnder = (sheet: BeatSheet, draggedBeatId: string, clientY: number): { el: HTMLElement; actId: string; beforeBeatId: string | null } | null => {
		const candidates: BeatLandingCandidate[] = [];
		for (const item of tableOrder(sheet)) {
			if (item.kind === 'act') continue;
			if (item.kind === 'beat') {
				if (item.beat.id === draggedBeatId) continue;
				candidates.push({ kind: 'beat', key: item.key, actId: item.act.id, beatId: item.beat.id, middle: middleOf(item.key) });
			} else {
				candidates.push({ kind: 'foot', key: item.key, actId: item.act.id, beatId: null, middle: middleOf(item.key) });
			}
		}
		const landing = beatLandingAt(candidates, clientY);
		const el = landing === null ? undefined : entryEl(landing.key);
		return landing === null || el === undefined ? null : { el, actId: landing.actId, beforeBeatId: landing.beforeBeatId };
	};

	/** Where a dragged act would land: before another act, judged by each act's whole group, or past the last. */
	const actLandingUnder = (sheet: BeatSheet, draggedActId: string, clientY: number): { el: HTMLElement; beforeActId: string | null } => {
		const boxes = measured();
		const candidates = shownActs(sheet)
			.filter((act) => act.id !== draggedActId)
			.map((act) => ({
				actId: act.id,
				top: boxes.get(tableKey('act', act.id))?.top ?? 0,
				bottom: boxes.get(tableKey('foot', act.id))?.bottom ?? 0,
			}));
		const landing = actLandingAt(candidates, clientY);
		const el = landing.beforeActId === null ? undefined : actEntries.get(tableKey('act', landing.beforeActId))?.el;
		return { el: el ?? tail, beforeActId: landing.beforeActId };
	};

	table.addEventListener('dragover', (event) => {
		const sheet = currentSheet();
		if (tableDrag === null || sheet === null || event.dataTransfer === null) return;
		if (tableDrag.kind === 'beat') {
			if (!event.dataTransfer.types.includes(BEAT_SHEET_BEAT_DRAG_TYPE)) return;
			event.preventDefault();
			const landing = beatLandingUnder(sheet, tableDrag.beatId, event.clientY);
			if (landing === null) {
				event.dataTransfer.dropEffect = 'none';
				cells.clearMark();
				beatLanding = null;
				return;
			}
			event.dataTransfer.dropEffect = 'move';
			beatLanding = { actId: landing.actId, beforeBeatId: landing.beforeBeatId };
			cells.setMark(landing.el, 'is-drop-before');
			return;
		}
		if (!event.dataTransfer.types.includes(BEAT_SHEET_ACT_DRAG_TYPE)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const landing = actLandingUnder(sheet, tableDrag.actId, event.clientY);
		actLanding = { beforeActId: landing.beforeActId };
		cells.setMark(landing.el, 'is-drop-before');
	});
	table.addEventListener('drop', (event) => {
		const sheet = currentSheet();
		if (tableDrag === null || sheet === null || event.dataTransfer === null) return;
		if (tableDrag.kind === 'beat') {
			const dragged = event.dataTransfer.getData(BEAT_SHEET_BEAT_DRAG_TYPE);
			if (tableDrag.beatId !== dragged) return;
			event.preventDefault();
			const landing = beatLanding ?? beatLandingUnder(sheet, dragged, event.clientY);
			cells.clearMark();
			// The landing is a place on the screen; the document is told where that is in the order it keeps.
			if (landing !== null) moveBeatTo(sheet.id, dragged, landing.actId, beatAnchor(sheet, landing.actId, landing.beforeBeatId, dragged));
			return;
		}
		const dragged = event.dataTransfer.getData(BEAT_SHEET_ACT_DRAG_TYPE);
		if (tableDrag.actId !== dragged) return;
		event.preventDefault();
		const landing = actLanding ?? actLandingUnder(sheet, dragged, event.clientY);
		cells.clearMark();
		moveActTo(sheet.id, dragged, actAnchor(sheet, landing.beforeActId, dragged));
	});

	/** A beat moved into an act before another of its beats, or to its end; nothing written for no move. */
	const moveBeatTo = (openedSheet: string, beatId: string, toActId: string, beforeBeatId: string | null): void => {
		const sheet = sheetAsStands(openedSheet);
		if (sheet === null || readOnly || beatMoveIsNoop(sheet, beatId, toActId, beforeBeatId)) return;
		void enqueue(async () => {
			await controls.bridge().moveBeat(openedSheet, beatId, toActId, beforeBeatId);
		});
	};

	/** An act moved before another, or to the end; nothing written for no move, which the document's own move is asked about. */
	const moveActTo = (openedSheet: string, actId: string, beforeActId: string | null): void => {
		if (readOnly || reading === null || moveBeatSheetAct(reading.held, openedSheet, actId, beforeActId, 0) === null) return;
		void enqueue(async () => {
			await controls.bridge().moveAct(openedSheet, actId, beforeActId);
		});
	};

	let eventWindow = root.win;
	// The deck holds a card still while one of its controls is pressed; the
	// release lands anywhere, so the window hears it, as under the timeline.
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
		// A colour panel hangs in the body of the window it was opened in; it
		// goes before the card leaves that window, as the timeline's does.
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

	// -- The acts' actions ---------------------------------------------------

	/**
	 * An act made through its form, before another act as the screen has them
	 * or at the screen's foot. The place is named as the screen named it when
	 * the form opened, and said as the document keeps it only when the write
	 * comes to be made: an anchor worked out at the press would be another
	 * act's id on a sheet shown from its end, and that act may have gone by
	 * then, which would land this one at the wrong end. The form stays open
	 * over a write that did not land, as a beat's does.
	 */
	const addAct = (beforeOnScreen: string | null): void => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		const opened = currentSheet();
		if (path === null || openedSheet === null || opened === null || readOnly || disposed) return;
		const reversed = opened.reversed;
		keep(new ActFormModal(app, t, { mode: 'add', initial: '' }, async (label) => {
			const came: { made: string | null } = { made: null };
			await enqueue(async () => {
				if (!stillOn(path, openedSheet)) return;
				const now = sheetAsStands(openedSheet);
				if (now === null) return;
				came.made = await controls.bridge().addAct(openedSheet, label, actAnchor({ ...now, reversed }, beforeOnScreen));
			});
			if (came.made === null && !disposed) throw new Error(t('beatSheet.act.refused'));
		})).open();
	};

	const editAct = (actId: string): void => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		const sheet = currentSheet();
		const act = sheet === null ? undefined : findBeatSheetAct(sheet, actId);
		if (path === null || openedSheet === null || act === undefined || readOnly || disposed) return;
		keep(new ActFormModal(app, t, { mode: 'edit', initial: act.label }, async (label) => {
			const came: { wrote: BeatSheetWrite } = { wrote: 'refused' };
			await enqueue(async () => {
				if (!stillOn(path, openedSheet)) return;
				came.wrote = await controls.bridge().relabelAct(openedSheet, actId, label);
			});
			if (came.wrote !== 'written' && !disposed) throw new Error(t('beatSheet.act.refused'));
		})).open();
	};

	/**
	 * An act one step along the story. Which way a step up the screen goes is
	 * settled by the screen its menu opened on, so an item does what it said
	 * when it was offered; where the step lands is read off the sheet as it
	 * stands when the move comes to be made.
	 */
	const moveActBy = (actId: string, direction: 'up' | 'down'): void => {
		const openedSheet = sheetId;
		if (openedSheet === null || readOnly) return;
		void enqueue(async () => {
			const sheet = sheetAsStands(openedSheet);
			const step = sheet === null ? null : beatSheetActStep(sheet, actId, direction);
			if (step === null) return;
			await controls.bridge().moveAct(openedSheet, actId, step.beforeActId);
		});
	};

	const deleteAct = async (actId: string): Promise<void> => {
		const openedSheet = sheetId;
		const sheet = currentSheet();
		const index = sheet?.acts.findIndex((act) => act.id === actId) ?? -1;
		const act = sheet?.acts[index];
		if (disposed || openedSheet === null || act === undefined || readOnly) return;
		if (act.beats.length > 0) {
			const rows = act.beats.reduce((total, beat) => total + beat.rows.length, 0);
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('beatSheet.act.deleteTitle', { act: actTitle(t, index + 1, act.label) }),
				lines: [t('beatSheet.act.deleteDescription', { beats: act.beats.length, rows })],
				label: t('actions.delete'),
			}, keep);
			if (!confirmed || disposed) return;
		}
		await enqueue(async () => {
			await controls.bridge().deleteAct(openedSheet, actId);
		});
	};

	const openActMenu = (actId: string, event: MouseEvent): void => {
		const sheet = currentSheet();
		if (sheet === null) return;
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.edit'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					editAct(actId);
				});
		});
		menu.addSeparator();
		// The moves and the insertions, then the removal, in the order a card's menu keeps.
		// Up and down are the screen's: on a sheet shown from its end, up is later in the story.
		const up = storedDirection('up', sheet.reversed);
		const down = storedDirection('down', sheet.reversed);
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(readOnly || beatSheetActStep(sheet, actId, up) === null)
				.onClick(() => {
					moveActBy(actId, up);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(readOnly || beatSheetActStep(sheet, actId, down) === null)
				.onClick(() => {
					moveActBy(actId, down);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('beatSheet.act.insertAfter'))
				.setIcon('list-plus')
				.setDisabled(readOnly)
				.onClick(() => {
					// After, as the screen has them: before the act shown below this one, or at the screen's foot.
					const now = currentSheet();
					if (now === null) return;
					const shown = shownActs(now);
					const at = shown.findIndex((act) => act.id === actId);
					if (at !== -1) addAct(shown[at + 1]?.id ?? null);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('beatSheet.beat.add'))
				.setIcon('plus')
				.setDisabled(readOnly)
				.onClick(() => {
					addBeatAtFoot(actId);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('beatSheet.act.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(readOnly)
				.onClick(() => {
					void deleteAct(actId);
				});
		});
		menu.showAtMouseEvent(event);
	};

	// -- The beats' actions --------------------------------------------------

	/**
	 * A beat made in an act, before another of its beats as the screen has them
	 * or at the act's foot, the place named and said as an act's is. The form
	 * stays open over a write the project refused: a beat is no note, so
	 * nowhere but the form holds the words typed for it.
	 */
	const addBeat = (actId: string, beforeOnScreen: string | null): void => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		const opened = currentSheet();
		if (path === null || openedSheet === null || opened === null || readOnly || disposed) return;
		const reversed = opened.reversed;
		keep(new BeatFormModal(app, t, { mode: 'add', initial: { name: '', description: '' } }, async (draft) => {
			const came: { made: string | null } = { made: null };
			await enqueue(async () => {
				if (!stillOn(path, openedSheet)) return;
				const now = sheetAsStands(openedSheet);
				if (now === null) return;
				came.made = await controls.bridge().addBeat(openedSheet, actId, draft, beatAnchor({ ...now, reversed }, actId, beforeOnScreen));
			});
			if (came.made === null && !disposed) throw new Error(t('beatSheet.beat.refused'));
		})).open();
	};

	/** A beat made at the foot of an act as the screen has it, which is where a beat dropped on the act's foot lands. */
	const addBeatAtFoot = (actId: string): void => {
		addBeat(actId, null);
	};

	const editBeat = (beatId: string, reveal?: 'description'): void => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		const sheet = currentSheet();
		const place = sheet === null ? null : findBeat(sheet, beatId);
		if (path === null || openedSheet === null || place === null || readOnly || disposed) return;
		keep(new BeatFormModal(app, t, {
			mode: 'edit',
			initial: { name: place.beat.name, description: place.beat.description },
			...(reveal === undefined ? {} : { reveal }),
		}, async (draft) => {
			const came: { wrote: BeatSheetWrite } = { wrote: 'refused' };
			await enqueue(async () => {
				if (!stillOn(path, openedSheet)) return;
				came.wrote = await controls.bridge().editBeat(openedSheet, beatId, draft);
			});
			if (came.wrote !== 'written' && !disposed) throw new Error(t('beatSheet.beat.refused'));
		})).open();
	};

	/** A beat one step along the story, across an act's edge where its act ends; settled and read as an act's step is. */
	const moveBeatBy = (beatId: string, direction: 'up' | 'down'): void => {
		const openedSheet = sheetId;
		if (openedSheet === null || readOnly) return;
		void enqueue(async () => {
			const sheet = sheetAsStands(openedSheet);
			const step = sheet === null ? null : beatStep(sheet, beatId, direction);
			if (step === null) return;
			await controls.bridge().moveBeat(openedSheet, beatId, step.actId, step.beforeBeatId);
		});
	};

	const moveBeatToAct = (beatId: string): void => {
		const path = controls.projectPath();
		const openedSheet = sheetId;
		const sheet = currentSheet();
		const place = sheet === null ? null : findBeat(sheet, beatId);
		if (path === null || openedSheet === null || sheet === null || place === null || readOnly || disposed) return;
		const elsewhere: PickerOption[] = shownActs(sheet)
			.map((act) => ({ value: act.id, label: actTitle(t, sheet.acts.indexOf(act) + 1, act.label) }))
			.filter((option) => option.value !== place.act.id);
		if (elsewhere.length === 0) return;
		keep(new TimelineTimePickModal(app, t('beatSheet.beat.moveToActPlaceholder'), elsewhere, (picked) => {
			if (!stillOn(path, openedSheet) || !elsewhere.some((option) => option.value === picked.value)) return;
			void enqueue(async () => {
				if (!stillOn(path, openedSheet)) return;
				// To the foot of that act as the screen has it, where a drop on its foot would land.
				const now = sheetAsStands(openedSheet);
				if (now === null) return;
				await controls.bridge().moveBeat(openedSheet, beatId, picked.value, beatAnchor(now, picked.value, null, beatId));
			});
		})).open();
	};

	const deleteBeat = async (beatId: string): Promise<void> => {
		const openedSheet = sheetId;
		const sheet = currentSheet();
		const place = sheet === null ? null : findBeat(sheet, beatId);
		if (disposed || openedSheet === null || place === null || readOnly) return;
		// A time's words live on in its note; a beat's are nowhere but here, so
		// what it says of itself is asked about as what stands under it is.
		const described = place.beat.description.trim().length > 0;
		if (place.beat.rows.length > 0 || described) {
			const lines: string[] = [];
			if (described) lines.push(t('beatSheet.beat.deleteDescribed'));
			if (place.beat.rows.length > 0) lines.push(t('beatSheet.beat.deleteDescription', { rows: place.beat.rows.length }));
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('beatSheet.beat.deleteTitle', { name: beatName(place.beat) }),
				lines,
				label: t('actions.delete'),
			}, keep);
			if (!confirmed || disposed) return;
		}
		await enqueue(async () => {
			await controls.bridge().deleteBeat(openedSheet, beatId);
		});
	};

	const openBeatMenu = (beatId: string, event: MouseEvent): void => {
		const sheet = currentSheet();
		const place = sheet === null ? null : findBeat(sheet, beatId);
		if (sheet === null || place === null) return;
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.edit'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					editBeat(beatId);
				});
		});
		menu.addSeparator();
		// Up and down are the screen's, as an act's are.
		const up = storedDirection('up', sheet.reversed);
		const down = storedDirection('down', sheet.reversed);
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(readOnly || beatStep(sheet, beatId, up) === null)
				.onClick(() => {
					moveBeatBy(beatId, up);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(readOnly || beatStep(sheet, beatId, down) === null)
				.onClick(() => {
					moveBeatBy(beatId, down);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('beatSheet.beat.moveToAct'))
				.setIcon('corner-down-right')
				.setDisabled(readOnly || sheet.acts.length < 2)
				.onClick(() => {
					moveBeatToAct(beatId);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('beatSheet.beat.insertAfter'))
				.setIcon('list-plus')
				.setDisabled(readOnly)
				.onClick(() => {
					// After, as the screen has them: before the beat shown below this one in its act, or at the act's foot.
					const now = currentSheet();
					const place = now === null ? null : findBeat(now, beatId);
					if (now === null || place === null) return;
					const shown = shownBeats(now, place.act);
					const at = shown.findIndex((beat) => beat.id === beatId);
					addBeat(place.act.id, shown[at + 1]?.id ?? null);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('beatSheet.beat.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(readOnly)
				.onClick(() => {
					void deleteBeat(beatId);
				});
		});
		menu.showAtMouseEvent(event);
	};

	// -- The lanes' cells ----------------------------------------------------------

	const cells: LaneCells = createLaneCells<BeatSheetReading>({
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
		// As last painted, and not as last read: a read that came back with
		// nothing leaves the table standing, and a row open in it is still the
		// row the screen shows, with the words the screen shows for it.
		lanes: () => paintedLanes,
		documentLanes: () => {
			const held = reading?.held ?? null;
			if (held === null) return null;
			if (documentLanesMemo?.held !== held) documentLanesMemo = { held, lanes: held.sheets.map(sheetAsLane) };
			return documentLanesMemo.lanes;
		},
		// A beat is no note a sheet may name again: once it has gone, words kept
		// for its cell have no foot to come back to, whatever becomes of the sheet.
		cellStands: (placedSheetId, beatId) => {
			const sheet = reading === null ? undefined : findBeatSheet(reading.held, placedSheetId);
			return sheet !== undefined && findBeat(sheet, beatId) !== null;
		},
		activeId: () => sheetId,
		presentation: () => presentation,
		// One lane has the field's width, so a row's cards wrap across it.
		laneAxis: () => 'across',
		scenesById: () => scenesById,
		sceneIndex: () => sceneIndex,
		stackKey: (placedSheetId, rowId) => beatStackKey(placedSheetId, rowId),
		stackPositions: () => memory.stackPositions,
		placeName,
		sceneScope,
		subrowMenuItems: (menu, lane, time, rowId) => {
			const sheet = currentSheet();
			menu.addItem((item) => {
				item
					.setTitle(t('beatSheet.subrow.moveToBeat'))
					.setIcon('corner-down-right')
					.setDisabled(readOnly || sheet === null || lane.id !== sheet.id || otherBeats(sheet, time.timeId).length === 0)
					.onClick(() => { moveRowToBeat(time.timeId, rowId); });
			});
		},
		words: { editGone: 'beatSheet.subrow.editGone', addGone: 'beatSheet.subrow.addGone', sceneRemove: 'beatSheet.scene.remove' },
		dragTypes: { row: BEAT_SHEET_ROW_DRAG_TYPE, scene: BEAT_SHEET_SCENE_DRAG_TYPE },
		// One lane has no neighbour to lock out, and no head to dress.
		dragPhase: () => undefined,
		endDrag: () => {
			endDrag();
		},
	});

	// -- The sheets' forms ---------------------------------------------------

	const openAddSheet = (): void => {
		const read = reading;
		if (read === null || readOnly || disposed) return;
		keep(new AddBeatSheetModal(
			app,
			t,
			{
				takenNames: read.held.sheets.map((sheet) => sheet.name),
				shelf: {
					// The presets are offered in the words they will be written in: the project's.
					builtIn: () => builtInBeatSheetTemplates(read.locale),
					project: () => reading?.held.templates ?? lastHeld?.templates ?? read.held.templates,
				},
				templateActions,
			},
			async (draft) => {
				if (disposed) return;
				const came: { made: string | null } = { made: null };
				await enqueue(async () => {
					came.made = await controls.bridge().createSheet(draft.name, draft.template);
					// Shown once a read holds it, which the one that follows this write does.
					if (came.made !== null) awaitedSheetId = came.made;
				});
				// That read has landed: a sheet it did not bring back is not waited on any longer.
				if (awaitedSheetId === came.made) awaitedSheetId = null;
				if (came.made === null && !disposed) throw new Error(t('beatSheet.sheet.createRefused'));
			},
		)).open();
	};

	const openEditSheet = (): void => {
		const read = reading;
		const sheet = currentSheet();
		if (read === null || sheet === null || readOnly || disposed) return;
		keep(new EditBeatSheetModal(
			app,
			t,
			{
				initial: sheet.name,
				takenNames: read.held.sheets.filter((candidate) => candidate.id !== sheet.id).map((candidate) => candidate.name),
				deleteSheet: async () => {
					if (disposed) return false;
					const now = sheetAsStands(sheet.id) ?? sheet;
					const beats = now.acts.reduce((total, act) => total + act.beats.length, 0);
					const rows = now.acts.reduce((total, act) => total + act.beats.reduce((sum, beat) => sum + beat.rows.length, 0), 0);
					const confirmed = await confirmTimelineAction(app, t, {
						title: t('beatSheet.sheet.deleteTitle', { name: now.name }),
						lines: [t('beatSheet.sheet.deleteDescription', { acts: now.acts.length, beats, rows })],
						label: t('actions.delete'),
					}, keep);
					if (!confirmed || disposed) return false;
					// The form closes on this answer, so it is the file's answer and
					// not the asking: a sheet the project would not let go stands, and
					// its form stands open with it, saying so.
					const came = { gone: false };
					await enqueue(async () => {
						came.gone = await controls.bridge().deleteSheet(sheet.id);
					});
					if (!came.gone && !disposed) new Notice(t('beatSheet.sheet.deleteRefused'));
					return came.gone;
				},
			},
			async (name) => {
				if (disposed) return;
				// The form stays open over a write that did not land, as a beat's
				// does: a sheet's name is nowhere but in the form until it is written.
				const came: { wrote: BeatSheetWrite } = { wrote: 'written' };
				await enqueue(async () => {
					// Against the sheet as it stands now, so a name already so is not written again.
					const standingSheet = sheetAsStands(sheet.id) ?? sheet;
					if (name !== standingSheet.name) came.wrote = await controls.bridge().renameSheet(sheet.id, name);
				});
				if (came.wrote !== 'written' && !disposed) throw new Error(t('beatSheet.sheet.renameRefused'));
			},
		)).open();
	};

	// -- The project's own templates -------------------------------------------

	/**
	 * The sheet on show kept as a template under a name: its acts' labels and
	 * its beats' names and descriptions, and nothing written under them. The
	 * press names the sheet it was made on, which is the one kept whatever is
	 * on show by the time the name has been typed, as it stands in the file
	 * when its turn comes. A namesake is replaced, and the dialog says so
	 * before it is.
	 */
	const openExport = (): void => {
		const aimed = currentSheet();
		const path = controls.projectPath();
		if (aimed === null || path === null || readOnly || disposed) return;
		void promptForCustomFieldTemplate(app, t, {
			title: t('modal.customFieldTemplate.exportTitle'),
			submitLabel: t('common.save'),
			initial: { name: aimed.name, description: '' },
			rows: null,
			objection: () => null,
			advisory: (name) => {
				const held = reading?.held ?? lastHeld;
				const match = held === null ? undefined : beatSheetTemplateNamesake(held, name);
				return match === undefined ? null : t('modal.customFieldTemplate.replaceNotice', { name: match.name });
			},
		}, keep).then((result) => {
			if (result === null || disposed) return;
			void enqueue(async () => {
				const current = controls.model();
				// The same project, still one that can be written; the sheet on show may be another by now.
				if (disposed || current === null || current.readOnly || current.path !== path || controls.projectPath() !== path) return;
				const wrote = await controls.bridge().saveTemplate(aimed.id, { name: result.name, description: result.description });
				new Notice(t(wrote === 'written' ? 'notice.templateExported' : 'beatSheet.template.exportRefused', { name: result.name }));
			});
		});
	};

	/**
	 * What stands beside the template field of the Add beat sheet form: the
	 * way to take one of the project's own templates out. A preset cannot go,
	 * so the control wakes only for a pick of the project's.
	 */
	const templateActions = (line: HTMLElement, form: AddBeatSheetFormHandle): void => {
		const button = line.createEl('button', {
			cls: 'clickable-icon snowflake-method-beat-sheet-template-delete',
			attr: { type: 'button', 'aria-label': t('beatSheet.template.delete') },
		});
		setIcon(button, 'trash-2');
		setTooltip(button, t('beatSheet.template.delete'));
		const paint = (): void => {
			button.disabled = readOnly || form.choice().kind !== 'project';
		};
		form.onChoice(paint);
		paint();
		button.addEventListener('click', () => {
			void deleteTemplate(form);
		});
	};

	const deleteTemplate = async (form: AddBeatSheetFormHandle): Promise<void> => {
		const choice = form.choice();
		const held = reading?.held ?? lastHeld;
		const template = held === null || choice.kind !== 'project' ? undefined : findBeatSheetTemplate(held, choice.id);
		if (template === undefined || readOnly || disposed || form.closed()) return;
		const confirmed = await confirmTimelineAction(app, t, {
			title: t('beatSheet.template.deleteTitle', { name: template.name }),
			lines: [t('beatSheet.template.deleteDescription')],
			label: t('actions.delete'),
		}, keep);
		if (!confirmed || disposed) return;
		const came = { gone: false };
		await enqueue(async () => {
			came.gone = await controls.bridge().deleteTemplate(template.id);
		});
		if (disposed) return;
		if (!came.gone) {
			new Notice(t('beatSheet.template.deleteRefused'));
			return;
		}
		// The form is left holding nothing that has gone: a pick still on the
		// template falls back to the barest start. A form closed meanwhile, or
		// moved on to another pick, is left as it is.
		const now = form.choice();
		if (!form.closed() && now.kind === 'project' && now.id === template.id) {
			form.choose({ kind: 'built-in', id: BUILT_IN_BEAT_SHEET_TEMPLATE_IDS[0] });
		}
	};

	// The pool is the corkboard in one column, showing what the sheet has not
	// placed; its search, funnel, grouping and order are its own, and the card
	// style it chooses dresses the sheet's cards as well.
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
		searchLabel: 'quiet',
		columns: 1,
		gap: 0.75,
		emptyText: t('beatSheet.pool.empty'),
		modeShared: true,
		// Its cards leave for the cells and come back to it, and its menu places a scene as a beat's does.
		...cells.poolVariant(),
	});

	paintAll();
	void reload();

	const handle: BeatSheetHandle = {
		refresh: () => {
			// Nothing read means the project was not there to be read when the
			// last read went out; the model landing is the word that it may be
			// there now, so the document is asked for again.
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
			// Each dialog is closed on its own: one that throws on the way out
			// would otherwise take the words below with it, and those are the
			// author's, with no second chance once the workspace has gone.
			for (const modal of [...standing]) {
				try {
					modal.close();
				} catch (error) {
					console.error('Snowflake: a beat sheet dialog could not be closed', error);
				}
			}
			standing.clear();
			// Words still being written go the way a leave sends them.
			cells.settle();
			deck.dispose();
			sizeObserver?.disconnect();
			sheetField?.destroy();
			root.remove();
		},
	};
	return handle;
};
