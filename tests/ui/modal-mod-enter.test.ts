import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import type { KeymapEventHandler } from '../helpers/obsidian-runtime';

const { notices, opened } = vi.hoisted(() => ({
	notices: vi.fn(),
	opened: [] as unknown[],
}));

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
		open(): void {
			opened.push(this);
			this.onOpen();
		}
		close(): void {
			this.onClose();
		}
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
	interface ColorLike {
		setValue(value: string): ColorLike;
		getValue(): string;
		onChange(handler: (value: string) => void): ColorLike;
	}
	/** The rows the dialogs draw, with the few members each of them reaches. */
	class Setting {
		settingEl: CorkboardElement & { toggle(on: boolean): void };
		nameEl: CorkboardElement;
		descEl: CorkboardElement & { appendText(text: string): void };
		controlEl: CorkboardElement;
		constructor(container: CorkboardElement) {
			this.settingEl = Object.assign(container.createDiv({ cls: 'setting-item' }), { toggle: (): void => undefined });
			const info = this.settingEl.createDiv();
			this.nameEl = info.createDiv();
			const descEl = info.createDiv();
			this.descEl = Object.assign(descEl, { appendText: (text: string): void => { descEl.textContent += text; } });
			this.controlEl = this.settingEl.createDiv();
		}
		setName(name: string): this { this.nameEl.setText(name); return this; }
		setDesc(desc: string): this { this.descEl.setText(desc); return this; }
		private field(tag: string, build: (component: FieldLike) => void): this {
			const inputEl = this.controlEl.createEl(tag);
			const component: FieldLike = {
				inputEl,
				setPlaceholder: (value) => { inputEl.setAttribute('placeholder', value); return component; },
				setValue: (value) => { inputEl.value = value; return component; },
				onChange: (handler) => { inputEl.addEventListener('input', () => { handler(inputEl.value); }); return component; },
			};
			build(component);
			return this;
		}
		addText(build: (component: FieldLike) => void): this { return this.field('input', build); }
		addTextArea(build: (component: FieldLike) => void): this { return this.field('textarea', build); }
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
		addColorPicker(build: (component: ColorLike) => void): this {
			let value = '';
			const component: ColorLike = {
				setValue: (next) => { value = next; return component; },
				getValue: () => value,
				onChange: () => component,
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
		getIconIds: (): string[] => [],
		Notice: class {
			constructor(message: string) { notices(message); }
		},
	};
});

import type { App } from 'obsidian';

import {
	SnowflakeFormModal,
	promptForChapterNumberRule,
	promptForCustomFieldTemplate,
	promptForDefinitionEdit,
	promptForDefinitionPath,
	promptForHighlightRule,
	promptForKindForm,
	type Translate,
} from '../../src/ui/modals';
import { submitOnModEnter } from '../../src/ui/modal-keys';

const app = {} as App;
const t: Translate = (key) => key;
async function settle(): Promise<void> {
	for (let at = 0; at < 20; at++) await Promise.resolve();
}

/** The Mod+Enter handlers a dialog's scope holds, and nothing else of it. */
const chords = (modal: unknown): KeymapEventHandler[] =>
	(modal as { scope: { keys: KeymapEventHandler[] } }).scope.keys.filter(
		(handler) => handler.key === 'Enter' && handler.modifiers?.length === 1 && handler.modifiers[0] === 'Mod',
	);
/** Strikes the chord as the app's keymap would, answering what the handler answered. */
const press = (modal: unknown, event: Partial<KeyboardEvent> = {}): boolean | void => {
	const [chord] = chords(modal);
	if (chord === undefined) throw new Error('the dialog carries no Mod+Enter handler');
	return chord.func({ isComposing: false, repeat: false, ...event } as KeyboardEvent, {});
};
const lastOpened = (): unknown => opened[opened.length - 1];
/** Whether a prompt has answered yet, read without waiting on it. */
const answered = async (pending: Promise<unknown>): Promise<boolean> => {
	const seen = vi.fn();
	void pending.then(seen, seen);
	await settle();
	return seen.mock.calls.length > 0;
};

class ProbeForm extends SnowflakeFormModal<string> {
	value = 'draft';
	constructor(onSubmit: (value: string) => Promise<void>) {
		super(app, t, 'Probe', onSubmit);
	}
	protected buildForm(): void {
		this.contentEl.createEl('input');
	}
	protected collectValue(): string | null {
		return this.value.length > 0 ? this.value : null;
	}
}

beforeEach(() => {
	vi.stubGlobal('window', { setTimeout: (): number => 0 });
});
afterEach(() => {
	opened.length = 0;
	notices.mockClear();
	vi.unstubAllGlobals();
});

describe('Mod+Enter in the dialogs', () => {
	it('submits a form from the dialog scope and keeps the key from the field under the caret', async () => {
		const onSubmit = vi.fn(() => Promise.resolve());
		const form = new ProbeForm(onSubmit);
		const close = vi.spyOn(form, 'close');
		form.open();
		expect(chords(form)).toHaveLength(1);
		expect(press(form)).toBe(false);
		await settle();
		expect(onSubmit).toHaveBeenCalledWith('draft');
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('leaves a chord struck mid-composition to the input method, and a held key to itself', async () => {
		const onSubmit = vi.fn(() => Promise.resolve());
		const form = new ProbeForm(onSubmit);
		form.open();
		expect(press(form, { isComposing: true })).not.toBe(false);
		expect(press(form, { repeat: true })).not.toBe(false);
		await settle();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('still owns the chord when the form refuses what it holds', async () => {
		const onSubmit = vi.fn(() => Promise.resolve());
		const form = new ProbeForm(onSubmit);
		form.value = '';
		form.open();
		expect(press(form)).toBe(false);
		await settle();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('wires one handler per dialog, and a second wiring replaces the first', () => {
		const onSubmit = vi.fn(() => Promise.resolve());
		const form = new ProbeForm(onSubmit);
		const other = vi.fn();
		submitOnModEnter(form, other);
		expect(chords(form)).toHaveLength(1);
		press(form);
		expect(other).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('creates a definition entry, and stays open on an empty name', async () => {
		const pending = promptForDefinitionPath(app, t, 'category', 'Heroes');
		press(lastOpened());
		await expect(pending).resolves.toEqual({ path: 'Heroes', description: '' });

		const empty = promptForDefinitionPath(app, t, 'category', '');
		press(lastOpened());
		expect(await answered(empty)).toBe(false);
	});

	it('saves a definition edit', async () => {
		const pending = promptForDefinitionEdit(app, t, 'category', 'Heroes/Knights', 'Sworn to the crown');
		press(lastOpened());
		await expect(pending).resolves.toEqual({ name: 'Knights', description: 'Sworn to the crown' });
	});

	it('answers the kind form, and keeps it open while the name is objected to', async () => {
		const initial = { name: 'Guilds', icon: '', description: 'Who pays whom' };
		const pending = promptForKindForm(app, t, { title: 'Add kind', submitLabel: 'Create', initial, objection: () => null });
		press(lastOpened());
		await expect(pending).resolves.toEqual(initial);

		const refused = promptForKindForm(app, t, { title: 'Add kind', submitLabel: 'Create', initial, objection: () => 'taken' });
		press(lastOpened());
		expect(await answered(refused)).toBe(false);
	});

	it('answers the template dialog', async () => {
		const pending = promptForCustomFieldTemplate(app, t, {
			title: 'Export as template',
			submitLabel: 'Save',
			rows: null,
			objection: () => null,
			initial: { name: 'Sheet', description: 'The usual columns' },
		});
		press(lastOpened());
		await expect(pending).resolves.toEqual({ name: 'Sheet', description: 'The usual columns', fields: [] });
	});

	it('answers the highlight rule dialog', async () => {
		const pending = promptForHighlightRule(app, t, {
			title: 'Edit rule',
			submitLabel: 'Save',
			initial: { id: 'r1', name: 'Names', kind: 'literal', patterns: ['Bob'], enabled: true, decoration: 'background', color: null },
		});
		press(lastOpened());
		await expect(pending).resolves.toEqual({ name: 'Names', kind: 'literal', patterns: ['Bob'], decoration: 'background', color: null });
	});

	it('answers the chapter number rule dialog', async () => {
		const pending = promptForChapterNumberRule(app, t, {
			title: 'Edit rule',
			submitLabel: 'Save',
			initial: { id: 'c1', kind: 'format', text: 'Chapter {nnnn}', seed: '', enabled: true },
		});
		press(lastOpened());
		await expect(pending).resolves.toEqual({ kind: 'format', text: 'Chapter {nnnn}', seed: '' });
	});
});
