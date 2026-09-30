// @vitest-environment happy-dom

/**
 * The canvas's engine raised on a real document, by the plugin's own code:
 * the facade, the one React file behind it, and React Flow under that. What
 * the facade works out is read elsewhere, on no document at all; this file
 * says what only a document can: that the engine draws what it is told, that
 * none of the library's own key listening reaches the window, that a face is
 * asked once to keep what it holds, and that an engine taken down and raised
 * again, as it is when its view is moved to another window, loses nothing
 * the author had in hand.
 */

import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { freeformCanvasMount } from '../../src/ui/freeform-canvas';
import {
	NO_CANVAS_SELECTION,
	type CanvasEdge,
	type CanvasHandle,
	type CanvasNode,
	type CanvasOptions,
	type CanvasPort,
	type PaintContext,
} from '../../src/ui/freeform-canvas-port';
import { installObsidianDom, migrate, migrationListeners } from '../helpers/obsidian-dom';

declare global {
	// React asks for this before it lets `act` stand in for the scheduler.
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
	installObsidianDom(window);
});

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({
	id, kind: 'text', x: 0, y: 0, width: 200, height: 100, z: 0, frame: null,
	revision: `words of ${id}`, label: `Node ${id}`, tone: null, locked: false, connectable: false,
	minWidth: 96, minHeight: 48,
	...extra,
});

const edge = (id: string, from: string, to: string, extra: Partial<CanvasEdge> = {}): CanvasEdge => ({
	id, from, fromSide: 'right', to, toSide: 'left', label: '', arrow: 'end', line: 'solid', revision: '', ...extra,
});

interface Painted {
	id: string;
	kind: string;
	body: HTMLElement;
	dressed: PaintContext[];
	settled: number;
	unmounted: number;
}

const last = <T,>(entries: readonly T[]): T | undefined => entries[entries.length - 1];

const standing: { handle: CanvasHandle; host: HTMLElement }[] = [];

function canvas(size: { width: number; height: number } = { width: 800, height: 600 }, options: Partial<CanvasOptions> = {}) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	let measure = size;
	Object.defineProperties(host, {
		clientWidth: { configurable: true, get: () => measure.width },
		clientHeight: { configurable: true, get: () => measure.height },
	});
	const painted: Painted[] = [];
	const port = {
		painter: vi.fn((kind: string) => ({
			mount: (body: HTMLElement, id: string, context: PaintContext) => {
				const entry: Painted = { id, kind, body, dressed: [context], settled: 0, unmounted: 0 };
				painted.push(entry);
				const face = body.ownerDocument.createElement('div');
				face.className = 'face';
				face.textContent = `${kind} ${id}`;
				body.appendChild(face);
				return {
					dress: (next: PaintContext) => { entry.dressed.push(next); },
					settle: () => { entry.settled += 1; },
					unmount: () => {
						entry.unmounted += 1;
						face.remove();
					},
				};
			},
		})),
		commit: vi.fn(),
		connect: vi.fn(),
		reconnect: vi.fn(),
		selectionChanged: vi.fn(),
		viewportChanged: vi.fn(),
		menu: vi.fn(),
		open: vi.fn(),
		key: vi.fn(() => false),
		clipboard: vi.fn(),
		gestureEnded: vi.fn(),
		failed: vi.fn(),
	} satisfies CanvasPort;
	const mount = freeformCanvasMount(() => import('../../src/ui/freeform-canvas-root'));
	let handle!: CanvasHandle;
	act(() => {
		handle = mount(host, port, {
			id: `canvas-${String(standing.length + 1)}`,
			viewport: { x: 0, y: 0, zoom: 1 },
			interaction: { ground: 'pan', snap: null, minimap: false, readOnly: false },
			zoom: { min: 0.1, max: 4 },
			labels: { canvas: 'Freeform', minimap: 'Minimap' },
			reduceMotion: () => true,
			additive: (event) => event.metaKey || event.shiftKey,
			...options,
		});
	});
	standing.push({ handle, host });
	return {
		host, port, handle, painted,
		resize: (next: { width: number; height: number }) => {
			measure = next;
			act(() => {
				handle.remeasure();
			});
		},
		/** Waits for the engine's code and its first drawing, which come a tick or several after the mount. */
		raised: async () => {
			await vi.waitFor(() => {
				expect(host.querySelector('.react-flow')).not.toBeNull();
			});
			await act(async () => {
				await Promise.resolve();
			});
		},
		tell: (change: () => void) => {
			act(change);
		},
		nodes: (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.react-flow__node')),
		faceOf: (id: string): Painted[] => painted.filter((entry) => entry.id === id),
	};
}

afterEach(() => {
	for (const { handle, host } of standing.splice(0)) {
		act(() => {
			handle.dispose();
		});
		host.remove();
	}
	vi.restoreAllMocks();
});

describe('the canvas engine on a document', () => {
	it('wears the canvas’s class, takes the focus by a press alone, and raises the engine in a box of its own', async () => {
		const { host, raised } = canvas();
		expect(host.classList.contains('snowflake-method-freeform-canvas')).toBe(true);
		expect(host.getAttribute('tabindex')).toBe('-1');
		await raised();
		const engine = host.querySelector('.snowflake-method-freeform-engine');
		expect(engine).not.toBeNull();
		expect(engine?.querySelector('.snowflake-method-freeform-flow .react-flow')).not.toBeNull();
		expect(host.querySelector('.react-flow')?.getAttribute('aria-label')).toBe('Freeform');
		// Its credit stands in the README, as the author chose, and not on the canvas.
		expect(host.querySelector('.react-flow__attribution')).toBeNull();
	});

	it('draws every node it is told of where it stands, each dressed by the painter of its kind', async () => {
		const { handle, port, painted, raised, tell, nodes } = canvas();
		await raised();
		tell(() => {
			handle.setScene({
				nodes: [
					node('f', { kind: 'frame', x: -40, y: -40, width: 600, height: 400, z: 2 }),
					node('a', { x: 10, y: 20, z: 0, frame: 'f', tone: 'is-tint-macaron-1' }),
					node('b', { x: 300, y: 120, z: 5 }),
				],
				edges: [edge('a-b', 'a', 'b', { label: 'then' })],
			});
		});
		expect(nodes()).toHaveLength(3);
		const drawn = new Map(nodes().map((element) => [element.getAttribute('data-id'), element] as const));
		expect(drawn.get('a')?.style.transform).toBe('translate(10px,20px)');
		expect(drawn.get('a')?.style.width).toBe('200px');
		expect(drawn.get('a')?.style.height).toBe('100px');
		expect(drawn.get('a')?.getAttribute('aria-label')).toBe('Node a');
		expect(drawn.get('a')?.classList.contains('is-card')).toBe(true);
		expect(drawn.get('a')?.classList.contains('is-tint-macaron-1')).toBe(true);
		expect(drawn.get('f')?.classList.contains('is-frame')).toBe(true);
		// Frames stand in a band of their own under the lines, every other node over them.
		const depth = (id: string): number => Number(drawn.get(id)?.style.zIndex);
		expect(depth('f')).toBeLessThan(0);
		expect(depth('a')).toBeGreaterThan(0);
		expect(depth('b')).toBeGreaterThan(depth('a'));
		expect(port.painter.mock.calls.map(([kind]) => kind).sort()).toEqual(['frame', 'text', 'text']);
		expect(painted.map((entry) => entry.body.textContent).sort()).toEqual(['frame f', 'text a', 'text b']);
		expect(painted.every((entry) => entry.body.classList.contains('nokey'))).toBe(true);
		expect(painted[0]!.dressed[0]).toEqual({ selected: false, readOnly: false, band: 'extended', width: 600, height: 400 });
	});

	it('draws a line from side to side by the measures it was told, measuring nothing', async () => {
		const { host, handle, raised, tell } = canvas();
		await raised();
		tell(() => {
			handle.setScene({
				nodes: [node('a', { width: 100, height: 40 }), node('b', { x: 300, y: 100, width: 100, height: 40 })],
				edges: [edge('a-b', 'a', 'b', { label: 'then', line: 'dashed' })],
			});
		});
		const path = host.querySelector('.react-flow__edge-path');
		expect(path?.getAttribute('d')).toMatch(/^M\s*100[ ,]+20\b/u);
		expect(path?.getAttribute('d')).toMatch(/300[ ,]+120\s*$/u);
		expect(host.querySelector('.snowflake-method-freeform-edge')?.classList.contains('is-dashed')).toBe(true);
		expect(host.querySelector('.snowflake-method-freeform-edge-label')?.textContent).toBe('then');
		// The arrowhead is left to the stylesheet to colour, so it follows the theme.
		const head = host.querySelector<SVGElement>('.react-flow__arrowhead polyline');
		expect(head).not.toBeNull();
		expect(head?.style.stroke ?? '').toBe('');
		// The four dots are the pointer's alone: the way that is everyone's is a node's menu.
		const handles = Array.from(host.querySelectorAll('.snowflake-method-freeform-handle'));
		expect(handles).toHaveLength(8);
		expect(handles.every((dot) => dot.getAttribute('aria-hidden') === 'true')).toBe(true);
	});

	it('draws a node again only when what stands of it moved, and dresses its face only when what it shows did', async () => {
		const { handle, raised, tell, faceOf, nodes } = canvas();
		await raised();
		const first = [node('a'), node('b', { x: 300 })];
		tell(() => {
			handle.setScene({ nodes: first, edges: [] });
		});
		const before = nodes().map((element) => element);
		const dressed = faceOf('a')[0]!.dressed.length;
		// Told the same again, under other objects, as every read after a write tells it.
		tell(() => {
			handle.setScene({ nodes: first.map((one) => ({ ...one })), edges: [] });
		});
		expect(nodes()).toEqual(before);
		expect(faceOf('a')).toHaveLength(1);
		expect(faceOf('a')[0]!.dressed).toHaveLength(dressed);
		// Moved, the node stands elsewhere and its face is left as it is.
		tell(() => {
			handle.setScene({ nodes: [node('a', { x: 50 }), node('b', { x: 300 })], edges: [] });
		});
		expect(nodes().find((element) => element.getAttribute('data-id') === 'a')?.style.transform).toBe('translate(50px,0px)');
		expect(faceOf('a')[0]!.dressed).toHaveLength(dressed);
		// What it shows moved: the face is dressed again, and not raised again.
		tell(() => {
			handle.setScene({ nodes: [node('a', { x: 50, revision: 'other words' }), node('b', { x: 300 })], edges: [] });
		});
		expect(faceOf('a')).toHaveLength(1);
		expect(faceOf('a')[0]!.dressed).toHaveLength(dressed + 1);
		// Sized, it is dressed for its size.
		tell(() => {
			handle.setScene({ nodes: [node('a', { x: 50, revision: 'other words', width: 320 }), node('b', { x: 300 })], edges: [] });
		});
		expect(last(faceOf('a')[0]!.dressed)).toMatchObject({ width: 320, height: 100 });
	});

	it('raises another face for a node that became another kind, and keeps the words of the one it takes down', async () => {
		const { handle, raised, tell, faceOf } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a', { kind: 'pending' })], edges: [] });
		});
		tell(() => {
			handle.setScene({ nodes: [node('a', { kind: 'task' })], edges: [] });
		});
		expect(faceOf('a').map((entry) => [entry.kind, entry.settled, entry.unmounted])).toEqual([
			['pending', 1, 1],
			['task', 0, 0],
		]);
	});

	it('asks a face to keep what it holds as its node goes, and takes it down', async () => {
		const { handle, raised, tell, faceOf, nodes } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a'), node('b', { x: 300 })], edges: [] });
		});
		tell(() => {
			handle.setScene({ nodes: [node('b', { x: 300 })], edges: [] });
		});
		expect(nodes()).toHaveLength(1);
		expect(faceOf('a')[0]).toMatchObject({ settled: 1, unmounted: 1 });
		expect(faceOf('b')[0]).toMatchObject({ settled: 0, unmounted: 0 });
	});

	it('says what is chosen, chooses what it is told to, and lets a node that goes take its choosing with it', async () => {
		const { handle, port, raised, tell, nodes, faceOf } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a'), node('b', { x: 300 })], edges: [edge('a-b', 'a', 'b')] });
		});
		tell(() => {
			handle.select({ nodes: ['b'], edges: ['a-b'] });
		});
		expect(handle.selection()).toEqual({ nodes: ['b'], edges: ['a-b'] });
		expect(port.selectionChanged).toHaveBeenLastCalledWith({ nodes: ['b'], edges: ['a-b'] });
		expect(nodes().find((element) => element.getAttribute('data-id') === 'b')?.classList.contains('selected')).toBe(true);
		expect(last(faceOf('b')[0]!.dressed)).toMatchObject({ selected: true });
		const told = port.selectionChanged.mock.calls.length;
		// Chosen as it is already, nothing is said.
		tell(() => {
			handle.select({ nodes: ['b'], edges: ['a-b'] });
		});
		expect(port.selectionChanged).toHaveBeenCalledTimes(told);
		tell(() => {
			handle.setScene({ nodes: [node('a')], edges: [] });
		});
		expect(handle.selection()).toEqual(NO_CANVAS_SELECTION);
		expect(port.selectionChanged).toHaveBeenLastCalledWith(NO_CANVAS_SELECTION);
	});

	it('holds a node still that is locked, and every node in a canvas that cannot be written', async () => {
		const { handle, raised, tell, nodes, faceOf } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a', { locked: true }), node('b', { x: 300 })], edges: [] });
		});
		const held = (id: string): boolean =>
			nodes().find((element) => element.getAttribute('data-id') === id)?.classList.contains('draggable') === false;
		expect(held('a')).toBe(true);
		expect(held('b')).toBe(false);
		tell(() => {
			handle.setInteraction({ readOnly: true });
		});
		expect(held('b')).toBe(true);
		expect(last(faceOf('b')[0]!.dressed)).toMatchObject({ readOnly: true });
	});

	it('lets none of the library’s own key listening reach the window or the document', async () => {
		const onWindow = vi.spyOn(window, 'addEventListener');
		const onDocument = vi.spyOn(document, 'addEventListener');
		const { handle, raised, tell } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a')], edges: [] });
		});
		const keys = (calls: unknown[][]): unknown[][] =>
			calls.filter(([type]) => type === 'keydown' || type === 'keyup' || type === 'keypress');
		// The two the canvas hears for itself, ahead of whatever stands in the window.
		expect(keys(onWindow.mock.calls).map(([type, , capture]) => [type, capture])).toEqual([
			['keydown', true],
			['keyup', true],
		]);
		expect(keys(onDocument.mock.calls)).toEqual([]);
	});

	it('hands a key pressed on the canvas to the workspace, and one pressed in a field to the field', async () => {
		const { host, port, raised } = canvas();
		await raised();
		const press = (target: Element, key: string): KeyboardEvent => {
			const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			target.dispatchEvent(event);
			return event;
		};
		port.key.mockReturnValue(true);
		const taken = press(host, 'Delete');
		expect(port.key).toHaveBeenCalledOnce();
		expect(taken.defaultPrevented).toBe(true);
		port.key.mockReturnValue(false);
		expect(press(host, 'a').defaultPrevented).toBe(false);
		expect(port.key).toHaveBeenCalledTimes(2);
		const field = document.createElement('textarea');
		host.appendChild(field);
		press(field, 'Backspace');
		expect(port.key).toHaveBeenCalledTimes(2);
		field.remove();
	});

	it('lets a press on a button of a face become a drag, and keeps a press in a field for the field', async () => {
		const { handle, painted, raised, tell } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a')], edges: [] });
		});
		const body = painted[0]!.body;
		// Pressed, moved past the engine's threshold, and let go: the moves and the release land on the window, as a real drag's do.
		const drag = (target: Element): boolean => {
			const at = (type: string, x: number, on: EventTarget = window): void => {
				act(() => {
					on.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view: window, clientX: x, clientY: 50 }));
				});
			};
			at('mousedown', 10, target);
			// The first move past the threshold starts the drag; the node moves with the next.
			at('mousemove', 30);
			at('mousemove', 40);
			const dragging = handle.busy();
			at('mouseup', 40);
			return dragging;
		};
		const button = body.ownerDocument.createElement('button');
		const field = body.ownerDocument.createElement('textarea');
		body.append(button, field);
		// A card is mostly buttons: a press on one may become a drag, and its click survives a press that hardly moved.
		expect(drag(button)).toBe(true);
		expect(drag(field)).toBe(false);
		expect(drag(body.querySelector('.face')!)).toBe(true);
		expect(handle.busy()).toBe(false);
		button.remove();
		field.remove();
	});

	it('opens a node pressed twice, and leaves a press twice on a control of its face to the face', async () => {
		const { handle, port, painted, raised, tell } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a')], edges: [] });
		});
		const body = painted[0]!.body;
		const twice = (target: Element): void => {
			target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
		};
		twice(body.querySelector('.face')!);
		expect(port.open).toHaveBeenCalledWith({ kind: 'node', id: 'a' }, expect.anything());
		// A title pressed twice is being edited, not opened.
		const control = body.ownerDocument.createElement('button');
		body.appendChild(control);
		twice(control);
		expect(port.open).toHaveBeenCalledOnce();
		control.remove();
	});

	it('hands a copy, a cut and a paste made on the canvas to the workspace, and leaves a field its own', async () => {
		const { host, port, raised } = canvas();
		await raised();
		for (const kind of ['copy', 'cut', 'paste'] as const) {
			host.dispatchEvent(new Event(kind, { bubbles: true }));
			expect(port.clipboard).toHaveBeenLastCalledWith(kind, expect.anything());
		}
		const field = document.createElement('input');
		host.appendChild(field);
		field.dispatchEvent(new Event('copy', { bubbles: true }));
		expect(port.clipboard).toHaveBeenCalledTimes(3);
		field.remove();
	});

	it('looks from where it is told to, and says where it looks from', async () => {
		const { handle, port, raised, tell } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a', { x: 1_000, y: 1_000, width: 200, height: 100 })], edges: [] });
		});
		tell(() => {
			handle.moveViewport({ kind: 'exact', viewport: { x: 30, y: 40, zoom: 0.5 } });
		});
		expect(handle.viewport()).toEqual({ x: 30, y: 40, zoom: 0.5 });
		expect(port.viewportChanged).toHaveBeenLastCalledWith({ x: 30, y: 40, zoom: 0.5 }, expect.any(Boolean));
		// The middle of what is in sight, on the plane.
		expect(handle.centre()).toEqual({ x: (400 - 30) / 0.5, y: (300 - 40) / 0.5 });
		tell(() => {
			handle.moveViewport({ kind: 'reset' });
		});
		expect(handle.viewport()).toEqual({ x: 0, y: 0, zoom: 1 });
		tell(() => {
			handle.moveViewport({ kind: 'reveal', id: 'a' });
		});
		// The node's middle at the canvas's middle, at the size the canvas stands at.
		expect(handle.viewport()).toEqual({ x: 400 - 1_100, y: 300 - 1_050, zoom: 1 });
		tell(() => {
			handle.moveViewport({ kind: 'step', direction: 'out' });
		});
		expect(handle.viewport().zoom).toBe(0.75);
		tell(() => {
			handle.moveViewport({ kind: 'fit', of: 'all' });
		});
		expect(handle.viewport()).toEqual({ x: 400 - 1_100, y: 300 - 1_050, zoom: 1 });
		const moved = port.viewportChanged.mock.calls.length;
		// Nothing to look at is nowhere to go.
		tell(() => {
			handle.moveViewport({ kind: 'reveal', id: 'gone' });
			handle.moveViewport({ kind: 'fit', of: 'selection' });
			handle.moveViewport({ kind: 'fit', of: [] });
		});
		expect(port.viewportChanged).toHaveBeenCalledTimes(moved);
	});

	it('changes every face together as the canvas is looked at from further off', async () => {
		const { handle, raised, tell, faceOf } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a'), node('b', { x: 300 })], edges: [] });
		});
		tell(() => {
			handle.moveViewport({ kind: 'exact', viewport: { x: 0, y: 0, zoom: 0.3 } });
		});
		expect(last(faceOf('a')[0]!.dressed)).toMatchObject({ band: 'compact' });
		expect(last(faceOf('b')[0]!.dressed)).toMatchObject({ band: 'compact' });
		tell(() => {
			handle.moveViewport({ kind: 'exact', viewport: { x: 0, y: 0, zoom: 0.2 } });
		});
		expect(last(faceOf('a')[0]!.dressed)).toMatchObject({ band: 'far' });
	});

	it('keeps where it is to look from until it has a size to look by, and raises no engine on a canvas that is not shown', async () => {
		const { host, handle, port, resize, raised, tell } = canvas({ width: 0, height: 0 });
		await act(async () => {
			await new Promise((resolve) => { setTimeout(resolve, 20); });
		});
		expect(host.querySelector('.react-flow')).toBeNull();
		tell(() => {
			handle.setScene({ nodes: [node('a', { x: 1_000, y: 1_000 })], edges: [] });
			handle.select({ nodes: ['a'], edges: [] });
			handle.moveViewport({ kind: 'exact', viewport: { x: 30, y: 40, zoom: 0.5 } });
		});
		// A place named outright is kept before anything is measured.
		expect(handle.viewport()).toEqual({ x: 30, y: 40, zoom: 0.5 });
		expect(handle.selection()).toEqual({ nodes: ['a'], edges: [] });
		tell(() => {
			handle.moveViewport({ kind: 'reveal', id: 'a' });
		});
		resize({ width: 800, height: 600 });
		await raised();
		expect(host.querySelectorAll('.react-flow__node')).toHaveLength(1);
		expect(host.querySelector('.react-flow__node')?.classList.contains('selected')).toBe(true);
		// The move that waited for a size is made now that there is one.
		expect(handle.viewport()).toEqual({ x: 400 - 1_100 * 0.5, y: 300 - 1_050 * 0.5, zoom: 0.5 });
		expect(port.failed).not.toHaveBeenCalled();
	});

	it('loses nothing the author had in hand when it is moved to another window', async () => {
		const { host, handle, port, raised, tell, faceOf, nodes } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a'), node('b', { x: 300 })], edges: [edge('a-b', 'a', 'b')] });
			handle.select({ nodes: ['b'], edges: [] });
			handle.moveViewport({ kind: 'exact', viewport: { x: 30, y: 40, zoom: 0.5 } });
		});
		const engine = host.querySelector('.snowflake-method-freeform-engine');
		act(() => {
			migrate(host, window);
		});
		await raised();
		// Another engine, raised in the window the canvas now stands in.
		expect(host.querySelectorAll('.snowflake-method-freeform-engine')).toHaveLength(1);
		expect(host.querySelector('.snowflake-method-freeform-engine')).not.toBe(engine);
		expect(nodes()).toHaveLength(2);
		expect(host.querySelectorAll('.react-flow__edge')).toHaveLength(1);
		expect(handle.selection()).toEqual({ nodes: ['b'], edges: [] });
		expect(nodes().find((element) => element.getAttribute('data-id') === 'b')?.classList.contains('selected')).toBe(true);
		expect(handle.viewport()).toEqual({ x: 30, y: 40, zoom: 0.5 });
		// Each face was asked once to keep what it held, taken down, and raised again.
		expect(faceOf('a').map((entry) => [entry.settled, entry.unmounted])).toEqual([[1, 1], [0, 0]]);
		expect(faceOf('b').map((entry) => [entry.settled, entry.unmounted])).toEqual([[1, 1], [0, 0]]);
		expect(port.failed).not.toHaveBeenCalled();
	});

	it('asks every face once to keep what it holds as it goes, and leaves nothing behind', async () => {
		const stopped = vi.spyOn(window, 'removeEventListener');
		const { host, handle, port, raised, tell, painted } = canvas();
		await raised();
		tell(() => {
			handle.setScene({ nodes: [node('a'), node('b', { x: 300 }), node('f', { kind: 'frame', z: 0 })], edges: [] });
		});
		act(() => {
			handle.dispose();
		});
		expect(painted.map((entry) => [entry.id, entry.settled, entry.unmounted]).sort()).toEqual([
			['a', 1, 1], ['b', 1, 1], ['f', 1, 1],
		]);
		expect(host.children).toHaveLength(0);
		expect(host.classList.contains('snowflake-method-freeform-canvas')).toBe(false);
		expect(migrationListeners(host)).toBe(0);
		expect(stopped.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup').map(([type, , capture]) => [type, capture])).toEqual([
			['keydown', true],
			['keyup', true],
		]);
		// Gone, it hears nothing and says nothing.
		host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
		expect(port.key).not.toHaveBeenCalled();
		act(() => {
			handle.setScene({ nodes: [node('z')], edges: [] });
			handle.select({ nodes: ['z'], edges: [] });
			handle.dispose();
		});
		expect(painted).toHaveLength(3);
		expect(port.failed).not.toHaveBeenCalled();
	});

	it('keeps the words of a face that throws apart from the rest, so one that fails costs only itself', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { handle, port, raised, tell, painted } = canvas();
		await raised();
		const mounting = port.painter.getMockImplementation()!;
		port.painter.mockImplementation((kind: string) => {
			const painter = mounting(kind);
			return {
				mount: (body: HTMLElement, id: string, context: PaintContext) => {
					const face = painter.mount(body, id, context);
					if (id !== 'a') return face;
					return { ...face, settle: () => { throw new Error('would not keep'); } };
				},
			};
		});
		tell(() => {
			handle.setScene({ nodes: [node('a'), node('b', { x: 300 })], edges: [] });
		});
		act(() => {
			handle.settle();
		});
		expect(painted.find((entry) => entry.id === 'b')?.settled).toBe(1);
		expect(logged).toHaveBeenCalled();
	});

	it('says so when the engine cannot be brought, and draws nothing', async () => {
		const host = document.createElement('div');
		document.body.appendChild(host);
		Object.defineProperties(host, {
			clientWidth: { configurable: true, get: () => 800 },
			clientHeight: { configurable: true, get: () => 600 },
		});
		const failed = vi.fn();
		const mount = freeformCanvasMount(() => Promise.reject(new Error('no engine')));
		const handle = mount(host, { failed } as unknown as CanvasPort, {
			id: 'canvas-lost',
			viewport: { x: 0, y: 0, zoom: 1 },
			interaction: { ground: 'pan', snap: null, minimap: false, readOnly: false },
			zoom: { min: 0.1, max: 4 },
			labels: { canvas: 'Freeform', minimap: 'Minimap' },
			reduceMotion: () => true,
			additive: () => false,
		});
		await vi.waitFor(() => {
			expect(failed).toHaveBeenCalledOnce();
		});
		expect(host.querySelector('.react-flow')).toBeNull();
		handle.dispose();
		host.remove();
	});
});
