/**
 * The canvas as the workspace holds it: what stands on it, what is chosen,
 * where it is looked at from, and the engine that draws it. All of that is
 * kept here, outside the engine, so the engine can be taken down and put up
 * again -- when its view is moved to another window, when its tab was opened
 * out of sight -- and lose nothing the author had in hand.
 *
 * The engine's own code is React and is not taken until a canvas is first
 * shown: a project that never opens the tab never pays for it, and the tests
 * that load the plugin never load the engine.
 */

import {
	boundsOf,
	centreOf,
	centredOn,
	fitViewport,
	gestureChanges,
	hasUntold,
	isViewport,
	reconcileEdges,
	reconcileNodes,
	reduceEdgeChanges,
	reduceNodeChanges,
	sameSelection,
	sameViewport,
	selectionOf,
	steppedViewport,
	withSelection,
	zoomBandOf,
} from './freeform-canvas-model';
import {
	NO_CANVAS_SELECTION,
	type CanvasFlow,
	type CanvasHandle,
	type CanvasRoot,
	type CanvasRootModule,
	type CanvasScene,
	type CanvasSelection,
	type CanvasSnapshot,
	type CanvasViewport,
	type CanvasViewportTarget,
	type LoadCanvasRoot,
	type MountFreeformCanvas,
	type PaintedNode,
} from './freeform-canvas-port';
import { bindCanvasWindow, type CanvasWindow } from './freeform-canvas-window';

/** The class the engine's own stylesheet is kept under, and the plugin's dress of it. */
export const FREEFORM_CANVAS_CLASS = 'snowflake-method-freeform-canvas';

/** How long the keyboard must rest before the places it nudged nodes to are handed over, in milliseconds. */
const NUDGE_REST_MS = 400;

/** How long a move of the viewport takes where it is shown moving, in milliseconds. */
const MOVE_MS = 200;

/** Where a press begins something of its own: words being written, a choice from a list. */
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

function withinField(target: EventTarget | null): boolean {
	if (target === null || !(target as Node).instanceOf(Element)) return false;
	return (target as Element).closest(FIELD_SELECTOR) !== null;
}

/**
 * The way a canvas is raised, given the way the engine's code is brought.
 * The two are told apart so the plugin names the engine's module where its
 * bundle is put together, and a test names it where it stands.
 */
export const freeformCanvasMount = (loadRoot: LoadCanvasRoot): MountFreeformCanvas => (host, port, options) => {
	host.addClass(FREEFORM_CANVAS_CLASS);
	host.setAttribute('tabindex', '-1');

	let snapshot: CanvasSnapshot = {
		nodes: [],
		edges: [],
		interaction: options.interaction,
		panning: false,
		band: zoomBandOf(options.viewport.zoom, null),
		size: { width: 0, height: 0 },
	};
	const listeners = new Set<() => void>();
	const publish = (next: CanvasSnapshot): void => {
		if (next === snapshot) return;
		snapshot = next;
		for (const listener of [...listeners]) listener();
	};
	const set = (change: Partial<CanvasSnapshot>): void => {
		const keys = Object.keys(change) as (keyof CanvasSnapshot)[];
		if (keys.every((key) => change[key] === snapshot[key])) return;
		publish({ ...snapshot, ...change });
	};

	let disposed = false;
	let module: CanvasRootModule | null = null;
	let root: CanvasRoot | null = null;
	let container: HTMLElement | null = null;
	let flow: CanvasFlow | null = null;
	let viewport: CanvasViewport = isViewport(options.viewport) ? options.viewport : { x: 0, y: 0, zoom: 1 };
	/** A move asked for before the engine stood, or while the canvas had no size to work one out by. */
	let waiting: CanvasViewportTarget | null = { kind: 'exact', viewport };
	/** The scene handed over while a gesture was in flight, drawn when it ends. */
	let owed: CanvasScene | null = null;
	let dragging = false;
	let holding = false;
	let told: CanvasSelection = NO_CANVAS_SELECTION;
	let nudge: number | null = null;
	/** The faces standing now, by the node each dresses. */
	const faces = new Map<string, PaintedNode>();
	/** The engine is being taken down, every face having been asked to keep what it holds. */
	let lowering = false;
	/** The window the canvas stands in, as the canvas hears it; nothing until it is bound. */
	let surroundings: CanvasWindow | null = null;

	const busy = (): boolean => dragging || holding;

	/**
	 * Every face asked to keep what it is still typing, each on its own: one
	 * that throws on the way must not take the words of the rest with it.
	 */
	const settleFaces = (): void => {
		for (const face of [...faces.values()]) {
			try {
				face.settle();
			} catch (error) {
				console.error('Snowflake: a freeform node could not keep its words', error);
			}
		}
	};

	const tellSelection = (): void => {
		const now = selectionOf(snapshot.nodes, snapshot.edges);
		if (sameSelection(now, told)) return;
		told = now;
		port.selectionChanged(now);
	};

	const draw = (scene: CanvasScene): void => {
		set({
			nodes: reconcileNodes(snapshot.nodes, scene.nodes),
			edges: reconcileEdges(snapshot.edges, scene.edges),
		});
		// A node that has gone takes its choosing with it, which the workspace must hear of.
		tellSelection();
	};

	const clearNudge = (): void => {
		if (nudge === null) return;
		host.win.clearTimeout(nudge);
		nudge = null;
	};

	/** Hands over where the nodes were left, and lets a scene that waited for the gesture be drawn. */
	const hand = (): void => {
		clearNudge();
		const changes = gestureChanges(snapshot.nodes);
		if (changes.length > 0) port.commit(changes);
		const waited = owed;
		owed = null;
		if (waited !== null) draw(waited);
		port.gestureEnded();
	};

	const still = (): boolean =>
		options.reduceMotion() || snapshot.size.width === 0 || snapshot.size.height === 0;

	/** The place to look from that a target names, or null where it names nothing to look at. */
	const resolve = (target: CanvasViewportTarget): CanvasViewport | null => {
		const { size } = snapshot;
		switch (target.kind) {
			case 'exact':
				return isViewport(target.viewport) ? target.viewport : null;
			case 'reset':
				return { x: 0, y: 0, zoom: 1 };
			case 'step':
				return steppedViewport(viewport, size, target.direction, options.zoom);
			case 'reveal': {
				const box = boundsOf(snapshot.nodes, new Set([target.id]));
				if (box === null) return null;
				return centredOn({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, size, viewport.zoom);
			}
			case 'fit': {
				const ids = target.of === 'all'
					? undefined
					: new Set(target.of === 'selection' ? selectionOf(snapshot.nodes, snapshot.edges).nodes : target.of);
				if (ids !== undefined && ids.size === 0) return null;
				const box = boundsOf(snapshot.nodes, ids);
				return box === null ? null : fitViewport(box, size, options.zoom);
			}
		}
	};

	const moveViewport = (target: CanvasViewportTarget): void => {
		// A place named outright can be kept before anything is measured; every
		// other is worked out from the canvas's size, and waits for one.
		const unsized = snapshot.size.width === 0 || snapshot.size.height === 0;
		if (flow === null || (unsized && target.kind !== 'exact' && target.kind !== 'reset')) {
			waiting = target;
			if (target.kind === 'exact' && isViewport(target.viewport)) viewport = target.viewport;
			return;
		}
		const to = resolve(target);
		if (to === null || sameViewport(to, viewport)) return;
		flow.setViewport(to, still() ? 0 : MOVE_MS);
	};

	const takeWaiting = (): void => {
		if (waiting === null || flow === null) return;
		const target = waiting;
		waiting = null;
		const to = resolve(target);
		if (to !== null) flow.setViewport(to, 0);
	};

	/** Takes the engine down. What the faces hold is kept first, unless the caller has kept it already. */
	const lower = (kept = false): void => {
		const standing = root;
		const held = container;
		root = null;
		container = null;
		flow = null;
		// Where the canvas was looked at from is where it is looked at from again.
		waiting = { kind: 'exact', viewport };
		dragging = false;
		holding = false;
		// Kept before the engine is asked to go, and not left to its going.
		if (!kept) settleFaces();
		lowering = true;
		try {
			standing?.unmount();
		} catch (error) {
			console.error('Snowflake: the freeform canvas could not be taken down', error);
		} finally {
			lowering = false;
		}
		held?.remove();
		faces.clear();
	};

	const raise = (): void => {
		if (disposed || module === null || root !== null) return;
		// Measured here, and not taken from what the window last said: a window
		// that tells a canvas nothing of its size must not leave it unraised.
		const size = surroundings?.measure() ?? snapshot.size;
		// The measure may itself have raised the engine, in saying the canvas is another size.
		if (root !== null || size.width === 0 || size.height === 0) return;
		container = host.createDiv({ cls: 'snowflake-method-freeform-engine' });
		try {
			root = module.mountRoot(container, {
				options: { ...options, viewport },
				store: {
					get: () => snapshot,
					subscribe: (listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
				},
				port,
				faces: {
					mounted: (id, face) => {
						faces.set(id, face);
					},
					unmounted: (id, face) => {
						if (faces.get(id) === face) faces.delete(id);
						return !lowering;
					},
				},
				attach: (next) => {
					flow = next;
					if (next === null) return;
					next.setSize(snapshot.size);
					takeWaiting();
				},
				nodesChanged: (changes) => {
					if (disposed || changes.length === 0) return;
					let nudged = false;
					for (const change of changes) {
						if (change.kind === 'position') {
							if (change.dragging) dragging = true;
							else if (!dragging) nudged = true;
						} else if (change.kind === 'size' && change.resizing) {
							dragging = true;
						}
					}
					set({ nodes: reduceNodeChanges(snapshot.nodes, changes, snapshot.interaction.snap) });
					tellSelection();
					if (!nudged || dragging) return;
					// The keyboard moves a node a step at a time and says nothing of
					// when it is done, so its resting is what ends the gesture.
					clearNudge();
					nudge = host.win.setTimeout(() => {
						nudge = null;
						if (!disposed && !busy()) hand();
					}, NUDGE_REST_MS);
				},
				edgesChanged: (changes) => {
					if (disposed) return;
					set({ edges: reduceEdgeChanges(snapshot.edges, changes) });
					tellSelection();
				},
				gestureEnded: () => {
					if (disposed) return;
					dragging = false;
					if (!holding) hand();
				},
				holding: (on) => {
					if (disposed || holding === on) return;
					holding = on;
					if (!on && !dragging) hand();
				},
				moved: (next, settled) => {
					if (disposed || !isViewport(next)) return;
					viewport = next;
					set({ band: zoomBandOf(next.zoom, snapshot.band) });
					port.viewportChanged(next, settled);
				},
			});
		} catch (error) {
			container.remove();
			container = null;
			root = null;
			port.failed(error);
		}
	};

	/**
	 * Whether a copy, a cut or a paste is the canvas's: asked for while the
	 * focus stands on it, and not in a field of a face, whose words are the
	 * field's, nor over words chosen on a face, which are the reader's to copy.
	 */
	const clipboardOurs = (event: ClipboardEvent): boolean => {
		if (withinField(event.target)) return false;
		const active = host.doc.activeElement;
		if (active === null || !host.contains(active)) return false;
		const chosen = host.win.getSelection();
		return chosen === null || chosen.type !== 'Range' || chosen.anchorNode === null || !host.contains(chosen.anchorNode);
	};

	// Bound once the engine can be raised and lowered: the window is measured
	// as it is bound, and a canvas that has a size is one to raise.
	surroundings = bindCanvasWindow({
		host,
		panning: (on) => {
			set({ panning: on });
		},
		resized: (size) => {
			set({ size });
			if (size.width === 0 || size.height === 0) return;
			if (root === null) raise();
			flow?.setSize(size);
			takeWaiting();
		},
		clipboard: (event) => {
			if (disposed || event.defaultPrevented || !clipboardOurs(event)) return;
			if (event.type !== 'copy' && event.type !== 'cut' && event.type !== 'paste') return;
			if (!port.clipboard(event.type, event)) return;
			event.preventDefault();
			event.stopPropagation();
		},
		migrated: () => {
			// The engine's listeners and measures are the window's it was raised
			// in. What the author has in hand is kept here, so the engine is
			// taken down and raised again in the window the view now stands in.
			if (root === null) return;
			lower();
			raise();
		},
	});

	const onKey = (event: KeyboardEvent): void => {
		if (disposed || event.defaultPrevented || withinField(event.target)) return;
		if (!port.key(event)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	host.addEventListener('keydown', onKey);

	void loadRoot().then(
		(loaded) => {
			if (disposed) return;
			module = loaded;
			raise();
		},
		(error: unknown) => {
			if (!disposed) port.failed(error);
		},
	);

	const handle: CanvasHandle = {
		setScene: (scene) => {
			if (disposed) return;
			if (busy()) {
				owed = scene;
				return;
			}
			draw(scene);
		},
		setInteraction: (change) => {
			if (disposed) return;
			const interaction = { ...snapshot.interaction, ...change };
			const held = snapshot.interaction;
			if (
				interaction.ground === held.ground && interaction.snap === held.snap &&
				interaction.minimap === held.minimap && interaction.readOnly === held.readOnly
			) {
				return;
			}
			set({ interaction });
		},
		selection: () => selectionOf(snapshot.nodes, snapshot.edges),
		select: (selection) => {
			if (disposed) return;
			set(withSelection(snapshot.nodes, snapshot.edges, selection));
			tellSelection();
		},
		viewport: () => viewport,
		moveViewport,
		toPlane: (client) => {
			if (flow !== null) return flow.toPlane(client);
			const box = host.getBoundingClientRect();
			return {
				x: (client.x - box.left - viewport.x) / viewport.zoom,
				y: (client.y - box.top - viewport.y) / viewport.zoom,
			};
		},
		centre: () => centreOf(viewport, snapshot.size),
		busy,
		remeasure: () => {
			if (!disposed) surroundings?.measure();
		},
		focus: () => {
			host.focus({ preventScroll: true });
		},
		settle: () => {
			if (disposed) return;
			settleFaces();
			// What the keyboard left, or a gesture cut short, is handed over now
			// rather than lost with the canvas.
			if (hasUntold(snapshot.nodes)) {
				dragging = false;
				holding = false;
				hand();
			}
		},
		dispose: () => {
			if (disposed) return;
			settleFaces();
			if (hasUntold(snapshot.nodes)) {
				clearNudge();
				const changes = gestureChanges(snapshot.nodes);
				if (changes.length > 0) port.commit(changes);
			}
			disposed = true;
			clearNudge();
			surroundings?.release();
			host.removeEventListener('keydown', onKey);
			lower(true);
			listeners.clear();
			host.removeClass(FREEFORM_CANVAS_CLASS);
		},
	};
	return handle;
};
