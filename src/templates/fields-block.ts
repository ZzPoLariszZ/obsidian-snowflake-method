import {
  SCENE_POV_OMNISCIENT,
  type DefinitionFileId,
  type ProgressStatus,
  type ScenePovMode,
  type TimeKind,
  type WorldbuildingKind,
} from "../domain";
import { parseTerm, renderTerm } from "./record-lines";

export type FieldsBlockLanguage = "en" | "zh-CN";

/**
 * The point of view a scene displays: a character resolved to a name, one of
 * the narrative modes, or nothing chosen yet. Resolution happens in the
 * service, which is the only layer that knows the project's characters; this
 * module only renders what it is handed.
 */
export type ScenePovField =
  | { kind: "character"; path: string; name: string }
  | { kind: "mode"; mode: ScenePovMode }
  | null;

/**
 * The universal lines every member note's overview opens with. Categories
 * arrive as their stored display form, link or plain path text, because the
 * stored form is already exactly what should be shown; a null status is a
 * note that never chose one, and the line is simply absent.
 */
export interface MemberFieldsCommon {
  progressStatus: ProgressStatus | null;
  aliases: readonly string[];
  categories: readonly string[];
}

export interface CharacterFieldsView extends MemberFieldsCommon {
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
}

export interface SceneFieldsView extends MemberFieldsCommon {
  pov: ScenePovField;
  times: readonly string[];
  locations: readonly string[];
  conflict: string;
  cast: readonly { path: string; name: string }[];
}

export interface EntityTimeView {
  kind: TimeKind | null;
  start: string;
  end: string;
}

export interface EntityFieldsView extends MemberFieldsCommon {
  description: string;
  /** Present only for kinds that carry the time fields. */
  time: EntityTimeView | null;
}

/**
 * What a definition node's own note shows. The path is where the node sits
 * right now, read from its folders rather than stored, so this block is the
 * one place a taxonomy entry reads as a name instead of as `_self`.
 */
export interface DefinitionFieldsView {
  taxonomyPath: string;
  description: string;
}

interface FieldsCopy {
  characterTitle: string;
  sceneTitle: string;
  entityTitles: Record<WorldbuildingKind, string>;
  definitionTitles: Record<DefinitionFileId, string>;
  definitionName: string;
  status: string;
  statusLabels: Record<ProgressStatus, string>;
  aliases: string;
  category: string;
  description: string;
  type: string;
  timeKindLabels: Record<TimeKind, string>;
  start: string;
  end: string;
  when: string;
  oneSentenceStoryline: string;
  motivation: string;
  goal: string;
  conflict: string;
  growth: string;
  pov: string;
  time: string;
  location: string;
  cast: string;
  povOmniscient: string;
  povMultiple: string;
  separator: string;
  listSeparator: string;
}

/**
 * The same wording the dashboard forms and the generated bases use for these
 * fields, kept here rather than read from the i18n layer so templates stay a
 * leaf module the services can import.
 */
const COPY: Record<FieldsBlockLanguage, FieldsCopy> = {
  en: {
    characterTitle: "Character overview",
    sceneTitle: "Scene overview",
    entityTitles: {
      time: "Time overview",
      location: "Location overview",
      item: "Item overview",
    },
    definitionTitles: {
      category: "Category",
      "world-status": "World status",
      relationship: "Relationship",
    },
    definitionName: "Name",
    status: "Progress status",
    statusLabels: {
      "not-started": "Not started",
      "in-progress": "In progress",
      "in-revision": "In revision",
      complete: "Complete",
    },
    aliases: "Aliases",
    category: "Category",
    description: "Description",
    type: "Type",
    timeKindLabels: {
      point: "Time point",
      period: "Time period",
    },
    start: "Start",
    end: "End",
    when: "When",
    oneSentenceStoryline: "One-sentence storyline",
    motivation: "Motivation",
    goal: "Goal",
    conflict: "Conflict",
    growth: "Growth",
    pov: "Point-of-view character",
    time: "Time",
    location: "Location",
    cast: "Characters",
    povOmniscient: "Omniscient",
    povMultiple: "Multi-POV",
    separator: ": ",
    listSeparator: ", ",
  },
  "zh-CN": {
    characterTitle: "角色概览",
    sceneTitle: "场景概览",
    entityTitles: {
      time: "时间概览",
      location: "地点概览",
      item: "物品概览",
    },
    definitionTitles: {
      category: "类别",
      "world-status": "状态",
      relationship: "关系",
    },
    definitionName: "名称",
    status: "进度",
    statusLabels: {
      "not-started": "未开始",
      "in-progress": "进行中",
      "in-revision": "修订中",
      complete: "已完成",
    },
    aliases: "别名",
    category: "类别",
    description: "描述",
    type: "类型",
    timeKindLabels: {
      point: "时间点",
      period: "时间段",
    },
    start: "开始",
    end: "结束",
    when: "时间",
    oneSentenceStoryline: "一句话故事概述",
    motivation: "动机",
    goal: "目标",
    conflict: "冲突",
    growth: "成长",
    pov: "视点人物",
    time: "时间",
    location: "地点",
    cast: "人物",
    povOmniscient: "全知视角",
    povMultiple: "多人视角",
    separator: "：",
    listSeparator: "、",
  },
};

/**
 * The read-only block a character note shows for its properties. The stored
 * values stay language-neutral in the frontmatter; only this display is
 * localized, which is safe because the block is generated and never parsed.
 *
 * The same order the properties read in everywhere else: what they are called,
 * what they are filed under, the story, and how far along it is last. The name
 * is not among them, because the note is already titled with it and the block
 * sits directly under that title.
 */
export function renderCharacterFieldsBlock(
  language: FieldsBlockLanguage,
  fields: CharacterFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.characterTitle, [
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
    { label: copy.oneSentenceStoryline, value: fields.oneSentenceStoryline },
    { label: copy.motivation, value: fields.motivation },
    { label: copy.goal, value: fields.goal },
    { label: copy.conflict, value: fields.conflict },
    { label: copy.growth, value: fields.growth },
    { label: copy.status, value: statusLabel(copy, fields.progressStatus) },
  ], copy.separator);
}

/**
 * A scene's properties in the order they read everywhere else: what it is
 * called and filed under, who tells it and where, then how far along it is.
 * The title is not among them, for the same reason a character's name is not.
 */
export function renderSceneFieldsBlock(
  language: FieldsBlockLanguage,
  fields: SceneFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.sceneTitle, [
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
    { label: copy.pov, value: renderPov(copy, fields.pov) },
    {
      label: copy.time,
      value: joinList(copy, fields.times),
    },
    {
      label: copy.location,
      value: joinList(copy, fields.locations),
    },
    {
      label: copy.cast,
      value: fields.cast
        .map((member) => wikiLink(member.path, member.name))
        .filter((link) => link.length > 0)
        .join(copy.listSeparator),
    },
    { label: copy.conflict, value: fields.conflict },
    { label: copy.status, value: statusLabel(copy, fields.progressStatus) },
  ], copy.separator);
}

/** The same order again: what it is called and filed under, what it is, how
 * far along it is. The name is the note's own title, as everywhere else. */
export function renderEntityFieldsBlock(
  language: FieldsBlockLanguage,
  kind: WorldbuildingKind,
  fields: EntityFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.entityTitles[kind], [
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
    ...timeEntries(copy, fields.time),
    { label: copy.description, value: fields.description },
    { label: copy.status, value: statusLabel(copy, fields.progressStatus) },
  ], copy.separator);
}

/**
 * The block a definition node's `_self.md` opens with. The note is named for
 * the file every node folder holds, so without this nothing on the page says
 * which entry it is. A node's name is its whole path, parents included, and
 * the callout's own title says which vocabulary that path belongs to: it is
 * here to be read, not to be stored.
 */
export function renderDefinitionFieldsBlock(
  language: FieldsBlockLanguage,
  id: DefinitionFileId,
  fields: DefinitionFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.definitionTitles[id], [
    { label: copy.definitionName, value: fields.taxonomyPath },
    { label: copy.description, value: fields.description },
  ], copy.separator);
}

function statusLabel(
  copy: FieldsCopy,
  status: ProgressStatus | null,
): string {
  return status === null ? "" : copy.statusLabels[status];
}

function timeEntries(
  copy: FieldsCopy,
  time: EntityTimeView | null,
): FieldEntry[] {
  if (time === null) return [];
  const entries: FieldEntry[] = [
    {
      label: copy.type,
      // A note can hold a kind this release no longer knows, and a line with
      // nothing to say is simply left out.
      value: time.kind === null ? "" : (copy.timeKindLabels[time.kind] ?? ""),
    },
  ];
  // A link with no display name is read out as the whole vault path, so what
  // the note stored is re-emitted through the codec before it is shown.
  const start = displayTerm(time.start);
  const end = displayTerm(time.end);
  if (start.length > 0 && end.length > 0) {
    entries.push({ label: copy.start, value: start });
    entries.push({ label: copy.end, value: end });
  } else if (start.length > 0) {
    entries.push({ label: copy.when, value: start });
  } else if (end.length > 0) {
    entries.push({ label: copy.end, value: end });
  }
  return entries;
}

/** A stored term as it should be read: a link keeps its name, text stays text. */
function displayTerm(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "" : renderTerm(parseTerm(trimmed));
}

function joinList(copy: FieldsCopy, values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(copy.listSeparator);
}

function renderPov(copy: FieldsCopy, pov: ScenePovField): string {
  if (pov === null) return "";
  if (pov.kind === "mode") {
    return pov.mode === SCENE_POV_OMNISCIENT
      ? copy.povOmniscient
      : copy.povMultiple;
  }
  return wikiLink(pov.path, pov.name);
}

interface FieldEntry {
  label: string;
  value: string;
}

/**
 * An `[!info]` callout: boxed in reading view and live preview, an ordinary
 * blockquote everywhere else, so the block reads as generated matter rather
 * than prose in every mode. Only fields holding a value appear; one paragraph
 * per shown field, and a value's own line breaks continue the paragraph as
 * unlabeled callout lines.
 */
function renderCallout(
  title: string,
  entries: readonly FieldEntry[],
  separator: string,
): string {
  const lines = [`> [!info] ${title}`];
  const filled = entries.filter((entry) => entry.value.trim().length > 0);
  filled.forEach((entry, index) => {
    if (index > 0) lines.push(">");
    const valueLines = entry.value.split(/\r\n|\r|\n/u);
    lines.push(`> **${entry.label}**${separator}${valueLines[0] ?? ""}`.trimEnd());
    for (const rest of valueLines.slice(1)) {
      lines.push(rest.length > 0 ? `> ${rest}` : ">");
    }
  });
  return lines.join("\n");
}

/**
 * Writes a link the way Obsidian writes one, matching `toWikiLink` in the
 * service layer: the path without its ".md", the alias stripped of the
 * characters that would end the link early.
 */
function wikiLink(path: string, alias: string): string {
  const target = path.trim().replace(/\.md$/u, "");
  if (!target) return "";
  const safeAlias = alias.replace(/[|\]]/gu, "").trim();
  return safeAlias ? `[[${target}|${safeAlias}]]` : `[[${target}]]`;
}
