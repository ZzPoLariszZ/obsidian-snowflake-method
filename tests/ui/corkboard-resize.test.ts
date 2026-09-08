import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	return {
		...runtime,
		FuzzySuggestModal: class extends runtime.Modal {},
		SuggestModal: class extends runtime.Modal {},
		SearchComponent: class {
			readonly input: CorkboardElement;
			constructor(container: CorkboardElement) {
				this.input = container.createDiv({ cls: 'search-input-container' }).createEl('input');
			}
			setPlaceholder(): this { return this; }
			setValue(value: string): this { this.input.value = value; return this; }
			onChange(callback: (value: string) => void): this {
				this.input.addEventListener('input', () => { callback(this.input.value); });
				return this;
			}
		},
	};
});
vi.mock('../../src/ui/corkboard-layout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/corkboard-layout')>();
	return { ...actual, displayOrder: vi.fn(actual.displayOrder), buildLayout: vi.fn(actual.buildLayout) };
});
vi.mock('../../src/ui/scene-filters', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/scene-filters')>();
	return { ...actual, filterScenes: vi.fn(actual.filterScenes) };
});

import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls } from '../../src/ui/corkboard-bridge';
import { buildLayout, displayOrder } from '../../src/ui/corkboard-layout';
import { filterScenes } from '../../src/ui/scene-filters';
import { corkboardMemory, type CorkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

const CARD = '.snowflake-method-corkboard-card';
const NUMBER = '.snowflake-method-corkboard-number';
const TITLE = '.snowflake-method-corkboard-title';

function board(settings: Partial<CorkboardMemory> = {}) {
	const dom = new CorkboardDom();
	const memory = Object.assign(corkboardMemory(), settings);
	const scenes: SceneViewModel[] = Array.from({ length: 3_000 }, (_, index) => ({
		id: `scene-${String(index)}`, path: `Scenes/${String(index)}.md`,
		title: `Scene ${String(index)}`, rank: index, progressStatus: 'in-progress',
		aliases: [], categoryPaths: memory.group === 'category' ? ['Arc/A', 'Arc/B'] : [],
		povPath: '', povName: '', povMissing: false,
		times: [], locations: [], characterPaths: [], conflict: 'An obstacle', color: null,
		linkedManuscript: [], worldStatus: [], relationships: [], events: '',
		customFields: '', revision: 'revision', readOnly: false, healthIssues: [],
	}));
	let model = {
		path: 'Pressure/Pressure.md', projectId: 'pressure', locale: 'en',
		scenes, characters: [], manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
		host: { patchScene: vi.fn(() => Promise.resolve('saved')) },
		t: (key: string) => key,
		model: () => model,
		activateProject: vi.fn(),
		refresh: vi.fn(() => Promise.resolve()),
		popover: { closeFilter: vi.fn() },
		memory,
		remember: vi.fn(),
	} as unknown as CorkboardControls;
	const handle = renderCorkboard(dom.container as unknown as HTMLElement, controls);
	const root = dom.container.children[0]!;
	const canvas = root.querySelector('.snowflake-method-corkboard-canvas')!;
	const scroller = root.querySelector('.snowflake-method-corkboard-scroll')!;
	return {
		dom, root, canvas, scroller, handle, memory, controls,
		cards: () => canvas.querySelectorAll(CARD),
		scroll: (top: number) => {
			scroller.scrollTop = top;
			scroller.dispatch('scroll');
			dom.flushFrame();
		},
		replaceTitle: (title: string) => {
			model = { ...model, scenes: model.scenes.map((scene, index) => index === 0 ? { ...scene, title } : scene) };
			handle.refresh();
		},
	};
}

beforeEach(() => { vi.clearAllMocks(); });

describe('corkboard viewport changes', () => {
	it('coalesces sidebar resize notifications and view remeasure calls into one frame', () => {
		const fixture = board();
		const firstNumber = fixture.cards()[0]!.querySelector(NUMBER)!;
		const writes = firstNumber.textWrites;
		const reads = fixture.dom.geometryReads;
		const layouts = vi.mocked(buildLayout).mock.calls.length;

		fixture.dom.resize(970);
		fixture.handle.remeasure();
		fixture.dom.resize(930);
		fixture.handle.remeasure();

		expect(fixture.dom.geometryReads).toBe(reads);
		expect(fixture.dom.frames.size).toBe(1);
		fixture.dom.flushFrame();
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(displayOrder)).toHaveBeenCalledTimes(1);
		// Three columns still fit. Their width changes without rebuilding
		// the rows for all 3,000 scenes or rewriting mounted card contents.
		expect(vi.mocked(buildLayout)).toHaveBeenCalledTimes(layouts);
		expect(firstNumber.textWrites).toBe(writes);
		expect(fixture.cards()[0]!.styles.width).toBe('283.33px');
		expect(fixture.cards().length).toBeLessThan(30);
		fixture.handle.dispose();
	});

	it('reads viewport geometry before changing card widths without invalidating inherited styles', () => {
		const fixture = board();
		fixture.dom.operations.length = 0;
		fixture.dom.resize(930);
		fixture.dom.flushFrame();

		const operations = fixture.dom.operations;
		const firstWrite = operations.findIndex((operation) => operation.kind === 'style');
		expect(firstWrite).toBeGreaterThan(0);
		expect(operations.slice(0, firstWrite).some((operation) => operation.property === 'clientWidth')).toBe(true);
		// Reading or setting scrollTop, or reading clientHeight, after CSS
		// writes forces synchronous layout of the resized card subtree.
		expect(operations.slice(firstWrite).filter((operation) => operation.kind !== 'style')).toEqual([]);
		expect(operations.filter((operation) => operation.kind === 'style').every((operation) => operation.target.matches(CARD))).toBe(true);
		expect(fixture.root.styles['--snowflake-method-corkboard-card-width']).toBeUndefined();
		fixture.handle.dispose();
	});

	it('scrolls the existing virtual window without rewriting retained cards', () => {
		const fixture = board();
		const card = fixture.cards()[3]!;
		const number = card.querySelector(NUMBER)!;
		const writes = number.textWrites;
		fixture.scroll(20);
		fixture.scroll(40);

		expect(fixture.cards()).toContain(card);
		expect(number.textWrites).toBe(writes);
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(displayOrder)).toHaveBeenCalledTimes(1);
		fixture.handle.dispose();
	});

	it('keeps the same scene and offset within its row when a sidebar changes the column count', () => {
		const fixture = board();
		// Three columns, 280px rows: scene 30 is 47px above the viewport.
		fixture.scroll(2_847);
		const anchored = fixture.cards().find((card) => card.dataset.id === 'scene-30')!;
		expect(anchored.styles.transform).toBe('translate(0px, 2800px)');

		fixture.dom.operations.length = 0;
		fixture.dom.resize(700);
		fixture.dom.flushFrame();
		const operations = [...fixture.dom.operations];
		const firstWrite = operations.findIndex((operation) => operation.kind === 'style');
		expect(operations.slice(firstWrite).some((operation) => operation.kind === 'read')).toBe(false);
		expect(operations[operations.length - 1]).toEqual({ kind: 'scroll', target: fixture.scroller, property: 'scrollTop' });

		// Two columns put scene 30 on row 15; retain the 47px offset.
		expect(fixture.scroller.scrollTop).toBe(4_247);
		expect(fixture.memory.scrollTop).toBe(4_247);
		expect(fixture.cards()).toContain(anchored);
		expect(anchored.styles.transform).toBe('translate(0px, 4200px)');
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(displayOrder)).toHaveBeenCalledTimes(1);
		fixture.handle.dispose();
	});

	it('keeps a focused unfinished title mounted across scrolling and sidebar animation', () => {
		const fixture = board();
		const card = fixture.cards()[0]!;
		card.querySelector(TITLE)!.dispatch('click');
		const input = card.querySelector('.snowflake-method-corkboard-title-input')!;
		input.value = 'Unfinished scene title';
		fixture.scroll(28_000);
		fixture.dom.resize(700);
		fixture.dom.flushFrame();

		expect(fixture.cards()).toContain(card);
		expect(fixture.dom.doc.activeElement).toBe(input);
		expect(input.value).toBe('Unfinished scene title');
		expect(input.classes.has('is-hidden')).toBe(false);
		expect(fixture.controls.host.patchScene).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it('retains the specific group copy when a scene belongs to multiple categories', () => {
		const fixture = board({ group: 'category' });
		// Each category has all 3,000 scenes: read scene 30 in the second
		// group, 47px into its row, rather than its earlier copy in Arc/A.
		fixture.scroll(282_919);
		const anchored = fixture.cards().find((card) => card.dataset.key === 'category:Arc/B|scene-30')!;
		expect(anchored).toBeDefined();
		fixture.dom.resize(700);
		fixture.dom.flushFrame();

		expect(fixture.scroller.scrollTop).toBe(424_319);
		expect(fixture.cards()).toContain(anchored);
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(1);
		fixture.handle.dispose();
	});

	it('settles compact themed height during resize without repeating scene analysis', () => {
		const fixture = board({ mode: 'compact' });
		for (let frame = 0; frame < 3 && fixture.dom.frames.size > 0; frame++) fixture.dom.flushFrame();
		expect(fixture.root.styles['--snowflake-method-corkboard-card-height']).toBe('76px');
		expect(fixture.dom.frames.size).toBe(0);
		const filtering = vi.mocked(filterScenes).mock.calls.length;
		const ordering = vi.mocked(displayOrder).mock.calls.length;
		fixture.dom.resize(700);
		for (let frame = 0; frame < 3 && fixture.dom.frames.size > 0; frame++) fixture.dom.flushFrame();
		expect(fixture.dom.frames.size).toBe(0);
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(filtering);
		expect(vi.mocked(displayOrder)).toHaveBeenCalledTimes(ordering);
		fixture.handle.dispose();
	});

	it('defers hidden geometry and cancels queued work when the tab closes', () => {
		const fixture = board();
		fixture.scroll(607);
		const height = fixture.canvas.styles.height;
		const writes = fixture.canvas.styleWrites;
		fixture.dom.resize(0, 0);
		fixture.dom.flushFrame();

		expect(fixture.canvas.styles.height).toBe(height);
		expect(fixture.canvas.styleWrites).toBe(writes);
		expect(fixture.memory.scrollTop).toBe(607);
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(1);
		fixture.dom.resize(700, 600);
		expect(fixture.dom.frames.size).toBe(1);
		fixture.handle.dispose();
		expect(fixture.dom.frames.size).toBe(0);
		expect(fixture.dom.observers.every((observer) => observer.disconnected)).toBe(true);
		fixture.dom.flushFrame();
		expect(fixture.canvas.styleWrites).toBe(writes);
	});

	it('still refreshes scene contents and order after an authored change or search', () => {
		const fixture = board();
		const title = fixture.cards()[0]!.querySelector(TITLE)!;
		fixture.replaceTitle('The revised opening');
		expect(title.textContent).toBe('The revised opening');
		const search = fixture.root.querySelector('input')!;
		search.value = 'revised opening';
		search.dispatch('input');
		fixture.dom.flushFrame();

		expect(fixture.cards()).toHaveLength(1);
		expect(fixture.cards()[0]!.dataset.id).toBe('scene-0');
		expect(vi.mocked(filterScenes)).toHaveBeenCalledTimes(3);
		expect(vi.mocked(displayOrder)).toHaveBeenCalledTimes(3);
		fixture.handle.dispose();
	});
});
