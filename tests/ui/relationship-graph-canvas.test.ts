import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom } from '../helpers/corkboard-dom';
import {
	accentColor,
	GRAPH_FALLBACK_COLORS,
	probeGraphColors,
	RELATIONSHIP_GRAPH_CANVAS_CLASS,
	relationshipGraphMount,
	withOpacity,
} from '../../src/ui/relationship-graph-canvas';
import type { GraphHandle, GraphPort, GraphRootModule } from '../../src/ui/relationship-graph-port';
import { EMPTY_PICTURE } from '../../src/ui/relationship-graph-model';
import { defaultEntityGraphState } from '../../src/domain';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const port: GraphPort = {
	nodeClicked: () => undefined,
	edgeClicked: () => undefined,
	nodeMenu: () => undefined,
	edgeMenu: () => undefined,
	backgroundMenu: () => undefined,
	viewportMoved: () => undefined,
	focusChanged: () => undefined,
};

/** An engine that only records what it is asked. */
function fakeEngine(): GraphHandle & { calls: string[] } {
	const calls: string[] = [];
	const note =
		(name: string) =>
		(...args: unknown[]): void => {
			calls.push(`${name}(${args.map((arg) => JSON.stringify(arg) ?? 'undefined').join(', ')})`);
		};
	return {
		calls,
		setScene: note('setScene'),
		setViewport: note('setViewport'),
		fit: note('fit'),
		resetView: note('resetView'),
		zoomBy: note('zoomBy'),
		panBy: note('panBy'),
		focusNode: note('focusNode'),
		focusedNode: () => 'alice',
		centreOn: note('centreOn'),
		nudgeNode: note('nudgeNode'),
		pinNode: note('pinNode'),
		isPinned: () => true,
		places: () => new Map([['alice', { x: 1, y: 2, pinned: false }]]),
		setPlaces: note('setPlaces'),
		remeasure: note('remeasure'),
		dispose: note('dispose'),
	};
}

/** A root module that arrives when the test lets it. */
function deferredRoot() {
	const engine = fakeEngine();
	const mountRelationshipGraph = vi.fn(() => engine);
	let arrive: (module: GraphRootModule) => void = () => undefined;
	const module = new Promise<GraphRootModule>((resolve) => {
		arrive = resolve;
	});
	return { engine, mountRelationshipGraph, arrive: () => arrive({ mountRelationshipGraph }), load: () => module };
}

describe('the relationship graph mount', () => {
	it('dresses the host at once and raises the engine when its code arrives', async () => {
		const dom = new CorkboardDom();
		const host = dom.container.createDiv();
		const root = deferredRoot();
		const handle = relationshipGraphMount(root.load)(host as unknown as HTMLElement, port);
		expect(host.classes.has(RELATIONSHIP_GRAPH_CANVAS_CLASS)).toBe(true);
		expect(root.mountRelationshipGraph).not.toHaveBeenCalled();
		root.arrive();
		await settle();
		expect(root.mountRelationshipGraph).toHaveBeenCalledWith(host, port);
		handle.dispose();
		expect(root.engine.calls).toEqual(['dispose()']);
		expect(host.classes.has(RELATIONSHIP_GRAPH_CANVAS_CLASS)).toBe(false);
	});

	it('keeps what was asked before the engine stood and runs it in order once it does', async () => {
		const dom = new CorkboardDom();
		const host = dom.container.createDiv();
		const root = deferredRoot();
		const handle = relationshipGraphMount(root.load)(host as unknown as HTMLElement, port);
		const state = defaultEntityGraphState();
		handle.setScene({ picture: EMPTY_PICTURE, display: state.display, forces: state.forces, colors: GRAPH_FALLBACK_COLORS });
		handle.setViewport({ x: 1, y: 2, k: 0.5 });
		handle.setPlaces(new Map([['bob', { x: 3, y: 4, pinned: true }]]));
		handle.fit();
		handle.pinNode('bob', false);
		expect(handle.focusedNode()).toBeNull();
		expect(handle.isPinned('bob')).toBe(false);
		expect(handle.places().size).toBe(0);
		root.arrive();
		await settle();
		expect(root.engine.calls.map((call) => call.slice(0, call.indexOf('(')))).toEqual([
			'setScene',
			'setViewport',
			'setPlaces',
			'fit',
			'pinNode',
		]);
		expect(root.engine.calls[1]).toBe('setViewport({"x":1,"y":2,"k":0.5})');
		expect(handle.focusedNode()).toBe('alice');
		expect(handle.isPinned('bob')).toBe(true);
		expect(handle.places().get('alice')).toEqual({ x: 1, y: 2, pinned: false });
		handle.zoomBy(2);
		expect(root.engine.calls[root.engine.calls.length - 1]).toBe('zoomBy(2)');
	});

	it('never raises an engine for a host that was taken down before the code came', async () => {
		const dom = new CorkboardDom();
		const host = dom.container.createDiv();
		const root = deferredRoot();
		const handle = relationshipGraphMount(root.load)(host as unknown as HTMLElement, port);
		handle.fit();
		handle.dispose();
		root.arrive();
		await settle();
		expect(root.mountRelationshipGraph).not.toHaveBeenCalled();
		expect(root.engine.calls).toEqual([]);
		handle.resetView();
		expect(root.engine.calls).toEqual([]);
	});

	it('reports a root that will not load and leaves the handle inert', async () => {
		const dom = new CorkboardDom();
		const host = dom.container.createDiv();
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handle = relationshipGraphMount(() => Promise.reject(new Error('offline')))(host as unknown as HTMLElement, port);
		handle.fit();
		await settle();
		expect(error).toHaveBeenCalledTimes(1);
		expect(handle.focusedNode()).toBeNull();
		handle.dispose();
		error.mockRestore();
	});
});

describe('the colour probe', () => {
	it('folds an opacity into a computed colour and leaves other notations alone', () => {
		expect(withOpacity('rgb(10, 20, 30)', '0.5')).toBe('rgba(10, 20, 30, 0.500)');
		expect(withOpacity('rgba(10, 20, 30, 0.5)', '0.5')).toBe('rgba(10, 20, 30, 0.250)');
		expect(withOpacity('rgb(10, 20, 30)', '1')).toBe('rgb(10, 20, 30)');
		expect(withOpacity('rgb(10, 20, 30)', undefined)).toBe('rgb(10, 20, 30)');
		expect(withOpacity('color(display-p3 1 0 0)', '0.5')).toBe('color(display-p3 1 0 0)');
		expect(withOpacity('', '0.5')).toBeNull();
		expect(withOpacity(undefined, '0.5')).toBeNull();
	});

	it('reads a theme triplet as a colour and nothing else', () => {
		expect(accentColor('120, 82, 238')).toBe('rgb(120, 82, 238)');
		expect(accentColor(' 8,109,221 ')).toBe('rgb(8, 109, 221)');
		expect(accentColor('#7852ee')).toBeNull();
		expect(accentColor('')).toBeNull();
		expect(accentColor(undefined)).toBeNull();
	});

	/** A host whose window answers for each probe class, and whose body carries the accents. */
	function themedHost(answers: Record<string, Partial<CSSStyleDeclaration>>, accents: Record<string, string>) {
		const made: { classes: string; removed: boolean }[] = [];
		const body = { kind: 'body' };
		const host = {
			kind: 'host',
			win: {
				getComputedStyle: (element: { classes?: string; kind?: string }): Partial<CSSStyleDeclaration> & { getPropertyValue: (name: string) => string } => ({
					getPropertyValue: (name: string) => accents[name] ?? '',
					...(element.kind === 'body' ? { backgroundColor: 'rgb(30, 30, 30)' } : {}),
					...(element.kind === 'host' ? { backgroundColor: 'rgba(0, 0, 0, 0)' } : {}),
					...(element.classes === undefined ? {} : (answers[element.classes] ?? {})),
				}),
			},
			doc: { body },
			createDiv: ({ cls }: { cls: string }) => {
				const probe = { classes: cls, removed: false, remove: () => { probe.removed = true; } };
				made.push(probe);
				return probe;
			},
		};
		return { host: host as unknown as HTMLElement, made };
	}

	it('reads the colours off the classes the native graph probes, with the opacity folded in', () => {
		const { host, made } = themedHost(
			{
				'graph-view color-fill': { color: 'rgb(1, 2, 3)', opacity: '1' },
				'graph-view color-fill-unresolved': { color: 'rgb(1, 2, 3)', opacity: '0.3' },
				'graph-view color-line': { color: 'rgb(4, 5, 6)', opacity: '0.6' },
				'graph-view color-text': { color: 'rgb(7, 8, 9)', opacity: '' },
				'snowflake-method-relationship-graph-probe': { fontSize: '14px', fontFamily: 'Inter, sans-serif' },
			},
			{ '--color-purple-rgb': '120, 82, 238' },
		);
		const colors = probeGraphColors(host, ['purple', 'orange']);
		expect(colors.fill).toBe('rgb(1, 2, 3)');
		expect(colors.fillUnresolved).toBe('rgba(1, 2, 3, 0.300)');
		expect(colors.line).toBe('rgba(4, 5, 6, 0.600)');
		expect(colors.text).toBe('rgb(7, 8, 9)');
		expect(colors.font).toBe('14px Inter, sans-serif');
		expect(colors.background).toBe('rgb(30, 30, 30)');
		expect(colors.accents).toEqual({ purple: 'rgb(120, 82, 238)', orange: 'rgb(236, 117, 0)' });
		// What the theme gives nothing for falls back, so nothing is drawn black on black.
		expect(colors.fillHighlight).toBe(GRAPH_FALLBACK_COLORS.fillHighlight);
		expect(colors.arrow).toBe(GRAPH_FALLBACK_COLORS.arrow);
		expect(made.every((probe) => probe.removed)).toBe(true);
		expect(made.map((probe) => probe.classes)).toContain('graph-view color-circle'.replace('color-circle', 'color-fill-focused'));
	});

	it('falls back whole on a theme that gives nothing to read', () => {
		const { host } = themedHost({}, {});
		const colors = probeGraphColors(host, ['purple', 'unknown']);
		expect(colors.fill).toBe(GRAPH_FALLBACK_COLORS.fill);
		expect(colors.font).toBe(GRAPH_FALLBACK_COLORS.font);
		expect(colors.background).toBe('rgb(30, 30, 30)');
		expect(colors.accents.purple).toBe('rgb(120, 82, 238)');
		expect(colors.accents.unknown).toBe(GRAPH_FALLBACK_COLORS.fill);
	});
});
