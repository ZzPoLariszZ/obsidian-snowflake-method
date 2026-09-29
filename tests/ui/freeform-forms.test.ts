import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { notices, titles } = vi.hoisted(() => ({
	notices: vi.fn(),
	titles: [] as string[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		readonly dom = new CorkboardDom();
		modalEl = this.dom.container.createDiv();
		contentEl = this.modalEl.createDiv();
		setTitle(title: string): void { titles.push(title); }
		onOpen(): void {}
		onClose(): void {}
		close(): void { this.onClose(); }
	}
	interface TextLike {
		inputEl: CorkboardElement;
		setValue(value: string): TextLike;
		onChange(handler: (value: string) => void): TextLike;
	}
	class Setting extends runtime.Setting {
		settingEl: CorkboardElement;
		controlEl: CorkboardElement;
		name = '';
		constructor(container: CorkboardElement) {
			super();
			this.settingEl = container.createDiv({ cls: 'setting-item' });
			this.controlEl = this.settingEl.createDiv();
		}
		override setName(name?: string): this {
			this.settingEl.setAttribute('data-name', name ?? '');
			return this;
		}
		addText(build: (component: TextLike) => void): this {
			const inputEl = this.controlEl.createEl('input');
			const component: TextLike = {
				inputEl,
				setValue: (value) => { inputEl.value = value; return component; },
				onChange: (handler) => { inputEl.addEventListener('input', () => { handler(inputEl.value); }); return component; },
			};
			build(component);
			return this;
		}
	}
	return {
		...runtime,
		Modal,
		Setting,
		FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} },
		SuggestModal: class extends Modal {},
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { App } from 'obsidian';

import { FreeformTextModal, FreeformViewFormModal, type FreeformViewFormOptions } from '../../src/ui/freeform-forms';

const app = {} as App;
const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(',')})`;

const collect = (form: unknown): string | null => (form as { collectValue(): string | null }).collectValue();
const build = (form: unknown): void => { (form as { buildForm(): void }).buildForm(); };
const content = (form: unknown): CorkboardElement => (form as { contentEl: CorkboardElement }).contentEl;
const lead = (form: unknown): CorkboardElement => {
	const actions = new CorkboardDom().container;
	(form as { leadingActions(el: CorkboardElement): void }).leadingActions(actions);
	return actions;
};
const type = (input: CorkboardElement, words: string): void => {
	input.value = words;
	input.dispatch('input');
};

const viewForm = (options: Partial<FreeformViewFormOptions> = {}): FreeformViewFormModal =>
	new FreeformViewFormModal(app, t, { mode: 'add', initial: '', takenNames: [], ...options }, () => Promise.resolve());

afterEach(() => {
	notices.mockClear();
	titles.length = 0;
});

describe('the freeform view form', () => {
	it('says Add where a view is made and Edit where one is edited, and names its one field', () => {
		const adding = viewForm();
		const editing = viewForm({ mode: 'edit', initial: 'Main' });
		// A create form is titled Add, never New.
		expect(titles).toEqual(['timeline.view.add', 'timeline.view.edit']);
		expect((adding as unknown as { submitLabelKey: string }).submitLabelKey).toBe('common.create');
		expect((editing as unknown as { submitLabelKey: string }).submitLabelKey).toBe('common.save');
		build(adding);
		expect(content(adding).querySelector('.setting-item')!.getAttribute('data-name')).toBe('timeline.view.name');
		expect(content(adding).querySelectorAll('input')).toHaveLength(1);
	});

	it('hands back the name trimmed, and refuses none and one another view answers to', () => {
		const form = viewForm({ takenNames: ['Second'] });
		build(form);
		const name = content(form).querySelector('input')!;
		expect(name.value).toBe('');
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameRequired');
		type(name, '  First  ');
		expect(collect(form)).toBe('First');
		type(name, 'second');
		expect(collect(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('timeline.view.nameTaken');
		// The objection stands under the field as it is typed, and marks the field.
		expect(content(form).querySelector('.snowflake-method-field-warning')!.textContent).toBe('timeline.view.nameTaken');
		expect(name.getAttribute('aria-invalid')).toBe('true');
		type(name, 'Third');
		expect(name.getAttribute('aria-invalid')).toBeNull();
	});

	it('lets a view keep the name it has, however it is written', () => {
		const form = viewForm({ mode: 'edit', initial: 'Main', takenNames: ['Second', 'Main'] });
		build(form);
		const name = content(form).querySelector('input')!;
		expect(name.value).toBe('Main');
		expect(collect(form)).toBe('Main');
		type(name, 'MAIN');
		expect(collect(form)).toBe('MAIN');
		// A view being made has no name of its own to keep.
		const adding = viewForm({ takenNames: ['Main'] });
		build(adding);
		type(content(adding).querySelector('input')!, 'main');
		expect(collect(adding)).toBeNull();
	});

	it('offers Delete at the foot only where a view is edited', () => {
		expect(lead(viewForm()).children).toHaveLength(0);
		const actions = lead(viewForm({ mode: 'edit', initial: 'Main', deleteView: () => Promise.resolve(false) }));
		const button = actions.querySelector('.snowflake-method-modal-leading-action')!;
		expect(button.classes.has('mod-warning')).toBe(true);
		expect(button.textContent).toBe('actions.delete');
		expect(button.getAttribute('type')).toBe('button');
	});

	it('closes on Delete only when the file says the view went', async () => {
		const answers: ((gone: boolean) => void)[] = [];
		const form = viewForm({ mode: 'edit', initial: 'Main', deleteView: () => new Promise<boolean>((resolve) => { answers.push(resolve); }) });
		const close = vi.spyOn(form, 'close');
		const button = lead(form).querySelector('.snowflake-method-modal-leading-action')!;
		button.dispatch('click');
		answers[0]!(false);
		await Promise.resolve();
		await Promise.resolve();
		expect(close).not.toHaveBeenCalled();
		button.dispatch('click');
		answers[1]!(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('asks nothing once closed, and does not close twice on an answer that comes late', async () => {
		const answers: ((gone: boolean) => void)[] = [];
		const deleteView = vi.fn(() => new Promise<boolean>((resolve) => { answers.push(resolve); }));
		const form = viewForm({ mode: 'edit', initial: 'Main', deleteView });
		const button = lead(form).querySelector('.snowflake-method-modal-leading-action')!;
		button.dispatch('click');
		form.close();
		const close = vi.spyOn(form, 'close');
		answers[0]!(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(close).not.toHaveBeenCalled();
		button.dispatch('click');
		expect(deleteView).toHaveBeenCalledTimes(1);
	});
});

describe('the dialog refused words are kept in', () => {
	it('shows every word that was refused under the view it was meant for, to be read and copied and not changed', () => {
		const form = new FreeformTextModal(app, t, [
			{ place: 'Act one', words: 'First\nsecond line' },
			{ place: 'Act two', words: 'Another' },
		]);
		form.onOpen();
		expect(titles).toEqual(['freeformCanvas.text.unsaved']);
		const root = content(form);
		expect(root.querySelector('p')!.textContent).toBe('freeformCanvas.text.refused');
		expect(root.querySelectorAll('h3').map((heading) => heading.textContent)).toEqual(['Act one', 'Act two']);
		const kept = root.querySelectorAll('textarea');
		expect(kept.map((area) => area.value)).toEqual(['First\nsecond line', 'Another']);
		expect(kept.every((area) => area.readOnly)).toBe(true);
		expect(kept.map((area) => area.getAttribute('aria-label'))).toEqual(['freeformCanvas.text.label', 'freeformCanvas.text.label']);
	});

	it('closes by its own button, and leaves nothing behind', () => {
		const form = new FreeformTextModal(app, t, [{ place: 'Act one', words: 'First' }]);
		form.onOpen();
		const close = vi.spyOn(form, 'close');
		const button = content(form).querySelector('button')!;
		expect(button.textContent).toBe('common.close');
		button.dispatch('click');
		expect(close).toHaveBeenCalledOnce();
		expect(content(form).children).toHaveLength(0);
		// Opened again, it is drawn once and not over what it drew before.
		form.onOpen();
		form.onOpen();
		expect(content(form).querySelectorAll('textarea')).toHaveLength(1);
	});
});
