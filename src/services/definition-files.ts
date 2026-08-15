import {
  DEFINITION_FILE_IDS,
  type CharacterType,
  type DefinitionFileId,
  type EntityKind,
  type ProjectLanguage,
} from "../domain";
import { entityKindFolder, getProjectPathLayout } from "./types";

/**
 * Definition files are the project's taxonomies: plain notes whose heading
 * tree is the vocabulary. Each entity kind owns its own set, in the folder
 * its notes live in, so a vocabulary is scoped to the kind that uses it. A
 * path is the heading chain, `# Race` > `## Elf` reads as `Race/Elf`, and
 * frontmatter or record lines point at a heading with
 * `[[…/Category#Elf|Race/Elf]]`: the anchor carries identity, the alias shows
 * the full path, and the link target is always the definition file's full
 * vault path. Obsidian resolves a heading link by text alone, which is why
 * every heading must stay unique across its own file, even under different
 * trees. Across files nothing has to agree: two kinds may both name a
 * heading `Origin`.
 *
 * The files are deliberately ordinary Markdown. Users extend them by typing
 * headings or through the pickers, the plugin only ever appends, and the
 * health checker is what reports duplicates and dangling links.
 */

export interface DefinitionEntry {
  /** The heading text, which is the link anchor. */
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

export function findDefinitionEntry(
  tree: DefinitionTree,
  heading: string,
): DefinitionEntry | null {
  return (
    tree.entries.find((entry) => entry.heading === heading.trim()) ?? null
  );
}

export type AppendPathResult =
  | { ok: true; content: string; addedHeadings: string[] }
  | { ok: false; code: "invalid-segment" | "heading-taken"; segment: string };

/**
 * Ensures a path exists, appending only the missing tail. A new heading lands
 * at the end of its parent's subtree so the tree stays grouped, and a segment
 * whose text already names a different path is refused rather than reused:
 * anchors resolve by text alone, so reuse would point old links somewhere new.
 */
export function appendDefinitionPath(
  content: string,
  path: string,
): AppendPathResult {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { ok: false, code: "invalid-segment", segment: path };
  }
  for (const segment of segments) {
    if (!isValidDefinitionSegment(segment)) {
      return { ok: false, code: "invalid-segment", segment };
    }
  }

  const tree = parseDefinitionFile(content);
  const byPath = new Map(tree.entries.map((entry) => [entry.path, entry]));

  let depth = segments.length;
  while (depth > 0 && !byPath.has(segments.slice(0, depth).join("/"))) {
    depth -= 1;
  }
  const missing = segments.slice(depth);
  if (missing.length === 0) {
    return { ok: true, content, addedHeadings: [] };
  }
  for (const segment of missing) {
    if (findDefinitionEntry(tree, segment) !== null) {
      return { ok: false, code: "heading-taken", segment };
    }
  }

  const lines = content.split(/\r\n|\r|\n/u);
  let insertAfter = lines.length - 1;
  if (depth > 0) {
    const anchor = byPath.get(segments.slice(0, depth).join("/")) as DefinitionEntry;
    const subtreeEnd = tree.entries.find(
      (entry) => entry.line > anchor.line && entry.level <= anchor.level,
    );
    insertAfter =
      subtreeEnd === undefined ? lines.length - 1 : subtreeEnd.line - 1;
    while (insertAfter > anchor.line && (lines[insertAfter] ?? "").trim() === "") {
      insertAfter -= 1;
    }
  } else {
    while (insertAfter >= 0 && (lines[insertAfter] ?? "").trim() === "") {
      insertAfter -= 1;
    }
  }

  const added: string[] = [];
  const block: string[] = [];
  for (let index = 0; index < missing.length; index += 1) {
    const level = depth + index + 1;
    const segment = missing[index] as string;
    block.push("", `${"#".repeat(Math.min(level, 6))} ${segment}`);
    added.push(segment);
  }
  const next = [
    ...lines.slice(0, insertAfter + 1),
    ...block,
    ...lines.slice(insertAfter + 1),
  ];
  let result = next.join("\n");
  if (content.endsWith("\n") && !result.endsWith("\n")) result += "\n";
  return { ok: true, content: result, addedHeadings: added };
}

/**
 * A heading that can anchor a link and sit inside a path: no path separator,
 * nothing that ends a wikilink early, no leading hash.
 */
export function isValidDefinitionSegment(segment: string): boolean {
  const trimmed = segment.trim();
  return (
    trimmed.length > 0 &&
    !/[/#|[\]]/u.test(trimmed) &&
    !trimmed.startsWith("^")
  );
}

export interface HeadingLink {
  path: string;
  heading: string;
  display: string | null;
}

const HEADING_LINK_PATTERN = /^\[\[([^\]|#]*)#([^\]|]+)(?:\|([^\]]+))?\]\]$/u;

/** Reads a whole value of the form `[[path#heading|alias]]`. */
export function parseHeadingLink(value: unknown): HeadingLink | null {
  if (typeof value !== "string") return null;
  const match = HEADING_LINK_PATTERN.exec(value.trim());
  if (match === null) return null;
  return {
    path: (match[1] ?? "").trim(),
    heading: (match[2] ?? "").trim(),
    display: match[3] === undefined ? null : match[3].trim(),
  };
}

export function renderHeadingLink(
  filePath: string,
  heading: string,
  display: string,
): string {
  const target = filePath.trim().replace(/\.md$/u, "");
  return `[[${target}#${heading}|${display.replace(/[|\]]/gu, "").trim()}]]`;
}

interface DefinitionCopy {
  /** File names without their number, which the folder decides. */
  fileStems: Record<DefinitionFileId, string>;
  categoryIntro: string;
  worldStatusIntro: string;
  relationshipIntro: string;
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
    categoryIntro:
      "Categories notes of this kind can point at. Add a heading to add a category, and nest headings to build a path like Race/Elf. Every heading must stay unique across this whole file.",
    worldStatusIntro:
      "The states an entity of this kind can be in inside the story. Records in a note's World Status section point at these headings.",
    relationshipIntro:
      "The ways an entity of this kind relates to others. Records in a note's Relationships section point at these headings, and their targets may be entities of any kind.",
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
    categoryIntro:
      "此类笔记可引用的类别。添加标题即添加类别，嵌套标题可组成「种族/精灵」这样的路径。整份文件中的每个标题必须保持唯一。",
    worldStatusIntro: "此类实体在故事中可处于的状态。笔记「世界状态」区段中的记录会指向这些标题。",
    relationshipIntro:
      "此类实体与其他实体之间的关系。笔记「关系」区段中的记录会指向这些标题，记录的对象可以是任何类型的实体。",
    roles: { major: "主角", supporting: "配角", minor: "次要角色" },
    worldStatusStarters: ["受伤", "失踪", "已故"],
    relationshipStarters: ["盟友", "敌人", "朋友", "家人", "成员"],
  },
};

/**
 * A definition file is numbered after the folder it sits in, the way
 * `10_Summary` holds `11_One_Sentence_Summary.md`: the folder's number gives
 * up its trailing zero to the file's position, and where there is no zero to
 * give up the position is appended instead. Characters get 21/22/23 inside
 * `20_Character`, locations 621/622/623 inside `62_Location`, so the three
 * files sort together above the notes they classify.
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

export function definitionFileName(
  kind: EntityKind,
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  const stem = COPY[language].fileStems[id];
  const number = definitionFileNumber(kind, id, language);
  return number.length === 0 ? `${stem}.md` : `${number}_${stem}.md`;
}

/**
 * What a kind's definition file holds on creation. Characters arrive with the
 * vocabulary the plugin itself depends on or has always suggested: the three
 * role categories the type field stands on, and the starter status and
 * relationship labels. Every other kind starts with an intro line and an
 * empty tree, because its vocabulary is the author's to invent.
 */
export function definitionFileTemplate(
  kind: EntityKind,
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  const copy = COPY[language];
  const intro =
    id === "category"
      ? copy.categoryIntro
      : id === "world-status"
        ? copy.worldStatusIntro
        : copy.relationshipIntro;
  const lines = [intro];
  if (kind === "character") {
    const starters =
      id === "category"
        ? (["major", "supporting", "minor"] as const).map(
            (role) => copy.roles[role],
          )
        : id === "world-status"
          ? copy.worldStatusStarters
          : copy.relationshipStarters;
    for (const starter of starters) lines.push("", `# ${starter}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The seeded role heading for a character type, `Major` or `主角`. With the
 * category file scoped to characters this is also the role's whole path.
 */
export function characterRoleHeading(
  language: ProjectLanguage,
  type: CharacterType,
): string {
  return COPY[language].roles[type];
}

/**
 * The character type a heading names, in either language. Both languages are
 * consulted because a project's language can change while its notes keep the
 * links they were written with.
 */
export function characterTypeFromHeading(
  heading: string,
): CharacterType | null {
  for (const language of ["en", "zh-CN"] as const) {
    const roles = COPY[language].roles;
    for (const type of ["major", "supporting", "minor"] as const) {
      if (heading === roles[type]) return type;
    }
  }
  return null;
}

/**
 * Reads a character's role out of its category links: the first link whose
 * anchor is one of the seeded role headings decides.
 */
export function characterRoleFromCategories(
  values: unknown,
): CharacterType | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    const link = parseHeadingLink(value);
    if (link === null) continue;
    const type = characterTypeFromHeading(link.heading);
    if (type !== null) return type;
  }
  return null;
}
