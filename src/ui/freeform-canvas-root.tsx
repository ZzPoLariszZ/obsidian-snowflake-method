/**
 * The engine: React Flow, stood on the canvas and told what to draw. This is
 * the plugin's one React file, and it holds no rule of the plugin's own. What
 * stands on the canvas is kept by the facade (`freeform-canvas.ts`), what a
 * change comes to is worked out in the model (`freeform-canvas-model.ts`),
 * and what a node shows is painted by the workspace into an element this
 * file renders empty. What is left here is the telling: the facade's nodes
 * said as React Flow's, React Flow's changes said as the seam's.
 *
 * Every key React Flow would listen for is turned off. It listens on the
 * window the plugin was loaded in, which hears nothing of a canvas moved to
 * a window of its own; the keys are the workspace's to hear instead.
 */

import {
	Background,
	BackgroundVariant,
	BaseEdge,
	ConnectionMode,
	EdgeLabelRenderer,
	Handle,
	MarkerType,
	MiniMap,
	NodeResizer,
	Position,
	ReactFlow,
	ReactFlowProvider,
	getBezierPath,
	useReactFlow,
	useStore,
	useStoreApi,
	type Connection,
	type ConnectionLineComponentProps,
	type Edge as EngineEdge,
	type EdgeChange,
	type EdgeProps,
	type Node as EngineNode,
	type NodeChange,
	type NodeProps,
} from '@xyflow/react';
import {
	Component,
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ErrorInfo,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
	type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { CANVAS_EDGE_Z, canvasDepth, handleBoxes, nearestSide, sideMiddle, wheelZoomFactor, zoomedAbout } from './freeform-canvas-model';
import {
	CANVAS_FAR_KIND,
	CANVAS_FRAME_KIND,
	CANVAS_SIDES,
	type CanvasEdge,
	type CanvasEdgeChange,
	type CanvasHeldEdge,
	type CanvasHeldNode,
	type CanvasLink,
	type CanvasNode,
	type CanvasNodeChange,
	type CanvasPoint,
	type CanvasRoot,
	type CanvasRootDeps,
	type CanvasSide,
	type PaintContext,
	type PaintedNode,
	type ZoomBand,
} from './freeform-canvas-port';

type FlowNode = EngineNode<{ node: CanvasNode }, 'freeform'>;
type FlowEdge = EngineEdge<{ edge: CanvasEdge }, 'freeform'>;

/**
 * How many nodes or lines a canvas draws whole before it draws only what is
 * in sight. Nearer than the far band a face costs enough to draw that only
 * the ones in sight are, and a pan over 500 costs 3 ms a frame that way.
 * From far off every face is its barest and nearly all are in sight, so all
 * are drawn: dropping and raising them at the edges as the plane moved cost
 * more than they do standing, measured at 500 and 1,000.
 */
const WHOLE_NODES = 200;
const WHOLE_EDGES = 400;

/** How wide the ground's pattern is laid, in the plane's own units; the grid a node lands on is as wide. */
const GROUND_GAP = 20;
/** How wide a dot of the pattern is drawn, in the plane's own units. */
const GROUND_DOT = 2;
/**
 * The engine lays each dot at the middle of a cell of its pattern, and a
 * node landing on the grid lands at a corner. Moved by half a cell, and by
 * half a dot more for the dot's own width, the dots stand on the corners.
 */
const GROUND_OFFSET = (GROUND_GAP + GROUND_DOT) / 2;

const POSITIONS: Readonly<Record<CanvasSide, Position>> = {
	top: Position.Top,
	right: Position.Right,
	bottom: Position.Bottom,
	left: Position.Left,
};

const isSide = (value: unknown): value is CanvasSide =>
	typeof value === 'string' && (CANVAS_SIDES as readonly string[]).includes(value);

/**
 * The handle that is the whole of a node. A line may land on it anywhere, as
 * on the app's own canvas, and never start from it: the side it then lands
 * by is the one nearest where it was let go, worked out where the gesture
 * ends. It is the engine's to find under the pointer, so it is told as a
 * handle, and the stylesheet lets it be pressed only while a line is drawn.
 */
const BODY_HANDLE = 'body';

/** The variable the stylesheet sizes the frame a node is held by and the dots a line starts from, so both keep their size on the screen as the plane is zoomed. */
const UNZOOM_VAR = '--snowflake-method-freeform-unzoom';

const Deps = createContext<CanvasRootDeps | null>(null);

function useDeps(): CanvasRootDeps {
	const deps = useContext(Deps);
	if (deps === null) throw new Error('The freeform canvas was drawn outside its root.');
	return deps;
}

// -- The facade's nodes said as React Flow's ----------------------------------------

/**
 * One node as React Flow takes it. It is told its size and where its handles
 * stand, so nothing on the canvas waits to be measured: a line is drawn, a
 * fit is worked out and a sizing starts from what the view says, whether or
 * not the window the canvas stands in ever reports a measure. The list names
 * every handle the node has, the whole of it included: the engine takes this
 * list for the node's handles again whenever the node is told afresh, and a
 * handle left out of it is one a line could be let go on and never land on.
 */
function flowNode(held: CanvasHeldNode, readOnly: boolean): FlowNode {
	const { node } = held;
	const still = readOnly || node.locked;
	return {
		id: node.id,
		type: 'freeform',
		position: { x: held.x, y: held.y },
		width: held.width,
		height: held.height,
		measured: { width: held.width, height: held.height },
		handles: [
			...handleBoxes(held.width, held.height).map((box) => ({
				id: box.side,
				type: 'source' as const,
				position: POSITIONS[box.side],
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
			})),
			{ id: BODY_HANDLE, type: 'target' as const, position: Position.Top, x: 0, y: 0, width: held.width, height: held.height },
		],
		zIndex: canvasDepth(node),
		selected: held.selected,
		draggable: !still,
		connectable: !readOnly && node.connectable,
		selectable: true,
		focusable: true,
		ariaLabel: node.label,
		className: [
			'snowflake-method-freeform-node',
			node.kind === CANVAS_FRAME_KIND ? 'is-frame' : 'is-card',
			node.tone === null ? '' : node.tone,
		].filter((part) => part.length > 0).join(' '),
		data: { node },
	};
}

function flowEdge(held: CanvasHeldEdge, readOnly: boolean): FlowEdge {
	const { edge } = held;
	return {
		id: edge.id,
		type: 'freeform',
		source: edge.from,
		target: edge.to,
		sourceHandle: edge.fromSide,
		targetHandle: edge.toSide,
		selected: held.selected,
		zIndex: CANVAS_EDGE_Z,
		reconnectable: !readOnly,
		focusable: true,
		ariaLabel: edge.name,
		className: `snowflake-method-freeform-edge is-${edge.line}`,
		...(edge.arrow === 'end' || edge.arrow === 'both' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
		...(edge.arrow === 'start' || edge.arrow === 'both' ? { markerStart: { type: MarkerType.ArrowClosed } } : {}),
		data: { edge },
	};
}

/** What was made of an entry last, so an entry that is the one it was is the node it was. */
interface Made<Flow> {
	readOnly: boolean;
	flow: Flow;
}

function useFlowNodes(held: readonly CanvasHeldNode[], readOnly: boolean): FlowNode[] {
	const made = useRef(new WeakMap<CanvasHeldNode, Made<FlowNode>>());
	return useMemo(() => held.map((entry) => {
		const kept = made.current.get(entry);
		if (kept !== undefined && kept.readOnly === readOnly) return kept.flow;
		const flow = flowNode(entry, readOnly);
		made.current.set(entry, { readOnly, flow });
		return flow;
	}), [held, readOnly]);
}

function useFlowEdges(held: readonly CanvasHeldEdge[], readOnly: boolean): FlowEdge[] {
	const made = useRef(new WeakMap<CanvasHeldEdge, Made<FlowEdge>>());
	return useMemo(() => held.map((entry) => {
		const kept = made.current.get(entry);
		if (kept !== undefined && kept.readOnly === readOnly) return kept.flow;
		const flow = flowEdge(entry, readOnly);
		made.current.set(entry, { readOnly, flow });
		return flow;
	}), [held, readOnly]);
}

// -- React Flow's changes said as the seam's -----------------------------------------

function nodeChanges(changes: readonly NodeChange<FlowNode>[]): CanvasNodeChange[] {
	const said: CanvasNodeChange[] = [];
	for (const change of changes) {
		if (change.type === 'position') {
			if (change.position === undefined) continue;
			said.push({
				kind: 'position',
				id: change.id,
				x: change.position.x,
				y: change.position.y,
				dragging: change.dragging === true,
			});
		} else if (change.type === 'dimensions') {
			// A measure the engine took of a node it was already told the size
			// of says nothing new; only a sizing by hand carries the word.
			if (change.resizing === undefined || change.dimensions === undefined) continue;
			said.push({
				kind: 'size',
				id: change.id,
				width: change.dimensions.width,
				height: change.dimensions.height,
				resizing: change.resizing,
			});
		} else if (change.type === 'select') {
			said.push({ kind: 'select', id: change.id, selected: change.selected });
		}
	}
	return said;
}

function edgeChanges(changes: readonly EdgeChange<FlowEdge>[]): CanvasEdgeChange[] {
	const said: CanvasEdgeChange[] = [];
	for (const change of changes) {
		if (change.type === 'select') said.push({ kind: 'select', id: change.id, selected: change.selected });
	}
	return said;
}

/** The box a node of the engine's stands in, in the plane's own units. */
function boxOf(node: Pick<FlowNode, 'width' | 'height'> & { measured: { width?: number; height?: number }; internals: { positionAbsolute: CanvasPoint } }): { x: number; y: number; width: number; height: number } {
	return {
		x: node.internals.positionAbsolute.x,
		y: node.internals.positionAbsolute.y,
		width: node.measured.width ?? node.width ?? 0,
		height: node.measured.height ?? node.height ?? 0,
	};
}

// -- A node --------------------------------------------------------------------------

/**
 * Where a press begins something of its own, which a drag would swallow: a
 * selection in a field, a choice from a list. A press on a button or a link
 * is a click still to come, and a move before it drags the node: a scene's
 * card is mostly buttons, and a card that could be taken hold of nowhere
 * would be a card that cannot be moved. The click survives a press that
 * hardly moved, by the engine's own click distance.
 */
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
/** What a press twice belongs to: every control, since a title pressed twice is being edited, not opened. */
const CONTROL_SELECTOR = `${FIELD_SELECTOR}, button, a`;

function useBand(): ZoomBand {
	const { store } = useDeps();
	return useSyncExternalStore(store.subscribe, () => store.get().band);
}

function useReadOnly(): boolean {
	const { store } = useDeps();
	return useSyncExternalStore(store.subscribe, () => store.get().interaction.readOnly);
}

const FreeformNode = memo(function FreeformNode(props: NodeProps<FlowNode>): ReactElement {
	const deps = useDeps();
	const { id, selected } = props;
	const { node } = props.data;
	const width = props.width ?? node.width;
	const height = props.height ?? node.height;
	const band = useBand();
	const readOnly = useReadOnly();
	const body = useRef<HTMLDivElement | null>(null);
	const face = useRef<PaintedNode | null>(null);
	const context: PaintContext = { selected: selected === true, readOnly, band, width, height };
	const held = useRef(context);
	held.current = context;
	// From far off every node but a frame is dressed by the far painter: its
	// face is taken down, and raised again as the canvas comes nearer.
	const kind = band === 'far' && node.kind !== CANVAS_FRAME_KIND ? CANVAS_FAR_KIND : node.kind;

	useLayoutEffect(() => {
		const host = body.current;
		if (host === null) return undefined;
		// A press in a field of the face is the field's: it is stopped here,
		// under the node, so the engine never takes it for the start of a drag.
		// A double click on any control of the face is the control's too.
		const keep = (selector: string) => (event: Event): void => {
			const target = event.target;
			if (target === null || !(target as Node).instanceOf(Element)) return;
			if ((target as Element).closest(selector) !== null) event.stopPropagation();
		};
		const keepPress = keep(FIELD_SELECTOR);
		const keepTwice = keep(CONTROL_SELECTOR);
		host.addEventListener('mousedown', keepPress);
		host.addEventListener('touchstart', keepPress, { passive: true });
		host.addEventListener('dblclick', keepTwice);
		const letGo = (): void => {
			host.removeEventListener('mousedown', keepPress);
			host.removeEventListener('touchstart', keepPress);
			host.removeEventListener('dblclick', keepTwice);
		};
		let painted: PaintedNode;
		try {
			painted = deps.port.painter(kind).mount(host, id, held.current);
		} catch (error) {
			deps.port.failed(error);
			return letGo;
		}
		face.current = painted;
		deps.faces.mounted(id, painted);
		return () => {
			letGo();
			const owed = deps.faces.unmounted(id, painted);
			face.current = null;
			try {
				if (owed) painted.settle();
			} finally {
				painted.unmount();
			}
		};
		// The painter is chosen by the node's kind and by how far off the
		// canvas is looked at from; how the face is dressed follows in the effect below.
	}, [deps, id, kind]);

	useLayoutEffect(() => {
		face.current?.dress(held.current);
	}, [node.revision, selected, readOnly, band, width, height]);

	// The frame a node is sized by stands only while the node is under the
	// pointer or chosen: it is eight controls the engine listens on, which
	// five hundred nodes need not all carry at once. A move over the node
	// says so as well as the entering does, for a pointer whose entering
	// was never heard: one that was pressed elsewhere as it came.
	const [hovered, setHovered] = useState(false);
	useLayoutEffect(() => {
		const wrapper = body.current?.parentElement;
		if (wrapper === null || wrapper === undefined) return undefined;
		const over = (): void => {
			setHovered(true);
		};
		const out = (): void => {
			setHovered(false);
		};
		wrapper.addEventListener('pointerenter', over);
		wrapper.addEventListener('pointermove', over);
		wrapper.addEventListener('pointerleave', out);
		return () => {
			wrapper.removeEventListener('pointerenter', over);
			wrapper.removeEventListener('pointermove', over);
			wrapper.removeEventListener('pointerleave', out);
		};
	}, []);
	// Taken hold of to be sized, a node is chosen as a press on it would choose it.
	const onResizeStart = useCallback(() => {
		if (!held.current.selected) deps.choose({ nodes: [id], edges: [] });
	}, [deps, id]);

	const still = readOnly || node.locked;
	const connectable = !readOnly && node.connectable;
	return (
		<>
			<NodeResizer
				isVisible={(selected === true || hovered) && !still}
				minWidth={node.minWidth}
				minHeight={node.minHeight}
				autoScale={false}
				handleClassName="snowflake-method-freeform-resize-handle"
				lineClassName="snowflake-method-freeform-resize-line"
				onResizeStart={onResizeStart}
				onResizeEnd={deps.gestureEnded}
			/>
			<Handle
				id={BODY_HANDLE}
				type="target"
				position={Position.Top}
				isConnectable={connectable}
				isConnectableStart={false}
				className="snowflake-method-freeform-handle-body"
				aria-hidden="true"
			/>
			{CANVAS_SIDES.map((side) => (
				<Handle
					key={side}
					id={side}
					type="source"
					position={POSITIONS[side]}
					isConnectable={connectable}
					className="snowflake-method-freeform-handle"
					aria-hidden="true"
				/>
			))}
			<div ref={body} className="snowflake-method-freeform-node-body nokey" data-kind={node.kind} />
		</>
	);
}, (before, after) =>
	before.id === after.id &&
	before.data.node === after.data.node &&
	before.selected === after.selected &&
	before.width === after.width &&
	before.height === after.height &&
	before.isConnectable === after.isConnectable &&
	before.draggable === after.draggable);

// -- A line --------------------------------------------------------------------------

/**
 * A line, with its words on it where it has any. It carries no control of
 * its own: pressed twice it is opened, and its menu is asked for on the
 * line itself, as on a node; the words stand for the line where they are
 * pressed, since they are drawn over it and would else take the press
 * for the ground's.
 */
const FreeformEdge = memo(function FreeformEdge(props: EdgeProps<FlowEdge>): ReactElement {
	const { port } = useDeps();
	const [path, labelX, labelY] = getBezierPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
	});
	const label = props.data?.edge.label ?? '';
	const selected = props.selected === true;
	const id = props.id;
	const openTwice = useCallback((event: ReactMouseEvent) => {
		event.stopPropagation();
		port.open({ kind: 'edge', id }, event.nativeEvent);
	}, [id, port]);
	const openMenu = useCallback((event: ReactMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		port.menu({ kind: 'edge', id }, event.nativeEvent);
	}, [id, port]);
	return (
		<>
			<BaseEdge
				id={props.id}
				path={path}
				{...(props.markerEnd === undefined ? {} : { markerEnd: props.markerEnd })}
				{...(props.markerStart === undefined ? {} : { markerStart: props.markerStart })}
				interactionWidth={24}
			/>
			{label.length === 0 ? null : (
				<EdgeLabelRenderer>
					<div
						className={`snowflake-method-freeform-edge-label nodrag nopan${selected ? ' is-selected' : ''}`}
						style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` }}
						onDoubleClick={openTwice}
						onContextMenu={openMenu}
					>
						<span className="snowflake-method-freeform-edge-words">{label}</span>
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	);
});

/**
 * The line drawn while a connection is: from the dot it started at to the
 * pointer, or, over a node it may land on, to the side it will land by, so
 * what is let go is what was seen. The engine says where the pointer stands
 * in the screen's units of the canvas, and the plane's own are wanted.
 */
function FreeformConnectionLine(props: ConnectionLineComponentProps<FlowNode>): ReactElement {
	const [tx, ty, zoom] = useStore((state) => state.transform);
	let { toX, toY, toPosition } = props;
	if (props.toNode !== null && props.toHandle?.id === BODY_HANDLE) {
		const box = boxOf(props.toNode);
		const side = nearestSide(box, { x: (props.pointer.x - tx) / zoom, y: (props.pointer.y - ty) / zoom });
		const end = sideMiddle(box, side);
		toX = end.x;
		toY = end.y;
		toPosition = POSITIONS[side];
	}
	const [path] = getBezierPath({
		sourceX: props.fromX,
		sourceY: props.fromY,
		sourcePosition: props.fromPosition,
		targetX: toX,
		targetY: toY,
		targetPosition: toPosition,
	});
	return (
		<path
			d={path}
			fill="none"
			className="react-flow__connection-path"
			{...(props.connectionLineStyle === undefined ? {} : { style: props.connectionLineStyle })}
		/>
	);
}

/** Tells the stylesheet how far the plane is zoomed, so what is sized on the screen can be sized in the plane's units. */
function Unzoom(): null {
	const zoom = useStore((state) => state.transform[2]);
	const domNode = useStore((state) => state.domNode);
	useLayoutEffect(() => {
		domNode?.style.setProperty(UNZOOM_VAR, String(1 / zoom));
	}, [domNode, zoom]);
	return null;
}

const NODE_TYPES = { freeform: FreeformNode };
const EDGE_TYPES = { freeform: FreeformEdge };

/** Said once, so the canvas is not handed another object at every drawing. */
const PRO_OPTIONS = { hideAttribution: true };

// -- The canvas ----------------------------------------------------------------------

/** Hands the facade the engine's own reins once it stands, and takes them back as it goes. */
function Reins(): null {
	const deps = useDeps();
	const flow = useReactFlow<FlowNode, FlowEdge>();
	const store = useStoreApi<FlowNode, FlowEdge>();
	useEffect(() => {
		deps.attach({
			viewport: () => flow.getViewport(),
			setViewport: (viewport, duration) => {
				// Never waited for: a move shown on a window that is not drawing may never end.
				void flow.setViewport(viewport, { duration });
			},
			toPlane: (client) => flow.screenToFlowPosition(client, { snapToGrid: false }),
			setSize: (size) => {
				if (size.width === 0 || size.height === 0) return;
				const held = store.getState();
				if (held.width !== size.width || held.height !== size.height) store.setState(size);
			},
			setAdditive: (on) => {
				if (store.getState().multiSelectionActive !== on) store.setState({ multiSelectionActive: on });
			},
		});
		return () => {
			deps.attach(null);
		};
	}, [deps, flow, store]);
	return null;
}

/** The lines a node being moved or sized is drawn level with, laid across the whole canvas in the screen's own pixels. */
function Guides(): ReactElement | null {
	const { store: canvas } = useDeps();
	const { guides } = useSyncExternalStore(canvas.subscribe, canvas.get);
	const transform = useStore((state) => state.transform);
	if (guides === null) return null;
	const [tx, ty, zoom] = transform;
	return (
		<div className="snowflake-method-freeform-guides" aria-hidden="true">
			{guides.x === null ? null : <div className="snowflake-method-freeform-guide is-upright" style={{ left: guides.x * zoom + tx }} />}
			{guides.y === null ? null : <div className="snowflake-method-freeform-guide is-level" style={{ top: guides.y * zoom + ty }} />}
		</div>
	);
}

function Flow(): ReactElement {
	const deps = useDeps();
	const { options, port, store: canvas } = deps;
	const snapshot = useSyncExternalStore(canvas.subscribe, canvas.get);
	const { interaction, panning, size } = snapshot;
	const nodes = useFlowNodes(snapshot.nodes, interaction.readOnly);
	const edges = useFlowEdges(snapshot.edges, interaction.readOnly);
	const flow = useReactFlow<FlowNode, FlowEdge>();
	const store = useStoreApi<FlowNode, FlowEdge>();
	const wrapper = useRef<HTMLDivElement | null>(null);
	/** Where the pointer last stood over the canvas, in the window's units: where a line is let go is read off it. */
	const pointer = useRef<CanvasPoint | null>(null);
	/** A line is being drawn, which the stylesheet is told of: the frames nodes are sized by must not take its end. */
	const [connecting, setConnecting] = useState(false);

	// Whether a press adds to what is chosen is read off the press itself, as
	// it goes down and before the engine sees it: a key held when the window
	// lost the keyboard cannot be left standing.
	useEffect(() => {
		const host = wrapper.current;
		if (host === null) return undefined;
		const onPress = (event: PointerEvent): void => {
			pointer.current = { x: event.clientX, y: event.clientY };
			const additive = options.additive(event);
			if (store.getState().multiSelectionActive !== additive) {
				store.setState({ multiSelectionActive: additive });
			}
		};
		const onMove = (event: PointerEvent): void => {
			pointer.current = { x: event.clientX, y: event.clientY };
		};
		host.addEventListener('pointerdown', onPress, true);
		host.addEventListener('pointermove', onMove, true);
		return () => {
			host.removeEventListener('pointerdown', onPress, true);
			host.removeEventListener('pointermove', onMove, true);
		};
	}, [options, store]);

	// The platform's own key over the wheel sizes the plane about the pointer,
	// as the app's canvas does; a turn without it moves the plane, which the
	// engine does of itself. Read off the turn, which no stale key misleads,
	// and taken ahead of the engine, which would move the plane by it.
	useEffect(() => {
		const host = wrapper.current;
		if (host === null) return undefined;
		const onWheel = (event: WheelEvent): void => {
			if (!options.zoomKey(event)) return;
			// The minimap sizes itself by its own wheel.
			const panel = (event.target as Partial<Element> | null)?.closest?.('.react-flow__panel');
			if (panel !== null && panel !== undefined) return;
			event.preventDefault();
			event.stopPropagation();
			const box = (store.getState().domNode ?? host).getBoundingClientRect();
			const about = { x: event.clientX - box.left, y: event.clientY - box.top };
			void flow.setViewport(
				zoomedAbout(flow.getViewport(), about, wheelZoomFactor(event.deltaY, event.deltaMode), options.zoom),
				{ duration: 0 },
			);
		};
		host.addEventListener('wheel', onWheel, { capture: true, passive: false });
		return () => {
			host.removeEventListener('wheel', onWheel, { capture: true });
		};
	}, [flow, options, store]);

	// Asked at every drawing, which costs nothing and is never stale: a view
	// moved to another screen is drawn again there.
	const coarse = wrapper.current?.ownerDocument.defaultView?.matchMedia('(pointer: coarse)').matches === true;

	const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
		deps.nodesChanged(nodeChanges(changes));
	}, [deps]);
	const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
		deps.edgesChanged(edgeChanges(changes));
	}, [deps]);
	/**
	 * What a connection the engine reports comes to: the node and side at
	 * each end. An end let go on a dot is that dot's side; one let go on the
	 * whole of a node lands by the side nearest where it was let go.
	 */
	const landed = useCallback((connection: Connection): CanvasLink | null => {
		const { source, target, sourceHandle, targetHandle } = connection;
		if (source === target) return null;
		const at = pointer.current === null ? null : flow.screenToFlowPosition(pointer.current, { snapToGrid: false });
		const sideOf = (id: string, handle: string | null): CanvasSide | null => {
			if (isSide(handle)) return handle;
			if (handle !== BODY_HANDLE || at === null) return null;
			const held = canvas.get().nodes.find((entry) => entry.node.id === id);
			return held === undefined ? null : nearestSide(held, at);
		};
		const fromSide = sideOf(source, sourceHandle);
		const toSide = sideOf(target, targetHandle);
		if (fromSide === null || toSide === null) return null;
		return { from: source, fromSide, to: target, toSide };
	}, [canvas, flow]);
	const onConnect = useCallback((connection: Connection) => {
		const link = landed(connection);
		if (link !== null) port.connect(link);
	}, [landed, port]);
	// A line from a node to itself joins nothing: the engine says so as it is drawn, and never asks for it.
	const isValidConnection = useCallback((connection: Connection | FlowEdge) => connection.source !== connection.target, []);
	const onReconnect = useCallback((edge: FlowEdge, connection: Connection) => {
		const link = landed(connection);
		if (link !== null) port.reconnect(edge.id, link);
	}, [landed, port]);
	const hold = useCallback(() => {
		deps.holding(true);
	}, [deps]);
	const release = useCallback(() => {
		deps.holding(false);
	}, [deps]);
	// A line's drawing, begun or ended, is a hold on the canvas too; moving
	// one end of a line that stands begins and ends it the same way.
	const connectStart = useCallback(() => {
		setConnecting(true);
		deps.holding(true);
	}, [deps]);
	const connectEnd = useCallback(() => {
		setConnecting(false);
		deps.holding(false);
	}, [deps]);
	const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: FlowNode) => {
		// A face that opened a menu of its own has answered the press already.
		if (event.defaultPrevented) return;
		event.preventDefault();
		port.menu({ kind: 'node', id: node.id }, event.nativeEvent);
	}, [port]);
	const onSelectionContextMenu = useCallback((event: ReactMouseEvent, chosen: FlowNode[]) => {
		const first = chosen[0];
		if (first === undefined) return;
		event.preventDefault();
		port.menu({ kind: 'node', id: first.id }, event.nativeEvent);
	}, [port]);
	const onEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: FlowEdge) => {
		event.preventDefault();
		port.menu({ kind: 'edge', id: edge.id }, event.nativeEvent);
	}, [port]);
	const onPaneContextMenu = useCallback((event: ReactMouseEvent | MouseEvent) => {
		event.preventDefault();
		const native = 'nativeEvent' in event ? event.nativeEvent : event;
		port.menu({
			kind: 'ground',
			at: flow.screenToFlowPosition({ x: native.clientX, y: native.clientY }, { snapToGrid: false }),
		}, native);
	}, [flow, port]);
	const onNodeDoubleClick = useCallback((event: ReactMouseEvent, node: FlowNode) => {
		if (event.defaultPrevented) return;
		port.open({ kind: 'node', id: node.id }, event.nativeEvent);
	}, [port]);
	const onEdgeDoubleClick = useCallback((event: ReactMouseEvent, edge: FlowEdge) => {
		port.open({ kind: 'edge', id: edge.id }, event.nativeEvent);
	}, [port]);
	const onDoubleClick = useCallback((event: ReactMouseEvent) => {
		const target = event.target as Element;
		if (!target.classList.contains('react-flow__pane')) return;
		port.open({
			kind: 'ground',
			at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false }),
		}, event.nativeEvent);
	}, [flow, port]);
	const onMove = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
		deps.moved(viewport, false);
	}, [deps]);
	const onMoveEnd = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
		deps.moved(viewport, true);
	}, [deps]);
	const onError = useCallback((code: string, message: string) => {
		// A canvas with no size yet is one that is not shown yet, which is no fault.
		if (code === '004') return;
		console.error(`Snowflake: the freeform canvas reported ${code}: ${message}`);
	}, []);
	const snapGrid = useMemo((): [number, number] => {
		const step = interaction.snap ?? GROUND_GAP;
		return [step, step];
	}, [interaction.snap]);

	// A drag on the ground draws a box, as the app's canvas has it; the plane
	// is moved by the middle button, or by any button while Space is held. A
	// finger has neither, so it moves the plane unless the controls' switch
	// says it draws the box: the engine lets a finger pass where a button is
	// named, and takes it for the box only where none is.
	const pans = interaction.ground === 'select' ? false : panning ? true : [1];
	return (
		<div ref={wrapper} className={connecting ? 'snowflake-method-freeform-flow is-connecting' : 'snowflake-method-freeform-flow'}>
			<ReactFlow<FlowNode, FlowEdge>
				id={options.id}
				nodes={nodes}
				edges={edges}
				nodeTypes={NODE_TYPES}
				edgeTypes={EDGE_TYPES}
				width={size.width}
				height={size.height}
				defaultViewport={options.viewport}
				minZoom={options.zoom.min}
				maxZoom={options.zoom.max}
				colorMode="light"
				aria-label={options.labels.canvas}
				connectionMode={ConnectionMode.Loose}
				zIndexMode="manual"
				elevateNodesOnSelect={false}
				elevateEdgesOnSelect={false}
				onlyRenderVisibleElements={snapshot.band !== 'far' && (nodes.length > WHOLE_NODES || edges.length > WHOLE_EDGES)}
				nodesDraggable={!interaction.readOnly}
				nodesConnectable={!interaction.readOnly}
				edgesReconnectable={!interaction.readOnly}
				elementsSelectable
				nodesFocusable
				edgesFocusable
				selectionOnDrag
				panOnDrag={pans}
				panOnScroll
				panOnScrollSpeed={1}
				zoomOnScroll={false}
				zoomOnPinch
				zoomOnDoubleClick={false}
				preventScrolling
				snapToGrid={interaction.snap !== null}
				snapGrid={snapGrid}
				nodeDragThreshold={coarse ? 8 : 4}
				nodeClickDistance={coarse ? 8 : 4}
				connectionRadius={coarse ? 40 : 20}
				deleteKeyCode={null}
				selectionKeyCode={null}
				multiSelectionKeyCode={null}
				panActivationKeyCode={null}
				zoomActivationKeyCode={null}
				proOptions={PRO_OPTIONS}
				defaultMarkerColor={null}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeDragStop={deps.gestureEnded}
				onSelectionDragStop={deps.gestureEnded}
				onSelectionStart={hold}
				onSelectionEnd={release}
				onConnectStart={connectStart}
				onConnectEnd={connectEnd}
				onReconnectStart={hold}
				onReconnectEnd={release}
				connectionLineComponent={FreeformConnectionLine}
				isValidConnection={isValidConnection}
				onConnect={onConnect}
				onReconnect={onReconnect}
				onNodeContextMenu={onNodeContextMenu}
				onSelectionContextMenu={onSelectionContextMenu}
				onEdgeContextMenu={onEdgeContextMenu}
				onPaneContextMenu={onPaneContextMenu}
				onNodeDoubleClick={onNodeDoubleClick}
				onEdgeDoubleClick={onEdgeDoubleClick}
				onDoubleClick={onDoubleClick}
				onMove={onMove}
				onMoveEnd={onMoveEnd}
				onError={onError}
			>
				<Background id={options.id} variant={BackgroundVariant.Dots} gap={GROUND_GAP} size={GROUND_DOT} offset={GROUND_OFFSET} />
				<Guides />
				<Unzoom />
				{interaction.minimap ? (
					<MiniMap
						pannable
						zoomable
						position="bottom-right"
						ariaLabel={options.labels.minimap}
						className="snowflake-method-freeform-minimap"
					/>
				) : null}
				<Reins />
			</ReactFlow>
		</div>
	);
}

/** Catches what falls over while the canvas draws, and says so to the workspace rather than to a blank tab. */
class Guard extends Component<{ failed: (error: unknown) => void; children: ReactNode }, { fell: boolean }> {
	override state = { fell: false };

	static getDerivedStateFromError(): { fell: boolean } {
		return { fell: true };
	}

	override componentDidCatch(error: Error, _info: ErrorInfo): void {
		this.props.failed(error);
	}

	override render(): ReactNode {
		return this.state.fell ? null : this.props.children;
	}
}

export function mountRoot(container: HTMLElement, deps: CanvasRootDeps): CanvasRoot {
	const root = createRoot(container);
	// Drawn before this call is over, and not in a turn of its own: a canvas
	// is raised as its tab is shown, and what is drawn a turn later is drawn a
	// frame late, over a ground that stood empty for that frame.
	flushSync(() => {
		root.render(
			<Guard failed={deps.port.failed}>
				<Deps.Provider value={deps}>
					<ReactFlowProvider>
						<Flow />
					</ReactFlowProvider>
				</Deps.Provider>
			</Guard>,
		);
	});
	return {
		unmount: () => {
			root.unmount();
		},
	};
}
