import { revisionKindFor, type OccurrenceRole, type Revision } from '../domain';
import {
	foreshadowingCardPrint,
	renderForeshadowingCard,
	renderForeshadowingForm,
	renderUnresolvedOccurrenceCard,
	type ForeshadowingCardEntry,
	type ForeshadowingRailCallbacks,
} from './foreshadowing-cards';
import type { Translate } from './modals';
import { railParts } from './rail-parts';

/**
 * The margin rail: one absolutely positioned column per segment, standing
 * to the right of the manuscript, holding a card per revision the segment
 * carries and a card per foreshadowing occurrence standing in it. The stream
 * computes where each card's text sits and hands the tops in; the rail draws
 * the cards and settles collisions by pushing down, the way a margin of
 * comments does, both families in one stack. Cards being edited keep their
 * elements and their unsaved text across a sync, because a dress refresh
 * mid-thought must not eat a sentence.
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
	/** The foreshadowing family sharing this rail. */
	foreshadowing: {
		entries: ForeshadowingCardEntry[];
		/** Occurrences the note no longer answers for; pinned, top always null. */
		unresolved: ForeshadowingCardEntry[];
	};
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
	/** What the foreshadowing cards answer with. */
	foreshadowing: ForeshadowingRailCallbacks;
}

export interface RevisionRail {
	sync(model: RevisionRailModel): void;
	/** The card standing for this revision, conflicts included. */
	cardFor(id: string): HTMLElement | null;
	/** The card standing for this occurrence, unresolved ones included. */
	cardForOccurrence(occurrenceId: string): HTMLElement | null;
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

/** The rail's own key for a foreshadowing card, and for its unresolved face. */
const occurrenceKey = (occurrenceId: string): string => `fs:${occurrenceId}`;
const unresolvedKey = (occurrenceId: string): string =>
	`fs-conflict:${occurrenceId}`;

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

	const parts = railParts(restack);

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

	/** The same, for an occurrence's role and note just written. */
	const savedOccurrence = (
		occurrenceId: string,
		patch: { role: OccurrenceRole; note: string },
	): void => {
		if (held === null) return;
		held = {
			...held,
			foreshadowing: {
				...held.foreshadowing,
				entries: held.foreshadowing.entries.map((entry) =>
					entry.occurrence.id === occurrenceId
						? {
								...entry,
								occurrence: {
									...entry.occurrence,
									role: patch.role,
									note: patch.note,
								},
							}
						: entry,
				),
			},
		};
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
		const value = parts
			.fieldBlock(host, 'type', t('manuscript.revision.type'))
			.createDiv({
				cls: 'snowflake-method-rail-value',
				attr: { 'data-kind': kind },
			});
		value.createSpan({ text });
		return value;
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
		const head = parts.headBlock(card);
		const type = typeBlock(
			head,
			kind,
			t(`manuscript.revision.kind.${revision.kind}`),
		);
		parts.navGroup(
			head,
			{
				previous: t('manuscript.revision.previous'),
				next: t('manuscript.revision.next'),
			},
			(step) => callbacks.hasNeighbour(revision, step),
			(step) => {
				callbacks.onJump(revision, step);
			},
		);
		return type;
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
		const fields = parts.fieldsBlock(card);
		if (options.originalText.length > 0) {
			parts.valueBlock(
				fields,
				'original',
				t('manuscript.revision.original'),
				options.originalText,
			);
		}
		const proposedInput = parts.inputBlock(
			fields,
			'proposed',
			t('manuscript.revision.proposed'),
			{
				value: options.proposed,
				placeholder: t('manuscript.revision.proposedPlaceholder'),
			},
		);
		const commentInput = parts.inputBlock(
			fields,
			'comment',
			t('manuscript.revision.commentOptional'),
			{
				value: options.comment,
				placeholder: t('manuscript.revision.commentPlaceholder'),
			},
		);
		const actions = parts.actionRow(card, 'end');
		parts.actionButton(actions, t('common.cancel'), () => {
			options.onCancel();
		});
		parts.actionButton(
			actions,
			t('common.save'),
			() => {
				options.onSave(proposedInput.value, commentInput.value);
			},
			'primary',
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
		const fields = parts.fieldsBlock(card);
		if (revision.kind !== 'insert') {
			parts.valueBlock(
				fields,
				'original',
				t('manuscript.revision.original'),
				revision.originalText,
			);
		}
		if (revision.kind !== 'delete') {
			parts.valueBlock(
				fields,
				'proposed',
				t('manuscript.revision.proposed'),
				revision.proposed,
			);
		}
		if (revision.comment.length > 0) {
			parts.valueBlock(
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
		const actions = parts.actionRow(card, 'balanced');
		parts.actionButton(actions, t('actions.edit'), beginEdit);
		parts.actionButton(actions, t('manuscript.revision.reject'), () => {
			callbacks.onRetire(revision);
		});
		parts.actionButton(
			actions,
			t('manuscript.revision.accept'),
			() => {
				callbacks.onAccept(revision);
			},
			'primary',
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
		const fields = parts.fieldsBlock(card);
		type.createSpan({
			cls: 'snowflake-method-rail-badge',
			text: t('manuscript.revision.conflict'),
		});
		if (revision.originalText.length > 0) {
			parts.valueBlock(
				fields,
				'original',
				t('manuscript.revision.original'),
				revision.originalText,
			);
		}
		if (revision.proposed.length > 0) {
			parts.valueBlock(
				fields,
				'proposed',
				t('manuscript.revision.proposed'),
				revision.proposed,
			);
		}
		if (revision.comment.length > 0) {
			parts.valueBlock(
				fields,
				'comment',
				t('manuscript.revision.comment'),
				revision.comment,
			);
		}
		if (readOnly) return;
		const actions = parts.actionRow(card, 'end');
		parts.actionButton(actions, t('manuscript.revision.discard'), () => {
			callbacks.onRetire(revision);
		});
	};

	const foreshadowingOptions = (
		readOnly: boolean,
	): {
		t: Translate;
		parts: typeof parts;
		readOnly: boolean;
		callbacks: ForeshadowingRailCallbacks;
	} => ({ t, parts, readOnly, callbacks: callbacks.foreshadowing });

	/**
	 * A form opened in a standing card, and closed again: the card holds its
	 * unsaved text through every sync while the form stands, a refused save
	 * leaves it open on what was typed, and a landed one is told to the held
	 * model before the card is drawn afresh -- the fresh feed arrives a read
	 * later, and the card would otherwise show the words the author replaced
	 * until the note is dressed again.
	 */
	const editable = (
		state: CardState,
		card: HTMLElement,
		openForm: (finish: {
			save: (commit: () => Promise<boolean>, landed: () => void) => void;
			cancel: () => void;
		}) => void,
	): void => {
		state.editing = true;
		// The card no longer shows its print, so the sync that follows the
		// form closing draws it afresh rather than leaving the form standing
		// as an unchanged card.
		state.print = '';
		card.empty();
		openForm({
			save: (commit, landed) => {
				// The answer is waited for, because a save that fails fails
				// after the write was tried, and closing the form before then
				// would close it over nothing.
				void (async () => {
					const took = await commit();
					if (!took) return;
					state.editing = false;
					landed();
					restack();
				})();
			},
			cancel: () => {
				state.editing = false;
				restack();
			},
		});
		// Both faces are drawn in place, and they are not the same height:
		// without a fresh placement the cards below stay where the shorter
		// one left them, and the taller one covers them.
		restack();
	};

	const sync = (model: RevisionRailModel): void => {
		held = model;
		const wanted = new Set<string>();
		// A pinned card has no anchor to stand beside and keeps the head of
		// the stack, whatever top it was last placed at.
		const order: { key: string; top: number | null; pinned?: boolean }[] = [];

		/**
		 * One card brought level: wanted, given its place in the order, and
		 * redrawn only when its print moved -- what it says can change under
		 * it, a note turning read-only takes a Discard away, text edited from
		 * the table arrives here, a neighbour comes or goes -- or left whole
		 * while a form is open in it, since the element then holds the only
		 * copy of what is being typed.
		 */
		const place = (spec: {
			key: string;
			top: number | null;
			pinned?: boolean;
			cls: string;
			print: string;
			draw: (card: HTMLElement, state: CardState) => void;
		}): void => {
			wanted.add(spec.key);
			order.push({ key: spec.key, top: spec.top, pinned: spec.pinned });
			const kept = cards.get(spec.key);
			if (kept !== undefined && (kept.editing || kept.print === spec.print)) return;
			const card =
				kept?.el ?? rail.createDiv({ cls: `snowflake-method-rail-card ${spec.cls}` });
			card.empty();
			card.removeClass('is-conflict');
			const state: CardState = { el: card, editing: false, print: spec.print };
			spec.draw(card, state);
			cards.set(spec.key, state);
		};

		/**
		 * A card with a form open in it stands on for its record even once
		 * the note stops answering for it, pinned: the form holds what is
		 * being typed, and a conflict card raised beside it would be a second
		 * card for one record. The conflict shows once the form closes, on
		 * the sync that follows. True when the card is standing so.
		 */
		const holdOpen = (key: string): boolean => {
			if (cards.get(key)?.editing !== true) return false;
			wanted.add(key);
			order.push({ key, top: null, pinned: true });
			return true;
		};

		const neighbours = (entry: ForeshadowingCardEntry): [boolean, boolean] => [
			callbacks.foreshadowing.hasNeighbour(entry.item, entry.occurrence, -1),
			callbacks.foreshadowing.hasNeighbour(entry.item, entry.occurrence, 1),
		];

		// Conflicts first, pinned to the head of the stack: they have no spot
		// in the text to stand beside any more. The arrows are drawn live, so
		// every print carries them, or a neighbour coming or going would
		// leave a card's compass stale.
		for (const revision of model.conflicts) {
			if (holdOpen(revision.id)) continue;
			place({
				key: `conflict:${revision.id}`,
				top: null,
				pinned: true,
				cls: 'snowflake-method-revision-card',
				print: cardPrint(revision, model.readOnly, [
					callbacks.hasNeighbour(revision, -1),
					callbacks.hasNeighbour(revision, 1),
				]),
				draw: (card) => {
					renderConflictCard(card, revision, model.readOnly);
				},
			});
		}

		// The unresolved occurrences, pinned beside the conflicts by the same
		// rule, and kept past their record while a form is open in them.
		for (const entry of model.foreshadowing.unresolved) {
			if (holdOpen(occurrenceKey(entry.occurrence.id))) continue;
			place({
				key: unresolvedKey(entry.occurrence.id),
				top: null,
				pinned: true,
				cls: 'snowflake-method-foreshadowing-card',
				print: foreshadowingCardPrint(
					entry.item,
					entry.occurrence,
					model.readOnly,
					neighbours(entry),
					true,
				),
				draw: (card) => {
					renderUnresolvedOccurrenceCard(
						card,
						entry,
						foreshadowingOptions(model.readOnly),
					);
				},
			});
		}

		for (const entry of model.entries) {
			place({
				key: entry.revision.id,
				top: entry.top,
				cls: 'snowflake-method-revision-card',
				print: cardPrint(entry.revision, model.readOnly, [
					callbacks.hasNeighbour(entry.revision, -1),
					callbacks.hasNeighbour(entry.revision, 1),
				]),
				draw: (card, state) => {
					renderRestCard(card, entry, model.readOnly, () => {
						editable(state, card, (finish) => {
							renderForm(card, {
								originalText: entry.revision.originalText,
								proposed: entry.revision.proposed,
								comment: entry.revision.comment,
								onSave: (proposed, comment) => {
									finish.save(
										() => callbacks.onEditSave(entry.revision, proposed, comment),
										() => {
											saved(entry.revision.id, proposed, comment);
										},
									);
								},
								onCancel: finish.cancel,
							});
						});
					});
				},
			});
		}

		// The foreshadowing cards, by the same rules as the revisions above.
		for (const entry of model.foreshadowing.entries) {
			place({
				key: occurrenceKey(entry.occurrence.id),
				top: entry.top,
				cls: 'snowflake-method-foreshadowing-card',
				print: foreshadowingCardPrint(
					entry.item,
					entry.occurrence,
					model.readOnly,
					neighbours(entry),
					false,
				),
				draw: (card, state) => {
					renderForeshadowingCard(card, entry, {
						...foreshadowingOptions(model.readOnly),
						beginEdit: () => {
							editable(state, card, (finish) => {
								renderForeshadowingForm(card, entry, {
									t,
									parts,
									onSave: (patch) => {
										finish.save(
											() =>
												callbacks.foreshadowing.onEditSave(
													entry.item,
													entry.occurrence,
													patch,
												),
											() => {
												savedOccurrence(entry.occurrence.id, patch);
											},
										);
									},
									onCancel: finish.cancel,
								});
							});
						},
					});
				},
			});
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
					cls: 'snowflake-method-rail-card snowflake-method-revision-card is-draft',
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
		const resolved = order.map(({ key, top, pinned }) => {
			const el = key === 'draft' ? draftEl : (cards.get(key)?.el ?? null);
			const standing = el === null ? NaN : parseFloat(el.style.top);
			return {
				key,
				el,
				top:
					pinned === true
						? null
						: (top ?? (Number.isNaN(standing) ? null : standing)),
			};
		});

		// Stacking only ever pushes down, so the cards must enter it in the
		// order of their anchors: the pinned cards first (conflicts and
		// unresolved occurrences, which have no top and never take the one
		// they were last placed at), then everything else by where it
		// belongs -- the draft merged among the standing cards, not appended
		// after them.
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
		cardForOccurrence: (id) =>
			cards.get(occurrenceKey(id))?.el ??
			cards.get(unresolvedKey(id))?.el ??
			null,
		editing: () => [...cards.values()].some((state) => state.editing),
		dispose: () => {
			rail.remove();
		},
	};
}
