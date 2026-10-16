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

import { defaultRelationshipGraphDocument, rememberSceneManuscriptOptions } from '../../src/domain';
import { buildSceneManuscriptPreset, SCENE_MANUSCRIPT_FALLBACK_COLORS } from '../../src/ui/native-graph';
import { renderRelationshipGraph } from '../../src/ui/relationship-graph';
import type {
	RelationshipGraphControls,
	RelationshipGraphReading,
} from '../../src/ui/relationship-graph-bridge';
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
}

function mount(options: MountOptions = {}) {
	const dom = new CorkboardDom();
	const memory = relationshipGraphMemory({ view: options.view ?? 'entities', controlsOpen: options.controlsOpen ?? true });
	const listeners = new Set<() => void>();
	const empty = defaultRelationshipGraphDocument();
	const reading: RelationshipGraphReading = {
		projectPath: 'Demo/001_Project_Metadata.md',
		rootPath: 'Demo',
		locale: 'en',
		held: options.stored
			? rememberSceneManuscriptOptions(
					empty,
					buildSceneManuscriptPreset({ rootPath: 'Demo', locale: 'en' }, SCENE_MANUSCRIPT_FALLBACK_COLORS),
					'Demo',
					1,
				)!
			: empty,
		members: [],
		kinds: [],
		resolveTarget: () => null,
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
	const controls = {
		app: {},
		host: {},
		t: (key: string) => key,
		model: () => null,
		projectPath: () => 'P',
		activateProject: vi.fn(),
		refresh,
		bridge: () => bridge,
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
		memory,
		remember,
		refresh,
		listeners,
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
