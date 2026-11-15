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
			readonly inputEl: CorkboardElement;
			constructor(container: CorkboardElement) {
				this.input = container.createDiv({ cls: 'search-input-container' }).createEl('input');
				this.inputEl = this.input;
			}
			setPlaceholder(): this { return this; }
			setValue(value: string): this { this.input.value = value; return this; }
			onChange(): this { return this; }
		},
	};
});
vi.mock('../../src/ui/corkboard-layout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/corkboard-layout')>();
	return { ...actual, buildLayout: vi.fn(actual.buildLayout) };
});

import { renderCorkboard } from '../../src/ui/corkboard';
import type { CorkboardControls, CorkboardVariant } from '../../src/ui/corkboard-bridge';
import { buildLayout } from '../../src/ui/corkboard-layout';
import { isFilterOptionRow, type FilterOptionRow, type FilterRow, type FilterSliderRow } from '../../src/ui/filter-rows';
import { CORKBOARD_SIZE_STOPS, corkboardMemory, type CorkboardMemory } from '../../src/ui/story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from '../../src/ui/view-model';

const CARD = '.snowflake-method-corkboard-card';
const TEXT_SIZE = '--snowflake-method-corkboard-text-size';
const CARD_HEIGHT = '--snowflake-method-corkboard-card-height';
const SPREAD_START = '--snowflake-method-corkboard-spread-start';
const SPREAD_END = '--snowflake-method-corkboard-spread-end';

/**
 * The board with a panel that stands in for the Display panel as the real
 * one behaves: drafts are shown through `preview`, a confirmation applies
 * every row in sight and tells the board, and any other close hands the
 * standing answers back, the choices before the measures.
 */
function board(settings: Partial<CorkboardMemory> = {}, variant?: CorkboardVariant) {
	const dom = new CorkboardDom();
	const memory = Object.assign(corkboardMemory(), settings);
	const scenes: SceneViewModel[] = Array.from({ length: 200 }, (_, index) => ({
		id: `scene-${String(index)}`, path: `Scenes/${String(index)}.md`,
		title: `Scene ${String(index)}`, rank: index, progressStatus: 'in-progress',
		aliases: [], categoryPaths: [], povPath: '', povName: '', povMissing: false,
		times: [], locations: [], characterPaths: [], conflict: 'An obstacle', color: null,
		linkedManuscript: [], worldStatus: [], relationships: [], events: '',
		customFields: '', revision: 'revision', readOnly: false, healthIssues: [], gallery: [], galleryMain: null,
	}));
	const model = {
		path: 'Novel/Novel.md', projectId: 'novel', locale: 'en',
		scenes, characters: [], manuscriptPaths: [], readOnly: false,
	} as unknown as ProjectDashboardModel;
	let open: { anchor: CorkboardElement; rows: readonly FilterRow[]; changed: () => void; title: string | undefined } | null = null;
	const drafts = new Map<FilterRow, string | number>();
	const putBack = (rows: readonly FilterRow[]): void => {
		for (const row of rows) if (isFilterOptionRow(row)) row.preview?.(row.value);
		for (const row of rows) if (row.presentation === 'stop-slider') row.preview(row.value);
	};
	// The popover marks the button its panel hangs from, as the real one does.
	const popover = {
		filterOpen: () => open !== null,
		openFilter: vi.fn((anchor: CorkboardElement, rows: readonly FilterRow[], changed: () => void, title?: string) => {
			popover.closeFilter();
			open = { anchor, rows, changed, title };
			anchor.setAttribute('aria-expanded', 'true');
		}),
		closeFilter: vi.fn(() => {
			const standing = open;
			open = null;
			drafts.clear();
			if (standing === null) return;
			standing.anchor.setAttribute('aria-expanded', 'false');
			putBack(standing.rows);
		}),
	};
	const remember = vi.fn();
	const controls = {
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
		host: { patchScene: vi.fn(() => Promise.resolve('saved')) },
		t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`),
		model: () => model,
		activateProject: vi.fn(),
		refresh: vi.fn(() => Promise.resolve()),
		popover,
		memory,
		remember,
	} as unknown as CorkboardControls;
	const handle = renderCorkboard(dom.container as unknown as HTMLElement, controls, variant);
	const root = dom.container.children[0]!;
	const canvas = root.querySelector('.snowflake-method-corkboard-canvas')!;
	const scroller = root.querySelector('.snowflake-method-corkboard-scroll')!;
	const rows = (): readonly FilterRow[] => {
		if (open === null) throw new Error('the panel is not open');
		return open.rows;
	};
	const slider = (label: string): FilterSliderRow => {
		const row = rows().find((candidate) => candidate.label === label);
		if (row === undefined || row.presentation !== 'stop-slider') throw new Error(`no rail named ${label}`);
		return row;
	};
	const choice = (label: string): FilterOptionRow => {
		const row = rows().find((candidate) => candidate.label === label);
		if (row === undefined || !isFilterOptionRow(row)) throw new Error(`no choice named ${label}`);
		return row;
	};
	return {
		dom, root, canvas, scroller, handle, memory, remember, popover,
		cards: () => canvas.querySelectorAll(CARD),
		openDisplay: () => { root.querySelector('.snowflake-method-corkboard-display')!.dispatch('click'); },
		rows, slider, choice,
		/** The handle moved to a stop: the draft, shown on the board. */
		drag: (label: string, value: number) => {
			const row = slider(label);
			drafts.set(row, value);
			row.preview(value);
			dom.flushFrame();
		},
		/** A style picked in the panel: the draft, shown where the row asks to be. */
		pick: (label: string, value: string) => {
			const row = choice(label);
			drafts.set(row, value);
			row.preview?.(value);
			dom.flushFrame();
		},
		confirm: () => {
			const standing = open;
			if (standing === null) throw new Error('the panel is not open');
			for (const row of standing.rows) {
				if (row.presentation === 'number-range') continue;
				const draft = drafts.get(row);
				if (row.presentation === 'stop-slider') {
					if (row.hidden?.() !== true) row.apply(typeof draft === 'number' ? draft : row.value);
				} else {
					row.apply(typeof draft === 'string' ? draft : row.value);
				}
			}
			open = null;
			drafts.clear();
			standing.anchor.setAttribute('aria-expanded', 'false');
			standing.changed();
			dom.flushFrame();
		},
		dismiss: () => {
			popover.closeFilter();
			dom.flushFrame();
		},
	};
}

/** Where each card of the first row stands, and how wide, as the board wrote it. */
const firstRow = (cards: CorkboardElement[], count: number): { left: string | undefined; width: string | undefined }[] =>
	cards.slice(0, count).map((card) => ({ left: card.styles.insetInlineStart, width: card.styles.width }));

beforeEach(() => { vi.clearAllMocks(); });

describe('the corkboard\'s display sizes', () => {
	it('offers the three sizes between the card style and the grouping, each on its own stops and at the board\'s own', () => {
		const fixture = board();
		fixture.openDisplay();
		expect(fixture.rows().map((row) => row.label)).toEqual([
			'corkboard.cards', 'corkboard.cardWidth', 'corkboard.cardHeight', 'corkboard.textSize', 'corkboard.groupBy',
		]);
		const width = fixture.slider('corkboard.cardWidth');
		expect(width).toMatchObject({ stops: CORKBOARD_SIZE_STOPS.cardWidth, value: 0, empty: 0, resetLabel: 'settings.manuscriptAppearance.reset' });
		expect(fixture.slider('corkboard.cardHeight').stops).toBe(CORKBOARD_SIZE_STOPS.cardHeight);
		expect(fixture.slider('corkboard.textSize').stops).toBe(CORKBOARD_SIZE_STOPS.textSize);
		expect(width.format(0)).toBe('corkboard.size.auto');
		expect(width.format(256)).toBe('settings.manuscriptAppearance.pixels:{"value":256}');
		// Each handle waits at what the board draws: three cards sharing a thousand pixels, the standard card, the theme's small type.
		expect(width.rest?.()).toBeCloseTo(920 / 3);
		expect(fixture.slider('corkboard.cardHeight').rest?.()).toBe(240);
		expect(fixture.slider('corkboard.textSize').themeVar).toBe('--font-ui-small');
		// A width has no style it does not act on; the other two need a text box.
		expect(width.hidden).toBeUndefined();
		expect(fixture.slider('corkboard.cardHeight').hidden?.()).toBe(false);
		fixture.dismiss();
		fixture.handle.dispose();
	});

	it('opens each rail on the size the view holds', () => {
		const fixture = board({ cardWidth: 320, cardHeight: 352, textSize: 16 });
		fixture.openDisplay();
		expect(fixture.slider('corkboard.cardWidth').value).toBe(320);
		expect(fixture.slider('corkboard.cardHeight').value).toBe(352);
		expect(fixture.slider('corkboard.textSize').value).toBe(16);
		// The width the row would share out, not the one it is held to.
		expect(fixture.slider('corkboard.cardWidth').rest?.()).toBeCloseTo(920 / 3);
		fixture.dismiss();
		fixture.handle.dispose();
	});

	it('draws a dragged width at once, exactly, the spare room shared between the cards, and keeps none of it', () => {
		const fixture = board();
		expect(firstRow(fixture.cards(), 3)).toEqual([
			{ left: '0px', width: '306.67px' }, { left: '346.67px', width: '306.67px' }, { left: '693.33px', width: '306.67px' },
		]);
		fixture.openDisplay();
		fixture.drag('corkboard.cardWidth', 256);
		expect(firstRow(fixture.cards(), 3)).toEqual([
			{ left: '0px', width: '256px' }, { left: '372px', width: '256px' }, { left: '744px', width: '256px' },
		]);
		// The room between two cards is written on each, side by side; a row's two ends keep the gap.
		const [first, middle, last] = fixture.cards();
		expect([first!.styles[SPREAD_START], first!.styles[SPREAD_END]]).toEqual(['', '116px']);
		expect([middle!.styles[SPREAD_START], middle!.styles[SPREAD_END]]).toEqual(['116px', '116px']);
		expect([last!.styles[SPREAD_START], last!.styles[SPREAD_END]]).toEqual(['116px', '']);
		expect(fixture.memory.cardWidth).toBe(0);
		expect(fixture.remember).not.toHaveBeenCalled();
		// A wider card leaves room for two.
		fixture.drag('corkboard.cardWidth', 416);
		expect(firstRow(fixture.cards(), 3)).toEqual([
			{ left: '0px', width: '416px' }, { left: '584px', width: '416px' }, { left: '0px', width: '416px' },
		]);
		fixture.dismiss();
		fixture.handle.dispose();
	});

	it('keeps what was dragged when the panel is confirmed, in the memory and for the project', () => {
		const fixture = board();
		fixture.openDisplay();
		fixture.drag('corkboard.cardWidth', 256);
		fixture.drag('corkboard.textSize', 16);
		fixture.confirm();
		expect(fixture.memory).toMatchObject({ mode: 'standard', cardWidth: 256, cardHeight: 0, textSize: 16 });
		expect(fixture.remember).toHaveBeenCalledExactlyOnceWith({ cardWidth: 256, textSize: 16 });
		expect(firstRow(fixture.cards(), 2)).toEqual([{ left: '0px', width: '256px' }, { left: '372px', width: '256px' }]);
		expect(fixture.root.styles[TEXT_SIZE]).toBe('16px');
		// Confirmed again with nothing moved, only the layout is saved.
		fixture.openDisplay();
		fixture.confirm();
		expect(fixture.remember).toHaveBeenLastCalledWith(undefined);
		fixture.handle.dispose();
	});

	it('puts the board back as it stood when the panel closes any other way', () => {
		const fixture = board();
		fixture.scroller.scrollTop = 500;
		fixture.scroller.dispatch('scroll');
		fixture.dom.flushFrame();
		fixture.openDisplay();
		fixture.drag('corkboard.cardWidth', 416);
		fixture.drag('corkboard.cardHeight', 320);
		fixture.drag('corkboard.textSize', 20);
		expect(fixture.root.styles[TEXT_SIZE]).toBe('20px');
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('320px');
		fixture.dismiss();
		expect(fixture.memory).toMatchObject({ cardWidth: 0, cardHeight: 0, textSize: 0 });
		expect(fixture.remember).not.toHaveBeenCalled();
		expect(fixture.root.styles[TEXT_SIZE]).toBe('');
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('240px');
		expect(fixture.cards()[0]!.styles.width).toBe('306.67px');
		expect([fixture.cards()[0]!.styles[SPREAD_START], fixture.cards()[0]!.styles[SPREAD_END]]).toEqual(['', '']);
		// And where the author was reading.
		expect(fixture.scroller.scrollTop).toBe(500);
		fixture.handle.dispose();
	});

	it('leaves the board where the author scrolled to while a draft was shown', () => {
		const fixture = board();
		fixture.scroller.scrollTop = 500;
		fixture.scroller.dispatch('scroll');
		fixture.dom.flushFrame();
		fixture.openDisplay();
		fixture.drag('corkboard.cardHeight', 320);
		fixture.scroller.dispatch('wheel');
		fixture.scroller.scrollTop = 2000;
		fixture.scroller.dispatch('scroll');
		fixture.dom.flushFrame();
		fixture.dismiss();
		expect(fixture.scroller.scrollTop).not.toBe(500);
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('240px');
		fixture.handle.dispose();
	});

	it('repaints nothing for a panel dismissed with nothing tried', () => {
		const fixture = board();
		const layouts = vi.mocked(buildLayout).mock.calls.length;
		fixture.openDisplay();
		fixture.dismiss();
		expect(vi.mocked(buildLayout)).toHaveBeenCalledTimes(layouts);
		expect(fixture.dom.frames.size).toBe(0);
		fixture.handle.dispose();
	});

	it('draws the style drafted, so the sizes act on what is in sight, and offers a height and a type size only where there is a text box', () => {
		const fixture = board();
		fixture.openDisplay();
		const height = fixture.slider('corkboard.cardHeight');
		const type = fixture.slider('corkboard.textSize');
		fixture.pick('corkboard.cards', 'compact');
		expect(fixture.root.dataset.mode).toBe('compact');
		expect(fixture.memory.mode).toBe('standard');
		expect([height.hidden?.(), type.hidden?.()]).toEqual([true, true]);
		fixture.pick('corkboard.cards', 'extended');
		expect(fixture.root.dataset.mode).toBe('extended');
		expect([height.hidden?.(), type.hidden?.()]).toEqual([false, false]);
		// The scene's fullest card keeps its links on top of the height set.
		fixture.drag('corkboard.cardHeight', 320);
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('384px');
		fixture.dismiss();
		expect(fixture.root.dataset.mode).toBe('standard');
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('240px');
		fixture.handle.dispose();
	});

	it('leaves a size out of sight as it is stored when the panel is confirmed', () => {
		const fixture = board({ cardHeight: 320, textSize: 16 });
		fixture.openDisplay();
		fixture.pick('corkboard.cards', 'compact');
		fixture.confirm();
		expect(fixture.memory).toMatchObject({ mode: 'compact', cardHeight: 320, textSize: 16 });
		expect(fixture.remember).toHaveBeenCalledExactlyOnceWith({ mode: 'compact' });
		fixture.handle.dispose();
	});

	it('holds a set width through a resize, writing to the cards alone and building no rows again', () => {
		const fixture = board({ cardWidth: 256 });
		expect(firstRow(fixture.cards(), 3).map((card) => card.left)).toEqual(['0px', '372px', '744px']);
		const layouts = vi.mocked(buildLayout).mock.calls.length;
		fixture.dom.operations.length = 0;
		fixture.dom.resize(930);
		fixture.dom.flushFrame();
		expect(firstRow(fixture.cards(), 3)).toEqual([
			{ left: '0px', width: '256px' }, { left: '337px', width: '256px' }, { left: '674px', width: '256px' },
		]);
		expect(fixture.cards()[0]!.styles[SPREAD_END]).toBe('81px');
		expect(vi.mocked(buildLayout)).toHaveBeenCalledTimes(layouts);
		expect(fixture.dom.operations.filter((operation) => operation.kind === 'style').every((operation) => operation.target.matches(CARD))).toBe(true);
		fixture.handle.dispose();
	});

	it('takes no draft once it is gone', () => {
		const fixture = board();
		fixture.openDisplay();
		const width = fixture.slider('corkboard.cardWidth');
		fixture.drag('corkboard.cardWidth', 256);
		fixture.handle.dispose();
		// The panel's close hands the standing sizes back to a board that has gone: nothing is drawn.
		expect(() => { width.preview(416); }).not.toThrow();
		expect(fixture.dom.frames.size).toBe(0);
		expect(fixture.memory.cardWidth).toBe(0);
	});
});

describe('a pool\'s display panel', () => {
	const POOL = { columns: 1, gap: 0.75, searchLabel: 'quiet', addButton: 'icon' } as const;

	it('offers the three sizes of its own cards where a workspace gives it its width, the height and the type only for a style that shows a text box', () => {
		const wear = vi.fn();
		const fixture = board({ mode: 'compact' }, { ...POOL, wear });
		// The board said how it is drawn as it was first painted.
		expect(wear).toHaveBeenCalledOnce();
		expect(wear).toHaveBeenLastCalledWith({ mode: 'compact', cardWidth: 0, cardHeight: 0, textSize: 0 });
		fixture.openDisplay();
		expect(fixture.rows().map((row) => row.label)).toEqual([
			'corkboard.cards', 'corkboard.cardWidth', 'corkboard.cardHeight', 'corkboard.textSize', 'corkboard.groupBy',
		]);
		expect(fixture.slider('corkboard.cardWidth').stops).toBe(CORKBOARD_SIZE_STOPS.cardWidth);
		// A compact card shows no text box, so its height and its type have nothing to act on: the pool's look is its
		// own cards' alone, and the lanes' words are set from the workspace's own panel.
		expect(fixture.slider('corkboard.cardWidth').hidden).toBeUndefined();
		expect(fixture.slider('corkboard.cardHeight').hidden?.()).toBe(true);
		expect(fixture.slider('corkboard.textSize').hidden?.()).toBe(true);
		// A card of the pool is the board's least width while none is set, whether the pool stands open or is folded to nothing.
		expect(fixture.slider('corkboard.cardWidth').rest?.()).toBe(256);
		// The style drafted is shown, so the height's and the type's rows come with a style that has a text box.
		fixture.pick('corkboard.cards', 'standard');
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 0, cardHeight: 0, textSize: 0 });
		expect(fixture.slider('corkboard.cardHeight').hidden?.()).toBe(false);
		expect(fixture.slider('corkboard.textSize').hidden?.()).toBe(false);
		expect(fixture.memory.mode).toBe('compact');
		fixture.dismiss();
		expect(wear).toHaveBeenLastCalledWith({ mode: 'compact', cardWidth: 0, cardHeight: 0, textSize: 0 });
		fixture.handle.dispose();
	});

	it('tells the look it tries as the handle moves and the look it keeps, and stays one card wide whatever width is set', () => {
		const wear = vi.fn();
		const fixture = board({ mode: 'standard' }, { ...POOL, wear });
		wear.mockClear();
		fixture.openDisplay();
		fixture.drag('corkboard.cardWidth', 400);
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 400, cardHeight: 0, textSize: 0 });
		// The pool's width is the workspace's to give: the board lays one column out to whatever it is handed.
		expect(fixture.cards()[0]!.styles.width).toBe('1000px');
		fixture.drag('corkboard.cardHeight', 320);
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 400, cardHeight: 320, textSize: 0 });
		// Its own cards take the height and the type themselves.
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('320px');
		fixture.drag('corkboard.textSize', 18);
		expect(fixture.root.styles[TEXT_SIZE]).toBe('18px');
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 400, cardHeight: 320, textSize: 18 });
		// None of it is kept yet, and the same draft again tells nothing.
		expect(fixture.memory).toMatchObject({ cardWidth: 0, cardHeight: 0, textSize: 0 });
		const told = wear.mock.calls.length;
		fixture.drag('corkboard.textSize', 18);
		expect(wear).toHaveBeenCalledTimes(told);
		fixture.confirm();
		expect(fixture.memory).toMatchObject({ cardWidth: 400, cardHeight: 320, textSize: 18 });
		expect(fixture.remember).toHaveBeenCalledWith({ cardWidth: 400, cardHeight: 320, textSize: 18 });
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 400, cardHeight: 320, textSize: 18 });
		fixture.handle.dispose();
	});

	it('tells the standing look again when the panel closes unconfirmed', () => {
		const wear = vi.fn();
		const fixture = board({ mode: 'standard', cardWidth: 300, textSize: 14 }, { ...POOL, wear });
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 300, cardHeight: 0, textSize: 14 });
		fixture.openDisplay();
		fixture.drag('corkboard.cardWidth', 600);
		fixture.drag('corkboard.textSize', 30);
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 600, cardHeight: 0, textSize: 30 });
		fixture.dismiss();
		expect(wear).toHaveBeenLastCalledWith({ mode: 'standard', cardWidth: 300, cardHeight: 0, textSize: 14 });
		expect(fixture.root.styles[TEXT_SIZE]).toBe('14px');
		expect(fixture.memory).toMatchObject({ cardWidth: 300, textSize: 14 });
		expect(fixture.remember).not.toHaveBeenCalled();
		fixture.handle.dispose();
	});

	it('closes its own panel on a second press, and opens over one another surface hung from the lent popover since', () => {
		const fixture = board({ mode: 'standard' }, { ...POOL, wear: vi.fn() });
		fixture.openDisplay();
		expect(fixture.rows()).toHaveLength(5);
		fixture.openDisplay();
		expect(fixture.popover.filterOpen()).toBe(false);
		// The pool's panel again, and then the lanes' own Display hung from
		// the same popover under a button of the workspace's.
		fixture.openDisplay();
		const lanes = fixture.dom.container.createEl('button');
		fixture.popover.openFilter(lanes, [], () => undefined, 'corkboard.display');
		expect(fixture.rows()).toHaveLength(0);
		// A press on the pool's button from the keys, with no press of a
		// pointer to close the lanes' panel first: it took the panel for its
		// own, closed it and opened nothing.
		fixture.openDisplay();
		expect(fixture.popover.filterOpen()).toBe(true);
		expect(fixture.rows()).toHaveLength(5);
		expect(lanes.getAttribute('aria-expanded')).toBe('false');
		fixture.dismiss();
		fixture.handle.dispose();
	});

	it('keeps its two rows, shows no draft, and keeps the board\'s own sizes where no surface gives it its width', () => {
		const fixture = board({ cardWidth: 480, cardHeight: 320, textSize: 20 }, POOL);
		fixture.openDisplay();
		expect(fixture.rows().map((row) => row.label)).toEqual(['corkboard.cards', 'corkboard.groupBy']);
		expect(fixture.choice('corkboard.cards').preview).toBeUndefined();
		// One column as wide as the pool, a card as tall as its style, the theme's type.
		expect(fixture.cards()[0]!.styles.width).toBe('1000px');
		expect(fixture.root.styles[CARD_HEIGHT]).toBe('240px');
		expect(fixture.root.styles[TEXT_SIZE]).toBeUndefined();
		fixture.dismiss();
		fixture.handle.dispose();
	});
});
