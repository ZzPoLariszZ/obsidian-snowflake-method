/**
 * The scene card as one thing every board deals from: the corkboard, the
 * lanes of the timeline and the beat sheet, and the freeform canvas. It is
 * the shared member card with what a scene adds: the point of view on its
 * foot, which opens the character's form, and the manuscript notes it is
 * written into as chips above the foot. The card's shape, its edits in place
 * and the queue they go through are the deck's; what is written back goes
 * through the scene's own patch.
 */

import { Menu, Notice, setIcon, setTooltip, type App } from 'obsidian';

import type { ScenePatch } from '../services';
import { titleTaken } from './corkboard-layout';
import { linkedManuscriptPreview, orderManuscriptReferences } from './linked-manuscript';
import {
	MEMBER_CARD_PART_CLASSES,
	createMemberCardDeck,
	type CardKind,
	type MemberCard,
	type MemberCardDeck,
	type MemberCardPart,
	type MemberCardPatch,
} from './member-card';
import type { Translate } from './modals';
import { renderEmptyLine } from './pane-parts';
import type { DashboardHost, ProjectDashboardModel, SceneViewModel } from './view-model';

export {
	CARD_SELECTOR as SCENE_CARD_SELECTOR,
	controlWithin,
	fillSelect,
	pressWithin,
	type EditRevision,
	type WriteOptions,
} from './member-card';

/** The host's own methods a scene card calls, and no others. */
export type SceneCardHost = Pick<
	DashboardHost,
	'openManagedFile' | 'openManuscriptStream' | 'openSceneForm' | 'openCharacterForm' | 'patchScene'
>;

/** The parts of a scene card the focus can stand on: the shared ones, and the scene's own. */
export type SceneCardPart = MemberCardPart | 'pov' | 'more-links' | 'link';

const SCENE_OWN_PART_CLASSES: readonly [SceneCardPart, string][] = [
	['pov', 'snowflake-method-corkboard-pov'],
	['more-links', 'snowflake-method-corkboard-more-links'],
	['link', 'snowflake-method-corkboard-link'],
];

export const SCENE_CARD_PART_CLASSES: readonly [SceneCardPart, string][] = [
	...MEMBER_CARD_PART_CLASSES,
	...SCENE_OWN_PART_CLASSES,
];

/** What a scene's card carries beyond the shared parts. */
export interface SceneCardExtras {
	pov: HTMLButtonElement;
	chips: HTMLElement;
	moreLinks: HTMLButtonElement;
	linksSignature: string | null;
}

export type SceneCard = MemberCard<SceneViewModel> & SceneCardExtras;

/** What a scene deck asks of the board that deals its cards. */
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
	/** True while the plugin is unloading, when a dialog opened now would outlive its owner. */
	unloading?: () => boolean;
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
	/** The symbol every card wears at its head in place of its number, on a surface where the cards stand in no order. */
	symbol?: string;
	/** The conflict is read on the card and never typed into there: for a surface that leaves the writing to the form. */
	bodyReadOnly?: boolean;
	/** The title is read on the card and never typed into there. */
	titleReadOnly?: boolean;
}

export type SceneCardDeck<Card extends SceneCard> = MemberCardDeck<SceneViewModel, Card, SceneCardPart>;

/** A card's fields in the scene's own words: the card's body is the scene's conflict. */
function scenePatchOf(fields: MemberCardPatch, expectedRevision: string): ScenePatch {
	const patch: ScenePatch = { expectedRevision };
	if (fields.title !== undefined) patch.title = fields.title;
	if (fields.body !== undefined) patch.conflict = fields.body;
	if (fields.color !== undefined) patch.color = fields.color;
	if (fields.progressStatus !== undefined) patch.progressStatus = fields.progressStatus;
	return patch;
}

/** The scene as the fields written leave it, before the model has caught up. */
function sceneApplied(scene: SceneViewModel, fields: MemberCardPatch, revision: string): SceneViewModel {
	const next: SceneViewModel = { ...scene, revision };
	if (fields.title !== undefined) next.title = fields.title;
	if (fields.body !== undefined) next.conflict = fields.body;
	if (fields.color !== undefined) next.color = fields.color;
	if (fields.progressStatus !== undefined) next.progressStatus = fields.progressStatus;
	return next;
}

function sceneCardKind<Card extends SceneCard>(
	deps: SceneCardDeps<Card>,
): CardKind<SceneViewModel, SceneCardExtras, SceneCardPart> {
	const { app, host, t, notice } = deps;
	let orderedManuscriptLinks = new WeakMap<SceneViewModel, SceneViewModel['linkedManuscript']>();

	const dressLinks = (
		card: SceneCard,
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
				const file = app.metadataCache.getFirstLinkpathDest(link.target, card.member.path);
				if (file === null) {
					new Notice(t('table.referenceMissing', { name: link.label }));
					return;
				}
				const model = deps.model();
				if (model !== null) void host.openManuscriptStream(model.path, file.path).catch(notice);
			});
		}
	};

	return {
		title: (scene) => scene.title,
		body: (scene) => scene.conflict,
		status: (scene) => scene.progressStatus,
		color: (scene) => scene.color,
		// The pane shows a scene's main picture in the gallery style; the rail's scene symbol stands in without one.
		picture: (scene) => ({ gallery: scene.gallery, galleryMain: scene.galleryMain, path: scene.path, icon: 'clapperboard' }),
		cardClass: 'is-scene-card',
		patch: (scene, fields, expectedRevision, projectPath) =>
			host.patchScene(scene.id, scenePatchOf(fields, expectedRevision), projectPath),
		applied: sceneApplied,
		membersById: () => deps.scenesById(),
		taken: (name, ownId) => {
			const model = deps.model();
			return model !== null && titleTaken(name, ownId, model.scenes);
		},
		open: (scene) => host.openManagedFile(scene.path),
		words: {
			bodyLabel: () => t('table.conflict'),
			bodyPlaceholder: () => t('modal.scene.conflictPlaceholder'),
			nameRequired: () => t('modal.scene.nameRequired'),
			nameTaken: () => t('modal.scene.nameTaken'),
		},
		build: (slots) => {
			// The manuscript chips stand between the body and the foot.
			const links = slots.el.createDiv({
				cls: 'snowflake-method-corkboard-links',
				attr: { role: 'group', 'aria-label': t('table.sceneLinked') },
			});
			slots.el.insertBefore(links, slots.footer);
			const chips = links.createDiv({ cls: 'snowflake-method-corkboard-chips' });
			const moreLinks = links.createEl('button', {
				cls: 'snowflake-method-corkboard-more-links is-hidden',
				attr: { type: 'button', 'aria-haspopup': 'dialog' },
			});
			// The point of view leads the foot, ahead of the palette and the menu.
			const pov = slots.footerRow.createEl('button', {
				cls: 'snowflake-method-corkboard-pov',
				attr: { type: 'button', 'aria-haspopup': 'dialog' },
			});
			slots.footerRow.insertBefore(pov, slots.actions);
			return { pov, chips, moreLinks, linksSignature: null };
		},
		dress: (card, scene) => {
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
		},
		wire: (card, tools) => {
			card.pov.addEventListener('click', (event) => {
				event.stopPropagation();
				const owningProject = deps.projectPath();
				const character = deps.charactersByPath().get(card.member.povPath);
				if (deps.readOnly() || owningProject === null || character === undefined || character.readOnly ||
					character.healthIssues.some((issue) => issue.blocking)) return;
				tools.openForm((onSaved) => host.openCharacterForm(character.id, owningProject, onSaved));
			});
			card.moreLinks.addEventListener('click', (event) => {
				event.stopPropagation();
				const owningProject = deps.projectPath();
				if (owningProject === null) return;
				if (!tools.editable(card)) {
					const menu = new Menu();
					for (const link of card.member.linkedManuscript) {
						menu.addItem((item) => item.setTitle(link.label).setIcon('file-text').onClick(() => {
							const file = app.metadataCache.getFirstLinkpathDest(link.target, card.member.path);
							if (file === null) new Notice(t('table.referenceMissing', { name: link.label }));
							else void host.openManuscriptStream(owningProject, file.path).catch(notice);
						}));
					}
					menu.showAtMouseEvent(event);
					return;
				}
				tools.openForm((onSaved) => host.openSceneForm({
					mode: 'edit',
					id: card.id,
					section: 'linked-manuscript',
				}, owningProject, onSaved));
			});
		},
		partClasses: SCENE_OWN_PART_CLASSES,
		partOf: (card, part) => {
			switch (part) {
				case 'pov':
					return card.pov;
				case 'more-links':
					return card.moreLinks;
				case 'link':
					return card.chips.querySelector('button') ?? card.el;
				default:
					return null;
			}
		},
		beginPaint: () => {
			orderedManuscriptLinks = new WeakMap();
		},
	};
}

export function createSceneCardDeck<Card extends SceneCard>(
	deps: SceneCardDeps<Card>,
): SceneCardDeck<Card> {
	return createMemberCardDeck<SceneViewModel, SceneCardExtras, SceneCardPart, Card>(sceneCardKind(deps), {
		app: deps.app,
		t: deps.t,
		refresh: deps.refresh,
		notice: deps.notice,
		projectPath: deps.projectPath,
		readOnly: deps.readOnly,
		...(deps.unloading === undefined ? {} : { unloading: deps.unloading }),
		dragAllowed: deps.dragAllowed,
		menu: deps.menu,
		extend: deps.extend,
		...(deps.symbol === undefined ? {} : { symbol: deps.symbol }),
		...(deps.bodyReadOnly === undefined ? {} : { bodyReadOnly: deps.bodyReadOnly }),
		...(deps.titleReadOnly === undefined ? {} : { titleReadOnly: deps.titleReadOnly }),
	});
}
