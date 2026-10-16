/**
 * A character's or a worldbuilding note's card: the shared member card in the
 * scene card's shape, with what such a note adds. Its body is the
 * character's one-sentence storyline or the note's description, typed into
 * where the surface allows; its fullest style shows the main picture of the
 * note's gallery above the words, or the kind's symbol where there is none;
 * and its foot carries a word about the note, which the surface chooses: the
 * kind on the canvas, where kinds mix, a detail of its own on a board of one
 * kind. Writes go to the character's or the worldbuilding note's own patch.
 */

import type { App } from 'obsidian';

import type { CharacterPatch, EntityPatch } from '../services';
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
import type { CharacterViewModel, DashboardHost, WorldbuildingEntityViewModel } from './view-model';

/** The two kinds of note an entity card stands for. */
export type EntityMember = CharacterViewModel | WorldbuildingEntityViewModel;

export const isCharacterMember = (member: EntityMember): member is CharacterViewModel => !('kind' in member);

/** The kind a note is of: `character`, or the worldbuilding kind's id. */
export const kindOf = (member: EntityMember): string => (isCharacterMember(member) ? 'character' : member.kind);

/** What an entity card carries beyond the shared parts. */
export interface EntityCardExtras {
	/** The word on the foot. */
	word: HTMLElement;
}

export type EntityCard = MemberCard<EntityMember> & EntityCardExtras;
export type EntityCardPart = MemberCardPart;
export const ENTITY_CARD_PART_CLASSES: readonly [EntityCardPart, string][] = MEMBER_CARD_PART_CLASSES;

/** The host's own methods an entity card calls, and no others. */
export type EntityCardHost = Pick<DashboardHost, 'openManagedFile' | 'patchCharacter' | 'patchEntity'>;

/** What an entity deck asks of the surface that deals its cards. */
export interface EntityCardDeps<Card extends EntityCard> {
	app: App;
	host: EntityCardHost;
	t: Translate;
	/** Re-reads the project; resolves after the surface has been redrawn with the new model. */
	refresh: () => Promise<void>;
	notice: (error: unknown) => void;
	/** The path new edits are written under; a queued write keeps the one captured when it was queued. */
	projectPath: () => string | null;
	/** True while the project cannot be written to. */
	readOnly: () => boolean;
	/** True while the plugin is unloading, when a dialog opened now would outlive its owner. */
	unloading?: () => boolean;
	/** Every note the deck may deal, as the model holds them now; a note missing has gone. */
	membersById: () => ReadonlyMap<string, EntityMember>;
	/** Whether another note of the member's kind already bears the name. */
	nameTaken: (member: EntityMember, name: string) => boolean;
	/** What the foot says of the note. */
	footWord: (member: EntityMember) => string;
	/** The symbol the picture pane shows for a note with no picture: the kind's. */
	icon: (member: EntityMember) => string;
	/** Whether the surface lets this card drag now; the deck still drops it while a control is pressed. */
	dragAllowed: (card: Card) => boolean;
	/** The surface's own menu, from the ellipsis and from a right click off any control. */
	menu: (card: Card, event: MouseEvent) => void;
	/** Widens a freshly built card with the surface's own fields, before it is registered and wired. */
	extend: (card: EntityCard) => Card;
	/** The symbol a card wears at its head in place of its number, one for every card or one read off each note. */
	symbol?: string | ((member: EntityMember) => string);
	/** The body is read on the card and never typed into there. */
	bodyReadOnly?: boolean;
	/** The title is read on the card and never typed into there. */
	titleReadOnly?: boolean;
	/** Whether the surface's current style shows the picture pane; left out, the pane is dressed with every card. */
	paneShown?: () => boolean;
}

export type EntityCardDeck<Card extends EntityCard> = MemberCardDeck<EntityMember, Card, EntityCardPart>;

/** The words a card's body holds: a character's one-sentence storyline, a worldbuilding note's description. */
export const entityBodyOf = (member: EntityMember): string =>
	isCharacterMember(member) ? member.oneSentenceStoryline : member.description;

/** A card's fields in a character's own words: the title is the name, the body the storyline. */
function characterPatchOf(fields: MemberCardPatch, expectedRevision: string): CharacterPatch {
	const patch: CharacterPatch = { expectedRevision };
	if (fields.title !== undefined) patch.name = fields.title;
	if (fields.body !== undefined) patch.oneSentenceStoryline = fields.body;
	if (fields.color !== undefined) patch.color = fields.color;
	if (fields.progressStatus !== undefined) patch.progressStatus = fields.progressStatus;
	if (fields.gallery !== undefined) patch.gallery = fields.gallery;
	if (fields.galleryMain !== undefined) patch.galleryMain = fields.galleryMain;
	return patch;
}

/** And in a worldbuilding note's: the body is the description. */
function entityPatchOf(fields: MemberCardPatch, expectedRevision: string): EntityPatch {
	const patch: EntityPatch = { expectedRevision };
	if (fields.title !== undefined) patch.name = fields.title;
	if (fields.body !== undefined) patch.description = fields.body;
	if (fields.color !== undefined) patch.color = fields.color;
	if (fields.progressStatus !== undefined) patch.progressStatus = fields.progressStatus;
	if (fields.gallery !== undefined) patch.gallery = fields.gallery;
	if (fields.galleryMain !== undefined) patch.galleryMain = fields.galleryMain;
	return patch;
}

/** The note as the fields written leave it, before the model has caught up. */
function entityApplied(member: EntityMember, fields: MemberCardPatch, revision: string): EntityMember {
	const shared = {
		...(fields.title === undefined ? {} : { name: fields.title }),
		...(fields.color === undefined ? {} : { color: fields.color }),
		...(fields.progressStatus === undefined ? {} : { progressStatus: fields.progressStatus }),
		...(fields.gallery === undefined ? {} : { gallery: fields.gallery }),
		...(fields.galleryMain === undefined ? {} : { galleryMain: fields.galleryMain }),
		revision,
	};
	if (isCharacterMember(member)) {
		const next: CharacterViewModel = { ...member, ...shared };
		if (fields.body !== undefined) next.oneSentenceStoryline = fields.body;
		return next;
	}
	const next: WorldbuildingEntityViewModel = { ...member, ...shared };
	if (fields.body !== undefined) next.description = fields.body;
	return next;
}

function entityCardKind<Card extends EntityCard>(
	deps: EntityCardDeps<Card>,
): CardKind<EntityMember, EntityCardExtras, EntityCardPart> {
	const { host, t } = deps;
	return {
		title: (member) => member.name,
		body: entityBodyOf,
		status: (member) => member.progressStatus,
		color: (member) => member.color,
		picture: (member) => ({ gallery: member.gallery, galleryMain: member.galleryMain, path: member.path, icon: deps.icon(member) }),
		cardClass: 'is-entity-card',
		patch: (member, fields, expectedRevision, projectPath) =>
			isCharacterMember(member)
				? host.patchCharacter(member.id, characterPatchOf(fields, expectedRevision), projectPath)
				: host.patchEntity(member.id, entityPatchOf(fields, expectedRevision), projectPath),
		applied: entityApplied,
		membersById: () => deps.membersById(),
		taken: (name, ownId) => {
			const member = deps.membersById().get(ownId);
			return member !== undefined && deps.nameTaken(member, name);
		},
		open: (member) => host.openManagedFile(member.path),
		words: {
			bodyLabel: (member) => (isCharacterMember(member) ? t('modal.character.oneSentenceStoryline') : t('form.description')),
			bodyPlaceholder: (member) =>
				isCharacterMember(member) ? t('modal.character.oneSentenceStorylinePlaceholder') : t('form.description.placeholder'),
			nameRequired: (member) => (isCharacterMember(member) ? t('modal.character.nameRequired') : t('modal.entity.nameRequired')),
			nameTaken: (member) => (isCharacterMember(member) ? t('modal.character.nameTaken') : t('modal.entity.nameTaken')),
		},
		build: (slots) => {
			// The word leads the foot, where a scene names its point of view.
			const word = slots.footerRow.createSpan({ cls: 'snowflake-method-corkboard-word' });
			slots.footerRow.insertBefore(word, slots.actions);
			return { word };
		},
		dress: (card, member) => {
			const word = deps.footWord(member);
			if (card.word.textContent !== word) card.word.setText(word);
		},
		wire: () => undefined,
		partClasses: [],
		partOf: () => null,
	};
}

export function createEntityCardDeck<Card extends EntityCard>(deps: EntityCardDeps<Card>): EntityCardDeck<Card> {
	return createMemberCardDeck<EntityMember, EntityCardExtras, EntityCardPart, Card>(entityCardKind(deps), {
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
		...(deps.paneShown === undefined ? {} : { paneShown: deps.paneShown }),
	});
}
