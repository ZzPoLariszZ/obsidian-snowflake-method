import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, CorkboardElement } from '../helpers/corkboard-dom';

const { icons, tooltips, knownIcons, deckDeps, deckBeginPaint } = vi.hoisted(() => ({
	icons: [] as { el: unknown; icon: string }[],
	tooltips: [] as { el: unknown; text: string }[],
	knownIcons: new Set<string>(),
	deckDeps: [] as unknown[],
	deckBeginPaint: { calls: 0 },
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		onClose(): void {}
	}
	return {
		...runtime,
		Modal,
		getIcon: (name: string) => (knownIcons.has(name) ? {} : null),
		setIcon: (el: unknown, icon: string): void => { icons.push({ el, icon }); },
		setTooltip: (el: unknown, text: string): void => { tooltips.push({ el, text }); },
	};
});

// The deck is the real one everywhere else; here what it is handed is kept, so a test can ask it as a card would.
vi.mock('../../src/ui/scene-card', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/scene-card')>();
	return {
		...actual,
		createSceneCardDeck: vi.fn((deps: unknown) => {
			deckDeps.push(deps);
			return { beginPaint: () => { deckBeginPaint.calls++; } };
		}),
	};
});

import { Modal, type App } from 'obsidian';

import type { CorkboardControls, CorkboardVariant } from '../../src/ui/corkboard-bridge';
import type { SceneCard, SceneCardDeps } from '../../src/ui/scene-card';
import { corkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';
import {
	NARROW_MAX_REM,
	SCROLL_ROOM_MIN,
	bindFrameWindow,
	createFocusCustody,
	createFolds,
	createFrame,
	createLaneDeck,
	createModalKeeper,
	createScenePool,
	createStandInScrollbars,
	paintSymbol,
	toolbarIconButton,
	watchFrameSize,
	type Fold,
	type FrameControls,
	type FrameMemory,
	type SymbolMemo,
} from '../../src/ui/workspace-frame';

const t = (key: string): string => key;
const el = (element: CorkboardElement): HTMLElement => element as unknown as HTMLElement;
const button = (element: CorkboardElement): HTMLButtonElement => element as unknown as HTMLButtonElement;

/** Fires an element's own listeners with the properties an event carries. */
function fire(element: CorkboardElement, type: string, properties: Record<string, unknown>): void {
	for (const listener of element.listeners.get(type) ?? []) {
		listener({ target: element, preventDefault: () => undefined, stopPropagation: () => undefined, ...properties });
	}
}

const scene = (id: string): SceneViewModel => ({ id, path: `Scenes/${id}.md`, title: id }) as unknown as SceneViewModel;

const modelOf = (ids: string[]): ProjectDashboardModel => ({
	path: 'P',
	readOnly: false,
	scenes: ids.map(scene),
	manuscriptPaths: ['Draft/One.md', 'Draft/Two.md'],
	characters: [{ id: 'character-alice', name: 'Alice', path: 'Cast/Alice.md' }],
}) as unknown as ProjectDashboardModel;

/** The controls a workspace was handed, with every word of them a test may change after the render. */
function controlsOf() {
	const state = { projectPath: 'P' as string | null, unloading: false };
	const resolved = vi.fn((target: string, _source: string) => ({ path: `Draft/${target}.md` }));
	const poolHandle = { refresh: vi.fn(), reveal: vi.fn(), remeasure: vi.fn(), saveFocusedConflict: vi.fn(() => true), dispose: vi.fn() };
	const corkboard = vi.fn((_host: HTMLElement, _controls: CorkboardControls, _variant?: CorkboardVariant) => poolHandle);
	const memory: FrameMemory = { pool: corkboardMemory({ mode: 'compact', group: '', reversed: false }), poolCollapsed: false, scroll: { left: 0, top: 0 } };
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: resolved } } as unknown as App,
		host: {} as FrameControls['host'],
		t,
		projectPath: () => state.projectPath,
		activateProject: vi.fn(),
		refresh: vi.fn(() => Promise.resolve()),
		popover: { closeFilter: vi.fn(), filterOpen: () => false, openFilter: vi.fn() },
		memory,
		remember: vi.fn(),
		unloading: () => state.unloading,
		corkboard,
	} satisfies FrameControls;
	return { controls, state, resolved, poolHandle, corkboard };
}

beforeEach(() => {
	icons.length = 0;
	tooltips.length = 0;
	knownIcons.clear();
	deckDeps.length = 0;
	deckBeginPaint.calls = 0;
});

describe('the toolbar\'s symbols', () => {
	it('makes a symbol button in the toolbar, named for a screen reader and under the pointer', () => {
		const dom = new CorkboardDom();
		const toolbar = dom.container.createDiv();
		const made = toolbarIconButton(el(toolbar), 'snowflake-method-timeline-words', 'eye', 'Hide') as unknown as CorkboardElement;
		expect(toolbar.children).toEqual([made]);
		expect(made.tag).toBe('button');
		expect([...made.classes]).toEqual(['clickable-icon', 'snowflake-method-timeline-words']);
		expect(made.getAttribute('type')).toBe('button');
		expect(made.getAttribute('aria-label')).toBe('Hide');
		expect(icons).toEqual([{ el: made, icon: 'eye' }]);
		expect(tooltips).toEqual([{ el: made, text: 'Hide' }]);
	});

	it('draws the icon again only when it is another, and remembers the one it drew', () => {
		const dom = new CorkboardDom();
		const made = dom.container.createEl('button', { attr: { 'aria-label': 'Hide' } });
		const memo: SymbolMemo = { icon: 'eye' };
		paintSymbol(button(made), memo, { icon: 'eye', label: 'Hide', disabled: false });
		expect(icons).toEqual([]);
		paintSymbol(button(made), memo, { icon: 'eye-off', label: 'Hide', disabled: false });
		expect(icons).toEqual([{ el: made, icon: 'eye-off' }]);
		expect(memo.icon).toBe('eye-off');
		paintSymbol(button(made), memo, { icon: 'eye-off', label: 'Hide', disabled: false });
		expect(icons).toHaveLength(1);
	});

	it('names the button again only when the name is another, so a paint takes no tooltip from under the pointer', () => {
		const dom = new CorkboardDom();
		const made = dom.container.createEl('button', { attr: { 'aria-label': 'Hide' } });
		const memo: SymbolMemo = { icon: 'eye' };
		const written = made.attributeWrites;
		paintSymbol(button(made), memo, { icon: 'eye', label: 'Hide', disabled: false });
		expect(made.attributeWrites).toBe(written);
		expect(tooltips).toEqual([]);
		paintSymbol(button(made), memo, { icon: 'eye', label: 'Show', disabled: false });
		expect(made.getAttribute('aria-label')).toBe('Show');
		expect(tooltips).toEqual([{ el: made, text: 'Show' }]);
	});

	it('says which way a switch stands, leaves a symbol that is none unpressed, and shuts either as told', () => {
		const dom = new CorkboardDom();
		const made = dom.container.createEl('button');
		const memo: SymbolMemo = { icon: 'eye' };
		paintSymbol(button(made), memo, { icon: 'eye', label: 'Hide', disabled: true });
		expect(made.getAttribute('aria-pressed')).toBeNull();
		expect(made.disabled).toBe(true);
		paintSymbol(button(made), memo, { icon: 'eye', label: 'Hide', pressed: true, disabled: false });
		expect(made.getAttribute('aria-pressed')).toBe('true');
		expect(made.disabled).toBe(false);
		paintSymbol(button(made), memo, { icon: 'eye', label: 'Hide', pressed: false, disabled: false });
		expect(made.getAttribute('aria-pressed')).toBe('false');
	});
});

/** The folds over a memory of their own, with every word they say to the workspace counted. */
function foldsOf(start: Partial<Record<Fold, boolean>> = {}) {
	const dom = new CorkboardDom();
	const root = dom.container.createDiv();
	const toolbar = root.createDiv({ cls: 'toolbar' });
	const pool = dom.container.createDiv();
	const memory: Record<Fold, boolean> = { column: false, pool: false, ...start };
	const remember = vi.fn();
	const invalidateRects = vi.fn();
	const remeasurePool = vi.fn();
	const fitScrollbars = vi.fn();
	const folds = createFolds({
		root: el(root),
		t,
		labels: {
			column: { collapse: 'column.collapse', expand: 'column.expand' },
			pool: { collapse: 'pool.collapse', expand: 'pool.expand' },
		},
		collapsed: (part) => memory[part],
		setCollapsed: (part, collapsed) => { memory[part] = collapsed; },
		remember,
		pool: () => el(pool),
		invalidateRects,
		remeasurePool,
		fitScrollbars,
	});
	const toggle = (part: Fold): CorkboardElement =>
		root.querySelector(part === 'column' ? '.snowflake-method-timeline-time-toggle' : '.snowflake-method-timeline-pool-toggle')!;
	/** The workspace at a width, measured as its observer would have it measured. */
	const widen = (width: number): void => {
		dom.width = width;
		folds.measureNarrow();
	};
	return { dom, root, toolbar, pool, memory, folds, toggle, widen, remember, invalidateRects, remeasurePool, fitScrollbars };
}

describe('the folds', () => {
	it('stands its toggles in the frame\'s corners as the root\'s next children, the column\'s first', () => {
		const fixture = foldsOf();
		expect(fixture.root.children.map((child) => [...child.classes])).toEqual([
			['toolbar'],
			['snowflake-method-timeline-fold', 'is-start'],
			['snowflake-method-timeline-fold', 'is-end'],
		]);
		expect(fixture.toggle('column').parent).toBe(fixture.root.children[1]);
		expect(fixture.toggle('pool').parent).toBe(fixture.root.children[2]);
		expect(fixture.toggle('column').classes.has('clickable-icon')).toBe(true);
		expect(fixture.toggle('column').getAttribute('type')).toBe('button');
		// Where the app has no sidebar symbol of its own to lend, each toggle wears a panel's.
		expect(icons.map((drawn) => drawn.icon)).toEqual(['panel-left', 'panel-right']);
	});

	it('wears the app\'s own sidebar symbol where the app has one', () => {
		knownIcons.add('sidebar-toggle-button-icon');
		foldsOf();
		expect(icons.map((drawn) => drawn.icon)).toEqual(['sidebar-toggle-button-icon', 'sidebar-toggle-button-icon']);
	});

	it('paints each fold as the tab remembers it, asked afresh, and names a toggle again only when its name moved', () => {
		const fixture = foldsOf({ pool: true });
		fixture.folds.paint();
		expect(fixture.toggle('column').getAttribute('aria-label')).toBe('column.collapse');
		expect(fixture.toggle('column').getAttribute('aria-expanded')).toBe('true');
		expect(fixture.toggle('pool').getAttribute('aria-label')).toBe('pool.expand');
		expect(fixture.toggle('pool').getAttribute('aria-expanded')).toBe('false');
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(false);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(true);
		expect(fixture.pool.classes.has('is-hidden')).toBe(true);
		const named = tooltips.length;
		fixture.folds.paint();
		expect(tooltips).toHaveLength(named);
		// A restored state hands the fold to the memory; the next paint wears it.
		fixture.memory.column = true;
		fixture.memory.pool = false;
		fixture.folds.paint();
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
		expect(fixture.pool.classes.has('is-hidden')).toBe(false);
	});

	it('folds a part from its toggle, remembers it, and measures again for the room that moved', () => {
		const fixture = foldsOf();
		fixture.folds.paint();
		fixture.toggle('pool').dispatch('click');
		expect(fixture.memory.pool).toBe(true);
		expect(fixture.folds.folded('pool')).toBe(true);
		expect(fixture.pool.classes.has('is-hidden')).toBe(true);
		expect(fixture.remember).toHaveBeenCalledOnce();
		expect(fixture.invalidateRects).toHaveBeenCalledOnce();
		// The pool's own room moved, so the pool lays its cards out again; the bars are the column's to move.
		expect(fixture.remeasurePool).toHaveBeenCalledOnce();
		expect(fixture.fitScrollbars).not.toHaveBeenCalled();
		fixture.toggle('column').dispatch('click');
		expect(fixture.memory.column).toBe(true);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.fitScrollbars).toHaveBeenCalledOnce();
		expect(fixture.remeasurePool).toHaveBeenCalledOnce();
		expect(fixture.remember).toHaveBeenCalledTimes(2);
	});

	it('does nothing for a fold that already stands the way asked', () => {
		const fixture = foldsOf({ pool: true });
		fixture.folds.fold('pool', true);
		fixture.folds.fold('column', false);
		expect(fixture.remember).not.toHaveBeenCalled();
		expect(fixture.invalidateRects).not.toHaveBeenCalled();
		expect(tooltips).toEqual([]);
	});

	it('is narrow under the line and not on it, measured in the rem the window has', () => {
		const fixture = foldsOf();
		// The fake window says 16px to a rem.
		const line = NARROW_MAX_REM * 16;
		fixture.widen(line);
		expect(fixture.folds.folded('column')).toBe(false);
		expect(fixture.invalidateRects).not.toHaveBeenCalled();
		fixture.widen(line - 1);
		expect(fixture.folds.folded('column')).toBe(true);
		expect(fixture.folds.folded('pool')).toBe(true);
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(true);
		expect(fixture.pool.classes.has('is-hidden')).toBe(true);
		expect(fixture.invalidateRects).toHaveBeenCalledOnce();
		expect(fixture.remeasurePool).toHaveBeenCalledOnce();
		// Nothing was chosen: the tab's memory is untouched and nothing is saved.
		expect(fixture.memory).toEqual({ column: false, pool: false });
		expect(fixture.remember).not.toHaveBeenCalled();
		// The same side of the line again says nothing again.
		fixture.widen(line - 200);
		expect(fixture.invalidateRects).toHaveBeenCalledOnce();
	});

	it('takes a rem it cannot read for sixteen pixels, and a workspace with no width for no measure at all', () => {
		const fixture = foldsOf();
		fixture.dom.win.getComputedStyle = () => ({ fontSize: '', borderTopWidth: '', borderBottomWidth: '', columnGap: '' });
		fixture.widen(NARROW_MAX_REM * 16 - 1);
		expect(fixture.folds.folded('pool')).toBe(true);
		// A hidden tab measures nothing, which is not a narrow workspace widening.
		fixture.widen(0);
		expect(fixture.folds.folded('pool')).toBe(true);
		expect(fixture.invalidateRects).toHaveBeenCalledOnce();
	});

	it('lets a part brought back by hand while narrow stand until the workspace widens, and no longer', () => {
		const fixture = foldsOf();
		fixture.widen(1200);
		fixture.toggle('pool').dispatch('click');
		expect(fixture.folds.folded('pool')).toBe(false);
		expect(fixture.folds.folded('column')).toBe(true);
		expect(fixture.memory.pool).toBe(false);
		// Narrower still is narrow still, and the part stands.
		fixture.widen(1100);
		expect(fixture.folds.folded('pool')).toBe(false);
		fixture.widen(1600);
		expect(fixture.folds.folded('pool')).toBe(false);
		expect(fixture.folds.folded('column')).toBe(false);
		// Wide again forgot what was opened, so the next narrowing folds both.
		fixture.widen(1200);
		expect(fixture.folds.folded('pool')).toBe(true);
	});

	it('forgets a part brought back by hand once it is folded by hand again, and keeps that fold whatever the width', () => {
		const fixture = foldsOf();
		fixture.widen(1200);
		fixture.folds.fold('pool', false);
		fixture.folds.fold('pool', true);
		expect(fixture.memory.pool).toBe(true);
		fixture.memory.pool = false;
		// Were it still counted as opened, the memory's word alone would bring it back while narrow.
		expect(fixture.folds.folded('pool')).toBe(true);
		fixture.memory.column = true;
		fixture.widen(1600);
		expect(fixture.folds.folded('column')).toBe(true);
		expect(fixture.folds.folded('pool')).toBe(false);
	});
});

describe('watching the frame\'s size', () => {
	it('says when a box moved, until it is told to stop', () => {
		const dom = new CorkboardDom();
		const root = dom.container.createDiv();
		const resized = vi.fn();
		const stop = watchFrameSize(el(root), [el(root), el(root.createDiv())], resized);
		expect(dom.observers).toHaveLength(1);
		dom.resize(900);
		expect(resized).toHaveBeenCalledOnce();
		stop();
		expect(dom.observers[0]!.disconnected).toBe(true);
		dom.resize(800);
		expect(resized).toHaveBeenCalledOnce();
	});
});

/** A field with a scroller in it, the stand-in bars made after, and every write to a scroll place counted. */
function scrollbarsOf() {
	const dom = new CorkboardDom();
	const field = dom.container.createDiv();
	const scroller = field.createDiv({ cls: 'scroller' });
	const content = scroller.createDiv();
	const scrolled = vi.fn();
	const scrollbars = createStandInScrollbars({ field: el(field), scroller: el(scroller), scrolled });
	const across = field.querySelector('.snowflake-method-timeline-scrollbar.is-across')!;
	const down = field.querySelector('.snowflake-method-timeline-scrollbar.is-down')!;
	/** Counts the writes to an element's place across, which the fake keeps as a plain field. */
	const countLeftWrites = (element: CorkboardElement): { writes: number } => {
		const counted = { writes: 0 };
		let left = element.scrollLeft;
		Object.defineProperty(element, 'scrollLeft', {
			get: () => left,
			set: (next: number) => { counted.writes++; left = next; },
		});
		return counted;
	};
	const topWrites = (element: CorkboardElement): number =>
		dom.operations.filter((operation) => operation.kind === 'scroll' && operation.target === element).length;
	/** Makes the scroller's content taller than the window by this much. */
	const overflowDown = (by: number): void => { content.setCssStyles({ height: `${String(dom.height + by - 16)}px` }); };
	return { dom, field, scroller, across, down, scrolled, scrollbars, countLeftWrites, topWrites, overflowDown };
}

describe('the stand-in scrollbars', () => {
	it('makes the two bars in the field after the scroller, hidden from a screen reader, each with its spacer', () => {
		const fixture = scrollbarsOf();
		expect(fixture.field.children).toEqual([fixture.scroller, fixture.across, fixture.down]);
		for (const bar of [fixture.across, fixture.down]) {
			expect(bar.getAttribute('aria-hidden')).toBe('true');
			expect(bar.classes.has('is-hidden')).toBe(true);
			expect(bar.children.map((child) => [...child.classes])).toEqual([['snowflake-method-timeline-scrollbar-space']]);
		}
	});

	it('keeps the bars in step with the scroller and says where it stands', () => {
		const fixture = scrollbarsOf();
		fixture.scroller.scrollLeft = 120;
		fixture.scroller.scrollTop = 40;
		fixture.scroller.dispatch('scroll');
		expect(fixture.across.scrollLeft).toBe(120);
		expect(fixture.down.scrollTop).toBe(40);
		expect(fixture.scrolled).toHaveBeenCalledWith({ left: 120, top: 40 });
	});

	it('keeps the scroller in step with each bar', () => {
		const fixture = scrollbarsOf();
		fixture.across.scrollLeft = 60;
		fixture.across.dispatch('scroll');
		expect(fixture.scroller.scrollLeft).toBe(60);
		fixture.down.scrollTop = 10;
		fixture.down.dispatch('scroll');
		expect(fixture.scroller.scrollTop).toBe(10);
		// A bar's own move is not the scroller's, so nothing is said for it.
		expect(fixture.scrolled).not.toHaveBeenCalled();
	});

	it('writes no place that already stands, so the three never answer each other in a ring', () => {
		const fixture = scrollbarsOf();
		fixture.scroller.scrollLeft = 120;
		fixture.scroller.scrollTop = 40;
		fixture.scroller.dispatch('scroll');
		const acrossLeft = fixture.countLeftWrites(fixture.across);
		const scrollerLeft = fixture.countLeftWrites(fixture.scroller);
		const downTop = fixture.topWrites(fixture.down);
		const scrollerTop = fixture.topWrites(fixture.scroller);
		// Each echo of the move just made finds the others where it would put them.
		fixture.scroller.dispatch('scroll');
		fixture.across.dispatch('scroll');
		fixture.down.dispatch('scroll');
		expect(acrossLeft.writes).toBe(0);
		expect(scrollerLeft.writes).toBe(0);
		expect(fixture.topWrites(fixture.down)).toBe(downTop);
		expect(fixture.topWrites(fixture.scroller)).toBe(scrollerTop);
	});

	it('moves the whole scroller for a wheel over a bar, both ways', () => {
		const fixture = scrollbarsOf();
		const scrollBy = vi.fn();
		(fixture.scroller as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
		const preventDefault = vi.fn();
		fire(fixture.across, 'wheel', { deltaX: 12, deltaY: 30, preventDefault });
		fire(fixture.down, 'wheel', { deltaX: 0, deltaY: -8, preventDefault });
		expect(scrollBy.mock.calls).toEqual([[{ left: 12, top: 30 }], [{ left: 0, top: -8 }]]);
		expect(preventDefault).toHaveBeenCalledTimes(2);
	});

	it('shows neither bar while nothing overflows', () => {
		const fixture = scrollbarsOf();
		fixture.scrollbars.fit(200, 40);
		expect(fixture.across.classes.has('is-hidden')).toBe(true);
		expect(fixture.down.classes.has('is-hidden')).toBe(true);
		expect(fixture.across.classes.has('is-short')).toBe(false);
	});

	it('starts the bar across past the columns that keep their place, as long as its overflow', () => {
		const fixture = scrollbarsOf();
		fixture.dom.scrollWidth = 1500;
		fixture.scroller.scrollLeft = 75;
		fixture.scrollbars.fit(328);
		expect(fixture.across.classes.has('is-hidden')).toBe(false);
		expect(fixture.across.styles.insetInlineStart).toBe('328px');
		// The overflow, and the bar's own length for the spacer to reach past.
		expect(fixture.across.children[0]!.styles.width).toBe('1500px');
		expect(fixture.across.scrollLeft).toBe(75);
		expect(fixture.down.classes.has('is-hidden')).toBe(true);
		expect(fixture.across.classes.has('is-short')).toBe(false);
	});

	it('goes without the bar across where the field leaves it less than a thumb\'s room', () => {
		const fixture = scrollbarsOf();
		fixture.dom.scrollWidth = 1500;
		fixture.scrollbars.fit(fixture.dom.width - SCROLL_ROOM_MIN);
		expect(fixture.across.classes.has('is-hidden')).toBe(false);
		fixture.scrollbars.fit(fixture.dom.width - SCROLL_ROOM_MIN + 1);
		expect(fixture.across.classes.has('is-hidden')).toBe(true);
	});

	it('starts the bar down under the head, and at the field\'s top where the table has none', () => {
		const fixture = scrollbarsOf();
		fixture.overflowDown(300);
		fixture.scroller.scrollTop = 25;
		fixture.scrollbars.fit(0, 44);
		expect(fixture.down.classes.has('is-hidden')).toBe(false);
		expect(fixture.down.styles.insetBlockStart).toBe('44px');
		expect(fixture.down.children[0]!.styles.height).toBe(`${String(300 + fixture.dom.height)}px`);
		expect(fixture.down.scrollTop).toBe(25);
		fixture.scrollbars.fit(0);
		expect(fixture.down.styles.insetBlockStart).toBe('0px');
	});

	it('shows no bar down beside a head as tall as the scroller, and shows one where the table has no head to ask about', () => {
		const fixture = scrollbarsOf();
		fixture.overflowDown(300);
		fixture.scrollbars.fit(0, fixture.dom.height);
		expect(fixture.down.classes.has('is-hidden')).toBe(true);
		fixture.scrollbars.fit(0);
		expect(fixture.down.classes.has('is-hidden')).toBe(false);
	});

	it('stops each bar short of the other at the corner when both are shown', () => {
		const fixture = scrollbarsOf();
		fixture.dom.scrollWidth = 1500;
		fixture.overflowDown(300);
		fixture.scrollbars.fit(200, 40);
		expect(fixture.across.classes.has('is-short')).toBe(true);
		expect(fixture.down.classes.has('is-short')).toBe(true);
	});
});

describe('the window the frame listens to', () => {
	const deckOf = () => ({ releasePress: vi.fn(), closeColorPanel: vi.fn() });

	it('drops what was measured as the window scrolls or is resized, and hears a press released anywhere', () => {
		const dom = new CorkboardDom();
		const root = dom.container.createDiv();
		const deck = deckOf();
		const invalidateRects = vi.fn();
		bindFrameWindow({ root: el(root), deck, invalidateRects });
		expect(dom.windowListeners.get('scroll')!.map((entry) => entry.capture)).toEqual([true]);
		expect(dom.windowListeners.get('resize')!.map((entry) => entry.capture)).toEqual([false]);
		expect(dom.windowListeners.get('mouseup')!.map((entry) => entry.capture)).toEqual([true]);
		dom.dispatchWindow('scroll');
		dom.dispatchWindow('resize');
		expect(invalidateRects).toHaveBeenCalledTimes(2);
		dom.dispatchWindow('mouseup');
		expect(deck.releasePress).toHaveBeenCalledOnce();
	});

	it('lets the window go when released', () => {
		const dom = new CorkboardDom();
		const root = dom.container.createDiv();
		const invalidateRects = vi.fn();
		const release = bindFrameWindow({ root: el(root), deck: deckOf(), invalidateRects });
		release();
		for (const type of ['scroll', 'resize', 'mouseup']) expect(dom.windowListeners.get(type)).toEqual([]);
		expect(root.windowMigrationListeners.size).toBe(0);
		dom.dispatchWindow('scroll');
		expect(invalidateRects).not.toHaveBeenCalled();
	});

	it('follows the view to another window, closing what hung in the one it left', () => {
		const dom = new CorkboardDom();
		const next = new CorkboardDom();
		const root = dom.container.createDiv();
		const deck = deckOf();
		const invalidateRects = vi.fn();
		const release = bindFrameWindow({ root: el(root), deck, invalidateRects });
		root.migrateTo(next);
		for (const type of ['scroll', 'resize', 'mouseup']) {
			expect(dom.windowListeners.get(type)).toEqual([]);
			expect(next.windowListeners.get(type)).toHaveLength(1);
		}
		expect(deck.closeColorPanel).toHaveBeenCalledOnce();
		expect(deck.releasePress).toHaveBeenCalledOnce();
		expect(invalidateRects).toHaveBeenCalledOnce();
		// Released, it lets go of the window it stands in now, and hears of no other.
		release();
		for (const type of ['scroll', 'resize', 'mouseup']) expect(next.windowListeners.get(type)).toEqual([]);
		expect(root.windowMigrationListeners.size).toBe(0);
	});
});

/** A root with a scroller, a plain control and one card standing in it, and the little of a deck the custody asks. */
function custodyOf() {
	const dom = new CorkboardDom();
	const root = dom.container.createDiv();
	const scroller = root.createDiv({ cls: 'scroller' });
	const control = root.createEl('button');
	const outside = dom.container.createEl('button');
	const cardEl = scroller.createDiv({ cls: 'snowflake-method-corkboard-card', attr: { 'data-key': 'row-1 scene-1' } });
	const title = cardEl.createEl('button', { cls: 'snowflake-method-corkboard-title' });
	const conflict = cardEl.createEl('textarea', { cls: 'snowflake-method-corkboard-conflict' });
	const card = { el: cardEl, conflict } as unknown as SceneCard;
	const cards = new Map<string, SceneCard>([['row-1 scene-1', card]]);
	const partOf = vi.fn((_card: SceneCard, part: string): Element => (part === 'title' ? title : cardEl) as unknown as Element);
	const commitConflict = vi.fn();
	const custody = createFocusCustody(el(root), el(scroller), { cards, partOf, commitConflict });
	return { dom, root, scroller, control, outside, cardEl, title, conflict, card, cards, partOf, commitConflict, custody };
}

describe('focus custody', () => {
	it('holds nothing for a focus that stands outside the workspace', () => {
		const fixture = custodyOf();
		expect(fixture.custody.hold()).toBeNull();
		fixture.outside.focus();
		expect(fixture.custody.hold()).toBeNull();
	});

	it('holds a control as itself, and a card\'s control as the card\'s key and the part', () => {
		const fixture = custodyOf();
		fixture.control.focus();
		expect(fixture.custody.hold()).toEqual({ kind: 'element', el: fixture.control });
		fixture.title.focus();
		expect(fixture.custody.hold()).toEqual({ kind: 'card', key: 'row-1 scene-1', part: 'title' });
		fixture.cardEl.focus();
		expect(fixture.custody.hold()).toEqual({ kind: 'card', key: 'row-1 scene-1', part: 'card' });
	});

	it('leaves the focus where it is when the paint did not take it', () => {
		const fixture = custodyOf();
		fixture.control.focus();
		const held = fixture.custody.hold();
		fixture.title.focus();
		fixture.custody.giveBack(held);
		expect(fixture.dom.doc.activeElement).toBe(fixture.title);
		fixture.custody.giveBack(null);
		expect(fixture.dom.doc.activeElement).toBe(fixture.title);
	});

	it('gives the focus back to the control it stood on, or to the scroller when the control has gone', () => {
		const fixture = custodyOf();
		fixture.control.focus();
		const held = fixture.custody.hold();
		fixture.control.blur();
		fixture.custody.giveBack(held);
		expect(fixture.dom.doc.activeElement).toBe(fixture.control);
		fixture.control.remove();
		fixture.custody.giveBack(held);
		expect(fixture.dom.doc.activeElement).toBe(fixture.scroller);
	});

	it('gives the focus back to the same part of the same card when the card was remade, or to the scroller when it has gone', () => {
		const fixture = custodyOf();
		fixture.title.focus();
		const held = fixture.custody.hold();
		fixture.title.blur();
		fixture.custody.giveBack(held);
		expect(fixture.partOf).toHaveBeenCalledWith(fixture.card, 'title');
		expect(fixture.dom.doc.activeElement).toBe(fixture.title);
		fixture.cardEl.remove();
		fixture.custody.giveBack(held);
		expect(fixture.dom.doc.activeElement).toBe(fixture.scroller);
	});

	it('saves the conflict box holding the focus, and says when none of its cards holds it', () => {
		const fixture = custodyOf();
		expect(fixture.custody.saveConflict()).toBe(false);
		fixture.title.focus();
		expect(fixture.custody.saveConflict()).toBe(false);
		fixture.conflict.focus();
		expect(fixture.custody.saveConflict()).toBe(true);
		expect(fixture.commitConflict).toHaveBeenCalledExactlyOnceWith(fixture.card);
	});
});

describe('the dialogs the workspace owns', () => {
	const dialog = (): Modal & { closes: number } => {
		const modal = new Modal({} as App) as Modal & { closes: number };
		modal.closes = 0;
		// As the app's own: closing runs what the dialog does as it closes.
		modal.close = (): void => {
			modal.closes++;
			modal.onClose();
		};
		return modal;
	};

	it('hands a dialog back to be opened, and lets it go once it has closed of itself', () => {
		const keeper = createModalKeeper();
		const closed = vi.fn();
		const modal = dialog();
		modal.onClose = closed;
		expect(keeper.keep(modal)).toBe(modal);
		modal.close();
		// What the dialog did as it closed is still done.
		expect(closed).toHaveBeenCalledOnce();
		keeper.closeAll('never said');
		expect(modal.closes).toBe(1);
	});

	it('closes every dialog still standing, and none of them twice', () => {
		const keeper = createModalKeeper();
		const first = keeper.keep(dialog());
		const second = keeper.keep(dialog());
		keeper.closeAll('never said');
		keeper.closeAll('never said');
		expect([first.closes, second.closes]).toEqual([1, 1]);
	});

	it('closes the rest when one throws on the way out, and says which workspace it was', () => {
		const keeper = createModalKeeper();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const first = keeper.keep(dialog());
			const stuck = keeper.keep(dialog());
			const last = keeper.keep(dialog());
			const failure = new Error('stuck');
			stuck.close = (): void => { throw failure; };
			expect(() => { keeper.closeAll('Snowflake: a test dialog could not be closed'); }).not.toThrow();
			expect([first.closes, last.closes]).toEqual([1, 1]);
			expect(logged).toHaveBeenCalledExactlyOnceWith('Snowflake: a test dialog could not be closed', failure);
			// The one that would not close is let go all the same, and not tried again.
			const again = vi.fn();
			stuck.close = again;
			keeper.closeAll('never said');
			expect(again).not.toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});
});

/** The deck of the lanes, with what it handed the real deck kept to be asked as a card would ask. */
function laneDeckOf() {
	const handed = controlsOf();
	const state = { model: modelOf(['scene-1', 'scene-2']) as ProjectDashboardModel | null, readOnly: false };
	const cells = { dragAllowed: vi.fn(() => true), openCardMenu: vi.fn() };
	const notice = vi.fn();
	const laneDeck = createLaneDeck({
		controls: handed.controls,
		notice,
		model: () => state.model,
		readOnly: () => state.readOnly,
		cells: () => cells,
	});
	const deps = deckDeps[deckDeps.length - 1] as SceneCardDeps<SceneCard>;
	return { ...handed, workspace: state, cells, notice, laneDeck, deps };
}

describe('the deck the lanes\' cards are dealt from', () => {
	it('keys what the cards read off the model, afresh for each model it is handed', () => {
		const fixture = laneDeckOf();
		expect(fixture.laneDeck.scenesById().size).toBe(0);
		fixture.laneDeck.index(fixture.workspace.model);
		expect([...fixture.laneDeck.scenesById().keys()]).toEqual(['scene-1', 'scene-2']);
		expect([...fixture.laneDeck.sceneIndex()]).toEqual([['scene-1', 0], ['scene-2', 1]]);
		expect(fixture.deps.scenesById()).toBe(fixture.laneDeck.scenesById());
		expect([...fixture.deps.manuscriptPositions()]).toEqual([['Draft/One.md', 0], ['Draft/Two.md', 1]]);
		expect([...fixture.deps.charactersByPath().keys()]).toEqual(['Cast/Alice.md']);
		fixture.laneDeck.index(modelOf(['scene-9']));
		expect([...fixture.deps.scenesById().keys()]).toEqual(['scene-9']);
		fixture.laneDeck.index(null);
		expect(fixture.laneDeck.sceneIndex().size).toBe(0);
		expect(fixture.deps.manuscriptPositions().size).toBe(0);
	});

	it('resolves a link once per paint, and afresh at the next', () => {
		const fixture = laneDeckOf();
		expect(fixture.deps.resolveManuscriptPath('One', 'Scenes/a.md')).toBe('Draft/One.md');
		expect(fixture.deps.resolveManuscriptPath('One', 'Scenes/a.md')).toBe('Draft/One.md');
		expect(fixture.resolved).toHaveBeenCalledOnce();
		// The same words from another scene are another link.
		fixture.deps.resolveManuscriptPath('One', 'Scenes/b.md');
		expect(fixture.resolved).toHaveBeenCalledTimes(2);
		fixture.resolved.mockReturnValueOnce(null as unknown as { path: string });
		expect(fixture.deps.resolveManuscriptPath('Gone', 'Scenes/a.md')).toBeNull();
		expect(fixture.deps.resolveManuscriptPath('Gone', 'Scenes/a.md')).toBeNull();
		expect(fixture.resolved).toHaveBeenCalledTimes(3);
		fixture.laneDeck.beginPaint();
		expect(deckBeginPaint.calls).toBe(1);
		fixture.deps.resolveManuscriptPath('One', 'Scenes/a.md');
		expect(fixture.resolved).toHaveBeenCalledTimes(4);
	});

	it('asks the controls and the workspace afresh at every call, never keeping what they said at the render', () => {
		const fixture = laneDeckOf();
		expect(fixture.deps.projectPath()).toBe('P');
		expect(fixture.deps.unloading?.()).toBe(false);
		expect(fixture.deps.readOnly()).toBe(false);
		fixture.state.projectPath = 'Renamed';
		fixture.state.unloading = true;
		fixture.workspace.readOnly = true;
		fixture.workspace.model = null;
		expect(fixture.deps.projectPath()).toBe('Renamed');
		expect(fixture.deps.unloading?.()).toBe(true);
		expect(fixture.deps.readOnly()).toBe(true);
		expect(fixture.deps.model()).toBeNull();
		void fixture.deps.refresh();
		expect(fixture.controls.refresh).toHaveBeenCalledOnce();
	});

	it('takes controls that never say whether the plugin is unloading for ones that say it is not', () => {
		const handed = controlsOf();
		const { unloading: _unloading, ...quiet } = handed.controls;
		createLaneDeck({ controls: quiet, notice: vi.fn(), model: () => null, readOnly: () => true, cells: () => ({ dragAllowed: () => true, openCardMenu: () => undefined }) });
		expect((deckDeps[deckDeps.length - 1] as SceneCardDeps<SceneCard>).unloading?.()).toBe(false);
	});

	it('asks the cells, made after it, whether a card may drag and for its menu', () => {
		const fixture = laneDeckOf();
		const card = {} as SceneCard;
		const event = {} as MouseEvent;
		expect(fixture.deps.dragAllowed(card)).toBe(true);
		fixture.deps.menu(card, event);
		expect(fixture.cells.dragAllowed).toHaveBeenCalledWith(card);
		expect(fixture.cells.openCardMenu).toHaveBeenCalledWith(card, event);
		expect(fixture.deps.extend(card)).toBe(card);
	});
});

/** The pool beside a field, over a model the workspace may change, dealt with a variant of the test's own. */
function poolOf() {
	const handed = controlsOf();
	const dom = new CorkboardDom();
	const root = dom.container.createDiv();
	const body = root.createDiv();
	const field = body.createDiv({ cls: 'field' });
	const state = { model: modelOf(['scene-1', 'scene-2', 'scene-3']) as ProjectDashboardModel | null };
	const invalidateRects = vi.fn();
	const pool = createScenePool({ controls: handed.controls, root: el(root), body: el(body), model: () => state.model, invalidateRects });
	const menuItems = vi.fn();
	const mount = (): void => { pool.mount({ emptyText: 'pool.empty', menuItems }); };
	const dealt = (): [CorkboardElement, CorkboardControls, CorkboardVariant] =>
		handed.corkboard.mock.calls[0]! as unknown as [CorkboardElement, CorkboardControls, CorkboardVariant];
	return { ...handed, dom, root, body, field, workspace: state, invalidateRects, pool, menuItems, mount, dealt };
}

describe('the scene pool', () => {
	it('stands in the body after the field, its head naming it and counting what it holds', () => {
		const fixture = poolOf();
		const aside = fixture.pool.el as unknown as CorkboardElement;
		expect(fixture.body.children).toEqual([fixture.field, aside]);
		expect(aside.tag).toBe('aside');
		expect(aside.getAttribute('aria-label')).toBe('timeline.pool');
		expect(aside.children.map((child) => [...child.classes])).toEqual([
			['snowflake-method-timeline-pool-head'],
			['snowflake-method-corkboard-host'],
		]);
		const name = aside.querySelector('.snowflake-method-timeline-pool-name')!;
		expect(name.textContent).toBe('timeline.pool');
		expect(name.getAttribute('role')).toBe('heading');
		expect(name.getAttribute('aria-level')).toBe('3');
		expect(aside.querySelector('.snowflake-method-timeline-pool-count')!.classes.has('snowflake-method-step-indicator')).toBe(true);
		// Nothing is dealt until the cells stand to say how its cards leave.
		expect(fixture.corkboard).not.toHaveBeenCalled();
	});

	it('is the corkboard in one column, dealt with the workspace\'s own line and what the cells hand over', () => {
		const fixture = poolOf();
		fixture.mount();
		const [host, , variant] = fixture.dealt();
		expect(host).toBe((fixture.pool.el as unknown as CorkboardElement).querySelector('.snowflake-method-corkboard-host'));
		expect(variant).toMatchObject({ addButton: 'icon', searchLabel: 'quiet', columns: 1, gap: 0.75, modeShared: true, emptyText: 'pool.empty' });
		expect(variant.menuItems).toBe(fixture.menuItems);
	});

	it('leaves out what is on show has placed, counts the rest, and paints the pool', () => {
		const fixture = poolOf();
		fixture.mount();
		const include = fixture.dealt()[2].include!;
		const count = (fixture.pool.el as unknown as CorkboardElement).querySelector('.snowflake-method-timeline-pool-count')!;
		fixture.pool.paint(new Set(['scene-1']));
		expect(include(scene('scene-1'))).toBe(false);
		expect(include(scene('scene-2'))).toBe(true);
		expect(count.textContent).toBe('2');
		expect(count.dataset.digits).toBe('1');
		expect(fixture.poolHandle.refresh).toHaveBeenCalledOnce();
		fixture.pool.paint(new Set());
		expect(include(scene('scene-1'))).toBe(true);
		expect(count.textContent).toBe('3');
		fixture.workspace.model = null;
		fixture.pool.paint(new Set());
		expect(count.textContent).toBe('0');
	});

	it('hands the corkboard controls that read through the workspace\'s own at every call', () => {
		const fixture = poolOf();
		fixture.mount();
		const poolControls = fixture.dealt()[1];
		expect(poolControls.memory).toBe(fixture.controls.memory.pool);
		expect(poolControls.popover).toBe(fixture.controls.popover);
		expect(poolControls.model()).toBe(fixture.workspace.model);
		fixture.workspace.model = null;
		expect(poolControls.model()).toBeNull();
		expect(poolControls.unloading?.()).toBe(false);
		fixture.state.unloading = true;
		expect(poolControls.unloading?.()).toBe(true);
		poolControls.activateProject();
		expect(fixture.controls.activateProject).toHaveBeenCalledOnce();
		void poolControls.refresh();
		expect(fixture.controls.refresh).toHaveBeenCalledOnce();
	});

	it('dresses the workspace\'s cards in the style the pool chose, dropping what was measured only when the style moved', () => {
		const fixture = poolOf();
		fixture.mount();
		fixture.pool.paintCardMode();
		expect(fixture.root.dataset.mode).toBe('compact');
		expect(fixture.invalidateRects).toHaveBeenCalledOnce();
		fixture.pool.paintCardMode();
		expect(fixture.invalidateRects).toHaveBeenCalledOnce();
		// The pool's display control saves the tab and dresses the lanes at once.
		fixture.controls.memory.pool.mode = 'extended';
		fixture.dealt()[1].remember();
		expect(fixture.controls.remember).toHaveBeenCalledOnce();
		expect(fixture.root.dataset.mode).toBe('extended');
		expect(fixture.invalidateRects).toHaveBeenCalledTimes(2);
	});

	it('hands the pool its reveals, measures and saves, and says nothing to a pool not yet dealt or already gone', () => {
		const fixture = poolOf();
		fixture.pool.reveal('scene-1');
		fixture.pool.remeasure();
		fixture.pool.paint(new Set());
		expect(fixture.pool.saveFocusedConflict()).toBe(false);
		fixture.pool.dispose();
		fixture.mount();
		fixture.pool.reveal('scene-2');
		fixture.pool.remeasure();
		expect(fixture.poolHandle.reveal).toHaveBeenCalledExactlyOnceWith('scene-2');
		expect(fixture.poolHandle.remeasure).toHaveBeenCalledOnce();
		expect(fixture.pool.saveFocusedConflict()).toBe(true);
		fixture.pool.dispose();
		fixture.pool.dispose();
		expect(fixture.poolHandle.dispose).toHaveBeenCalledOnce();
		fixture.pool.remeasure();
		fixture.pool.paint(new Set());
		expect(fixture.poolHandle.remeasure).toHaveBeenCalledOnce();
		expect(fixture.poolHandle.refresh).not.toHaveBeenCalled();
		expect(fixture.pool.saveFocusedConflict()).toBe(false);
	});
});

/** The whole frame under a toolbar, over a column fold kept under a name of the test's own. */
function frameOf() {
	const handed = controlsOf();
	const dom = new CorkboardDom();
	const root = dom.container.createDiv();
	const toolbar = root.createDiv({ cls: 'toolbar' });
	const state = { columnCollapsed: false, model: modelOf(['scene-1']) as ProjectDashboardModel | null };
	const invalidateRects = vi.fn();
	const placed: { start: number; headHeight?: number } = { start: 200, headHeight: 40 };
	const placeScrollbars = vi.fn((fit: (start: number, headHeight?: number) => void) => { fit(placed.start, placed.headHeight); });
	const frame = createFrame({
		controls: handed.controls,
		root: el(root),
		foldLabels: {
			column: { collapse: 'column.collapse', expand: 'column.expand' },
			pool: { collapse: 'pool.collapse', expand: 'pool.expand' },
		},
		columnCollapsed: () => state.columnCollapsed,
		setColumnCollapsed: (collapsed) => { state.columnCollapsed = collapsed; },
		model: () => state.model,
		invalidateRects,
		placeScrollbars,
	});
	const scroller = frame.scroller as unknown as CorkboardElement;
	const across = root.querySelector('.snowflake-method-timeline-scrollbar.is-across')!;
	return { ...handed, dom, root, toolbar, workspace: state, invalidateRects, placed, placeScrollbars, frame, scroller, across };
}

describe('the frame, made together', () => {
	it('makes its elements in the order the root, the body and the field have always held them', () => {
		const fixture = frameOf();
		expect(fixture.root.children.map((child) => [...child.classes])).toEqual([
			['toolbar'],
			['snowflake-method-timeline-fold', 'is-start'],
			['snowflake-method-timeline-fold', 'is-end'],
			['snowflake-method-character-empty'],
			['snowflake-method-timeline-body', 'is-hidden'],
		]);
		const body = fixture.root.children[4]!;
		expect(body.children.map((child) => [...child.classes])).toEqual([
			['snowflake-method-timeline-field'],
			['snowflake-method-timeline-pool'],
		]);
		expect(body.children[1]).toBe(fixture.frame.pool.el);
		expect(body.children[0]!.children.map((child) => [...child.classes])).toEqual([
			['snowflake-method-timeline-scroll'],
			['snowflake-method-timeline-scrollbar', 'is-across', 'is-hidden'],
			['snowflake-method-timeline-scrollbar', 'is-down', 'is-hidden'],
		]);
		expect(fixture.scroller.getAttribute('tabindex')).toBe('-1');
		// The table is handed over empty, for the workspace to lay its rows in.
		expect(fixture.scroller.children).toEqual([fixture.frame.table]);
		expect((fixture.frame.table as unknown as CorkboardElement).children).toEqual([]);
	});

	it('says a word in the body\'s place, and brings the body back', () => {
		const fixture = frameOf();
		const line = fixture.root.children[3]!;
		const body = fixture.root.children[4]!;
		fixture.frame.showEmpty('Nothing yet');
		expect(line.classes.has('is-hidden')).toBe(false);
		expect(line.children[1]!.textContent).toBe('Nothing yet');
		expect(body.classes.has('is-hidden')).toBe(true);
		expect(fixture.root.classes.has('is-empty')).toBe(true);
		fixture.frame.showEmpty(null);
		expect(line.classes.has('is-hidden')).toBe(true);
		expect(body.classes.has('is-hidden')).toBe(false);
		expect(fixture.root.classes.has('is-empty')).toBe(false);
		expect(line.children[1]!.textContent).toBe('Nothing yet');
	});

	it('keeps the pool\'s fold in the memory it was handed and the column\'s wherever the workspace keeps it', () => {
		const fixture = frameOf();
		fixture.frame.folds.fold('column', true);
		expect(fixture.workspace.columnCollapsed).toBe(true);
		expect(fixture.controls.memory.poolCollapsed).toBe(false);
		// The column's room moved, so the bars are fitted by the workspace's own measure.
		expect(fixture.placeScrollbars).toHaveBeenCalledOnce();
		expect(fixture.poolHandle.remeasure).not.toHaveBeenCalled();
		fixture.frame.pool.mount({});
		fixture.frame.folds.fold('pool', true);
		expect(fixture.controls.memory.poolCollapsed).toBe(true);
		expect((fixture.frame.pool.el as unknown as CorkboardElement).classes.has('is-hidden')).toBe(true);
		expect(fixture.poolHandle.remeasure).toHaveBeenCalledOnce();
		expect(fixture.controls.remember).toHaveBeenCalledTimes(2);
		expect(fixture.invalidateRects).toHaveBeenCalledTimes(2);
		// A restored state hands the folds to the memory; the next paint wears them.
		fixture.controls.memory.poolCollapsed = false;
		fixture.workspace.columnCollapsed = false;
		fixture.frame.folds.paint();
		expect(fixture.root.classes.has('is-time-collapsed')).toBe(false);
		expect(fixture.root.classes.has('is-pool-collapsed')).toBe(false);
	});

	it('fits the bars by the workspace\'s own measure of where they start', () => {
		const fixture = frameOf();
		fixture.dom.scrollWidth = 1500;
		fixture.frame.fitScrollbars();
		expect(fixture.across.styles.insetInlineStart).toBe('200px');
		fixture.placed.start = 328;
		fixture.frame.fitScrollbars();
		expect(fixture.across.styles.insetInlineStart).toBe('328px');
	});

	it('measures the narrow rule and fits the bars again when a box of the frame changes size', () => {
		const fixture = frameOf();
		fixture.dom.resize(1200);
		expect(fixture.frame.folds.folded('pool')).toBe(true);
		expect(fixture.placeScrollbars).toHaveBeenCalledOnce();
		fixture.frame.stopWatchingSize();
		fixture.dom.resize(1600);
		expect(fixture.frame.folds.folded('pool')).toBe(true);
		expect(fixture.placeScrollbars).toHaveBeenCalledOnce();
	});

	it('keeps where the scroller stands in the tab\'s memory, and gives it back once', () => {
		const fixture = frameOf();
		fixture.scroller.scrollLeft = 220;
		fixture.scroller.scrollTop = 90;
		fixture.scroller.dispatch('scroll');
		expect(fixture.controls.memory.scroll).toEqual({ left: 220, top: 90 });
		fixture.scroller.scrollLeft = 0;
		fixture.scroller.scrollTop = 0;
		fixture.frame.giveScrollBack();
		expect([fixture.scroller.scrollLeft, fixture.scroller.scrollTop]).toEqual([220, 90]);
		// A later paint must not pull the author away from wherever they have scrolled since.
		fixture.scroller.scrollLeft = 10;
		fixture.scroller.scrollTop = 5;
		fixture.frame.giveScrollBack();
		expect([fixture.scroller.scrollLeft, fixture.scroller.scrollTop]).toEqual([10, 5]);
	});

	it('writes no scroll for a memory that holds none', () => {
		const fixture = frameOf();
		const written = fixture.dom.operations.filter((operation) => operation.kind === 'scroll').length;
		fixture.frame.giveScrollBack();
		expect(fixture.dom.operations.filter((operation) => operation.kind === 'scroll')).toHaveLength(written);
	});

	it('brings a folded pool back for a reveal, since a card can only be shown in a pool that stands', () => {
		const fixture = frameOf();
		fixture.frame.pool.mount({});
		fixture.controls.memory.poolCollapsed = true;
		fixture.frame.folds.paint();
		fixture.frame.reveal('scene-1');
		expect(fixture.controls.memory.poolCollapsed).toBe(false);
		expect((fixture.frame.pool.el as unknown as CorkboardElement).classes.has('is-hidden')).toBe(false);
		expect(fixture.poolHandle.reveal).toHaveBeenCalledExactlyOnceWith('scene-1');
	});

	it('measures everything again when told to: what a drag measured, the bars, then the pool', () => {
		const fixture = frameOf();
		fixture.frame.pool.mount({});
		const order: string[] = [];
		fixture.invalidateRects.mockImplementation(() => { order.push('rects'); });
		fixture.placeScrollbars.mockImplementation(() => { order.push('bars'); });
		fixture.poolHandle.remeasure.mockImplementation(() => { order.push('pool'); });
		fixture.frame.remeasure();
		expect(order).toEqual(['rects', 'bars', 'pool']);
	});
});
