import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import type { OptionFieldConfig } from '../../src/ui/option-picker';

interface MenuRecord {
	items: { title: string; icon: string; click: () => void }[];
	shown: 'mouse' | 'position' | null;
}

const { viewFields, searches, notices, rows, menus } = vi.hoisted(() => ({
	viewFields: [] as OptionFieldConfig[],
	searches: [] as { inputEl: unknown; type: (value: string) => void }[],
	notices: vi.fn(),
	/** The panel's rows, by name, as the runtime's Setting made them. */
	rows: [] as { name: string; kind: string; component: { change(value: unknown): void; getValue(): unknown } }[],
	/** Every menu built, with its items and how it was shown. */
	menus: [] as MenuRecord[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	/** The app's search field, as far as the workspace reads it: a box with an input in it, and a hand on what is typed. */
	class SearchComponent {
		readonly containerEl: CorkboardElement;
		readonly inputEl: CorkboardElement;
		private handler: (value: string) => void = () => undefined;
		constructor(parent: CorkboardElement) {
			this.containerEl = parent.createDiv({ cls: 'search-input-container' });
			this.inputEl = this.containerEl.createEl('input', { attr: { type: 'search' } });
			searches.push(this);
		}
		setPlaceholder(text: string): this { this.inputEl.setAttribute('placeholder', text); return this; }
		setValue(value: string): this { this.inputEl.value = value; return this; }
		getValue(): string { return this.inputEl.value; }
		onChange(handler: (value: string) => void): this { this.handler = handler; return this; }
		type(value: string): void { this.inputEl.value = value; this.handler(value); }
	}
	type Build = (component: never) => unknown;
	class Setting extends runtime.Setting {
		private rowName = '';
		setName(name?: string): this {
			this.rowName = name ?? '';
			return super.setName(name);
		}
		private record(kind: string, build?: Build): Build {
			return (component) => {
				rows.push({ name: this.rowName, kind, component: component });
				build?.(component);
			};
		}
		addToggle(build?: Build): this { return super.addToggle(this.record('toggle', build)); }
		addSlider(build?: Build): this { return super.addSlider(this.record('slider', build)); }
		addSearch(build?: Build): this { return super.addSearch(this.record('search', build)); }
	}
	class MenuItem {
		readonly item = { title: '', icon: '', click: (): void => undefined };
		setTitle(title: string): this { this.item.title = title; return this; }
		setIcon(icon: string): this { this.item.icon = icon; return this; }
		onClick(click: () => void): this { this.item.click = click; return this; }
	}
	class Menu implements MenuRecord {
		readonly items: MenuRecord['items'] = [];
		shown: MenuRecord['shown'] = null;
		constructor() { menus.push(this); }
		addItem(build: (item: MenuItem) => void): this { const item = new MenuItem(); build(item); this.items.push(item.item); return this; }
		addSeparator(): this { return this; }
		showAtMouseEvent(): this { this.shown = 'mouse'; return this; }
		showAtPosition(): this { this.shown = 'position'; return this; }
	}
	return {
		...runtime,
		Notice: class { constructor(message: string) { notices(message); } },
		getIcon: () => null,
		SearchComponent,
		Setting,
		Menu,
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

import {
	defaultRelationshipGraphDocument,
	rememberSceneManuscriptOptions,
	type GraphMember,
	type GraphViewport,
} from '../../src/domain';
import type { RecordLine } from '../../src/templates/record-lines';
import { buildSceneManuscriptPreset, SCENE_MANUSCRIPT_FALLBACK_COLORS } from '../../src/ui/native-graph';
import { renderRelationshipGraph } from '../../src/ui/relationship-graph';
import type {
	RelationshipGraphControls,
	RelationshipGraphReading,
} from '../../src/ui/relationship-graph-bridge';
import type { GraphHandle, GraphNodePlace, GraphPort, GraphScene } from '../../src/ui/relationship-graph-port';
import { relationshipGraphMemory, type RelationshipGraphView } from '../../src/ui/story-structure-state';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface MountOptions {
	view?: RelationshipGraphView;
	controlsOpen?: boolean;
	readOnly?: boolean;
	/** The file remembers native options from an earlier graph tab. */
	stored?: boolean;
	available?: boolean;
	open?: boolean;
	members?: GraphMember[];
	/** The view the file holds for the entities; absent for a file that holds none. */
	viewport?: GraphViewport;
	/** Where the nodes stood when the tab was last shown this session. */
	positions?: Map<string, GraphNodePlace>;
}

/** An engine that only records what it is asked, and lets a test speak through its port. */
interface FakeEngine extends GraphHandle {
	host: CorkboardElement;
	port: GraphPort;
	scenes: GraphScene[];
	viewports: (GraphViewport | null)[];
	calls: string[];
	given: ReadonlyMap<string, GraphNodePlace>[];
	focused: string | null;
	pinned: Set<string>;
	/** Where every node is said to stand on screen; null for off the picture. */
	place: { x: number; y: number } | null;
}

function fakeEngine(host: CorkboardElement, port: GraphPort): FakeEngine {
	const engine: FakeEngine = {
		host,
		port,
		scenes: [],
		viewports: [],
		calls: [],
		given: [],
		focused: null,
		pinned: new Set(),
		place: { x: 5, y: 5 },
		setScene: (scene) => { engine.scenes.push(scene); engine.calls.push('setScene'); },
		setViewport: (view) => { engine.viewports.push(view); engine.calls.push('setViewport'); },
		fit: () => { engine.calls.push('fit'); },
		resetView: () => { engine.calls.push('resetView'); },
		zoomBy: (factor) => { engine.calls.push(`zoomBy:${factor}`); },
		panBy: (dx, dy) => { engine.calls.push(`panBy:${dx},${dy}`); },
		focusNode: (id) => { engine.focused = id; engine.calls.push(`focusNode:${id}`); },
		focusedNode: () => engine.focused,
		centreOn: (id) => { engine.calls.push(`centreOn:${id}`); },
		screenPlaceOf: () => engine.place,
		nudgeNode: (id, dx, dy) => { engine.calls.push(`nudgeNode:${id}:${dx},${dy}`); },
		pinNode: (id, on) => { if (on) engine.pinned.add(id); else engine.pinned.delete(id); engine.calls.push(`pinNode:${id}:${on}`); },
		isPinned: (id) => engine.pinned.has(id),
		places: () => new Map([['character-alice', { x: 10, y: 20, pinned: true }]]),
		setPlaces: (places) => { engine.given.push(places); engine.calls.push('setPlaces'); },
		remeasure: () => { engine.calls.push('remeasure'); },
		dispose: () => { engine.calls.push('dispose'); },
	};
	return engine;
}

/** An event fired on one of the fake's elements, as the page would deliver it. */
function fire(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

/** A key pressed on the graph's ground, as the page would deliver it. */
function press(
	root: CorkboardElement,
	key: string,
	mods: { shift?: boolean; ctrl?: boolean } = {},
): { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> } {
	const ground = root.querySelector('.snowflake-method-relationship-graph-canvas')! as unknown as {
		listeners: Map<string, ((event: unknown) => void)[]>;
	};
	const event = {
		key,
		shiftKey: mods.shift ?? false,
		ctrlKey: mods.ctrl ?? false,
		metaKey: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
	for (const listener of ground.listeners.get('keydown') ?? []) listener(event);
	return event;
}

const line = (label: string, targetPath: string, targetName: string, value = ''): RecordLine => ({
	label: { path: `Demo/20_Character/23_Relationship/${label}/${label}`, display: label },
	value,
	clauses: [{ kind: 'target', term: { kind: 'link', path: targetPath, name: targetName } }],
});

const member = (
	id: string,
	group: GraphMember['group'],
	kind: string,
	name: string,
	path: string,
	relationships: RecordLine[] = [],
): GraphMember => ({ id, group, kind, name, aliases: [], path, relationships });

/** Alice holds one line to Bob; a scene and a town stand by with none. */
function family(): GraphMember[] {
	return [
		member('character-alice', 'character', 'character', 'Alice', 'Demo/20_Character/Alice.md', [
			line('Family', 'Demo/20_Character/Bob', 'Bob', 'sister'),
		]),
		member('character-bob', 'character', 'character', 'Bob', 'Demo/20_Character/Bob.md'),
		member('scene-1', 'scene', 'scene', 'Market', 'Demo/40_Scene/Market.md'),
		member('entity-1', 'worldbuilding', 'location', 'Town', 'Demo/30_Worldbuilding/32_Location/Town.md'),
	];
}

function mount(options: MountOptions = {}) {
	menus.length = 0;
	const dom = new CorkboardDom();
	const memory = relationshipGraphMemory({ view: options.view ?? 'entities', controlsOpen: options.controlsOpen ?? true });
	if (options.positions !== undefined) memory.positions = options.positions;
	const listeners = new Set<() => void>();
	const empty = defaultRelationshipGraphDocument();
	const stored = options.stored
		? rememberSceneManuscriptOptions(
				empty,
				buildSceneManuscriptPreset({ rootPath: 'Demo', locale: 'en' }, SCENE_MANUSCRIPT_FALLBACK_COLORS),
				'Demo',
				1,
			)!
		: empty;
	const reading: RelationshipGraphReading = {
		projectPath: 'Demo/001_Project_Metadata.md',
		rootPath: 'Demo',
		locale: 'en',
		held:
			options.viewport === undefined
				? stored
				: { ...stored, entities: { ...stored.entities, viewport: options.viewport } },
		members: options.members ?? [],
		kinds: [],
		resolveTarget: (link) => `${link}.md`,
		readOnly: options.readOnly ?? false,
	};
	const bridge = {
		t: (key: string) => key,
		read: vi.fn(() => Promise.resolve(reading)),
		subscribe: vi.fn((listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}),
		updateEntities: vi.fn(() => Promise.resolve('written' as const)),
		sceneManuscript: vi.fn(() => ({ available: options.available ?? true, open: options.open ?? false })),
		openSceneManuscriptGraph: vi.fn(() => Promise.resolve('opened' as const)),
		resetSceneManuscriptGraph: vi.fn(() => Promise.resolve('written' as const)),
	};
	const remember = vi.fn();
	const refresh = vi.fn(() => Promise.resolve());
	const engines: FakeEngine[] = [];
	const workspaceHandlers = new Map<string, () => void>();
	const app = {
		workspace: {
			on: vi.fn((name: string, handler: () => void) => {
				workspaceHandlers.set(name, handler);
				return { name };
			}),
			offref: vi.fn(),
		},
	};
	const host = {
		openCharacterForm: vi.fn(() => Promise.resolve()),
		openSceneForm: vi.fn(() => Promise.resolve(null)),
		openEntityForm: vi.fn(() => Promise.resolve(null)),
		openProjectFile: vi.fn(() => Promise.resolve()),
		openRelationship: vi.fn(() => Promise.resolve(true)),
	};
	const activateProject = vi.fn();
	const controls = {
		app,
		host,
		t: (key: string) => key,
		model: () => null,
		projectPath: () => 'Demo/001_Project_Metadata.md',
		activateProject,
		refresh,
		bridge: () => bridge,
		canvas: (canvasHost: HTMLElement, port: GraphPort): GraphHandle => {
			const engine = fakeEngine(canvasHost as unknown as CorkboardElement, port);
			engines.push(engine);
			return engine;
		},
		memory,
		remember,
	} as unknown as RelationshipGraphControls;
	const handle = renderRelationshipGraph(dom.container as unknown as HTMLElement, controls);
	// The view's refresh re-reads the model and hands it to the handle, which reads the file again.
	refresh.mockImplementation(() => {
		handle.refresh();
		return Promise.resolve();
	});
	const root = dom.container.querySelector('.snowflake-method-relationship-graph')!;
	return {
		dom,
		root,
		handle,
		bridge,
		reading,
		memory,
		remember,
		refresh,
		listeners,
		engines,
		host,
		app,
		activateProject,
		workspaceHandlers,
		viewField: (): OptionFieldConfig => viewFields[viewFields.length - 1]!,
		button: (cls: string): CorkboardElement => root.querySelector(`.${cls}`)!,
	};
}

describe('the relationship graph workspace', () => {
	it('builds a balanced toolbar with the view at its start, the search in the middle and the symbols at the end', async () => {
		const fixture = mount();
		await settle();
		const toolbar = fixture.root.querySelector('.snowflake-method-relationship-graph-toolbar')!;
		expect(toolbar.classes.has('snowflake-method-balanced-toolbar')).toBe(true);
		expect(toolbar.getAttribute('aria-label')).toBe('relationshipGraph.toolbar');
		expect(toolbar.children.map((child) => [...child.classes][0])).toEqual([
			'snowflake-method-toolbar-start',
			'snowflake-method-toolbar-search',
			'snowflake-method-toolbar-end',
		]);
		const end = toolbar.querySelector('.snowflake-method-toolbar-end')!;
		expect(end.children.map((child) => child.getAttribute('aria-label'))).toEqual([
			'relationshipGraph.zoomIn',
			'relationshipGraph.zoomOut',
			'relationshipGraph.menu',
			'relationshipGraph.fit',
			'relationshipGraph.resetView',
			'relationshipGraph.controls',
			'corkboard.refresh',
		]);
		expect(fixture.button('snowflake-method-relationship-graph-controls').getAttribute('aria-pressed')).toBe('true');
		expect(fixture.viewField().options()).toEqual([
			{ value: 'entities', label: 'relationshipGraph.view.entities' },
			{ value: 'scene-manuscript', label: 'relationshipGraph.view.sceneManuscript' },
		]);
		expect(fixture.viewField().value()).toBe('entities');
		expect(fixture.bridge.read).toHaveBeenCalledOnce();
		expect(fixture.root.classes.has('is-entities')).toBe(true);
		expect(fixture.root.querySelector('.snowflake-method-tab-planned')?.textContent).toBe('relationshipGraph.empty');
	});

	it('writes the chosen view on the memory, saves the layout and dresses the root for it', async () => {
		const fixture = mount();
		await settle();
		fixture.viewField().choose('scene-manuscript');
		expect(fixture.memory.view).toBe('scene-manuscript');
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.root.classes.has('is-scene-manuscript')).toBe(true);
		expect(fixture.root.classes.has('is-entities')).toBe(false);
		expect(fixture.root.querySelector('.snowflake-method-tab-planned')).toBeNull();
		// The same view again, or one the tab does not know, changes nothing.
		fixture.viewField().choose('scene-manuscript');
		fixture.viewField().choose('tags');
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.memory.view).toBe('scene-manuscript');
	});

	it('folds the controls from their symbol, which says what stands now', async () => {
		const fixture = mount({ controlsOpen: false });
		await settle();
		const button = fixture.button('snowflake-method-relationship-graph-controls');
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(fixture.root.classes.has('is-controls-open')).toBe(false);
		button.dispatch('click');
		expect(fixture.memory.controlsOpen).toBe(true);
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(fixture.root.classes.has('is-controls-open')).toBe(true);
		expect(fixture.remember).toHaveBeenCalledOnce();
	});

	it('keeps the words searched for on the memory', async () => {
		const fixture = mount();
		await settle();
		searches[searches.length - 1]!.type('alice');
		expect(fixture.memory.query).toBe('');
		fixture.dom.flushFrame();
		expect(fixture.memory.query).toBe('alice');
	});

	it('reads again when the bell rings or the refresh symbol is pressed, and marks a read-only project', async () => {
		const fixture = mount({ readOnly: true });
		await settle();
		expect(fixture.root.classes.has('is-read-only')).toBe(true);
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(2);
		fixture.button('snowflake-method-relationship-graph-refresh').dispatch('click');
		await settle();
		expect(fixture.refresh).toHaveBeenCalledOnce();
		expect(fixture.bridge.read).toHaveBeenCalledTimes(3);
		expect(notices).not.toHaveBeenCalled();
	});

	it('opens the native graph once when the view is chosen, and says why when it cannot', async () => {
		const fixture = mount();
		await settle();
		fixture.viewField().choose('scene-manuscript');
		await settle();
		expect(fixture.bridge.openSceneManuscriptGraph).toHaveBeenCalledOnce();
		expect(notices).not.toHaveBeenCalled();
		// A repaint from the bell shows the pane again without opening another tab.
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(fixture.bridge.openSceneManuscriptGraph).toHaveBeenCalledOnce();
		fixture.viewField().choose('entities');
		fixture.bridge.openSceneManuscriptGraph.mockResolvedValueOnce('disabled' as never);
		fixture.viewField().choose('scene-manuscript');
		await settle();
		expect(notices).toHaveBeenCalledWith('relationshipGraph.sceneManuscript.disabled');
	});

	it('stands in for the native graph with the lead and the open button, and no more', async () => {
		const fixture = mount({ view: 'scene-manuscript' });
		await settle();
		expect(fixture.bridge.openSceneManuscriptGraph).not.toHaveBeenCalled();
		const pane = fixture.root.querySelector('.snowflake-method-scene-manuscript-pane')!;
		const body = pane.querySelector('.snowflake-method-scene-manuscript-body')!;
		expect(body.querySelector('.snowflake-method-scene-manuscript-lead')?.textContent).toBe('relationshipGraph.sceneManuscript.lead');
		const open = body.querySelector('.snowflake-method-scene-manuscript-open')!;
		expect(open.classes.has('mod-cta')).toBe(true);
		expect(open.disabled).toBe(false);
		expect(body.querySelector('.snowflake-method-scene-manuscript-reset')).toBeNull();
		// Nothing more is said: the body holds the lead and the buttons, and no line on how the settings stand.
		expect(body.children.map((child) => [...child.classes].pop())).toEqual([
			'snowflake-method-scene-manuscript-lead',
			'snowflake-method-scene-manuscript-actions',
		]);
		open.dispatch('click');
		expect(fixture.bridge.openSceneManuscriptGraph).toHaveBeenCalledOnce();
	});

	it('offers a reset while the file remembers settings', async () => {
		const fixture = mount({ view: 'scene-manuscript', stored: true });
		await settle();
		const pane = fixture.root.querySelector('.snowflake-method-scene-manuscript-pane')!;
		expect(pane.querySelector('.snowflake-method-scene-manuscript-state')).toBeNull();
		pane.querySelector('.snowflake-method-scene-manuscript-reset')!.dispatch('click');
		await settle();
		expect(fixture.bridge.resetSceneManuscriptGraph).toHaveBeenCalledOnce();
		expect(notices).toHaveBeenCalledWith('relationshipGraph.sceneManuscript.resetDone');
	});

	it('says only what stands in the way: the plugin being off, or a read-only project', async () => {
		const open = mount({ view: 'scene-manuscript', open: true, stored: true });
		await settle();
		expect(open.root.querySelector('.snowflake-method-scene-manuscript-state')).toBeNull();

		const off = mount({ view: 'scene-manuscript', available: false });
		await settle();
		const offPane = off.root.querySelector('.snowflake-method-scene-manuscript-pane')!;
		const state = offPane.querySelector('.snowflake-method-scene-manuscript-state')!;
		expect(state.classes.has('is-disabled')).toBe(true);
		expect(state.textContent).toBe('relationshipGraph.sceneManuscript.disabled');
		expect(offPane.querySelector('.snowflake-method-scene-manuscript-open')!.disabled).toBe(true);

		const readOnly = mount({ view: 'scene-manuscript', readOnly: true, stored: true });
		await settle();
		const readOnlyPane = readOnly.root.querySelector('.snowflake-method-scene-manuscript-pane')!;
		expect(readOnlyPane.querySelector('.snowflake-method-scene-manuscript-reset')).toBeNull();
		expect(readOnlyPane.querySelector('.snowflake-method-scene-manuscript-read-only')?.textContent).toBe(
			'relationshipGraph.sceneManuscript.readOnly',
		);
	});

	it('lets go of the bell and the root when disposed', async () => {
		const fixture = mount();
		await settle();
		expect(fixture.listeners.size).toBe(1);
		fixture.handle.dispose();
		expect(fixture.listeners.size).toBe(0);
		expect(fixture.dom.container.querySelector('.snowflake-method-relationship-graph')).toBeNull();
		expect(fixture.handle.saveFocusedBody()).toBe(false);
	});
});

describe('the entities view', () => {
	it('raises the engine once there are lines to draw and hands it the picture and the file\'s view', async () => {
		const fixture = mount({ members: family() });
		await settle();
		expect(fixture.engines).toHaveLength(1);
		const engine = fixture.engines[0]!;
		expect(engine.host.classes.has('snowflake-method-relationship-graph-canvas')).toBe(true);
		expect(engine.scenes).toHaveLength(1);
		const scene = engine.scenes[0]!;
		// Scenes start off; the town stands as an orphan, the line runs from Alice to Bob.
		expect(scene.picture.nodes.map((node) => node.id).sort()).toEqual(['character-alice', 'character-bob', 'entity-1']);
		expect(scene.picture.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual([
			['character-alice', 'character-bob', 'Family'],
		]);
		expect(scene.display.labels).toBe('relationship');
		expect(scene.colors.accents.purple).toBe('rgb(120, 82, 238)');
		expect(engine.viewports).toEqual([null]);
		expect(engine.given).toEqual([]);
		expect(fixture.root.classes.has('is-empty')).toBe(false);
	});

	it('shows the empty line and raises no engine while the project has no relationships', async () => {
		const fixture = mount({ members: family().map((one) => ({ ...one, relationships: [] })) });
		await settle();
		expect(fixture.engines).toHaveLength(0);
		expect(fixture.root.classes.has('is-empty')).toBe(true);
		expect(fixture.root.querySelector('.snowflake-method-tab-planned')!.textContent).toBe('relationshipGraph.empty');
	});

	it('hands the engine the view the file holds', async () => {
		const fixture = mount({ members: family(), viewport: { x: 5, y: 6, k: 2 } });
		await settle();
		expect(fixture.engines[0]!.viewports).toEqual([{ x: 5, y: 6, k: 2 }]);
	});

	it('lights what the search finds without narrowing or moving the view, and counts it', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		const count = (): string => fixture.root.querySelector('.snowflake-method-toolbar-count')!.textContent;
		expect(count()).toBe('');
		searches[searches.length - 1]!.type('alice');
		fixture.dom.flushFrame();
		expect(engine.scenes).toHaveLength(2);
		const [whole, found] = engine.scenes as [GraphScene, GraphScene];
		expect(found.picture.nodes.map((node) => node.id)).toEqual(whole.picture.nodes.map((node) => node.id));
		expect(found.picture.matches).toEqual(new Set(['character-alice']));
		expect(engine.viewports).toHaveLength(1);
		expect(count()).toBe('freeformCanvas.search.matchesOne');
		searches[searches.length - 1]!.type('nobody');
		fixture.dom.flushFrame();
		expect(engine.scenes[2]!.picture.matches).toEqual(new Set());
		expect(count()).toBe('relationshipGraph.search.none');
	});

	it('steps through what the search found with Enter, centring each with the ring on it, and lets it go on Escape', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		const field = searches[searches.length - 1]!;
		const input = field.inputEl as CorkboardElement;
		const count = (): string => fixture.root.querySelector('.snowflake-method-toolbar-count')!.textContent;
		fire(input, 'keydown', { key: 'Enter' });
		expect(engine.calls).not.toContain('focusNode:character-alice');
		field.type('kind:character');
		fixture.dom.flushFrame();
		expect(count()).toBe('freeformCanvas.search.matches');
		// By name: Alice, then Bob, then round to Alice; Shift+Enter goes back.
		fire(input, 'keydown', { key: 'Enter' });
		expect(engine.calls.slice(-2)).toEqual(['focusNode:character-alice', 'centreOn:character-alice']);
		expect(count()).toBe('freeformCanvas.search.position');
		fire(input, 'keydown', { key: 'Enter' });
		expect(engine.calls.slice(-2)).toEqual(['focusNode:character-bob', 'centreOn:character-bob']);
		fire(input, 'keydown', { key: 'Enter' });
		expect(engine.focused).toBe('character-alice');
		fire(input, 'keydown', { key: 'Enter', shiftKey: true });
		expect(engine.focused).toBe('character-bob');
		// The words let go: nothing is marked, the count falls silent, and the ring the search put on comes off.
		fire(input, 'keydown', { key: 'Escape' });
		expect(fixture.memory.query).toBe('');
		expect(engine.scenes[engine.scenes.length - 1]!.picture.matches).toBeNull();
		expect(count()).toBe('');
		expect(engine.focused).toBeNull();
	});

	it('takes its ring off when the words change, and leaves a ring the keys put on', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		const field = searches[searches.length - 1]!;
		const input = field.inputEl as CorkboardElement;
		field.type('alice');
		fixture.dom.flushFrame();
		fire(input, 'keydown', { key: 'Enter' });
		expect(engine.focused).toBe('character-alice');
		// Other words: the ring from the last search goes before the new one is stepped through.
		field.type('bob');
		fixture.dom.flushFrame();
		expect(engine.focused).toBeNull();
		fire(input, 'keydown', { key: 'Enter' });
		expect(engine.focused).toBe('character-bob');
		// Tab moves the ring on by hand, so it is the keyboard's now and the search's end leaves it.
		press(fixture.root, 'Tab');
		expect(engine.focused).toBe('entity-1');
		fire(input, 'keydown', { key: 'Escape' });
		expect(fixture.memory.query).toBe('');
		expect(engine.focused).toBe('entity-1');
	});

	it('fits and resets the view from the toolbar', async () => {
		const fixture = mount({ members: family() });
		await settle();
		fixture.button('snowflake-method-relationship-graph-fit').dispatch('click');
		fixture.button('snowflake-method-relationship-graph-reset-view').dispatch('click');
		expect(fixture.engines[0]!.calls.filter((call) => call === 'fit' || call === 'resetView')).toEqual(['fit', 'resetView']);
	});

	it('writes where the view was left after a pause, once for a run of moves', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		engine.port.viewportMoved({ x: 1, y: 2, k: 2 });
		engine.port.viewportMoved({ x: 3, y: 4, k: 2 });
		expect(fixture.bridge.updateEntities).not.toHaveBeenCalled();
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(1);
		expect(fixture.bridge.updateEntities).toHaveBeenCalledWith({ viewport: { x: 3, y: 4, k: 2 } });
	});

	it('writes nothing for a read-only project', async () => {
		const fixture = mount({ members: family(), readOnly: true });
		await settle();
		fixture.engines[0]!.port.viewportMoved({ x: 1, y: 2, k: 2 });
		fixture.dom.flushFrame();
		fixture.handle.dispose();
		expect(fixture.bridge.updateEntities).not.toHaveBeenCalled();
	});

	it('settles a move still owed when the tab closes, and keeps where the nodes stand', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		engine.port.viewportMoved({ x: 7, y: 8, k: 1 });
		fixture.handle.dispose();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledWith({ viewport: { x: 7, y: 8, k: 1 } });
		expect(engine.calls[engine.calls.length - 1]).toBe('dispose');
		expect(fixture.memory.positions.get('character-alice')).toEqual({ x: 10, y: 20, pinned: true });
		expect(fixture.app.workspace.offref).toHaveBeenCalledWith({ name: 'css-change' });
		// The timer was let go with the tab: nothing is written twice.
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(1);
	});

	it('leaves the view where it stands when the file echoes the engine\'s own move', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		engine.port.viewportMoved({ x: 3, y: 4, k: 2 });
		fixture.dom.flushFrame();
		fixture.reading.held = {
			...fixture.reading.held,
			entities: { ...fixture.reading.held.entities, viewport: { x: 3, y: 4, k: 2 } },
		};
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(engine.scenes).toHaveLength(2);
		expect(engine.viewports).toEqual([null]);
	});

	it('moves the view when the file changed it from outside', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		fixture.reading.held = {
			...fixture.reading.held,
			entities: { ...fixture.reading.held.entities, viewport: { x: 9, y: 9, k: 0.5 } },
		};
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(engine.viewports).toEqual([null, { x: 9, y: 9, k: 0.5 }]);
		// The same reading again moves nothing.
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(engine.viewports).toHaveLength(2);
	});

	it('opens a node\'s form by its group, its note with the modifier, and a line\'s holder', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const { port } = fixture.engines[0]!;
		const projectPath = 'Demo/001_Project_Metadata.md';
		port.nodeClicked('character-alice', { mod: false });
		expect(fixture.activateProject).toHaveBeenCalledTimes(1);
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('character-alice', projectPath);
		port.nodeClicked('scene-1', { mod: false });
		expect(fixture.host.openSceneForm).toHaveBeenCalledWith({ mode: 'edit', id: 'scene-1' }, projectPath);
		port.nodeClicked('entity-1', { mod: false });
		expect(fixture.host.openEntityForm).toHaveBeenCalledWith({ mode: 'edit', id: 'entity-1' }, projectPath);
		port.nodeClicked('character-bob', { mod: true });
		expect(fixture.host.openProjectFile).toHaveBeenCalledWith('Demo/20_Character/Bob.md');
		port.edgeClicked(fixture.engines[0]!.scenes[0]!.picture.edges[0]!);
		expect(fixture.host.openRelationship).toHaveBeenCalledExactlyOnceWith(
			{ group: 'character', id: 'character-alice' },
			0,
			projectPath,
		);
		expect(fixture.activateProject).toHaveBeenCalledTimes(5);
		port.nodeClicked('nobody', { mod: false });
		expect(fixture.host.openCharacterForm).toHaveBeenCalledTimes(1);
		expect(fixture.activateProject).toHaveBeenCalledTimes(5);
	});

	it("says so when a line's card cannot be opened", async () => {
		const fixture = mount({ members: family() });
		await settle();
		fixture.host.openRelationship.mockResolvedValueOnce(false);
		notices.mockClear();
		const { port, scenes } = fixture.engines[0]!;
		port.edgeClicked(scenes[0]!.picture.edges[0]!);
		await settle();
		expect(notices).toHaveBeenCalledExactlyOnceWith('relationshipGraph.edit.refused');
		port.edgeClicked(scenes[0]!.picture.edges[0]!);
		await settle();
		expect(notices).toHaveBeenCalledTimes(1);
	});

	it('hands the engine where the nodes stood when the tab was last shown', async () => {
		const positions = new Map<string, GraphNodePlace>([['character-bob', { x: 1, y: 2, pinned: false }]]);
		const fixture = mount({ members: family(), positions });
		await settle();
		const engine = fixture.engines[0]!;
		expect(engine.given).toEqual([positions]);
		expect(engine.calls.indexOf('setPlaces')).toBeLessThan(engine.calls.indexOf('setScene'));
	});

	it('reads the colours again after a theme change', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		fixture.workspaceHandlers.get('css-change')!();
		expect(engine.scenes).toHaveLength(2);
		expect(engine.scenes[1]!.colors).not.toBe(engine.scenes[0]!.colors);
		expect(engine.scenes[1]!.colors).toEqual(engine.scenes[0]!.colors);
	});

	it('centres a node and puts the keyboard on it when revealed', async () => {
		const fixture = mount({ members: family() });
		await settle();
		fixture.handle.reveal('character-bob');
		expect(fixture.engines[0]!.calls.slice(-2)).toEqual(['centreOn:character-bob', 'focusNode:character-bob']);
		fixture.handle.remeasure();
		expect(fixture.engines[0]!.calls[fixture.engines[0]!.calls.length - 1]).toBe('remeasure');
	});
});

describe('the controls panel in the workspace', () => {
	const row = (name: string) => rows.filter((one) => one.name === name).pop()!.component;

	it("stands in the stage and folds with the toolbar's symbol", async () => {
		const fixture = mount({ members: family(), controlsOpen: false });
		await settle();
		const panel = fixture.root.querySelector('.snowflake-method-graph-controls')!;
		expect(panel.classes.has('is-close')).toBe(true);
		fixture.button('snowflake-method-relationship-graph-controls').dispatch('click');
		expect(panel.classes.has('is-close')).toBe(false);
		expect(fixture.memory.controlsOpen).toBe(true);
		expect(fixture.remember).toHaveBeenCalledTimes(1);
		panel.querySelector('.graph-controls-button.mod-close')!.dispatch('click');
		expect(panel.classes.has('is-close')).toBe(true);
		expect(fixture.memory.controlsOpen).toBe(false);
		expect(fixture.button('snowflake-method-relationship-graph-controls').getAttribute('aria-pressed')).toBe('false');
	});

	it('takes a change from the panel into the picture at once and writes it after a pause', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		row('relationshipGraph.display.arrows').change(false);
		row('relationshipGraph.filter.orphans').change(false);
		const last = engine.scenes[engine.scenes.length - 1]!;
		expect(last.display.arrows).toBe(false);
		// The town stood alone; without orphans it is gone from the picture.
		expect(last.picture.nodes.map((node) => node.id).sort()).toEqual(['character-alice', 'character-bob']);
		expect(fixture.bridge.updateEntities).not.toHaveBeenCalled();
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(1);
		const fresh = defaultRelationshipGraphDocument().entities;
		expect(fixture.bridge.updateEntities).toHaveBeenCalledWith({
			display: { ...fresh.display, arrows: false },
			filters: { ...fresh.filters, orphans: false },
		});
	});

	it("keeps the change just made when the file gives an older write of the panel's back", async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		const fresh = defaultRelationshipGraphDocument().entities;
		const fileWith = (arrows: boolean): RelationshipGraphReading => ({
			...fixture.reading,
			held: { ...fixture.reading.held, entities: { ...fresh, display: { ...fresh.display, arrows } } },
		});
		const ring = async (): Promise<void> => {
			for (const listener of fixture.listeners) listener();
			await settle();
		};
		const lastArrows = (): boolean => engine.scenes[engine.scenes.length - 1]!.display.arrows;
		row('relationshipGraph.display.arrows').change(false);
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(1);
		// Arrows back on before the first write has come back from the file: the file's older word must not flash them off.
		row('relationshipGraph.display.arrows').change(true);
		fixture.bridge.read.mockResolvedValueOnce(fileWith(false));
		await ring();
		expect(lastArrows()).toBe(true);
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(2);
		fixture.bridge.read.mockResolvedValueOnce(fileWith(true));
		await ring();
		expect(lastArrows()).toBe(true);
		// A ring that moved nothing in the file leaves the picture alone too.
		fixture.bridge.read.mockResolvedValueOnce(fileWith(true));
		await ring();
		expect(lastArrows()).toBe(true);
		// A change made outside, with nothing owed, is taken.
		fixture.bridge.read.mockResolvedValueOnce(fileWith(false));
		await ring();
		expect(lastArrows()).toBe(false);
	});

	it('settles a change still owed when the tab closes', async () => {
		const fixture = mount({ members: family() });
		await settle();
		row('relationshipGraph.force.repel').change(3);
		fixture.handle.dispose();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(1);
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).toHaveBeenCalledTimes(1);
	});

	it('writes nothing from the panel for a read-only project', async () => {
		const fixture = mount({ members: family(), readOnly: true });
		await settle();
		const engine = fixture.engines[0]!;
		row('relationshipGraph.display.arrows').change(false);
		fixture.dom.flushFrame();
		expect(fixture.bridge.updateEntities).not.toHaveBeenCalled();
		expect(engine.scenes).toHaveLength(1);
	});

	it("mirrors the panel's words into the toolbar and the toolbar's into the panel", async () => {
		const fixture = mount({ members: family() });
		await settle();
		row('').change('alice');
		expect(fixture.memory.query).toBe('alice');
		expect((searches[searches.length - 1]!.inputEl as CorkboardElement).value).toBe('alice');
		const engine = fixture.engines[0]!;
		expect(engine.scenes[engine.scenes.length - 1]!.picture.matches).toEqual(new Set(['character-alice']));
		searches[searches.length - 1]!.type('bob');
		fixture.dom.flushFrame();
		expect(row('').getValue()).toBe('bob');
	});

	it('names the kinds the graph has, the built-ins by their words', async () => {
		const fixture = mount({ members: family() });
		await settle();
		expect(rows.filter((one) => one.kind === 'toggle').map((one) => one.name)).toEqual(
			expect.arrayContaining(['relationshipGraph.filter.characters', 'relationshipGraph.filter.scenes', 'Family']),
		);
		expect(rows.some((one) => one.name === 'worldbuilding.kind.location')).toBe(false);
		fixture.reading.kinds = [{ id: 'location', folderName: '32_Location', custom: false, icon: null, description: null }];
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(rows.some((one) => one.name === 'worldbuilding.kind.location')).toBe(true);
	});

	it('shows the local section around the focused node and lets the whole graph back', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const local = fixture.root.querySelector('.graph-control-section.mod-local')!;
		expect(local.classes.has('is-hidden')).toBe(true);
		fixture.memory.focus = 'character-alice';
		for (const listener of fixture.listeners) listener();
		await settle();
		expect(local.classes.has('is-hidden')).toBe(false);
		expect(local.querySelector('.snowflake-method-graph-local-about')!.textContent).toBe('relationshipGraph.local.about');
		const engine = fixture.engines[0]!;
		expect(engine.scenes[engine.scenes.length - 1]!.picture.local).toBe(true);
		local.querySelector('.snowflake-method-graph-local-whole')!.dispatch('click');
		expect(fixture.memory.focus).toBeNull();
		expect(local.classes.has('is-hidden')).toBe(true);
		expect(engine.scenes[engine.scenes.length - 1]!.picture.local).toBe(false);
	});
});

describe('the keys and menus of the entities view', () => {
	const lastCalls = (fixture: ReturnType<typeof mount>, count: number): string[] => fixture.engines[0]!.calls.slice(-count);
	const menuTitles = (): string[] => menus[menus.length - 1]!.items.map((item) => item.title);
	const clickItem = (title: string): void => {
		menus[menus.length - 1]!.items.find((item) => item.title === title)!.click();
	};

	it('holds the keyboard on its ground, named for the view', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const ground = fixture.root.querySelector('.snowflake-method-relationship-graph-canvas')!;
		expect(ground.getAttribute('tabindex')).toBe('0');
		expect(ground.getAttribute('role')).toBe('application');
		expect(ground.getAttribute('aria-label')).toBe('relationshipGraph.view.entities');
	});

	it('walks the shown nodes by name with Tab and back with Shift+Tab, centring one out of sight', async () => {
		const fixture = mount({ members: family() });
		await settle();
		fixture.dom.resize(800, 600);
		const engine = fixture.engines[0]!;
		const event = press(fixture.root, 'Tab');
		expect(event.preventDefault).toHaveBeenCalled();
		expect(engine.focused).toBe('character-alice');
		expect(engine.calls).not.toContain('centreOn:character-alice');
		press(fixture.root, 'Tab');
		expect(engine.focused).toBe('character-bob');
		press(fixture.root, 'Tab');
		expect(engine.focused).toBe('entity-1');
		press(fixture.root, 'Tab');
		expect(engine.focused).toBe('character-alice');
		press(fixture.root, 'Tab', { shift: true });
		expect(engine.focused).toBe('entity-1');
		engine.place = { x: -40, y: 10 };
		press(fixture.root, 'Tab');
		expect(lastCalls(fixture, 2)).toEqual(['focusNode:character-alice', 'centreOn:character-alice']);
	});

	it("opens the focused node's form on Enter and its note with the modifier", async () => {
		const fixture = mount({ members: family() });
		await settle();
		press(fixture.root, 'Enter');
		expect(fixture.host.openCharacterForm).not.toHaveBeenCalled();
		press(fixture.root, 'Tab');
		press(fixture.root, 'Enter');
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('character-alice', 'Demo/001_Project_Metadata.md');
		press(fixture.root, 'Enter', { ctrl: true });
		expect(fixture.host.openProjectFile).toHaveBeenCalledWith('Demo/20_Character/Alice.md');
	});

	it('nudges the focused node with the arrows, and pans the view as a camera without one', async () => {
		const fixture = mount({ members: family() });
		await settle();
		press(fixture.root, 'ArrowLeft');
		press(fixture.root, 'ArrowUp', { shift: true });
		expect(lastCalls(fixture, 2)).toEqual(['panBy:10,0', 'panBy:0,50']);
		press(fixture.root, 'Tab');
		press(fixture.root, 'ArrowRight');
		press(fixture.root, 'ArrowDown', { shift: true });
		expect(lastCalls(fixture, 2)).toEqual(['nudgeNode:character-alice:10,0', 'nudgeNode:character-alice:0,50']);
	});

	it('zooms, resets, fits and pins from the keys', async () => {
		const fixture = mount({ members: family() });
		await settle();
		press(fixture.root, '+');
		press(fixture.root, '-');
		press(fixture.root, '0');
		press(fixture.root, 'f');
		expect(lastCalls(fixture, 4)).toEqual(['zoomBy:1.25', 'zoomBy:0.8', 'resetView', 'fit']);
		press(fixture.root, 'p');
		expect(lastCalls(fixture, 1)).toEqual(['fit']);
		press(fixture.root, 'Tab');
		press(fixture.root, 'P');
		press(fixture.root, 'p');
		expect(lastCalls(fixture, 2)).toEqual(['pinNode:character-alice:true', 'pinNode:character-alice:false']);
		const event = press(fixture.root, 'x');
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('lets the focus go on Escape, and then the keyboard', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const ground = fixture.root.querySelector('.snowflake-method-relationship-graph-canvas')!;
		ground.focus();
		press(fixture.root, 'Tab');
		press(fixture.root, 'Escape');
		expect(fixture.engines[0]!.focused).toBeNull();
		expect(fixture.dom.doc.activeElement).toBe(ground);
		press(fixture.root, 'Escape');
		expect(fixture.dom.doc.activeElement).toBe(fixture.dom.doc.body);
	});

	it('shows the node, line and ground menus where the engine points, every item with an icon', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const { port, scenes } = fixture.engines[0]!;
		const event = {} as MouseEvent;
		port.nodeMenu('character-alice', event);
		expect(menus[menus.length - 1]!.shown).toBe('mouse');
		expect(menuTitles()).toContain('common.open');
		expect(menus[menus.length - 1]!.items.every((item) => item.icon.length > 0)).toBe(true);
		clickItem('actions.edit');
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('character-alice', 'Demo/001_Project_Metadata.md');
		clickItem('common.open');
		expect(fixture.host.openProjectFile).toHaveBeenCalledWith('Demo/20_Character/Alice.md');
		clickItem('relationshipGraph.node.pin');
		expect(fixture.engines[0]!.pinned.has('character-alice')).toBe(true);
		port.edgeMenu(scenes[0]!.picture.edges[0]!, event);
		expect(menuTitles()).toEqual(['relationshipGraph.edge.edit', 'relationshipGraph.edge.open', 'relationshipGraph.edge.open']);
		clickItem('relationshipGraph.edge.edit');
		expect(fixture.host.openRelationship).toHaveBeenCalledExactlyOnceWith(
			{ group: 'character', id: 'character-alice' },
			0,
			'Demo/001_Project_Metadata.md',
		);
		port.backgroundMenu(event);
		expect(menuTitles()).toContain('relationshipGraph.closeControls');
		clickItem('relationshipGraph.closeControls');
		expect(fixture.memory.controlsOpen).toBe(false);
		clickItem('relationshipGraph.pan.up');
		expect(lastCalls(fixture, 1)).toEqual(['panBy:0,50']);
		const built = menus.length;
		port.nodeMenu('nobody', event);
		expect(menus).toHaveLength(built);
	});

	it('draws the local graph around a node from its menu, and the whole graph back', async () => {
		const fixture = mount({ members: family() });
		await settle();
		const engine = fixture.engines[0]!;
		engine.port.nodeMenu('character-alice', {} as MouseEvent);
		clickItem('relationshipGraph.local.show');
		expect(fixture.memory.focus).toBe('character-alice');
		expect(engine.scenes[engine.scenes.length - 1]!.picture.local).toBe(true);
		engine.port.backgroundMenu({} as MouseEvent);
		clickItem('relationshipGraph.local.whole');
		expect(fixture.memory.focus).toBeNull();
		expect(engine.scenes[engine.scenes.length - 1]!.picture.local).toBe(false);
	});

	it("shows the focused node's menu from the keyboard and the toolbar's symbol, and the ground's without one", async () => {
		const fixture = mount({ members: family() });
		await settle();
		press(fixture.root, 'ContextMenu');
		expect(menus[menus.length - 1]!.shown).toBe('position');
		expect(menuTitles()).toContain('relationshipGraph.resetView');
		press(fixture.root, 'Tab');
		press(fixture.root, 'F10', { shift: true });
		expect(menus[menus.length - 1]!.shown).toBe('position');
		expect(menuTitles()).toContain('common.open');
		const before = menus.length;
		press(fixture.root, 'F10');
		expect(menus).toHaveLength(before);
		fixture.button('snowflake-method-relationship-graph-more').dispatch('click');
		expect(menus[menus.length - 1]!.shown).toBe('mouse');
		expect(menuTitles()).toContain('relationshipGraph.node.pin');
	});

	it('zooms from the toolbar, for a touch screen', async () => {
		const fixture = mount({ members: family() });
		await settle();
		fixture.button('snowflake-method-relationship-graph-zoom-in').dispatch('click');
		fixture.button('snowflake-method-relationship-graph-zoom-out').dispatch('click');
		expect(lastCalls(fixture, 2)).toEqual(['zoomBy:1.25', 'zoomBy:0.8']);
		expect(fixture.button('snowflake-method-relationship-graph-more').getAttribute('aria-haspopup')).toBe('menu');
	});
});
