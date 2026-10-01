/**
 * The seam between the freeform workspace and the engine that draws its
 * canvas. The workspace knows the project, the views and what every node
 * stands for; the engine knows places, sizes, lines and gestures, and nothing
 * of what a node shows. What crosses the seam is said here and nowhere else,
 * in words of neither side: a node is a box with a kind, a line joins two
 * boxes by their sides, and what is painted in a box is the painter's.
 *
 * Types alone, so both sides and their tests name the seam without taking
 * the engine with them.
 */

export interface CanvasPoint {
	x: number;
	y: number;
}

export interface CanvasSize {
	width: number;
	height: number;
}

export interface CanvasBox extends CanvasPoint, CanvasSize {}

export interface CanvasViewport {
	x: number;
	y: number;
	zoom: number;
}

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

export const CANVAS_SIDES: readonly CanvasSide[] = ['top', 'right', 'bottom', 'left'];

/** How near the canvas is looked at, in the three steps a face changes at and the one it gives way at. */
export type ZoomBand = 'far' | 'compact' | 'standard' | 'extended';

/** The kind every frame is drawn as; every other kind names a painter of the workspace's. */
export const CANVAS_FRAME_KIND = 'frame';
/**
 * The painter every node but a frame is dressed by while the canvas is
 * looked at from far off: its symbol and its name alone, in place of a face
 * that could not be read at that distance and would cost as much to draw.
 */
export const CANVAS_FAR_KIND = 'far';

export interface CanvasNode {
	id: string;
	/** Which painter dresses it. */
	kind: string;
	/** Where it stands on the plane, by its top left corner, and how large. */
	x: number;
	y: number;
	width: number;
	height: number;
	/** Its place in its band, low under high. Frames stand in a band of their own under every other node. */
	z: number;
	/** The frame it moves with; null for one that stands free, and for a frame. */
	frame: string | null;
	/** Moves when what the painter would draw moves, and only then. */
	revision: string;
	/** What the node is called, for a reader that cannot see it. */
	label: string;
	/** A class the node wears, never a colour. */
	tone: string | null;
	/** Neither moved nor sized: a project that cannot be written, a node being typed into. */
	locked: boolean;
	/** Whether a line may start or end on it. */
	connectable: boolean;
	minWidth: number;
	minHeight: number;
}

export type CanvasArrow = 'none' | 'end' | 'both';
export type CanvasLine = 'solid' | 'dashed' | 'dotted';

export interface CanvasEdge {
	id: string;
	from: string;
	/** The side it leaves by, chosen already where the view left the choice open. */
	fromSide: CanvasSide;
	to: string;
	toSide: CanvasSide;
	/** The words drawn on the line; none where it carries none. */
	label: string;
	/** What the line is called, for a reader that cannot see it: what it joins. */
	name: string;
	arrow: CanvasArrow;
	line: CanvasLine;
	revision: string;
}

export interface CanvasScene {
	nodes: readonly CanvasNode[];
	edges: readonly CanvasEdge[];
}

export interface CanvasSelection {
	nodes: readonly string[];
	edges: readonly string[];
}

export const NO_CANVAS_SELECTION: CanvasSelection = { nodes: [], edges: [] };

/** One end of a line as a gesture left it: the node, and the side of it. */
export interface CanvasLink {
	from: string;
	fromSide: CanvasSide;
	to: string;
	toSide: CanvasSide;
}

/** Where a gesture left a node: moved, sized, or given to a frame or set free of one. */
export type CanvasGeometryChange =
	| { kind: 'move'; id: string; x: number; y: number }
	| { kind: 'resize'; id: string; x: number; y: number; width: number; height: number }
	| { kind: 'frame'; id: string; frame: string | null };

export type CanvasViewportTarget =
	| { kind: 'exact'; viewport: CanvasViewport }
	/** Everything, what is chosen, or the nodes named, with room about them. */
	| { kind: 'fit'; of: 'all' | 'selection' | readonly string[] }
	/** The plane's own corner at its own size. */
	| { kind: 'reset' }
	/** One step along the ladder of sizes, about the middle of what is in sight. */
	| { kind: 'step'; direction: 'in' | 'out' }
	/** A node brought to the middle, at the size the canvas stands at. */
	| { kind: 'reveal'; id: string };

export interface CanvasInteraction {
	/**
	 * What a finger's drag on the ground does: moves the plane, or draws a
	 * box round nodes. A mouse draws the box by its own drag either way, as
	 * the app's canvas has it, and moves the plane by its middle button or
	 * by any button while Space is held.
	 */
	ground: 'pan' | 'select';
	/** Whether nodes land on the grid, and how wide it is; null for none. */
	snap: number | null;
	/** Whether a node moved or sized by hand is drawn level with the sides and middles of the nodes about it. */
	snapObjects: boolean;
	minimap: boolean;
	/** Nothing is moved, sized, joined or removed. */
	readOnly: boolean;
}

export type CanvasMenuTarget =
	| { kind: 'ground'; at: CanvasPoint }
	| { kind: 'node'; id: string }
	| { kind: 'edge'; id: string };

/** What a face is dressed for. */
export interface PaintContext {
	selected: boolean;
	readOnly: boolean;
	band: ZoomBand;
	width: number;
	height: number;
}

export interface PaintedNode {
	/** Dresses the face again: what it shows moved, or how it is looked at. */
	dress: (context: PaintContext) => void;
	/**
	 * Keeps what is still being typed. Called before the face is taken down,
	 * and as the canvas goes; a face with nothing left to keep keeps nothing.
	 */
	settle: () => void;
	unmount: () => void;
}

export interface NodePainter {
	mount: (body: HTMLElement, id: string, context: PaintContext) => PaintedNode;
}

/** What the engine asks of the workspace, and tells it. */
export interface CanvasPort {
	painter: (kind: string) => NodePainter;
	/** Where a gesture left what it moved: handed over when it ends or the keyboard pauses, never as it goes. */
	commit: (changes: readonly CanvasGeometryChange[]) => void;
	connect: (link: CanvasLink) => void;
	/** One end of a line moved to another node or another side. */
	reconnect: (id: string, link: CanvasLink) => void;
	selectionChanged: (selection: CanvasSelection) => void;
	/** Where the canvas is looked at from; `settled` once the move is over. */
	viewportChanged: (viewport: CanvasViewport, settled: boolean) => void;
	menu: (target: CanvasMenuTarget, event: MouseEvent) => void;
	/** A double click, which opens what it fell on. */
	open: (target: CanvasMenuTarget, event: MouseEvent) => void;
	/** A key pressed on the canvas and not in a field of a face; true when it was taken. */
	key: (event: KeyboardEvent) => boolean;
	/**
	 * A copy, a cut or a paste asked for while the canvas holds the focus and
	 * no words on it are chosen; true when the canvas took it as its own.
	 */
	clipboard: (kind: 'copy' | 'cut' | 'paste', event: ClipboardEvent) => boolean;
	/** A gesture is over: a paint the workspace held back may now be made. */
	gestureEnded: () => void;
	/** The engine could not be started, or fell over while drawing. */
	failed: (error: unknown) => void;
}

/**
 * What the engine's own parts are called, for a reader that cannot see them.
 * The four dots a line is drawn from are named nowhere: they are the
 * pointer's way to a line, and the way that is everyone's is a node's menu.
 * A line carries no control of its own either: pressed twice it is opened,
 * and its menu is asked for on the line itself.
 */
export interface CanvasLabels {
	canvas: string;
	minimap: string;
}

export interface CanvasOptions {
	/** Unique to this mount: two canvases in two leaves must not share the names of their patterns and markers. */
	id: string;
	viewport: CanvasViewport;
	interaction: CanvasInteraction;
	zoom: { min: number; max: number };
	labels: CanvasLabels;
	reduceMotion: () => boolean;
	/** Whether a press is one that adds to what is chosen: the platform's own modifier, read off the press itself. */
	additive: (event: MouseEvent) => boolean;
	/**
	 * Whether a turn of the wheel sizes the plane rather than moving it: the
	 * platform's own modifier, read off the turn itself. A pinch, which comes
	 * as a turn with Control held, is the engine's own to take.
	 */
	zoomKey: (event: MouseEvent) => boolean;
}

export interface CanvasHandle {
	/** What stands on the canvas now. Held back while a gesture is in flight, and drawn when it ends. */
	setScene: (scene: CanvasScene) => void;
	setInteraction: (change: Partial<CanvasInteraction>) => void;
	selection: () => CanvasSelection;
	select: (selection: CanvasSelection) => void;
	viewport: () => CanvasViewport;
	moveViewport: (target: CanvasViewportTarget) => void;
	/** The place on the plane under a point of the window. */
	toPlane: (client: CanvasPoint) => CanvasPoint;
	/** The middle of what is in sight, on the plane. */
	centre: () => CanvasPoint;
	/** A drag, a sizing, a line being drawn or a box being drawn is in flight. */
	busy: () => boolean;
	remeasure: () => void;
	focus: () => void;
	/** Keeps what every face is still typing, without taking anything down. */
	settle: () => void;
	dispose: () => void;
}

/** What the engine's own module hands back: the one part that is React. */
export interface CanvasRootModule {
	mountRoot: (container: HTMLElement, deps: CanvasRootDeps) => CanvasRoot;
}

export interface CanvasRoot {
	unmount: () => void;
}

/** What the engine is steered by once it stands, handed to the facade as it comes up. */
export interface CanvasFlow {
	viewport: () => CanvasViewport;
	setViewport: (viewport: CanvasViewport, duration: number) => void;
	toPlane: (client: CanvasPoint) => CanvasPoint;
	setSize: (size: CanvasSize) => void;
	setAdditive: (on: boolean) => void;
}

/** One node as the engine holds it: the seam's own node, with what the engine alone keeps of it. */
export interface CanvasHeldNode {
	node: CanvasNode;
	selected: boolean;
	/** Where a gesture in flight has it, until the gesture ends and the view says so too. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CanvasHeldEdge {
	edge: CanvasEdge;
	selected: boolean;
}

/** The lines a node being moved or sized is drawn level with, in the plane's own units; null on an axis it was drawn to none on. */
export interface CanvasGuides {
	x: number | null;
	y: number | null;
}

/** What the engine draws from, held outside it so a root taken down and put up again loses nothing. */
export interface CanvasSnapshot {
	nodes: readonly CanvasHeldNode[];
	edges: readonly CanvasHeldEdge[];
	interaction: CanvasInteraction;
	/** Whether Space, which lets a drag on the ground move the plane, is held over the canvas. */
	panning: boolean;
	/** The lines what is being moved or sized was last drawn level with; null between gestures. */
	guides: CanvasGuides | null;
	band: ZoomBand;
	size: CanvasSize;
}

export interface CanvasStore {
	get: () => CanvasSnapshot;
	subscribe: (listener: () => void) => () => void;
}

/** One change the engine reports of a node, in the seam's words. */
export type CanvasNodeChange =
	| { kind: 'position'; id: string; x: number; y: number; dragging: boolean }
	| { kind: 'size'; id: string; width: number; height: number; resizing: boolean }
	| { kind: 'select'; id: string; selected: boolean };

export type CanvasEdgeChange = { kind: 'select'; id: string; selected: boolean };

/** The faces standing on the canvas, kept by the facade so what they are typing can be kept without the engine. */
export interface CanvasFaces {
	mounted: (id: string, face: PaintedNode) => void;
	/**
	 * A face is about to be taken down. True where it is still to be asked to
	 * keep what it holds; false where the canvas has asked it already, as it
	 * does every face before the engine itself is taken down.
	 */
	unmounted: (id: string, face: PaintedNode) => boolean;
}

export interface CanvasRootDeps {
	options: CanvasOptions;
	store: CanvasStore;
	port: CanvasPort;
	faces: CanvasFaces;
	/** The engine stands, or has gone. */
	attach: (flow: CanvasFlow | null) => void;
	nodesChanged: (changes: readonly CanvasNodeChange[]) => void;
	edgesChanged: (changes: readonly CanvasEdgeChange[]) => void;
	/** A drag of nodes or a sizing has ended. */
	gestureEnded: () => void;
	/** The engine asks for a choosing of its own making: a node taken hold of to be sized is chosen, alone, as a press on it would choose it. */
	choose: (selection: CanvasSelection) => void;
	/** A gesture that holds the canvas busy without moving a node: a line or a box being drawn. */
	holding: (on: boolean) => void;
	moved: (viewport: CanvasViewport, settled: boolean) => void;
}

export type MountFreeformCanvas = (
	host: HTMLElement,
	port: CanvasPort,
	options: CanvasOptions,
) => CanvasHandle;

/** Brings the engine's own code, which is not taken until a canvas is first shown. */
export type LoadCanvasRoot = () => Promise<CanvasRootModule>;
