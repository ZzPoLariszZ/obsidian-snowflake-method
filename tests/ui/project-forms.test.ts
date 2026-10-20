import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { notices } = vi.hoisted(() => ({ notices: vi.fn() }));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		readonly dom = new CorkboardDom();
		modalEl = this.dom.container.createDiv();
		titleEl = this.modalEl.createDiv();
		contentEl = this.modalEl.createDiv();
		setTitle(): void {}
		onOpen(): void {}
		onClose(): void {}
		open(): void { this.onOpen(); }
		close(): void { this.onClose(); }
	}
	interface FieldLike {
		inputEl: CorkboardElement;
		setPlaceholder(value: string): FieldLike;
		setValue(value: string): FieldLike;
		onChange(handler: (value: string) => void): FieldLike;
	}
	interface DropdownLike {
		selectEl: CorkboardElement;
		addOption(value: string, label: string): DropdownLike;
		setValue(value: string): DropdownLike;
		onChange(handler: (value: string) => void): DropdownLike;
	}
	class Setting {
		settingEl: CorkboardElement;
		nameEl: CorkboardElement;
		descEl: CorkboardElement;
		controlEl: CorkboardElement;
		constructor(container: CorkboardElement) {
			this.settingEl = container.createDiv({ cls: 'setting-item' });
			const info = this.settingEl.createDiv();
			this.nameEl = info.createDiv();
			this.descEl = info.createDiv();
			this.controlEl = this.settingEl.createDiv();
		}
		setName(name: string): this { this.nameEl.setText(name); return this; }
		setDesc(desc: string): this { this.descEl.setText(desc); return this; }
		addText(build: (component: FieldLike) => void): this {
			const inputEl = this.controlEl.createEl('input');
			const component: FieldLike = {
				inputEl,
				setPlaceholder: (value) => { inputEl.setAttribute('placeholder', value); return component; },
				setValue: (value) => { inputEl.value = value; return component; },
				onChange: (handler) => { inputEl.addEventListener('input', () => { handler(inputEl.value); }); return component; },
			};
			build(component);
			return this;
		}
		addDropdown(build: (component: DropdownLike) => void): this {
			const selectEl = this.controlEl.createEl('select');
			const component: DropdownLike = {
				selectEl,
				addOption: (value, label) => { selectEl.createEl('option', { value, text: label }); return component; },
				setValue: (value) => { selectEl.value = value; return component; },
				onChange: (handler) => { selectEl.addEventListener('change', () => { handler(selectEl.value); }); return component; },
			};
			build(component);
			return this;
		}
	}
	return {
		...runtime,
		Modal,
		Setting,
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { App } from 'obsidian';

import {
	CreateProjectModal,
	SetSeriesModal,
	type CreateProjectRequest,
	type SeriesChoice,
	type Translate,
} from '../../src/ui/modals';

const app = {} as App;
const t: Translate = (key) => key;

interface FormLike<T> {
	contentEl: CorkboardElement;
	collectValue(): T | null;
}

/** The three boxes a project form offers, told apart by what they are for. */
function fields(form: FormLike<unknown>): {
	name: CorkboardElement | null;
	series: CorkboardElement;
	book: CorkboardElement;
	chevron: CorkboardElement;
} {
	const seriesField = form.contentEl.querySelector('.snowflake-method-series-field');
	if (seriesField === null) throw new Error('no series field');
	const inputs = form.contentEl.querySelectorAll('input') as (CorkboardElement & { type?: string })[];
	const book = inputs.find((input) => input.type === 'number');
	if (book === undefined) throw new Error('no book field');
	const series = seriesField.querySelector('input');
	const chevron = seriesField.querySelector('button');
	if (series === null || chevron === null) throw new Error('series field incomplete');
	const name = inputs.find((input) => input !== series && input !== book) ?? null;
	return { name, series, book, chevron };
}

function type(input: CorkboardElement, value: string): void {
	input.value = value;
	input.dispatch('input');
}

beforeEach(() => {
	vi.stubGlobal('window', { setTimeout: (): number => 0 });
});
afterEach(() => {
	notices.mockClear();
	vi.unstubAllGlobals();
});

describe('CreateProjectModal', () => {
	const sources = [
		{ path: 'Root/Other/Project.md', title: 'Other', series: null, locale: 'en' as const, archived: false },
		{ path: 'Root/Saga 1/Project.md', title: 'Saga 1', series: { name: 'Saga', book: 1 }, locale: 'en' as const, archived: false },
	];
	const open = (names: string[] = ['Saga'], offered = sources): FormLike<CreateProjectRequest> => {
		const form = new CreateProjectModal(app, t, 'en', ['Taken'], names, offered, () => Promise.resolve());
		form.open();
		return form as unknown as FormLike<CreateProjectRequest>;
	};
	const startFromRow = (form: FormLike<unknown>): CorkboardElement | null =>
		form.contentEl.querySelector('.snowflake-method-start-from-setting');

	it('makes a project in no series unless a series is named', () => {
		const form = open();
		const { name, series, book } = fields(form);
		if (name === null) throw new Error('no name field');
		type(name, 'Novel');
		expect(book.disabled).toBe(true);
		expect(form.collectValue()).toEqual({ title: 'Novel', locale: 'en', series: null, startFrom: null });
		type(series, 'Saga');
		expect(book.disabled).toBe(false);
		expect(form.collectValue()).toEqual({
			title: 'Novel',
			locale: 'en',
			series: { name: 'Saga', book: null },
			startFrom: null,
		});
		type(book, '2');
		expect(form.collectValue()).toEqual({
			title: 'Novel',
			locale: 'en',
			series: { name: 'Saga', book: 2 },
			startFrom: null,
		});
	});

	it('offers a project to start from only while there is one, blank first and the typed series’ books next', () => {
		expect(startFromRow(open(['Saga'], []))).toBeNull();
		const form = open();
		const row = startFromRow(form);
		if (row === null) throw new Error('no start-from row');
		expect(row.classes.has('snowflake-method-stacked-setting')).toBe(true);
		const picker = row.querySelector('.snowflake-method-option-picker-input') ?? row.querySelector('input');
		if (picker === null) throw new Error('no start-from field');
		// Blank is what the field shows until a project is chosen.
		expect(picker.value).toBe('modal.project.startFromNone');
		const { name, series } = fields(form);
		if (name === null) throw new Error('no name field');
		type(name, 'Novel');
		expect(form.collectValue()?.startFrom).toBeNull();
		type(series, 'Saga');
		// The field reads its options when it opens, so the series typed
		// after the form was drawn still heads the list with its books.
		const options = (form as unknown as { startFromField: unknown; sources: unknown });
		expect(options.startFromField).not.toBeNull();
	});

	it('refuses a book number that is not a whole number above zero', () => {
		const form = open();
		const { name, series, book } = fields(form);
		if (name === null) throw new Error('no name field');
		type(name, 'Novel');
		type(series, 'Saga');
		for (const bad of ['0', '1.5', '-2', 'two']) {
			type(book, bad);
			expect(form.collectValue()).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('modal.project.bookInvalid');
		}
	});

	it('keeps a typed series through the redraw a language change makes', () => {
		const form = open();
		const first = fields(form);
		type(first.series, 'Saga');
		type(first.book, '3');
		const select = form.contentEl.querySelector('select');
		if (select === null) throw new Error('no language field');
		select.value = 'zh-CN';
		select.dispatch('change');
		const redrawn = fields(form);
		expect(redrawn.series).not.toBe(first.series);
		expect(redrawn.series.value).toBe('Saga');
		expect(redrawn.book.value).toBe('3');
		expect(redrawn.book.disabled).toBe(false);
	});

	it('offers the chevron only while there is a series to offer', () => {
		expect(fields(open([])).chevron.disabled).toBe(true);
		expect(fields(open(['Saga'])).chevron.disabled).toBe(false);
	});
});

describe('SetSeriesModal', () => {
	const open = (current: { name: string; book: number | null } | null): FormLike<SeriesChoice> => {
		const form = new SetSeriesModal(app, t, current, ['Saga'], () => Promise.resolve());
		form.open();
		return form as unknown as FormLike<SeriesChoice>;
	};

	it('opens on the series the project stands in and answers what it is left holding', () => {
		const form = open({ name: 'Saga', book: 2 });
		const { series, book } = fields(form);
		expect(series.value).toBe('Saga');
		expect(book.value).toBe('2');
		expect(book.disabled).toBe(false);
		type(book, '4');
		expect(form.collectValue()).toEqual({ series: { name: 'Saga', book: 4 } });
	});

	it('answers no series for an emptied name, whatever the number says', () => {
		const form = open({ name: 'Saga', book: 2 });
		const { series, book } = fields(form);
		type(series, '   ');
		expect(book.disabled).toBe(true);
		expect(form.collectValue()).toEqual({ series: null });
	});

	it('starts empty for a project in no series, the number disabled until one is named', () => {
		const form = open(null);
		const { series, book } = fields(form);
		expect(series.value).toBe('');
		expect(book.disabled).toBe(true);
		type(series, 'Epic');
		type(book, 'x');
		expect(form.collectValue()).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('modal.project.bookInvalid');
	});
});
