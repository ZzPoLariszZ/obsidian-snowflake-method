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
 * The drawing itself is the engine's (`relationship-graph-engine.ts`),
 * raised once in a host of its own that outlives every repaint, and fed a
 * picture on each reading. The engine says where the view was moved to and
 * what was clicked; the shell keeps the one and answers the other.
 */

import { Notice } from 'obsidian';

import {
	buildEntityGraph,
	defaultEntityGraphState,
	EMPTY_ENTITY_GRAPH,
	GRAPH_CUSTOM_KIND_COLOR_NAMES,
	GRAPH_DEFAULT_COLOR_NAMES,
	indexGraphForQueries,
	isWorldbuildingKind,
	patchEntityGraphState,
	sameEntityGraphState,
	type EntityGraph,
	type EntityGraphState,
	type GraphEdge,
	type GraphNode,
	type GraphQueryIndex,
	type GraphViewport,
} from '../domain';
import { buildOptionField, type OptionPicker } from './option-picker';
import type {
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
import { pictureOf } from './relationship-graph-model';
import type { GraphClickModifiers, GraphColors, GraphHandle, GraphPort } from './relationship-graph-port';
import { renderSceneManuscriptPane } from './scene-manuscript-pane';
import {
	RELATIONSHIP_GRAPH_VIEWS,
	isRelationshipGraphView,
	type RelationshipGraphView,
} from './story-structure-state';
import {
	balanceToolbar,
	createSearchField,
	toolbarEnd,
	toolbarIconButton,
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

/** Whether two states set the picture alike, the viewport aside: the engine moves that, and the scene has an echo rule of its own for it. */
const sameControls = (a: EntityGraphState, b: EntityGraphState): boolean =>
	sameEntityGraphState({ ...a, viewport: null }, { ...b, viewport: null });

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
	/** The graph of the reading held, built once per reading, with its index for the search. */
	let graph: EntityGraph = EMPTY_ENTITY_GRAPH;
	let index: GraphQueryIndex | null = null;
	let nodesById = new Map<string, GraphNode>();

	const root = container.createDiv({ cls: 'snowflake-method-relationship-graph' });

	// -- The engine ----------------------------------------------------------

	let engine: GraphHandle | null = null;
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
		void controls.bridge().updateEntities({ viewport: view }).catch(notice);
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
		void controls.bridge().updateEntities(patch).catch(notice);
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

	/** A node opens its form, or with the modifier its note; a target no note answers to opens nothing. */
	const openNode = (id: string, modifiers: GraphClickModifiers): void => {
		const node = nodesById.get(id);
		if (node === undefined || reading === null) return;
		const projectPath = reading.projectPath;
		controls.activateProject();
		if (modifiers.mod) {
			if (node.path !== null) void host.openProjectFile(node.path).catch(notice);
			return;
		}
		if (node.group === 'character') void host.openCharacterForm(node.id, projectPath).catch(notice);
		else if (node.group === 'scene') void host.openSceneForm({ mode: 'edit', id: node.id }, projectPath).catch(notice);
		else if (node.group === 'worldbuilding') {
			void host.openEntityForm({ mode: 'edit', id: node.id }, projectPath).catch(notice);
		}
	};
	/** A line opens the form of the entity that holds it. */
	const openEdge = (edge: GraphEdge): void => {
		openNode(edge.source, { mod: false, shift: false });
	};

	const port: GraphPort = {
		nodeClicked: openNode,
		edgeClicked: openEdge,
		nodeMenu: () => undefined,
		edgeMenu: () => undefined,
		backgroundMenu: () => undefined,
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
	// lines and the rest dimmed. It narrows nothing, since a relationship is
	// a line between two nodes and a picture cut down to a name would show a
	// lone disc. The other view has nothing of its own to search, so the
	// field is put away with the symbols while that view is shown.
	const searchField = createSearchField(toolbar, {
		placeholder: t('relationshipGraph.search'),
		query: (words) => {
			memory.query = words;
			paintStage();
		},
		step: () => undefined,
		leave: () => undefined,
	});
	const end = toolbarEnd(toolbar);
	const iconButton = (cls: string, icon: string, label: string): HTMLButtonElement =>
		toolbarIconButton(end, cls, icon, label);
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
	const refreshButton = iconButton('snowflake-method-relationship-graph-refresh', 'refresh-cw', t('corkboard.refresh'));
	refreshButton.addEventListener('click', () => {
		void controls.refresh().then(() => reload()).catch(notice);
	});
	const stopBalance = balanceToolbar(toolbar, { start: viewHost, end });

	// -- The stage -------------------------------------------------------------

	// The engine's ground outlives every repaint, so the layout is never
	// started over; the sheet beside it is drawn afresh each time, with the
	// words that stand in for the graph while there is nothing to draw or
	// while the tab stands in for Obsidian's own.
	const stage = root.createDiv({ cls: 'snowflake-method-relationship-graph-stage' });
	const canvasHost = stage.createDiv({ cls: 'snowflake-method-relationship-graph-canvas' });
	const sheet = stage.createDiv({ cls: 'snowflake-method-relationship-graph-sheet' });
	const panel = renderGraphControls(stage, {
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
			memory.query = text;
			searchField.input.value = text;
			paintStage();
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

	/** The picture of the reading held handed to the engine, and the file's view when it changed from outside. */
	const drawScene = (read: RelationshipGraphReading): void => {
		const first = engine === null;
		const handle = ensureEngine();
		const colors = themeColors();
		const state = read.held.entities;
		const picture = pictureOf({
			graph,
			state,
			search: memory.query,
			focus: memory.focus,
			customKinds: read.kinds.filter((kind) => kind.custom).map((kind) => kind.id),
			index: index ?? undefined,
		});
		handle.setScene({ picture, display: state.display, forces: state.forces, colors });
		const next = state.viewport;
		if (first || (!sameViewport(next, readViewport) && !sameViewport(next, writtenViewport))) {
			handle.setViewport(next);
		}
		readViewport = next;
	};

	/** The stage drawn afresh for the view shown and the document read. */
	const paintStage = (): void => {
		sheet.empty();
		root.toggleClass('is-entities', memory.view === 'entities');
		root.toggleClass('is-scene-manuscript', memory.view === 'scene-manuscript');
		root.toggleClass('is-read-only', reading?.readOnly === true);
		root.toggleClass('is-controls-open', memory.controlsOpen);
		const empty = reading !== null && graph.edges.length === 0;
		root.toggleClass('is-empty', empty);
		panel.setOpen(memory.controlsOpen);
		if (memory.view === 'entities') {
			if (empty) {
				sheet.createEl('p', { cls: 'snowflake-method-tab-planned', text: t('relationshipGraph.empty') });
			} else if (reading !== null) {
				drawScene(reading);
				panel.setQuery(memory.query);
				panel.refresh();
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
		const read = await controls.bridge().read();
		if (disposed) return;
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
			flushState();
			flushViewport();
			app.workspace.offref(themeRef);
			unsubscribe();
			stopBalance();
			searchField.dispose();
			viewField.destroy();
			if (engine !== null) {
				memory.positions = engine.places();
				engine.dispose();
				engine = null;
			}
			panel.dispose();
			root.remove();
		},
	};
}
