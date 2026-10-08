/**
 * What the file explorer shows a Snowflake project as, when asked to tidy
 * it: the ordering prefixes the layout wears taken off the names, and the
 * entries the plugin keeps for itself left out. Nothing here touches a file;
 * the names on disk stay as they are, and the rename box shows them.
 */

import { DEFINITION_FILE_IDS, type ProjectLanguage } from "../domain";
import {
	customFieldRootNameForFolder,
	definitionRootNameForFolder,
} from "./definition-files";
import { isStickyNotePath } from "./sticky-note-service";
import { PROJECT_PATH_LAYOUTS, type ProjectPathLayout } from "./types";

export const EXPLORER_SCOPES = ["projects", "vault"] as const;
export type ExplorerScope = (typeof EXPLORER_SCOPES)[number];

export function isExplorerScope(value: unknown): value is ExplorerScope {
	return (EXPLORER_SCOPES as readonly unknown[]).includes(value);
}

/**
 * The ordering prefix the layout writes and nothing wider: two or three
 * digits (`00_`, `001_`, `621_`), one digit (`1_`), or a digit, a letter
 * and perhaps a digit (`6A_`, `6A1_`). Four digits are a year, as in a
 * session file's name, and stay.
 */
export const ORDERING_PREFIX = /^(?:\d{1,3}|\d[A-Za-z]\d?)_/u;

/** The name without its ordering prefix, or as it is when nothing would be left. */
export function displayNameOf(name: string, hidePrefix: boolean): string {
	if (!hidePrefix) return name;
	const stripped = name.replace(ORDERING_PREFIX, "");
	return stripped.length === 0 ? name : stripped;
}

export interface ExplorerEntry {
	path: string;
	/** The whole name, extension and all. */
	name: string;
	isFolder: boolean;
}

/** Which built-in rule claims an entry: a plugin folder, or a plugin file. */
export type BuiltinExplorerRule = "folder" | "file";

type LayoutEntry = readonly [ProjectLanguage, ProjectPathLayout];

const LAYOUTS = Object.entries(PROJECT_PATH_LAYOUTS) as LayoutEntry[];

function toolRootOf(layout: ProjectPathLayout): string {
	return layout.directories.tasks.split("/")[0] ?? "";
}

/** Whether `name` is a tree root the kind folder implies, custom kinds included. */
function isDefinitionRoot(kindFolder: string, name: string, language: ProjectLanguage): boolean {
	return (
		DEFINITION_FILE_IDS.some(
			(id) => definitionRootNameForFolder(kindFolder, id, language) === name,
		) || customFieldRootNameForFolder(kindFolder, language) === name
	);
}

function relativeToRoot(path: string, root: string): string | null {
	if (root.length === 0) return path;
	if (path === root) return "";
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

/**
 * The built-in rule an entry falls under inside its project, or null for
 * the author's own: the system folder and all it holds, the definition
 * trees under the character, scene and worldbuilding kind folders, and
 * under the tool folder every JSON file and every sticky note. Both
 * layouts are read, since a project may be opened under either language.
 */
export function builtinRuleFor(
	entry: ExplorerEntry,
	projectRoot: string | null,
): BuiltinExplorerRule | null {
	if (projectRoot === null) return null;
	const relative = relativeToRoot(entry.path, projectRoot);
	if (relative === null || relative.length === 0) return null;
	const segments = relative.split("/");
	const head = segments[0] ?? "";
	for (const [language, layout] of LAYOUTS) {
		const directories = layout.directories;
		if (head === directories.system) return "folder";
		if (
			(head === directories.characters || head === directories.scenes) &&
			segments.length >= 2 &&
			isDefinitionRoot(head, segments[1] ?? "", language)
		) {
			return "folder";
		}
		if (
			head === directories.worldbuilding &&
			segments.length >= 3 &&
			isDefinitionRoot(segments[1] ?? "", segments[2] ?? "", language)
		) {
			return "folder";
		}
		if (head === toolRootOf(layout) && !entry.isFolder) {
			if (entry.name.toLowerCase().endsWith(".json")) return "file";
			if (isStickyNotePath(entry.path)) return "file";
		}
	}
	return null;
}

export interface HiddenPattern {
	/** The line as the author wrote it. */
	source: string;
	/** A line with a slash names a place; one without names every entry of that name. */
	byPath: boolean;
	test: RegExp;
}

function escapeForRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The author's own list, one entry per line. A name hides every entry of
 * that name; a path hides the entry at that place, or at that place inside
 * any folder, so `20_Character/21_Category` reaches every project. `*`
 * stands for any run of characters short of a slash. Lines that could not
 * name an entry are ignored.
 */
export function compileHiddenList(text: string): HiddenPattern[] {
	const patterns: HiddenPattern[] = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim().replace(/^\/+/u, "").replace(/\/+$/u, "");
		if (line.length === 0 || line.includes("\\")) continue;
		const segments = line.split("/");
		if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
			continue;
		}
		const byPath = segments.length > 1;
		const body = line.split("*").map(escapeForRegExp).join("[^/]*");
		patterns.push({
			source: line,
			byPath,
			test: new RegExp(`${byPath ? "(?:^|/)" : "^"}${body}$`, "iu"),
		});
	}
	return patterns;
}

export function matchesHiddenPattern(pattern: HiddenPattern, entry: ExplorerEntry): boolean {
	return pattern.byPath ? pattern.test.test(entry.path) : pattern.test.test(entry.name);
}

export interface ExplorerRules {
	hidePrefix: boolean;
	hideFiles: boolean;
	hideFolders: boolean;
	hiddenFiles: readonly HiddenPattern[];
	hiddenFolders: readonly HiddenPattern[];
}

/**
 * Whether the tidy view leaves an entry out. The built-in rules speak only
 * inside a project; the author's lists speak everywhere; and a folder that
 * holds entries and shows none of them is left out with them, so a folder
 * of records does not stand there empty, while a folder that is simply
 * empty stays, since it is somewhere to put things. `memo` carries the
 * answers of one pass, as every parent asks after all its children.
 */
export function isHiddenEntry(
	entry: ExplorerEntry,
	projectRoot: string | null,
	rules: ExplorerRules,
	childrenOf: (folderPath: string) => readonly ExplorerEntry[],
	memo: Map<string, boolean> = new Map(),
): boolean {
	const kept = memo.get(entry.path);
	if (kept !== undefined) return kept;
	memo.set(entry.path, false);
	const hidden = decideHidden(entry, projectRoot, rules, childrenOf, memo);
	memo.set(entry.path, hidden);
	return hidden;
}

function decideHidden(
	entry: ExplorerEntry,
	projectRoot: string | null,
	rules: ExplorerRules,
	childrenOf: (folderPath: string) => readonly ExplorerEntry[],
	memo: Map<string, boolean>,
): boolean {
	const builtin = builtinRuleFor(entry, projectRoot);
	if (builtin === "folder" && rules.hideFolders) return true;
	if (builtin === "file" && rules.hideFiles) return true;
	const patterns = entry.isFolder
		? rules.hideFolders
			? rules.hiddenFolders
			: []
		: rules.hideFiles
			? rules.hiddenFiles
			: [];
	if (patterns.some((pattern) => matchesHiddenPattern(pattern, entry))) return true;
	if (!entry.isFolder || !rules.hideFolders) return false;
	const children = childrenOf(entry.path);
	return (
		children.length > 0 &&
		children.every((child) => isHiddenEntry(child, projectRoot, rules, childrenOf, memo))
	);
}
