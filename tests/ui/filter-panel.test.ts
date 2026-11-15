import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { FilterPanel } from '../../src/ui/filter-panel';
import { MACARON_COLORS } from '../../src/domain/macaron';
import type { FilterOptionRow, FilterRangeRow, FilterRow, FilterSliderRow } from '../../src/ui/filter-rows';
import type { StopSliderSpec } from '../../src/ui/presentation-controls';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

// Positioning is independent of the range fields' draft and confirm behavior.
vi.mock('../../src/ui/anchored-panel', () => ({
	followAnchor: () => () => undefined,
}));

// The rail itself is the manuscript's own control, tested beside it; here
// each one built is kept with what it was told, so a test can move it.
const rails = vi.hoisted(() => ({
	built: [] as { spec: StopSliderSpec; sync: ReturnType<typeof vi.fn> }[],
}));
vi.mock('../../src/ui/presentation-controls', () => ({
	addStopSlider: (_setting: unknown, spec: StopSliderSpec) => {
		const sync = vi.fn();
		rails.built.push({ spec, sync });
		return { sync };
	},
}));

function setup() {
	const dom = new CorkboardDom();
	Object.assign(dom.win, { activeDocument: dom.doc });
	const anchor = dom.container.createEl('button');
	const apply = vi.fn();
	const changed = vi.fn();
	const row: FilterRangeRow = {
		presentation: 'number-range',
		label: 'Scene range',
		min: { label: 'Minimum scene number', placeholder: 'Min', value: '2' },
		max: { label: 'Maximum scene number', placeholder: 'Max', value: '8' },
		apply,
	};
	const panel = new FilterPanel({} as App, (key) => key);
	const open = () => panel.open(anchor as unknown as HTMLElement, [row], changed);
	const field = (selector: string): CorkboardElement => {
		const element = dom.container.querySelector(selector);
		if (element === null) throw new Error(`Missing ${selector}`);
		return element;
	};
	const inputs = (): CorkboardElement[] => dom.container.querySelectorAll('input');
	const type = (index: number, value: string): void => {
		const input = inputs()[index];
		if (input === undefined) throw new Error(`Missing range input ${index}`);
		input.value = value;
		input.dispatch('input');
	};
	open();
	return { panel, row, apply, changed, open, field, inputs, type };
}

describe('scene range fields in the filter panel', () => {
	it('shows accessible bounds and applies both only on confirmation', () => {
		const view = setup();
		expect(view.inputs().map((input) => input.value)).toEqual(['2', '8']);
		expect(view.inputs().map((input) => input.getAttribute('aria-label'))).toEqual([
			'Minimum scene number', 'Maximum scene number',
		]);
		view.type(0, '3');
		view.type(1, '12');
		expect(view.apply).not.toHaveBeenCalled();
		expect(view.row.min.value).toBe('2');
		expect(view.row.max.value).toBe('8');
		view.field('.mod-cta').dispatch('click');
		expect(view.apply).toHaveBeenCalledExactlyOnceWith('3', '12');
		expect(view.changed).toHaveBeenCalledOnce();
		expect(view.panel.isOpen()).toBe(false);
	});

	it('discards edited bounds when dismissed', () => {
		const view = setup();
		view.type(0, '5');
		view.panel.close();
		expect(view.apply).not.toHaveBeenCalled();
		expect(view.changed).not.toHaveBeenCalled();
		view.open();
		expect(view.inputs().map((input) => input.value)).toEqual(['2', '8']);
		view.panel.close();
	});

	it('resets both draft fields and clears bounds only after confirmation', () => {
		const view = setup();
		view.type(0, '4');
		view.field('.snowflake-method-filter-reset').dispatch('click');
		expect(view.inputs().map((input) => input.value)).toEqual(['', '']);
		expect(view.apply).not.toHaveBeenCalled();
		view.field('.mod-cta').dispatch('click');
		expect(view.apply).toHaveBeenCalledExactlyOnceWith('', '');
	});

	it('keeps active bounds when a reset is dismissed', () => {
		const view = setup();
		view.field('.snowflake-method-filter-reset').dispatch('click');
		view.panel.close();
		view.open();
		expect(view.inputs().map((input) => input.value)).toEqual(['2', '8']);
		expect(view.apply).not.toHaveBeenCalled();
		view.panel.close();
	});
});

describe('questions under an answer', () => {
	const [rose, mint] = MACARON_COLORS;
	if (rose === undefined || mint === undefined) throw new Error('two colours wanted');

	/** A colour question, answered by its strip, with questions under some answers. */
	const question = (
		applied: string[],
		label: string,
		value = '',
		under?: FilterOptionRow['under'],
	): FilterOptionRow => ({
		label,
		presentation: 'color-swatches',
		placeholder: `any ${label}`,
		empty: '',
		options: () => [],
		value,
		apply: (next) => {
			applied.push(`${label}=${next}`);
		},
		...(under === undefined ? {} : { under }),
	});

	function branching(groundValue = '', edgeValue = '') {
		const dom = new CorkboardDom();
		Object.assign(dom.win, { activeDocument: dom.doc });
		const anchor = dom.container.createEl('button');
		const applied: string[] = [];
		const changed = vi.fn();
		const rows = [
			question(applied, 'ground', groundValue, {
				[rose]: [question(applied, 'rose edge', edgeValue)],
				[mint]: [question(applied, 'mint edge')],
			}),
		];
		const panel = new FilterPanel({} as App, (key) => key);
		panel.open(anchor as unknown as HTMLElement, rows, changed);
		const labels = (): (string | null)[] =>
			dom.container
				.querySelectorAll('.snowflake-method-filter-label')
				.map((label) => label.textContent);
		const pick = (field: number, color: string): void => {
			const strip = dom.container.querySelectorAll('.snowflake-method-sticky-swatches')[field];
			if (strip === undefined) throw new Error(`no strip ${String(field)}`);
			const swatch = strip
				.querySelectorAll('.snowflake-method-sticky-swatch')
				.find((candidate) => candidate.getAttribute('data-color') === color);
			if (swatch === undefined) throw new Error(`no swatch ${color}`);
			swatch.dispatch('click');
		};
		const press = (selector: string): void => {
			const button = dom.container.querySelector(selector);
			if (button === null) throw new Error(`Missing ${selector}`);
			button.dispatch('click');
		};
		return { panel, applied, changed, labels, pick, press };
	}

	it('draws them while that answer is drafted, and applies the ones not drawn as not asked', () => {
		const view = branching();
		expect(view.labels()).toEqual(['ground']);
		view.pick(0, rose);
		expect(view.labels()).toEqual(['ground', 'rose edge']);
		view.pick(1, mint);
		// Another answer on the ground: the rose edge goes, the mint edge comes, unanswered.
		view.pick(0, mint);
		expect(view.labels()).toEqual(['ground', 'mint edge']);
		view.press('.mod-cta');
		expect(view.applied).toEqual(['ground=' + mint, 'rose edge=', 'mint edge=']);
		expect(view.changed).toHaveBeenCalledOnce();
		expect(view.panel.isOpen()).toBe(false);
	});

	it('opens on the answers held, under too, and a reset reaches under', () => {
		const view = branching(rose, mint);
		expect(view.labels()).toEqual(['ground', 'rose edge']);
		view.press('.snowflake-method-filter-reset');
		expect(view.labels()).toEqual(['ground']);
		expect(view.applied).toEqual([]);
		view.press('.mod-cta');
		expect(view.applied).toEqual(['ground=', 'rose edge=', 'mint edge=']);
	});
});

describe('a measure on a rail of stops', () => {
	const [rose] = MACARON_COLORS;
	if (rose === undefined) throw new Error('a colour wanted');

	function measuring(options: { hidden?: () => boolean; style?: FilterOptionRow } = {}) {
		rails.built.length = 0;
		const dom = new CorkboardDom();
		Object.assign(dom.win, { activeDocument: dom.doc });
		const anchor = dom.container.createEl('button');
		const applied: number[] = [];
		const previewed: number[] = [];
		const changed = vi.fn();
		const width: FilterSliderRow = {
			presentation: 'stop-slider',
			label: 'Card width',
			stops: [208, 256, 320],
			value: 256,
			empty: 0,
			resetLabel: 'Reset to default',
			format: (value) => (value === 0 ? 'Automatic' : `${String(value)} px`),
			rest: () => 300,
			...(options.hidden === undefined ? {} : { hidden: options.hidden }),
			preview: (value) => {
				previewed.push(value);
			},
			apply: (value) => {
				applied.push(value);
			},
		};
		const rows: FilterRow[] = options.style === undefined ? [width] : [options.style, width];
		const panel = new FilterPanel({} as App, (key) => key);
		const open = (): void => {
			panel.open(anchor as unknown as HTMLElement, rows, changed, 'Display');
		};
		const press = (selector: string): void => {
			const button = dom.container.querySelector(selector);
			if (button === null) throw new Error(`Missing ${selector}`);
			button.dispatch('click');
		};
		const rail = (): { spec: StopSliderSpec; sync: ReturnType<typeof vi.fn> } => {
			const last = rails.built[rails.built.length - 1];
			if (last === undefined) throw new Error('no rail built');
			return last;
		};
		const row = (): CorkboardElement => {
			const found = dom.container.querySelector('.snowflake-method-filter-slider');
			if (found === null) throw new Error('no slider row');
			return found;
		};
		open();
		return { dom, panel, width, applied, previewed, changed, open, press, rail, row };
	}

	it('builds the rail on the measure held, named for the row, its words written on the name\'s line', () => {
		const view = measuring();
		const { spec } = view.rail();
		expect(spec).toMatchObject({ stops: [208, 256, 320], value: 256, resetValue: 0, resetLabel: 'Reset to default', label: 'Card width' });
		expect(spec.rest?.()).toBe(300);
		expect(spec.format(0)).toBe('Automatic');
		const name = view.row().querySelector('.snowflake-method-filter-label');
		expect(name?.textContent).toBe('Card width');
		expect(spec.valueHost).toBe(name);
		expect(view.previewed).toEqual([]);
		view.panel.close();
	});

	it('shows the board each stop the handle passes and keeps the last only when confirmed', () => {
		const view = measuring();
		view.rail().spec.onPick(320);
		view.rail().spec.onPick(208);
		expect(view.previewed).toEqual([320, 208]);
		expect(view.applied).toEqual([]);
		// The row handed in still holds the standing measure.
		expect(view.width.value).toBe(256);
		view.press('.mod-cta');
		expect(view.applied).toEqual([208]);
		expect(view.changed).toHaveBeenCalledOnce();
		// Confirmed: nothing is handed back.
		expect(view.previewed).toEqual([320, 208]);
		expect(view.panel.isOpen()).toBe(false);
	});

	it('hands the standing measure back when the panel closes any other way', () => {
		const view = measuring();
		view.rail().spec.onPick(320);
		view.panel.close();
		expect(view.previewed).toEqual([320, 256]);
		expect(view.applied).toEqual([]);
		expect(view.changed).not.toHaveBeenCalled();
		// Opened again, the rail stands on the measure held.
		view.open();
		expect(view.rail().spec.value).toBe(256);
		// And one panel opened over another puts the first one's board back too.
		view.rail().spec.onPick(208);
		view.open();
		expect(view.previewed).toEqual([320, 256, 208, 256]);
		view.panel.close();
	});

	it('takes the reset as the board\'s own measure, shown at once and kept on confirmation', () => {
		const view = measuring();
		view.rail().spec.onPick(320);
		view.press('.snowflake-method-filter-reset');
		expect(view.previewed).toEqual([320, 0]);
		expect(view.rail().spec.value).toBe(0);
		expect(view.applied).toEqual([]);
		view.press('.mod-cta');
		expect(view.applied).toEqual([0]);
	});

	it('puts a rail away while its measure has nothing to act on, and leaves it as stored', () => {
		let hidden = true;
		const view = measuring({ hidden: () => hidden });
		expect(view.row().classes.has('is-hidden')).toBe(true);
		view.press('.mod-cta');
		expect(view.applied).toEqual([]);
		expect(view.changed).toHaveBeenCalledOnce();
		hidden = false;
		view.open();
		expect(view.row().classes.has('is-hidden')).toBe(false);
		view.press('.mod-cta');
		expect(view.applied).toEqual([256]);
	});

	it('lets a rail under an answer go with that answer, and keeps only the one on show', () => {
		rails.built.length = 0;
		const dom = new CorkboardDom();
		Object.assign(dom.win, { activeDocument: dom.doc });
		const anchor = dom.container.createEl('button');
		const width: FilterSliderRow = {
			presentation: 'stop-slider',
			label: 'Card width',
			stops: [208, 256, 320],
			value: 256,
			empty: 0,
			resetLabel: 'Reset to default',
			format: (value) => `${String(value)} px`,
			preview: () => undefined,
			apply: () => undefined,
		};
		const ground: FilterOptionRow = {
			label: 'Ground',
			presentation: 'color-swatches',
			placeholder: 'any',
			empty: '',
			options: () => [],
			value: '',
			apply: () => undefined,
			under: { [rose]: [width] },
		};
		const panel = new FilterPanel({} as App, (key) => key);
		panel.open(anchor as unknown as HTMLElement, [ground], vi.fn(), 'Display');
		const pickRose = (): void => {
			const swatch = dom.container
				.querySelectorAll('.snowflake-method-sticky-swatch')
				.find((candidate) => candidate.getAttribute('data-color') === rose);
			if (swatch === undefined) throw new Error('no swatch');
			swatch.dispatch('click');
		};
		// The answer the measure stands under is drafted: its rail is built
		// and told where to wait.
		pickRose();
		expect(rails.built).toHaveLength(1);
		const first = rails.built[0]!;
		const told = first.sync.mock.calls.length;
		expect(told).toBeGreaterThan(0);
		// The answer is taken back, and its row goes: the rail is told
		// nothing more, now or when the answer is drafted again.
		pickRose();
		expect(dom.container.querySelector('.snowflake-method-filter-slider')).toBeNull();
		pickRose();
		expect(rails.built).toHaveLength(2);
		expect(first.sync).toHaveBeenCalledTimes(told);
		expect(rails.built[1]!.sync).toHaveBeenCalled();
		panel.close();
	});

	it('shows a choice that asks to be seen, brings the rails it uncovers back, and puts both back when dismissed', () => {
		const styles: string[] = [];
		let shown = '';
		const style: FilterOptionRow = {
			label: 'Cards',
			presentation: 'color-swatches',
			placeholder: 'any',
			empty: '',
			options: () => [],
			value: '',
			apply: (next) => {
				styles.push(`apply=${next}`);
			},
			preview: (next) => {
				shown = next;
				styles.push(`preview=${next}`);
			},
		};
		const view = measuring({ style, hidden: () => shown === '' });
		expect(view.row().classes.has('is-hidden')).toBe(true);
		const swatch = view.dom.container
			.querySelectorAll('.snowflake-method-sticky-swatch')
			.find((candidate) => candidate.getAttribute('data-color') === rose);
		if (swatch === undefined) throw new Error('no swatch');
		swatch.dispatch('click');
		expect(styles).toEqual([`preview=${rose}`]);
		expect(view.row().classes.has('is-hidden')).toBe(false);
		// A rail brought back is told where to wait.
		expect(view.rail().sync).toHaveBeenLastCalledWith(256);
		view.rail().spec.onPick(320);
		view.panel.close();
		// The choice goes back first, since the measure may be of what it shows.
		expect(styles).toEqual([`preview=${rose}`, 'preview=']);
		expect(view.previewed).toEqual([320, 256]);
		expect(view.applied).toEqual([]);
	});
});
