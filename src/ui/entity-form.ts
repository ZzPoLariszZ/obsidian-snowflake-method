import { getLinkpath, setIcon, setTooltip, type App } from 'obsidian';

import {
	foldName,
	type ProgressStatus,
	type ProjectWorldbuildingKind,
} from '../domain';
import {
	parseTerm,
	renderTerm,
	type CustomField,
	type RecordClause,
	type RecordClauseKind,
	type RecordLine,
	type RecordTerm,
} from '../templates';
import {
	buildOptionField,
	buildOptionPicker,
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
	/** Time notes a record clause can point at. */
	times: () => readonly PickerOption[];
	/** Members a record clause can point at. */
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
				const options: PickerOption[] = known.map((path) => ({
					value: path,
					label: path,
				}));
				// A path the tree no longer holds stays on the field -- dropping it
				// would edit the note behind the author's back -- and says so.
				for (const value of this.values) {
					if (known.includes(value)) continue;
					options.push({ value, label: value, missing: true });
				}
				return options;
			},
			missingLabel: (name) => t('form.referenceMissing', { name }),
			label: t('form.category'),
			placeholder: t('form.definition.placeholder.category'),
			emptyPlaceholder: t('form.definition.placeholder.category'),
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
			options: () =>
				noteFieldOptions(
					this.context.options(),
					this.values,
					(path) => !linkLeadsNowhere(this.context.app, path),
				),
			missingLabel: (name) =>
				this.context.t('form.referenceMissing', { name }),
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
			options: () =>
				noteFieldOptions(
					this.context.options(),
					[this.value],
					(path) => !linkLeadsNowhere(this.context.app, path),
				),
			missingLabel: (name) =>
				this.context.t('form.referenceMissing', { name }),
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
 * Whether a link leads nowhere at all — which is the only reading of "missing"
 * a field can act on. Obsidian shortens the links it writes to whatever was
 * unambiguous at the time, so a link that does not match a listed note by its
 * text may still be that note; what it resolves to is the answer.
 */
export function linkLeadsNowhere(app: App, path: string): boolean {
	return app.metadataCache.getFirstLinkpathDest(getLinkpath(path), '') === null;
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
	/** Whether a link the list does not hold still leads to a note. */
	leadsSomewhere: (path: string) => boolean,
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
			// Words are words; a link that leads nowhere is a note that has gone,
			// and the field says which of the two it is holding.
			missing: isMissingLink(value, leadsSomewhere),
		}))
		.filter((option) => !paths.has(option.value));
	return [...known, ...kept];
}

function isMissingLink(
	value: string,
	leadsSomewhere: (path: string) => boolean,
): boolean {
	const term = parseTerm(value);
	return term.kind === 'link' && !leadsSomewhere(term.path);
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

/**
 * The kinds of note a record can point at. Time is split by what a time note
 * is, because picking "the year it happened" and "the war it happened during"
 * are different choices even though both are time notes. The groups are not a
 * fixed union: every registered worldbuilding kind is one, so this list only
 * names the ones whose labels live in the copy.
 */
export const BUILT_IN_ENTITY_GROUP_IDS = [
	'character',
	'scene',
	'time-point',
	'time-period',
	'location',
	'item',
] as const;

/** A built-in group id above, or a registered kind standing as its own group. */
export type EntityGroupId = string;

/** Every group of one project, in rail order with time split into its two. */
export function entityGroupsOf(
	kinds: readonly ProjectWorldbuildingKind[],
): EntityGroupId[] {
	return [
		'character',
		'scene',
		...kinds.flatMap((kind) =>
			kind.id === 'time' ? ['time-point', 'time-period'] : [kind.id],
		),
	];
}

/** What connector a reference to each group is written with. */
export function clauseForGroup(group: EntityGroupId): RecordClauseKind {
	if (group === 'time-point' || group === 'time-period') return 'when';
	return group === 'location' ? 'at' : 'with';
}

/** What a group is called: copy for the built-ins, a kind its own name. */
export function entityGroupLabel(t: Translate, group: EntityGroupId): string {
	return (BUILT_IN_ENTITY_GROUP_IDS as readonly string[]).includes(group)
		? t(`form.group.${group}`)
		: group;
}

export interface PickedEntity {
	group: EntityGroupId;
	option: PickerOption;
}

/**
 * A card the author has begun but not yet filed under a label. A record needs
 * its label to be written, but a form redraw is not a save: whatever was
 * typed has to survive it, label or no label.
 */
export interface RecordDraft {
	value: string;
	target: RecordTerm | null;
	clauses: RecordClause[];
}

/** One card's worth of state, kept beside its element. */
interface RecordCard {
	el: HTMLElement;
	contextsEl: HTMLElement;
	label: string;
	/**
	 * The stored label link, kept while the label field is untouched. The
	 * target carries identity and the alias is only a display cache, so a
	 * save must not rebuild the target out of the alias: after a folder
	 * rename that would resurrect the node the rename moved away from.
	 */
	labelPath: string | null;
	valueEl: HTMLTextAreaElement;
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
		private readonly initialDrafts: readonly RecordDraft[] = [],
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
		for (const draft of this.initialDrafts) this.addDraft(draft);
	}

	/**
	 * The unlabeled cards, so a redraw can hand them to the editor it builds
	 * next. They rejoin after the records; a redraw mid-form loses a draft's
	 * place in the order, never the draft.
	 */
	drafts(): RecordDraft[] {
		return this.cards
			.filter((card) => card.label.trim().length === 0)
			.map((card) => ({
				value: card.valueEl.value,
				target: card.target,
				clauses: [...card.clauses],
			}));
	}

	private addDraft(draft: RecordDraft): void {
		const card = this.addCard(null);
		if (card === null) return;
		card.valueEl.value = draft.value;
		card.target = draft.target;
		card.clauses = [...draft.clauses];
		card.renderTarget();
		this.renderContexts(card);
	}

	records(): RecordLine[] {
		const records: RecordLine[] = [];
		for (const card of this.cards) {
			const path = card.label.trim();
			if (path.length === 0) continue;
			records.push({
				label:
					card.labelPath !== null
						? { path: card.labelPath, display: path }
						: {
								// The node's note is named after its folder, so the leaf
								// says itself twice: `…/Race/Elf/Elf`.
								path: `${this.definitionPath}/${path}/${path.split('/').pop() ?? path}`,
								display: path,
							},
				value: oneLineValue(card.valueEl.value),
				clauses: [
					...(card.target !== null
						? [{ kind: 'target' as const, term: card.target }]
						: []),
					...card.clauses,
				],
			});
		}
		return records;
	}

	private addCard(record: RecordLine | null): RecordCard | null {
		const list = this.listEl;
		if (list === null) return null;
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

		// Only the target the picker will show comes out of the clauses. Any
		// further target line -- and every one of them where the editor shows
		// no picker -- stays an ordinary context line, visible and removable,
		// and is written back out with the record rather than dropped.
		const storedTarget = this.withTarget
			? record?.clauses.find((clause) => clause.kind === 'target')
			: undefined;
		const card: RecordCard = {
			el,
			contextsEl: null as unknown as HTMLElement,
			label:
				record === null ? '' : labelDisplay(record.label, this.definitionPath),
			labelPath: record?.label.path ?? null,
			valueEl: null as unknown as HTMLTextAreaElement,
			target:
				storedTarget !== undefined && storedTarget.kind !== 'span'
					? storedTarget.term
					: null,
			clauses: (record?.clauses ?? []).filter(
				(clause) => clause !== storedTarget,
			),
			renderTarget: () => undefined,
		};
		this.makeDraggable(el, handle, card);

		// Every field says what it is in its own placeholder, so a card carries
		// no titles: the fields are the card.
		buildOptionField(this.context.app, body.createDiv(), {
			options: () => {
				const known = this.context.labels.list();
				const options: PickerOption[] = known.map((path) => ({
					value: path,
					label: path,
				}));
				if (card.label.length > 0 && !known.includes(card.label)) {
					options.push({ value: card.label, label: card.label, missing: true });
				}
				return options;
			},
			missingLabel: (name) =>
				this.context.t('form.referenceMissing', { name }),
			label: this.copy.labelTitle,
			placeholder: this.copy.labelPlaceholder,
			emptyPlaceholder: this.copy.labelPlaceholder,
			value: () => card.label,
			choose: (value) => {
				card.label = value;
				// A picked label is the author's decision: from here the link is
				// built from the taxonomy path, not kept from the stored line.
				card.labelPath = null;
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

		// The same field a custom field holds its content in: prose wants room
		// to wrap, not a single line scrolling sideways.
		card.valueEl = body.createEl('textarea', {
			cls: 'snowflake-method-record-value',
			attr: {
				placeholder: this.context.t('form.record.valuePlaceholder'),
				'aria-label': this.context.t('form.record.value'),
				rows: '2',
			},
		});
		card.valueEl.value = record?.value ?? '';

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
					this.isMissing(card.target),
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
					kind: clauseForGroup(picked.group),
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
		return card;
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
			: entityGroupLabel(this.context.t, group);
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
			const missing =
				clause.kind === 'span'
					? this.isMissing(clause.start) || this.isMissing(clause.end)
					: this.isMissing(clause.term);
			this.renderLine(card.contextsEl, label, text, missing, () => {
				card.clauses.splice(index, 1);
				this.renderContexts(card);
			});
		});
	}

	/** Whether a reference names a note that is no longer anywhere. */
	private isMissing(term: RecordTerm): boolean {
		const path = linkPath(term);
		return path !== null && linkLeadsNowhere(this.context.app, path);
	}

	/** One reference: what it is, what it points at, and a way to drop it. */
	private renderLine(
		container: HTMLElement,
		label: string,
		text: string,
		missing: boolean,
		remove: () => void,
	): void {
		const line = container.createDiv({ cls: 'snowflake-method-record-line' });
		line.createDiv({
			cls: 'snowflake-method-record-line-label',
			text: label,
		});
		const value = line.createDiv({
			cls: 'snowflake-method-record-line-value',
			text,
		});
		if (missing) {
			value.addClass('snowflake-method-option-picker-missing');
			setTooltip(value, this.context.t('form.referenceMissing', { name: text }));
		}
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

/**
 * Everything the custom-fields block needs to know about templates: which
 * notes are on offer, which one the kind has chosen, how to record a new
 * choice, and what default fields the chosen note defines right now.
 */
export interface CustomFieldTemplateSource {
	options: () => readonly PickerOption[];
	current: () => Promise<string | null>;
	set: (path: string | null) => Promise<void>;
	fields: () => Promise<CustomField[]>;
	/** Writes the form's rows as a template of the kind, replacing a namesake. */
	export: (input: {
		name: string;
		description: string;
		fields: CustomField[];
	}) => Promise<{ ok: true } | { ok: false; code: 'invalid-name' | 'taken' }>;
}

/**
 * The form's custom fields: title-and-content rows stored in the note's own
 * marked block, edited here and nowhere else. The rows live in an array the
 * modal owns and this editor mutates in place, so a form redraw rebuilds the
 * editor without losing a keystroke. On a create form the kind's template
 * note seeds the rows; choosing a template re-seeds an untouched create form
 * wholesale, and on any form already holding rows it appends the template's
 * fields below them, skipping titles already present.
 */
export class CustomFieldsEditor {
	private rowsEl: HTMLElement | null = null;
	/** The row a drag carries, by its place in the shared list. */
	private draggingIndex: number | null = null;

	constructor(
		private readonly context: {
			app: App;
			t: Translate;
			/** The rows, shared with the modal and edited in place. */
			rows: CustomField[];
			/** The kind's template machinery; null on the quick form. */
			template: CustomFieldTemplateSource | null;
			/** True on a create form, where the template seeds the rows. */
			seedFromTemplate: boolean;
			/** Offers the rows as a template of the kind; absent where unwanted. */
			onExport?: () => void;
			touched: () => boolean;
			markTouched: () => void;
		},
	) {}

	attach(container: HTMLElement): void {
		const t = this.context.t;
		const block = container.createDiv({
			cls: 'snowflake-method-record-editor snowflake-method-custom-fields',
		});
		const head = block.createDiv({
			cls: 'snowflake-method-custom-fields-head',
		});
		head.createDiv({
			cls: 'snowflake-method-record-title',
			text: t('form.customFields'),
		});
		// The template choice and the export share one line under the title:
		// the choice starts it on the left, the export closes it on the right.
		const onExport = this.context.onExport;
		if (this.context.template !== null || onExport !== undefined) {
			const row = block.createDiv({
				cls: 'snowflake-method-custom-fields-template',
			});
			if (this.context.template !== null) {
				this.attachTemplatePicker(row, this.context.template);
			}
			if (onExport !== undefined) {
				const exportButton = row.createEl('button', {
					cls: 'snowflake-method-custom-fields-export',
					text: t('form.customFields.export'),
					attr: { type: 'button' },
				});
				exportButton.addEventListener('click', onExport);
			}
		}
		this.rowsEl = block.createDiv({
			cls: 'snowflake-method-record-cards snowflake-method-custom-fields-rows',
		});
		const add = block.createEl('button', {
			cls: 'snowflake-method-record-add',
			text: t('form.customFields.add'),
			attr: { type: 'button' },
		});
		add.addEventListener('click', () => {
			this.context.rows.push({ title: '', content: '' });
			this.context.markTouched();
			this.renderRows();
		});
		this.renderRows();
		if (
			this.context.seedFromTemplate &&
			this.context.template !== null &&
			this.context.rows.length === 0 &&
			!this.context.touched()
		) {
			void this.context.template.fields().then((fields) => {
				// The answer may land after the author started typing; what
				// they typed wins.
				if (this.context.touched() || this.context.rows.length > 0) return;
				this.context.rows.push(...fields);
				this.renderRows();
			});
		}
	}

	/** Every title as typed, for the submit-time duplicate check. */
	titles(): string[] {
		return this.context.rows.map((row) => row.title);
	}

	/**
	 * The template choice, opening the line under the block's title: a
	 * single-value picker over the kind's templates, with an offer of none.
	 * Built once the stored choice has been read, so the field opens already
	 * saying it.
	 */
	private attachTemplatePicker(
		row: HTMLElement,
		template: CustomFieldTemplateSource,
	): void {
		const t = this.context.t;
		row.createSpan({
			cls: 'snowflake-method-custom-fields-template-label',
			text: t('form.customFields.template'),
		});
		const fieldEl = row.createDiv();
		let current = '';
		void template.current().then((path) => {
			current = path ?? '';
			buildOptionField(this.context.app, fieldEl, {
				options: () => {
					const known = template.options();
					const options: PickerOption[] = [
						{ value: '', label: t('form.customFields.templateNone') },
						...known,
					];
					if (
						current.length > 0 &&
						!known.some((option) => option.value === current)
					) {
						options.push({ value: current, label: current, missing: true });
					}
					return options;
				},
				missingLabel: (name) => t('form.referenceMissing', { name }),
				label: t('form.customFields.template'),
				placeholder: t('form.customFields.templatePlaceholder'),
				emptyPlaceholder: t('form.customFields.templatePlaceholder'),
				value: () => current,
				choose: (value) => {
					current = value;
					void template
						.set(value.length === 0 ? null : value)
						.then(async () => {
							const untouchedCreate =
								this.context.seedFromTemplate && !this.context.touched();
							if (value.length === 0) {
								// Clearing the choice empties only seeded rows nobody
								// has touched; typed rows are the author's.
								if (untouchedCreate) {
									this.context.rows.splice(0, this.context.rows.length);
									this.renderRows();
								}
								return;
							}
							const fields = await template.fields();
							// A fresh choice reseeds a create form nobody has typed
							// into; a form already holding rows keeps them, and the
							// template's fields join below — the titles already
							// present staying single.
							if (untouchedCreate) {
								this.context.rows.splice(
									0,
									this.context.rows.length,
									...fields,
								);
								this.renderRows();
								return;
							}
							const present = new Set(
								this.context.rows.map((row) => foldName(row.title.trim())),
							);
							const appended = fields.filter(
								(field) => !present.has(foldName(field.title.trim())),
							);
							if (appended.length === 0) return;
							this.context.rows.push(...appended);
							this.context.markTouched();
							this.renderRows();
						});
				},
			});
		});
	}

	private renderRows(): void {
		const rows = this.rowsEl;
		if (rows === null) return;
		rows.empty();
		this.context.rows.forEach((row, index) => {
			// The same card a record wears: the handle that moves it, the
			// fields that are it, and the way to be rid of it.
			const el = rows.createDiv({ cls: 'snowflake-method-record-card' });
			const handle = el.createDiv({
				cls: 'snowflake-method-record-drag',
				attr: { 'aria-label': this.context.t('form.record.reorder') },
			});
			setIcon(handle, 'grip-vertical');
			this.makeRowDraggable(el, handle, index);
			const body = el.createDiv({ cls: 'snowflake-method-record-body' });
			const title = body.createEl('input', {
				type: 'text',
				cls: 'snowflake-method-record-value snowflake-method-custom-field-title',
				value: row.title,
				attr: {
					placeholder: this.context.t('form.customFields.titlePlaceholder'),
					'aria-label': this.context.t('form.customFields.titlePlaceholder'),
				},
			});
			title.addEventListener('input', () => {
				row.title = title.value;
				this.context.markTouched();
			});
			const content = body.createEl('textarea', {
				cls: 'snowflake-method-custom-field-content',
				attr: {
					placeholder: this.context.t(
						'form.customFields.contentPlaceholder',
					),
					'aria-label': row.title,
					rows: '2',
				},
			});
			content.value = row.content;
			content.addEventListener('input', () => {
				row.content = content.value;
				this.context.markTouched();
			});
			const remove = el.createEl('button', {
				cls: 'snowflake-method-record-card-close clickable-icon',
				attr: {
					type: 'button',
					'aria-label': this.context.t('form.customFields.remove', {
						name: row.title,
					}),
				},
			});
			setIcon(remove, 'trash-2');
			remove.addEventListener('click', () => {
				this.context.rows.splice(index, 1);
				this.context.markTouched();
				this.renderRows();
			});
		});
	}

	/**
	 * Fields keep the order they are given, so that order is the author's to
	 * set — the record cards' own rule, moved the record cards' own way. Only
	 * the handle starts a drag, and a drop reorders the shared rows and
	 * redraws, which is also what retires every listener the old cards held.
	 */
	private makeRowDraggable(
		el: HTMLElement,
		handle: HTMLElement,
		index: number,
	): void {
		handle.addEventListener('mousedown', () => {
			el.draggable = true;
		});
		handle.addEventListener('mouseup', () => {
			el.draggable = false;
		});
		el.addEventListener('dragstart', (event) => {
			this.draggingIndex = index;
			el.addClass('is-dragging');
			if (event.dataTransfer === null) return;
			event.dataTransfer.effectAllowed = 'move';
			// A drag has to carry something to start at all.
			event.dataTransfer.setData('text/plain', '');
		});
		el.addEventListener('dragend', () => {
			el.draggable = false;
			el.removeClass('is-dragging');
			this.draggingIndex = null;
		});
		el.addEventListener('dragover', (event) => {
			if (this.draggingIndex === null || this.draggingIndex === index) return;
			event.preventDefault();
			el.addClass('is-drop-target');
		});
		el.addEventListener('dragleave', () => {
			el.removeClass('is-drop-target');
		});
		el.addEventListener('drop', (event) => {
			el.removeClass('is-drop-target');
			const from = this.draggingIndex;
			if (from === null || from === index) return;
			event.preventDefault();
			this.draggingIndex = null;
			const [moved] = this.context.rows.splice(from, 1);
			if (moved === undefined) return;
			this.context.rows.splice(index, 0, moved);
			this.context.markTouched();
			this.renderRows();
		});
	}
}

/**
 * What a stored label reads as: the taxonomy path derived from its target
 * whenever the target sits in this editor's tree, because the target carries
 * identity and the alias is only a display cache -- stale after a folder
 * rename until the health checker rewrites it. A target from anywhere else
 * falls back to the alias, which is all there is to go on.
 */
function labelDisplay(
	label: { path: string; display: string },
	definitionPath: string,
): string {
	const prefix = `${definitionPath}/`;
	const target = label.path.trim().replace(/\.md$/u, '');
	if (!target.startsWith(prefix)) return label.display;
	const segments = target.slice(prefix.length).split('/');
	const last = segments.pop();
	const parent = segments[segments.length - 1];
	// The note segment: the leaf repeating its folder.
	const namesNode =
		last !== undefined &&
		parent !== undefined &&
		foldName(last) === foldName(parent);
	if (!namesNode) return label.display;
	const path = segments.join('/');
	return path.length > 0 ? path : label.display;
}

function termText(term: RecordTerm): string {
	return term.kind === 'text' ? term.text : term.name;
}

/**
 * The grammar keeps a record on one line, so the line breaks the taller value
 * field lets an author type read back out as spaces.
 */
function oneLineValue(text: string): string {
	return text
		.split(/\r\n|\r|\n/u)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join(' ');
}

function linkPath(term: RecordTerm): string | null {
	return term.kind === 'link' ? term.path : null;
}

