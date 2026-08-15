import { Setting, type App } from 'obsidian';

import type { DetailsPropertyId, ProgressStatus } from '../domain';
import {
	parseTerm,
	renderTerm,
	type DetailsLine,
	type RecordLine,
	type RecordTerm,
} from '../templates';
import { FieldSuggest } from './field-suggest';
import {
	buildOptionPicker,
	optionsMatching,
	type PickerOption,
} from './option-picker';
import type { Translate } from './modals';

/**
 * The shared field kit every member form is built from: the universal rows
 * (status, aliases, categories) and the record editors for the body-stored
 * compound properties. Records are modal-only by design, so these editors are
 * the one place they are written.
 */

export interface DefinitionPathSource {
	/** Paths the definition file offers right now, in its heading order. */
	list(): readonly string[];
	/**
	 * Appends a new path, resolving to null on success and to a localized
	 * objection when the file refuses it.
	 */
	add(path: string): Promise<string | null>;
}

export interface RecordEditorContext {
	app: App;
	t: Translate;
	notice: (message: string) => void;
	/** Members a target can point at: every character, scene, and entity. */
	members: () => readonly PickerOption[];
	/** Time notes, for when and from and to. */
	times: () => readonly PickerOption[];
	/** Location notes, for at. */
	locations: () => readonly PickerOption[];
	/** The record labels of one definition file, with create-on-type. */
	labels: DefinitionPathSource;
}

/** A pill list with an inline input for free text: Enter or a comma adds. */
export class ChipListField {
	private values: string[];
	private chipsEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(
		initial: readonly string[],
		private readonly placeholder: string,
	) {
		this.values = [...initial];
	}

	attach(container: HTMLElement): void {
		const field = container.createDiv({ cls: 'snowflake-method-chip-field' });
		this.chipsEl = field.createDiv({ cls: 'snowflake-method-chip-list' });
		this.inputEl = field.createEl('input', {
			type: 'text',
			cls: 'snowflake-method-chip-input',
			attr: { placeholder: this.placeholder },
		});
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ',' || event.key === '、') {
				event.preventDefault();
				this.commitInput();
			} else if (
				event.key === 'Backspace' &&
				this.inputEl?.value === '' &&
				this.values.length > 0
			) {
				this.values.pop();
				this.renderChips();
			}
		});
		this.inputEl.addEventListener('blur', () => this.commitInput());
		this.renderChips();
	}

	get(): string[] {
		this.commitInput();
		return [...this.values];
	}

	private commitInput(): void {
		const raw = this.inputEl?.value ?? '';
		const trimmed = raw.trim();
		if (this.inputEl) this.inputEl.value = '';
		if (trimmed.length === 0) return;
		if (!this.values.includes(trimmed)) {
			this.values.push(trimmed);
			this.renderChips();
		}
	}

	private renderChips(): void {
		const chips = this.chipsEl;
		if (!chips) return;
		chips.empty();
		this.values.forEach((value, index) => {
			const chip = chips.createSpan({ cls: 'snowflake-method-chip' });
			chip.createSpan({ cls: 'snowflake-method-chip-label', text: value });
			const remove = chip.createEl('button', {
				cls: 'snowflake-method-chip-remove',
				text: '×',
				attr: { type: 'button', 'aria-label': value },
			});
			remove.addEventListener('click', () => {
				this.values.splice(index, 1);
				this.renderChips();
			});
		});
	}
}

/**
 * Category paths as a tag picker over the definition file's tree, with
 * create-on-type appending to the file first so the link the note will store
 * resolves. A picked path the file no longer lists still shows as a tag, so
 * nothing silently falls off a note in the picker.
 */
export class CategoryPathField {
	private values: string[];

	constructor(
		private readonly context: {
			app: App;
			t: Translate;
			notice: (message: string) => void;
			source: DefinitionPathSource;
		},
		initial: readonly string[],
	) {
		this.values = [...initial];
	}

	attach(container: HTMLElement): void {
		const t = this.context.t;
		buildOptionPicker(this.context.app, container, {
			options: () => {
				const known = this.context.source.list();
				const all = [...known];
				for (const value of this.values) {
					if (!known.includes(value)) all.push(value);
				}
				return all.map((path) => ({ value: path, label: path }));
			},
			label: t('form.category'),
			placeholder: t('form.category.placeholder'),
			emptyPlaceholder: t('form.category.placeholder'),
			picked: () => this.values,
			pick: (value) => {
				if (!this.values.includes(value)) this.values.push(value);
			},
			unpick: (value) => {
				this.values = this.values.filter((candidate) => candidate !== value);
			},
			removeLabel: (label) => t('form.category.remove', { name: label }),
			create: {
				label: (typed) => t('form.category.create', { name: typed }),
				run: async (typed) => {
					const path = typed.trim();
					if (path.length === 0) return null;
					const objection = await this.context.source.add(path);
					if (objection !== null) {
						this.context.notice(objection);
						return null;
					}
					return { value: path, label: path };
				},
			},
		});
	}

	get(): string[] {
		return [...this.values];
	}
}

/** The progress status dropdown, sharing the step vocabulary minus skipped. */
export function addProgressStatusRow(
	container: HTMLElement,
	t: Translate,
	settingClass: string,
	initial: ProgressStatus | null,
	onChange: (value: ProgressStatus | null) => void,
): void {
	const setting = new Setting(container).setName(t('form.progressStatus'));
	setting.settingEl.addClass(settingClass);
	setting.addDropdown((dropdown) => {
		dropdown.addOption('', t('form.progressStatus.unset'));
		for (const status of [
			'not-started',
			'in-progress',
			'in-revision',
			'complete',
		] as const) {
			dropdown.addOption(status, t(`status.${status}`));
		}
		dropdown.setValue(initial ?? '').onChange((value) => {
			onChange(
				value === 'not-started' ||
					value === 'in-progress' ||
					value === 'in-revision' ||
					value === 'complete'
					? value
					: null,
			);
		});
	});
}

/** Suggests options under a free-text input, a pick inserting the link. */
class TermSuggest extends FieldSuggest<PickerOption> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		fieldEl: HTMLElement,
		private readonly listOptions: () => readonly PickerOption[],
		private readonly onPick: (option: PickerOption) => void,
	) {
		super(app, inputEl, fieldEl);
	}

	protected getSuggestions(query: string): PickerOption[] {
		return optionsMatching(this.listOptions(), query);
	}

	renderSuggestion(option: PickerOption, el: HTMLElement): void {
		el.setText(option.label);
	}

	selectSuggestion(option: PickerOption): void {
		this.onPick(option);
		this.close();
	}
}

interface TermInputOptions {
	placeholderKey: string;
	options?: () => readonly PickerOption[];
}

/**
 * One clause input: plain text stays text, a pick becomes a wikilink. The
 * field holds the raw term either way, exactly what the record line stores.
 */
class TermInput {
	private inputEl: HTMLInputElement | null = null;

	constructor(
		private readonly context: { app: App; t: Translate },
		private value: string,
		private readonly options: TermInputOptions,
	) {}

	attach(container: HTMLElement): void {
		const holder = container.createDiv({ cls: 'snowflake-method-term-input' });
		this.inputEl = holder.createEl('input', {
			type: 'text',
			value: this.value,
			attr: { placeholder: this.context.t(this.options.placeholderKey) },
		});
		this.inputEl.addEventListener('input', () => {
			this.value = this.inputEl?.value ?? '';
		});
		const list = this.options.options;
		if (list !== undefined && this.inputEl !== null) {
			new TermSuggest(this.context.app, this.inputEl, holder, list, (option) => {
				this.value = renderTerm({
					kind: 'link',
					path: option.value,
					name: option.label,
				});
				if (this.inputEl) this.inputEl.value = this.value;
			});
		}
	}

	term(): RecordTerm | null {
		const raw = (this.inputEl?.value ?? this.value).trim();
		if (raw.length === 0) return null;
		return parseTerm(raw);
	}
}

interface RecordRow {
	labelInput: HTMLInputElement;
	target: TermInput;
	location: TermInput;
	when: TermInput;
	from: TermInput;
	to: TermInput;
	rowEl: HTMLElement;
}

/**
 * The rows of one record section. Each row is a label from the definition
 * file followed by the clause inputs in canonical order; empty clauses are
 * simply absent from the line, and a row without a label is not a record.
 */
export class RecordRowsEditor {
	private rows: RecordRow[] = [];
	private listEl: HTMLElement | null = null;

	constructor(
		private readonly context: RecordEditorContext,
		private readonly definitionPath: string,
		private readonly initial: readonly RecordLine[],
		private readonly copy: { title: string; add: string },
		private readonly withTarget: boolean,
	) {}

	attach(container: HTMLElement): void {
		const block = container.createDiv({ cls: 'snowflake-method-record-editor' });
		const header = block.createDiv({ cls: 'snowflake-method-record-header' });
		header.createSpan({
			cls: 'snowflake-method-record-title',
			text: this.copy.title,
		});
		const add = header.createEl('button', {
			text: this.copy.add,
			attr: { type: 'button' },
		});
		this.listEl = block.createDiv({ cls: 'snowflake-method-record-rows' });
		add.addEventListener('click', () => {
			this.addRow(null);
		});
		for (const record of this.initial) this.addRow(record);
	}

	records(): RecordLine[] {
		const records: RecordLine[] = [];
		for (const row of this.rows) {
			const heading = row.labelInput.value.trim();
			if (heading.length === 0) continue;
			const label = heading.split('/').pop() ?? heading;
			const when = row.when.term();
			const from = row.from.term();
			const to = row.to.term();
			records.push({
				label: { path: this.definitionPath, heading: label, display: label },
				target: this.withTarget ? row.target.term() : null,
				location: row.location.term(),
				time:
					from !== null && to !== null
						? { kind: 'span', start: from, end: to }
						: when !== null
							? { kind: 'when', at: when }
							: null,
			});
		}
		return records;
	}

	/** Rows whose span is half-filled, so the form can refuse to save them. */
	halfSpans(): number {
		return this.rows.filter((row) => {
			const from = row.from.term();
			const to = row.to.term();
			return (from === null) !== (to === null);
		}).length;
	}

	private addRow(record: RecordLine | null): void {
		const list = this.listEl;
		if (!list) return;
		const rowEl = list.createDiv({ cls: 'snowflake-method-record-row' });
		const labelHolder = rowEl.createDiv({
			cls: 'snowflake-method-term-input snowflake-method-record-label',
		});
		const labelInput = labelHolder.createEl('input', {
			type: 'text',
			value: record?.label.display ?? '',
			attr: { placeholder: this.context.t('form.record.label') },
		});
		new TermSuggest(
			this.context.app,
			labelInput,
			labelHolder,
			() =>
				this.context.labels.list().map((path) => ({ value: path, label: path })),
			(option) => {
				labelInput.value = option.value;
			},
		);

		const term = (
			value: RecordTerm | null | undefined,
			options: TermInputOptions,
		): TermInput => {
			const input = new TermInput(
				this.context,
				value === null || value === undefined ? '' : renderTerm(value),
				options,
			);
			input.attach(rowEl);
			return input;
		};

		const target = this.withTarget
			? term(record?.target, {
					placeholderKey: 'form.record.target',
					options: this.context.members,
				})
			: new TermInput(this.context, '', { placeholderKey: 'form.record.target' });
		const location = term(record?.location, {
			placeholderKey: 'form.record.at',
			options: this.context.locations,
		});
		const when = term(record?.time?.kind === 'when' ? record.time.at : null, {
			placeholderKey: 'form.record.when',
			options: this.context.times,
		});
		const from = term(record?.time?.kind === 'span' ? record.time.start : null, {
			placeholderKey: 'form.record.from',
			options: this.context.times,
		});
		const to = term(record?.time?.kind === 'span' ? record.time.end : null, {
			placeholderKey: 'form.record.to',
			options: this.context.times,
		});

		const remove = rowEl.createEl('button', {
			cls: 'snowflake-method-record-remove',
			text: '×',
			attr: { type: 'button', 'aria-label': this.context.t('common.remove') },
		});
		const row: RecordRow = { labelInput, target, location, when, from, to, rowEl };
		remove.addEventListener('click', () => {
			this.rows = this.rows.filter((candidate) => candidate !== row);
			rowEl.remove();
		});
		this.rows.push(row);
	}
}

/**
 * The one-line editor for a built-in single-record property: Age on a
 * character, Owner on an item. The same clause tail as a record, behind a
 * fixed label instead of a picked one.
 */
export class DetailsRowEditor {
	private readonly value: TermInput;
	private readonly when: TermInput;
	private readonly from: TermInput;
	private readonly to: TermInput;

	constructor(
		private readonly context: RecordEditorContext,
		private readonly property: DetailsPropertyId,
		private readonly copy: { title: string },
		initial: DetailsLine | null,
		valueOptions?: () => readonly PickerOption[],
	) {
		this.value = new TermInput(
			this.context,
			initial?.value == null ? '' : renderTerm(initial.value),
			{ placeholderKey: 'form.record.value', options: valueOptions },
		);
		this.when = new TermInput(
			this.context,
			initial?.time?.kind === 'when' ? renderTerm(initial.time.at) : '',
			{ placeholderKey: 'form.record.when', options: this.context.times },
		);
		this.from = new TermInput(
			this.context,
			initial?.time?.kind === 'span' ? renderTerm(initial.time.start) : '',
			{ placeholderKey: 'form.record.from', options: this.context.times },
		);
		this.to = new TermInput(
			this.context,
			initial?.time?.kind === 'span' ? renderTerm(initial.time.end) : '',
			{ placeholderKey: 'form.record.to', options: this.context.times },
		);
	}

	attach(container: HTMLElement): void {
		const block = container.createDiv({ cls: 'snowflake-method-record-editor' });
		const header = block.createDiv({ cls: 'snowflake-method-record-header' });
		header.createSpan({
			cls: 'snowflake-method-record-title',
			text: this.copy.title,
		});
		const rowEl = block.createDiv({
			cls: 'snowflake-method-record-row snowflake-method-details-row',
		});
		this.value.attach(rowEl);
		this.when.attach(rowEl);
		this.from.attach(rowEl);
		this.to.attach(rowEl);
	}

	line(): DetailsLine | null {
		const value = this.value.term();
		const when = this.when.term();
		const from = this.from.term();
		const to = this.to.term();
		if (value === null && when === null && from === null && to === null) {
			return null;
		}
		return {
			property: this.property,
			value,
			location: null,
			time:
				from !== null && to !== null
					? { kind: 'span', start: from, end: to }
					: when !== null
						? { kind: 'when', at: when }
						: null,
		};
	}

	halfSpans(): number {
		const from = this.from.term();
		const to = this.to.term();
		return (from === null) !== (to === null) ? 1 : 0;
	}
}
