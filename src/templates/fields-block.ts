import {
  SCENE_POV_OMNISCIENT,
  type ProgressStatus,
  type ScenePovMode,
  type TimeKind,
  type WorldbuildingKind,
} from "../domain";

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
  time: string;
  location: string;
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

interface FieldsCopy {
  characterTitle: string;
  sceneTitle: string;
  entityTitles: Record<WorldbuildingKind, string>;
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
      point: "Point in time",
      period: "Period",
      event: "Event",
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
      event: "事件",
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
 */
export function renderCharacterFieldsBlock(
  language: FieldsBlockLanguage,
  fields: CharacterFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.characterTitle, [
    ...commonEntries(copy, fields),
    { label: copy.oneSentenceStoryline, value: fields.oneSentenceStoryline },
    { label: copy.motivation, value: fields.motivation },
    { label: copy.goal, value: fields.goal },
    { label: copy.conflict, value: fields.conflict },
    { label: copy.growth, value: fields.growth },
  ], copy.separator);
}

export function renderSceneFieldsBlock(
  language: FieldsBlockLanguage,
  fields: SceneFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.sceneTitle, [
    ...commonEntries(copy, fields),
    { label: copy.pov, value: renderPov(copy, fields.pov) },
    { label: copy.time, value: fields.time },
    { label: copy.location, value: fields.location },
    {
      label: copy.cast,
      value: fields.cast
        .map((member) => wikiLink(member.path, member.name))
        .filter((link) => link.length > 0)
        .join(copy.listSeparator),
    },
    { label: copy.conflict, value: fields.conflict },
  ], copy.separator);
}

export function renderEntityFieldsBlock(
  language: FieldsBlockLanguage,
  kind: WorldbuildingKind,
  fields: EntityFieldsView,
): string {
  const copy = COPY[language];
  return renderCallout(copy.entityTitles[kind], [
    ...commonEntries(copy, fields),
    ...timeEntries(copy, fields.time),
    { label: copy.description, value: fields.description },
  ], copy.separator);
}

function commonEntries(
  copy: FieldsCopy,
  fields: MemberFieldsCommon,
): FieldEntry[] {
  return [
    {
      label: copy.status,
      value:
        fields.progressStatus === null
          ? ""
          : copy.statusLabels[fields.progressStatus],
    },
    { label: copy.aliases, value: joinList(copy, fields.aliases) },
    { label: copy.category, value: joinList(copy, fields.categories) },
  ];
}

function timeEntries(
  copy: FieldsCopy,
  time: EntityTimeView | null,
): FieldEntry[] {
  if (time === null) return [];
  const entries: FieldEntry[] = [
    {
      label: copy.type,
      value: time.kind === null ? "" : copy.timeKindLabels[time.kind],
    },
  ];
  const start = time.start.trim();
  const end = time.end.trim();
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
