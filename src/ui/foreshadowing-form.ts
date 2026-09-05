import { Notice, Setting, setIcon, setTooltip, type App } from 'obsidian';

import {
	OCCURRENCE_ROLES,
	fileStem,
	isOccurrenceRole,
	type EntityRef,
	type EntityRosterEntry,
	type Foreshadowing,
	type ForeshadowingRef,
	type ForeshadowingStatus,
	type OccurrenceRole,
} from '../domain';
import {
	addEnumSelect,
	addForeshadowingStatusControl,
	entityGroupLabel,
	renderRecordLine,
	renderRecordPickFrame,
} from './entity-form';
import {
	ConfirmModal,
	promptForEntityReference,
	SnowflakeFormModal,
	type EntityReferenceSource,
	type SubmitHandler,
	type Translate,
} from './modals';
import { truncateEnd } from './mention-rows';
import { buildOptionField, type OptionPicker } from './option-picker';

/**
 * The dialogs a foreshadowing is made and kept through: the thread's own
 * form, shared by a creation from a selection in the stream (the selection
 * becomes the first occurrence) and an edit from the table or a card; the
 * small forms that add a selection to a standing thread and relink an
 * unresolved occurrence; the one that edits a single occurrence; and the
 * confirmation before a thread goes with everything it holds.
 *
 * A refused write is thrown from the submit handler, which is what keeps a
 * form open on what was typed: the base closes on a normal return.
 */

/**
 * One occurrence as the thread's form edits it: role and note; the position
 * and the words are read-only. The host lists them in manuscript order,
 * which is the number each card wears.
 */
export interface ForeshadowingOccurrenceDraft {
	id: string;
	role: OccurrenceRole;
	note: string;
	/** The chapter it stands in, for the card's position line. */
	title: string;
	/** The words it marks, as they were marked. */
	text: string;
	unresolved: boolean;
}

export interface ForeshadowingFormResult {
	name: string;
	description: string;
	status: ForeshadowingStatus;
	related: EntityRef[];
	/** The occurrences the form showed and kept, role and note as edited. */
	occurrences: { id: string; role: OccurrenceRole; note: string }[];
	/** The occurrences the form took out. */
	removed: string[];
	/** The occurrence a stream selection is asking to add; null otherwise. */
	initial: { role: OccurrenceRole; note: string } | null;
}

export interface ForeshadowingFormOptions {
	title: string;
	submitLabelKey: string;
	/** Every entity the project can point at. */
	roster: readonly EntityRosterEntry[];
	/** What the form opens on; absent for a new thread. */
	initial?: {
		name: string;
		description: string;
		status: ForeshadowingStatus;
		related: readonly EntityRef[];
		occurrences: readonly ForeshadowingOccurrenceDraft[];
	};
	/** Set only when a stream selection opened the form. */
	seedOccurrence?: { title: string; text: string; role: OccurrenceRole };
	/**
	 * Offered only in edit mode: confirms and deletes the thread, answering
	 * true once it is gone, on which the form closes without saving.
	 */
	onDelete?: () => Promise<boolean>;
	/**
	 * Offered only in edit mode: shows an occurrence in the stream -- the
	 * passage, or the pinned card of one the chapter no longer answers for.
	 * The form stays open over it, keeping what was typed.
	 */
	onReveal?: (occurrenceId: string) => void;
}

/**
 * The two named rows every occurrence dialog opens with, above the fields
 * that describe the occurrence: the position -- the chapter, a link to the
 * passage where the host can show it -- and the words whole, on the
 * thread's ground. One shape for the three dialogs, however each was
 * reached: editing an occurrence from the table, adding the selection to a
 * thread, relinking one.
 */
function placeRows(
	host: HTMLElement,
	t: Translate,
	place: { title: string; text: string; unresolved?: boolean; reveal?: () => void },
): void {
	const position = new Setting(host).setName(t('manuscript.foreshadowing.place'));
	const name = position.controlEl.createSpan({
		cls: 'snowflake-method-foreshadowing-occurrence-place-title',
		text: place.title,
	});
	if (place.unresolved === true) {
		position.controlEl.addClass('snowflake-method-foreshadowing-occurrence-place');
		position.controlEl.addClass('is-unresolved');
		position.setDesc(t('manuscript.foreshadowing.unresolvedHint'));
		position.descEl.addClass('snowflake-method-foreshadowing-unresolved-hint');
	}
	const reveal = place.reveal;
	if (reveal !== undefined) {
		name.addClass('is-link');
		name.setAttr('role', 'link');
		name.setAttr('tabindex', '0');
		name.addEventListener('click', reveal);
		name.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			reveal();
		});
	}
	new Setting(host)
		.setName(t('manuscript.foreshadowing.text'))
		.controlEl.createDiv({
			cls: 'snowflake-method-foreshadowing-passage',
			text: place.text,
		});
}

function addRoleDropdown(
	setting: Setting,
	t: Translate,
	initial: OccurrenceRole,
	onChange: (role: OccurrenceRole) => void,
): void {
	setting.addDropdown((dropdown) => {
		for (const role of OCCURRENCE_ROLES) {
			dropdown.addOption(role, t(`foreshadowing.role.${role}`));
		}
		dropdown.setValue(initial).onChange((value) => {
			onChange(isOccurrenceRole(value) ? value : initial);
		});
	});
}

function addNoteArea(
	setting: Setting,
	t: Translate,
	initial: string,
	onChange: (note: string) => void,
): void {
	setting.addTextArea((area) => {
		area
			.setPlaceholder(t('manuscript.foreshadowing.notePlaceholder'))
			.setValue(initial)
			.onChange(onChange);
	});
}

/** The bare select a card's occurrence row carries, in the theme's dress. */
function roleSelect(
	host: HTMLElement,
	t: Translate,
	initial: OccurrenceRole,
	onChange: (role: OccurrenceRole) => void,
): HTMLSelectElement {
	return addEnumSelect(host, {
		cls: 'dropdown',
		ariaLabel: t('manuscript.foreshadowing.role'),
		values: OCCURRENCE_ROLES,
		label: (role) => t(`foreshadowing.role.${role}`),
		initial,
		is: isOccurrenceRole,
		fallback: initial,
		onChange,
	});
}

/**
 * The thread's own form. Related entities are held by id: ids are unique
 * across kinds, and a stored ref whose note has gone keeps its line marked
 * missing -- dropping it would erase what the author wrote by failing to
 * show it.
 */
class ForeshadowingModal extends SnowflakeFormModal<ForeshadowingFormResult> {
	private name: string;
	private description: string;
	private status: ForeshadowingStatus;
	/** The picked entities, by id. */
	private related: string[];
	private readonly occurrences: ForeshadowingOccurrenceDraft[];
	/** The ids the trash took out, staged until Save like the rest. */
	private readonly removed: string[] = [];
	private seed: { role: OccurrenceRole; note: string } | null;
	/** Everything an id may stand for: the roster, and the stored refs it lacks. */
	private readonly refs = new Map<string, EntityRef>();
	/** The group each roster entry lists under; an id absent here is missing. */
	private readonly groupOf = new Map<string, string>();

	constructor(
		app: App,
		t: Translate,
		private readonly options: ForeshadowingFormOptions,
		onSubmit: SubmitHandler<ForeshadowingFormResult>,
		private readonly settle: () => void,
	) {
		super(app, t, options.title, onSubmit, options.submitLabelKey);
		this.modalEl.addClass(
			'snowflake-method-character-modal',
			'snowflake-method-foreshadowing-modal',
		);
		const initial = options.initial;
		this.name = initial?.name ?? '';
		this.description = initial?.description ?? '';
		this.status = initial?.status ?? 'planned';
		this.related = (initial?.related ?? []).map((ref) => ref.id);
		this.occurrences = (initial?.occurrences ?? []).map((occurrence) => ({
			...occurrence,
		}));
		this.seed =
			options.seedOccurrence === undefined
				? null
				: { role: options.seedOccurrence.role, note: '' };
		for (const entry of options.roster) {
			this.refs.set(entry.id, { kind: entry.kind, id: entry.id, name: entry.name });
			this.groupOf.set(entry.id, entry.group);
		}
		for (const ref of initial?.related ?? []) {
			if (this.refs.has(ref.id)) continue;
			this.refs.set(ref.id, { kind: ref.kind, id: ref.id, name: ref.name });
		}
	}

	protected buildForm(): void {
		const t = this.t;
		this.contentEl.addClass(
			'snowflake-method-character-form',
			'snowflake-method-foreshadowing-form',
		);
		addForeshadowingStatusControl(this.titleControls(), t, this.status, (value) => {
			this.status = value;
		});
		const nameSetting = new Setting(this.contentEl)
			.setName(`${t('modal.foreshadowing.name')} *`)
			.addText((text) => {
				text.setValue(this.name).onChange((value) => {
					this.name = value;
				});
				// The field the author came to type in, when the thread is
				// new; an edit opens with nothing focused, like every form.
				if (this.options.initial === undefined) {
					this.contentEl.win.setTimeout(() => {
						text.inputEl.focus();
					}, 0);
				}
			});
		nameSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-character-name-setting',
		);
		const descriptionSetting = new Setting(this.contentEl)
			.setName(t('modal.foreshadowing.description'))
			.addTextArea((area) => {
				area
					.setPlaceholder(t('form.description.placeholder'))
					.setValue(this.description)
					.onChange((value) => {
						this.description = value;
					});
			});
		descriptionSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-foreshadowing-wide',
		);
		const relatedSetting = new Setting(this.contentEl).setName(
			t('modal.foreshadowing.related'),
		);
		relatedSetting.settingEl.addClass(
			'snowflake-method-character-setting',
			'snowflake-method-foreshadowing-wide',
		);
		this.buildRelated(relatedSetting.controlEl);
		if (this.options.seedOccurrence !== undefined && this.seed !== null) {
			this.buildSeed(this.options.seedOccurrence, this.seed);
		}
		if (this.options.initial !== undefined) this.buildOccurrences();
	}

	/** Delete foreshadowing, at the start of the footer across from Save. */
	protected leadingActions(actions: HTMLElement): void {
		const onDelete = this.options.onDelete;
		if (onDelete === undefined) return;
		const button = actions.createEl('button', {
			cls: 'mod-warning snowflake-method-modal-leading-action',
			text: this.t('actions.delete'),
			attr: { type: 'button' },
		});
		button.addEventListener('click', () => {
			void onDelete()
				.then((gone) => {
					if (gone) this.close();
				})
				.catch((error: unknown) => {
					new Notice(
						error instanceof Error ? error.message : this.t('errors.unknown'),
					);
				});
		});
	}

	/**
	 * The entities the thread touches: one line each with a way off, and
	 * under them the chooser a relationship's target wears -- the kind asked
	 * first, then the note -- standing after every pick, since a thread
	 * touches as many as it touches. A stored ref whose note has gone keeps
	 * its line, marked, rather than being dropped on save.
	 */
	private buildRelated(host: HTMLElement): void {
		const t = this.t;
		const block = host.createDiv({ cls: 'snowflake-method-foreshadowing-related' });
		const lines = block.createDiv({ cls: 'snowflake-method-record-lines' });
		const draw = (): void => {
			lines.empty();
			for (const id of this.related) {
				const ref = this.refs.get(id);
				if (ref === undefined) continue;
				const group = this.groupOf.get(id);
				renderRecordLine(
					lines,
					{
						label: entityGroupLabel(t, group ?? ref.kind),
						text: ref.name,
						missing: group === undefined,
						missingTitle: t('modal.foreshadowing.relatedMissing', {
							name: ref.name,
						}),
						removeLabel: t('modal.foreshadowing.relatedRemove', {
							name: ref.name,
						}),
					},
					() => {
						this.related = this.related.filter((candidate) => candidate !== id);
						draw();
					},
				);
			}
		};
		draw();
		const offered = this.options.roster.length > 0;
		renderRecordPickFrame(
			block,
			t(
				offered
					? 'modal.foreshadowing.relatedPlaceholder'
					: 'modal.foreshadowing.relatedEmpty',
			),
			() => {
				if (!offered) return;
				void promptForEntityReference(this.app, t, this.referenceSource()).then(
					(picked) => {
						if (picked === null || this.related.includes(picked.option.value)) {
							return;
						}
						this.related.push(picked.option.value);
						draw();
					},
				);
			},
		);
	}

	/**
	 * The roster as the reference dialog reads it: the kinds in the order
	 * the roster lists them, and under each the notes not yet picked. No
	 * creating from here: a thread points at what the project has.
	 */
	private referenceSource(): EntityReferenceSource {
		const t = this.t;
		const groups: string[] = [];
		for (const entry of this.options.roster) {
			if (!groups.includes(entry.group)) groups.push(entry.group);
		}
		return {
			groups: () => groups.map((id) => ({ id, label: entityGroupLabel(t, id) })),
			entitiesIn: (group) =>
				this.options.roster
					.filter(
						(entry) => entry.group === group && !this.related.includes(entry.id),
					)
					.map((entry) => ({ value: entry.id, label: entry.name })),
		};
	}

	/** The selection that opened the form, becoming the thread's first occurrence. */
	/**
	 * The first occurrence of a new thread: the selection the dialog was
	 * opened on, as one record card with no way off -- the words are the
	 * reason the dialog is open.
	 */
	private buildSeed(
		place: { title: string; text: string },
		seed: { role: OccurrenceRole; note: string },
	): void {
		const { cards } = this.occurrenceEditor(
			this.t('modal.foreshadowing.initialOccurrence'),
		);
		const { body } = this.occurrenceCard(cards, 1, null);
		this.roleLine(body, seed.role, (role) => {
			seed.role = role;
		});
		this.placeLine(body, place.title, false, null);
		this.textLine(body, place.text);
		this.noteLine(body, seed.note, (note) => {
			seed.note = note;
		});
	}

	/**
	 * The occurrences the thread holds, one record card each: role and note
	 * open to change, the place read-only, and a trash that only stages the
	 * deletion -- nothing is written until Save, and Cancel takes the
	 * staging with it. No adding here: an occurrence is a selection in the
	 * stream, which the line under the cards says.
	 */
	private buildOccurrences(): void {
		const t = this.t;
		const { block, cards } = this.occurrenceEditor(
			t('modal.foreshadowing.occurrences'),
		);
		const onReveal = this.options.onReveal;
		this.occurrences.forEach((occurrence, at) => {
			const { body } = this.occurrenceCard(cards, at + 1, (card) => {
				const index = this.occurrences.indexOf(occurrence);
				if (index >= 0) this.occurrences.splice(index, 1);
				this.removed.push(occurrence.id);
				card.remove();
				// The numbers are the order the survivors stand in.
				cards
					.querySelectorAll('.snowflake-method-record-order-number')
					.forEach((badge, place) => {
						badge.setText(String(place + 1));
					});
			});
			this.roleLine(body, occurrence.role, (role) => {
				occurrence.role = role;
			});
			this.placeLine(
				body,
				occurrence.title,
				occurrence.unresolved,
				onReveal === undefined
					? null
					: () => {
							onReveal(occurrence.id);
						},
			);
			this.textLine(body, occurrence.text);
			this.noteLine(body, occurrence.note, (note) => {
				occurrence.note = note;
			});
		});
		block.createEl('p', {
			cls: 'snowflake-method-character-empty',
			text: t('modal.foreshadowing.occurrencesEmpty'),
		});
	}

	/** The block a record editor stands in: a title, and the cards under it. */
	private occurrenceEditor(title: string): {
		block: HTMLElement;
		cards: HTMLElement;
	} {
		const block = this.contentEl.createDiv({
			cls: 'snowflake-method-record-editor snowflake-method-foreshadowing-wide',
		});
		block.createDiv({ cls: 'snowflake-method-record-title', text: title });
		return { block, cards: block.createDiv({ cls: 'snowflake-method-record-cards' }) };
	}

	/**
	 * A record card whose handle is a number: an occurrence keeps the
	 * manuscript's order, not the author's, so where a record's drag handle
	 * goes the card says which it is in that order. The trash at its end
	 * when there is a way off.
	 */
	private occurrenceCard(
		cards: HTMLElement,
		number: number,
		remove: ((card: HTMLElement) => void) | null,
	): { card: HTMLElement; body: HTMLElement } {
		const card = cards.createDiv({
			cls: 'snowflake-method-record-card snowflake-method-foreshadowing-occurrence-card',
		});
		card
			.createDiv({ cls: 'snowflake-method-record-order' })
			.createSpan({
				cls: 'snowflake-method-record-order-number',
				text: String(number),
			});
		const body = card.createDiv({ cls: 'snowflake-method-record-body' });
		if (remove !== null) {
			const close = card.createEl('button', {
				cls: 'snowflake-method-record-card-close clickable-icon',
				attr: {
					type: 'button',
					'aria-label': this.t('modal.foreshadowing.occurrenceDelete'),
				},
			});
			setIcon(close, 'trash-2');
			setTooltip(close, this.t('modal.foreshadowing.occurrenceDelete'));
			close.addEventListener('click', () => {
				remove(card);
			});
		}
		return { card, body };
	}

	/**
	 * Every field of the card is a line the record card gives what it points
	 * at: the name of the field at the left, the field itself after it. The
	 * modifier class lets a line whose field runs to several lines stand its
	 * name on the first of them.
	 */
	private fieldLine(body: HTMLElement, label: string, modifier = ''): HTMLElement {
		const line = body.createDiv({
			cls: `snowflake-method-record-line snowflake-method-foreshadowing-field-line${
				modifier === '' ? '' : ` ${modifier}`
			}`,
		});
		line.createSpan({ cls: 'snowflake-method-record-line-label', text: label });
		return line;
	}

	/** The role, in the theme's select. */
	private roleLine(
		body: HTMLElement,
		initial: OccurrenceRole,
		onChange: (role: OccurrenceRole) => void,
	): void {
		const line = this.fieldLine(body, this.t('manuscript.foreshadowing.role'));
		roleSelect(line, this.t, initial, onChange).addClass(
			'snowflake-method-record-line-field',
		);
	}

	/**
	 * The chapter, with nothing to take it off by: the position is read here
	 * and never typed into, and where the host can show it, the name is the
	 * way there. One the chapter no longer answers for is marked and
	 * explained.
	 */
	private placeLine(
		body: HTMLElement,
		title: string,
		unresolved: boolean,
		reveal: (() => void) | null,
	): void {
		const t = this.t;
		const line = this.fieldLine(body, t('manuscript.foreshadowing.place'));
		const value = line.createSpan({
			cls: 'snowflake-method-record-line-value snowflake-method-foreshadowing-occurrence-place',
		});
		if (unresolved) {
			value.addClass('is-unresolved');
			setIcon(
				value.createSpan({ cls: 'snowflake-method-character-empty-icon' }),
				'triangle-alert',
			);
			setTooltip(value, t('manuscript.foreshadowing.unresolvedHint'));
		}
		const name = value.createSpan({
			cls: 'snowflake-method-foreshadowing-occurrence-place-title',
			text: title,
		});
		if (reveal === null) return;
		name.addClass('is-link');
		name.setAttr('role', 'link');
		name.setAttr('tabindex', '0');
		name.addEventListener('click', reveal);
		name.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			reveal();
		});
	}

	/** The words the occurrence marks, whole, on the thread's own ground. */
	private textLine(body: HTMLElement, text: string): void {
		const line = this.fieldLine(
			body,
			this.t('manuscript.foreshadowing.text'),
			'snowflake-method-foreshadowing-text-line',
		);
		line.createSpan({
			cls: 'snowflake-method-record-line-value snowflake-method-foreshadowing-passage',
			text,
		});
	}

	/** The note, in the field a record card keeps its value in. */
	private noteLine(
		body: HTMLElement,
		initial: string,
		onChange: (note: string) => void,
	): void {
		const line = this.fieldLine(
			body,
			this.t('manuscript.foreshadowing.note'),
			'snowflake-method-foreshadowing-note-line',
		);
		const note = line.createEl('textarea', {
			cls: 'snowflake-method-record-value snowflake-method-record-line-field',
			attr: {
				rows: '2',
				placeholder: this.t('manuscript.foreshadowing.notePlaceholder'),
			},
		});
		note.value = initial;
		note.addEventListener('input', () => {
			onChange(note.value);
		});
	}

	onClose(): void {
		super.onClose();
		this.settle();
	}

	protected collectValue(): ForeshadowingFormResult | null {
		const name = this.name.trim();
		if (name.length === 0) {
			new Notice(this.t('modal.foreshadowing.nameRequired'));
			return null;
		}
		return {
			name,
			description: this.description.trim(),
			status: this.status,
			// Missing ones included: dropping them would erase what the author
			// wrote.
			related: this.related.flatMap((id) => {
				const ref = this.refs.get(id);
				return ref === undefined ? [] : [{ ...ref }];
			}),
			occurrences: this.occurrences.map(({ id, role, note }) => ({
				id,
				role,
				note: note.trim(),
			})),
			removed: [...this.removed],
			initial:
				this.seed === null
					? null
					: { role: this.seed.role, note: this.seed.note.trim() },
		};
	}
}

/**
 * Opens the thread's form and resolves when it closes, whichever way. The
 * work happens in `onSubmit`; throwing from it keeps the form open with a
 * notice, which is how a refused write is answered.
 */
export function promptForForeshadowing(
	app: App,
	t: Translate,
	options: ForeshadowingFormOptions,
	onSubmit: SubmitHandler<ForeshadowingFormResult>,
): Promise<void> {
	return new Promise((resolve) => {
		new ForeshadowingModal(app, t, options, onSubmit, resolve).open();
	});
}

/** Where an occurrence stands, as its own dialog shows it. */
/** The picker's box in a dialog row: the row's whole width, as the role's dropdown takes it. */
const PICKER_CLS = 'snowflake-method-foreshadowing-picker';

export interface OccurrencePlace {
	title: string;
	/** The words, whole. */
	text: string;
	unresolved: boolean;
	/** Shows the occurrence in the stream; absent, the position is plain. */
	reveal?: () => void;
}

/** One occurrence's role and note, edited from the table. */
class OccurrenceModal extends SnowflakeFormModal<{
	role: OccurrenceRole;
	note: string;
}> {
	private role: OccurrenceRole;
	private note: string;

	constructor(
		app: App,
		t: Translate,
		private readonly place: OccurrencePlace,
		initial: { role: OccurrenceRole; note: string },
		onSubmit: SubmitHandler<{ role: OccurrenceRole; note: string }>,
		private readonly settle: () => void,
	) {
		super(app, t, t('modal.occurrence.title'), onSubmit, 'common.save');
		this.role = initial.role;
		this.note = initial.note;
		this.modalEl.addClass(
			'snowflake-method-project-modal',
			'snowflake-method-compact-form-modal',
		);
	}

	protected buildForm(): void {
		const t = this.t;
		this.contentEl.addClass('snowflake-method-project-form');
		placeRows(this.contentEl, t, this.place);
		addRoleDropdown(
			new Setting(this.contentEl).setName(t('manuscript.foreshadowing.role')),
			t,
			this.role,
			(role) => {
				this.role = role;
			},
		);
		addNoteArea(
			new Setting(this.contentEl).setName(
				t('manuscript.foreshadowing.noteOptional'),
			),
			t,
			this.note,
			(note) => {
				this.note = note;
			},
		);
	}

	onClose(): void {
		super.onClose();
		this.settle();
	}

	protected collectValue(): { role: OccurrenceRole; note: string } {
		return { role: this.role, note: this.note.trim() };
	}
}

export function promptForForeshadowingOccurrence(
	app: App,
	t: Translate,
	place: OccurrencePlace,
	initial: { role: OccurrenceRole; note: string },
	onSubmit: SubmitHandler<{ role: OccurrenceRole; note: string }>,
): Promise<void> {
	return new Promise((resolve) => {
		new OccurrenceModal(app, t, place, initial, onSubmit, resolve).open();
	});
}

export interface PickedForeshadowing {
	foreshadowingId: string;
	role: OccurrenceRole;
	note: string;
}

/**
 * Adds a selection to a thread already standing: the threads searched by
 * name and grouped by status, so the ones in play are where the author is
 * looking; then the role and note the new occurrence takes.
 */
class PickForeshadowingModal extends SnowflakeFormModal<PickedForeshadowing> {
	private readonly pickers: OptionPicker[] = [];
	private picked = '';
	private role: OccurrenceRole = 'reinforce';
	private note = '';

	constructor(
		app: App,
		t: Translate,
		private readonly items: readonly Foreshadowing[],
		private readonly place: { title: string; text: string },
		onSubmit: SubmitHandler<PickedForeshadowing>,
		private readonly settle: () => void,
	) {
		super(app, t, t('manuscript.foreshadowing.addTitle'), onSubmit, 'common.add');
		this.modalEl.addClass(
			'snowflake-method-project-modal',
			'snowflake-method-compact-form-modal',
		);
	}

	protected buildForm(): void {
		const t = this.t;
		this.contentEl.addClass('snowflake-method-project-form');
		placeRows(this.contentEl, t, this.place);
		const pick = new Setting(this.contentEl).setName(
			t('manuscript.foreshadowing.pick'),
		);
		// The threads come in the table's order -- status first, then first
		// appearance -- so the headings the sections make are the table's
		// groups, each once.
		this.pickers.push(
			buildOptionField(this.app, pick.controlEl.createDiv({ cls: PICKER_CLS }), {
				options: () =>
					this.items.map((item) => ({
						value: item.id,
						label: item.name,
						section: t(`foreshadowing.status.${item.status}`),
					})),
				label: t('manuscript.foreshadowing.pick'),
				placeholder: t('manuscript.foreshadowing.pickPlaceholder'),
				emptyPlaceholder: t('manuscript.foreshadowing.pickEmpty'),
				required: true,
				value: () => this.picked,
				choose: (value) => {
					this.picked = value;
				},
			}),
		);
		addRoleDropdown(
			new Setting(this.contentEl).setName(t('manuscript.foreshadowing.role')),
			t,
			this.role,
			(role) => {
				this.role = role;
			},
		);
		addNoteArea(
			new Setting(this.contentEl).setName(
				t('manuscript.foreshadowing.noteOptional'),
			),
			t,
			this.note,
			(note) => {
				this.note = note;
			},
		);
	}

	protected renderForm(): void {
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.renderForm();
	}

	onClose(): void {
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.onClose();
		this.settle();
	}

	protected collectValue(): PickedForeshadowing | null {
		if (this.picked.length === 0) {
			new Notice(this.t('manuscript.foreshadowing.pickRequired'));
			return null;
		}
		return { foreshadowingId: this.picked, role: this.role, note: this.note.trim() };
	}
}

export function promptForForeshadowingPick(
	app: App,
	t: Translate,
	items: readonly Foreshadowing[],
	place: { title: string; text: string },
	onSubmit: SubmitHandler<PickedForeshadowing>,
): Promise<void> {
	return new Promise((resolve) => {
		new PickForeshadowingModal(app, t, items, place, onSubmit, resolve).open();
	});
}

export interface RelinkChoice {
	foreshadowingId: string;
	occurrenceId: string;
}

/**
 * Puts a selection under an occurrence its chapter no longer answers for:
 * the unresolved occurrences searched by thread, role and the words they
 * marked, grouped by the chapter they were lost in, which is how the author
 * remembers them.
 */
class RelinkOccurrenceModal extends SnowflakeFormModal<RelinkChoice> {
	private readonly pickers: OptionPicker[] = [];
	private picked = '';

	constructor(
		app: App,
		t: Translate,
		private readonly waiting: readonly ForeshadowingRef[],
		private readonly titles: ReadonlyMap<string, string>,
		private readonly place: { title: string; text: string },
		onSubmit: SubmitHandler<RelinkChoice>,
		private readonly settle: () => void,
	) {
		super(app, t, t('manuscript.foreshadowing.relinkTitle'), onSubmit, 'common.save');
		this.modalEl.addClass(
			'snowflake-method-project-modal',
			'snowflake-method-compact-form-modal',
		);
	}

	protected buildForm(): void {
		const t = this.t;
		this.contentEl.addClass('snowflake-method-project-form');
		placeRows(this.contentEl, t, this.place);
		const pick = new Setting(this.contentEl).setName(
			t('manuscript.foreshadowing.occurrencePick'),
		);
		this.pickers.push(
			buildOptionField(this.app, pick.controlEl.createDiv({ cls: PICKER_CLS }), {
				options: () =>
					this.waiting.map(({ item, occurrence }) => ({
						value: occurrence.id,
						label: `${item.name} · ${t(`foreshadowing.role.${occurrence.role}`)} · “${truncateEnd(occurrence.originalText, 40)}”`,
						section: this.titles.get(occurrence.path) ?? fileStem(occurrence.path),
					})),
				label: t('manuscript.foreshadowing.occurrencePick'),
				placeholder: t('manuscript.foreshadowing.occurrencePlaceholder'),
				emptyPlaceholder: t('manuscript.foreshadowing.noUnresolved'),
				required: true,
				value: () => this.picked,
				choose: (value) => {
					this.picked = value;
				},
			}),
		);
	}

	protected renderForm(): void {
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.renderForm();
	}

	onClose(): void {
		for (const picker of this.pickers.splice(0)) picker.destroy();
		super.onClose();
		this.settle();
	}

	protected collectValue(): RelinkChoice | null {
		const ref = this.waiting.find(({ occurrence }) => occurrence.id === this.picked);
		if (ref === undefined) {
			new Notice(this.t('manuscript.foreshadowing.pickRequired'));
			return null;
		}
		return { foreshadowingId: ref.item.id, occurrenceId: ref.occurrence.id };
	}
}

export function promptForOccurrenceRelink(
	app: App,
	t: Translate,
	waiting: readonly ForeshadowingRef[],
	titles: ReadonlyMap<string, string>,
	place: { title: string; text: string },
	onSubmit: SubmitHandler<RelinkChoice>,
): Promise<void> {
	return new Promise((resolve) => {
		new RelinkOccurrenceModal(app, t, waiting, titles, place, onSubmit, resolve).open();
	});
}

/** Before a thread goes with everything it holds. */
class ConfirmForeshadowingDeletionModal extends ConfirmModal {
	constructor(
		app: App,
		t: Translate,
		private readonly name: string,
		private readonly count: number,
		onResolve: (confirmed: boolean) => void,
	) {
		super(app, t, { label: t('actions.delete'), style: 'mod-warning' }, onResolve);
		this.setTitle(t('modal.foreshadowing.deleteTitle', { name }));
	}

	protected renderBody(body: HTMLElement): void {
		body.createEl('p', {
			text: this.t('modal.foreshadowing.deleteDescription', {
				name: this.name,
				count: this.count,
			}),
		});
	}
}

export function confirmForeshadowingDeletion(
	app: App,
	t: Translate,
	name: string,
	count: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmForeshadowingDeletionModal(app, t, name, count, resolve).open();
	});
}
