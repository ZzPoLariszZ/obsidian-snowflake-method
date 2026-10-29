import type { App } from 'obsidian';
import { Platform } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildOptionField, type OptionFieldConfig } from '../../src/ui/option-picker';
import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
// The framework's suggest as the tests know it, which keeps the one built last.
import { AbstractInputSuggest } from '../helpers/obsidian-runtime';

const views = [
	{ value: 'scene', label: 'Scene view' },
	{ value: 'character', label: 'Character view' },
];

/** The field's list, through the doors the framework uses: it reads the field on every input event, and on focus. */
interface ListDoor {
	getSuggestions(query: string): unknown[];
	showAllSuggestions(): void;
	close(): void;
}

function field(extra: Partial<OptionFieldConfig> = {}): CorkboardElement {
	const dom = new CorkboardDom();
	const host = dom.container.createDiv();
	buildOptionField({} as App, host as unknown as HTMLElement, {
		options: () => views,
		label: 'View',
		placeholder: 'Pick a view',
		emptyPlaceholder: 'No views yet',
		value: () => 'scene',
		choose: () => undefined,
		...extra,
	});
	const input = host.querySelector('.snowflake-method-option-picker-input');
	if (input === null) throw new Error('the field has no input');
	return input;
}

describe('a one-value field on a touch screen', () => {
	afterEach(() => {
		Platform.isMobile = false;
	});

	it('selects its value on the way in on the desktop, so typing replaces it', () => {
		const input = field();
		const select = vi.spyOn(input, 'select');
		input.dispatch('focus');
		expect(select).toHaveBeenCalledTimes(1);
		expect(input.readOnly).toBe(false);
		expect(input.getAttribute('inputmode')).toBeNull();
	});

	it('is a list on a phone when it only chooses among what it lists: no typing, no keyboard, nothing selected', () => {
		Platform.isMobile = true;
		const input = field();
		const select = vi.spyOn(input, 'select');
		expect(input.readOnly).toBe(true);
		expect(input.getAttribute('inputmode')).toBe('none');
		input.dispatch('focus');
		expect(select).not.toHaveBeenCalled();
		expect(input.value).toBe('Scene view');
	});

	it('keeps its keyboard on a phone when it can create, and the first thing typed replaces the value on show', () => {
		Platform.isMobile = true;
		const input = field({
			create: { label: (typed) => `Add ${typed}`, run: () => Promise.resolve(null) },
		});
		const select = vi.spyOn(input, 'select');
		expect(input.readOnly).toBe(false);
		input.dispatch('focus');
		expect(select).not.toHaveBeenCalled();
		expect(input.value).toBe('Scene view');
		input.dispatch('beforeinput');
		expect(input.value).toBe('');
		input.value = 'Ch';
		input.dispatch('beforeinput');
		expect(input.value).toBe('Ch');
		input.dispatch('blur');
		expect(input.value).toBe('Scene view');
	});

	it('replaces the value for a composed word too, which the keyboard starts before it inserts anything', () => {
		Platform.isMobile = true;
		const input = field({
			create: { label: (typed) => `Add ${typed}`, run: () => Promise.resolve(null) },
		});
		input.dispatch('focus');
		input.dispatch('compositionstart');
		expect(input.value).toBe('');
	});

	it('keeps its keyboard on a phone when its list is capped, since the search is the way through it', () => {
		Platform.isMobile = true;
		const input = field({ cap: { rows: 1, more: (count) => `${count} more` } });
		expect(input.readOnly).toBe(false);
		expect(input.getAttribute('inputmode')).toBeNull();
	});

	it('keeps every option on offer however often the field is read, until the writer types or the list closes', () => {
		Platform.isMobile = true;
		const input = field({ cap: { rows: 5, more: (count) => `${count} more` } });
		const list = AbstractInputSuggest.latest as unknown as ListDoor;
		input.dispatch('focus');
		// The framework reads the field on the input event the ask dispatches, and
		// on a touch screen once more half a second after the focus.
		expect(list.getSuggestions(input.value)).toHaveLength(2);
		expect(list.getSuggestions(input.value)).toHaveLength(2);
		input.dispatch('beforeinput');
		input.value = 'Ch';
		expect(list.getSuggestions(input.value)).toHaveLength(1);
		list.showAllSuggestions();
		expect(list.getSuggestions(input.value)).toHaveLength(2);
		list.close();
		expect(list.getSuggestions(input.value)).toHaveLength(1);
		input.dispatch('blur');
		expect(input.value).toBe('Scene view');
	});
});
