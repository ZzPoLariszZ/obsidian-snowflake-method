import { setIcon, setTooltip, type App } from 'obsidian';

import type { DetailsPropertyId, ProgressStatus } from '../domain';
import {
	parseTerm,
	renderTerm,
	type DetailsLine,
	type RecordClause,
	type RecordClauseKind,
	type RecordLine,
	type RecordTerm,
} from '../templates';
import { FieldSuggest } from './field-suggest';
import {
	buildOptionField,
	buildOptionPicker,
	optionsMatching,
	type OptionPicker,
	type PickerOption,
} from './option-picker';
import type { NewDefinitionPath, Translate } from './modals';

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
	 * objection when the file refuses it. The description is written under the
	 * new heading for whoever reads the file later.
	 */
	add(path: string, description: string): Promise<string | null>;
}

export interface RecordEditorContext {
	app: App;
	t: Translate;
	notice: (message: string) => void;
	/** The record labels of one definition file, with create-on-type. */
	labels: DefinitionPathSource;
	/**
	 * Asks what a new label is and what it means, resolving to null when
	 * cancelled. The path comes back too: the dialog is where a name typed in
	 * passing gets its last look.
	 */
	describeLabel: (path: string) => Promise<NewDefinitionPath | null>;
	/** Chooses a note to point at: its group first, then the note itself. */
	pickEntity: () => Promise<PickedEntity | null>;
	/** The group a stored link belongs to, for naming the line it sits on. */
	entityGroup: (path: string) => EntityGroupId | null;
	/** Time notes, for the Owner details row that still asks for one. */
	times: () => readonly PickerOption[];
	/** Members the Owner details row can point at. */
	members: () => readonly PickerOption[];
}

/**
 * Free text as a tag list: type, then Enter or a comma commits a tag.
 *
 * It wears the option picker's own field, tags and remove buttons rather than
 * a look of its own, because the two sit one above the other in every member
 * form and the only real difference is that this one has nothing to suggest.
 */
export class ChipListField {
	private values: string[];
	private valuesEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(
		private readonly context: { t: Translate },
		initial: readonly string[],
		private readonly placeholder: string,
	) {
		this.values = [...initial];
	}

	attach(container: HTMLElement): void {
		const picker = container.createDiv({
			cls: 'snowflake-method-option-picker',
		});
		const field = picker.createDiv({
			cls: 'snowflake-method-option-picker-field',
		});
		this.valuesEl = field.createDiv({
			cls: 'snowflake-method-option-picker-values',
		});
		this.inputEl = this.valuesEl.createEl('input', {
			type: 'text',
			cls: 'snowflake-method-option-picker-input',
			attr: { placeholder: this.placeholder },
		});
		// The frame is the field, so clicking anywhere in it starts typing.
		field.addEventListener('mousedown', (event) => {
			if (event.target === this.inputEl) return;
			if ((event.target as HTMLElement).closest('button') !== null) return;
			event.preventDefault();
			this.inputEl?.focus();
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
				this.renderTags();
			}
		});
		this.inputEl.addEventListener('blur', () => this.commitInput());
		this.renderTags();
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
			this.renderTags();
		}
	}

	/** Tags are rebuilt before the input, which always stays last in the row. */
	private renderTags(): void {
		const values = this.valuesEl;
		if (values === null) return;
		for (const tag of Array.from(
			values.querySelectorAll('.snowflake-method-option-picker-tag'),
		)) {
			tag.remove();
		}
		this.values.forEach((value, index) => {
			const tag = values.createSpan({
				cls: 'snowflake-method-option-picker-tag',
			});
			setTooltip(tag.createSpan({ text: value }), value);
			const remove = tag.createEl('button', {
				cls: 'snowflake-method-option-picker-remove clickable-icon',
				attr: {
					type: 'button',
					'aria-label': this.context.t('form.aliases.remove', { name: value }),
				},
			});
			setIcon(remove, 'x');
			// Taking focus would blur the input and commit whatever is half-typed.
			remove.addEventListener('mousedown', (event) => {
				event.preventDefault();
			});
			remove.addEventListener('click', () => {
				this.values.splice(index, 1);
				this.renderTags();
				this.inputEl?.focus();
			});
			values.insertBefore(tag, this.inputEl);
		});
	}
}

/**
 * Category paths as a tag picker over the definition file's tree, with
 * create-on-type appending to the file first so the link the note will store
 * resolves. A picked path the file no longer lists still shows as a tag, so
 * nothing silently falls off a note in the picker.
 *
 * Creating asks for a description first: a new category is a word the whole
 * project will be sorted by, and the one moment its meaning is obvious is the
 * moment it is invented.
 */
export class CategoryPathField {
	private values: string[];

	constructor(
		private readonly context: {
			app: App;
			t: Translate;
			notice: (message: string) => void;
			source: DefinitionPathSource;
			/**
			 * Asks for the path to write and what it means, resolving to null
			 * when cancelled.
			 */
			describe: (path: string) => Promise<NewDefinitionPath | null>;
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
					const typedPath = typed.trim();
					if (typedPath.length === 0) return null;
					// The dialog may hand back a different path than it was given:
					// what it settles on is what gets written and picked.
					const answer = await this.context.describe(typedPath);
					if (answer === null) return null;
					const path = answer.path.trim();
					if (path.length === 0) return null;
					const objection = await this.context.source.add(
						path,
						answer.description,
					);
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

/**
 * Any number of notes of one sort, as a tag picker with create-on-type. What
 * a scene held before these fields named notes -- plain words -- stays on the
 * list as a tag of its own, so nothing an author wrote is dropped by a change
 * of field.
 */
export class NoteListField {
	private values: string[];
	/**
	 * Notes made from this field, by note key. The project behind the field is
	 * read afresh on every keystroke, but a note made a moment ago may not be
	 * in it yet, and a field that cannot find what it just made stores the
	 * path as if it were words and shows it twice.
	 */
	private readonly made = new Map<string, PickerOption>();

	constructor(
		private readonly context: {
			app: App;
			t: Translate;
			notice: (message: string) => void;
			/** The notes on offer, newest reading of the project. */
			options: () => readonly PickerOption[];
			/** Makes one by name, resolving to null when that fails. */
			create: (name: string) => Promise<PickerOption | null>;
			label: string;
			placeholder: string;
			createLabel: (name: string) => string;
			removeLabel: (name: string) => string;
		},
		initial: readonly string[],
	) {
		this.values = [...initial];
	}

	attach(container: HTMLElement): void {
		buildOptionPicker(this.context.app, container, {
			options: () => noteFieldOptions(this.context.options(), this.values),
			label: this.context.label,
			placeholder: this.context.placeholder,
			emptyPlaceholder: this.context.placeholder,
			picked: () => this.values.map((value) => this.identity(value)),
			pick: (value) => {
				const stored = this.term(value);
				if (!this.values.includes(stored)) this.values.push(stored);
			},
			unpick: (value) => {
				this.values = this.values.filter(
					(candidate) => this.identity(candidate) !== value,
				);
			},
			removeLabel: (label) => this.context.removeLabel(label),
			create: {
				label: (typed) => this.context.createLabel(typed),
				// Storing is left to the pick that follows, so a note arrives on
				// the list exactly once however it came to exist.
				run: async (typed) => {
					const name = typed.trim();
					if (name.length === 0) return null;
					const created = await this.context.create(name);
					if (created === null) return null;
					const option = { value: noteKey(created.value), label: created.label };
					this.made.set(option.value, created);
					return option;
				},
			},
		});
	}

	/** The term to store for a picked note: a link when the note is known. */
	private term(value: string): string {
		const option =
			this.context
				.options()
				.find((candidate) => noteKey(candidate.value) === value) ??
			this.made.get(value);
		return option === undefined
			? value
			: renderTerm({ kind: 'link', path: option.value, name: option.label });
	}

	get(): string[] {
		return [...this.values];
	}

	/** What the picker knows a stored value by: a note's path, or the words. */
	private identity(value: string): string {
		return noteIdentity(value);
	}
}

/**
 * One note of one sort, as a single-value picker with create-on-type. Held as
 * the raw term the note stores, so words written before the field named notes
 * stay on the list as an option of their own.
 */
export class NoteField {
	private value: string;
	/** Notes made from this field, by note key. See `NoteListField.made`. */
	private readonly made = new Map<string, PickerOption>();

	constructor(
		private readonly context: {
			app: App;
			t: Translate;
			/** The notes on offer, newest reading of the project. */
			options: () => readonly PickerOption[];
			/** Makes one by name, resolving to null when that fails. */
			create: (name: string) => Promise<PickerOption | null>;
			label: string;
			placeholder: string;
			createLabel: (name: string) => string;
			/** Called with the term to store on every change. */
			onChange: (value: string) => void;
		},
		initial: string,
	) {
		this.value = initial.trim();
	}

	attach(container: HTMLElement): OptionPicker {
		return buildOptionField(this.context.app, container, {
			options: () => noteFieldOptions(this.context.options(), [this.value]),
			label: this.context.label,
			placeholder: this.context.placeholder,
			emptyPlaceholder: this.context.placeholder,
			value: () => this.identity(),
			choose: (value) => {
				const option =
					this.context
						.options()
						.find((candidate) => noteKey(candidate.value) === value) ??
					this.made.get(value);
				this.set(
					option === undefined
						? value
						: renderTerm({
								kind: 'link',
								path: option.value,
								name: option.label,
							}),
				);
			},
			create: {
				label: (typed) => this.context.createLabel(typed),
				// Choosing is left to the field, which the picker does next.
				run: async (typed) => {
					const name = typed.trim();
					if (name.length === 0) return null;
					const created = await this.context.create(name);
					if (created === null) return null;
					const option = { value: noteKey(created.value), label: created.label };
					this.made.set(option.value, created);
					return option;
				},
			},
		});
	}

	private set(value: string): void {
		this.value = value;
		this.context.onChange(value);
	}

	private identity(): string {
		return noteIdentity(this.value);
	}
}

/** A note is known by its path without the extension, which is what a link holds. */
function noteKey(path: string): string {
	return path.replace(/\.md$/u, '');
}

/**
 * What a note field offers: the project's notes keyed the way a stored link is,
 * and behind them anything the field holds that the project has never heard of.
 *
 * The keying is the whole of it. A note listed under its file path and held as
 * a link are the same note, and a field that keys them differently shows the
 * one it holds as a path and goes on offering it a second time.
 */
export function noteFieldOptions(
	options: readonly PickerOption[],
	values: readonly string[],
): PickerOption[] {
	const known = options.map((option) => ({
		value: noteKey(option.value),
		label: option.label,
	}));
	const paths = new Set(known.map((option) => option.value));
	// Words a scene wrote before this field named notes are on offer nowhere,
	// so the field carries them itself rather than dropping what it cannot find.
	const kept = values
		.filter((value) => value.trim().length > 0)
		.map((value) => ({
			value: noteIdentity(value),
			label: noteDisplay(value),
		}))
		.filter((option) => !paths.has(option.value));
	return [...known, ...kept];
}

/** What a picker knows a stored value by: a note's path, or the words. */
export function noteIdentity(value: string): string {
	const term = parseTerm(value);
	return term.kind === 'link' ? noteKey(term.path) : term.text;
}

function noteDisplay(value: string): string {
	const term = parseTerm(value);
	return term.kind === 'link' ? term.name : term.text;
}

export const PROGRESS_STATUS_ORDER = [
	'not-started',
	'in-progress',
	'in-revision',
	'complete',
] as const;

/**
 * The progress status, worn where a step wears it: a bare select in the header
 * beside the title, no label of its own, and always holding one of the four.
 * A member is somewhere in its progress the moment it exists, so there is
 * nothing for an unset option to mean.
 */
export function addProgressStatusControl(
	container: HTMLElement,
	t: Translate,
	initial: ProgressStatus,
	onChange: (value: ProgressStatus) => void,
): HTMLSelectElement {
	const select = container.createEl('select', {
		cls: 'dropdown snowflake-method-status-select',
		attr: { 'aria-label': t('form.progressStatus') },
	});
	for (const status of PROGRESS_STATUS_ORDER) {
		const option = select.createEl('option', {
			value: status,
			text: t(`status.${status}`),
		});
		option.selected = status === initial;
	}
	select.addEventListener('change', () => {
		const value = select.value;
		onChange(
			PROGRESS_STATUS_ORDER.includes(value as ProgressStatus)
				? (value as ProgressStatus)
				: 'not-started',
		);
	});
	return select;
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

/**
 * The kinds of note a record can point at. Time is split by what a time note
 * is, because picking "the year it happened" and "the war it happened during"
 * are different choices even though both are time notes.
 */
export const ENTITY_GROUP_IDS = [
	'character',
	'scene',
	'time-point',
	'time-period',
	'location',
	'item',
] as const;

export type EntityGroupId = (typeof ENTITY_GROUP_IDS)[number];

/** What connector a reference to each group is written with. */
export const ENTITY_GROUP_CLAUSE: Readonly<
	Record<EntityGroupId, RecordClauseKind>
> = {
	character: 'with',
	scene: 'with',
	item: 'with',
	'time-point': 'when',
	'time-period': 'when',
	location: 'at',
};

export interface PickedEntity {
	group: EntityGroupId;
	option: PickerOption;
}

/** One card's worth of state, kept beside its element. */
interface RecordCard {
	el: HTMLElement;
	contextsEl: HTMLElement;
	label: string;
	valueEl: HTMLInputElement;
	target: RecordTerm | null;
	clauses: RecordClause[];
	renderTarget: () => void;
}

/**
 * One card per record: the label it is filed under, the value it carries on
 * this note, the one target a relationship is with, and any number of notes
 * that give it context. A card is a record, so removing the card removes the
 * record, and removing a line removes only that line.
 */
export class RecordCardsEditor {
	private cards: RecordCard[] = [];
	private listEl: HTMLElement | null = null;
	private dragging: RecordCard | null = null;

	constructor(
		private readonly context: RecordEditorContext,
		private readonly definitionPath: string,
		private readonly initial: readonly RecordLine[],
		private readonly copy: {
			title: string;
			add: string;
			labelTitle: string;
			labelPlaceholder: string;
		},
		private readonly withTarget: boolean,
	) {}

	attach(container: HTMLElement): void {
		const block = container.createDiv({ cls: 'snowflake-method-record-editor' });
		block.createDiv({
			cls: 'snowflake-method-record-title',
			text: this.copy.title,
		});
		this.listEl = block.createDiv({ cls: 'snowflake-method-record-cards' });
		// Under the records, where the next one will appear, rather than off in
		// a corner of the heading.
		const add = block.createEl('button', {
			cls: 'snowflake-method-record-add',
			text: this.copy.add,
			attr: { type: 'button' },
		});
		add.addEventListener('click', () => {
			this.addCard(null);
		});
		for (const record of this.initial) this.addCard(record);
	}

	records(): RecordLine[] {
		const records: RecordLine[] = [];
		for (const card of this.cards) {
			const heading = card.label.trim();
			if (heading.length === 0) continue;
			const label = heading.split('/').pop() ?? heading;
			records.push({
				label: { path: this.definitionPath, heading: label, display: label },
				value: card.valueEl.value.trim(),
				clauses: [
					...(this.withTarget && card.target !== null
						? [{ kind: 'target' as const, term: card.target }]
						: []),
					...card.clauses,
				],
			});
		}
		return records;
	}

	private addCard(record: RecordLine | null): void {
		const list = this.listEl;
		if (list === null) return;
		const el = list.createDiv({ cls: 'snowflake-method-record-card' });
		const handle = el.createDiv({
			cls: 'snowflake-method-record-drag',
			attr: { 'aria-label': this.context.t('form.record.reorder') },
		});
		setIcon(handle, 'grip-vertical');
		const body = el.createDiv({ cls: 'snowflake-method-record-body' });
		const close = el.createEl('button', {
			cls: 'snowflake-method-record-card-close clickable-icon',
			attr: {
				type: 'button',
				'aria-label': this.context.t('form.record.removeRecord'),
			},
		});
		setIcon(close, 'trash-2');

		const storedTarget = record?.clauses.find(
			(clause) => clause.kind === 'target',
		);
		const card: RecordCard = {
			el,
			contextsEl: null as unknown as HTMLElement,
			label: record?.label.display ?? '',
			valueEl: null as unknown as HTMLInputElement,
			target:
				storedTarget !== undefined && storedTarget.kind !== 'span'
					? storedTarget.term
					: null,
			clauses: (record?.clauses ?? []).filter(
				(clause) => clause.kind !== 'target',
			),
			renderTarget: () => undefined,
		};
		this.makeDraggable(el, handle, card);

		// Every field says what it is in its own placeholder, so a card carries
		// no titles: the fields are the card.
		buildOptionField(this.context.app, body.createDiv(), {
			options: () => {
				const known = this.context.labels.list();
				const all =
					known.includes(card.label) || card.label.length === 0
						? [...known]
						: [...known, card.label];
				return all.map((path) => ({ value: path, label: path }));
			},
			label: this.copy.labelTitle,
			placeholder: this.copy.labelPlaceholder,
			emptyPlaceholder: this.copy.labelPlaceholder,
			value: () => card.label,
			choose: (value) => {
				card.label = value;
			},
			create: {
				label: (typed) =>
					this.context.t('form.record.createLabel', { name: typed }),
				run: async (typed) => {
					const typedPath = typed.trim();
					if (typedPath.length === 0) return null;
					const answer = await this.context.describeLabel(typedPath);
					if (answer === null) return null;
					const path = answer.path.trim();
					if (path.length === 0) return null;
					const objection = await this.context.labels.add(
						path,
						answer.description,
					);
					if (objection !== null) {
						this.context.notice(objection);
						return null;
					}
					return { value: path, label: path };
				},
			},
		});

		card.valueEl = body.createEl('input', {
			type: 'text',
			cls: 'snowflake-method-record-value',
			value: record?.value ?? '',
			attr: {
				placeholder: this.context.t('form.record.valuePlaceholder'),
				'aria-label': this.context.t('form.record.value'),
			},
		});

		if (this.withTarget) {
			const targetEl = body.createDiv({
				cls: 'snowflake-method-record-target',
			});
			card.renderTarget = (): void => {
				targetEl.empty();
				if (card.target === null) {
					this.renderTargetPicker(
						targetEl,
						this.context.t('form.record.chooseTarget'),
						() => {
							void this.context.pickEntity().then((picked) => {
								if (picked === null) return;
								card.target = {
									kind: 'link',
									path: picked.option.value,
									name: picked.option.label,
								};
								card.renderTarget();
							});
						},
					);
					return;
				}
				this.renderLine(
					targetEl,
					this.lineLabel(card.target),
					termText(card.target),
					() => {
						card.target = null;
						card.renderTarget();
					},
				);
			};
			card.renderTarget();
		}

		// What the record is comes first, what it points at comes after.
		card.contextsEl = body.createDiv({ cls: 'snowflake-method-record-lines' });
		this.renderAddMore(body, this.context.t('form.record.more'), () => {
			void this.context.pickEntity().then((picked) => {
				if (picked === null) return;
				card.clauses.push({
					kind: ENTITY_GROUP_CLAUSE[picked.group],
					term: {
						kind: 'link',
						path: picked.option.value,
						name: picked.option.label,
					},
				});
				this.renderContexts(card);
			});
		});

		close.addEventListener('click', () => {
			this.cards = this.cards.filter((candidate) => candidate !== card);
			el.remove();
		});
		this.cards.push(card);
		this.renderContexts(card);
	}

	/**
	 * Records keep the order they are given, so that order is the author's to
	 * set. Only the handle starts a drag, or selecting the text in a field
	 * would carry the card off instead.
	 */
	private makeDraggable(
		el: HTMLElement,
		handle: HTMLElement,
		card: RecordCard,
	): void {
		handle.addEventListener('mousedown', () => {
			el.draggable = true;
		});
		handle.addEventListener('mouseup', () => {
			el.draggable = false;
		});
		el.addEventListener('dragstart', (event) => {
			this.dragging = card;
			el.addClass('is-dragging');
			if (event.dataTransfer === null) return;
			event.dataTransfer.effectAllowed = 'move';
			// A drag has to carry something to start at all.
			event.dataTransfer.setData('text/plain', '');
		});
		el.addEventListener('dragend', () => {
			el.draggable = false;
			el.removeClass('is-dragging');
			this.dragging = null;
		});
		el.addEventListener('dragover', (event) => {
			if (this.dragging === null || this.dragging === card) return;
			event.preventDefault();
			el.addClass('is-drop-target');
		});
		el.addEventListener('dragleave', () => {
			el.removeClass('is-drop-target');
		});
		el.addEventListener('drop', (event) => {
			el.removeClass('is-drop-target');
			const dragged = this.dragging;
			if (dragged === null || dragged === card) return;
			event.preventDefault();
			this.moveCard(dragged, card);
		});
	}

	/** Puts one card where another sits, in the list and on the page. */
	private moveCard(dragged: RecordCard, target: RecordCard): void {
		const from = this.cards.indexOf(dragged);
		const to = this.cards.indexOf(target);
		if (from < 0 || to < 0) return;
		this.cards.splice(from, 1);
		this.cards.splice(to, 0, dragged);
		if (from < to) target.el.after(dragged.el);
		else target.el.before(dragged.el);
	}

	/**
	 * The way to add a reference, quiet the way the add-record row under the
	 * cards is quiet: both are invitations, not fields holding anything.
	 */
	private renderAddMore(
		container: HTMLElement,
		label: string,
		open: () => void,
	): void {
		const button = container.createEl('button', {
			cls: 'snowflake-method-record-more',
			text: label,
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			open();
		});
	}

	/**
	 * The target is a value the record holds, so it wears the option picker's
	 * frame like every other field that names something.
	 */
	private renderTargetPicker(
		container: HTMLElement,
		placeholder: string,
		open: () => void,
	): void {
		const picker = container.createDiv({
			cls: 'snowflake-method-option-picker is-single snowflake-method-record-pick',
		});
		const field = picker.createDiv({
			cls: 'snowflake-method-option-picker-field',
		});
		const values = field.createDiv({
			cls: 'snowflake-method-option-picker-values',
		});
		values.createSpan({
			cls: 'snowflake-method-record-pick-placeholder',
			text: placeholder,
		});
		const selector = field.createEl('button', {
			cls: 'clickable-icon snowflake-method-option-picker-selector',
			attr: { type: 'button', 'aria-label': placeholder },
		});
		setIcon(selector, 'chevrons-up-down');
		picker.addEventListener('click', () => {
			open();
		});
	}

	/**
	 * A line is labelled by what it points at, never by the connector the line
	 * will be written with: `at` and `when` are for reading the note, and the
	 * form talks about locations and times.
	 */
	private lineLabel(term: RecordTerm): string {
		const path = linkPath(term);
		const group = path === null ? null : this.context.entityGroup(path);
		return group === null
			? this.context.t('form.record.reference')
			: this.context.t(`form.group.${group}`);
	}

	private renderContexts(card: RecordCard): void {
		card.contextsEl.empty();
		card.clauses.forEach((clause, index) => {
			const text =
				clause.kind === 'span'
					? `${termText(clause.start)} – ${termText(clause.end)}`
					: termText(clause.term);
			const label =
				clause.kind === 'span'
					? this.context.t('form.record.span')
					: this.lineLabel(clause.term);
			this.renderLine(card.contextsEl, label, text, () => {
				card.clauses.splice(index, 1);
				this.renderContexts(card);
			});
		});
	}

	/** One reference: what it is, what it points at, and a way to drop it. */
	private renderLine(
		container: HTMLElement,
		label: string,
		text: string,
		remove: () => void,
	): void {
		const line = container.createDiv({ cls: 'snowflake-method-record-line' });
		line.createDiv({
			cls: 'snowflake-method-record-line-label',
			text: label,
		});
		line.createDiv({ cls: 'snowflake-method-record-line-value', text });
		const button = line.createEl('button', {
			cls: 'snowflake-method-record-line-remove clickable-icon',
			attr: {
				type: 'button',
				'aria-label': this.context.t('form.record.removeLine', { name: text }),
			},
		});
		setIcon(button, 'circle-minus');
		button.addEventListener('click', remove);
	}
}

function termText(term: RecordTerm): string {
	return term.kind === 'text' ? term.text : term.name;
}

function linkPath(term: RecordTerm): string | null {
	return term.kind === 'link' ? term.path : null;
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
