import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';
import type { OptionFieldConfig, PickerOption } from '../../src/ui/option-picker';

const { menus, positions, hidden, viewFields, notices, rendered } = vi.hoisted(() => ({
	menus: [] as { title: string; disabled: boolean; checked: boolean | null; click: () => void }[][],
	positions: [] as ({ x: number; y: number } | null)[],
	hidden: [] as unknown[],
	viewFields: [] as OptionFieldConfig[],
	notices: vi.fn(),
	rendered: [] as string[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		modalEl = { addClass: (): void => undefined };
		setTitle(): void {}
		onClose(): void {}
	}
	class MenuItem {
		title = '';
		disabled = false;
		checked: boolean | null = null;
		click: () => void = () => undefined;
		setTitle(title: string): this { this.title = title; return this; }
		setIcon(): this { return this; }
		setWarning(): this { return this; }
		setSection(): this { return this; }
		setDisabled(value: boolean): this { this.disabled = value; return this; }
		setChecked(value: boolean | null): this { this.checked = value; return this; }
		onClick(handler: () => void): this { this.click = handler; return this; }
	}
	class Menu {
		private readonly items: MenuItem[] = [];
		private onHidden: () => void = () => undefined;
		addItem(build: (item: MenuItem) => void): this {
			const item = new MenuItem();
			build(item);
			this.items.push(item);
			return this;
		}
		addSeparator(): this { return this; }
		setParentElement(): this { return this; }
		private shown(at: { x: number; y: number } | null): this {
			menus.push(this.items.map((item) => ({ title: item.title, disabled: item.disabled, checked: item.checked, click: item.click })));
			positions.push(at);
			return this;
		}
		showAtMouseEvent(): this { return this.shown(null); }
		showAtPosition(at: { x: number; y: number }): this { return this.shown(at); }
		onHide(handler: () => void): void { this.onHidden = handler; }
		hide(): this {
			hidden.push(this);
			this.onHidden();
			return this;
		}
	}
	return {
		...runtime,
		Keymap: {
			isModifier: (event: { metaKey?: boolean }, modifier: string) => modifier === 'Mod' && event.metaKey === true,
			isModEvent: () => false,
		},
		getIcon: () => null,
		Modal,
		Menu,
		Component: class {
			readonly children = new Set<unknown>();
			addChild(child: unknown): void { this.children.add(child); }
			removeChild(child: unknown): void { this.children.delete(child); }
		},
		MarkdownRenderer: {
			render: (_app: unknown, words: string, box: CorkboardElement): Promise<void> => {
				rendered.push(words);
				box.setText(words);
				return Promise.resolve();
			},
		},
		FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} },
		SuggestModal: class extends Modal {},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

// The view field is the real one; what the workspace hands it is kept, so a test can pick as the list would.
vi.mock('../../src/ui/option-picker', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/option-picker')>();
	return {
		...actual,
		buildOptionField: vi.fn((...args: Parameters<typeof actual.buildOptionField>) => {
			viewFields.push(args[2]);
			return actual.buildOptionField(...args);
		}),
	};
});

vi.mock('../../src/ui/timeline-forms', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/timeline-forms')>();
	return { ...actual, confirmTimelineAction: vi.fn(() => Promise.resolve(true)) };
});

import { Component, type Modal } from 'obsidian';
import {
	FREEFORM_LIMITS,
	FREEFORM_SIZE,
	applyFreeformSteps,
	leaveFreeformView,
	newFreeformView,
	renameFreeformView,
	type FreeformDocument,
	type FreeformEdge,
	type FreeformFrame,
	type FreeformLabels,
	type FreeformLimits,
	type FreeformPlacement,
	type FreeformStep,
	type FreeformView,
	type FreeformViewport,
} from '../../src/domain';
import type { FreeformTransacted, FreeformViewWrite } from '../../src/services';
import { renderFreeform } from '../../src/ui/freeform';
import type { FreeformBridge, FreeformControls } from '../../src/ui/freeform-bridge';
import {
	NO_CANVAS_SELECTION,
	type CanvasHandle,
	type CanvasInteraction,
	type CanvasNode,
	type CanvasOptions,
	type CanvasPort,
	type CanvasScene,
	type CanvasSelection,
	type CanvasViewportTarget,
	type MountFreeformCanvas,
	type PaintContext,
	type PaintedNode,
} from '../../src/ui/freeform-canvas-port';
import {
	FreeformEdgeFormModal,
	FreeformFrameFormModal,
	FreeformGeometryModal,
	FreeformNodeFormModal,
	FreeformTextModal,
	FreeformViewFormModal,
} from '../../src/ui/freeform-forms';
import { FREEFORM_CASCADE, FREEFORM_FACE_HEIGHTS, FREEFORM_GRID } from '../../src/ui/freeform-layout';
import { freeformMemory } from '../../src/ui/story-structure-state';
import { TimelineTimePickModal, confirmTimelineAction } from '../../src/ui/timeline-forms';
import type { CharacterViewModel, ProjectDashboardModel, SceneViewModel, WorldbuildingEntityViewModel } from '../../src/ui/view-model';

// Obsidian's own DOM carries `instanceOf`, and a browser has `Element`; a menu
// asked for from the keyboard reads the one off the event target and names the other.
(CorkboardElement.prototype as unknown as { instanceOf: () => boolean }).instanceOf = () => true;
vi.stubGlobal('Element', class {});

async function settle(): Promise<void> {
	for (let at = 0; at < 60; at++) await Promise.resolve();
}

const text = (id: string, words: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	id,
	resource: { type: 'text', text: words },
	x: 0,
	y: 0,
	width: 200,
	height: 100,
	displayMode: 'auto',
	zIndex: 0,
	frameId: null,
	...extra,
});
const sceneNode = (id: string, sceneId: string, name: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	...text(id, ''),
	resource: { type: 'entity', kind: 'scene', id: sceneId, name },
	...extra,
});
const link = (id: string, extra: Partial<FreeformPlacement> = {}): FreeformPlacement => ({
	...text(id, ''),
	resource: { type: 'link', url: 'https://example.com/path', label: '' },
	...extra,
});
const frame = (id: string, extra: Partial<FreeformFrame> = {}): FreeformFrame => ({
	id, title: '', color: null, x: 0, y: 0, width: 400, height: 300, zIndex: 0, ...extra,
});
const edge = (id: string, source: string, target: string): FreeformEdge => ({
	id, source, target, sourceSide: null, targetSide: null, label: '', arrow: 'end', line: 'solid',
});
const view = (id: string, extra: Partial<FreeformView> = {}): FreeformView => ({
	...newFreeformView({ id, name: `View ${id}`, now: 1 }),
	...extra,
});
const scene = (id: string, title: string): SceneViewModel => ({
	id, path: `Scenes/${title}.md`, title, rank: 0, progressStatus: 'in-progress', aliases: [], categoryPaths: [],
	povPath: '', povName: '', povMissing: false, times: [], locations: [], characterPaths: [], conflict: '', color: null,
	linkedManuscript: [], worldStatus: [], relationships: [], events: '', customFields: '', revision: 'r', readOnly: false, healthIssues: [],
});

const character = (id: string, name: string): CharacterViewModel => ({
	id, path: `Characters/${name}.md`, name, rank: 0, type: null, progressStatus: 'complete', aliases: ['Nan'], categoryPaths: [],
	oneSentenceStoryline: 'Wants out', oneParagraphStoryline: '', motivation: 'Fear', goal: '', conflict: '', growth: '',
	worldStatus: [], relationships: [], customFields: '', revision: 'c1', readOnly: false, healthIssues: [],
});
const place = (id: string, name: string): WorldbuildingEntityViewModel => ({
	id, path: `World/${name}.md`, name, kind: 'location', rank: 0, progressStatus: null, aliases: [], categoryPaths: [],
	description: 'A harbour', timeKind: null, timeStart: '', timeEnd: '', timeStartMissing: false, timeEndMissing: false,
	worldStatus: [], relationships: [], customFields: '', revision: 'w1', readOnly: false, healthIssues: [],
});

const submit = (form: unknown, value: unknown): Promise<void> =>
	(form as { submitHandler(value: unknown): Promise<void> }).submitHandler(value);

/** Keeps every form of a kind the workspace opens, in place of showing it. */
function watch<T extends Modal>(kind: { prototype: T }): T[] {
	const opened: T[] = [];
	vi.spyOn(kind.prototype as Modal, 'open').mockImplementation(function (this: Modal) { opened.push(this as T); });
	return opened;
}

/** Calls an element's own listeners with the properties an event carries. */
function fire(element: CorkboardElement, type: string, properties: Record<string, unknown> = {}): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

/**
 * A plain canvas in the engine's place. It keeps what it is told, raises a
 * face for every node that stands and takes it down as the node goes, which
 * is all of the engine that the workspace can see.
 */
function plainCanvas() {
	const state = {
		host: null as CorkboardElement | null,
		port: null as CanvasPort | null,
		options: null as CanvasOptions | null,
		scenes: [] as CanvasScene[],
		interaction: null as CanvasInteraction | null,
		selection: NO_CANVAS_SELECTION,
		viewport: { x: 0, y: 0, zoom: 1 },
		moves: [] as CanvasViewportTarget[],
		busy: false,
		centre: { x: 500, y: 300 },
		settled: 0,
		disposed: 0,
		focused: 0,
		remeasured: 0,
		band: 'extended' as PaintContext['band'],
		faces: new Map<string, { face: PaintedNode; body: CorkboardElement; node: CanvasNode }>(),
	};
	const contextOf = (node: CanvasNode): PaintContext => ({
		selected: state.selection.nodes.includes(node.id),
		readOnly: state.interaction?.readOnly ?? true,
		band: state.band,
		width: node.width,
		height: node.height,
	});
	const lay = (scene: CanvasScene): void => {
		const standing = new Set(scene.nodes.map((node) => node.id));
		for (const [id, held] of [...state.faces]) {
			if (standing.has(id) && scene.nodes.find((node) => node.id === id)?.kind === held.node.kind) continue;
			state.faces.delete(id);
			held.face.settle();
			held.face.unmount();
			held.body.remove();
		}
		for (const node of scene.nodes) {
			const held = state.faces.get(node.id);
			if (held === undefined) {
				const body = state.host!.createDiv({ cls: 'snowflake-method-freeform-node-body' });
				body.setAttribute('data-node', node.id);
				const face = state.port!.painter(node.kind).mount(body as unknown as HTMLElement, node.id, contextOf(node));
				state.faces.set(node.id, { face, body, node });
				continue;
			}
			held.node = node;
			held.face.dress(contextOf(node));
		}
	};
	const mount: MountFreeformCanvas = (host, port, options) => {
		state.host = host as unknown as CorkboardElement;
		state.port = port;
		state.options = options;
		state.interaction = options.interaction;
		state.viewport = options.viewport;
		const handle: CanvasHandle = {
			setScene: (scene) => {
				state.scenes.push(scene);
				lay(scene);
			},
			setInteraction: (change) => {
				state.interaction = { ...state.interaction!, ...change };
			},
			selection: () => state.selection,
			select: (selection) => {
				state.selection = selection;
				port.selectionChanged(selection);
			},
			viewport: () => state.viewport,
			moveViewport: (target) => {
				state.moves.push(target);
				if (target.kind === 'exact') state.viewport = target.viewport;
			},
			toPlane: (client) => client,
			centre: () => state.centre,
			busy: () => state.busy,
			remeasure: () => { state.remeasured += 1; },
			focus: () => { state.focused += 1; },
			settle: () => {
				state.settled += 1;
				for (const held of [...state.faces.values()]) held.face.settle();
			},
			dispose: () => {
				state.disposed += 1;
				for (const held of [...state.faces.values()]) {
					held.face.settle();
					held.face.unmount();
				}
				state.faces.clear();
			},
		};
		return handle;
	};
	return { state, mount };
}

interface WorkspaceOptions {
	readOnly?: boolean;
	locale?: 'en' | 'zh-CN';
	limits?: Partial<FreeformLimits>;
	viewId?: string | null;
	snap?: boolean;
}

function workspace(initial: readonly FreeformView[] = [], options: WorkspaceOptions = {}) {
	const dom = new CorkboardDom();
	const locale = options.locale ?? 'en';
	const limits: FreeformLimits = { ...FREEFORM_LIMITS, ...options.limits };
	let held: FreeformDocument = { views: [...initial] };
	const listeners = new Set<() => void>();
	let serial = 0;
	let now = 10;
	/** What the next write is answered with, in place of what the view would say. */
	let refusal: FreeformTransacted['came'] | null = null;
	/** Held shut, a write waits here until it is let through. */
	let gate: Promise<void> = Promise.resolve();
	let failing = false;
	const swap = (before: FreeformView, after: FreeformView): void => {
		held = { views: held.views.map((candidate) => (candidate === before ? after : candidate)) };
	};
	const bridge = {
		read: vi.fn(async () => {
			if (failing) throw new Error('unreadable');
			// The path the workspace's project stands at now, as a read would name it.
			return { projectPath: projectPath ?? 'P', locale, held, limits };
		}),
		subscribe: vi.fn((listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}),
		readResources: vi.fn(async () => null),
		subscribeResources: vi.fn(() => () => undefined),
		mintId: vi.fn((kind: string) => `${kind}-${String(++serial)}`),
		createView: vi.fn(async (name: string) => {
			if (refusal !== null) return null;
			const id = `freeform-view-${String(++serial)}`;
			held = { views: [...held.views, newFreeformView({ id, name, now: ++now })] };
			return id;
		}),
		renameView: vi.fn(async (id: string, name: string): Promise<FreeformViewWrite> => {
			const before = held.views.find((candidate) => candidate.id === id);
			if (before === undefined) return 'absent';
			if (refusal !== null) return 'refused';
			const after = renameFreeformView(before, name, ++now);
			if (after !== null) swap(before, after);
			return 'written';
		}),
		deleteView: vi.fn(async (id: string) => {
			if (refusal !== null) return false;
			held = { views: held.views.filter((candidate) => candidate.id !== id) };
			return true;
		}),
		leaveView: vi.fn(async (id: string, left: { viewport?: FreeformViewport; labels?: FreeformLabels }): Promise<FreeformViewWrite> => {
			const before = held.views.find((candidate) => candidate.id === id);
			if (before === undefined) return 'absent';
			const after = leaveFreeformView(before, left);
			if (after !== null) swap(before, after);
			return 'written';
		}),
		transact: vi.fn(async (id: string, steps: readonly FreeformStep[], viewport: FreeformViewport | null = null): Promise<FreeformTransacted> => {
			await gate;
			const before = held.views.find((candidate) => candidate.id === id);
			if (before === undefined) return { came: 'absent', inverse: [] };
			if (refusal !== null) return { came: refusal, inverse: [] };
			const made = applyFreeformSteps(before, steps, ++now, limits);
			if (made.came !== 'written') return { came: made.came, inverse: [] };
			if (made.changed) swap(before, viewport === null ? made.view : { ...made.view, viewport });
			return { came: 'written', inverse: made.inverse };
		}),
	} satisfies FreeformBridge;
	let model = {
		path: 'P', projectId: 'p', locale, readOnly: options.readOnly === true,
		scenes: [scene('scene-1', 'Arrival'), scene('scene-2', 'Departure')],
		manuscriptPaths: [],
		characters: [character('char-1', 'Anna')],
		worldbuildingKinds: [
			{ id: 'location', folderName: '62_Location', custom: false, icon: null, description: null },
			{ id: 'Faction', folderName: '64_Faction', custom: true, icon: 'flag', description: null },
		],
		worldbuilding: { location: [place('loc-1', 'Harbour')], Faction: [] },
	} as unknown as ProjectDashboardModel;
	const memory = freeformMemory({ viewId: options.viewId ?? null, minimap: false, snap: options.snap === true });
	const host = {
		openManagedFile: vi.fn((_path: string) => Promise.resolve()),
		openManuscriptStream: vi.fn(() => Promise.resolve()),
		openSceneForm: vi.fn((_intent: unknown, _path?: string, _onSaved?: () => void) => Promise.resolve<string | null>(null)),
		openCharacterForm: vi.fn((_id: string, _path?: string, _onSaved?: () => void) => Promise.resolve()),
		openEntityForm: vi.fn((_intent: unknown, _path?: string, _onSaved?: () => void) => Promise.resolve<string | null>(null)),
		patchScene: vi.fn(() => Promise.resolve('r2')),
		isReduceMotionEnabled: vi.fn(() => false),
	};
	const canvas = plainCanvas();
	let handle: ReturnType<typeof renderFreeform>;
	const refresh = vi.fn(async () => { handle.refresh(); });
	const remember = vi.fn();
	let projectPath: string | null = 'P';
	let unloading = false;
	let home = true;
	const chords: { modifiers: string[]; key: string; listener: () => boolean | undefined; heard: boolean }[] = [];
	const component = new Component();
	const controls = {
		app: {},
		host,
		t: (key: string, vars?: Record<string, string | number>): string =>
			vars === undefined ? key : `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(',')})`,
		model: () => model,
		projectPath: () => projectPath,
		activateProject: vi.fn(),
		refresh,
		bridge: () => bridge,
		memory,
		remember,
		unloading: () => unloading,
		component,
		chord: (modifiers: string[], key: string, listener: () => boolean | undefined) => {
			const entry = { modifiers, key, listener, heard: true };
			chords.push(entry);
			return () => { entry.heard = false; };
		},
		mountCanvas: canvas.mount,
		atHome: () => home,
	} as unknown as FreeformControls;
	handle = renderFreeform(dom.container as unknown as HTMLElement, controls);
	const root = dom.container.querySelector('.snowflake-method-freeform')!;
	const port = (): CanvasPort => canvas.state.port!;
	const faceOf = (id: string): CorkboardElement => canvas.state.faces.get(id)!.body.children[0]!;
	const fixture = {
		dom, root, handle, bridge, memory, host, controls, refresh, remember, canvas: canvas.state, port, component, chords,
		remodel: (change: Partial<ProjectDashboardModel>) => { model = { ...model, ...change }; },
		moveProject: (path: string | null) => { projectPath = path; },
		unload: () => { unloading = true; },
		leaveHome: () => { home = false; },
		held: () => held,
		viewHeld: (id: string): FreeformView => held.views.find((candidate) => candidate.id === id)!,
		/** Another leaf, or another device, writes the view. */
		rewrite: (id: string, change: (before: FreeformView) => FreeformView) => {
			const before = held.views.find((candidate) => candidate.id === id)!;
			swap(before, change(before));
		},
		notify: () => { for (const listener of listeners) listener(); },
		/** The files read and parsed again, as every read after a write is: the same document under another identity. */
		reparse: () => { held = JSON.parse(JSON.stringify(held)) as FreeformDocument; },
		refuse: (came: FreeformTransacted['came'] | null) => { refusal = came; },
		fail: (on: boolean) => { failing = on; },
		/** Holds every write until the hand is opened. */
		hold: (): (() => void) => {
			let open = (): void => undefined;
			gate = new Promise<void>((resolve) => { open = resolve; });
			return open;
		},
		listeners,
		viewField: (): OptionFieldConfig => viewFields[viewFields.length - 1]!,
		button: (cls: string): CorkboardElement => root.querySelector(`.${cls}`)!,
		emptyLine: (): CorkboardElement => root.children.find((child) => child.classes.has('snowflake-method-character-empty'))!,
		emptyWords: (): string => fixture.emptyLine().children[1]!.textContent,
		stage: (): CorkboardElement => root.querySelector('.snowflake-method-freeform-stage')!,
		hint: (): CorkboardElement => root.querySelector('.snowflake-method-freeform-hint')!,
		zoomLevel: (): CorkboardElement => root.querySelector('.snowflake-method-freeform-zoom-level')!,
		/** What stands on the canvas now, as it was last told. */
		scene: (): CanvasScene => canvas.state.scenes[canvas.state.scenes.length - 1]!,
		nodes: (): string[] => fixture.scene().nodes.map((node) => node.id),
		node: (id: string): CanvasNode => fixture.scene().nodes.find((node) => node.id === id)!,
		face: faceOf,
		field: (id: string): CorkboardElement | null => faceOf(id).querySelector('textarea'),
		shown: (id: string): string => faceOf(id).querySelector('.snowflake-method-freeform-text')!.children[0]?.textContent ?? '',
		more: (id: string): CorkboardElement => faceOf(id).querySelector('.snowflake-method-freeform-node-more')!,
		/** Types words into the node open for typing, and leaves it the way named. */
		type: (id: string, typed: string, leave: 'blur' | 'chord' | 'escape' | 'none' = 'blur'): void => {
			const field = faceOf(id).querySelector('textarea')!;
			field.value = typed;
			if (leave === 'blur') fire(field, 'blur');
			else if (leave === 'chord') fire(field, 'keydown', { key: 'Enter', metaKey: true });
			else if (leave === 'escape') fire(field, 'keydown', { key: 'Escape' });
		},
		menuAt: (target: Parameters<CanvasPort['menu']>[0], event: Record<string, unknown> = {}) => {
			menus.length = 0;
			positions.length = 0;
			port().menu(target, event as unknown as MouseEvent);
			return menus[0];
		},
		/** Adds a text node from the ground's menu, at the middle of what is in sight; hands back its id. */
		addText: (): string => {
			const before = new Set(fixture.nodes());
			fixture.menuAt({ kind: 'ground', at: canvas.state.centre })!.find((item) => item.title === 'freeformCanvas.text.add')!.click();
			return fixture.nodes().find((id) => !before.has(id)) ?? '';
		},
		choose: (selection: Partial<CanvasSelection>): void => {
			canvas.state.selection = { nodes: [], edges: [], ...selection };
			port().selectionChanged(canvas.state.selection);
		},
		press: (key: string, extra: Record<string, unknown> = {}): boolean =>
			port().key({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra } as unknown as KeyboardEvent),
		/** The chord registered for a key pressed with these modifiers, as the view's scope would hear it. */
		chord: (modifiers: string[], key: string) =>
			chords.find((entry) => entry.key === key && entry.modifiers.join('+') === modifiers.join('+'))!,
	};
	return fixture;
}

type Fixture = ReturnType<typeof workspace>;

/** One view of three text nodes, a scene and a link, with a frame round the first. */
const laidView = (): FreeformView => view('a', {
	frames: [frame('f1', { title: 'Opening', x: -40, y: -80, width: 400, height: 300 })],
	placements: [
		text('t1', 'First words\n\nand more', { x: 0, y: 0, zIndex: 0, frameId: 'f1' }),
		text('t2', 'Second', { x: 400, y: 0, zIndex: 1 }),
		sceneNode('s1', 'scene-1', 'Arrival as kept', { x: 0, y: 300, zIndex: 2 }),
		link('l1', { x: 400, y: 300, zIndex: 3 }),
	],
	edges: [edge('e1', 't1', 't2')],
	viewport: { x: 12, y: 34, zoom: 0.5 },
	updatedAt: 5,
});

const laid = async (options: WorkspaceOptions = {}, more: readonly FreeformView[] = []): Promise<Fixture> => {
	const fixture = workspace([laidView(), ...more], options);
	await settle();
	return fixture;
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(confirmTimelineAction).mockReset();
	vi.mocked(confirmTimelineAction).mockImplementation(() => Promise.resolve(true));
	notices.mockClear();
	menus.length = 0;
	positions.length = 0;
	hidden.length = 0;
	rendered.length = 0;
});

describe('the freeform workspace', () => {
	it('says it is reading, then lays the view changed last and offers every view', async () => {
		const fixture = workspace([view('b', { updatedAt: 3 }), laidView(), view('c', { updatedAt: 4 })]);
		expect(fixture.emptyWords()).toBe('freeformCanvas.loading');
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(false);
		expect(fixture.stage().classes.has('is-hidden')).toBe(true);
		expect(fixture.root.classes.has('is-empty')).toBe(true);
		await settle();
		expect(fixture.root.classes.has('is-empty')).toBe(false);
		expect(fixture.stage().classes.has('is-hidden')).toBe(false);
		expect(fixture.emptyLine().classes.has('is-hidden')).toBe(true);
		for (const cls of ['snowflake-method-prose-panel', 'snowflake-method-freeform']) {
			expect(fixture.root.classes.has(cls), cls).toBe(true);
		}
		// In the order the views were made, whichever was changed last.
		expect(fixture.viewField().options().map((option) => [option.value, option.label])).toEqual([
			['b', 'View b'], ['a', 'View a'], ['c', 'View c'],
		]);
		expect(fixture.viewField().value()).toBe('a');
		expect(fixture.memory.viewId).toBe('a');
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
		expect(fixture.scene().edges.map((one) => one.id)).toEqual(['e1']);
	});

	it('shows the view the tab names, and the one changed last where that has gone', async () => {
		const named = workspace([view('a', { updatedAt: 9 }), view('b', { updatedAt: 2, placements: [text('b1', 'B')] })], { viewId: 'b' });
		await settle();
		expect(named.viewField().value()).toBe('b');
		expect(named.nodes()).toEqual(['b1']);
		expect(named.remember).not.toHaveBeenCalled();
		const gone = workspace([view('a', { updatedAt: 9 }), view('b', { updatedAt: 2 })], { viewId: 'zz' });
		await settle();
		expect(gone.viewField().value()).toBe('a');
		// The tab is told what it shows now, so the next session opens on it.
		expect(gone.memory.viewId).toBe('a');
		expect(gone.remember).toHaveBeenCalledOnce();
	});

	it('looks at a view from where its file says it was last looked at from', async () => {
		const fixture = await laid();
		expect(fixture.canvas.moves).toEqual([{ kind: 'exact', viewport: { x: 12, y: 34, zoom: 0.5 } }]);
		expect(fixture.zoomLevel().textContent).toBe('50%');
		expect(fixture.zoomLevel().getAttribute('aria-label')).toBe('freeformCanvas.zoom.level(percent=50)');
	});

	it('says there are no views, and offers only to make one', async () => {
		const fixture = workspace([]);
		await settle();
		expect(fixture.emptyWords()).toBe('freeformCanvas.empty.views');
		expect(fixture.stage().classes.has('is-hidden')).toBe(true);
		expect(fixture.button('snowflake-method-freeform-view-add').disabled).toBe(false);
		expect(fixture.button('snowflake-method-freeform-node-add').disabled).toBe(true);
		expect(fixture.button('snowflake-method-freeform-view-edit').disabled).toBe(true);
		expect(fixture.memory.viewId).toBeNull();
	});

	it('says the canvas could not be read, and reads again when it is asked to', async () => {
		const fixture = workspace([laidView()]);
		fixture.fail(true);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await settle();
		// The first read went out before the failure was set; the next one meets it.
		fixture.notify();
		await settle();
		expect(fixture.emptyWords()).toBe('freeformCanvas.loadFailed');
		expect(fixture.button('snowflake-method-freeform-view-add').disabled).toBe(true);
		fixture.fail(false);
		fire(fixture.button('snowflake-method-freeform-refresh'), 'click');
		await settle();
		expect(fixture.refresh).toHaveBeenCalled();
		expect(fixture.stage().classes.has('is-hidden')).toBe(false);
		expect(fixture.nodes()).toContain('t1');
	});

	it('says a view holds nothing, over a canvas that can still be pressed', async () => {
		const fixture = workspace([view('a')]);
		await settle();
		expect(fixture.stage().classes.has('is-hidden')).toBe(false);
		expect(fixture.hint().classes.has('is-hidden')).toBe(false);
		expect(fixture.hint().querySelectorAll('span').map((span) => span.textContent)).toContain('freeformCanvas.empty.nodes');
		expect(fixture.button('snowflake-method-freeform-fit').disabled).toBe(true);
		const held = await laid();
		expect(held.hint().classes.has('is-hidden')).toBe(true);
		expect(held.button('snowflake-method-freeform-fit').disabled).toBe(false);
	});

	it('shows a project that cannot be written, and offers no change to it', async () => {
		const fixture = await laid({ readOnly: true });
		expect(fixture.root.classes.has('is-read-only')).toBe(true);
		expect(fixture.canvas.interaction?.readOnly).toBe(true);
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
		for (const cls of ['snowflake-method-freeform-view-add', 'snowflake-method-freeform-node-add', 'snowflake-method-freeform-view-edit']) {
			expect(fixture.button(cls).disabled, cls).toBe(true);
		}
		// A double click opens nothing to type into, and no key takes anything off.
		fixture.port().open({ kind: 'node', id: 't1' }, {} as MouseEvent);
		expect(fixture.field('t1')).toBeNull();
		fixture.port().open({ kind: 'ground', at: { x: 0, y: 0 } }, {} as MouseEvent);
		expect(fixture.nodes()).toHaveLength(5);
		fixture.choose({ nodes: ['t1'] });
		expect(fixture.press('Delete')).toBe(false);
		fixture.port().commit([{ kind: 'move', id: 't1', x: 50, y: 50 }]);
		await settle();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		expect(fixture.bridge.leaveView).not.toHaveBeenCalled();
		// The model's word alone: a project that can be written again is one the canvas changes again.
		fixture.remodel({ readOnly: false });
		fixture.handle.refresh();
		expect(fixture.canvas.interaction?.readOnly).toBe(false);
		expect(fixture.button('snowflake-method-freeform-node-add').disabled).toBe(false);
	});

	it('says what every node is called and shows each by its own kind', async () => {
		const fixture = await laid();
		expect(fixture.scene().nodes.map((node) => [node.id, node.kind, node.label])).toEqual([
			['f1', 'frame', 'Opening'],
			['t1', 'text', 'First words'],
			['t2', 'text', 'Second'],
			// A scene is called what the project calls it now, not what the view last kept, with the kind of note it is.
			['s1', 'scene', 'freeformCanvas.node.name(kind=form.group.scene,name=Arrival)'],
			['l1', 'link', 'example.com'],
		]);
		expect(fixture.node('t1').frame).toBe('f1');
		expect(fixture.scene().nodes.every((node) => node.connectable && !node.locked)).toBe(true);
		// A line is called by what it joins.
		expect(fixture.scene().edges[0]).toMatchObject({ id: 'e1', name: 'freeformCanvas.edge.name(from=First words,to=Second)' });
		expect(fixture.shown('t1')).toBe('First words\n\nand more');
		// A scene stands as the corkboard's own card.
		expect(fixture.root.classes.has('snowflake-method-scene-cards')).toBe(true);
		const card = fixture.face('s1').querySelector('.snowflake-method-corkboard-card')!;
		expect(card.getAttribute('data-key')).toBe('s1');
		expect(card.getAttribute('draggable')).toBe('false');
		expect(card.querySelector('.snowflake-method-corkboard-title')!.textContent).toBe('Arrival');
		expect(fixture.face('f1').querySelector('.snowflake-method-freeform-frame-title')!.textContent).toBe('Opening');
	});

	it('calls a scene that has gone what it was last called, and an untitled frame by the word for one', async () => {
		const fixture = workspace([view('a', {
			frames: [frame('f1')],
			placements: [sceneNode('s9', 'scene-9', 'Lost scene'), text('t0', '')],
		})]);
		await settle();
		expect(fixture.scene().nodes.map((node) => [node.id, node.kind, node.label])).toEqual([
			['f1', 'frame', 'freeformCanvas.frame.untitled'],
			['s9', 'missing', 'Lost scene'],
			['t0', 'text', 'freeformCanvas.text.label'],
		]);
		expect(fixture.face('f1').querySelector('.snowflake-method-freeform-frame-title')!.classes.has('is-untitled')).toBe(true);
	});

	it('paints nothing again for a bell that brings back what is shown', async () => {
		const fixture = await laid();
		const painted = fixture.canvas.scenes.length;
		fixture.notify();
		await settle();
		expect(fixture.canvas.scenes).toHaveLength(painted);
		// Read and parsed again, the files are other objects that lay out the same.
		fixture.reparse();
		fixture.notify();
		await settle();
		expect(fixture.canvas.scenes).toHaveLength(painted);
		// Another leaf looked at the view from elsewhere: that is its own to keep.
		fixture.rewrite('a', (before) => ({ ...before, viewport: { x: 900, y: 900, zoom: 2 }, updatedAt: 99 }));
		fixture.notify();
		await settle();
		expect(fixture.canvas.scenes).toHaveLength(painted);
		expect(fixture.canvas.moves).toHaveLength(1);
	});

	it('lays the view out again when another leaf changed it', async () => {
		const fixture = await laid();
		fixture.rewrite('a', (before) => ({
			...before,
			placements: before.placements.map((placement) => (placement.id === 't2' ? { ...placement, x: 900 } : placement)),
		}));
		fixture.notify();
		await settle();
		expect(fixture.node('t2').x).toBe(900);
		// Where this leaf looks from is left where it was.
		expect(fixture.canvas.moves).toHaveLength(1);
	});

	it('holds a paint back while a gesture is in flight, and makes it when the gesture ends', async () => {
		const fixture = await laid();
		const painted = fixture.canvas.scenes.length;
		fixture.canvas.busy = true;
		fixture.rewrite('a', (before) => ({ ...before, placements: before.placements.filter((placement) => placement.id !== 'l1') }));
		fixture.notify();
		await settle();
		expect(fixture.canvas.scenes).toHaveLength(painted);
		fixture.canvas.busy = false;
		fixture.port().gestureEnded();
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1']);
	});

	it('follows the project to another path, asking the bridge that stands for it', async () => {
		const fixture = await laid();
		expect(fixture.bridge.subscribe).toHaveBeenCalledOnce();
		fixture.handle.refresh();
		fixture.handle.remeasure();
		expect(fixture.canvas.remeasured).toBe(1);
	});
});

describe('the freeform views', () => {
	it('turns to the view picked, leaves the one it showed where it stood looking, and remembers the pick', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1, placements: [text('b1', 'B')], viewport: { x: 7, y: 8, zoom: 2 } })]);
		fixture.port().viewportChanged({ x: -100, y: -50, zoom: 0.75 }, true);
		fixture.choose({ nodes: ['t1'] });
		fixture.viewField().choose('b');
		await settle();
		expect(fixture.nodes()).toEqual(['b1']);
		expect(fixture.canvas.moves[fixture.canvas.moves.length - 1]).toEqual({ kind: 'exact', viewport: { x: 7, y: 8, zoom: 2 } });
		expect(fixture.zoomLevel().textContent).toBe('200%');
		// What was chosen on the view left is chosen no more.
		expect(fixture.canvas.selection).toEqual(NO_CANVAS_SELECTION);
		expect(fixture.memory.viewId).toBe('b');
		expect(fixture.remember).toHaveBeenCalled();
		expect(fixture.bridge.leaveView).toHaveBeenCalledOnce();
		const [left, behind] = fixture.bridge.leaveView.mock.calls[0]!;
		expect(left).toBe('a');
		expect(behind.viewport).toEqual({ x: -100, y: -50, zoom: 0.75 });
		// The scene is called what the project calls it now, so one that goes missing later is called that.
		expect(behind.labels?.get('s1')).toEqual({ name: 'Arrival', kind: 'scene' });
		expect(fixture.viewHeld('a').viewport).toEqual({ x: -100, y: -50, zoom: 0.75 });
		expect(fixture.viewHeld('a').updatedAt).toBe(5);
	});

	it('comes back to a view where this leaf last looked at it from, whatever its file says since', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1 })]);
		fixture.port().viewportChanged({ x: -100, y: -50, zoom: 0.75 }, true);
		fixture.viewField().choose('b');
		await settle();
		fixture.rewrite('a', (before) => ({ ...before, viewport: { x: 1, y: 1, zoom: 1 } }));
		fixture.viewField().choose('a');
		await settle();
		expect(fixture.canvas.moves[fixture.canvas.moves.length - 1]).toEqual({ kind: 'exact', viewport: { x: -100, y: -50, zoom: 0.75 } });
	});

	it('writes nothing as it leaves a view it neither moved about nor has a new name for', async () => {
		const fixture = workspace([
			view('a', { updatedAt: 5, placements: [sceneNode('s1', 'scene-1', 'Arrival')] }),
			view('b', { updatedAt: 1 }),
		]);
		await settle();
		fixture.viewField().choose('b');
		await settle();
		expect(fixture.bridge.leaveView).not.toHaveBeenCalled();
	});

	it('follows a layout restored under it to the view that names', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1, placements: [text('b1', 'B')] })]);
		fixture.memory.viewId = 'b';
		fixture.handle.refresh();
		await settle();
		expect(fixture.viewField().value()).toBe('b');
		expect(fixture.nodes()).toEqual(['b1']);
	});

	it('makes a view through its form and shows it once a read holds it', async () => {
		const fixture = await laid();
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-add'), 'click');
		expect(forms).toHaveLength(1);
		await submit(forms[0], 'Second act');
		await settle();
		expect(fixture.bridge.createView).toHaveBeenCalledWith('Second act');
		expect(fixture.held().views.map((one) => one.name)).toEqual(['View a', 'Second act']);
		expect(fixture.viewField().value()).toBe(fixture.held().views[1]!.id);
		expect(fixture.nodes()).toEqual([]);
		expect(fixture.hint().classes.has('is-hidden')).toBe(false);
	});

	it('keeps the form standing over a view the project would not make', async () => {
		const fixture = await laid();
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-add'), 'click');
		fixture.refuse('refused');
		await expect(submit(forms[0], 'Second act')).rejects.toThrow('freeformCanvas.view.createRefused');
		expect(fixture.viewField().value()).toBe('a');
	});

	it('names a view again through its form, and writes no name that is already so', async () => {
		const fixture = await laid();
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-edit'), 'click');
		await submit(forms[0], 'View a');
		expect(fixture.bridge.renameView).not.toHaveBeenCalled();
		await submit(forms[0], 'Renamed');
		await settle();
		expect(fixture.bridge.renameView).toHaveBeenCalledWith('a', 'Renamed');
		expect(fixture.viewField().options().map((option) => option.label)).toEqual(['Renamed']);
		fixture.refuse('refused');
		await expect(submit(forms[0], 'Again')).rejects.toThrow('freeformCanvas.view.renameRefused');
	});

	it('asks before a view is deleted, saying what goes with it and what words are lost', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1 })]);
		fixture.port().viewportChanged({ x: 1, y: 2, zoom: 1 }, true);
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-edit'), 'click');
		const form = forms[0] as unknown as { options: { deleteView(): Promise<boolean> } };
		await expect(form.options.deleteView()).resolves.toBe(true);
		await settle();
		expect(vi.mocked(confirmTimelineAction).mock.calls[0]![2]).toEqual({
			title: 'timeline.view.deleteTitle(name=View a)',
			lines: [
				'freeformCanvas.view.deleteDescription(nodes=4,edges=1,frames=1)',
				'freeformCanvas.words.lost(count=3)',
			],
			label: 'actions.delete',
		});
		expect(fixture.bridge.deleteView).toHaveBeenCalledWith('a');
		expect(fixture.viewField().value()).toBe('b');
		// A view that has gone is left nowhere, and where it was looked at from is forgotten.
		expect(fixture.bridge.leaveView).not.toHaveBeenCalled();
		expect(fixture.memory.viewports.has('a')).toBe(false);
	});

	it('says nothing of words lost where a view holds none of its own, and keeps a view the author would not let go', async () => {
		const fixture = workspace([view('a', { placements: [sceneNode('s1', 'scene-1', 'Arrival')] })]);
		await settle();
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-edit'), 'click');
		const form = forms[0] as unknown as { options: { deleteView(): Promise<boolean> } };
		vi.mocked(confirmTimelineAction).mockImplementation(() => Promise.resolve(false));
		await expect(form.options.deleteView()).resolves.toBe(false);
		expect(vi.mocked(confirmTimelineAction).mock.calls[0]![2].lines).toEqual([
			'freeformCanvas.view.deleteDescription(nodes=1,edges=0,frames=0)',
		]);
		expect(fixture.bridge.deleteView).not.toHaveBeenCalled();
	});

	it('says so when the project would not let a view go, and leaves its form standing', async () => {
		const fixture = await laid();
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-edit'), 'click');
		const form = forms[0] as unknown as { options: { deleteView(): Promise<boolean> } };
		fixture.refuse('refused');
		await expect(form.options.deleteView()).resolves.toBe(false);
		expect(notices).toHaveBeenCalledWith('timeline.view.deleteRefused');
		expect(fixture.viewField().value()).toBe('a');
	});

	it('offers every other view’s name as one that is taken', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1 })]);
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-add'), 'click');
		fire(fixture.button('snowflake-method-freeform-view-edit'), 'click');
		const [adding, editing] = forms as unknown as { options: { mode: string; initial: string; takenNames: string[]; deleteView?: unknown } }[];
		expect(adding!.options).toMatchObject({ mode: 'add', initial: '', takenNames: ['View a', 'View b'] });
		expect(adding!.options.deleteView).toBeUndefined();
		expect(editing!.options).toMatchObject({ mode: 'edit', initial: 'View a', takenNames: ['View b'] });
	});
});

describe('text nodes', () => {
	it('adds one at the middle of what is in sight, open to be typed into, and writes it once it holds a word', async () => {
		const fixture = await laid();
		const open = fixture.hold();
		// Through the form, as the toolbar's word opens it: a text node asks nothing more of it.
		const forms = watch(FreeformNodeFormModal);
		fire(fixture.button('snowflake-method-freeform-node-add'), 'click');
		expect(forms).toHaveLength(1);
		await submit(forms[0], { type: 'text' });
		const id = fixture.nodes()[fixture.nodes().length - 1]!;
		expect(fixture.node(id)).toMatchObject({
			kind: 'text',
			x: 500 - FREEFORM_SIZE.width / 2,
			y: 300 - FREEFORM_SIZE.height / 2,
			width: FREEFORM_SIZE.width,
			height: FREEFORM_SIZE.height,
			locked: true,
			// Over everything that stands.
			z: 4,
		});
		expect(fixture.canvas.selection).toEqual({ nodes: [id], edges: [] });
		const field = fixture.field(id)!;
		expect(fixture.dom.doc.activeElement).toBe(field);
		expect(field.getAttribute('aria-label')).toBe('freeformCanvas.text.label');
		expect(field.getAttribute('placeholder')).toBe('freeformCanvas.text.placeholder');
		expect(field.getAttribute('maxlength')).toBe(String(FREEFORM_LIMITS.textLength));
		// Nothing is written for a node that holds no word yet.
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		fixture.dom.height = 100;
		fixture.type(id, 'A thought');
		await settle();
		// Shown as written before the file has it.
		expect(fixture.field(id)).toBeNull();
		expect(fixture.shown(id)).toBe('A thought');
		expect(fixture.node(id)).toMatchObject({ locked: false, label: 'A thought' });
		expect(fixture.viewHeld('a').placements).toHaveLength(4);
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
		expect(fixture.bridge.transact.mock.calls[0]).toEqual(['a', [{
			do: 'add',
			placements: [{
				id,
				resource: { type: 'text', text: 'A thought' },
				x: 500 - FREEFORM_SIZE.width / 2,
				y: 300 - FREEFORM_SIZE.height / 2,
				width: FREEFORM_SIZE.width,
				height: FREEFORM_SIZE.height,
			}],
		}], { x: 12, y: 34, zoom: 0.5 }]);
		open();
		await settle();
		expect(fixture.viewHeld('a').placements.map((placement) => placement.id)).toContain(id);
		expect(fixture.node(id)).toMatchObject({ kind: 'text', label: 'A thought', locked: false });
		// Where the leaf stood looking rode along with the change.
		expect(fixture.viewHeld('a').viewport).toEqual({ x: 12, y: 34, zoom: 0.5 });
	});

	it('never writes a node left with no word in it', async () => {
		const fixture = await laid();
		const id = fixture.addText();
		fixture.type(id, '   \n  ');
		await settle();
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		const again = fixture.addText();
		fixture.type(again, 'Typed and let go', 'escape');
		await settle();
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		expect(fixture.canvas.focused).toBe(1);
	});

	it('adds one where the ground was pressed twice, and one from the ground’s menu where that was opened', async () => {
		const fixture = workspace([view('a')]);
		await settle();
		fixture.port().open({ kind: 'ground', at: { x: 1_000, y: 2_000 } }, {} as MouseEvent);
		const first = fixture.nodes()[0]!;
		expect(fixture.node(first)).toMatchObject({ x: 1_000 - FREEFORM_SIZE.width / 2, y: 2_000 - FREEFORM_SIZE.height / 2 });
		fixture.type(first, 'Here');
		await settle();
		const menu = fixture.menuAt({ kind: 'ground', at: { x: 1_000, y: 2_000 } })!;
		expect(menu.map((item) => item.title)).toEqual([
			'freeformCanvas.node.add', 'freeformCanvas.text.add', 'freeformCanvas.frame.add', 'freeformCanvas.fit.all', 'freeformCanvas.reset.viewport',
		]);
		menu[1]!.click();
		const second = fixture.nodes()[1]!;
		// The spot is taken, so the second steps aside.
		expect(fixture.node(second)).toMatchObject({
			x: 1_000 - FREEFORM_SIZE.width / 2 + FREEFORM_CASCADE,
			y: 2_000 - FREEFORM_SIZE.height / 2 + FREEFORM_CASCADE,
		});
	});

	it('lands a new node on the grid while the switch is on', async () => {
		const fixture = workspace([view('a')], { snap: true });
		await settle();
		expect(fixture.canvas.interaction?.snap).toBe(FREEFORM_GRID);
		fixture.port().open({ kind: 'ground', at: { x: 1_003, y: 2_007 } }, {} as MouseEvent);
		const made = fixture.node(fixture.nodes()[0]!);
		expect(made.x % FREEFORM_GRID).toBe(0);
		expect(made.y % FREEFORM_GRID).toBe(0);
	});

	it('keeps the node being typed into before it makes another', async () => {
		const fixture = workspace([view('a')]);
		await settle();
		const first = fixture.addText();
		fixture.type(first, 'Kept on the way', 'none');
		fixture.addText();
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
		expect(fixture.viewHeld('a').placements.map((placement) => placement.resource)).toEqual([
			{ type: 'text', text: 'Kept on the way' },
		]);
		expect(fixture.nodes()).toHaveLength(2);
	});

	it('says a view is full, and makes no node it has no room for', async () => {
		const fixture = await laid({ limits: { placements: 4 } });
		fixture.addText();
		expect(notices).toHaveBeenCalledWith('freeformCanvas.view.full(limit=4)');
		expect(fixture.nodes()).toHaveLength(5);
	});

	it('opens a node pressed twice, and keeps its words on the chord, growing the box they need', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		const field = fixture.field('t2')!;
		expect(field.value).toBe('Second');
		expect(fixture.node('t2').locked).toBe(true);
		expect(fixture.face('t2').classes.has('is-editing')).toBe(true);
		fixture.dom.height = 240;
		fixture.type('t2', 'Second, at length', 'chord');
		await settle();
		expect(fixture.face('t2').classes.has('is-editing')).toBe(false);
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([
			{ do: 'text', id: 't2', text: 'Second, at length' },
			{ do: 'place', places: [{ id: 't2', x: 400, y: 0, height: 240 }] },
		]);
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')).toMatchObject({
			resource: { type: 'text', text: 'Second, at length' }, height: 240, width: 200,
		});
		expect(fixture.node('t2')).toMatchObject({ label: 'Second, at length', height: 240, locked: false });
		expect(fixture.shown('t2')).toBe('Second, at length');
	});

	it('writes nothing for words left as they were, and never makes a box shorter', async () => {
		const fixture = await laid();
		fixture.dom.height = 40;
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.type('t2', 'Second');
		await settle();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		expect(fixture.node('t2').locked).toBe(false);
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.type('t2', 'Shorter');
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'text', id: 't2', text: 'Shorter' }]);
	});

	it('leaves a node as it was on Escape, and gives the canvas the focus back', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.type('t2', 'Thrown away', 'escape');
		await settle();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		expect(fixture.field('t2')).toBeNull();
		expect(fixture.shown('t2')).toBe('Second');
		expect(fixture.node('t2').locked).toBe(false);
		expect(fixture.canvas.focused).toBe(1);
	});

	it('leaves the input method its own keys', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		const field = fixture.field('t2')!;
		field.value = 'Composing';
		fire(field, 'keydown', { key: 'Escape', isComposing: true });
		fire(field, 'keydown', { key: 'Enter', metaKey: true, isComposing: true });
		expect(fixture.field('t2')).toBe(field);
		// Enter alone is a line of the words, never the end of them.
		fire(field, 'keydown', { key: 'Enter' });
		expect(fixture.field('t2')).toBe(field);
	});

	it('takes a node whose words were taken out to the last off the view', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.type('t2', '  ');
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'delete', nodes: ['t2'], edges: [] }]);
		expect(fixture.nodes()).toEqual(['f1', 't1', 's1', 'l1']);
		// The line that ended on it went with it.
		expect(fixture.viewHeld('a').edges).toEqual([]);
	});

	it('keeps the focused node’s words for the view’s own chord, and says so', async () => {
		const fixture = await laid();
		expect(fixture.handle.saveFocusedConflict()).toBe(false);
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.field('t2')!.value = 'By the chord';
		expect(fixture.handle.saveFocusedConflict()).toBe(true);
		await settle();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')?.resource).toEqual({ type: 'text', text: 'By the chord' });
		// The field has gone, so the chord is no longer the node's.
		expect(fixture.handle.saveFocusedConflict()).toBe(false);
	});

	it('hands back words the project would not take, and shows the node as its file has it', async () => {
		const fixture = await laid();
		const kept = watch(FreeformTextModal);
		fixture.refuse('refused');
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.type('t2', 'Words that must not be lost');
		await settle();
		expect(kept).toHaveLength(1);
		expect((kept[0] as unknown as { drafts: unknown }).drafts).toEqual([{ place: 'View a', words: 'Words that must not be lost' }]);
		expect(notices).toHaveBeenCalledWith('freeformCanvas.changeRefused');
		expect(fixture.node('t2').label).toBe('Second');
		expect(fixture.shown('t2')).toBe('Second');
	});

	it('hands back the words of a node made and refused, as it does a node\u2019s that stood', async () => {
		const fixture = await laid();
		const kept = watch(FreeformTextModal);
		fixture.refuse('full');
		fixture.port().open({ kind: 'node', id: 't1' }, {} as MouseEvent);
		fixture.type('t1', 'One', 'none');
		fixture.port().open({ kind: 'ground', at: { x: 900, y: 900 } }, {} as MouseEvent);
		const made = fixture.nodes()[fixture.nodes().length - 1]!;
		fixture.type(made, 'Two');
		await settle();
		// Each write is refused in its own turn, so each hands its words back as it is.
		const drafts = (kept as unknown as { drafts: { place: string; words: string }[] }[]).flatMap((dialog) => dialog.drafts);
		expect(drafts).toEqual([{ place: 'View a', words: 'One' }, { place: 'View a', words: 'Two' }]);
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
		expect(fixture.shown('t1')).toBe('First words\n\nand more');
		expect(notices).toHaveBeenCalledWith('freeformCanvas.view.full(limit=500)');
	});

	it('hands back words typed into a node that has gone from under them, and sends nothing', async () => {
		const fixture = await laid();
		const kept = watch(FreeformTextModal);
		// Both nodes have gone from under the words typed into them, which is said at once.
		fixture.port().open({ kind: 'node', id: 't1' }, {} as MouseEvent);
		fixture.field('t1')!.value = 'One';
		const first = fixture.field('t1')!;
		fixture.rewrite('a', (before) => ({ ...before, placements: before.placements.filter((placement) => placement.id === 's1') }));
		fixture.notify();
		await settle();
		expect(first.value).toBe('One');
		expect(kept).toHaveLength(1);
		expect((kept[0] as unknown as { drafts: unknown }).drafts).toEqual([{ place: 'View a', words: 'One' }]);
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
	});

	it('opens no dialog for words refused as the plugin goes, and logs them', async () => {
		const fixture = await laid();
		const kept = watch(FreeformTextModal);
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		fixture.refuse('refused');
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.field('t2')!.value = 'Typed as the plugin went';
		fixture.unload();
		fixture.handle.dispose();
		await settle();
		expect(kept).toHaveLength(0);
		expect(logged).toHaveBeenCalledWith(
			'Snowflake: a text node’s words could not be written',
			{ place: 'View a', words: 'Typed as the plugin went' },
		);
	});

	it('keeps what is being typed when a project can no longer be written, and hands it back', async () => {
		const fixture = await laid();
		const kept = watch(FreeformTextModal);
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.field('t2')!.value = 'Typed as the project closed';
		fixture.remodel({ readOnly: true });
		fixture.handle.refresh();
		await settle();
		expect(fixture.field('t2')).toBeNull();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		expect((kept[0] as unknown as { drafts: unknown }).drafts).toEqual([{ place: 'View a', words: 'Typed as the project closed' }]);
	});

	it('keeps what is being typed as the tab turns to another view, on the view it was typed on', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1 })]);
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.field('t2')!.value = 'Typed before the turn';
		fixture.viewField().choose('b');
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![0]).toBe('a');
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')?.resource).toEqual({ type: 'text', text: 'Typed before the turn' });
		expect(fixture.viewField().value()).toBe('b');
		expect(fixture.nodes()).toEqual([]);
	});

	it('never draws what is being typed over with what the file holds', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		const field = fixture.field('t2')!;
		field.value = 'Mine';
		fixture.rewrite('a', (before) => ({
			...before,
			placements: before.placements.map((placement) => (placement.id === 't2' ? { ...placement, resource: { type: 'text', text: 'Theirs' } } : placement)),
		}));
		fixture.notify();
		await settle();
		expect(fixture.field('t2')).toBe(field);
		expect(field.value).toBe('Mine');
		fixture.type('t2', 'Mine');
		await settle();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')?.resource).toEqual({ type: 'text', text: 'Mine' });
	});

	it('draws a node’s words again only when they are other words', async () => {
		const fixture = await laid();
		const drawn = rendered.length;
		fixture.choose({ nodes: ['t1'] });
		fixture.handle.refresh();
		fixture.port().commit([{ kind: 'move', id: 't1', x: 70, y: 70 }]);
		await settle();
		expect(rendered).toHaveLength(drawn);
		fixture.rewrite('a', (before) => ({
			...before,
			placements: before.placements.map((placement) => (placement.id === 't1' ? { ...placement, resource: { type: 'text', text: 'Other words' } } : placement)),
		}));
		fixture.notify();
		await settle();
		expect(rendered.slice(drawn)).toEqual(['Other words']);
		expect(fixture.shown('t1')).toBe('Other words');
	});

	it('lets what it drew go with the node', async () => {
		const fixture = await laid();
		const children = (fixture.component as unknown as { children: Set<unknown> }).children;
		expect(children.size).toBe(2);
		fixture.choose({ nodes: ['t1', 't2'] });
		fixture.press('Delete');
		await settle();
		expect(children.size).toBe(0);
	});
});

describe('moving, sizing and removing', () => {
	it('writes where a gesture left its nodes as one change, shown before the file has it', async () => {
		const fixture = await laid();
		const open = fixture.hold();
		fixture.port().commit([
			{ kind: 'move', id: 't2', x: 640, y: 80 },
			{ kind: 'resize', id: 'l1', x: 400, y: 300, width: 320, height: 200 },
		]);
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		expect(fixture.node('l1')).toMatchObject({ width: 320, height: 200 });
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')).toMatchObject({ x: 400, y: 0 });
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{
			do: 'place',
			places: [
				{ id: 't2', x: 640, y: 80 },
				{ id: 'l1', x: 400, y: 300, width: 320, height: 200 },
			],
		}]);
		open();
		await settle();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')).toMatchObject({ x: 640, y: 80 });
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
	});

	it('never shows a node back where it was between its write and the read that follows', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		const from = fixture.canvas.scenes.length - 1;
		await settle();
		fixture.notify();
		await settle();
		for (const scene of fixture.canvas.scenes.slice(from)) {
			expect(scene.nodes.find((node) => node.id === 't2')).toMatchObject({ x: 640, y: 80 });
		}
	});

	it('carries a frame’s nodes with it, and gives a node to the frame it was dropped in', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 'f1', x: 60, y: 20 }]);
		expect(fixture.node('f1')).toMatchObject({ x: 60, y: 20 });
		// The frame went a hundred each way, and so did the node it holds.
		expect(fixture.node('t1')).toMatchObject({ x: 100, y: 100, frame: 'f1' });
		await settle();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 120, y: 120 }, { kind: 'frame', id: 't2', frame: 'f1' }]);
		await settle();
		expect(fixture.node('t2').frame).toBe('f1');
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')?.frameId).toBe('f1');
		fixture.port().commit([{ kind: 'move', id: 't2', x: 900, y: 900 }, { kind: 'frame', id: 't2', frame: null }]);
		await settle();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')?.frameId).toBeNull();
	});

	it('makes every change still on its way, in the order they were made', async () => {
		const fixture = await laid();
		const open = fixture.hold();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		fixture.port().commit([{ kind: 'move', id: 'l1', x: 10, y: 10 }]);
		fixture.port().commit([{ kind: 'move', id: 't2', x: 700, y: 90 }]);
		expect(fixture.node('t2')).toMatchObject({ x: 700, y: 90 });
		expect(fixture.node('l1')).toMatchObject({ x: 10, y: 10 });
		open();
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledTimes(3);
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')).toMatchObject({ x: 700, y: 90 });
		expect(fixture.node('t2')).toMatchObject({ x: 700, y: 90 });
		expect(fixture.node('l1')).toMatchObject({ x: 10, y: 10 });
	});

	it('puts a node back where its file has it when the file would not take the change, and says so', async () => {
		const fixture = await laid();
		fixture.refuse('refused');
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		await settle();
		expect(fixture.node('t2')).toMatchObject({ x: 400, y: 0 });
		expect(notices).toHaveBeenCalledWith('freeformCanvas.changeRefused');
	});

	it('says so at once for a change the view cannot take, and sends none of it', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 'gone', x: 1, y: 1 }]);
		await settle();
		expect(notices).toHaveBeenCalledWith('freeformCanvas.changeRefused');
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
		// A gesture that ended where it began is no change at all.
		notices.mockClear();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 400, y: 0 }]);
		fixture.port().commit([]);
		await settle();
		expect(notices).not.toHaveBeenCalled();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
	});

	it('sends no change to a project that moved from under it', async () => {
		const fixture = await laid();
		const open = fixture.hold();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		// The first is on its way by the time the second is made.
		await settle();
		fixture.port().commit([{ kind: 'move', id: 'l1', x: 10, y: 10 }]);
		fixture.moveProject('Elsewhere');
		open();
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')).toMatchObject({ x: 640, y: 80 });
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 'l1')).toMatchObject({ x: 400, y: 300 });
		// The node goes back where its file has it, and the author is told.
		expect(fixture.node('l1')).toMatchObject({ x: 400, y: 300 });
		expect(notices).toHaveBeenCalledWith('freeformCanvas.changeRefused');
	});

	it('takes what is chosen off the view on Delete and on Backspace, and asks nothing', async () => {
		const fixture = await laid();
		fixture.choose({ nodes: ['t2', 'l1'], edges: [] });
		expect(fixture.press('Delete')).toBe(true);
		expect(fixture.nodes()).toEqual(['f1', 't1', 's1']);
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'delete', nodes: ['t2', 'l1'], edges: [] }]);
		expect(vi.mocked(confirmTimelineAction)).not.toHaveBeenCalled();
		fixture.choose({ nodes: ['f1'] });
		expect(fixture.press('Backspace')).toBe(true);
		await settle();
		// A frame taken off leaves what it held standing, and free.
		expect(fixture.nodes()).toEqual(['t1', 's1']);
		expect(fixture.node('t1').frame).toBeNull();
	});

	it('takes a line chosen off the view, and leaves the nodes it joined', async () => {
		const fixture = await laid();
		fixture.choose({ edges: ['e1'] });
		expect(fixture.press('Delete')).toBe(true);
		await settle();
		expect(fixture.scene().edges).toEqual([]);
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
	});

	it('takes no key it has no use for, and none pressed with the platform’s own', async () => {
		const fixture = await laid();
		expect(fixture.press('Delete')).toBe(false);
		expect(fixture.press('Escape')).toBe(false);
		fixture.choose({ nodes: ['t2'] });
		expect(fixture.press('Delete', { metaKey: true })).toBe(false);
		expect(fixture.press('Backspace', { ctrlKey: true })).toBe(false);
		expect(fixture.press('Delete', { altKey: true })).toBe(false);
		expect(fixture.press('a')).toBe(false);
		await settle();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
	});

	it('lets go of what is chosen on Escape', async () => {
		const fixture = await laid();
		fixture.choose({ nodes: ['t2'], edges: ['e1'] });
		expect(fixture.press('Escape')).toBe(true);
		expect(fixture.canvas.selection).toEqual(NO_CANVAS_SELECTION);
		expect(fixture.nodes()).toHaveLength(5);
	});

	it('drops a node that was never written when it is taken off with the rest', async () => {
		const fixture = await laid();
		const made = fixture.addText();
		fixture.choose({ nodes: [made, 't2'] });
		expect(fixture.press('Delete')).toBe(true);
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'delete', nodes: ['t2'], edges: [] }]);
		expect(fixture.nodes()).toEqual(['f1', 't1', 's1', 'l1']);
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
	});
});

describe('taking a change back', () => {
	const undoButton = (fixture: Fixture): CorkboardElement => fixture.button('snowflake-method-freeform-undo');
	const redoButton = (fixture: Fixture): CorkboardElement => fixture.button('snowflake-method-freeform-redo');
	const placed = (fixture: Fixture, id: string): FreeformPlacement | undefined =>
		fixture.viewHeld('a').placements.find((placement) => placement.id === id);
	const written = (fixture: Fixture, at: number): readonly FreeformStep[] => fixture.bridge.transact.mock.calls[at]![1];

	it('stands its two symbols ahead of the zoom step, asleep until there is a change to take back', async () => {
		const fixture = await laid();
		expect(undoButton(fixture).getAttribute('aria-label')).toBe('freeformCanvas.undo');
		expect(redoButton(fixture).getAttribute('aria-label')).toBe('freeformCanvas.redo');
		expect(undoButton(fixture).disabled).toBe(true);
		expect(redoButton(fixture).disabled).toBe(true);
		const panel = fixture.root.querySelector('.snowflake-method-freeform-controls')!;
		expect(panel.children.map((child) => [...child.classes].find((cls) => cls.startsWith('snowflake-method-freeform-') && cls !== 'snowflake-method-freeform-control'))).toEqual([
			'snowflake-method-freeform-select',
			'snowflake-method-freeform-undo',
			'snowflake-method-freeform-redo',
			'snowflake-method-freeform-zoom-out',
			'snowflake-method-freeform-zoom-level',
			'snowflake-method-freeform-zoom-in',
			'snowflake-method-freeform-fit',
			'snowflake-method-freeform-reset',
		]);
	});

	it('takes a move back, shown at once and written as one more change, and makes it again', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		// To be taken back from the moment it is shown, before its write has landed.
		expect(undoButton(fixture).disabled).toBe(false);
		expect(redoButton(fixture).disabled).toBe(true);
		await settle();
		fire(undoButton(fixture), 'click');
		expect(fixture.node('t2')).toMatchObject({ x: 400, y: 0 });
		expect(undoButton(fixture).disabled).toBe(true);
		expect(redoButton(fixture).disabled).toBe(false);
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledTimes(2);
		expect(written(fixture, 1)).toEqual([{ do: 'place', places: [{ id: 't2', x: 400, y: 0, width: 200, height: 100, frameId: null }] }]);
		expect(placed(fixture, 't2')).toMatchObject({ x: 400, y: 0 });
		fire(redoButton(fixture), 'click');
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		expect(undoButton(fixture).disabled).toBe(false);
		expect(redoButton(fixture).disabled).toBe(true);
		await settle();
		expect(written(fixture, 2)).toEqual([{ do: 'place', places: [{ id: 't2', x: 640, y: 80, width: 200, height: 100, frameId: null }] }]);
		expect(placed(fixture, 't2')).toMatchObject({ x: 640, y: 80 });
		// And back once more, from the chords.
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(false);
		expect(fixture.node('t2')).toMatchObject({ x: 400, y: 0 });
		expect(fixture.chord(['Mod', 'Shift'], 'z').listener()).toBe(false);
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledTimes(5);
	});

	it('takes a chord for nothing when there is nothing to take back, and leaves it to a field or a project that cannot be written', async () => {
		const fixture = await laid();
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(true);
		expect(fixture.chord(['Mod', 'Shift'], 'z').listener()).toBe(true);
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		// In a field, the chord is the field's own.
		fixture.port().open({ kind: 'node', id: 't1' }, {} as MouseEvent);
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(true);
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		fixture.type('t1', 'First words\n\nand more', 'escape');
		fixture.remodel({ readOnly: true });
		fixture.handle.refresh();
		expect(undoButton(fixture).disabled).toBe(true);
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(true);
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
	});

	it('puts back what was taken off the view as it was, and takes it off again', async () => {
		const fixture = await laid();
		fixture.choose({ nodes: ['f1'], edges: ['e1'] });
		fixture.press('Delete');
		await settle();
		expect(fixture.nodes()).toEqual(['t1', 't2', 's1', 'l1']);
		expect(fixture.scene().edges).toEqual([]);
		fire(undoButton(fixture), 'click');
		expect(fixture.nodes()).toEqual(['f1', 't1', 't2', 's1', 'l1']);
		expect(fixture.node('t1').frame).toBe('f1');
		expect(fixture.scene().edges.map((one) => one.id)).toEqual(['e1']);
		await settle();
		expect(written(fixture, 1)).toEqual([
			{
				do: 'restore',
				placements: [],
				frames: [laidView().frames[0]],
				edges: [laidView().edges[0]],
			},
			{ do: 'reframe', members: [{ id: 't1', frameId: 'f1' }] },
		]);
		expect(fixture.viewHeld('a').frames).toEqual(laidView().frames);
		expect(placed(fixture, 't1')?.frameId).toBe('f1');
		fire(redoButton(fixture), 'click');
		expect(fixture.nodes()).toEqual(['t1', 't2', 's1', 'l1']);
		await settle();
		// What was done last is taken back first: the node set free of its frame, then the frame and the line taken off.
		expect(written(fixture, 2)).toEqual([
			{ do: 'reframe', members: [{ id: 't1', frameId: null }] },
			{ do: 'delete', nodes: ['f1'], edges: ['e1'] },
		]);
		expect(fixture.viewHeld('a').frames).toEqual([]);
		expect(placed(fixture, 't1')?.frameId).toBeNull();
	});

	it('takes back words typed into a node, and a node made by typing into it', async () => {
		const fixture = await laid();
		fixture.dom.height = 40;
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.type('t2', 'Other words', 'chord');
		await settle();
		expect(fixture.shown('t2')).toBe('Other words');
		fire(undoButton(fixture), 'click');
		expect(fixture.shown('t2')).toBe('Second');
		await settle();
		expect(written(fixture, 1)).toEqual([{ do: 'text', id: 't2', text: 'Second' }]);
		expect(placed(fixture, 't2')?.resource).toEqual({ type: 'text', text: 'Second' });
		fire(redoButton(fixture), 'click');
		expect(fixture.shown('t2')).toBe('Other words');
		await settle();
		// A node made by typing is taken off the view, and put back with its words.
		const made = fixture.addText();
		fixture.type(made, 'A thought');
		await settle();
		expect(placed(fixture, made)).toBeDefined();
		fire(undoButton(fixture), 'click');
		expect(fixture.nodes()).not.toContain(made);
		await settle();
		expect(written(fixture, 4)).toEqual([{ do: 'delete', nodes: [made], edges: [] }]);
		expect(placed(fixture, made)).toBeUndefined();
		fire(redoButton(fixture), 'click');
		expect(fixture.nodes()).toContain(made);
		expect(fixture.shown(made)).toBe('A thought');
		await settle();
		expect(written(fixture, 5)).toEqual([{
			do: 'restore',
			placements: [expect.objectContaining({ id: made, resource: { type: 'text', text: 'A thought' }, zIndex: 4 })],
			frames: [],
			edges: [],
		}]);
		expect(placed(fixture, made)).toMatchObject({ zIndex: 4 });
	});

	it('keeps words still being typed before it takes anything back', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		fixture.dom.height = 40;
		fixture.port().open({ kind: 'node', id: 't1' }, {} as MouseEvent);
		fixture.field('t1')!.value = 'Typed, then undone';
		fire(undoButton(fixture), 'click');
		// The words are the last change, so they are what is taken back; the move stands.
		expect(fixture.field('t1')).toBeNull();
		expect(fixture.shown('t1')).toBe('First words\n\nand more');
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		await settle();
		expect(written(fixture, 1)).toEqual([{ do: 'text', id: 't1', text: 'Typed, then undone' }]);
		expect(written(fixture, 2)).toEqual([{ do: 'text', id: 't1', text: 'First words\n\nand more' }]);
	});

	it('forgets what could be made again once another change is made', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		fire(undoButton(fixture), 'click');
		await settle();
		expect(redoButton(fixture).disabled).toBe(false);
		fixture.port().commit([{ kind: 'move', id: 'l1', x: 10, y: 10 }]);
		expect(redoButton(fixture).disabled).toBe(true);
		expect(undoButton(fixture).disabled).toBe(false);
	});

	it('keeps each view’s own changes, and takes back only the view on show’s', async () => {
		const fixture = await laid({}, [view('b', { updatedAt: 1, placements: [text('b1', 'B', { x: 0, y: 0 })] })]);
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		fixture.viewField().choose('b');
		await settle();
		expect(undoButton(fixture).disabled).toBe(true);
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(true);
		fixture.port().commit([{ kind: 'move', id: 'b1', x: 30, y: 30 }]);
		await settle();
		expect(undoButton(fixture).disabled).toBe(false);
		fixture.viewField().choose('a');
		await settle();
		expect(undoButton(fixture).disabled).toBe(false);
		fire(undoButton(fixture), 'click');
		expect(fixture.node('t2')).toMatchObject({ x: 400, y: 0 });
		await settle();
		expect(fixture.viewHeld('b').placements[0]).toMatchObject({ x: 30, y: 30 });
		fixture.viewField().choose('b');
		await settle();
		fire(undoButton(fixture), 'click');
		expect(fixture.node('b1')).toMatchObject({ x: 0, y: 0 });
	});

	it('takes back what the file said it wrote, not what the canvas worked out, where the two differ', async () => {
		const fixture = await laid();
		const open = fixture.hold();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		// Another leaf moved the node while the write waited: the file's answer says where it stood as the write landed.
		fixture.rewrite('a', (before) => ({
			...before,
			placements: before.placements.map((placement) => (placement.id === 't2' ? { ...placement, x: 50, y: 50 } : placement)),
		}));
		open();
		await settle();
		fire(undoButton(fixture), 'click');
		await settle();
		expect(written(fixture, 1)).toEqual([{ do: 'place', places: [{ id: 't2', x: 50, y: 50, width: 200, height: 100, frameId: null }] }]);
		expect(placed(fixture, 't2')).toMatchObject({ x: 50, y: 50 });
	});

	it('forgets a change the file would not take', async () => {
		const fixture = await laid();
		fixture.refuse('refused');
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		expect(undoButton(fixture).disabled).toBe(false);
		await settle();
		expect(undoButton(fixture).disabled).toBe(true);
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(true);
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
	});

	it('says a change can no longer be taken back when the view has changed from under it', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		// Another leaf took the node off the view since.
		fixture.rewrite('a', (before) => ({ ...before, placements: before.placements.filter((placement) => placement.id !== 't2') }));
		fixture.notify();
		await settle();
		fire(undoButton(fixture), 'click');
		expect(notices).toHaveBeenCalledWith('freeformCanvas.undo.gone');
		expect(undoButton(fixture).disabled).toBe(true);
		expect(redoButton(fixture).disabled).toBe(true);
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
	});

	it('says so too when the file would not take the change back, and shows the view as the file has it', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		fixture.refuse('refused');
		fire(undoButton(fixture), 'click');
		expect(fixture.node('t2')).toMatchObject({ x: 400, y: 0 });
		expect(redoButton(fixture).disabled).toBe(false);
		await settle();
		expect(notices).toHaveBeenCalledWith('freeformCanvas.undo.gone');
		expect(notices).not.toHaveBeenCalledWith('freeformCanvas.changeRefused');
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80 });
		expect(redoButton(fixture).disabled).toBe(true);
		// Made again after a refusal, it says so in the words for that.
		fixture.refuse(null);
		fixture.port().commit([{ kind: 'move', id: 'l1', x: 10, y: 10 }]);
		await settle();
		fire(undoButton(fixture), 'click');
		await settle();
		fixture.refuse('absent');
		fire(redoButton(fixture), 'click');
		await settle();
		expect(notices).toHaveBeenCalledWith('freeformCanvas.redo.gone');
	});

	it('forgets every change as the project it was made in goes', async () => {
		const fixture = await laid();
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		expect(undoButton(fixture).disabled).toBe(false);
		fixture.moveProject('Elsewhere');
		fixture.notify();
		await settle();
		expect(undoButton(fixture).disabled).toBe(true);
	});

	it('offers nothing to take back on a project that cannot be written', async () => {
		const fixture = await laid({ readOnly: true });
		expect(undoButton(fixture).disabled).toBe(true);
		expect(redoButton(fixture).disabled).toBe(true);
		expect(fixture.chord(['Mod'], 'z').listener()).toBe(true);
	});
});

describe('nodes added by type', () => {
	const formOptions = (form: unknown) => (form as { options: FreeformNodeFormModal['options'] }).options;

	it('offers every kind of note the project holds and what is made on the canvas, each note once with whether the view holds it', async () => {
		const fixture = await laid();
		const forms = watch(FreeformNodeFormModal);
		fire(fixture.button('snowflake-method-freeform-node-add'), 'click');
		const options = formOptions(forms[0]);
		expect(options.types.map((type) => [type.value, type.label, type.section])).toEqual([
			['scene', 'form.group.scene', 'entity'],
			['character', 'form.group.character', 'entity'],
			['location', 'worldbuilding.kind.location', 'entity'],
			['Faction', 'Faction', 'entity'],
			['text', 'freeformCanvas.type.text', 'canvas'],
			['frame', 'freeformCanvas.type.frame', 'canvas'],
		]);
		expect(options.candidates('scene')).toEqual([
			{ id: 'scene-1', name: 'Arrival', onView: true },
			{ id: 'scene-2', name: 'Departure', onView: false },
		]);
		expect(options.candidates('character')).toEqual([{ id: 'char-1', name: 'Anna', onView: false }]);
		expect(options.candidates('location')).toEqual([{ id: 'loc-1', name: 'Harbour', onView: false }]);
		expect(options.candidates('Faction')).toEqual([]);
		expect(options.room()).toBe(FREEFORM_LIMITS.placements - 4);
	});

	it('places the notes chosen at the middle of what is in sight, each a step from the last, and chooses them', async () => {
		const fixture = await laid();
		const forms = watch(FreeformNodeFormModal);
		fire(fixture.button('snowflake-method-freeform-node-add'), 'click');
		await submit(forms[0], {
			type: 'entity',
			kind: 'character',
			nodes: [{ id: 'char-1', name: 'Anna' }, { id: 'char-2', name: 'Gone already' }],
		});
		const added = fixture.nodes().slice(-2);
		expect(fixture.node(added[0]!)).toMatchObject({
			kind: 'character',
			x: 500 - FREEFORM_SIZE.width / 2,
			y: 300 - FREEFORM_SIZE.height / 2,
			height: FREEFORM_FACE_HEIGHTS.record.standard,
			label: 'freeformCanvas.node.name(kind=form.group.character,name=Anna)',
		});
		// A note the project no longer holds is placed all the same, and shown as missing under the name it was given.
		expect(fixture.node(added[1]!)).toMatchObject({
			kind: 'missing',
			x: 500 - FREEFORM_SIZE.width / 2 + FREEFORM_CASCADE,
			y: 300 - FREEFORM_SIZE.height / 2 + FREEFORM_CASCADE,
			label: 'Gone already',
		});
		expect(fixture.canvas.selection).toEqual({ nodes: added, edges: [] });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{
			do: 'add',
			placements: [
				expect.objectContaining({ id: added[0], resource: { type: 'entity', kind: 'character', id: 'char-1', name: 'Anna' } }),
				expect.objectContaining({ id: added[1], resource: { type: 'entity', kind: 'character', id: 'char-2', name: 'Gone already' } }),
			],
		}]);
		expect(fixture.viewHeld('a').placements).toHaveLength(6);
		// A character's face shows its rows.
		expect(fixture.face(added[0]!).classes.has('is-record')).toBe(true);
		expect(fixture.face(added[0]!).querySelector('.snowflake-method-freeform-face-name')!.textContent).toBe('Anna');
		expect(fixture.face(added[1]!).classes.has('is-missing')).toBe(true);
	});

	it('places notes where the ground’s menu was opened', async () => {
		const fixture = await laid();
		const forms = watch(FreeformNodeFormModal);
		fixture.menuAt({ kind: 'ground', at: { x: 2_000, y: 3_000 } })![0]!.click();
		await submit(forms[0], { type: 'entity', kind: 'location', nodes: [{ id: 'loc-1', name: 'Harbour' }] });
		const added = fixture.nodes()[fixture.nodes().length - 1]!;
		expect(fixture.node(added)).toMatchObject({ kind: 'worldbuilding', x: 2_000 - FREEFORM_SIZE.width / 2, y: 3_000 - FREEFORM_SIZE.height / 2 });
		expect(fixture.node(added).label).toBe('freeformCanvas.node.name(kind=worldbuilding.kind.location,name=Harbour)');
		// A scene lands with the room the board's standard card needs, so it stands as that card from the first.
		fixture.menuAt({ kind: 'ground', at: { x: 2_000, y: 3_000 } })![0]!.click();
		await submit(forms[1], { type: 'entity', kind: 'scene', nodes: [{ id: 'scene-2', name: 'Departure' }] });
		const sceneAdded = fixture.nodes()[fixture.nodes().length - 1]!;
		expect(fixture.node(sceneAdded)).toMatchObject({
			kind: 'scene',
			y: 3_000 - FREEFORM_FACE_HEIGHTS.scene.standard / 2,
			height: FREEFORM_FACE_HEIGHTS.scene.standard,
		});
		expect(fixture.face(sceneAdded).dataset.mode).toBe('standard');
	});

	it('leaves the form standing over a refusal, saying so once', async () => {
		const fixture = await laid();
		fixture.refuse('refused');
		const forms = watch(FreeformNodeFormModal);
		fire(fixture.button('snowflake-method-freeform-node-add'), 'click');
		await expect(submit(forms[0], { type: 'entity', kind: 'scene', nodes: [{ id: 'scene-2', name: 'Departure' }] }))
			.rejects.toThrow('freeformCanvas.node.refused');
		expect(notices).not.toHaveBeenCalled();
		expect(fixture.nodes()).toHaveLength(5);
	});

	it('adds a text node through the form, typed where it lands', async () => {
		const fixture = await laid();
		const forms = watch(FreeformNodeFormModal);
		fixture.menuAt({ kind: 'ground', at: { x: 2_000, y: 3_000 } })![0]!.click();
		await submit(forms[0], { type: 'text' });
		const added = fixture.nodes()[fixture.nodes().length - 1]!;
		expect(fixture.node(added)).toMatchObject({ kind: 'text', x: 2_000 - FREEFORM_SIZE.width / 2, locked: true });
		expect(fixture.field(added)).not.toBeNull();
	});

	it('opens no form on a project that cannot be written, nor with no view to add to', async () => {
		const forms = watch(FreeformNodeFormModal);
		const readOnly = await laid({ readOnly: true });
		fire(readOnly.button('snowflake-method-freeform-node-add'), 'click');
		readOnly.menuAt({ kind: 'ground', at: { x: 0, y: 0 } })![0]!.click();
		const bare = workspace([]);
		await settle();
		fire(bare.button('snowflake-method-freeform-node-add'), 'click');
		expect(forms).toHaveLength(0);
	});
});

describe('what a node opens', () => {
	it('opens a scene’s form on a press twice and from its menu, and its note from its menu', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 's1' }, {} as MouseEvent);
		await settle();
		expect(fixture.host.openSceneForm).toHaveBeenCalledWith({ mode: 'edit', id: 'scene-1' }, 'P', expect.any(Function));
		const menu = fixture.menuAt({ kind: 'node', id: 's1' })!;
		menu[0]!.click();
		await settle();
		expect(fixture.host.openSceneForm).toHaveBeenCalledTimes(2);
		menu[1]!.click();
		expect(fixture.host.openManagedFile).toHaveBeenCalledWith('Scenes/Arrival.md');
	});

	it('opens a character’s and a worldbuilding note’s form, and their notes', async () => {
		const fixture = workspace([view('a', {
			placements: [
				{ ...text('c1', ''), resource: { type: 'entity', kind: 'character', id: 'char-1', name: 'Anna' } },
				{ ...text('w1', ''), resource: { type: 'entity', kind: 'location', id: 'loc-1', name: 'Harbour' }, x: 300 },
				{ ...text('m1', ''), resource: { type: 'entity', kind: 'location', id: 'loc-9', name: 'Lost' }, x: 600 },
			],
		})]);
		await settle();
		// The form says it saved before it closes, as the dashboard's does.
		fixture.host.openEntityForm.mockImplementation((_intent: unknown, _path?: string, onSaved?: () => void) => {
			onSaved?.();
			return Promise.resolve(null);
		});
		fixture.port().open({ kind: 'node', id: 'c1' }, {} as MouseEvent);
		fixture.port().open({ kind: 'node', id: 'w1' }, {} as MouseEvent);
		fixture.port().open({ kind: 'node', id: 'm1' }, {} as MouseEvent);
		await settle();
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('char-1', 'P', expect.any(Function));
		expect(fixture.host.openEntityForm).toHaveBeenCalledWith({ mode: 'edit', id: 'loc-1' }, 'P', expect.any(Function));
		// A note that has gone opens nothing, and its menu offers only its face, its frame, its lines, its measures and its removal.
		expect(fixture.menuAt({ kind: 'node', id: 'm1' })!.map((item) => item.title)).toEqual([
			...DISPLAY_ITEMS, ...FRAME_ITEMS, ...SINGLE_ITEMS, 'timeline.timeline.removeFromView',
		]);
		const menu = fixture.menuAt({ kind: 'node', id: 'w1' })!;
		menu[1]!.click();
		expect(fixture.host.openManagedFile).toHaveBeenCalledWith('World/Harbour.md');
		// The form's save was read back.
		expect(fixture.refresh).toHaveBeenCalled();
	});

	it('opens the note alone on a project that cannot be written', async () => {
		const fixture = await laid({ readOnly: true });
		fixture.port().open({ kind: 'node', id: 's1' }, {} as MouseEvent);
		await settle();
		expect(fixture.host.openSceneForm).not.toHaveBeenCalled();
		expect(fixture.host.openManagedFile).toHaveBeenCalledWith('Scenes/Arrival.md');
	});
});

describe('how a node is shown and where it stands', () => {
	it('sets the face chosen for every node chosen, and grows a box to the face it chose', async () => {
		const fixture = await laid();
		fixture.choose({ nodes: ['t2', 's1'] });
		fixture.menuAt({ kind: 'node', id: 's1' })![DISPLAY_ITEMS.indexOf('corkboard.cards.extended')]!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([
			{ do: 'display', modes: [{ id: 't2', mode: 'extended' }, { id: 's1', mode: 'extended' }] },
			// A text's fullest face needs no more room than its box has; a scene's card does.
			{ do: 'place', places: [{ id: 's1', x: 0, y: 300, height: FREEFORM_FACE_HEIGHTS.scene.extended }] },
		]);
		expect(fixture.node('s1').height).toBe(FREEFORM_FACE_HEIGHTS.scene.extended);
		expect(fixture.face('s1').dataset.mode).toBe('extended');
		// Back to Auto for the one node, which sizes nothing.
		fixture.choose({ nodes: [] });
		fixture.menuAt({ kind: 'node', id: 't2' })![1]!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[1]![1]).toEqual([{ do: 'display', modes: [{ id: 't2', mode: 'auto' }] }]);
	});

	it('shows, on Auto, the fullest face the zoom allows that the box has room for', async () => {
		const fixture = workspace([view('a', {
			placements: [
				{ ...text('c1', ''), resource: { type: 'entity', kind: 'character', id: 'char-1', name: 'Anna' }, height: 200 },
				{ ...text('c2', ''), resource: { type: 'entity', kind: 'character', id: 'char-1', name: 'Anna' }, x: 300, height: 400 },
				{ ...text('c3', ''), resource: { type: 'entity', kind: 'character', id: 'char-1', name: 'Anna' }, x: 600, height: 40 },
			],
		})]);
		await settle();
		// The plain canvas dresses at the fullest band: a box too low for that face falls back to what fits.
		expect(fixture.face('c1').dataset.mode).toBe('standard');
		expect(fixture.face('c2').dataset.mode).toBe('extended');
		expect(fixture.face('c3').dataset.mode).toBe('compact');
		// Looked at from further off, every face is the barest, whatever its box has room for.
		fixture.canvas.band = 'compact';
		fixture.handle.refresh();
		expect(fixture.face('c2').dataset.mode).toBe('compact');
	});

	it('sets a node’s size and place by number through its form, refusing what the view will not take', async () => {
		const fixture = await laid();
		const forms = watch(FreeformGeometryModal);
		fixture.menuAt({ kind: 'node', id: 't2' })![DISPLAY_ITEMS.length + FRAME_ITEMS.length + 2]!.click();
		expect(forms).toHaveLength(1);
		await submit(forms[0], { x: 640, y: 80, width: 300, height: 200 });
		expect(fixture.node('t2')).toMatchObject({ x: 640, y: 80, width: 300, height: 200 });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'place', places: [{ id: 't2', x: 640, y: 80, width: 300, height: 200 }] }]);
		// A frame is measured the same way.
		fixture.menuAt({ kind: 'node', id: 'f1' })!.find((item) => item.title === 'freeformCanvas.node.geometry')!.click();
		await submit(forms[1], { x: 10, y: 20, width: 500, height: 400 });
		await settle();
		expect(fixture.viewHeld('a').frames[0]).toMatchObject({ x: 10, y: 20, width: 500, height: 400 });
		fixture.refuse('refused');
		fixture.menuAt({ kind: 'node', id: 't2' })!.find((item) => item.title === 'freeformCanvas.node.geometry')!.click();
		await expect(submit(forms[2], { x: 1, y: 1, width: 300, height: 200 })).rejects.toThrow('freeformCanvas.geometry.refused');
	});
});

describe('frames', () => {
	const framesHeld = (fixture: Fixture) => fixture.viewHeld('a').frames;
	const placed = (fixture: Fixture, id: string) => fixture.viewHeld('a').placements.find((placement) => placement.id === id);
	const pickFrom = (form: unknown) => form as { times: PickerOption[]; pick: (option: PickerOption) => void };

	it('adds a frame through the form, titled and tinted, where the ground’s menu was opened, and chooses it', async () => {
		const fixture = await laid();
		const forms = watch(FreeformNodeFormModal);
		fixture.menuAt({ kind: 'ground', at: { x: 2_000, y: 3_000 } })!.find((item) => item.title === 'freeformCanvas.frame.add')!.click();
		expect((forms[0] as unknown as { options: FreeformNodeFormModal['options'] }).options.initialType).toBe('frame');
		await submit(forms[0], { type: 'frame', frame: { title: 'Act one', color: 'macaron-2' } });
		const added = fixture.nodes().find((id) => id.startsWith('frame-'))!;
		expect(fixture.node(added)).toMatchObject({ kind: 'frame', label: 'Act one', tone: 'is-tint-macaron-2', x: 2_000 - 240, y: 3_000 - 160, width: 480, height: 320 });
		expect(fixture.canvas.selection).toEqual({ nodes: [added], edges: [] });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{
			do: 'add-frames',
			frames: [{ id: added, title: 'Act one', color: 'macaron-2', x: 1_760, y: 2_840, width: 480, height: 320 }],
		}]);
		expect(framesHeld(fixture)).toHaveLength(2);
		// Frames stand first, under every other node.
		expect(fixture.nodes().slice(0, 2)).toEqual(['f1', added]);
		expect(fixture.face(added).getAttribute('data-color')).toBe('macaron-2');
		expect(fixture.face(added).classes.has('snowflake-method-sticky-tint')).toBe(true);
		// The form stands over a refusal.
		fixture.refuse('full');
		fire(fixture.button('snowflake-method-freeform-node-add'), 'click');
		await expect(submit(forms[1], { type: 'frame', frame: { title: '', color: null } })).rejects.toThrow('freeformCanvas.frame.refused');
	});

	it('gathers the nodes chosen into a frame drawn round them, untitled, and chooses the frame', async () => {
		const fixture = await laid();
		fixture.choose({ nodes: ['t2', 's1'] });
		fixture.menuAt({ kind: 'node', id: 't2' })!.find((item) => item.title === 'freeformCanvas.frame.group')!.click();
		await settle();
		const made = fixture.bridge.transact.mock.calls[0]![1][0] as { do: string; frame: { id: string; title: string; color: null }; members: string[] };
		expect(made).toMatchObject({ do: 'group', frame: { title: '', color: null }, members: ['t2', 's1'] });
		const frame = framesHeld(fixture).find((candidate) => candidate.id === made.frame.id)!;
		// Round t2 at (400, 0) and s1 at (0, 300), each 200 by 100, with the room a grouping leaves and a head.
		expect(frame).toMatchObject({ x: -24, y: -64, width: 648, height: 488 });
		expect(placed(fixture, 't2')?.frameId).toBe(frame.id);
		expect(placed(fixture, 's1')?.frameId).toBe(frame.id);
		expect(fixture.canvas.selection).toEqual({ nodes: [frame.id], edges: [] });
		expect(fixture.node(frame.id).label).toBe('freeformCanvas.frame.untitled');
	});

	it('gives the nodes chosen to a frame picked by name, bringing in those that stand outside it, and sets them free again', async () => {
		const fixture = await laid();
		const picks = watch(TimelineTimePickModal);
		fixture.choose({ nodes: ['t2', 't1'] });
		fixture.menuAt({ kind: 'node', id: 't2' })!.find((item) => item.title === 'freeformCanvas.frame.moveTo')!.click();
		const pick = pickFrom(picks[0]);
		expect(pick.times.map((option) => [option.value, option.label])).toEqual([['', 'freeformCanvas.frame.none'], ['f1', 'Opening']]);
		pick.pick({ value: 'f1', label: 'Opening' });
		await settle();
		// t1 stands in the frame already and stays where it is; t2 is brought inside, at the frame's head.
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([
			{ do: 'reframe', members: [{ id: 't2', frameId: 'f1' }, { id: 't1', frameId: 'f1' }] },
			{ do: 'place', places: [{ id: 't2', x: -40 + 24, y: -80 + 40 + 24 }] },
		]);
		expect(placed(fixture, 't2')).toMatchObject({ frameId: 'f1', x: -16, y: -16 });
		fixture.choose({ nodes: ['t1'] });
		fixture.menuAt({ kind: 'node', id: 't1' })!.find((item) => item.title === 'freeformCanvas.frame.moveTo')!.click();
		pickFrom(picks[1]).pick({ value: '', label: '' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[1]![1]).toEqual([{ do: 'reframe', members: [{ id: 't1', frameId: null }] }]);
		expect(placed(fixture, 't1')?.frameId).toBeNull();
	});

	it('edits a frame’s title and tint through its form, on a press twice and from its menu, and stands over a refusal', async () => {
		const fixture = await laid();
		const forms = watch(FreeformFrameFormModal);
		fixture.port().open({ kind: 'node', id: 'f1' }, {} as MouseEvent);
		expect(forms).toHaveLength(1);
		await submit(forms[0], { title: 'Act one', color: 'macaron-5' });
		expect(fixture.node('f1')).toMatchObject({ label: 'Act one', tone: 'is-tint-macaron-5' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'edit-frame', id: 'f1', title: 'Act one', color: 'macaron-5' }]);
		expect(framesHeld(fixture)[0]).toMatchObject({ title: 'Act one', color: 'macaron-5' });
		expect(fixture.face('f1').querySelector('.snowflake-method-freeform-frame-title')!.textContent).toBe('Act one');
		expect(fixture.face('f1').getAttribute('data-color')).toBe('macaron-5');
		fixture.menuAt({ kind: 'node', id: 'f1' })![0]!.click();
		expect(forms).toHaveLength(2);
		fixture.refuse('refused');
		await expect(submit(forms[1], { title: 'x', color: null })).rejects.toThrow('freeformCanvas.frame.refused');
		expect(notices).not.toHaveBeenCalled();
	});

	it('chooses a frame’s contents, draws the frame afresh round them, and offers neither for a frame that holds nothing', async () => {
		const fixture = await laid();
		const menu = fixture.menuAt({ kind: 'node', id: 'f1' })!;
		menu.find((item) => item.title === 'freeformCanvas.frame.selectContents')!.click();
		expect(fixture.canvas.selection).toEqual({ nodes: ['t1'], edges: [] });
		expect(fixture.canvas.focused).toBe(1);
		menu.find((item) => item.title === 'freeformCanvas.frame.fitContents')!.click();
		await settle();
		// Round t1 at (0, 0), 200 by 100.
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'place', places: [{ id: 'f1', x: -24, y: -64, width: 248, height: 188 }] }]);
		expect(framesHeld(fixture)[0]).toMatchObject({ x: -24, y: -64, width: 248, height: 188 });
		const empty = workspace([view('a', { frames: [frame('f1')], placements: [text('t1', 'free')] })]);
		await settle();
		const bare = empty.menuAt({ kind: 'node', id: 'f1' })!;
		expect(bare.find((item) => item.title === 'freeformCanvas.frame.selectContents')!.disabled).toBe(true);
		expect(bare.find((item) => item.title === 'freeformCanvas.frame.fitContents')!.disabled).toBe(true);
		// With no frame on the view, there is none to move a node to.
		const frameless = workspace([view('a', { placements: [text('t1', 'free')] })]);
		await settle();
		expect(frameless.menuAt({ kind: 'node', id: 't1' })!.find((item) => item.title === 'freeformCanvas.frame.moveTo')!.disabled).toBe(true);
	});

	it('takes a frame off the view and leaves what it held standing, free, and a node dropped in it is carried by it', async () => {
		const fixture = await laid();
		fixture.menuAt({ kind: 'node', id: 'f1' })!.find((item) => item.title === 'freeformCanvas.frame.remove')!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'delete', nodes: ['f1'], edges: [] }]);
		expect(fixture.nodes()).toEqual(['t1', 't2', 's1', 'l1']);
		expect(placed(fixture, 't1')?.frameId).toBeNull();
		expect(fixture.node('t1').frame).toBeNull();
	});
});

describe('lines from node to node', () => {
	const edgesHeld = (fixture: Fixture) => fixture.viewHeld('a').edges;
	const pickFrom = (form: unknown) => form as { times: PickerOption[]; pick: (option: PickerOption) => void };

	it('draws a line where a drag ended, from the side it left by to the side it came to', async () => {
		const fixture = await laid();
		fixture.port().connect({ from: 's1', fromSide: 'bottom', to: 'l1', toSide: 'top' });
		expect(fixture.scene().edges.map((one) => one.id)).toHaveLength(2);
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{
			do: 'connect',
			edges: [{ id: 'edge-1', source: 's1', target: 'l1', sourceSide: 'bottom', targetSide: 'top' }],
		}]);
		expect(edgesHeld(fixture)).toHaveLength(2);
		expect(edgesHeld(fixture)[1]).toMatchObject({ source: 's1', target: 'l1', sourceSide: 'bottom', targetSide: 'top', arrow: 'end', line: 'solid' });
		// A line from a node to itself joins nothing, and is never sent.
		fixture.port().connect({ from: 's1', fromSide: 'bottom', to: 's1', toSide: 'top' });
		await settle();
		expect(fixture.bridge.transact).toHaveBeenCalledOnce();
	});

	it('draws a line to a node picked by name, leaving its sides to where the two stand', async () => {
		const fixture = await laid();
		const picks = watch(TimelineTimePickModal);
		fixture.menuAt({ kind: 'node', id: 's1' })!.find((item) => item.title === 'freeformCanvas.node.connect')!.click();
		expect(picks).toHaveLength(1);
		const pick = pickFrom(picks[0]);
		// Every other node of the view, by what it is called, the node itself left out.
		expect(pick.times.map((option) => [option.value, option.label])).toEqual([
			['f1', 'Opening'], ['t1', 'First words'], ['t2', 'Second'], ['l1', 'example.com'],
		]);
		pick.pick({ value: 'f1', label: 'Opening' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{
			do: 'connect',
			edges: [{ id: 'edge-1', source: 's1', target: 'f1', sourceSide: null, targetSide: null }],
		}]);
	});

	it('moves an end of a line where a drag left it, and to a node picked by name', async () => {
		const fixture = await laid();
		fixture.port().reconnect('e1', { from: 't1', fromSide: 'right', to: 'l1', toSide: 'left' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([
			{ do: 'reconnect', id: 'e1', source: 't1', target: 'l1', sourceSide: 'right', targetSide: 'left' },
		]);
		expect(edgesHeld(fixture)[0]).toMatchObject({ source: 't1', target: 'l1', sourceSide: 'right', targetSide: 'left' });
		const picks = watch(TimelineTimePickModal);
		fixture.menuAt({ kind: 'edge', id: 'e1' })!.find((item) => item.title === 'freeformCanvas.edge.changeStart')!.click();
		// The other end is left out of the choice, so no line is asked to join a node to itself.
		expect(pickFrom(picks[0]).times.map((option) => option.value)).toEqual(['f1', 't1', 't2', 's1']);
		pickFrom(picks[0]).pick({ value: 's1', label: '' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[1]![1]).toEqual([{ do: 'reconnect', id: 'e1', source: 's1', sourceSide: null }]);
		fixture.menuAt({ kind: 'edge', id: 'e1' })!.find((item) => item.title === 'freeformCanvas.edge.changeEnd')!.click();
		expect(pickFrom(picks[1]).times.map((option) => option.value)).toEqual(['f1', 't1', 't2', 'l1']);
		pickFrom(picks[1]).pick({ value: 't2', label: '' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[2]![1]).toEqual([{ do: 'reconnect', id: 'e1', target: 't2', targetSide: null }]);
		expect(edgesHeld(fixture)[0]).toMatchObject({ source: 's1', target: 't2', sourceSide: null, targetSide: null });
	});

	it('turns a line about, its sides with it', async () => {
		const fixture = await laid();
		fixture.rewrite('a', (before) => ({ ...before, edges: [{ ...before.edges[0]!, sourceSide: 'bottom', targetSide: 'top' }] }));
		fixture.notify();
		await settle();
		fixture.menuAt({ kind: 'edge', id: 'e1' })!.find((item) => item.title === 'freeformCanvas.edge.reverse')!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([
			{ do: 'reconnect', id: 'e1', source: 't2', target: 't1', sourceSide: 'top', targetSide: 'bottom' },
		]);
		expect(edgesHeld(fixture)[0]).toMatchObject({ source: 't2', target: 't1' });
	});

	it('edits a line’s words and look through its form, on a press twice and from its menu', async () => {
		const fixture = await laid();
		const forms = watch(FreeformEdgeFormModal);
		fixture.port().open({ kind: 'edge', id: 'e1' }, {} as MouseEvent);
		expect(forms).toHaveLength(1);
		await submit(forms[0], { label: 'leads to', arrow: 'both', line: 'dashed' });
		expect(fixture.scene().edges[0]).toMatchObject({ label: 'leads to', arrow: 'both', line: 'dashed' });
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'edit-edges', edits: [{ id: 'e1', label: 'leads to', arrow: 'both', line: 'dashed' }] }]);
		expect(edgesHeld(fixture)[0]).toMatchObject({ label: 'leads to', arrow: 'both', line: 'dashed' });
		fixture.menuAt({ kind: 'edge', id: 'e1' })![0]!.click();
		expect(forms).toHaveLength(2);
		// The form stands over a refusal, saying so.
		fixture.refuse('refused');
		await expect(submit(forms[1], { label: 'x', arrow: 'none', line: 'solid' })).rejects.toThrow('freeformCanvas.edge.refused');
		expect(notices).not.toHaveBeenCalled();
	});

	it('goes to either end of a line, chosen and in sight, and takes a line off the view from its menu', async () => {
		const fixture = await laid();
		const menu = fixture.menuAt({ kind: 'edge', id: 'e1' })!;
		menu.find((item) => item.title === 'freeformCanvas.edge.goStart')!.click();
		expect(fixture.canvas.moves[fixture.canvas.moves.length - 1]).toEqual({ kind: 'reveal', id: 't1' });
		expect(fixture.canvas.selection).toEqual({ nodes: ['t1'], edges: [] });
		menu.find((item) => item.title === 'freeformCanvas.edge.goEnd')!.click();
		expect(fixture.canvas.moves[fixture.canvas.moves.length - 1]).toEqual({ kind: 'reveal', id: 't2' });
		expect(fixture.canvas.focused).toBe(2);
		menu.find((item) => item.title === 'freeformCanvas.edge.delete')!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'delete', nodes: [], edges: ['e1'] }]);
		expect(fixture.scene().edges).toEqual([]);
	});

	it('says so when a line the file would not take is drawn', async () => {
		const fixture = await laid();
		fixture.refuse('full');
		fixture.port().connect({ from: 's1', fromSide: 'bottom', to: 'l1', toSide: 'top' });
		await settle();
		expect(notices).toHaveBeenCalledWith('freeformCanvas.edge.refused');
		expect(fixture.scene().edges).toHaveLength(1);
	});

	it('draws no line on a project that cannot be written, whose nodes carry no dots', async () => {
		const fixture = await laid({ readOnly: true });
		expect(fixture.scene().nodes.every((node) => !node.connectable)).toBe(true);
		fixture.port().connect({ from: 's1', fromSide: 'bottom', to: 'l1', toSide: 'top' });
		fixture.port().reconnect('e1', { from: 't1', fromSide: 'right', to: 'l1', toSide: 'left' });
		fixture.port().open({ kind: 'edge', id: 'e1' }, {} as MouseEvent);
		await settle();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
	});
});

const DISPLAY_ITEMS = ['freeformCanvas.display.auto', 'corkboard.cards.compact', 'corkboard.cards.standard', 'corkboard.cards.extended'];
/** What a menu offers one node alone. */
const SINGLE_ITEMS = ['freeformCanvas.node.connect', 'freeformCanvas.node.geometry'];
/** What a menu offers the placements chosen, of frames. */
const FRAME_ITEMS = ['freeformCanvas.frame.group', 'freeformCanvas.frame.moveTo'];
/** What a frame's own menu offers first. */
const OWN_FRAME_ITEMS = ['freeformCanvas.frame.edit', 'freeformCanvas.frame.selectContents', 'freeformCanvas.frame.fitContents'];
const EDGE_ITEMS = [
	'freeformCanvas.edge.edit', 'freeformCanvas.edge.reverse', 'freeformCanvas.edge.changeStart', 'freeformCanvas.edge.changeEnd',
	'freeformCanvas.edge.goStart', 'freeformCanvas.edge.goEnd', 'freeformCanvas.edge.delete',
];

describe('the menus', () => {
	it('offers each kind of node what opens it, its face, its measures and its removal', async () => {
		const fixture = await laid();
		expect(fixture.menuAt({ kind: 'node', id: 't2' })!.map((item) => item.title)).toEqual([
			'freeformCanvas.text.edit', ...DISPLAY_ITEMS, ...FRAME_ITEMS, ...SINGLE_ITEMS, 'timeline.timeline.removeFromView',
		]);
		expect(fixture.menuAt({ kind: 'node', id: 's1' })!.map((item) => item.title)).toEqual([
			'actions.edit', 'actions.openNote', ...DISPLAY_ITEMS, ...FRAME_ITEMS, ...SINGLE_ITEMS, 'timeline.timeline.removeFromView',
		]);
		// A link opens nothing yet; a frame has no face to choose and is removed as a frame, its nodes kept.
		expect(fixture.menuAt({ kind: 'node', id: 'l1' })!.map((item) => item.title)).toEqual([
			...DISPLAY_ITEMS, ...FRAME_ITEMS, ...SINGLE_ITEMS, 'timeline.timeline.removeFromView',
		]);
		expect(fixture.menuAt({ kind: 'node', id: 'f1' })!.map((item) => item.title)).toEqual([
			...OWN_FRAME_ITEMS, ...SINGLE_ITEMS, 'freeformCanvas.frame.remove',
		]);
		// The face the node shows is the one checked.
		expect(fixture.menuAt({ kind: 'node', id: 't2' })!.map((item) => item.checked)).toEqual([
			null, true, false, false, false, null, null, null, null, null,
		]);
		expect(fixture.menuAt({ kind: 'edge', id: 'e1' })!.map((item) => item.title)).toEqual(EDGE_ITEMS);
		expect(fixture.menuAt({ kind: 'edge', id: 'gone' })).toBeUndefined();
		expect(fixture.menuAt({ kind: 'node', id: 'gone' })).toBeUndefined();
	});

	it('opens a node for typing from its menu', async () => {
		const fixture = await laid();
		fixture.menuAt({ kind: 'node', id: 't2' })![0]!.click();
		expect(fixture.field('t2')?.value).toBe('Second');
	});

	it('speaks for all that is chosen when asked on one of them, and for the one alone when asked elsewhere', async () => {
		const fixture = await laid();
		fixture.choose({ nodes: ['t1', 't2'], edges: ['e1'] });
		const onChosen = fixture.menuAt({ kind: 'node', id: 't2' })!;
		// Several are chosen: there is no one text to edit and no one box to measure, and the face and the frame are every one's.
		expect(onChosen.map((item) => item.title)).toEqual([...DISPLAY_ITEMS, ...FRAME_ITEMS, 'timeline.timeline.removeFromView']);
		const elsewhere = fixture.menuAt({ kind: 'node', id: 'l1' })!;
		elsewhere[elsewhere.length - 1]!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[0]![1]).toEqual([{ do: 'delete', nodes: ['l1'], edges: [] }]);
		onChosen[onChosen.length - 1]!.click();
		await settle();
		expect(fixture.bridge.transact.mock.calls[1]![1]).toEqual([{ do: 'delete', nodes: ['t1', 't2'], edges: ['e1'] }]);
	});

	it('offers a project that cannot be written nothing that would change it', async () => {
		const fixture = await laid({ readOnly: true });
		expect(fixture.menuAt({ kind: 'node', id: 't2' })!.map((item) => item.disabled)).toEqual([true, true, true, true, true, true, true, true, true, true]);
		// A line's ends can be gone to all the same.
		expect(fixture.menuAt({ kind: 'edge', id: 'e1' })!.map((item) => item.disabled)).toEqual([true, true, true, true, false, false, true]);
		// A note is opened all the same.
		expect(fixture.menuAt({ kind: 'node', id: 's1' })!.map((item) => [item.title, item.disabled]).slice(0, 2)).toEqual([
			['actions.edit', true], ['actions.openNote', false],
		]);
		expect(fixture.menuAt({ kind: 'ground', at: { x: 0, y: 0 } })!.map((item) => item.disabled)).toEqual([true, true, true, false, false]);
	});

	it('looks about from the ground’s menu', async () => {
		const fixture = await laid();
		const menu = fixture.menuAt({ kind: 'ground', at: { x: 0, y: 0 } })!;
		menu[3]!.click();
		menu[4]!.click();
		expect(fixture.canvas.moves.slice(1)).toEqual([{ kind: 'fit', of: 'all' }, { kind: 'reset' }]);
		const bare = workspace([view('a')]);
		await settle();
		expect(bare.menuAt({ kind: 'ground', at: { x: 0, y: 0 } })!.map((item) => item.disabled)).toEqual([false, false, false, true, false]);
	});

	it('opens a node’s menu from the button every face carries, under the pointer or by the button', async () => {
		const fixture = await laid();
		const more = fixture.more('l1');
		expect(more.getAttribute('aria-label')).toBe('table.actions');
		expect(more.getAttribute('aria-haspopup')).toBe('menu');
		menus.length = 0;
		positions.length = 0;
		fire(more, 'click', { detail: 1 });
		expect(menus[0]!.map((item) => item.title)).toEqual([...DISPLAY_ITEMS, ...FRAME_ITEMS, ...SINGLE_ITEMS, 'timeline.timeline.removeFromView']);
		expect(positions[0]).toBeNull();
		// Asked for from the keyboard, a press has no place of its own: the menu stands by the button.
		Object.assign(more, { getBoundingClientRect: () => ({ left: 40, bottom: 90, top: 66, right: 64 }) });
		fire(more, 'click', { detail: 0 });
		expect(positions[1]).toEqual({ x: 40, y: 90 });
		for (const id of ['t1', 'f1']) expect(fixture.more(id), id).toBeDefined();
		// A scene's card carries the corkboard's own button, which opens the node's menu all the same.
		const card = fixture.face('s1').querySelector('.snowflake-method-corkboard-more')!;
		fire(card, 'click', { detail: 1 });
		expect(menus[2]!.map((item) => item.title)[0]).toBe('actions.edit');
	});

	it('takes the menus it opened with it as it goes', async () => {
		const fixture = await laid();
		fixture.menuAt({ kind: 'node', id: 't2' });
		fixture.menuAt({ kind: 'ground', at: { x: 0, y: 0 } });
		fixture.handle.dispose();
		expect(hidden).toHaveLength(2);
	});
});

describe('the canvas controls', () => {
	it('steps nearer and further, and says how near the canvas is looked at', async () => {
		const fixture = await laid();
		fire(fixture.button('snowflake-method-freeform-zoom-in'), 'click');
		fire(fixture.button('snowflake-method-freeform-zoom-out'), 'click');
		expect(fixture.canvas.moves.slice(1)).toEqual([{ kind: 'step', direction: 'in' }, { kind: 'step', direction: 'out' }]);
		fixture.port().viewportChanged({ x: 0, y: 0, zoom: 1.2534 }, false);
		expect(fixture.zoomLevel().textContent).toBe('125%');
		expect(fixture.button('snowflake-method-freeform-zoom-in').disabled).toBe(false);
		// At either end of the ladder, the step that would go past it is asleep.
		fixture.port().viewportChanged({ x: 0, y: 0, zoom: 4 }, true);
		expect(fixture.button('snowflake-method-freeform-zoom-in').disabled).toBe(true);
		expect(fixture.button('snowflake-method-freeform-zoom-out').disabled).toBe(false);
		fixture.port().viewportChanged({ x: 0, y: 0, zoom: 0.1 }, true);
		expect(fixture.button('snowflake-method-freeform-zoom-out').disabled).toBe(true);
		expect(fixture.zoomLevel().textContent).toBe('10%');
	});

	it('fits everything and resets, by the words and by their chords', async () => {
		const fixture = await laid();
		const fit = fixture.button('snowflake-method-freeform-fit');
		const reset = fixture.button('snowflake-method-freeform-reset');
		expect([fit.textContent, fit.getAttribute('aria-label')]).toEqual(['freeformCanvas.fit', 'freeformCanvas.fit.all']);
		expect([reset.textContent, reset.getAttribute('aria-label')]).toEqual(['freeformCanvas.reset', 'freeformCanvas.reset.viewport']);
		fire(fit, 'click');
		fire(reset, 'click');
		expect(fixture.chords.map((chord) => [chord.modifiers, chord.key])).toEqual([
			[['Mod'], 'z'], [['Mod', 'Shift'], 'z'], [['Shift'], '1'], [['Shift'], '0'],
		]);
		expect(fixture.chord(['Shift'], '1').listener()).toBe(false);
		expect(fixture.chord(['Shift'], '0').listener()).toBe(false);
		expect(fixture.canvas.moves.slice(1)).toEqual([
			{ kind: 'fit', of: 'all' }, { kind: 'reset' }, { kind: 'fit', of: 'all' }, { kind: 'reset' },
		]);
	});

	it('leaves a chord to the field it was pressed in, and to whatever holds the focus outside the workspace', async () => {
		const fixture = await laid();
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		expect(fixture.dom.doc.activeElement).toBe(fixture.field('t2'));
		expect(fixture.chord(['Shift'], '1').listener()).toBe(true);
		expect(fixture.chord(['Shift'], '0').listener()).toBe(true);
		const outside = fixture.dom.container.createEl('button');
		outside.focus();
		expect(fixture.chord(['Shift'], '1').listener()).toBe(true);
		expect(fixture.canvas.moves).toHaveLength(1);
		// On one of the workspace's own buttons the chord is the canvas's.
		fixture.button('snowflake-method-freeform-fit').focus();
		expect(fixture.chord(['Shift'], '1').listener()).toBe(false);
		expect(fixture.canvas.moves).toHaveLength(2);
	});

	it('leaves a chord alone while no canvas is shown', async () => {
		const fixture = workspace([]);
		await settle();
		expect(fixture.chord(['Shift'], '1').listener()).toBe(true);
		expect(fixture.canvas.moves).toEqual([]);
	});

	it('draws a box with a drag on the ground while the switch is on', async () => {
		const fixture = await laid();
		const select = fixture.button('snowflake-method-freeform-select');
		expect(select.getAttribute('aria-label')).toBe('freeformCanvas.select.box');
		expect(select.getAttribute('aria-pressed')).toBe('false');
		expect(fixture.canvas.interaction?.ground).toBe('pan');
		fire(select, 'click');
		expect(select.getAttribute('aria-pressed')).toBe('true');
		expect(fixture.canvas.interaction?.ground).toBe('select');
		// A paint keeps the switch where the author left it.
		fixture.handle.refresh();
		expect(fixture.canvas.interaction?.ground).toBe('select');
		fire(select, 'click');
		expect(fixture.canvas.interaction?.ground).toBe('pan');
	});

	it('names its two bars for a reader that cannot see them', async () => {
		const fixture = await laid();
		const bars = fixture.root.querySelectorAll('.snowflake-method-freeform-toolbar, .snowflake-method-freeform-controls');
		expect(bars.map((bar) => [bar.getAttribute('role'), bar.getAttribute('aria-label')])).toEqual([
			['toolbar', 'freeformCanvas.toolbar'],
			['toolbar', 'freeformCanvas.controls'],
		]);
		expect(fixture.canvas.options?.labels).toEqual({ canvas: 'storyStructure.family.freeform', minimap: 'freeformCanvas.minimap', edgeMenu: 'table.actions' });
	});

	it('shows no move where motion is to be spared, nor in a window the plugin was not loaded in', async () => {
		const fixture = await laid();
		const still = fixture.canvas.options!.reduceMotion;
		expect(still()).toBe(false);
		fixture.host.isReduceMotionEnabled.mockReturnValue(true);
		expect(still()).toBe(true);
		fixture.host.isReduceMotionEnabled.mockReturnValue(false);
		fixture.leaveHome();
		expect(still()).toBe(true);
	});

	it('reads whether a press adds to what is chosen off the press itself', async () => {
		const fixture = await laid();
		const additive = fixture.canvas.options!.additive;
		expect(additive({ metaKey: true, shiftKey: false } as MouseEvent)).toBe(true);
		expect(additive({ metaKey: false, shiftKey: true } as MouseEvent)).toBe(true);
		expect(additive({ metaKey: false, shiftKey: false } as MouseEvent)).toBe(false);
	});

	it('names every canvas apart, so two in two leaves share no pattern and no marker', async () => {
		const first = await laid();
		const second = await laid();
		expect(first.canvas.options!.id).not.toBe(second.canvas.options!.id);
	});
});

describe('showing a scene', () => {
	it('brings a scene’s first node on the view into sight, chosen and holding the focus', async () => {
		const fixture = workspace([view('a', {
			placements: [text('t1', 'one'), sceneNode('s1', 'scene-1', 'Arrival'), sceneNode('s2', 'scene-1', 'Arrival')],
		})]);
		await settle();
		fixture.handle.reveal('scene-1');
		expect(fixture.canvas.moves[fixture.canvas.moves.length - 1]).toEqual({ kind: 'reveal', id: 's1' });
		expect(fixture.canvas.selection).toEqual({ nodes: ['s1'], edges: [] });
		expect(fixture.canvas.focused).toBe(1);
		const moved = fixture.canvas.moves.length;
		fixture.handle.reveal('scene-2');
		expect(fixture.canvas.moves).toHaveLength(moved);
	});
});

describe('the engine falling over', () => {
	it('says the canvas could not be read, once, and logs what fell', async () => {
		const fixture = await laid();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		fixture.port().failed(new Error('fell'));
		fixture.port().failed(new Error('fell again'));
		expect(fixture.emptyWords()).toBe('freeformCanvas.loadFailed');
		expect(fixture.stage().classes.has('is-hidden')).toBe(true);
		expect(logged).toHaveBeenCalledTimes(2);
	});
});

describe('the workspace going', () => {
	it('keeps what is being typed, leaves the view where it stood looking, and takes everything down in order', async () => {
		const fixture = await laid();
		const forms = watch(FreeformViewFormModal);
		fire(fixture.button('snowflake-method-freeform-view-edit'), 'click');
		const closed = vi.spyOn(forms[0] as Modal, 'close');
		fixture.port().viewportChanged({ x: 5, y: 6, zoom: 1.5 }, true);
		fixture.port().open({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.field('t2')!.value = 'Typed as the tab closed';
		fixture.handle.dispose();
		expect(closed).toHaveBeenCalledOnce();
		expect(fixture.chords.every((chord) => !chord.heard)).toBe(true);
		expect(fixture.listeners.size).toBe(0);
		expect(fixture.canvas.settled).toBeGreaterThan(0);
		expect(fixture.canvas.disposed).toBe(1);
		expect(fixture.dom.container.querySelector('.snowflake-method-freeform')).toBeNull();
		await settle();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')?.resource).toEqual({ type: 'text', text: 'Typed as the tab closed' });
		expect(fixture.viewHeld('a').viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
		// Going twice is going once.
		fixture.handle.dispose();
		expect(fixture.canvas.disposed).toBe(1);
	});

	it('writes where a gesture cut short left its nodes, as the engine hands them over on its way out', async () => {
		const fixture = await laid();
		const dispose = fixture.canvas.disposed;
		// The engine hands over what it still holds as it is taken down.
		const port = fixture.port();
		fixture.handle.dispose();
		expect(fixture.canvas.disposed).toBe(dispose + 1);
		port.commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		await settle();
		expect(fixture.viewHeld('a').placements.find((placement) => placement.id === 't2')).toMatchObject({ x: 640, y: 80 });
	});

	it('paints nothing, opens nothing and says nothing once it has gone', async () => {
		const fixture = await laid();
		fixture.handle.dispose();
		const painted = fixture.canvas.scenes.length;
		fixture.refuse('refused');
		fixture.port().commit([{ kind: 'move', id: 't2', x: 640, y: 80 }]);
		fixture.port().open({ kind: 'ground', at: { x: 0, y: 0 } }, {} as MouseEvent);
		fixture.port().menu({ kind: 'node', id: 't2' }, {} as MouseEvent);
		fixture.port().failed(new Error('late'));
		fixture.handle.refresh();
		fixture.notify();
		await settle();
		expect(fixture.canvas.scenes).toHaveLength(painted);
		expect(menus).toEqual([]);
		expect(notices).not.toHaveBeenCalled();
	});

	it('leaves nothing behind for a project that cannot be written', async () => {
		const fixture = await laid({ readOnly: true });
		fixture.port().viewportChanged({ x: 5, y: 6, zoom: 1.5 }, true);
		fixture.handle.dispose();
		await settle();
		expect(fixture.bridge.leaveView).not.toHaveBeenCalled();
		expect(fixture.bridge.transact).not.toHaveBeenCalled();
	});
});
