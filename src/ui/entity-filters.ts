/**
 * What a board of characters or of one worldbuilding kind can be narrowed
 * and gathered by: the status, the category, the colour, a character's role
 * and a time's kind. The search reads the fields the dashboard's tables read.
 */

import {
	MACARON_COLORS,
	PROGRESS_STATUSES,
	TIME_KINDS,
	isTimeKind,
	type CharacterType,
	type MacaronColor,
	type ProgressStatus,
	type TimeKind,
} from '../domain';
import { characterRoleName } from '../services';
import type { ShownMember } from './corkboard-deal';
import type { GroupValue } from './corkboard-layout';
import { memberMatches } from './dashboard-state';
import { entityBodyOf, isCharacterMember, type EntityMember } from './entity-card';
import type { FilterRow } from './filter-rows';
import type { Translate } from './modals';
import { categoryFilterRow, categoryWithin, progressFilterRow } from './scene-filters';

const CHARACTER_ROLES: readonly CharacterType[] = ['major', 'supporting', 'minor'];

const isCharacterRole = (value: string): value is CharacterType => (CHARACTER_ROLES as readonly string[]).includes(value);

/** The funnel's answers. Empty values mean the question is not being asked. */
export interface EntityFilters {
	status: 'all' | ProgressStatus;
	/** A category path, whose subtree counts as filed under it. */
	category: string;
	color: '' | MacaronColor;
	/** A character's role; asked only on the character view. */
	role: '' | CharacterType;
	/** A time's point or period; asked only on the time view. */
	timeKind: '' | TimeKind;
}

export function entityFilters(): EntityFilters {
	return { status: 'all', category: '', color: '', role: '', timeKind: '' };
}

/** True when any of the funnel's questions is being asked. */
export function entityFiltered(filters: EntityFilters): boolean {
	return (
		filters.status !== 'all' ||
		filters.category !== '' ||
		filters.color !== '' ||
		filters.role !== '' ||
		filters.timeKind !== ''
	);
}

/** Every question back to unasked, in place, as the board keeps them. */
export function clearEntityFilters(filters: EntityFilters): void {
	Object.assign(filters, entityFilters());
}

/** Drops a category the kind's tree no longer has. */
export function reconcileEntityFilters(
	filters: EntityFilters,
	model: { definitions?: { category?: Partial<Record<string, { nodes: readonly { taxonomyPath: string }[] }>> } },
	kind: string,
): void {
	const nodes = model.definitions?.category?.[kind]?.nodes;
	if (filters.category !== '' && nodes !== undefined && !nodes.some((node) => node.taxonomyPath === filters.category)) {
		filters.category = '';
	}
}

/** The notes the questions and the search keep, each with its place in the order. */
export function filterEntities(
	members: readonly EntityMember[],
	query: string,
	filters: EntityFilters,
	t: Translate,
): ShownMember<EntityMember>[] {
	const searching = query.trim().length > 0;
	return members
		.map((member, index) => ({ member, index }))
		.filter(
			({ member }) =>
				(filters.status === 'all' || member.progressStatus === filters.status) &&
				(filters.category === '' ||
					member.categoryPaths.some((path) => categoryWithin(path, filters.category))) &&
				(filters.color === '' || member.color === filters.color) &&
				(filters.role === '' || (isCharacterMember(member) && member.type === filters.role)) &&
				(filters.timeKind === '' || (!isCharacterMember(member) && member.timeKind === filters.timeKind)) &&
				(!searching ||
					memberMatches(
						[
							member.name,
							...member.aliases,
							...member.categoryPaths,
							...(member.progressStatus === null ? [] : [t(`status.${member.progressStatus}`)]),
							entityBodyOf(member),
						],
						query,
					)),
		);
}

export const ENTITY_GROUP_FIELDS = ['status', 'category', 'role', 'timeKind', 'color'] as const;
export type EntityGroupField = (typeof ENTITY_GROUP_FIELDS)[number];

export function isEntityGroupField(value: unknown): value is EntityGroupField {
	return (ENTITY_GROUP_FIELDS as readonly unknown[]).includes(value);
}

/** The fields a view's cards can be gathered by: the role on the character view, the kind on the time view. */
export function entityGroupFields(kind: string): readonly EntityGroupField[] {
	if (kind === 'character') return ['status', 'category', 'role', 'color'];
	if (kind === 'time') return ['status', 'category', 'timeKind', 'color'];
	return ['status', 'category', 'color'];
}

/** What a group field is called over the display popover. */
export function entityGroupLabel(t: Translate, field: EntityGroupField): string {
	switch (field) {
		case 'status':
			return t('table.progressStatus');
		case 'category':
			return t('table.category');
		case 'role':
			return t('corkboard.group.role');
		case 'timeKind':
			return t('form.timeKind');
		case 'color':
			return t('stickyNotes.color');
	}
}

/** The groups a note falls into for one of the fields, each with its place among its field's. */
export function entityGroupValues(
	member: EntityMember,
	field: EntityGroupField,
	ctx: { t: Translate; locale: 'en' | 'zh-CN' },
): GroupValue[] {
	switch (field) {
		case 'status':
			return member.progressStatus === null
				? []
				: [{ key: member.progressStatus, label: ctx.t(`status.${member.progressStatus}`), rank: PROGRESS_STATUSES.indexOf(member.progressStatus) }];
		case 'color':
			return member.color === null
				? []
				: [{ key: member.color, label: ctx.t(`stickyNotes.color.${member.color}`), rank: MACARON_COLORS.indexOf(member.color) }];
		case 'category':
			return member.categoryPaths.map((path) => ({ key: path, label: path, rank: 0 }));
		case 'role':
			return isCharacterMember(member) && member.type !== null
				? [{ key: member.type, label: characterRoleName(ctx.locale, member.type), rank: CHARACTER_ROLES.indexOf(member.type) }]
				: [];
		case 'timeKind':
			return !isCharacterMember(member) && member.timeKind !== null
				? [{ key: member.timeKind, label: ctx.t(`form.timeKind.${member.timeKind}`), rank: TIME_KINDS.indexOf(member.timeKind) }]
				: [];
	}
}

/** Everything a note of the kind can be narrowed by, in the funnel's rows. */
export function entityFilterRows(
	t: Translate,
	kind: string,
	locale: 'en' | 'zh-CN',
	filters: EntityFilters,
	extra: { categoryPaths: readonly string[] },
): FilterRow[] {
	const rows: FilterRow[] = [
		progressFilterRow(t, filters.status, (next) => {
			filters.status = next;
		}),
		categoryFilterRow(t, extra.categoryPaths, filters.category, (next) => {
			filters.category = next;
		}),
	];
	if (kind === 'character') {
		rows.push({
			label: t('corkboard.group.role'),
			placeholder: t('table.filterAllRoles'),
			empty: '',
			options: () => CHARACTER_ROLES.map((role) => ({ value: role, label: characterRoleName(locale, role) })),
			value: filters.role,
			apply: (next) => {
				filters.role = isCharacterRole(next) ? next : '';
			},
		});
	}
	if (kind === 'time') {
		rows.push({
			label: t('form.timeKind'),
			placeholder: t('table.filterAllTimeKinds'),
			empty: '',
			options: () => TIME_KINDS.map((timeKind) => ({ value: timeKind, label: t(`form.timeKind.${timeKind}`) })),
			value: filters.timeKind,
			apply: (next) => {
				filters.timeKind = isTimeKind(next) ? next : '';
			},
		});
	}
	rows.push({
		label: t('table.sceneColor'),
		presentation: 'color-swatches',
		placeholder: t('table.filterAllColors'),
		empty: '',
		options: () => MACARON_COLORS.map((color) => ({ value: color, label: t(`stickyNotes.color.${color}`) })),
		value: filters.color,
		apply: (next) => {
			filters.color = (MACARON_COLORS as readonly string[]).includes(next) ? (next as MacaronColor) : '';
		},
	});
	return rows;
}
