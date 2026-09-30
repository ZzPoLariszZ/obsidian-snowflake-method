import { afterEach, describe, expect, it, vi } from 'vitest';

import { CorkboardDom, type CorkboardElement } from '../helpers/corkboard-dom';

const { notices, titles, fields, pickers } = vi.hoisted(() => ({
	notices: vi.fn(),
	titles: [] as string[],
	fields: [] as unknown[],
	pickers: [] as unknown[],
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

// The pickers are the real ones; what the form hands them is kept, so a test can pick as the list would.
vi.mock('../../src/ui/option-picker', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/ui/option-picker')>();
	return {
		...actual,
		buildOptionField: vi.fn((...args: Parameters<typeof actual.buildOptionField>) => {
			fields.push(args[2]);
			return actual.buildOptionField(...args);
		}),
		buildOptionPicker: vi.fn((...args: Parameters<typeof actual.buildOptionPicker>) => {
			pickers.push(args[2]);
			return actual.buildOptionPicker(...args);
		}),
	};
});

import type { App } from 'obsidian';

import { FREEFORM_SIZE } from '../../src/domain';
import {
	FREEFORM_PICK_ROWS,
	FreeformEdgeFormModal,
	FreeformGeometryModal,
	FreeformNodeFormModal,
	FreeformTextModal,
	FreeformViewFormModal,
	type FreeformEdgeDraft,
	type FreeformNodeDraft,
	type FreeformNodeFormOptions,
	type FreeformViewFormOptions,
} from '../../src/ui/freeform-forms';
import type { OptionFieldConfig, OptionPickerConfig } from '../../src/ui/option-picker';

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
	fields.length = 0;
	pickers.length = 0;
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

describe('the form nodes are added through', () => {
	const candidates = {
		scene: [
			{ id: 'scene-1', name: 'Arrival', onView: true },
			{ id: 'scene-2', name: 'Departure', onView: false },
			{ id: 'scene-3', name: 'Return', onView: false },
		],
		character: [{ id: 'char-1', name: 'Anna', onView: false }],
		location: [],
	};
	const nodeForm = (options: Partial<FreeformNodeFormOptions> = {}, room = 10): FreeformNodeFormModal =>
		new FreeformNodeFormModal(app, t, {
			types: [
				{ value: 'scene', label: 'Scene', section: 'entity' },
				{ value: 'character', label: 'Character', section: 'entity' },
				{ value: 'location', label: 'Location', section: 'entity' },
				{ value: 'text', label: 'Text', section: 'canvas' },
			],
			candidates: (type) => candidates[type as keyof typeof candidates] ?? [],
			room: () => room,
			...options,
		}, () => Promise.resolve());
	const typeField = (): OptionFieldConfig => fields[fields.length - 1] as OptionFieldConfig;
	const nodesPicker = (): OptionPickerConfig => pickers[pickers.length - 1] as OptionPickerConfig;
	const collectDraft = (form: unknown): FreeformNodeDraft | null => (form as { collectValue(): FreeformNodeDraft | null }).collectValue();
	const summary = (form: unknown): CorkboardElement => content(form).querySelector('.snowflake-method-field-warning')!;
	const pickRow = (form: unknown): CorkboardElement => content(form).querySelector('.snowflake-method-freeform-node-pick')!;

	it('is titled Add node, names its two fields, and offers the types in their two groups', () => {
		const form = nodeForm();
		build(form);
		expect(titles).toEqual(['freeformCanvas.node.add']);
		expect((form as unknown as { submitLabelKey: string }).submitLabelKey).toBe('common.add');
		expect(content(form).querySelectorAll('.setting-item').map((row) => row.getAttribute('data-name'))).toEqual([
			'freeformCanvas.node.type', 'freeformCanvas.node.pick',
		]);
		expect(typeField().label).toBe('freeformCanvas.node.type');
		expect(typeField().required).toBe(true);
		expect(typeField().options().map((option) => [option.value, option.section])).toEqual([
			['scene', 'freeformCanvas.node.section.entity'],
			['character', 'freeformCanvas.node.section.entity'],
			['location', 'freeformCanvas.node.section.entity'],
			['text', 'freeformCanvas.node.section.canvas'],
		]);
		// No type yet: the nodes field stands hidden, and nothing can be handed back.
		expect(typeField().value()).toBe('');
		expect(pickRow(form).classes.has('is-hidden')).toBe(true);
		expect(collectDraft(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.node.typePlaceholder');
	});

	it('lists the notes of the type chosen, those not on the view first and apart from those on it, capped for a long list', () => {
		const form = nodeForm();
		build(form);
		typeField().choose('scene');
		expect(pickRow(form).classes.has('is-hidden')).toBe(false);
		// Built afresh for the type, so it offers what the type holds: a field decides as it is built whether it has anything to offer.
		expect(pickers).toHaveLength(2);
		expect(content(form).querySelectorAll('.snowflake-method-option-picker-input')[1]!.disabled).toBe(false);
		expect(nodesPicker().label).toBe('freeformCanvas.node.pick');
		expect(nodesPicker().placeholder).toBe('freeformCanvas.node.pickPlaceholder');
		expect(nodesPicker().emptyPlaceholder).toBe('freeformCanvas.node.pickEmpty');
		expect(nodesPicker().cap?.rows).toBe(FREEFORM_PICK_ROWS);
		expect(nodesPicker().cap?.more(7)).toBe('freeformCanvas.node.pickMore(count=7)');
		expect(nodesPicker().options().map((option) => [option.value, option.section])).toEqual([
			['scene-2', 'freeformCanvas.node.notOnView'],
			['scene-3', 'freeformCanvas.node.notOnView'],
			['scene-1', 'freeformCanvas.node.onView'],
		]);
		expect(nodesPicker().removeLabel('Arrival')).toBe('form.record.removeLine(name=Arrival)');
		// With none on the view, the list needs no headings.
		typeField().choose('character');
		expect(nodesPicker().options()).toEqual([{ value: 'char-1', label: 'Anna' }]);
		// Text asks nothing more.
		typeField().choose('text');
		expect(pickRow(form).classes.has('is-hidden')).toBe(true);
		expect(collectDraft(form)).toEqual({ type: 'text' });
	});

	it('says how many are chosen and how many more the view has room for, and refuses none and too many', () => {
		const form = nodeForm({}, 2);
		build(form);
		typeField().choose('scene');
		expect(summary(form).textContent).toBe('freeformCanvas.node.summary(chosen=0,left=2)');
		expect(summary(form).classes.has('is-notice')).toBe(true);
		expect(collectDraft(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.node.required');
		nodesPicker().pick('scene-2');
		expect(summary(form).textContent).toBe('freeformCanvas.node.summary(chosen=1,left=1)');
		expect(collectDraft(form)).toEqual({ type: 'entity', kind: 'scene', nodes: [{ id: 'scene-2', name: 'Departure' }] });
		nodesPicker().pick('scene-3');
		nodesPicker().pick('scene-1');
		expect(summary(form).textContent).toBe('freeformCanvas.node.limitSome(left=2)');
		expect(summary(form).classes.has('is-notice')).toBe(false);
		expect(collectDraft(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.node.limitSome(left=2)');
		nodesPicker().unpick('scene-1');
		expect(collectDraft(form)?.type === 'entity' && collectDraft(form)).toMatchObject({ nodes: [{ id: 'scene-2' }, { id: 'scene-3' }] });
	});

	it('forgets what was picked when the type changes, and opens on the type it was given', () => {
		const form = nodeForm({ initialType: 'scene' });
		build(form);
		expect(typeField().value()).toBe('scene');
		nodesPicker().pick('scene-2');
		expect(nodesPicker().picked()).toEqual(['scene-2']);
		typeField().choose('character');
		expect(nodesPicker().picked()).toEqual([]);
		// The same type again changes nothing.
		nodesPicker().pick('char-1');
		typeField().choose('character');
		expect(nodesPicker().picked()).toEqual(['char-1']);
	});
});

describe('the form a node’s size and place are set through', () => {
	const geometryForm = (initial = { x: 10, y: 20, width: 300, height: 200 }): FreeformGeometryModal =>
		new FreeformGeometryModal(app, t, initial, { width: 96, height: 48 }, () => Promise.resolve());
	const collectGeometry = (form: unknown) => (form as { collectValue(): unknown }).collectValue();
	const inputs = (form: unknown): CorkboardElement[] => content(form).querySelectorAll('input');

	it('names its four fields and shows what the node measures now', () => {
		const form = geometryForm();
		build(form);
		expect(titles).toEqual(['freeformCanvas.geometry.title']);
		expect((form as unknown as { submitLabelKey: string }).submitLabelKey).toBe('common.save');
		expect(content(form).querySelector('p')!.textContent).toBe('freeformCanvas.geometry.hint');
		expect(content(form).querySelectorAll('.setting-item').map((row) => row.getAttribute('data-name'))).toEqual([
			'freeformCanvas.geometry.x', 'freeformCanvas.geometry.y', 'freeformCanvas.geometry.width', 'freeformCanvas.geometry.height',
		]);
		expect(inputs(form).map((input) => input.value)).toEqual(['10', '20', '300', '200']);
		expect(inputs(form).map((input) => input.getAttribute('aria-label'))).toEqual([
			'freeformCanvas.geometry.x', 'freeformCanvas.geometry.y', 'freeformCanvas.geometry.width', 'freeformCanvas.geometry.height',
		]);
		expect(collectGeometry(form)).toEqual({ x: 10, y: 20, width: 300, height: 200 });
	});

	it('takes whole numbers alone, and no size under the least a node may be', () => {
		const form = geometryForm();
		build(form);
		const [x, , width, height] = inputs(form) as [CorkboardElement, CorkboardElement, CorkboardElement, CorkboardElement];
		type(x, ' -40 ');
		expect(collectGeometry(form)).toEqual({ x: -40, y: 20, width: 300, height: 200 });
		type(x, '1.5');
		expect(collectGeometry(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.geometry.invalid');
		type(x, '');
		expect(collectGeometry(form)).toBeNull();
		type(x, 'abc');
		expect(collectGeometry(form)).toBeNull();
		type(x, '0');
		type(width, '95');
		expect(collectGeometry(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.geometry.tooSmall(width=96,height=48)');
		type(width, '96');
		type(height, '48');
		expect(collectGeometry(form)).toEqual({ x: 0, y: 20, width: 96, height: 48 });
		type(height, String(FREEFORM_SIZE.max + 1));
		expect(collectGeometry(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.geometry.invalid');
	});
});

describe('the form a line is edited through', () => {
	const edgeForm = (initial: FreeformEdgeDraft = { label: '', arrow: 'end', line: 'solid' }, limit = 200): FreeformEdgeFormModal =>
		new FreeformEdgeFormModal(app, t, initial, limit, () => Promise.resolve());
	const collectEdge = (form: unknown): FreeformEdgeDraft | null => (form as { collectValue(): FreeformEdgeDraft | null }).collectValue();

	it('says first that a line joins nothing in the notes, then names its three fields', () => {
		const form = edgeForm({ label: 'leads to', arrow: 'both', line: 'dashed' });
		build(form);
		expect(titles).toEqual(['freeformCanvas.edge.edit']);
		expect((form as unknown as { submitLabelKey: string }).submitLabelKey).toBe('common.save');
		expect(content(form).querySelector('p')!.textContent).toBe('freeformCanvas.edge.hint');
		expect(content(form).querySelectorAll('.setting-item').map((row) => row.getAttribute('data-name'))).toEqual([
			'freeformCanvas.edge.label', 'freeformCanvas.edge.arrow', 'freeformCanvas.edge.line',
		]);
		const label = content(form).querySelector('input')!;
		expect(label.value).toBe('leads to');
		expect(label.getAttribute('aria-label')).toBe('freeformCanvas.edge.label');
		expect(label.getAttribute('maxlength')).toBe('200');
		const selects = content(form).querySelectorAll('select');
		expect(selects.map((select) => select.getAttribute('aria-label'))).toEqual(['freeformCanvas.edge.arrow', 'freeformCanvas.edge.line']);
		expect(selects[0]!.querySelectorAll('option').map((option) => [option.value, option.textContent, option.selected])).toEqual([
			['none', 'freeformCanvas.edge.arrow.none', false],
			['end', 'freeformCanvas.edge.arrow.end', false],
			['both', 'freeformCanvas.edge.arrow.both', true],
		]);
		expect(selects[1]!.querySelectorAll('option').map((option) => [option.value, option.selected])).toEqual([
			['solid', false], ['dashed', true], ['dotted', false],
		]);
		expect(collectEdge(form)).toEqual({ label: 'leads to', arrow: 'both', line: 'dashed' });
	});

	it('hands back what was chosen, the words trimmed, and refuses words past the limit', () => {
		const form = edgeForm({ label: '', arrow: 'end', line: 'solid' }, 8);
		build(form);
		type(content(form).querySelector('input')!, '  then  ');
		const [arrow, line] = content(form).querySelectorAll('select') as [CorkboardElement, CorkboardElement];
		arrow.value = 'none';
		arrow.dispatch('change');
		line.value = 'dotted';
		line.dispatch('change');
		expect(collectEdge(form)).toEqual({ label: 'then', arrow: 'none', line: 'dotted' });
		type(content(form).querySelector('input')!, 'far too long');
		expect(collectEdge(form)).toBeNull();
		expect(notices).toHaveBeenLastCalledWith('freeformCanvas.edge.refused');
	});
});
