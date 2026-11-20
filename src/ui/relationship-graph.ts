/**
 * The relationship graph workspace: the fifth tab of the Visualization
 * workspace, with two views of one project's relationships. The entities
 * view draws the project's characters, scenes and worldbuilding notes as
 * nodes and every relationship record line as a labelled line between
 * holder and target, on a stage of its own. The scenes-and-manuscript view
 * opens Obsidian's own graph in a tab of its own, set to the project, and
 * this tab stands in for it with a pane that says what was set.
 *
 * The toolbar rides the strip's row as the timeline's does: the view at its
 * start, the search in the middle, the symbols at the end. What the tab
 * shows and whether the controls stand open are the layout's to keep; the
 * words searched for and where the nodes stand last the session; how the
 * graph is filtered, coloured, drawn and left is the file's.
 *
 * Under the stage a timeline can be opened: the project's times as one
 * axis, the graph drawn as it stands at the one the thumb is on, and a
 * time-lapse that runs the axis from there to its end. Whether it stands
 * open is the layout's, the time it is on the session's, and how a dated
 * line is read the file's, with the other controls.
 *
 * The drawing itself is the engine's (`relationship-graph-engine.ts`),
 * raised once in a host of its own that outlives every repaint, and fed a
 * picture on each reading. The engine says where the view was moved to and
 * what was clicked; the shell keeps the one and answers the other.
 */

import { Keymap, Notice, type Menu } from 'obsidian';

import {
	buildEntityGraph,
	buildGraphTimeline,
	defaultEntityGraphState,
	EMPTY_ENTITY_GRAPH,
	EMPTY_GRAPH_TIMELINE,
	GRAPH_CUSTOM_KIND_COLOR_NAMES,
	GRAPH_DEFAULT_COLOR_NAMES,
	hiddenAt,
	indexGraphForQueries,
	isWorldbuildingKind,
	NO_UNDATED_PARTS,
	patchEntityGraphState,
	sameEntityGraphState,
	sameGraphTimeline,
	timeChanges,
	undatedHeldAt,
	undatedParts,
	UNRESOLVED_GROUP,
	type EntityGraph,
	type EntityGraphState,
	type GraphEdge,
	type GraphNode,
	type GraphQueryIndex,
	type GraphTimeline,
	type GraphTimeRule,
	type GraphUndatedRule,
	type GraphViewport,
	type TimeChange,
	type UndatedParts,
} from '../domain';
import { mountFullScreenButton, toolbarKept } from './full-screen';
import { buildOptionField, type OptionPicker } from './option-picker';
import type {
	RelationshipGraphBridge,
	RelationshipGraphControls,
	RelationshipGraphHandle,
	RelationshipGraphReading,
} from './relationship-graph-bridge';
import { probeGraphColors } from './relationship-graph-canvas';
import {
	GRAPH_STATE_SAVE_MS,
	hexOfColor,
	renderGraphControls,
	type GraphControlsKind,
} from './relationship-graph-controls';
import { inBox, type Point } from './relationship-graph-layout';
import { addPanItems, addWholeGraphItem, buildBackgroundMenu, buildEdgeMenu, buildNodeMenu, type GraphMenuDeps } from './relationship-graph-menus';
import { pictureBase, pictureFrom, tabOrder, type GraphPicture, type PictureBase } from './relationship-graph-model';
import type { GraphClickModifiers, GraphColors, GraphHandle, GraphPort } from './relationship-graph-port';
import { renderGraphTimeline, type TimelinePoint } from './relationship-graph-timeline';
import { playbackFrame, playbackSchedule, type PlaybackSchedule } from './relationship-graph-timeline-layout';
import { renderEmptyLine } from './pane-parts';
import { writeUnderWay } from './pending-writes';
import { renderSceneManuscriptPane } from './scene-manuscript-pane';
import {
	RELATIONSHIP_GRAPH_VIEWS,
	isRelationshipGraphView,
	type RelationshipGraphView,
} from './story-structure-state';
import {
	balanceToolbar,
	createSearchField,
	gatherToolbarActions,
	paintSymbol,
	toolbarEnd,
	toolbarIconButton,
	type SymbolMemo,
} from './workspace-frame';

/** The word each view goes by in the field. */
const VIEW_WORDS: Record<RelationshipGraphView, string> = {
	entities: 'relationshipGraph.view.entities',
	'scene-manuscript': 'relationshipGraph.view.sceneManuscript',
};

/** The theme accents the default groups draw with, read off the body once per theme. */
export const GRAPH_ACCENT_NAMES: readonly string[] = [
	...Object.values(GRAPH_DEFAULT_COLOR_NAMES),
	...GRAPH_CUSTOM_KIND_COLOR_NAMES,
];

/** How long the view may keep moving before where it stands is written to the file. */
export const VIEWPORT_SAVE_MS = 1500;

/** The symbol the timeline's switch wears on the toolbar. */
export const TIMELINE_SYMBOL = 'chart-gantt';

/** The longest a frame of the time-lapse counts for, in ms: a window put away and brought back carries on where it stood. */
const PLAY_FRAME_MAX_MS = 100;

/** Whether two states set the picture alike, the viewport aside: the engine moves that, and the scene has an echo rule of its own for it. */
const sameControls = (a: EntityGraphState, b: EntityGraphState): boolean =>
	sameEntityGraphState({ ...a, viewport: null }, { ...b, viewport: null });

/** How far an arrow key takes a node or the view, in screen pixels, and with Shift held. */
export const KEY_STEP = 10;
export const KEY_STEP_FAST = 50;
/** How much a key or a symbol zooms the view by. */
export const ZOOM_STEP = 1.25;

const sameViewport = (a: GraphViewport | null, b: GraphViewport | null): boolean =>
	a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.k === b.k);

export function renderRelationshipGraph(
	container: HTMLElement,
	controls: RelationshipGraphControls,
): RelationshipGraphHandle {
	const { app, host, t, memory } = controls;
	const win = container.win;
	const notice = (error: unknown): void => {
		new Notice(error instanceof Error ? error.message : t('errors.unknown'));
	};
	let disposed = false;
	let reading: RelationshipGraphReading | null = null;
	/**
	 * The bridge the reading was read through, which its owed writes go
	 * back to: the controls' own may stand on another project by the time
	 * a write falls due, as a tab moved on does before the old graph is
	 * taken down.
	 */
	let readBridge: RelationshipGraphBridge | null = null;
	/** The graph of the reading held, built once per reading, with its index for the search. */
	let graph: EntityGraph = EMPTY_ENTITY_GRAPH;
	let index: GraphQueryIndex | null = null;
	let nodesById = new Map<string, GraphNode>();
	/**
	 * The timeline of the reading held, built when the strip first asks for
	 * it and again when the graph or the rule it was built by moves.
	 */
	let timeline: GraphTimeline = EMPTY_GRAPH_TIMELINE;
	let timelineOf: { graph: EntityGraph; rule: GraphTimeRule } | null = null;
	/** What every picture of the filters, the search and the groups standing is drawn from, whatever the time. */
	let base: PictureBase | null = null;
	/** What each time changes among the lines the filters leave, and the same as the strip draws its points by. */
	let changes: TimeChange[] = [];
	let points: TimelinePoint[] = [];
	/** The counts the changes come to, written out: a time-lapse scheduled over others has nothing left to follow. */
	let changesKey = '';
	/** Whether some line in sight names a time. */
	let dated = false;
	/** The lines in sight that name no time, and the nodes none of the dated ones touches. */
	let undated: UndatedParts = NO_UNDATED_PARTS;
	/** Where those stand along the axis, by the file's word: there before it starts, or held back to its end. */
	let undatedRule: GraphUndatedRule = 'before';
	/**
	 * While a time-lapse runs or has just been paused mid-time: how many of
	 * the lines entering at a time are shown yet. Null is all of them.
	 */
	let partial: { index: number; revealed: number } | null = null;
	/** The time-lapse while it runs: what it follows, how long it has run, and where it last drew. */
	let play: {
		schedule: PlaybackSchedule;
		/** The time it started on, whose lines stood already unless it began afresh. */
		from: number;
		fresh: boolean;
		key: string;
		elapsed: number;
		last: number | null;
		frame: number | null;
		index: number;
		revealed: number;
	} | null = null;

	const root = container.createDiv({ cls: 'snowflake-method-relationship-graph' });

	// -- The engine ----------------------------------------------------------

	let engine: GraphHandle | null = null;
	/** The picture drawn last, which the keys walk. */
	let lastPicture: GraphPicture | null = null;
	/** The theme's colours, read when first drawn and again after a theme change. */
	let colors: GraphColors | null = null;
	/** The viewport the last reading carried, so only a change from outside moves the view. */
	let readViewport: GraphViewport | null = null;
	/** The viewport last written, whose own echo from the file must not move the view either. */
	let writtenViewport: GraphViewport | null = null;
	let owedViewport: GraphViewport | null = null;
	let viewportTimer: number | null = null;

	const flushViewport = (): void => {
		if (viewportTimer !== null) {
			win.clearTimeout(viewportTimer);
			viewportTimer = null;
		}
		const view = owedViewport;
		owedViewport = null;
		if (view === null || reading === null || reading.readOnly) return;
		if (sameViewport(view, reading.held.entities.viewport)) return;
		writtenViewport = view;
		void writeUnderWay((readBridge ?? controls.bridge()).updateEntities({ viewport: view })).catch(notice);
	};
	const queueViewport = (view: GraphViewport): void => {
		if (reading === null || reading.readOnly) return;
		owedViewport = view;
		if (viewportTimer !== null) win.clearTimeout(viewportTimer);
		viewportTimer = win.setTimeout(() => {
			viewportTimer = null;
			flushViewport();
		}, VIEWPORT_SAVE_MS);
	};

	// The controls write the state a part at a time: the picture takes each
	// change at once, the file takes them together once the hand rests.
	let owedState: Partial<EntityGraphState> | null = null;
	let stateTimer: number | null = null;
	/** The entities as the file last gave them, to tell a ring that moved nothing from a change made outside. */
	let readEntities: EntityGraphState | null = null;
	/** What the file will give back for each write of ours still on its way, oldest first: the picture shows them already. */
	let echoesOwed: EntityGraphState[] = [];
	const flushState = (): void => {
		if (stateTimer !== null) {
			win.clearTimeout(stateTimer);
			stateTimer = null;
		}
		const patch = owedState;
		owedState = null;
		if (patch === null || reading === null) return;
		echoesOwed.push(reading.held.entities);
		void writeUnderWay((readBridge ?? controls.bridge()).updateEntities(patch)).catch(notice);
	};
	const changeState = (patch: Partial<EntityGraphState>): void => {
		if (reading === null || reading.readOnly) return;
		reading = { ...reading, held: { ...reading.held, entities: patchEntityGraphState(reading.held.entities, patch) } };
		owedState = { ...(owedState ?? {}), ...patch };
		if (stateTimer !== null) win.clearTimeout(stateTimer);
		stateTimer = win.setTimeout(() => {
			stateTimer = null;
			flushState();
		}, GRAPH_STATE_SAVE_MS);
		paintStage();
	};
	/**
	 * The entities to draw once the file has been read again. A reading that
	 * gives a write of ours back, or moved nothing, leaves the picture on what
	 * the panel last set, which may be ahead of the file by a change still
	 * owed: taken as read, the file would undo that change for the moment its
	 * write takes to land, and the switch would flash. A change made outside
	 * is taken, with what is owed on top. The viewport is always the file's;
	 * the scene tells its own echo apart.
	 */
	const entitiesAfterReading = (held: EntityGraphState | null, incoming: EntityGraphState): EntityGraphState => {
		const echoed = echoesOwed.findIndex((echo) => sameControls(echo, incoming));
		if (echoed >= 0) echoesOwed.splice(0, echoed + 1);
		const moved = readEntities === null || !sameControls(incoming, readEntities);
		readEntities = incoming;
		if (held !== null && (echoed >= 0 || !moved)) return { ...held, viewport: incoming.viewport };
		echoesOwed = [];
		return owedState === null ? incoming : patchEntityGraphState(incoming, owedState);
	};

	/** The node kinds the graph has, in the project's order, each by its name. */
	const kindsPresent = (): GraphControlsKind[] => {
		const present = new Set(graph.nodes.map((node) => node.kind));
		const kinds: GraphControlsKind[] = [];
		if (present.has('character')) kinds.push({ id: 'character', name: t('relationshipGraph.filter.characters') });
		if (present.has('scene')) kinds.push({ id: 'scene', name: t('relationshipGraph.filter.scenes') });
		for (const kind of reading?.kinds ?? []) {
			if (!present.has(kind.id)) continue;
			kinds.push({ id: kind.id, name: isWorldbuildingKind(kind.id) ? t(`worldbuilding.kind.${kind.id}`) : kind.id });
		}
		return kinds;
	};

	const openNote = (path: string): void => {
		controls.activateProject();
		void host.openProjectFile(path).catch(notice);
	};
	/** A node opens its form, or with the modifier its note; a target no note answers to opens nothing. */
	const openNode = (id: string, modifiers: GraphClickModifiers): void => {
		const node = nodesById.get(id);
		if (node === undefined || reading === null) return;
		const projectPath = reading.projectPath;
		if (modifiers.mod) {
			if (node.path !== null) openNote(node.path);
			return;
		}
		controls.activateProject();
		if (node.group === 'character') void host.openCharacterForm(node.id, projectPath).catch(notice);
		else if (node.group === 'scene') void host.openSceneForm({ mode: 'edit', id: node.id }, projectPath).catch(notice);
		else if (node.group === 'worldbuilding') {
			void host.openEntityForm({ mode: 'edit', id: node.id }, projectPath).catch(notice);
		}
	};
	/** A line opens the form of the entity that holds it. */
	/**
	 * A line opens its holder's form on the record's card. The holder is a
	 * member, since only a target can be unresolved; a refusal is said here,
	 * in the project's own words.
	 */
	const openEdge = (edge: GraphEdge): void => {
		const node = nodesById.get(edge.source);
		if (node === undefined || node.group === UNRESOLVED_GROUP || reading === null) return;
		controls.activateProject();
		void host
			.openRelationship({ group: node.group, id: node.id }, edge.record, reading.projectPath)
			.then((opened) => {
				if (!opened) new Notice(t('relationshipGraph.edit.refused'));
			})
			.catch(notice);
	};

	const port: GraphPort = {
		nodeClicked: openNode,
		edgeClicked: openEdge,
		nodeMenu: (id, event) => {
			buildNodeMenu(menuDeps, id)?.showAtMouseEvent(event);
		},
		edgeMenu: (edge, event) => {
			buildEdgeMenu(menuDeps, edge).showAtMouseEvent(event);
		},
		backgroundMenu: (event) => {
			buildBackgroundMenu(menuDeps).showAtMouseEvent(event);
		},
		viewportMoved: queueViewport,
		focusChanged: () => undefined,
	};

	// -- The toolbar ---------------------------------------------------------

	const toolbar = root.createDiv({
		cls: 'snowflake-method-relationship-graph-toolbar snowflake-method-balanced-toolbar',
		attr: { role: 'toolbar', 'aria-label': t('relationshipGraph.toolbar') },
	});
	const viewHost = toolbar.createDiv({
		cls: 'snowflake-method-toolbar-start snowflake-method-relationship-graph-view-select',
	});
	// The search marks the entities view, as the searches of the other
	// workspaces mark theirs: the nodes that answer it are lit with their
	// lines and the rest dimmed, Enter brings them into the middle one by
	// one with the keyboard's ring on each, and the field's end counts them.
	// The ring goes with the words, so nothing of a search outlasts it. It
	// narrows nothing, since a relationship is a line between two nodes and
	// a picture cut down to a name would show a lone disc. The other view
	// has nothing of its own to search, so the field is put away with the
	// symbols while that view is shown.
	/** The node the search last brought into sight, by id so it keeps its place through a paint. */
	let hitId: string | null = null;
	/** The shown nodes the search found, in the order Tab walks them. */
	const hitsOf = (): GraphNode[] => {
		const picture = lastPicture;
		if (picture === null || picture.matches === null) return [];
		const { matches } = picture;
		return tabOrder(picture.nodes.filter((node) => matches.has(node.id)));
	};
	/** What the search says of itself at the field's end: how many it found, which of them is in sight, or that none matched. */
	const paintSearchCount = (): void => {
		if (lastPicture === null || lastPicture.matches === null) {
			searchField.count.setText('');
			return;
		}
		const hits = hitsOf();
		if (hits.length === 0) {
			searchField.count.setText(t('relationshipGraph.search.none'));
			return;
		}
		const at = hitId === null ? -1 : hits.findIndex((node) => node.id === hitId);
		searchField.count.setText(
			at === -1
				? t(hits.length === 1 ? 'freeformCanvas.search.matchesOne' : 'freeformCanvas.search.matches', { count: hits.length })
				: t('freeformCanvas.search.position', { at: at + 1, count: hits.length }),
		);
	};
	/** The next node found brought into the middle with the ring on it, or the one before; round again at either end. */
	const stepSearch = (step: 1 | -1): void => {
		const hits = hitsOf();
		if (hits.length === 0 || engine === null) return;
		const at = hitId === null ? -1 : hits.findIndex((node) => node.id === hitId);
		const next = at === -1 ? (step === 1 ? 0 : hits.length - 1) : (at + step + hits.length) % hits.length;
		hitId = hits[next]!.id;
		engine.focusNode(hitId);
		engine.centreOn(hitId);
		paintSearchCount();
	};
	const setQuery = (words: string): void => {
		if (words === memory.query) return;
		memory.query = words;
		// The ring the search put on comes off with the words it answered; one the keys put there stays.
		if (hitId !== null && engine?.focusedNode() === hitId) engine.focusNode(null);
		hitId = null;
		paintStage();
	};
	const searchField = createSearchField(toolbar, {
		placeholder: t('relationshipGraph.search'),
		query: setQuery,
		step: stepSearch,
		leave: () => undefined,
	});
	const end = toolbarEnd(toolbar);
	const iconButton = (cls: string, icon: string, label: string): HTMLButtonElement =>
		toolbarIconButton(end, cls, icon, label);
	// A touch screen has no wheel and no right button: these three stand in,
	// and are shown only there.
	const zoomInButton = iconButton('snowflake-method-relationship-graph-zoom-in', 'zoom-in', t('relationshipGraph.zoomIn'));
	zoomInButton.addEventListener('click', () => {
		engine?.zoomBy(ZOOM_STEP);
	});
	const zoomOutButton = iconButton('snowflake-method-relationship-graph-zoom-out', 'zoom-out', t('relationshipGraph.zoomOut'));
	zoomOutButton.addEventListener('click', () => {
		engine?.zoomBy(1 / ZOOM_STEP);
	});
	const moreButton = iconButton('snowflake-method-relationship-graph-more', 'ellipsis', t('relationshipGraph.menu'));
	moreButton.setAttribute('aria-haspopup', 'menu');
	moreButton.addEventListener('click', (event) => {
		const focused = engine?.focusedNode() ?? null;
		const menu = focused === null ? buildBackgroundMenu(menuDeps) : buildNodeMenu(menuDeps, focused);
		menu?.showAtMouseEvent(event);
	});
	const fitButton = iconButton('snowflake-method-relationship-graph-fit', 'maximize', t('relationshipGraph.fit'));
	fitButton.addEventListener('click', () => {
		engine?.fit();
	});
	const resetViewButton = iconButton(
		'snowflake-method-relationship-graph-reset-view',
		'locate-fixed',
		t('relationshipGraph.resetView'),
	);
	resetViewButton.addEventListener('click', () => {
		engine?.resetView();
	});
	// The controls panel folds open and shut from one symbol, which says what
	// stands now; the fold is the layout's, like the view.
	const controlsButton = iconButton(
		'snowflake-method-relationship-graph-controls',
		'sliders-horizontal',
		t('relationshipGraph.controls'),
	);
	const foldControls = (open: boolean): void => {
		memory.controlsOpen = open;
		controlsButton.setAttribute('aria-pressed', open ? 'true' : 'false');
		controls.remember();
		paintStage();
	};
	controlsButton.setAttribute('aria-pressed', memory.controlsOpen ? 'true' : 'false');
	controlsButton.addEventListener('click', () => {
		foldControls(!memory.controlsOpen);
	});
	// The timeline stands under the stage and folds from one symbol, whose
	// name says what a press does; the fold is the layout's, as the panel's is.
	const timelineButton = iconButton(
		'snowflake-method-relationship-graph-timeline-toggle',
		TIMELINE_SYMBOL,
		t('relationshipGraph.timeline.show'),
	);
	const timelineMemo: SymbolMemo = { icon: TIMELINE_SYMBOL };
	const paintTimelineButton = (): void => {
		paintSymbol(timelineButton, timelineMemo, {
			icon: TIMELINE_SYMBOL,
			label: t(memory.timelineOpen ? 'relationshipGraph.timeline.hide' : 'relationshipGraph.timeline.show'),
			pressed: memory.timelineOpen,
			disabled: false,
		});
	};
	const foldTimeline = (open: boolean): void => {
		stopPlay();
		memory.timelineOpen = open;
		paintTimelineButton();
		controls.remember();
		// The graph of one time and the whole graph ease into each other, as two times do.
		paintStage(true);
	};
	paintTimelineButton();
	timelineButton.addEventListener('click', () => {
		foldTimeline(!memory.timelineOpen);
	});
	const refreshButton = iconButton('snowflake-method-relationship-graph-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().catch(notice);
	});
	const fullScreenButton = mountFullScreenButton(end, refreshButton, t, controls.fullScreen);
	// The graph's own menu is the ground's or the focused node's; on a tablet
	// its button is put away unlisted and the gathered menu carries what the
	// toolbar's buttons do not: the focused node's items without the fit the
	// list has, else the way back from a local graph and the pan's twin. The
	// stand-in tab, which draws no graph, adds nothing.
	gatherToolbarActions(end, {
		t,
		keep: toolbarKept(fullScreenButton, refreshButton),
		omit: [moreButton],
		extend: (menu) => {
			if (memory.view !== 'entities') return;
			const focused = engine?.focusedNode() ?? null;
			if (focused !== null) {
				buildNodeMenu(menuDeps, focused, { into: menu, fit: false });
				return;
			}
			addWholeGraphItem(menu, menuDeps);
			addPanItems(menu, menuDeps);
		},
	});
	const stopBalance = balanceToolbar(toolbar, { start: viewHost, end });

	// -- The stage -------------------------------------------------------------

	// The engine's ground outlives every repaint, so the layout is never
	// started over; the sheet beside it is drawn afresh each time, with the
	// words that stand in for the graph while there is nothing to draw or
	// while the tab stands in for Obsidian's own.
	// The stage is a column: the ground the graph is drawn on, with the sheet
	// and the controls panel in its corner, and under it the timeline when it
	// is open, so the ground ends above the strip and the panel keeps clear.
	const stage = root.createDiv({ cls: 'snowflake-method-relationship-graph-stage' });
	const ground = stage.createDiv({ cls: 'snowflake-method-relationship-graph-ground' });
	const canvasHost = ground.createDiv({
		cls: 'snowflake-method-relationship-graph-canvas',
		attr: { tabindex: '0', role: 'application', 'aria-label': t('relationshipGraph.view.entities') },
	});
	const sheet = ground.createDiv({ cls: 'snowflake-method-relationship-graph-sheet' });

	const menuDeps: GraphMenuDeps = {
		t,
		node: (id) => nodesById.get(id),
		focus: () => memory.focus,
		controlsOpen: () => memory.controlsOpen,
		isPinned: (id) => engine?.isPinned(id) ?? false,
		open: (node) => {
			if (node.path !== null) openNote(node.path);
		},
		edit: (node) => {
			openNode(node.id, { mod: false });
		},
		editRelationship: openEdge,
		showLocal: (id) => {
			memory.focus = id;
			paintStage();
		},
		showWhole: () => {
			memory.focus = null;
			paintStage();
		},
		pin: (id, on) => engine?.pinNode(id, on),
		nudge: (id, dx, dy) => engine?.nudgeNode(id, dx, dy),
		pan: (dx, dy) => engine?.panBy(dx, dy),
		fit: () => engine?.fit(),
		resetView: () => engine?.resetView(),
		foldControls,
	};

	/** A menu opened from the keyboard, at a node's disc or in the middle of the ground. */
	const showMenuAt = (menu: Menu | null, place: Point | null): void => {
		if (menu === null) return;
		const box = canvasHost.getBoundingClientRect();
		const at = place ?? { x: canvasHost.clientWidth / 2, y: canvasHost.clientHeight / 2 };
		menu.showAtPosition({ x: box.left + at.x, y: box.top + at.y }, canvasHost.doc);
	};

	// The keys, on the ground that holds the keyboard: Tab walks the nodes by
	// name, Enter opens the one it stands on, the arrows move it or the view,
	// and each has its twin on a menu.
	canvasHost.addEventListener('keydown', (event) => {
		const handle = engine;
		if (handle === null || lastPicture === null) return;
		const focused = handle.focusedNode();
		const step = event.shiftKey ? KEY_STEP_FAST : KEY_STEP;
		const used = (): void => {
			event.preventDefault();
			event.stopPropagation();
		};
		// A chord with a modifier held is a hotkey's, Obsidian's or the user's
		// own, and passes; only Enter keeps its modifier, which says how the
		// node opens.
		if ((event.metaKey || event.ctrlKey || event.altKey) && event.key !== 'Enter') return;
		switch (event.key) {
			case 'Tab': {
				const order = tabOrder(lastPicture.nodes);
				if (order.length === 0) return;
				const at = focused === null ? -1 : order.findIndex((node) => node.id === focused);
				const next = event.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at + 1) % order.length;
				const id = order[next]!.id;
				handle.focusNode(id);
				const place = handle.screenPlaceOf(id);
				if (place === null || !inBox(place, canvasHost.clientWidth, canvasHost.clientHeight, 0)) handle.centreOn(id);
				used();
				return;
			}
			case 'Enter':
				if (focused === null) return;
				openNode(focused, { mod: Keymap.isModEvent(event) !== false });
				used();
				return;
			case 'ArrowUp':
			case 'ArrowDown':
			case 'ArrowLeft':
			case 'ArrowRight': {
				const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
				const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
				// A node goes the way the arrow points; the view moves as the camera does.
				if (focused !== null) handle.nudgeNode(focused, dx, dy);
				else handle.panBy(-dx, -dy);
				used();
				return;
			}
			case '+':
			case '=':
				handle.zoomBy(ZOOM_STEP);
				used();
				return;
			case '-':
			case '_':
				handle.zoomBy(1 / ZOOM_STEP);
				used();
				return;
			case '0':
				handle.resetView();
				used();
				return;
			case 'f':
			case 'F':
				handle.fit();
				used();
				return;
			case 'p':
			case 'P':
				if (focused === null) return;
				handle.pinNode(focused, !handle.isPinned(focused));
				used();
				return;
			case 'Escape':
				if (focused !== null) handle.focusNode(null);
				else canvasHost.blur();
				used();
				return;
			case 'ContextMenu':
			case 'F10':
				if (event.key === 'F10' && !event.shiftKey) return;
				if (focused === null) showMenuAt(buildBackgroundMenu(menuDeps), null);
				else showMenuAt(buildNodeMenu(menuDeps, focused), handle.screenPlaceOf(focused));
				used();
				return;
			default:
				return;
		}
	});
	const panel = renderGraphControls(ground, {
		t,
		state: () => reading?.held.entities ?? defaultEntityGraphState(),
		query: () => memory.query,
		kinds: kindsPresent,
		customKinds: () => reading?.kinds.filter((kind) => kind.custom).map((kind) => kind.id) ?? [],
		labels: () => graph.labels,
		focus: () => (memory.focus === null ? null : (nodesById.get(memory.focus)?.name ?? null)),
		readOnly: () => reading?.readOnly ?? true,
		accentHex: (name) => hexOfColor(themeColors().accents[name] ?? ''),
		onQuery: (text) => {
			searchField.input.value = text;
			setQuery(text);
		},
		onChange: changeState,
		onFold: foldControls,
		onShowWhole: () => {
			memory.focus = null;
			paintStage();
		},
	});

	// Choosing the native view opens the graph tab once, there and then; a
	// repaint, or a tab restored on this view, only shows the pane, whose
	// button opens the graph again.
	const openSceneManuscript = (): void => {
		void controls
			.bridge()
			.openSceneManuscriptGraph()
			.then((opening) => {
				if (opening === 'disabled') new Notice(t('relationshipGraph.sceneManuscript.disabled'));
				if (opening === 'unavailable') new Notice(t('relationshipGraph.sceneManuscript.unavailable'));
			})
			.catch(notice);
	};
	const resetSceneManuscript = (): void => {
		void controls
			.bridge()
			.resetSceneManuscriptGraph()
			.then((wrote) => {
				if (wrote === 'written') new Notice(t('relationshipGraph.sceneManuscript.resetDone'));
			})
			.catch(notice);
	};
	const chooseView = (chosen: string): void => {
		if (!isRelationshipGraphView(chosen) || chosen === memory.view) return;
		memory.view = chosen;
		controls.remember();
		paintAll();
		if (chosen === 'scene-manuscript') openSceneManuscript();
	};
	const viewField: OptionPicker = buildOptionField(app, viewHost, {
		options: () => RELATIONSHIP_GRAPH_VIEWS.map((view) => ({ value: view, label: t(VIEW_WORDS[view]) })),
		label: t('relationshipGraph.view'),
		placeholder: t('relationshipGraph.view'),
		emptyPlaceholder: t('relationshipGraph.view'),
		value: () => memory.view,
		choose: chooseView,
	});

	/** The engine, raised the first time there is a graph to draw, with where the nodes stood last. */
	const ensureEngine = (): GraphHandle => {
		if (engine !== null) return engine;
		engine = controls.canvas(canvasHost, port);
		if (memory.positions.size > 0) engine.setPlaces(memory.positions);
		return engine;
	};

	/** The theme's colours, read once and kept until the theme changes. */
	const themeColors = (): GraphColors => {
		colors ??= probeGraphColors(canvasHost, GRAPH_ACCENT_NAMES);
		return colors;
	};

	// -- The timeline ----------------------------------------------------------

	/** Whether the graph is drawn at one time: the strip open on the entity view, and the project has times. */
	const timed = (): boolean =>
		memory.timelineOpen && memory.view === 'entities' && timeline.times.length > 0;
	/** The time the thumb stands on: the one the session remembers, or the first. */
	const timeIndex = (): number => {
		if (memory.time === null) return 0;
		const at = timeline.times.findIndex((time) => time.id === memory.time);
		return at < 0 ? 0 : at;
	};
	/** The timeline of the reading held, by the rule the file keeps; built only while the strip asks for it. */
	const readTimeline = (read: RelationshipGraphReading): void => {
		const rule = read.held.entities.timeline.rule;
		if (!memory.timelineOpen || memory.view !== 'entities') return;
		if (timelineOf !== null && timelineOf.graph === graph && timelineOf.rule === rule) return;
		const built = buildGraphTimeline({ members: read.members, graph, times: read.times, resolve: read.resolveTarget, rule });
		const moved = !sameGraphTimeline(timeline, built);
		// The new timeline stands before anything is drawn from it: stopping a
		// time-lapse draws the time it reached, and must draw it from this one.
		timeline = built;
		timelineOf = { graph, rule };
		// A time-lapse carries on through a reading that says the same; one that
		// moved a time or a dated line has nothing left to follow.
		if (play !== null && moved) stopPlay();
	};
	/** What each time changes among the lines the base holds, and the points the strip draws by. */
	const readChanges = (): void => {
		const standing = base !== null && timed();
		undatedRule = reading?.held.entities.timeline.undated ?? 'before';
		undated = base !== null && standing ? undatedParts(timeline, base.shown, base.edges) : NO_UNDATED_PARTS;
		changes = base !== null && standing ? timeChanges(timeline, base.edges, undatedRule) : [];
		changesKey = changes.map((change) => `${String(change.entering.length)}/${String(change.leaving.length)}`).join(',');
		// The lines that name a time, and no others: an undated line set at the axis's end is no date.
		dated = undated.dated;
		points = timeline.times.map((time, at) => ({
			name: time.name,
			period: time.kind === 'period',
			changes: (changes[at]?.entering.length ?? 0) + (changes[at]?.leaving.length ?? 0) > 0,
		}));
		if (play !== null && play.key !== changesKey) stopPlay();
	};
	/**
	 * Whether the lines and notes no time is said of are held back at a time:
	 * the file's rule says after the axis ends, this is not its last time, and
	 * some line in sight is dated, without which there is no axis to wait on.
	 */
	const holdsUndated = (at: number): boolean => dated && undatedHeldAt(timeline, at, undatedRule);
	/**
	 * The lines the picture leaves out: the dated ones not standing at the
	 * time, the ones a time-lapse has yet to bring in, and the undated ones
	 * while they are held back.
	 */
	const hiddenNow = (): Set<string> | null => {
		if (!timed()) return null;
		const at = timeIndex();
		const waiting = partial !== null && partial.index === at ? (changes[at]?.entering.slice(partial.revealed) ?? []) : [];
		const hidden = hiddenAt(timeline, at, waiting);
		if (holdsUndated(at)) for (const id of undated.edges) hidden.add(id);
		return hidden;
	};
	/**
	 * The nodes that wait for a line to bring them in: the ones no dated line
	 * touches, while the undated are held back, and at the axis's end while a
	 * time-lapse is still bringing their lines in, so each comes with its
	 * first. Null where every node stands as the filters leave it.
	 */
	const heldNow = (): ReadonlySet<string> | null => {
		if (!timed() || !dated || undatedRule !== 'after') return null;
		const at = timeIndex();
		if (holdsUndated(at)) return undated.nodes;
		return partial !== null && partial.index === at ? undated.nodes : null;
	};

	const strip = renderGraphTimeline(stage, {
		t,
		seek: (at) => {
			stopPlay();
			setTime(at);
		},
		step: (by) => {
			stopPlay();
			setTime(timeIndex() + by);
		},
		toggle: () => {
			if (play === null) startPlay();
			else stopPlay();
		},
		pause: () => {
			stopPlay();
		},
		leave: () => {
			canvasHost.focus();
		},
	});
	const paintStrip = (thumb?: number): void => {
		// A strip out of sight is left as it was: it is drawn again when it is opened.
		if (!memory.timelineOpen || memory.view !== 'entities' || graph.edges.length === 0) return;
		const at = timeIndex();
		strip.paint({ points, current: at, thumb: thumb ?? at, playing: play !== null, dated });
	};

	/** The picture of the reading held handed to the engine, and the file's view when it changed from outside. */
	const drawScene = (read: RelationshipGraphReading, fade = false): void => {
		const first = engine === null;
		const handle = ensureEngine();
		const colors = themeColors();
		const state = read.held.entities;
		if (base === null) {
			base = pictureBase({
				graph,
				state,
				search: memory.query,
				customKinds: read.kinds.filter((kind) => kind.custom).map((kind) => kind.id),
				index: index ?? undefined,
			});
			readChanges();
		}
		const picture = pictureFrom(base, memory.focus, hiddenNow(), heldNow());
		lastPicture = picture;
		handle.setScene({ picture, display: state.display, forces: state.forces, colors, fade });
		paintSearchCount();
		const next = state.viewport;
		if (first || (!sameViewport(next, readViewport) && !sameViewport(next, writtenViewport))) {
			handle.setViewport(next);
		}
		readViewport = next;
	};

	/**
	 * Another time, drawn alone: the picture of it from the base standing,
	 * eased in the engine, and the strip. The sheet and the panel are not the
	 * time's to redraw.
	 */
	const drawTime = (): void => {
		if (reading === null || memory.view !== 'entities' || graph.edges.length === 0) return;
		drawScene(reading, true);
		paintStrip();
	};
	const setTime = (at: number): void => {
		const count = timeline.times.length;
		if (count === 0) return;
		const next = Math.max(0, Math.min(count - 1, at));
		const id = timeline.times[next]?.id ?? null;
		if (id === memory.time && partial === null) {
			paintStrip();
			return;
		}
		memory.time = id;
		partial = null;
		drawTime();
	};

	/** The time-lapse ended where it stands: the time it reached is shown whole, the thumb on it. */
	const stopPlay = (): void => {
		if (play === null) return;
		if (play.frame !== null) win.cancelAnimationFrame(play.frame);
		play = null;
		const shown = partial !== null;
		partial = null;
		if (disposed) return;
		if (shown) drawTime();
		else paintStrip();
	};
	/** One frame of the time-lapse, off the clock: the time and the lines it has reached, then the thumb. */
	const playFrame = (now: number): void => {
		const running = play;
		if (running === null || disposed || reading === null) return;
		running.frame = null;
		// A stage out of sight has no frames worth drawing: the time-lapse waits where it is.
		if (canvasHost.clientWidth === 0) {
			stopPlay();
			return;
		}
		running.elapsed += running.last === null ? 0 : Math.min(Math.max(0, now - running.last), PLAY_FRAME_MAX_MS);
		running.last = now;
		const at = playbackFrame(running.schedule, running.elapsed);
		if (at.index !== running.index || at.revealed !== running.revealed) {
			running.index = at.index;
			running.revealed = at.revealed;
			memory.time = timeline.times[at.index]?.id ?? null;
			// The time it started on stood whole already, unless it began afresh.
			partial = at.index === running.from && !running.fresh ? null : { index: at.index, revealed: at.revealed };
			drawScene(reading, true);
		}
		if (at.done) {
			play = null;
			// While the last time's lines came in, the notes no time is said of
			// came each with its first: the ones with no line at all stand now
			// that the axis has ended.
			const waited = partial !== null && heldNow() !== null;
			partial = null;
			if (waited) drawScene(reading, true);
			paintStrip();
			return;
		}
		paintStrip(at.thumb);
		running.frame = win.requestAnimationFrame(playFrame);
	};
	/** The time-lapse from the time the thumb is on to the last; from the last, over again from the first. */
	const startPlay = (): void => {
		const count = timeline.times.length;
		if (play !== null || !timed() || !dated || count < 2 || reading === null) return;
		const here = timeIndex();
		const fresh = here >= count - 1;
		const from = fresh ? 0 : here;
		const schedule = playbackSchedule(
			changes.map((change) => ({ entering: change.entering.length, leaving: change.leaving.length })),
			from,
			{ fresh, stagger: !host.isReduceMotionEnabled() },
		);
		play = { schedule, from, fresh, key: changesKey, elapsed: 0, last: null, frame: null, index: -1, revealed: -1 };
		play.frame = win.requestAnimationFrame(playFrame);
		paintStrip();
	};

	/**
	 * The stage drawn afresh for the view shown and the document read; eased
	 * where the caller says the picture is another time's or another fold's.
	 */
	const paintStage = (fade = false): void => {
		sheet.empty();
		root.toggleClass('is-entities', memory.view === 'entities');
		root.toggleClass('is-scene-manuscript', memory.view === 'scene-manuscript');
		root.toggleClass('is-read-only', reading?.readOnly === true);
		root.toggleClass('is-controls-open', memory.controlsOpen);
		const empty = reading !== null && graph.edges.length === 0;
		root.toggleClass('is-empty', empty);
		root.toggleClass('is-timeline-open', memory.timelineOpen && memory.view === 'entities' && !empty);
		panel.setOpen(memory.controlsOpen);
		// The filters, the search and the groups may have moved: the base is worked out again.
		base = null;
		if (memory.view !== 'entities' || empty) stopPlay();
		if (memory.view === 'entities') {
			if (empty) {
				searchField.count.setText('');
				renderEmptyLine(sheet, t('relationshipGraph.empty'));
			} else if (reading !== null) {
				readTimeline(reading);
				// A reading that lands while a time-lapse runs is drawn as its next frame would be.
				drawScene(reading, fade || play !== null);
				panel.setQuery(memory.query);
				panel.refresh();
				paintStrip();
			}
		} else if (reading !== null) {
			renderSceneManuscriptPane(sheet, {
				t,
				standing: controls.bridge().sceneManuscript(),
				stored: reading.held.sceneManuscript !== null,
				readOnly: reading.readOnly,
				open: openSceneManuscript,
				reset: resetSceneManuscript,
			});
		}
	};
	const paintAll = (): void => {
		viewField.refresh();
		paintStage();
	};
	const reload = async (): Promise<void> => {
		const bridge = controls.bridge();
		const read = await bridge.read();
		if (disposed) return;
		readBridge = read === null ? null : bridge;
		if (read === null) {
			readEntities = null;
			echoesOwed = [];
		}
		const next =
			read === null
				? null
				: {
						...read,
						held: {
							...read.held,
							entities: entitiesAfterReading(reading?.held.entities ?? null, read.held.entities),
						},
					};
		reading = next;
		graph = next === null ? EMPTY_ENTITY_GRAPH : buildEntityGraph(next.members, next.resolveTarget);
		index = next === null ? null : indexGraphForQueries(graph);
		nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
		if (next === null) {
			stopPlay();
			timeline = EMPTY_GRAPH_TIMELINE;
			timelineOf = null;
		}
		paintAll();
	};
	const unsubscribe = controls.bridge().subscribe(() => {
		void reload().catch(notice);
	});
	// A theme change may have recoloured the graph's ground and discs.
	const themeRef = app.workspace.on('css-change', () => {
		colors = null;
		if (memory.view === 'entities') paintStage();
	});
	void reload().catch(notice);

	return {
		refresh: () => {
			void reload().catch(notice);
		},
		reveal: (id) => {
			engine?.centreOn(id);
			engine?.focusNode(id);
		},
		remeasure: () => {
			engine?.remeasure();
		},
		saveFocusedBody: () => false,
		dispose: () => {
			disposed = true;
			stopPlay();
			flushState();
			flushViewport();
			app.workspace.offref(themeRef);
			unsubscribe();
			stopBalance();
			strip.dispose();
			searchField.dispose();
			viewField.destroy();
			if (engine !== null) {
				// The places are the reading's project's, and the memory is the
				// controls' project's: not the same once a tab has moved on.
				if (reading !== null && reading.projectPath === controls.projectPath()) memory.positions = engine.places();
				engine.dispose();
				engine = null;
			}
			panel.dispose();
			root.remove();
		},
	};
}
