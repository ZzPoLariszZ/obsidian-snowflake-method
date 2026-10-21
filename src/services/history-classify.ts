import {
	FRONTMATTER_KEYS,
	HISTORY_STEPS,
	isDocumentType,
	kindIdFromFolderName,
	type HistoryNoteRef,
	type HistoryStep,
} from "../domain";
import {
	documentTypeOf,
	projectIdOf,
	type ManagedFrontmatter,
} from "../repository";
import { builtinRuleFor } from "./explorer-names";
import { PROJECT_PATH_LAYOUTS, type ProjectRef } from "./types";

/**
 * What a note is to the history, read off a version of it. The frontmatter
 * is the authority, as everywhere in the plugin: the version's own first,
 * then whatever the caller knows of the note now, and the folder only
 * where no frontmatter declares a type. Where the note is one the history
 * has nothing to say about -- the system folder, the tool chain, a
 * definition tree, another project's note -- the answer is null, and the
 * version is passed over.
 */

type Layouts = (typeof PROJECT_PATH_LAYOUTS)[keyof typeof PROJECT_PATH_LAYOUTS];

const LAYOUTS: readonly Layouts[] = Object.values(PROJECT_PATH_LAYOUTS);

const names = (pick: (layout: Layouts) => string): ReadonlySet<string> =>
	new Set(LAYOUTS.map(pick));

/** The first folder of each chain the history passes over, in both languages. */
const TOOL_ROOTS = names((layout) => layout.directories.writingSessions.split("/")[0] ?? "");
const SYSTEM_FOLDERS = names((layout) => layout.directories.system);
const DRAFT_FOLDERS = names((layout) => layout.directories.draft);
const CHARACTER_FOLDERS = names((layout) => layout.directories.characters);
const SCENE_FOLDERS = names((layout) => layout.directories.scenes);
const WORLDBUILDING_FOLDERS = names((layout) => layout.directories.worldbuilding);

/** The built-in kinds by their folder names in either language. */
const BUILTIN_KIND_FOLDERS: ReadonlyMap<string, string> = new Map(
	LAYOUTS.flatMap((layout) =>
		Object.entries(layout.worldbuildingKinds).map(
			([kind, folderName]) => [folderName, kind] as const,
		),
	),
);

/** The step a step note's document type stands for. */
const STEP_OF_TYPE: ReadonlyMap<string, HistoryStep> = new Map([
	["one-sentence-summary", HISTORY_STEPS[0]],
	["one-paragraph-summary", HISTORY_STEPS[1]],
	["plot-synopsis", HISTORY_STEPS[2]],
	["long-synopsis", HISTORY_STEPS[3]],
]);

/** The document types whose notes are the plugin's own, never the author's work. */
const PASSED_OVER_TYPES: ReadonlySet<string> = new Set([
	"project-metadata",
	"definition",
	"template",
	"sticky-note",
]);

export type HistoryProject = Pick<ProjectRef, "id" | "worldbuildingKinds">;

/**
 * The kind id a kind folder spells: the project's own registry first, then
 * the built-in folders of either language, then the folder name without
 * its prefix, which is what an authored kind's notes carry.
 */
function kindIdOfFolder(project: HistoryProject, folderName: string): string {
	const registered = project.worldbuildingKinds.find(
		(kind) => kind.folderName === folderName,
	);
	if (registered !== undefined) return registered.id;
	return BUILTIN_KIND_FOLDERS.get(folderName) ?? kindIdFromFolderName(folderName);
}

function worldbuildingRef(
	project: HistoryProject,
	path: string,
	segments: readonly string[],
	frontmatter: ManagedFrontmatter | null,
): HistoryNoteRef {
	const declared = frontmatter?.[FRONTMATTER_KEYS.worldbuildingKind];
	const wbKind =
		typeof declared === "string" && declared.length > 0
			? declared
			: WORLDBUILDING_FOLDERS.has(segments[0] ?? "") && segments.length >= 3
				? kindIdOfFolder(project, segments[1] ?? "")
				: undefined;
	return { path, kind: "worldbuilding", ...(wbKind === undefined ? {} : { wbKind }) };
}

/**
 * What a note at `path` under the project root is to the history, or null
 * where the history passes it over. `frontmatters` are read in order and
 * the first that declares a document type is the authority; the folder
 * answers only when none does.
 */
export function classifyHistoryPath(
	project: HistoryProject,
	path: string,
	frontmatters: readonly (ManagedFrontmatter | null)[],
): HistoryNoteRef | null {
	if (!path.toLowerCase().endsWith(".md")) return null;
	const segments = path.split("/");
	const head = segments[0] ?? "";
	if (TOOL_ROOTS.has(head) || SYSTEM_FOLDERS.has(head)) return null;
	// The definition trees under the entity folders hold the plugin's
	// vocabulary, not the author's notes; the explorer's rule knows them.
	const name = segments[segments.length - 1] ?? "";
	if (builtinRuleFor({ path, name, isFolder: false }, "") !== null) return null;

	const frontmatter =
		frontmatters.find((candidate) => candidate !== null && documentTypeOf(candidate) !== null) ??
		null;
	const type = frontmatter === null ? null : documentTypeOf(frontmatter);
	if (frontmatter !== null && type !== null) {
		const owner = projectIdOf(frontmatter);
		if (owner !== null && owner !== project.id) return null;
		if (PASSED_OVER_TYPES.has(type)) return null;
		if (type === "worldbuilding") {
			return {
				...worldbuildingRef(project, path, segments, frontmatter),
				documentType: "worldbuilding",
			};
		}
		if (type === "character") return { path, kind: "character", documentType: "character" };
		if (type === "scene") return { path, kind: "scene", documentType: "scene" };
		if (type === "draft") {
			// A draft note is the manuscript's where the manuscript is read
			// from; elsewhere in the project it is a note the author kept.
			return DRAFT_FOLDERS.has(head)
				? { path, kind: "manuscript", documentType: "draft" }
				: { path, kind: "other", documentType: "draft" };
		}
		const step = STEP_OF_TYPE.get(type);
		if (step !== undefined && isDocumentType(type)) {
			return { path, kind: "step", step, documentType: type };
		}
		return isDocumentType(type)
			? { path, kind: "other", documentType: type }
			: { path, kind: "other" };
	}

	if (DRAFT_FOLDERS.has(head)) return { path, kind: "manuscript" };
	if (CHARACTER_FOLDERS.has(head)) return { path, kind: "character" };
	if (SCENE_FOLDERS.has(head)) return { path, kind: "scene" };
	if (WORLDBUILDING_FOLDERS.has(head)) return worldbuildingRef(project, path, segments, null);
	return { path, kind: "other" };
}
