/**
 * The seam between the relationship graph's shell and its drawing engine.
 * The shell works out what is to be drawn and the engine draws it; the
 * engine's own code, which is d3's, is not taken until a graph is first
 * shown, so everything the two say to each other is typed here, where
 * neither side's code is needed.
 */

import type { EntityGraphDisplay, EntityGraphForces, GraphEdge, GraphViewport } from '../domain';
import type { GraphPicture } from './relationship-graph-model';

/** The colours the engine draws with, read off the theme by the shell. */
export interface GraphColors {
	readonly fill: string;
	/** The ring around the node the keyboard stands on. */
	readonly fillFocused: string;
	readonly fillUnresolved: string;
	/** The node under the pointer. */
	readonly fillHighlight: string;
	readonly line: string;
	readonly lineHighlight: string;
	readonly arrow: string;
	readonly text: string;
	/** The ground the labels stand on, which backs them for legibility. */
	readonly background: string;
	/** The theme's accents by name (`purple` to `rgb(…)`), which the default groups draw with. */
	readonly accents: Readonly<Record<string, string>>;
	/** The interface font as a canvas font string. */
	readonly font: string;
}

/** Everything the engine needs to draw one picture. */
export interface GraphScene {
	readonly picture: GraphPicture;
	readonly display: EntityGraphDisplay;
	readonly forces: EntityGraphForces;
	readonly colors: GraphColors;
}

/** The keys held when a node was clicked. */
export interface GraphClickModifiers {
	readonly mod: boolean;
	readonly shift: boolean;
}

/** What the engine tells the shell. */
export interface GraphPort {
	nodeClicked(id: string, modifiers: GraphClickModifiers): void;
	edgeClicked(edge: GraphEdge): void;
	nodeMenu(id: string, event: MouseEvent): void;
	edgeMenu(edge: GraphEdge, event: MouseEvent): void;
	backgroundMenu(event: MouseEvent): void;
	/** The view moved, by a gesture, a key or a fit; the shell keeps it, in the native graph's units. */
	viewportMoved(view: GraphViewport): void;
	/** The node the keyboard stands on changed. */
	focusChanged(id: string | null): void;
}

/** Where a node stands, and whether it was pinned there. */
export interface GraphNodePlace {
	readonly x: number;
	readonly y: number;
	readonly pinned: boolean;
}

/** What the shell asks of the engine. */
export interface GraphHandle {
	setScene(scene: GraphScene): void;
	/** Where the view stands, as `viewportMoved` gave it; null fits the graph to the box once the layout has settled. */
	setViewport(view: GraphViewport | null): void;
	fit(): void;
	/** The view at zoom 1 with the graph's origin in the middle. */
	resetView(): void;
	zoomBy(factor: number): void;
	panBy(dx: number, dy: number): void;
	/** Puts the keyboard on a node, drawing its ring; null takes it off. */
	focusNode(id: string | null): void;
	focusedNode(): string | null;
	/** Brings a node into the middle of the view at the zoom standing. */
	centreOn(id: string): void;
	/** Where a node's disc stands on the host, in screen pixels from its corner; null for a node not placed. */
	screenPlaceOf(id: string): { x: number; y: number } | null;
	/** Moves a node by screen pixels. */
	nudgeNode(id: string, dx: number, dy: number): void;
	pinNode(id: string, pinned: boolean): void;
	isPinned(id: string): boolean;
	/** Where every node the engine has met stands, for the session's memory. */
	places(): Map<string, GraphNodePlace>;
	setPlaces(places: ReadonlyMap<string, GraphNodePlace>): void;
	remeasure(): void;
	dispose(): void;
}

export type MountRelationshipGraph = (host: HTMLElement, port: GraphPort) => GraphHandle;

export interface GraphRootModule {
	mountRelationshipGraph: MountRelationshipGraph;
}

/** Brings the engine's own code, which is not taken until a graph is first shown. */
export type LoadGraphRoot = () => Promise<GraphRootModule>;
