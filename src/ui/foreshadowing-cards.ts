import {
	OCCURRENCE_ROLES,
	type Foreshadowing,
	type ForeshadowingOccurrence,
	type OccurrenceRole,
} from '../domain';
import type { Translate } from './modals';
import type { RailParts } from './rail-parts';

/**
 * The foreshadowing family of margin card: one card per occurrence, standing
 * beside the passage it marks, saying which thread it belongs to and what
 * this appearance does for it. Drawn with the rail's shared parts, so it
 * reads as a revision card's sibling rather than a second kind of margin.
 */

export interface ForeshadowingCardEntry {
	item: Foreshadowing;
	occurrence: ForeshadowingOccurrence;
	/** The anchor's top relative to the segment, or null while unmeasurable. */
	top: number | null;
}

export interface ForeshadowingRailCallbacks {
	/**
	 * Takes an edited role and note, and answers once the write has either
	 * landed or failed. False keeps the form open on what was typed.
	 */
	onEditSave(
		item: Foreshadowing,
		occurrence: ForeshadowingOccurrence,
		patch: { role: OccurrenceRole; note: string },
	): Promise<boolean>;
	/** Takes this one occurrence out; the thread stands. */
	onDelete(item: Foreshadowing, occurrence: ForeshadowingOccurrence): void;
	/** Opens the thread itself, in its own editor. */
	onOpen(item: Foreshadowing): void;
	/** Whether the same thread has an occurrence one step back or on. */
	hasNeighbour(
		item: Foreshadowing,
		occurrence: ForeshadowingOccurrence,
		step: -1 | 1,
	): boolean;
	onJump(
		item: Foreshadowing,
		occurrence: ForeshadowingOccurrence,
		step: -1 | 1,
	): void;
}

/**
 * Everything a resting card is drawn from -- and not its offsets, for the
 * reason the revision print leaves them out: a card that only moved is
 * placed again, never rebuilt under the pointer.
 */
export const foreshadowingCardPrint = (
	item: Foreshadowing,
	occurrence: ForeshadowingOccurrence,
	readOnly: boolean,
	neighbours: [boolean, boolean],
	unresolved: boolean,
): string =>
	JSON.stringify([
		occurrence.id,
		occurrence.role,
		occurrence.note,
		occurrence.originalText,
		item.id,
		item.name,
		item.description,
		item.status,
		readOnly,
		neighbours,
		unresolved,
	]);

interface CardOptions {
	t: Translate;
	parts: RailParts;
	readOnly: boolean;
	callbacks: ForeshadowingRailCallbacks;
}

/**
 * The head, laid as a two-by-two grid: the field's name with the compass at
 * its right, and under them what this appearance does in the ink the table
 * gives the role -- a badge after it when the words are gone -- with the
 * thread's status, in the word the table gives it, centred under the
 * compass so the word and the arrows read as one column down the corner.
 */
function cardHead(
	card: HTMLElement,
	entry: ForeshadowingCardEntry,
	options: CardOptions,
	role: OccurrenceRole | 'unresolved',
	badge?: string,
): void {
	const { t, parts, callbacks } = options;
	const head = parts.headBlock(card);
	const field = parts.fieldBlock(head, 'role', t('manuscript.foreshadowing.role'));
	parts.navGroup(
		field,
		{
			previous: t('manuscript.foreshadowing.previous'),
			next: t('manuscript.foreshadowing.next'),
		},
		(step) => callbacks.hasNeighbour(entry.item, entry.occurrence, step),
		(step) => {
			callbacks.onJump(entry.item, entry.occurrence, step);
		},
	);
	const value = field.createDiv({ cls: 'snowflake-method-rail-value' });
	value.createSpan({
		cls: 'snowflake-method-foreshadowing-role',
		attr: { 'data-role': role },
		text: t(`foreshadowing.role.${entry.occurrence.role}`),
	});
	if (badge !== undefined) {
		value.createSpan({ cls: 'snowflake-method-rail-badge', text: badge });
	}
	field.createSpan({
		cls: `snowflake-method-entity-status snowflake-method-rail-status is-${entry.item.status}`,
		text: t(`foreshadowing.status.${entry.item.status}`),
	});
}

/** The thread's own fields: its name, and what it promises when it says. */
function threadFields(
	fields: HTMLElement,
	entry: ForeshadowingCardEntry,
	options: Pick<CardOptions, 't' | 'parts'>,
): void {
	const { t, parts } = options;
	parts.valueBlock(
		fields,
		'name',
		t('manuscript.foreshadowing.name'),
		entry.item.name,
	);
	if (entry.item.description.length > 0) {
		parts.valueBlock(
			fields,
			'description',
			t('manuscript.foreshadowing.description'),
			entry.item.description,
		);
	}
}

/**
 * A resting card: the thread, the words this appearance marks, its note,
 * and what can be done.
 */
export function renderForeshadowingCard(
	card: HTMLElement,
	entry: ForeshadowingCardEntry,
	options: CardOptions & { beginEdit: () => void },
): void {
	const { t, parts, callbacks } = options;
	cardHead(card, entry, options, entry.occurrence.role);
	const fields = parts.fieldsBlock(card);
	threadFields(fields, entry, options);
	parts.valueBlock(
		fields,
		'passage',
		t('manuscript.foreshadowing.text'),
		entry.occurrence.originalText,
	);
	if (entry.occurrence.note.length > 0) {
		parts.valueBlock(
			fields,
			'note',
			t('manuscript.foreshadowing.note'),
			entry.occurrence.note,
		);
	}
	if (options.readOnly) return;
	// Mildest first, and the one that takes something away at the end.
	const actions = parts.actionRow(card, 'balanced');
	parts.actionButton(actions, t('manuscript.foreshadowing.open'), () => {
		callbacks.onOpen(entry.item);
	});
	parts.actionButton(actions, t('manuscript.foreshadowing.edit'), options.beginEdit);
	parts.actionButton(
		actions,
		t('manuscript.foreshadowing.delete'),
		() => {
			callbacks.onDelete(entry.item, entry.occurrence);
		},
		'danger',
	);
}

/**
 * The card for an occurrence the note no longer answers for: pinned at the
 * head of the rail, badged, showing the words it marked and asking for a
 * fresh selection -- which is made through the context menu's relink, so
 * the card offers only the thread and the way out.
 */
export function renderUnresolvedOccurrenceCard(
	card: HTMLElement,
	entry: ForeshadowingCardEntry,
	options: CardOptions,
): void {
	const { t, parts, callbacks } = options;
	card.addClass('is-conflict');
	cardHead(
		card,
		entry,
		options,
		'unresolved',
		t('manuscript.foreshadowing.unresolved'),
	);
	const fields = parts.fieldsBlock(card);
	threadFields(fields, entry, options);
	parts.valueBlock(
		fields,
		'original',
		t('manuscript.foreshadowing.text'),
		entry.occurrence.originalText,
	);
	if (entry.occurrence.note.length > 0) {
		parts.valueBlock(
			fields,
			'note',
			t('manuscript.foreshadowing.note'),
			entry.occurrence.note,
		);
	}
	card.createDiv({
		cls: 'snowflake-method-rail-hint',
		text: t('manuscript.foreshadowing.unresolvedHint'),
	});
	if (options.readOnly) return;
	const actions = parts.actionRow(card, 'end');
	parts.actionButton(actions, t('manuscript.foreshadowing.open'), () => {
		callbacks.onOpen(entry.item);
	});
	parts.actionButton(
		actions,
		t('manuscript.foreshadowing.delete'),
		() => {
			callbacks.onDelete(entry.item, entry.occurrence);
		},
		'danger',
	);
}

/**
 * The editable face: the thread named and described but not offered for
 * typing -- it is edited in its own dialog -- the words this appearance
 * marks, and its role and note open to change, cancel and save.
 */
export function renderForeshadowingForm(
	card: HTMLElement,
	entry: ForeshadowingCardEntry,
	options: {
		t: Translate;
		parts: RailParts;
		onSave(patch: { role: OccurrenceRole; note: string }): void;
		onCancel(): void;
	},
): void {
	const { t, parts } = options;
	const fields = parts.fieldsBlock(card);
	threadFields(fields, entry, options);
	parts.valueBlock(
		fields,
		'passage',
		t('manuscript.foreshadowing.text'),
		entry.occurrence.originalText,
	);
	// Its own part name, not the head's: the head lays `role` as a grid
	// with the compass, and a select wants the plain named block.
	const roleField = parts.fieldBlock(
		fields,
		'role-pick',
		t('manuscript.foreshadowing.role'),
	);
	const select = roleField.createEl('select', {
		cls: 'dropdown snowflake-method-rail-select',
		attr: { 'aria-label': t('manuscript.foreshadowing.role') },
	});
	for (const role of OCCURRENCE_ROLES) {
		select.createEl('option', {
			text: t(`foreshadowing.role.${role}`),
			attr: { value: role },
		});
	}
	select.value = entry.occurrence.role;
	const noteInput = parts.inputBlock(
		fields,
		'note',
		t('manuscript.foreshadowing.noteOptional'),
		{
			value: entry.occurrence.note,
			placeholder: t('manuscript.foreshadowing.notePlaceholder'),
		},
	);
	const actions = parts.actionRow(card, 'end');
	parts.actionButton(actions, t('manuscript.foreshadowing.cancel'), () => {
		options.onCancel();
	});
	parts.actionButton(
		actions,
		t('manuscript.foreshadowing.save'),
		() => {
			const role = (OCCURRENCE_ROLES as readonly string[]).includes(select.value)
				? (select.value as OccurrenceRole)
				: entry.occurrence.role;
			options.onSave({ role, note: noteInput.value });
		},
		'primary',
	);
	// Never let focus scroll, for the reason the revision form gives: the
	// card may not have its top yet, and the words it stands beside are
	// already on the screen.
	noteInput.focus({ preventScroll: true });
}
