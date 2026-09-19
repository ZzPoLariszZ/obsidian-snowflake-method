/**
 * The cells of a lane: what stands in the box a workspace makes where a lane
 * meets a time, or a beat sheet meets a beat. The sub-descriptions written
 * there, the foot the next is typed at, the scenes placed on each flat or
 * stacked, the drags that move a row or a scene and the menus that move them
 * without one, and every rule for keeping words an author typed until the
 * file holds them. The timeline was the first to stand on it and its names
 * are the timeline's still, as the scene card kept the corkboard's.
 *
 * The workspace makes each cell's box, says what stands around it through
 * the dependencies below, and keeps a protocol with it: `recoverHomelessFeet`
 * at the head of a paint that has a document, `sweep` once the rows are
 * painted or cleared, `settle` as it goes, after its dialogs are closed.
 */

import { Keymap, Menu, setIcon, setTooltip, type App, type Modal } from 'obsidian';

import type { ScenePresentation, Timeline, TimelineRow, TimelineTime } from '../domain';
import type { CorkboardVariant } from './corkboard-bridge';
import { MoveAfterModal, type MoveAfterEntry, type Translate } from './modals';
import { SCENE_CARD_SELECTOR, pressWithin, type SceneCard, type SceneCardDeck } from './scene-card';
import { planCardMoves, planCardRepaint } from './sticky-note-layout';
import { dropIndexAt } from './task-board-rows';
import type { TimelineBridge, TimelineHost } from './timeline-bridge';
import { TimelineDraftModal, confirmTimelineAction, type RecoveredTimelineDraft } from './timeline-forms';
import {
	cellDragState,
	clampStackPosition,
	joinKey,
	keyPrefix,
	placementIndexAt,
	rowAcceptsScene,
	splitKey,
	type TimelineDrag,
} from './timeline-layout';
import type { SceneViewModel } from './view-model';

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

/**
 * What stands in a lane's cell: the rows when the lane holds the time, the
 * foot where the next is typed, and the rows typed and not yet read back.
 * The box itself, its axis and its pluses are the workspace's.
 */
export interface LaneCell {
	timelineId: string;
	timeId: string;
	el: HTMLElement;
	/** The rows' box, while the lane holds the time; null while it does not. */
	rows: HTMLElement | null;
	trailing: TrailingRow | null;
	pending: PendingRow[];
	subrows: Map<string, SubrowEntry>;
}

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

/** A lane as its cells know one: its id, its name, and the rows it holds under each time. */
export type Lane = Pick<Timeline, 'id' | 'name' | 'times'>;

/** What a card's menu opened on, kept through its picker and the queue by the workspace that knows its views. */
export interface SceneScope<Reading> {
	laneId: string;
	sceneId: string;
	/** Null when the scene came from the pool. */
	rowId: string | null;
	/** The lane as the reading handed over has it, or the one last taken; null once anything the menu opened on has moved. */
	lane: (read?: Reading | null) => Lane | null;
}

/** What the lanes' cells ask of the workspace they stand in. */
export interface LaneCellsDeps<Reading> {
	app: App;
	t: Translate;
	host: Pick<TimelineHost, 'openManagedFile' | 'openSceneForm' | 'deleteScene'>;
	notice: (error: unknown) => void;
	/** Dialogs opened here belong to the workspace, which closes them as it goes. */
	keep: <T extends Modal>(modal: T) => T;
	enqueue: (action: () => Promise<void>) => Promise<void>;
	/** The bridge standing now; asked for afresh, since a rename hands the workspace a new one. */
	bridge: () => Pick<TimelineBridge, 'addRow' | 'editRow' | 'moveRow' | 'deleteRow' | 'placeScene' | 'removeScene'> & {
		read: () => Promise<Reading | null>;
	};
	unloading: () => boolean;
	disposed: () => boolean;
	readOnly: () => boolean;
	projectPath: () => string | null;
	/** Wears the classes a drag in flight is dressed by. */
	root: HTMLElement;
	/** What every mounted card stands within; a card outside it is nobody's. */
	ground: HTMLElement;
	deck: SceneCardDeck<SceneCard>;
	/** The lanes as last painted. */
	lanes: () => readonly Lane[];
	/** Every lane the document holds, shown or not; null while nothing is read. */
	documentLanes: () => readonly Lane[] | null;
	/** Whether words kept for a cell still have a cell to come back to. */
	cellStands: (laneId: string, timeId: string) => boolean;
	activeId: () => string | null;
	presentation: () => ScenePresentation;
	laneAxis: () => 'across' | 'down';
	scenesById: () => ReadonlyMap<string, SceneViewModel>;
	sceneIndex: () => ReadonlyMap<string, number>;
	/** Under which name a row's stack remembers the card it shows; null while nothing is shown to remember it for. */
	stackKey: (laneId: string, rowId: string) => string | null;
	stackPositions: () => Map<string, number>;
	/** Where words were meant to stand, as a writer would name it. */
	placeName: (laneId: string, timeId: string | null) => string;
	sceneScope: (sceneId: string, rowId: string | null) => SceneScope<Reading> | null;
	/** What a row's menu offers between its moves and its removal. */
	subrowMenuItems?: (menu: Menu, lane: Lane, time: TimelineTime, rowId: string) => void;
	/** The words that name the surface the cells stand in, as translation keys. */
	words: { editGone: string; addGone: string; sceneRemove: string };
	dragTypes: { row: string; scene: string };
	/** The workspace's own parts dressed for the drag in flight, beside the cells. */
	dragPhase: (stateOf: (laneId: string) => 'lane' | 'locked' | 'idle') => void;
	/** The whole of a drag's end, the workspace's half with the cells'. */
	endDrag: () => void;
}

export interface LaneCells {
	/** What stands in a cell, mounted on the box the workspace made for it. */
	mountCell: (el: HTMLElement, timelineId: string, timeId: string) => LaneCell;
	/** The cell brought level with the lane: null for a lane that lacks the time. */
	dressCell: (cell: LaneCell, time: TimelineTime | null, lane: Lane) => void;
	unmountCell: (cell: LaneCell) => void;
	/** Words whose cell has gone, shown for keeping; asked at the head of a paint that has a document. */
	recoverHomelessFeet: () => void;
	/** What no cell took over in a paint: asked once its rows are painted, or cleared. */
	sweep: () => void;
	dragging: () => boolean;
	setMark: (el: HTMLElement, cls: string) => void;
	clearMark: () => void;
	invalidateRects: () => void;
	paintDragPhase: () => void;
	/** The cells' half of a drag's end. */
	dragEnded: () => void;
	/** What the scene pool is dealt with, so its cards leave for the cells and come back. */
	poolVariant: () => Pick<CorkboardVariant, 'menuItems' | 'dragOut' | 'dropIn'>;
	dragAllowed: (card: SceneCard) => boolean;
	openCardMenu: (card: SceneCard, event: MouseEvent) => void;
	/** Words still being written as the workspace goes, sent the way a leave sends them. */
	settle: () => void;
}

/**
 * The cells of a lane: the sub-descriptions written in them and the scenes
 * placed on those, with every rule of keeping the words an author typed. The
 * workspace makes each cell's box and says what stands around it; what
 * stands in it is kept here, the same wherever a lane is drawn.
 */
export function createLaneCells<Reading>(deps: LaneCellsDeps<Reading>): LaneCells {
	const { app, t, host, notice, keep, enqueue, root, ground, deck } = deps;

	/** The row or the scene being dragged, while one is. */
	let drag: Extract<TimelineDrag, { kind: 'row' | 'scene' }> | null = null;
	/** Where a drop would land, as the class on the element that wears the line. */
	let mark: { el: HTMLElement; cls: string } | null = null;
	/** What the last dragover worked out, which the drop then uses: the row a drop lands before. */
	let rowLanding: { cell: LaneCell; rowId: string | null } | null = null;
	/** Where a scene would land: a row and the scene it goes before, or the trailing row for a row of its own. */
	let sceneLanding: { cell: LaneCell; rowId: string | null; beforeSceneId: string | null } | null = null;
	/** Measured once per drag, dropped on scroll, resize, paint and drag end. */
	let rects: {
		subrows: Map<HTMLElement, { rowId: string; middle: number }[]>;
		cards: Map<HTMLElement, { sceneId: string; el: HTMLElement; rect: DOMRect }[]>;
	} = { subrows: new Map(), cards: new Map() };
	const invalidateRects = (): void => {
		rects = { subrows: new Map(), cards: new Map() };
	};

	const laneOfRow = (rowId: string): Lane | null =>
		deps.lanes().find((lane) => lane.times.some((time) => time.rows.some((row) => row.id === rowId))) ?? null;

	// -- The cells ---------------------------------------------------------------

	/** Every cell's body by lane and time, so words given back find their foot without walking the rows of times. */
	const laneCells = new Map<string, LaneCell>();

	/** What stands in a cell, mounted on the box the workspace made for it, where a dragged row or scene lands. */
	const mountCell = (el: HTMLElement, timelineId: string, timeId: string): LaneCell => {
		const cell: LaneCell = { timelineId, timeId, el, rows: null, trailing: null, pending: [], subrows: new Map() };
		laneCells.set(footKey(timelineId, timeId), cell);
		// A row lands in a cell of its own lane, before the sub-row under the
		// pointer or at the foot; another lane's cell says no, as a cursor.
		// The mark moves from dragover alone: Chromium fires dragleave at
		// every child boundary, and a mark cleared there flickers.
		el.addEventListener('dragover', (event) => {
			if (drag?.kind === 'scene') {
				sceneDragOver(cell, event);
				return;
			}
			if (drag?.kind !== 'row' || event.dataTransfer?.types.includes(deps.dragTypes.row) !== true) return;
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
				sceneDrop(cell, event);
				return;
			}
			const dragged = event.dataTransfer?.getData(deps.dragTypes.row) ?? '';
			if (drag?.kind !== 'row' || drag.rowId !== dragged || drag.timelineId !== cell.timelineId) return;
			event.preventDefault();
			// The landing the last dragover worked out, for the drop it was shown for.
			const beforeRowId = rowLanding?.cell === cell
				? rowLanding.rowId
				: (subrowLanding(cell, drag.rowId, event.clientY)?.rowId ?? null);
			clearMark();
			const { timelineId: draggedLane, rowId } = drag;
			void enqueue(async () => {
				await deps.bridge().moveRow(draggedLane, rowId, cell.timeId, beforeRowId);
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
		cell: LaneCell,
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

	/** Takes down what stands in a cell: the rows, their cards, and the foot. */
	const clearCell = (cell: LaneCell): void => {
		for (const rowId of [...cell.subrows.keys()]) unmountSubrow(cell, rowId);
		for (const pending of cell.pending) pending.el.remove();
		cell.pending = [];
		cell.trailing?.el.remove();
		cell.trailing = null;
		cell.rows?.remove();
		cell.rows = null;
	};

	/** A cell's body gone with its box: what stood in it comes down, and the lanes forget it. */
	const unmountLaneCell = (cell: LaneCell): void => {
		clearCell(cell);
		laneCells.delete(footKey(cell.timelineId, cell.timeId));
	};

	/**
	 * What stands in a cell brought level with the lane: the rows' box and the
	 * foot while the lane holds the time, and nothing while it does not.
	 */
	const dressLaneCell = (cell: LaneCell, time: TimelineTime | null, lane: Lane): void => {
		if (time === null) {
			if (cell.rows !== null) clearCell(cell);
			return;
		}
		if (cell.rows === null) {
			cell.rows = cell.el.createDiv({ cls: 'snowflake-method-timeline-rows' });
			cell.trailing = buildTrailing(cell);
		}
		if (cell.trailing !== null) {
			cell.trailing.el.toggleClass('is-hidden', deps.readOnly());
			cell.trailing.input.disabled = deps.readOnly();
			// The foot invites the first sub-description, then more of them. Keeping it
			// out of the way until its own cell is asked for is the stylesheet's work,
			// and it does that for every foot alike, so nothing is marked here.
			const more = time.rows.length + cell.pending.length > 0;
			cell.trailing.input.setAttribute('placeholder', t(more ? 'timeline.subrow.placeholderMore' : 'timeline.subrow.placeholder'));
		}
		paintSubrows(cell, time, lane);
	};

	// -- The sub-rows of a cell ----------------------------------------------

	const buildSubrow = (cell: LaneCell, rowId: string): SubrowEntry => {
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
			if (deps.readOnly() || event.dataTransfer === null || time === null) {
				event.preventDefault();
				return;
			}
			drag = { kind: 'row', timelineId: cell.timelineId, timeId: time.timeId, rowId: entry.rowId };
			invalidateRects();
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(deps.dragTypes.row, entry.rowId);
			if (typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(entry.el, 8, 8);
			root.addClass('is-row-drag');
			entry.el.addClass('is-dragging');
			paintDragPhase();
		});
		handle.addEventListener('dragend', () => {
			entry.el.removeClass('is-dragging');
			deps.endDrag();
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
	 * so far is left behind as bare letters. The composing is the input's own
	 * and goes down with it; the words held back are the cell's, kept under its
	 * key, so a cell built again or a workspace closed mid-composition still
	 * has them.
	 */
	const composingFeet = new WeakSet<HTMLTextAreaElement>();
	const withheldFeet = new Map<string, string>();
	/** How many writes are on their way from each foot: their words are the write's to give back. */
	const footWrites = new Map<string, number>();

	/** Words joined in the order they were written, with the empty ones left out. */
	const mergeWords = (...parts: readonly string[]): string =>
		parts.filter((part) => part.trim().length > 0).join('\n');

	const holdFootWrite = (key: string, by: 1 | -1): void => {
		const now = (footWrites.get(key) ?? 0) + by;
		if (now <= 0) footWrites.delete(key);
		else footWrites.set(key, now);
	};

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
		const foot = laneCells.get(footKey(timelineId, timeId))?.trailing?.input;
		const shown = foot !== undefined && foot.isConnected ? foot : null;
		// A lane the document no longer holds has no foot for the words to come
		// back to, at this paint or any after it. Put by under its key they
		// would be out of sight until the workspace closed, so they are shown
		// for keeping at once, as an edit of a row that has gone is -- and with
		// them all the cell was holding besides: words a composition held back,
		// and words typed into the emptied foot while this write was away.
		if (shown === null && !deps.cellStands(timelineId, timeId)) {
			recoverFoot(timelineId, timeId, words);
			return;
		}
		// A foot being composed in is left as it stands: the words wait aside
		// and go in when the composition ends, ahead of whatever it left there.
		if (shown !== null && composingFeet.has(shown)) {
			withheldFeet.set(key, mergeWords(withheldFeet.get(key) ?? '', words));
			return;
		}
		const since = shown?.value ?? footWords.get(key) ?? '';
		const value = mergeWords(withheldFeet.get(key) ?? '', words, since);
		withheldFeet.delete(key);
		keepFoot(key, value);
		if (shown === null) return;
		shown.value = value;
		fitWords(shown);
	};

	/**
	 * All a cell's foot was holding, shown for keeping: the words handed back,
	 * those a composition held back, and those typed since. Nothing stays under
	 * the key, which has no foot left to give it back to.
	 */
	const recoverFoot = (timelineId: string, timeId: string, words = ''): void => {
		const key = footKey(timelineId, timeId);
		const all = mergeWords(withheldFeet.get(key) ?? '', words, footWords.get(key) ?? '');
		footWords.delete(key);
		withheldFeet.delete(key);
		if (all.length > 0) recoverWords(deps.placeName(timelineId, timeId), all);
	};

	/**
	 * Words left at the foot of a cell whose lane the document no longer holds.
	 * They are shown for keeping as soon as the paint says the lane has gone,
	 * rather than held out of sight until the workspace closes -- except while
	 * a write of theirs is away, which gives them back itself.
	 */
	const recoverHomelessFeet = (): void => {
		for (const key of new Set([...footWords.keys(), ...withheldFeet.keys()])) {
			if (footWrites.has(key)) continue;
			const [timelineId, timeId] = splitKey(key) as [string, string];
			if (deps.cellStands(timelineId, timeId)) continue;
			recoverFoot(timelineId, timeId);
		}
	};

	const buildTrailing = (cell: LaneCell): TrailingRow => {
		const timeId = cell.timeId;
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
		// The composition these waited on went down with the input it was in,
		// so they wait no longer: they go into the new one, ahead of whatever
		// was typed after they were refused.
		const withheld = withheldFeet.get(key);
		if (withheld !== undefined) {
			withheldFeet.delete(key);
			keepFoot(key, mergeWords(withheld, footWords.get(key) ?? ''));
		}
		const held = footWords.get(key);
		if (held !== undefined) {
			input.value = held;
			fitWords(input);
		}
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
				event.preventDefault();
				commitTrailing(cell, input);
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
			const kept = withheldFeet.get(key);
			withheldFeet.delete(key);
			if (kept === undefined) return;
			input.value = mergeWords(kept, input.value);
			keepFoot(key, input.value);
			fitWords(input);
		});
		input.addEventListener('blur', () => {
			commitTrailing(cell, input);
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
	const commitTrailing = (cell: LaneCell, input: HTMLTextAreaElement): void => {
		const timeId = cell.timeId;
		const words = input.value.trim();
		if (words.length === 0 || deps.readOnly()) return;
		const key = footKey(cell.timelineId, timeId);
		input.value = '';
		keepFoot(key, '');
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
		// A write that threw has had its say already, through the queue.
		let outcome: 'written' | 'unwritten' | 'threw' = 'threw';
		holdFootWrite(key, 1);
		void enqueue(async () => {
			const id = await deps.bridge().addRow(timelineId, timeId, words, null);
			outcome = id === null ? 'unwritten' : 'written';
		}).then(() => {
			holdFootWrite(key, -1);
			pending.el.remove();
			cell.pending = cell.pending.filter((candidate) => candidate !== pending);
			const written = outcome === 'written';
			if (written) {
				// Every paint since this write went out has left the cell's foot
				// alone, the write being the one to give its words back. It has
				// none to give back, but the foot may have been written in again
				// while it was away, and the lane may have gone under those
				// words meanwhile: they are looked at now, once and by nobody
				// else.
				if (!deps.disposed() && deps.documentLanes() !== null) recoverHomelessFeet();
				return;
			}
			if (deps.disposed()) {
				recoverWords(deps.placeName(timelineId, timeId), words);
				return;
			}
			// The write's answer is the same for a project that refused it and for
			// a cell that has gone, and the words go a different way for each. The
			// read that followed the write is what can tell them apart, so what is
			// said waits for it, and says where the words really went.
			if (outcome === 'unwritten') {
				deps.notice(new Error(t(deps.cellStands(timelineId, timeId) ? 'timeline.subrow.refused' : deps.words.addGone)));
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
				// Check at delivery: unload can start between a refusal and
				// this microtask. The words remain recoverable without a dialog
				// belonging to a plugin that has gone.
				if (deps.unloading()) {
					for (const draft of drafts) {
						console.error('Snowflake: sub-description words could not be written', draft);
					}
					return;
				}
				new TimelineDraftModal(app, t, drafts).open();
			});
		}
		recoveryDrafts.push({ place, words });
	};
	const placeOfRow = (timelineId: string, rowId: string): string => {
		const lane = deps.documentLanes()?.find((candidate) => candidate.id === timelineId);
		const time = lane?.times.find((candidate) => candidate.rows.some((row) => row.id === rowId));
		return deps.placeName(timelineId, time?.timeId ?? null);
	};

	const beginRowEdit = (cell: LaneCell, entry: SubrowEntry): void => {
		if (deps.readOnly() || entry.editing) return;
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
		if (deps.readOnly()) {
			// Nothing is asked of a project that cannot be written: the words
			// wait for the row's next edit, once it can be, or go to the
			// dialog when the workspace has gone.
			if (deps.disposed()) recoverWords(placeOfRow(timelineId, rowId), words);
			else rowDrafts.set(rowId, { timelineId, words });
			return;
		}
		rowPending.set(rowId, { generation, words });
		let outcome: 'written' | 'gone' | 'failed' = 'failed';
		void enqueue(async () => {
			const result = await deps.bridge().editRow(timelineId, rowId, words);
			if (result === 'absent') {
				outcome = 'gone';
				throw new Error(t(deps.words.editGone));
			}
			if (result !== 'written') throw new Error(t('timeline.subrow.editRefused'));
			outcome = 'written';
		}).then(() => {
			if (rowPending.get(rowId)?.generation === generation) rowPending.delete(rowId);
			if (outcome === 'written') rowWritten.set(rowId, Math.max(rowWritten.get(rowId) ?? 0, generation));
			if (rowEdits.get(rowId) !== generation || outcome === 'written') return;
			if (deps.disposed() || outcome === 'gone') {
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
	const commitRowEdit = (cell: LaneCell, entry: SubrowEntry, refocus: boolean): void => {
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
		dressLabel(entry, deps.readOnly() ? current : words);
		writeRowWords(cell.timelineId, entry.rowId, words);
	};

	/** The time a row stands under on its lane, as the lane is now. */
	const timeOfRow = (cell: LaneCell, rowId: string): TimelineTime | null => {
		const lane = deps.lanes().find((candidate) => candidate.id === cell.timelineId);
		return lane?.times.find((time) => time.rows.some((row) => row.id === rowId)) ?? null;
	};

	/** The stored row an entry stands for, from the lane as it is now. */
	const rowOfEntry = (cell: LaneCell, entry: SubrowEntry): TimelineRow | null => {
		const lane = deps.lanes().find((candidate) => candidate.id === cell.timelineId);
		for (const time of lane?.times ?? []) {
			const row = time.rows.find((candidate) => candidate.id === entry.rowId);
			if (row !== undefined) return row;
		}
		return null;
	};

	const openSubrowMenu = (cell: LaneCell, entry: SubrowEntry, event: MouseEvent): void => {
		const lane = deps.lanes().find((candidate) => candidate.id === cell.timelineId);
		const time = lane?.times.find((candidate) => candidate.rows.some((row) => row.id === entry.rowId));
		if (lane === undefined || time === undefined) return;
		const at = time.rows.findIndex((row) => row.id === entry.rowId);
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(deps.readOnly() || at <= 0)
				.onClick(() => {
					moveRowBy(lane, time, at, -1);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(deps.readOnly() || at === -1 || at >= time.rows.length - 1)
				.onClick(() => {
					moveRowBy(lane, time, at, 1);
				});
		});
		deps.subrowMenuItems?.(menu, lane, time, entry.rowId);
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.subrow.remove'))
				.setIcon('x')
				.setWarning(true)
				.setDisabled(deps.readOnly())
				.onClick(() => {
					void removeRow(lane, time, entry.rowId);
				});
		});
		menu.showAtMouseEvent(event);
	};

	/** A row one step up or down among its time's rows, before the neighbour that then follows it. */
	const moveRowBy = (lane: Lane, time: TimelineTime, at: number, step: -1 | 1): void => {
		const row = time.rows[at];
		if (row === undefined) return;
		const beforeId = step === -1 ? (time.rows[at - 1]?.id ?? null) : (time.rows[at + 2]?.id ?? null);
		void enqueue(async () => {
			await deps.bridge().moveRow(lane.id, row.id, time.timeId, beforeId);
		});
	};

	const removeRow = async (lane: Lane, time: TimelineTime, rowId: string): Promise<void> => {
		if (deps.disposed()) return;
		const row = time.rows.find((candidate) => candidate.id === rowId);
		if (row === undefined) return;
		if (row.scenes.length > 0) {
			const confirmed = await confirmTimelineAction(app, t, {
				title: t('timeline.subrow.removeTitle'),
				lines: [t('timeline.subrow.removeDescription', { count: row.scenes.length })],
				label: t('common.remove'),
			}, keep);
			if (!confirmed || deps.disposed()) return;
		}
		await enqueue(async () => {
			await deps.bridge().deleteRow(lane.id, rowId);
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
	const parkedSubrows = new Map<string, { cell: LaneCell; entry: SubrowEntry }>();
	const parkKey = (timelineId: string, rowId: string): string => joinKey(timelineId, rowId);

	const unmountSubrow = (cell: LaneCell, rowId: string): void => {
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
	const adoptSubrow = (cell: LaneCell, rowId: string): SubrowEntry | null => {
		const rows = cell.rows;
		if (rows === null) return null;
		const key = parkKey(cell.timelineId, rowId);
		let entry = parkedSubrows.get(key)?.entry ?? null;
		if (entry !== null) {
			parkedSubrows.delete(key);
		} else {
			for (const holder of laneCells.values()) {
				if (holder.timelineId !== cell.timelineId || holder === cell) continue;
				const held = holder.subrows.get(rowId);
				if (held === undefined) continue;
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
			if (!ground.contains(card.el)) takeDown(key);
		}
	};

	/** The label's words: the text given, or a stand-in for none. */
	const dressLabel = (entry: SubrowEntry, text: string): void => {
		const words = text.trim();
		const shown = words.length > 0 ? text : t('timeline.subrow.empty');
		if (entry.label.textContent !== shown) entry.label.setText(shown);
		entry.label.toggleClass('is-empty', words.length === 0);
	};

	const dressSubrow = (cell: LaneCell, entry: SubrowEntry, row: TimelineRow, lane: Lane): void => {
		// An edit in flight keeps its input and its words; the paint dresses around it.
		if (!entry.editing) dressLabel(entry, row.text);
		entry.label.disabled = deps.readOnly();
		entry.input.readOnly = deps.readOnly();
		entry.more.disabled = deps.readOnly();
		entry.handle.setAttribute('draggable', deps.readOnly() ? 'false' : 'true');
		entry.handle.disabled = deps.readOnly();
		paintPlacements(cell, entry, row, lane);
	};

	const paintSubrows = (cell: LaneCell, time: TimelineTime, lane: Lane): void => {
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

	const buildMissing = (entry: SubrowEntry, lane: Lane, sceneId: string, parent: HTMLElement = entry.scenes): HTMLElement => {
		const el = parent.createDiv({
			cls: 'snowflake-method-timeline-scene-missing',
			attr: { 'data-key': cardKey(entry.rowId, sceneId), role: 'listitem' },
		});
		el.createSpan({ text: t('timeline.scene.missing') });
		const remove = el.createEl('button', {
			cls: 'clickable-icon snowflake-method-timeline-scene-missing-remove',
			attr: { type: 'button', 'aria-label': t(deps.words.sceneRemove) },
		});
		setIcon(remove, 'x');
		setTooltip(remove, t(deps.words.sceneRemove));
		remove.addEventListener('click', () => {
			void enqueue(async () => {
				await deps.bridge().removeScene(lane.id, sceneId);
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
		if (remove !== null) remove.disabled = deps.readOnly();
	};

	/** The element standing for a key on a sub-row: a card of the deck, or a missing stand-in. */
	const placementEl = (entry: SubrowEntry, key: string): HTMLElement | undefined =>
		deck.cards.get(key)?.el ?? entry.missing.get(sceneOfKey(key));

	const paintPlacements = (cell: LaneCell, entry: SubrowEntry, row: TimelineRow, lane: Lane): void => {
		if (deps.presentation() === 'stack') {
			paintStack(cell, entry, row, lane);
			return;
		}
		if (entry.stack !== null) takeDownStack(entry, row.id);
		const keys = row.scenes.map((sceneId) => cardKey(row.id, sceneId));
		const standing = [...deck.cards.keys()].filter((key) => key.startsWith(keyPrefix(row.id)));
		const wantedCards = row.scenes
			.filter((sceneId) => deps.scenesById().has(sceneId))
			.map((sceneId) => cardKey(row.id, sceneId));
		const plan = planCardRepaint(standing, wantedCards, []);
		for (const key of plan.remove) takeDown(key);
		for (const [sceneId, el] of entry.missing) {
			if (!row.scenes.includes(sceneId) || deps.scenesById().has(sceneId)) {
				el.remove();
				entry.missing.delete(sceneId);
			}
		}
		row.scenes.forEach((sceneId, at) => {
			const key = cardKey(row.id, sceneId);
			const scene = deps.scenesById().get(sceneId);
			if (scene === undefined) {
				const standing = entry.missing.get(sceneId);
				if (standing === undefined) entry.missing.set(sceneId, buildMissing(entry, lane, sceneId));
				else dressMissing(standing);
				return;
			}
			const index = deps.sceneIndex().get(sceneId) ?? 0;
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

	const buildStack = (cell: LaneCell, entry: SubrowEntry): StackEntry => {
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
			if (row === null || lane === null) return;
			const key = deps.stackKey(lane.id, row.id);
			if (key === null) return;
			const at = clampStackPosition(deps.stackPositions().get(key), row.scenes.length);
			deps.stackPositions().set(key, clampStackPosition(step(at, row.scenes.length), row.scenes.length));
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
	const paintStack = (cell: LaneCell, entry: SubrowEntry, row: TimelineRow, lane: Lane): void => {
		let stack = entry.stack;
		if (stack === null) {
			// The cards dealt flat come down; the stack deals one of them again.
			for (const key of cardsWithin(row.id, entry.el)) takeDown(key);
			for (const el of entry.missing.values()) el.remove();
			entry.missing.clear();
			stack = buildStack(cell, entry);
			entry.stack = stack;
		}
		const total = row.scenes.length;
		const key = deps.stackKey(lane.id, row.id);
		const remembered = key === null ? undefined : deps.stackPositions().get(key);
		const at = clampStackPosition(remembered, total);
		if (key !== null && remembered !== at) deps.stackPositions().set(key, at);
		const shownId = row.scenes[at];
		const shownScene = shownId === undefined ? undefined : deps.scenesById().get(shownId);
		// The card in front is wanted only while its scene stands. One whose
		// scene the project no longer has comes down with the rest, its words
		// settled or shown for keeping, and the stand-in takes its place rather
		// than standing beside it.
		const wantedKey = shownScene === undefined || shownId === undefined ? null : cardKey(row.id, shownId);
		for (const standing of [...deck.cards.keys()]) {
			if (standing.startsWith(keyPrefix(row.id)) && standing !== wantedKey) takeDown(standing);
		}
		for (const [sceneId, el] of entry.missing) {
			if (sceneId !== shownId || deps.scenesById().has(sceneId)) {
				el.remove();
				entry.missing.delete(sceneId);
			}
		}
		if (shownId !== undefined) {
			if (shownScene === undefined) {
				const standing = entry.missing.get(shownId);
				if (standing === undefined) entry.missing.set(shownId, buildMissing(entry, lane, shownId, stack.face));
				else dressMissing(standing);
			} else {
				const wanted = cardKey(row.id, shownId);
				const index = deps.sceneIndex().get(shownId) ?? 0;
				let card = deck.cards.get(wanted);
				if (card === undefined) {
					card = deck.mount(stack.face, wanted, shownScene, index);
					wireCardDrag(card, row.id);
				} else if (!stack.face.contains(card.el)) {
					// The row came from another time: its card in front comes over as it stands.
					stack.face.insertBefore(card.el, null);
				}
				deck.dress(card, shownScene, index, { position: at + 1, size: total });
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

	// -- Dragging the rows and the scenes -------------------------------------------

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
		const stateOf = (laneId: string): 'lane' | 'locked' | 'idle' => cellDragState(drag, laneId);
		for (const cell of laneCells.values()) {
			const state = stateOf(cell.timelineId);
			cell.el.toggleClass('is-drag-lane', state === 'lane');
			cell.el.toggleClass('is-locked-out', state === 'locked');
		}
		deps.dragPhase(stateOf);
	};

	/** The cells' half of a drag's end: the mark, the drag itself and what it had worked out. */
	const dragEnded = (): void => {
		clearMark();
		drag = null;
		rowLanding = null;
		sceneLanding = null;
		invalidateRects();
		root.removeClass('is-row-drag');
		root.removeClass('is-scene-drag');
	};

	/** A scene begins to move: the active lane is locked for the drag, and every other lane stands back. */
	const beginSceneDrag = (sceneId: string, source: { timelineId: string; rowId: string } | { pool: true }): void => {
		const activeId = deps.activeId();
		if (deps.readOnly() || activeId === null) return;
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
				deps.readOnly() || lane === null || lane.id !== deps.activeId() ||
				event.dataTransfer === null || pressWithin(event.target)
			) {
				event.preventDefault();
				return;
			}
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData(deps.dragTypes.scene, card.id);
			card.el.addClass('is-dragging');
			beginSceneDrag(card.id, { timelineId: lane.id, rowId });
		});
		card.el.addEventListener('dragend', () => {
			card.el.removeClass('is-dragging');
			deps.endDrag();
		});
	};

	/** The sub-row under the pointer, from the event's own target: a stored row, the trailing one, or none. */
	const subrowUnder = (
		cell: LaneCell,
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

	const sceneDragOver = (cell: LaneCell, event: DragEvent): void => {
		if (drag?.kind !== 'scene' || event.dataTransfer?.types.includes(deps.dragTypes.scene) !== true) return;
		event.preventDefault();
		if (drag.lockedTimelineId !== cell.timelineId || cell.rows === null) {
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
		if (deps.presentation() === 'stack') {
			if (!rowAcceptsScene(drag, under.entry.rowId, deps.presentation())) {
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
			deps.laneAxis(),
		);
		const before = candidates[at];
		const last = candidates[candidates.length - 1];
		if (before !== undefined) setMark(before.el, 'is-drop-before');
		else if (last !== undefined) setMark(last.el, 'is-drop-after');
		else setMark(under.entry.scenes, 'is-drop-target');
		sceneLanding = { cell, rowId: under.entry.rowId, beforeSceneId: before?.sceneId ?? null };
	};

	const sceneDrop = (cell: LaneCell, event: DragEvent): void => {
		const timeId = cell.timeId;
		const dragged = event.dataTransfer?.getData(deps.dragTypes.scene) ?? '';
		if (drag?.kind !== 'scene' || drag.sceneId !== dragged || drag.lockedTimelineId !== cell.timelineId) return;
		event.preventDefault();
		const landing = sceneLanding?.cell === cell ? sceneLanding : null;
		clearMark();
		if (landing === null) return;
		const timelineId = drag.lockedTimelineId;
		const sceneId = drag.sceneId;
		void enqueue(async () => {
			const bridge = deps.bridge();
			if (landing.rowId === null) await bridge.addRow(timelineId, timeId, '', null, [sceneId]);
			else await bridge.placeScene(timelineId, sceneId, landing.rowId, landing.beforeSceneId);
		});
	};

	// -- The cards' menu -----------------------------------------------------

	interface ScenePlacementTarget extends MoveAfterEntry {
		timeId: string;
		rowId: string | null;
	}

	/** Each stored row, and a new row of its own at every time, as a drop offers. */
	const placementTargets = (lane: Lane): ScenePlacementTarget[] => {
		const entries: ScenePlacementTarget[] = [];
		for (const time of lane.times) {
			for (const row of time.rows) {
				entries.push({
					id: `row:${row.id}`, index: entries.length, timeId: time.timeId, rowId: row.id,
					label: `${deps.placeName(lane.id, time.timeId)} / ${row.text.trim() || t('timeline.subrow.empty')}`,
				});
			}
			entries.push({
				id: `time:${time.timeId}`, index: entries.length, timeId: time.timeId, rowId: null,
				label: `${deps.placeName(lane.id, time.timeId)} / ${t('timeline.scene.placeNewRow')}`,
			});
		}
		return entries;
	};

	const placeSceneByMenu = (scope: SceneScope<Reading>): void => {
		const lane = scope.lane();
		if (lane === null || lane.times.length === 0) return;
		const targets = placementTargets(lane);
		const modal = keep(new MoveAfterModal(app, t, targets, (picked) => {
			const target = targets.find((candidate) => candidate.id === picked.id);
			if (target === undefined || scope.lane() === null) return;
			void enqueue(async () => {
				if (scope.lane() === null) return;
				const bridge = deps.bridge();
				const current = scope.lane(await bridge.read());
				const time = current?.times.find((candidate) => candidate.timeId === target.timeId);
				if (time === undefined || (target.rowId !== null && !time.rows.some((row) => row.id === target.rowId))) return;
				if (target.rowId === null) await bridge.addRow(scope.laneId, target.timeId, '', null, [scope.sceneId]);
				else await bridge.placeScene(scope.laneId, scope.sceneId, target.rowId, null);
			});
		}));
		modal.setPlaceholder(t('timeline.scene.moveTo'));
		modal.open();
	};

	/** Resolve neighbours when the queued action runs, after any earlier move has landed. */
	const moveSceneByMenu = (scope: SceneScope<Reading>, direction: -1 | 1): void => {
		if (scope.lane() === null) return;
		void enqueue(async () => {
			if (scope.lane() === null) return;
			const bridge = deps.bridge();
			const lane = scope.lane(await bridge.read());
			const row = lane?.times.flatMap((time) => time.rows).find((candidate) => candidate.id === scope.rowId);
			const at = row?.scenes.indexOf(scope.sceneId) ?? -1;
			if (row === undefined || at < 0 || at + direction < 0 || at + direction >= row.scenes.length) return;
			const beforeSceneId = row.scenes[direction === -1 ? at - 1 : at + 2] ?? null;
			await bridge.placeScene(scope.laneId, scope.sceneId, row.id, beforeSceneId);
		});
	};

	/** The pool and lane cards share one placement picker and one pair of bridge writes. */
	const addScenePlacementMenuItem = (sceneId: string, rowId: string | null, menu: Menu): void => {
		const scope = deps.sceneScope(sceneId, rowId);
		const lane = scope === null ? null : scope.lane();
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.scene.moveTo'))
				.setIcon('corner-down-right')
				.setDisabled(lane === null || lane.times.length === 0)
				.onClick(() => {
					if (scope !== null) placeSceneByMenu(scope);
				});
		});
	};

	const openCardMenu = (card: SceneCard, event: MouseEvent): void => {
		const path = deps.projectPath();
		const rowId = rowOfKey(card.key);
		const lane = laneOfRow(rowId);
		const row = lane?.times.flatMap((time) => time.rows).find((candidate) => candidate.id === rowId);
		const at = row?.scenes.indexOf(card.id) ?? -1;
		const scope = deps.sceneScope(card.id, rowId);
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
				.setTitle(t('actions.moveUp'))
				.setIcon('arrow-up')
				.setDisabled(scope === null || at <= 0)
				.onClick(() => {
					if (scope !== null) moveSceneByMenu(scope, -1);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.moveDown'))
				.setIcon('arrow-down')
				.setDisabled(scope === null || row === undefined || at < 0 || at >= row.scenes.length - 1)
				.onClick(() => {
					if (scope !== null) moveSceneByMenu(scope, 1);
				});
		});
		addScenePlacementMenuItem(card.id, rowId, menu);
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t(deps.words.sceneRemove))
				.setIcon('x')
				.setDisabled(deps.readOnly() || lane === null)
				.onClick(() => {
					if (lane === null) return;
					void enqueue(async () => {
						await deps.bridge().removeScene(lane.id, card.id);
					});
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('actions.delete'))
				.setIcon('trash-2')
				.setWarning(true)
				.setDisabled(deps.readOnly() || card.scene.readOnly || path === null)
				.onClick(() => {
					if (path === null) return;
					void deck.enqueue(() => host.deleteScene(card.id, card.scene.revision, path), { persist: true });
				});
		});
		menu.showAtMouseEvent(event);
	};

	return {
		mountCell,
		dressCell: dressLaneCell,
		unmountCell: unmountLaneCell,
		recoverHomelessFeet,
		sweep: () => {
			sweepParked();
			sweepCards();
		},
		dragging: () => drag !== null,
		setMark,
		clearMark,
		invalidateRects,
		paintDragPhase,
		dragEnded,
		// A pool card leaves under the workspace's type and locks the active
		// lane; a lane's card dropped back on the pool gives up its place.
		poolVariant: () => ({
			menuItems: (sceneId, menu) => { addScenePlacementMenuItem(sceneId, null, menu); },
			dragOut: {
				type: deps.dragTypes.scene,
				onStart: (sceneId) => {
					beginSceneDrag(sceneId, { pool: true });
				},
				onEnd: deps.endDrag,
			},
			dropIn: {
				accepts: (types) =>
					types.includes(deps.dragTypes.scene) && drag?.kind === 'scene' && !('pool' in drag.source),
				onDrop: () => {
					if (drag?.kind !== 'scene' || 'pool' in drag.source) return;
					const { lockedTimelineId, sceneId } = drag;
					void enqueue(async () => {
						await deps.bridge().removeScene(lockedTimelineId, sceneId);
					});
				},
			},
		}),
		// A card drags from the active lane alone; in a single lane that is every card.
		dragAllowed: (card) => !deps.readOnly() && laneOfRow(rowOfKey(card.key))?.id === deps.activeId(),
		openCardMenu,
		settle: () => {
			// Words still being written go the way a leave sends them, without
			// waiting on a blur the host may not send: an open edit of a row,
			// the words kept from a row's write that failed, tried once more,
			// and whatever stands at a cell's foot, shown or kept.
			for (const cell of laneCells.values()) {
				for (const entry of cell.subrows.values()) {
					if (entry.editing) commitRowEdit(cell, entry, false);
				}
			}
			for (const [rowId, draft] of [...rowDrafts]) {
				rowDrafts.delete(rowId);
				writeRowWords(draft.timelineId, rowId, draft.words);
			}
			// Words a composition held back are the cell's as much as those in
			// its input, and go the same way, ahead of them.
			for (const [key, kept] of [...withheldFeet]) {
				withheldFeet.delete(key);
				keepFoot(key, mergeWords(kept, footWords.get(key) ?? ''));
			}
			for (const [key, words] of [...footWords]) {
				footWords.delete(key);
				const [timelineId, timeId] = splitKey(key) as [string, string];
				const trimmed = words.trim();
				if (trimmed.length === 0) continue;
				if (deps.readOnly()) {
					recoverWords(deps.placeName(timelineId, timeId), trimmed);
					continue;
				}
				let written = false;
				void enqueue(async () => {
					const id = await deps.bridge().addRow(timelineId, timeId, trimmed, null);
					if (id === null) throw new Error(t('timeline.subrow.refused'));
					written = true;
				}).then(() => {
					if (!written) recoverWords(deps.placeName(timelineId, timeId), trimmed);
				});
			}
		},
	};
}
