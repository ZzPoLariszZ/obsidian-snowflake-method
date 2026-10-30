/**
 * The questions the revision and foreshadowing tables ask in the funnel,
 * written once: the dashboard's two tabs ask them of their rows, and the
 * margin cards sidebar asks them of its cards under the kind it is showing.
 * Each row reads its answer from, and writes it back to, the memory the
 * asker keeps.
 */

import { FORESHADOWING_STATUSES, OCCURRENCE_ROLES, REVISION_KINDS } from '../domain';
import type { FilterRow } from './filter-rows';
import type { Translate } from './modals';

/** The revision table's two questions: the kind to keep, and whether to keep only conflicts. */
export function revisionFilterRows(
	t: Translate,
	filters: { kind: string; standing: string },
): FilterRow[] {
	return [
		{
			label: t('revisionTable.type'),
			placeholder: t('revisionTable.filterAllTypes'),
			empty: '',
			options: () =>
				REVISION_KINDS.map((kind) => ({
					value: kind,
					label: t(`manuscript.revision.kind.${kind}`),
				})),
			value: filters.kind,
			apply: (value) => {
				filters.kind = value;
			},
		},
		{
			label: t('revisionTable.standing'),
			placeholder: t('revisionTable.filterAllStandings'),
			empty: '',
			options: () => [{ value: 'conflict', label: t('revisionTable.conflictOnly') }],
			value: filters.standing,
			apply: (value) => {
				filters.standing = value;
			},
		},
	];
}

/** The foreshadowing table's three: the thread's status, the occurrence's role, and whether to keep only unresolved places. */
export function foreshadowingFilterRows(
	t: Translate,
	filters: { status: string; role: string; standing: string },
): FilterRow[] {
	return [
		{
			label: t('status.label'),
			placeholder: t('foreshadowingTable.filterAllStatuses'),
			empty: '',
			options: () =>
				FORESHADOWING_STATUSES.map((status) => ({
					value: status,
					label: t(`foreshadowing.status.${status}`),
				})),
			value: filters.status,
			apply: (value) => {
				filters.status = value;
			},
		},
		{
			label: t('foreshadowingTable.role'),
			placeholder: t('foreshadowingTable.filterAllRoles'),
			empty: '',
			options: () =>
				OCCURRENCE_ROLES.map((role) => ({
					value: role,
					label: t(`foreshadowing.role.${role}`),
				})),
			value: filters.role,
			apply: (value) => {
				filters.role = value;
			},
		},
		{
			label: t('foreshadowingTable.standing'),
			placeholder: t('foreshadowingTable.filterAllStandings'),
			empty: '',
			options: () => [{ value: 'unresolved', label: t('foreshadowingTable.unresolvedOnly') }],
			value: filters.standing,
			apply: (value) => {
				filters.standing = value;
			},
		},
	];
}
