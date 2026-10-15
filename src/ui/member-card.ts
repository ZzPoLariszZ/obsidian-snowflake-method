/**
 * The card every board deals from, whatever note it stands for: a scene's
 * on the corkboard and in the lanes, a character's or a worldbuilding
 * note's on the board's own views and on the freeform canvas. What a card is
 * made of, how it is dressed from the model without losing an edit in
 * flight, how its name, status, colour and body text are written back, and
 * the one queue every such write goes through, all live here, so a card
 * looks and answers the same whatever it shows and wherever it stands. What
 * one kind of note adds to the card -- a scene's point of view and its
 * links, an entity's picture and the word on its foot -- is the kind's,
 * handed in as a spec and built into the card's slots; and what the card
 * writes goes through the kind too, which knows the note's fields. How the
 * cards are laid out, windowed and dragged, and what their menu offers,
 * stays with the board that deals them.
 */

import { Keymap, Notice, setIcon, setTooltip, type App } from 'obsidian';

import { PROGRESS_STATUSES, galleryCover, galleryLinkTarget, isProgressStatus, type MacaronColor, type ProgressStatus } from '../domain';
import { hangPanel, type HungPanel } from './anchored-panel';
import { CorkboardDraftModal, type RecoveredCorkboardDraft } from './corkboard-draft-modal';
import { statusOptions, type CardSelectOption } from './corkboard-layout';
import { resolveGalleryPicture } from './gallery-links';
import type { Translate } from './modals';
import { paintCount } from './pane-parts';
import { PROSE_BOX_CLASS, ProseBox } from './prose-box';
import { renderStickySwatches } from './sticky-note-card';

export const CARD_SELECTOR = '.snowflake-method-corkboard-card';
/** What a press on begins a text selection or a choice, never a drag; the body is a prose box. */
const CONTROL_SELECTOR = `input, textarea, select, button, a, .${PROSE_BOX_CLASS}`;
/** Where a press begins something of its own: the words being written, and the lists. */
const PRESS_SELECTOR = `input, textarea, select, .${PROSE_BOX_CLASS}`;

/** What every note a card can stand for has: its identity, where it is, and whether it can be written. */
export interface CardMember {
	id: string;
	path: string;
	revision: string;
	readOnly: boolean;
	healthIssues: readonly { blocking: boolean }[];
}

/** A draft's revision advances only when the deck it belongs to successfully writes it. */
export interface EditRevision {
	revision: string;
}

/** The parts every card has that the focus can stand on, named so a repaint can give it back. */
export type MemberCardPart = 'card' | 'title' | 'status' | 'color' | 'more' | 'body';

export const MEMBER_CARD_PART_CLASSES: readonly [MemberCardPart, string][] = [
	['title', 'snowflake-method-corkboard-title'],
	['title', 'snowflake-method-corkboard-title-input'],
	['status', 'snowflake-method-corkboard-status-select'],
	['color', 'snowflake-method-corkboard-color'],
	['more', 'snowflake-method-corkboard-more'],
	['body', 'snowflake-method-corkboard-body-text'],
];

/**
 * A card's element and the parts a dressing rewrites rather than remakes,
 * so a control holding the focus is still there, and still focused, after
 * a read redresses the card around it.
 */
export interface MemberCard<Member extends CardMember> {
	/** The note's id, or the group key and the id where a note stands in several groups. */
	key: string;
	id: string;
	el: HTMLElement;
	member: Member;
	/** The note's place in its order. */
	index: number;
	number: HTMLElement;
	/** The symbol the head wears in place of the number, where the surface asked for one. */
	symbolIcon: string;
	title: HTMLButtonElement;
	titleText: string;
	titleInput: HTMLInputElement;
	editingTitle: boolean;
	titleOriginal: string;
	titleRevision: EditRevision;
	color: HTMLButtonElement;
	more: HTMLButtonElement;
	status: HTMLSelectElement;
	statusSignature: string;
	/** The body's words, in a block that edits plain text: the box's element, which the focus can stand on. */
	body: HTMLElement;
	/** The box the body is read from and written into; `body` is its element. */
	bodyBox: ProseBox;
	bodyDirty: boolean;
	bodyOriginal: string;
	bodyRevision: EditRevision;
	/** The pane the gallery style, and an entity card's fullest style, show a picture of the note's gallery in. */
	picture: HTMLElement;
	/** Where the picture stands inside the pane, remade when the picture moves; the pane's buttons stand beside it. */
	pictureFrame: HTMLElement;
	/** What the frame was last drawn from: the picture's path and stamp, or the symbol shown in its place. */
	pictureSignature: string;
	/** The link of the picture the pane was turned to with its arrows; null shows the main picture, else the first. */
	pictureLink: string | null;
	picturePrevious: HTMLButtonElement;
	pictureNext: HTMLButtonElement;
	pictureStar: HTMLButtonElement;
	pictureRemove: HTMLButtonElement;
}

/** What a card's picture pane draws from: the note's gallery, where its links resolve from, and the symbol shown without one. */
export interface CardPicture {
	gallery: readonly string[];
	galleryMain: string | null;
	path: string;
	icon: string;
}

/** The fields a card writes in place, in the card's own words; the kind maps them onto the note's. */
export interface MemberCardPatch {
	title?: string;
	body?: string;
	color?: MacaronColor | null;
	progressStatus?: ProgressStatus;
	/** The note's gallery as the pane leaves it, and which of its pictures is the main one. */
	gallery?: string[];
	galleryMain?: string | null;
}

/** Where a kind builds its own parts into the card: the elements the shared parts stand in. */
export interface CardSlots {
	el: HTMLElement;
	head: HTMLElement;
	body: HTMLElement;
	footer: HTMLElement;
	footerRow: HTMLElement;
	actions: HTMLElement;
}

/** What a kind's own wiring may ask of the deck. */
export interface CardKindTools<Member extends CardMember> {
	/** A form opened through the queue, read again only when it saved. */
	openForm: (open: (onSaved: () => void) => Promise<unknown>) => void;
	editable: (card: MemberCard<Member>) => boolean;
	notice: (error: unknown) => void;
}

/**
 * What one kind of note adds to the shared card: how its fields are read
 * and written, the words the card uses for them, and the parts only that
 * kind carries.
 */
export interface CardKind<Member extends CardMember, Extras extends object, Part extends string> {
	title: (member: Member) => string;
	body: (member: Member) => string;
	status: (member: Member) => ProgressStatus | null;
	color: (member: Member) => MacaronColor | null;
	/** The note's gallery, for the pane, and the symbol shown while it has no picture. */
	picture: (member: Member) => CardPicture;
	/** The class every card of the kind wears, for the styles that tell one kind's card from another's. */
	cardClass: string;
	/** Writes the fields under the revision the card holds; answers the note's new revision. */
	patch: (member: Member, fields: MemberCardPatch, expectedRevision: string, projectPath: string) => Promise<string>;
	/** The note as the fields written leave it, before the model has caught up. */
	applied: (member: Member, fields: MemberCardPatch, revision: string) => Member;
	/** Every note of the kind as the model holds it now; a note missing from it has gone. */
	membersById: () => ReadonlyMap<string, Member>;
	/** Whether another note of the kind already bears the name. */
	taken: (name: string, ownId: string) => boolean;
	/** What Enter on the card opens. */
	open: (member: Member) => Promise<void>;
	words: {
		bodyLabel: (member: Member) => string;
		/** Said in an empty body that can be typed into; a body only read shows none. */
		bodyPlaceholder: (member: Member) => string;
		nameRequired: (member: Member) => string;
		nameTaken: (member: Member) => string;
	};
	/** Builds the kind's own parts into the slots and answers them, for the card to carry. */
	build: (slots: CardSlots, member: Member) => Extras;
	dress: (card: MemberCard<Member> & Extras, member: Member) => void;
	wire: (card: MemberCard<Member> & Extras, tools: CardKindTools<Member>) => void;
	/** The kind's own parts the focus can stand on, by class. */
	partClasses: readonly [Part, string][];
	partOf: (card: MemberCard<Member> & Extras, part: Part) => Element | null;
	/** The head of a full paint, for what a kind resolves once per paint. */
	beginPaint?: () => void;
}

/** What a deck asks of the board that deals its cards. */
export interface MemberCardDeps<Member extends CardMember, Extras extends object, Card extends MemberCard<Member> & Extras> {
	app: App;
	t: Translate;
	/** Re-reads the project; resolves after the board has been redrawn with the new model. */
	refresh: () => Promise<void>;
	notice: (error: unknown) => void;
	/** The path new edits are written under; a queued write keeps the one captured when it was queued. */
	projectPath: () => string | null;
	/** True while the project cannot be written to. */
	readOnly: () => boolean;
	/** True while the plugin is unloading, when a dialog opened now would outlive its owner. */
	unloading?: () => boolean;
	/** Whether the board lets this card drag now; the deck still drops it while a control is pressed. */
	dragAllowed: (card: Card) => boolean;
	/** The board's own menu, from the ellipsis and from a right click off any control. */
	menu: (card: Card, event: MouseEvent) => void;
	/** Widens a freshly built card with the board's own fields, before it is registered and wired. */
	extend: (card: MemberCard<Member> & Extras) => Card;
	/**
	 * The symbol a card wears at its head in place of its number: for a
	 * surface where the cards stand in no order of their own, one for every
	 * card or one read off each note. Left out, a card wears its place in the
	 * order, as on the board.
	 */
	symbol?: string | ((member: Member) => string);
	/** The body is read on the card and never typed into there: for a surface that shows the note and leaves its writing to the form. */
	bodyReadOnly?: boolean;
	/** The title is read on the card and never typed into there: for a surface where a card changes only its tint and its standing. */
	titleReadOnly?: boolean;
}

/** A text a card has written that its deck has not yet saved, or has saved and the model has not yet shown. */
interface PendingText {
	value: string;
	base: EditRevision;
	original: string;
	key: string;
}

export interface WriteOptions {
	/** Runs even after the deck is disposed: a final draft joining accepted saves. */
	persist?: boolean;
	/** False hands the failure to the caller instead of a notice. */
	reportError?: boolean;
	/** Whether the read that follows the action is wanted; true when absent. */
	shouldRefresh?: () => boolean;
}

/**
 * What every card of one board shares: the registry of the cards standing,
 * the texts and statuses still being saved, the revisions each editor
 * holds, and the one queue every write goes through.
 */
export interface MemberCardDeck<Member extends CardMember, Card extends MemberCard<Member>, Part extends string> {
	readonly cards: ReadonlyMap<string, Card>;
	/**
	 * Every change the board makes, one after another, each followed by a
	 * read of the project before the next runs: what makes a quick edit
	 * carry a fresh revision whatever came before it.
	 */
	enqueue: (action: () => Promise<void>, options?: WriteOptions) => Promise<void>;
	/** A form opened through the queue, read again only when it saved. */
	openForm: (open: (onSaved: () => void) => Promise<unknown>) => void;
	/** Carries a revision the board's own rank write moved on, without adopting an external one. */
	adoptRevision: (change: { id: string; before: string; after: string }) => void;
	/** Lets go of the revision aliases only mounted editors and accepted saves still need. */
	prune: () => void;
	/** Forgets what the last full paint resolved, so a refresh resolves afresh. */
	beginPaint: () => void;
	/** Builds a card's element under the parent, registers it under its key and wires its controls. */
	mount: (parent: HTMLElement, key: string, member: Member, index: number) => Card;
	/** Dresses the card from the model while preserving unfinished and pending edits. */
	dress: (
		card: Card,
		member: Member,
		index: number,
		/** Where the card stands among those shown, one-based, and how many there are. */
		place: { position: number; size: number },
	) => void;
	/** Takes a card down and out of the registry; a deleted note's draft is kept. */
	unmount: (key: string) => void;
	/** Takes a card off the surface but keeps its editor: for a draft the filter left no place for. */
	park: (card: Card) => void;
	/** Settles a card's open words and takes it down: written where the note still stands, kept for the writer where it has gone. */
	retire: (key: string) => void;
	/** Moves a card, its editor and its pending texts under another key. */
	rekey: (card: Card, nextKey: string) => void;
	/** Takes every card down, keeping the drafts a refused write would lose. */
	clear: () => void;
	editable: (card: Card) => boolean;
	/** The keys the board must keep mounted wherever the window is: unfinished editors and pending texts. */
	editingKeys: () => string[];
	partOf: (card: Card, part: Part | MemberCardPart) => Element;
	beginTitleEdit: (card: Card) => void;
	commitTitle: (card: Card, refocus: boolean) => void;
	commitBody: (card: Card) => void;
	/** Lets the controls drag again once a press on one has ended. */
	releasePress: () => void;
	closeColorPanel: () => void;
	/** Drains every editor into the queue, which keeps running after the board is gone. */
	dispose: () => void;
}

/** Whether two gallery links name the same picture. */
const sameGalleryTarget = (left: string, right: string): boolean =>
	(galleryLinkTarget(left) ?? left.trim()) === (galleryLinkTarget(right) ?? right.trim());

/** The file name a gallery link ends in, for a picture that resolves to no file. */
const galleryLinkName = (link: string): string => {
	const target = galleryLinkTarget(link) ?? link.trim();
	return target.slice(target.lastIndexOf('/') + 1);
};

/** Whether an event began on one of a card's controls, which answer for themselves. */
export function controlWithin(target: EventTarget | null): boolean {
	if (target === null || !(target as Node).instanceOf(Element)) return false;
	return (target as Element).closest(CONTROL_SELECTOR) !== null;
}

/**
 * Whether a press on the target begins something of its own: a selection in
 * a field, a choice from a list. A press on a button or a link is a click
 * that has not happened yet, and a move before it lets the card drag; on a
 * card in the fullest style there is little else to take hold of.
 */
export function pressWithin(target: EventTarget | null): boolean {
	if (target === null || !(target as Node).instanceOf(Element)) return false;
	return (target as Element).closest(PRESS_SELECTOR) !== null;
}

/** A select's options remade from the list, the disabled ones disabled. */
export function fillSelect(
	select: HTMLSelectElement,
	options: readonly CardSelectOption[],
): void {
	select.empty();
	for (const option of options) {
		const el = select.createEl('option', {
			text: option.label,
			attr: { value: option.value },
		});
		if (option.disabled) el.disabled = true;
	}
}

export function createMemberCardDeck<
	Member extends CardMember,
	Extras extends object,
	Part extends string,
	Card extends MemberCard<Member> & Extras,
>(
	kind: CardKind<Member, Extras, Part>,
	deps: MemberCardDeps<Member, Extras, Card>,
): MemberCardDeck<Member, Card, Part> {
	const { app, t, notice } = deps;
	const cards = new Map<string, Card>();
	// Shared across group copies and remounts while a note's save is pending.
	const pendingStatuses = new Map<string, { value: ProgressStatus }>();
	const pendingTitles = new Map<string, PendingText>();
	const pendingBodies = new Map<string, PendingText>();
	const revisions = new Map<string, Map<string, Set<EditRevision>>>();
	/** Own writes the displayed model has not yet caught up with, including unmounted cards. */
	const revisionTransitions = new Map<string, Map<string, string>>();
	const queuedRevisions = new Set<{ base: EditRevision }>();
	let colorPanel: { card: Card; hung: HungPanel } | null = null;
	/** True while a press on a card's control is held, when a card must not drag. */
	let pressed = false;
	let queue: Promise<void> = Promise.resolve();
	let disposed = false;
	let recoveryDrafts: RecoveredCorkboardDraft[] = [];
	const recoveredTexts = new Set<string>();

	const symbolOf = (member: Member): string | undefined =>
		typeof deps.symbol === 'function' ? deps.symbol(member) : deps.symbol;

	const recoverText = (member: Member, fields: Pick<RecoveredCorkboardDraft, 'title' | 'body'>): void => {
		const draft: RecoveredCorkboardDraft = { name: kind.title(member), bodyLabel: kind.words.bodyLabel(member) };
		for (const field of ['title', 'body'] as const) {
			const value = fields[field];
			if (value === undefined) continue;
			const key = JSON.stringify([member.path, field, value]);
			if (recoveredTexts.has(key)) continue;
			recoveredTexts.add(key);
			draft[field] = value;
		}
		if (draft.title === undefined && draft.body === undefined) return;
		if (recoveryDrafts.length === 0) {
			// Wait until the current paint has restored focus before opening.
			void Promise.resolve().then(() => {
				const drafts = recoveryDrafts;
				recoveryDrafts = [];
				recoveredTexts.clear();
				// Checked at delivery, as the timeline's own recovery is: unload
				// can start between a refused write and this microtask. The words
				// stay recoverable without a dialog belonging to a plugin that
				// has gone.
				if (deps.unloading?.() === true) {
					for (const draft of drafts) {
						console.error('Snowflake: a card’s words could not be written', draft);
					}
					return;
				}
				new CorkboardDraftModal(app, t, drafts).open();
			});
		}
		recoveryDrafts.push(draft);
	};

	// -- The queue and the revisions -----------------------------------------

	const enqueue = (action: () => Promise<void>, options: WriteOptions = {}): Promise<void> => {
		const run = queue.then(async () => {
			if (disposed && options.persist !== true) return;
			try {
				await action();
			} catch (error) {
				if (options.reportError === false) throw error;
				notice(error);
			}
			if (!disposed && (options.shouldRefresh?.() ?? true)) await deps.refresh().then(() => revisionTransitions.clear()).catch((error: unknown) => {
				if (options.reportError === false) throw error;
				notice(error);
			});
		});
		// A modal receives its own rejection, without poisoning later writes.
		queue = run.catch(() => undefined);
		return run;
	};

	const openForm = (open: (onSaved: () => void) => Promise<unknown>): void => {
		let saved = false;
		void enqueue(async () => { await open(() => { saved = true; }); }, { shouldRefresh: () => saved });
	};

	/** Only mounted editors and accepted saves still need revision aliases. */
	const prune = (): void => {
		const held = new Set([...queuedRevisions].map((pending) => pending.base));
		for (const card of cards.values()) {
			held.add(card.titleRevision);
			held.add(card.bodyRevision);
		}
		for (const pending of [...pendingTitles.values(), ...pendingBodies.values()]) held.add(pending.base);
		for (const [id, byRevision] of revisions) {
			for (const [revision, bases] of byRevision) {
				for (const base of bases) if (!held.has(base)) bases.delete(base);
				if (bases.size === 0) byRevision.delete(revision);
			}
			if (byRevision.size === 0) revisions.delete(id);
		}
	};

	const editRevision = (member: Member): EditRevision => {
		const revision = revisionTransitions.get(member.id)?.get(member.revision) ?? member.revision;
		let byRevision = revisions.get(member.id);
		if (byRevision === undefined) {
			byRevision = new Map();
			revisions.set(member.id, byRevision);
		}
		const standing = byRevision.get(revision)?.values().next().value;
		if (standing !== undefined) return standing;
		const base = { revision };
		byRevision.set(revision, new Set([base]));
		return base;
	};

	const advanceRevision = (id: string, before: string, after: string): void => {
		if (before === after) return;
		// A card can remount from the old model before the write's refresh
		// finishes. Resolve its revision even if its former editor was pruned.
		const transitions = revisionTransitions.get(id) ?? new Map<string, string>();
		for (const [origin, revision] of transitions) {
			if (revision === before) transitions.set(origin, after);
		}
		transitions.set(before, after);
		revisionTransitions.set(id, transitions);
		const byRevision = revisions.get(id);
		const bases = byRevision?.get(before);
		if (byRevision === undefined || bases === undefined) return;
		byRevision.delete(before);
		const next = byRevision.get(after) ?? new Set<EditRevision>();
		for (const base of bases) {
			base.revision = after;
			next.add(base);
		}
		byRevision.set(after, next);
	};

	const adoptRevision = (change: { id: string; before: string; after: string }): void => {
		advanceRevision(change.id, change.before, change.after);
		for (const card of cards.values()) {
			if (card.id === change.id && card.member.revision === change.before) {
				card.member = { ...card.member, revision: change.after };
			}
		}
	};

	/** One or more fields of one note, under the revision the card holds now, which the write then moves on. */
	const patch = (
		card: Card,
		fields: MemberCardPatch,
		base = editRevision(card.member),
	): Promise<boolean> => {
		const owningProject = deps.projectPath();
		let saved = false;
		const queued = { base };
		queuedRevisions.add(queued);
		return enqueue(async () => {
			if (owningProject === null) return;
			const expectedRevision = base.revision;
			const revision = await kind.patch(card.member, fields, expectedRevision, owningProject);
			advanceRevision(card.id, expectedRevision, revision);
			for (const standing of new Set([card, ...cards.values()])) {
				if (standing.id === card.id && standing.member.revision === expectedRevision) {
					standing.member = kind.applied(standing.member, fields, revision);
				}
			}
			saved = true;
		}, { persist: true }).then(() => saved).finally(() => {
			queuedRevisions.delete(queued);
			prune();
		});
	};

	// -- A card --------------------------------------------------------------

	const editable = (card: MemberCard<Member>): boolean =>
		!deps.readOnly() && !card.member.readOnly && !card.member.healthIssues.some((issue) => issue.blocking);

	/** Builds a card's element once: the parts a dressing rewrites rather than remakes. */
	const build = (
		el: HTMLElement,
		key: string,
		member: Member,
		index: number,
	): MemberCard<Member> & Extras => {
		// A grip at the top centre, to take hold of the card by where nothing else answers a press.
		const grip = el.createSpan({ cls: 'snowflake-method-corkboard-grip', attr: { 'aria-hidden': 'true' } });
		setIcon(grip, 'grip-horizontal');
		const head = el.createDiv({ cls: 'snowflake-method-corkboard-head' });
		// Its place in the order, or the symbol the surface gives its cards.
		const symbol = symbolOf(member);
		const number = head.createSpan(
			symbol === undefined
				? { cls: 'snowflake-method-step-indicator snowflake-method-corkboard-number' }
				: { cls: 'snowflake-method-corkboard-symbol', attr: { 'aria-hidden': 'true' } },
		);
		if (symbol !== undefined) setIcon(number, symbol);
		const title = head.createEl('button', {
			cls: 'snowflake-method-corkboard-title',
			attr: { type: 'button' },
		});
		const titleInput = head.createEl('input', {
			cls: 'snowflake-method-corkboard-title-input is-hidden',
			attr: { type: 'text', 'aria-label': t('corkboard.editName') },
		});
		const status = head.createEl('select', {
			cls: 'dropdown snowflake-method-entity-status snowflake-method-corkboard-status-select',
			attr: { 'aria-label': t('table.progressStatus') },
		});
		// The picture stands between the head and the words, in a frame of its
		// own, with the pane's buttons beside it: the arrows that turn the
		// note's gallery round, the star and the bin.
		const picture = el.createDiv({ cls: 'snowflake-method-corkboard-picture is-empty' });
		const pictureFrame = picture.createDiv({ cls: 'snowflake-method-corkboard-picture-frame' });
		const pictureButton = (part: string, icon: string): HTMLButtonElement => {
			const button = picture.createEl('button', {
				cls: `clickable-icon snowflake-method-corkboard-picture-${part} is-hidden`,
				attr: { type: 'button' },
			});
			setIcon(button, icon);
			return button;
		};
		const picturePrevious = pictureButton('previous', 'chevron-left');
		const pictureNext = pictureButton('next', 'chevron-right');
		const pictureStar = pictureButton('star', 'star');
		pictureStar.setAttribute('aria-pressed', 'false');
		const pictureRemove = pictureButton('remove', 'trash-2');
		const body = el.createDiv({ cls: 'snowflake-method-corkboard-body' });
		// The words are a prose box, as the dashboard's steps are, so the
		// typography's alignment and indent reach them. A body only read invites
		// no writing: it shows no placeholder, and is not reached by the Tab key.
		const bodyBox = new ProseBox(body, {
			cls: 'snowflake-method-corkboard-body-text',
			label: kind.words.bodyLabel(member),
			placeholder: deps.bodyReadOnly === true ? '' : kind.words.bodyPlaceholder(member),
			readOnly: deps.bodyReadOnly === true,
		});
		const footer = el.createDiv({ cls: 'snowflake-method-corkboard-footer' });
		const footerRow = footer.createDiv({ cls: 'snowflake-method-corkboard-footer-row' });
		const actions = footerRow.createDiv({ cls: 'snowflake-method-corkboard-actions' });
		const color = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-color',
			attr: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
		});
		setIcon(color, 'palette');
		const more = actions.createEl('button', {
			cls: 'clickable-icon snowflake-method-corkboard-more',
			attr: {
				type: 'button',
				'aria-label': t('table.actions'),
				'aria-haspopup': 'menu',
			},
		});
		setIcon(more, 'ellipsis');
		setTooltip(more, t('table.actions'));
		el.addClass(kind.cardClass);
		const extras = kind.build({ el, head, body, footer, footerRow, actions }, member);
		const core: MemberCard<Member> = {
			key,
			id: member.id,
			el,
			member,
			index,
			number,
			symbolIcon: symbol ?? '',
			title,
			titleText: '',
			titleInput,
			editingTitle: false,
			titleOriginal: kind.title(member),
			titleRevision: editRevision(member),
			color,
			more,
			status,
			statusSignature: '',
			body: bodyBox.el,
			bodyBox,
			bodyDirty: false,
			bodyOriginal: kind.body(member),
			bodyRevision: editRevision(member),
			picture,
			pictureFrame,
			pictureSignature: '',
			pictureLink: null,
			picturePrevious,
			pictureNext,
			pictureStar,
			pictureRemove,
		};
		return Object.assign(core, extras);
	};

	const recoverBlockedDraft = (card: Card): void => {
		const fields: Pick<RecoveredCorkboardDraft, 'title' | 'body'> = {};
		if (card.editingTitle && card.titleInput.value !== card.titleOriginal) fields.title = card.titleInput.value;
		if (card.bodyDirty && card.bodyBox.value !== card.bodyOriginal) fields.body = card.bodyBox.value;
		card.bodyDirty = false;
		if (card.editingTitle) endTitleEdit(card, false);
		paintBody(card);
		recoverText(card.member, fields);
	};

	/** Text and color always represent the same selection, even during a save. */
	const paintStatus = (card: Card, value: ProgressStatus | null): void => {
		card.status.value = value ?? '';
		for (const status of PROGRESS_STATUSES) {
			card.status.toggleClass(`is-${status}`, value === status);
		}
	};

	/**
	 * A title that is read and never typed into is said to be so, never
	 * disabled: a disabled button swallows the press that drags the card's
	 * node on the canvas, and loses its tooltip. Said so, it leaves the tab
	 * order, and a press on it takes no focus, as with a disabled one.
	 */
	const stillTitle = (card: Card, still: boolean): void => {
		if (still) {
			card.title.setAttribute('aria-disabled', 'true');
			card.title.setAttribute('tabindex', '-1');
		} else {
			card.title.removeAttribute('aria-disabled');
			card.title.removeAttribute('tabindex');
		}
	};

	const paintTitle = (card: Card): void => {
		if (card.editingTitle) return;
		const title = pendingTitles.get(card.id)?.value ?? kind.title(card.member);
		if (card.titleText === title) return;
		card.titleText = title;
		card.title.setText(title);
		setTooltip(card.title, title);
	};

	const paintBody = (card: Card): void => {
		if (card.bodyDirty) return;
		const pending = pendingBodies.get(card.id);
		const value = pending?.value ?? kind.body(card.member);
		if (card.bodyBox.value !== value) card.bodyBox.value = value;
		card.bodyOriginal = value;
		card.bodyRevision = pending?.base ?? editRevision(card.member);
	};

	/** Dresses the card from the model while preserving unfinished and pending edits. */
	const dress = (
		card: Card,
		member: Member,
		index: number,
		place: { position: number; size: number },
	): void => {
		card.member = member;
		card.index = index;
		const { el } = card;
		const writable = editable(card);
		if (!writable) recoverBlockedDraft(card);
		if (!writable && colorPanel?.card === card) closeColorPanel();
		el.setAttribute('data-id', member.id);
		el.setAttribute('aria-setsize', String(place.size));
		el.setAttribute('aria-posinset', String(place.position));
		const tint = kind.color(member);
		if (tint === null) el.removeAttribute('data-color');
		else el.setAttribute('data-color', tint);
		el.toggleClass('is-read-only', !writable);
		el.toggleClass('has-managed-section-issue', member.healthIssues.some((issue) => issue.blocking));
		el.setAttribute('draggable', deps.dragAllowed(card) && !pressed ? 'true' : 'false');
		const symbol = symbolOf(member);
		if (symbol === undefined) {
			paintCount(card.number, index + 1);
			card.number.setAttribute(
				'aria-label',
				t('corkboard.position', { number: index + 1 }),
			);
		} else if (symbol !== card.symbolIcon) {
			card.symbolIcon = symbol;
			setIcon(card.number, symbol);
		}
		paintTitle(card);
		stillTitle(card, !writable || deps.titleReadOnly === true);
		const colorLabel =
			tint === null
				? t('modal.scene.colorNone')
				: t(`stickyNotes.color.${tint}`);
		card.color.setAttribute('aria-label', t('corkboard.colorLabel', { color: colorLabel }));
		setTooltip(card.color, colorLabel);
		card.color.disabled = !writable;
		const shownStatus = pendingStatuses.get(member.id)?.value ?? kind.status(member);
		const statuses = statusOptions(shownStatus, t);
		const statusSignature = statuses.map((option) => option.value).join('\n');
		if (statusSignature !== card.statusSignature) {
			card.statusSignature = statusSignature;
			fillSelect(card.status, statuses);
		}
		paintStatus(card, shownStatus);
		card.status.disabled = !writable;
		paintBody(card);
		card.bodyBox.readOnly = !writable || deps.bodyReadOnly === true;
		const bodyLabel = kind.words.bodyLabel(member);
		if (card.body.getAttribute('aria-label') !== bodyLabel) card.body.setAttribute('aria-label', bodyLabel);
		paintPicture(card, member, writable);
		kind.dress(card, member);
	};

	/** The link of the picture the pane shows: the one its arrows turned to while the note still holds it, else the main picture, else the first. */
	const pictureShown = (card: Card, gallery: readonly string[], galleryMain: string | null): string | null => {
		if (card.pictureLink !== null && gallery.includes(card.pictureLink)) return card.pictureLink;
		card.pictureLink = null;
		return galleryCover(gallery, galleryMain);
	};

	/** A button's label and tooltip, set only when the words move. */
	const say = (button: HTMLButtonElement, label: string): void => {
		if (button.getAttribute('aria-label') === label) return;
		button.setAttribute('aria-label', label);
		setTooltip(button, label);
	};

	/**
	 * The pane shows one picture of the note's gallery: the one its arrows
	 * were turned to while the note still holds it, else the main picture,
	 * else the first. A note with none shows the kind's symbol, and a link
	 * that resolves to no file says so. The frame is redrawn only when that
	 * moves. The arrows show for more than one picture, the star and the bin
	 * for a picture on a note that can be written.
	 */
	const paintPicture = (card: Card, member: Member, writable: boolean): void => {
		const { gallery, galleryMain, path, icon } = kind.picture(member);
		const link = pictureShown(card, gallery, galleryMain);
		const file = link === null ? null : resolveGalleryPicture(deps.app.metadataCache, link, path);
		const name = kind.title(member);
		const signature =
			link === null ? `icon:${icon}` : file === null ? `missing:${link}` : `${file.path}|${String(file.stat.mtime)}`;
		if (signature !== card.pictureSignature) {
			card.pictureSignature = signature;
			card.pictureFrame.empty();
			if (file === null) {
				const symbol = card.pictureFrame.createSpan({
					cls: 'snowflake-method-corkboard-picture-symbol',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(symbol, link === null ? icon : 'image-off');
			} else {
				card.pictureFrame.createEl('img', {
					attr: { src: deps.app.vault.getResourcePath(file), alt: name, loading: 'lazy' },
				});
			}
		} else if (file !== null) {
			// A rename moves the words under the picture, not the picture.
			const shown = card.pictureFrame.querySelector('img');
			if (shown !== null && shown.getAttribute('alt') !== name) shown.setAttribute('alt', name);
		}
		card.picture.toggleClass('is-empty', gallery.length === 0);
		card.picture.toggleClass('has-many', gallery.length > 1);
		card.picturePrevious.toggleClass('is-hidden', gallery.length < 2);
		card.pictureNext.toggleClass('is-hidden', gallery.length < 2);
		const main = link !== null && galleryMain !== null && sameGalleryTarget(link, galleryMain);
		card.pictureStar.toggleClass('is-hidden', link === null || !writable);
		card.pictureStar.toggleClass('is-main', main);
		card.pictureStar.setAttribute('aria-pressed', main ? 'true' : 'false');
		card.pictureRemove.toggleClass('is-hidden', link === null || !writable);
		say(card.picturePrevious, t('corkboard.picture.previous'));
		say(card.pictureNext, t('corkboard.picture.next'));
		say(card.pictureStar, t(main ? 'form.gallery.unsetMain' : 'form.gallery.setMain'));
		say(card.pictureRemove, t('form.gallery.removePicture', { name: file?.name ?? (link === null ? '' : galleryLinkName(link)) }));
	};

	/** Turns the pane to the next or the previous picture of the note's gallery, round past either end. */
	const turnPicture = (card: Card, by: number): void => {
		const { gallery, galleryMain } = kind.picture(card.member);
		const count = gallery.length;
		if (count < 2) return;
		const shown = pictureShown(card, gallery, galleryMain);
		const from = shown === null ? 0 : gallery.indexOf(shown);
		card.pictureLink = gallery[(((from + by) % count) + count) % count] ?? null;
		paintPicture(card, card.member, editable(card));
	};

	/** The star makes the picture shown the note's main one, or lets it go again; the pane shows the answer at once, as the status does. */
	const starPicture = (card: Card): void => {
		if (!editable(card)) return;
		const { gallery, galleryMain } = kind.picture(card.member);
		const link = pictureShown(card, gallery, galleryMain);
		if (link === null) return;
		const main = galleryMain !== null && sameGalleryTarget(link, galleryMain);
		const fields: MemberCardPatch = { galleryMain: main ? null : link };
		void patch(card, fields);
		paintPicture(card, kind.applied(card.member, fields, card.member.revision), true);
	};

	/** The bin takes the picture shown off the note, the main with it where it was the main, and turns the pane to the next. */
	const removePicture = (card: Card): void => {
		if (!editable(card)) return;
		const { gallery, galleryMain } = kind.picture(card.member);
		const link = pictureShown(card, gallery, galleryMain);
		if (link === null) return;
		const kept = gallery.filter((entry) => entry !== link);
		const fields: MemberCardPatch = {
			gallery: kept,
			...(galleryMain !== null && sameGalleryTarget(link, galleryMain) ? { galleryMain: null } : {}),
		};
		card.pictureLink = kept[Math.min(gallery.indexOf(link), kept.length - 1)] ?? null;
		void patch(card, fields);
		paintPicture(card, kind.applied(card.member, fields, card.member.revision), true);
	};

	// -- Editing in place ----------------------------------------------------

	const beginTitleEdit = (card: Card): void => {
		if (deps.titleReadOnly === true || !editable(card) || card.editingTitle) return;
		const pending = pendingTitles.get(card.id);
		card.editingTitle = true;
		card.titleOriginal = pending?.value ?? kind.title(card.member);
		card.titleRevision = pending?.base ?? editRevision(card.member);
		card.title.addClass('is-hidden');
		card.titleInput.removeClass('is-hidden');
		card.titleInput.value = card.titleOriginal;
		card.titleInput.focus();
		card.titleInput.select();
	};

	const endTitleEdit = (card: Card, refocus: boolean): void => {
		card.editingTitle = false;
		card.titleInput.addClass('is-hidden');
		card.title.removeClass('is-hidden');
		paintTitle(card);
		if (refocus) card.title.focus({ preventScroll: true });
	};

	const saveText = (
		card: Card,
		field: 'title' | 'body',
		pending: PendingText,
	): void => {
		const values = field === 'title' ? pendingTitles : pendingBodies;
		const paint = field === 'title' ? paintTitle : paintBody;
		values.set(card.id, pending);
		for (const standing of cards.values()) {
			if (standing.id === card.id) paint(standing);
		}
		void patch(card, { [field]: pending.value }, pending.base).then((saved) => {
			if (values.get(card.id) !== pending) return;
			values.delete(card.id);
			if (disposed) {
				if (!saved) recoverText(card.member, { [field]: pending.value });
				return;
			}
			if (!saved) {
				// A rejected revision leaves the local draft available to fix
				// or cancel with Escape; the refreshed model remains its own.
				// A card taken down since is nobody's to reach, whether or not
				// the note stands: its draft goes to the recovery dialog.
				// A card parked is off the page though still in the registry: the
				// board's window or its filter left it no place. Words put back
				// into it would be held out of sight until the board went away,
				// so it counts as out of reach along with one taken down.
				const draft = cards.get(card.key) ??
					[...cards.values()].find((standing) => standing.id === card.id) ?? null;
				if (
					draft === null ||
					!draft.el.isConnected ||
					!editable(draft) ||
					!kind.membersById().has(card.id)
				) {
					recoverText(card.member, { [field]: pending.value });
				} else if (field === 'body' && !draft.bodyDirty) {
					draft.bodyBox.value = pending.value;
					draft.bodyOriginal = pending.original;
					draft.bodyRevision = pending.base;
					draft.bodyDirty = true;
				} else if (field === 'title' && !draft.editingTitle) {
					draft.editingTitle = true;
					draft.titleOriginal = pending.original;
					draft.titleRevision = pending.base;
					draft.titleInput.value = pending.value;
					draft.title.addClass('is-hidden');
					draft.titleInput.removeClass('is-hidden');
				}
			}
			for (const standing of cards.values()) {
				if (standing.id === card.id) paint(standing);
			}
		});
	};

	/** The typed name, refused as the form refuses one: empty, or another note's. */
	const commitTitle = (card: Card, refocus: boolean): void => {
		if (!card.editingTitle) return;
		if (!editable(card)) {
			recoverBlockedDraft(card);
			return;
		}
		const typed = card.titleInput.value.trim();
		if (typed === card.titleOriginal) {
			endTitleEdit(card, refocus);
			return;
		}
		if (typed.length === 0) {
			new Notice(kind.words.nameRequired(card.member));
			return;
		}
		const current = kind.title(card.member);
		if (typed !== current && kind.taken(typed, card.id)) {
			new Notice(kind.words.nameTaken(card.member));
			return;
		}
		endTitleEdit(card, refocus);
		if (typed === current && !pendingTitles.has(card.id)) return;
		saveText(card, 'title', {
			value: typed, base: card.titleRevision, original: card.titleOriginal, key: card.key,
		});
	};

	const commitBody = (card: Card): void => {
		if (!editable(card)) {
			recoverBlockedDraft(card);
			return;
		}
		if (!card.bodyDirty) {
			paintBody(card);
			return;
		}
		const value = card.bodyBox.value;
		card.bodyDirty = false;
		if (value === kind.body(card.member) && !pendingBodies.has(card.id)) {
			paintBody(card);
			return;
		}
		saveText(card, 'body', {
			value, base: card.bodyRevision, original: card.bodyOriginal, key: card.key,
		});
	};

	const closeColorPanel = (): void => {
		const open = colorPanel;
		if (open === null) return;
		colorPanel = null;
		open.hung.release();
		open.hung.el.remove();
	};

	const toggleColorPanel = (card: Card): void => {
		if (colorPanel?.card === card) {
			closeColorPanel();
			return;
		}
		closeColorPanel();
		if (!editable(card)) return;
		const hung = hangPanel(card.color, {
			cls: 'snowflake-method-corkboard-color-panel',
			label: t('stickyNotes.color'),
			build: (panel) => {
				renderStickySwatches(panel, {
					value: kind.color(card.member) ?? '',
					t,
					onPick: (value) => {
						closeColorPanel();
						if (editable(card)) void patch(card, { color: value });
					},
					none: {
						label: t('modal.scene.colorNone'),
						onPick: () => {
							closeColorPanel();
							if (editable(card)) void patch(card, { color: null });
						},
					},
				});
			},
			onClose: () => {
				closeColorPanel();
			},
		});
		colorPanel = { card, hung };
	};

	// -- Wiring --------------------------------------------------------------

	const wire = (card: Card): void => {
		const { el } = card;
		card.title.addEventListener('click', () => {
			beginTitleEdit(card);
		});
		// A still title takes no focus from a press, as a disabled one would not; the press goes on to whatever moves the card.
		card.title.addEventListener('mousedown', (event) => {
			if (card.title.getAttribute('aria-disabled') === 'true') event.preventDefault();
		});
		card.titleInput.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			if (event.key === 'Enter') {
				event.preventDefault();
				commitTitle(card, true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				endTitleEdit(card, true);
			}
		});
		card.titleInput.addEventListener('blur', () => {
			commitTitle(card, false);
		});
		card.status.addEventListener('change', () => {
			const value = card.status.value;
			if (!isProgressStatus(value) || !editable(card)) return;
			const previous = pendingStatuses.get(card.id)?.value ?? kind.status(card.member);
			if (value === previous) return;
			const pending = { value };
			pendingStatuses.set(card.id, pending);
			for (const standing of cards.values()) {
				if (standing.id === card.id) paintStatus(standing, value);
			}
			void patch(card, { progressStatus: value }).then(() => {
				// Keep the selection through the refresh as well as the write.
				if (pendingStatuses.get(card.id) === pending) pendingStatuses.delete(card.id);
				if (!disposed) {
					for (const standing of cards.values()) {
						if (standing.id === card.id) {
							paintStatus(standing, pendingStatuses.get(standing.id)?.value ?? kind.status(standing.member));
						}
					}
				}
			});
		});
		card.body.addEventListener('input', () => {
			card.bodyDirty = card.bodyBox.value !== card.bodyOriginal;
		});
		card.body.addEventListener('blur', () => {
			commitBody(card);
		});
		card.body.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
				event.preventDefault();
				commitBody(card);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				card.bodyDirty = false;
				paintBody(card);
				el.focus({ preventScroll: true });
			}
		});
		card.color.addEventListener('click', (event) => {
			event.stopPropagation();
			toggleColorPanel(card);
		});
		card.more.addEventListener('click', (event) => {
			event.stopPropagation();
			deps.menu(card, event);
		});
		// The pane's arrows turn the note's gallery round; its star and its bin write the note, as the status and the tint do.
		card.picturePrevious.addEventListener('click', (event) => {
			event.stopPropagation();
			turnPicture(card, -1);
		});
		card.pictureNext.addEventListener('click', (event) => {
			event.stopPropagation();
			turnPicture(card, 1);
		});
		card.pictureStar.addEventListener('click', (event) => {
			event.stopPropagation();
			starPicture(card);
		});
		card.pictureRemove.addEventListener('click', (event) => {
			event.stopPropagation();
			removePicture(card);
		});
		el.addEventListener('contextmenu', (event) => {
			if (controlWithin(event.target) && event.target !== card.more) return;
			event.preventDefault();
			deps.menu(card, event);
		});
		// Only the card's own key: a control inside it answers its own.
		el.addEventListener('keydown', (event) => {
			if (event.target !== el) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			void kind.open(card.member).catch(notice);
		});
		// A press in a field or on a list is a selection or a choice beginning,
		// and a card that drags under it would swallow both. A press on a
		// button is a click still to come: a move before it drags the card.
		el.addEventListener('mousedown', (event) => {
			if (!pressWithin(event.target)) return;
			pressed = true;
			el.setAttribute('draggable', 'false');
		});
		kind.wire(card, { openForm, editable, notice });
	};

	const releasePress = (): void => {
		if (!pressed) return;
		pressed = false;
		for (const card of cards.values()) {
			card.el.setAttribute('draggable', deps.dragAllowed(card) ? 'true' : 'false');
		}
	};

	// -- The registry --------------------------------------------------------

	const mount = (parent: HTMLElement, key: string, member: Member, index: number): Card => {
		const el = parent.createDiv({
			cls: 'snowflake-method-corkboard-card snowflake-method-sticky-tint',
			attr: { role: 'listitem', tabindex: '0', 'data-key': key, 'data-id': member.id },
		});
		const card = deps.extend(build(el, key, member, index));
		cards.set(key, card);
		wire(card);
		return card;
	};

	const unmount = (key: string): void => {
		const card = cards.get(key);
		if (card === undefined) return;
		if (colorPanel?.card === card) closeColorPanel();
		// A deleted note cannot accept the editor that was pinned to it.
		if (!kind.membersById().has(card.id)) recoverBlockedDraft(card);
		card.el.remove();
		cards.delete(key);
	};

	const park = (card: Card): void => {
		const latest = kind.membersById().get(card.id);
		if (latest !== undefined) card.member = latest;
		if (!editable(card)) recoverBlockedDraft(card);
		if (colorPanel?.card === card) closeColorPanel();
		card.el.remove();
	};

	/**
	 * A card's open words settled before it goes: written where the note is
	 * still there to take them, and kept for the writer where it is not. A
	 * write against a note that has gone can only fail, and would say so with
	 * an error before handing the words back anyway.
	 */
	const settle = (card: Card): void => {
		if (!kind.membersById().has(card.id)) {
			recoverBlockedDraft(card);
			return;
		}
		commitTitle(card, false);
		commitBody(card);
		if (card.editingTitle) recoverBlockedDraft(card);
	};

	/** Settles a card's words and takes it down: what a surface asks when a placement goes. */
	const retire = (key: string): void => {
		const card = cards.get(key);
		if (card === undefined) return;
		settle(card);
		unmount(key);
	};

	const rekey = (card: Card, nextKey: string): void => {
		const key = card.key;
		cards.delete(key);
		card.key = nextKey;
		card.el.setAttribute('data-key', nextKey);
		cards.set(nextKey, card);
		for (const pending of [pendingTitles.get(card.id), pendingBodies.get(card.id)]) {
			if (pending?.key === key) pending.key = nextKey;
		}
	};

	const clear = (): void => {
		for (const card of cards.values()) {
			recoverBlockedDraft(card);
			card.el.remove();
		}
		closeColorPanel();
		cards.clear();
	};

	const editingKeys = (): string[] => {
		const keys: string[] = [];
		for (const card of cards.values()) {
			if (card.editingTitle || card.bodyDirty) keys.push(card.key);
		}
		for (const pending of [...pendingTitles.values(), ...pendingBodies.values()]) {
			keys.push(pending.key);
		}
		return keys;
	};

	const partOf = (card: Card, part: Part | MemberCardPart): Element => {
		switch (part) {
			case 'title':
				return card.editingTitle ? card.titleInput : card.title;
			case 'status':
				return card.status;
			case 'color':
				return card.color;
			case 'more':
				return card.more;
			case 'body':
				return card.body;
			case 'card':
				return card.el;
			default:
				return kind.partOf(card, part) ?? card.el;
		}
	};

	return {
		cards,
		enqueue,
		openForm,
		adoptRevision,
		prune,
		beginPaint: () => {
			kind.beginPaint?.();
		},
		mount,
		dress,
		unmount,
		park,
		retire,
		rekey,
		clear,
		editable,
		editingKeys,
		partOf,
		beginTitleEdit,
		commitTitle,
		commitBody,
		releasePress,
		closeColorPanel,
		dispose: () => {
			disposed = true;
			closeColorPanel();
			// Final drafts join accepted saves in the same order. They retain
			// the board's project and revisions after its view has gone away.
			for (const card of cards.values()) settle(card);
		},
	};
}
