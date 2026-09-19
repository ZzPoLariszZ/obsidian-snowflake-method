/**
 * The dialogs the beat sheet workspace opens: a sheet made from a template
 * or renamed, an act's label, and a beat's name and description. Each is a
 * labelled form, as every form the plugin opens is. The confirmations, the
 * picker a row moves by and the dialog refused words are kept in are the
 * timeline's own, which say nothing of timelines.
 */

import { Notice, Setting, type App } from 'obsidian';

import {
	BUILT_IN_BEAT_SHEET_TEMPLATE_IDS,
	isBuiltInBeatSheetTemplateId,
	type BeatSheetStructure,
	type BeatSheetTemplate,
	type BuiltInBeatSheetTemplate,
} from '../domain';
import type { BeatSheetTemplateChoice } from './beat-sheet-bridge';
import {
	SnowflakeFormModal,
	UniqueNameField,
	type SubmitHandler,
	type Translate,
} from './modals';
import { buildOptionField, type OptionPicker, type PickerOption } from './option-picker';
import { joinKey, splitKey } from './timeline-layout';

/** The value a template wears in the picker: which shelf it stands on, and its id there. */
export function templateOptionValue(choice: BeatSheetTemplateChoice): string {
	return joinKey(choice.kind, choice.id);
}

/** The choice a picker's value names, or null where it names nothing the form offers. */
export function readTemplateOption(value: string): BeatSheetTemplateChoice | null {
	const [kind, id] = splitKey(value);
	if (id === undefined || id.length === 0) return null;
	if (kind === 'built-in') return isBuiltInBeatSheetTemplateId(id) ? { kind, id } : null;
	return kind === 'project' ? { kind, id } : null;
}

const countBeats = (structure: BeatSheetStructure): number =>
	structure.acts.reduce((total, act) => total + act.beats.length, 0);

/** What the Add beat sheet form hands back. */
export interface BeatSheetDraft {
	name: string;
	template: BeatSheetTemplateChoice;
}

/** What the templates on offer are, asked for afresh so one made or deleted while the form stands is seen. */
export interface BeatSheetTemplateShelf {
	/** The presets, in the project's language. */
	builtIn: () => readonly BuiltInBeatSheetTemplate[];
	/** The project's own templates, as the file has them now. */
	project: () => readonly BeatSheetTemplate[];
}

/**
 * A sheet made: its name, and the template it starts from, typed into,
 * searched and picked from as a form's category is, the presets under one
 * heading and the project's own under another. A line under the field says
 * how much the pick holds, since a template is only a start, and under that
 * stands what the template's author wrote of it, set off as a quotation: the
 * words are theirs and not the form's.
 */
export class AddBeatSheetModal extends SnowflakeFormModal<BeatSheetDraft> {
	private nameValue = '';
	private readonly name: UniqueNameField;
	private choice: BeatSheetTemplateChoice = { kind: 'built-in', id: BUILT_IN_BEAT_SHEET_TEMPLATE_IDS[0] };
	private picker: OptionPicker | null = null;
	private summaryEl: HTMLElement | null = null;
	private descriptionEl: HTMLElement | null = null;
	private closed = false;

	constructor(
		app: App,
		t: Translate,
		private readonly options: {
			takenNames: readonly string[];
			shelf: BeatSheetTemplateShelf;
			/** What stands beside the template field, for a template of the project's own that is picked. */
			templateActions?: (host: HTMLElement, form: AddBeatSheetFormHandle) => void;
		},
		onSubmit: SubmitHandler<BeatSheetDraft>,
	) {
		super(app, t, t('beatSheet.sheet.add'), onSubmit, 'common.create');
		this.name = new UniqueNameField(options.takenNames, null, () => this.t('beatSheet.sheet.nameTaken'));
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.t('beatSheet.sheet.name'))
			.addText((text) => {
				inputEl = text.inputEl;
				text.setValue(this.nameValue).onChange((value) => {
					this.nameValue = value;
					this.name.show(value);
				});
			});
		this.name.attach(name.settingEl, inputEl, this.nameValue);
		const template = new Setting(this.contentEl)
			.setName(this.t('beatSheet.sheet.template'))
			.setDesc(this.t('beatSheet.sheet.templateHint'));
		template.settingEl.addClass('snowflake-method-beat-sheet-template-setting');
		const line = template.controlEl.createDiv({ cls: 'snowflake-method-beat-sheet-template-line' });
		this.picker?.destroy();
		this.picker = buildOptionField(
			this.app,
			line.createDiv({ cls: 'snowflake-method-timeline-picker' }),
			{
				options: () => this.templateOptions(),
				label: this.t('beatSheet.sheet.template'),
				placeholder: this.t('beatSheet.sheet.templatePlaceholder'),
				emptyPlaceholder: this.t('beatSheet.sheet.templatePlaceholder'),
				value: () => templateOptionValue(this.choice),
				choose: (value) => {
					const picked = readTemplateOption(value);
					if (picked === null) return;
					this.pick(picked);
				},
			},
		);
		this.options.templateActions?.(line, this.handle());
		this.summaryEl = template.controlEl.createDiv({ cls: 'snowflake-method-beat-sheet-template-summary' });
		this.descriptionEl = template.controlEl.createEl('blockquote', {
			cls: 'snowflake-method-beat-sheet-template-description is-hidden',
		});
		this.paintSummary();
	}

	/** The presets first, then the project's own, each shelf under its heading. */
	private templateOptions(): PickerOption[] {
		return [
			...this.options.shelf.builtIn().map((preset) => ({
				value: templateOptionValue({ kind: 'built-in', id: preset.id }),
				label: preset.name,
				section: this.t('beatSheet.template.section.builtIn'),
			})),
			...this.options.shelf.project().map((template) => ({
				value: templateOptionValue({ kind: 'project', id: template.id }),
				label: template.name,
				section: this.t('beatSheet.template.section.custom'),
			})),
		];
	}

	/** The structure the pick holds, or null for one the shelf no longer has. */
	private pickedStructure(): { structure: BeatSheetStructure; description: string } | null {
		const choice = this.choice;
		if (choice.kind === 'built-in') {
			const preset = this.options.shelf.builtIn().find((candidate) => candidate.id === choice.id);
			return preset === undefined ? null : { structure: preset.structure, description: '' };
		}
		const template = this.options.shelf.project().find((candidate) => candidate.id === choice.id);
		return template === undefined ? null : { structure: template, description: template.description };
	}

	private paintSummary(): void {
		const el = this.summaryEl;
		const quote = this.descriptionEl;
		if (el === null || quote === null) return;
		const picked = this.pickedStructure();
		el.setText(picked === null ? '' : this.t('beatSheet.sheet.templateSummary', {
			acts: picked.structure.acts.length,
			beats: countBeats(picked.structure),
		}));
		// A preset says nothing of itself, and neither does a template exported without a word: no quotation stands empty.
		const description = picked?.description.trim() ?? '';
		quote.setText(description);
		quote.toggleClass('is-hidden', description.length === 0);
	}

	/** Who beside the field wants to hear the pick move. */
	private readonly choiceListeners = new Set<() => void>();

	/** The pick moved: the line under the field says what it holds now, and whoever stands beside it hears. */
	private pick(choice: BeatSheetTemplateChoice): void {
		this.choice = choice;
		this.paintSummary();
		for (const listener of [...this.choiceListeners]) listener();
	}

	/** What the workspace may ask of the form while it stands, for what it puts beside the template field. */
	private handle(): AddBeatSheetFormHandle {
		return {
			choice: () => this.choice,
			closed: () => this.closed,
			choose: (choice) => {
				this.pick(choice);
				this.picker?.refresh();
			},
			onChoice: (listener) => {
				this.choiceListeners.add(listener);
			},
		};
	}

	onClose(): void {
		this.closed = true;
		this.picker?.destroy();
		this.picker = null;
		this.summaryEl = null;
		this.descriptionEl = null;
		this.choiceListeners.clear();
		super.onClose();
	}

	protected collectValue(): BeatSheetDraft | null {
		const name = this.nameValue.trim();
		if (name.length === 0) {
			new Notice(this.t('beatSheet.sheet.nameRequired'));
			return null;
		}
		const objection = this.name.objection(name);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}
		if (this.pickedStructure() === null) {
			new Notice(this.t('beatSheet.sheet.templateGone'));
			return null;
		}
		return { name, template: this.choice };
	}
}

/** What stands beside the template field may read and move the form's pick. */
export interface AddBeatSheetFormHandle {
	choice: () => BeatSheetTemplateChoice;
	closed: () => boolean;
	choose: (choice: BeatSheetTemplateChoice) => void;
	onChoice: (listener: () => void) => void;
}

/** A sheet edited: its name, with Delete at the start of the foot across from Save. */
export class EditBeatSheetModal extends SnowflakeFormModal<string> {
	private nameValue: string;
	private readonly name: UniqueNameField;
	private closed = false;

	constructor(
		app: App,
		t: Translate,
		private readonly options: {
			initial: string;
			takenNames: readonly string[];
			/** Takes the sheet out, confirmation and all; true when it went. */
			deleteSheet: () => Promise<boolean>;
		},
		onSubmit: SubmitHandler<string>,
	) {
		super(app, t, t('beatSheet.sheet.edit'), onSubmit, 'common.save');
		this.nameValue = options.initial;
		this.name = new UniqueNameField(options.takenNames, options.initial, () => this.t('beatSheet.sheet.nameTaken'));
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		let inputEl: HTMLInputElement | null = null;
		const name = new Setting(this.contentEl)
			.setName(this.t('beatSheet.sheet.name'))
			.addText((text) => {
				inputEl = text.inputEl;
				text.setValue(this.nameValue).onChange((value) => {
					this.nameValue = value;
					this.name.show(value);
				});
			});
		this.name.attach(name.settingEl, inputEl, this.nameValue);
	}

	protected leadingActions(actions: HTMLElement): void {
		const button = actions.createEl('button', {
			cls: 'mod-warning snowflake-method-modal-leading-action',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			if (this.closed) return;
			void this.options.deleteSheet().then((gone) => {
				if (gone && !this.closed) this.close();
			});
		});
	}

	protected collectValue(): string | null {
		const name = this.nameValue.trim();
		if (name.length === 0) {
			new Notice(this.t('beatSheet.sheet.nameRequired'));
			return null;
		}
		const objection = this.name.objection(name);
		if (objection !== null) {
			new Notice(objection);
			return null;
		}
		return name;
	}

	onClose(): void {
		this.closed = true;
		super.onClose();
	}
}

/** An act made or edited: its label alone, which it may go without, since its number is read off its place. */
export class ActFormModal extends SnowflakeFormModal<string> {
	private label: string;

	constructor(
		app: App,
		t: Translate,
		options: { mode: 'add' | 'edit'; initial: string },
		onSubmit: SubmitHandler<string>,
	) {
		super(
			app,
			t,
			t(options.mode === 'add' ? 'beatSheet.act.add' : 'beatSheet.act.edit'),
			onSubmit,
			options.mode === 'add' ? 'common.create' : 'common.save',
		);
		this.label = options.initial;
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		new Setting(this.contentEl)
			.setName(this.t('beatSheet.act.label'))
			.setDesc(this.t('beatSheet.act.labelHint'))
			.addText((text) => {
				text.setValue(this.label).onChange((value) => {
					this.label = value;
				});
			});
	}

	protected collectValue(): string {
		return this.label.trim();
	}
}

/** What the beat forms hand back. */
export interface BeatDraft {
	name: string;
	description: string;
}

/**
 * A beat made or edited. A beat is no note, so its name and its main
 * description are the form's to keep: a write the project refuses leaves the
 * form standing with the words in it, since nowhere else holds them.
 */
export class BeatFormModal extends SnowflakeFormModal<BeatDraft> {
	private readonly value: BeatDraft;
	private descriptionSetting: Setting | null = null;
	private revealFrame: number | null = null;

	constructor(
		app: App,
		t: Translate,
		private readonly options: { mode: 'add' | 'edit'; initial: BeatDraft; reveal?: 'description' },
		onSubmit: SubmitHandler<BeatDraft>,
	) {
		super(
			app,
			t,
			t(options.mode === 'add' ? 'beatSheet.beat.add' : 'beatSheet.beat.edit'),
			onSubmit,
			options.mode === 'add' ? 'common.create' : 'common.save',
		);
		this.value = { ...options.initial };
		this.modalEl.addClass('snowflake-method-compact-form-modal');
	}

	protected buildForm(): void {
		this.contentEl.addClass('snowflake-method-project-form');
		new Setting(this.contentEl)
			.setName(this.t('beatSheet.beat.name'))
			.addText((text) => {
				text.setValue(this.value.name).onChange((value) => {
					this.value.name = value;
				});
			});
		this.descriptionSetting = new Setting(this.contentEl)
			.setName(this.t('form.description'))
			.addTextArea((area) => {
				area
					.setPlaceholder(this.t('form.description.placeholder'))
					.setValue(this.value.description)
					.onChange((value) => {
						this.value.description = value;
					});
			});
		this.descriptionSetting.settingEl.addClass('snowflake-method-beat-sheet-description-setting');
	}

	onOpen(): void {
		super.onOpen();
		if (this.options.reveal === 'description') this.revealDescription();
	}

	/** Opens on the description, the way a time's form does when its description was what was pressed. */
	private revealDescription(): void {
		const modalWindow = this.modalEl.win;
		if (this.revealFrame !== null) modalWindow.cancelAnimationFrame(this.revealFrame);
		// Let the form finish its initial layout and focus cleanup before moving to the row.
		this.revealFrame = modalWindow.requestAnimationFrame(() => {
			this.revealFrame = modalWindow.requestAnimationFrame(() => {
				this.revealFrame = null;
				const setting = this.descriptionSetting;
				if (setting === null || !setting.settingEl.isConnected) return;
				setting.controlEl.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
			});
		});
	}

	onClose(): void {
		if (this.revealFrame !== null) {
			this.modalEl.win.cancelAnimationFrame(this.revealFrame);
			this.revealFrame = null;
		}
		this.descriptionSetting = null;
		super.onClose();
	}

	protected collectValue(): BeatDraft | null {
		const name = this.value.name.trim();
		if (name.length === 0) {
			new Notice(this.t('beatSheet.beat.nameRequired'));
			return null;
		}
		return { name, description: this.value.description.trim() };
	}
}
