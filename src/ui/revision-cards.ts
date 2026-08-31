import { setIcon } from 'obsidian';

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
	onEditSave(revision: Revision, proposed: string, comment: string): void;
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

	const excerpt = (text: string, limit = 160): string =>
		text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

	const iconButton = (
		host: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void => {
		const button = host.createEl('button', {
			cls: 'snowflake-method-revision-action',
			attr: { type: 'button', 'aria-label': label, title: label },
		});
		setIcon(button, icon);
		button.createSpan({ text: label });
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			onClick();
		});
	};

	/** The editable face: proposed text and comment, save and cancel. */
	const renderForm = (
		card: HTMLElement,
		options: {
			kind: Revision['kind'];
			proposed: string;
			comment: string;
			onSave(proposed: string, comment: string): void;
			onCancel(): void;
		},
	): void => {
		let proposedInput: HTMLTextAreaElement | null = null;
		if (options.kind !== 'delete') {
			proposedInput = card.createEl('textarea', {
				cls: 'snowflake-method-revision-input',
				attr: {
					rows: '3',
					placeholder: t('manuscript.revision.proposedPlaceholder'),
					'aria-label': t('manuscript.revision.proposed'),
				},
			});
			proposedInput.value = options.proposed;
		}
		const commentInput = card.createEl('textarea', {
			cls: 'snowflake-method-revision-input',
			attr: {
				rows: '2',
				placeholder: t('manuscript.revision.commentPlaceholder'),
				'aria-label': t('manuscript.revision.comment'),
			},
		});
		commentInput.value = options.comment;
		const actions = card.createDiv({
			cls: 'snowflake-method-revision-actions',
		});
		iconButton(actions, 'check', t('manuscript.revision.save'), () => {
			options.onSave(proposedInput?.value ?? '', commentInput.value);
		});
		iconButton(actions, 'x', t('manuscript.revision.cancel'), () => {
			options.onCancel();
		});
		// Never let focus scroll: at this moment the card may not have been
		// given its top yet, and scrolling a card at the rail's origin into
		// view is a jump to the segment's head. The card stands beside the
		// words that were clicked, which are already on the screen.
		(proposedInput ?? commentInput).focus({ preventScroll: true });
	};

	const renderRestCard = (
		card: HTMLElement,
		entry: RevisionCardEntry,
		readOnly: boolean,
		beginEdit: () => void,
	): void => {
		const revision = entry.revision;
		card.createDiv({
			cls: 'snowflake-method-revision-kind',
			text: t(`manuscript.revision.kind.${revision.kind}`),
		});
		if (revision.kind !== 'insert') {
			card.createDiv({
				cls: 'snowflake-method-revision-original',
				text: excerpt(revision.originalText),
			});
		}
		if (revision.kind !== 'delete') {
			card.createDiv({
				cls: 'snowflake-method-revision-proposed',
				text: excerpt(revision.proposed),
			});
		}
		if (revision.comment.length > 0) {
			card.createDiv({
				cls: 'snowflake-method-revision-comment',
				text: revision.comment,
			});
		}
		if (readOnly) return;
		const actions = card.createDiv({
			cls: 'snowflake-method-revision-actions',
		});
		iconButton(actions, 'check', t('manuscript.revision.accept'), () => {
			callbacks.onAccept(revision);
		});
		iconButton(actions, 'x', t('manuscript.revision.reject'), () => {
			callbacks.onReject(revision);
		});
		iconButton(actions, 'pencil', t('manuscript.revision.edit'), beginEdit);
	};

	const renderConflictCard = (
		card: HTMLElement,
		revision: Revision,
		readOnly: boolean,
	): void => {
		card.addClass('is-conflict');
		card.createDiv({
			cls: 'snowflake-method-revision-kind',
			text: t('manuscript.revision.conflict'),
		});
		if (revision.originalText.length > 0) {
			card.createDiv({
				cls: 'snowflake-method-revision-original',
				text: excerpt(revision.originalText),
			});
		}
		if (revision.proposed.length > 0) {
			card.createDiv({
				cls: 'snowflake-method-revision-proposed',
				text: excerpt(revision.proposed),
			});
		}
		if (revision.comment.length > 0) {
			card.createDiv({
				cls: 'snowflake-method-revision-comment',
				text: revision.comment,
			});
		}
		if (readOnly) return;
		const actions = card.createDiv({
			cls: 'snowflake-method-revision-actions',
		});
		iconButton(actions, 'trash-2', t('manuscript.revision.discard'), () => {
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
					kind: entry.revision.kind,
					proposed: entry.revision.proposed,
					comment: entry.revision.comment,
					onSave: (proposed, comment) => {
						state.editing = false;
						callbacks.onEditSave(entry.revision, proposed, comment);
					},
					onCancel: () => {
						state.editing = false;
						card.empty();
						renderRestCard(card, entry, model.readOnly, () => undefined);
						sync(model);
					},
				});
			});
			cards.set(key, state);
		}

		if (model.draft !== null) {
			order.push({ key: 'draft', top: model.draft.top });
			if (draftEl === null) {
				draftEl = rail.createDiv({
					cls: 'snowflake-method-revision-card is-draft',
				});
				draftEl.createDiv({
					cls: 'snowflake-method-revision-kind',
					text: t(`manuscript.revision.kind.${model.draft.kind}`),
				});
				if (model.draft.originalText.length > 0) {
					draftEl.createDiv({
						cls: 'snowflake-method-revision-original',
						text: excerpt(model.draft.originalText),
					});
				}
				renderForm(draftEl, {
					kind: model.draft.kind,
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
