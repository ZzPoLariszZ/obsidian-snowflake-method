/**
 * The freeform workspace: a plane the project's resources are set out on,
 * one view at a time of the several a project may keep. A view keeps where
 * things stand and never what they are, so what a node shows is read from
 * the project as it is painted, and a change made here moves, sizes, adds or
 * removes a node and touches no note.
 *
 * The plane itself is the engine's (`freeform-canvas.ts`), handed in so a
 * test stands a plain one in its place; what stands in a node's box is the
 * faces' (`freeform-faces.ts`), and a scene's face is the corkboard's own
 * card, dealt from a deck of the workspace's; the read, the queue and the
 * paint's gate are the loop's (`document-loop.ts`), shared with the timeline
 * and the beat sheet; what was done, kept to be taken back, is the
 * history's (`freeform-history.ts`). This is what is left: the toolbar, the
 * canvas's controls, the menus, the forms, what each kind of node opens,
 * and the one way every change goes to the file and into the history.
 *
 * A change is shown the moment it is made and written after: the view as
 * the canvas shows it is the view as its file has it with every change still
 * on its way made to it, so a node dropped stays where it was dropped while
 * its write is in flight, and goes back only if the file would not take it.
 * Taking a change back is one more change, written the same way.
 */

import { Keymap, Menu, Notice, SearchComponent, setIcon } from 'obsidian';

import {
	DEFAULT_FREEFORM_VIEWPORT,
	FREEFORM_FRAME_HEAD,
	FREEFORM_FRAME_PADDING,
	FREEFORM_SIZE,
	FREEFORM_ZOOM,
	applyFreeformSteps,
	copyFreeformSelection,
	findFreeformEdge,
	findFreeformFrame,
	findFreeformPlacement,
	findFreeformView,
	freeformBounds,
	freeformClipSteps,
	freeformPlacedFilePaths,
	freeformPlacedTypes,
	freeformRoom,
	isWorldbuildingKind,
	leaveFreeformView,
	shownFreeformViewId,
	type FreeformCame,
	type FreeformClip,
	type FreeformDisplayMode,
	type FreeformFrame,
	type FreeformPlace,
	type FreeformPlacement,
	type FreeformPlacementDraft,
	type FreeformRecordType,
	type FreeformSide,
	type FreeformStep,
	type FreeformView,
} from '../domain';
import { createDocumentLoop, type DocumentLoop } from './document-loop';
import type { FreeformBridge, FreeformHandle, FreeformReading, RenderFreeform } from './freeform-bridge';
import { zoomPercent, zoomStep } from './freeform-canvas-model';
import {
	NO_CANVAS_SELECTION,
	type CanvasMenuTarget,
	type CanvasPoint,
	type CanvasPort,
	type CanvasSelection,
} from './freeform-canvas-port';
import { freeformClipSize, readFreeformClip, writeFreeformClip } from './freeform-clipboard';
import { createFreeformFaces } from './freeform-faces';
import {
	FreeformEdgeFormModal,
	FreeformFrameFormModal,
	FreeformGeometryModal,
	FreeformLinkFormModal,
	FreeformNodeFormModal,
	FreeformTextModal,
	FreeformViewFormModal,
	type FreeformFrameDraft,
	type FreeformLinkDraft,
	type FreeformNodeCandidate,
	type FreeformNodeType,
	type RecoveredFreeformText,
} from './freeform-forms';
import {
	EMPTY_FREEFORM_HISTORY,
	answerFreeformChange,
	recordFreeformChange,
	takeFreeformRedo,
	takeFreeformUndo,
	type FreeformHistory,
	type FreeformHistoryTurn,
} from './freeform-history';
import {
	EMPTY_FREEFORM_SCENE,
	FREEFORM_FACE_MODES,
	FREEFORM_FACE_MODES_OF,
	FREEFORM_GRID,
	FREEFORM_NODE_MIN,
	cascadeStep,
	cornersOf,
	faceKindOf,
	heightForMode,
	landingHeightOf,
	grownHeight,
	laidOutAlike,
	landingAt,
	landingsAt,
	ownWordsCount,
	placeStepOf,
	plainFirstLine,
	sceneOf,
	searchFreeformScene,
	type FreeformSceneMade,
	type FreeformSceneWords,
} from './freeform-layout';
import {
	freeformFileKind,
	freeformFileName,
	freeformLabelOf,
	resolvePlacement,
	type FreeformResources,
	type ResolvedNode,
} from './freeform-resources';
import type { ForeshadowingOccurrenceRow, ForeshadowingTableItem } from './foreshadowing-rows';
import { kindIcon } from './kind-icon';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';
import { renderEmptyLine } from './pane-parts';
import { TimelineTimePickModal, confirmTimelineAction } from './timeline-forms';
import { kindEntities, type ProjectDashboardModel } from './view-model';
import { bindFrameWindow, createLaneDeck, createMenuKeeper, createModalKeeper, toolbarIconButton } from './workspace-frame';

/** How many of a text node's first words it is called by, for a reader that cannot see it. */
const NAME_LENGTH = 80;

/** How long the search waits after a keystroke before the view is marked for it, as the corkboard's does. */
const SEARCH_DEBOUNCE_MS = 150;

/** Where a press is the field's own: words being written, a choice from a list. */
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/** A change on its way to the file, shown on the canvas meanwhile. */
interface Pending {
	viewId: string;
	steps: readonly FreeformStep[];
	/**
	 * The view as its file had it when the write landed; nothing while the
	 * write is in flight. Once the file is read as anything else, the change
	 * is the file's own and is made to it no more.
	 */
	landedOn: FreeformView | null | undefined;
}

/** Every canvas is named apart, so two in two leaves share no pattern and no marker. */
let mounted = 0;

export const renderFreeform: RenderFreeform = (container, controls) => {
	const { app, host, t, memory } = controls;
	// The cards a scene stands as are the corkboard's, dressed by the same sheet.
	const root = container.createDiv({ cls: 'snowflake-method-prose-panel snowflake-method-freeform snowflake-method-scene-cards' });

	const notice = (error: unknown): void => {
		new Notice(error instanceof Error ? error.message : t('errors.unknown'));
	};

	// -- The toolbar ---------------------------------------------------------

	const toolbar = root.createDiv({
		cls: 'snowflake-method-freeform-toolbar',
		attr: { role: 'toolbar', 'aria-label': t('freeformCanvas.toolbar') },
	});
	// The view is typed into, searched and picked from, as the timeline's is.
	const viewHost = toolbar.createDiv({ cls: 'snowflake-method-freeform-view-select' });
	const editViewButton = toolbarIconButton(toolbar, 'snowflake-method-freeform-view-edit', 'pencil', t('timeline.view.edit'));
	editViewButton.addEventListener('click', () => {
		openEditView();
	});
	// The search marks what it finds and dims the rest; Enter brings the found
	// into sight one by one, Escape lets the search go.
	const searchHost = toolbar.createDiv({ cls: 'snowflake-method-freeform-search' });
	const search = new SearchComponent(searchHost);
	search.setPlaceholder(t('freeformCanvas.search'));
	const searchCount = searchHost.createSpan({ cls: 'snowflake-method-freeform-search-count', attr: { 'aria-live': 'polite' } });
	let searchTimer: number | null = null;
	let searchWindow = root.win;
	search.onChange((next) => {
		if (searchTimer !== null) searchWindow.clearTimeout(searchTimer);
		searchWindow = root.win;
		searchTimer = searchWindow.setTimeout(() => {
			searchTimer = null;
			setQuery(next);
		}, SEARCH_DEBOUNCE_MS);
	});
	search.inputEl.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			// Words typed and not yet marked are marked now, so the step lands on what was asked for.
			if (searchTimer !== null) {
				searchWindow.clearTimeout(searchTimer);
				searchTimer = null;
				setQuery(search.getValue());
			}
			stepSearch(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			// A search standing is let go first; the field is left once it stands empty.
			if (search.getValue().length > 0) {
				search.setValue('');
				setQuery('');
			} else {
				search.inputEl.blur();
				canvas.focus();
			}
		}
	});
	const refreshButton = toolbarIconButton(toolbar, 'snowflake-method-freeform-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().then(() => reload()).catch(notice);
	});
	// The two words carry a symbol each, which is all that shows of them where
	// the toolbar is too narrow for the words; the words stay their names.
	const wordWithSymbol = (cls: string, icon: string, words: string): HTMLButtonElement => {
		const button = toolbar.createEl('button', { cls: `mod-cta ${cls}`, attr: { type: 'button', 'aria-label': words } });
		setIcon(button.createSpan({ cls: 'snowflake-method-freeform-word-symbol' }), icon);
		button.createSpan({ cls: 'snowflake-method-freeform-word', text: words });
		return button;
	};
	const addViewButton = wordWithSymbol('snowflake-method-freeform-view-add', 'layout-dashboard', t('timeline.view.add'));
	addViewButton.addEventListener('click', () => {
		openAddView();
	});
	const addNodeButton = wordWithSymbol('snowflake-method-freeform-node-add', 'plus', t('freeformCanvas.node.add'));
	addNodeButton.addEventListener('click', () => {
		openAddNode();
	});

	// -- The stage: the canvas, the word said of an empty one, and its controls --

	const empty = renderEmptyLine(root, '');
	const stage = root.createDiv({ cls: 'snowflake-method-freeform-stage is-hidden' });
	const ground = stage.createDiv({ cls: 'snowflake-method-freeform-ground' });
	const hint = stage.createDiv({ cls: 'snowflake-method-freeform-hint is-hidden' });
	const hintLine = renderEmptyLine(hint, t('freeformCanvas.empty.nodes'));
	const panel = stage.createDiv({
		cls: 'snowflake-method-freeform-controls',
		attr: { role: 'toolbar', 'aria-label': t('freeformCanvas.controls') },
	});
	// Touch has no key to hold, so a drag on the ground is told here to draw a
	// box; with a mouse the switch is the same choice made without the key.
	const selectButton = toolbarIconButton(panel, 'snowflake-method-freeform-select', 'box-select', t('freeformCanvas.select.box'));
	selectButton.setAttribute('aria-pressed', 'false');
	selectButton.addEventListener('click', () => {
		dragDraws = !dragDraws;
		selectButton.setAttribute('aria-pressed', dragDraws ? 'true' : 'false');
		canvas.setInteraction({ ground: dragDraws ? 'select' : 'pan' });
	});
	const undoButton = toolbarIconButton(panel, 'snowflake-method-freeform-undo', 'undo-2', t('freeformCanvas.undo'));
	undoButton.addEventListener('click', () => {
		undo();
	});
	const redoButton = toolbarIconButton(panel, 'snowflake-method-freeform-redo', 'redo-2', t('freeformCanvas.redo'));
	redoButton.addEventListener('click', () => {
		redo();
	});
	const zoomOutButton = toolbarIconButton(panel, 'snowflake-method-freeform-zoom-out', 'minus', t('freeformCanvas.zoom.out'));
	zoomOutButton.addEventListener('click', () => {
		canvas.moveViewport({ kind: 'step', direction: 'out' });
	});
	const zoomLevel = panel.createSpan({ cls: 'snowflake-method-freeform-zoom-level' });
	const zoomInButton = toolbarIconButton(panel, 'snowflake-method-freeform-zoom-in', 'plus', t('freeformCanvas.zoom.in'));
	zoomInButton.addEventListener('click', () => {
		canvas.moveViewport({ kind: 'step', direction: 'in' });
	});
	const wordButton = (cls: string, words: string, label: string): HTMLButtonElement => {
		const button = panel.createEl('button', {
			cls: `snowflake-method-freeform-control ${cls}`,
			text: words,
			attr: { type: 'button', 'aria-label': label },
		});
		return button;
	};
	const fitButton = wordButton('snowflake-method-freeform-fit', t('freeformCanvas.fit'), t('freeformCanvas.fit.all'));
	fitButton.addEventListener('click', () => {
		fitAll();
	});
	const resetButton = wordButton('snowflake-method-freeform-reset', t('freeformCanvas.reset'), t('freeformCanvas.reset.viewport'));
	resetButton.addEventListener('click', () => {
		resetViewport();
	});
	// The minimap stands in the canvas's far corner when asked for, and this button, laid over its corner, puts it away.
	const minimapButton = toolbarIconButton(stage, 'snowflake-method-freeform-minimap-collapse', 'minimize-2', t('freeformCanvas.minimap.collapse'));
	minimapButton.addEventListener('click', () => {
		setMinimap(false);
	});
	const paintMinimap = (): void => {
		minimapButton.toggleClass('is-hidden', !memory.minimap);
	};
	paintMinimap();

	const showEmpty = (text: string | null): void => {
		empty.line.toggleClass('is-hidden', text === null);
		stage.toggleClass('is-hidden', text !== null);
		root.toggleClass('is-empty', text !== null);
		if (text !== null) empty.text.setText(text);
	};

	// -- State ---------------------------------------------------------------

	let reading: FreeformReading | null = null;
	let loadFailed = false;
	/** The engine could not be raised, or fell over while it drew: the canvas has nothing to show on. */
	let engineFailed = false;
	let model: ProjectDashboardModel | null = null;
	let readOnly = true;
	/** The view the tab is to show: the one picked, until a reading says it has gone. */
	let viewId: string | null = memory.viewId;
	/** What the tab was last told to remember, so a view named from outside, by a layout restored, is told apart. */
	let remembered: string | null = memory.viewId;
	/**
	 * A view this workspace has just made, until a read brings back the
	 * document that holds it; a paint in between must not take its absence
	 * there for a pick that has gone.
	 */
	let awaitedViewId: string | null = null;
	/** The view the canvas was last laid out for; every change made on the canvas is that view's. */
	let shownViewId: string | null = null;
	let selection: CanvasSelection = NO_CANVAS_SELECTION;
	/** The node being typed into. */
	let editingId: string | null = null;
	/** A text node made and not yet written: one left with no words in it never is. */
	let draft: { viewId: string; placement: FreeformPlacement } | null = null;
	/** Whether a drag on the ground draws a box rather than moves the plane. */
	let dragDraws = false;
	/** The words searched for on the view on show; nothing marks nothing. */
	let query = '';
	/** The nodes the search found, in reading order, and the one of them last brought into sight. */
	let hits: string[] = [];
	let hitId: string | null = null;
	const pending: Pending[] = [];
	/**
	 * What was done to each view here, kept to be taken back: the tab's own,
	 * and gone with it. A view deleted takes its own with it.
	 */
	const histories = new Map<string, FreeformHistory>();
	/** The view last worked out for the canvas, kept while neither its file nor what is on its way moves. */
	let standing: { id: string; file: FreeformView; turn: number; view: FreeformView } | null = null;
	let turn = 0;
	/** What the canvas was last told stands on it. */
	let made: FreeformSceneMade | null = null;
	/**
	 * The records and files the view on show places, read through the
	 * bridge: each family only when a view places one of it, again when the
	 * project is read again or a family rings, and once more where a view
	 * comes to place a family not yet read.
	 */
	let resources: FreeformResources | null = null;
	let resourcesKey = '';
	let resourcesSerial = 0;
	let optionsSignature = '';
	let viewField: OptionPicker | null = null;
	let disposed = false;
	/** Forms belong to this workspace, and the menus it opened; recovered words deliberately outlive it. */
	const modals = createModalKeeper();
	const menus = createMenuKeeper();
	const { keep } = modals;

	// -- Reading -------------------------------------------------------------

	const loop: DocumentLoop = createDocumentLoop<FreeformReading, ProjectDashboardModel>({
		source: () => controls.bridge(),
		taken: (next, failed) => {
			// What was done in one project is nothing to take back in another.
			if (next !== null && reading !== null && next.projectPath !== reading.projectPath) {
				histories.clear();
				paintHistory();
			}
			reading = next;
			if (next !== null && awaitedViewId !== null && findFreeformView(next.held, awaitedViewId) !== undefined) {
				viewId = awaitedViewId;
				awaitedViewId = null;
			}
			loadFailed = failed;
		},
		readFailed: (error) => {
			console.error('Snowflake: the freeform views could not be read', error);
		},
		held: () => reading?.held ?? null,
		alike: (painted, held) =>
			typeof painted === 'object' && painted !== null && typeof held === 'object' && held !== null &&
			laidOutAlike(painted as FreeformReading['held'], held as FreeformReading['held'], shownViewId),
		model: () => controls.model(),
		refreshModel: () => controls.refresh(),
		draw: (nextModel) => {
			draw(nextModel);
		},
		dragging: () => canvas.busy(),
		disposed: () => disposed,
		notice,
	});
	const { reload, enqueue } = loop;

	/** A view as its file has it now. */
	const fileView = (id: string): FreeformView | null =>
		reading === null ? null : (findFreeformView(reading.held, id) ?? null);

	/**
	 * A view as the canvas shows it: as its file has it, with every change
	 * still on its way made to it, in the order they were made. A change the
	 * view can no longer take is passed over; its write will say so.
	 */
	const standingView = (id: string): FreeformView | null => {
		const file = fileView(id);
		if (file === null || reading === null) return null;
		if (standing !== null && standing.id === id && standing.file === file && standing.turn === turn) {
			return standing.view;
		}
		let view = file;
		for (const entry of pending) {
			if (entry.viewId !== id) continue;
			if (entry.landedOn !== undefined && entry.landedOn !== file) continue;
			const taken = applyFreeformSteps(view, entry.steps, view.updatedAt, reading.limits);
			if (taken.came === 'written') view = taken.view;
		}
		standing = { id, file, turn, view };
		return view;
	};

	const shownView = (): FreeformView | null => (shownViewId === null ? null : standingView(shownViewId));

	// -- What a node is called, and what it wears -----------------------------

	const lastCalled = (placement: FreeformPlacement): string => {
		const { resource } = placement;
		if (resource.type === 'file') return freeformFileName(resource.path);
		if (resource.type === 'link') return resource.label;
		if (resource.type === 'text') return resource.text;
		return resource.name;
	};

	/** What a kind of note is called: the copy's word for a built-in, an authored kind its own name. */
	const kindWord = (kind: string): string => {
		if (kind === 'scene') return t('form.group.scene');
		if (kind === 'character') return t('form.group.character');
		return isWorldbuildingKind(kind) ? t(`worldbuilding.kind.${kind}`) : kind;
	};

	/** What a node is called, as its face shows it. */
	const nameOf = (node: ResolvedNode): string => {
		if (node.type === 'text') {
			const first = plainFirstLine(node.text, NAME_LENGTH);
			return first.length === 0 ? t('freeformCanvas.text.label') : first;
		}
		if (node.type === 'link') return node.label.length > 0 ? node.label : node.host;
		if (node.type === 'file') return node.file.name;
		if (node.type === 'missing') return node.name;
		if (node.type === 'pending') return lastCalled(node.placement);
		// A sticky note is called by its first words as they read, not as they are marked; a revision by the first line of the words it changes.
		if (node.type === 'sticky-note') {
			const first = plainFirstLine(node.note.body, NAME_LENGTH);
			return first.length === 0 ? t('freeformCanvas.type.stickyNote') : first;
		}
		if (node.type === 'revision') {
			const words = node.row.original.length > 0 ? node.row.original : node.row.proposed;
			const first = plainFirstLine(words, NAME_LENGTH);
			return first.length === 0 ? node.row.title : first;
		}
		return freeformLabelOf(node)?.name ?? lastCalled(node.placement);
	};

	/** What a node is called for a reader that cannot see it: a note or a record with the kind of thing it is. */
	const labelOf = (node: ResolvedNode): string => {
		const name = nameOf(node);
		if (node.type === 'scene' || node.type === 'character') return t('freeformCanvas.node.name', { kind: kindWord(node.type), name });
		if (node.type === 'worldbuilding') return t('freeformCanvas.node.name', { kind: kindWord(node.entity.kind), name });
		if (node.type === 'task') return t('freeformCanvas.node.name', { kind: t('freeformCanvas.type.task'), name });
		if (node.type === 'foreshadowing') return t('freeformCanvas.node.name', { kind: t('freeformCanvas.type.foreshadowing'), name });
		if (node.type === 'revision') return t('freeformCanvas.node.name', { kind: t('freeformCanvas.type.revision'), name });
		if (node.type === 'sticky-note') return t('freeformCanvas.node.name', { kind: t('freeformCanvas.type.stickyNote'), name });
		if (node.type === 'file') return t('freeformCanvas.node.name', { kind: t('freeformCanvas.type.file'), name });
		if (node.type === 'link') return t('freeformCanvas.node.name', { kind: t('freeformCanvas.type.link'), name });
		return name;
	};

	const frameLabelOf = (frame: FreeformFrame): string =>
		frame.title.trim().length > 0 ? frame.title : t('freeformCanvas.frame.untitled');

	/** The symbol a node wears until the stage that gives its kind a face of its own. */
	const iconOf = (node: ResolvedNode): string => {
		const kinds = model ?? { worldbuildingKinds: [] };
		switch (node.type) {
			case 'scene':
				return kindIcon(kinds, 'scene');
			case 'character':
				return kindIcon(kinds, 'character');
			case 'worldbuilding':
				return kindIcon(kinds, node.entity.kind);
			case 'task':
				return 'list-todo';
			case 'foreshadowing':
				return 'waypoints';
			case 'revision':
				return 'file-diff';
			case 'sticky-note':
				return 'sticker';
			case 'file':
				return 'file';
			case 'link':
				return 'link';
			case 'text':
				return 'type';
			case 'pending':
				return 'loader';
			case 'missing':
				return 'triangle-alert';
		}
	};

	/**
	 * All a record's face shows of it, as one string, worked out once per
	 * record the model holds: a face is dressed again when this moves, and
	 * every paint asks for it.
	 */
	const signatures = new WeakMap<object, string>();
	const signatureOf = (record: object): string => {
		let signature = signatures.get(record);
		if (signature === undefined) {
			signature = JSON.stringify(record);
			signatures.set(record, signature);
		}
		return signature;
	};
	const recordOf = (node: ResolvedNode): object | null => {
		switch (node.type) {
			case 'scene':
				return node.scene;
			case 'character':
				return node.character;
			case 'worldbuilding':
				return node.entity;
			case 'task':
				return node.task;
			case 'foreshadowing':
				return node.item;
			case 'revision':
				return node.row;
			case 'sticky-note':
				return node.note;
			case 'file':
				return node.file;
			default:
				return null;
		}
	};

	const words: FreeformSceneWords = {
		resolve: (placement) => {
			// A paint is made only once a model stands; the guard is the type's.
			if (model === null) return { type: 'pending', placement, of: 'file' };
			return resolvePlacement(placement, model, resources);
		},
		label: labelOf,
		frameLabel: frameLabelOf,
		edgeName: (from, to) => t('freeformCanvas.edge.name', { from, to }),
		revision: (node) => {
			if (node.type === 'text') return `${node.placement.displayMode}\n${node.text}`;
			const record = recordOf(node);
			return `${node.type}\n${node.placement.displayMode}\n${iconOf(node)}\n${labelOf(node)}\n${record === null ? '' : signatureOf(record)}`;
		},
		locked: (id) => id === editingId,
		// A line may be drawn from node to node wherever the project can be written.
		get connectable(): boolean {
			return !readOnly;
		},
	};

	// -- Painting ------------------------------------------------------------

	const paintOptions = (views: readonly FreeformView[]): void => {
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

	const paintZoom = (zoom: number): void => {
		const percent = String(zoomPercent(zoom));
		const shown = `${percent}%`;
		if (zoomLevel.textContent !== shown) {
			zoomLevel.setText(shown);
			zoomLevel.setAttribute('aria-label', t('freeformCanvas.zoom.level', { percent }));
		}
		zoomInButton.disabled = zoomStep(zoom, 'in', FREEFORM_ZOOM) === zoom;
		zoomOutButton.disabled = zoomStep(zoom, 'out', FREEFORM_ZOOM) === zoom;
	};

	const historyOf = (id: string): FreeformHistory => histories.get(id) ?? EMPTY_FREEFORM_HISTORY;

	/** The two symbols awake only while there is a change of the view on show to take back or make again. */
	const paintHistory = (): void => {
		const history = shownViewId === null ? EMPTY_FREEFORM_HISTORY : historyOf(shownViewId);
		undoButton.disabled = readOnly || shownViewId === null || history.undo.length === 0;
		redoButton.disabled = readOnly || shownViewId === null || history.redo.length === 0;
	};

	/** The canvas told what stands on the view on show, as it stands now. */
	const paintScene = (): void => {
		if (disposed) return;
		const id = shownViewId;
		const view = id === null ? null : standingView(id);
		paintHistory();
		if (view === null || model === null) {
			made = null;
			hits = [];
			canvas.setScene(EMPTY_FREEFORM_SCENE);
			hint.toggleClass('is-hidden', true);
			root.toggleClass('is-searching', false);
			searchCount.setText('');
			fitButton.disabled = true;
			return;
		}
		const shown = draft !== null && draft.viewId === id
			? { ...view, placements: [...view.placements, draft.placement] }
			: view;
		laneDeck.beginPaint();
		const searched = searchFreeformScene(sceneOf(shown, words), query);
		made = searched.made;
		hits = searched.hits;
		if (hitId !== null && !hits.includes(hitId)) hitId = null;
		canvas.setInteraction({
			readOnly,
			ground: dragDraws ? 'select' : 'pan',
			snap: memory.snap ? FREEFORM_GRID : null,
			minimap: memory.minimap,
		});
		canvas.setScene(made.scene);
		paintSearch();
		fitButton.disabled = made.scene.nodes.length === 0;
		deck.prune();
	};

	// -- Searching -------------------------------------------------------------

	/**
	 * What the search says of itself: how many it found, which of them is in
	 * sight, or that none matched, said over the canvas as an empty view's
	 * word is. Nothing while nothing is searched for.
	 */
	const paintSearch = (): void => {
		const nodes = made?.scene.nodes.length ?? 0;
		const searching = query.trim().length > 0 && nodes > 0;
		const none = searching && hits.length === 0;
		hint.toggleClass('is-hidden', nodes > 0 && !none);
		hintLine.text.setText(t(none ? 'freeformCanvas.search.none' : 'freeformCanvas.empty.nodes'));
		root.toggleClass('is-searching', searching);
		if (!searching || hits.length === 0) {
			searchCount.setText('');
			return;
		}
		const at = hitId === null ? -1 : hits.indexOf(hitId);
		searchCount.setText(at === -1
			? t(hits.length === 1 ? 'freeformCanvas.search.matchesOne' : 'freeformCanvas.search.matches', { count: hits.length })
			: t('freeformCanvas.search.position', { at: at + 1, count: hits.length }));
	};

	const setQuery = (next: string): void => {
		if (next === query) return;
		query = next;
		hitId = null;
		paintScene();
	};

	/** The next node found brought into sight and chosen, or the one before; round again at either end. */
	const stepSearch = (step: 1 | -1): void => {
		if (hits.length === 0) return;
		const at = hitId === null ? -1 : hits.indexOf(hitId);
		const next = at === -1 ? (step === 1 ? 0 : hits.length - 1) : (at + step + hits.length) % hits.length;
		hitId = hits[next] ?? null;
		if (hitId === null) return;
		canvas.moveViewport({ kind: 'reveal', id: hitId });
		canvas.select({ nodes: [hitId], edges: [] });
		paintSearch();
	};

	/** The search field given the keys, its words chosen so the next ones replace them. */
	const focusSearch = (): void => {
		search.inputEl.focus();
		search.inputEl.select();
	};

	// -- The switches ------------------------------------------------------------

	const setMinimap = (on: boolean): void => {
		if (memory.minimap === on) return;
		memory.minimap = on;
		controls.remember();
		canvas.setInteraction({ minimap: on });
		paintMinimap();
	};

	const setSnap = (on: boolean): void => {
		if (memory.snap === on) return;
		memory.snap = on;
		controls.remember();
		canvas.setInteraction({ snap: on ? FREEFORM_GRID : null });
	};

	/**
	 * The records and files the view on show places, read afresh where what
	 * is wanted changed, or where told to since the project or a family
	 * moved. A read that lands after another was asked for is let go; one
	 * that lands is painted at once, so a face that stood pending shows.
	 */
	const readResources = (force = false): void => {
		listenToResources();
		const view = shownView();
		const path = controls.projectPath();
		const types = view === null ? new Set<FreeformRecordType | 'file'>() : freeformPlacedTypes(view);
		const filePaths = view === null ? [] : freeformPlacedFilePaths(view);
		const key = JSON.stringify([path, [...types].sort(), [...filePaths].sort()]);
		const same = key === resourcesKey;
		resourcesKey = key;
		if (types.size === 0 || path === null) {
			if (resources !== null) {
				resources = null;
				paintScene();
			}
			return;
		}
		if (same && !force && resources !== null) return;
		resourcesSerial += 1;
		const serial = resourcesSerial;
		void controls.bridge().readResources({ types, filePaths }).then((read) => {
			if (disposed || serial !== resourcesSerial) return;
			resources = read;
			paintScene();
		}).catch((error: unknown) => {
			console.error('Snowflake: a freeform view’s records could not be read', error);
		});
	};

	/**
	 * What a leaf leaves behind as it goes from a view: where it stood
	 * looking, and what the view's resources are called now, so one that goes
	 * missing later is called what it was last called. Written only where it
	 * says something the file does not.
	 */
	const leaveShown = (): void => {
		const id = shownViewId;
		if (id === null) return;
		// What is being typed and where nodes were left are the view's, and go to it first.
		canvas.settle();
		draft = null;
		editingId = null;
		const file = fileView(id);
		if (file === null || readOnly || model === null) return;
		const viewport = memory.viewports.get(id);
		const labels = new Map<string, { name: string; kind?: string }>();
		for (const placement of file.placements) {
			const label = freeformLabelOf(resolvePlacement(placement, model, null));
			if (label !== null) labels.set(placement.id, label);
		}
		const left = { ...(viewport === undefined ? {} : { viewport }), labels };
		if (leaveFreeformView(file, left) === null) return;
		// Nothing on screen is drawn from it, so no paint is asked for after it.
		void enqueue(async () => {
			await controls.bridge().leaveView(id, left);
		}, 'nothing');
	};

	/** The canvas turned to another view, or to none: the one on show is left first. */
	const turnTo = (view: FreeformView | null): void => {
		const next = view?.id ?? null;
		if (next === shownViewId) return;
		leaveShown();
		shownViewId = next;
		canvas.select(NO_CANVAS_SELECTION);
		if (view === null) return;
		// Where this leaf last looked at the view from, or where its file says it was last looked at from.
		const at = memory.viewports.get(view.id) ?? view.viewport;
		canvas.moveViewport({ kind: 'exact', viewport: at });
		paintZoom(at.zoom);
	};

	const paintAll = (): void => {
		loop.paint();
	};

	/** The laying out itself, from the model handed to it and the document last read. */
	const draw = (nextModel: ProjectDashboardModel | null): void => {
		const modelMoved = nextModel !== model;
		if (modelMoved) laneDeck.index(nextModel);
		model = nextModel;
		// The model's word alone, renewed with every project refresh.
		readOnly = model?.readOnly ?? true;
		root.toggleClass('is-read-only', readOnly);
		addViewButton.disabled = readOnly || reading === null;
		if (reading === null || model === null || engineFailed) {
			editViewButton.disabled = true;
			addNodeButton.disabled = true;
			paintOptions([]);
			showEmpty(t(loadFailed || engineFailed ? 'freeformCanvas.loadFailed' : 'freeformCanvas.loading'));
			return;
		}
		const held = reading.held;
		// A layout restored under the workspace names the view for it.
		if (memory.viewId !== remembered) {
			remembered = memory.viewId;
			if (memory.viewId !== null) viewId = memory.viewId;
		}
		viewId = shownFreeformViewId(held, viewId);
		if (memory.viewId !== viewId) {
			memory.viewId = viewId;
			remembered = viewId;
			controls.remember();
		}
		paintOptions(held.views);
		const view = viewId === null ? null : fileView(viewId);
		editViewButton.disabled = readOnly || view === null;
		addNodeButton.disabled = readOnly || view === null;
		turnTo(view);
		if (view === null) {
			paintScene();
			readResources();
			showEmpty(t('freeformCanvas.empty.views'));
			return;
		}
		showEmpty(null);
		paintScene();
		// The threads, the revisions and the files arrive with the project's own refresh.
		readResources(modelMoved);
	};

	// -- Writing -------------------------------------------------------------

	/**
	 * Says why a change did not land: in the words handed in, or in the
	 * view's own; nothing where the caller says its own word, as a form left
	 * standing over a refusal does.
	 */
	const say = (came: FreeformCame, words?: string | null): void => {
		if (came === 'written' || disposed || words === null) return;
		if (words !== undefined) {
			new Notice(words);
			return;
		}
		new Notice(came === 'full'
			? t('freeformCanvas.view.full', { limit: reading?.limits.placements ?? 0 })
			: t('freeformCanvas.changeRefused'));
	};

	const drop = (entry: Pending): void => {
		const at = pending.indexOf(entry);
		if (at === -1) return;
		pending.splice(at, 1);
		turn += 1;
	};

	/**
	 * One gesture, one write, one change to take back. The change is made to
	 * the view as the canvas shows it at once, and sent to the file in its
	 * turn; what the file would not take is taken off the canvas again, and
	 * said. The steps that take it back are kept from the moment it is shown,
	 * worked out here, and stand corrected by the file's own once it lands.
	 * `gone` is what to say for a change the view would not take: the words
	 * for a change taken back or made again that it can no longer take, or
	 * null for a caller that says its own word.
	 */
	const change = async (
		steps: readonly FreeformStep[],
		turnOf: FreeformHistoryTurn = 'change',
		gone?: string | null,
	): Promise<FreeformCame> => {
		const id = shownViewId;
		const path = controls.projectPath();
		const view = id === null ? null : standingView(id);
		if (id === null || view === null || reading === null || path === null || readOnly) {
			say('refused', gone);
			return 'refused';
		}
		const taken = applyFreeformSteps(view, steps, view.updatedAt, reading.limits);
		if (taken.came !== 'written') {
			say(taken.came, gone);
			return taken.came;
		}
		if (!taken.changed) return 'written';
		const entry: Pending = { viewId: id, steps, landedOn: undefined };
		pending.push(entry);
		turn += 1;
		const recorded = recordFreeformChange(historyOf(id), taken.inverse, turnOf);
		histories.set(id, recorded.history);
		paintScene();
		// Where the leaf stands looking rides along with the change.
		const viewport = canvas.viewport();
		const answer: { came: FreeformCame; inverse: readonly FreeformStep[] } = { came: 'refused', inverse: [] };
		await enqueue(async () => {
			try {
				// The project the change was made in, where it still stands to be written.
				if (controls.projectPath() !== path) return;
				const done = await controls.bridge().transact(id, steps, viewport);
				answer.came = done.came;
				answer.inverse = done.inverse;
			} finally {
				if (answer.came === 'written') entry.landedOn = fileView(id);
				else drop(entry);
			}
		});
		drop(entry);
		if (recorded.entry !== null) {
			histories.set(id, answerFreeformChange(historyOf(id), recorded.entry, answer.came === 'written' ? answer.inverse : null));
		}
		if (answer.came !== 'written') {
			paintScene();
			say(answer.came, gone);
		} else {
			paintHistory();
		}
		return answer.came;
	};

	// -- Taking back and making again --------------------------------------------

	/**
	 * The last change to the view on show taken back, or the last taken back
	 * made again. False where there was none to take, so a key pressed for
	 * nothing goes on to whoever is next.
	 */
	const turnBack = (way: 'undo' | 'redo'): boolean => {
		const id = shownViewId;
		if (id === null || readOnly || disposed) return false;
		// Words still being typed are the view's before anything is taken back.
		canvas.settle();
		const took = way === 'undo' ? takeFreeformUndo(historyOf(id)) : takeFreeformRedo(historyOf(id));
		if (took === null) return false;
		histories.set(id, took.history);
		paintHistory();
		void change(took.entry.steps, way, t(way === 'undo' ? 'freeformCanvas.undo.gone' : 'freeformCanvas.redo.gone'))
			.catch((error: unknown) => {
				console.error('Snowflake: a freeform change could not be taken back', error);
			});
		return true;
	};

	const undo = (): boolean => turnBack('undo');

	const redo = (): boolean => turnBack('redo');

	/**
	 * Words whose write failed have no field left to go back to: they go to a
	 * dialog that outlives the workspace, gathered over a tick so refusals
	 * landing together open one.
	 */
	let recovered: RecoveredFreeformText[] = [];
	const recover = (place: string, kept: string): void => {
		if (recovered.length === 0) {
			void Promise.resolve().then(() => {
				const drafts = recovered;
				recovered = [];
				// Checked at delivery: unload can start between a refusal and this
				// tick, and a plugin that has gone can own no dialog.
				if (controls.unloading?.() === true) {
					for (const entry of drafts) {
						console.error('Snowflake: a text node’s words could not be written', entry);
					}
					return;
				}
				new FreeformTextModal(app, t, drafts).open();
			});
		}
		recovered.push({ place, words: kept });
	};

	/** A change that carries typed words, which are handed back where it does not land. */
	const write = (steps: readonly FreeformStep[], place: string, kept: string): void => {
		void change(steps).then((came) => {
			if (came !== 'written') recover(place, kept);
		}, (error: unknown) => {
			console.error('Snowflake: a freeform change could not be made', error);
			recover(place, kept);
		});
	};

	// -- Text nodes ----------------------------------------------------------

	const keepText = (id: string, kept: string, needed: number): void => {
		if (editingId === id) editingId = null;
		const blank = kept.trim().length === 0;
		const place = shownViewId === null ? '' : (fileView(shownViewId)?.name ?? '');
		if (draft !== null && draft.placement.id === id) {
			const { placement } = draft;
			draft = null;
			// A text node left with no words in it is never written.
			if (blank) {
				paintScene();
				return;
			}
			write([{
				do: 'add',
				placements: [{
					id,
					resource: { type: 'text', text: kept },
					x: placement.x,
					y: placement.y,
					width: placement.width,
					height: grownHeight(placement.height, needed),
				}],
			}], place, kept);
			return;
		}
		const view = shownView();
		const placement = view === null ? undefined : findFreeformPlacement(view, id);
		if (placement === undefined || placement.resource.type !== 'text') {
			// The node has gone from under the words typed into it.
			if (!blank) recover(place, kept);
			paintScene();
			return;
		}
		// Words taken out to the last are the node taken off the view.
		if (blank) {
			void change([{ do: 'delete', nodes: [id], edges: [] }]);
			return;
		}
		if (placement.resource.text === kept) {
			paintScene();
			return;
		}
		const height = grownHeight(placement.height, needed);
		const steps: FreeformStep[] = [{ do: 'text', id, text: kept }];
		if (height !== placement.height) {
			steps.push({ do: 'place', places: [{ id, x: placement.x, y: placement.y, height }] });
		}
		write(steps, place, kept);
	};

	const leaveText = (id: string): void => {
		if (editingId === id) editingId = null;
		if (draft !== null && draft.placement.id === id) draft = null;
		paintScene();
		canvas.focus();
	};

	// -- The deck a scene's card is dealt from ---------------------------------

	/**
	 * A scene stands on the canvas as the corkboard's own card, dealt from a
	 * deck of this workspace's: named, coloured and set in its status where
	 * it stands, its writes queued and read back as the board's are. Its
	 * conflict is read on the card and written in the scene's form, as every
	 * card's body is on the canvas, and the card wears the scene's symbol in
	 * place of its number, since the canvas stands its cards in no order. A
	 * card is keyed by its placement, so a scene placed twice is two cards
	 * that show the same words. The engine moves the card's node, so the
	 * card itself never drags, and its menu is the node's.
	 */
	const laneDeck = createLaneDeck({
		controls: {
			app,
			t,
			host,
			refresh: () => controls.refresh(),
			projectPath: () => controls.projectPath(),
			unloading: () => controls.unloading?.() === true,
		},
		notice,
		model: () => model,
		readOnly: () => readOnly,
		cells: () => ({
			dragAllowed: () => false,
			openCardMenu: (card, event) => {
				openNodeMenu(card.key, event);
			},
		}),
		symbol: kindIcon({ worldbuildingKinds: [] }, 'scene'),
		conflictReadOnly: true,
	});
	const { deck } = laneDeck;
	// A press on a card's control is let go wherever it ends, and a colour
	// panel goes with the window the card leaves, as under the corkboard.
	const unbindDeckWindow = bindFrameWindow({ root, deck, invalidateRects: () => undefined });

	/** Keeps the words of the card's field holding the focus; true when one did. */
	const keepFocusedCard = (): boolean => {
		const active = root.doc.activeElement;
		if (active === null) return false;
		for (const card of deck.cards.values()) {
			if (active === card.conflict) {
				deck.commitConflict(card);
				return true;
			}
			if (active === card.titleInput) {
				deck.commitTitle(card, false);
				return true;
			}
		}
		return false;
	};

	// -- What a record opens -------------------------------------------------------

	/** The project the records are read from, for the host's own tables and floats. */
	const recordContext = (): { projectPath: string | null; locale: 'en' | 'zh-CN' | null } => ({
		projectPath: controls.projectPath(),
		locale: reading?.locale ?? null,
	});

	/** One occurrence of a foreshadowing shown in the manuscript: flashed where it stands, or its chapter opened where it has come loose. */
	const openOccurrence = (item: ForeshadowingTableItem, occurrence: ForeshadowingOccurrenceRow): void => {
		void item;
		const table = host.foreshadowingTable(recordContext());
		const spot = occurrence.reveal ?? { from: occurrence.from, to: occurrence.to };
		const opening = occurrence.standing === 'live'
			? table.open({ path: occurrence.path, from: spot.from, to: spot.to })
			: table.openUnresolved(occurrence.path, occurrence.id);
		void opening.catch(notice);
	};

	/** A foreshadowing shown in the manuscript at its first occurrence, in manuscript order; none, and it is said. */
	const openForeshadowing = (item: ForeshadowingTableItem): void => {
		const first = item.occurrences[0];
		if (first === undefined) {
			new Notice(t('freeformCanvas.open.noOccurrence'));
			return;
		}
		openOccurrence(item, first);
	};

	/** One occurrence picked by its chapter and its role, for a foreshadowing with several. */
	const openPickOccurrence = (item: ForeshadowingTableItem): void => {
		if (disposed) return;
		if (item.occurrences.length === 0) {
			new Notice(t('freeformCanvas.open.noOccurrence'));
			return;
		}
		const options: PickerOption[] = item.occurrences.map((occurrence) => ({
			value: occurrence.id,
			label: `${occurrence.title} · ${t(`foreshadowing.role.${occurrence.role}`)}`,
		}));
		keep(new TimelineTimePickModal(app, t('freeformCanvas.open.occurrencePlaceholder'), options, (picked) => {
			const occurrence = item.occurrences.find((candidate) => candidate.id === picked.value);
			if (occurrence !== undefined) openOccurrence(item, occurrence);
		})).open();
	};

	/** A revision shown in the manuscript where it stands, or its chapter opened where it has come into conflict. */
	const openRevision = (node: Extract<ResolvedNode, { type: 'revision' }>): void => {
		const table = host.revisionTable(recordContext());
		const spot = node.row.reveal ?? { from: node.row.from, to: node.row.to };
		const opening = node.row.status === 'live'
			? table.open({ path: node.row.path, from: spot.from, to: spot.to })
			: table.openUnresolved(node.row.path, node.row.id);
		void opening.catch(notice);
	};

	/** A task shown on its board; one the board no longer shows is said to have gone. */
	const openTask = (node: Extract<ResolvedNode, { type: 'task' }>): void => {
		const path = controls.projectPath();
		if (path === null) return;
		void host.revealTask(path, node.task.id).then((shown) => {
			if (!shown && !disposed) new Notice(t('freeformCanvas.open.taskGone'));
		}, notice);
	};

	/** A sticky note floated over this window, its project made current first, as the sticky board floats one. */
	const floatSticky = (node: Extract<ResolvedNode, { type: 'sticky-note' }>): void => {
		controls.activateProject();
		void host.stickyNotes(recordContext()).float(node.note.id, root.win).catch(notice);
	};

	const faces = createFreeformFaces({
		app,
		t,
		component: controls.component,
		sourcePath: () => controls.projectPath() ?? '',
		node: (id) => made?.nodes.get(id),
		frame: (id) => made?.frames.get(id),
		icon: iconOf,
		label: nameOf,
		frameLabel: frameLabelOf,
		editing: () => editingId,
		textLimit: () => reading?.limits.textLength ?? 0,
		menu: (id, event) => {
			openNodeMenu(id, event);
		},
		keepText,
		leaveText,
		openOccurrence,
		today: () => controls.bridge().today(),
		dateFormat: () => controls.bridge().dateFormat(),
		locale: () => reading?.locale ?? 'en',
		scenes: {
			mount: (parent, key, scene, index) => deck.mount(parent, key, scene, index),
			dress: (card, scene, index) => {
				deck.dress(card, scene, index, { position: index + 1, size: model?.scenes.length ?? 0 });
			},
			settle: (key) => {
				const card = deck.cards.get(key);
				if (card === undefined) return;
				deck.commitTitle(card, false);
				deck.commitConflict(card);
			},
			retire: (key) => {
				deck.retire(key);
			},
		},
	});

	/** A text node made where it is to stand, open to be typed into, and written once it holds a word. */
	const addText = (middle?: CanvasPoint): void => {
		const id = shownViewId;
		if (id === null || readOnly || disposed) return;
		// A node still being typed into is kept before another is made.
		canvas.settle();
		const view = standingView(id);
		if (view === null || reading === null) return;
		if (freeformRoom(view, reading.limits).placements === 0) {
			say('full');
			return;
		}
		const at = landingAt(
			cornersOf(view),
			middle ?? canvas.centre(),
			FREEFORM_SIZE,
			memory.snap ? FREEFORM_GRID : null,
		);
		const top = view.placements.reduce((highest, placement) => Math.max(highest, placement.zIndex), -1);
		const placement: FreeformPlacement = {
			id: controls.bridge().mintId('placement'),
			resource: { type: 'text', text: '' },
			x: at.x,
			y: at.y,
			width: FREEFORM_SIZE.width,
			height: FREEFORM_SIZE.height,
			displayMode: 'auto',
			zIndex: top + 1,
			frameId: null,
		};
		draft = { viewId: id, placement };
		editingId = placement.id;
		paintScene();
		canvas.select({ nodes: [placement.id], edges: [] });
		// A face standing already opens now; one still to be raised opens as it is.
		faces.edit(placement.id);
	};

	const editText = (id: string): void => {
		if (readOnly || disposed || made?.nodes.get(id)?.type !== 'text') return;
		editingId = id;
		paintScene();
		if (!faces.edit(id)) canvas.moveViewport({ kind: 'reveal', id });
	};

	/**
	 * The families that ring for themselves ring here; the rest arrive with
	 * the project's refresh. The bridge is the one standing now, asked for
	 * afresh on every ring, since a rename moves the path.
	 */
	let boundResourcesBridge: FreeformBridge | null = null;
	let unsubscribeResources: (() => void) | null = null;
	const listenToResources = (): void => {
		const bridge = controls.bridge();
		if (bridge === boundResourcesBridge) return;
		unsubscribeResources?.();
		boundResourcesBridge = bridge;
		unsubscribeResources = bridge.subscribeResources(() => {
			if (!disposed) readResources(true);
		});
	};

	// -- Nodes added by type ----------------------------------------------------

	/** The kinds of node the form offers: what the project holds notes of, and what is made on the canvas. */
	const nodeTypes = (): FreeformNodeType[] => [
		{ value: 'scene', label: kindWord('scene'), section: 'entity' },
		{ value: 'character', label: kindWord('character'), section: 'entity' },
		...(model?.worldbuildingKinds ?? []).map((kind): FreeformNodeType => ({ value: kind.id, label: kindWord(kind.id), section: 'entity' })),
		{ value: 'task', label: t('freeformCanvas.type.task'), section: 'task' },
		{ value: 'foreshadowing', label: t('freeformCanvas.type.foreshadowing'), section: 'task' },
		{ value: 'revision', label: t('freeformCanvas.type.revision'), section: 'task' },
		{ value: 'sticky-note', label: t('freeformCanvas.type.stickyNote'), section: 'task' },
		{ value: 'file', label: t('freeformCanvas.type.file'), section: 'file' },
		{ value: 'link', label: t('freeformCanvas.type.link'), section: 'file' },
		{ value: 'text', label: t('freeformCanvas.type.text'), section: 'canvas' },
		{ value: 'frame', label: t('freeformCanvas.type.frame'), section: 'canvas' },
	];

	/** The families the form offers whole, read for it before it opens. */
	const FORM_FAMILIES: readonly FreeformRecordType[] = ['task', 'foreshadowing', 'revision', 'sticky-note'];

	/** What a record of a family is called in the form's list. */
	const recordName = (family: FreeformRecordType, record: { title?: string; name?: string; original?: string; proposed?: string; body?: string }): string => {
		switch (family) {
			case 'task':
				return record.title ?? '';
			case 'foreshadowing':
				return record.name ?? '';
			case 'revision':
				return plainFirstLine((record.original ?? '').length > 0 ? record.original ?? '' : record.proposed ?? '', NAME_LENGTH);
			case 'sticky-note':
				return plainFirstLine(record.body ?? '', NAME_LENGTH);
		}
	};

	/**
	 * The notes of a kind the project holds, or the records of a family as
	 * read for the form, each with whether the view on show places it
	 * already. A record set aside is not offered: the canvas shows it as
	 * missing, and offers nothing it would show so.
	 */
	const nodeCandidates = (kind: string, read: FreeformResources | null, files: readonly { path: string; name: string }[]): FreeformNodeCandidate[] => {
		if (model === null) return [];
		const view = shownView();
		const placed = new Set<string>();
		for (const { resource } of view?.placements ?? []) {
			if (resource.type === 'entity') placed.add(`entity ${resource.id}`);
			else if (resource.type === 'file') placed.add(`file ${resource.path}`);
			else if (resource.type !== 'text' && resource.type !== 'link') placed.add(`${resource.type} ${resource.id}`);
		}
		if (kind === 'file') return files.map((file) => ({ id: file.path, name: file.path, onView: placed.has(`file ${file.path}`) }));
		const named = (family: string, entries: readonly { id: string; name: string }[]): FreeformNodeCandidate[] =>
			entries.map((entry) => ({ id: entry.id, name: entry.name, onView: placed.has(`${family} ${entry.id}`) }));
		if (kind === 'scene') return named('entity', model.scenes.map((scene) => ({ id: scene.id, name: scene.title })));
		if (kind === 'character') return named('entity', model.characters);
		if (kind === 'task') return named('task', (read?.tasks ?? []).filter((task) => !task.archived).map((task) => ({ id: task.id, name: recordName('task', task) })));
		if (kind === 'foreshadowing') return named('foreshadowing', (read?.foreshadowing ?? []).map((item) => ({ id: item.id, name: recordName('foreshadowing', item) })));
		if (kind === 'revision') return named('revision', (read?.revisions ?? []).map((row) => ({ id: row.id, name: recordName('revision', row) })));
		if (kind === 'sticky-note') return named('sticky-note', (read?.stickyNotes ?? []).filter((note) => !note.archived).map((note) => ({ id: note.id, name: recordName('sticky-note', note) })));
		return named('entity', kindEntities(model, kind));
	};

	/**
	 * Nodes added through the form: a text node typed where it lands, or the
	 * notes chosen, each landing a step from the last so they fan out from
	 * the middle of what is in sight, or from where the ground's menu was
	 * opened. The form stands over a refusal, saying so.
	 */
	const openAddNode = (middle?: CanvasPoint, initialType: string | null = null): void => {
		const id = shownViewId;
		if (id === null || readOnly || disposed || model === null) return;
		// The records and the files are read whole for the form's lists before it opens; a family that will not read offers nothing.
		const bridge = controls.bridge();
		void Promise.all([
			bridge.readResources({ types: new Set(FORM_FAMILIES), filePaths: [] }).catch((error: unknown) => {
				console.error('Snowflake: the records could not be read for the freeform form', error);
				return null;
			}),
			bridge.listFiles().catch((error: unknown) => {
				console.error('Snowflake: the project’s files could not be listed for the freeform form', error);
				return [];
			}),
		]).then(([read, files]) => {
			if (disposed || shownViewId !== id) return;
			openNodeForm(middle, initialType, read, files);
		});
	};

	const openNodeForm = (
		middle: CanvasPoint | undefined,
		initialType: string | null,
		read: FreeformResources | null,
		files: readonly { path: string; name: string }[],
	): void => {
		keep(new FreeformNodeFormModal(
			app,
			t,
			{
				types: nodeTypes(),
				candidates: (kind) => nodeCandidates(kind, read, files),
				room: () => {
					const view = shownView();
					return view === null || reading === null ? 0 : freeformRoom(view, reading.limits).placements;
				},
				labelLimit: reading?.limits.labelLength ?? 0,
				initialType,
			},
			async (draft) => {
				if (disposed) return;
				if (draft.type === 'text') {
					addText(middle);
					return;
				}
				if (draft.type === 'frame') {
					await addFrame(draft.frame, middle);
					return;
				}
				if (draft.type === 'link') {
					await addLink(draft.link, middle);
					return;
				}
				canvas.settle();
				const view = shownView();
				if (view === null) throw new Error(t('freeformCanvas.node.refused'));
				const kind = draft.kind;
				const family = FORM_FAMILIES.find((candidate) => candidate === kind);
				// A note lands with the room its standard face needs, so it stands as its own card from the first; a file or a
				// link with its one row, and a picture, a video or a sound with room for the file itself.
				const shape = faceKindOf(
					family ?? (kind === 'file' ? 'file' : kind === 'scene' ? 'scene' : kind === 'character' ? 'character' : 'worldbuilding'),
				);
				const heights = draft.nodes.map((node) =>
					kind === 'file' && ['image', 'video', 'audio'].includes(freeformFileKind(node.id)) ? FREEFORM_SIZE.height : landingHeightOf(shape),
				);
				const size = { width: FREEFORM_SIZE.width, height: Math.max(...heights, 0) };
				const landings = landingsAt(
					cornersOf(view),
					middle ?? canvas.centre(),
					draft.nodes.length,
					size,
					memory.snap ? FREEFORM_GRID : null,
				);
				const placements: FreeformPlacementDraft[] = draft.nodes.map((node, at) => ({
					id: controls.bridge().mintId('placement'),
					resource: kind === 'file'
						? { type: 'file', path: node.id }
						: family === undefined
							? { type: 'entity', kind, id: node.id, name: node.name }
							: { type: family, id: node.id, name: node.name },
					x: landings[at]?.x ?? 0,
					y: landings[at]?.y ?? 0,
					width: size.width,
					height: heights[at] ?? size.height,
				}));
				const came = await change([{ do: 'add', placements }], 'change', null);
				if (came !== 'written') throw new Error(t('freeformCanvas.node.refused'));
				if (disposed) return;
				canvas.select({ nodes: placements.map((placement) => placement.id), edges: [] });
			},
		)).open();
	};

	// -- Links -------------------------------------------------------------------

	/** A link laid down where it lands; the form stands over a refusal, saying so. */
	const addLink = async (draft: FreeformLinkDraft, middle?: CanvasPoint): Promise<void> => {
		canvas.settle();
		const view = shownView();
		if (view === null || readOnly || disposed) throw new Error(t('freeformCanvas.link.refused'));
		// A link is one row, and lands with the room for one.
		const size = { width: FREEFORM_SIZE.width, height: landingHeightOf('record') };
		const at = landingAt(cornersOf(view), middle ?? canvas.centre(), size, memory.snap ? FREEFORM_GRID : null);
		const id = controls.bridge().mintId('placement');
		const came = await change([{
			do: 'add',
			placements: [{ id, resource: { type: 'link', url: draft.url, label: draft.label }, x: at.x, y: at.y, width: size.width, height: size.height }],
		}], 'change', null);
		if (came !== 'written') throw new Error(t('freeformCanvas.link.refused'));
		if (!disposed) canvas.select({ nodes: [id], edges: [] });
	};

	/** A link's address and label, edited through its form; the form stands over a refusal, saying so. */
	const openLinkForm = (id: string): void => {
		const node = made?.nodes.get(id);
		if (node?.type !== 'link' || readOnly || disposed) return;
		keep(new FreeformLinkFormModal(app, t, { url: node.url, label: node.label }, reading?.limits.labelLength ?? 0, async (draft) => {
			if (disposed) return;
			const came = await change([{ do: 'link', id, url: draft.url, label: draft.label }], 'change', null);
			if (came !== 'written') throw new Error(t('freeformCanvas.link.refused'));
		})).open();
	};

	/** The address handed to the app, which opens it as the author has it set to. */
	const openLink = (node: Extract<ResolvedNode, { type: 'link' }>): void => {
		try {
			host.openExternalLink(node.url, root);
		} catch (error) {
			notice(error);
		}
	};

	/** The address put on the clipboard, for wherever it is wanted next. */
	const copyLink = (node: Extract<ResolvedNode, { type: 'link' }>): void => {
		void root.win.navigator.clipboard.writeText(node.url).catch(notice);
	};

	// -- What a node opens -----------------------------------------------------

	/** The note behind a node, opened in the app. */
	const openNote = (node: ResolvedNode): void => {
		const path = node.type === 'scene'
			? node.scene.path
			: node.type === 'character'
				? node.character.path
				: node.type === 'worldbuilding'
					? node.entity.path
					: null;
		if (path === null) return;
		void host.openManagedFile(path).catch(notice);
	};

	/**
	 * What a node opens: its form, through the deck's queue so a save is read
	 * back, or its words to be typed into. A node whose resource has gone
	 * opens nothing.
	 */
	const openNode = (id: string): void => {
		if (disposed || made === null) return;
		if (made.frames.has(id)) {
			openFrameForm(id);
			return;
		}
		const node = made.nodes.get(id);
		const path = controls.projectPath();
		if (node === undefined || path === null) return;
		if (node.type === 'text') {
			editText(id);
			return;
		}
		// A project that cannot be written still shows its notes, its board and its manuscript; only the forms are kept shut.
		if (readOnly && (node.type === 'scene' || node.type === 'character' || node.type === 'worldbuilding')) {
			openNote(node);
			return;
		}
		if (node.type === 'scene') {
			deck.openForm((onSaved) => host.openSceneForm({ mode: 'edit', id: node.scene.id }, path, onSaved));
		} else if (node.type === 'character') {
			deck.openForm((onSaved) => host.openCharacterForm(node.character.id, path, onSaved));
		} else if (node.type === 'worldbuilding') {
			deck.openForm((onSaved) => host.openEntityForm({ mode: 'edit', id: node.entity.id }, path, onSaved));
		} else if (node.type === 'task') {
			openTask(node);
		} else if (node.type === 'foreshadowing') {
			openForeshadowing(node.item);
		} else if (node.type === 'revision') {
			openRevision(node);
		} else if (node.type === 'sticky-note') {
			floatSticky(node);
		} else if (node.type === 'file') {
			void host.openProjectFile(node.file.path).catch(notice);
		} else if (node.type === 'link') {
			openLink(node);
		}
	};

	// -- How a node is shown and where it stands ----------------------------------

	/**
	 * The face chosen for nodes: the one asked for, or Auto, which is the
	 * fullest the view's zoom allows that the box has room for. A face chosen
	 * by hand sizes the box to what that face needs, taller or shorter.
	 */
	const setDisplay = (ids: readonly string[], mode: FreeformDisplayMode): void => {
		const view = shownView();
		if (view === null || made === null || readOnly) return;
		const modes: { id: string; mode: FreeformDisplayMode }[] = [];
		const places: FreeformPlace[] = [];
		for (const id of ids) {
			const placement = findFreeformPlacement(view, id);
			const node = made.nodes.get(id);
			if (placement === undefined || node === undefined) continue;
			modes.push({ id, mode });
			const height = heightForMode(faceKindOf(node.type), mode, placement.height);
			if (height !== placement.height) places.push({ id, x: placement.x, y: placement.y, height });
		}
		if (modes.length === 0) return;
		const steps: FreeformStep[] = [{ do: 'display', modes }];
		if (places.length > 0) steps.push({ do: 'place', places });
		void change(steps);
	};

	/** A node's place and size set by number: the keyboard's way of moving and sizing one. */
	const openGeometry = (id: string): void => {
		const view = shownView();
		if (view === null || readOnly || disposed) return;
		const node = findFreeformPlacement(view, id) ?? view.frames.find((frame) => frame.id === id);
		if (node === undefined) return;
		keep(new FreeformGeometryModal(
			app,
			t,
			{ x: node.x, y: node.y, width: node.width, height: node.height },
			FREEFORM_NODE_MIN,
			async (geometry) => {
				if (disposed) return;
				const came = await change([{ do: 'place', places: [{ id, ...geometry }] }], 'change', null);
				if (came !== 'written') throw new Error(t('freeformCanvas.geometry.refused'));
			},
		)).open();
	};

	// -- Frames ------------------------------------------------------------------

	/** How large a frame is made where nothing tells its size: room for a few nodes. */
	const FRAME_SIZE = { width: 480, height: 320 };

	/** A frame made empty where it lands, to be dragged into; the form stands over a refusal, saying so. */
	const addFrame = async (draft: FreeformFrameDraft, middle?: CanvasPoint): Promise<void> => {
		canvas.settle();
		const view = shownView();
		if (view === null || readOnly || disposed) throw new Error(t('freeformCanvas.frame.refused'));
		const at = landingAt(cornersOf(view), middle ?? canvas.centre(), FRAME_SIZE, memory.snap ? FREEFORM_GRID : null);
		const id = controls.bridge().mintId('frame');
		const came = await change([{
			do: 'add-frames',
			frames: [{ id, title: draft.title, color: draft.color, x: at.x, y: at.y, width: FRAME_SIZE.width, height: FRAME_SIZE.height }],
		}], 'change', null);
		if (came !== 'written') throw new Error(t('freeformCanvas.frame.refused'));
		if (!disposed) canvas.select({ nodes: [id], edges: [] });
	};

	/** The nodes chosen gathered into a new frame drawn round them, untitled until its form names it. */
	const groupIntoFrame = (ids: readonly string[]): void => {
		const view = shownView();
		if (view === null || readOnly || disposed) return;
		const members = ids.filter((id) => findFreeformPlacement(view, id) !== undefined);
		if (members.length === 0) return;
		const id = controls.bridge().mintId('frame');
		void change([{ do: 'group', frame: { id, title: '', color: null }, members }], 'change', t('freeformCanvas.frame.refused'))
			.then((came) => {
				if (came === 'written' && !disposed) canvas.select({ nodes: [id], edges: [] });
			});
	};

	/** A frame's title and tint, edited through its form; the form stands over a refusal, saying so. */
	const openFrameForm = (id: string): void => {
		const view = shownView();
		const frame = view === null ? undefined : findFreeformFrame(view, id);
		if (frame === undefined || readOnly || disposed) return;
		keep(new FreeformFrameFormModal(app, t, { title: frame.title, color: frame.color }, async (draft) => {
			if (disposed) return;
			const came = await change([{ do: 'edit-frame', id, title: draft.title, color: draft.color }], 'change', null);
			if (came !== 'written') throw new Error(t('freeformCanvas.frame.refused'));
		})).open();
	};

	/** The placements a frame holds. */
	const membersOf = (view: FreeformView, frameId: string): string[] =>
		view.placements.filter((placement) => placement.frameId === frameId).map((placement) => placement.id);

	/** A frame's members chosen, and the frame let go. */
	const selectContents = (id: string): void => {
		const view = shownView();
		if (view === null) return;
		canvas.select({ nodes: membersOf(view, id), edges: [] });
		canvas.focus();
	};

	/** A frame drawn afresh round what it holds, with the room a grouping leaves. */
	const fitToContents = (id: string): void => {
		const view = shownView();
		if (view === null || readOnly) return;
		const box = freeformBounds(view, membersOf(view, id));
		if (box === null) return;
		void change([{
			do: 'place',
			places: [{
				id,
				x: box.x - FREEFORM_FRAME_PADDING,
				y: box.y - FREEFORM_FRAME_PADDING - FREEFORM_FRAME_HEAD,
				width: box.width + 2 * FREEFORM_FRAME_PADDING,
				height: box.height + 2 * FREEFORM_FRAME_PADDING + FREEFORM_FRAME_HEAD,
			}],
		}]);
	};

	/**
	 * The keyboard's way of dropping nodes into a frame, or out of one: the
	 * frame picked by name, or none. A node given to a frame it does not
	 * stand in is moved into it, where its members stand.
	 */
	const openMoveToFrame = (ids: readonly string[]): void => {
		const view = shownView();
		if (view === null || readOnly || disposed) return;
		const options: PickerOption[] = [
			{ value: '', label: t('freeformCanvas.frame.none') },
			...view.frames.map((frame) => ({ value: frame.id, label: frameLabelOf(frame) })),
		];
		keep(new TimelineTimePickModal(app, t('freeformCanvas.frame.moveToPlaceholder'), options, (picked) => {
			const now = shownView();
			if (now === null || disposed) return;
			const frame = picked.value.length === 0 ? null : findFreeformFrame(now, picked.value) ?? null;
			if (picked.value.length > 0 && frame === null) return;
			const members = ids.filter((id) => findFreeformPlacement(now, id) !== undefined);
			if (members.length === 0) return;
			const places: FreeformPlace[] = [];
			if (frame !== null) {
				// Each member not standing in the frame is brought inside it, at its head, a step from the last.
				const inside = (placement: FreeformPlacement): boolean =>
					placement.x >= frame.x && placement.y >= frame.y &&
					placement.x + placement.width <= frame.x + frame.width && placement.y + placement.height <= frame.y + frame.height;
				const corners = cornersOf(now);
				for (const id of members) {
					const placement = findFreeformPlacement(now, id);
					if (placement === undefined || inside(placement)) continue;
					const landing = landingAt(
						corners,
						{ x: frame.x + FREEFORM_FRAME_PADDING + placement.width / 2, y: frame.y + FREEFORM_FRAME_HEAD + FREEFORM_FRAME_PADDING + placement.height / 2 },
						{ width: placement.width, height: placement.height },
						memory.snap ? FREEFORM_GRID : null,
					);
					corners.push(landing);
					places.push({ id, x: landing.x, y: landing.y });
				}
			}
			const steps: FreeformStep[] = [{ do: 'reframe', members: members.map((id) => ({ id, frameId: frame?.id ?? null })) }];
			if (places.length > 0) steps.push({ do: 'place', places });
			void change(steps, 'change', t('freeformCanvas.frame.refused'));
		})).open();
	};

	// -- Lines from node to node --------------------------------------------------

	/** What a node is called on the canvas now, for the lists a line's ends are picked from. */
	const nodeOptions = (except: readonly string[]): PickerOption[] => {
		if (made === null) return [];
		const left = new Set(except);
		return made.scene.nodes
			.filter((node) => !left.has(node.id))
			.map((node) => ({ value: node.id, label: node.label }));
	};

	/** A line drawn from one node to another, by a drag between their sides or by a pick; the sides a pick leaves open are chosen by where the two stand. */
	const connect = (from: string, to: string, sides: { fromSide: FreeformSide | null; toSide: FreeformSide | null }): void => {
		if (readOnly || disposed || from === to) return;
		void change([{
			do: 'connect',
			edges: [{
				id: controls.bridge().mintId('edge'),
				source: from,
				target: to,
				sourceSide: sides.fromSide,
				targetSide: sides.toSide,
			}],
		}], 'change', t('freeformCanvas.edge.refused'));
	};

	/** The keyboard's way of drawing a line: the other end picked from the nodes of the view by name. */
	const openConnectTo = (from: string): void => {
		if (readOnly || disposed) return;
		keep(new TimelineTimePickModal(app, t('freeformCanvas.node.connectPlaceholder'), nodeOptions([from]), (picked) => {
			connect(from, picked.value, { fromSide: null, toSide: null });
		})).open();
	};

	/** One end of a line moved to another node, or another side of the same. */
	const reconnect = (id: string, ends: { source?: string; target?: string; sourceSide?: FreeformSide | null; targetSide?: FreeformSide | null }): void => {
		if (readOnly || disposed) return;
		void change([{ do: 'reconnect', id, ...ends }], 'change', t('freeformCanvas.edge.refused'));
	};

	/** One end of a line picked afresh from the nodes of the view by name; the side is left to where the two stand. */
	const openChangeEnd = (id: string, end: 'source' | 'target'): void => {
		const view = shownView();
		const edge = view === null ? undefined : findFreeformEdge(view, id);
		if (edge === undefined || readOnly || disposed) return;
		const other = end === 'source' ? edge.target : edge.source;
		keep(new TimelineTimePickModal(app, t('freeformCanvas.node.connectPlaceholder'), nodeOptions([other]), (picked) => {
			reconnect(id, end === 'source' ? { source: picked.value, sourceSide: null } : { target: picked.value, targetSide: null });
		})).open();
	};

	/** A line's words and look, edited through its form; the form stands over a refusal, saying so. */
	const openEdgeForm = (id: string): void => {
		const view = shownView();
		const edge = view === null ? undefined : findFreeformEdge(view, id);
		if (edge === undefined || readOnly || disposed) return;
		keep(new FreeformEdgeFormModal(
			app,
			t,
			{ label: edge.label, arrow: edge.arrow, line: edge.line },
			reading?.limits.labelLength ?? 0,
			async (draft) => {
				if (disposed) return;
				const came = await change([{ do: 'edit-edges', edits: [{ id, ...draft }] }], 'change', null);
				if (came !== 'written') throw new Error(t('freeformCanvas.edge.refused'));
			},
		)).open();
	};

	/** One end of a line brought into sight and chosen. */
	const goToEnd = (id: string, end: 'source' | 'target'): void => {
		const view = shownView();
		const edge = view === null ? undefined : findFreeformEdge(view, id);
		if (edge === undefined) return;
		const node = end === 'source' ? edge.source : edge.target;
		canvas.moveViewport({ kind: 'reveal', id: node });
		canvas.select({ nodes: [node], edges: [] });
		canvas.focus();
	};

	// -- Removing ------------------------------------------------------------

	/** Nodes and lines taken off the view. Nothing is asked: what they showed is kept where it lives. */
	const remove = (nodes: readonly string[], edges: readonly string[] = []): void => {
		if (readOnly || disposed) return;
		let standingNodes = nodes;
		if (draft !== null && nodes.includes(draft.placement.id)) {
			const made = draft.placement.id;
			if (editingId === made) editingId = null;
			draft = null;
			standingNodes = nodes.filter((id) => id !== made);
		}
		if (standingNodes.length === 0 && edges.length === 0) {
			paintScene();
			return;
		}
		void change([{ do: 'delete', nodes: standingNodes, edges }]);
	};

	// -- Copies, the clipboard, and the order nodes stand in --------------------

	/** What a copy of the nodes named takes, as the view stands now; null where none of them stands. */
	const clipOf = (ids: readonly string[]): FreeformClip | null => {
		if (ids.length === 0 || shownView() === null) return null;
		// Words still being typed are the view's before they are copied.
		canvas.settle();
		const view = shownView();
		return view === null ? null : copyFreeformSelection(view, { nodes: ids });
	};

	/** Whether the view has room for a copy laid down on it; says what stands in the way where it has not. */
	const roomFor = (view: FreeformView, clip: FreeformClip): boolean => {
		if (reading === null) return false;
		const room = freeformRoom(view, reading.limits);
		if (clip.placements.length > room.placements) {
			if (room.placements === 0) say('full');
			else new Notice(t('freeformCanvas.node.limitSome', { left: room.placements }));
			return false;
		}
		if (clip.frames.length > room.frames || clip.edges.length > room.edges) {
			say('refused');
			return false;
		}
		return true;
	};

	/** Where a copy's corner goes so its middle stands at a place, stepping aside from a corner already taken. */
	const landingFor = (view: FreeformView, clip: FreeformClip, middle: CanvasPoint): CanvasPoint =>
		landingAt(cornersOf(view), middle, freeformClipSize(clip), memory.snap ? FREEFORM_GRID : null);

	/**
	 * A copy laid down with its corner at a place, every node and line under
	 * an id of its own, and the new nodes chosen in place of the old.
	 */
	const layDown = (clip: FreeformClip, corner: CanvasPoint): void => {
		const view = shownView();
		if (view === null || readOnly || disposed || !roomFor(view, clip)) return;
		const { steps, nodes } = freeformClipSteps(clip, corner, (kind) => controls.bridge().mintId(kind));
		if (steps.length === 0) return;
		void change(steps);
		canvas.select({ nodes, edges: [] });
		canvas.focus();
	};

	/** The nodes named copied and laid down a step down and across from where they stand; false where none stands. */
	const duplicate = (ids: readonly string[]): boolean => {
		if (readOnly || disposed) return false;
		const clip = clipOf(ids);
		const view = shownView();
		if (clip === null || view === null) return false;
		const size = freeformClipSize(clip);
		const step = cascadeStep(memory.snap ? FREEFORM_GRID : null);
		layDown(clip, landingFor(view, clip, {
			x: clip.origin.x + step + size.width / 2,
			y: clip.origin.y + step + size.height / 2,
		}));
		return true;
	};

	/** A copy laid down about a place: where the ground's menu was opened, or the middle of what is in sight. */
	const paste = (clip: FreeformClip, middle?: CanvasPoint): void => {
		const view = shownView();
		if (view === null || readOnly || disposed) return;
		layDown(clip, landingFor(view, clip, middle ?? canvas.centre()));
	};

	/** The nodes named put on the clipboard by the menu, where no clipboard event brings the words. */
	const copyToClipboard = (ids: readonly string[]): void => {
		const clip = clipOf(ids);
		if (clip === null) return;
		void root.win.navigator.clipboard.writeText(writeFreeformClip(clip)).catch(notice);
	};

	/** What the clipboard holds laid down by the menu; says so where it holds no copy. */
	const pasteFromClipboard = (middle: CanvasPoint): void => {
		void root.win.navigator.clipboard.readText().then((words) => {
			if (disposed) return;
			const clip = readFreeformClip(words);
			if (clip === null) new Notice(t('freeformCanvas.node.pasteEmpty'));
			else paste(clip, middle);
		}).catch(notice);
	};

	/** The nodes named a step up or down among their neighbours. */
	const restack = (ids: readonly string[], to: 'forward' | 'backward'): void => {
		if (readOnly || disposed || ids.length === 0) return;
		void change([{ do: 'restack', ids, to }]);
	};

	// -- Choosing and looking about ----------------------------------------------

	/** Every node chosen; false where there is none, so the key goes on to whoever is next. */
	const selectAll = (): boolean => {
		if (made === null || made.scene.nodes.length === 0) return false;
		canvas.select({ nodes: made.scene.nodes.map((node) => node.id), edges: [] });
		canvas.focus();
		return true;
	};

	/** One node added to what is chosen, or taken out of it. */
	const chooseAlso = (id: string, on: boolean): void => {
		const nodes = on ? [...selection.nodes.filter((one) => one !== id), id] : selection.nodes.filter((one) => one !== id);
		canvas.select({ nodes, edges: selection.edges });
	};

	const fitAll = (): void => {
		canvas.moveViewport({ kind: 'fit', of: 'all' });
	};

	/** What is chosen brought into sight, a line by its two ends; false where nothing is. */
	const fitSelection = (): boolean => {
		if (selection.nodes.length > 0) {
			canvas.moveViewport({ kind: 'fit', of: 'selection' });
			return true;
		}
		const view = shownView();
		const ends = view === null
			? []
			: selection.edges.flatMap((id) => {
				const edge = findFreeformEdge(view, id);
				return edge === undefined ? [] : [edge.source, edge.target];
			});
		if (ends.length === 0) return false;
		canvas.moveViewport({ kind: 'fit', of: ends });
		return true;
	};

	const resetViewport = (): void => {
		canvas.moveViewport({ kind: 'reset' });
	};

	// -- Menus ---------------------------------------------------------------

	/** A menu shown under the pointer, or by what it was asked from where the keyboard asked. */
	const show = (menu: Menu, event: MouseEvent): void => {
		menus.keep(menu);
		const target = event.target;
		// A press of the keyboard comes with no place of its own.
		if (event.detail === 0 && target !== null && (target as Node).instanceOf(Element)) {
			const box = (target as Element).getBoundingClientRect();
			menu.showAtPosition({ x: box.left, y: box.bottom }, (target as Element).doc);
			return;
		}
		menu.showAtMouseEvent(event);
	};

	const openGroundMenu = (at: CanvasPoint, event: MouseEvent): void => {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.add'))
				.setIcon('plus')
				.setDisabled(readOnly || shownViewId === null)
				.onClick(() => {
					openAddNode(at);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.text.add'))
				.setIcon('type')
				.setDisabled(readOnly || shownViewId === null)
				.onClick(() => {
					addText(at);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.frame.add'))
				.setIcon('frame')
				.setDisabled(readOnly || shownViewId === null)
				.onClick(() => {
					openAddNode(at, 'frame');
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.link.add'))
				.setIcon('link')
				.setDisabled(readOnly || shownViewId === null)
				.onClick(() => {
					openAddNode(at, 'link');
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.paste'))
				.setIcon('clipboard-paste')
				.setDisabled(readOnly || shownViewId === null)
				.onClick(() => {
					pasteFromClipboard(at);
				});
		});
		menu.addSeparator();
		const standing = made !== null && made.scene.nodes.length > 0;
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.selectAll'))
				.setIcon('box-select')
				.setDisabled(!standing)
				.onClick(() => {
					selectAll();
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.fit.all'))
				.setIcon('maximize')
				.setDisabled(!standing)
				.onClick(fitAll);
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.fit.selection'))
				.setIcon('scan')
				.setDisabled(selection.nodes.length === 0 && selection.edges.length === 0)
				.onClick(() => {
					fitSelection();
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.reset.viewport'))
				.setIcon('rotate-ccw')
				.onClick(resetViewport);
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.snap'))
				.setIcon('grid-2x2')
				.setChecked(memory.snap)
				.onClick(() => {
					setSnap(!memory.snap);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.minimap.show'))
				.setIcon('map')
				.setChecked(memory.minimap)
				.onClick(() => {
					setMinimap(!memory.minimap);
				});
		});
		show(menu, event);
	};

	/** The way each kind of node opens, first in its menu; a note is opened second. */
	const addOpenItems = (menu: Menu, id: string, node: ResolvedNode): boolean => {
		if (node.type === 'text') {
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.text.edit'))
					.setIcon('pencil')
					.setDisabled(readOnly)
					.onClick(() => {
						editText(id);
					});
			});
			return true;
		}
		if (node.type === 'task') {
			menu.addItem((item) => {
				item.setTitle(t('freeformCanvas.open.task')).setIcon('list-todo').onClick(() => {
					openTask(node);
				});
			});
			return true;
		}
		if (node.type === 'foreshadowing') {
			menu.addItem((item) => {
				item.setTitle(t('freeformCanvas.open.manuscript')).setIcon('book-open').onClick(() => {
					openForeshadowing(node.item);
				});
			});
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.open.occurrence'))
					.setIcon('waypoints')
					.setDisabled(node.item.occurrences.length === 0)
					.onClick(() => {
						openPickOccurrence(node.item);
					});
			});
			return true;
		}
		if (node.type === 'revision') {
			menu.addItem((item) => {
				item.setTitle(t('freeformCanvas.open.manuscript')).setIcon('book-open').onClick(() => {
					openRevision(node);
				});
			});
			return true;
		}
		if (node.type === 'sticky-note') {
			menu.addItem((item) => {
				item.setTitle(t('stickyNotes.float')).setIcon('sticker').onClick(() => {
					floatSticky(node);
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('actions.openNote')).setIcon('file-text').onClick(() => {
					void host.openManagedFile(node.note.path).catch(notice);
				});
			});
			return true;
		}
		if (node.type === 'file') {
			menu.addItem((item) => {
				item.setTitle(t('common.open')).setIcon('file').onClick(() => {
					void host.openProjectFile(node.file.path).catch(notice);
				});
			});
			return true;
		}
		if (node.type === 'link') {
			menu.addItem((item) => {
				item.setTitle(t('freeformCanvas.link.open')).setIcon('external-link').onClick(() => {
					openLink(node);
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('freeformCanvas.link.copy')).setIcon('copy').onClick(() => {
					copyLink(node);
				});
			});
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.link.edit'))
					.setIcon('pencil')
					.setDisabled(readOnly)
					.onClick(() => {
						openLinkForm(id);
					});
			});
			return true;
		}
		if (node.type !== 'scene' && node.type !== 'character' && node.type !== 'worldbuilding') return false;
		menu.addItem((item) => {
			item
				.setTitle(t('actions.edit'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					openNode(id);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('actions.openNote'))
				.setIcon('file-text')
				.onClick(() => {
					openNote(node);
				});
		});
		return true;
	};

	/** What a frame's menu offers first: its form, its members chosen, and its box drawn afresh round them. */
	const addFrameItems = (menu: Menu, id: string): void => {
		const view = shownView();
		const holds = view !== null && membersOf(view, id).length > 0;
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.frame.edit'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					openFrameForm(id);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.frame.selectContents'))
				.setIcon('box-select')
				.setDisabled(!holds)
				.onClick(() => {
					selectContents(id);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.frame.fitContents'))
				.setIcon('shrink')
				.setDisabled(readOnly || !holds)
				.onClick(() => {
					fitToContents(id);
				});
		});
	};

	const openNodeMenu = (id: string, event: MouseEvent): void => {
		if (made === null || disposed) return;
		const node = made.nodes.get(id);
		const isFrame = made.frames.has(id);
		if (node === undefined && !isFrame) return;
		// A menu asked for on one of several chosen speaks for them all; on any other node, for that node alone.
		const chosen = selection.nodes.includes(id) ? selection.nodes : [id];
		const single = chosen.length === 1;
		const menu = new Menu();
		if (single && isFrame) {
			addFrameItems(menu, id);
			menu.addSeparator();
		}
		if (single && node !== undefined && addOpenItems(menu, id, node)) menu.addSeparator();
		// The face a node shows, for every placement chosen: the faces every one
		// of them has, checked where all of them show it. A kind with one face
		// has nothing to choose.
		const placements = chosen.flatMap((one) => (made?.nodes.has(one) === true ? [one] : []));
		const kinds = placements.flatMap((one) => {
			const node = made?.nodes.get(one);
			return node === undefined ? [] : [faceKindOf(node.type)];
		});
		const faces = FREEFORM_FACE_MODES.filter((face) => kinds.every((kind) => FREEFORM_FACE_MODES_OF[kind].includes(face)));
		if (placements.length > 0 && faces.length > 1) {
			const view = shownView();
			const modes = new Set(placements.map((one) => (view === null ? undefined : findFreeformPlacement(view, one)?.displayMode)));
			const shared = modes.size === 1 ? [...modes][0] ?? null : null;
			for (const mode of ['auto', ...faces] as const) {
				menu.addItem((item) => {
					item
						.setTitle(mode === 'auto' ? t('freeformCanvas.display.auto') : t(`corkboard.cards.${mode}`))
						.setChecked(shared === mode)
						.setDisabled(readOnly)
						.onClick(() => {
							setDisplay(placements, mode);
						});
				});
			}
			menu.addSeparator();
		}
		// Placements chosen are gathered into a frame, or given to one by name.
		if (placements.length > 0) {
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.frame.group'))
					.setIcon('group')
					.setDisabled(readOnly)
					.onClick(() => {
						groupIntoFrame(placements);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.frame.moveTo'))
					.setIcon('folder-input')
					.setDisabled(readOnly || (made?.frames.size ?? 0) === 0)
					.onClick(() => {
						openMoveToFrame(placements);
					});
			});
			menu.addSeparator();
		}
		if (single) {
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.node.connect'))
					.setIcon('spline')
					.setDisabled(readOnly || (made?.scene.nodes.length ?? 0) < 2)
					.onClick(() => {
						openConnectTo(id);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.node.geometry'))
					.setIcon('move')
					.setDisabled(readOnly)
					.onClick(() => {
						openGeometry(id);
					});
			});
			menu.addSeparator();
		}
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.duplicate'))
				.setIcon('copy-plus')
				.setDisabled(readOnly)
				.onClick(() => {
					duplicate(chosen);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.copy'))
				.setIcon('copy')
				.onClick(() => {
					copyToClipboard(chosen);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.forward'))
				.setIcon('bring-to-front')
				.setDisabled(readOnly)
				.onClick(() => {
					restack(chosen, 'forward');
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.node.backward'))
				.setIcon('send-to-back')
				.setDisabled(readOnly)
				.onClick(() => {
					restack(chosen, 'backward');
				});
		});
		menu.addSeparator();
		// The way to choose several without a key to hold: this node joins what is chosen, or leaves it.
		const among = selection.nodes.includes(id);
		menu.addItem((item) => {
			item
				.setTitle(t(among ? 'freeformCanvas.node.deselect' : 'freeformCanvas.node.select'))
				.setIcon(among ? 'square-minus' : 'square-plus')
				.onClick(() => {
					chooseAlso(id, !among);
				});
		});
		menu.addItem((item) => {
			item
				// A frame taken off leaves what it held standing, and free.
				.setTitle(t(single && isFrame ? 'freeformCanvas.frame.remove' : 'timeline.timeline.removeFromView'))
				.setIcon('eye-off')
				.setDisabled(readOnly)
				.onClick(() => {
					remove(chosen, selection.nodes.includes(id) ? selection.edges : []);
				});
		});
		show(menu, event);
	};

	const openEdgeMenu = (id: string, event: MouseEvent): void => {
		const view = shownView();
		const edge = view === null ? undefined : findFreeformEdge(view, id);
		if (edge === undefined || disposed) return;
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.edit'))
				.setIcon('pencil')
				.setDisabled(readOnly)
				.onClick(() => {
					openEdgeForm(id);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.reverse'))
				.setIcon('arrow-left-right')
				.setDisabled(readOnly)
				.onClick(() => {
					reconnect(id, { source: edge.target, target: edge.source, sourceSide: edge.targetSide, targetSide: edge.sourceSide });
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.changeStart'))
				.setIcon('log-out')
				.setDisabled(readOnly)
				.onClick(() => {
					openChangeEnd(id, 'source');
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.changeEnd'))
				.setIcon('log-in')
				.setDisabled(readOnly)
				.onClick(() => {
					openChangeEnd(id, 'target');
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.goStart'))
				.setIcon('locate')
				.onClick(() => {
					goToEnd(id, 'source');
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.goEnd'))
				.setIcon('locate-fixed')
				.onClick(() => {
					goToEnd(id, 'target');
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.edge.delete'))
				.setIcon('trash-2')
				.setDisabled(readOnly)
				.onClick(() => {
					// A menu asked for on one of several lines chosen speaks for them all.
					remove([], selection.edges.includes(id) ? selection.edges : [id]);
				});
		});
		show(menu, event);
	};

	const openMenu = (target: CanvasMenuTarget, event: MouseEvent): void => {
		if (disposed) return;
		if (target.kind === 'ground') openGroundMenu(target.at, event);
		else if (target.kind === 'node') openNodeMenu(target.id, event);
		else openEdgeMenu(target.id, event);
	};

	// -- What the canvas asks and tells ---------------------------------------

	const port: CanvasPort = {
		painter: (kind) => faces.painter(kind),
		commit: (changes) => {
			const step = placeStepOf(changes);
			if (step !== null) void change([step]);
		},
		connect: (link) => {
			connect(link.from, link.to, { fromSide: link.fromSide, toSide: link.toSide });
		},
		reconnect: (id, link) => {
			reconnect(id, { source: link.from, target: link.to, sourceSide: link.fromSide, targetSide: link.toSide });
		},
		selectionChanged: (next) => {
			selection = next;
		},
		viewportChanged: (viewport) => {
			if (shownViewId !== null) memory.viewports.set(shownViewId, viewport);
			paintZoom(viewport.zoom);
			// A colour panel hangs where its card's button stood; the card has moved from under it.
			deck.closeColorPanel();
		},
		menu: openMenu,
		open: (target) => {
			if (disposed) return;
			if (target.kind === 'ground') addText(target.at);
			else if (target.kind === 'node') openNode(target.id);
			else openEdgeForm(target.id);
		},
		key: (event) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return false;
			if (event.key === 'Delete' || event.key === 'Backspace') {
				if (readOnly || (selection.nodes.length === 0 && selection.edges.length === 0)) return false;
				remove(selection.nodes, selection.edges);
				return true;
			}
			if (event.key === 'Escape') {
				if (selection.nodes.length === 0 && selection.edges.length === 0) return false;
				canvas.select(NO_CANVAS_SELECTION);
				return true;
			}
			return false;
		},
		clipboard: (kind, event) => {
			if (disposed || shownViewId === null) return false;
			const data = event.clipboardData;
			if (data === null) return false;
			if (kind === 'paste') {
				if (readOnly) return false;
				const clip = readFreeformClip(data.getData('text/plain'));
				if (clip === null) return false;
				paste(clip);
				return true;
			}
			const clip = clipOf(selection.nodes);
			if (clip === null) return false;
			data.setData('text/plain', writeFreeformClip(clip));
			// A cut in a project that cannot be written is a copy: nothing is taken off.
			if (kind === 'cut' && !readOnly) remove(selection.nodes, selection.edges);
			return true;
		},
		gestureEnded: () => {
			loop.paintOwed();
		},
		failed: (error) => {
			console.error('Snowflake: the freeform canvas could not be drawn', error);
			if (engineFailed || disposed) return;
			engineFailed = true;
			paintAll();
		},
	};

	mounted += 1;
	const canvas = controls.mountCanvas(ground, port, {
		id: `snowflake-method-freeform-${String(mounted)}`,
		viewport: DEFAULT_FREEFORM_VIEWPORT,
		interaction: {
			ground: 'pan',
			snap: memory.snap ? FREEFORM_GRID : null,
			minimap: memory.minimap,
			readOnly: true,
		},
		zoom: FREEFORM_ZOOM,
		labels: { canvas: t('storyStructure.family.freeform'), minimap: t('freeformCanvas.minimap') },
		// A move shown is timed by the window the plugin was loaded in, which may
		// not be drawing while the canvas stands in a window of its own.
		reduceMotion: () => host.isReduceMotionEnabled() || !controls.atHome(root),
		additive: (event) => Keymap.isModifier(event, 'Mod') || event.shiftKey,
	});
	paintZoom(DEFAULT_FREEFORM_VIEWPORT.zoom);

	// -- The views' forms ----------------------------------------------------

	const chooseView = (chosen: string): void => {
		if (chosen.length === 0 || chosen === viewId) return;
		viewId = chosen;
		paintAll();
	};

	const openAddView = (): void => {
		const read = reading;
		if (read === null || readOnly || disposed) return;
		keep(new FreeformViewFormModal(
			app,
			t,
			{ mode: 'add', initial: '', takenNames: read.held.views.map((view) => view.name) },
			async (name) => {
				if (disposed) return;
				const came: { made: string | null } = { made: null };
				await enqueue(async () => {
					came.made = await controls.bridge().createView(name);
					// Shown once a read holds it, which the one that follows this write does.
					if (came.made !== null) awaitedViewId = came.made;
				});
				// That read has landed: a view it did not bring back is not waited on any longer.
				if (awaitedViewId === came.made) awaitedViewId = null;
				if (came.made === null && !disposed) throw new Error(t('freeformCanvas.view.createRefused'));
			},
		)).open();
	};

	const openEditView = (): void => {
		const read = reading;
		const view = viewId === null ? null : fileView(viewId);
		if (read === null || view === null || readOnly || disposed) return;
		keep(new FreeformViewFormModal(
			app,
			t,
			{
				mode: 'edit',
				initial: view.name,
				takenNames: read.held.views.filter((candidate) => candidate.id !== view.id).map((candidate) => candidate.name),
				deleteView: async () => {
					if (disposed) return false;
					const now = fileView(view.id) ?? view;
					const lost = ownWordsCount(now);
					const confirmed = await confirmTimelineAction(app, t, {
						title: t('timeline.view.deleteTitle', { name: now.name }),
						lines: [
							t('freeformCanvas.view.deleteDescription', {
								nodes: now.placements.length,
								edges: now.edges.length,
								frames: now.frames.length,
							}),
							...(lost === 0 ? [] : [t('freeformCanvas.words.lost', { count: lost })]),
						],
						label: t('actions.delete'),
					}, keep);
					if (!confirmed || disposed) return false;
					// The form closes on this answer, so it is the file's answer and
					// not the asking: a view the project would not let go stands, and
					// its form stands open with it, saying so.
					const came = { gone: false };
					await enqueue(async () => {
						came.gone = await controls.bridge().deleteView(view.id);
					});
					if (came.gone) {
						memory.viewports.delete(view.id);
						histories.delete(view.id);
					} else if (!disposed) {
						new Notice(t('timeline.view.deleteRefused'));
					}
					return came.gone;
				},
			},
			async (name) => {
				if (disposed) return;
				// The form stays open over a write that did not land: a view's name
				// is nowhere but in the form until it is written.
				const came: { wrote: FreeformCame } = { wrote: 'written' };
				await enqueue(async () => {
					// Against the view as it stands now, so a name already so is not written again.
					const standingName = (fileView(view.id) ?? view).name;
					if (name !== standingName) came.wrote = await controls.bridge().renameView(view.id, name);
				});
				if (came.wrote !== 'written' && !disposed) throw new Error(t('freeformCanvas.view.renameRefused'));
			},
		)).open();
	};

	// -- Keys heard ahead of the app's own -------------------------------------

	/** Whether a chord is the canvas's to take: never one pressed in a field, where it is the field's. */
	const chordFree = (): boolean => {
		if (disposed || stage.classList.contains('is-hidden')) return false;
		const active = root.doc.activeElement;
		if (active === null || active === root.doc.body) return true;
		return root.contains(active) && active.closest(FIELD_SELECTOR) === null;
	};
	const chords = [
		// A chord with nothing to take back is not taken, so it goes on to whoever is next.
		controls.chord(['Mod'], 'z', () => !chordFree() || !undo()),
		controls.chord(['Mod', 'Shift'], 'z', () => !chordFree() || !redo()),
		controls.chord(['Mod'], 'a', () => !chordFree() || !selectAll()),
		// The search's own field is the one field the chord is taken in: pressed there, it chooses the words again.
		controls.chord(['Mod'], 'f', () => {
			if (disposed || stage.classList.contains('is-hidden')) return true;
			if (!chordFree() && root.doc.activeElement !== search.inputEl) return true;
			focusSearch();
			return false;
		}),
		controls.chord(['Mod'], 'd', () => !chordFree() || !duplicate(selection.nodes)),
		controls.chord(['Shift'], '1', () => {
			if (!chordFree()) return true;
			fitAll();
			return false;
		}),
		controls.chord(['Shift'], '2', () => !chordFree() || !fitSelection()),
		controls.chord(['Shift'], '0', () => {
			if (!chordFree()) return true;
			resetViewport();
			return false;
		}),
	];

	paintAll();
	void reload();

	const handle: FreeformHandle = {
		refresh: () => {
			// Nothing read means the project was not there to be read when the
			// last read went out; the model landing is the word that it may be
			// there now, so the document is asked for again.
			if (reading === null) void reload();
			else paintAll();
		},
		reveal: (id) => {
			const view = shownView();
			const placement = view?.placements.find(({ resource }) => resource.type === 'entity' && resource.id === id);
			if (placement === undefined) return;
			canvas.moveViewport({ kind: 'reveal', id: placement.id });
			canvas.select({ nodes: [placement.id], edges: [] });
			canvas.focus();
		},
		remeasure: () => {
			canvas.remeasure();
		},
		saveFocusedConflict: () => faces.keepFocused() || keepFocusedCard(),
		dispose: () => {
			if (disposed) return;
			// The order is a rule, as it is the timeline's: the bell, the keys,
			// the menus and the dialogs, and only then the words still being
			// written and where the nodes were left, which go to the file as a
			// leave sends them.
			loop.release();
			unsubscribeResources?.();
			unsubscribeResources = null;
			for (const stop of chords) stop();
			menus.hideAll('Snowflake: a freeform menu could not be closed');
			modals.closeAll('Snowflake: a freeform dialog could not be closed');
			leaveShown();
			disposed = true;
			canvas.dispose();
			// The cards' own words go last, through the deck's queue, which outlives the workspace.
			unbindDeckWindow();
			deck.dispose();
			viewField?.destroy();
			root.remove();
		},
	};
	return handle;
};
