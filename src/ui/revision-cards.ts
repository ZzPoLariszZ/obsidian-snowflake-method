import { setIcon } from 'obsidian';

import { revisionKindFor, type Revision } from '../domain';
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
	/**
	 * The text either side of the spot when the draft was begun. A range
	 * proves its place by the words under it; a point has no words of its
	 * own, so these are the only witnesses it has that the note has not moved
	 * beneath it while the card stood open.
	 */
	before: string;
	after: string;
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
	/**
	 * Takes the revision out: a rejection from a resting card and a discard
	 * from a conflict card are one call, since taking a revision out is the
	 * same work whichever word the button wore.
	 */
	onRetire(revision: Revision): void;
	/**
	 * Takes an edited revision, and answers once the write has either landed
	 * or failed. False means it was refused -- the card stays open on what was
	 * typed instead of closing over a save that never happened.
	 */
	onEditSave(
		revision: Revision,
		proposed: string,
		comment: string,
	): Promise<boolean>;
	/**
	 * Takes the drafted revision, and answers once the write has either
	 * landed or failed. False keeps the form open on what was typed, as the
	 * edit face does: the words a refusal cannot save are still the author's.
	 */
	onDraftSave(proposed: string, comment: string): Promise<boolean>;
	onDraftCancel(): void;
	/**
	 * Whether a card stands one step back (-1) or on (+1) from this one,
	 * anywhere in the manuscript. False greys the arrow rather than leaving it
	 * to answer a click with nothing.
	 */
	hasNeighbour(revision: Revision, step: -1 | 1): boolean;
	/** Takes the reader to the card one step back or on. */
	onJump(revision: Revision, step: -1 | 1): void;
}

export interface RevisionRail {
	sync(model: RevisionRailModel): void;
	/** The card standing for this revision, conflicts included. */
	cardFor(id: string): HTMLElement | null;
	/**
	 * Whether a card is open for editing. The form holds the only copy of
	 * what is being typed into it, so whoever would take the rail down asks
	 * this first.
	 */
	editing(): boolean;
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
	/** What the card was last drawn from, so an unchanged one is left alone. */
	print: string;
}

/**
 * What makes one draft a different proposal from another: the spot, and the
 * words under it. The same offsets over other words are another proposal --
 * the note was rewritten there while the card stood open -- and a form kept
 * on the offsets alone would go on showing the earlier words as the original
 * while the record saved from it names the later ones.
 */
export const draftKeyOf = (draft: RevisionDraft): string =>
	`${draft.kind}:${String(draft.from)}:${String(draft.to)}:${draft.originalText}`;

/**
 * Everything a resting card is drawn from. A card whose print has not
 * changed since it was last drawn is left exactly as it stands: the rail is
 * asked to sync on every scroll and every settled keystroke, and a card
 * rebuilt under the pointer swaps the button out between the press and the
 * release, so the click lands on nothing.
 */
export const cardPrint = (
	revision: Revision,
	readOnly: boolean,
	neighbours: [boolean, boolean],
): string =>
	JSON.stringify([
		revision.id,
		revision.kind,
		revision.originalText,
		revision.proposed,
		revision.comment,
		readOnly,
		neighbours,
	]);

export function renderRevisionRail(
	segmentEl: HTMLElement,
	callbacks: RevisionRailCallbacks,
): RevisionRail {
	const rail = segmentEl.createDiv({ cls: 'snowflake-method-revision-rail' });
	const cards = new Map<string, CardState>();
	let draftEl: HTMLElement | null = null;
	/** Which draft the standing form was built for, so a new one rebuilds it. */
	let draftKey: string | null = null;
	/** The last thing the rail was asked to show, for placing it again. */
	let held: RevisionRailModel | null = null;

	const t = callbacks.t;

	/**
	 * Draws and places the cards again on the newest thing the rail was told,
	 * which is what a form opening or closing goes through: a card that
	 * changed height under the author's hands has to push the ones below it
	 * down, and only the stacking pass knows where they go. Deliberately not
	 * the model the form was opened over -- cards have come and gone since,
	 * and reviving that older picture would take them with it.
	 */
	const restack = (): void => {
		if (held !== null) sync(held);
	};

	/** Brings the held model level with an edit that has just landed. */
	const saved = (id: string, proposed: string, comment: string): void => {
		if (held === null) return;
		held = {
			...held,
			entries: held.entries.map((entry) =>
				entry.revision.id === id
					? {
							...entry,
							revision: {
								...entry.revision,
								kind: revisionKindFor(entry.revision.kind, proposed),
								proposed,
								comment,
							},
						}
					: entry,
			),
		};
	};

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
	 * The pair in the card's upper corner: one step back through the
	 * manuscript's revisions, one step on. A proposal is answered here, and
	 * the next proposal is usually pages away -- these carry the reader there
	 * instead of leaving them to hunt the margin for the next marked passage.
	 * Arrows rather than words: the pair is a compass, not two more things to
	 * read, and words in the corner would crowd the field names beside them.
	 */
	const navGroup = (host: HTMLElement, revision: Revision): void => {
		const nav = host.createDiv({ cls: 'snowflake-method-revision-nav' });
		const arrow = (step: -1 | 1, icon: string, label: string): void => {
			const button = nav.createEl('button', {
				cls: 'clickable-icon snowflake-method-revision-nav-step',
				attr: {
					type: 'button',
					'aria-label': label,
					title: label,
					// The first and the last card say so plainly.
					...(callbacks.hasNeighbour(revision, step)
						? {}
						: { disabled: 'disabled' }),
				},
			});
			setIcon(button, icon);
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				callbacks.onJump(revision, step);
			});
		};
		arrow(-1, 'chevron-up', t('manuscript.revision.previous'));
		arrow(1, 'chevron-down', t('manuscript.revision.next'));
	};

	/**
	 * A saved card's top line: what the revision would do at the left, the two
	 * arrows at the right. Handed back so a conflict can pin its badge after
	 * the kind.
	 */
	const cardHead = (
		card: HTMLElement,
		revision: Revision,
		kind: Revision['kind'] | 'conflict',
	): HTMLElement => {
		const head = card.createDiv({ cls: 'snowflake-method-revision-head' });
		const type = typeBlock(
			head,
			kind,
			t(`manuscript.revision.kind.${revision.kind}`),
		);
		navGroup(head, revision);
		return type;
	};

	/**
	 * A text area tall enough for all of it: the words are shown whole, never
	 * as much of them as the three rows happened to hold, and never behind a
	 * scrollbar. The rows are only the floor, the drag handle still raises
	 * one, and a card built in a pane nobody is looking at measures nothing
	 * and is left at its rows until it is drawn somewhere real.
	 *
	 * `keepTaller` is for the growing that happens under the author's hands:
	 * a box may rise to hold what is being typed, but never fall back, or a
	 * box the author dragged taller would collapse at the next keystroke.
	 */
	const growToFit = (input: HTMLTextAreaElement, keepTaller = false): void => {
		if (input.value.length === 0) return;
		// Its height is still the rows', so scrollHeight is either those rows
		// or everything in it, whichever is taller; the borders the box sizes
		// inside are added back.
		if (input.offsetHeight === 0) return;
		const frame = input.offsetHeight - input.clientHeight;
		const wanted = input.scrollHeight + frame;
		if (keepTaller && wanted <= input.offsetHeight) return;
		input.setCssStyles({ height: `${String(wanted)}px` });
	};

	const inputBlock = (
		host: HTMLElement,
		part: 'proposed' | 'comment',
		label: string,
		options: { value: string; placeholder: string },
	): HTMLTextAreaElement => {
		const field = fieldBlock(host, part, label);
		const input = field.createEl('textarea', {
			cls: 'snowflake-method-revision-input',
			attr: {
				rows: '3',
				'aria-label': label,
				placeholder: options.placeholder,
			},
		});
		input.value = options.value;
		growToFit(input);
		// Typing past the bottom of the box raises it instead of pushing the
		// words out of sight, and the rail is told, since a card that grew
		// while nothing restacked would grow over the one below it.
		input.addEventListener('input', () => {
			const before = input.offsetHeight;
			growToFit(input, true);
			if (input.offsetHeight !== before) restack();
		});
		return input;
	};

	/**
	 * The editable face: the three fields named and filled, cancel and save.
	 * No kind here -- while a revision is being written the author is looking
	 * at their own words and their replacement, and a word like "Replace"
	 * above them says nothing the two fields do not. The proposal is always
	 * offered, deletions included: emptying it is how a replacement becomes a
	 * deletion, and filling it again is the way back.
	 *
	 * The original is drawn here exactly as the resting card draws it, in the
	 * same block on the same ground. It is not offered for typing, so a text
	 * area gave it nothing but a narrower column that broke its lines
	 * somewhere else, a scrollbar of its own, and a drag handle for a box
	 * with nothing to reveal.
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
			valueBlock(
				fields,
				'original',
				t('manuscript.revision.original'),
				options.originalText,
			);
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
		cardHead(card, revision, revision.kind);
		const fields = card.createDiv({
			cls: 'snowflake-method-revision-fields',
		});
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
			callbacks.onRetire(revision);
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
		// Still typed by what it would have done, with the badge saying why
		// it can no longer do it.
		const type = cardHead(card, revision, 'conflict');
		const fields = card.createDiv({
			cls: 'snowflake-method-revision-fields',
		});
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
			callbacks.onRetire(revision);
		});
	};

	const sync = (model: RevisionRailModel): void => {
		held = model;
		const wanted = new Set<string>();
		const order: { key: string; top: number | null }[] = [];

		// Conflicts first, pinned to the head of the stack: they have no spot
		// in the text to stand beside any more.
		for (const revision of model.conflicts) {
			// A card open for editing goes on standing for its revision even
			// once the note stops answering for it: the form holds what is
			// being typed, and a conflict card raised beside it would be a
			// second card for one revision. The conflict shows once the form
			// closes, on the sync that follows.
			const open = cards.get(revision.id);
			if (open?.editing === true) {
				wanted.add(revision.id);
				order.push({ key: revision.id, top: null });
				continue;
			}
			const key = `conflict:${revision.id}`;
			wanted.add(key);
			order.push({ key, top: null });
			// Redrawn in place like a resting card, and for the same reason:
			// what it says can change under it -- a note turning read-only
			// takes its Discard away, and text edited from the table arrives
			// here -- and a card drawn once would go on offering what it was
			// born offering. Only when something did change, though.
			const print = cardPrint(revision, model.readOnly, [false, false]);
			const kept = cards.get(key);
			if (kept !== undefined && kept.print === print) continue;
			const card =
				kept?.el ?? rail.createDiv({ cls: 'snowflake-method-revision-card' });
			card.empty();
			renderConflictCard(card, revision, model.readOnly);
			cards.set(key, { el: card, editing: false, print });
		}

		for (const entry of model.entries) {
			const key = entry.revision.id;
			wanted.add(key);
			order.push({ key, top: entry.top });
			const kept = cards.get(key);
			// A card being edited keeps its element and its unsaved text, and
			// a resting card that would be drawn the same is left as it is.
			if (kept !== undefined && kept.editing) continue;
			const print = cardPrint(entry.revision, model.readOnly, [
				callbacks.hasNeighbour(entry.revision, -1),
				callbacks.hasNeighbour(entry.revision, 1),
			]);
			if (kept !== undefined && kept.print === print) continue;
			const card =
				kept?.el ?? rail.createDiv({ cls: 'snowflake-method-revision-card' });
			card.empty();
			card.removeClass('is-conflict');
			const state: CardState = { el: card, editing: false, print };
			renderRestCard(card, entry, model.readOnly, () => {
				state.editing = true;
				// The card no longer shows its print, so the sync that follows
				// the form closing draws it afresh rather than leaving the
				// form standing as an unchanged card.
				state.print = '';
				card.empty();
				renderForm(card, {
					originalText: entry.revision.originalText,
					proposed: entry.revision.proposed,
					comment: entry.revision.comment,
					onSave: (proposed, comment) => {
						// A refused save leaves the card open on what was
						// typed: the author gets the notice and their words
						// both, instead of one at the price of the other. The
						// answer is waited for, because a save that fails
						// fails after the write was tried, and closing the
						// form before then would close it over nothing.
						void (async () => {
							const took = await callbacks.onEditSave(
								entry.revision,
								proposed,
								comment,
							);
							if (!took) return;
							state.editing = false;
							// The card is drawn again from what the rail last
							// held, and that is the revision from before the
							// save: the fresh feed arrives a read later. So the
							// held copy is told what was just written, or the
							// card would show the words the author replaced
							// until the note is dressed again.
							saved(entry.revision.id, proposed, comment);
							restack();
						})();
					},
					onCancel: () => {
						state.editing = false;
						restack();
					},
				});
				// Both faces are drawn in place, and they are not the same
				// height: without a fresh placement the cards below stay where
				// the shorter one left them, and the taller one covers them.
				restack();
			});
			cards.set(key, state);
		}

		if (model.draft !== null) {
			order.push({ key: 'draft', top: model.draft.top });
			// A second revision begun while the first is still being written
			// is a different proposal -- about another passage, or about the
			// same offsets over words the note no longer holds there -- and
			// the form is built again for it, rather than the standing card
			// keeping the earlier text on show while the save goes to the new
			// one.
			const key = draftKeyOf(model.draft);
			if (draftEl !== null && key !== draftKey) {
				draftEl.remove();
				draftEl = null;
			}
			draftKey = key;
			if (draftEl === null) {
				draftEl = rail.createDiv({
					cls: 'snowflake-method-revision-card is-draft',
				});
				renderForm(draftEl, {
					originalText: model.draft.originalText,
					proposed: '',
					comment: '',
					onSave: (proposed, comment) => {
						// Waited for, and the card left standing until it
						// lands: a form closed over a refused write takes the
						// proposal with it and leaves nothing to try again.
						void callbacks.onDraftSave(proposed, comment);
					},
					onCancel: () => {
						callbacks.onDraftCancel();
					},
				});
			}
		} else if (draftEl !== null) {
			draftEl.remove();
			draftEl = null;
			draftKey = null;
		}

		for (const [key, state] of cards) {
			if (wanted.has(key)) continue;
			// A card being written in outlives the revision it was drawn for.
			// The author is mid-sentence in it, and the element holds the only
			// copy of that sentence; it keeps its place in the stack and goes
			// on the first sync after the form closes.
			if (state.editing) {
				order.push({ key, top: null });
				continue;
			}
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
		cardFor: (id) =>
			cards.get(id)?.el ?? cards.get(`conflict:${id}`)?.el ?? null,
		editing: () => [...cards.values()].some((state) => state.editing),
		dispose: () => {
			rail.remove();
		},
	};
}
