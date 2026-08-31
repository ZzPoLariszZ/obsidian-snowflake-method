import type { Revision } from '../domain';
import type { Translate } from './modals';

/**
 * The revision rail: one absolutely positioned column per segment, standing
 * to the right of the manuscript, holding a card per revision the segment
 * carries. The stream computes where each revision's text sits and hands the
 * tops in; the rail draws the cards and settles collisions by pushing down,
 * the way a margin of comments does. Cards being edited keep their elements
 * and their unsaved text across a sync, because a dress refresh mid-thought
 * must not eat a sentence.
 */

export interface RevisionCardEntry {
	revision: Revision;
	/** Where the revision's text stands NOW, in body offsets. */
	from: number;
	to: number;
	/** The anchor's top relative to the segment, or null while unmeasurable. */
	top: number | null;
}

/** A revision being made: everything but the proposed text and comment. */
export interface RevisionDraft {
	path: string;
	kind: Revision['kind'];
	from: number;
	to: number;
	originalText: string;
	top: number | null;
}

export interface RevisionRailModel {
	entries: RevisionCardEntry[];
	conflicts: Revision[];
	draft: RevisionDraft | null;
	readOnly: boolean;
}

export interface RevisionRailCallbacks {
	t: Translate;
	onAccept(revision: Revision): void;
	onReject(revision: Revision): void;
	onDiscard(revision: Revision): void;
	/**
	 * Takes an edited revision. False means it was refused -- the card stays
	 * open on what was typed instead of closing over a save that never
	 * happened.
	 */
	onEditSave(revision: Revision, proposed: string, comment: string): boolean;
	onDraftSave(proposed: string, comment: string): void;
	onDraftCancel(): void;
}

export interface RevisionRail {
	sync(model: RevisionRailModel): void;
	dispose(): void;
}

const CARD_GAP = 8;

/**
 * Stacks cards down the rail: each takes its asked-for top unless the one
 * before it reaches lower, and a card with no measurable anchor simply
 * follows the previous card. Pure, so the collision policy is testable
 * without a layout engine.
 */
export function stackCards(
	cards: readonly { key: string; top: number | null; height: number }[],
	gap = CARD_GAP,
): Map<string, number> {
	const placed = new Map<string, number>();
	let floor = 0;
	for (const card of cards) {
		const top = Math.max(card.top ?? floor, floor);
		placed.set(card.key, top);
		floor = top + card.height + gap;
	}
	return placed;
}

interface CardState {
	el: HTMLElement;
	editing: boolean;
}

export function renderRevisionRail(
	segmentEl: HTMLElement,
	callbacks: RevisionRailCallbacks,
): RevisionRail {
	const rail = segmentEl.createDiv({ cls: 'snowflake-method-revision-rail' });
	const cards = new Map<string, CardState>();
	let draftEl: HTMLElement | null = null;

	const t = callbacks.t;

	/**
	 * Where a card's buttons stand. The answers to a proposal share the
	 * card's width between them, since each is as likely as the next; the
	 * form's pair sits at the right, where a dialog keeps what closes it.
	 */
	const actionRow = (card: HTMLElement, shape: 'balanced' | 'end'): HTMLElement =>
		card.createDiv({
			cls: `snowflake-method-revision-actions is-${shape}`,
		});

	const actionButton = (
		host: HTMLElement,
		label: string,
		onClick: () => void,
		primary = false,
	): void => {
		const button = host.createEl('button', {
			cls: primary
				? 'mod-cta snowflake-method-revision-action'
				: 'snowflake-method-revision-action',
			text: label,
			attr: { type: 'button', 'aria-label': label, title: label },
		});
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			onClick();
		});
	};

	/**
	 * One titled block: the field's name over its value, the shape the
	 * plugin's own forms use everywhere else. Every card is read as named
	 * parts this way -- what the text says now, what it would say, and why --
	 * rather than as three anonymous paragraphs that only their styling tells
	 * apart.
	 */
	const fieldBlock = (
		host: HTMLElement,
		part: 'type' | 'original' | 'proposed' | 'comment',
		label: string,
	): HTMLElement => {
		const field = host.createDiv({
			cls: `snowflake-method-revision-field is-${part}`,
		});
		field.createDiv({ cls: 'snowflake-method-revision-label', text: label });
		return field;
	};

	/** A field's value, shown whole: a card trims nothing it was given. */
	const valueBlock = (
		host: HTMLElement,
		part: 'original' | 'proposed' | 'comment',
		label: string,
		text: string,
	): void => {
		fieldBlock(host, part, label).createDiv({
			cls: 'snowflake-method-revision-value',
			text,
		});
	};

	/**
	 * What the revision would do, as the card's first field: the word alone
	 * in the colour of its kind, since a saved card is read rather than
	 * operated and a coloured slab at its head only competes with the two
	 * grounds that matter.
	 */
	const typeBlock = (
		host: HTMLElement,
		kind: Revision['kind'] | 'conflict',
		text: string,
	): HTMLElement => {
		const value = fieldBlock(host, 'type', t('manuscript.revision.type'))
			.createDiv({
				cls: 'snowflake-method-revision-value',
				attr: { 'data-kind': kind },
			});
		value.createSpan({ text });
		return value;
	};

	/**
	 * A text area tall enough for all of it: the words are shown whole, never
	 * as much of them as the rows happened to hold. The rows are the floor --
	 * three where the author is expected to write, one for the original,
	 * which is given rather than asked for and so is exactly as tall as it
	 * is. The drag handle still raises any of them, and a card built in a
	 * pane nobody is looking at measures nothing and is left at its rows
	 * until it is drawn somewhere real.
	 */
	const growToFit = (input: HTMLTextAreaElement): void => {
		if (input.value.length === 0) return;
		// Its height is still the rows', so scrollHeight is either those rows
		// or everything in it, whichever is taller; the borders the box sizes
		// inside are added back.
		if (input.offsetHeight === 0) return;
		const frame = input.offsetHeight - input.clientHeight;
		input.setCssStyles({ height: `${String(input.scrollHeight + frame)}px` });
	};

	const inputBlock = (
		host: HTMLElement,
		part: 'original' | 'proposed' | 'comment',
		label: string,
		options: {
			value: string;
			rows?: number;
			placeholder?: string;
			readOnly?: boolean;
		},
	): HTMLTextAreaElement => {
		const field = fieldBlock(host, part, label);
		const input = field.createEl('textarea', {
			cls: 'snowflake-method-revision-input',
			attr: {
				rows: String(options.rows ?? 3),
				'aria-label': label,
				...(options.placeholder === undefined
					? {}
					: { placeholder: options.placeholder }),
				// The words being revised are shown, not offered: they are
				// what the proposal is measured against, and a card that let
				// them be typed over would be promising an edit it cannot
				// make.
				...(options.readOnly === true ? { readonly: 'readonly' } : {}),
			},
		});
		if (options.readOnly === true) input.addClass('is-readonly');
		input.value = options.value;
		growToFit(input);
		return input;
	};

	/**
	 * The editable face: the three fields named and filled, cancel and save.
	 * No kind here -- while a revision is being written the author is looking
	 * at their own words and their replacement, and a word like "Replace"
	 * above them says nothing the two fields do not. The proposal is always
	 * offered, deletions included: emptying it is how a replacement becomes a
	 * deletion, and filling it again is the way back.
	 */
	const renderForm = (
		card: HTMLElement,
		options: {
			originalText: string;
			proposed: string;
			comment: string;
			onSave(proposed: string, comment: string): void;
			onCancel(): void;
		},
	): void => {
		const fields = card.createDiv({
			cls: 'snowflake-method-revision-fields',
		});
		if (options.originalText.length > 0) {
			inputBlock(fields, 'original', t('manuscript.revision.original'), {
				value: options.originalText,
				rows: 1,
				readOnly: true,
			});
		}
		const proposedInput = inputBlock(
			fields,
			'proposed',
			t('manuscript.revision.proposed'),
			{
				value: options.proposed,
				placeholder: t('manuscript.revision.proposedPlaceholder'),
			},
		);
		const commentInput = inputBlock(
			fields,
			'comment',
			t('manuscript.revision.commentOptional'),
			{
				value: options.comment,
				placeholder: t('manuscript.revision.commentPlaceholder'),
			},
		);
		const actions = actionRow(card, 'end');
		actionButton(actions, t('manuscript.revision.cancel'), () => {
			options.onCancel();
		});
		actionButton(
			actions,
			t('manuscript.revision.save'),
			() => {
				options.onSave(proposedInput.value, commentInput.value);
			},
			true,
		);
		// Never let focus scroll: at this moment the card may not have been
		// given its top yet, and scrolling a card at the rail's origin into
		// view is a jump to the segment's head. The card stands beside the
		// words that were clicked, which are already on the screen.
		proposedInput.focus({ preventScroll: true });
	};

	const renderRestCard = (
		card: HTMLElement,
		entry: RevisionCardEntry,
		readOnly: boolean,
		beginEdit: () => void,
	): void => {
		const revision = entry.revision;
		const fields = card.createDiv({
			cls: 'snowflake-method-revision-fields',
		});
		typeBlock(
			fields,
			revision.kind,
			t(`manuscript.revision.kind.${revision.kind}`),
		);
		if (revision.kind !== 'insert') {
			valueBlock(
				fields,
				'original',
				t('manuscript.revision.original'),
				revision.originalText,
			);
		}
		if (revision.kind !== 'delete') {
			valueBlock(
				fields,
				'proposed',
				t('manuscript.revision.proposed'),
				revision.proposed,
			);
		}
		if (revision.comment.length > 0) {
			valueBlock(
				fields,
				'comment',
				t('manuscript.revision.comment'),
				revision.comment,
			);
		}
		if (readOnly) return;
		// Left to right the row runs from the mildest to the one that
		// rewrites the manuscript, so the button under the pointer after a
		// glance is never the one that changes the text.
		const actions = actionRow(card, 'balanced');
		actionButton(actions, t('manuscript.revision.edit'), beginEdit);
		actionButton(actions, t('manuscript.revision.reject'), () => {
			callbacks.onReject(revision);
		});
		actionButton(
			actions,
			t('manuscript.revision.accept'),
			() => {
				callbacks.onAccept(revision);
			},
			true,
		);
	};

	const renderConflictCard = (
		card: HTMLElement,
		revision: Revision,
		readOnly: boolean,
	): void => {
		card.addClass('is-conflict');
		const fields = card.createDiv({
			cls: 'snowflake-method-revision-fields',
		});
		// Still typed by what it would have done, with the badge saying why
		// it can no longer do it.
		const type = typeBlock(
			fields,
			'conflict',
			t(`manuscript.revision.kind.${revision.kind}`),
		);
		type.createSpan({
			cls: 'snowflake-method-revision-badge',
			text: t('manuscript.revision.conflict'),
		});
		if (revision.originalText.length > 0) {
			valueBlock(
				fields,
				'original',
				t('manuscript.revision.original'),
				revision.originalText,
			);
		}
		if (revision.proposed.length > 0) {
			valueBlock(
				fields,
				'proposed',
				t('manuscript.revision.proposed'),
				revision.proposed,
			);
		}
		if (revision.comment.length > 0) {
			valueBlock(
				fields,
				'comment',
				t('manuscript.revision.comment'),
				revision.comment,
			);
		}
		if (readOnly) return;
		const actions = actionRow(card, 'end');
		actionButton(actions, t('manuscript.revision.discard'), () => {
			callbacks.onDiscard(revision);
		});
	};

	const sync = (model: RevisionRailModel): void => {
		const wanted = new Set<string>();
		const order: { key: string; top: number | null }[] = [];

		// Conflicts first, pinned to the head of the stack: they have no spot
		// in the text to stand beside any more.
		for (const revision of model.conflicts) {
			const key = `conflict:${revision.id}`;
			wanted.add(key);
			order.push({ key, top: null });
			const kept = cards.get(key);
			if (kept !== undefined) continue;
			const card = rail.createDiv({ cls: 'snowflake-method-revision-card' });
			renderConflictCard(card, revision, model.readOnly);
			cards.set(key, { el: card, editing: false });
		}

		for (const entry of model.entries) {
			const key = entry.revision.id;
			wanted.add(key);
			order.push({ key, top: entry.top });
			const kept = cards.get(key);
			// A card being edited keeps its element and its unsaved text; a
			// resting card is cheap to redraw in place.
			if (kept !== undefined && kept.editing) continue;
			const card =
				kept?.el ?? rail.createDiv({ cls: 'snowflake-method-revision-card' });
			card.empty();
			card.removeClass('is-conflict');
			const state: CardState = { el: card, editing: false };
			renderRestCard(card, entry, model.readOnly, () => {
				state.editing = true;
				card.empty();
				renderForm(card, {
					originalText: entry.revision.originalText,
					proposed: entry.revision.proposed,
					comment: entry.revision.comment,
					onSave: (proposed, comment) => {
						// A refused save leaves the card open on what was
						// typed: the author gets the notice and their words
						// both, instead of one at the price of the other.
						if (!callbacks.onEditSave(entry.revision, proposed, comment)) {
							return;
						}
						state.editing = false;
					},
					onCancel: () => {
						state.editing = false;
						card.empty();
						renderRestCard(card, entry, model.readOnly, () => undefined);
						sync(model);
					},
				});
				// Both faces are drawn in place, and they are not the same
				// height: without a fresh placement the cards below stay where
				// the shorter one left them, and the taller one covers them.
				sync(model);
			});
			cards.set(key, state);
		}

		if (model.draft !== null) {
			order.push({ key: 'draft', top: model.draft.top });
			if (draftEl === null) {
				draftEl = rail.createDiv({
					cls: 'snowflake-method-revision-card is-draft',
				});
				renderForm(draftEl, {
					originalText: model.draft.originalText,
					proposed: '',
					comment: '',
					onSave: (proposed, comment) => {
						callbacks.onDraftSave(proposed, comment);
					},
					onCancel: () => {
						callbacks.onDraftCancel();
					},
				});
			}
		} else if (draftEl !== null) {
			draftEl.remove();
			draftEl = null;
		}

		for (const [key, state] of cards) {
			if (wanted.has(key)) continue;
			state.el.remove();
			cards.delete(key);
		}

		rail.toggleClass(
			'is-empty',
			order.length === 0 && model.draft === null,
		);

		// A card whose anchor cannot be measured right now -- an editor
		// line not laid out yet -- keeps the top it already has instead of
		// being stacked somewhere new: it was standing in the right place a
		// moment ago, and a held place beats a guessed one. Resolved BEFORE
		// the sort, so a held card takes its place in the stacking order by
		// where it stands, not at the head as an anchorless stranger --
		// which was exactly how one freshly measured card ended up floored
		// beneath every held one.
		const resolved = order.map(({ key, top }) => {
			const el = key === 'draft' ? draftEl : (cards.get(key)?.el ?? null);
			const standing = el === null ? NaN : parseFloat(el.style.top);
			return {
				key,
				el,
				top: top ?? (Number.isNaN(standing) ? null : standing),
			};
		});

		// Stacking only ever pushes down, so the cards must enter it in the
		// order of their anchors: conflicts first (they alone still have no
		// top), then everything else by where it belongs -- the draft merged
		// among the standing cards, not appended after them.
		resolved.sort((left, right) => {
			const leftTop = left.top ?? Number.NEGATIVE_INFINITY;
			const rightTop = right.top ?? Number.NEGATIVE_INFINITY;
			return leftTop - rightTop;
		});

		// Two passes: the cards must be in the DOM to have heights.
		const measured = resolved.map(({ key, el, top }) => ({
			key,
			top,
			height: el?.offsetHeight ?? 0,
		}));
		const placed = stackCards(measured);
		for (const { key } of measured) {
			const el = key === 'draft' ? draftEl : (cards.get(key)?.el ?? null);
			const top = placed.get(key);
			if (el !== null && top !== undefined) {
				el.style.top = `${String(top)}px`;
			}
		}
	};

	return {
		sync,
		dispose: () => {
			rail.remove();
		},
	};
}
