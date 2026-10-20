/**
 * The engine that draws the entity graph: a force layout on d3-force and a
 * canvas drawn by hand, in the native graph's manner. Discs sized by their
 * links, labels that fade with the zoom, thin lines with arrowheads, the
 * node under the pointer or the nodes the search found lit with their
 * neighbours and the rest dimmed, drag on a node, pan on the ground, and a
 * wheel zoom that glides to where it is sent, in about the pointer and out
 * about the middle.
 *
 * The engine keeps where every node it has met stands, by id, so a picture
 * that drops a node and brings it back finds it where it was, and only a
 * node new to the engine enters the layout, set down beside a neighbour.
 * It never writes a file: the view's moves go out through the port, and
 * the shell keeps them.
 *
 * Loaded on its own, after the shell: this is the only module that imports
 * d3, and nothing imports this module but the loader the shell is given.
 */

import { Keymap, Platform } from 'obsidian';

import { drag, type D3DragEvent } from 'd3-drag';
import {
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';

import {
	repelStrength,
	sliderForce,
	UNRESOLVED_GROUP,
	type EntityGraphForces,
	type GraphEdge,
	type GraphLabelMode,
	type GraphNode,
	type GraphViewport,
} from '../domain';
import {
	arrowAlpha,
	arrowhead,
	arrowSize,
	arrowStandoff,
	clampZoom,
	distanceToCurve,
	drawnRadius,
	easeAlpha,
	edgeControl,
	edgeLabelAnchor,
	fitViewport,
	glideZoom,
	GRAPH_DIM_ALPHA,
	GRAPH_LABEL_GAP,
	GRAPH_LINE_HIT_TOLERANCE,
	GRAPH_ZOOM_RANGE,
	homeViewport,
	inBox,
	lineWidth,
	nodeRadius,
	textAlpha,
	toScreen,
	toWorld,
	wheelZoomFactor,
	type Point,
} from './relationship-graph-layout';
import { edgeHighlight, highlightOf, matchHighlight, type GraphHighlight, type NodeColor } from './relationship-graph-model';
import type {
	GraphColors,
	GraphHandle,
	GraphNodePlace,
	GraphPort,
	GraphScene,
	MountRelationshipGraph,
} from './relationship-graph-port';
import { watchFrameSize } from './workspace-frame';

interface SimNode extends SimulationNodeDatum {
	id: string;
	node: GraphNode;
	/** The world radius at zoom 1. */
	radius: number;
	pinned: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	fx?: number | null;
	fy?: number | null;
	/** The eased dimming alpha. */
	alpha: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
	edge: GraphEdge;
	alpha: number;
}

/**
 * What a drag takes hold of: the node, and where it stood on screen when the
 * press came. d3 measures the drag from the subject's place in the pointer's
 * own frame, so the place is the screen's, and every move is read back into
 * the world through the view.
 */
interface DragSubject {
	x: number;
	y: number;
	node: SimNode;
}

type DragEvent = D3DragEvent<HTMLCanvasElement, unknown, DragSubject | undefined>;

/** How far a press may travel and still be a click, in screen pixels. */
const CLICK_SLOP = 3;
/** The longest a line's label is drawn before it is cut. */
const LABEL_LIMIT = 40;
/** How far past the box a node is still drawn, so a disc on the edge is whole. */
const DRAW_MARGIN = 64;
/** Labels on lines are drawn only from this native zoom; closer in, they are readable. */
const EDGE_LABEL_ZOOM = 0.5;

const SURFACE_CLASS = 'snowflake-method-relationship-graph-surface';

const endsOf = (link: SimLink): [SimNode, SimNode] => [link.source as SimNode, link.target as SimNode];

const placed = (sim: SimNode): boolean => Number.isFinite(sim.x) && Number.isFinite(sim.y);

const labelText = (edge: GraphEdge, mode: GraphLabelMode): string => {
	const text = edge.text.trim();
	let words = edge.label;
	if (mode === 'text') words = text || edge.label;
	else if (mode === 'both' && text) words = `${edge.label}: ${text}`;
	return words.length > LABEL_LIMIT ? `${words.slice(0, LABEL_LIMIT - 1)}…` : words;
};

const sameForces = (a: EntityGraphForces | null, b: EntityGraphForces): boolean =>
	a !== null && a.center === b.center && a.repel === b.repel && a.link === b.link && a.linkDistance === b.linkDistance;

/** A deterministic scatter, so a picture laid out twice lands the same way. */
function scatter(seed: number): Point {
	const angle = (seed * 2.399963) % (Math.PI * 2);
	const reach = 20 + ((seed * 37) % 60);
	return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
}

/** The smaller font the lines' labels are set in, from the interface font. */
function smallerFont(font: string): string {
	const space = font.indexOf(' ');
	const size = parseFloat(space === -1 ? font : font.slice(0, space));
	const family = space === -1 ? 'sans-serif' : font.slice(space + 1);
	return `${Math.max(9, Math.round((Number.isFinite(size) ? size : 13) * 0.85))}px ${family}`;
}

class RelationshipGraphEngine implements GraphHandle {
	private readonly canvas: HTMLCanvasElement;
	private readonly win: Window;
	private readonly simulation = forceSimulation<SimNode, SimLink>([]).stop();
	private readonly charge = forceManyBody<SimNode>();
	private readonly linkForce = forceLink<SimNode, SimLink>([]).id((node) => node.id);
	private readonly pullX = forceX<SimNode>(0);
	private readonly pullY = forceY<SimNode>(0);
	private readonly zoomer: ZoomBehavior<HTMLCanvasElement, unknown>;
	private readonly stopWatching: () => void;
	private readonly listeners: (() => void)[] = [];

	private scene: GraphScene | null = null;
	private forces: EntityGraphForces | null = null;
	private nodes: SimNode[] = [];
	private readonly byId = new Map<string, SimNode>();
	private links: SimLink[] = [];
	/** Where nodes not in the picture last stood. */
	private readonly parked = new Map<string, GraphNodePlace>();
	private view: GraphViewport = { x: 0, y: 0, k: 1 };
	/** Where the zoom is headed: the view's zoom glides to it a frame at a time, as the native graph's does. */
	private targetK = 1;
	/** The screen point the glide keeps in place; null is the middle of the box, which a zoom out is about. */
	private zoomCentre: Point | null = null;
	/** No view was set: the graph is fitted to the box once the layout settles, and the origin kept centred until then. */
	private fitPending = true;
	private settledOnce = false;
	private width = 0;
	private height = 0;
	private dpr = 1;
	private frame: number | null = null;
	private quad: Quadtree<SimNode> | null = null;
	private hovered: string | null = null;
	private hoveredEdge: GraphEdge | null = null;
	private highlight: GraphHighlight | null = null;
	private focused: string | null = null;
	private dragging: SimNode | null = null;
	private press: { x: number; y: number; button: number } | null = null;
	/** The view is being set by the engine itself, not moved by a gesture or a command. */
	private settingView = false;
	private disposed = false;

	constructor(
		private readonly host: HTMLElement,
		private readonly port: GraphPort,
	) {
		this.win = host.win;
		this.canvas = host.createEl('canvas', { cls: SURFACE_CLASS });
		this.simulation
			.force('charge', this.charge)
			.force('link', this.linkForce)
			.force('x', this.pullX)
			.force('y', this.pullY)
			.velocityDecay(0.4)
			.on('tick', () => {
				this.quad = null;
				this.requestFrame();
			})
			.on('end', () => {
				this.settledOnce = true;
				if (this.fitPending) {
					this.fitPending = false;
					this.fit(false);
				}
			});

		this.zoomer = zoom<HTMLCanvasElement, unknown>()
			.scaleExtent([GRAPH_ZOOM_RANGE.min, GRAPH_ZOOM_RANGE.max])
			.filter((event: Event) => {
				// The wheel is the engine's own: it sends the target, and the frames glide to it.
				if (event.type === 'wheel') return false;
				const mouse = event as MouseEvent;
				if (typeof mouse.button === 'number' && mouse.button !== 0) return false;
				if (mouse.ctrlKey) return false;
				return this.nodeAt(this.pointOf(event)) === null;
			})
			.on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
				const { x, y, k } = event.transform;
				// A pinch sets the zoom outright; a pan keeps it, and a glide under way goes on.
				if (k !== this.view.k) {
					this.targetK = k;
					this.zoomCentre = null;
				}
				this.view = { x, y, k };
				this.requestFrame();
				if (this.settingView) return;
				this.fitPending = false;
				this.port.viewportMoved(this.nativeView(this.view));
			});
		const dragger = drag<HTMLCanvasElement, unknown, DragSubject | undefined>()
			.container(this.canvas)
			.subject((event: DragEvent): DragSubject | undefined => {
				const node = this.nodeAt({ x: event.x, y: event.y });
				if (node === null) return undefined;
				const at = toScreen(node, this.view);
				return { x: at.x, y: at.y, node };
			})
			.on('start', (event: DragEvent) => {
				if (event.subject === undefined) return;
				const { node } = event.subject;
				this.dragging = node;
				node.fx = node.x;
				node.fy = node.y;
				this.canvas.addClass('is-dragging');
				this.simulation.alphaTarget(0.3).restart();
			})
			.on('drag', (event: DragEvent) => {
				if (event.subject === undefined) return;
				const world = toWorld({ x: event.x, y: event.y }, this.view);
				event.subject.node.fx = world.x;
				event.subject.node.fy = world.y;
				this.requestFrame();
			})
			.on('end', (event: DragEvent) => {
				if (event.subject === undefined) return;
				const { node } = event.subject;
				this.simulation.alphaTarget(0);
				if (!node.pinned) {
					node.fx = null;
					node.fy = null;
				}
				this.dragging = null;
				this.canvas.removeClass('is-dragging');
			});

		// The engine's own listeners stand before d3's, so a press is seen
		// whatever d3 makes of it.
		this.listen('pointerdown', (event) => {
			this.press = { x: event.clientX, y: event.clientY, button: event.button };
		});
		this.listen('pointerup', (event) => {
			const press = this.press;
			this.press = null;
			if (press === null || press.button !== 0 || event.button !== 0) return;
			if (Platform.isMacOS && event.ctrlKey) return;
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) return;
			this.clicked(event);
		});
		this.listen('pointermove', (event) => {
			if (this.dragging !== null) return;
			this.hover(this.pointOf(event));
		});
		this.listen('pointerleave', () => {
			this.hover(null);
		});
		this.listen('wheel', (event) => {
			event.preventDefault();
			this.wheelZoom(event);
		});
		this.listen('contextmenu', (event) => {
			event.preventDefault();
			const point = this.pointOf(event);
			const node = this.nodeAt(point);
			if (node !== null) {
				this.port.nodeMenu(node.id, event);
				return;
			}
			const link = this.edgeAt(point);
			if (link !== null) this.port.edgeMenu(link.edge, event);
			else this.port.backgroundMenu(event);
		});
		select(this.canvas).call(dragger).call(this.zoomer).on('dblclick.zoom', null);

		this.stopWatching = watchFrameSize(host, [host], () => this.remeasure());
		this.remeasure();
	}

	// --- the handle -------------------------------------------------------------

	setScene(scene: GraphScene): void {
		if (this.disposed) return;
		const first = this.scene === null;
		this.scene = scene;
		const { picture, display } = scene;
		const wanted = new Set(picture.nodes.map((node) => node.id));
		for (const sim of this.nodes) {
			if (wanted.has(sim.id)) continue;
			if (placed(sim)) this.parked.set(sim.id, { x: sim.x, y: sim.y, pinned: sim.pinned });
			this.byId.delete(sim.id);
		}
		this.nodes = this.nodes.filter((sim) => wanted.has(sim.id));
		const entering: SimNode[] = [];
		for (const node of picture.nodes) {
			const standing = this.byId.get(node.id);
			if (standing !== undefined) {
				standing.node = node;
				standing.radius = nodeRadius(node.weight, display.nodeSize);
				continue;
			}
			const parked = this.parked.get(node.id);
			const sim: SimNode = {
				id: node.id,
				node,
				radius: nodeRadius(node.weight, display.nodeSize),
				pinned: parked?.pinned ?? false,
				x: parked?.x ?? Number.NaN,
				y: parked?.y ?? Number.NaN,
				vx: 0,
				vy: 0,
				alpha: 1,
			};
			if (parked !== undefined) {
				this.parked.delete(node.id);
				if (sim.pinned) {
					sim.fx = sim.x;
					sim.fy = sim.y;
				}
			} else {
				entering.push(sim);
			}
			this.nodes.push(sim);
			this.byId.set(node.id, sim);
		}
		this.place(entering, picture.edges);
		this.links = picture.edges
			.filter((edge) => this.byId.has(edge.source) && this.byId.has(edge.target))
			.map((edge) => ({ source: edge.source, target: edge.target, edge, alpha: 1 }));
		this.simulation.nodes(this.nodes);
		this.linkForce.links(this.links);
		let reheat = first ? 1 : 0;
		if (!sameForces(this.forces, scene.forces)) {
			this.forces = scene.forces;
			this.applyForces(scene.forces);
			reheat = Math.max(reheat, 0.3);
		}
		if (entering.length > 0) reheat = Math.max(reheat, 0.3);
		if (reheat > 0) this.simulation.alpha(reheat).restart();
		if (this.hovered !== null && !this.byId.has(this.hovered)) this.hover(null);
		if (this.focused !== null && !this.byId.has(this.focused)) this.focusNode(null);
		this.refreshHighlight();
		this.quad = null;
		this.requestFrame();
	}

	setViewport(view: GraphViewport | null): void {
		if (view === null) {
			if (this.settledOnce) {
				this.fitPending = false;
				this.fit(false);
				return;
			}
			this.fitPending = true;
			this.applyView(homeViewport(this.width, this.height, this.dpr), false);
			return;
		}
		this.fitPending = false;
		this.applyView(this.viewFromNative(view), false);
	}

	/**
	 * Fits the graph to the box. A fit the engine does of itself, as the
	 * layout settles or the box gets its size, is not announced: it is no
	 * move of the user's to be kept as the view.
	 */
	fit(announce = true): void {
		if (this.width === 0 || this.height === 0) {
			this.fitPending = true;
			return;
		}
		const standing = this.nodes.filter(placed);
		const fitted = fitViewport(
			standing,
			standing.map((sim) => sim.radius),
			this.width,
			this.height,
			this.dpr,
		);
		this.applyView(fitted, announce);
	}

	resetView(): void {
		this.applyView(homeViewport(this.width, this.height, this.dpr), true);
	}

	/** Sends the zoom a step about the middle, which the frames glide to, as the native graph's keys do. */
	zoomBy(factor: number): void {
		this.sendZoom(this.targetK * factor, null);
	}

	panBy(dx: number, dy: number): void {
		this.applyView({ ...this.view, x: this.view.x + dx, y: this.view.y + dy }, true);
	}

	focusNode(id: string | null): void {
		const next = id !== null && this.byId.has(id) ? id : null;
		if (next === this.focused) return;
		this.focused = next;
		this.requestFrame();
		this.port.focusChanged(next);
	}

	focusedNode(): string | null {
		return this.focused;
	}

	centreOn(id: string): void {
		const sim = this.byId.get(id);
		if (sim === undefined || !placed(sim)) return;
		const { k } = this.view;
		this.applyView({ k, x: this.width / 2 - sim.x * k, y: this.height / 2 - sim.y * k }, true);
	}

	screenPlaceOf(id: string): Point | null {
		const sim = this.byId.get(id);
		if (sim === undefined || !placed(sim)) return null;
		return toScreen(sim, this.view);
	}

	nudgeNode(id: string, dx: number, dy: number): void {
		const sim = this.byId.get(id);
		if (sim === undefined || !placed(sim)) return;
		sim.x += dx / this.view.k;
		sim.y += dy / this.view.k;
		if (sim.pinned) {
			sim.fx = sim.x;
			sim.fy = sim.y;
		}
		this.quad = null;
		this.simulation.alpha(Math.max(this.simulation.alpha(), 0.1)).restart();
	}

	pinNode(id: string, pinned: boolean): void {
		const sim = this.byId.get(id);
		if (sim === undefined) return;
		sim.pinned = pinned;
		sim.fx = pinned ? sim.x : null;
		sim.fy = pinned ? sim.y : null;
		this.requestFrame();
	}

	isPinned(id: string): boolean {
		return this.byId.get(id)?.pinned ?? this.parked.get(id)?.pinned ?? false;
	}

	places(): Map<string, GraphNodePlace> {
		const places = new Map<string, GraphNodePlace>(this.parked);
		for (const sim of this.nodes) {
			if (placed(sim)) places.set(sim.id, { x: sim.x, y: sim.y, pinned: sim.pinned });
		}
		return places;
	}

	setPlaces(places: ReadonlyMap<string, GraphNodePlace>): void {
		for (const [id, place] of places) {
			const sim = this.byId.get(id);
			if (sim === undefined) {
				this.parked.set(id, place);
				continue;
			}
			sim.x = place.x;
			sim.y = place.y;
			sim.vx = 0;
			sim.vy = 0;
			sim.pinned = place.pinned;
			sim.fx = place.pinned ? place.x : null;
			sim.fy = place.pinned ? place.y : null;
		}
		this.quad = null;
		this.requestFrame();
	}

	remeasure(): void {
		if (this.disposed) return;
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		const dpr = this.win.devicePixelRatio || 1;
		if (width === this.width && height === this.height && dpr === this.dpr) return;
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		this.zoomer.scaleExtent([GRAPH_ZOOM_RANGE.min / dpr, GRAPH_ZOOM_RANGE.max / dpr]);
		this.canvas.width = Math.max(1, Math.round(width * dpr));
		this.canvas.height = Math.max(1, Math.round(height * dpr));
		if (width > 0 && height > 0 && this.fitPending) {
			if (this.settledOnce) {
				this.fitPending = false;
				this.fit(false);
			} else {
				this.applyView(homeViewport(width, height, dpr), false);
			}
		}
		this.requestFrame();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.simulation.stop();
		if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
		this.frame = null;
		this.stopWatching();
		for (const stop of this.listeners.splice(0)) stop();
		select(this.canvas).on('.zoom', null).on('.drag', null);
		this.canvas.remove();
	}

	// --- the layout -------------------------------------------------------------

	private applyForces(forces: EntityGraphForces): void {
		const centre = sliderForce(forces.center);
		this.charge.strength(-repelStrength(forces.repel));
		this.linkForce.distance(forces.linkDistance).strength(sliderForce(forces.link));
		this.pullX.strength(centre);
		this.pullY.strength(centre);
	}

	/** New nodes set down beside a neighbour that has a place, else about the middle of what stands. */
	private place(entering: SimNode[], edges: readonly GraphEdge[]): void {
		if (entering.length === 0) return;
		let sumX = 0;
		let sumY = 0;
		let count = 0;
		for (const sim of this.nodes) {
			if (!placed(sim)) continue;
			sumX += sim.x;
			sumY += sim.y;
			count += 1;
		}
		const centre = count === 0 ? { x: 0, y: 0 } : { x: sumX / count, y: sumY / count };
		const spread = Math.sqrt(entering.length) * 30;
		entering.forEach((sim, index) => {
			let anchor: Point | null = null;
			for (const edge of edges) {
				const otherId = edge.source === sim.id ? edge.target : edge.target === sim.id ? edge.source : null;
				if (otherId === null) continue;
				const other = this.byId.get(otherId);
				if (other !== undefined && other !== sim && placed(other)) {
					anchor = other;
					break;
				}
			}
			const jitter = scatter(index + 1);
			if (anchor !== null) {
				sim.x = anchor.x + jitter.x;
				sim.y = anchor.y + jitter.y;
			} else {
				sim.x = centre.x + (jitter.x / 80) * spread;
				sim.y = centre.y + (jitter.y / 80) * spread;
			}
		});
	}

	// --- the view --------------------------------------------------------------------

	/**
	 * The view in the native graph's units, a world unit being one device
	 * pixel at zoom 1, which the port keeps so every display shows the same
	 * picture; the engine's own view maps world units to CSS pixels.
	 */
	private nativeView(view: GraphViewport): GraphViewport {
		const { dpr } = this;
		return { x: view.x * dpr, y: view.y * dpr, k: view.k * dpr };
	}

	private viewFromNative(view: GraphViewport): GraphViewport {
		const { dpr } = this;
		return { x: view.x / dpr, y: view.y / dpr, k: clampZoom(view.k / dpr, dpr) };
	}

	/** The view set on the zoom behaviour, which keeps it; announced to the port unless the engine is only following. */
	private applyView(view: GraphViewport, announce: boolean): void {
		this.settingView = !announce;
		try {
			this.zoomer.transform(select(this.canvas), zoomIdentity.translate(view.x, view.y).scale(view.k));
		} finally {
			this.settingView = false;
		}
		this.view = view;
		this.targetK = view.k;
		this.zoomCentre = null;
		this.requestFrame();
	}

	/** A wheel turn moves the target the native way: zooming in is about the pointer, zooming out about the middle. */
	private wheelZoom(event: WheelEvent): void {
		const target = this.targetK * wheelZoomFactor(event.deltaY, event.deltaMode);
		this.sendZoom(target, target < this.view.k ? null : this.pointOf(event));
	}

	/** Sets where the zoom is headed and the screen point it is about; the frames take it there. */
	private sendZoom(target: number, about: Point | null): void {
		this.targetK = clampZoom(target, this.dpr);
		this.zoomCentre = about;
		this.fitPending = false;
		this.requestFrame();
	}

	/** One frame of the zoom's glide towards its target; true while it is still on its way. */
	private glide(): boolean {
		const { width, height, dpr } = this;
		this.targetK = clampZoom(this.targetK, dpr);
		const next = glideZoom(this.view, this.targetK, this.zoomCentre ?? { x: width / 2, y: height / 2 });
		if (next === this.view) return false;
		this.view = next;
		// The zoom behaviour is kept at the drawn view, so a pan that starts
		// mid-glide measures from what is on the screen.
		select(this.canvas).property('__zoom', zoomIdentity.translate(next.x, next.y).scale(next.k));
		this.port.viewportMoved(this.nativeView(next));
		return true;
	}

	// --- pointing -----------------------------------------------------------------

	private listen<K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void): void {
		this.canvas.addEventListener(type, handler);
		this.listeners.push(() => {
			this.canvas.removeEventListener(type, handler);
		});
	}

	/** A pointer's place in the canvas, in screen pixels. */
	private pointOf(event: Event): Point {
		const box = this.canvas.getBoundingClientRect();
		const mouse = event as Partial<MouseEvent>;
		if (typeof mouse.clientX === 'number' && typeof mouse.clientY === 'number') {
			return { x: mouse.clientX - box.left, y: mouse.clientY - box.top };
		}
		const touch = (event as Partial<TouchEvent>).touches?.[0];
		if (touch === undefined) return { x: 0, y: 0 };
		return { x: touch.clientX - box.left, y: touch.clientY - box.top };
	}

	private ensureQuadtree(): Quadtree<SimNode> {
		if (this.quad === null) {
			this.quad = quadtree<SimNode>()
				.x((sim) => sim.x)
				.y((sim) => sim.y)
				.addAll(this.nodes.filter(placed));
		}
		return this.quad;
	}

	/** The node whose drawn disc is under a screen point, or null. */
	private nodeAt(point: Point): SimNode | null {
		if (this.scene === null || this.nodes.length === 0) return null;
		const world = toWorld(point, this.view);
		const { k } = this.view;
		const { dpr } = this;
		// The native reach: the drawn disc and two device pixels around it.
		const slack = 2 / dpr;
		const largest = (drawnRadius(30 * this.scene.display.nodeSize, k, dpr) + slack) / k;
		const found = this.ensureQuadtree().find(world.x, world.y, largest);
		if (found === undefined) return null;
		const reach = drawnRadius(found.radius, k, dpr) + slack;
		return Math.hypot(found.x - world.x, found.y - world.y) * k <= reach ? found : null;
	}

	/** The line nearest a screen point within the tolerance, or null. */
	private edgeAt(point: Point): SimLink | null {
		let best: SimLink | null = null;
		let nearest = GRAPH_LINE_HIT_TOLERANCE;
		const slack = GRAPH_LINE_HIT_TOLERANCE + 60;
		for (const link of this.links) {
			const [source, target] = endsOf(link);
			if (!placed(source) || !placed(target)) continue;
			const s = toScreen(source, this.view);
			const t = toScreen(target, this.view);
			if (point.x < Math.min(s.x, t.x) - slack || point.x > Math.max(s.x, t.x) + slack) continue;
			if (point.y < Math.min(s.y, t.y) - slack || point.y > Math.max(s.y, t.y) + slack) continue;
			const control = toScreen(edgeControl(source, target, link.edge.lane, source.id < target.id), this.view);
			const distance = distanceToCurve(point, s, control, t);
			if (distance < nearest) {
				nearest = distance;
				best = link;
			}
		}
		return best;
	}

	private hover(point: Point | null): void {
		const node = point === null ? null : this.nodeAt(point);
		const link = point === null || node !== null ? null : this.edgeAt(point);
		const nextNode = node?.id ?? null;
		const nextEdge = link?.edge ?? null;
		if (nextNode === this.hovered && nextEdge === this.hoveredEdge) return;
		this.hovered = nextNode;
		this.hoveredEdge = nextEdge;
		this.canvas.toggleClass('is-over-node', nextNode !== null);
		this.canvas.toggleClass('is-over-line', nextEdge !== null);
		this.refreshHighlight();
		this.requestFrame();
	}

	/** What is lit: the pointer's node or line while there is one, else what the search found, else everything. */
	private refreshHighlight(): void {
		if (this.scene === null) this.highlight = null;
		else if (this.hovered !== null) this.highlight = highlightOf(this.scene.picture, this.hovered);
		else if (this.hoveredEdge !== null) this.highlight = edgeHighlight(this.hoveredEdge);
		else this.highlight = matchHighlight(this.scene.picture);
	}

	private clicked(event: PointerEvent): void {
		const point = this.pointOf(event);
		const node = this.nodeAt(point);
		if (node !== null) {
			this.port.nodeClicked(node.id, { mod: Keymap.isModEvent(event) !== false, shift: event.shiftKey });
			return;
		}
		const link = this.edgeAt(point);
		if (link !== null) this.port.edgeClicked(link.edge);
	}

	// --- drawing --------------------------------------------------------------------

	private requestFrame(): void {
		if (this.disposed || this.frame !== null) return;
		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = null;
			this.draw();
		});
	}

	private colorOf(node: GraphNode, color: NodeColor | undefined, colors: GraphColors): string {
		if (node.group === UNRESOLVED_GROUP || color === undefined || color.by === 'unresolved') return colors.fillUnresolved;
		if (color.by === 'accent') return colors.accents[color.name] ?? colors.fill;
		if (color.by === 'hex') return color.hex;
		return colors.fill;
	}

	/** Every alpha eased one step towards where the highlight wants it; true while any is still on its way. */
	private easeAlphas(): boolean {
		const { highlight } = this;
		let easing = false;
		for (const sim of this.nodes) {
			const target = highlight === null || highlight.nodes.has(sim.id) ? 1 : GRAPH_DIM_ALPHA;
			const next = easeAlpha(sim.alpha, target);
			if (next !== sim.alpha) {
				sim.alpha = next;
				easing = true;
			}
		}
		for (const link of this.links) {
			const target = highlight === null || highlight.edges.has(link.edge.id) ? 1 : GRAPH_DIM_ALPHA;
			const next = easeAlpha(link.alpha, target);
			if (next !== link.alpha) {
				link.alpha = next;
				easing = true;
			}
		}
		return easing;
	}

	private draw(): void {
		if (this.disposed || this.scene === null) return;
		const context = this.canvas.getContext('2d');
		if (context === null) return;
		const { display, colors, picture } = this.scene;
		const gliding = this.glide();
		const { width, height, dpr, view, highlight } = this;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, width, height);
		const { k } = view;
		const arrowA = arrowAlpha(k, dpr);
		const textA = textAlpha(k, display.textFade, dpr);
		const easing = this.easeAlphas();

		// Lines, then their arrowheads and labels.
		const stroke = lineWidth(display.lineSize, dpr);
		const head = arrowSize(display.lineSize, dpr);
		const edgeLabels = display.labels !== 'none' && k * dpr >= EDGE_LABEL_ZOOM && textA > 0;
		const smallFont = smallerFont(colors.font);
		context.lineWidth = stroke;
		context.lineCap = 'round';
		for (const link of this.links) {
			const [source, target] = endsOf(link);
			if (!placed(source) || !placed(target)) continue;
			const s = toScreen(source, view);
			const t = toScreen(target, view);
			if (!inBox(s, width, height, DRAW_MARGIN) && !inBox(t, width, height, DRAW_MARGIN)) {
				const midpoint = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
				if (!inBox(midpoint, width, height, DRAW_MARGIN)) continue;
			}
			const alpha = link.alpha;
			if (alpha <= 0.01) continue;
			const lit = highlight !== null && highlight.edges.has(link.edge.id);
			const control = toScreen(edgeControl(source, target, link.edge.lane, source.id < target.id), view);
			context.globalAlpha = alpha;
			context.strokeStyle = lit ? colors.lineHighlight : colors.line;
			context.beginPath();
			context.moveTo(s.x, s.y);
			context.quadraticCurveTo(control.x, control.y, t.x, t.y);
			context.stroke();
			if (display.arrows && arrowA > 0) {
				// The native head: it fades with the zoom while the line does not,
				// keeps the arrow colour when lit, and stands a world unit off the rim.
				const shape = arrowhead(s, control, t, arrowStandoff(target.radius, k, dpr), head);
				context.globalAlpha = arrowA * alpha;
				context.fillStyle = colors.arrow;
				context.beginPath();
				context.moveTo(shape.tip.x, shape.tip.y);
				context.lineTo(shape.left.x, shape.left.y);
				context.lineTo(shape.notch.x, shape.notch.y);
				context.lineTo(shape.right.x, shape.right.y);
				context.closePath();
				context.fill();
			}
			if (edgeLabels) {
				const anchor = edgeLabelAnchor(s, control, t);
				const words = labelText(link.edge, display.labels);
				context.globalAlpha = textA * link.alpha;
				context.font = smallFont;
				context.textAlign = 'center';
				context.textBaseline = 'middle';
				context.lineWidth = 3;
				context.strokeStyle = colors.background;
				context.strokeText(words, anchor.x, anchor.y);
				context.fillStyle = colors.text;
				context.fillText(words, anchor.x, anchor.y);
				context.lineWidth = stroke;
			}
		}

		// Discs, then their labels.
		context.font = colors.font;
		context.textAlign = 'center';
		context.textBaseline = 'top';
		for (const sim of this.nodes) {
			if (!placed(sim)) continue;
			const p = toScreen(sim, view);
			const r = drawnRadius(sim.radius, k, dpr);
			if (!inBox(p, width, height, r + DRAW_MARGIN)) continue;
			const hovered = sim.id === this.hovered;
			context.globalAlpha = sim.alpha;
			context.fillStyle = hovered ? colors.fillHighlight : this.colorOf(sim.node, picture.colors.get(sim.id), colors);
			context.beginPath();
			context.arc(p.x, p.y, r, 0, Math.PI * 2);
			context.fill();
			if (sim.id === this.focused) {
				context.lineWidth = 2;
				context.strokeStyle = colors.fillFocused;
				context.beginPath();
				context.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
				context.stroke();
				context.lineWidth = stroke;
			}
			if (sim.pinned) {
				context.fillStyle = colors.background;
				context.beginPath();
				context.arc(p.x, p.y, Math.max(1.5, r / 4), 0, Math.PI * 2);
				context.fill();
			}
			const labelAlpha = hovered || sim.id === this.focused ? sim.alpha : textA * sim.alpha;
			if (labelAlpha <= 0.01) continue;
			context.globalAlpha = labelAlpha;
			context.fillStyle = colors.text;
			context.fillText(sim.node.name, p.x, p.y + r + GRAPH_LABEL_GAP);
		}
		context.globalAlpha = 1;
		if (easing || gliding) this.requestFrame();
	}
}

export const mountRelationshipGraph: MountRelationshipGraph = (host, port) => new RelationshipGraphEngine(host, port);
