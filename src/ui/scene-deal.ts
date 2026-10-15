/**
 * The corkboard's own view, the scenes in narrative order: what the board
 * is dealt when nothing else is asked for, and what the timeline's and the
 * beat sheet's pools are dealt always. Everything here was once the board's
 * own plumbing; it stands apart so the board can be dealt another kind.
 */

import type { CorkboardControls } from './corkboard-bridge';
import type { CorkboardDeal } from './corkboard-deal';
import { CORKBOARD_PANED, CORKBOARD_REM, SCENE_DRAG_TYPE, groupValues } from './corkboard-layout';
import {
	SCENE_CARD_PART_CLASSES,
	createSceneCardDeck,
	type SceneCardExtras,
	type SceneCardPart,
} from './scene-card';
import {
	clearSceneFilters,
	filterScenes,
	reconcileSceneFilters,
	sceneFilterRows,
	sceneFiltered,
	sceneFilters,
	sceneHasNonRangeFilters,
	type SceneFilters,
} from './scene-filters';
import { CORKBOARD_GROUP_FIELDS, isCorkboardGroupField, type CorkboardGroupField } from './story-structure-state';
import type { ProjectDashboardModel, SceneViewModel } from './view-model';

const GROUP_LABEL_KEYS: Readonly<Record<CorkboardGroupField, string>> = {
	pov: 'table.scenePov',
	status: 'table.progressStatus',
	category: 'table.category',
	time: 'table.sceneTime',
	location: 'table.sceneLocation',
	character: 'table.sceneCharacters',
	color: 'stickyNotes.color',
	linked: 'table.sceneLinked',
};

/** What the scene funnel needs beyond the model: the category tree and the manuscript's notes. */
export interface SceneFilterExtra {
	categoryPaths: string[];
	manuscriptNotes: { path: string; title: string }[];
}

export type SceneDeal = CorkboardDeal<SceneViewModel, SceneCardExtras, SceneCardPart, SceneFilters, SceneFilterExtra>;

export function sceneDeal(controls: CorkboardControls<SceneFilters>): SceneDeal {
	const { app, host, t } = controls;
	let model: ProjectDashboardModel | null = null;
	let manuscriptPositions = new Map<string, number>();
	let resolvedManuscriptPaths = new Map<string, Map<string, string | null>>();
	let charactersByPath = new Map<string, ProjectDashboardModel['characters'][number]>();
	let scenesById = new Map<string, SceneViewModel>();
	let characterNames = new Map<string, string>();

	/** One resolution per target/source during a full paint, also shared with grouping. */
	const resolveManuscriptPath = (target: string, sourcePath: string): string | null => {
		let paths = resolvedManuscriptPaths.get(sourcePath);
		if (paths === undefined) {
			paths = new Map();
			resolvedManuscriptPaths.set(sourcePath, paths);
		}
		if (!paths.has(target)) paths.set(target, app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null);
		return paths.get(target) ?? null;
	};

	return {
		view: 'scene',
		dragType: SCENE_DRAG_TYPE,
		cardHeight: CORKBOARD_REM.cardHeight,
		paned: CORKBOARD_PANED,
		words: {
			search: t('table.searchScenes'),
			add: t('actions.addScene'),
			insertBefore: t('table.insertSceneBefore'),
			insertAfter: t('table.insertSceneAfter'),
			empty: t('scenes.empty'),
		},
		index: (next) => {
			if (next !== model) {
				manuscriptPositions = new Map(next?.manuscriptPaths.map((path, index) => [path, index]));
			}
			model = next;
			charactersByPath = new Map(next?.characters.map((character) => [character.path, character]) ?? []);
			characterNames = new Map(next?.characters.map((character) => [character.path, character.name]) ?? []);
			scenesById = new Map(next?.scenes.map((scene) => [scene.id, scene]) ?? []);
		},
		beginPaint: () => {
			// A refresh can follow metadata resolution even with the same model object.
			resolvedManuscriptPaths = new Map();
		},
		members: (current) => current.scenes,
		membersById: () => scenesById,
		name: (scene) => scene.title,
		filters: {
			make: sceneFilters,
			clear: clearSceneFilters,
			active: sceneFiltered,
			gapping: sceneHasNonRangeFilters,
			reconcile: reconcileSceneFilters,
			extra: async (current) => {
				const [categories, manuscripts] = await Promise.allSettled([
					host.listDefinitionPaths('scene', 'category', current.path),
					host.listManuscriptNotes(current.path),
				]);
				// Parent definitions remain useful filters even when scenes are filed
				// only under their descendants. Keep the known assignments if the tree
				// cannot be read, without losing the other filter options.
				const categoryPaths = categories.status === 'fulfilled' ? categories.value : [
					...new Set(current.scenes.flatMap((scene) => scene.categoryPaths)),
				].sort((a, b) => a.localeCompare(b, current.locale));
				const manuscriptNotes = manuscripts.status === 'fulfilled' ? manuscripts.value : [];
				return { categoryPaths, manuscriptNotes };
			},
			rows: (current, filters, extra) => sceneFilterRows(t, current, filters, extra),
		},
		shown: (members, query, filters) =>
			filterScenes(members, query, filters, { t, characterNames, resolveLink: resolveManuscriptPath })
				.map((entry) => ({ member: entry.scene, index: entry.index })),
		groupFields: CORKBOARD_GROUP_FIELDS,
		groupLabel: (field) => (isCorkboardGroupField(field) ? t(GROUP_LABEL_KEYS[field]) : field),
		groupValues: (scene, field, current) =>
			isCorkboardGroupField(field)
				? groupValues(scene, field, {
						t,
						characters: current.characters,
						locale: current.locale,
						resolveLink: resolveManuscriptPath,
					})
				: [],
		noneLabel: (field) => t(`corkboard.none.${field}`),
		deck: (deps) => createSceneCardDeck({
			...deps,
			host,
			model: () => model,
			charactersByPath: () => charactersByPath,
			scenesById: () => scenesById,
			manuscriptPositions: () => manuscriptPositions,
			resolveManuscriptPath,
		}),
		partClasses: SCENE_CARD_PART_CLASSES,
		reorder: (id, target, projectPath, adopt) => host.reorderScene(id, target, projectPath, adopt),
		openCreate: (afterIndex, projectPath, onSaved) => host.openSceneForm({ mode: 'create', afterIndex }, projectPath, onSaved),
		openEdit: (scene, projectPath, onSaved) => host.openSceneForm({ mode: 'edit', id: scene.id }, projectPath, onSaved),
		open: (scene) => host.openManagedFile(scene.path),
		delete: (scene, projectPath) => host.deleteScene(scene.id, scene.revision, projectPath),
	};
}
