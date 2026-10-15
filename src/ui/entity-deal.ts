/**
 * The corkboard's other views: the characters, and the notes of one
 * worldbuilding kind, dealt as the scenes are. Each is one kind's notes in
 * rank order, searched over the fields the dashboard's table searches,
 * gathered and narrowed by the kind's own fields, their cards the shared
 * entity card, and the host asked for the kind's own create, edit, reorder
 * and delete.
 */

import { foldName } from '../domain';
import { characterRoleName } from '../services';
import type { CorkboardControls } from './corkboard-bridge';
import type { CorkboardDeal } from './corkboard-deal';
import { CHARACTER_DRAG_TYPE, ENTITY_DRAG_TYPE } from './corkboard-layout';
import {
	ENTITY_CARD_PART_CLASSES,
	createEntityCardDeck,
	isCharacterMember,
	kindOf,
	type EntityCardExtras,
	type EntityCardPart,
	type EntityMember,
} from './entity-card';
import {
	clearEntityFilters,
	entityFilterRows,
	entityFiltered,
	entityFilters,
	entityGroupFields,
	entityGroupLabel,
	entityGroupValues,
	filterEntities,
	isEntityGroupField,
	reconcileEntityFilters,
	type EntityFilters,
} from './entity-filters';
import { kindIcon } from './kind-icon';
import { kindText } from './kind-word';
import type { Translate } from './modals';
import type { CorkboardMode } from './story-structure-state';
import { kindEntities, type ProjectDashboardModel } from './view-model';

/** An entity card's height per style in rem with no pane on it: the scene card's, its fullest the standard's. */
export const ENTITY_CARD_REM: Readonly<Record<CorkboardMode, number>> = { compact: 5, standard: 15, gallery: 5, extended: 15 };

/** The styles that stand the picture pane on an entity's card: the gallery style, and its fullest above the words. */
export const ENTITY_CARD_PANED: readonly CorkboardMode[] = ['gallery', 'extended'];

/** What the funnel of an entity view needs beyond the model: the kind's category tree. */
export interface EntityFilterExtra {
	categoryPaths: string[];
}

export type EntityDeal = CorkboardDeal<EntityMember, EntityCardExtras, EntityCardPart, EntityFilters, EntityFilterExtra>;

/**
 * What a card's foot says on a board of one kind, where the kind itself is
 * the field's word: a character's role, a time's point or period, and for
 * every other note the last names of its categories; nothing where the note
 * has none, as a scene's foot names no point of view it lacks.
 */
export function boardFootWord(t: Translate, locale: 'en' | 'zh-CN', member: EntityMember): string {
	if (isCharacterMember(member)) return member.type === null ? '' : characterRoleName(locale, member.type);
	if (member.kind === 'time') return member.timeKind === null ? '' : t(`form.timeKind.${member.timeKind}`);
	return member.categoryPaths.map((path) => path.slice(path.lastIndexOf('/') + 1)).join(', ');
}

export function entityDeal(controls: CorkboardControls<EntityFilters>, kind: string): EntityDeal {
	const { host, t } = controls;
	const character = kind === 'character';
	let model: ProjectDashboardModel | null = null;
	let membersById = new Map<string, EntityMember>();
	const membersOf = (current: ProjectDashboardModel): readonly EntityMember[] =>
		character ? current.characters : kindEntities(current, kind);
	const words = character
		? {
			search: t('table.searchCharacters'),
			add: t('actions.addCharacter'),
			insertBefore: t('table.insertCharacterBefore'),
			insertAfter: t('table.insertCharacterAfter'),
			empty: t('characters.empty'),
		}
		: {
			search: kindText(t, 'worldbuilding.search', kind),
			add: kindText(t, 'worldbuilding.add', kind),
			insertBefore: kindText(t, 'worldbuilding.insertBefore', kind),
			insertAfter: kindText(t, 'worldbuilding.insertAfter', kind),
			empty: kindText(t, 'worldbuilding.empty', kind),
		};
	return {
		view: kind,
		dragType: character ? CHARACTER_DRAG_TYPE : ENTITY_DRAG_TYPE,
		cardHeight: ENTITY_CARD_REM,
		paned: ENTITY_CARD_PANED,
		words,
		index: (next) => {
			model = next;
			membersById = new Map(next === null ? [] : membersOf(next).map((member) => [member.id, member]));
		},
		beginPaint: () => undefined,
		members: membersOf,
		membersById: () => membersById,
		name: (member) => member.name,
		filters: {
			make: entityFilters,
			clear: clearEntityFilters,
			active: entityFiltered,
			// Every question an entity view asks can leave gaps in the order.
			gapping: entityFiltered,
			reconcile: (filters, current) => {
				reconcileEntityFilters(filters, current, kind);
			},
			extra: async (current) => {
				try {
					return { categoryPaths: await host.listDefinitionPaths(kind, 'category', current.path) };
				} catch {
					// The tree could not be read: the assignments the notes carry still make filters.
					return {
						categoryPaths: [...new Set(membersOf(current).flatMap((member) => member.categoryPaths))]
							.sort((a, b) => a.localeCompare(b, current.locale)),
					};
				}
			},
			rows: (current, filters, extra) => entityFilterRows(t, kind, current.locale, filters, extra),
		},
		shown: (members, query, filters) => filterEntities(members, query, filters, t),
		groupFields: entityGroupFields(kind),
		groupLabel: (field) => (isEntityGroupField(field) ? entityGroupLabel(t, field) : field),
		groupValues: (member, field, current) =>
			isEntityGroupField(field) ? entityGroupValues(member, field, { t, locale: current.locale }) : [],
		noneLabel: (field) => t(`corkboard.none.${field}`),
		deck: (deps) => createEntityCardDeck({
			...deps,
			host,
			membersById: () => membersById,
			nameTaken: (member, name) => {
				const folded = foldName(name);
				return [...membersById.values()].some(
					(candidate) => candidate.id !== member.id && foldName(candidate.name) === folded,
				);
			},
			footWord: (member) => boardFootWord(t, model?.locale ?? 'en', member),
			icon: (member) => kindIcon(model ?? { worldbuildingKinds: [] }, kindOf(member)),
		}),
		partClasses: ENTITY_CARD_PART_CLASSES,
		reorder: async (id, target, projectPath, adopt) => {
			// A relative destination is resolved against the order as it stands
			// when the queued move runs, which is after every earlier write landed.
			const current = controls.model();
			const ids = current === null || current.path !== projectPath ? [] : membersOf(current).map((member) => member.id);
			const index = typeof target === 'number' ? target : target(ids);
			if (index === null) return;
			if (character) await host.reorderCharacter(id, index, projectPath, adopt);
			else await host.reorderEntity(kind, id, index, projectPath, adopt);
		},
		openCreate: (afterIndex, projectPath, onSaved) =>
			character
				? host.openCreateCharacterForm(afterIndex, projectPath, onSaved)
				: host.openEntityForm({ mode: 'create', kind, afterIndex }, projectPath, onSaved),
		openEdit: (member, projectPath, onSaved) =>
			isCharacterMember(member)
				? host.openCharacterForm(member.id, projectPath, onSaved)
				: host.openEntityForm({ mode: 'edit', id: member.id }, projectPath, onSaved),
		open: (member) => host.openManagedFile(member.path),
		delete: (member, projectPath) =>
			isCharacterMember(member)
				? host.deleteCharacter(member.id, member.revision, projectPath)
				: host.deleteEntity(member.id, member.revision, projectPath),
	};
}
