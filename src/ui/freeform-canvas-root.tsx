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
	useStoreApi,
	type Connection,
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
	useSyncExternalStore,
	type ErrorInfo,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
	type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { CANVAS_EDGE_Z, canvasDepth, handleBoxes } from './freeform-canvas-model';
import {
	CANVAS_FRAME_KIND,
	CANVAS_SIDES,
	type CanvasEdge,
	type CanvasEdgeChange,
	type CanvasHeldEdge,
	type CanvasHeldNode,
	type CanvasLink,
	type CanvasNode,
	type CanvasNodeChange,
	type CanvasRoot,
	type CanvasRootDeps,
	type CanvasSide,
	type PaintContext,
	type PaintedNode,
	type ZoomBand,
} from './freeform-canvas-port';

type FlowNode = EngineNode<{ node: CanvasNode }, 'freeform'>;
type FlowEdge = EngineEdge<{ edge: CanvasEdge }, 'freeform'>;

/** How many nodes or lines a canvas draws whole before it draws only what is in sight. */
const WHOLE_NODES = 200;
const WHOLE_EDGES = 400;

/** How wide the ground's pattern is laid, in the plane's own units. */
const GROUND_GAP = 20;

const POSITIONS: Readonly<Record<CanvasSide, Position>> = {
	top: Position.Top,
	right: Position.Right,
	bottom: Position.Bottom,
	left: Position.Left,
};

const isSide = (value: unknown): value is CanvasSide =>
	typeof value === 'string' && (CANVAS_SIDES as readonly string[]).includes(value);

const Deps = createContext<CanvasRootDeps | null>(null);

function useDeps(): CanvasRootDeps {
	const deps = useContext(Deps);
	if (deps === null) throw new Error('The freeform canvas was drawn outside its root.');
	return deps;
}

// -- The facade's nodes said as React Flow's ----------------------------------------

/**
 * One node as React Flow takes it. It is told its size and where its four
 * handles stand, so nothing on the canvas waits to be measured: a line is
 * drawn, a fit is worked out and a sizing starts from what the view says,
 * whether or not the window the canvas stands in ever reports a measure.
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
		handles: handleBoxes(held.width, held.height).map((box) => ({
			id: box.side,
			type: 'source' as const,
			position: POSITIONS[box.side],
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height,
		})),
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
		ariaLabel: edge.label,
		className: `snowflake-method-freeform-edge is-${edge.line}`,
		...(edge.arrow === 'none' ? {} : { markerEnd: { type: MarkerType.ArrowClosed } }),
		...(edge.arrow === 'both' ? { markerStart: { type: MarkerType.ArrowClosed } } : {}),
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

function linkOf(connection: Connection): CanvasLink | null {
	const { source, target, sourceHandle, targetHandle } = connection;
	if (source === target) return null;
	if (!isSide(sourceHandle) || !isSide(targetHandle)) return null;
	return { from: source, fromSide: sourceHandle, to: target, toSide: targetHandle };
}

// -- A node --------------------------------------------------------------------------

/** Where a press begins something of its own, and must not pick the node up. */
const PRESS_SELECTOR = 'input, textarea, select, button, a, [contenteditable="true"], [contenteditable=""]';

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

	useLayoutEffect(() => {
		const host = body.current;
		if (host === null) return undefined;
		// A press on a field or a button of the face is the face's: it is
		// stopped here, under the node, so the engine never takes it for the
		// start of a drag. The click that follows is untouched.
		const keep = (event: Event): void => {
			const target = event.target;
			if (target === null || !(target as Node).instanceOf(Element)) return;
			if ((target as Element).closest(PRESS_SELECTOR) !== null) event.stopPropagation();
		};
		host.addEventListener('mousedown', keep);
		host.addEventListener('touchstart', keep, { passive: true });
		let painted: PaintedNode;
		try {
			painted = deps.port.painter(node.kind).mount(host, id, held.current);
		} catch (error) {
			deps.port.failed(error);
			return () => {
				host.removeEventListener('mousedown', keep);
				host.removeEventListener('touchstart', keep);
			};
		}
		face.current = painted;
		deps.faces.mounted(id, painted);
		return () => {
			host.removeEventListener('mousedown', keep);
			host.removeEventListener('touchstart', keep);
			const owed = deps.faces.unmounted(id, painted);
			face.current = null;
			try {
				if (owed) painted.settle();
			} finally {
				painted.unmount();
			}
		};
		// The painter is chosen by the node's kind alone; how the face is
		// dressed follows in the effect below.
	}, [deps, id, node.kind]);

	useLayoutEffect(() => {
		face.current?.dress(held.current);
	}, [node.revision, selected, readOnly, band, width, height]);

	const still = readOnly || node.locked;
	return (
		<>
			<NodeResizer
				isVisible={selected === true && !still}
				minWidth={node.minWidth}
				minHeight={node.minHeight}
				handleClassName="snowflake-method-freeform-resize-handle"
				lineClassName="snowflake-method-freeform-resize-line"
				onResizeEnd={deps.gestureEnded}
			/>
			{CANVAS_SIDES.map((side) => (
				<Handle
					key={side}
					id={side}
					type="source"
					position={POSITIONS[side]}
					isConnectable={!readOnly && node.connectable}
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

const FreeformEdge = memo(function FreeformEdge(props: EdgeProps<FlowEdge>): ReactElement {
	const [path, labelX, labelY] = getBezierPath({
		sourceX: props.sourceX,
		sourceY: props.sourceY,
		sourcePosition: props.sourcePosition,
		targetX: props.targetX,
		targetY: props.targetY,
		targetPosition: props.targetPosition,
	});
	const label = props.data?.edge.label ?? '';
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
						className={`snowflake-method-freeform-edge-label nodrag nopan${props.selected === true ? ' is-selected' : ''}`}
						style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` }}
					>
						{label}
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	);
});

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

function Flow(): ReactElement {
	const deps = useDeps();
	const { options, port, store: canvas } = deps;
	const snapshot = useSyncExternalStore(canvas.subscribe, canvas.get);
	const { interaction, boxing, size } = snapshot;
	const nodes = useFlowNodes(snapshot.nodes, interaction.readOnly);
	const edges = useFlowEdges(snapshot.edges, interaction.readOnly);
	const flow = useReactFlow<FlowNode, FlowEdge>();
	const store = useStoreApi<FlowNode, FlowEdge>();
	const wrapper = useRef<HTMLDivElement | null>(null);

	// Whether a press adds to what is chosen is read off the press itself, as
	// it goes down and before the engine sees it: a key held when the window
	// lost the keyboard cannot be left standing.
	useEffect(() => {
		const host = wrapper.current;
		if (host === null) return undefined;
		const onPress = (event: PointerEvent): void => {
			const additive = options.additive(event);
			if (store.getState().multiSelectionActive !== additive) {
				store.setState({ multiSelectionActive: additive });
			}
		};
		host.addEventListener('pointerdown', onPress, true);
		return () => {
			host.removeEventListener('pointerdown', onPress, true);
		};
	}, [options, store]);

	// Asked at every drawing, which costs nothing and is never stale: a view
	// moved to another screen is drawn again there.
	const coarse = wrapper.current?.ownerDocument.defaultView?.matchMedia('(pointer: coarse)').matches === true;

	const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
		deps.nodesChanged(nodeChanges(changes));
	}, [deps]);
	const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
		deps.edgesChanged(edgeChanges(changes));
	}, [deps]);
	const onConnect = useCallback((connection: Connection) => {
		const link = linkOf(connection);
		if (link !== null) port.connect(link);
	}, [port]);
	const onReconnect = useCallback((edge: FlowEdge, connection: Connection) => {
		const link = linkOf(connection);
		if (link !== null) port.reconnect(edge.id, link);
	}, [port]);
	const hold = useCallback(() => {
		deps.holding(true);
	}, [deps]);
	const release = useCallback(() => {
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

	const boxes = boxing || interaction.ground === 'select';
	const pans = interaction.ground === 'select' ? false : boxing ? [1] : true;
	return (
		<div ref={wrapper} className="snowflake-method-freeform-flow">
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
				onlyRenderVisibleElements={nodes.length > WHOLE_NODES || edges.length > WHOLE_EDGES}
				nodesDraggable={!interaction.readOnly}
				nodesConnectable={!interaction.readOnly}
				edgesReconnectable={!interaction.readOnly}
				elementsSelectable
				nodesFocusable
				edgesFocusable
				selectionOnDrag={boxes}
				panOnDrag={pans}
				panOnScroll={false}
				zoomOnScroll
				zoomOnPinch
				zoomOnDoubleClick={false}
				preventScrolling
				snapToGrid={interaction.snap !== null}
				snapGrid={snapGrid}
				nodeDragThreshold={coarse ? 6 : 1}
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
				onConnectStart={hold}
				onConnectEnd={release}
				onReconnectStart={hold}
				onReconnectEnd={release}
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
				<Background id={options.id} variant={BackgroundVariant.Dots} gap={GROUND_GAP} size={1} />
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
