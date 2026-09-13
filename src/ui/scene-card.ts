/**
 * The scene card as one thing every board deals from: the corkboard, and any
 * surface that lays the same cards out another way. What a card is made of,
 * how it is dressed from the model without losing an edit in flight, how its
 * name, status, colour and conflict are written back, and the one queue every
 * such write goes through all live here, so a card looks and answers the
 * same wherever it stands. How the cards are laid out, windowed and dragged,
 * and what their menu offers, stays with the board that deals them.
 */

import { Keymap, Menu, Notice, setIcon, setTooltip, type App } from 'obsidian';

import { PROGRESS_STATUSES, isProgressStatus, type ProgressStatus } from '../domain';
import type { ScenePatch } from '../services';
import { hangPanel, type HungPanel } from './anchored-panel';
import { CorkboardDraftModal, type RecoveredCorkboardDraft } from './corkboard-draft-modal';
import { statusOptions, titleTaken, type CardSelectOption } from './corkboard-layout';
import { linkedManuscriptPreview, orderManuscriptReferences } from './linked-manuscript';
import type { Translate } from './modals';
import { paintCount, renderEmptyLine } from './pane-parts';
import { renderStickySwatches } from './sticky-note-card';
import type { DashboardHost, ProjectDashboardModel, SceneViewModel } from './view-model';

export const SCENE_CARD_SELECTOR = '.snowflake-method-corkboard-card';
/** What a press on begins a text selection or a choice, never a drag. */
const CONTROL_SELECTOR = 'input, textarea, select, button, a';
/** Where a press begins something of its own: the words being written, and the lists. */
const PRESS_SELECTOR = 'input, textarea, select';

/** The host's own methods a card calls, and no others. */
export type SceneCardHost = Pick<
	DashboardHost,
	'openManagedFile' | 'openManuscriptStream' | 'openSceneForm' | 'openCharacterForm' | 'patchScene'
>;

/** A draft's revision advances only when the deck it belongs to successfully writes it. */
export interface EditRevision {
	revision: string;
}

/** The parts of a card the focus can stand on, named so a repaint can give it back. */
export type SceneCardPart =
	| 'card'
	| 'title'
	| 'pov'
	| 'status'
	| 'color'
	| 'more'
	| 'conflict'
	| 'more-links'
	| 'link';

export const SCENE_CARD_PART_CLASSES: readonly [SceneCardPart, string][] = [
	['title', 'snowflake-method-corkboard-title'],
	['title', 'snowflake-method-corkboard-title-input'],
	['pov', 'snowflake-method-corkboard-pov'],
	['status', 'snowflake-method-corkboard-status-select'],
	['color', 'snowflake-method-corkboard-color'],
	['more', 'snowflake-method-corkboard-more'],
	['conflict', 'snowflake-method-corkboard-conflict'],
	['more-links', 'snowflake-method-corkboard-more-links'],
	['link', 'snowflake-method-corkboard-link'],
];

/**
 * A card's element and the parts a dressing rewrites rather than remakes,
 * so a control holding the focus is still there, and still focused, after
 * a read redresses the card around it.
 */
export interface SceneCard {
	/** The scene's id, or the group key and the id where a scene stands in several groups. */
	key: string;
	id: string;
	el: HTMLElement;
	scene: SceneViewModel;
	/** The scene's place in the narrative order. */
	index: number;
	number: HTMLElement;
	title: HTMLButtonElement;
	titleText: string;
	titleInput: HTMLInputElement;
	editingTitle: boolean;
	titleOriginal: string;
	titleRevision: EditRevision;
	color: HTMLButtonElement;
	more: HTMLButtonElement;
	pov: HTMLButtonElement;
	status: HTMLSelectElement;
	statusSignature: string;
	conflict: HTMLTextAreaElement;
	conflictDirty: boolean;
	conflictOriginal: string;
	conflictRevision: EditRevision;
	chips: HTMLElement;
	moreLinks: HTMLButtonElement;
	linksSignature: string | null;
}

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

/** What a deck asks of the board that deals its cards. */
export interface SceneCardDeps<Card extends SceneCard> {
	app: App;
	host: SceneCardHost;
	t: Translate;
	/** Re-reads the project; resolves after the board has been redrawn with the new model. */
	refresh: () => Promise<void>;
	notice: (error: unknown) => void;
	/** The model the board last painted from; null before the first paint or with no project. */
	model: () => ProjectDashboardModel | null;
	/** The path new edits are written under; a queued write keeps the one captured when it was queued. */
	projectPath: () => string | null;
	/** True while the project cannot be written to. */
	readOnly: () => boolean;
	charactersByPath: () => ReadonlyMap<string, ProjectDashboardModel['characters'][number]>;
	scenesById: () => ReadonlyMap<string, SceneViewModel>;
	/** Manuscript note paths by reading order, for the linked chips. */
	manuscriptPositions: () => ReadonlyMap<string, number>;
	/** Resolve in the source scene's context; the board may share its own cache. */
	resolveManuscriptPath: (target: string, sourcePath: string) => string | null;
	/** Whether the board lets this card drag now; the deck still drops it while a control is pressed. */
	dragAllowed: (card: Card) => boolean;
	/** The board's own menu, from the ellipsis and from a right click off any control. */
	menu: (card: Card, event: MouseEvent) => void;
	/** Widens a freshly built card with the board's own fields, before it is registered and wired. */
	extend: (card: SceneCard) => Card;
}

/**
 * What every card of one board shares: the registry of the cards standing,
 * the texts and statuses still being saved, the revisions each editor
 * holds, and the one queue every write goes through.
 */
export interface SceneCardDeck<Card extends SceneCard> {
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
	/** Forgets what the last full paint resolved, so a refresh resolves links afresh. */
	beginPaint: () => void;
	/** Builds a card's element under the parent, registers it under its key and wires its controls. */
	mount: (parent: HTMLElement, key: string, scene: SceneViewModel, index: number) => Card;
	/** Dresses the card from the model while preserving unfinished and pending edits. */
	dress: (
		card: Card,
		scene: SceneViewModel,
		index: number,
		/** Where the card stands among those shown, one-based, and how many there are. */
		place: { position: number; size: number },
	) => void;
	/** Takes a card down and out of the registry; a deleted scene's draft is kept. */
	unmount: (key: string) => void;
	/** Takes a card off the surface but keeps its editor: for a draft the filter left no place for. */
	park: (card: Card) => void;
	/** Moves a card, its editor and its pending texts under another key. */
	rekey: (card: Card, nextKey: string) => void;
	/** Takes every card down, keeping the drafts a refused write would lose. */
	clear: () => void;
	editable: (card: Card) => boolean;
	/** The keys the board must keep mounted wherever the window is: unfinished editors and pending texts. */
	editingKeys: () => string[];
	partOf: (card: Card, part: SceneCardPart) => Element;
	beginTitleEdit: (card: Card) => void;
	commitTitle: (card: Card, refocus: boolean) => void;
	commitConflict: (card: Card) => void;
	/** Lets the controls drag again once a press on one has ended. */
	releasePress: () => void;
	closeColorPanel: () => void;
	/** Drains every editor into the queue, which keeps running after the board is gone. */
	dispose: () => void;
}

export function createSceneCardDeck<Card extends SceneCard>(
	deps: SceneCardDeps<Card>,
): SceneCardDeck<Card> {
	const { app, host, t, notice } = deps;
	const cards = new Map<string, Card>();
	// Shared across group copies and remounts while a scene's save is pending.
	const pendingStatuses = new Map<string, { value: ProgressStatus }>();
	const pendingTitles = new Map<string, PendingText>();
	const pendingConflicts = new Map<string, PendingText>();
	const revisions = new Map<string, Map<string, Set<EditRevision>>>();
	/** Own writes the displayed model has not yet caught up with, including unmounted cards. */
	const revisionTransitions = new Map<string, Map<string, string>>();
	const queuedRevisions = new Set<{ base: EditRevision }>();
	let orderedManuscriptLinks = new WeakMap<SceneViewModel, SceneViewModel['linkedManuscript']>();
	let colorPanel: { card: Card; hung: HungPanel } | null = null;
	/** True while a press on a card's control is held, when a card must not drag. */
	let pressed = false;
	let queue: Promise<void> = Promise.resolve();
	let disposed = false;
	let recoveryDrafts: RecoveredCorkboardDraft[] = [];
	const recoveredTexts = new Set<string>();

	const recoverText = (scene: SceneViewModel, fields: Pick<RecoveredCorkboardDraft, 'title' | 'conflict'>): void => {
		const draft: RecoveredCorkboardDraft = { scene: scene.title };
		for (const field of ['title', 'conflict'] as const) {
			const value = fields[field];
			if (value === undefined) continue;
			const key = JSON.stringify([scene.path, field, value]);
			if (recoveredTexts.has(key)) continue;
			recoveredTexts.add(key);
			draft[field] = value;
		}
		if (draft.title === undefined && draft.conflict === undefined) return;
		if (recoveryDrafts.length === 0) {
			// Wait until the current paint has restored focus before opening.
			void Promise.resolve().then(() => {
				const drafts = recoveryDrafts;
				recoveryDrafts = [];
				recoveredTexts.clear();
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
			held.add(card.conflictRevision);
		}
		for (const pending of [...pendingTitles.values(), ...pendingConflicts.values()]) held.add(pending.base);
		for (const [id, byRevision] of revisions) {
			for (const [revision, bases] of byRevision) {
				for (const base of bases) if (!held.has(base)) bases.delete(base);
				if (bases.size === 0) byRevision.delete(revision);
			}
			if (byRevision.size === 0) revisions.delete(id);
		}
	};

	const editRevision = (scene: SceneViewModel): EditRevision => {
		const revision = revisionTransitions.get(scene.id)?.get(scene.revision) ?? scene.revision;
		let byRevision = revisions.get(scene.id);
		if (byRevision === undefined) {
			byRevision = new Map();
			revisions.set(scene.id, byRevision);
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
			if (card.id === change.id && card.scene.revision === change.before) {
				card.scene = { ...card.scene, revision: change.after };
			}
		}
	};

	/** One field of one scene, under the revision the card holds now, which the write then moves on. */
	const patch = (
		card: Card,
		fields: Pick<ScenePatch, 'title' | 'conflict' | 'color' | 'progressStatus'>,
		base = editRevision(card.scene),
	): Promise<boolean> => {
		const owningProject = deps.projectPath();
		let saved = false;
		const queued = { base };
		queuedRevisions.add(queued);
		return enqueue(async () => {
			if (owningProject === null) return;
			const expectedRevision = base.revision;
			const revision = await host.patchScene(card.id, {
				...fields,
				expectedRevision,
			}, owningProject);
			advanceRevision(card.id, expectedRevision, revision);
			for (const standing of new Set([card, ...cards.values()])) {
				if (standing.id === card.id && standing.scene.revision === expectedRevision) {
					standing.scene = { ...standing.scene, ...fields, revision };
				}
			}
			saved = true;
		}, { persist: true }).then(() => saved).finally(() => {
			queuedRevisions.delete(queued);
			prune();
		});
	};

	// -- A card --------------------------------------------------------------

	const editable = (card: Card): boolean =>
		!deps.readOnly() && !card.scene.readOnly && !card.scene.healthIssues.some((issue) => issue.blocking);

	/** Builds a card's element once: the parts a dressing rewrites rather than remakes. */
	const build = (
		el: HTMLElement,
		key: string,
		scene: SceneViewModel,
		index: number,
	): SceneCard => {
		// A grip at the top centre, to take hold of the card by where nothing else answers a press.
		const grip = el.createSpan({ cls: 'snowflake-method-corkboard-grip', attr: { 'aria-hidden': 'true' } });
		setIcon(grip, 'grip-horizontal');
		const head = el.createDiv({ cls: 'snowflake-method-corkboard-head' });
		const number = head.createSpan({
			cls: 'snowflake-method-step-indicator snowflake-method-corkboard-number',
		});
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
		const body = el.createDiv({ cls: 'snowflake-method-corkboard-body' });
		const conflict = body.createEl('textarea', {
			cls: 'snowflake-method-corkboard-conflict',
			attr: {
				'aria-label': t('table.conflict'),
				placeholder: t('modal.scene.conflictPlaceholder'),
				rows: '3',
			},
		});
		const links = el.createDiv({
			cls: 'snowflake-method-corkboard-links',
			attr: { role: 'group', 'aria-label': t('table.sceneLinked') },
		});
		const chips = links.createDiv({ cls: 'snowflake-method-corkboard-chips' });
		const moreLinks = links.createEl('button', {
			cls: 'snowflake-method-corkboard-more-links is-hidden',
			attr: { type: 'button', 'aria-haspopup': 'dialog' },
		});
		const footer = el.createDiv({ cls: 'snowflake-method-corkboard-footer' });
		const footerRow = footer.createDiv({ cls: 'snowflake-method-corkboard-footer-row' });
		const pov = footerRow.createEl('button', {
			cls: 'snowflake-method-corkboard-pov',
			attr: { type: 'button', 'aria-haspopup': 'dialog' },
		});
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
		return {
			key,
			id: scene.id,
			el,
			scene,
			index,
			number,
			title,
			titleText: '',
			titleInput,
			editingTitle: false,
			titleOriginal: scene.title,
			titleRevision: editRevision(scene),
			color,
			more,
			pov,
			status,
			statusSignature: '',
			conflict,
			conflictDirty: false,
			conflictOriginal: scene.conflict,
			conflictRevision: editRevision(scene),
			chips,
			moreLinks,
			linksSignature: null,
		};
	};

	const recoverBlockedDraft = (card: Card): void => {
		const fields: Pick<RecoveredCorkboardDraft, 'title' | 'conflict'> = {};
		if (card.editingTitle && card.titleInput.value !== card.titleOriginal) fields.title = card.titleInput.value;
		if (card.conflictDirty && card.conflict.value !== card.conflictOriginal) fields.conflict = card.conflict.value;
		card.conflictDirty = false;
		if (card.editingTitle) endTitleEdit(card, false);
		paintConflict(card);
		recoverText(card.scene, fields);
	};

	/** Text and color always represent the same selection, even during a save. */
	const paintStatus = (card: Card, value: ProgressStatus | null): void => {
		card.status.value = value ?? '';
		for (const status of PROGRESS_STATUSES) {
			card.status.toggleClass(`is-${status}`, value === status);
		}
	};

	const paintTitle = (card: Card): void => {
		if (card.editingTitle) return;
		const title = pendingTitles.get(card.id)?.value ?? card.scene.title;
		if (card.titleText === title) return;
		card.titleText = title;
		card.title.setText(title);
		setTooltip(card.title, title);
	};

	const paintConflict = (card: Card): void => {
		if (card.conflictDirty) return;
		const pending = pendingConflicts.get(card.id);
		const value = pending?.value ?? card.scene.conflict;
		if (card.conflict.value !== value) card.conflict.value = value;
		card.conflictOriginal = value;
		card.conflictRevision = pending?.base ?? editRevision(card.scene);
	};

	/** Dresses the card from the model while preserving unfinished and pending edits. */
	const dress = (
		card: Card,
		scene: SceneViewModel,
		index: number,
		place: { position: number; size: number },
	): void => {
		card.scene = scene;
		card.index = index;
		const { el } = card;
		const writable = editable(card);
		if (!writable) recoverBlockedDraft(card);
		if (!writable && colorPanel?.card === card) closeColorPanel();
		el.setAttribute('data-id', scene.id);
		el.setAttribute('aria-setsize', String(place.size));
		el.setAttribute('aria-posinset', String(place.position));
		if (scene.color === null) el.removeAttribute('data-color');
		else el.setAttribute('data-color', scene.color);
		el.toggleClass('is-read-only', !writable);
		el.toggleClass('has-managed-section-issue', scene.healthIssues.some((issue) => issue.blocking));
		el.setAttribute('draggable', deps.dragAllowed(card) && !pressed ? 'true' : 'false');
		paintCount(card.number, index + 1);
		card.number.setAttribute(
			'aria-label',
			t('corkboard.position', { number: index + 1 }),
		);
		paintTitle(card);
		card.title.disabled = !writable;
		const colorLabel =
			scene.color === null
				? t('modal.scene.colorNone')
				: t(`stickyNotes.color.${scene.color}`);
		card.color.setAttribute('aria-label', t('corkboard.colorLabel', { color: colorLabel }));
		setTooltip(card.color, colorLabel);
		card.color.disabled = !writable;
		const povLabel = t('corkboard.povLabel', { name: scene.povName || '—' });
		if (card.pov.textContent !== povLabel) card.pov.setText(povLabel);
		setTooltip(
			card.pov,
			scene.povMissing
				? t('table.referenceMissing', { name: scene.povName })
				: povLabel,
		);
		card.pov.toggleClass('is-missing', scene.povMissing);
		const character = deps.charactersByPath().get(scene.povPath);
		card.pov.disabled =
			deps.readOnly() || character === undefined || character.readOnly || character.healthIssues.some((issue) => issue.blocking);
		const shownStatus = pendingStatuses.get(scene.id)?.value ?? scene.progressStatus;
		const statuses = statusOptions(shownStatus, t);
		const statusSignature = statuses.map((option) => option.value).join('\n');
		if (statusSignature !== card.statusSignature) {
			card.statusSignature = statusSignature;
			fillSelect(card.status, statuses);
		}
		paintStatus(card, shownStatus);
		card.status.disabled = !writable;
		paintConflict(card);
		card.conflict.readOnly = !writable;
		let links = orderedManuscriptLinks.get(scene);
		if (links === undefined) {
			links = orderManuscriptReferences(scene.linkedManuscript, deps.manuscriptPositions(), (link) =>
				deps.resolveManuscriptPath(link.target, scene.path),
			);
			orderedManuscriptLinks.set(scene, links);
		}
		const linksSignature = JSON.stringify(links.map((link) => [link.raw,
			deps.resolveManuscriptPath(link.target, scene.path)]));
		if (linksSignature !== card.linksSignature) {
			card.linksSignature = linksSignature;
			dressLinks(card, scene, links);
		}
		card.moreLinks.disabled = false;
	};

	const dressLinks = (
		card: Card,
		scene: SceneViewModel,
		orderedLinks: SceneViewModel['linkedManuscript'],
	): void => {
		card.chips.empty();
		const { shown, remaining } = linkedManuscriptPreview(orderedLinks);
		card.el.toggleClass('has-more-links', remaining > 0);
		card.moreLinks.toggleClass('is-hidden', remaining === 0);
		card.moreLinks.setText(`+${String(remaining)}`);
		const moreLabel = t(remaining === 1 ? 'corkboard.moreLinkedOne' : 'corkboard.moreLinked', { count: remaining });
		card.moreLinks.setAttribute('aria-label', moreLabel);
		setTooltip(card.moreLinks, moreLabel);
		if (scene.linkedManuscript.length === 0) {
			renderEmptyLine(card.chips, t('corkboard.none.linked'));
		}
		for (const link of shown) {
			const missing =
				deps.resolveManuscriptPath(link.target, scene.path) === null;
			const chip = card.chips.createEl('button', {
				cls: `snowflake-method-corkboard-link${missing ? ' is-missing' : ''}`,
				attr: { type: 'button' },
			});
			if (missing) {
				const icon = chip.createSpan({
					cls: 'snowflake-method-corkboard-link-icon',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(icon, 'triangle-alert');
				setTooltip(chip, t('table.referenceMissing', { name: link.label }));
			} else {
				setTooltip(chip, link.linktext);
			}
			chip.createSpan({ cls: 'snowflake-method-corkboard-link-prefix', text: t('corkboard.linkedPrefix') });
			chip.createSpan({ cls: 'snowflake-method-corkboard-link-label', text: link.label });
			chip.addEventListener('click', (event) => {
				event.stopPropagation();
				const file = app.metadataCache.getFirstLinkpathDest(link.target, card.scene.path);
				if (file === null) {
					new Notice(t('table.referenceMissing', { name: link.label }));
					return;
				}
				const model = deps.model();
				if (model !== null) void host.openManuscriptStream(model.path, file.path).catch(notice);
			});
		}
	};

	// -- Editing in place ----------------------------------------------------

	const beginTitleEdit = (card: Card): void => {
		if (!editable(card) || card.editingTitle) return;
		const pending = pendingTitles.get(card.id);
		card.editingTitle = true;
		card.titleOriginal = pending?.value ?? card.scene.title;
		card.titleRevision = pending?.base ?? editRevision(card.scene);
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
		field: 'title' | 'conflict',
		pending: PendingText,
	): void => {
		const values = field === 'title' ? pendingTitles : pendingConflicts;
		const paint = field === 'title' ? paintTitle : paintConflict;
		values.set(card.id, pending);
		for (const standing of cards.values()) {
			if (standing.id === card.id) paint(standing);
		}
		void patch(card, { [field]: pending.value }, pending.base).then((saved) => {
			if (values.get(card.id) !== pending) return;
			values.delete(card.id);
			if (disposed) {
				if (!saved) recoverText(card.scene, { [field]: pending.value });
				return;
			}
			if (!saved) {
				// A rejected revision leaves the local draft available to fix
				// or cancel with Escape; the refreshed model remains its own.
				const draft = cards.get(card.key) ??
					[...cards.values()].find((standing) => standing.id === card.id) ?? card;
				if (!editable(draft) || !deps.scenesById().has(card.id)) {
					recoverText(card.scene, { [field]: pending.value });
				} else if (field === 'conflict' && !draft.conflictDirty) {
					draft.conflict.value = pending.value;
					draft.conflictOriginal = pending.original;
					draft.conflictRevision = pending.base;
					draft.conflictDirty = true;
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

	/** The typed name, refused as the form refuses one: empty, or another scene's. */
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
			new Notice(t('modal.scene.nameRequired'));
			return;
		}
		const model = deps.model();
		if (
			typed !== card.scene.title &&
			model !== null &&
			titleTaken(typed, card.id, model.scenes)
		) {
			new Notice(t('modal.scene.nameTaken'));
			return;
		}
		endTitleEdit(card, refocus);
		if (typed === card.scene.title && !pendingTitles.has(card.id)) return;
		saveText(card, 'title', {
			value: typed, base: card.titleRevision, original: card.titleOriginal, key: card.key,
		});
	};

	const commitConflict = (card: Card): void => {
		if (!editable(card)) {
			recoverBlockedDraft(card);
			return;
		}
		if (!card.conflictDirty) {
			paintConflict(card);
			return;
		}
		const value = card.conflict.value;
		card.conflictDirty = false;
		if (value === card.scene.conflict && !pendingConflicts.has(card.id)) {
			paintConflict(card);
			return;
		}
		saveText(card, 'conflict', {
			value, base: card.conflictRevision, original: card.conflictOriginal, key: card.key,
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
					value: card.scene.color ?? '',
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
		card.pov.addEventListener('click', (event) => {
			event.stopPropagation();
			const owningProject = deps.projectPath();
			const character = deps.charactersByPath().get(card.scene.povPath);
			if (deps.readOnly() || owningProject === null || character === undefined || character.readOnly ||
				character.healthIssues.some((issue) => issue.blocking)) return;
			openForm((onSaved) => host.openCharacterForm(character.id, owningProject, onSaved));
		});
		card.status.addEventListener('change', () => {
			const value = card.status.value;
			if (!isProgressStatus(value) || !editable(card)) return;
			const previous = pendingStatuses.get(card.id)?.value ?? card.scene.progressStatus;
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
							paintStatus(standing, pendingStatuses.get(standing.id)?.value ?? standing.scene.progressStatus);
						}
					}
				}
			});
		});
		card.moreLinks.addEventListener('click', (event) => {
			event.stopPropagation();
			const owningProject = deps.projectPath();
			if (owningProject === null) return;
			if (!editable(card)) {
				const menu = new Menu();
				for (const link of card.scene.linkedManuscript) {
					menu.addItem((item) => item.setTitle(link.label).setIcon('file-text').onClick(() => {
						const file = app.metadataCache.getFirstLinkpathDest(link.target, card.scene.path);
						if (file === null) new Notice(t('table.referenceMissing', { name: link.label }));
						else void host.openManuscriptStream(owningProject, file.path).catch(notice);
					}));
				}
				menu.showAtMouseEvent(event);
				return;
			}
			openForm((onSaved) => host.openSceneForm({
				mode: 'edit',
				id: card.id,
				section: 'linked-manuscript',
			}, owningProject, onSaved));
		});
		card.conflict.addEventListener('input', () => {
			card.conflictDirty = card.conflict.value !== card.conflictOriginal;
		});
		card.conflict.addEventListener('blur', () => {
			commitConflict(card);
		});
		card.conflict.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && Keymap.isModifier(event, 'Mod')) {
				event.preventDefault();
				commitConflict(card);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				card.conflictDirty = false;
				paintConflict(card);
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
			void host.openManagedFile(card.scene.path).catch(notice);
		});
		// A press in a field or on a list is a selection or a choice beginning,
		// and a card that drags under it would swallow both. A press on a
		// button is a click still to come: a move before it drags the card.
		el.addEventListener('mousedown', (event) => {
			if (!pressWithin(event.target)) return;
			pressed = true;
			el.setAttribute('draggable', 'false');
		});
	};

	const releasePress = (): void => {
		if (!pressed) return;
		pressed = false;
		for (const card of cards.values()) {
			card.el.setAttribute('draggable', deps.dragAllowed(card) ? 'true' : 'false');
		}
	};

	// -- The registry --------------------------------------------------------

	const mount = (parent: HTMLElement, key: string, scene: SceneViewModel, index: number): Card => {
		const el = parent.createDiv({
			cls: 'snowflake-method-corkboard-card snowflake-method-sticky-tint',
			attr: { role: 'listitem', tabindex: '0', 'data-key': key, 'data-id': scene.id },
		});
		const card = deps.extend(build(el, key, scene, index));
		cards.set(key, card);
		wire(card);
		return card;
	};

	const unmount = (key: string): void => {
		const card = cards.get(key);
		if (card === undefined) return;
		if (colorPanel?.card === card) closeColorPanel();
		// A deleted scene cannot accept the editor that was pinned to it.
		if (!deps.scenesById().has(card.id)) recoverBlockedDraft(card);
		card.el.remove();
		cards.delete(key);
	};

	const park = (card: Card): void => {
		const latest = deps.scenesById().get(card.id);
		if (latest !== undefined) card.scene = latest;
		if (!editable(card)) recoverBlockedDraft(card);
		if (colorPanel?.card === card) closeColorPanel();
		card.el.remove();
	};

	const rekey = (card: Card, nextKey: string): void => {
		const key = card.key;
		cards.delete(key);
		card.key = nextKey;
		card.el.setAttribute('data-key', nextKey);
		cards.set(nextKey, card);
		for (const pending of [pendingTitles.get(card.id), pendingConflicts.get(card.id)]) {
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
			if (card.editingTitle || card.conflictDirty) keys.push(card.key);
		}
		for (const pending of [...pendingTitles.values(), ...pendingConflicts.values()]) {
			keys.push(pending.key);
		}
		return keys;
	};

	const partOf = (card: Card, part: SceneCardPart): Element => {
		switch (part) {
			case 'title':
				return card.editingTitle ? card.titleInput : card.title;
			case 'pov':
				return card.pov;
			case 'status':
				return card.status;
			case 'color':
				return card.color;
			case 'more':
				return card.more;
			case 'conflict':
				return card.conflict;
			case 'more-links':
				return card.moreLinks;
			case 'link':
				return card.chips.querySelector('button') ?? card.el;
			case 'card':
				return card.el;
		}
	};

	return {
		cards,
		enqueue,
		openForm,
		adoptRevision,
		prune,
		beginPaint: () => {
			orderedManuscriptLinks = new WeakMap();
		},
		mount,
		dress,
		unmount,
		park,
		rekey,
		clear,
		editable,
		editingKeys,
		partOf,
		beginTitleEdit,
		commitTitle,
		commitConflict,
		releasePress,
		closeColorPanel,
		dispose: () => {
			disposed = true;
			closeColorPanel();
			// Final drafts join accepted saves in the same order. They retain
			// the board's project and revisions after its view has gone away.
			for (const card of cards.values()) {
				commitTitle(card, false);
				commitConflict(card);
				if (card.editingTitle) recoverBlockedDraft(card);
			}
		},
	};
}
