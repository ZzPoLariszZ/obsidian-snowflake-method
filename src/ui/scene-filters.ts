/**
 * How a scene table or board narrows its scenes: the funnel's questions and
 * the search, asked of a scene's view model. Written once here and read by
 * the dashboard's scene table and the corkboard alike, so the two
 * answer the same query the same way.
 */

import {
	MACARON_COLORS,
	PROGRESS_STATUSES,
	SCENE_POV_MULTIPLE,
	SCENE_POV_OMNISCIENT,
	isProgressStatus,
	type MacaronColor,
	type ProgressStatus,
} from '../domain';
import { memberMatches } from './dashboard-state';
import type { FilterRow } from './filter-rows';
import type { Translate } from './modals';
import type { PickerOption } from './option-picker';
import type { SceneViewModel } from './view-model';

/** The funnel's answers. '' and 'all' mean the question is not being asked. */
export interface SceneFilters {
	status: 'all' | ProgressStatus;
	/** A category path, whose subtree counts as filed under it. */
	category: string;
	/** A character path, a point-of-view mode, or '' for every scene. */
	pov: string;
	/** A time or location by the name it is shown under. */
	time: string;
	location: string;
	/** A character path the scene must have in its cast. */
	character: string;
	color: '' | MacaronColor;
	/** A manuscript note's path without its extension, as a link names it. */
	linked: string;
}

/** What the rows need of the model: the cast, and the time and place notes. */
export interface SceneFilterModel {
	characters: readonly { path: string; name: string }[];
	worldbuilding: Partial<Record<string, readonly { name: string }[]>>;
}

export function sceneFilters(): SceneFilters {
	return {
		status: 'all',
		category: '',
		pov: '',
		time: '',
		location: '',
		character: '',
		color: '',
		linked: '',
	};
}

/** True when any of the funnel's questions is being asked. */
export function sceneFiltered(filters: SceneFilters): boolean {
	return (
		filters.status !== 'all' ||
		filters.category !== '' ||
		filters.pov !== '' ||
		filters.time !== '' ||
		filters.location !== '' ||
		filters.character !== '' ||
		filters.color !== '' ||
		filters.linked !== ''
	);
}

/** Every question back to unasked, in place, as the table keeps them. */
export function clearSceneFilters(filters: SceneFilters): void {
	Object.assign(filters, sceneFilters());
}

/**
 * Whether a category path sits at or below the one a filter names, so
 * filtering by `Race` keeps the characters filed under `Race/Elf`. A level
 * nobody is filed under directly is still a real thing to ask about, which is
 * why the whole tree is on offer.
 */
export function categoryWithin(path: string, filter: string): boolean {
	return path === filter || path.startsWith(`${filter}/`);
}

/** What a stored term reads as: a link's display name, or the text itself. */
export function termName(raw: string): string {
	const trimmed = raw.trim();
	const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u.exec(trimmed);
	if (match === null) return trimmed;
	const alias = (match[2] ?? '').trim();
	if (alias.length > 0) return alias;
	const path = (match[1] ?? '').trim();
	return path.split('/').pop() ?? path;
}

/**
 * Whether a link's target names the note at a path: the whole path, or the
 * shortest tail of it, which is how Obsidian writes a link when it can.
 */
export function linkNamesNote(target: string, notePath: string): boolean {
	const note = notePath.replace(/\.md$/u, '');
	const named = target.trim().replace(/\.md$/u, '');
	return named.length > 0 && (note === named || note.endsWith(`/${named}`));
}

/** The scenes the questions and the search keep, each with its place in the list. */
export function filterScenes(
	scenes: readonly SceneViewModel[],
	query: string,
	filters: SceneFilters,
	context: { t: Translate; characterNames: ReadonlyMap<string, string> },
): { scene: SceneViewModel; index: number }[] {
	// The stored value is a link or the words themselves; either way the
	// name is what the table shows and what the filter names.
	const holds = (values: readonly string[], wanted: string): boolean =>
		values.some((value) => termName(value) === wanted);
	return scenes
		.map((scene, index) => ({ scene, index }))
		.filter(
			({ scene }) =>
				(filters.pov === '' || scene.povPath === filters.pov) &&
				(filters.status === 'all' ||
					scene.progressStatus === filters.status) &&
				(filters.category === '' ||
					scene.categoryPaths.some((path) =>
						categoryWithin(path, filters.category),
					)) &&
				(filters.time === '' || holds(scene.times, filters.time)) &&
				(filters.location === '' ||
					holds(scene.locations, filters.location)) &&
				(filters.character === '' ||
					scene.characterPaths.includes(filters.character)) &&
				(filters.color === '' || scene.color === filters.color) &&
				(filters.linked === '' ||
					scene.linkedManuscript.some((link) =>
						linkNamesNote(link.target, filters.linked),
					)) &&
				memberMatches(
					[
						scene.title,
						...scene.aliases,
						...scene.categoryPaths,
						scene.povName,
						...scene.times.map(termName),
						...scene.locations.map(termName),
						scene.conflict,
						...(scene.progressStatus === null
							? []
							: [context.t(`status.${scene.progressStatus}`)]),
						...scene.characterPaths.map(
							(path) => context.characterNames.get(path) ?? '',
						),
						...scene.linkedManuscript.map((link) => link.label),
					],
					query,
				),
		);
}

/** The progress row every member table's funnel opens with. */
export function progressFilterRow(
	t: Translate,
	value: 'all' | ProgressStatus,
	apply: (next: 'all' | ProgressStatus) => void,
): FilterRow {
	return {
		label: t('table.progressStatus'),
		placeholder: t('table.filterAllStatuses'),
		empty: 'all',
		options: () =>
			PROGRESS_STATUSES.map((status) => ({
				value: status,
				label: t(`status.${status}`),
			})),
		value,
		apply: (next) => {
			apply(isProgressStatus(next) ? next : 'all');
		},
	};
}

/** The category row, over one kind's whole tree. */
export function categoryFilterRow(
	t: Translate,
	paths: readonly string[],
	value: string,
	apply: (next: string) => void,
): FilterRow {
	return {
		label: t('table.category'),
		placeholder: t('table.filterAllCategories'),
		empty: '',
		options: () => paths.map((path) => ({ value: path, label: path })),
		value,
		apply,
	};
}

/**
 * Everything a scene can be narrowed by. The notes it names are offered
 * whole, not only the ones some scene already points at: a filter is asked
 * before the answer is known.
 */
export function sceneFilterRows(
	t: Translate,
	model: SceneFilterModel,
	filters: SceneFilters,
	extra: {
		categoryPaths: readonly string[];
		manuscriptNotes: readonly { path: string; title: string }[];
	},
): FilterRow[] {
	const named = (entities: readonly { name: string }[]): PickerOption[] =>
		entities
			.map((entity) => ({ value: entity.name, label: entity.name }))
			.filter((option) => option.value.length > 0);
	const ofKind = (kind: 'time' | 'location'): readonly { name: string }[] =>
		model.worldbuilding[kind] ?? [];
	return [
		progressFilterRow(t, filters.status, (next) => {
			filters.status = next;
		}),
		categoryFilterRow(t, extra.categoryPaths, filters.category, (next) => {
			filters.category = next;
		}),
		{
			label: t('table.scenePov'),
			placeholder: t('table.filterAllPov'),
			empty: '',
			options: () => [
				{ value: SCENE_POV_OMNISCIENT, label: t('modal.scene.povOmniscient') },
				{ value: SCENE_POV_MULTIPLE, label: t('modal.scene.povMultiple') },
				...model.characters.map((character) => ({
					value: character.path,
					label: character.name,
				})),
			],
			value: filters.pov,
			apply: (next) => {
				filters.pov = next;
			},
		},
		{
			label: t('table.sceneTime'),
			placeholder: t('table.filterAllTimes'),
			empty: '',
			options: () => named(ofKind('time')),
			value: filters.time,
			apply: (next) => {
				filters.time = next;
			},
		},
		{
			label: t('table.sceneLocation'),
			placeholder: t('table.filterAllLocations'),
			empty: '',
			options: () => named(ofKind('location')),
			value: filters.location,
			apply: (next) => {
				filters.location = next;
			},
		},
		{
			label: t('table.sceneCharacters'),
			placeholder: t('table.filterAllCast'),
			empty: '',
			options: () =>
				model.characters.map((character) => ({
					value: character.path,
					label: character.name,
				})),
			value: filters.character,
			apply: (next) => {
				filters.character = next;
			},
		},
		{
			label: t('table.sceneColor'),
			presentation: 'color-swatches',
			placeholder: t('table.filterAllColors'),
			empty: '',
			options: () =>
				MACARON_COLORS.map((color) => ({
					value: color,
					label: t(`stickyNotes.color.${color}`),
				})),
			value: filters.color,
			apply: (next) => {
				filters.color = (MACARON_COLORS as readonly string[]).includes(next)
					? (next as MacaronColor)
					: '';
			},
		},
		{
			label: t('table.sceneLinked'),
			placeholder: t('table.filterAllLinked'),
			empty: '',
			options: () =>
				extra.manuscriptNotes.map((note) => ({
					value: note.path.replace(/\.md$/u, ''),
					label: note.title,
				})),
			value: filters.linked,
			apply: (next) => {
				filters.linked = next;
			},
		},
	];
}
