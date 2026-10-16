import { describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import type { OptionFieldConfig } from '../../src/ui/option-picker';

const { viewFields, searches, notices } = vi.hoisted(() => ({
	viewFields: [] as OptionFieldConfig[],
	searches: [] as { inputEl: unknown; type: (value: string) => void }[],
	notices: vi.fn(),
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
	return {
		...runtime,
		Notice: class { constructor(message: string) { notices(message); } },
		getIcon: () => null,
		SearchComponent,
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
}

function fakeEngine(host: CorkboardElement, port: GraphPort): FakeEngine {
	const engine: FakeEngine = {
		host,
		port,
		scenes: [],
		viewports: [],
		calls: [],
		given: [],
		setScene: (scene) => { engine.scenes.push(scene); engine.calls.push('setScene'); },
		setViewport: (view) => { engine.viewports.push(view); engine.calls.push('setViewport'); },
		fit: () => { engine.calls.push('fit'); },
		resetView: () => { engine.calls.push('resetView'); },
		zoomBy: () => { engine.calls.push('zoomBy'); },
		panBy: () => { engine.calls.push('panBy'); },
		focusNode: (id) => { engine.calls.push(`focusNode:${id}`); },
		focusedNode: () => null,
		centreOn: (id) => { engine.calls.push(`centreOn:${id}`); },
		nudgeNode: () => { engine.calls.push('nudgeNode'); },
		pinNode: () => { engine.calls.push('pinNode'); },
		isPinned: () => false,
		places: () => new Map([['character-alice', { x: 10, y: 20, pinned: true }]]),
		setPlaces: (places) => { engine.given.push(places); engine.calls.push('setPlaces'); },
		remeasure: () => { engine.calls.push('remeasure'); },
		dispose: () => { engine.calls.push('dispose'); },
	};
	return engine;
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
	};
	const activateProject = vi.fn();
	const controls = {
		app,
		host,
		t: (key: string) => key,
		model: () => null,
		projectPath: () => 'P',
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

	it('lights what the search finds without narrowing or moving the view', async () => {
		const fixture = mount({ members: family() });
		await settle();
		searches[searches.length - 1]!.type('alice');
		fixture.dom.flushFrame();
		const engine = fixture.engines[0]!;
		expect(engine.scenes).toHaveLength(2);
		const [whole, found] = engine.scenes as [GraphScene, GraphScene];
		expect(found.picture.nodes.map((node) => node.id)).toEqual(whole.picture.nodes.map((node) => node.id));
		expect(found.picture.matches).toEqual(new Set(['character-alice']));
		expect(engine.viewports).toHaveLength(1);
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
		port.nodeClicked('character-alice', { mod: false, shift: false });
		expect(fixture.activateProject).toHaveBeenCalledTimes(1);
		expect(fixture.host.openCharacterForm).toHaveBeenCalledWith('character-alice', projectPath);
		port.nodeClicked('scene-1', { mod: false, shift: false });
		expect(fixture.host.openSceneForm).toHaveBeenCalledWith({ mode: 'edit', id: 'scene-1' }, projectPath);
		port.nodeClicked('entity-1', { mod: false, shift: false });
		expect(fixture.host.openEntityForm).toHaveBeenCalledWith({ mode: 'edit', id: 'entity-1' }, projectPath);
		port.nodeClicked('character-bob', { mod: true, shift: false });
		expect(fixture.host.openProjectFile).toHaveBeenCalledWith('Demo/20_Character/Bob.md');
		port.edgeClicked(fixture.engines[0]!.scenes[0]!.picture.edges[0]!);
		expect(fixture.host.openCharacterForm).toHaveBeenLastCalledWith('character-alice', projectPath);
		port.nodeClicked('nobody', { mod: false, shift: false });
		expect(fixture.host.openCharacterForm).toHaveBeenCalledTimes(2);
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
