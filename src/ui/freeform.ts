/**
 * The freeform workspace: a plane the project's resources are set out on,
 * one view at a time of the several a project may keep. A view keeps where
 * things stand and never what they are, so what a node shows is read from
 * the project as it is painted, and a change made here moves, sizes, adds or
 * removes a node and touches no note.
 *
 * The plane itself is the engine's (`freeform-canvas.ts`), handed in so a
 * test stands a plain one in its place; what stands in a node's box is the
 * faces' (`freeform-faces.ts`); the read, the queue and the paint's gate are
 * the loop's (`document-loop.ts`), shared with the timeline and the beat
 * sheet; what was done, kept to be taken back, is the history's
 * (`freeform-history.ts`). This is what is left: the toolbar, the canvas's
 * controls, the menus, the views' forms, and the one way every change goes
 * to the file and into the history.
 *
 * A change is shown the moment it is made and written after: the view as
 * the canvas shows it is the view as its file has it with every change still
 * on its way made to it, so a node dropped stays where it was dropped while
 * its write is in flight, and goes back only if the file would not take it.
 * Taking a change back is one more change, written the same way.
 */

import { Keymap, Menu, Notice } from 'obsidian';

import {
	DEFAULT_FREEFORM_VIEWPORT,
	FREEFORM_SIZE,
	FREEFORM_ZOOM,
	applyFreeformSteps,
	findFreeformPlacement,
	findFreeformView,
	freeformRoom,
	leaveFreeformView,
	shownFreeformViewId,
	type FreeformCame,
	type FreeformFrame,
	type FreeformPlacement,
	type FreeformStep,
	type FreeformView,
} from '../domain';
import { createDocumentLoop, type DocumentLoop } from './document-loop';
import type { FreeformHandle, FreeformReading, RenderFreeform } from './freeform-bridge';
import { zoomPercent, zoomStep } from './freeform-canvas-model';
import {
	NO_CANVAS_SELECTION,
	type CanvasMenuTarget,
	type CanvasPoint,
	type CanvasPort,
	type CanvasSelection,
} from './freeform-canvas-port';
import { createFreeformFaces } from './freeform-faces';
import { FreeformTextModal, FreeformViewFormModal, type RecoveredFreeformText } from './freeform-forms';
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
	FREEFORM_GRID,
	cornersOf,
	grownHeight,
	laidOutAlike,
	landingAt,
	ownWordsCount,
	placeStepOf,
	plainFirstLine,
	sceneOf,
	type FreeformSceneMade,
	type FreeformSceneWords,
} from './freeform-layout';
import {
	freeformFileName,
	freeformLabelOf,
	resolvePlacement,
	type ResolvedNode,
} from './freeform-resources';
import { kindIcon } from './kind-icon';
import { buildOptionField, type OptionPicker } from './option-picker';
import { renderEmptyLine } from './pane-parts';
import { confirmTimelineAction } from './timeline-forms';
import type { ProjectDashboardModel } from './view-model';
import { createMenuKeeper, createModalKeeper, toolbarIconButton } from './workspace-frame';

/** How many of a text node's first words it is called by, for a reader that cannot see it. */
const NAME_LENGTH = 80;

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
	const root = container.createDiv({ cls: 'snowflake-method-prose-panel snowflake-method-freeform' });

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
	const refreshButton = toolbarIconButton(toolbar, 'snowflake-method-freeform-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().then(() => reload()).catch(notice);
	});
	const addViewButton = toolbar.createEl('button', {
		cls: 'mod-cta snowflake-method-freeform-view-add',
		text: t('timeline.view.add'),
		attr: { type: 'button' },
	});
	addViewButton.addEventListener('click', () => {
		openAddView();
	});
	const addNodeButton = toolbar.createEl('button', {
		cls: 'mod-cta snowflake-method-freeform-node-add',
		text: t('freeformCanvas.node.add'),
		attr: { type: 'button' },
	});
	addNodeButton.addEventListener('click', () => {
		// Text is the one kind of node there is to add as yet, so the press
		// adds one: at the middle of what is in sight, open to be typed into.
		addText();
	});

	// -- The stage: the canvas, the word said of an empty one, and its controls --

	const empty = renderEmptyLine(root, '');
	const stage = root.createDiv({ cls: 'snowflake-method-freeform-stage is-hidden' });
	const ground = stage.createDiv({ cls: 'snowflake-method-freeform-ground' });
	const hint = stage.createDiv({ cls: 'snowflake-method-freeform-hint is-hidden' });
	renderEmptyLine(hint, t('freeformCanvas.empty.nodes'));
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

	const labelOf = (node: ResolvedNode): string => {
		if (node.type === 'text') {
			const first = plainFirstLine(node.text, NAME_LENGTH);
			return first.length === 0 ? t('freeformCanvas.text.label') : first;
		}
		if (node.type === 'link') return node.label.length > 0 ? node.label : node.host;
		if (node.type === 'file') return node.file.name;
		if (node.type === 'missing') return node.name;
		if (node.type === 'pending') return lastCalled(node.placement);
		return freeformLabelOf(node)?.name ?? lastCalled(node.placement);
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
				return 'pencil-line';
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

	const words: FreeformSceneWords = {
		resolve: (placement) => {
			// A paint is made only once a model stands; the guard is the type's.
			if (model === null) return { type: 'pending', placement, of: 'file' };
			return resolvePlacement(placement, model, null);
		},
		label: labelOf,
		frameLabel: frameLabelOf,
		revision: (node) =>
			node.type === 'text'
				? `${node.placement.displayMode}\n${node.text}`
				: `${node.type}\n${node.placement.displayMode}\n${iconOf(node)}\n${labelOf(node)}`,
		locked: (id) => id === editingId,
		// Lines are drawn from node to node in a later stage; one a file holds is shown all the same.
		connectable: false,
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
			canvas.setScene(EMPTY_FREEFORM_SCENE);
			hint.toggleClass('is-hidden', true);
			fitButton.disabled = true;
			return;
		}
		const shown = draft !== null && draft.viewId === id
			? { ...view, placements: [...view.placements, draft.placement] }
			: view;
		made = sceneOf(shown, words);
		canvas.setInteraction({
			readOnly,
			ground: dragDraws ? 'select' : 'pan',
			snap: memory.snap ? FREEFORM_GRID : null,
			minimap: memory.minimap,
		});
		canvas.setScene(made.scene);
		hint.toggleClass('is-hidden', made.scene.nodes.length > 0);
		fitButton.disabled = made.scene.nodes.length === 0;
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
			showEmpty(t('freeformCanvas.empty.views'));
			return;
		}
		showEmpty(null);
		paintScene();
	};

	// -- Writing -------------------------------------------------------------

	/** Says why a change did not land: in the words handed in, or in the view's own. */
	const say = (came: FreeformCame, words?: string): void => {
		if (came === 'written' || disposed) return;
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
	 * `gone` is what to say for a change taken back or made again that the
	 * view can no longer take.
	 */
	const change = async (
		steps: readonly FreeformStep[],
		turnOf: FreeformHistoryTurn = 'change',
		gone?: string,
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

	const faces = createFreeformFaces({
		app,
		t,
		component: controls.component,
		sourcePath: () => controls.projectPath() ?? '',
		node: (id) => made?.nodes.get(id),
		frame: (id) => made?.frames.get(id),
		icon: iconOf,
		label: labelOf,
		frameLabel: frameLabelOf,
		editing: () => editingId,
		textLimit: () => reading?.limits.textLength ?? 0,
		menu: (id, event) => {
			openNodeMenu(id, event);
		},
		keepText,
		leaveText,
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

	// -- Looking about -------------------------------------------------------

	const fitAll = (): void => {
		canvas.moveViewport({ kind: 'fit', of: 'all' });
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
				.setTitle(t('freeformCanvas.text.add'))
				.setIcon('type')
				.setDisabled(readOnly || shownViewId === null)
				.onClick(() => {
					addText(at);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.fit.all'))
				.setIcon('maximize')
				.setDisabled(made === null || made.scene.nodes.length === 0)
				.onClick(fitAll);
		});
		menu.addItem((item) => {
			item
				.setTitle(t('freeformCanvas.reset.viewport'))
				.setIcon('rotate-ccw')
				.onClick(resetViewport);
		});
		show(menu, event);
	};

	const openNodeMenu = (id: string, event: MouseEvent): void => {
		if (made === null || disposed) return;
		const node = made.nodes.get(id);
		if (node === undefined && !made.frames.has(id)) return;
		// A menu asked for on one of several chosen speaks for them all; on any other node, for that node alone.
		const chosen = selection.nodes.includes(id) ? selection.nodes : [id];
		const menu = new Menu();
		if (node?.type === 'text' && chosen.length === 1) {
			menu.addItem((item) => {
				item
					.setTitle(t('freeformCanvas.text.edit'))
					.setIcon('pencil')
					.setDisabled(readOnly)
					.onClick(() => {
						editText(id);
					});
			});
			menu.addSeparator();
		}
		menu.addItem((item) => {
			item
				.setTitle(t('timeline.timeline.removeFromView'))
				.setIcon('eye-off')
				.setDisabled(readOnly)
				.onClick(() => {
					remove(chosen, selection.nodes.includes(id) ? selection.edges : []);
				});
		});
		show(menu, event);
	};

	const openMenu = (target: CanvasMenuTarget, event: MouseEvent): void => {
		if (disposed) return;
		if (target.kind === 'ground') openGroundMenu(target.at, event);
		else if (target.kind === 'node') openNodeMenu(target.id, event);
	};

	// -- What the canvas asks and tells ---------------------------------------

	const port: CanvasPort = {
		painter: (kind) => faces.painter(kind),
		commit: (changes) => {
			const step = placeStepOf(changes);
			if (step !== null) void change([step]);
		},
		connect: () => undefined,
		reconnect: () => undefined,
		selectionChanged: (next) => {
			selection = next;
		},
		viewportChanged: (viewport) => {
			if (shownViewId !== null) memory.viewports.set(shownViewId, viewport);
			paintZoom(viewport.zoom);
		},
		menu: openMenu,
		open: (target) => {
			if (disposed) return;
			if (target.kind === 'ground') addText(target.at);
			else if (target.kind === 'node') editText(target.id);
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
		clipboard: () => undefined,
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
		controls.chord(['Shift'], '1', () => {
			if (!chordFree()) return true;
			fitAll();
			return false;
		}),
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
		saveFocusedConflict: () => faces.keepFocused(),
		dispose: () => {
			if (disposed) return;
			// The order is a rule, as it is the timeline's: the bell, the keys,
			// the menus and the dialogs, and only then the words still being
			// written and where the nodes were left, which go to the file as a
			// leave sends them.
			loop.release();
			for (const stop of chords) stop();
			menus.hideAll('Snowflake: a freeform menu could not be closed');
			modals.closeAll('Snowflake: a freeform dialog could not be closed');
			leaveShown();
			disposed = true;
			canvas.dispose();
			viewField?.destroy();
			root.remove();
		},
	};
	return handle;
};
