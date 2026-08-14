import {
  DEFINITION_FILE_IDS,
  DEFINITION_NODE_BASENAME,
  foldName,
  safeFileName,
  type CharacterType,
  type DefinitionFileId,
  type EntityKind,
  type ProjectLanguage,
} from "../domain";
import { entityKindFolder, getProjectPathLayout } from "./types";

/**
 * Definition trees are the project's taxonomies: folder hierarchies whose
 * folders are the vocabulary. Each entity kind owns its own set, rooted in
 * the folder its notes live in, so a vocabulary is scoped to the kind that
 * uses it. A node exists because its folder does, `Race/Elf` is the folder
 * chain below the root, and every node holds a `_self.md` where its
 * description and anything a later release attaches live. Frontmatter and
 * record lines point at a node through that note,
 * `[[…/21_Category/Race/Elf/_self|Race/Elf]]`: the target carries identity,
 * the alias shows the taxonomy path, and Obsidian resolves the full path, so
 * two parents may both hold an `Elf` and a folder rename walks through every
 * link on its own. The alias a rename leaves behind is display cache, stale
 * until the health checker rewrites it.
 *
 * The trees are deliberately ordinary folders. Users extend them in the file
 * explorer or through the pickers, and the plugin's only insistence is
 * materialization: every node folder gets its `_self.md`, made at creation,
 * by the vault watcher, or by the health checker's repair.
 */

/**
 * How many levels a path may have, for reading and managing alike: the
 * pickers refuse a deeper path and the walk that lists a tree stops here.
 * Folders could nest forever, but a taxonomy nobody can read to the bottom
 * of is not a vocabulary any more.
 */
export const MAX_DEFINITION_DEPTH = 7;

export type AppendPathResult =
  | { ok: true; createdPaths: string[] }
  | { ok: false; code: "invalid-segment" | "too-deep"; segment: string };

/**
 * What renaming a node came to: the path it now spells, or the refusal to
 * show — a name the file system will not take, or a sibling already
 * answering to it under fold.
 */
export type RenamePathResult =
  | { ok: true; taxonomyPath: string }
  | { ok: false; code: "invalid-segment" | "taken"; segment: string };

/**
 * A name a node folder can actually be given: what the file system accepts
 * unchanged, nothing hidden behind a leading dot, and never the node file's
 * own name.
 */
export function isValidDefinitionSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (trimmed.length === 0 || trimmed.startsWith(".")) return false;
  if (foldName(trimmed) === foldName(DEFINITION_NODE_BASENAME)) return false;
  try {
    return safeFileName(trimmed) === trimmed;
  } catch {
    return false;
  }
}

export type DefinitionPathCheck =
  | { ok: true; segments: string[] }
  | { ok: false; code: "invalid-segment" | "too-deep"; segment: string };

/** A typed path split into the segments to ensure, or the refusal to show. */
export function checkDefinitionPath(path: string): DefinitionPathCheck {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { ok: false, code: "invalid-segment", segment: path };
  }
  if (segments.length > MAX_DEFINITION_DEPTH) {
    return { ok: false, code: "too-deep", segment: path };
  }
  for (const segment of segments) {
    if (!isValidDefinitionSegment(segment)) {
      return { ok: false, code: "invalid-segment", segment };
    }
  }
  return { ok: true, segments };
}

/** The vault path of a node's `_self` note, without its extension. */
export function nodeSelfPath(rootPath: string, taxonomyPath: string): string {
  return `${rootPath}/${taxonomyPath}/${DEFINITION_NODE_BASENAME}`;
}

/**
 * The link a note stores for a node: the `_self` target that carries
 * identity, and the taxonomy path as the alias every reader sees.
 */
export function nodeLink(rootPath: string, taxonomyPath: string): string {
  const alias = taxonomyPath.replace(/[|\]]/gu, "").trim();
  return `[[${nodeSelfPath(rootPath, taxonomyPath)}|${alias}]]`;
}

/**
 * The taxonomy path a target names below a root: the segments between the
 * two, with the node file stripped off the end. Null when the target is not
 * under the root, which is what makes the caller fall back to the alias.
 */
export function taxonomyPathFromTarget(
  target: string,
  rootPath: string,
): string | null {
  const cleaned = target.trim().replace(/\.md$/u, "");
  const prefix = `${rootPath.trim().replace(/\/+$/u, "")}/`;
  if (!cleaned.startsWith(prefix)) return null;
  const segments = cleaned
    .slice(prefix.length)
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments[segments.length - 1] === DEFINITION_NODE_BASENAME) {
    segments.pop();
  }
  return segments.length === 0 ? null : segments.join("/");
}

/** A stored definition value taken apart, whichever era wrote it. */
export interface DefinitionValue {
  /** The link target, `.md` never included; the heading split off when legacy. */
  target: string;
  alias: string | null;
  /** The heading of a legacy `[[file#heading|alias]]` link, else null. */
  legacyHeading: string | null;
}

const DEFINITION_VALUE_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u;

export function parseDefinitionValue(value: unknown): DefinitionValue | null {
  if (typeof value !== "string") return null;
  const match = DEFINITION_VALUE_PATTERN.exec(value.trim());
  if (match === null) return null;
  const raw = (match[1] ?? "").trim();
  const alias = match[2] === undefined ? null : match[2].trim();
  const hash = raw.indexOf("#");
  if (hash < 0) {
    return { target: raw.replace(/\.md$/u, ""), alias, legacyHeading: null };
  }
  return {
    target: raw.slice(0, hash).trim().replace(/\.md$/u, ""),
    alias,
    legacyHeading: raw.slice(hash + 1).trim(),
  };
}

/**
 * The taxonomy path a stored value should be read as. The target is the
 * source of truth, so it is asked first; the alias answers for a target the
 * root cannot explain, and a legacy heading link answers with the alias it
 * always carried.
 */
export function taxonomyPathFromValue(
  value: unknown,
  rootPath: string,
): string | null {
  const link = parseDefinitionValue(value);
  if (link === null) return null;
  if (link.legacyHeading !== null) {
    return link.alias !== null && link.alias.length > 0
      ? link.alias
      : link.legacyHeading;
  }
  const derived = taxonomyPathFromTarget(link.target, rootPath);
  if (derived !== null) return derived;
  return link.alias !== null && link.alias.length > 0 ? link.alias : null;
}

/**
 * The name of the node a stored value points at: the target's last folder,
 * or the heading a legacy link named. This is the piece role detection
 * matches, so it must read both eras.
 */
export function nodeNameFromValue(value: unknown): string | null {
  const link = parseDefinitionValue(value);
  if (link === null) return null;
  if (link.legacyHeading !== null) return link.legacyHeading;
  const segments = link.target
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const last = segments.pop();
  if (last === undefined) return null;
  if (foldName(last) !== foldName(DEFINITION_NODE_BASENAME)) return last;
  return segments.pop() ?? null;
}

/**
 * The tree root a stored value points into: a legacy link's file is the very
 * folder the tree now stands at, and a node link's root is what is left when
 * the node's own folder and file come off the end.
 */
export function definitionRootFromValue(value: unknown): string | null {
  const link = parseDefinitionValue(value);
  if (link === null) return null;
  if (link.legacyHeading !== null) return link.target;
  const segments = link.target.split("/").filter((segment) => segment.length > 0);
  if (segments[segments.length - 1] === DEFINITION_NODE_BASENAME) {
    segments.pop();
  }
  segments.pop();
  return segments.length === 0 ? null : segments.join("/");
}

interface DefinitionCopy {
  /** Root folder names without their number, which the kind's folder decides. */
  fileStems: Record<DefinitionFileId, string>;
  roles: Record<CharacterType, string>;
  worldStatusStarters: string[];
  relationshipStarters: string[];
}

const COPY: Record<ProjectLanguage, DefinitionCopy> = {
  en: {
    fileStems: {
      category: "Category",
      "world-status": "World_Status",
      relationship: "Relationship",
    },
    roles: { major: "Major", supporting: "Supporting", minor: "Minor" },
    worldStatusStarters: ["Injured", "Missing", "Deceased"],
    relationshipStarters: ["Ally", "Enemy", "Friend", "Family", "Member"],
  },
  "zh-CN": {
    fileStems: {
      category: "类别",
      "world-status": "状态",
      relationship: "关系",
    },
    roles: { major: "主角", supporting: "配角", minor: "次要角色" },
    worldStatusStarters: ["受伤", "失踪", "已故"],
    relationshipStarters: ["盟友", "敌人", "朋友", "家人", "成员"],
  },
};

/**
 * A definition root is numbered after the folder it sits in, the way
 * `10_Summary` holds `11_One_Sentence_Summary.md`: the folder's number gives
 * up its trailing zero to the root's position, and where there is no zero to
 * give up the position is appended instead. Characters get 21/22/23 inside
 * `20_Character`, locations 621/622/623 inside `62_Location`, so the three
 * trees sort together above the notes they classify.
 */
function definitionFileNumber(
  kind: EntityKind,
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  const folder = entityKindFolder(getProjectPathLayout(language), kind);
  const leaf = folder.slice(folder.lastIndexOf("/") + 1);
  const folderNumber = /^\d+/u.exec(leaf)?.[0] ?? "";
  const position = DEFINITION_FILE_IDS.indexOf(id) + 1;
  if (folderNumber.length === 0) return "";
  return folderNumber.endsWith("0")
    ? `${folderNumber.slice(0, -1)}${position}`
    : `${folderNumber}${position}`;
}

/** The name of a kind's tree root folder, `21_Category` or `621_类别`. */
export function definitionRootName(
  kind: EntityKind,
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  const stem = COPY[language].fileStems[id];
  const number = definitionFileNumber(kind, id, language);
  return number.length === 0 ? stem : `${number}_${stem}`;
}

/**
 * The node names a character tree starts with: the vocabulary the plugin
 * itself depends on or has always suggested. Every other kind starts empty,
 * because its vocabulary is the author's to invent.
 */
export function characterStarterNames(
  language: ProjectLanguage,
  id: DefinitionFileId,
): string[] {
  const copy = COPY[language];
  if (id === "category") {
    return (["major", "supporting", "minor"] as const).map(
      (role) => copy.roles[role],
    );
  }
  return id === "world-status"
    ? [...copy.worldStatusStarters]
    : [...copy.relationshipStarters];
}

/**
 * The seeded role node for a character type, `Major` or `主角`. Seeded at the
 * root of the character category tree, so this is also the role's whole path.
 */
export function characterRoleName(
  language: ProjectLanguage,
  type: CharacterType,
): string {
  return COPY[language].roles[type];
}

/**
 * The character type a node name names, in either language. Both languages
 * are consulted because a project's language can change while its notes keep
 * the links they were written with.
 */
export function characterTypeFromNodeName(
  name: string,
): CharacterType | null {
  for (const language of ["en", "zh-CN"] as const) {
    const roles = COPY[language].roles;
    for (const type of ["major", "supporting", "minor"] as const) {
      if (name === roles[type]) return type;
    }
  }
  return null;
}

/**
 * The role a single stored category link names -- and only at the root of
 * the category tree, where the roles are seeded. An author is free to name a
 * deeper node after a role, `Houses/Major`, and that is an ordinary category:
 * reading it as the role would make the dashboard disagree with the generated
 * base, and the migration mistake it for a converted role.
 */
export function characterRoleFromValue(value: unknown): CharacterType | null {
  const link = parseDefinitionValue(value);
  if (link === null) return null;
  if (link.legacyHeading !== null) {
    const type = characterTypeFromNodeName(link.legacyHeading);
    if (type === null) return null;
    // A legacy link's alias is the taxonomy path it always carried: a path
    // with a parent in it is a nested node, not a root role.
    const alias = link.alias ?? "";
    return alias.includes("/") ? null : type;
  }
  const segments = link.target
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  if (last !== undefined && foldName(last) === foldName(DEFINITION_NODE_BASENAME)) {
    segments.pop();
  }
  const name = segments.pop();
  if (name === undefined) return null;
  const type = characterTypeFromNodeName(name);
  if (type === null) return null;
  // The folder above a root node is the tree root itself. A target too short
  // to say -- a hand-typed link relative to the root -- is given the benefit
  // of the doubt, the way every link was before nodes had depth.
  const parent = segments.pop();
  return parent === undefined || isCategoryRootName(parent) ? type : null;
}

/** Whether a folder name is a character category tree root, either language. */
function isCategoryRootName(name: string): boolean {
  for (const language of ["en", "zh-CN"] as const) {
    if (name === definitionRootName("character", "category", language)) {
      return true;
    }
  }
  return false;
}

/**
 * Reads a character's role out of its category links: the first link naming
 * a seeded role node at the tree root decides, whichever era wrote the link.
 */
export function characterRoleFromCategories(
  values: unknown,
): CharacterType | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    const type = characterRoleFromValue(value);
    if (type !== null) return type;
  }
  return null;
}

/*
 * The legacy corner. Before nodes were folders a tree was a heading tree
 * inside one file per kind and id, `20_Character/21_Category.md`, and links
 * anchored a heading: `[[…/21_Category#Elf|Race/Elf]]`. Nothing below is
 * written any more; the migration still reads it to raise the folders, adopt
 * the prose, and retire the file.
 */

/** The file a kind's taxonomy lived in before it became a folder tree. */
export function legacyDefinitionFileName(
  kind: EntityKind,
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  return `${definitionRootName(kind, id, language)}.md`;
}

export interface DefinitionEntry {
  /** The heading text, which was the link anchor. */
  heading: string;
  /** The full slash path from the root heading. */
  path: string;
  /** Heading level, which is also the path depth. */
  level: number;
  /** Zero-based line the heading sits on. */
  line: number;
}

export interface DefinitionTree {
  entries: DefinitionEntry[];
  /** Heading texts that appear more than once, in first-seen order. */
  duplicates: string[];
}

export function parseDefinitionFile(content: string): DefinitionTree {
  const entries: DefinitionEntry[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const stack: Array<{ level: number; heading: string }> = [];
  let inFence = false;
  const lines = content.split(/\r\n|\r|\n/u);
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line] ?? "";
    if (/^\s*(```|~~~)/u.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*\S)\s*$/u.exec(text);
    if (match === null) continue;
    const level = (match[1] ?? "#").length;
    const heading = (match[2] ?? "").trim();
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as (typeof stack)[number];
      if (top.level >= level) stack.pop();
      else break;
    }
    const path = [...stack.map((frame) => frame.heading), heading].join("/");
    stack.push({ level, heading });
    entries.push({ heading, path, level, line });
    const count = seen.get(heading) ?? 0;
    seen.set(heading, count + 1);
    if (count === 1) duplicates.push(heading);
  }
  return { entries, duplicates };
}

/**
 * The prose a legacy file kept under each heading, by path: what belongs in
 * each node's `_self.md` once the folders stand. The text above the first
 * heading was the file's intro line and stays behind, because it described
 * the mechanism this file no longer is.
 */
export function definitionProseByPath(content: string): Map<string, string> {
  const tree = parseDefinitionFile(content);
  const lines = content.split(/\r\n|\r|\n/u);
  const prose = new Map<string, string>();
  for (let index = 0; index < tree.entries.length; index += 1) {
    const entry = tree.entries[index] as DefinitionEntry;
    const from = entry.line + 1;
    const to = tree.entries[index + 1]?.line ?? lines.length;
    const body = lines.slice(from, to).join("\n").trim();
    if (body.length > 0) prose.set(entry.path, body);
  }
  return prose;
}
