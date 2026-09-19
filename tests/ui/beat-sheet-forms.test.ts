import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';
import type { OptionFieldConfig } from '../../src/ui/option-picker';

const { notices, fields } = vi.hoisted(() => ({
	notices: vi.fn(),
	fields: [] as { config: OptionFieldConfig; refresh: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
}));

vi.mock('obsidian', async (importOriginal) => {
	const runtime = await importOriginal<typeof import('../helpers/obsidian-runtime')>();
	class Modal extends runtime.Modal {
		readonly dom = new CorkboardDom();
		modalEl = this.dom.container.createDiv();
		contentEl = this.modalEl.createDiv();
		setTitle(): void {}
		onOpen(): void {}
		onClose(): void {}
		close(): void { this.onClose(); }
	}
	interface TextLike {
		inputEl: CorkboardElement;
		setPlaceholder(value: string): TextLike;
		setValue(value: string): TextLike;
		onChange(handler: (value: string) => void): TextLike;
	}
	class Setting extends runtime.Setting {
		settingEl: CorkboardElement;
		infoEl: CorkboardElement;
		controlEl: CorkboardElement;
		constructor(container: CorkboardElement) {
			super();
			this.settingEl = container.createDiv({ cls: 'setting-item' });
			this.infoEl = this.settingEl.createDiv();
			this.controlEl = this.settingEl.createDiv();
		}
		private field(tag: string, build: (component: TextLike) => void): this {
			const inputEl = this.controlEl.createEl(tag);
			const component: TextLike = {
				inputEl,
				setPlaceholder: (value) => { inputEl.setAttribute('placeholder', value); return component; },
				setValue: (value) => { inputEl.value = value; return component; },
				onChange: (handler) => { inputEl.addEventListener('input', () => { handler(inputEl.value); }); return component; },
			};
			build(component);
			return this;
		}
		addText(build: (component: TextLike) => void): this { return this.field('input', build); }
		addTextArea(build: (component: TextLike) => void): this { return this.field('textarea', build); }
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

// What the form hands its template field is kept, so a test can read the list and pick as the list would.
vi.mock('../../src/ui/option-picker', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/option-picker')>();
	return {
		...actual,
		buildOptionField: vi.fn((_app: unknown, _host: unknown, config: OptionFieldConfig) => {
			const field = { config, refresh: vi.fn(), destroy: vi.fn() };
			fields.push(field);
			return field;
		}),
	};
});

import type { App } from 'obsidian';

import { builtInBeatSheetTemplates, type BeatSheetTemplate } from '../../src/domain';
import {
	ActFormModal,
	AddBeatSheetModal,
	BeatFormModal,
	EditBeatSheetModal,
	readTemplateOption,
	templateOptionValue,
	type AddBeatSheetFormHandle,
	type BeatSheetDraft,
} from '../../src/ui/beat-sheet-forms';

const app = {} as App;
const t = (key: string, vars?: Record<string, string | number>): string =>
	vars === undefined ? key : `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(',')})`;
const collect = <T>(form: unknown): T | null => (form as { collectValue(): T | null }).collectValue();
const build = (form: unknown): void => { (form as { buildForm(): void }).buildForm(); };
const content = (form: unknown): CorkboardElement => (form as { contentEl: CorkboardElement }).contentEl;
const type = (input: CorkboardElement, words: string): void => {
	input.value = words;
	input.dispatch('input');
};

const template = (id: string, name: string, extra: Partial<BeatSheetTemplate> = {}): BeatSheetTemplate => ({
	id, name, description: '', createdAt: 1, updatedAt: 1,
	acts: [{ label: 'Opening', beats: [{ name: 'Hook', description: '' }, { name: 'Turn', description: '' }] }],
	...extra,
});

const addForm = (
	options: {
		takenNames?: string[];
		project?: () => readonly BeatSheetTemplate[];
		templateActions?: (host: HTMLElement, form: AddBeatSheetFormHandle) => void;
	} = {},
	onSubmit: (draft: BeatSheetDraft) => Promise<void> = () => Promise.resolve(),
): AddBeatSheetModal =>
	new AddBeatSheetModal(app, t, {
		takenNames: options.takenNames ?? [],
		shelf: { builtIn: () => builtInBeatSheetTemplates('en'), project: options.project ?? (() => []) },
		...(options.templateActions === undefined ? {} : { templateActions: options.templateActions }),
	}, onSubmit);

afterEach(() => {
	fields.length = 0;
	notices.mockClear();
	vi.unstubAllGlobals();
});

describe('the beat sheet forms', () => {
	it('carries a template choice through the picker as one value, and reads nothing the form does not offer', () => {
		for (const choice of [{ kind: 'built-in', id: 'save-the-cat' }, { kind: 'project', id: 'beat-sheet-template-1' }] as const) {
			expect(readTemplateOption(templateOptionValue(choice))).toEqual(choice);
		}
		expect(readTemplateOption(templateOptionValue({ kind: 'built-in', id: 'no-such-preset' as 'blank' }))).toBeNull();
		expect(readTemplateOption('')).toBeNull();
		expect(readTemplateOption('blank')).toBeNull();
		expect(readTemplateOption(templateOptionValue({ kind: 'project', id: '' }))).toBeNull();
	});

	describe('Add beat sheet', () => {
		it('offers the presets under one heading, Blank first, and the project\'s own under another', () => {
			const form = addForm({ project: () => [template('tpl-1', 'My shape')] });
			build(form);
			expect(fields).toHaveLength(1);
			const options = fields[0]!.config.options();
			expect(options.map((option) => option.section)).toEqual([
				...builtInBeatSheetTemplates('en').map(() => 'beatSheet.template.section.builtIn'),
				'beatSheet.template.section.custom',
			]);
			expect(options.map((option) => option.label)).toEqual([
				'Blank', 'Three Act', 'Kishōtenketsu', 'Story Circle', 'Save the Cat', 'Hero’s Journey', 'Romancing the Beat', 'My shape',
			]);
			// The field opens on Blank: a template is only a start, and the barest start asks nothing.
			expect(readTemplateOption(fields[0]!.config.value())).toEqual({ kind: 'built-in', id: 'blank' });
			expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
		});

		it('says under the field how much the pick holds, and under that what its author wrote of it, as a quotation', () => {
			const form = addForm({ project: () => [template('tpl-1', 'My shape', { description: ' Two turns.\nOne hollow. ' }), template('tpl-2', 'Wordless')] });
			build(form);
			const summary = content(form).querySelector('.snowflake-method-beat-sheet-template-summary')!;
			const quote = content(form).querySelector('.snowflake-method-beat-sheet-template-description')!;
			expect(quote.tag).toBe('blockquote');
			// A preset says nothing of itself, so no quotation stands empty under its count.
			expect(summary.textContent).toBe('beatSheet.sheet.templateSummary(acts=0,beats=0)');
			expect(quote.classes.has('is-hidden')).toBe(true);
			fields[0]!.config.choose(templateOptionValue({ kind: 'built-in', id: 'save-the-cat' }));
			expect(summary.textContent).toBe('beatSheet.sheet.templateSummary(acts=3,beats=15)');
			expect(quote.classes.has('is-hidden')).toBe(true);
			// The count stays the count alone; the author's words stand under it, in the lines they were written in.
			fields[0]!.config.choose(templateOptionValue({ kind: 'project', id: 'tpl-1' }));
			expect(summary.textContent).toBe('beatSheet.sheet.templateSummary(acts=1,beats=2)');
			expect(quote.textContent).toBe('Two turns.\nOne hollow.');
			expect(quote.classes.has('is-hidden')).toBe(false);
			// A value the list never offered moves nothing.
			fields[0]!.config.choose('nonsense');
			expect(quote.textContent).toBe('Two turns.\nOne hollow.');
			// A template exported without a word takes the quotation away again.
			fields[0]!.config.choose(templateOptionValue({ kind: 'project', id: 'tpl-2' }));
			expect(quote.textContent).toBe('');
			expect(quote.classes.has('is-hidden')).toBe(true);
		});

		it('lays the field and the line under it in the template setting\'s own control', () => {
			const form = addForm();
			build(form);
			const setting = content(form).querySelector('.snowflake-method-beat-sheet-template-setting')!;
			const line = setting.querySelector('.snowflake-method-beat-sheet-template-line')!;
			expect(line.querySelector('.snowflake-method-timeline-picker')).not.toBeNull();
			expect(line.parent!.children.map((child) => [...child.classes][0])).toEqual([
				'snowflake-method-beat-sheet-template-line',
				'snowflake-method-beat-sheet-template-summary',
				'snowflake-method-beat-sheet-template-description',
			]);
		});

		it('hands back the name and the pick, and refuses no name, a taken one, and a template that has gone', () => {
			let shelf = [template('tpl-1', 'My shape')];
			const form = addForm({ takenNames: ['Main'], project: () => shelf });
			build(form);
			const name = content(form).querySelector('input')!;
			expect(collect(form)).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('beatSheet.sheet.nameRequired');
			type(name, ' main ');
			expect(name.getAttribute('aria-invalid')).toBe('true');
			expect(collect(form)).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('beatSheet.sheet.nameTaken');
			type(name, '  Second draft ');
			expect(name.getAttribute('aria-invalid')).toBeNull();
			expect(collect(form)).toEqual({ name: 'Second draft', template: { kind: 'built-in', id: 'blank' } });
			fields[0]!.config.choose(templateOptionValue({ kind: 'project', id: 'tpl-1' }));
			expect(collect(form)).toEqual({ name: 'Second draft', template: { kind: 'project', id: 'tpl-1' } });
			// The template is deleted in another leaf while the form stands: nothing is made from what is not there.
			shelf = [];
			expect(collect(form)).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('beatSheet.sheet.templateGone');
		});

		it('lets what stands beside the field read the pick, move it, and hear it move, until the form closes', () => {
			const handles: AddBeatSheetFormHandle[] = [];
			const hosts: CorkboardElement[] = [];
			const form = addForm({
				project: () => [template('tpl-1', 'My shape')],
				templateActions: (host, handle) => {
					hosts.push(host as unknown as CorkboardElement);
					handles.push(handle);
				},
			});
			build(form);
			expect(hosts[0]!.classes.has('snowflake-method-beat-sheet-template-line')).toBe(true);
			const handle = handles[0]!;
			const heard = vi.fn();
			handle.onChoice(heard);
			expect(handle.choice()).toEqual({ kind: 'built-in', id: 'blank' });
			expect(handle.closed()).toBe(false);
			// The list picks: the one beside the field hears.
			fields[0]!.config.choose(templateOptionValue({ kind: 'project', id: 'tpl-1' }));
			expect(heard).toHaveBeenCalledTimes(1);
			expect(handle.choice()).toEqual({ kind: 'project', id: 'tpl-1' });
			// The one beside the field picks: the field shows it, the line says it, and the listeners hear that too.
			handle.choose({ kind: 'built-in', id: 'three-act' });
			expect(heard).toHaveBeenCalledTimes(2);
			expect(fields[0]!.refresh).toHaveBeenCalledTimes(1);
			expect(fields[0]!.config.value()).toBe(templateOptionValue({ kind: 'built-in', id: 'three-act' }));
			expect(content(form).querySelector('.snowflake-method-beat-sheet-template-summary')!.textContent).toBe(
				'beatSheet.sheet.templateSummary(acts=3,beats=10)',
			);
			form.close();
			expect(handle.closed()).toBe(true);
			expect(fields[0]!.destroy).toHaveBeenCalledTimes(1);
			handle.choose({ kind: 'built-in', id: 'blank' });
			expect(heard).toHaveBeenCalledTimes(2);
		});
	});

	describe('Edit beat sheet', () => {
		const editForm = (deleteSheet: () => Promise<boolean>): EditBeatSheetModal =>
			new EditBeatSheetModal(app, t, { initial: 'Main', takenNames: ['Second'], deleteSheet }, () => Promise.resolve());

		it('hands back the trimmed name, its own included, and refuses none and a taken one', () => {
			const form = editForm(() => Promise.resolve(false));
			build(form);
			const name = content(form).querySelector('input')!;
			expect(name.value).toBe('Main');
			expect(collect(form)).toBe('Main');
			type(name, 'MAIN');
			expect(collect(form)).toBe('MAIN');
			type(name, '  ');
			expect(collect(form)).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('beatSheet.sheet.nameRequired');
			type(name, 'second');
			expect(collect(form)).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('beatSheet.sheet.nameTaken');
		});

		it('closes on Delete only when the file says the sheet went', async () => {
			const answers: ((gone: boolean) => void)[] = [];
			const form = editForm(() => new Promise<boolean>((resolve) => { answers.push(resolve); }));
			const close = vi.spyOn(form, 'close');
			const actions = new CorkboardDom().container;
			(form as unknown as { leadingActions(el: CorkboardElement): void }).leadingActions(actions);
			const button = actions.querySelector('.snowflake-method-modal-leading-action')!;
			expect(button.classes.has('mod-warning')).toBe(true);
			expect(button.textContent).toBe('actions.delete');
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
			const deleteSheet = vi.fn(() => new Promise<boolean>((resolve) => { answers.push(resolve); }));
			const form = editForm(deleteSheet);
			const actions = new CorkboardDom().container;
			(form as unknown as { leadingActions(el: CorkboardElement): void }).leadingActions(actions);
			const button = actions.querySelector('.snowflake-method-modal-leading-action')!;
			button.dispatch('click');
			form.close();
			const close = vi.spyOn(form, 'close');
			answers[0]!(true);
			await Promise.resolve();
			await Promise.resolve();
			expect(close).not.toHaveBeenCalled();
			button.dispatch('click');
			expect(deleteSheet).toHaveBeenCalledTimes(1);
		});
	});

	it('takes an act\'s label trimmed, and none at all, since its number is read off its place', () => {
		const form = new ActFormModal(app, t, { mode: 'edit', initial: ' Setup ' }, () => Promise.resolve());
		build(form);
		const label = content(form).querySelector('input')!;
		expect(label.value).toBe(' Setup ');
		expect(collect<string>(form)).toBe('Setup');
		type(label, '   ');
		expect(collect<string>(form)).toBe('');
		expect(notices).not.toHaveBeenCalled();
	});

	describe('a beat\'s form', () => {
		it('hands back the name and the description trimmed, and refuses a beat with no name', () => {
			const form = new BeatFormModal(app, t, { mode: 'add', initial: { name: '', description: '' } }, () => Promise.resolve());
			build(form);
			const name = content(form).querySelector('input')!;
			const description = content(form).querySelector('textarea')!;
			expect(description.parent!.parent!.classes.has('snowflake-method-beat-sheet-description-setting')).toBe(true);
			type(description, '  The ordinary world.\n');
			expect(collect(form)).toBeNull();
			expect(notices).toHaveBeenLastCalledWith('beatSheet.beat.nameRequired');
			type(name, ' Opening Image ');
			expect(collect(form)).toEqual({ name: 'Opening Image', description: 'The ordinary world.' });
		});

		it('keeps its words over a write the project refused, so the form can be sent again', async () => {
			vi.stubGlobal('window', { setTimeout: () => 0 });
			const refusals = [new Error('beatSheet.beat.refused')];
			const sent: unknown[] = [];
			const form = new BeatFormModal(app, t, { mode: 'edit', initial: { name: 'Catalyst', description: 'A letter.' } }, (draft) => {
				sent.push(draft);
				const refusal = refusals.shift();
				return refusal === undefined ? Promise.resolve() : Promise.reject(refusal);
			});
			const close = vi.spyOn(form, 'close');
			form.onOpen();
			const send = (): Promise<boolean> => (form as unknown as { submit(): Promise<boolean> }).submit();
			await expect(send()).resolves.toBe(false);
			expect(notices).toHaveBeenLastCalledWith('beatSheet.beat.refused');
			expect(close).not.toHaveBeenCalled();
			expect(content(form).querySelector('input')!.value).toBe('Catalyst');
			expect(content(form).querySelector('textarea')!.value).toBe('A letter.');
			await expect(send()).resolves.toBe(true);
			expect(close).toHaveBeenCalledTimes(1);
			expect(sent).toEqual([
				{ name: 'Catalyst', description: 'A letter.' },
				{ name: 'Catalyst', description: 'A letter.' },
			]);
		});

		it('opens on the description when that was what was pressed, two frames on, and asks for no frame once closed', () => {
			vi.stubGlobal('window', { setTimeout: () => 0 });
			const form = new BeatFormModal(app, t, {
				mode: 'edit', initial: { name: 'Catalyst', description: '' }, reveal: 'description',
			}, () => Promise.resolve());
			const dom = (form as unknown as { dom: CorkboardDom }).dom;
			form.onOpen();
			const area = content(form).querySelector('textarea')!;
			expect(dom.doc.activeElement).not.toBe(area);
			dom.flushFrame();
			expect(dom.doc.activeElement).not.toBe(area);
			dom.flushFrame();
			expect(dom.doc.activeElement).toBe(area);

			const plain = new BeatFormModal(app, t, { mode: 'edit', initial: { name: 'Catalyst', description: '' } }, () => Promise.resolve());
			plain.onOpen();
			expect((plain as unknown as { dom: CorkboardDom }).dom.frames.size).toBe(0);

			const shut = new BeatFormModal(app, t, {
				mode: 'edit', initial: { name: 'Catalyst', description: '' }, reveal: 'description',
			}, () => Promise.resolve());
			const shutDom = (shut as unknown as { dom: CorkboardDom }).dom;
			shut.onOpen();
			expect(shutDom.frames.size).toBe(1);
			shut.close();
			expect(shutDom.frames.size).toBe(0);
		});
	});
});
