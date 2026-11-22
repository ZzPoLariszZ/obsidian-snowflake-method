import {
	STEP_DEFINITIONS,
	STEP_SECTION_IDS,
	STEP_STATUSES,
	canSetStepStatus,
	getProgress,
	type EditableStepId,
	type StepId,
} from '../../src/domain';
import {
	PROJECT_DIRECTORY_KEYS,
	getProjectPathLayout,
	type ProjectRef,
	type ProjectSnapshot,
	type ProjectStructureIssue,
} from '../../src/services';
import { readMarkedSection } from '../../src/templates';
import type { JsonObject } from '../json';

/**
 * A project as the API tells it. What the services hold is told in the
 * contract's own words: a path is a path in the vault under one name
 * everywhere, a language is a language and not a locale, and nothing of how
 * the plugin keeps its own books (the fingerprints a review is told by, the
 * notes read to build the reading) is handed out.
 */

/** What each step produces, in words that are the same in every language. */
export const STEP_NAMES: Readonly<Record<StepId, string>> = {
	1: 'one-sentence-summary',
	2: 'one-paragraph-summary',
	3: 'character-sheets',
	4: 'plot-synopsis',
	5: 'character-synopses',
	6: 'long-synopsis',
	7: 'character-profiles',
	8: 'scene-list',
	9: 'scene-planning',
	10: 'manuscript',
};

/** Whether a step is one of the four written in a note of their own. */
export const isEditableStep = (step: number): step is EditableStepId => step in STEP_SECTION_IDS;

export interface ProjectStanding {
	/** It stands in the archive folder. */
	archived: boolean;
	/** The metadata note of the project the author last worked in, or null. */
	currentPath: string | null;
}

export function projectSummary(ref: ProjectRef, standing: ProjectStanding): JsonObject {
	return {
		id: ref.id,
		title: ref.title,
		language: ref.locale,
		path: ref.rootPath,
		metadataPath: ref.projectFile,
		series: ref.series === null ? null : { name: ref.series.name, book: ref.series.book },
		readOnly: ref.readOnly,
		archived: standing.archived,
		current: standing.currentPath !== null && standing.currentPath === ref.projectFile,
	};
}

export function stepOf(project: ProjectSnapshot, id: StepId): JsonObject {
	const definition = STEP_DEFINITIONS.find((entry) => entry.id === id);
	return {
		id,
		name: STEP_NAMES[id],
		status: project.steps[id],
		optional: definition?.optional === true,
		dependencies: [...(definition?.dependencies ?? [])],
		needsReview: project.needsReview.includes(id),
		textEditable: isEditableStep(id),
		// The manuscript has no one note. Where it begins is the nearest thing to it.
		path: id === 10 ? project.links.draft : isEditableStep(id) ? (project.artifacts[id]?.path ?? null) : null,
		allowedStatuses: STEP_STATUSES.filter((status) => canSetStepStatus(id, status)),
	};
}

export function stepsOf(project: ProjectSnapshot): JsonObject[] {
	return STEP_DEFINITIONS.map((definition) => stepOf(project, definition.id));
}

/** How many of a project's issues are damage, how many only tidying, and what that comes to. */
export function healthCounts(issues: readonly ProjectStructureIssue[]): JsonObject {
	const blocking = issues.filter((issue) => issue.blocking).length;
	const advisory = issues.length - blocking;
	return { status: blocking > 0 ? 'blocking' : advisory > 0 ? 'advisory' : 'ok', blocking, advisory };
}

/** Where each of the project's folders stands, under the names every language shares. */
function foldersOf(project: ProjectRef): JsonObject {
	const layout = getProjectPathLayout(project.locale);
	const folders: JsonObject = {};
	for (const key of PROJECT_DIRECTORY_KEYS) folders[key] = `${project.rootPath}/${layout.directories[key]}`;
	return folders;
}

export function projectOf(project: ProjectSnapshot, standing: ProjectStanding): JsonObject {
	return {
		...projectSummary(project, standing),
		// A note of the project a newer build wrote makes the whole of it read-only.
		readOnly: project.readOnly,
		schemaVersion: project.schemaVersion,
		steps: stepsOf(project),
		progress: { ...getProgress(project.steps) },
		counts: {
			characters: project.characters.length,
			scenes: project.scenes.length,
			entities: Object.values(project.worldbuilding).reduce((sum, bucket) => sum + bucket.length, 0),
		},
		manuscript: { firstNotePath: project.links.draft },
		health: healthCounts(project.structureIssues),
		folders: foldersOf(project),
	};
}

/**
 * What a step's own note says, section by section. Null where the note is
 * not there. A section whose markers are missing or broken reads as empty,
 * as it does in the dashboard, and the answer says the note is damaged.
 */
export function stepTextOf(project: ProjectSnapshot, step: EditableStepId): JsonObject | null {
	const artifact = project.artifacts[step];
	if (artifact === undefined) return null;
	const sections: JsonObject = {};
	let damaged = false;
	for (const id of STEP_SECTION_IDS[step]) {
		const text = readMarkedSection(artifact.content, id);
		if (text === null) damaged = true;
		sections[id] = text ?? '';
	}
	return {
		step,
		path: artifact.path,
		etag: artifact.revision,
		readOnly: artifact.readOnly || project.readOnly,
		damaged,
		sections,
	};
}

function issueOf(issue: ProjectStructureIssue): JsonObject {
	const told: JsonObject = {
		code: issue.code,
		path: issue.path,
		steps: [...issue.stepIds],
		blocking: issue.blocking,
		repairable: issue.repairable,
	};
	if (issue.field !== undefined) told['field'] = issue.field;
	if (issue.expected !== undefined) told['expected'] = issue.expected;
	if (issue.names !== undefined) told['names'] = [...issue.names];
	return told;
}

export function healthOf(project: ProjectSnapshot, outdatedNotes: number): JsonObject {
	return {
		status: healthCounts(project.structureIssues)['status'] ?? 'ok',
		readOnly: project.readOnly,
		outdatedNotes,
		issues: project.structureIssues.map(issueOf),
	};
}
