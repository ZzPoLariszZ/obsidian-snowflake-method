import type {
  CategoryNamespaceId,
  CharacterType,
  DefinitionFileId,
  ProjectLanguage,
} from "../domain";

/**
 * Definition files are the project's taxonomies: plain notes at the
 * worldbuilding root whose heading tree is the vocabulary. A path is the
 * heading chain, `# Character` > `## Race` > `### Elf` reads as
 * `Character/Race/Elf`, and frontmatter or record lines point at a heading
 * with `[[…/Category#Elf|Character/Race/Elf]]`: the anchor carries identity,
 * the alias shows the full path. Obsidian resolves a heading link by text
 * alone, which is why every heading must stay unique across the whole file,
 * even under different trees.
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
  fileNames: Record<DefinitionFileId, string>;
  categoryIntro: string;
  worldStatusIntro: string;
  relationshipIntro: string;
  namespaces: Record<CategoryNamespaceId, string>;
  roles: Record<CharacterType, string>;
  worldStatusStarters: string[];
  relationshipStarters: string[];
}

const COPY: Record<ProjectLanguage, DefinitionCopy> = {
  en: {
    fileNames: {
      category: "Category.md",
      "world-status": "World_Status.md",
      relationship: "Relationship.md",
    },
    categoryIntro:
      "Categories every entity can point at. Add a heading to add a category, and nest headings to build a path like Character/Race/Elf. Every heading must stay unique across this whole file.",
    worldStatusIntro:
      "The states an entity can be in inside the story. Records in a note's World Status section point at these headings.",
    relationshipIntro:
      "The ways entities relate to each other. Records in a note's Relationships section point at these headings.",
    namespaces: {
      character: "Character",
      scene: "Scene",
      time: "Time",
      location: "Location",
      item: "Item",
    },
    roles: { major: "Major", supporting: "Supporting", minor: "Minor" },
    worldStatusStarters: ["Injured", "Missing", "Deceased"],
    relationshipStarters: ["Ally", "Enemy", "Friend", "Family", "Member"],
  },
  "zh-CN": {
    fileNames: {
      category: "类别.md",
      "world-status": "世界状态.md",
      relationship: "关系.md",
    },
    categoryIntro:
      "所有实体可引用的类别。添加标题即添加类别，嵌套标题可组成「角色/种族/精灵」这样的路径。整份文件中的每个标题必须保持唯一。",
    worldStatusIntro: "实体在故事中可处于的状态。笔记「世界状态」区段中的记录会指向这些标题。",
    relationshipIntro: "实体之间的关系。笔记「关系」区段中的记录会指向这些标题。",
    namespaces: {
      character: "角色",
      scene: "场景",
      time: "时间",
      location: "地点",
      item: "物品",
    },
    roles: { major: "主角", supporting: "配角", minor: "次要角色" },
    worldStatusStarters: ["受伤", "失踪", "已故"],
    relationshipStarters: ["盟友", "敌人", "朋友", "家人", "成员"],
  },
};

export function definitionFileName(
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  return COPY[language].fileNames[id];
}

export function definitionFileTemplate(
  id: DefinitionFileId,
  language: ProjectLanguage,
): string {
  const copy = COPY[language];
  if (id === "category") {
    const lines = [copy.categoryIntro, "", `# ${copy.namespaces.character}`];
    for (const role of ["major", "supporting", "minor"] as const) {
      lines.push("", `## ${copy.roles[role]}`);
    }
    for (const namespace of ["scene", "time", "location", "item"] as const) {
      lines.push("", `# ${copy.namespaces[namespace]}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const intro =
    id === "world-status" ? copy.worldStatusIntro : copy.relationshipIntro;
  const starters =
    id === "world-status"
      ? copy.worldStatusStarters
      : copy.relationshipStarters;
  const lines = [intro];
  for (const starter of starters) lines.push("", `# ${starter}`);
  return `${lines.join("\n")}\n`;
}

export function categoryNamespaceLabel(
  language: ProjectLanguage,
  namespace: CategoryNamespaceId,
): string {
  return COPY[language].namespaces[namespace];
}

/** The seeded role heading for a character type, `Major` or `主角`. */
export function characterRoleHeading(
  language: ProjectLanguage,
  type: CharacterType,
): string {
  return COPY[language].roles[type];
}

/** The seeded role path for a character type, `Character/Major` or `角色/主角`. */
export function characterRolePath(
  language: ProjectLanguage,
  type: CharacterType,
): string {
  const copy = COPY[language];
  return `${copy.namespaces.character}/${copy.roles[type]}`;
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
