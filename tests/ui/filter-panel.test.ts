import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';

import { FilterPanel } from '../../src/ui/filter-panel';
import { MACARON_COLORS } from '../../src/domain/macaron';
import type { FilterOptionRow, FilterRangeRow } from '../../src/ui/filter-rows';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

// Positioning is independent of the range fields' draft and confirm behavior.
vi.mock('../../src/ui/anchored-panel', () => ({
	followAnchor: () => () => undefined,
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
