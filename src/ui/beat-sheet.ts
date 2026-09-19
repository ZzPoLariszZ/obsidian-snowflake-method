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
 * paint's gate are the loop's (`document-loop.ts`). Nor is the frame around
 * the table: the folds, the stand-in bars, the pool, the deck, the window,
 * the focus and the dialogs are the frame's (`workspace-frame.ts`). All three
 * are shared with the timeline. This is the sheet's own drawing: the
 * toolbar, the acts, the beat column, and the moves of acts and beats.
 */

import { Menu, Notice, setIcon, setTooltip } from 'obsidian';

import {
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
	moveBeat,
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
} from './beat-sheet-forms';
import {
	actLandingAt,
	actTitle,
	assignedSceneIds,
	beatLandingAt,
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
import { createDocumentLoop, type DocumentLoop } from './document-loop';
import { createLaneCells, type Lane, type LaneCell, type LaneCells, type SceneScope } from './lane-cells';
import { promptForCustomFieldTemplate } from './modals';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';
import { renderEmptyLine } from './pane-parts';
import { planCardMoves, planCardRepaint } from './sticky-note-layout';
import { TimelineTimePickModal, confirmTimelineAction } from './timeline-forms';
import type { ProjectDashboardModel } from './view-model';
import {
	bindFrameWindow,
	createFocusCustody,
	createFrame,
	createLaneDeck,
	createModalKeeper,
	paintSymbol,
	toolbarIconButton,
	type Fold,
	type FoldLabels,
	type SymbolMemo,
} from './workspace-frame';

/** An act's header across the table: its handle, what it is called, and its two controls. */
interface ActEntry {
	kind: 'act';
	actId: string;
	el: HTMLElement;
	handle: HTMLButtonElement;
	title: HTMLButtonElement;
	add: HTMLButtonElement;
}

/** The line under an act's beats: it says the act holds none, and takes a beat dropped at the act's end. */
interface FootEntry {
	kind: 'foot';
	el: HTMLElement;
	line: HTMLElement;
}

/** One beat's row: its own cell in the beat column, and the one lane's cell beside it. */
interface BeatEntry {
	kind: 'beat';
	beatId: string;
	el: HTMLElement;
	handle: HTMLButtonElement;
	label: HTMLButtonElement;
	description: HTMLButtonElement;
	/** The plus on the rule above the row, which puts a beat in before it. */
	seamAdd: HTMLButtonElement;
	body: LaneCell;
}

/** All that stands in the table, each under the key its kind and its id give it. */
type TableEntryEl = ActEntry | BeatEntry | FootEntry;

/** What the two folds' toggles are called: the beat column folded to its names, and the pool away. */
const FOLD_LABELS: Readonly<Record<Fold, FoldLabels>> = {
	column: { collapse: 'beatSheet.beat.collapse', expand: 'beatSheet.beat.expand' },
	pool: { collapse: 'timeline.pool.collapse', expand: 'timeline.pool.expand' },
};

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
	const iconButton = (cls: string, icon: string, label: string): HTMLButtonElement =>
		toolbarIconButton(toolbar, cls, icon, label);
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

	// -- The folds, the empty states, the body and the pool --------------------

	// The frame stands under the toolbar, as the timeline's does: the folds in
	// its corners, the beat column's at the left and the pool's at the right,
	// then the word said in the body's place, and the body. The beat column
	// folds as the timeline's time column does, by the same class. The bar
	// across starts past the beat column, and the pool shows what the sheet on
	// show has not placed.
	const frame = createFrame({
		controls,
		root,
		foldLabels: FOLD_LABELS,
		columnCollapsed: () => memory.beatsCollapsed,
		setColumnCollapsed: (collapsed) => {
			memory.beatsCollapsed = collapsed;
		},
		model: () => model,
		invalidateRects: () => {
			invalidateRects();
		},
		// No head row stands over the table, so the bar down starts at the field's top.
		placeScrollbars: (fit) => {
			fit(beatColumnWidth());
		},
	});
	const { scroller, table, folds, pool, showEmpty } = frame;
	// No head row stands over the table: the sheet is named in the toolbar's
	// field, and each act's header is a head of its own.
	const actsEmpty = table.createDiv({ cls: 'snowflake-method-timeline-times-empty' });
	renderEmptyLine(actsEmpty, t('beatSheet.empty.acts'));
	/** Where an act dropped past the last lands, and wears the line. */
	const tail = table.createDiv({ cls: 'snowflake-method-timeline-tail' });

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
	/** The symbols the three switches wear now, so a paint redraws none for nothing. */
	const presentationSymbol: SymbolMemo = { icon: 'gallery-horizontal' };
	const wordsSymbol: SymbolMemo = { icon: 'eye' };
	const orderSymbol: SymbolMemo = { icon: 'arrow-down-narrow-wide' };
	let readOnly = true;
	let optionsSignature = '';
	let sheetField: OptionPicker | null = null;
	/** One keeping for the table's three kinds: a key says its kind, so no two of them can meet. */
	const tableEntries = new Map<string, TableEntryEl>();
	let disposed = false;
	/** Forms and pickers belong to this workspace; recovered words deliberately outlive it. */
	const modals = createModalKeeper();
	const { keep } = modals;
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

	// The cards are the corkboard's, dealt from a deck of the same kind, with what they read off the model.
	const laneDeck = createLaneDeck({
		controls,
		notice,
		model: () => model,
		readOnly: () => readOnly,
		cells: () => cells,
	});
	const { deck } = laneDeck;

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

	/** Where the beat column ends, from its own box; nothing here holds its place, so nothing is summed. */
	const beatColumnWidth = (): number => {
		const width = table.querySelector<HTMLElement>('.snowflake-method-timeline-time')?.offsetWidth ?? 0;
		return Number.isFinite(width) ? width : 0;
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
		folds.paint();
		// The model's own, made again only when it is another model.
		if (nextModel !== model) laneDeck.index(nextModel);
		model = nextModel;
		// The model's word alone, renewed with every project refresh.
		readOnly = model?.readOnly ?? true;
		root.toggleClass('is-read-only', readOnly);
		laneDeck.beginPaint();
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
		pool.paintCardMode();
		const hold = focus.hold();
		paintTable(sheet);
		paintPool(sheet);
		// The scroll the tab remembers, given back once the sheet is long enough to take it.
		frame.giveScrollBack();
		focus.giveBack(hold);
		deck.prune();
		stateText.setText('');
		frame.fitScrollbars();
	};

	/** The symbol shows how the sheet deals its scenes; a press deals them the other way. */
	const paintPresentation = (sheet: BeatSheet | null): void => {
		presentation = sheet === null ? 'flat' : derivedBeatSheetPresentation(sheet);
		root.dataset.presentation = presentation;
		const stacked = presentation === 'stack';
		paintSymbol(presentationButton, presentationSymbol, {
			icon: stacked ? 'layers-3' : 'gallery-horizontal',
			label: t(stacked ? 'timeline.presentation.toFlat' : 'timeline.presentation.toStack'),
			disabled: readOnly || sheet === null,
		});
	};

	/** The symbol shows whether the beats show their rows' words; a press shows or hides them. */
	const paintWords = (sheet: BeatSheet | null): void => {
		const shown = sheet === null || sheet.showSubDescriptions;
		root.toggleClass('is-words-hidden', !shown);
		paintSymbol(wordsButton, wordsSymbol, {
			icon: shown ? 'eye' : 'eye-off',
			label: t(shown ? 'timeline.view.subDescriptionsHide' : 'timeline.view.subDescriptions'),
			pressed: shown,
			disabled: readOnly || sheet === null,
		});
	};

	/** The symbol shows which way the sheet runs; a press turns it about. */
	const paintOrder = (sheet: BeatSheet | null): void => {
		const reversed = sheet !== null && sheet.reversed;
		paintSymbol(orderButton, orderSymbol, {
			icon: reversed ? 'arrow-up-narrow-wide' : 'arrow-down-narrow-wide',
			label: t(reversed ? 'beatSheet.order.restore' : 'beatSheet.order.reverse'),
			pressed: reversed,
			disabled: readOnly || sheet === null,
		});
	};

	/** The pool follows the sheet on show: what it has placed leaves the pool, and the count says what is left. */
	const paintPool = (sheet: BeatSheet): void => {
		pool.paint(assignedSceneIds(sheet));
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
		const entry: ActEntry = { kind: 'act', actId, el, handle, title, add };
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
		return { kind: 'foot', el, line };
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
			kind: 'beat', beatId, el, handle, label, description, seamAdd,
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
		// The beat's own rows, handed over and not copied: the cells compare them by identity.
		cells.dressCell(entry.body, { timeId: item.beat.id, rows: item.beat.rows }, laneOf(sheet));
	};

	const unmountEntry = (key: string): void => {
		const entry = tableEntries.get(key);
		if (entry === undefined) return;
		// A beat's row gives its cell back to the cells before it goes.
		if (entry.kind === 'beat') cells.unmountCell(entry.body);
		entry.el.remove();
		tableEntries.delete(key);
	};

	const entryEl = (key: string): HTMLElement | undefined => tableEntries.get(key)?.el;

	const clearTable = (): void => {
		for (const key of [...tableEntries.keys()]) unmountEntry(key);
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
		for (const key of planCardRepaint([...tableEntries.keys()], wanted, []).remove) unmountEntry(key);
		for (const item of entries) {
			let entry = tableEntries.get(item.key);
			if (entry === undefined) {
				entry = item.kind === 'act' ? buildAct(item.key, item.act.id)
					: item.kind === 'beat' ? buildBeat(item.key, sheet, item.beat.id)
						: buildFoot(item.key, item.act.id);
				tableEntries.set(item.key, entry);
			}
			// The key carries the kind, so what stands under it is of the kind the table asks for.
			if (item.kind === 'act' && entry.kind === 'act') dressAct(entry, item);
			else if (item.kind === 'beat' && entry.kind === 'beat') dressBeat(entry, item, sheet);
			else if (item.kind === 'foot' && entry.kind === 'foot') entry.line.toggleClass('is-hidden', item.act.beats.length > 0);
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
		cells.paintDragPhase();
		loop.paintOwed();
	};

	/** Every entry's box, measured once per drag. */
	const measured = (): Map<string, DOMRect> => {
		if (tableRects === null) {
			tableRects = new Map();
			for (const [key, entry] of tableEntries) tableRects.set(key, entry.el.getBoundingClientRect());
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
				candidates.push({ key: item.key, actId: item.act.id, beatId: item.beat.id, middle: middleOf(item.key) });
			} else {
				candidates.push({ key: item.key, actId: item.act.id, beatId: null, middle: middleOf(item.key) });
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
		const el = landing.beforeActId === null ? undefined : entryEl(tableKey('act', landing.beforeActId));
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

	/** A beat moved into an act before another of its beats, or to its end; nothing written for no move, which the document's own move is asked about. */
	const moveBeatTo = (openedSheet: string, beatId: string, toActId: string, beforeBeatId: string | null): void => {
		if (readOnly || reading === null || moveBeat(reading.held, openedSheet, beatId, toActId, beforeBeatId, 0) === null) return;
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

	// What was measured is dropped as the window moves, and the window hears
	// the release of a press the deck holds a card still under, as the timeline's does.
	const releaseWindow = bindFrameWindow({ root, deck, invalidateRects });

	// -- Focus custody -------------------------------------------------------

	const focus = createFocusCustody(root, scroller, deck);

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
		scenesById: laneDeck.scenesById,
		sceneIndex: laneDeck.sceneIndex,
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
					project: () => lastHeld?.templates ?? read.held.templates,
				},
				templateDelete: { allowed: () => !readOnly, remove: removeTemplate },
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
				const held = lastHeld;
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
	 * One of the project's own templates taken out, from the Add beat sheet
	 * form that offers it: asked about first, and said where it would not go.
	 * True once it has gone, which is when the form lets its pick of it go.
	 */
	const removeTemplate = async (templateId: string): Promise<boolean> => {
		const template = lastHeld === null ? undefined : findBeatSheetTemplate(lastHeld, templateId);
		if (template === undefined || readOnly || disposed) return false;
		const confirmed = await confirmTimelineAction(app, t, {
			title: t('beatSheet.template.deleteTitle', { name: template.name }),
			lines: [t('beatSheet.template.deleteDescription')],
			label: t('actions.delete'),
		}, keep);
		if (!confirmed || disposed) return false;
		const came = { gone: false };
		await enqueue(async () => {
			came.gone = await controls.bridge().deleteTemplate(template.id);
		});
		if (disposed) return false;
		if (!came.gone) new Notice(t('beatSheet.template.deleteRefused'));
		return came.gone;
	};

	// The pool is dealt now that the cells stand: its cards leave for them and
	// come back to it, and its menu places a scene as a beat's does.
	pool.mount({ emptyText: t('beatSheet.pool.empty'), ...cells.poolVariant() });

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
		reveal: frame.reveal,
		remeasure: frame.remeasure,
		saveFocusedConflict: () => focus.saveConflict() || pool.saveFocusedConflict(),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			// The order is a rule, as it is the timeline's: the bell, the window,
			// the pool, the dialogs, and only then the words still being written
			// and the deck.
			loop.release();
			releaseWindow();
			pool.dispose();
			// Each dialog is closed on its own, so one that throws on the way out
			// does not take the words below with it.
			modals.closeAll('Snowflake: a beat sheet dialog could not be closed');
			// Words still being written go the way a leave sends them.
			cells.settle();
			deck.dispose();
			frame.stopWatchingSize();
			sheetField?.destroy();
			root.remove();
		},
	};
	return handle;
};
