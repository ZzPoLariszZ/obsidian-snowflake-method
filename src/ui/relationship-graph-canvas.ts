/**
 * The way a relationship graph is raised, given the way the engine's code is
 * brought, and the colours it is drawn with. The engine is d3 and is not
 * taken until a graph is first shown: a handle is given at once and what
 * it is asked is held until the engine stands, the way the freeform canvas
 * does it.
 *
 * The colours are read the way Obsidian's own graph reads them: by setting
 * the classes its renderer probes on a hidden element and taking the
 * computed colour, so a theme that restyles the native graph restyles this
 * one.
 */

import type {
	GraphColors,
	GraphHandle,
	GraphNodePlace,
	LoadGraphRoot,
	MountRelationshipGraph,
} from './relationship-graph-port';

export const RELATIONSHIP_GRAPH_CANVAS_CLASS = 'snowflake-method-relationship-graph-canvas-host';

export const relationshipGraphMount =
	(loadRoot: LoadGraphRoot): MountRelationshipGraph =>
	(host, port) => {
		host.addClass(RELATIONSHIP_GRAPH_CANVAS_CLASS);
		let engine: GraphHandle | null = null;
		let disposed = false;
		/** What was asked before the engine stood, run in order once it does. */
		const owed: ((engine: GraphHandle) => void)[] = [];
		const run = (work: (engine: GraphHandle) => void): void => {
			if (disposed) return;
			if (engine === null) owed.push(work);
			else work(engine);
		};
		void loadRoot()
			.then((module) => {
				if (disposed) return;
				engine = module.mountRelationshipGraph(host, port);
				for (const work of owed.splice(0)) work(engine);
			})
			.catch((error: unknown) => {
				console.error('Snowflake: the relationship graph engine could not be loaded', error);
			});
		return {
			setScene: (scene) => run((inner) => inner.setScene(scene)),
			setViewport: (view) => run((inner) => inner.setViewport(view)),
			fit: () => run((inner) => inner.fit()),
			resetView: () => run((inner) => inner.resetView()),
			zoomBy: (factor) => run((inner) => inner.zoomBy(factor)),
			panBy: (dx, dy) => run((inner) => inner.panBy(dx, dy)),
			focusNode: (id) => run((inner) => inner.focusNode(id)),
			focusedNode: () => engine?.focusedNode() ?? null,
			centreOn: (id) => run((inner) => inner.centreOn(id)),
			nudgeNode: (id, dx, dy) => run((inner) => inner.nudgeNode(id, dx, dy)),
			pinNode: (id, pinned) => run((inner) => inner.pinNode(id, pinned)),
			isPinned: (id) => engine?.isPinned(id) ?? false,
			places: () => engine?.places() ?? new Map<string, GraphNodePlace>(),
			setPlaces: (places) => run((inner) => inner.setPlaces(places)),
			remeasure: () => run((inner) => inner.remeasure()),
			dispose: () => {
				disposed = true;
				owed.length = 0;
				engine?.dispose();
				engine = null;
				host.removeClass(RELATIONSHIP_GRAPH_CANVAS_CLASS);
			},
		};
	};

// --- colours -------------------------------------------------------------------

/** The classes Obsidian's graph renderer probes for its colours, by what each colours. */
export const GRAPH_COLOR_CLASSES = {
	fill: 'color-fill',
	fillFocused: 'color-fill-focused',
	fillUnresolved: 'color-fill-unresolved',
	fillHighlight: 'color-fill-highlight',
	line: 'color-line',
	lineHighlight: 'color-line-highlight',
	arrow: 'color-arrow',
	text: 'color-text',
} as const;

/** What is drawn with where the theme gives nothing to read. */
export const GRAPH_FALLBACK_COLORS: GraphColors = {
	fill: 'rgb(140, 140, 140)',
	fillFocused: 'rgb(124, 77, 255)',
	fillUnresolved: 'rgba(140, 140, 140, 0.5)',
	fillHighlight: 'rgb(124, 77, 255)',
	line: 'rgba(140, 140, 140, 0.6)',
	lineHighlight: 'rgb(124, 77, 255)',
	arrow: 'rgba(140, 140, 140, 0.8)',
	text: 'rgb(140, 140, 140)',
	background: 'rgb(255, 255, 255)',
	accents: {},
	font: '13px sans-serif',
};

/** The theme's fallback accents, in case a theme drops the variables. */
const FALLBACK_ACCENTS: Readonly<Record<string, string>> = {
	red: 'rgb(233, 49, 71)',
	orange: 'rgb(236, 117, 0)',
	yellow: 'rgb(224, 172, 0)',
	green: 'rgb(8, 185, 78)',
	cyan: 'rgb(0, 191, 188)',
	blue: 'rgb(8, 109, 221)',
	purple: 'rgb(120, 82, 238)',
	pink: 'rgb(213, 57, 132)',
};

const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/;
const TRIPLET = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/;

/** A computed colour with the element's opacity folded in; null where there was no colour to read. */
export function withOpacity(color: string | undefined, opacity: string | undefined): string | null {
	if (color === undefined || color.length === 0) return null;
	const alpha = opacity === undefined || opacity.length === 0 ? 1 : Number(opacity);
	if (!Number.isFinite(alpha) || alpha >= 1) return color;
	const match = RGB.exec(color);
	if (match === null) return color;
	const own = match[4] === undefined ? 1 : Number(match[4]);
	return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${(own * alpha).toFixed(3)})`;
}

/** A theme triplet (`120, 82, 238`) as a canvas colour, or null for anything else. */
export function accentColor(triplet: string | undefined): string | null {
	if (triplet === undefined) return null;
	const match = TRIPLET.exec(triplet);
	return match === null ? null : `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
}

/**
 * The graph's colours read off the theme through Obsidian's own probe
 * classes, and the accents named off the body. Where a theme gives nothing
 * to read, the fallbacks stand in, so nothing is ever drawn black on black.
 */
export function probeGraphColors(host: HTMLElement, accentNames: readonly string[]): GraphColors {
	const win = host.win;
	const read = (classes: string): { color: string | null; font: string | null; background: string | null } => {
		const probe = host.createDiv({ cls: classes });
		try {
			const style = win.getComputedStyle(probe);
			const color = withOpacity(style.color, style.opacity);
			const size = style.fontSize;
			const family = style.fontFamily;
			const font = size && family ? `${size} ${family}` : null;
			const background =
				style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : null;
			return { color, font, background };
		} finally {
			probe.remove();
		}
	};
	const colorOf = (key: keyof typeof GRAPH_COLOR_CLASSES): string =>
		read(`graph-view ${GRAPH_COLOR_CLASSES[key]}`).color ?? GRAPH_FALLBACK_COLORS[key];
	const own = read('snowflake-method-relationship-graph-probe');
	const bodyStyle = win.getComputedStyle(host.doc.body);
	const accents: Record<string, string> = {};
	for (const name of accentNames) {
		accents[name] =
			accentColor(bodyStyle.getPropertyValue(`--color-${name}-rgb`)) ?? FALLBACK_ACCENTS[name] ?? GRAPH_FALLBACK_COLORS.fill;
	}
	const painted = (style: CSSStyleDeclaration): string | null =>
		style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : null;
	const background =
		painted(win.getComputedStyle(host)) ?? own.background ?? painted(bodyStyle) ?? GRAPH_FALLBACK_COLORS.background;
	return {
		fill: colorOf('fill'),
		fillFocused: colorOf('fillFocused'),
		fillUnresolved: colorOf('fillUnresolved'),
		fillHighlight: colorOf('fillHighlight'),
		line: colorOf('line'),
		lineHighlight: colorOf('lineHighlight'),
		arrow: colorOf('arrow'),
		text: colorOf('text'),
		background,
		accents,
		font: own.font ?? GRAPH_FALLBACK_COLORS.font,
	};
}
