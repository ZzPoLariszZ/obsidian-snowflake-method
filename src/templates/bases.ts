import { parseYaml, stringifyYaml } from "obsidian";

import { FRONTMATTER_KEYS } from "../domain";
import type { TemplateLanguage } from "./markdown";

/**
 * Obsidian Bases views over the character and scene notes of one project.
 *
 * A generated base is deliberately *not* a managed document: it carries no
 * Snowflake frontmatter, and the scaffold only ever checks that it exists.
 * Authors are expected to add their own views and column widths, so rewriting
 * one to match a canonical form would discard their work.
 */

/** Each id also names the project directory the base file is written into. */
export type ProjectBaseId = "characters" | "scenes";

export interface ProjectBaseDefinition {
  id: ProjectBaseId;
  fileName: string;
  content: string;
}

type SortDirection = "ASC" | "DESC";

interface BaseSort {
  property: string;
  direction: SortDirection;
}

interface BaseGroupBy {
  property: string;
  direction: SortDirection;
}

interface BaseView {
  type: "table";
  name: string;
  filters?: { and: string[] };
  groupBy?: BaseGroupBy;
  order: string[];
  sort: BaseSort[];
}

interface BaseDocument {
  filters: { and: string[] };
  formulas: Record<string, string>;
  properties: Record<string, { displayName: string }>;
  views: BaseView[];
}

interface Copy {
  charactersFileName: string;
  scenesFileName: string;
  characterName: string;
  characterType: string;
  majorType: string;
  supportingType: string;
  minorType: string;
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
  sceneName: string;
  scenePov: string;
  povOmniscient: string;
  povMultiple: string;
  sceneTime: string;
  sceneLocation: string;
  sceneCharacters: string;
  majorCharacterSheetView: string;
  allCharactersView: string;
  sceneListView: string;
  byPovView: string;
  byLocationView: string;
}

const COPY: Record<TemplateLanguage, Copy> = {
  en: {
    charactersFileName: "Characters.base",
    scenesFileName: "Scenes.base",
    characterName: "Name",
    characterType: "Type",
    majorType: "Major",
    supportingType: "Supporting",
    minorType: "Minor",
    oneSentenceStoryline: "One-sentence storyline",
    motivation: "Motivation",
    goal: "Goal",
    conflict: "Conflict",
    growth: "Growth",
    sceneName: "Scene name",
    scenePov: "POV character",
    povOmniscient: "Omniscient",
    povMultiple: "Multi-POV",
    sceneTime: "Time",
    sceneLocation: "Location",
    sceneCharacters: "Characters",
    majorCharacterSheetView: "Major Character Sheet",
    allCharactersView: "All Characters",
    sceneListView: "Scene List",
    byPovView: "By POV",
    byLocationView: "By Location",
  },
  "zh-CN": {
    charactersFileName: "角色总览.base",
    scenesFileName: "场景总览.base",
    characterName: "姓名",
    characterType: "类型",
    majorType: "主角",
    supportingType: "配角",
    minorType: "次要角色",
    oneSentenceStoryline: "一句话故事概述",
    motivation: "动机",
    goal: "目标",
    conflict: "冲突",
    growth: "成长",
    sceneName: "场景名称",
    scenePov: "视点人物",
    povOmniscient: "全知视角",
    povMultiple: "多人视角",
    sceneTime: "时间",
    sceneLocation: "地点",
    sceneCharacters: "人物",
    majorCharacterSheetView: "主要角色表",
    allCharactersView: "全部角色",
    sceneListView: "场景列表",
    byPovView: "按视点人物",
    byLocationView: "按地点",
  },
};

/**
 * The stable id the scaffold gives each system template note. Those notes carry
 * a real document type and project id, so they match a naive base filter and
 * have to be excluded by id. Matching the id rather than the `00_System` folder
 * keeps the filter correct after a project is renamed.
 */
function templateDocumentId(projectId: string, kind: ProjectBaseId): string {
  return kind === "characters"
    ? `${projectId}-template-character`
    : `${projectId}-template-scene`;
}

/** A property reference inside a filter or formula expression. */
function expr(key: string): string {
  return `note[${JSON.stringify(key)}]`;
}

function equals(key: string, value: string): string {
  return `${expr(key)} == ${JSON.stringify(value)}`;
}

function notEquals(key: string, value: string): string {
  return `${expr(key)} != ${JSON.stringify(value)}`;
}

/** Sorting always follows the rank the dashboard maintains. */
const RANK_SORT: BaseSort[] = [
  { property: FRONTMATTER_KEYS.rank, direction: "ASC" },
];

/**
 * A link whose display text is the name stored in frontmatter. Renaming a
 * character or scene rewrites that field but leaves the file name untouched, so
 * a plain `file.name` column would drift away from the dashboard.
 */
function nameLinkFormula(nameKey: string): string {
  return `if(${expr(nameKey)}, file.asLink(${expr(nameKey)}), file.asLink())`;
}

/**
 * Character type is stored as a canonical `major`/`supporting`/`minor` value, so
 * a raw column would read as English in a Chinese project while the dashboard
 * shows the translated label. An unrecognized value falls through unchanged
 * rather than rendering as blank.
 */
function characterTypeFormula(copy: Copy): string {
  const key = FRONTMATTER_KEYS.characterType;
  const label = (value: string): string => JSON.stringify(value);
  return (
    `if(${equals(key, "major")}, ${label(copy.majorType)}, ` +
    `if(${equals(key, "supporting")}, ${label(copy.supportingType)}, ` +
    `if(${equals(key, "minor")}, ${label(copy.minorType)}, ${expr(key)})))`
  );
}

/**
 * The point of view stores a wikilink for a character and a canonical
 * `omniscient`/`multiple` word for the narrative modes, so a raw column would
 * read the modes as English in a Chinese project. The link falls through
 * unchanged and keeps opening the character.
 */
function scenePovFormula(copy: Copy): string {
  const key = FRONTMATTER_KEYS.pov;
  return (
    `if(${equals(key, "omniscient")}, ${JSON.stringify(copy.povOmniscient)}, ` +
    `if(${equals(key, "multiple")}, ${JSON.stringify(copy.povMultiple)}, ${expr(key)}))`
  );
}

/**
 * A string that YAML reads back verbatim as a plain scalar: no leading
 * indicator character, no `:` or `#`, no trailing space.
 */
const PLAIN_SCALAR = /^[^\s"'&*?:|>%@`#[\]{},-][^:#\n]*[^\s:#]$|^[A-Za-z0-9]$/u;

function scalar(value: string): string {
  if (PLAIN_SCALAR.test(value)) return value;
  return `'${value.replace(/'/gu, "''")}'`;
}

/**
 * Writes the fixed document shape above rather than delegating to
 * `stringifyYaml`, which takes no options: it folds the longer filter
 * expressions across lines at its default width and emits anchors for the sort
 * clause every view shares. Both survive a round trip through a YAML parser,
 * but this file is meant to be opened and edited by authors.
 */
function render(document: BaseDocument): string {
  const lines: string[] = ["filters:", "  and:"];
  for (const filter of document.filters.and) {
    lines.push(`    - ${scalar(filter)}`);
  }

  lines.push("formulas:");
  for (const [name, expression] of Object.entries(document.formulas)) {
    lines.push(`  ${scalar(name)}: ${scalar(expression)}`);
  }

  lines.push("properties:");
  for (const [key, property] of Object.entries(document.properties)) {
    lines.push(`  ${scalar(key)}:`);
    lines.push(`    displayName: ${scalar(property.displayName)}`);
  }

  lines.push("views:");
  for (const view of document.views) {
    lines.push(`  - type: ${scalar(view.type)}`);
    lines.push(`    name: ${scalar(view.name)}`);
    if (view.filters) {
      lines.push("    filters:", "      and:");
      for (const filter of view.filters.and) {
        lines.push(`        - ${scalar(filter)}`);
      }
    }
    if (view.groupBy) {
      lines.push("    groupBy:");
      lines.push(`      property: ${scalar(view.groupBy.property)}`);
      lines.push(`      direction: ${scalar(view.groupBy.direction)}`);
    }
    lines.push("    order:");
    for (const column of view.order) {
      lines.push(`      - ${scalar(column)}`);
    }
    lines.push("    sort:");
    for (const sort of view.sort) {
      lines.push(`      - property: ${scalar(sort.property)}`);
      lines.push(`        direction: ${scalar(sort.direction)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function charactersBase(projectId: string, copy: Copy): string {
  const nameFormula = "character";
  const typeFormula = "character_type";
  return render({
    filters: {
      and: [
        equals(FRONTMATTER_KEYS.document, "character"),
        equals(FRONTMATTER_KEYS.projectId, projectId),
        notEquals(
          FRONTMATTER_KEYS.characterId,
          templateDocumentId(projectId, "characters"),
        ),
      ],
    },
    formulas: {
      [nameFormula]: nameLinkFormula(FRONTMATTER_KEYS.characterName),
      [typeFormula]: characterTypeFormula(copy),
    },
    properties: {
      [`formula.${nameFormula}`]: { displayName: copy.characterName },
      [`formula.${typeFormula}`]: { displayName: copy.characterType },
      [`note.${FRONTMATTER_KEYS.characterName}`]: { displayName: copy.characterName },
      [`note.${FRONTMATTER_KEYS.characterType}`]: { displayName: copy.characterType },
      [`note.${FRONTMATTER_KEYS.oneSentenceStoryline}`]: {
        displayName: copy.oneSentenceStoryline,
      },
      [`note.${FRONTMATTER_KEYS.motivation}`]: { displayName: copy.motivation },
      [`note.${FRONTMATTER_KEYS.goal}`]: { displayName: copy.goal },
      [`note.${FRONTMATTER_KEYS.conflict}`]: { displayName: copy.conflict },
      [`note.${FRONTMATTER_KEYS.growth}`]: { displayName: copy.growth },
    },
    views: [
      {
        type: "table",
        name: copy.majorCharacterSheetView,
        filters: { and: [equals(FRONTMATTER_KEYS.characterType, "major")] },
        order: [
          `formula.${nameFormula}`,
          FRONTMATTER_KEYS.oneSentenceStoryline,
          FRONTMATTER_KEYS.motivation,
          FRONTMATTER_KEYS.goal,
          FRONTMATTER_KEYS.conflict,
          FRONTMATTER_KEYS.growth,
        ],
        sort: RANK_SORT,
      },
      {
        type: "table",
        name: copy.allCharactersView,
        groupBy: { property: `formula.${typeFormula}`, direction: "ASC" },
        order: [
          `formula.${nameFormula}`,
          `formula.${typeFormula}`,
          FRONTMATTER_KEYS.oneSentenceStoryline,
          FRONTMATTER_KEYS.motivation,
          FRONTMATTER_KEYS.goal,
          FRONTMATTER_KEYS.conflict,
          FRONTMATTER_KEYS.growth,
        ],
        sort: RANK_SORT,
      },
    ],
  });
}

function scenesBase(projectId: string, copy: Copy): string {
  const nameFormula = "scene";
  const povFormula = "pov";
  const povColumn = `formula.${povFormula}`;
  const sceneColumns = [
    povColumn,
    FRONTMATTER_KEYS.sceneTime,
    FRONTMATTER_KEYS.sceneLocation,
    FRONTMATTER_KEYS.sceneCharacters,
    FRONTMATTER_KEYS.conflict,
  ];
  const without = (excluded: string): string[] =>
    sceneColumns.filter((column) => column !== excluded);
  return render({
    filters: {
      and: [
        equals(FRONTMATTER_KEYS.document, "scene"),
        equals(FRONTMATTER_KEYS.projectId, projectId),
        notEquals(
          FRONTMATTER_KEYS.sceneId,
          templateDocumentId(projectId, "scenes"),
        ),
      ],
    },
    formulas: {
      [nameFormula]: nameLinkFormula(FRONTMATTER_KEYS.sceneTitle),
      [povFormula]: scenePovFormula(copy),
    },
    properties: {
      [`formula.${nameFormula}`]: { displayName: copy.sceneName },
      [povColumn]: { displayName: copy.scenePov },
      [`note.${FRONTMATTER_KEYS.sceneTitle}`]: { displayName: copy.sceneName },
      [`note.${FRONTMATTER_KEYS.pov}`]: { displayName: copy.scenePov },
      [`note.${FRONTMATTER_KEYS.sceneTime}`]: { displayName: copy.sceneTime },
      [`note.${FRONTMATTER_KEYS.sceneLocation}`]: { displayName: copy.sceneLocation },
      [`note.${FRONTMATTER_KEYS.sceneCharacters}`]: {
        displayName: copy.sceneCharacters,
      },
      [`note.${FRONTMATTER_KEYS.conflict}`]: { displayName: copy.conflict },
    },
    views: [
      {
        type: "table",
        name: copy.sceneListView,
        order: [`formula.${nameFormula}`, ...sceneColumns],
        sort: RANK_SORT,
      },
      {
        type: "table",
        name: copy.byPovView,
        groupBy: { property: povColumn, direction: "ASC" },
        order: [`formula.${nameFormula}`, ...without(povColumn)],
        sort: RANK_SORT,
      },
      {
        type: "table",
        name: copy.byLocationView,
        groupBy: { property: FRONTMATTER_KEYS.sceneLocation, direction: "ASC" },
        order: [
          `formula.${nameFormula}`,
          ...without(FRONTMATTER_KEYS.sceneLocation),
        ],
        sort: RANK_SORT,
      },
    ],
  });
}

/**
 * Bookkeeping keys a base never grows on its own: identity and machinery
 * every note carries, whose column would say nothing. The name keys are here
 * too, because the generated name formula already links each row by name.
 */
export const BASE_EXCLUDED_COLUMN_KEYS: ReadonlySet<string> = new Set([
  FRONTMATTER_KEYS.schema,
  FRONTMATTER_KEYS.document,
  FRONTMATTER_KEYS.projectId,
  FRONTMATTER_KEYS.projectName,
  FRONTMATTER_KEYS.projectLanguage,
  FRONTMATTER_KEYS.stepStatuses,
  FRONTMATTER_KEYS.reviewedFingerprints,
  FRONTMATTER_KEYS.draft,
  FRONTMATTER_KEYS.manuscriptSequence,
  FRONTMATTER_KEYS.characterId,
  FRONTMATTER_KEYS.sceneId,
  FRONTMATTER_KEYS.rank,
  FRONTMATTER_KEYS.characterName,
  FRONTMATTER_KEYS.sceneTitle,
]);

/** Localized display names for the member keys a base may gain later. */
export function baseColumnDisplayNames(
  language: TemplateLanguage,
): ReadonlyMap<string, string> {
  const copy = COPY[language];
  return new Map([
    [FRONTMATTER_KEYS.characterType, copy.characterType],
    [FRONTMATTER_KEYS.oneSentenceStoryline, copy.oneSentenceStoryline],
    [FRONTMATTER_KEYS.motivation, copy.motivation],
    [FRONTMATTER_KEYS.goal, copy.goal],
    [FRONTMATTER_KEYS.conflict, copy.conflict],
    [FRONTMATTER_KEYS.growth, copy.growth],
    [FRONTMATTER_KEYS.pov, copy.scenePov],
    [FRONTMATTER_KEYS.sceneTime, copy.sceneTime],
    [FRONTMATTER_KEYS.sceneLocation, copy.sceneLocation],
    [FRONTMATTER_KEYS.sceneCharacters, copy.sceneCharacters],
  ]);
}

export interface BaseColumnAddition {
  key: string;
  displayName?: string;
}

/**
 * Appends columns for properties the base does not reference anywhere yet, so
 * a field that moves into the frontmatter, or one the author invents later,
 * shows up the next time the base opens. Append-only on purpose: a key
 * referenced by any view, or named under `properties`, is one the author has
 * already decided about, and hiding or reordering is theirs to keep. The
 * whole document is re-serialized, which normalizes formatting the same way
 * Obsidian's own view editor does, and preserves every setting in it.
 */
export function appendBaseColumns(
  content: string,
  additions: readonly BaseColumnAddition[],
): { content: string; added: string[] } {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return { content, added: [] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { content, added: [] };
  }
  const base = parsed as {
    properties?: Record<string, Record<string, unknown>>;
    views?: { order?: unknown }[];
  };

  const referenced = new Set<string>();
  for (const key of Object.keys(base.properties ?? {})) {
    referenced.add(key);
  }
  for (const view of base.views ?? []) {
    if (!Array.isArray(view.order)) continue;
    for (const column of view.order) {
      if (typeof column === "string") referenced.add(column);
    }
  }
  const isReferenced = (key: string): boolean =>
    referenced.has(key) || referenced.has(`note.${key}`);

  const added: string[] = [];
  for (const addition of additions) {
    if (isReferenced(addition.key)) continue;
    const column = `note.${addition.key}`;
    added.push(column);
    if (addition.displayName !== undefined) {
      base.properties ??= {};
      base.properties[column] = {
        ...(base.properties[column] ?? {}),
        displayName: addition.displayName,
      };
    }
    for (const view of base.views ?? []) {
      if (!Array.isArray(view.order)) continue;
      view.order.push(column);
    }
  }
  if (added.length === 0) return { content, added };
  return { content: stringifyYaml(parsed), added };
}

export function getProjectBases(
  projectId: string,
  language: TemplateLanguage,
): ProjectBaseDefinition[] {
  const copy = COPY[language];
  return [
    {
      id: "characters",
      fileName: copy.charactersFileName,
      content: charactersBase(projectId, copy),
    },
    {
      id: "scenes",
      fileName: copy.scenesFileName,
      content: scenesBase(projectId, copy),
    },
  ];
}
